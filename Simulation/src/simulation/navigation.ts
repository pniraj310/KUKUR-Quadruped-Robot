import * as THREE from 'three';
import {
  BodyPose,
  LabSceneObject,
  NavigationActivityState,
  NavigationConfigAndState,
  NavigationFsmState,
  SensorRayReading,
  ServoChannel,
  SimulatedDetection,
} from '../types/simulator';
import {
  checkRobotPoseCollision,
  computeRobotWorldColliders,
  getObstacleLocalDimensions,
  raycastSolidObstacles,
} from './collision';

const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();
const _originWorld = new THREE.Vector3();
const _originLowWorld = new THREE.Vector3();
const _dirWorld = new THREE.Vector3();

export interface NavigationScanResult {
  rays: SensorRayReading[];
  nearestForwardM: number;
  nearestForwardObjectId: string | null;
  leftClearanceM: number;
  rightClearanceM: number;
  detectedObstacleIds: string[];
}

export interface NavigationStepOptions {
  userManipulating?: boolean;
}

const MAX_SENSOR_RANGE_M = 3.6;
export const LIFTED_CHASSIS_HEIGHT_THRESHOLD_M = 0.43;
const LIFTED_FOOT_CLEARANCE_THRESHOLD_M = 0.055;

export function normalizeAngleDeg(deg: number): number {
  let a = (((deg + 180) % 360) + 360) % 360 - 180;
  if (a === -180) a = 180;
  return a;
}

/**
 * Determine whether KUKUR has been lifted off the laboratory floor.
 * Checks both chassis height and the lowest world-space foot sphere elevation.
 */
export function isRobotLiftedOffFloor(
  bodyPose: BodyPose,
  channels: ServoChannel[],
  visualGain: number = 1.0
): boolean {
  if (bodyPose.y > LIFTED_CHASSIS_HEIGHT_THRESHOLD_M) {
    return true;
  }
  const colliders = computeRobotWorldColliders(bodyPose, channels, visualGain);
  let minFootBottomY = Infinity;
  for (const sph of colliders) {
    if (sph.part.endsWith('-foot')) {
      const bottomY = sph.center.y - sph.radius;
      if (bottomY < minFootBottomY) minFootBottomY = bottomY;
    }
  }
  return minFootBottomY > LIFTED_FOOT_CLEARANCE_THRESHOLD_M;
}

/**
 * Cast KUKUR's forward and lateral distance sensor rays + fuse forward camera detections
 * in world coordinates transformed by the robot's current orientation.
 */
