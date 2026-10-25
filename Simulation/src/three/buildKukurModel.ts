import * as THREE from 'three';
import { ROBOT_DIMS } from '../simulation/kinematics';
import { LegId, SelectableTarget } from '../types/simulator';
import { LEG_CHANNELS_MAP } from '../simulation/initialState';

export type RobotStructureColor = 'green' | 'blue';

export interface LegRigRefs {
  legId: LegId;
  colorTheme: RobotStructureColor;
  abductionPivot: THREE.Group;
  hipPivot: THREE.Group;
  kneePivot: THREE.Group;
  footTip: THREE.Object3D;
  jointAnchors: [THREE.Object3D, THREE.Object3D, THREE.Object3D];
  channelMeshes: Record<number, THREE.Mesh[]>;
}

export interface KukurModelRig {
  rootGroup: THREE.Group;
  chassisGroup: THREE.Group;
  legs: Record<LegId, LegRigRefs>;
  legColorScheme: Record<LegId, RobotStructureColor>;
  channelPivotMap: Record<number, THREE.Group>;
  channelMeshesMap: Record<number, THREE.Mesh[]>;
  chassisPartMeshes: Record<string, THREE.Mesh[]>;
  ultrasonicSensorGroup: THREE.Group;
  cameraModuleGroup: THREE.Group;
  cameraDetachedStand: THREE.Group;
  robotCamera: THREE.PerspectiveCamera;
  lcdModuleGroup: THREE.Group;
  lcdScreenMesh: THREE.Mesh;
  lcdDetachedStand: THREE.Group;
  micModuleGroup: THREE.Group;
  micRingMat: THREE.MeshStandardMaterial;
  micDetachedStand: THREE.Group;
  jointHighlightRing: THREE.Group;
  selectableMeshes: THREE.Object3D[];
}

function tagSelectable(obj: THREE.Object3D, target: SelectableTarget, bucket: THREE.Object3D[]) {
  obj.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      child.userData.selectable = target;
      child.castShadow = true;
      child.receiveShadow = true;
      bucket.push(child);
    }
  });
}

/**
 * Create a rounded-end link shape for 3D-printed thigh/shin links
 */
function createRoundedLinkGeometry(
  length: number,
  topRadius: number,
  bottomRadius: number,
  thickness: number
): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, topRadius, 0, Math.PI, false);
  shape.lineTo(-bottomRadius, -length);
  shape.absarc(0, -length, bottomRadius, Math.PI, Math.PI * 2, false);
  shape.lineTo(topRadius, 0);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelSegments: 3,
    steps: 1,
    bevelSize: 0.0025,
    bevelThickness: 0.0025,
  });
  geo.rotateY(Math.PI / 2);
  geo.translate(-thickness / 2, 0, 0);
  geo.computeVertexNormals();
  return geo;
}

