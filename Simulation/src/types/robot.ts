export type LegId = 'FL' | 'FR' | 'RL' | 'RR';

export type JointType = 'abduction' | 'hip_pitch' | 'knee';

export interface LegJoints {
  hip: number;      // Abduction/Adduction (roll) in degrees (-45° to +45°)
  shoulder: number; // Hip pitch (pitch) in degrees (-60° to +90°)
  knee: number;     // Lower leg knee (pitch) in degrees (-140° to -20°)
}

export interface RobotJointAngles {
  FL: LegJoints;
  FR: LegJoints;
  RL: LegJoints;
  RR: LegJoints;
}

export interface JointChannelInfo {
  channel: number;
  leg: LegId;
  legLabel: string;
  joint: JointType;
  jointLabel: string;
  name: string;
  softwareMin: number;
  softwareMax: number;
  physicalMin: number;
  physicalMax: number;
  neutralAngle: number;
}

// PCA9685 12-channel mapping for KUKUR
export const PCA9685_CHANNELS: JointChannelInfo[] = [
  { channel: 0, leg: 'FL', legLabel: 'Front-Left', joint: 'abduction', jointLabel: 'Abduction', name: 'FL Abduction (CH0)', softwareMin: -45, softwareMax: 45, physicalMin: -45, physicalMax: 45, neutralAngle: 0 },
  { channel: 1, leg: 'FL', legLabel: 'Front-Left', joint: 'hip_pitch', jointLabel: 'Hip Pitch', name: 'FL Hip Pitch (CH1)', softwareMin: -60, softwareMax: 90, physicalMin: -60, physicalMax: 90, neutralAngle: 45 },
  { channel: 2, leg: 'FL', legLabel: 'Front-Left', joint: 'knee', jointLabel: 'Knee', name: 'FL Knee (CH2)', softwareMin: -140, softwareMax: -15, physicalMin: -140, physicalMax: -15, neutralAngle: -90 },

  { channel: 3, leg: 'FR', legLabel: 'Front-Right', joint: 'abduction', jointLabel: 'Abduction', name: 'FR Abduction (CH3)', softwareMin: -45, softwareMax: 45, physicalMin: -45, physicalMax: 45, neutralAngle: 0 },
  { channel: 4, leg: 'FR', legLabel: 'Front-Right', joint: 'hip_pitch', jointLabel: 'Hip Pitch', name: 'FR Hip Pitch (CH4)', softwareMin: -60, softwareMax: 90, physicalMin: -60, physicalMax: 90, neutralAngle: 45 },
  { channel: 5, leg: 'FR', legLabel: 'Front-Right', joint: 'knee', jointLabel: 'Knee', name: 'FR Knee (CH5)', softwareMin: -140, softwareMax: -15, physicalMin: -140, physicalMax: -15, neutralAngle: -90 },

  { channel: 6, leg: 'RL', legLabel: 'Back-Left', joint: 'abduction', jointLabel: 'Abduction', name: 'BL Abduction (CH6)', softwareMin: -45, softwareMax: 45, physicalMin: -45, physicalMax: 45, neutralAngle: 0 },
  // CH7 Back-left hip pitch has the configured initial software test limits: min 90, target 95, max 100!
  { channel: 7, leg: 'RL', legLabel: 'Back-Left', joint: 'hip_pitch', jointLabel: 'Hip Pitch', name: 'BL Hip Pitch (CH7)', softwareMin: 90, softwareMax: 100, physicalMin: 0, physicalMax: 180, neutralAngle: 95 },
  { channel: 8, leg: 'RL', legLabel: 'Back-Left', joint: 'knee', jointLabel: 'Knee', name: 'BL Knee (CH8)', softwareMin: -140, softwareMax: -15, physicalMin: -140, physicalMax: -15, neutralAngle: -90 },

  { channel: 9, leg: 'RR', legLabel: 'Back-Right', joint: 'abduction', jointLabel: 'Abduction', name: 'BR Abduction (CH9)', softwareMin: -45, softwareMax: 45, physicalMin: -45, physicalMax: 45, neutralAngle: 0 },
  { channel: 10, leg: 'RR', legLabel: 'Back-Right', joint: 'hip_pitch', jointLabel: 'Hip Pitch', name: 'BR Hip Pitch (CH10)', softwareMin: -60, softwareMax: 90, physicalMin: -60, physicalMax: 90, neutralAngle: 45 },
  { channel: 11, leg: 'RR', legLabel: 'Back-Right', joint: 'knee', jointLabel: 'Knee', name: 'BR Knee (CH11)', softwareMin: -140, softwareMax: -15, physicalMin: -140, physicalMax: -15, neutralAngle: -90 },
];