export function scanNavigationSensors(
  bodyPose: BodyPose,
  objects: LabSceneObject[],
  cameraDetections: SimulatedDetection[] = []
): NavigationScanResult {
  _euler.set(
    THREE.MathUtils.degToRad(bodyPose.pitch),
    THREE.MathUtils.degToRad(bodyPose.yaw),
    THREE.MathUtils.degToRad(bodyPose.roll),
    'YXZ'
  );
  _quat.setFromEuler(_euler);

  const specs: Array<{
    id: string;
    label: string;
    localOrigin: [number, number, number];
    angleDeg: number; // +CCW = Left, -CW = Right
    zone: 'forward' | 'left' | 'right';
  }> = [
    {
      id: 'fwd-center',
      label: 'Front Center',
      localOrigin: [0, -0.015, 0.265],
      angleDeg: 0,
      zone: 'forward',
    },
    {
      id: 'fwd-left-corridor',
      label: 'Front Left Corridor',
      localOrigin: [0.185, -0.02, 0.22],
      angleDeg: 0,
      zone: 'forward',
    },
    {
      id: 'fwd-right-corridor',
      label: 'Front Right Corridor',
      localOrigin: [-0.185, -0.02, 0.22],
      angleDeg: 0,
      zone: 'forward',
    },
    {
      id: 'fwd-diag-l',
      label: 'Front-Left 16°',
      localOrigin: [0.09, -0.015, 0.25],
      angleDeg: 16,
      zone: 'forward',
    },
    {
      id: 'fwd-diag-r',
      label: 'Front-Right 16°',
      localOrigin: [-0.09, -0.015, 0.25],
      angleDeg: -16,
      zone: 'forward',
    },
    {
      id: 'left-42',
      label: 'Left 42°',
      localOrigin: [0.11, -0.015, 0.2],
      angleDeg: 42,
      zone: 'left',
    },
    {
      id: 'left-75',
      label: 'Left 75°',
      localOrigin: [0.115, -0.015, 0.08],
      angleDeg: 75,
      zone: 'left',
    },
    {
      id: 'right-42',
      label: 'Right 42°',
      localOrigin: [-0.11, -0.015, 0.2],
      angleDeg: -42,
      zone: 'right',
    },
    {
      id: 'right-75',
      label: 'Right 75°',
      localOrigin: [-0.115, -0.015, 0.08],
      angleDeg: -75,
      zone: 'right',
    },
  ];

  const rays: SensorRayReading[] = [];
  const detectedSet = new Set<string>();
  let nearestForwardM = MAX_SENSOR_RANGE_M;
  let nearestForwardObjectId: string | null = null;
  let leftSum = 0;
  let leftMin = MAX_SENSOR_RANGE_M;
  let rightSum = 0;
  let rightMin = MAX_SENSOR_RANGE_M;

  for (const sp of specs) {
    _originWorld
      .set(sp.localOrigin[0], sp.localOrigin[1], sp.localOrigin[2])
      .applyQuaternion(_quat)
      .add(new THREE.Vector3(bodyPose.x, bodyPose.y, bodyPose.z));

    _originLowWorld.set(_originWorld.x, Math.max(0.11, bodyPose.y - 0.19), _originWorld.z);

    const rad = THREE.MathUtils.degToRad(sp.angleDeg);
    _dirWorld.set(Math.sin(rad), 0, Math.cos(rad)).applyQuaternion(_quat);
    _dirWorld.y = 0;
    if (_dirWorld.lengthSq() < 1e-6) _dirWorld.set(0, 0, 1);
    _dirWorld.normalize();

    const hitHigh = raycastSolidObstacles(_originWorld, _dirWorld, MAX_SENSOR_RANGE_M, objects);
    const hitLow = raycastSolidObstacles(
      _originLowWorld,
      _dirWorld,
      MAX_SENSOR_RANGE_M,
      objects
    );

    const bestHit =
      hitHigh && hitLow
        ? hitHigh.distanceM <= hitLow.distanceM
          ? hitHigh
          : hitLow
        : hitHigh || hitLow;

    const dist = bestHit ? bestHit.distanceM : MAX_SENSOR_RANGE_M;
    const hitId = bestHit ? bestHit.objectId : null;
    if (hitId && dist < MAX_SENSOR_RANGE_M * 0.85) {
      detectedSet.add(hitId);
    }

    const endPt = _originWorld.clone().addScaledVector(_dirWorld, dist);

    rays.push({
      id: sp.id,
      label: sp.label,
      angleDeg: sp.angleDeg,
      origin: [_originWorld.x, _originWorld.y, _originWorld.z],
      endPoint: [endPt.x, endPt.y, endPt.z],
      distanceM: Math.round(dist * 100) / 100,
      maxRangeM: MAX_SENSOR_RANGE_M,
      hitObjectId: hitId,
      zone: sp.zone,
    });

    if (sp.zone === 'forward') {
      if (dist < nearestForwardM) {
        nearestForwardM = dist;
        nearestForwardObjectId = hitId;
      }
    } else if (sp.zone === 'left') {
      leftSum += dist;
      if (dist < leftMin) leftMin = dist;
    } else {
      rightSum += dist;
      if (dist < rightMin) rightMin = dist;
    }
  }

  // Fuse forward virtual camera detections for solid obstacles near center corridor
  for (const det of cameraDetections) {
    const matchingObj = objects.find((o) => o.id === det.objectId);
    if (!matchingObj || !getObstacleLocalDimensions(matchingObj.type).isSolid) continue;

    if (det.distanceMeters < MAX_SENSOR_RANGE_M * 0.85) {
      detectedSet.add(det.objectId);
    }
    const centerX = det.bbox.x + det.bbox.width * 0.5;
    if (centerX > 0.3 && centerX < 0.7) {
      const noseEst = Math.max(0.05, det.distanceMeters - 0.18);
      if (noseEst < nearestForwardM) {
        nearestForwardM = Math.round(noseEst * 100) / 100;
        nearestForwardObjectId = det.objectId;
      }
    }
  }

  // Report best/mean lateral clearance so a single grazing ray doesn't hide a clear 75°-90° side corridor
  const leftClearanceM = Math.round(((leftMin * 0.45 + (leftSum / 2) * 0.55)) * 100) / 100;
  const rightClearanceM = Math.round(((rightMin * 0.45 + (rightSum / 2) * 0.55)) * 100) / 100;

  return {
    rays,
    nearestForwardM: Math.round(nearestForwardM * 100) / 100,
    nearestForwardObjectId,
    leftClearanceM,
    rightClearanceM,
    detectedObstacleIds: Array.from(detectedSet),
  };
}

/**
 * Verify that KUKUR can rotate smoothly in place from `pose.yaw` by `deltaDeg` without striking a wall.
 */
