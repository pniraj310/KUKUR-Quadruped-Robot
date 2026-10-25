import React, { useState, useEffect } from 'react';
import { Viewport3D, CameraViewMode } from './components/Viewport3D';
import { BottomControlDock } from './components/BottomControlDock';
import {
  BodyPose,
  DetectedObject,
  EnvironmentType,
  GaitType,
  LcdDisplayState,
  LogEntry,
  MicrophoneState,
  RobotActivityState,
  RobotJointAngles,
  SceneItem,
  SensorData,
  Vector3D,
} from './types/robot';
import { DEFAULT_BODY_POSE } from './simulation/kinematics';
import {
  Radio,
  Compass,
  BatteryCharging,
  ShieldCheck,
  Cpu,
  Octagon,
  Scan,
  Monitor,
  Mic,
  RotateCcw,
} from 'lucide-react';

export default function App() {
  // Start stationary as requested: stationary default pose
  const [gait, setGait] = useState<GaitType>('stand');
  const [isSimRunning, setIsSimRunning] = useState<boolean>(false); // Start stationary!
  const [isEmergencyStopped, setIsEmergencyStopped] = useState<boolean>(false);
  const [robotState, setRobotState] = useState<RobotActivityState>('IDLE');

  const [envType, setEnvType] = useState<EnvironmentType>('lab');
  const [bodyPose, setBodyPose] = useState<BodyPose>(DEFAULT_BODY_POSE);
  const [strideLength, setStrideLength] = useState<number>(35);
  const [stepHeight, setStepHeight] = useState<number>(25);
  const [turnRate, setTurnRate] = useState<number>(0);
  const [speedMultiplier, setSpeedMultiplier] = useState<number>(1);
  const [cameraMode, setCameraMode] = useState<CameraViewMode>('orbit');
  const [isFovVisible, setIsFovVisible] = useState<boolean>(true);

  // Initial selected joint is CH7 (Back-left hip-pitch joint) as specifically required!
  const [selectedChannel, setSelectedChannel] = useState<number>(7);
  const [selectedPartName, setSelectedPartName] = useState<string>('BL Hip Pitch (CH7)');

  // Sim time tracking
  const [simTimeSeconds, setSimTimeSeconds] = useState<number>(0);

  // 12-DOF joint targets (CH7 starts at initial target 95° within 90°-100° software limits)
  const [joints, setJoints] = useState<RobotJointAngles>({
    FL: { hip: 0, shoulder: 45, knee: -90 },
    FR: { hip: 0, shoulder: 45, knee: -90 },
    RL: { hip: 0, shoulder: 95, knee: -90 }, // CH7 Back-Left Hip Pitch initial target: 95°
    RR: { hip: 0, shoulder: 45, knee: -90 },
  });

  // Live sensors telemetry state
  const [sensors, setSensors] = useState<SensorData>({
    ultrasonicDistanceCm: 142.5,
    imu: {
      roll: 0.0,
      pitch: 0.0,
      yaw: 0.0,
      accel: { x: 0.0, y: 9.81, z: 0.0 },
      gyro: { x: 0.0, y: 0.0, z: 0.0 },
      tempC: 38.4,
    },
    footContacts: { FL: true, FR: true, RL: true, RR: true },
    footForces: { FL: 6.4, FR: 6.4, RL: 6.4, RR: 6.4 },
    batteryVoltage: 7.85,
    servoCurrentAmps: 1.15,
  });

  // 16x2 LCD Display state
  const [lcdState, setLcdState] = useState<LcdDisplayState>({
    mode: 'status',
    line1: 'KUKUR Quadruped',
    line2: 'SYS: OK 50Hz SIM',
    customLine1: 'HELLO KUKUR',
    customLine2: 'SIMULATION READY',
    backlight: true,
    i2cAddress: '0x27',
  });

  // Microphone & Voice State
  const [micState, setMicState] = useState<MicrophoneState>({
    isListening: false,
    isRealMic: false,
    volume: 0,
    waveform: [],
    lastCommand: '',
    commandHistory: [],
  });

  // Interactive 3D Scene Objects (Person, Box, Chair, Pylon, Barrel)
  const [sceneItems, setSceneItems] = useState<SceneItem[]>([
    {
      id: 'person-1',
      type: 'person',
      name: 'Person (Mannequin)',
      position: { x: 0.2, y: 0, z: 2.2 },
      rotation: Math.PI,
      isWalking: true,
    },
    {
      id: 'box-1',
      type: 'box',
      name: 'Wooden Supply Crate',
      position: { x: -1.2, y: 0, z: 1.4 },
      rotation: 0.4,
    },
    {
      id: 'chair-1',
      type: 'chair',
      name: 'Lab Office Chair',
      position: { x: 1.3, y: 0, z: 1.8 },
      rotation: -0.6,
    },
    {
      id: 'pylon-1',
      type: 'pylon',
      name: 'Safety Pylon',
      position: { x: -0.6, y: 0, z: 0.9 },
      rotation: 0,
    },
    {
      id: 'barrel-1',
      type: 'barrel',
      name: 'Storage Barrel',
      position: { x: 0.8, y: 0, z: 3.2 },
      rotation: 0,
    },
  ]);

  // Detected Objects in front camera
  const [detections, setDetections] = useState<DetectedObject[]>([]);

  // Diagnostic Logs
  const [logs, setLogs] = useState<LogEntry[]>([
    {
      id: '1',
      timestamp: new Date().toLocaleTimeString(),
      level: 'info',
      source: 'KUKUR-CORE',
      message: 'KUKUR Quadruped 3D Simulation initialized in SIMULATION ONLY mode.',
    },
    {
      id: '2',
      timestamp: new Date().toLocaleTimeString(),
      level: 'info',
      source: 'PCA9685',
      message: 'PCA9685 12-channel mapping initialized. CH7 Back-Left Hip Pitch selected (90°-100°).',
    },
    {
      id: '3',
      timestamp: new Date().toLocaleTimeString(),
      level: 'info',
      source: 'LCD-0x27',
      message: '16x2 Character LCD attached to front canopy with I2C address 0x27.',
    },
  ]);

  const addLog = (level: LogEntry['level'], source: string, message: string) => {
    setLogs((prev) => [
      {
        id: String(Date.now() + Math.random()),
        timestamp: new Date().toLocaleTimeString(),
        level,
        source,
        message,
      },
      ...prev.slice(0, 80),
    ]);
  };

  // Simulation timer
  useEffect(() => {
    if (!isSimRunning || isEmergencyStopped) return;
    const interval = setInterval(() => {
      setSimTimeSeconds((prev) => prev + 0.1);
    }, 100);
    return () => clearInterval(interval);
  }, [isSimRunning, isEmergencyStopped]);

  // Handle sensor & telemetry updates from 3D Viewport
  const handleSensorsUpdate = (newSensors: SensorData, newJoints: RobotJointAngles) => {
    setSensors(newSensors);
  };

  // Handle click selection of joint or module from 3D Viewport
  const handleSelectJointOrPart = (channel: number | null, name: string) => {
    setSelectedPartName(name);
    if (channel !== null) {
      setSelectedChannel(channel);
      addLog('cmd', 'INSPECTOR', `Selected joint CH${channel}: ${name}`);
    } else {
      addLog('info', 'INSPECTOR', `Selected module: ${name}`);
    }
  };

  // Emergency Stop Handler
  const handleEmergencyStop = () => {
    setIsEmergencyStopped(true);
    setIsSimRunning(false);
    setRobotState('E_STOP');
    addLog('error', 'SAFETY', 'EMERGENCY STOP engaged! All actuator commands halted.');
  };

  // Reset Simulation Handler
  const handleResetSimulation = () => {
    setIsEmergencyStopped(false);
    setIsSimRunning(false);
    setGait('stand');
    setTurnRate(0);
    setBodyPose(DEFAULT_BODY_POSE);
    setJoints({
      FL: { hip: 0, shoulder: 45, knee: -90 },
      FR: { hip: 0, shoulder: 45, knee: -90 },
      RL: { hip: 0, shoulder: 95, knee: -90 },
      RR: { hip: 0, shoulder: 45, knee: -90 },
    });
    setRobotState('IDLE');
    addLog('info', 'SAFETY', 'Simulation reset to stationary neutral pose. E-stop cleared.');
  };

  // Voice Command Dispatcher with safety verification
  const handleExecuteVoiceCommand = (rawCmd: string): { success: boolean; message: string } => {
    const cmd = rawCmd.toLowerCase().trim();

    if (isEmergencyStopped) {
      addLog('warn', 'VOICE', `Rejected command "${rawCmd}" — Emergency stop is active.`);
      return { success: false, message: 'Command rejected: Emergency stop active.' };
    }

    if (cmd.includes('stand')) {
      setGait('stand');
      setIsSimRunning(false);
      setRobotState('STANDING');
      addLog('cmd', 'VOICE', `Executed voice command: "Stand"`);
      return { success: true, message: 'KUKUR standing neutral.' };
    }

    if (cmd.includes('sit')) {
      setGait('sit');
      setIsSimRunning(false);
      setRobotState('SITTING');
      addLog('cmd', 'VOICE', `Executed voice command: "Sit"`);
      return { success: true, message: 'KUKUR sitting down.' };
    }

    if (cmd.includes('walk') || cmd.includes('trot')) {
      setGait(cmd.includes('walk') ? 'walk' : 'trot');
      setIsSimRunning(true);
      setRobotState('WALKING');
      addLog('cmd', 'VOICE', `Executed voice command: "${rawCmd}"`);
      return { success: true, message: 'KUKUR walking forward.' };
    }

    if (cmd.includes('stop')) {
      setIsSimRunning(false);
      setRobotState('IDLE');
      addLog('cmd', 'VOICE', `Executed voice command: "Stop"`);
      return { success: true, message: 'KUKUR stopped.' };
    }

    if (cmd.includes('left')) {
      setTurnRate(-0.6);
      setIsSimRunning(true);
      addLog('cmd', 'VOICE', `Executed voice command: "Turn left"`);
      return { success: true, message: 'Steering left.' };
    }

    if (cmd.includes('right')) {
      setTurnRate(0.6);
      setIsSimRunning(true);
      addLog('cmd', 'VOICE', `Executed voice command: "Turn right"`);
      return { success: true, message: 'Steering right.' };
    }

    if (cmd.includes('detect') || cmd.includes('object')) {
      setLcdState((prev) => ({ ...prev, mode: 'detection' }));
      addLog('cmd', 'VOICE', `Executed voice command: "Show detected objects"`);
      return { success: true, message: 'Displaying detected objects on LCD.' };
    }

    if (cmd.includes('status')) {
      setLcdState((prev) => ({ ...prev, mode: 'status' }));
      addLog('cmd', 'VOICE', `Executed voice command: "Show robot status"`);
      return { success: true, message: 'Displaying robot status on LCD.' };
    }

    addLog('warn', 'VOICE', `Unrecognized command: "${rawCmd}"`);
    return { success: false, message: `Unrecognized command "${rawCmd}".` };
  };

  // Scene items modification handlers
  const handleAddItem = (item: SceneItem) => {
    setSceneItems((prev) => [...prev, item]);
    addLog('info', 'WORLD', `Spawned ${item.name} at [${item.position.x}m, ${item.position.z}m]`);
  };

  const handleRemoveItem = (id: string) => {
    setSceneItems((prev) => prev.filter((it) => it.id !== id));
    addLog('info', 'WORLD', `Removed object ID ${id} from scene.`);
  };

  const handleUpdateItemPos = (id: string, pos: Vector3D) => {
    setSceneItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, position: pos } : it))
    );
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-neutral-950 font-sans select-none">
      {/* Top Left Engineering Spec Badge */}
      <div className="absolute top-3 left-3 z-20 pointer-events-auto">
        <div className="flex items-center gap-2.5 bg-neutral-900/90 border border-neutral-800/90 px-3.5 py-2 rounded-xl shadow-xl backdrop-blur-none">
          <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center font-bold text-amber-400 font-mono text-sm">
            KU
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-extrabold text-xs tracking-wider text-neutral-100 uppercase">
                Project: KUKUR
              </span>
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 font-bold">
                12-DOF Quadruped
              </span>
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                SIMULATION ONLY
              </span>
            </div>
            <div className="text-[11px] text-neutral-400 font-mono flex items-center gap-1.5 mt-0.5">
              <span className="text-amber-300 font-semibold">{selectedPartName}</span>
              <span className="text-neutral-600">•</span>
              <span className="text-neutral-400">
                State:{' '}
                <strong
                  className={
                    isEmergencyStopped
                      ? 'text-rose-400'
                      : isSimRunning
                      ? 'text-emerald-400'
                      : 'text-neutral-300'
                  }
                >
                  {isEmergencyStopped ? 'E-STOPPED' : isSimRunning ? 'WALKING' : 'STATIONARY'}
                </strong>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Top Right Live Telemetry Quick Bar */}
      <div className="absolute top-3 right-3 z-20 pointer-events-auto flex items-center gap-2">
        {/* Ultrasonic distance */}
        <div className="flex items-center gap-1.5 bg-neutral-900/90 border border-neutral-800/90 px-2.5 py-1.5 rounded-xl text-xs font-mono shadow-xl backdrop-blur-none">
          <Radio className="w-3.5 h-3.5 text-sky-400" />
          <span className="text-neutral-400">US:</span>
          <span
            className={`font-semibold ${
              sensors.ultrasonicDistanceCm < 30
                ? 'text-rose-400'
                : sensors.ultrasonicDistanceCm < 80
                ? 'text-amber-400'
                : 'text-emerald-400'
            }`}
          >
            {sensors.ultrasonicDistanceCm.toFixed(1)}cm
          </span>
        </div>

        {/* IMU tilt */}
        <div className="flex items-center gap-1.5 bg-neutral-900/90 border border-neutral-800/90 px-2.5 py-1.5 rounded-xl text-xs font-mono shadow-xl backdrop-blur-none">
          <Compass className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-neutral-400">IMU:</span>
          <span className="text-neutral-200">
            {sensors.imu.roll > 0 ? `+${sensors.imu.roll}` : sensors.imu.roll}° /{' '}
            {sensors.imu.pitch > 0 ? `+${sensors.imu.pitch}` : sensors.imu.pitch}°
          </span>
        </div>

        {/* Detections Count */}
        <div className="flex items-center gap-1.5 bg-neutral-900/90 border border-neutral-800/90 px-2.5 py-1.5 rounded-xl text-xs font-mono shadow-xl backdrop-blur-none">
          <Scan className="w-3.5 h-3.5 text-purple-400" />
          <span className="text-neutral-400">Vision:</span>
          <span className="text-purple-300 font-bold">{detections.length} objects</span>
        </div>

        {/* LiPo Voltage */}
        <div className="flex items-center gap-1.5 bg-neutral-900/90 border border-neutral-800/90 px-2.5 py-1.5 rounded-xl text-xs font-mono shadow-xl backdrop-blur-none">
          <BatteryCharging className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-emerald-300 font-semibold">{sensors.batteryVoltage.toFixed(2)}V</span>
        </div>
      </div>

      {/* 3D Viewport - 100% Unobstructed Center Viewport */}
      <Viewport3D
        gait={gait}
        envType={envType}
        bodyPose={bodyPose}
        strideLength={strideLength}
        stepHeight={stepHeight}
        turnRate={turnRate}
        speedMultiplier={speedMultiplier}
        cameraMode={cameraMode}
        onSensorsUpdate={handleSensorsUpdate}
        onDetectionsUpdate={setDetections}
        onSelectJointOrPart={handleSelectJointOrPart}
        selectedChannel={selectedChannel}
        isSimRunning={isSimRunning}
        isEmergencyStopped={isEmergencyStopped}
        lcdState={lcdState}
        isFovVisible={isFovVisible}
        sceneItems={sceneItems}
      />

      {/* Sleek Collapsible Bottom Engineering Dock with all 9 Tabs */}
      <BottomControlDock
        gait={gait}
        setGait={(newGait) => {
          setGait(newGait);
          if (newGait === 'trot' || newGait === 'walk' || newGait === 'pace' || newGait === 'gallop') {
            setIsSimRunning(true);
            setRobotState('WALKING');
          } else if (newGait === 'sit') {
            setIsSimRunning(false);
            setRobotState('SITTING');
          } else if (newGait === 'stand') {
            setIsSimRunning(false);
            setRobotState('STANDING');
          }
        }}
        envType={envType}
        setEnvType={setEnvType}
        bodyPose={bodyPose}
        setBodyPose={setBodyPose}
        strideLength={strideLength}
        setStrideLength={setStrideLength}
        turnRate={turnRate}
        setTurnRate={setTurnRate}
        speedMultiplier={speedMultiplier}
        setSpeedMultiplier={setSpeedMultiplier}
        cameraMode={cameraMode}
        setCameraMode={setCameraMode}
        sensors={sensors}
        joints={joints}
        setJoints={setJoints}
        selectedChannel={selectedChannel}
        setSelectedChannel={(ch) => {
          setSelectedChannel(ch);
          setSelectedPartName(`Joint CH${ch}`);
        }}
        isSimRunning={isSimRunning}
        setIsSimRunning={setIsSimRunning}
        isEmergencyStopped={isEmergencyStopped}
        onEmergencyStop={handleEmergencyStop}
        onResetSimulation={handleResetSimulation}
        robotState={robotState}
        detections={detections}
        isFovVisible={isFovVisible}
        onToggleFov={() => setIsFovVisible(!isFovVisible)}
        lcdState={lcdState}
        setLcdState={setLcdState}
        micState={micState}
        setMicState={setMicState}
        onExecuteVoiceCommand={handleExecuteVoiceCommand}
        sceneItems={sceneItems}
        onAddItem={handleAddItem}
        onRemoveItem={handleRemoveItem}
        onUpdateItemPos={handleUpdateItemPos}
        logs={logs}
        onClearLogs={() => setLogs([])}
        simTimeSeconds={simTimeSeconds}
      />
    </div>
  );
}
