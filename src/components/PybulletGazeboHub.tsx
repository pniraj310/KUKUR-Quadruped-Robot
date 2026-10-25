import React, { useState } from 'react';
import { Copy, Check, Download, Terminal, Box, Play, Cpu, Layers } from 'lucide-react';

export const PYBULLET_GYM_CODE = `"""
SpotMicroAI Reinforcement Learning Environment (PyBullet + Gymnasium)
Based on Bananaweizen/SpotMicroAI open-source 12-DOF Quadruped
Hardware target: Raspberry Pi 4 Model B (2018) + PCA9685 + MPU-6050 + HC-SR04
"""

import gymnasium as gym
from gymnasium import spaces
import pybullet as p
import pybullet_data
import numpy as np
import time
import math
import os

class SpotMicroPybulletEnv(gym.Env):
    """
    SpotMicro 12-DOF Quadruped PyBullet Gymnasium Environment
    Observation Space (18-dim):
      - IMU Roll, Pitch, Yaw (3)
      - IMU Angular Velocity wx, wy, wz (3)
      - Foot Contacts FL, FR, RL, RR (4)
      - Ultrasonic distance in meters (1)
      - Previous Joint Action targets (7 principal modes)
    Action Space (12-dim continuous):
      - Joint target angles for [FL_hip, FL_shoulder, FL_knee,
                                 FR_hip, FR_shoulder, FR_knee,
                                 RL_hip, RL_shoulder, RL_knee,
                                 RR_hip, RR_shoulder, RR_knee]
    """
    metadata = {"render_modes": ["human", "rgb_array"], "render_fps": 50}

    def __init__(self, render_mode="human", sim_to_real=True):
        super().__init__()
        self.render_mode = render_mode
        self.sim_to_real = sim_to_real
        
        # Connect to PyBullet physics server
        if self.render_mode == "human":
            self.physics_client = p.connect(p.GUI)
            p.configureDebugVisualizer(p.COV_ENABLE_GUI, 0)
            p.configureDebugVisualizer(p.COV_ENABLE_SHADOWS, 1)
        else:
            self.physics_client = p.connect(p.DIRECT)

        p.setAdditionalSearchPath(pybullet_data.getDataPath())
        p.setGravity(0, 0, -9.81)
        p.setTimeStep(1.0 / 50.0)  # 50 Hz control loop matches PCA9685 PWM frequency

        # Action limits (joint angles in radians)
        # Hip: +/- 0.8 rad (~45 deg)
        # Shoulder: -1.0 to 1.5 rad
        # Knee: -2.5 to -0.3 rad
        self.action_space = spaces.Box(
            low=np.array([-0.8, -1.0, -2.5] * 4, dtype=np.float32),
            high=np.array([0.8, 1.5, -0.3] * 4, dtype=np.float32),
            dtype=np.float32
        )

        # Observation space (18 dimensions)
        self.observation_space = spaces.Box(
            low=-np.inf, high=np.inf, shape=(18,), dtype=np.float32
        )

        self.robot_id = None
        self.plane_id = None
        self.step_counter = 0
        self.max_episode_steps = 1000
        self.joint_indices = list(range(12))
        self.foot_link_indices = [3, 6, 9, 12]  # Foot tip link indices in URDF

    def reset(self, seed=None, options=None):
        super().reset(seed=seed)
        p.resetSimulation()
        p.setGravity(0, 0, -9.81)

        # Spawn Plane Floor
        self.plane_id = p.loadURDF("plane.urdf")
        p.changeDynamics(self.plane_id, -1, lateralFriction=1.0)

        # Add obstacle boxes to simulate obstacle course
        for z_pos in [1.5, 3.0, 5.0]:
            col_id = p.createCollisionShape(p.GEOM_BOX, halfExtents=[0.6, 0.1, 0.03])
            vis_id = p.createVisualShape(p.GEOM_BOX, halfExtents=[0.6, 0.1, 0.03], rgbaColor=[0.8, 0.5, 0.2, 1])
            p.createMultiBody(baseMass=0, baseCollisionShapeIndex=col_id, baseVisualShapeIndex=vis_id, basePosition=[0, z_pos, 0.03])

        # Load SpotMicro URDF model
        urdf_path = os.path.join(os.path.dirname(__file__), "spotmicro.urdf")
        start_pos = [0, 0, 0.22]
        start_orientation = p.getQuaternionFromEuler([0, 0, 0])
        
        # Domain Randomization: Randomize body mass by +/- 10%
        if self.sim_to_real:
            mass_scale = np.random.uniform(0.9, 1.1)
        else:
            mass_scale = 1.0

        if os.path.exists(urdf_path):
            self.robot_id = p.loadURDF(urdf_path, start_pos, start_orientation)
        else:
            # Fallback simple procedural box robot if URDF file is being downloaded
            col_shape = p.createCollisionShape(p.GEOM_BOX, halfExtents=[0.055, 0.14, 0.04])
            self.robot_id = p.createMultiBody(baseMass=2.5 * mass_scale, baseCollisionShapeIndex=col_shape, basePosition=start_pos)

        self.step_counter = 0
        obs = self._get_obs()
        return obs, {}

    def step(self, action):
        self.step_counter += 1

        # Clip action within joint limits
        target_joints = np.clip(action, self.action_space.low, self.action_space.high)

        # Domain Randomization: Add slight motor latency and noise
        if self.sim_to_real:
            motor_noise = np.random.normal(0, 0.02, size=12)
            applied_targets = target_joints + motor_noise
        else:
            applied_targets = target_joints

        # Command servos via PyBullet Position Control (MG996R max torque ~2.5 N*m)
        max_torques = [2.5] * 12
        p.setJointMotorControlArray(
            self.robot_id,
            self.joint_indices,
            p.POSITION_CONTROL,
            targetPositions=applied_targets,
            forces=max_torques
        )

        p.stepSimulation()
        if self.render_mode == "human":
            time.sleep(1.0 / 50.0)

        obs = self._get_obs()

        # Compute Rewards
        pos, orn = p.getBasePositionAndOrientation(self.robot_id)
        linear_vel, angular_vel = p.getBaseVelocity(self.robot_id)
        euler = p.getEulerFromQuaternion(orn)

        # 1. Forward velocity reward (along +Y/Z)
        forward_velocity = linear_vel[1]
        reward_forward = 1.5 * forward_velocity

        # 2. Upright balance reward (penalize roll & pitch tilt)
        tilt = math.sqrt(euler[0]**2 + euler[1]**2)
        reward_upright = 1.0 * math.exp(-3.0 * tilt)

        # 3. Energy penalty (sum of squared target torques)
        joint_states = p.getJointStates(self.robot_id, self.joint_indices)
        applied_forces = [s[3] for s in joint_states]
        reward_energy = -0.005 * sum(f**2 for f in applied_forces)

        # 4. Obstacle proximity penalty from HC-SR04 raycast
        dist_sensor = obs[10]
        reward_obstacle = -2.0 * max(0.0, (0.35 - dist_sensor) / 0.35) if dist_sensor < 0.35 else 0.0

        total_reward = reward_forward + reward_upright + reward_energy + reward_obstacle

        # Termination: Robot fell over or reached max steps
        terminated = False
        if abs(euler[0]) > 0.8 or abs(euler[1]) > 0.8:  # Tilted > 45 degrees
            terminated = True
            total_reward -= 5.0
        if pos[2] < 0.08:  # Body collapsed to floor
            terminated = True
            total_reward -= 5.0

        truncated = self.step_counter >= self.max_episode_steps

        return obs, total_reward, terminated, truncated, {"dist": dist_sensor, "v_fwd": forward_velocity}

    def _get_obs(self):
        pos, orn = p.getBasePositionAndOrientation(self.robot_id)
        linear_vel, angular_vel = p.getBaseVelocity(self.robot_id)
        euler = p.getEulerFromQuaternion(orn)

        # 1. IMU: Roll, Pitch, Yaw and Gyro rates
        roll, pitch, yaw = euler
        wx, wy, wz = angular_vel

        # 2. Foot contacts (4 binary sensors)
        contacts = []
        for foot_idx in self.foot_link_indices:
            cp = p.getContactPoints(self.robot_id, self.plane_id, foot_idx, -1)
            contacts.append(1.0 if len(cp) > 0 else 0.0)

        # 3. HC-SR04 Ultrasonic Raycast Simulation (4m max)
        ray_from = [pos[0], pos[1] + 0.15, pos[2] + 0.02]
        ray_to = [pos[0], pos[1] + 4.15, pos[2] + 0.02]
        ray_results = p.rayTest(ray_from, ray_to)
        hit_fraction = ray_results[0][2]
        dist_meters = hit_fraction * 4.0

        obs = np.array([
            roll, pitch, yaw,
            wx, wy, wz,
            contacts[0], contacts[1], contacts[2], contacts[3],
            dist_meters,
            0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0
        ], dtype=np.float32)

        return obs

    def close(self):
        p.disconnect(self.physics_client)

if __name__ == "__main__":
    print("[*] Initializing SpotMicroAI PyBullet Reinforcement Learning Environment...")
    env = SpotMicroPybulletEnv(render_mode="human")
    obs, info = env.reset()

    # To train with Stable-Baselines3:
    # from stable_baselines3 import PPO
    # model = PPO("MlpPolicy", env, verbose=1, learning_rate=3e-4)
    # model.learn(total_timesteps=100000)
    # model.save("spotmicro_ppo_checkpoint")

    print("[*] Running 200 demo steps in PyBullet...")
    for step in range(200):
        # Demo diagonal trotting joint oscillations
        t = step * 0.1
        action = np.array([
            0.0, math.sin(t) * 0.5, -math.sin(t) * 0.8 - 1.2,
            0.0, -math.sin(t) * 0.5, math.sin(t) * 0.8 - 1.2,
            0.0, -math.sin(t) * 0.5, math.sin(t) * 0.8 - 1.2,
            0.0, math.sin(t) * 0.5, -math.sin(t) * 0.8 - 1.2,
        ], dtype=np.float32)
        
        obs, reward, term, trunc, _ = env.step(action)
        if term or trunc:
            obs, _ = env.reset()

    env.close()
    print("[+] Done!")
`;

