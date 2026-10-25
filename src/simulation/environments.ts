import * as THREE from 'three';
import { DetectedObject, EnvironmentType, SceneItem, Vector3D } from '../types/robot';
import { Obstacle3D } from './sensors';

export interface EnvironmentScene {
  group: THREE.Group;
  obstacles: Obstacle3D[];
  sceneItems: SceneItem[];
  itemMeshes: Map<string, THREE.Group>;
  groundHeightAt: (x: number, z: number) => number;
  updateAnimation: (delta: number) => void;
  addItem: (item: SceneItem) => void;
  removeItem: (id: string) => void;
  updateItemPos: (id: string, pos: Vector3D) => void;
  detectObjectsInCamera: (
    camera: THREE.PerspectiveCamera,
    robotPos: THREE.Vector3,
    robotHeadingRad: number
  ) => DetectedObject[];
  dispose: () => void;
}

/**
 * Procedural Grid Floor Texture
 */
function createGridFloorTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#0d1017';
  ctx.fillRect(0, 0, 512, 512);

  // Sub-grid lines (0.1m)
  ctx.strokeStyle = '#1a2233';
  ctx.lineWidth = 1;
  const step = 512 / 10;
  for (let i = 0; i <= 512; i += step) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 512);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(512, i);
    ctx.stroke();
  }

  // Major metric lines (1.0m)
  ctx.strokeStyle = '#38bdf8';
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 2.5;
  ctx.strokeRect(0, 0, 512, 512);
  ctx.globalAlpha = 1.0;

  // Center cross hair marker
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(246, 256);
  ctx.lineTo(266, 256);
  ctx.moveTo(256, 246);
  ctx.lineTo(256, 266);
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(20, 20);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Procedural 3D Person Model (Stylized Mannequin with animatable limbs)
 */
function createPersonMesh(): { group: THREE.Group; animateWalk: (phase: number) => void } {
  const group = new THREE.Group();
  group.name = 'Person_Mannequin';

  const skinMat = new THREE.MeshStandardMaterial({ color: 0xfbbf24, roughness: 0.6 });
  const shirtMat = new THREE.MeshStandardMaterial({ color: 0x2563eb, roughness: 0.5 }); // Blue polo
  const pantsMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.7 }); // Slate pants
  const shoeMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.8 });

  // Head (height ~1.75m total)
  const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 16), skinMat);
  headMesh.position.y = 1.62;
  headMesh.castShadow = true;
  group.add(headMesh);

  // Hair / Cap
  const capMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.125, 0.05, 16), shirtMat);
  capMesh.position.y = 1.72;
  group.add(capMesh);

  // Torso / Shirt
  const torsoMesh = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.52, 0.2), shirtMat);
  torsoMesh.position.y = 1.25;
  torsoMesh.castShadow = true;
  group.add(torsoMesh);

  // Left & Right Arm Pivots
  const leftArmPivot = new THREE.Group();
  leftArmPivot.position.set(-0.24, 1.45, 0);
  group.add(leftArmPivot);
  const leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.45, 0.1), shirtMat);
  leftArm.position.y = -0.22;
  leftArm.castShadow = true;
  leftArmPivot.add(leftArm);

  const rightArmPivot = new THREE.Group();
  rightArmPivot.position.set(0.24, 1.45, 0);
  group.add(rightArmPivot);
  const rightArm = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.45, 0.1), shirtMat);
  rightArm.position.y = -0.22;
  rightArm.castShadow = true;
  rightArmPivot.add(rightArm);

  // Left & Right Leg Pivots
  const leftLegPivot = new THREE.Group();
  leftLegPivot.position.set(-0.11, 0.98, 0);
  group.add(leftLegPivot);
  const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.9, 0.15), pantsMat);
  leftLeg.position.y = -0.45;
  leftLeg.castShadow = true;
  leftLegPivot.add(leftLeg);

  const leftShoe = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.08, 0.22), shoeMat);
  leftShoe.position.set(0, -0.92, 0.04);
  leftLegPivot.add(leftShoe);

  const rightLegPivot = new THREE.Group();
  rightLegPivot.position.set(0.11, 0.98, 0);
  group.add(rightLegPivot);
  const rightLeg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.9, 0.15), pantsMat);
  rightLeg.position.y = -0.45;
  rightLeg.castShadow = true;
  rightLegPivot.add(rightLeg);

  const rightShoe = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.08, 0.22), shoeMat);
  rightShoe.position.set(0, -0.92, 0.04);
  rightLegPivot.add(rightShoe);

  const animateWalk = (phase: number) => {
    const swing = Math.sin(phase * Math.PI * 2) * 0.45;
    leftLegPivot.rotation.x = swing;
    rightLegPivot.rotation.x = -swing;
    leftArmPivot.rotation.x = -swing;
    rightArmPivot.rotation.x = swing;
  };

  return { group, animateWalk };
}

