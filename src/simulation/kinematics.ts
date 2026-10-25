import { BodyPose, GaitType, LegId, LegJoints, RobotJointAngles, Vector3D } from '../types/robot';

// SpotMicro physical link lengths (in millimeters)
export const SPOT_MICRO_PARAMS = {
  bodyLength: 280, // mm (distance front to rear hip: 280mm, half is 140mm)
  bodyWidth: 110,  // mm (distance left to right hip: 110mm, half is 55mm)
  L1_hip: 58.5,    // mm (lateral offset from hip roll to shoulder)
  L2_upper: 105.0, // mm (femur length)
  L3_lower: 120.0, // mm (tibia length)
  defaultHeight: 165.0, // mm nominal standing height
};

export const DEFAULT_BODY_POSE: BodyPose = {
  x: 0,
  y: 165,
  z: 0,
  roll: 0,
  pitch: 0,
  yaw: 0,
};

// Hip attachment positions relative to body center [x: right(+)/left(-), y: vertical, z: front(+)/rear(-)]
export const HIP_POSITIONS: Record<LegId, Vector3D> = {
  FL: { x: -SPOT_MICRO_PARAMS.bodyWidth / 2, y: 0, z: SPOT_MICRO_PARAMS.bodyLength / 2 },
  FR: { x: SPOT_MICRO_PARAMS.bodyWidth / 2, y: 0, z: SPOT_MICRO_PARAMS.bodyLength / 2 },
  RL: { x: -SPOT_MICRO_PARAMS.bodyWidth / 2, y: 0, z: -SPOT_MICRO_PARAMS.bodyLength / 2 },
  RR: { x: SPOT_MICRO_PARAMS.bodyWidth / 2, y: 0, z: -SPOT_MICRO_PARAMS.bodyLength / 2 },
};

/**
 * Inverse Kinematics for a single SpotMicro leg.
 * Computes the 3 joint angles (hip roll, shoulder pitch, knee pitch in degrees)
 * given the foot position (x, y, z in mm) relative to the hip origin.
 *
 * Coordinate system at hip:
 * - x: lateral (outward is positive for right legs, negative for left legs)
 * - y: vertical downward (-y is toward ground)
 * - z: longitudinal (forward is positive)
 */
export function calculateLegIK(leg: LegId, footTarget: Vector3D): LegJoints {
  const isLeft = leg === 'FL' || leg === 'RL';
  const l1 = SPOT_MICRO_PARAMS.L1_hip;
  const l2 = SPOT_MICRO_PARAMS.L2_upper;
  const l3 = SPOT_MICRO_PARAMS.L3_lower;

  // Account for lateral sign convention
  const x = isLeft ? -footTarget.x : footTarget.x;
  const y = -footTarget.y; // positive downwards
  const z = footTarget.z;

  // 1. Hip Roll Angle (theta1)
  // Distance in the coronal (x-y) plane
  const d_xy = Math.sqrt(x * x + y * y);
  if (d_xy < l1) {
    // Target is inside hip cylinder singularity
    return { hip: 0, shoulder: 45, knee: -90 };
  }

  const alpha = Math.atan2(y, x);
  const beta = Math.acos(Math.min(1, Math.max(-1, l1 / d_xy)));
  let theta1_rad = alpha - beta;
  if (!isLeft) {
    theta1_rad = -theta1_rad;
  }

  // 2. Projected length in sagittal plane
  const d_plane = Math.sqrt(Math.max(0, d_xy * d_xy - l1 * l1) + z * z);

  // Clamp within reach
  const maxReach = l2 + l3 - 1.0;
  const minReach = Math.abs(l2 - l3) + 1.0;
  const d_clamped = Math.min(maxReach, Math.max(minReach, d_plane));

  // 3. Knee Pitch Angle (theta3) using Law of Cosines
  const cosKnee = (d_clamped * d_clamped - l2 * l2 - l3 * l3) / (2 * l2 * l3);
  const knee_rad = -Math.acos(Math.min(1, Math.max(-1, cosKnee))); // knee flexes backwards

  // 4. Shoulder Pitch Angle (theta2)
  const gamma = Math.atan2(z, Math.sqrt(Math.max(0, d_xy * d_xy - l1 * l1)));
  const delta = Math.atan2(
    l3 * Math.sin(-knee_rad),
    l2 + l3 * Math.cos(-knee_rad)
  );
  const shoulder_rad = gamma + delta;

  // Convert to degrees and apply joint limits
  const radToDeg = 180 / Math.PI;
  const hipDeg = Math.min(45, Math.max(-45, theta1_rad * radToDeg));
  const shoulderDeg = Math.min(90, Math.max(-60, shoulder_rad * radToDeg));
  const kneeDeg = Math.min(-15, Math.max(-145, knee_rad * radToDeg));

  return {
    hip: hipDeg,
    shoulder: shoulderDeg,
    knee: kneeDeg,
  };
}