export interface Vector3D {
  x: number;
  y: number;
  z: number;
}

export interface BodyPose {
  x: number;      // Body lateral shift (mm)
  y: number;      // Body height (mm, typically 120 - 200 mm)
  z: number;      // Body surge shift (mm)
  roll: number;   // degrees (-25° to +25°)
  pitch: number;  // degrees (-25° to +25°)
  yaw: number;    // degrees (-30° to +30°)
}

export type GaitType = 'trot' | 'walk' | 'pace' | 'gallop' | 'stand' | 'sit' | 'wave';

export type RobotActivityState = 'IDLE' | 'WALKING' | 'SITTING' | 'STANDING' | 'TESTING_LEG' | 'TESTING_JOINT' | 'E_STOP';

export type EnvironmentType = 'lab' | 'obstacles' | 'slopes' | 'rough' | 'room' | 'outdoor';

export interface SensorData {
  ultrasonicDistanceCm: number;   // HC-SR04 reading (2 - 400 cm)
  imu: {
    roll: number;                 // MPU6050 roll (deg)
    pitch: number;                // MPU6050 pitch (deg)
    yaw: number;                  // MPU6050 yaw (deg)
    accel: Vector3D;              // m/s^2
    gyro: Vector3D;               // rad/s
    tempC: number;                // MPU6050 internal temp
  };
  footContacts: {
    FL: boolean;
    FR: boolean;
    RL: boolean;
    RR: boolean;
  };
  footForces: {
    FL: number;                   // Newtons
    FR: number;
    RL: number;
    RR: number;
  };
  batteryVoltage: number;         // 2S/3S LiPo voltage (7.4V - 11.1V)
  servoCurrentAmps: number;       // Total current drawn by 12 servos
}

// Interactive Environment Object
export interface SceneItem {
  id: string;
  type: 'person' | 'box' | 'chair' | 'pylon' | 'barrel';
  name: string;
  position: Vector3D; // in meters [x, y, z]
  rotation: number;   // yaw in radians
  isWalking?: boolean;
}

// Object Detection
export interface DetectedObject {
  id: string;
  label: string;
  confidence: number;
  distanceM: number;
  directionDeg: number;
  bbox: { x: number; y: number; w: number; h: number }; // normalized 0..1 in camera frame
  pos3D: Vector3D;
}

// 16x2 LCD Display State
export type LcdMode = 'status' | 'pose' | 'joints' | 'imu' | 'detection' | 'ultrasonic' | 'camera_mic' | 'hardware' | 'custom';

export interface LcdDisplayState {
  mode: LcdMode;
  line1: string;
  line2: string;
  customLine1: string;
  customLine2: string;
  backlight: boolean;
  i2cAddress: string; // '0x27'
}

// Microphone & Voice Interface State
export interface MicrophoneState {
  isListening: boolean;
  isRealMic: boolean;
  volume: number;
  waveform: number[];
  lastCommand: string;
  commandHistory: Array<{
    id: string;
    text: string;
    timestamp: string;
    status: 'executed' | 'rejected';
  }>;
}

// Log Entry
export interface LogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'cmd';
  source: string;
  message: string;
}

export interface RlHyperparameters {
  learningRate: number;
  gamma: number;                  // Discount factor
  clipRatio: number;              // PPO clip ratio
  entropyCoeff: number;
  forwardRewardWeight: number;
  uprightRewardWeight: number;
  energyPenaltyWeight: number;
  slipPenaltyWeight: number;
  clearanceRewardWeight: number;
  obstaclePenaltyWeight: number;
  simToRealNoise: boolean;        // Domain randomization
}

export interface RlTrainingMetrics {
  episode: number;
  step: number;
  currentReward: number;
  averageReward: number;
  bestReward: number;
  rewardHistory: number[];
  policyLoss: number;
  valueLoss: number;
  distanceTraveledMeters: number;
  isTraining: boolean;
  speedMultiplier: 1 | 2 | 5 | 10;
}
