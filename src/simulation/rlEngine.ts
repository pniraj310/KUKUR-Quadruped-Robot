import { RlHyperparameters, RlTrainingMetrics, SensorData, Vector3D } from '../types/robot';

export const DEFAULT_RL_HYPERPARAMS: RlHyperparameters = {
  learningRate: 0.0003,
  gamma: 0.99,
  clipRatio: 0.2,
  entropyCoeff: 0.01,
  forwardRewardWeight: 1.5,
  uprightRewardWeight: 1.0,
  energyPenaltyWeight: 0.3,
  slipPenaltyWeight: 0.5,
  clearanceRewardWeight: 0.4,
  obstaclePenaltyWeight: 2.0,
  simToRealNoise: true,
};

/**
 * Lightweight 2-layer Neural Network policy for quadruped gait adaptation
 * State dimension: 16 (IMU roll/pitch/yaw, gyro, accel, ultrasonic, 4 foot contacts, phase)
 * Action dimension: 4 (Gait frequency modulation, Stride amplitude, Body pitch trim, Ground clearance)
 */
export class SpotMicroRlPolicy {
  public weights1: number[][]; // 16 -> 32
  public bias1: number[];
  public weights2: number[][]; // 32 -> 4
  public bias2: number[];

  constructor() {
    this.weights1 = Array.from({ length: 16 }, () =>
      Array.from({ length: 32 }, () => (Math.random() - 0.5) * 0.2)
    );
    this.bias1 = Array.from({ length: 32 }, () => 0.0);
    this.weights2 = Array.from({ length: 32 }, () =>
      Array.from({ length: 4 }, () => (Math.random() - 0.5) * 0.2)
    );
    this.bias2 = Array.from({ length: 4 }, () => 0.0);
  }

  forward(state: number[]): number[] {
    // Layer 1 with Tanh activation
    const hidden: number[] = new Array(32);
    for (let j = 0; j < 32; j++) {
      let sum = this.bias1[j];
      for (let i = 0; i < 16; i++) {
        sum += (state[i] || 0) * this.weights1[i][j];
      }
      hidden[j] = Math.tanh(sum);
    }

    // Layer 2 with Tanh activation (actions scaled between -1 and 1)
    const action: number[] = new Array(4);
    for (let k = 0; k < 4; k++) {
      let sum = this.bias2[k];
      for (let j = 0; j < 32; j++) {
        sum += hidden[j] * this.weights2[j][k];
      }
      action[k] = Math.tanh(sum);
    }
    return action;
  }

  // Perturb weights (Evolutionary Strategy / Policy Gradient gradient update)
  updateWeights(gradient: number, lr: number) {
    for (let i = 0; i < 16; i++) {
      for (let j = 0; j < 32; j++) {
        this.weights1[i][j] += (Math.random() - 0.48) * lr * gradient;
      }
    }
    for (let j = 0; j < 32; j++) {
      for (let k = 0; k < 4; k++) {
        this.weights2[j][k] += (Math.random() - 0.48) * lr * gradient;
      }
    }
  }

  exportJson(): string {
    return JSON.stringify(
      {
        model: 'SpotMicroAI-PPO-Policy-v1',
        architecture: '16x32x4-Tanh',
        weights1: this.weights1,
        bias1: this.bias1,
        weights2: this.weights2,
        bias2: this.bias2,
      },
      null,
      2
    );
  }
}

/**
 * Computes step reward based on SpotMicro sensor feedback and RL weights
 */
export function computeStepReward(
  sensors: SensorData,
  forwardVelocity: number, // m/s
  energyConsumption: number,
  hyperparams: RlHyperparameters
): { totalReward: number; breakdown: Record<string, number> } {
  // 1. Forward velocity reward (positive for progressing forward)
  const r_forward = hyperparams.forwardRewardWeight * Math.max(-0.5, forwardVelocity);

  // 2. Upright stability reward (penalize roll and pitch deviation from 0)
  const rollRad = (sensors.imu.roll * Math.PI) / 180;
  const pitchRad = (sensors.imu.pitch * Math.PI) / 180;
  const tiltMagnitude = Math.sqrt(rollRad * rollRad + pitchRad * pitchRad);
  const r_upright = hyperparams.uprightRewardWeight * Math.exp(-3.0 * tiltMagnitude);

  // 3. Energy penalty (servo current draw)
  const r_energy = -hyperparams.energyPenaltyWeight * (energyConsumption * 0.2);

  // 4. Foot slip penalty (if foot is contacting but sliding horizontally)
  const slipMagnitude = Math.abs(sensors.imu.gyro.x) + Math.abs(sensors.imu.gyro.z);
  const r_slip = -hyperparams.slipPenaltyWeight * Math.min(2.0, slipMagnitude * 0.1);

  // 5. Obstacle clearance / collision penalty
  let r_obstacle = 0;
  if (sensors.ultrasonicDistanceCm < 25) {
    // Dangerous proximity or collision
    r_obstacle = -hyperparams.obstaclePenaltyWeight * (1.0 - sensors.ultrasonicDistanceCm / 25);
  }

  // 6. Healthy stance reward (all 4 feet shouldn't be off the ground at once)
  const contactCount = (sensors.footContacts.FL ? 1 : 0) +
                       (sensors.footContacts.FR ? 1 : 0) +
                       (sensors.footContacts.RL ? 1 : 0) +
                       (sensors.footContacts.RR ? 1 : 0);
  const r_stance = contactCount > 0 ? 0.2 : -0.5;

  const totalReward = r_forward + r_upright + r_energy + r_slip + r_obstacle + r_stance;

  return {
    totalReward,
    breakdown: {
      forward: Math.round(r_forward * 100) / 100,
      upright: Math.round(r_upright * 100) / 100,
      energy: Math.round(r_energy * 100) / 100,
      slip: Math.round(r_slip * 100) / 100,
      obstacle: Math.round(r_obstacle * 100) / 100,
      stance: r_stance,
    },
  };
}
