import * as THREE from 'three';
import { LegId, LegJoints, RobotJointAngles } from '../types/robot';
import { SPOT_MICRO_PARAMS } from './kinematics';

export interface LegAssembly {
  hipPivot: THREE.Group;       // Abduction (roll around Z)
  shoulderPivot: THREE.Group;  // Hip Pitch (pitch around X)
  kneePivot: THREE.Group;      // Knee (pitch around X)
  footMesh: THREE.Mesh;
  hipHousingMesh: THREE.Mesh;
  upperLegMesh: THREE.Mesh;
  lowerLegMesh: THREE.Mesh;
}

export interface SpotMicroVisualModel {
  rootGroup: THREE.Group;
  bodyMeshGroup: THREE.Group;
  legs: Record<LegId, LegAssembly>;
  robotCamera: THREE.PerspectiveCamera;
  cameraMountGroup: THREE.Group;
  cameraFovHelper: THREE.LineSegments;
  lcdGroup: THREE.Group;
  updateLcdDisplay: (line1: string, line2: string, backlight?: boolean) => void;
  micGroup: THREE.Group;
  ultrasonicSensorGroup: THREE.Group;
  sensorRayLine: THREE.Line;
  piBoardGroup: THREE.Group;
  pcaBoardGroup: THREE.Group;
  selectableObjects: THREE.Object3D[];
  highlightPart: (channelOrName: number | string | null) => void;
  updateJoints: (joints: RobotJointAngles) => void;
  updateSensorRay: (distanceCm: number) => void;
  setFovVisible: (visible: boolean) => void;
}

// Convert mm to meters for Three.js scene scale
const SCALE = 0.001;
const L1 = SPOT_MICRO_PARAMS.L1_hip * SCALE;          // 0.0585 m
const L2 = SPOT_MICRO_PARAMS.L2_upper * SCALE;        // 0.105 m
const L3 = SPOT_MICRO_PARAMS.L3_lower * SCALE;        // 0.120 m
const BODY_L = SPOT_MICRO_PARAMS.bodyLength * SCALE;  // 0.280 m
const BODY_W = SPOT_MICRO_PARAMS.bodyWidth * SCALE;   // 0.110 m
const BODY_H = 0.080;                                // 80 mm body height

/**
 * Procedural 3D-Print PLA carbon-fiber texture
 */
function create3DPrintTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#22252a';
  ctx.fillRect(0, 0, 256, 256);

  // 3D print layer lines
  ctx.strokeStyle = '#1a1c22';
  ctx.lineWidth = 1.5;
  for (let y = 0; y < 256; y += 3) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(256, y);
    ctx.stroke();
  }

  // Carbon fiber weave
  ctx.strokeStyle = '#2e333d';
  ctx.lineWidth = 0.8;
  for (let x = 0; x < 256; x += 6) {
    for (let y = 0; y < 256; y += 6) {
      if ((x + y) % 12 === 0) {
        ctx.strokeRect(x, y, 3, 3);
      }
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(4, 4);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Creates dynamic 16x2 LCD Character CanvasTexture
 */
function createLcdTexture(): { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture; updateText: (l1: string, l2: string, bl?: boolean) => void } {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  const updateText = (l1: string, l2: string, bl: boolean = true) => {
    // Blue LCD backlight with HD44780 dot-matrix appearance
    ctx.fillStyle = bl ? '#00358e' : '#0a1931';
    ctx.fillRect(0, 0, 512, 128);

    // Bezel border
    ctx.strokeStyle = '#051838';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, 506, 122);

    // Subtle 5x8 character cell dot matrix grid pattern
    ctx.fillStyle = bl ? 'rgba(0, 70, 180, 0.4)' : 'rgba(0, 30, 80, 0.4)';
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 16; c++) {
        const x = 24 + c * 29;
        const y = 20 + r * 50;
        ctx.fillRect(x, y, 26, 42);
      }
    }

    // High contrast white/cyan character text
    ctx.fillStyle = bl ? '#ffffff' : '#475569';
    ctx.font = 'bold 32px "Courier New", monospace';
    ctx.textBaseline = 'middle';

    const cleanL1 = (l1 || '').padEnd(16, ' ').slice(0, 16);
    const cleanL2 = (l2 || '').padEnd(16, ' ').slice(0, 16);

    ctx.fillText(cleanL1, 26, 42);
    ctx.fillText(cleanL2, 26, 92);

    texture.needsUpdate = true;
  };

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  updateText('KUKUR Quadruped', 'SYS: OK 50Hz');

  return { canvas, texture, updateText };
}