/**
 * Forward Kinematics for a single leg:
 * Computes the foot tip position relative to the hip given the 3 joint angles (in degrees).
 */
export function calculateLegFK(leg: LegId, joints: LegJoints): Vector3D {
  const isLeft = leg === 'FL' || leg === 'RL';
  const l1 = SPOT_MICRO_PARAMS.L1_hip;
  const l2 = SPOT_MICRO_PARAMS.L2_upper;
  const l3 = SPOT_MICRO_PARAMS.L3_lower;

  const degToRad = Math.PI / 180;
  const theta1 = (isLeft ? joints.hip : -joints.hip) * degToRad;
  const theta2 = joints.shoulder * degToRad;
  const theta3 = -joints.knee * degToRad;

  // Sagittal plane coordinates
  const z = l2 * Math.sin(theta2) + l3 * Math.sin(theta2 - theta3);
  const r = l2 * Math.cos(theta2) + l3 * Math.cos(theta2 - theta3);

  // 3D coordinates relative to hip
  const x_local = l1 * Math.cos(theta1) - r * Math.sin(theta1);
  const y_local = -(l1 * Math.sin(theta1) + r * Math.cos(theta1));

  return {
    x: isLeft ? -x_local : x_local,
    y: y_local,
    z: z,
  };
}

/**
 * Transforms foot targets in world/ground space according to body pose (roll, pitch, yaw, translation)
 */
export function computePoseInverseKinematics(pose: BodyPose): RobotJointAngles {
  const degToRad = Math.PI / 180;
  const roll = pose.roll * degToRad;
  const pitch = pose.pitch * degToRad;
  const yaw = pose.yaw * degToRad;

  // Rotation matrix components
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cy = Math.cos(yaw), sy = Math.sin(yaw);

  // Default neutral foot coordinates relative to body center on ground
  const neutralFootPositions: Record<LegId, Vector3D> = {
    FL: { x: -(SPOT_MICRO_PARAMS.bodyWidth / 2 + SPOT_MICRO_PARAMS.L1_hip), y: -pose.y, z: SPOT_MICRO_PARAMS.bodyLength / 2 },
    FR: { x: SPOT_MICRO_PARAMS.bodyWidth / 2 + SPOT_MICRO_PARAMS.L1_hip, y: -pose.y, z: SPOT_MICRO_PARAMS.bodyLength / 2 },
    RL: { x: -(SPOT_MICRO_PARAMS.bodyWidth / 2 + SPOT_MICRO_PARAMS.L1_hip), y: -pose.y, z: -SPOT_MICRO_PARAMS.bodyLength / 2 },
    RR: { x: SPOT_MICRO_PARAMS.bodyWidth / 2 + SPOT_MICRO_PARAMS.L1_hip, y: -pose.y, z: -SPOT_MICRO_PARAMS.bodyLength / 2 },
  };

  const legs: LegId[] = ['FL', 'FR', 'RL', 'RR'];
  const jointResult: Partial<RobotJointAngles> = {};

  for (const leg of legs) {
    const hip = HIP_POSITIONS[leg];
    const footG = neutralFootPositions[leg];

    // Subtract body translation
    const px = footG.x - pose.x;
    const py = footG.y;
    const pz = footG.z - pose.z;

    // Apply inverse rotation
    // R_transposed * p
    const r11 = cy * cp;
    const r12 = cy * sp * sr - sy * cr;
    const r13 = cy * sp * cr + sy * sr;

    const r21 = sy * cp;
    const r22 = sy * sp * sr + cy * cr;
    const r23 = sy * sp * cr - cy * sr;

    const r31 = -sp;
    const r32 = cp * sr;
    const r33 = cp * cr;

    const x_rot = r11 * px + r21 * py + r31 * pz;
    const y_rot = r12 * px + r22 * py + r32 * pz;
    const z_rot = r13 * px + r23 * py + r33 * pz;

    // Relative to leg hip origin
    const footRelative: Vector3D = {
      x: x_rot - hip.x,
      y: y_rot - hip.y,
      z: z_rot - hip.z,
    };

    jointResult[leg] = calculateLegIK(leg, footRelative);
  }

  return jointResult as RobotJointAngles;
}

