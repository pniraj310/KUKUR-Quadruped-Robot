import {
  BodyPose,
  GaitConfig,
  LabSceneObject,
  LegId,
  PosePreset,
  ServoChannel,
} from '../types/simulator';
import { INITIAL_SERVO_CHANNELS, LEG_CHANNELS_MAP } from './initialState';
import { checkRobotPoseCollision } from './collision';

// Robot physical geometry dimensions (in meters)
export const ROBOT_DIMS = {
  chassisLength: 0.52,
  chassisWidth: 0.21,
  chassisHeight: 0.105,
  hipOffsetX: 0.108,
  hipOffsetZ: 0.195,
  shoulderOutsetX: 0.046,
  upperLegLength: 0.205,
  lowerLegLength: 0.205,
  footRadius: 0.028,
};

/**
 * Clamp a servo command strictly within its allowed bounds.
 * CH7 is permanently enforced within [90, 100] as an invariant safety guard.
 */
export function clampChannelAngle(ch: ServoChannel, requestedDeg: number): number {
  const min = ch.channel === 7 ? Math.max(90, ch.minAngle) : ch.minAngle;
  const max = ch.channel === 7 ? Math.min(100, ch.maxAngle) : ch.maxAngle;
  const clamped = Math.min(max, Math.max(min, requestedDeg));
  return Math.round(clamped * 100) / 100;
}

/**
 * Convert software command angle (default 95 deg) into simulated 3D joint rotation (radians).
 * In Three.js right-handed coordinates (+Y up, +Z forward, +X robot-left), links hang along -Y,
 * so negative X rotation swings a link toward +Z (forward) and flexes the trailing knee upward.
 */
export function computeJointRadians(
  ch: ServoChannel,
  visualGain: number = 1.0
): number {
  const deltaFromNeutral = (ch.currentSimulatedAngle - 95) * visualGain;
  const directionSign =
    ch.role === 'abduction' ? (ch.leg === 'FL' || ch.leg === 'BL' ? 1 : -1) : -1;
  const totalDeg = ch.mechanicalOffsetDeg + deltaFromNeutral * directionSign;
  return (totalDeg * Math.PI) / 180;
}

/**
 * Compute simulated PCA9685 PWM pulse width in microseconds (500-2500us)
 */
export function angleToSimulatedPwmUs(angleDeg: number): number {
  return Math.round(500 + (angleDeg / 180) * 2000);
}

/**
 * Generate Stand / Sit / Neutral pose preview targets clamped safely within each channel's active [min, max].
 */
export function getPosePresetTargets(
  preset: PosePreset,
  channels: ServoChannel[]
): { targets: number[]; bodyPose: Partial<BodyPose> } {
  if (preset === 'stand') {
    const rawTargets = channels.map((ch) => {
      if (ch.role === 'abduction') return 95;
      if (ch.role === 'hip') return 93;
      return 92.5;
    });
    return {
      targets: rawTargets.map((val, idx) => clampChannelAngle(channels[idx], val)),
      bodyPose: { y: 0.375, pitch: 0, roll: 0 },
    };
  }

  if (preset === 'sit') {
    const rawTargets = channels.map((ch) => {
      if (ch.role === 'abduction') return 95;
      const isBack = ch.leg === 'BL' || ch.leg === 'BR';
      if (ch.role === 'hip') return isBack ? 99.5 : 92.5;
      return isBack ? 99.5 : 93.0;
    });
    return {
      targets: rawTargets.map((val, idx) => clampChannelAngle(channels[idx], val)),
      bodyPose: { y: 0.31, pitch: -11, roll: 0 },
    };
  }

  return {
    targets: channels.map((ch) => clampChannelAngle(channels[ch.channel], 95)),
    bodyPose: { x: 0, y: 0.36, z: 0, pitch: 0, roll: 0, yaw: 0 },
  };
}

/**
 * Compute coordinated 3-joint target angles for a single leg given normalized (-1..1)
 * Lift, Reach, and Spread sliders, respecting channel min/max bounds.
 */
export function computeCoordinatedLegTargets(
  leg: LegId,
  channels: ServoChannel[],
  lift: number,
  reach: number,
  spread: number
): [number, number, number] {
  const [abdIdx, hipIdx, kneeIdx] = LEG_CHANNELS_MAP[leg];
  const abdCh = channels[abdIdx];
  const hipCh = channels[hipIdx];
  const kneeCh = channels[kneeIdx];

  const abdHalfSpan = (abdCh.maxAngle - abdCh.minAngle) * 0.5;
  const hipHalfSpan = (hipCh.maxAngle - hipCh.minAngle) * 0.5;
  const kneeHalfSpan = (kneeCh.maxAngle - kneeCh.minAngle) * 0.5;

  const abdTarget = clampChannelAngle(abdCh, 95 + spread * abdHalfSpan);
  const hipTarget = clampChannelAngle(
    hipCh,
    95 + (reach * 0.65 - lift * 0.35) * hipHalfSpan
  );
  const kneeTarget = clampChannelAngle(
    kneeCh,
    95 + (lift * 0.85 - reach * 0.25) * kneeHalfSpan
  );

  return [abdTarget, hipTarget, kneeTarget];
}