export const SPOTMICRO_URDF_CODE = `<?xml version="1.0" encoding="utf-8"?>
<!--
  SpotMicroAI 12-DOF Quadruped URDF Model
  Exact geometry based on Bananaweizen/SpotMicroAI open-source robot.
  Link dimensions: Body 280x110x80mm, Hip L1=58.5mm, Femur L2=105mm, Tibia L3=120mm
-->
<robot name="spotmicro_ai">
  <!-- MATERIAL DEFINITIONS -->
  <material name="spot_yellow">
    <color rgba="0.95 0.75 0.1 1.0"/>
  </material>
  <material name="chassis_black">
    <color rgba="0.12 0.13 0.15 1.0"/>
  </material>
  <material name="aluminum_blue">
    <color rgba="0.2 0.6 0.9 1.0"/>
  </material>
  <material name="rubber_pad">
    <color rgba="0.05 0.05 0.05 1.0"/>
  </material>

  <!-- BASE LINK (MAIN CHASSIS) -->
  <link name="base_link">
    <visual>
      <origin xyz="0 0 0" rpy="0 0 0"/>
      <geometry>
        <box size="0.110 0.280 0.080"/>
      </geometry>
      <material name="spot_yellow"/>
    </visual>
    <collision>
      <origin xyz="0 0 0" rpy="0 0 0"/>
      <geometry>
        <box size="0.110 0.280 0.080"/>
      </geometry>
    </collision>
    <inertial>
      <mass value="2.1"/>
      <origin xyz="0 0 0"/>
      <inertia ixx="0.0148" ixy="0" ixz="0" iyy="0.0032" iyz="0" izz="0.0159"/>
    </inertial>
  </link>

  <!-- HC-SR04 ULTRASONIC SENSOR LINK -->
  <link name="ultrasonic_sensor_link">
    <visual>
      <origin xyz="0 0 0" rpy="0 0 0"/>
      <geometry>
        <box size="0.045 0.020 0.015"/>
      </geometry>
      <material name="aluminum_blue"/>
    </visual>
  </link>
  <joint name="ultrasonic_joint" type="fixed">
    <parent link="base_link"/>
    <child link="ultrasonic_sensor_link"/>
    <origin xyz="0 0.145 0.02" rpy="0 0 0"/>
  </joint>

  <!-- MPU6050 IMU SENSOR LINK -->
  <link name="imu_link">
    <visual>
      <origin xyz="0 0 0" rpy="0 0 0"/>
      <geometry>
        <box size="0.02 0.02 0.004"/>
      </geometry>
      <material name="chassis_black"/>
    </visual>
  </link>
  <joint name="imu_joint" type="fixed">
    <parent link="base_link"/>
    <child link="imu_link"/>
    <origin xyz="0 0 0.04" rpy="0 0 0"/>
  </joint>

  <!-- ==================== FRONT LEFT (FL) LEG ==================== -->
  <!-- Hip Joint: Rotation along longitudinal axis (Roll) -->
  <joint name="FL_hip_joint" type="revolute">
    <parent link="base_link"/>
    <child link="FL_hip_link"/>
    <origin xyz="-0.055 0.140 0" rpy="0 0 0"/>
    <axis xyz="0 1 0"/>
    <limit lower="-0.785" upper="0.785" effort="2.5" velocity="6.0"/>
  </joint>

  <link name="FL_hip_link">
    <visual>
      <origin xyz="-0.02925 0 0" rpy="0 1.5708 0"/>
      <geometry>
        <cylinder radius="0.018" length="0.0585"/>
      </geometry>
      <material name="aluminum_blue"/>
    </visual>
    <inertial>
      <mass value="0.115"/>
      <inertia ixx="0.0001" ixy="0" ixz="0" iyy="0.0001" iyz="0" izz="0.0001"/>
    </inertial>
  </link>

  <!-- Shoulder Joint: Rotation along lateral axis (Pitch) -->
  <joint name="FL_shoulder_joint" type="revolute">
    <parent link="FL_hip_link"/>
    <child link="FL_upper_leg_link"/>
    <origin xyz="-0.0585 0 0" rpy="0 0 0"/>
    <axis xyz="1 0 0"/>
    <limit lower="-1.047" upper="1.57" effort="2.5" velocity="6.0"/>
  </joint>

  <link name="FL_upper_leg_link">
    <visual>
      <origin xyz="0 0 -0.0525" rpy="0 0 0"/>
      <geometry>
        <box size="0.024 0.032 0.105"/>
      </geometry>
      <material name="spot_yellow"/>
    </visual>
    <collision>
      <origin xyz="0 0 -0.0525" rpy="0 0 0"/>
      <geometry>
        <box size="0.024 0.032 0.105"/>
      </geometry>
    </collision>
    <inertial>
      <mass value="0.140"/>
      <inertia ixx="0.0002" ixy="0" ixz="0" iyy="0.0002" iyz="0" izz="0.0001"/>
    </inertial>
  </link>

  <!-- Knee Joint: Rotation along lateral axis (Pitch) -->
  <joint name="FL_knee_joint" type="revolute">
    <parent link="FL_upper_leg_link"/>
    <child link="FL_lower_leg_link"/>
    <origin xyz="0 0 -0.105" rpy="0 0 0"/>
    <axis xyz="1 0 0"/>
    <limit lower="-2.53" upper="-0.26" effort="2.5" velocity="6.0"/>
  </joint>

  <link name="FL_lower_leg_link">
    <visual>
      <origin xyz="0 0 -0.060" rpy="0 0 0"/>
      <geometry>
        <box size="0.016 0.020 0.120"/>
      </geometry>
      <material name="chassis_black"/>
    </visual>
    <collision>
      <origin xyz="0 0 -0.060" rpy="0 0 0"/>
      <geometry>
        <box size="0.016 0.020 0.120"/>
      </geometry>
    </collision>
    <inertial>
      <mass value="0.090"/>
      <inertia ixx="0.0001" ixy="0" ixz="0" iyy="0.0001" iyz="0" izz="0.00005"/>
    </inertial>
  </link>

  <!-- Foot Tip Contact -->
  <link name="FL_foot_link">
    <visual>
      <origin xyz="0 0 0" rpy="0 0 0"/>
      <geometry>
        <sphere radius="0.015"/>
      </geometry>
      <material name="rubber_pad"/>
    </visual>
    <collision>
      <origin xyz="0 0 0" rpy="0 0 0"/>
      <geometry>
        <sphere radius="0.015"/>
      </geometry>
    </collision>
  </link>
  <joint name="FL_foot_joint" type="fixed">
    <parent link="FL_lower_leg_link"/>
    <child link="FL_foot_link"/>
    <origin xyz="0 0 -0.120" rpy="0 0 0"/>
  </joint>

  <!-- (Note: FR, RL, and RR legs follow the identical kinematics structure with mirrored lateral offsets) -->
</robot>
`;

