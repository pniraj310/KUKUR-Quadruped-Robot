export type LegId = 'FL' | 'FR' | 'BL' | 'BR';

export type JointRole = 'abduction' | 'hip' | 'knee';

export type GaitType = 'trot' | 'walk' | 'pace' | 'gallop';

export type PosePreset = 'neutral' | 'stand' | 'sit' | 'custom';

export type CameraViewMode = 'orbit' | 'first-person' | 'split';

export type ViewportToolMode = 'select' | 'floor-drag' | 'box-select';

export type TransformGizmoMode = 'translate' | 'rotate' | 'scale';

export type LcdScreenPreset = 'status' | 'servos' | 'sensors' | 'custom';

export type LcdOrientation = 0 | 90 | 180 | 270;

export type LightingPreset = 'studio' | 'daylight' | 'inspection';

export type NavigationFsmState =
  | 'IDLE'
  | 'MOVING_FORWARD'
  | 'OBSTACLE_DETECTED'
  | 'CHECKING_PATHS'
  | 'TURNING_LEFT'
  | 'TURNING_RIGHT'
  | 'BYPASSING_OBSTACLE'
  | 'WAITING_FOR_CLEARANCE'
  | 'RELOCALIZING'
  | 'RESUMING_MOVEMENT'
  | 'PATH_BLOCKED';

export type NavigationActivityState = 'IDLE' | 'MOVING' | 'WAITING';

export type TurnDirection = 'NONE' | 'LEFT' | 'RIGHT' | 'BLOCKED';

export type ScenarioId =
  | 'default-lab'
  | 'single-box'
  | 'wall-one-side'
  | 'wall-right-side'
  | 'either-side-bypass'
  | 'blocked-corridor';

export interface ServoChannel {
  channel: number; // 0..11
  leg: LegId;
  role: JointRole;
  label: string;
  targetAngle: number; // Software command angle (deg)
  currentSimulatedAngle: number; // Smoothed simulated servo shaft position (deg)
  minAngle: number; // Allowed min software command (default 90)
  maxAngle: number; // Allowed max software command (default 100)
  safetyLocked: boolean; // True for CH7 (strictly 90-100 deg)
  mechanicalOffsetDeg: number; // Uncalibrated resting link geometry offset
}

export interface BodyPose {
  x: number;
  y: number; // Body height above floor (m)
  z: number;
  pitch: number; // deg
  roll: number; // deg
  yaw: number; // deg
}

export interface AttachableModuleState {
  id: 'camera' | 'lcd' | 'microphone';
  name: string;
  attached: boolean;
  mountPosition: [number, number, number];
  mountRotation: [number, number, number]; // deg [pitch, yaw, roll]
  worldPosition: [number, number, number];
  worldRotation: [number, number, number]; // deg
}

export interface CameraModuleConfig extends AttachableModuleState {
  id: 'camera';
  fov: number;
  webcamEnabled: boolean;
  showDetections: boolean;
  showDepth: boolean;
}

export interface LcdModuleConfig extends AttachableModuleState {
  id: 'lcd';
  orientation: LcdOrientation;
  screenPreset: LcdScreenPreset;
  customText: string;
  backlightColor: 'ice-blue' | 'emerald' | 'amber';
}

export interface MicModuleConfig extends AttachableModuleState {
  id: 'microphone';
  listening: boolean;
  browserMicEnabled: boolean;
  simulatedGain: number;
  lastCommand: string;
  commandLog: Array<{
    id: string;
    timestamp: string;
    source: 'simulated-text' | 'browser-voice';
    phrase: string;
    actionTaken: string;
  }>;
}

export type SceneObjectType =
  | 'human'
  | 'box'
  | 'cylinder'
  | 'wall'
  | 'ramp'
  | 'rough-terrain';

export interface LabSceneObject {
  id: string;
  type: SceneObjectType;
  label: string;
  position: [number, number, number];
  rotation: [number, number, number]; // deg [x, y, z]
  scale: [number, number, number];
  color: string;
  colliding?: boolean;
}

export interface SimulatedDetection {
  id: string;
  objectId: string;
  label: string;
  confidence: number; // 0..1 simulated score
  distanceMeters: number; // Simulated virtual depth
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  source: 'SIMULATED_3D' | 'WEBCAM_MOTION';
}

export interface SensorRayReading {
  id: string;
  label: string;
  angleDeg: number; // Relative to robot forward +Z (+ is Left, - is Right)
  origin: [number, number, number];
  endPoint: [number, number, number];
  distanceM: number;
  maxRangeM: number;
  hitObjectId: string | null;
  zone: 'forward' | 'left' | 'right';
}

export interface NavigationConfigAndState {
  enabled: boolean; // Autonomous obstacle avoidance enabled
  safetyDistanceM: number; // Configurable stop/avoid threshold (default 0.75m)
  turnAngleDeg: number; // Configurable nominal avoidance turn angle (default 55°)
  clearanceThresholdM: number; // Configurable minimum clear path threshold (default 0.60m)
  forwardSpeedMps: number; // Simulated walking speed (m/s)
  turnRateDegPerSec: number; // Simulated yaw turn rate (deg/s)
  showSensorRays: boolean;
  fsmState: NavigationFsmState;
  activityState: NavigationActivityState; // IDLE | MOVING | WAITING
  isLiftedOffFloor: boolean;
  selectedTurnDirection: TurnDirection;
  nearestForwardM: number;
  leftClearanceM: number;
  rightClearanceM: number;
  detectedObstacleIds: string[];
  statusMessage: string;
  // Deterministic FSM memory for hysteresis, bypass verification, and external reposition detection
  stateTimerSec: number;
  committedTurn: 'LEFT' | 'RIGHT' | null;
  targetYawDeg: number | null;
  initialBypassHeadingDeg: number | null;
  bypassObstacleId: string | null;
  bypassDistanceTraveledM: number;
  cumulativeTurnDeg: number;
  lastCommandedPose: BodyPose | null;
}

export interface SensorTelemetry {
  accel: [number, number, number]; // g (MPU6050 simulated)
  gyro: [number, number, number]; // deg/s (MPU6050 simulated)
  ultrasonicCm: number; // HC-SR04 simulated distance (cm)
  batteryVoltage: number; // V (simulated 2S LiPo)
  manualSensorOverride: boolean;
  manualUltrasonicCm: number;
  manualImuNoise: number;
}

export interface GaitConfig {
  selectedGait: GaitType;
  gaitEnabled: boolean; // Disabled by default per safety rule
  isRunning: boolean; // Active animation flag
  cadenceHz: number;
  stepAmplitudeDeg: number;
  locomotionTranslate: boolean; // Move robot across floor when gait runs
}

export interface LegTestState {
  activeLeg: LegId | null;
  running: boolean;
  liftFactor: Record<LegId, number>;
  reachFactor: Record<LegId, number>;
  spreadFactor: Record<LegId, number>;
}

export type SelectableTarget =
  | { kind: 'joint'; channel: number }
  | { kind: 'chassis'; partName: string }
  | { kind: 'module'; moduleId: 'camera' | 'lcd' | 'microphone' }
  | { kind: 'scene-object'; objectId: string }
  | null;
