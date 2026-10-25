import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  BodyPose,
  CameraModuleConfig,
  CameraViewMode,
  GaitConfig,
  LabSceneObject,
  LcdModuleConfig,
  LegTestState,
  LightingPreset,
  MicModuleConfig,
  NavigationConfigAndState,
  PosePreset,
  SelectableTarget,
  SensorTelemetry,
  ServoChannel,
  SimulatedDetection,
  TransformGizmoMode,
  ViewportToolMode,
} from '../types/simulator';
import { buildKukurModel, KukurModelRig } from '../three/buildKukurModel';
import { createLabObjectGroup } from '../three/buildLabObjects';
import {
  buildLcdLines,
  createLcdTextureBundle,
  drawLcdCanvas,
} from '../three/lcdTexture';
import {
  clampChannelAngle,
  computeGaitTargets,
  computeJointRadians,
  computeSingleLegTestTargets,
  detectSceneCollisions,
  resolveSolidBodyMovement,
} from '../simulation/kinematics';
import {
  checkRobotPoseCollision,
  getObstacleLocalDimensions,
} from '../simulation/collision';
import {
  isRobotLiftedOffFloor,
  scanNavigationSensors,
  stepAutonomousNavigation,
} from '../simulation/navigation';
import {
  computeSimulatedImu,
  computeSimulatedUltrasonicCm,
  computeVirtualDetections,
} from '../simulation/sensors';
import {
  AlertOctagon,
  Box,
  Compass,
  Crosshair,
  Eye,
  Grid,
  Layers,
  Maximize2,
  Minimize2,
  Move,
  MousePointer,
  Navigation,
  Plus,
  Radar,
  RotateCw,
  Scan,
  ShieldAlert,
  SquareStack,
  UserPlus,
  Wrench,
} from 'lucide-react';

interface Viewport3DProps {
  channels: ServoChannel[];
  onUpdateChannelsFromSim: (targets: number[], simulatedCurrent?: number[]) => void;
  bodyPose: BodyPose;
  onUpdateBodyPose: (patch: Partial<BodyPose>) => void;
  onUpdateBodyPoseFromSim: (pose: BodyPose) => void;
  manualPoseToken: number;
  posePreset: PosePreset;
  gait: GaitConfig;
  onStopGaitBeforeCollision: () => void;
  legTest: LegTestState;
  navigation: NavigationConfigAndState;
  onUpdateNavigation: (patch: Partial<NavigationConfigAndState>) => void;
  scenarioResetToken: number;
  cameraModule: CameraModuleConfig;
  onUpdateCameraModule: (patch: Partial<CameraModuleConfig>) => void;
  lcdModule: LcdModuleConfig;
  onUpdateLcdModule: (patch: Partial<LcdModuleConfig>) => void;
  micModule: MicModuleConfig;
  onUpdateMicModule: (patch: Partial<MicModuleConfig>) => void;
  labObjects: LabSceneObject[];
  onUpdateLabObject: (id: string, patch: Partial<LabSceneObject>) => void;
  onSpawnLabObject: (type: LabSceneObject['type']) => void;
  selectedTarget: SelectableTarget;
  onSelectTarget: (target: SelectableTarget) => void;
  attachmentMode: boolean;
  onToggleAttachmentMode: () => void;
  cameraViewMode: CameraViewMode;
  onChangeCameraViewMode: (mode: CameraViewMode) => void;
  lightingPreset: LightingPreset;
  lightIntensity: number;
  shadowsEnabled: boolean;
  visualKinematicGain: number;
  telemetry: SensorTelemetry;
  onUpdateLiveTelemetry: (
    patch: Partial<SensorTelemetry>,
    detections: SimulatedDetection[],
    collidingIds: string[]
  ) => void;
  detections: SimulatedDetection[];
  robotFeedCanvasRef: React.RefObject<HTMLCanvasElement | null>;
}

const SENSOR_RAY_POOL_SIZE = 9;

const detectSoftwareGl = (): boolean => {
  try {
    const probeCanvas = document.createElement('canvas');
    const gl = probeCanvas.getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return false;
  }
};

