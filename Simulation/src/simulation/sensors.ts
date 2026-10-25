import * as THREE from 'three';
import {
  BodyPose,
  LabSceneObject,
  SensorTelemetry,
  SimulatedDetection,
} from '../types/simulator';

const _vCenter = new THREE.Vector3();
const _vCorner = new THREE.Vector3();
const _vCamPos = new THREE.Vector3();
const _vCamDir = new THREE.Vector3();
const _vToObj = new THREE.Vector3();
const _raycaster = new THREE.Raycaster();
const _ultraOrigin = new THREE.Vector3();
const _ultraDir = new THREE.Vector3();
const _chassisQuat = new THREE.Quaternion();
const _chassisEuler = new THREE.Euler();

function getObjectLocalBounds(type: LabSceneObject['type']): {
  minY: number;
  maxY: number;
  halfX: number;
  halfZ: number;
  classLabel: string;
} {
  switch (type) {
    case 'human':
      return { minY: 0, maxY: 1.72, halfX: 0.24, halfZ: 0.18, classLabel: 'person' };
    case 'box':
      return { minY: 0, maxY: 0.36, halfX: 0.2, halfZ: 0.2, classLabel: 'box_obstacle' };
    case 'cylinder':
      return { minY: 0, maxY: 0.56, halfX: 0.2, halfZ: 0.2, classLabel: 'cylinder' };
    case 'wall':
      return { minY: 0, maxY: 0.65, halfX: 0.8, halfZ: 0.08, classLabel: 'barrier_wall' };
    case 'ramp':
      return { minY: 0, maxY: 0.24, halfX: 0.37, halfZ: 0.45, classLabel: 'incline_ramp' };
    case 'rough-terrain':
      return { minY: 0, maxY: 0.08, halfX: 0.48, halfZ: 0.48, classLabel: 'rough_terrain' };
  }
}

/**
 * Project 3D virtual lab objects through the robot's virtual PerspectiveCamera
 * to produce accurate simulated 2D bounding boxes, class labels, confidence scores,
 * and simulated RGB-D distances.
 */
export function computeVirtualDetections(
  robotCamera: THREE.PerspectiveCamera,
  objects: LabSceneObject[]
): SimulatedDetection[] {
  robotCamera.updateMatrixWorld(true);
  robotCamera.getWorldPosition(_vCamPos);
  robotCamera.getWorldDirection(_vCamDir);

  const detections: SimulatedDetection[] = [];

  for (const obj of objects) {
    const bounds = getObjectLocalBounds(obj.type);
    const sx = obj.scale[0];
    const sy = obj.scale[1];
    const sz = obj.scale[2];

    const centerY = obj.position[1] + (bounds.minY + bounds.maxY) * 0.5 * sy;
    _vCenter.set(obj.position[0], centerY, obj.position[2]);

    _vToObj.subVectors(_vCenter, _vCamPos);
    const centerDistance = _vToObj.length();
    if (centerDistance < 0.05 || centerDistance > 9.5) continue;

    // Project 8 corners + 4 midpoints of object's oriented bounding box into camera NDC [-1, 1]
    // (including midpoints ensures wide walls spanning across the camera view are accurately detected!)
    const rotRad = (obj.rotation[1] * Math.PI) / 180;
    const cosY = Math.cos(rotRad);
    const sinY = Math.sin(rotRad);

    let minNdcX = Infinity;
    let maxNdcX = -Infinity;
    let minNdcY = Infinity;
    let maxNdcY = -Infinity;
    let minPointDist = Infinity;
    let validSamples = 0;

    const hx = bounds.halfX * sx;
    const hz = bounds.halfZ * sz;
    const y0 = obj.position[1] + bounds.minY * sy;
    const y1 = obj.position[1] + bounds.maxY * sy;

    const xs = [-hx, 0, hx];
    const ys = [y0, (y0 + y1) * 0.5, y1];
    const zs = [-hz, hz];

    for (let xi = 0; xi < xs.length; xi++) {
      for (let yi = 0; yi < ys.length; yi++) {
        for (let zi = 0; zi < zs.length; zi++) {
          const lx = xs[xi];
          const lz = zs[zi];
          const wx = obj.position[0] + lx * cosY + lz * sinY;
          const wz = obj.position[2] - lx * sinY + lz * cosY;

          _vCorner.set(wx, ys[yi], wz);
          _vToObj.subVectors(_vCorner, _vCamPos);
          const ptDist = _vToObj.length();
          if (_vToObj.dot(_vCamDir) <= 0.05) continue;

          if (ptDist < minPointDist) minPointDist = ptDist;
          _vCorner.project(robotCamera);
          validSamples++;
          if (_vCorner.x < minNdcX) minNdcX = _vCorner.x;
          if (_vCorner.x > maxNdcX) maxNdcX = _vCorner.x;
          if (_vCorner.y < minNdcY) minNdcY = _vCorner.y;
          if (_vCorner.y > maxNdcY) maxNdcY = _vCorner.y;
        }
      }
    }

    if (validSamples < 2) continue;
    if (maxNdcX < -0.98 || minNdcX > 0.98 || maxNdcY < -0.98 || minNdcY > 0.98) {
      continue;
    }

    const xLeft = THREE.MathUtils.clamp((minNdcX + 1) * 0.5, 0.01, 0.98);
    const xRight = THREE.MathUtils.clamp((maxNdcX + 1) * 0.5, 0.02, 0.99);
    const yTop = THREE.MathUtils.clamp((1 - maxNdcY) * 0.5, 0.01, 0.98);
    const yBottom = THREE.MathUtils.clamp((1 - minNdcY) * 0.5, 0.02, 0.99);

    const width = xRight - xLeft;
    const height = yBottom - yTop;
    if (width < 0.03 || height < 0.03) continue;

    const effectiveDist = Math.min(centerDistance, minPointDist);
    const centerBias =
      1 - Math.min(1, Math.hypot((minNdcX + maxNdcX) * 0.5, (minNdcY + maxNdcY) * 0.5));
    const distFactor = THREE.MathUtils.clamp(1 - effectiveDist / 8.5, 0.35, 0.99);
    const baseConf = obj.type === 'human' ? 0.94 : 0.89;
    const confidence = Math.min(
      0.99,
      Math.max(0.52, baseConf * 0.72 + distFactor * 0.18 + centerBias * 0.1)
    );

    detections.push({
      id: `det-${obj.id}`,
      objectId: obj.id,
      label: bounds.classLabel,
      confidence: Math.round(confidence * 100) / 100,
      distanceMeters: Math.round(effectiveDist * 100) / 100,
      bbox: {
        x: xLeft,
        y: yTop,
        width,
        height,
      },
      source: 'SIMULATED_3D',
    });
  }

  detections.sort((a, b) => a.distanceMeters - b.distanceMeters);
  return detections;
}