/**
 * Procedural 3D Chair Model
 */
function createChairMesh(): THREE.Group {
  const chair = new THREE.Group();
  chair.name = 'Chair';

  const woodMat = new THREE.MeshStandardMaterial({ color: 0xb45309, roughness: 0.6 });
  const cushionMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.8 });

  // Seat
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.06, 0.48), cushionMat);
  seat.position.y = 0.45;
  seat.castShadow = true;
  chair.add(seat);

  // Backrest
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.45, 0.05), woodMat);
  back.position.set(0, 0.72, -0.22);
  back.castShadow = true;
  chair.add(back);

  // 4 Legs
  const legPositions = [
    [-0.2, 0.22, -0.2],
    [0.2, 0.22, -0.2],
    [-0.2, 0.22, 0.2],
    [0.2, 0.22, 0.2],
  ];
  legPositions.forEach(([x, y, z]) => {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.015, 0.44, 12), woodMat);
    leg.position.set(x, y, z);
    leg.castShadow = true;
    chair.add(leg);
  });

  return chair;
}

/**
 * Procedural 3D Wooden Crate / Box Model
 */
function createBoxMesh(): THREE.Group {
  const box = new THREE.Group();
  box.name = 'Crate';
  const crateMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.75, metalness: 0.05 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), crateMat);
  mesh.position.y = 0.25;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  box.add(mesh);

  // Corner brackets
  const bracketMat = new THREE.MeshStandardMaterial({ color: 0x1f2937, metalness: 0.8 });
  const trim = new THREE.Mesh(new THREE.BoxGeometry(0.51, 0.04, 0.51), bracketMat);
  trim.position.y = 0.25;
  box.add(trim);

  return box;
}

/**
 * Procedural 3D Traffic Pylon Cone
 */
function createPylonMesh(): THREE.Group {
  const pylon = new THREE.Group();
  pylon.name = 'Traffic_Pylon';

  const orangeMat = new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.4 });
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });

  // Base plate
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.03, 0.3), orangeMat);
  base.position.y = 0.015;
  base.castShadow = true;
  pylon.add(base);

  // Cone
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.45, 16), orangeMat);
  cone.position.y = 0.24;
  cone.castShadow = true;
  pylon.add(cone);

  // Reflective white collar
  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.1, 16), whiteMat);
  stripe.position.y = 0.25;
  pylon.add(stripe);

  return pylon;
}

/**
 * Procedural 3D Oil Barrel
 */
function createBarrelMesh(): THREE.Group {
  const barrel = new THREE.Group();
  barrel.name = 'Barrel';
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.3, metalness: 0.7 });

  const cylinder = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.75, 20), barrelMat);
  cylinder.position.y = 0.375;
  cylinder.castShadow = true;
  barrel.add(cylinder);

  return barrel;
}