export const Viewport3D: React.FC<Viewport3DProps> = ({
  channels,
  onUpdateChannelsFromSim,
  bodyPose,
  onUpdateBodyPose,
  onUpdateBodyPoseFromSim,
  manualPoseToken,
  posePreset,
  gait,
  onStopGaitBeforeCollision,
  legTest,
  navigation,
  onUpdateNavigation,
  scenarioResetToken,
  cameraModule,
  onUpdateCameraModule,
  lcdModule,
  onUpdateLcdModule,
  micModule,
  onUpdateMicModule,
  labObjects,
  onUpdateLabObject,
  onSpawnLabObject,
  selectedTarget,
  onSelectTarget,
  attachmentMode,
  onToggleAttachmentMode,
  cameraViewMode,
  onChangeCameraViewMode,
  lightingPreset,
  lightIntensity,
  shadowsEnabled,
  visualKinematicGain,
  telemetry,
  onUpdateLiveTelemetry,
  detections,
  robotFeedCanvasRef,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const splitOverlayCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [viewportTool, setViewportTool] = useState<ViewportToolMode>('select');
  const [gizmoMode, setGizmoMode] = useState<TransformGizmoMode>('translate');
  const [showChannelLabels, setShowChannelLabels] = useState<boolean>(false);
  const [showCollisionWireframes, setShowCollisionWireframes] = useState<boolean>(true);
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [dockCollapsed, setDockCollapsed] = useState<boolean>(false);
  const [marqueeRect, setMarqueeRect] = useState<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  } | null>(null);
  const [projectedLabels, setProjectedLabels] = useState<
    Array<{ channel: number; x: number; y: number; visible: boolean; angle: number }>
  >([]);
  const [webglError, setWebglError] = useState<string | null>(null);

  // Store latest props in mutable ref so WebGL loop never tears down on React state updates
  const latestRef = useRef({
    channels,
    onUpdateChannelsFromSim,
    bodyPose,
    onUpdateBodyPose,
    onUpdateBodyPoseFromSim,
    manualPoseToken,
    posePreset,
    gait,
    onStopGaitBeforeCollision,
    legTest,
    navigation,
    onUpdateNavigation,
    scenarioResetToken,
    cameraModule,
    onUpdateCameraModule,
    lcdModule,
    onUpdateLcdModule,
    micModule,
    onUpdateMicModule,
    labObjects,
    onUpdateLabObject,
    selectedTarget,
    onSelectTarget,
    attachmentMode,
    cameraViewMode,
    lightingPreset,
    lightIntensity,
    shadowsEnabled,
    visualKinematicGain,
    telemetry,
    onUpdateLiveTelemetry,
    viewportTool,
    gizmoMode,
    showChannelLabels,
    showCollisionWireframes,
    showGrid,
  });

  latestRef.current = {
    channels,
    onUpdateChannelsFromSim,
    bodyPose,
    onUpdateBodyPose,
    onUpdateBodyPoseFromSim,
    manualPoseToken,
    posePreset,
    gait,
    onStopGaitBeforeCollision,
    legTest,
    navigation,
    onUpdateNavigation,
    scenarioResetToken,
    cameraModule,
    onUpdateCameraModule,
    lcdModule,
    onUpdateLcdModule,
    micModule,
    onUpdateMicModule,
    labObjects,
    onUpdateLabObject,
    selectedTarget,
    onSelectTarget,
    attachmentMode,
    cameraViewMode,
    lightingPreset,
    lightIntensity,
    shadowsEnabled,
    visualKinematicGain,
    telemetry,
    onUpdateLiveTelemetry,
    viewportTool,
    gizmoMode,
    showChannelLabels,
    showCollisionWireframes,
    showGrid,
  };

  const cameraPresetGoalRef = useRef<{
    pos: THREE.Vector3;
    target: THREE.Vector3;
  } | null>(null);

  const jumpCameraPreset = (preset: 'iso' | 'front' | 'side' | 'top') => {
    const bp = latestRef.current.bodyPose;
    const yawRad = THREE.MathUtils.degToRad(bp.yaw);
    const fwdX = Math.sin(yawRad);
    const fwdZ = Math.cos(yawRad);
    const leftX = Math.cos(yawRad);
    const leftZ = -Math.sin(yawRad);
    const t = new THREE.Vector3(bp.x + fwdX * 0.12, bp.y * 0.78, bp.z + fwdZ * 0.12);
    if (preset === 'front') {
      cameraPresetGoalRef.current = {
        pos: new THREE.Vector3(
          bp.x + fwdX * 1.08,
          bp.y + 0.28,
          bp.z + fwdZ * 1.08
        ),
        target: t,
      };
    } else if (preset === 'side') {
      cameraPresetGoalRef.current = {
        pos: new THREE.Vector3(
          bp.x + leftX * 1.18 + fwdX * 0.05,
          bp.y + 0.24,
          bp.z + leftZ * 1.18 + fwdZ * 0.05
        ),
        target: t,
      };
    } else if (preset === 'top') {
      cameraPresetGoalRef.current = {
        pos: new THREE.Vector3(
          bp.x - fwdX * 0.15,
          bp.y + 2.35,
          bp.z - fwdZ * 0.15
        ),
        target: t,
      };
    } else {
      cameraPresetGoalRef.current = {
        pos: new THREE.Vector3(
          bp.x + leftX * 1.62 + fwdX * 0.68,
          bp.y + 0.76,
          bp.z + leftZ * 1.62 + fwdZ * 0.68
        ),
        target: new THREE.Vector3(bp.x + fwdX * 0.45, bp.y * 0.85, bp.z + fwdZ * 0.45),
      };
    }
  };

  const sceneCtxRef = useRef<{
    scene: THREE.Scene;
    orbitCamera: THREE.PerspectiveCamera;
    orbitControls: OrbitControls;
    transformControls: TransformControls;
    rig: KukurModelRig;
    lcdCanvas: HTMLCanvasElement;
    lcdTexture: THREE.CanvasTexture;
    gridHelper: THREE.GridHelper;
    keyLight: THREE.DirectionalLight;
    hemiLight: THREE.HemisphereLight;
    rimLight: THREE.DirectionalLight;
    contactShadowMesh: THREE.Mesh;
    sensorRaysGroup: THREE.Group;
    labObjectGroups: Map<
      string,
      {
        group: THREE.Group;
        collisionBox: THREE.LineSegments;
        collisionMat: THREE.LineBasicMaterial;
        type: LabSceneObject['type'];
      }
    >;
    labSelectableMeshes: THREE.Object3D[];
  } | null>(null);

  // Initialize Three.js once
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareGl();
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        powerPreference: 'high-performance',
      });
    } catch (err) {
      setWebglError(err instanceof Error ? err.message : 'WebGL initialization failed');
      return;
    }

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = !isSoftwareGl && latestRef.current.shadowsEnabled;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const initW = Math.max(container.clientWidth, 320);
    const initH = Math.max(container.clientHeight, 240);
    renderer.setSize(initW, initH);
    renderer.domElement.className = 'block w-full h-full outline-none';
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const onContextLost = (e: Event) => {
      e.preventDefault();
      setWebglError('WebGL context lost — click Reset Pose or reload viewport.');
    };
    const onContextRestored = () => setWebglError(null);
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', onContextRestored);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1120);
    scene.fog = new THREE.FogExp2(0x0b1120, 0.065);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    const orbitCamera = new THREE.PerspectiveCamera(48, initW / initH, 0.05, 45);
    orbitCamera.position.set(2.02, 1.16, 0.86);

    const orbitControls = new OrbitControls(orbitCamera, renderer.domElement);
    orbitControls.enableDamping = !isSoftwareGl;
    orbitControls.dampingFactor = 0.08;
    orbitControls.maxPolarAngle = Math.PI * 0.495;
    orbitControls.minDistance = 0.32;
    orbitControls.maxDistance = 9.5;
    orbitControls.target.set(0.06, 0.36, 0.72);
    orbitControls.update();

    orbitControls.addEventListener('start', () => {
      cameraPresetGoalRef.current = null;
    });

    // TransformControls Gizmo (Three.js r169+ getHelper())
    const transformControls = new TransformControls(orbitCamera, renderer.domElement);
    transformControls.setSize(0.72);
    const transformHelper = transformControls.getHelper();
    scene.add(transformHelper);

    let isGizmoDragging = false;
    transformControls.addEventListener('dragging-changed', (ev) => {
      isGizmoDragging = Boolean(ev.value);
      orbitControls.enabled = !isGizmoDragging;
    });

    transformControls.addEventListener('objectChange', () => {
      const attachedObj = transformControls.object;
      if (!attachedObj) return;
      const st = latestRef.current;

      if (attachedObj === rig.rootGroup) {
        const candidatePose: BodyPose = {
          x: Math.round(attachedObj.position.x * 1000) / 1000,
          y: Math.max(0.14, Math.round(attachedObj.position.y * 1000) / 1000),
          z: Math.round(attachedObj.position.z * 1000) / 1000,
          pitch: Math.round(THREE.MathUtils.radToDeg(attachedObj.rotation.x) * 10) / 10,
          yaw: Math.round(THREE.MathUtils.radToDeg(attachedObj.rotation.y) * 10) / 10,
          roll: Math.round(THREE.MathUtils.radToDeg(attachedObj.rotation.z) * 10) / 10,
        };
        const resolved = resolveSolidBodyMovement(
          st.bodyPose,
          candidatePose,
          st.channels,
          st.labObjects,
          st.visualKinematicGain
        );
        attachedObj.position.set(
          resolved.resolvedPose.x,
          resolved.resolvedPose.y,
          resolved.resolvedPose.z
        );
        attachedObj.rotation.set(
          THREE.MathUtils.degToRad(resolved.resolvedPose.pitch),
          THREE.MathUtils.degToRad(resolved.resolvedPose.yaw),
          THREE.MathUtils.degToRad(resolved.resolvedPose.roll),
          'YXZ'
        );
        st.onUpdateBodyPose(resolved.resolvedPose);
      } else if (attachedObj === rig.cameraModuleGroup) {
        const posTuple: [number, number, number] = [
          Math.round(attachedObj.position.x * 1000) / 1000,
          Math.round(attachedObj.position.y * 1000) / 1000,
          Math.round(attachedObj.position.z * 1000) / 1000,
        ];
        const rotTuple: [number, number, number] = [
          Math.round(THREE.MathUtils.radToDeg(attachedObj.rotation.x) * 10) / 10,
          Math.round(THREE.MathUtils.radToDeg(attachedObj.rotation.y) * 10) / 10,
          Math.round(THREE.MathUtils.radToDeg(attachedObj.rotation.z) * 10) / 10,
        ];
        if (st.cameraModule.attached) {
          st.onUpdateCameraModule({ mountPosition: posTuple, mountRotation: rotTuple });
        } else {
          st.onUpdateCameraModule({ worldPosition: posTuple, worldRotation: rotTuple });
        }
      } else if (attachedObj === rig.lcdModuleGroup) {
        const posTuple: [number, number, number] = [
          Math.round(attachedObj.position.x * 1000) / 1000,
          Math.round(attachedObj.position.y * 1000) / 1000,
          Math.round(attachedObj.position.z * 1000) / 1000,
        ];
        const rotTuple: [number, number, number] = [
          Math.round(THREE.MathUtils.radToDeg(attachedObj.rotation.x) * 10) / 10,
          Math.round(THREE.MathUtils.radToDeg(attachedObj.rotation.y) * 10) / 10,
          Math.round(THREE.MathUtils.radToDeg(attachedObj.rotation.z) * 10) / 10,
        ];
        if (st.lcdModule.attached) {
          st.onUpdateLcdModule({ mountPosition: posTuple, mountRotation: rotTuple });
        } else {
          st.onUpdateLcdModule({ worldPosition: posTuple, worldRotation: rotTuple });
        }
      } else if (attachedObj === rig.micModuleGroup) {
        const posTuple: [number, number, number] = [
          Math.round(attachedObj.position.x * 1000) / 1000,
          Math.round(attachedObj.position.y * 1000) / 1000,
          Math.round(attachedObj.position.z * 1000) / 1000,
        ];
        const rotTuple: [number, number, number] = [
          Math.round(THREE.MathUtils.radToDeg(attachedObj.rotation.x) * 10) / 10,
          Math.round(THREE.MathUtils.radToDeg(attachedObj.rotation.y) * 10) / 10,
          Math.round(THREE.MathUtils.radToDeg(attachedObj.rotation.z) * 10) / 10,
        ];
        if (st.micModule.attached) {
          st.onUpdateMicModule({ mountPosition: posTuple, mountRotation: rotTuple });
        } else {
          st.onUpdateMicModule({ worldPosition: posTuple, worldRotation: rotTuple });
        }
      } else if (st.selectedTarget?.kind === 'scene-object') {
        const id = st.selectedTarget.objectId;
        const prevObj = st.labObjects.find((o) => o.id === id);
        const nextPos: [number, number, number] = [
          Math.round(attachedObj.position.x * 100) / 100,
          Math.max(0, Math.round(attachedObj.position.y * 100) / 100),
          Math.round(attachedObj.position.z * 100) / 100,
        ];
        const nextRot: [number, number, number] = [
          Math.round(THREE.MathUtils.radToDeg(attachedObj.rotation.x)),
          Math.round(THREE.MathUtils.radToDeg(attachedObj.rotation.y)),
          Math.round(THREE.MathUtils.radToDeg(attachedObj.rotation.z)),
        ];
        const nextScale: [number, number, number] = [
          Math.max(0.25, Math.round(attachedObj.scale.x * 100) / 100),
          Math.max(0.25, Math.round(attachedObj.scale.y * 100) / 100),
          Math.max(0.25, Math.round(attachedObj.scale.z * 100) / 100),
        ];

        if (prevObj) {
          const candidateObjects = st.labObjects.map((o) =>
            o.id === id ? { ...o, position: nextPos, rotation: nextRot, scale: nextScale } : o
          );
          const wasColliding = checkRobotPoseCollision(
            st.bodyPose,
            st.channels,
            [prevObj],
            st.visualKinematicGain,
            0.01
          ).colliding;
          const wouldCollide = checkRobotPoseCollision(
            st.bodyPose,
            st.channels,
            candidateObjects,
            st.visualKinematicGain,
            0.01
          ).colliding;

          if (!wasColliding && wouldCollide) {
            attachedObj.position.set(prevObj.position[0], prevObj.position[1], prevObj.position[2]);
            attachedObj.rotation.set(
              THREE.MathUtils.degToRad(prevObj.rotation[0]),
              THREE.MathUtils.degToRad(prevObj.rotation[1]),
              THREE.MathUtils.degToRad(prevObj.rotation[2])
            );
            attachedObj.scale.set(prevObj.scale[0], prevObj.scale[1], prevObj.scale[2]);
            return;
          }
        }

        st.onUpdateLabObject(id, {
          position: nextPos,
          rotation: nextRot,
          scale: nextScale,
        });
      }
    });

    // 3-Point Studio Robotics Lab Lighting
    const hemiLight = new THREE.HemisphereLight(0x93c5fd, 0x1e293b, 0.75);
    hemiLight.position.set(0, 8, 0);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff7ed, 1.85);
    keyLight.position.set(3.2, 5.2, 3.6);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.set(1024, 1024);
    const sd = 4.2;
    keyLight.shadow.camera.left = -sd;
    keyLight.shadow.camera.right = sd;
    keyLight.shadow.camera.top = sd;
    keyLight.shadow.camera.bottom = -sd;
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 15;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x60a5fa, 0.75);
    rimLight.position.set(-3.0, 2.8, -2.8);
    scene.add(rimLight);

    // Laboratory Ground Plane + Metric Calibration Grid
    const floorGeo = new THREE.PlaneGeometry(24, 24);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.86,
      metalness: 0.08,
    });
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.y = -0.002;
    floorMesh.receiveShadow = true;
    scene.add(floorMesh);

    const gridHelper = new THREE.GridHelper(12, 24, 0x334155, 0x1e293b);
    gridHelper.position.y = 0.001;
    scene.add(gridHelper);

    // Decorative Laboratory Floor Markings (explicitly non-solid visual markings on floor)
    const floorMarkingsGroup = new THREE.Group();
    floorMarkingsGroup.name = 'DecorativeFloorMarkings';
    const startRing = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.45, 48),
      new THREE.MeshBasicMaterial({
        color: 0x1e3a8a,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.55,
      })
    );
    startRing.rotation.x = -Math.PI / 2;
    startRing.position.set(0, 0.0015, 0);
    floorMarkingsGroup.add(startRing);

    [-1.2, 1.2].forEach((laneX) => {
      const laneStripe = new THREE.Mesh(
        new THREE.PlaneGeometry(0.03, 6.0),
        new THREE.MeshBasicMaterial({
          color: 0x1e293b,
          transparent: true,
          opacity: 0.65,
        })
      );
      laneStripe.rotation.x = -Math.PI / 2;
      laneStripe.position.set(laneX, 0.0014, 0);
      floorMarkingsGroup.add(laneStripe);
    });
    floorMarkingsGroup.traverse((c) => {
      c.raycast = () => {};
    });
    scene.add(floorMarkingsGroup);

    const forwardArrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 0.004, 0.48),
      0.24,
      0x22c55e,
      0.06,
      0.04
    );
    forwardArrow.traverse((c) => {
      c.raycast = () => {};
    });
    scene.add(forwardArrow);

    // Soft radial contact shadow directly beneath robot chassis
    const contactCanvas = document.createElement('canvas');
    contactCanvas.width = 128;
    contactCanvas.height = 128;
    const cctx = contactCanvas.getContext('2d');
    if (cctx) {
      const g = cctx.createRadialGradient(64, 64, 8, 64, 64, 60);
      g.addColorStop(0, 'rgba(0,0,0,0.65)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      cctx.fillStyle = g;
      cctx.fillRect(0, 0, 128, 128);
    }
    const contactTex = new THREE.CanvasTexture(contactCanvas);
    const contactShadowMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.75, 0.95),
      new THREE.MeshBasicMaterial({
        map: contactTex,
        transparent: true,
        depthWrite: false,
        opacity: 0.55,
      })
    );
    contactShadowMesh.rotation.x = -Math.PI / 2;
    contactShadowMesh.position.y = 0.002;
    contactShadowMesh.raycast = () => {};
    scene.add(contactShadowMesh);

    // 3D Sensor Detection Rays & Hit Endpoint Markers Pool (Zero GC in loop)
    const sensorRaysGroup = new THREE.Group();
    sensorRaysGroup.name = 'NavigationSensorRays';
    const sensorRayLines: Array<{
      line: THREE.Line;
      positions: Float32Array;
      mat: THREE.LineBasicMaterial;
      hitDot: THREE.Mesh;
      dotMat: THREE.MeshBasicMaterial;
    }> = [];

    const dotGeo = new THREE.SphereGeometry(0.022, 12, 10);
    for (let i = 0; i < SENSOR_RAY_POOL_SIZE; i++) {
      const positions = new Float32Array(6);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const mat = new THREE.LineBasicMaterial({
        color: 0x10b981,
        transparent: true,
        opacity: 0.85,
      });
      const line = new THREE.Line(geo, mat);
      line.frustumCulled = false;
      line.raycast = () => {};

      const dotMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
      const hitDot = new THREE.Mesh(dotGeo, dotMat);
      hitDot.visible = false;
      hitDot.raycast = () => {};

      sensorRaysGroup.add(line, hitDot);
      sensorRayLines.push({ line, positions, mat, hitDot, dotMat });
    }
    scene.add(sensorRaysGroup);

    // Build KUKUR 3D Hierarchical Robot Model + LCD Texture
    const { canvas: lcdCanvas, texture: lcdTexture } = createLcdTextureBundle(
      renderer.capabilities.getMaxAnisotropy()
    );
    const rig = buildKukurModel(lcdTexture);
    scene.add(rig.rootGroup);

    const labObjectGroups = new Map<
      string,
      {
        group: THREE.Group;
        collisionBox: THREE.LineSegments;
        collisionMat: THREE.LineBasicMaterial;
        type: LabSceneObject['type'];
      }
    >();
    const labSelectableMeshes: THREE.Object3D[] = [];

    sceneCtxRef.current = {
      scene,
      orbitCamera,
      orbitControls,
      transformControls,
      rig,
      lcdCanvas,
      lcdTexture,
      gridHelper,
      keyLight,
      hemiLight,
      rimLight,
      contactShadowMesh,
      sensorRaysGroup,
      labObjectGroups,
      labSelectableMeshes,
    };

    if (!isSoftwareGl) {
      renderer.compile(scene, orbitCamera);
    }

    // Raycasting, Floor-Dragging & Marquee Box Selection
    const raycaster = new THREE.Raycaster();
    const pointerNdc = new THREE.Vector2();
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const planeHit = new THREE.Vector3();

    let pointerDownClient = { x: 0, y: 0 };
    let draggingFloorObjectId: string | null = null;
    let draggingFloorRobot = false;
    let dragOffsetXZ = { x: 0, z: 0 };
    let marqueeActive = false;

    const getCanvasNdc = (ev: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointerNdc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      return rect;
    };

    const getActiveMainCam = () =>
      latestRef.current.cameraViewMode === 'first-person' ? rig.robotCamera : orbitCamera;

    const onPointerDown = (ev: PointerEvent) => {
      if (ev.button !== 0 || isGizmoDragging) return;
      pointerDownClient = { x: ev.clientX, y: ev.clientY };
      const st = latestRef.current;
      const rect = getCanvasNdc(ev);

      if (st.viewportTool === 'box-select') {
        marqueeActive = true;
        orbitControls.enabled = false;
        const lx = ev.clientX - rect.left;
        const ly = ev.clientY - rect.top;
        setMarqueeRect({ x1: lx, y1: ly, x2: lx, y2: ly });
        return;
      }

      if (st.viewportTool === 'floor-drag') {
        raycaster.setFromCamera(pointerNdc, getActiveMainCam());
        const dragCandidates = st.attachmentMode
          ? labSelectableMeshes
          : [...rig.selectableMeshes, ...labSelectableMeshes];
        const hits = raycaster.intersectObjects(dragCandidates, false);
        if (hits.length > 0) {
          let curr: THREE.Object3D | null = hits[0].object;
          while (curr && !curr.userData.selectable) {
            curr = curr.parent;
          }
          const sel = curr?.userData.selectable as SelectableTarget | undefined;
          if (sel && sel.kind === 'scene-object') {
            draggingFloorObjectId = sel.objectId;
            st.onSelectTarget(sel);
            orbitControls.enabled = false;
            const entry = labObjectGroups.get(sel.objectId);
            if (entry && raycaster.ray.intersectPlane(groundPlane, planeHit)) {
              dragOffsetXZ = {
                x: entry.group.position.x - planeHit.x,
                z: entry.group.position.z - planeHit.z,
              };
            }
          } else if (sel && !st.attachmentMode) {
            draggingFloorRobot = true;
            st.onSelectTarget({ kind: 'chassis', partName: 'Main Chassis' });
            orbitControls.enabled = false;
            if (raycaster.ray.intersectPlane(groundPlane, planeHit)) {
              dragOffsetXZ = {
                x: rig.rootGroup.position.x - planeHit.x,
                z: rig.rootGroup.position.z - planeHit.z,
              };
            }
          }
        }
      }
    };

    const onPointerMove = (ev: PointerEvent) => {
      const rect = getCanvasNdc(ev);
      if (marqueeActive) {
        setMarqueeRect((prev) =>
          prev
            ? {
                ...prev,
                x2: ev.clientX - rect.left,
                y2: ev.clientY - rect.top,
              }
            : null
        );
        return;
      }

      if (draggingFloorRobot) {
        const st = latestRef.current;
        raycaster.setFromCamera(pointerNdc, getActiveMainCam());
        if (raycaster.ray.intersectPlane(groundPlane, planeHit)) {
          const nx = THREE.MathUtils.clamp(
            Math.round((planeHit.x + dragOffsetXZ.x) * 100) / 100,
            -5.2,
            5.2
          );
          const nz = THREE.MathUtils.clamp(
            Math.round((planeHit.z + dragOffsetXZ.z) * 100) / 100,
            -5.2,
            5.2
          );
          const curRobotPose: BodyPose = {
            ...st.bodyPose,
            x: rig.rootGroup.position.x,
            y: rig.rootGroup.position.y,
            z: rig.rootGroup.position.z,
          };
          const resolved = resolveSolidBodyMovement(
            curRobotPose,
            { ...curRobotPose, x: nx, z: nz },
            st.channels,
            st.labObjects,
            st.visualKinematicGain
          );
          rig.rootGroup.position.set(
            resolved.resolvedPose.x,
            resolved.resolvedPose.y,
            resolved.resolvedPose.z
          );
          st.onUpdateBodyPose(resolved.resolvedPose);
        }
        return;
      }

      if (draggingFloorObjectId) {
        const st = latestRef.current;
        raycaster.setFromCamera(pointerNdc, getActiveMainCam());
        if (raycaster.ray.intersectPlane(groundPlane, planeHit)) {
          const nx = THREE.MathUtils.clamp(
            Math.round((planeHit.x + dragOffsetXZ.x) * 100) / 100,
            -5.5,
            5.5
          );
          const nz = THREE.MathUtils.clamp(
            Math.round((planeHit.z + dragOffsetXZ.z) * 100) / 100,
            -5.5,
            5.5
          );
          const prevObj = st.labObjects.find((o) => o.id === draggingFloorObjectId);
          if (prevObj) {
            const candidateObjs = st.labObjects.map((o) =>
              o.id === draggingFloorObjectId ? { ...o, position: [nx, 0, nz] as [number, number, number] } : o
            );
            const wasCol = checkRobotPoseCollision(
              st.bodyPose,
              st.channels,
              [prevObj],
              st.visualKinematicGain,
              0.01
            ).colliding;
            const nowCol = checkRobotPoseCollision(
              st.bodyPose,
              st.channels,
              candidateObjs,
              st.visualKinematicGain,
              0.01
            ).colliding;
            if (!wasCol && nowCol) {
              return;
            }
          }

          const entry = labObjectGroups.get(draggingFloorObjectId);
          if (entry) {
            entry.group.position.x = nx;
            entry.group.position.z = nz;
          }
          st.onUpdateLabObject(draggingFloorObjectId, {
            position: [nx, 0, nz],
          });
        }
      }
    };

    const onPointerUp = (ev: PointerEvent) => {
      const rect = getCanvasNdc(ev);
      const st = latestRef.current;

      if (marqueeActive) {
        marqueeActive = false;
        orbitControls.enabled = true;
        const xMin = Math.min(pointerDownClient.x - rect.left, ev.clientX - rect.left);
        const xMax = Math.max(pointerDownClient.x - rect.left, ev.clientX - rect.left);
        const yMin = Math.min(pointerDownClient.y - rect.top, ev.clientY - rect.top);
        const yMax = Math.max(pointerDownClient.y - rect.top, ev.clientY - rect.top);
        setMarqueeRect(null);

        if (xMax - xMin > 8 && yMax - yMin > 8) {
          const cam = getActiveMainCam();
          const proj = new THREE.Vector3();
          let matched: SelectableTarget = null;
          for (let ch = 0; ch < 12; ch++) {
            rig.channelPivotMap[ch].getWorldPosition(proj);
            proj.project(cam);
            const sx = ((proj.x + 1) * 0.5) * rect.width;
            const sy = ((-proj.y + 1) * 0.5) * rect.height;
            if (proj.z < 1 && sx >= xMin && sx <= xMax && sy >= yMin && sy <= yMax) {
              matched = { kind: 'joint', channel: ch };
              break;
            }
          }
          if (!matched) {
            for (const [id, entry] of labObjectGroups.entries()) {
              entry.group.getWorldPosition(proj);
              proj.y += 0.25;
              proj.project(cam);
              const sx = ((proj.x + 1) * 0.5) * rect.width;
              const sy = ((-proj.y + 1) * 0.5) * rect.height;
              if (proj.z < 1 && sx >= xMin && sx <= xMax && sy >= yMin && sy <= yMax) {
                matched = { kind: 'scene-object', objectId: id };
                break;
              }
            }
          }
          if (matched) st.onSelectTarget(matched);
          return;
        }
      }

      if (draggingFloorRobot) {
        draggingFloorRobot = false;
        orbitControls.enabled = true;
        return;
      }

      if (draggingFloorObjectId) {
        draggingFloorObjectId = null;
        orbitControls.enabled = true;
        return;
      }

      const moveDist = Math.hypot(
        ev.clientX - pointerDownClient.x,
        ev.clientY - pointerDownClient.y
      );
      if (moveDist < 6 && !isGizmoDragging) {
        raycaster.setFromCamera(pointerNdc, getActiveMainCam());
        const candidates = st.attachmentMode
          ? [rig.cameraModuleGroup, rig.lcdModuleGroup, rig.micModuleGroup]
          : [...rig.selectableMeshes, ...labSelectableMeshes];
        const hits = raycaster.intersectObjects(candidates, st.attachmentMode);
        if (hits.length > 0) {
          let curr: THREE.Object3D | null = hits[0].object;
          while (curr && !curr.userData.selectable) {
            curr = curr.parent;
          }
          if (curr?.userData.selectable) {
            st.onSelectTarget(curr.userData.selectable as SelectableTarget);
          }
        } else if (!st.attachmentMode) {
          st.onSelectTarget(null);
        }
      }
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.max(entry.contentRect.width, 200);
        const h = Math.max(entry.contentRect.height, 200);
        orbitCamera.aspect = w / h;
        orbitCamera.updateProjectionMatrix();
        renderer.setSize(w, h);
      }
    });
    resizeObserver.observe(container);

    // Main Animation & Simulation Loop
    let frameId = 0;
    let disposed = false;
    const clock = new THREE.Clock();
    let simElapsed = 0;
    let lastUiSyncTime = 0;
    let prevBodyPose: BodyPose = { ...latestRef.current.bodyPose };
    let localPose: BodyPose = { ...latestRef.current.bodyPose };
    let localNav: NavigationConfigAndState = { ...latestRef.current.navigation };
    let lastSeenResetToken = latestRef.current.scenarioResetToken;
    let lastSeenManualPoseToken = latestRef.current.manualPoseToken;
    let lastDispatchedPoseSig = `${localPose.x},${localPose.y},${localPose.z},${localPose.pitch},${localPose.roll},${localPose.yaw}`;
    let cachedDetections: SimulatedDetection[] = [];

    const simAngles = latestRef.current.channels.map((c) => c.currentSimulatedAngle);
    const _projVec = new THREE.Vector3();
    const _fwdArrowDir = new THREE.Vector3(0, 0, 1);

    function afterDraw(cb: () => void) {
      if (disposed) return;
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync ? gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) : null;
      gl.flush();
      const poll = () => {
        if (disposed) return;
        const state = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
        if (sync && state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function tick() {
      if (disposed) return;
      const dt = Math.min(clock.getDelta(), 0.08);
      const st = latestRef.current;

      // Distinguish scenario resets vs manual user pose manipulation vs controller motion
      let manualPoseJustChanged = false;
      const incomingPoseSig = `${st.bodyPose.x},${st.bodyPose.y},${st.bodyPose.z},${st.bodyPose.pitch},${st.bodyPose.roll},${st.bodyPose.yaw}`;
      if (st.scenarioResetToken !== lastSeenResetToken) {
        lastSeenResetToken = st.scenarioResetToken;
        lastSeenManualPoseToken = st.manualPoseToken;
        localPose = { ...st.bodyPose };
        localNav = { ...st.navigation };
        lastDispatchedPoseSig = incomingPoseSig;
        for (let i = 0; i < 12; i++) {
          simAngles[i] = st.channels[i].targetAngle;
        }
      } else if (st.manualPoseToken !== lastSeenManualPoseToken) {
        lastSeenManualPoseToken = st.manualPoseToken;
        localPose = { ...st.bodyPose };
        lastDispatchedPoseSig = incomingPoseSig;
        manualPoseJustChanged = true;
      }

      const isUserManipulatingRobot =
        (isGizmoDragging && transformControls.object === rig.rootGroup) ||
        draggingFloorRobot ||
        manualPoseJustChanged;

      // Sync user-controlled navigation config parameters
      localNav.enabled = st.navigation.enabled;
      localNav.safetyDistanceM = st.navigation.safetyDistanceM;
      localNav.turnAngleDeg = st.navigation.turnAngleDeg;
      localNav.clearanceThresholdM = st.navigation.clearanceThresholdM;
      localNav.forwardSpeedMps = st.navigation.forwardSpeedMps;
      localNav.turnRateDegPerSec = st.navigation.turnRateDegPerSec;
      localNav.showSensorRays = st.navigation.showSensorRays;

      let activeTargets = st.channels.map((c) => c.targetAngle);
      let isAnimating = false;
      let latestScan = scanNavigationSensors(localPose, st.labObjects, cachedDetections);

      if (localNav.enabled) {
        // Continuous 11-State Autonomous Obstacle Avoidance FSM Loop
        const navStep = stepAutonomousNavigation(
          dt,
          localNav,
          localPose,
          st.channels,
          st.labObjects,
          cachedDetections,
          st.visualKinematicGain,
          { userManipulating: isUserManipulatingRobot }
        );
        localNav = navStep.nextNav;
        localPose = navStep.nextBodyPose;
        latestScan = navStep.scan;

        if (navStep.shouldAnimateGait) {
          isAnimating = true;
          simElapsed += dt;
          const navGaitCfg: GaitConfig = {
            ...st.gait,
            gaitEnabled: true,
            isRunning: true,
          };
          const proposedTargets = computeGaitTargets(simElapsed, navGaitCfg, st.channels);
          const candidateChannels = st.channels.map((ch, idx) => ({
            ...ch,
            targetAngle: proposedTargets[idx],
            currentSimulatedAngle: proposedTargets[idx],
          }));
          if (
            !checkRobotPoseCollision(
              localPose,
              candidateChannels,
              st.labObjects,
              st.visualKinematicGain,
              0.012
            ).colliding
          ) {
            activeTargets = proposedTargets;
          }
        } else {
          // Stopped before obstacle, lifted off floor, relocalizing, or waiting for clearance
          activeTargets = st.channels.map((ch) => clampChannelAngle(ch, 95));
        }
      } else if (st.gait.gaitEnabled && st.gait.isRunning) {
        // Manual Gait Execution — enforce solid obstacles & suspend ground translation if lifted off floor
        const liftedNow = isRobotLiftedOffFloor(localPose, st.channels, st.visualKinematicGain);
        const nextSimElapsed = simElapsed + dt;
        const proposedTargets = computeGaitTargets(nextSimElapsed, st.gait, st.channels);
        const candidateChannels = st.channels.map((ch, idx) => ({
          ...ch,
          targetAngle: proposedTargets[idx],
          currentSimulatedAngle: proposedTargets[idx],
        }));

        if (liftedNow || isUserManipulatingRobot) {
          // Suspended ground locomotion while lifted off floor or manually dragged
          isAnimating = false;
          activeTargets = st.channels.map((ch) => clampChannelAngle(ch, 95));
        } else if (st.gait.locomotionTranslate) {
          const headingRad = THREE.MathUtils.degToRad(localPose.yaw);
          const speed = 0.16 * st.gait.cadenceHz;
          const candPose: BodyPose = {
            ...localPose,
            x: THREE.MathUtils.clamp(localPose.x + Math.sin(headingRad) * speed * dt, -5.2, 5.2),
            z: THREE.MathUtils.clamp(localPose.z + Math.cos(headingRad) * speed * dt, -5.2, 5.2),
          };
          const preContactCheck = checkRobotPoseCollision(
            candPose,
            candidateChannels,
            st.labObjects,
            st.visualKinematicGain,
            0.032
          );
          if (preContactCheck.colliding) {
            isAnimating = false;
            activeTargets = st.channels.map((ch) => clampChannelAngle(ch, 95));
            st.onStopGaitBeforeCollision();
          } else {
            isAnimating = true;
            simElapsed = nextSimElapsed;
            localPose = candPose;
            activeTargets = proposedTargets;
          }
        } else {
          const inPlaceCheck = checkRobotPoseCollision(
            localPose,
            candidateChannels,
            st.labObjects,
            st.visualKinematicGain,
            0.012
          );
          if (!inPlaceCheck.colliding) {
            isAnimating = true;
            simElapsed = nextSimElapsed;
            activeTargets = proposedTargets;
          } else {
            st.onStopGaitBeforeCollision();
          }
        }
      } else if (st.legTest.running && st.legTest.activeLeg) {
        const nextSimElapsed = simElapsed + dt;
        const proposedTargets = computeSingleLegTestTargets(
          nextSimElapsed,
          st.legTest.activeLeg,
          st.channels
        );
        const candidateChannels = st.channels.map((ch, idx) => ({
          ...ch,
          targetAngle: proposedTargets[idx],
          currentSimulatedAngle: proposedTargets[idx],
        }));
        if (
          !checkRobotPoseCollision(
            localPose,
            candidateChannels,
            st.labObjects,
            st.visualKinematicGain,
            0.01
          ).colliding
        ) {
          isAnimating = true;
          simElapsed = nextSimElapsed;
          activeTargets = proposedTargets;
        }
      } else {
        // Keep idle scan values fresh in localNav for telemetry display
        const liftedIdle = isRobotLiftedOffFloor(localPose, st.channels, st.visualKinematicGain);
        localNav = {
          ...localNav,
          fsmState: 'IDLE',
          activityState: 'IDLE',
          isLiftedOffFloor: liftedIdle,
          selectedTurnDirection: 'NONE',
          nearestForwardM: latestScan.nearestForwardM,
          leftClearanceM: latestScan.leftClearanceM,
          rightClearanceM: latestScan.rightClearanceM,
          detectedObstacleIds: latestScan.detectedObstacleIds,
          statusMessage: 'Autonomous avoidance standby (IDLE)',
          lastCommandedPose: null,
        };
      }

      // 2. Smooth exponential servo shaft damping + parent-child joint updates
      for (let i = 0; i < 12; i++) {
        simAngles[i] = THREE.MathUtils.damp(simAngles[i], activeTargets[i], 14, dt);
        const chObj: ServoChannel = {
          ...st.channels[i],
          targetAngle: activeTargets[i],
          currentSimulatedAngle: simAngles[i],
        };
        const rad = computeJointRadians(chObj, st.visualKinematicGain);
        const pivot = rig.channelPivotMap[i];
        if (chObj.role === 'abduction') {
          pivot.rotation.z = rad;
        } else {
          pivot.rotation.x = rad;
        }
      }

      if (st.selectedTarget?.kind === 'joint') {
        const selCh = st.selectedTarget.channel;
        const needle = rig.jointHighlightRing.children[1];
        if (needle) {
          needle.rotation.z = THREE.MathUtils.degToRad((simAngles[selCh] - 95) * 3);
        }
      }

      // 3. Update Robot Root Body Pose
      if ((!isGizmoDragging || transformControls.object !== rig.rootGroup) && !draggingFloorRobot) {
        rig.rootGroup.position.set(localPose.x, localPose.y, localPose.z);
        rig.rootGroup.rotation.set(
          THREE.MathUtils.degToRad(localPose.pitch),
          THREE.MathUtils.degToRad(localPose.yaw),
          THREE.MathUtils.degToRad(localPose.roll),
          'YXZ'
        );
      }
      contactShadowMesh.position.x = rig.rootGroup.position.x;
      contactShadowMesh.position.z = rig.rootGroup.position.z;
      contactShadowMesh.rotation.z = -rig.rootGroup.rotation.y;
      (contactShadowMesh.material as THREE.MeshBasicMaterial).opacity = Math.max(
        0.08,
        0.55 - Math.max(0, rig.rootGroup.position.y - 0.36) * 1.4
      );
      const fwdSin = Math.sin(rig.rootGroup.rotation.y);
      const fwdCos = Math.cos(rig.rootGroup.rotation.y);
      forwardArrow.position.set(
        rig.rootGroup.position.x + fwdSin * 0.38,
        0.004,
        rig.rootGroup.position.z + fwdCos * 0.38
      );
      _fwdArrowDir.set(fwdSin, 0, fwdCos).normalize();
      forwardArrow.setDirection(_fwdArrowDir);

      // 3B. Update 3D Sensor Detection Rays & Hit Endpoint Spheres
      sensorRaysGroup.visible = localNav.showSensorRays;
      if (localNav.showSensorRays) {
        for (let rIdx = 0; rIdx < SENSOR_RAY_POOL_SIZE; rIdx++) {
          const item = sensorRayLines[rIdx];
          const ray = latestScan.rays[rIdx];
          if (!ray) {
            item.line.visible = false;
            item.hitDot.visible = false;
            continue;
          }
          item.line.visible = true;
          item.positions[0] = ray.origin[0];
          item.positions[1] = ray.origin[1];
          item.positions[2] = ray.origin[2];
          item.positions[3] = ray.endPoint[0];
          item.positions[4] = ray.endPoint[1];
          item.positions[5] = ray.endPoint[2];
          item.line.geometry.attributes.position.needsUpdate = true;

          const isCloseAlert = ray.distanceM <= localNav.safetyDistanceM;
          const isWarn = !isCloseAlert && ray.distanceM <= localNav.safetyDistanceM * 1.25;
          const colorHex = isCloseAlert
            ? 0xef4444
            : isWarn
            ? 0xf59e0b
            : ray.zone === 'forward'
            ? 0x10b981
            : 0x38bdf8;
          item.mat.color.setHex(colorHex);

          if (ray.hitObjectId) {
            item.hitDot.visible = true;
            item.hitDot.position.set(ray.endPoint[0], ray.endPoint[1], ray.endPoint[2]);
            item.dotMat.color.setHex(colorHex);
          } else {
            item.hitDot.visible = false;
          }
        }
      }

      // 4. Update Attachable Modules (Camera, LCD, Microphone)
      const syncModuleRig = (
        modGroup: THREE.Group,
        standGroup: THREE.Group,
        cfg: {
          attached: boolean;
          mountPosition: [number, number, number];
          mountRotation: [number, number, number];
          worldPosition: [number, number, number];
          worldRotation: [number, number, number];
        }
      ) => {
        const expectedParent = cfg.attached ? rig.chassisGroup : scene;
        if (modGroup.parent !== expectedParent) {
          expectedParent.add(modGroup);
        }
        standGroup.visible = !cfg.attached;
        if (!isGizmoDragging || transformControls.object !== modGroup) {
          const p = cfg.attached ? cfg.mountPosition : cfg.worldPosition;
          const r = cfg.attached ? cfg.mountRotation : cfg.worldRotation;
          modGroup.position.set(p[0], p[1], p[2]);
          modGroup.rotation.set(
            THREE.MathUtils.degToRad(r[0]),
            THREE.MathUtils.degToRad(r[1]),
            THREE.MathUtils.degToRad(r[2])
          );
        }
      };

      syncModuleRig(rig.cameraModuleGroup, rig.cameraDetachedStand, st.cameraModule);
      syncModuleRig(rig.lcdModuleGroup, rig.lcdDetachedStand, st.lcdModule);
      syncModuleRig(rig.micModuleGroup, rig.micDetachedStand, st.micModule);

      if (rig.robotCamera.fov !== st.cameraModule.fov) {
        rig.robotCamera.fov = st.cameraModule.fov;
        rig.robotCamera.updateProjectionMatrix();
      }

      rig.micRingMat.color.setHex(st.micModule.listening ? 0x10b981 : 0x475569);
      rig.micRingMat.emissive.setHex(st.micModule.listening ? 0x059669 : 0x000000);

      // 5. Camera Preset Glide & OrbitControls Update
      if (cameraPresetGoalRef.current) {
        orbitCamera.position.lerp(cameraPresetGoalRef.current.pos, 1 - Math.exp(-8 * dt));
        orbitControls.target.lerp(cameraPresetGoalRef.current.target, 1 - Math.exp(-8 * dt));
        if (orbitCamera.position.distanceTo(cameraPresetGoalRef.current.pos) < 0.015) {
          cameraPresetGoalRef.current = null;
        }
      }
      orbitControls.update();

      // 6. Periodic Telemetry, Navigation UI Sync, Obstacle Highlighting & Robot Camera (~12 Hz)
      const now = performance.now();
      if (now - lastUiSyncTime > (isSoftwareGl ? 150 : 80)) {
        lastUiSyncTime = now;

        // Dispatch pose if autonomous navigation or floor gait moved the robot (without triggering manualPoseToken)
        const roundedPose: BodyPose = {
          x: Math.round(localPose.x * 1000) / 1000,
          y: Math.round(localPose.y * 1000) / 1000,
          z: Math.round(localPose.z * 1000) / 1000,
          pitch: Math.round(localPose.pitch * 10) / 10,
          roll: Math.round(localPose.roll * 10) / 10,
          yaw: Math.round(localPose.yaw * 10) / 10,
        };
        const nextPoseSig = `${roundedPose.x},${roundedPose.y},${roundedPose.z},${roundedPose.pitch},${roundedPose.roll},${roundedPose.yaw}`;
        if (!isUserManipulatingRobot && nextPoseSig !== lastDispatchedPoseSig) {
          lastDispatchedPoseSig = nextPoseSig;
          st.onUpdateBodyPoseFromSim(roundedPose);
        }

        st.onUpdateNavigation({
          fsmState: localNav.fsmState,
          activityState: localNav.activityState,
          isLiftedOffFloor: localNav.isLiftedOffFloor,
          selectedTurnDirection: localNav.selectedTurnDirection,
          nearestForwardM: localNav.nearestForwardM,
          leftClearanceM: localNav.leftClearanceM,
          rightClearanceM: localNav.rightClearanceM,
          detectedObstacleIds: localNav.detectedObstacleIds,
          statusMessage: localNav.statusMessage,
          stateTimerSec: localNav.stateTimerSec,
          committedTurn: localNav.committedTurn,
          targetYawDeg: localNav.targetYawDeg,
          initialBypassHeadingDeg: localNav.initialBypassHeadingDeg,
          bypassObstacleId: localNav.bypassObstacleId,
          bypassDistanceTraveledM: localNav.bypassDistanceTraveledM,
          cumulativeTurnDeg: localNav.cumulativeTurnDeg,
          lastCommandedPose: localNav.lastCommandedPose,
        });

        if (isAnimating || localNav.enabled) {
          st.onUpdateChannelsFromSim(
            activeTargets,
            simAngles.map((a) => Math.round(a * 100) / 100)
          );
        }

        // Update 3D LCD texture (includes PATH BLOCKED & AUTO-NAV status)
        const lcdLines = buildLcdLines(
          st.lcdModule,
          st.posePreset,
          isAnimating,
          st.channels,
          st.telemetry,
          localNav
        );
        drawLcdCanvas(lcdCanvas, lcdLines, st.lcdModule);
        lcdTexture.needsUpdate = true;

        // Highlight Detected & Colliding Solid Obstacles
        const collidingSet = detectSceneCollisions(
          localPose,
          st.labObjects,
          st.channels,
          st.visualKinematicGain
        );
        const detectedSet = new Set(latestScan.detectedObstacleIds);
        const closeHitSet = new Set(
          latestScan.rays
            .filter((r) => r.hitObjectId && r.distanceM <= localNav.safetyDistanceM)
            .map((r) => r.hitObjectId as string)
        );

        for (const [id, entry] of labObjectGroups.entries()) {
          const isSolid = getObstacleLocalDimensions(entry.type).isSolid;
          if (!isSolid) {
            entry.collisionBox.visible = false;
            continue;
          }
          const isColOrDanger = collidingSet.has(id) || closeHitSet.has(id);
          const isDetected = detectedSet.has(id);
          entry.collisionBox.visible =
            st.showCollisionWireframes && (isColOrDanger || isDetected);
          if (entry.collisionBox.visible) {
            entry.collisionMat.color.setHex(isColOrDanger ? 0xef4444 : 0xf59e0b);
          }
        }

        const obstacleMeshes = Array.from(labObjectGroups.values())
          .filter((e) => getObstacleLocalDimensions(e.type).isSolid)
          .map((e) => e.group);
        const sonarCm = st.telemetry.manualSensorOverride
          ? st.telemetry.manualUltrasonicCm
          : obstacleMeshes.length > 0
          ? Math.min(
              computeSimulatedUltrasonicCm(rig.chassisGroup, obstacleMeshes),
              Math.round(latestScan.nearestForwardM * 1000) / 10
            )
          : Math.round(latestScan.nearestForwardM * 1000) / 10;

        const imu = computeSimulatedImu(
          roundedPose,
          prevBodyPose,
          0.085,
          isAnimating,
          st.telemetry.manualImuNoise
        );
        prevBodyPose = { ...roundedPose };

        rig.rootGroup.updateMatrixWorld(true);
        cachedDetections = st.cameraModule.webcamEnabled
          ? []
          : computeVirtualDetections(rig.robotCamera, st.labObjects);

        st.onUpdateLiveTelemetry(
          {
            accel: imu.accel,
            gyro: imu.gyro,
            ultrasonicCm: sonarCm,
          },
          cachedDetections,
          Array.from(collidingSet)
        );

        // Render Virtual Robot Camera Feed to secondary 2D canvas (hide gizmo & sensor rays)
        const feedCanvas = robotFeedCanvasRef.current;
        const splitCanvas = splitOverlayCanvasRef.current;
        if (!st.cameraModule.webcamEnabled && (feedCanvas || splitCanvas)) {
          const prevHelperVis = transformHelper.visible;
          const prevRingVis = rig.jointHighlightRing.visible;
          const prevRaysVis = sensorRaysGroup.visible;
          transformHelper.visible = false;
          rig.jointHighlightRing.visible = false;
          sensorRaysGroup.visible = false;

          rig.robotCamera.aspect = 16 / 10;
          rig.robotCamera.updateProjectionMatrix();
          renderer.render(scene, rig.robotCamera);

          if (feedCanvas) {
            const fctx = feedCanvas.getContext('2d');
            if (fctx) {
              fctx.clearRect(0, 0, feedCanvas.width, feedCanvas.height);
              fctx.drawImage(renderer.domElement, 0, 0, feedCanvas.width, feedCanvas.height);
            }
          }
          if (splitCanvas && st.cameraViewMode === 'split') {
            const sctx = splitCanvas.getContext('2d');
            if (sctx) {
              sctx.clearRect(0, 0, splitCanvas.width, splitCanvas.height);
              sctx.drawImage(renderer.domElement, 0, 0, splitCanvas.width, splitCanvas.height);
            }
          }

          transformHelper.visible = prevHelperVis;
          rig.jointHighlightRing.visible = prevRingVis;
          sensorRaysGroup.visible = prevRaysVis;
        }

        if (st.showChannelLabels) {
          const mainCam =
            st.cameraViewMode === 'first-person' ? rig.robotCamera : orbitCamera;
          const cw = renderer.domElement.clientWidth;
          const chH = renderer.domElement.clientHeight;
          const nextLabels = [];
          for (let c = 0; c < 12; c++) {
            rig.channelPivotMap[c].getWorldPosition(_projVec);
            _projVec.project(mainCam);
            const visible =
              _projVec.z > -1 &&
              _projVec.z < 1 &&
              Math.abs(_projVec.x) < 0.96 &&
              Math.abs(_projVec.y) < 0.96;
            nextLabels.push({
              channel: c,
              x: ((_projVec.x + 1) * 0.5) * cw,
              y: ((-_projVec.y + 1) * 0.5) * chH,
              visible,
              angle: activeTargets[c],
            });
          }
          setProjectedLabels(nextLabels);
        }
      }

      // 7. Render Primary 3D Viewport
      const activeCam =
        st.cameraViewMode === 'first-person' ? rig.robotCamera : orbitCamera;
      if (activeCam === rig.robotCamera) {
        const w = Math.max(renderer.domElement.clientWidth, 1);
        const h = Math.max(renderer.domElement.clientHeight, 1);
        rig.robotCamera.aspect = w / h;
        rig.robotCamera.updateProjectionMatrix();
      }
      renderer.render(scene, activeCam);

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    }

    frameId = requestAnimationFrame(tick);

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      transformControls.detach();
      transformControls.dispose();
      orbitControls.dispose();
      lcdTexture.dispose();
      contactTex.dispose();
      dotGeo.dispose();
      renderer.dispose();
      sceneCtxRef.current = null;
    };
  }, [robotFeedCanvasRef]);

  // Synchronize Lab Scene Objects (add/remove/update when props change)
  useEffect(() => {
    const ctx = sceneCtxRef.current;
    if (!ctx) return;

    const currentIds = new Set(labObjects.map((o) => o.id));

    for (const [id, entry] of ctx.labObjectGroups.entries()) {
      if (!currentIds.has(id)) {
        if (ctx.transformControls.object === entry.group) {
          ctx.transformControls.detach();
        }
        ctx.scene.remove(entry.group);
        ctx.labObjectGroups.delete(id);
      }
    }

    ctx.labSelectableMeshes.length = 0;
    for (const obj of labObjects) {
      let entry = ctx.labObjectGroups.get(obj.id);
      if (!entry || entry.type !== obj.type) {
        if (entry) ctx.scene.remove(entry.group);
        const built = createLabObjectGroup(obj, ctx.labSelectableMeshes);
        ctx.scene.add(built.group);
        entry = { ...built, type: obj.type };
        ctx.labObjectGroups.set(obj.id, entry);
      } else {
        entry.group.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            ctx.labSelectableMeshes.push(child);
          }
        });
        if (ctx.transformControls.object !== entry.group || !ctx.transformControls.dragging) {
          entry.group.position.set(obj.position[0], obj.position[1], obj.position[2]);
          entry.group.rotation.set(
            THREE.MathUtils.degToRad(obj.rotation[0]),
            THREE.MathUtils.degToRad(obj.rotation[1]),
            THREE.MathUtils.degToRad(obj.rotation[2])
          );
          entry.group.scale.set(obj.scale[0], obj.scale[1], obj.scale[2]);
        }
      }
    }
  }, [labObjects]);

  // Synchronize Selection Highlights & TransformControls Gizmo Attachment
  useEffect(() => {
    const ctx = sceneCtxRef.current;
    if (!ctx) return;
    const { rig, transformControls, labObjectGroups } = ctx;

    Object.values(rig.channelMeshesMap).forEach((meshes) =>
      meshes.forEach((m) => {
        const mat = m.material as THREE.MeshStandardMaterial;
        if (mat.emissive) mat.emissive.setHex(0x000000);
      })
    );
    Object.values(rig.chassisPartMeshes).forEach((meshes) =>
      meshes.forEach((m) => {
        const mat = m.material as THREE.MeshStandardMaterial;
        if (mat.emissive) mat.emissive.setHex(0x000000);
      })
    );

    rig.jointHighlightRing.visible = false;
    transformControls.detach();
    transformControls.setMode(gizmoMode);

    if (!selectedTarget || cameraViewMode === 'first-person') return;

    if (selectedTarget.kind === 'joint') {
      const ch = selectedTarget.channel;
      const meshes = rig.channelMeshesMap[ch] || [];
      meshes.forEach((m) => {
        const mat = m.material as THREE.MeshStandardMaterial;
        if (mat.emissive) {
          mat.emissive.setHex(0x0284c7);
          mat.emissiveIntensity = 0.55;
        }
      });

      const pivot = rig.channelPivotMap[ch];
      if (pivot) {
        pivot.add(rig.jointHighlightRing);
        rig.jointHighlightRing.position.set(0, 0, 0);
        const isAbd = ch % 3 === 0;
        rig.jointHighlightRing.rotation.set(0, isAbd ? 0 : Math.PI / 2, 0);
        rig.jointHighlightRing.visible = true;
      }
    } else if (selectedTarget.kind === 'chassis') {
      const meshes = rig.chassisPartMeshes[selectedTarget.partName] || [];
      meshes.forEach((m) => {
        const mat = m.material as THREE.MeshStandardMaterial;
        if (mat.emissive) {
          mat.emissive.setHex(0x1d4ed8);
          mat.emissiveIntensity = 0.35;
        }
      });
      if (!attachmentMode && viewportTool === 'select' && gizmoMode !== 'scale') {
        transformControls.setSpace('world');
        transformControls.attach(rig.rootGroup);
      }
    } else if (selectedTarget.kind === 'module') {
      const modGroup =
        selectedTarget.moduleId === 'camera'
          ? rig.cameraModuleGroup
          : selectedTarget.moduleId === 'lcd'
          ? rig.lcdModuleGroup
          : rig.micModuleGroup;
      const isAttached =
        selectedTarget.moduleId === 'camera'
          ? cameraModule.attached
          : selectedTarget.moduleId === 'lcd'
          ? lcdModule.attached
          : micModule.attached;

      if (gizmoMode !== 'scale') {
        transformControls.setSpace(isAttached ? 'local' : 'world');
        transformControls.attach(modGroup);
      }
    } else if (selectedTarget.kind === 'scene-object') {
      const entry = labObjectGroups.get(selectedTarget.objectId);
      if (entry && viewportTool === 'select') {
        transformControls.setSpace('world');
        transformControls.attach(entry.group);
      }
    }
  }, [
    selectedTarget,
    gizmoMode,
    viewportTool,
    attachmentMode,
    cameraViewMode,
    cameraModule.attached,
    lcdModule.attached,
    micModule.attached,
  ]);

  // Synchronize Lighting, Grid & Shadow toggles
  useEffect(() => {
    const ctx = sceneCtxRef.current;
    if (!ctx) return;

    ctx.gridHelper.visible = showGrid;
    ctx.keyLight.castShadow = shadowsEnabled;

    if (lightingPreset === 'daylight') {
      ctx.scene.background = new THREE.Color(0x111827);
      ctx.scene.fog = new THREE.FogExp2(0x111827, 0.055);
      ctx.keyLight.color.setHex(0xffffff);
      ctx.keyLight.intensity = 2.1 * lightIntensity;
      ctx.hemiLight.intensity = 1.0 * lightIntensity;
      ctx.rimLight.intensity = 0.65 * lightIntensity;
    } else if (lightingPreset === 'inspection') {
      ctx.scene.background = new THREE.Color(0x050811);
      ctx.scene.fog = new THREE.FogExp2(0x050811, 0.09);
      ctx.keyLight.color.setHex(0xe0f2fe);
      ctx.keyLight.intensity = 1.45 * lightIntensity;
      ctx.hemiLight.intensity = 0.45 * lightIntensity;
      ctx.rimLight.intensity = 1.15 * lightIntensity;
    } else {
      ctx.scene.background = new THREE.Color(0x0b1120);
      ctx.scene.fog = new THREE.FogExp2(0x0b1120, 0.065);
      ctx.keyLight.color.setHex(0xfff7ed);
      ctx.keyLight.intensity = 1.85 * lightIntensity;
      ctx.hemiLight.intensity = 0.75 * lightIntensity;
      ctx.rimLight.intensity = 0.75 * lightIntensity;
    }
  }, [lightingPreset, lightIntensity, shadowsEnabled, showGrid]);

  const isPathBlocked =
    navigation.enabled &&
    (navigation.fsmState === 'PATH_BLOCKED' || navigation.fsmState === 'WAITING_FOR_CLEARANCE');

  return (
    <div className="relative flex-1 h-full bg-slate-950 overflow-hidden select-none">
      {/* Dedicated WebGL Mount Container */}
      <div ref={mountRef} className="w-full h-full" />

      {/* Fallback Error Banner if WebGL Context Unavailable */}
      {webglError && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/95 p-6 z-30">
          <div className="max-w-md border border-red-500/40 bg-slate-900 p-6 rounded-xl text-center space-y-3">
            <ShieldAlert className="w-8 h-8 text-red-400 mx-auto" />
            <h3 className="text-base font-semibold text-white">3D Viewport Suspended</h3>
            <p className="text-xs text-slate-300">{webglError}</p>
          </div>
        </div>
      )}

      {/* Prominent PATH BLOCKED — WAITING FOR CLEARANCE Alert Overlay */}
      {isPathBlocked && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 bg-red-950 border-2 border-red-500 px-5 py-2.5 rounded-xl shadow-2xl flex items-center gap-3">
          <AlertOctagon className="w-5 h-5 text-red-400 shrink-0" />
          <div>
            <div className="text-sm font-bold font-mono tracking-wide text-red-100">
              PATH BLOCKED — WAITING FOR CLEARANCE
            </div>
            <div className="text-[11px] font-mono text-red-200 tabular-nums">
              Both routes blocked — waiting · Fwd {navigation.nearestForwardM.toFixed(2)}m · Left{' '}
              {navigation.leftClearanceM.toFixed(2)}m · Right {navigation.rightClearanceM.toFixed(2)}m
            </div>
          </div>
        </div>
      )}

      {/* Top-Left Live Autonomous Navigation & Rangefinder Status Card (when not in split view) */}
      {cameraViewMode !== 'split' && cameraViewMode !== 'first-person' && (
        <div className="absolute top-4 left-4 z-20 bg-slate-900 border border-slate-700/90 rounded-xl px-3.5 py-2.5 shadow-xl space-y-1.5 min-w-[262px] max-w-[310px]">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-white flex items-center gap-1.5">
              <Navigation className="w-3.5 h-3.5 text-emerald-400" />
              Autonomous Navigation
            </span>
            <div className="flex items-center gap-1.5">
              <span
                className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold ${
                  navigation.activityState === 'MOVING'
                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40'
                    : navigation.activityState === 'WAITING'
                    ? 'bg-amber-950 text-amber-300 border border-amber-500/40'
                    : 'bg-slate-800 text-slate-400'
                }`}
              >
                {navigation.activityState}
              </span>
              <button
                type="button"
                onClick={() => onUpdateNavigation({ enabled: !navigation.enabled })}
                className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold cursor-pointer transition-colors ${
                  navigation.enabled
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-800 text-slate-300 hover:text-white'
                }`}
              >
                {navigation.enabled ? 'ACTIVE' : 'ENABLE'}
              </button>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-1.5 text-[10px] font-mono tabular-nums">
            <div className="bg-slate-950 border border-slate-800 rounded px-1.5 py-1">
              <div className="text-slate-400">LEFT</div>
              <div className="text-sky-300 font-semibold">
                {navigation.leftClearanceM.toFixed(2)}m
              </div>
            </div>
            <div className="bg-slate-950 border border-slate-800 rounded px-1.5 py-1">
              <div className="text-slate-400">FRONT</div>
              <div
                className={`font-semibold ${
                  navigation.nearestForwardM <= navigation.safetyDistanceM
                    ? 'text-red-400'
                    : 'text-emerald-300'
                }`}
              >
                {navigation.nearestForwardM.toFixed(2)}m
              </div>
            </div>
            <div className="bg-slate-950 border border-slate-800 rounded px-1.5 py-1">
              <div className="text-slate-400">RIGHT</div>
              <div className="text-sky-300 font-semibold">
                {navigation.rightClearanceM.toFixed(2)}m
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between text-[10px] font-mono pt-0.5">
            <span
              className={
                isPathBlocked
                  ? 'text-red-400 font-bold'
                  : navigation.enabled
                  ? 'text-amber-300 font-semibold'
                  : 'text-slate-400'
              }
            >
              {navigation.fsmState}
            </span>
            <span className="text-slate-300">
              DIR: <strong>{navigation.selectedTurnDirection}</strong>
            </span>
          </div>
          <div className="text-[10px] font-mono text-slate-300 bg-slate-950 border border-slate-800/90 rounded px-2 py-1 truncate">
            {navigation.statusMessage}
          </div>
        </div>
      )}

      {/* Drag-to-Select Marquee Box */}
      {marqueeRect && (
        <div
          className="absolute border border-sky-400 bg-sky-500/15 pointer-events-none z-20"
          style={{
            left: Math.min(marqueeRect.x1, marqueeRect.x2),
            top: Math.min(marqueeRect.y1, marqueeRect.y2),
            width: Math.abs(marqueeRect.x2 - marqueeRect.x1),
            height: Math.abs(marqueeRect.y2 - marqueeRect.y1),
          }}
        />
      )}

      {/* Interactive 3D Channel Badges (CH0–CH11) */}
      {showChannelLabels && (
        <div className="absolute inset-0 pointer-events-none z-10 overflow-hidden">
          {projectedLabels.map(
            (lbl) =>
              lbl.visible && (
                <button
                  key={lbl.channel}
                  type="button"
                  onClick={() => onSelectTarget({ kind: 'joint', channel: lbl.channel })}
                  style={{
                    transform: `translate(${Math.round(lbl.x)}px, ${Math.round(lbl.y)}px) translate(-50%, -50%)`,
                  }}
                  className={`pointer-events-auto absolute top-0 left-0 px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold transition-colors border whitespace-nowrap ${
                    selectedTarget?.kind === 'joint' && selectedTarget.channel === lbl.channel
                      ? 'bg-sky-500 text-slate-950 border-sky-300 shadow'
                      : lbl.channel === 7
                      ? 'bg-slate-900 text-amber-300 border-amber-500/50 hover:border-amber-400'
                      : 'bg-slate-900 text-slate-200 border-slate-700/80 hover:border-sky-400'
                  }`}
                >
                  {channels[lbl.channel].leg} CH{lbl.channel} · {lbl.angle.toFixed(0)}°
                </button>
              )
          )}
        </div>
      )}

      {/* First-Person Robot Camera Detection Overlay */}
      {cameraViewMode === 'first-person' && cameraModule.showDetections && (
        <div className="absolute inset-0 pointer-events-none z-10">
          <div className="absolute top-4 left-4 bg-slate-900 border border-slate-700 px-3 py-1.5 rounded-lg text-xs font-mono text-sky-300">
            ROBOT VIRTUAL CAMERA POV · {navigation.fsmState}
          </div>
          {detections.map((det) => (
            <div
              key={det.id}
              style={{
                left: `${det.bbox.x * 100}%`,
                top: `${det.bbox.y * 100}%`,
                width: `${det.bbox.width * 100}%`,
                height: `${det.bbox.height * 100}%`,
              }}
              className="absolute border-2 border-emerald-400 bg-emerald-500/10"
            >
              <div className="bg-emerald-500 text-slate-950 text-[11px] font-mono font-semibold px-1.5 py-0.5 inline-block whitespace-nowrap">
                {det.label} {(det.confidence * 100).toFixed(0)}%
                {cameraModule.showDepth ? ` · ${det.distanceMeters.toFixed(2)}m` : ''} [SIM]
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Split View Secondary Robot Camera Feed Window */}
      {cameraViewMode === 'split' && (
        <div className="absolute top-4 left-4 w-72 bg-slate-900 border border-slate-700 rounded-xl overflow-hidden shadow-xl z-20">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-800 text-[11px] font-mono">
            <span className="text-sky-300 font-semibold">ROBOT CAM [SIMULATED]</span>
            <span className="text-slate-400">{detections.length} OBJ</span>
          </div>
          <div className="relative aspect-[16/10] bg-slate-950">
            <canvas
              ref={splitOverlayCanvasRef}
              width={320}
              height={200}
              className="w-full h-full block"
            />
            {cameraModule.showDetections &&
              detections.map((det) => (
                <div
                  key={det.id}
                  style={{
                    left: `${det.bbox.x * 100}%`,
                    top: `${det.bbox.y * 100}%`,
                    width: `${det.bbox.width * 100}%`,
                    height: `${det.bbox.height * 100}%`,
                  }}
                  className="absolute border border-emerald-400 pointer-events-none"
                >
                  <span className="bg-emerald-500 text-slate-950 text-[9px] font-mono font-semibold px-1 block truncate">
                    {det.label} {(det.confidence * 100).toFixed(0)}%{' '}
                    {cameraModule.showDepth ? `${det.distanceMeters.toFixed(1)}m` : ''}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Top-Right Compact Selection & Attachment Mode Status Banner */}
      <div className="absolute top-4 right-4 flex items-center gap-2 z-20">
        {attachmentMode && (
          <div className="bg-amber-950 border border-amber-500/60 text-amber-200 px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-2">
            <Wrench className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>Attachment Mode: Click Camera, LCD, or Mic to reposition</span>
          </div>
        )}
        {selectedTarget && (
          <div className="bg-slate-900 border border-slate-700 px-3 py-1.5 rounded-lg text-xs text-slate-200 flex items-center gap-2">
            <Crosshair className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            <span className="font-mono">
              {selectedTarget.kind === 'joint'
                ? `CH${selectedTarget.channel} (${channels[selectedTarget.channel].label})`
                : selectedTarget.kind === 'chassis'
                ? selectedTarget.partName
                : selectedTarget.kind === 'module'
                ? `Module: ${selectedTarget.moduleId.toUpperCase()}`
                : `Scene: ${selectedTarget.objectId}`}
            </span>
            <button
              type="button"
              onClick={() => onSelectTarget(null)}
              className="text-slate-400 hover:text-white ml-1 text-[11px] underline cursor-pointer"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {/* Collapsible Bottom Control Dock */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center max-w-[96%]">
        <button
          type="button"
          onClick={() => setDockCollapsed((v) => !v)}
          className="px-3 py-1 bg-slate-900 border border-b-0 border-slate-700 rounded-t-lg text-[11px] font-medium text-slate-300 hover:text-white flex items-center gap-1.5 cursor-pointer"
        >
          {dockCollapsed ? (
            <>
              <Maximize2 className="w-3 h-3" /> Show Viewport Tools
            </>
          ) : (
            <>
              <Minimize2 className="w-3 h-3" /> Hide Tools
            </>
          )}
        </button>

        {!dockCollapsed && (
          <div className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 shadow-2xl flex flex-wrap items-center justify-center gap-2">
            {/* Pointer / Selection Modes */}
            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
              <button
                type="button"
                onClick={() => setViewportTool('select')}
                className={`px-2.5 py-1 rounded text-xs font-medium flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                  viewportTool === 'select'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <MousePointer className="w-3.5 h-3.5" /> Select & Gizmo
              </button>
              <button
                type="button"
                onClick={() => setViewportTool('floor-drag')}
                className={`px-2.5 py-1 rounded text-xs font-medium flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                  viewportTool === 'floor-drag'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <Move className="w-3.5 h-3.5" /> Drag Robot / Obstacles
              </button>
              <button
                type="button"
                onClick={() => setViewportTool('box-select')}
                className={`px-2.5 py-1 rounded text-xs font-medium flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                  viewportTool === 'box-select'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <Scan className="w-3.5 h-3.5" /> Box Select
              </button>
            </div>

            {/* Transform Gizmo Mode */}
            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
              <button
                type="button"
                onClick={() => setGizmoMode('translate')}
                className={`px-2 py-1 rounded text-xs font-medium whitespace-nowrap cursor-pointer ${
                  gizmoMode === 'translate'
                    ? 'bg-slate-700 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Move
              </button>
              <button
                type="button"
                onClick={() => setGizmoMode('rotate')}
                className={`px-2 py-1 rounded text-xs font-medium flex items-center gap-1 whitespace-nowrap cursor-pointer ${
                  gizmoMode === 'rotate'
                    ? 'bg-slate-700 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <RotateCw className="w-3 h-3" /> Rotate
              </button>
              <button
                type="button"
                onClick={() => setGizmoMode('scale')}
                className={`px-2 py-1 rounded text-xs font-medium whitespace-nowrap cursor-pointer ${
                  gizmoMode === 'scale'
                    ? 'bg-slate-700 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Scale
              </button>
            </div>

            {/* Component Attachment Mode Toggle */}
            <button
              type="button"
              onClick={onToggleAttachmentMode}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors ${
                attachmentMode
                  ? 'bg-amber-500 text-slate-950 border-amber-400 font-semibold'
                  : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-600'
              }`}
            >
              <Wrench className="w-3.5 h-3.5" />
              Attach Mode
            </button>

            {/* Quick Spawn Solid Lab Obstacles */}
            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
              <button
                type="button"
                onClick={() => onSpawnLabObject('wall')}
                className="px-2 py-1 rounded text-xs text-slate-300 hover:bg-slate-800 hover:text-white flex items-center gap-1 whitespace-nowrap cursor-pointer"
              >
                <SquareStack className="w-3.5 h-3.5 text-rose-400" /> +Wall
              </button>
              <button
                type="button"
                onClick={() => onSpawnLabObject('box')}
                className="px-2 py-1 rounded text-xs text-slate-300 hover:bg-slate-800 hover:text-white flex items-center gap-1 whitespace-nowrap cursor-pointer"
              >
                <Box className="w-3.5 h-3.5 text-amber-400" /> +Box
              </button>
              <button
                type="button"
                onClick={() => onSpawnLabObject('human')}
                className="px-2 py-1 rounded text-xs text-slate-300 hover:bg-slate-800 hover:text-white flex items-center gap-1 whitespace-nowrap cursor-pointer"
              >
                <UserPlus className="w-3.5 h-3.5 text-sky-400" /> +Person
              </button>
              <button
                type="button"
                onClick={() => onSpawnLabObject('ramp')}
                className="px-2 py-1 rounded text-xs text-slate-300 hover:bg-slate-800 hover:text-white flex items-center gap-1 whitespace-nowrap cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 text-emerald-400" /> +Ramp
              </button>
            </div>

            {/* Camera Views & Overlays */}
            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
              {(['iso', 'front', 'side', 'top'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => {
                    if (cameraViewMode === 'first-person') onChangeCameraViewMode('orbit');
                    jumpCameraPreset(p);
                  }}
                  className="px-2 py-1 rounded text-xs text-slate-300 hover:bg-slate-800 hover:text-white capitalize whitespace-nowrap cursor-pointer"
                >
                  {p}
                </button>
              ))}
              <button
                type="button"
                onClick={() =>
                  onChangeCameraViewMode(
                    cameraViewMode === 'first-person' ? 'orbit' : 'first-person'
                  )
                }
                className={`px-2 py-1 rounded text-xs font-medium flex items-center gap-1 whitespace-nowrap cursor-pointer ${
                  cameraViewMode === 'first-person'
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <Eye className="w-3.5 h-3.5" /> POV
              </button>
            </div>

            {/* Sensor Rays, Channel Labels & Grid Toggles */}
            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
              <button
                type="button"
                onClick={() =>
                  onUpdateNavigation({ showSensorRays: !navigation.showSensorRays })
                }
                className={`px-2 py-1 rounded text-xs flex items-center gap-1 whitespace-nowrap cursor-pointer ${
                  navigation.showSensorRays ? 'bg-slate-800 text-emerald-300' : 'text-slate-500'
                }`}
              >
                <Radar className="w-3.5 h-3.5" /> Rays
              </button>
              <button
                type="button"
                onClick={() => setShowChannelLabels((v) => !v)}
                className={`px-2 py-1 rounded text-xs flex items-center gap-1 whitespace-nowrap cursor-pointer ${
                  showChannelLabels ? 'bg-slate-800 text-sky-300' : 'text-slate-400'
                }`}
              >
                <Layers className="w-3.5 h-3.5" /> CH Labels
              </button>
              <button
                type="button"
                onClick={() => setShowGrid((v) => !v)}
                className={`px-2 py-1 rounded text-xs flex items-center gap-1 whitespace-nowrap cursor-pointer ${
                  showGrid ? 'bg-slate-800 text-slate-200' : 'text-slate-500'
                }`}
              >
                <Grid className="w-3.5 h-3.5" /> Grid
              </button>
              <button
                type="button"
                onClick={() => setShowCollisionWireframes((v) => !v)}
                className={`px-2 py-1 rounded text-xs flex items-center gap-1 whitespace-nowrap cursor-pointer ${
                  showCollisionWireframes ? 'bg-slate-800 text-amber-300' : 'text-slate-500'
                }`}
              >
                <Compass className="w-3.5 h-3.5" /> Bounds
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