function canRotateInPlace(
  pose: BodyPose,
  deltaDeg: number,
  channels: ServoChannel[],
  objects: LabSceneObject[],
  visualGain: number
): boolean {
  const steps = Math.max(2, Math.ceil(Math.abs(deltaDeg) / 18));
  for (let s = 1; s <= steps; s++) {
    const testYaw = normalizeAngleDeg(pose.yaw + (deltaDeg * s) / steps);
    if (
      checkRobotPoseCollision({ ...pose, yaw: testYaw }, channels, objects, visualGain, 0.006)
        .colliding
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Test how far KUKUR can advance forward along `candidateYawDeg` in world space
 * without its body, legs, or feet colliding with any solid obstacle.
 */
export function evaluateEscapeHeadingClearance(
  basePose: BodyPose,
  candidateYawDeg: number,
  channels: ServoChannel[],
  objects: LabSceneObject[],
  visualGain: number
): number {
  const rotatedPose: BodyPose = { ...basePose, yaw: candidateYawDeg };
  if (checkRobotPoseCollision(rotatedPose, channels, objects, visualGain, 0.006).colliding) {
    return 0;
  }

  const yawRad = THREE.MathUtils.degToRad(candidateYawDeg);
  const stepX = Math.sin(yawRad);
  const stepZ = Math.cos(yawRad);

  let maxClearDist = 0;
  const maxProbeM = 2.4;
  const stepSize = 0.12;

  for (let d = stepSize; d <= maxProbeM; d += stepSize) {
    const testPose: BodyPose = {
      ...rotatedPose,
      x: basePose.x + stepX * d,
      z: basePose.z + stepZ * d,
    };
    if (Math.abs(testPose.x) > 5.35 || Math.abs(testPose.z) > 5.35) {
      break;
    }
    const col = checkRobotPoseCollision(testPose, channels, objects, visualGain, 0.032);
    if (col.colliding) {
      break;
    }
    maxClearDist = d;
  }

  return Math.round(maxClearDist * 100) / 100;
}

interface SideRouteEvaluation {
  viable: boolean;
  bestClearanceM: number;
  bestDeltaDeg: number;
  score: number;
}

function evaluateSideOptions(
  pose: BodyPose,
  side: 'LEFT' | 'RIGHT',
  nominalTurnDeg: number,
  clearanceThresholdM: number,
  safetyDistanceM: number,
  lateralSensorClearanceM: number,
  channels: ServoChannel[],
  objects: LabSceneObject[],
  visualGain: number
): SideRouteEvaluation {
  const sign = side === 'LEFT' ? 1 : -1;
  const clampedTurn = THREE.MathUtils.clamp(nominalTurnDeg, 30, 90);
  const rawAngles = [
    Math.round(clampedTurn * 0.85),
    Math.round(clampedTurn),
    Math.min(92, Math.round(clampedTurn * 1.3)),
    90,
  ];
  const uniqueMagnitudes = Array.from(new Set(rawAngles));

  let bestClearanceM = 0;
  let bestDeltaDeg = sign * clampedTurn;
  let bestOptionScore = -1;

  for (const mag of uniqueMagnitudes) {
    const delta = sign * mag;
    if (!canRotateInPlace(pose, delta, channels, objects, visualGain)) {
      continue;
    }
    const candYaw = normalizeAngleDeg(pose.yaw + delta);
    const probeDist = evaluateEscapeHeadingClearance(
      pose,
      candYaw,
      channels,
      objects,
      visualGain
    );
    const candScan = scanNavigationSensors({ ...pose, yaw: candYaw }, objects, []);
    const effectiveClearance = Math.min(probeDist, candScan.nearestForwardM);

    // Slight preference for turn angles closer to user's configured nominalTurnDeg when equally clear
    const anglePenalty = Math.abs(mag - clampedTurn) * 0.003;
    const optionScore = effectiveClearance - anglePenalty;

    if (effectiveClearance > bestClearanceM || optionScore > bestOptionScore) {
      if (effectiveClearance >= clearanceThresholdM || bestClearanceM < clearanceThresholdM) {
        bestClearanceM = Math.max(bestClearanceM, effectiveClearance);
        if (optionScore > bestOptionScore) {
          bestOptionScore = optionScore;
          bestDeltaDeg = delta;
        }
      }
    }
  }

  const minReq = Math.max(0.42, clearanceThresholdM);
  const viable =
    bestClearanceM >= minReq &&
    (bestClearanceM >= safetyDistanceM * 0.9 || lateralSensorClearanceM >= minReq * 0.85);

  return {
    viable,
    bestClearanceM: Math.round(bestClearanceM * 100) / 100,
    bestDeltaDeg,
    score: bestClearanceM * 0.78 + lateralSensorClearanceM * 0.22,
  };
}

function deriveActivityState(
  enabled: boolean,
  fsmState: NavigationFsmState,
  shouldAnimateGait: boolean
): NavigationActivityState {
  if (!enabled || fsmState === 'IDLE') return 'IDLE';
  if (
    shouldAnimateGait ||
    fsmState === 'MOVING_FORWARD' ||
    fsmState === 'TURNING_LEFT' ||
    fsmState === 'TURNING_RIGHT' ||
    fsmState === 'BYPASSING_OBSTACLE' ||
    fsmState === 'RESUMING_MOVEMENT'
  ) {
    return shouldAnimateGait ? 'MOVING' : 'WAITING';
  }
  return 'WAITING';
}

export interface NavigationStepOutput {
  nextNav: NavigationConfigAndState;
  nextBodyPose: BodyPose;
  shouldAnimateGait: boolean;
  scan: NavigationScanResult;
}

/**
 * Advance one step of KUKUR's continuous 11-state Autonomous Obstacle Avoidance FSM.
 */
export function stepAutonomousNavigation(
  dt: number,
  nav: NavigationConfigAndState,
  bodyPose: BodyPose,
  channels: ServoChannel[],
  objects: LabSceneObject[],
  cameraDetections: SimulatedDetection[],
  visualGain: number = 1.0,
  options: NavigationStepOptions = {}
): NavigationStepOutput {
  const lifted = isRobotLiftedOffFloor(bodyPose, channels, visualGain);
  const scan = scanNavigationSensors(bodyPose, objects, cameraDetections);

  // Manual Stop Simulation override: never auto-restart when disabled
  if (!nav.enabled) {
    return {
      nextNav: {
        ...nav,
        fsmState: 'IDLE',
        activityState: 'IDLE',
        isLiftedOffFloor: lifted,
        selectedTurnDirection: 'NONE',
        nearestForwardM: scan.nearestForwardM,
        leftClearanceM: scan.leftClearanceM,
        rightClearanceM: scan.rightClearanceM,
        detectedObstacleIds: scan.detectedObstacleIds,
        statusMessage: 'Autonomous avoidance standby (IDLE)',
        stateTimerSec: 0,
        committedTurn: null,
        targetYawDeg: null,
        initialBypassHeadingDeg: null,
        bypassObstacleId: null,
        bypassDistanceTraveledM: 0,
        cumulativeTurnDeg: 0,
        lastCommandedPose: null,
      },
      nextBodyPose: bodyPose,
      shouldAnimateGait: false,
      scan,
    };
  }

  // Detect external manual pick-up, drag, or heading rotation not caused by the navigation controller
  let externalPoseChanged = Boolean(options.userManipulating);
  if (!externalPoseChanged && nav.lastCommandedPose !== null) {
    const lp = nav.lastCommandedPose;
    const posDelta = Math.hypot(
      bodyPose.x - lp.x,
      bodyPose.y - lp.y,
      bodyPose.z - lp.z
    );
    const yawDelta = Math.abs(normalizeAngleDeg(bodyPose.yaw - lp.yaw));
    const tiltDelta = Math.max(
      Math.abs(bodyPose.pitch - lp.pitch),
      Math.abs(bodyPose.roll - lp.roll)
    );
    if (posDelta > 0.014 || yawDelta > 1.0 || tiltDelta > 1.5) {
      externalPoseChanged = true;
    }
  }

  // Scenario D (lifted off floor): immediately suspend ground locomotion until placed back down
  if (lifted) {
    const suspendedPose: BodyPose = { ...bodyPose };
    return {
      nextNav: {
        ...nav,
        fsmState: 'RELOCALIZING',
        activityState: 'WAITING',
        isLiftedOffFloor: true,
        selectedTurnDirection: 'NONE',
        nearestForwardM: scan.nearestForwardM,
        leftClearanceM: scan.leftClearanceM,
        rightClearanceM: scan.rightClearanceM,
        detectedObstacleIds: scan.detectedObstacleIds,
        statusMessage: 'Robot lifted off floor — waiting for placement',
        stateTimerSec: 0,
        committedTurn: null,
        targetYawDeg: null,
        initialBypassHeadingDeg: null,
        bypassObstacleId: null,
        bypassDistanceTraveledM: 0,
        cumulativeTurnDeg: 0,
        lastCommandedPose: { ...suspendedPose },
      },
      nextBodyPose: suspendedPose,
      shouldAnimateGait: false,
      scan,
    };
  }

  // Scenario D & E: user dragged, picked up/placed, or manually rotated KUKUR -> pause & relocalize at new pose
  if (externalPoseChanged) {
    const acceptedPose: BodyPose = { ...bodyPose };
    return {
      nextNav: {
        ...nav,
        fsmState: 'RELOCALIZING',
        activityState: 'WAITING',
        isLiftedOffFloor: false,
        selectedTurnDirection: 'NONE',
        nearestForwardM: scan.nearestForwardM,
        leftClearanceM: scan.leftClearanceM,
        rightClearanceM: scan.rightClearanceM,
        detectedObstacleIds: scan.detectedObstacleIds,
        statusMessage: 'Robot repositioned — recalculating route',
        stateTimerSec: 0,
        committedTurn: null,
        targetYawDeg: null,
        initialBypassHeadingDeg: null,
        bypassObstacleId: null,
        bypassDistanceTraveledM: 0,
        cumulativeTurnDeg: 0,
        lastCommandedPose: { ...acceptedPose },
      },
      nextBodyPose: acceptedPose,
      shouldAnimateGait: false,
      scan,
    };
  }

  const nextNav: NavigationConfigAndState = {
    ...nav,
    isLiftedOffFloor: false,
    nearestForwardM: scan.nearestForwardM,
    leftClearanceM: scan.leftClearanceM,
    rightClearanceM: scan.rightClearanceM,
    detectedObstacleIds: scan.detectedObstacleIds,
    stateTimerSec: nav.stateTimerSec + dt,
  };
  let nextPose: BodyPose = { ...bodyPose };
  let shouldAnimateGait = false;

  const stopThresholdM = nav.safetyDistanceM;
  const resumeThresholdM = Math.max(nav.safetyDistanceM * 1.15, nav.safetyDistanceM + 0.08);
  const clearanceThresholdM = Math.max(0.4, nav.clearanceThresholdM);

  // Transition IDLE -> active navigation when enabled
  if (nextNav.fsmState === 'IDLE') {
    nextNav.stateTimerSec = 0;
    nextNav.selectedTurnDirection = 'NONE';
    if (scan.nearestForwardM <= stopThresholdM) {
      nextNav.fsmState = 'OBSTACLE_DETECTED';
      nextNav.bypassObstacleId = scan.nearestForwardObjectId;
      nextNav.initialBypassHeadingDeg = nextPose.yaw;
      nextNav.statusMessage = 'Obstacle detected — checking alternate routes';
    } else {
      nextNav.fsmState = 'MOVING_FORWARD';
      nextNav.statusMessage = 'Forward path clear — walking';
    }
  }

  const tryAdvanceForward = (distanceStep: number): boolean => {
    const yawRad = THREE.MathUtils.degToRad(nextPose.yaw);
    const candPose: BodyPose = {
      ...nextPose,
      x: THREE.MathUtils.clamp(nextPose.x + Math.sin(yawRad) * distanceStep, -5.3, 5.3),
      z: THREE.MathUtils.clamp(nextPose.z + Math.cos(yawRad) * distanceStep, -5.3, 5.3),
    };
    const hitBound = Math.abs(candPose.x) >= 5.29 || Math.abs(candPose.z) >= 5.29;
    if (hitBound) return false;

    const col = checkRobotPoseCollision(candPose, channels, objects, visualGain, 0.028);
    if (col.colliding) {
      return false;
    }
    nextPose = candPose;
    return true;
  };

  switch (nextNav.fsmState) {
    case 'RELOCALIZING': {
      shouldAnimateGait = false;
      nextNav.statusMessage = 'Robot repositioned — recalculating route';

      if (nextNav.stateTimerSec >= 0.1) {
        // Verify placement is valid and non-overlapping
        const overlap = checkRobotPoseCollision(
          nextPose,
          channels,
          objects,
          visualGain,
          0.008
        );
        if (overlap.colliding) {
          nextNav.fsmState = 'PATH_BLOCKED';
          nextNav.selectedTurnDirection = 'BLOCKED';
          nextNav.stateTimerSec = 0;
          nextNav.statusMessage = 'PATH BLOCKED — WAITING FOR CLEARANCE';
          break;
        }

        const fwdProbe = evaluateEscapeHeadingClearance(
          nextPose,
          nextPose.yaw,
          channels,
          objects,
          visualGain
        );
        if (scan.nearestForwardM > stopThresholdM && fwdProbe >= clearanceThresholdM) {
          nextNav.fsmState = 'RESUMING_MOVEMENT';
          nextNav.selectedTurnDirection = 'NONE';
          nextNav.stateTimerSec = 0;
          nextNav.statusMessage = 'Obstacle cleared — resuming walk';
        } else {
          // New heading faces an obstacle -> stop forward movement & select safe direction
          nextNav.fsmState = 'OBSTACLE_DETECTED';
          nextNav.bypassObstacleId = scan.nearestForwardObjectId;
          nextNav.initialBypassHeadingDeg = nextPose.yaw;
          nextNav.stateTimerSec = 0;
          nextNav.statusMessage = 'Obstacle detected — checking alternate routes';
        }
      }
      break;
    }

    case 'RESUMING_MOVEMENT': {
      if (scan.nearestForwardM <= stopThresholdM) {
        shouldAnimateGait = false;
        nextNav.fsmState = 'OBSTACLE_DETECTED';
        nextNav.bypassObstacleId = scan.nearestForwardObjectId;
        nextNav.initialBypassHeadingDeg = nextPose.yaw;
        nextNav.stateTimerSec = 0;
        nextNav.statusMessage = 'Obstacle detected — checking alternate routes';
        break;
      }

      // Smooth ramp-in before full MOVING_FORWARD
      const rampSpeed = nav.forwardSpeedMps * 0.75 * dt;
      const moved = tryAdvanceForward(rampSpeed);
      if (!moved) {
        shouldAnimateGait = false;
        nextNav.fsmState = 'OBSTACLE_DETECTED';
        nextNav.initialBypassHeadingDeg = nextPose.yaw;
        nextNav.stateTimerSec = 0;
        nextNav.statusMessage = 'Obstacle detected — checking alternate routes';
        break;
      }

      shouldAnimateGait = true;
      nextNav.selectedTurnDirection = 'NONE';
      nextNav.statusMessage = 'Obstacle cleared — resuming walk';

      if (nextNav.stateTimerSec >= 0.12) {
        nextNav.fsmState = 'MOVING_FORWARD';
        nextNav.stateTimerSec = 0;
        nextNav.statusMessage = `Forward path clear (${scan.nearestForwardM.toFixed(2)}m)`;
      }
      break;
    }

    case 'MOVING_FORWARD': {
      nextNav.selectedTurnDirection = 'NONE';
      if (scan.nearestForwardM <= stopThresholdM) {
        shouldAnimateGait = false;
        nextNav.fsmState = 'OBSTACLE_DETECTED';
        nextNav.bypassObstacleId = scan.nearestForwardObjectId;
        nextNav.initialBypassHeadingDeg = nextPose.yaw;
        nextNav.stateTimerSec = 0;
        nextNav.statusMessage = 'Obstacle detected — checking alternate routes';
      } else {
        const stepDist = nav.forwardSpeedMps * dt;
        const moved = tryAdvanceForward(stepDist);
        if (!moved) {
          shouldAnimateGait = false;
          nextNav.fsmState = 'OBSTACLE_DETECTED';
          nextNav.bypassObstacleId = scan.nearestForwardObjectId;
          nextNav.initialBypassHeadingDeg = nextPose.yaw;
          nextNav.stateTimerSec = 0;
          nextNav.statusMessage = 'Obstacle detected — checking alternate routes';
        } else {
          shouldAnimateGait = true;
          nextNav.statusMessage = `Walking forward — clear (${scan.nearestForwardM.toFixed(2)}m)`;
        }
      }
      break;
    }

    case 'OBSTACLE_DETECTED': {
      shouldAnimateGait = false;
      nextNav.statusMessage = 'Obstacle detected — checking alternate routes';

      // Short confirmation interval prevents false triggers or rapid jitter
      if (nextNav.stateTimerSec >= 0.08) {
        const fwdProbe = evaluateEscapeHeadingClearance(
          nextPose,
          nextPose.yaw,
          channels,
          objects,
          visualGain
        );
        if (scan.nearestForwardM >= resumeThresholdM && fwdProbe >= clearanceThresholdM) {
          nextNav.fsmState = 'RESUMING_MOVEMENT';
          nextNav.stateTimerSec = 0;
          nextNav.statusMessage = 'Obstacle cleared — resuming walk';
        } else {
          nextNav.fsmState = 'CHECKING_PATHS';
          nextNav.stateTimerSec = 0;
          nextNav.statusMessage = 'Obstacle detected — checking alternate routes';
        }
      }
      break;
    }

    case 'CHECKING_PATHS': {
      shouldAnimateGait = false;
      nextNav.statusMessage = 'Obstacle detected — checking alternate routes';

      if (nextNav.stateTimerSec >= 0.08) {
        // First check if front obstacle was moved/removed while checking
        const fwdProbe = evaluateEscapeHeadingClearance(
          nextPose,
          nextPose.yaw,
          channels,
          objects,
          visualGain
        );
        if (scan.nearestForwardM >= resumeThresholdM && fwdProbe >= clearanceThresholdM) {
          nextNav.fsmState = 'RESUMING_MOVEMENT';
          nextNav.selectedTurnDirection = 'NONE';
          nextNav.committedTurn = null;
          nextNav.stateTimerSec = 0;
          nextNav.statusMessage = 'Obstacle cleared — resuming walk';
          break;
        }

        const leftEval = evaluateSideOptions(
          nextPose,
          'LEFT',
          nav.turnAngleDeg,
          clearanceThresholdM,
          stopThresholdM,
          scan.leftClearanceM,
          channels,
          objects,
          visualGain
        );
        const rightEval = evaluateSideOptions(
          nextPose,
          'RIGHT',
          nav.turnAngleDeg,
          clearanceThresholdM,
          stopThresholdM,
          scan.rightClearanceM,
          channels,
          objects,
          visualGain
        );

        if (!leftEval.viable && !rightEval.viable) {
          nextNav.fsmState = 'PATH_BLOCKED';
          nextNav.selectedTurnDirection = 'BLOCKED';
          nextNav.committedTurn = null;
          nextNav.targetYawDeg = null;
          nextNav.stateTimerSec = 0;
          nextNav.statusMessage = 'PATH BLOCKED — WAITING FOR CLEARANCE';
          break;
        }

        // Hysteresis: retain committedTurn if still viable; else choose clear route deterministically
        let pick: 'LEFT' | 'RIGHT';
        let reasonMessage: string;

        if (nextNav.committedTurn === 'LEFT' && leftEval.viable) {
          pick = 'LEFT';
          reasonMessage = rightEval.viable
            ? 'Left clear — turning left'
            : 'Right blocked — turning left';
        } else if (nextNav.committedTurn === 'RIGHT' && rightEval.viable) {
          pick = 'RIGHT';
          reasonMessage = leftEval.viable
            ? 'Right clear — turning right'
            : 'Left blocked — turning right';
        } else if (leftEval.viable && !rightEval.viable) {
          pick = 'LEFT';
          reasonMessage = 'Right blocked — turning left';
        } else if (rightEval.viable && !leftEval.viable) {
          pick = 'RIGHT';
          reasonMessage = 'Left blocked — turning right';
        } else if (rightEval.score - leftEval.score > 0.28) {
          pick = 'RIGHT';
          reasonMessage = 'Wider right corridor — turning right';
        } else {
          // Scenario A step 5: when left path is clear (and comparable to right), turn left
          pick = 'LEFT';
          reasonMessage = 'Left clear — turning left';
        }

        const chosenEval = pick === 'LEFT' ? leftEval : rightEval;
        nextNav.committedTurn = pick;
        nextNav.selectedTurnDirection = pick;
        nextNav.cumulativeTurnDeg = 0;
        nextNav.targetYawDeg = normalizeAngleDeg(nextPose.yaw + chosenEval.bestDeltaDeg);
        nextNav.initialBypassHeadingDeg =
          nextNav.initialBypassHeadingDeg ?? nextPose.yaw;
        nextNav.fsmState = pick === 'LEFT' ? 'TURNING_LEFT' : 'TURNING_RIGHT';
        nextNav.stateTimerSec = 0;
        nextNav.statusMessage = reasonMessage;
      }
      break;
    }

    case 'TURNING_LEFT':
    case 'TURNING_RIGHT': {
      const dirSign = nextNav.fsmState === 'TURNING_LEFT' ? 1 : -1;
      const maxStepYaw = nav.turnRateDegPerSec * dt;
      let dYaw = maxStepYaw;
      if (nextNav.targetYawDeg !== null) {
        const rem = Math.abs(normalizeAngleDeg(nextNav.targetYawDeg - nextPose.yaw));
        dYaw = Math.min(maxStepYaw, Math.max(0.5, rem));
      }
      const candYaw = normalizeAngleDeg(nextPose.yaw + dirSign * dYaw);
      const rotPose: BodyPose = { ...nextPose, yaw: candYaw };

      const rotCol = checkRobotPoseCollision(rotPose, channels, objects, visualGain, 0.016);
      if (rotCol.colliding) {
        // Never keep grinding against a wall if blocked mid-turn
        shouldAnimateGait = false;
        nextNav.fsmState = 'PATH_BLOCKED';
        nextNav.selectedTurnDirection = 'BLOCKED';
        nextNav.stateTimerSec = 0;
        nextNav.statusMessage = 'PATH BLOCKED — WAITING FOR CLEARANCE';
        break;
      }

      nextPose = rotPose;
      nextNav.cumulativeTurnDeg += dYaw;
      shouldAnimateGait = true;

      const postTurnScan = scanNavigationSensors(nextPose, objects, []);
      const forwardProbe = evaluateEscapeHeadingClearance(
        nextPose,
        nextPose.yaw,
        channels,
        objects,
        visualGain
      );

      const targetReached =
        nextNav.targetYawDeg !== null
          ? Math.abs(normalizeAngleDeg(nextNav.targetYawDeg - nextPose.yaw)) <= 3.5
          : nextNav.cumulativeTurnDeg >= Math.max(30, nav.turnAngleDeg * 0.85);

      const bypassEntryClearM = Math.max(clearanceThresholdM, Math.min(stopThresholdM * 1.05, 0.95));

      if (
        targetReached &&
        postTurnScan.nearestForwardM >= bypassEntryClearM &&
        forwardProbe >= clearanceThresholdM
      ) {
        nextNav.fsmState = 'BYPASSING_OBSTACLE';
        nextNav.bypassDistanceTraveledM = 0;
        nextNav.stateTimerSec = 0;
        nextNav.statusMessage = `Bypassing obstacle (${nextNav.selectedTurnDirection})`;
      } else if (targetReached && nextNav.targetYawDeg !== null) {
        // Chosen angle wasn't quite clear yet; allow smooth continuation up to 135°
        nextNav.targetYawDeg = null;
      } else if (nextNav.cumulativeTurnDeg >= 135) {
        shouldAnimateGait = false;
        nextNav.fsmState = 'PATH_BLOCKED';
        nextNav.selectedTurnDirection = 'BLOCKED';
        nextNav.stateTimerSec = 0;
        nextNav.statusMessage = 'PATH BLOCKED — WAITING FOR CLEARANCE';
      }
      break;
    }

    case 'BYPASSING_OBSTACLE': {
      // Continuously recheck current route during bypass manoeuvre
      const bypassStopDistM = Math.min(stopThresholdM, Math.max(0.52, clearanceThresholdM * 0.95));
      if (scan.nearestForwardM <= bypassStopDistM) {
        shouldAnimateGait = false;
        nextNav.fsmState = 'OBSTACLE_DETECTED';
        nextNav.stateTimerSec = 0;
        nextNav.statusMessage = 'Obstacle detected — checking alternate routes';
        break;
      }

      const stepDist = nav.forwardSpeedMps * dt;
      const moved = tryAdvanceForward(stepDist);
      if (!moved) {
        shouldAnimateGait = false;
        nextNav.fsmState = 'OBSTACLE_DETECTED';
        nextNav.stateTimerSec = 0;
        nextNav.statusMessage = 'Obstacle detected — checking alternate routes';
        break;
      }

      shouldAnimateGait = true;
      nextNav.bypassDistanceTraveledM += stepDist;

      // Verify whether KUKUR has actually passed/cleared the tracked obstacle before returning to forward movement
      const initHeading = nextNav.initialBypassHeadingDeg ?? nextPose.yaw;
      const minBypassTravel = Math.max(0.5, clearanceThresholdM * 0.85);

      let clearedTrackedObstacle = true;
      if (nextNav.bypassObstacleId) {
        const obs = objects.find((o) => o.id === nextNav.bypassObstacleId);
        if (obs) {
          const dims = getObstacleLocalDimensions(obs.type);
          const obsRadius = dims.radius * Math.max(obs.scale[0], obs.scale[2]);
          const initRad = THREE.MathUtils.degToRad(initHeading);
          const fwdX = Math.sin(initRad);
          const fwdZ = Math.cos(initRad);
          const relX = nextPose.x - obs.position[0];
          const relZ = nextPose.z - obs.position[2];
          const alongProj = relX * fwdX + relZ * fwdZ;
          const lateralProj = Math.abs(relX * fwdZ - relZ * fwdX);
          clearedTrackedObstacle =
            lateralProj >= obsRadius + 0.24 || alongProj >= obsRadius + 0.12;
        }
      }

      if (nextNav.bypassDistanceTraveledM >= minBypassTravel && clearedTrackedObstacle) {
        // Check if original forward heading is now safe and wide open
        const diffToInit = normalizeAngleDeg(initHeading - nextPose.yaw);
        const scanAtInit = scanNavigationSensors({ ...nextPose, yaw: initHeading }, objects, []);
        const probeAtInit = evaluateEscapeHeadingClearance(
          nextPose,
          initHeading,
          channels,
          objects,
          visualGain
        );

        if (
          scanAtInit.nearestForwardM >= resumeThresholdM * 1.08 &&
          probeAtInit >= Math.max(1.05, clearanceThresholdM * 1.5) &&
          canRotateInPlace(nextPose, diffToInit, channels, objects, visualGain)
        ) {
          // Smoothly steer yaw back onto clear forward heading (no teleport/snap)
          if (Math.abs(diffToInit) <= nav.turnRateDegPerSec * dt + 2.5) {
            nextPose = { ...nextPose, yaw: initHeading };
            nextNav.fsmState = 'RESUMING_MOVEMENT';
            nextNav.selectedTurnDirection = 'NONE';
            nextNav.committedTurn = null;
            nextNav.targetYawDeg = null;
            nextNav.initialBypassHeadingDeg = null;
            nextNav.bypassObstacleId = null;
            nextNav.stateTimerSec = 0;
            nextNav.statusMessage = 'Obstacle cleared — resuming walk';
          } else {
            const steerStep = Math.sign(diffToInit) * nav.turnRateDegPerSec * 0.9 * dt;
            const steeredYaw = normalizeAngleDeg(nextPose.yaw + steerStep);
            if (
              !checkRobotPoseCollision(
                { ...nextPose, yaw: steeredYaw },
                channels,
                objects,
                visualGain,
                0.018
              ).colliding
            ) {
              nextPose = { ...nextPose, yaw: steeredYaw };
              nextNav.statusMessage = 'Obstacle passed — aligning forward heading';
            }
          }
          break;
        }

        // If original heading remains sealed (e.g. L-junction wall), resume forward movement along the new open corridor
        const currentCorridorDist = Math.max(0.85, nav.safetyDistanceM * 1.15);
        if (
          nextNav.bypassDistanceTraveledM >= currentCorridorDist &&
          scan.nearestForwardM >= resumeThresholdM
        ) {
          nextNav.fsmState = 'RESUMING_MOVEMENT';
          nextNav.selectedTurnDirection = 'NONE';
          nextNav.committedTurn = null;
          nextNav.targetYawDeg = null;
          nextNav.initialBypassHeadingDeg = null;
          nextNav.bypassObstacleId = null;
          nextNav.stateTimerSec = 0;
          nextNav.statusMessage = 'Obstacle cleared — resuming walk';
        }
      }
      break;
    }

    case 'PATH_BLOCKED':
    case 'WAITING_FOR_CLEARANCE': {
      shouldAnimateGait = false;
      nextNav.selectedTurnDirection = 'BLOCKED';

      if (nextNav.fsmState === 'PATH_BLOCKED' && nextNav.stateTimerSec >= 0.14) {
        nextNav.fsmState = 'WAITING_FOR_CLEARANCE';
        nextNav.stateTimerSec = 0;
      }

      nextNav.statusMessage =
        nextNav.fsmState === 'PATH_BLOCKED'
          ? 'PATH BLOCKED — WAITING FOR CLEARANCE'
          : 'Both routes blocked — waiting (PATH BLOCKED — WAITING FOR CLEARANCE)';

      // Continuously recheck front, left, and right paths without turning into walls
      const overlapNow = checkRobotPoseCollision(
        nextPose,
        channels,
        objects,
        visualGain,
        0.008
      ).colliding;
      if (overlapNow) {
        break;
      }

      const fwdProbe = evaluateEscapeHeadingClearance(
        nextPose,
        nextPose.yaw,
        channels,
        objects,
        visualGain
      );
      if (scan.nearestForwardM >= resumeThresholdM && fwdProbe >= clearanceThresholdM) {
        // Scenario C: front obstacle removed or moved away -> automatically resume walking!
        nextNav.fsmState = 'RESUMING_MOVEMENT';
        nextNav.selectedTurnDirection = 'NONE';
        nextNav.committedTurn = null;
        nextNav.targetYawDeg = null;
        nextNav.initialBypassHeadingDeg = null;
        nextNav.bypassObstacleId = null;
        nextNav.stateTimerSec = 0;
        nextNav.statusMessage = 'Obstacle cleared — resuming walk';
        break;
      }

      // Check if either left or right route was opened (Scenario B step 5 / Test 4)
      const leftCheck = evaluateSideOptions(
        nextPose,
        'LEFT',
        nav.turnAngleDeg,
        clearanceThresholdM,
        stopThresholdM,
        scan.leftClearanceM,
        channels,
        objects,
        visualGain
      );
      const rightCheck = evaluateSideOptions(
        nextPose,
        'RIGHT',
        nav.turnAngleDeg,
        clearanceThresholdM,
        stopThresholdM,
        scan.rightClearanceM,
        channels,
        objects,
        visualGain
      );

      if (leftCheck.viable || rightCheck.viable) {
        nextNav.fsmState = 'CHECKING_PATHS';
        nextNav.stateTimerSec = 0.08; // Ready to select newly opened route immediately
        nextNav.statusMessage = 'Obstacle detected — checking alternate routes';
      }
      break;
    }
  }

  nextNav.activityState = deriveActivityState(
    nextNav.enabled,
    nextNav.fsmState,
    shouldAnimateGait
  );
  nextNav.lastCommandedPose = { ...nextPose };

  return {
    nextNav,
    nextBodyPose: nextPose,
    shouldAnimateGait,
    scan,
  };
}