/**
 * Compute kinematic gait target angles at elapsed simulation time `tSec`.
 */
export function computeGaitTargets(
  tSec: number,
  gait: GaitConfig,
  channels: ServoChannel[]
): number[] {
  const phases: Record<LegId, number> =
    gait.selectedGait === 'trot'
      ? { FL: 0.0, BR: 0.0, FR: 0.5, BL: 0.5 }
      : gait.selectedGait === 'walk'
      ? { FL: 0.0, BR: 0.25, FR: 0.5, BL: 0.75 }
      : gait.selectedGait === 'pace'
      ? { FL: 0.0, BL: 0.0, FR: 0.5, BR: 0.5 }
      : { FL: 0.0, FR: 0.18, BL: 0.55, BR: 0.73 };

  const amp = gait.stepAmplitudeDeg;
  const targets = channels.map((ch) => ch.targetAngle);

  (['FL', 'FR', 'BL', 'BR'] as LegId[]).forEach((leg) => {
    const [abdIdx, hipIdx, kneeIdx] = LEG_CHANNELS_MAP[leg];
    const theta = 2 * Math.PI * (tSec * gait.cadenceHz + phases[leg]);

    const swing = Math.sin(theta);
    const lift = Math.max(0, Math.cos(theta));
    const subtleRollBalance = Math.cos(theta) * 0.25;

    targets[abdIdx] = clampChannelAngle(channels[abdIdx], 95 + subtleRollBalance * amp);
    targets[hipIdx] = clampChannelAngle(channels[hipIdx], 95 + swing * amp);
    targets[kneeIdx] = clampChannelAngle(channels[kneeIdx], 95 + lift * amp);
  });

  return targets;
}

/**
 * Compute single-leg test sweep targets at elapsed time `tSec`.
 */
export function computeSingleLegTestTargets(
  tSec: number,
  leg: LegId,
  channels: ServoChannel[]
): number[] {
  const targets = channels.map((ch) => ch.targetAngle);
  const [abdIdx, hipIdx, kneeIdx] = LEG_CHANNELS_MAP[leg];
  const w = tSec * 2.4;

  targets[abdIdx] = clampChannelAngle(channels[abdIdx], 95 + Math.sin(w * 0.5) * 3.5);
  targets[hipIdx] = clampChannelAngle(channels[hipIdx], 95 + Math.sin(w) * 4.5);
  targets[kneeIdx] = clampChannelAngle(channels[kneeIdx], 95 + Math.cos(w) * 4.5);

  return targets;
}

/**
 * Detect solid obstacle collisions against KUKUR's body, legs, and feet using exact world OBB/cylinder shapes.
 */
export function detectSceneCollisions(
  bodyPose: BodyPose,
  objects: LabSceneObject[],
  channels: ServoChannel[] = INITIAL_SERVO_CHANNELS,
  visualGain: number = 1.0
): Set<string> {
  const res = checkRobotPoseCollision(bodyPose, channels, objects, visualGain, 0.02);
  return new Set(res.collidingObjectIds);
}

/**
 * Resolve a requested robot pose update so KUKUR's body, legs, and feet cannot penetrate
 * solid obstacles. Attempts axis-by-axis sliding if diagonal motion is blocked, otherwise
 * retains `currentPose` before contact occurs.
 */
export function resolveSolidBodyMovement(
  currentPose: BodyPose,
  requestedPose: BodyPose,
  channels: ServoChannel[],
  objects: LabSceneObject[],
  visualGain: number = 1.0
): { resolvedPose: BodyPose; blocked: boolean; collidingIds: string[] } {
  const directCheck = checkRobotPoseCollision(
    requestedPose,
    channels,
    objects,
    visualGain,
    0.015
  );
  if (!directCheck.colliding) {
    return {
      resolvedPose: requestedPose,
      blocked: false,
      collidingIds: [],
    };
  }

  // Try X-only slide if Z was blocked
  const slideX: BodyPose = { ...currentPose, x: requestedPose.x, y: requestedPose.y };
  if (!checkRobotPoseCollision(slideX, channels, objects, visualGain, 0.015).colliding) {
    const movedAny = Math.abs(slideX.x - currentPose.x) > 1e-4;
    if (movedAny) {
      return {
        resolvedPose: slideX,
        blocked: true,
        collidingIds: directCheck.collidingObjectIds,
      };
    }
  }

  // Try Z-only slide if X was blocked
  const slideZ: BodyPose = { ...currentPose, z: requestedPose.z, y: requestedPose.y };
  if (!checkRobotPoseCollision(slideZ, channels, objects, visualGain, 0.015).colliding) {
    const movedAny = Math.abs(slideZ.z - currentPose.z) > 1e-4;
    if (movedAny) {
      return {
        resolvedPose: slideZ,
        blocked: true,
        collidingIds: directCheck.collidingObjectIds,
      };
    }
  }

  // Completely block penetrating transition before collision occurs
  return {
    resolvedPose: currentPose,
    blocked: true,
    collidingIds: directCheck.collidingObjectIds,
  };
}
