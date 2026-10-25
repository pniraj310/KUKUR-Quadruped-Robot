import * as THREE from 'three';
import {
  BodyPose,
  LabSceneObject,
  LegId,
  ServoChannel,
} from '../types/simulator';
import { LEG_CHANNELS_MAP } from './initialState';

export const ROBOT_SOLID_DIMS = {
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

export interface SolidObstacleDimensions {
  isSolid: boolean;
  kind: 'obb' | 'cylinder';
  halfX: number; // Unscaled local half-width
  heightY: number; // Unscaled local height from y=0
  halfZ: number; // Unscaled local half-depth
  radius: number; // Unscaled cylinder radius (when kind === 'cylinder')
}

/**
 * Exact unscaled geometry bounds matching `createLabObjectGroup` in `buildLabObjects.ts`.
 * Decorative floor markings are never in `labObjects`, and low walkable surface pads
 * (`rough-terrain`) are non-blocking floor surfaces (`isSolid: false`) unless elevated.
 */
export function getObstacleLocalDimensions(
  type: LabSceneObject['type']
): SolidObstacleDimensions {
  switch (type) {
    case 'wall':
      // Industrial barrier wall: 1.60m wide (X) x 0.65m tall (Y) x 0.16m thick (Z)
      return {
        isSolid: true,
        kind: 'obb',
        halfX: 0.8,
        heightY: 0.65,
        halfZ: 0.08,
        radius: 0.8,
      };
    case 'box':
      // Calibration crate: 0.40m x 0.36m x 0.40m
      return {
        isSolid: true,
        kind: 'obb',
        halfX: 0.2,
        heightY: 0.36,
        halfZ: 0.2,
        radius: 0.28,
      };
    case 'cylinder':
      // Pillar obstacle: radius 0.20m (base flange), height 0.56m
      return {
        isSolid: true,
        kind: 'cylinder',
        halfX: 0.2,
        heightY: 0.56,
        halfZ: 0.2,
        radius: 0.2,
      };
    case 'human':
      // Lab operator standing figure: 0.44m shoulder span x 1.72m tall x 0.28m depth
      return {
        isSolid: true,
        kind: 'obb',
        halfX: 0.22,
        heightY: 1.72,
        halfZ: 0.15,
        radius: 0.26,
      };
    case 'ramp':
      // Solid test ramp block: 0.74m wide x 0.24m high x 0.90m long
      return {
        isSolid: true,
        kind: 'obb',
        halfX: 0.37,
        heightY: 0.24,
        halfZ: 0.45,
        radius: 0.58,
      };
    case 'rough-terrain':
      // Walkable cobble test pad on ground (not a solid blocking wall)
      return {
        isSolid: false,
        kind: 'obb',
        halfX: 0.48,
        heightY: 0.06,
        halfZ: 0.48,
        radius: 0.48,
      };
  }
}

export interface RobotColliderSphere {
  part: string;
  center: THREE.Vector3;
  radius: number;
}

const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();
const _invQuat = new THREE.Quaternion();
const _matRoot = new THREE.Matrix4();
const _vecLocal = new THREE.Vector3();

function jointRad(ch: ServoChannel, visualGain: number): number {
  const delta = (ch.currentSimulatedAngle - 95) * visualGain;
  const sign =
    ch.role === 'abduction' ? (ch.leg === 'FL' || ch.leg === 'BL' ? 1 : -1) : -1;
  return ((ch.mechanicalOffsetDeg + delta * sign) * Math.PI) / 180;
}

/**
 * Compute world-space collision spheres covering KUKUR's entire central body,
 * shoulders, upper legs, knees, lower legs, and feet using the exact same
 * world coordinates and parent-child kinematics as the 3D rendered model.
 */
export function computeRobotWorldColliders(
  bodyPose: BodyPose,
  channels: ServoChannel[],
  visualGain: number = 1.0
): RobotColliderSphere[] {
  const spheres: RobotColliderSphere[] = [];

  _euler.set(
    THREE.MathUtils.degToRad(bodyPose.pitch),
    THREE.MathUtils.degToRad(bodyPose.yaw),
    THREE.MathUtils.degToRad(bodyPose.roll),
    'YXZ'
  );
  _quat.setFromEuler(_euler);
  _matRoot.compose(
    new THREE.Vector3(bodyPose.x, bodyPose.y, bodyPose.z),
    _quat,
    new THREE.Vector3(1, 1, 1)
  );

  // 1. Central Chassis Bounding Spheres (nose, front-left/right, center, rear-left/right, tail)
  const chassisLocalSamples: Array<[string, number, number, number, number]> = [
    ['chassis-nose', 0, 0.0, 0.25, 0.095],
    ['chassis-fl', 0.08, 0.0, 0.16, 0.085],
    ['chassis-fr', -0.08, 0.0, 0.16, 0.085],
    ['chassis-mid', 0, 0.0, 0.0, 0.105],
    ['chassis-bl', 0.08, 0.0, -0.16, 0.085],
    ['chassis-br', -0.08, 0.0, -0.16, 0.085],
    ['chassis-tail', 0, 0.0, -0.24, 0.09],
  ];

  for (const [name, lx, ly, lz, r] of chassisLocalSamples) {
    const worldPt = new THREE.Vector3(lx, ly, lz).applyMatrix4(_matRoot);
    spheres.push({ part: name, center: worldPt, radius: r });
  }

  // 2. Four Articulated Legs (Shoulder, Mid-Upper-Leg, Knee, Mid-Lower-Leg, Foot)
  const legDefs: Array<{ id: LegId; signX: number; signZ: number }> = [
    { id: 'FL', signX: 1, signZ: 1 },
    { id: 'FR', signX: -1, signZ: 1 },
    { id: 'BL', signX: 1, signZ: -1 },
    { id: 'BR', signX: -1, signZ: -1 },
  ];

  const mSocket = new THREE.Matrix4();
  const mAbd = new THREE.Matrix4();
  const mHipOffset = new THREE.Matrix4();
  const mHipRot = new THREE.Matrix4();
  const mKneeOffset = new THREE.Matrix4();
  const mKneeRot = new THREE.Matrix4();

  for (const leg of legDefs) {
    const [abdIdx, hipIdx, kneeIdx] = LEG_CHANNELS_MAP[leg.id];
    const abdAng = jointRad(channels[abdIdx], visualGain);
    const hipAng = jointRad(channels[hipIdx], visualGain);
    const kneeAng = jointRad(channels[kneeIdx], visualGain);

    mSocket
      .makeTranslation(
        leg.signX * ROBOT_SOLID_DIMS.hipOffsetX,
        0.002,
        leg.signZ * ROBOT_SOLID_DIMS.hipOffsetZ
      )
      .premultiply(_matRoot);

    mAbd.makeRotationZ(abdAng).premultiply(mSocket);
    mHipOffset
      .makeTranslation(leg.signX * ROBOT_SOLID_DIMS.shoulderOutsetX, 0, 0)
      .premultiply(mAbd);
    mHipRot.makeRotationX(hipAng).premultiply(mHipOffset);

    // Hip joint sphere
    spheres.push({
      part: `${leg.id}-hip`,
      center: new THREE.Vector3(0, 0, 0).applyMatrix4(mHipRot),
      radius: 0.034,
    });

    // Mid-Upper-Leg sphere
    spheres.push({
      part: `${leg.id}-upper`,
      center: new THREE.Vector3(0, -ROBOT_SOLID_DIMS.upperLegLength * 0.5, 0).applyMatrix4(
        mHipRot
      ),
      radius: 0.03,
    });

    mKneeOffset
      .makeTranslation(0, -ROBOT_SOLID_DIMS.upperLegLength, 0)
      .premultiply(mHipRot);
    mKneeRot.makeRotationX(kneeAng).premultiply(mKneeOffset);

    // Knee joint sphere
    spheres.push({
      part: `${leg.id}-knee`,
      center: new THREE.Vector3(0, 0, 0).applyMatrix4(mKneeRot),
      radius: 0.03,
    });

    // Mid-Lower-Leg sphere
    spheres.push({
      part: `${leg.id}-lower`,
      center: new THREE.Vector3(0, -ROBOT_SOLID_DIMS.lowerLegLength * 0.5, 0).applyMatrix4(
        mKneeRot
      ),
      radius: 0.024,
    });

    // Foot sphere
    spheres.push({
      part: `${leg.id}-foot`,
      center: new THREE.Vector3(0, -ROBOT_SOLID_DIMS.lowerLegLength, 0).applyMatrix4(
        mKneeRot
      ),
      radius: ROBOT_SOLID_DIMS.footRadius,
    });
  }

  return spheres;
}

/**
 * Signed/unsigned clearance distance (meters) from a world-space sphere `(center, radius)`
 * to a solid `LabSceneObject` using its exact world `position`, `rotation`, and `scale`.
 * Returns `< 0` when penetrating/colliding!
 */
export function sphereToObstacleSignedDistance(
  sphereCenter: THREE.Vector3,
  sphereRadius: number,
  obj: LabSceneObject
): number {
  const dims = getObstacleLocalDimensions(obj.type);
  if (!dims.isSolid) return Infinity;

  // Transform world sphere center into obstacle's unrotated local frame (scaled in meters)
  _euler.set(
    THREE.MathUtils.degToRad(obj.rotation[0]),
    THREE.MathUtils.degToRad(obj.rotation[1]),
    THREE.MathUtils.degToRad(obj.rotation[2]),
    'XYZ'
  );
  _invQuat.setFromEuler(_euler).invert();

  _vecLocal
    .set(
      sphereCenter.x - obj.position[0],
      sphereCenter.y - obj.position[1],
      sphereCenter.z - obj.position[2]
    )
    .applyQuaternion(_invQuat);

  const sx = Math.max(0.05, obj.scale[0]);
  const sy = Math.max(0.05, obj.scale[1]);
  const sz = Math.max(0.05, obj.scale[2]);

  const maxY = dims.heightY * sy;

  if (dims.kind === 'cylinder') {
    const radXZ = dims.radius * Math.max(sx, sz);
    const distXZ = Math.hypot(_vecLocal.x, _vecLocal.z);
    const dRadial = Math.max(0, distXZ - radXZ);
    const dY =
      _vecLocal.y < 0 ? -_vecLocal.y : _vecLocal.y > maxY ? _vecLocal.y - maxY : 0;

    if (dRadial === 0 && dY === 0) {
      // Sphere center is inside cylinder
      const insidePen = Math.min(radXZ - distXZ, _vecLocal.y, maxY - _vecLocal.y);
      return -insidePen - sphereRadius;
    }
    return Math.hypot(dRadial, dY) - sphereRadius;
  }

  // Oriented Bounding Box (x in [-hx, hx], y in [0, maxY], z in [-hz, hz])
  const hx = dims.halfX * sx;
  const hz = dims.halfZ * sz;

  const dx = Math.max(0, Math.abs(_vecLocal.x) - hx);
  const dy =
    _vecLocal.y < 0 ? -_vecLocal.y : _vecLocal.y > maxY ? _vecLocal.y - maxY : 0;
  const dz = Math.max(0, Math.abs(_vecLocal.z) - hz);

  if (dx === 0 && dy === 0 && dz === 0) {
    // Sphere center is inside box
    const insidePen = Math.min(
      hx - Math.abs(_vecLocal.x),
      hz - Math.abs(_vecLocal.z),
      _vecLocal.y,
      maxY - _vecLocal.y
    );
    return -insidePen - sphereRadius;
  }

  return Math.hypot(dx, dy, dz) - sphereRadius;
}

export interface PoseCollisionResult {
  colliding: boolean;
  collidingObjectIds: string[];
  minClearanceM: number;
}

/**
 * Evaluate whether KUKUR's body, legs, or feet collide with (or breach `paddingM` of)
 * any solid obstacle in the lab scene.
 */
export function checkRobotPoseCollision(
  bodyPose: BodyPose,
  channels: ServoChannel[],
  objects: LabSceneObject[],
  visualGain: number = 1.0,
  paddingM: number = 0.012
): PoseCollisionResult {
  const colliders = computeRobotWorldColliders(bodyPose, channels, visualGain);
  const collidingSet = new Set<string>();
  let minClearanceM = Infinity;

  for (const obj of objects) {
    const dims = getObstacleLocalDimensions(obj.type);
    if (!dims.isSolid) continue;

    // Fast broadphase XZ check
    const maxScale = Math.max(obj.scale[0], obj.scale[2]);
    const broadRadius = dims.radius * maxScale + 0.65;
    const bdx = bodyPose.x - obj.position[0];
    const bdz = bodyPose.z - obj.position[2];
    if (bdx * bdx + bdz * bdz > broadRadius * broadRadius) continue;

    for (const sph of colliders) {
      const dist = sphereToObstacleSignedDistance(sph.center, sph.radius, obj);
      if (dist < minClearanceM) minClearanceM = dist;
      if (dist < paddingM) {
        collidingSet.add(obj.id);
      }
    }
  }

  return {
    colliding: collidingSet.size > 0,
    collidingObjectIds: Array.from(collidingSet),
    minClearanceM,
  };
}

export interface RayObstacleHit {
  distanceM: number;
  point: THREE.Vector3;
  objectId: string;
}

const _rayLocalOrigin = new THREE.Vector3();
const _rayLocalDir = new THREE.Vector3();

/**
 * Exact world-space raycast against all solid obstacles (Walls, Boxes, Cylinders, Humans, Ramps)
 * using the exact same world coordinates, rotations, and scales as 3D rendering.
 * Decorative floor markings and non-solid pads are ignored.
 */
export function raycastSolidObstacles(
  worldOrigin: THREE.Vector3,
  worldDirNormalized: THREE.Vector3,
  maxRangeM: number,
  objects: LabSceneObject[]
): RayObstacleHit | null {
  let closestDist = maxRangeM;
  let closestObjId: string | null = null;

  for (const obj of objects) {
    const dims = getObstacleLocalDimensions(obj.type);
    if (!dims.isSolid) continue;

    _euler.set(
      THREE.MathUtils.degToRad(obj.rotation[0]),
      THREE.MathUtils.degToRad(obj.rotation[1]),
      THREE.MathUtils.degToRad(obj.rotation[2]),
      'XYZ'
    );
    _invQuat.setFromEuler(_euler).invert();

    _rayLocalOrigin
      .set(
        worldOrigin.x - obj.position[0],
        worldOrigin.y - obj.position[1],
        worldOrigin.z - obj.position[2]
      )
      .applyQuaternion(_invQuat);

    _rayLocalDir.copy(worldDirNormalized).applyQuaternion(_invQuat).normalize();

    const sx = Math.max(0.05, obj.scale[0]);
    const sy = Math.max(0.05, obj.scale[1]);
    const sz = Math.max(0.05, obj.scale[2]);
    const maxY = dims.heightY * sy;

    if (dims.kind === 'cylinder') {
      const r = dims.radius * Math.max(sx, sz);
      const ox = _rayLocalOrigin.x;
      const oz = _rayLocalOrigin.z;
      const dx = _rayLocalDir.x;
      const dz = _rayLocalDir.z;

      const a = dx * dx + dz * dz;
      if (a > 1e-8) {
        const b = 2 * (ox * dx + oz * dz);
        const c = ox * ox + oz * oz - r * r;
        const disc = b * b - 4 * a * c;
        if (disc >= 0) {
          const sqrtD = Math.sqrt(disc);
          const candidates = [(-b - sqrtD) / (2 * a), (-b + sqrtD) / (2 * a)];
          for (const t of candidates) {
            if (t >= 0.01 && t < closestDist) {
              const hitY = _rayLocalOrigin.y + _rayLocalDir.y * t;
              if (hitY >= 0 && hitY <= maxY) {
                closestDist = t;
                closestObjId = obj.id;
                break;
              }
            }
          }
        }
      }
    } else {
      // Ray-AABB slab intersection in obstacle local space
      const hx = dims.halfX * sx;
      const hz = dims.halfZ * sz;
      const minB = [-hx, 0, -hz];
      const maxB = [hx, maxY, hz];
      const orig = [_rayLocalOrigin.x, _rayLocalOrigin.y, _rayLocalOrigin.z];
      const dir = [_rayLocalDir.x, _rayLocalDir.y, _rayLocalDir.z];

      let tMin = 0.01;
      let tMax = closestDist;
      let valid = true;

      for (let axis = 0; axis < 3; axis++) {
        if (Math.abs(dir[axis]) < 1e-8) {
          if (orig[axis] < minB[axis] || orig[axis] > maxB[axis]) {
            valid = false;
            break;
          }
        } else {
          const invD = 1 / dir[axis];
          let t1 = (minB[axis] - orig[axis]) * invD;
          let t2 = (maxB[axis] - orig[axis]) * invD;
          if (t1 > t2) {
            const tmp = t1;
            t1 = t2;
            t2 = tmp;
          }
          tMin = Math.max(tMin, t1);
          tMax = Math.min(tMax, t2);
          if (tMin > tMax) {
            valid = false;
            break;
          }
        }
      }

      if (valid && tMin < closestDist) {
        closestDist = tMin;
        closestObjId = obj.id;
      }
    }
  }

  if (!closestObjId) return null;

  return {
    distanceM: Math.round(closestDist * 1000) / 1000,
    point: worldOrigin.clone().addScaledVector(worldDirNormalized, closestDist),
    objectId: closestObjId,
  };
}
