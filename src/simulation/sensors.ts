import { LegId, RobotJointAngles, SensorData, Vector3D } from '../types/robot';

export interface Obstacle3D {
  type: 'box' | 'cylinder' | 'ramp';
  position: Vector3D; // mm
  size: Vector3D;     // mm [width, height, depth] or [radius, height, radius]
}

/**
 * Simulates real-time sensor reads (HC-SR04 Ultrasonic, MPU-6050 IMU, Foot Contact switches, Battery/Current)
 */
export function simulateSensors(
  robotPos: Vector3D,
  robotRot: { roll: number; pitch: number; yaw: number }, // in degrees
  jointAngles: RobotJointAngles,
  footContacts: Record<LegId, boolean>,
  obstacles: Obstacle3D[],
  deltaTime: number,
  previousRot?: { roll: number; pitch: number; yaw: number }
): SensorData {
  // 1. HC-SR04 Ultrasonic Raycast Simulation
  // Sensor is mounted at front center of SpotMicro (+150mm forward, +20mm above center)
  const degToRad = Math.PI / 180;
  const yawRad = robotRot.yaw * degToRad;
  const pitchRad = robotRot.pitch * degToRad;

  // Sensor forward direction vector
  const rayDirX = Math.sin(yawRad) * Math.cos(pitchRad);
  const rayDirY = -Math.sin(pitchRad);
  const rayDirZ = Math.cos(yawRad) * Math.cos(pitchRad);

  const sensorOriginX = robotPos.x + Math.sin(yawRad) * 150;
  const sensorOriginY = robotPos.y + 20;
  const sensorOriginZ = robotPos.z + Math.cos(yawRad) * 150;

  let minDistanceMm = 4000; // max sensor range is 4 meters (400 cm)

  // Raycast against ground if tilted downwards
  if (rayDirY < -0.05 && sensorOriginY > 0) {
    const groundDist = -sensorOriginY / rayDirY;
    if (groundDist > 0 && groundDist < minDistanceMm) {
      minDistanceMm = groundDist;
    }
  }

  // Raycast against 3D obstacles
  for (const obs of obstacles) {
    // Simple bounding sphere / box intersection
    const dx = obs.position.x - sensorOriginX;
    const dy = obs.position.y - sensorOriginY;
    const dz = obs.position.z - sensorOriginZ;

    // Projection along ray
    const projection = dx * rayDirX + dy * rayDirY + dz * rayDirZ;
    if (projection > 0 && projection < minDistanceMm) {
      const perpDistSq = (dx * dx + dy * dy + dz * dz) - projection * projection;
      const radius = Math.max(obs.size.x, obs.size.z) / 2;
      if (perpDistSq < radius * radius) {
        minDistanceMm = Math.min(minDistanceMm, Math.max(20, projection - radius));
      }
    }
  }

  // Convert to cm with subtle sensor noise (±0.5 cm)
  const noise = (Math.random() - 0.5) * 0.8;
  const ultrasonicDistanceCm = Math.round(
    Math.min(400, Math.max(2, minDistanceMm / 10 + noise)) * 10
  ) / 10;

  // 2. MPU-6050 6-DOF IMU Simulation
  // Gyroscope angular rate in rad/s
  const prev = previousRot || robotRot;
  const dt = Math.max(0.001, deltaTime);
  const gyro: Vector3D = {
    x: ((robotRot.pitch - prev.pitch) * degToRad) / dt,
    y: ((robotRot.yaw - prev.yaw) * degToRad) / dt,
    z: ((robotRot.roll - prev.roll) * degToRad) / dt,
  };

  // Accelerometer in m/s^2 (including gravity vector 9.81)
  const g = 9.81;
  const rollRad = robotRot.roll * degToRad;
  const accel: Vector3D = {
    x: g * Math.sin(rollRad) + (Math.random() - 0.5) * 0.1,
    y: g * Math.cos(rollRad) * Math.cos(pitchRad) + (Math.random() - 0.5) * 0.1,
    z: -g * Math.sin(pitchRad) + (Math.random() - 0.5) * 0.1,
  };

  // 3. Foot Contact Forces (Newtons)
  // SpotMicro total mass ~2.6 kg (including Pi 4, battery, 12 servos, chassis)
  const totalWeightN = 2.6 * 9.81; // ~25.5 N
  const activeContacts = (footContacts.FL ? 1 : 0) + (footContacts.FR ? 1 : 0) +
                         (footContacts.RL ? 1 : 0) + (footContacts.RR ? 1 : 0);
  const nominalForcePerFoot = activeContacts > 0 ? totalWeightN / activeContacts : 0;

  const footForces = {
    FL: footContacts.FL ? nominalForcePerFoot + (Math.random() - 0.5) * 1.5 : 0,
    FR: footContacts.FR ? nominalForcePerFoot + (Math.random() - 0.5) * 1.5 : 0,
    RL: footContacts.RL ? nominalForcePerFoot + (Math.random() - 0.5) * 1.5 : 0,
    RR: footContacts.RR ? nominalForcePerFoot + (Math.random() - 0.5) * 1.5 : 0,
  };

  // 4. Power & Battery (2S LiPo 7.4V nominal, 8.4V max)
  // Base current for Pi 4 (~0.8A) + PCA9685/servos (0.2A idle to 3.5A during dynamic gait)
  const dynamicFactor = (Math.abs(gyro.x) + Math.abs(gyro.y) + Math.abs(gyro.z)) * 0.4;
  const servoCurrentAmps = Math.round((1.1 + dynamicFactor + Math.random() * 0.2) * 100) / 100;
  const batteryVoltage = Math.round((7.85 - servoCurrentAmps * 0.08) * 100) / 100;

  return {
    ultrasonicDistanceCm,
    imu: {
      roll: Math.round(robotRot.roll * 10) / 10,
      pitch: Math.round(robotRot.pitch * 10) / 10,
      yaw: Math.round(robotRot.yaw * 10) / 10,
      accel,
      gyro,
      tempC: Math.round((38.2 + Math.random() * 0.3) * 10) / 10,
    },
    footContacts,
    footForces,
    batteryVoltage,
    servoCurrentAmps,
  };
}