export function buildKukurModel(lcdTexture: THREE.CanvasTexture): KukurModelRig {
  const selectableMeshes: THREE.Object3D[] = [];
  const rootGroup = new THREE.Group();
  rootGroup.name = 'KukurRoot';

  const chassisGroup = new THREE.Group();
  chassisGroup.name = 'ChassisGroup';
  rootGroup.add(chassisGroup);

  // Strictly Blue & Green Structural Palette for KUKUR's Body and 4 Legs:
  // - Central body uses ONLY Green and Blue structural panels/frame.
  // - Exactly two complete legs (FL, BL) are Green; the other two complete legs (FR, BR) are Blue.
  // - Each leg applies its assigned color consistently to upper leg, lower leg, joint covers, brackets, and foot.
  const matGreenPrimary = new THREE.MeshStandardMaterial({
    color: 0x16a34a,
    roughness: 0.36,
    metalness: 0.08,
  });
  const matGreenCover = new THREE.MeshStandardMaterial({
    color: 0x15803d,
    roughness: 0.44,
    metalness: 0.14,
  });
  const matBluePrimary = new THREE.MeshStandardMaterial({
    color: 0x2563eb,
    roughness: 0.36,
    metalness: 0.08,
  });
  const matBlueCover = new THREE.MeshStandardMaterial({
    color: 0x1d4ed8,
    roughness: 0.44,
    metalness: 0.14,
  });

  // Identifiable materials reserved strictly for mounted electronic/sensor modules (Camera, LCD, Mic, Ultrasonic)
  const matSensorHousing = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.52,
    metalness: 0.35,
  });
  const matSensorMetal = new THREE.MeshStandardMaterial({
    color: 0xd4d4d8,
    roughness: 0.22,
    metalness: 0.85,
  });

  const chassisPartMeshes: Record<string, THREE.Mesh[]> = {};
  const registerChassisMesh = (
    partName: string,
    mesh: THREE.Mesh,
    colorTheme: RobotStructureColor
  ) => {
    mesh.userData.structureColor = colorTheme;
    if (!chassisPartMeshes[partName]) chassisPartMeshes[partName] = [];
    chassisPartMeshes[partName].push(mesh);
    tagSelectable(mesh, { kind: 'chassis', partName }, selectableMeshes);
  };

  const { chassisLength, chassisWidth, chassisHeight } = ROBOT_DIMS;

  // 1. CENTRAL CHASSIS — STRICTLY GREEN & BLUE PANELS AND STRUCTURAL CORE
  // A) Green Top Deck Panel
  const topDeckGeo = new THREE.BoxGeometry(chassisWidth * 0.96, 0.018, chassisLength * 0.62);
  const topDeckMesh = new THREE.Mesh(topDeckGeo, matGreenPrimary.clone());
  topDeckMesh.position.set(0, chassisHeight * 0.46, 0);
  chassisGroup.add(topDeckMesh);
  registerChassisMesh('Green Upper Deck Panel', topDeckMesh, 'green');

  // Blue structural ribs on Top Deck
  for (let i = -2; i <= 2; i++) {
    const rib = new THREE.Mesh(
      new THREE.BoxGeometry(chassisWidth * 0.55, 0.005, 0.012),
      matBluePrimary.clone()
    );
    rib.position.set(0, chassisHeight * 0.56, i * 0.042);
    chassisGroup.add(rib);
    registerChassisMesh('Blue Deck Rib', rib, 'blue');
  }

  // B) Green Angled Front Head / Snout Cowl
  const snoutShape = new THREE.Shape();
  snoutShape.moveTo(0, -0.042);
  snoutShape.lineTo(0.088, -0.032);
  snoutShape.lineTo(0.112, 0.038);
  snoutShape.lineTo(0, 0.052);
  snoutShape.closePath();
  const snoutGeo = new THREE.ExtrudeGeometry(snoutShape, {
    depth: chassisWidth * 0.88,
    bevelEnabled: true,
    bevelSegments: 3,
    bevelSize: 0.004,
    bevelThickness: 0.004,
  });
  snoutGeo.rotateY(-Math.PI / 2);
  snoutGeo.translate((chassisWidth * 0.88) / 2, 0, chassisLength * 0.36);
  const snoutMesh = new THREE.Mesh(snoutGeo, matGreenPrimary.clone());
  chassisGroup.add(snoutMesh);
  registerChassisMesh('Green Front Nose Panel', snoutMesh, 'green');

  // C) Green Rear Tail End Cap
  const tailGeo = new THREE.BoxGeometry(chassisWidth * 0.86, chassisHeight * 0.78, 0.068);
  const tailMesh = new THREE.Mesh(tailGeo, matGreenPrimary.clone());
  tailMesh.position.set(0, 0.004, -chassisLength * 0.44);
  chassisGroup.add(tailMesh);
  registerChassisMesh('Green Rear Cap Panel', tailMesh, 'green');

  // D) Blue Left & Right Structural Side Panels
  const sidePanelGeo = new THREE.BoxGeometry(0.014, chassisHeight * 0.82, chassisLength * 0.56);
  const leftBluePanel = new THREE.Mesh(sidePanelGeo, matBluePrimary.clone());
  leftBluePanel.position.set(chassisWidth * 0.48, -0.002, 0);
  chassisGroup.add(leftBluePanel);
  registerChassisMesh('Blue Left Side Panel', leftBluePanel, 'blue');

  const rightBluePanel = new THREE.Mesh(sidePanelGeo, matBluePrimary.clone());
  rightBluePanel.position.set(-chassisWidth * 0.48, -0.002, 0);
  chassisGroup.add(rightBluePanel);
  registerChassisMesh('Blue Right Side Panel', rightBluePanel, 'blue');

  // E) Blue Lower Belly Chassis Plate, Top Mounting Rail & Inner Spine Frame
  const bellyGeo = new THREE.BoxGeometry(chassisWidth * 0.92, 0.016, chassisLength * 0.88);
  const bellyMesh = new THREE.Mesh(bellyGeo, matBluePrimary.clone());
  bellyMesh.position.set(0, -chassisHeight * 0.44, 0);
  chassisGroup.add(bellyMesh);
  registerChassisMesh('Blue Lower Belly Panel', bellyMesh, 'blue');

  const railMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.036, 0.008, 0.22),
    matBlueCover.clone()
  );
  railMesh.position.set(0, chassisHeight * 0.58, 0.08);
  chassisGroup.add(railMesh);
  registerChassisMesh('Blue Top Mounting Rail', railMesh, 'blue');

  const coreCage = new THREE.Mesh(
    new THREE.BoxGeometry(chassisWidth * 0.72, chassisHeight * 0.68, chassisLength * 0.82),
    matBlueCover.clone()
  );
  chassisGroup.add(coreCage);
  registerChassisMesh('Blue Inner Chassis Frame', coreCage, 'blue');

  // Mounted Front Ultrasonic HC-SR04 Distance Sensor Module (identifiable mounted sensor)
  const ultrasonicSensorGroup = new THREE.Group();
  ultrasonicSensorGroup.name = 'UltrasonicSensorModule';
  chassisGroup.add(ultrasonicSensorGroup);

  const sonarPcb = new THREE.Mesh(
    new THREE.BoxGeometry(0.078, 0.028, 0.006),
    new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.45, metalness: 0.2 })
  );
  sonarPcb.position.set(0, -0.018, chassisLength * 0.512);
  ultrasonicSensorGroup.add(sonarPcb);

  [-0.024, 0.024].forEach((ux) => {
    const sonarBarrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.011, 0.011, 0.016, 20),
      matSensorMetal.clone()
    );
    sonarBarrel.rotation.x = Math.PI / 2;
    sonarBarrel.position.set(ux, -0.018, chassisLength * 0.522);
    ultrasonicSensorGroup.add(sonarBarrel);

    const sonarMeshCore = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.008, 0.017, 16),
      matSensorHousing.clone()
    );
    sonarMeshCore.rotation.x = Math.PI / 2;
    sonarMeshCore.position.set(ux, -0.018, chassisLength * 0.523);
    ultrasonicSensorGroup.add(sonarMeshCore);
  });
  ultrasonicSensorGroup.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) {
      c.userData.mountedComponent = 'ultrasonic';
      c.castShadow = true;
    }
  });

  // 2. FOUR ARTICULATED LEGS
  // Exactly two complete legs are GREEN (FL, BL) and two complete legs are BLUE (FR, BR).
  // Upper leg, lower leg, visible joint covers, brackets, and foot pads match each leg's color.
  const legColorScheme: Record<LegId, RobotStructureColor> = {
    FL: 'green',
    BL: 'green',
    FR: 'blue',
    BR: 'blue',
  };

  const legs = {} as Record<LegId, LegRigRefs>;
  const channelPivotMap: Record<number, THREE.Group> = {};
  const channelMeshesMap: Record<number, THREE.Mesh[]> = {};

  const upperGeo = createRoundedLinkGeometry(
    ROBOT_DIMS.upperLegLength,
    0.031,
    0.025,
    0.028
  );
  const lowerGeo = createRoundedLinkGeometry(
    ROBOT_DIMS.lowerLegLength,
    0.021,
    0.015,
    0.02
  );

  const legConfigs: Array<{ id: LegId; signX: number; signZ: number }> = [
    { id: 'FL', signX: 1, signZ: 1 },
    { id: 'FR', signX: -1, signZ: 1 },
    { id: 'BL', signX: 1, signZ: -1 },
    { id: 'BR', signX: -1, signZ: -1 },
  ];

  for (const cfg of legConfigs) {
    const legTheme = legColorScheme[cfg.id];
    const linkMatBase = legTheme === 'green' ? matGreenPrimary : matBluePrimary;
    const coverMatBase = legTheme === 'green' ? matGreenCover : matBlueCover;

    const [abdCh, hipCh, kneeCh] = LEG_CHANNELS_MAP[cfg.id];
    channelMeshesMap[abdCh] = [];
    channelMeshesMap[hipCh] = [];
    channelMeshesMap[kneeCh] = [];

    const tagLegMesh = (mesh: THREE.Mesh, ch: number) => {
      mesh.userData.structureColor = legTheme;
      mesh.userData.legId = cfg.id;
      channelMeshesMap[ch].push(mesh);
      tagSelectable(mesh, { kind: 'joint', channel: ch }, selectableMeshes);
    };

    // Shoulder/Hip chassis mount socket
    const legSocket = new THREE.Group();
    legSocket.name = `LegSocket_${cfg.id}`;
    legSocket.position.set(
      cfg.signX * ROBOT_DIMS.hipOffsetX,
      0.002,
      cfg.signZ * ROBOT_DIMS.hipOffsetZ
    );
    chassisGroup.add(legSocket);

    // Shoulder servo cover + matching color cable conduit
    const chassisServo = new THREE.Mesh(
      new THREE.BoxGeometry(0.042, 0.04, 0.054),
      coverMatBase.clone()
    );
    chassisServo.userData.structureColor = legTheme;
    chassisServo.userData.legId = cfg.id;
    chassisServo.position.set(-cfg.signX * 0.015, 0.005, 0);
    legSocket.add(chassisServo);

    for (let wIdx = 0; wIdx < 2; wIdx++) {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-cfg.signX * 0.02, 0.022, (wIdx - 0.5) * 0.005),
        new THREE.Vector3(cfg.signX * 0.005, 0.055, (wIdx - 0.5) * 0.005 - cfg.signZ * 0.018),
        new THREE.Vector3(-cfg.signX * 0.032, 0.035, -cfg.signZ * 0.046),
      ]);
      const wireMesh = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 12, 0.002, 6, false),
        coverMatBase.clone()
      );
      wireMesh.userData.structureColor = legTheme;
      wireMesh.userData.legId = cfg.id;
      legSocket.add(wireMesh);
    }

    // --- JOINT 1: ABDUCTION PIVOT (rotates around local Z) ---
    const abductionPivot = new THREE.Group();
    abductionPivot.name = `Pivot_CH${abdCh}_${cfg.id}_Abduction`;
    legSocket.add(abductionPivot);
    channelPivotMap[abdCh] = abductionPivot;

    const abdHorn = new THREE.Mesh(
      new THREE.CylinderGeometry(0.013, 0.013, 0.008, 18),
      coverMatBase.clone()
    );
    abdHorn.rotation.x = Math.PI / 2;
    abdHorn.position.set(0, 0, cfg.signZ * 0.028);
    abductionPivot.add(abdHorn);

    const abdBracket = new THREE.Mesh(
      new THREE.BoxGeometry(ROBOT_DIMS.shoulderOutsetX + 0.018, 0.046, 0.052),
      linkMatBase.clone()
    );
    abdBracket.position.set(cfg.signX * (ROBOT_DIMS.shoulderOutsetX * 0.45), 0, 0);
    abductionPivot.add(abdBracket);

    const hipServoCover = new THREE.Mesh(
      new THREE.BoxGeometry(0.036, 0.042, 0.046),
      coverMatBase.clone()
    );
    hipServoCover.position.set(cfg.signX * (ROBOT_DIMS.shoulderOutsetX * 0.72), 0, 0);
    abductionPivot.add(hipServoCover);

    [abdHorn, abdBracket, hipServoCover].forEach((m) => tagLegMesh(m, abdCh));

    // --- JOINT 2: HIP PITCH PIVOT (rotates around local X) ---
    const hipPivot = new THREE.Group();
    hipPivot.name = `Pivot_CH${hipCh}_${cfg.id}_Hip`;
    hipPivot.position.set(cfg.signX * ROBOT_DIMS.shoulderOutsetX, 0, 0);
    abductionPivot.add(hipPivot);
    channelPivotMap[hipCh] = hipPivot;

    // Upper Leg Link + Hip & Knee Joint Covers in consistent leg color
    const upperLegMesh = new THREE.Mesh(upperGeo, linkMatBase.clone());
    hipPivot.add(upperLegMesh);

    const hipJointCover = new THREE.Mesh(
      new THREE.CylinderGeometry(0.016, 0.016, 0.033, 20),
      coverMatBase.clone()
    );
    hipJointCover.rotation.z = Math.PI / 2;
    hipPivot.add(hipJointCover);

    const kneeJointCoverOuter = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.015, 0.033, 20),
      coverMatBase.clone()
    );
    kneeJointCoverOuter.rotation.z = Math.PI / 2;
    kneeJointCoverOuter.position.set(0, -ROBOT_DIMS.upperLegLength, 0);
    hipPivot.add(kneeJointCoverOuter);

    const kneeJointCap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.007, 0.007, 0.036, 14),
      linkMatBase.clone()
    );
    kneeJointCap.rotation.z = Math.PI / 2;
    kneeJointCap.position.set(0, -ROBOT_DIMS.upperLegLength, 0);
    hipPivot.add(kneeJointCap);

    const kneeActuatorCover = new THREE.Mesh(
      new THREE.BoxGeometry(0.024, 0.044, 0.038),
      coverMatBase.clone()
    );
    kneeActuatorCover.position.set(-cfg.signX * 0.004, -ROBOT_DIMS.upperLegLength + 0.035, -0.006);
    hipPivot.add(kneeActuatorCover);

    [
      upperLegMesh,
      hipJointCover,
      kneeJointCoverOuter,
      kneeJointCap,
      kneeActuatorCover,
    ].forEach((m) => tagLegMesh(m, hipCh));

    // --- JOINT 3: KNEE PITCH PIVOT (rotates around local X at distal end of Upper Leg) ---
    const kneePivot = new THREE.Group();
    kneePivot.name = `Pivot_CH${kneeCh}_${cfg.id}_Knee`;
    kneePivot.position.set(0, -ROBOT_DIMS.upperLegLength, 0);
    hipPivot.add(kneePivot);
    channelPivotMap[kneeCh] = kneePivot;

    // Lower Leg Link + Ankle Cover + Foot Pad in consistent leg color
    const lowerLegMesh = new THREE.Mesh(lowerGeo, linkMatBase.clone());
    kneePivot.add(lowerLegMesh);

    const ankleBracket = new THREE.Mesh(
      new THREE.BoxGeometry(0.026, 0.024, 0.024),
      coverMatBase.clone()
    );
    ankleBracket.position.set(0, -ROBOT_DIMS.lowerLegLength + 0.008, 0);
    kneePivot.add(ankleBracket);

    const footOuterPad = new THREE.Mesh(
      new THREE.CylinderGeometry(
        ROBOT_DIMS.footRadius,
        ROBOT_DIMS.footRadius,
        0.022,
        24
      ),
      coverMatBase.clone()
    );
    footOuterPad.rotation.z = Math.PI / 2;
    footOuterPad.position.set(0, -ROBOT_DIMS.lowerLegLength, 0);
    kneePivot.add(footOuterPad);

    const footInnerDisk = new THREE.Mesh(
      new THREE.CylinderGeometry(
        ROBOT_DIMS.footRadius * 0.68,
        ROBOT_DIMS.footRadius * 0.68,
        0.024,
        20
      ),
      linkMatBase.clone()
    );
    footInnerDisk.rotation.z = Math.PI / 2;
    footInnerDisk.position.set(0, -ROBOT_DIMS.lowerLegLength, 0);
    kneePivot.add(footInnerDisk);

    const anklePinCover = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0045, 0.0045, 0.028, 12),
      coverMatBase.clone()
    );
    anklePinCover.rotation.z = Math.PI / 2;
    anklePinCover.position.set(0, -ROBOT_DIMS.lowerLegLength + 0.012, 0);
    kneePivot.add(anklePinCover);

    const footTip = new THREE.Object3D();
    footTip.position.set(0, -ROBOT_DIMS.lowerLegLength - ROBOT_DIMS.footRadius, 0);
    kneePivot.add(footTip);

    [lowerLegMesh, ankleBracket, footOuterPad, footInnerDisk, anklePinCover].forEach((m) =>
      tagLegMesh(m, kneeCh)
    );

    legs[cfg.id] = {
      legId: cfg.id,
      colorTheme: legTheme,
      abductionPivot,
      hipPivot,
      kneePivot,
      footTip,
      jointAnchors: [abductionPivot, hipPivot, kneePivot],
      channelMeshes: {
        [abdCh]: channelMeshesMap[abdCh],
        [hipCh]: channelMeshesMap[hipCh],
        [kneeCh]: channelMeshesMap[kneeCh],
      },
    };
  }

  // 3. ATTACHABLE CAMERA MODULE + EMBEDDED VIRTUAL CAMERA (Identifiable Mounted Module)
  const cameraModuleGroup = new THREE.Group();
  cameraModuleGroup.name = 'CameraModule';
  chassisGroup.add(cameraModuleGroup);

  const camHousing = new THREE.Mesh(
    new THREE.BoxGeometry(0.068, 0.024, 0.026),
    matSensorHousing.clone()
  );
  cameraModuleGroup.add(camHousing);

  const camMountFoot = new THREE.Mesh(
    new THREE.BoxGeometry(0.024, 0.016, 0.022),
    matSensorMetal.clone()
  );
  camMountFoot.position.set(0, -0.016, -0.004);
  cameraModuleGroup.add(camMountFoot);

  const camLensMat = new THREE.MeshPhysicalMaterial({
    color: 0x0f172a,
    roughness: 0.08,
    metalness: 0.2,
    clearcoat: 1.0,
  });
  [-0.018, 0.018].forEach((lx) => {
    const bezel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0085, 0.0095, 0.008, 20),
      matSensorMetal.clone()
    );
    bezel.rotation.x = Math.PI / 2;
    bezel.position.set(lx, 0, 0.014);
    cameraModuleGroup.add(bezel);

    const glass = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0065, 0.0065, 0.009, 18),
      camLensMat
    );
    glass.rotation.x = Math.PI / 2;
    glass.position.set(lx, 0, 0.0145);
    cameraModuleGroup.add(glass);
  });

  const cameraDetachedStand = new THREE.Group();
  const camStandPole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.006, 0.008, 0.44, 12),
    matSensorHousing.clone()
  );
  camStandPole.position.set(0, -0.22, 0);
  const camStandBase = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.08, 0.014, 20),
    matSensorHousing.clone()
  );
  camStandBase.position.set(0, -0.44, 0);
  cameraDetachedStand.add(camStandPole, camStandBase);
  cameraDetachedStand.visible = false;
  cameraModuleGroup.add(cameraDetachedStand);

  tagSelectable(cameraModuleGroup, { kind: 'module', moduleId: 'camera' }, selectableMeshes);

  const robotCamera = new THREE.PerspectiveCamera(62, 16 / 10, 0.04, 25);
  robotCamera.position.set(0, 0, 0.022);
  robotCamera.rotation.y = Math.PI;
  cameraModuleGroup.add(robotCamera);

  // 4. ATTACHABLE / DETACHABLE LCD DISPLAY MODULE (Identifiable Mounted Module)
  const lcdModuleGroup = new THREE.Group();
  lcdModuleGroup.name = 'LcdModule';
  chassisGroup.add(lcdModuleGroup);

  const lcdBezel = new THREE.Mesh(
    new THREE.BoxGeometry(0.096, 0.052, 0.014),
    matSensorHousing.clone()
  );
  lcdModuleGroup.add(lcdBezel);

  const lcdPcb = new THREE.Mesh(
    new THREE.BoxGeometry(0.102, 0.056, 0.004),
    new THREE.MeshStandardMaterial({ color: 0x065f46, roughness: 0.5, metalness: 0.2 })
  );
  lcdPcb.position.set(0, 0, -0.008);
  lcdModuleGroup.add(lcdPcb);

  const lcdScreenMat = new THREE.MeshStandardMaterial({
    map: lcdTexture,
    emissive: new THREE.Color(0xffffff),
    emissiveMap: lcdTexture,
    emissiveIntensity: 0.72,
    roughness: 0.22,
    metalness: 0.05,
  });
  const lcdScreenMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.084, 0.042), lcdScreenMat);
  lcdScreenMesh.position.set(0, 0, 0.0076);
  lcdModuleGroup.add(lcdScreenMesh);

  const lcdDetachedStand = new THREE.Group();
  const lcdPedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(0.006, 0.008, 0.26, 12),
    matSensorHousing.clone()
  );
  lcdPedestal.position.set(0, -0.13, -0.01);
  const lcdBase = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.014, 0.1),
    matSensorHousing.clone()
  );
  lcdBase.position.set(0, -0.26, -0.01);
  lcdDetachedStand.add(lcdPedestal, lcdBase);
  lcdDetachedStand.visible = false;
  lcdModuleGroup.add(lcdDetachedStand);

  tagSelectable(lcdModuleGroup, { kind: 'module', moduleId: 'lcd' }, selectableMeshes);

  // 5. ATTACHABLE MICROPHONE MODULE (Identifiable Mounted Module)
  const micModuleGroup = new THREE.Group();
  micModuleGroup.name = 'MicModule';
  chassisGroup.add(micModuleGroup);

  const micStem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.005, 0.007, 0.022, 14),
    matSensorMetal.clone()
  );
  micStem.position.set(0, -0.01, 0);
  micModuleGroup.add(micStem);

  const micBody = new THREE.Mesh(
    new THREE.CylinderGeometry(0.018, 0.018, 0.014, 24),
    matSensorHousing.clone()
  );
  micBody.position.set(0, 0.006, 0);
  micModuleGroup.add(micBody);

  const micGrille = new THREE.Mesh(
    new THREE.SphereGeometry(0.015, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55),
    matSensorMetal.clone()
  );
  micGrille.position.set(0, 0.012, 0);
  micModuleGroup.add(micGrille);

  const micRingMat = new THREE.MeshStandardMaterial({
    color: 0x475569,
    emissive: 0x000000,
    emissiveIntensity: 0.8,
    roughness: 0.3,
  });
  const micRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.0185, 0.0022, 10, 28),
    micRingMat
  );
  micRing.rotation.x = Math.PI / 2;
  micRing.position.set(0, 0.011, 0);
  micModuleGroup.add(micRing);

  const micDetachedStand = new THREE.Group();
  const micPole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.005, 0.007, 0.21, 12),
    matSensorHousing.clone()
  );
  micPole.position.set(0, -0.11, 0);
  const micBase = new THREE.Mesh(
    new THREE.CylinderGeometry(0.055, 0.065, 0.012, 20),
    matSensorHousing.clone()
  );
  micBase.position.set(0, -0.215, 0);
  micDetachedStand.add(micPole, micBase);
  micDetachedStand.visible = false;
  micModuleGroup.add(micDetachedStand);

  tagSelectable(micModuleGroup, { kind: 'module', moduleId: 'microphone' }, selectableMeshes);

  // 6. 3D JOINT AXIS PROTRACTOR / HIGHLIGHT RING FOR SELECTED JOINT
  const jointHighlightRing = new THREE.Group();
  const torus = new THREE.Mesh(
    new THREE.TorusGeometry(0.044, 0.0028, 12, 36),
    new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
  );
  const needle = new THREE.Mesh(
    new THREE.BoxGeometry(0.004, 0.048, 0.004),
    new THREE.MeshBasicMaterial({ color: 0x22c55e })
  );
  needle.position.set(0, -0.024, 0);
  jointHighlightRing.add(torus, needle);
  jointHighlightRing.visible = false;
  sceneSafeDisableRaycast(jointHighlightRing);

  return {
    rootGroup,
    chassisGroup,
    legs,
    legColorScheme,
    channelPivotMap,
    channelMeshesMap,
    chassisPartMeshes,
    ultrasonicSensorGroup,
    cameraModuleGroup,
    cameraDetachedStand,
    robotCamera,
    lcdModuleGroup,
    lcdScreenMesh,
    lcdDetachedStand,
    micModuleGroup,
    micRingMat,
    micDetachedStand,
    jointHighlightRing,
    selectableMeshes,
  };
}

function sceneSafeDisableRaycast(group: THREE.Object3D) {
  group.traverse((c) => {
    c.raycast = () => {};
  });
}