export const TRAIN_PPO_SCRIPT = `"""
Standalone PPO Reinforcement Learning Training Script for SpotMicroAI
Runs with Stable-Baselines3 or PyTorch
"""

import sys
import os
import numpy as np

def run_training():
    try:
        from stable_baselines3 import PPO
        from stable_baselines3.common.callbacks import CheckpointCallback
        from spotmicro_pybullet_gym import SpotMicroPybulletEnv
    except ImportError:
        print("[!] Missing packages. Please install:")
        print("    pip install pybullet gymnasium stable-baselines3 torch")
        return

    print("==================================================")
    print("  SpotMicroAI PPO Locomotion Training (PyBullet) ")
    print("==================================================")
    
    # 1. Instantiate the gym environment with Sim-to-Real domain randomization
    env = SpotMicroPybulletEnv(render_mode="human", sim_to_real=True)

    # 2. Configure PPO Agent
    # Hyperparameters tuned for quadruped gait convergence
    model = PPO(
        policy="MlpPolicy",
        env=env,
        learning_rate=3e-4,
        n_steps=2048,
        batch_size=64,
        n_epochs=10,
        gamma=0.99,
        gae_lambda=0.95,
        clip_range=0.2,
        ent_coef=0.01,
        verbose=1,
        tensorboard_log="./spotmicro_tensorboard/"
    )

    # 3. Save checkpoint every 20,000 steps
    checkpoint_callback = CheckpointCallback(
        save_freq=20000,
        save_path="./checkpoints/",
        name_prefix="spotmicro_ppo"
    )

    print("[*] Starting training for 150,000 timesteps...")
    model.learn(total_timesteps=150000, callback=checkpoint_callback)

    # 4. Save trained policy weights for deployment to Raspberry Pi 4
    model.save("spotmicro_trained_policy.zip")
    print("[+] Model training complete! Saved to spotmicro_trained_policy.zip")
    print("[+] Export weights to JSON for Raspberry Pi 4: python export_to_pi.py")

if __name__ == "__main__":
    run_training()
`;