/**
 * Dynamic Gait Engine for Trot, Walk, Pace, Gallop, Sit, Wave
 */
export function generateGaitJoints(
  gait: GaitType,
  phase: number, // 0.0 to 1.0 continuous gait cycle
  strideLength: number = 40, // mm forward/backward
  stepHeight: number = 30, // mm clearance
  bodyPose: BodyPose = DEFAULT_BODY_POSE,
  turnRate: number = 0 // -1 (turn left) to +1 (turn right)
): { joints: RobotJointAngles; footPositions: Record<LegId, Vector3D>; contacts: Record<LegId, boolean> } {
  const legs: LegId[] = ['FL', 'FR', 'RL', 'RR'];
  const baseAngles = computePoseInverseKinematics(bodyPose);

  if (gait === 'stand') {
    const footPos: Record<LegId, Vector3D> = {
      FL: calculateLegFK('FL', baseAngles.FL),
      FR: calculateLegFK('FR', baseAngles.FR),
      RL: calculateLegFK('RL', baseAngles.RL),
      RR: calculateLegFK('RR', baseAngles.RR),
    };
    return {
      joints: baseAngles,
      footPositions: footPos,
      contacts: { FL: true, FR: true, RL: true, RR: true },
    };
  }

  if (gait === 'sit') {
    // Rear legs folded, front legs upright
    const sitJoints: RobotJointAngles = {
      FL: { hip: 0, shoulder: 40, knee: -75 },
      FR: { hip: 0, shoulder: 40, knee: -75 },
      RL: { hip: -10, shoulder: -35, knee: -135 },
      RR: { hip: 10, shoulder: -35, knee: -135 },
    };
    return {
      joints: sitJoints,
      footPositions: {
        FL: calculateLegFK('FL', sitJoints.FL),
        FR: calculateLegFK('FR', sitJoints.FR),
        RL: calculateLegFK('RL', sitJoints.RL),
        RR: calculateLegFK('RR', sitJoints.RR),
      },
      contacts: { FL: true, FR: true, RL: true, RR: true },
    };
  }

  if (gait === 'wave') {
    // Sit down and wave right front paw in the air
    const waveProgress = Math.sin(phase * Math.PI * 4);
    const waveJoints: RobotJointAngles = {
      FL: { hip: 0, shoulder: 35, knee: -70 },
      FR: { hip: 15 + waveProgress * 15, shoulder: 85, knee: -50 + waveProgress * 30 },
      RL: { hip: -10, shoulder: -35, knee: -135 },
      RR: { hip: 10, shoulder: -35, knee: -135 },
    };
    return {
      joints: waveJoints,
      footPositions: {
        FL: calculateLegFK('FL', waveJoints.FL),
        FR: calculateLegFK('FR', waveJoints.FR),
        RL: calculateLegFK('RL', waveJoints.RL),
        RR: calculateLegFK('RR', waveJoints.RR),
      },
      contacts: { FL: true, FR: false, RL: true, RR: true },
    };
  }

  // Phase offsets for different gaits (values between 0 and 1)
  let offsets: Record<LegId, number>;
  let dutyCycle = 0.5; // fraction of cycle foot is on ground

  switch (gait) {
    case 'trot':
      // Diagonal pairs move together
      offsets = { FL: 0.0, RR: 0.0, FR: 0.5, RL: 0.5 };
      dutyCycle = 0.55;
      break;
    case 'walk':
      // 4-beat crawl: FL -> RR -> FR -> RL
      offsets = { FL: 0.0, RR: 0.25, FR: 0.5, RL: 0.75 };
      dutyCycle = 0.75;
      break;
    case 'pace':
      // Lateral pairs move together
      offsets = { FL: 0.0, RL: 0.0, FR: 0.5, RR: 0.5 };
      dutyCycle = 0.55;
      break;
    case 'gallop':
      // Front pair, then rear pair
      offsets = { FL: 0.0, FR: 0.1, RL: 0.5, RR: 0.6 };
      dutyCycle = 0.45;
      break;
    default:
      offsets = { FL: 0, FR: 0.5, RL: 0.5, RR: 0 };
  }

  const resultJoints: Partial<RobotJointAngles> = {};
  const footPositions: Partial<Record<LegId, Vector3D>> = {};
  const contacts: Partial<Record<LegId, boolean>> = {};

  for (const leg of legs) {
    const legPhase = (phase + offsets[leg]) % 1.0;
    const isSwing = legPhase < (1.0 - dutyCycle);
    contacts[leg] = !isSwing;

    let deltaZ = 0;
    let deltaY = 0;
    let deltaX = 0;

    // Differential steering turn offset
    const isRightLeg = leg === 'FR' || leg === 'RR';
    const legTurnFactor = isRightLeg ? (1 - turnRate * 0.7) : (1 + turnRate * 0.7);
    const effectiveStride = strideLength * legTurnFactor;

    if (isSwing) {
      // Swing phase: foot lifts up and moves forward along a smooth cycloid/parabola
      const swingRatio = legPhase / (1.0 - dutyCycle);
      // Lift trajectory (sinusoidal)
      deltaY = Math.sin(swingRatio * Math.PI) * stepHeight;
      // Longitudinal trajectory (-half stride to +half stride)
      deltaZ = -effectiveStride / 2 + swingRatio * effectiveStride;
    } else {
      // Stance phase: foot pushes backwards on ground
      const stanceRatio = (legPhase - (1.0 - dutyCycle)) / dutyCycle;
      deltaY = 0;
      deltaZ = effectiveStride / 2 - stanceRatio * effectiveStride;
    }

    // Foot target relative to hip in nominal pose
    const isLeft = leg === 'FL' || leg === 'RL';
    const lateralOffset = isLeft ? -SPOT_MICRO_PARAMS.L1_hip : SPOT_MICRO_PARAMS.L1_hip;

    const footTarget: Vector3D = {
      x: lateralOffset + deltaX,
      y: -bodyPose.y + deltaY,
      z: deltaZ,
    };

    const calculatedJoints = calculateLegIK(leg, footTarget);
    resultJoints[leg] = calculatedJoints;
    footPositions[leg] = calculateLegFK(leg, calculatedJoints);
  }

  return {
    joints: resultJoints as RobotJointAngles,
    footPositions: footPositions as Record<LegId, Vector3D>,
    contacts: contacts as Record<LegId, boolean>,
  };
}