/**
 * Builds the fully interactive 3D robot KUKUR
 */
export function buildSpotMicroRobot(): SpotMicroVisualModel {
  const rootGroup = new THREE.Group();
  rootGroup.name = 'KUKUR_Robot_Dog';

  const printTexture = create3DPrintTexture();
  const selectableObjects: THREE.Object3D[] = [];

  // PBR Materials
  const kukurYellowMat = new THREE.MeshStandardMaterial({
    map: printTexture,
    color: new THREE.Color('#f59e0b'), // KUKUR vibrant robotic amber
    roughness: 0.55,
    metalness: 0.12,
  });

  const chassisDarkMat = new THREE.MeshStandardMaterial({
    map: printTexture,
    color: new THREE.Color('#181a20'),
    roughness: 0.7,
    metalness: 0.18,
  });

  const servoHornMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#38bdf8'), // Anodized aluminum servo horns
    roughness: 0.25,
    metalness: 0.85,
  });

  const chromeMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#e2e8f0'),
    roughness: 0.15,
    metalness: 0.95,
  });

  const rubberFootMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#0a0c10'),
    roughness: 0.95,
    metalness: 0.02,
  });

  // 1. MAIN CHASSIS / TORSO
  const bodyMeshGroup = new THREE.Group();
  rootGroup.add(bodyMeshGroup);

  // Lower chassis tray
  const trayGeo = new THREE.BoxGeometry(BODY_W, BODY_H * 0.45, BODY_L);
  const trayMesh = new THREE.Mesh(trayGeo, chassisDarkMat);
  trayMesh.castShadow = true;
  trayMesh.receiveShadow = true;
  trayMesh.userData = { type: 'body', name: 'Lower Chassis Tray' };
  selectableObjects.push(trayMesh);
  bodyMeshGroup.add(trayMesh);

  // Upper canopy (KUKUR yellow/amber shell)
  const canopyGeo = new THREE.BoxGeometry(BODY_W * 0.94, BODY_H * 0.55, BODY_L * 0.92);
  const canopyMesh = new THREE.Mesh(canopyGeo, kukurYellowMat);
  canopyMesh.position.y = BODY_H * 0.42;
  canopyMesh.castShadow = true;
  canopyMesh.receiveShadow = true;
  canopyMesh.userData = { type: 'body', name: 'KUKUR Main Torso Canopy' };
  selectableObjects.push(canopyMesh);
  bodyMeshGroup.add(canopyMesh);

  // Top carry handle / roll cage
  const handleGeo = new THREE.CylinderGeometry(0.005, 0.005, BODY_L * 0.38, 16);
  const handleMesh = new THREE.Mesh(handleGeo, chassisDarkMat);
  handleMesh.rotation.x = Math.PI / 2;
  handleMesh.position.set(0, BODY_H * 0.74, 0);
  bodyMeshGroup.add(handleMesh);

  // 2. 16x2 I2C CHARACTER LCD DISPLAY (Mounted on front canopy)
  const lcdGroup = new THREE.Group();
  lcdGroup.position.set(0, BODY_H * 0.65, 0.075);
  lcdGroup.rotation.x = -0.25; // Angled for visibility
  bodyMeshGroup.add(lcdGroup);

  const { texture: lcdCanvasTexture, updateText: updateLcdDisplay } = createLcdTexture();

  // LCD Bezel
  const lcdBezelGeo = new THREE.BoxGeometry(0.075, 0.026, 0.006);
  const lcdBezelMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.5, metalness: 0.3 });
  const lcdBezelMesh = new THREE.Mesh(lcdBezelGeo, lcdBezelMat);
  lcdBezelMesh.userData = { type: 'module', name: '16x2 I2C LCD Display (0x27)' };
  selectableObjects.push(lcdBezelMesh);
  lcdGroup.add(lcdBezelMesh);

  // LCD Screen face
  const lcdScreenGeo = new THREE.PlaneGeometry(0.068, 0.02);
  const lcdScreenMat = new THREE.MeshBasicMaterial({ map: lcdCanvasTexture });
  const lcdScreenMesh = new THREE.Mesh(lcdScreenGeo, lcdScreenMat);
  lcdScreenMesh.position.z = 0.0035;
  lcdGroup.add(lcdScreenMesh);

  // 3. FRONT CAMERA MODULE (Pi Camera v2 / HQ with Real POV)
  const cameraMountGroup = new THREE.Group();
  cameraMountGroup.position.set(0, BODY_H * 0.38, BODY_L / 2 + 0.012);
  bodyMeshGroup.add(cameraMountGroup);

  // Camera PCB
  const camPcbGeo = new THREE.BoxGeometry(0.025, 0.024, 0.003);
  const camPcbMat = new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.4, metalness: 0.2 });
  const camPcbMesh = new THREE.Mesh(camPcbGeo, camPcbMat);
  camPcbMesh.userData = { type: 'module', name: 'Pi Camera Module v2' };
  selectableObjects.push(camPcbMesh);
  cameraMountGroup.add(camPcbMesh);

  // Camera Lens barrel
  const lensGeo = new THREE.CylinderGeometry(0.006, 0.007, 0.012, 20);
  lensGeo.rotateX(Math.PI / 2);
  const lensMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.1, metalness: 0.9 });
  const lensMesh = new THREE.Mesh(lensGeo, lensMat);
  lensMesh.position.z = 0.006;
  cameraMountGroup.add(lensMesh);

  // Optical aperture glass
  const glassGeo = new THREE.CircleGeometry(0.004, 16);
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x38bdf8, transmission: 0.8, roughness: 0.05 });
  const glassMesh = new THREE.Mesh(glassGeo, glassMat);
  glassMesh.position.z = 0.0125;
  cameraMountGroup.add(glassMesh);

  // The actual 3D robot perspective camera (for simulated live view)
  const robotCamera = new THREE.PerspectiveCamera(65, 4 / 3, 0.05, 15);
  robotCamera.position.set(0, 0, 0.015);
  robotCamera.rotation.y = 0; // Looks forward (+Z)
  cameraMountGroup.add(robotCamera);

  // Camera FOV Frustum Visualization Wireframe
  const fovPoints = [
    // Origin to corners
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(-0.6, 0.45, 1.2),
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.6, 0.45, 1.2),
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.6, -0.45, 1.2),
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(-0.6, -0.45, 1.2),
    // Far plane rectangle
    new THREE.Vector3(-0.6, 0.45, 1.2), new THREE.Vector3(0.6, 0.45, 1.2),
    new THREE.Vector3(0.6, 0.45, 1.2), new THREE.Vector3(0.6, -0.45, 1.2),
    new THREE.Vector3(0.6, -0.45, 1.2), new THREE.Vector3(-0.6, -0.45, 1.2),
    new THREE.Vector3(-0.6, -0.45, 1.2), new THREE.Vector3(-0.6, 0.45, 1.2),
  ];
  const fovGeo = new THREE.BufferGeometry().setFromPoints(fovPoints);
  const fovMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.35 });
  const cameraFovHelper = new THREE.LineSegments(fovGeo, fovMat);
  cameraMountGroup.add(cameraFovHelper);

  const setFovVisible = (visible: boolean) => {
    cameraFovHelper.visible = visible;
  };

  // 4. MEMS MICROPHONE MODULE
  const micGroup = new THREE.Group();
  micGroup.position.set(-0.035, BODY_H * 0.71, 0.02);
  bodyMeshGroup.add(micGroup);

  const micPcbGeo = new THREE.BoxGeometry(0.016, 0.002, 0.016);
  const micPcbMat = new THREE.MeshStandardMaterial({ color: 0x9333ea, roughness: 0.4 }); // Purple breakout
  const micPcbMesh = new THREE.Mesh(micPcbGeo, micPcbMat);
  micPcbMesh.userData = { type: 'module', name: 'I2S MEMS Microphone Module' };
  selectableObjects.push(micPcbMesh);
  micGroup.add(micPcbMesh);

  // Metal mic sound-port can
  const micCanGeo = new THREE.CylinderGeometry(0.003, 0.003, 0.003, 16);
  const micCanMesh = new THREE.Mesh(micCanGeo, chromeMat);
  micCanMesh.position.y = 0.002;
  micGroup.add(micCanMesh);

  // 5. RASPBERRY PI 4 MODEL B (2018)
  const piBoardGroup = new THREE.Group();
  piBoardGroup.position.set(0, BODY_H * 0.71, -0.05);
  bodyMeshGroup.add(piBoardGroup);

  const pcbGeo = new THREE.BoxGeometry(0.056, 0.002, 0.085);
  const pcbMat = new THREE.MeshStandardMaterial({ color: 0x166534, roughness: 0.45, metalness: 0.2 });
  const pcbMesh = new THREE.Mesh(pcbGeo, pcbMat);
  pcbMesh.userData = { type: 'module', name: 'Raspberry Pi 4 Model B (2018)' };
  selectableObjects.push(pcbMesh);
  piBoardGroup.add(pcbMesh);

  // BCM2711 SoC aluminum heat sink
  const heatsinkGeo = new THREE.BoxGeometry(0.016, 0.006, 0.016);
  const heatsinkMesh = new THREE.Mesh(heatsinkGeo, chromeMat);
  heatsinkMesh.position.set(-0.005, 0.004, 0.005);
  piBoardGroup.add(heatsinkMesh);

  // 40-pin GPIO header
  const gpioGeo = new THREE.BoxGeometry(0.006, 0.008, 0.052);
  const gpioMesh = new THREE.Mesh(gpioGeo, chassisDarkMat);
  gpioMesh.position.set(0.022, 0.005, 0.005);
  piBoardGroup.add(gpioMesh);

  // 6. PCA9685 16-CHANNEL SERVO DRIVER
  const pcaBoardGroup = new THREE.Group();
  pcaBoardGroup.position.set(0.015, BODY_H * 0.71, 0.045);
  bodyMeshGroup.add(pcaBoardGroup);

  const pcaPcbGeo = new THREE.BoxGeometry(0.038, 0.002, 0.045);
  const pcaPcbMat = new THREE.MeshStandardMaterial({ color: 0x0369a1, roughness: 0.4 });
  const pcaPcbMesh = new THREE.Mesh(pcaPcbGeo, pcaPcbMat);
  pcaPcbMesh.userData = { type: 'module', name: 'PCA9685 16-Ch PWM Driver (0x40)' };
  selectableObjects.push(pcaPcbMesh);
  pcaBoardGroup.add(pcaPcbMesh);

  // 7. HC-SR04 ULTRASONIC SENSOR
  const ultrasonicSensorGroup = new THREE.Group();
  ultrasonicSensorGroup.position.set(0, BODY_H * 0.15, BODY_L / 2 + 0.006);
  bodyMeshGroup.add(ultrasonicSensorGroup);

  const usPcbGeo = new THREE.BoxGeometry(0.045, 0.02, 0.003);
  const usPcbMat = new THREE.MeshStandardMaterial({ color: 0x0284c7 });
  const usPcbMesh = new THREE.Mesh(usPcbGeo, usPcbMat);
  usPcbMesh.userData = { type: 'module', name: 'HC-SR04 Ultrasonic Sensor (GPIO 23/24)' };
  selectableObjects.push(usPcbMesh);
  ultrasonicSensorGroup.add(usPcbMesh);

  const barrelGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.014, 20);
  barrelGeo.rotateX(Math.PI / 2);

  const leftBarrel = new THREE.Mesh(barrelGeo, chromeMat);
  leftBarrel.position.set(-0.013, 0, 0.008);
  ultrasonicSensorGroup.add(leftBarrel);

  const rightBarrel = new THREE.Mesh(barrelGeo, chromeMat);
  rightBarrel.position.set(0.013, 0, 0.008);
  ultrasonicSensorGroup.add(rightBarrel);

  // Ultrasonic sensor ray line in 3D
  const rayGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, 1.5),
  ]);
  const rayMaterial = new THREE.LineDashedMaterial({
    color: 0x22c55e,
    dashSize: 0.04,
    gapSize: 0.02,
    linewidth: 2,
    transparent: true,
    opacity: 0.85,
  });
  const sensorRayLine = new THREE.Line(rayGeometry, rayMaterial);
  sensorRayLine.computeLineDistances();
  ultrasonicSensorGroup.add(sensorRayLine);

  // 8. 4 ARTICULATED LEGS WITH EXACT PCA9685 CHANNEL MAPPINGS
  // Channel mapping:
  // FL: Abduction CH0, Hip pitch CH1, Knee CH2
  // FR: Abduction CH3, Hip pitch CH4, Knee CH5
  // BL (RL): Abduction CH6, Hip pitch CH7, Knee CH8
  // BR (RR): Abduction CH9, Hip pitch CH10, Knee CH11
  const legs: Record<LegId, LegAssembly> = {} as any;
  const legConfigs: Array<{
    leg: LegId;
    isLeft: boolean;
    isFront: boolean;
    abductionCh: number;
    hipPitchCh: number;
    kneeCh: number;
  }> = [
    { leg: 'FL', isLeft: true, isFront: true, abductionCh: 0, hipPitchCh: 1, kneeCh: 2 },
    { leg: 'FR', isLeft: false, isFront: true, abductionCh: 3, hipPitchCh: 4, kneeCh: 5 },
    { leg: 'RL', isLeft: true, isFront: false, abductionCh: 6, hipPitchCh: 7, kneeCh: 8 },
    { leg: 'RR', isLeft: false, isFront: false, abductionCh: 9, hipPitchCh: 10, kneeCh: 11 },
  ];

  for (const cfg of legConfigs) {
    const hipX = cfg.isLeft ? -BODY_W / 2 : BODY_W / 2;
    const hipY = 0;
    const hipZ = cfg.isFront ? BODY_L / 2 : -BODY_L / 2;

    // Joint 1: Abduction Pivot (Roll around Z axis)
    const hipPivot = new THREE.Group();
    hipPivot.position.set(hipX, hipY, hipZ);
    hipPivot.name = `${cfg.leg}_Abduction_CH${cfg.abductionCh}`;
    bodyMeshGroup.add(hipPivot);

    // Hip housing & servo
    const hipHousingGeo = new THREE.BoxGeometry(0.04, 0.045, 0.045);
    const hipHousingMesh = new THREE.Mesh(hipHousingGeo, kukurYellowMat);
    hipHousingMesh.castShadow = true;
    hipHousingMesh.userData = {
      type: 'joint',
      channel: cfg.abductionCh,
      leg: cfg.leg,
      joint: 'abduction',
      name: `${cfg.leg} Abduction (CH${cfg.abductionCh})`,
    };
    selectableObjects.push(hipHousingMesh);
    hipPivot.add(hipHousingMesh);

    // Lateral horn
    const hornGeo = new THREE.CylinderGeometry(0.014, 0.014, L1, 20);
    hornGeo.rotateZ(Math.PI / 2);
    const hornMesh = new THREE.Mesh(hornGeo, servoHornMat);
    hornMesh.position.x = cfg.isLeft ? -L1 / 2 : L1 / 2;
    hornMesh.castShadow = true;
    hipPivot.add(hornMesh);

    // Joint 2: Hip Pitch Pivot (Pitch around X axis)
    const shoulderPivot = new THREE.Group();
    shoulderPivot.position.set(cfg.isLeft ? -L1 : L1, 0, 0);
    shoulderPivot.name = `${cfg.leg}_HipPitch_CH${cfg.hipPitchCh}`;
    hipPivot.add(shoulderPivot);

    // Shoulder/Hip bracket
    const shoulderJointGeo = new THREE.SphereGeometry(0.02, 16, 16);
    const shoulderJointMesh = new THREE.Mesh(shoulderJointGeo, chassisDarkMat);
    shoulderPivot.add(shoulderJointMesh);

    // Upper Leg (Femur)
    const upperLegGroup = new THREE.Group();
    shoulderPivot.add(upperLegGroup);

    const upperLegGeo = new THREE.BoxGeometry(0.024, L2, 0.032);
    upperLegGeo.translate(0, -L2 / 2, 0);
    const upperLegMesh = new THREE.Mesh(upperLegGeo, kukurYellowMat);
    upperLegMesh.castShadow = true;
    upperLegMesh.userData = {
      type: 'joint',
      channel: cfg.hipPitchCh,
      leg: cfg.leg,
      joint: 'hip_pitch',
      name: `${cfg.leg} Hip Pitch (CH${cfg.hipPitchCh})`,
    };
    selectableObjects.push(upperLegMesh);
    upperLegGroup.add(upperLegMesh);

    // Joint 3: Knee Pivot (Pitch around X axis)
    const kneePivot = new THREE.Group();
    kneePivot.position.set(0, -L2, 0);
    kneePivot.name = `${cfg.leg}_Knee_CH${cfg.kneeCh}`;
    shoulderPivot.add(kneePivot);

    const kneeBearingGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.028, 16);
    kneeBearingGeo.rotateZ(Math.PI / 2);
    const kneeBearingMesh = new THREE.Mesh(kneeBearingGeo, chromeMat);
    kneePivot.add(kneeBearingMesh);

    // Lower Leg (Tibia)
    const lowerLegGroup = new THREE.Group();
    kneePivot.add(lowerLegGroup);

    const lowerLegGeo = new THREE.BoxGeometry(0.016, L3, 0.02);
    lowerLegGeo.translate(0, -L3 / 2, 0);
    const lowerLegMesh = new THREE.Mesh(lowerLegGeo, chassisDarkMat);
    lowerLegMesh.castShadow = true;
    lowerLegMesh.userData = {
      type: 'joint',
      channel: cfg.kneeCh,
      leg: cfg.leg,
      joint: 'knee',
      name: `${cfg.leg} Knee (CH${cfg.kneeCh})`,
    };
    selectableObjects.push(lowerLegMesh);
    lowerLegGroup.add(lowerLegMesh);

    // Rubber Foot Pad
    const footGeo = new THREE.SphereGeometry(0.015, 20, 20);
    const footMesh = new THREE.Mesh(footGeo, rubberFootMat);
    footMesh.position.set(0, -L3, 0);
    footMesh.castShadow = true;
    footMesh.userData = { type: 'foot', leg: cfg.leg, name: `${cfg.leg} Rubber Foot Pad` };
    selectableObjects.push(footMesh);
    lowerLegGroup.add(footMesh);

    legs[cfg.leg] = {
      hipPivot,
      shoulderPivot,
      kneePivot,
      footMesh,
      hipHousingMesh,
      upperLegMesh,
      lowerLegMesh,
    };
  }

  // Visual selection highlight helper
  const highlightPart = (channelOrName: number | string | null) => {
    for (const obj of selectableObjects) {
      const mesh = obj as THREE.Mesh;
      if (!mesh.material) continue;

      const isMatch =
        channelOrName !== null &&
        (mesh.userData?.channel === channelOrName || mesh.userData?.name === channelOrName);

      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((m) => {
          if ('emissive' in m) {
            (m as any).emissive = isMatch ? new THREE.Color('#38bdf8') : new THREE.Color('#000000');
            (m as any).emissiveIntensity = isMatch ? 0.45 : 0;
          }
        });
      } else if ('emissive' in mesh.material) {
        (mesh.material as any).emissive = isMatch ? new THREE.Color('#38bdf8') : new THREE.Color('#000000');
        (mesh.material as any).emissiveIntensity = isMatch ? 0.45 : 0;
      }
    }
  };

  // Update all 12 servo joints in degrees
  const degToRad = Math.PI / 180;
  const updateJoints = (joints: RobotJointAngles) => {
    for (const cfg of legConfigs) {
      const j: LegJoints = joints[cfg.leg];
      if (!j) continue;

      // 1. Abduction (Roll about Z)
      legs[cfg.leg].hipPivot.rotation.z = (cfg.isLeft ? j.hip : -j.hip) * degToRad;

      // 2. Hip Pitch (Pitch about X)
      legs[cfg.leg].shoulderPivot.rotation.x = -j.shoulder * degToRad;

      // 3. Knee (Pitch about X)
      legs[cfg.leg].kneePivot.rotation.x = -j.knee * degToRad;
    }
  };

  // Update ultrasonic sensor ray visualization
  const updateSensorRay = (distanceCm: number) => {
    const distM = Math.min(4.0, Math.max(0.05, distanceCm / 100));
    const positions = (sensorRayLine.geometry as THREE.BufferGeometry).attributes.position;
    positions.setXYZ(1, 0, 0, distM);
    positions.needsUpdate = true;
    sensorRayLine.computeLineDistances();

    const mat = sensorRayLine.material as THREE.LineDashedMaterial;
    if (distM < 0.3) {
      mat.color.setHex(0xef4444); // Red obstacle alert
    } else if (distM < 0.8) {
      mat.color.setHex(0xf59e0b); // Amber caution
    } else {
      mat.color.setHex(0x22c55e); // Green safe
    }
  };

  return {
    rootGroup,
    bodyMeshGroup,
    legs,
    robotCamera,
    cameraMountGroup,
    cameraFovHelper,
    lcdGroup,
    updateLcdDisplay,
    micGroup,
    ultrasonicSensorGroup,
    sensorRayLine,
    piBoardGroup,
    pcaBoardGroup,
    selectableObjects,
    highlightPart,
    updateJoints,
    updateSensorRay,
    setFovVisible,
  };
}