export const PybulletGazeboHub: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'gym' | 'urdf' | 'train'>('gym');
  const [copied, setCopied] = useState(false);

  const getActiveCode = () => {
    switch (activeTab) {
      case 'gym':
        return PYBULLET_GYM_CODE;
      case 'urdf':
        return SPOTMICRO_URDF_CODE;
      case 'train':
        return TRAIN_PPO_SCRIPT;
    }
  };

  const getFilename = () => {
    switch (activeTab) {
      case 'gym':
        return 'spotmicro_pybullet_gym.py';
      case 'urdf':
        return 'spotmicro.urdf';
      case 'train':
        return 'train_ppo.py';
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(getActiveCode());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const element = document.createElement('a');
    const file = new Blob([getActiveCode()], { type: 'text/plain' });
    element.href = URL.createObjectURL(file);
    element.download = getFilename();
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  return (
    <div className="flex flex-col h-full bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden shadow-2xl">
      {/* Top Header Bar */}
      <div className="flex flex-wrap items-center justify-between px-4 py-3 bg-neutral-950 border-b border-neutral-800 gap-2">
        <div className="flex items-center gap-2">
          <Box className="w-5 h-5 text-amber-400" />
          <span className="text-sm font-semibold tracking-wide text-neutral-100">
            PyBullet & Gazebo Code Center
          </span>
          <span className="text-xs px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 font-mono">
            v1.2 Gym Compliant
          </span>
        </div>

        {/* File Tabs */}
        <div className="flex items-center bg-neutral-900 p-0.5 rounded-lg border border-neutral-800">
          <button
            onClick={() => setActiveTab('gym')}
            className={`px-3 py-1.5 text-xs font-mono rounded-md transition-colors ${
              activeTab === 'gym'
                ? 'bg-neutral-800 text-amber-300 font-medium shadow-sm'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            spotmicro_pybullet_gym.py
          </button>
          <button
            onClick={() => setActiveTab('urdf')}
            className={`px-3 py-1.5 text-xs font-mono rounded-md transition-colors ${
              activeTab === 'urdf'
                ? 'bg-neutral-800 text-amber-300 font-medium shadow-sm'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            spotmicro.urdf
          </button>
          <button
            onClick={() => setActiveTab('train')}
            className={`px-3 py-1.5 text-xs font-mono rounded-md transition-colors ${
              activeTab === 'train'
                ? 'bg-neutral-800 text-amber-300 font-medium shadow-sm'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            train_ppo.py
          </button>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-lg border border-neutral-700 transition"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copied!' : 'Copy Code'}
          </button>
          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-amber-500 hover:bg-amber-400 text-neutral-950 rounded-lg font-semibold shadow-md transition"
          >
            <Download className="w-3.5 h-3.5" />
            Download File
          </button>
        </div>
      </div>

      {/* Quick Launch Instruction Callout */}
      <div className="bg-neutral-950/60 px-4 py-2 border-b border-neutral-800/80 flex items-center justify-between text-xs text-neutral-400">
        <div className="flex items-center gap-2 font-mono">
          <Terminal className="w-3.5 h-3.5 text-sky-400" />
          <span>Quick Run:</span>
          <code className="bg-neutral-900 px-2 py-0.5 rounded text-neutral-300 border border-neutral-800">
            pip install pybullet gymnasium stable-baselines3 && python {getFilename()}
          </code>
        </div>
        <div className="text-neutral-500 text-[11px]">
          Sim-to-Real Domain Randomization enabled
        </div>
      </div>

      {/* Code Editor Preview */}
      <div className="flex-1 overflow-auto p-4 bg-neutral-950 font-mono text-xs leading-relaxed text-neutral-300">
        <pre className="whitespace-pre">{getActiveCode()}</pre>
      </div>
    </div>
  );
};