/**
 * Compute simulated HC-SR04 ultrasonic distance (cm) using Three.js Raycaster
 * from the front ultrasonic transducer on the chassis.
 */
export function computeSimulatedUltrasonicCm(
  chassisObject: THREE.Object3D,
  obstacleMeshes: THREE.Object3D[]
): number {
  chassisObject.updateMatrixWorld(true);
  _ultraOrigin.set(0, -0.015, 0.27);
  chassisObject.localToWorld(_ultraOrigin);

  _ultraDir.set(0, 0, 1).transformDirection(chassisObject.matrixWorld).normalize();
  _raycaster.set(_ultraOrigin, _ultraDir);
  _raycaster.near = 0.02;
  _raycaster.far = 4.0;

  const hits = _raycaster.intersectObjects(obstacleMeshes, true);
  if (hits.length > 0) {
    return Math.round(hits[0].distance * 1000) / 10;
  }
  return 400.0;
}

/**
 * Compute simulated MPU6050 Accelerometer (g) and Gyroscope (deg/s) from chassis pose & angular rates
 */
export function computeSimulatedImu(
  pose: BodyPose,
  prevPose: BodyPose,
  dt: number,
  isMoving: boolean,
  noiseAmplitude: number
): Pick<SensorTelemetry, 'accel' | 'gyro'> {
  const safeDt = Math.max(dt, 0.008);
  _chassisEuler.set(
    THREE.MathUtils.degToRad(pose.pitch),
    THREE.MathUtils.degToRad(pose.yaw),
    THREE.MathUtils.degToRad(pose.roll),
    'YXZ'
  );
  _chassisQuat.setFromEuler(_chassisEuler).invert();

  const gBody = new THREE.Vector3(0, 1, 0).applyQuaternion(_chassisQuat);
  const vib = isMoving ? 0.04 : 0.0;
  const jitter = () => (Math.random() - 0.5) * 2 * (noiseAmplitude + vib);

  const ax = Math.round((gBody.x + jitter()) * 1000) / 1000;
  const ay = Math.round((gBody.y + jitter()) * 1000) / 1000;
  const az = Math.round((gBody.z + jitter()) * 1000) / 1000;

  const gx =
    Math.round(((pose.pitch - prevPose.pitch) / safeDt + jitter() * 8) * 10) / 10;
  const gy = Math.round(((pose.yaw - prevPose.yaw) / safeDt + jitter() * 8) * 10) / 10;
  const gz = Math.round(((pose.roll - prevPose.roll) / safeDt + jitter() * 8) * 10) / 10;

  return {
    accel: [ax, ay, az],
    gyro: [gx, gy, gz],
  };
}