export function buildEnvironment(type: EnvironmentType): EnvironmentScene {
  const group = new THREE.Group();
  group.name = `Env_${type}`;
  const obstacles: Obstacle3D[] = [];
  const itemMeshes = new Map<string, THREE.Group>();

  // Default interactive scene items in the world
  const sceneItems: SceneItem[] = [
    {
      id: 'person-1',
      type: 'person',
      name: 'Person (Human Mannequin)',
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
      name: 'Safety Pylon 1',
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
  ];

  const gridTexture = createGridFloorTexture();
  const floorMat = new THREE.MeshStandardMaterial({
    map: gridTexture,
    roughness: 0.85,
    metalness: 0.1,
  });

  // Base Arena Floor (20m x 20m)
  const floorGeo = new THREE.PlaneGeometry(20, 20);
  const floorMesh = new THREE.Mesh(floorGeo, floorMat);
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.receiveShadow = true;
  group.add(floorMesh);

  // Soft Contact Shadow Plane directly beneath robot (Y = 0.002)
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = 128;
  shadowCanvas.height = 128;
  const sCtx = shadowCanvas.getContext('2d')!;
  const grad = sCtx.createRadialGradient(64, 64, 10, 64, 64, 60);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0.7)');
  grad.addColorStop(0.5, 'rgba(0, 0, 0, 0.3)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  sCtx.fillStyle = grad;
  sCtx.fillRect(0, 0, 128, 128);

  const shadowTexture = new THREE.CanvasTexture(shadowCanvas);
  const shadowGeo = new THREE.PlaneGeometry(0.5, 0.5);
  const shadowMat = new THREE.MeshBasicMaterial({
    map: shadowTexture,
    transparent: true,
    depthWrite: false,
    opacity: 0.6,
  });
  const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
  shadowMesh.rotation.x = -Math.PI / 2;
  shadowMesh.position.y = 0.002;
  group.add(shadowMesh);

  let groundHeightAt = (_x: number, _z: number) => 0.0;

  // Custom terrain geometries based on environment
  if (type === 'obstacles') {
    // Step obstacles
    const woodMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.7, metalness: 0.05 });
    const stepConfigs = [
      { z: 0.8, height: 0.03, width: 1.2, depth: 0.2 },
      { z: 1.6, height: 0.05, width: 1.2, depth: 0.25 },
      { z: 2.5, height: 0.07, width: 1.4, depth: 0.3 },
    ];

    stepConfigs.forEach((cfg) => {
      const stepMesh = new THREE.Mesh(
        new THREE.BoxGeometry(cfg.width, cfg.height, cfg.depth),
        woodMat
      );
      stepMesh.position.set(0, cfg.height / 2, cfg.z);
      stepMesh.castShadow = true;
      stepMesh.receiveShadow = true;
      group.add(stepMesh);

      obstacles.push({
        type: 'box',
        position: { x: 0, y: (cfg.height / 2) * 1000, z: cfg.z * 1000 },
        size: { x: cfg.width * 1000, y: cfg.height * 1000, z: cfg.depth * 1000 },
      });
    });

    groundHeightAt = (x: number, z: number) => {
      for (const step of stepConfigs) {
        if (
          Math.abs(x) < step.width / 2 &&
          Math.abs(z - step.z) < step.depth / 2
        ) {
          return step.height;
        }
      }
      return 0.0;
    };
  } else if (type === 'slopes') {
    // Ramp incline 15 degrees
    const rampLength = 2.0;
    const rampHeight = 0.35;
    const rampGeo = new THREE.BoxGeometry(1.4, 0.04, rampLength);
    const rampMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.7, metalness: 0.2 });
    const rampMesh = new THREE.Mesh(rampGeo, rampMat);
    rampMesh.rotation.x = 0.175;
    rampMesh.position.set(0, rampHeight / 2, 1.2);
    rampMesh.castShadow = true;
    rampMesh.receiveShadow = true;
    group.add(rampMesh);

    groundHeightAt = (x: number, z: number) => {
      if (Math.abs(x) < 0.7 && z > 0.2 && z < 2.2) {
        return ((z - 0.2) / 2.0) * rampHeight;
      }
      return 0.0;
    };
  }

  // Animation helper for person
  let personAnimWalk: ((phase: number) => void) | null = null;
  let personWalkPhase = 0;

  // Function to create mesh for a SceneItem
  const instantiateItemMesh = (item: SceneItem): THREE.Group => {
    let mesh: THREE.Group;
    switch (item.type) {
      case 'person': {
        const p = createPersonMesh();
        mesh = p.group;
        personAnimWalk = p.animateWalk;
        break;
      }
      case 'box':
        mesh = createBoxMesh();
        break;
      case 'chair':
        mesh = createChairMesh();
        break;
      case 'pylon':
        mesh = createPylonMesh();
        break;
      case 'barrel':
        mesh = createBarrelMesh();
        break;
      default:
        mesh = createBoxMesh();
    }
    mesh.position.set(item.position.x, item.position.y, item.position.z);
    mesh.rotation.y = item.rotation;
    mesh.userData = { id: item.id, type: item.type, name: item.name };
    return mesh;
  };

  // Instantiate default scene items
  sceneItems.forEach((item) => {
    const mesh = instantiateItemMesh(item);
    itemMeshes.set(item.id, mesh);
    group.add(mesh);

    // Register obstacle for ultrasonic sensor
    obstacles.push({
      type: item.type === 'pylon' || item.type === 'barrel' ? 'cylinder' : 'box',
      position: { x: item.position.x * 1000, y: 300, z: item.position.z * 1000 },
      size: { x: 500, y: 1000, z: 500 },
    });
  });

  const addItem = (item: SceneItem) => {
    sceneItems.push(item);
    const mesh = instantiateItemMesh(item);
    itemMeshes.set(item.id, mesh);
    group.add(mesh);
  };

  const removeItem = (id: string) => {
    const idx = sceneItems.findIndex((it) => it.id === id);
    if (idx !== -1) sceneItems.splice(idx, 1);
    const mesh = itemMeshes.get(id);
    if (mesh) {
      group.remove(mesh);
      itemMeshes.delete(id);
    }
  };

  const updateItemPos = (id: string, pos: Vector3D) => {
    const item = sceneItems.find((it) => it.id === id);
    if (item) {
      item.position = pos;
    }
    const mesh = itemMeshes.get(id);
    if (mesh) {
      mesh.position.set(pos.x, pos.y, pos.z);
    }
  };

  const updateAnimation = (delta: number) => {
    // Person walking pacing animation
    const person = sceneItems.find((it) => it.type === 'person' && it.isWalking);
    if (person && personAnimWalk) {
      personWalkPhase = (personWalkPhase + delta * 1.5) % 1.0;
      personAnimWalk(personWalkPhase);

      // Subtle slow patrol walk back and forth
      person.position.x = 0.2 + Math.sin(personWalkPhase * Math.PI * 2) * 0.4;
      updateItemPos(person.id, person.position);
    }
  };

  /**
   * Synthetic Computer Vision Object Detector:
   * Projects 3D scene objects into the robot camera's view frustum,
   * calculating 2D bounding boxes, confidence score, distance, and direction.
   */
  const detectObjectsInCamera = (
    camera: THREE.PerspectiveCamera,
    robotPos: THREE.Vector3,
    robotHeadingRad: number
  ): DetectedObject[] => {
    camera.updateMatrixWorld();
    const frustum = new THREE.Frustum();
    const projScreenMatrix = new THREE.Matrix4();
    projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projScreenMatrix);

    const detections: DetectedObject[] = [];

    for (const item of sceneItems) {
      const itemPos = new THREE.Vector3(item.position.x, item.position.y + 0.35, item.position.z);
      const dist = robotPos.distanceTo(itemPos);

      // Maximum detection range 7.5 meters
      if (dist > 7.5) continue;

      // Check if point is in camera frustum
      if (frustum.containsPoint(itemPos)) {
        // Project to 2D screen space coordinates [-1 to 1]
        const projected = itemPos.clone().project(camera);

        // Convert from NDC (-1..1) to normalized (0..1)
        const screenX = (projected.x + 1) / 2;
        const screenY = (1 - projected.y) / 2; // Inverted Y for 2D screen

        // Estimate 2D bounding box size based on inverse distance
        const baseSize = item.type === 'person' ? 1.4 : 0.6;
        const bboxW = Math.max(0.06, Math.min(0.65, (baseSize * 0.45) / dist));
        const bboxH = Math.max(0.08, Math.min(0.85, (baseSize * 0.95) / dist));

        // Calculate relative bearing / angle in degrees relative to robot heading
        const dx = item.position.x - robotPos.x;
        const dz = item.position.z - robotPos.z;
        const angleToItem = Math.atan2(dx, dz);
        let bearingDeg = ((angleToItem - robotHeadingRad) * 180) / Math.PI;
        // Normalize between -180 and 180
        bearingDeg = ((bearingDeg + 180) % 360) - 180;

        // Confidence score based on distance and centering
        const centerOffset = Math.abs(projected.x);
        const confidence = Math.round(Math.max(75, 99 - dist * 3.5 - centerOffset * 10));

        detections.push({
          id: item.id,
          label: item.type === 'person' ? 'Person' : item.type.toUpperCase(),
          confidence,
          distanceM: Math.round(dist * 100) / 100,
          directionDeg: Math.round(bearingDeg * 10) / 10,
          bbox: {
            x: Math.max(0, screenX - bboxW / 2),
            y: Math.max(0, screenY - bboxH / 2),
            w: bboxW,
            h: bboxH,
          },
          pos3D: item.position,
        });
      }
    }

    return detections;
  };

  const dispose = () => {
    gridTexture.dispose();
    floorMat.dispose();
    floorGeo.dispose();
    shadowTexture.dispose();
    shadowMat.dispose();
    shadowGeo.dispose();
  };

  return {
    group,
    obstacles,
    sceneItems,
    itemMeshes,
    groundHeightAt,
    updateAnimation,
    addItem,
    removeItem,
    updateItemPos,
    detectObjectsInCamera,
    dispose,
  };
}
