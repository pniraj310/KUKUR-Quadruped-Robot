import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  BodyPose,
  DetectedObject,
  EnvironmentType,
  GaitType,
  LcdDisplayState,
  RobotJointAngles,
  SceneItem,
  SensorData,
  Vector3D,
} from '../types/robot';
import { buildSpotMicroRobot, SpotMicroVisualModel } from '../simulation/robot3d';
import { buildEnvironment, EnvironmentScene } from '../simulation/environments';
import { generateGaitJoints } from '../simulation/kinematics';
import { simulateSensors } from '../simulation/sensors';

export type CameraViewMode = 'orbit' | 'follow' | 'front_sensor' | 'side_kinematics';

interface Viewport3DProps {
  gait: GaitType;
  envType: EnvironmentType;
  bodyPose: BodyPose;
  strideLength: number;
  stepHeight: number;
  turnRate: number;
  speedMultiplier: number;
  cameraMode: CameraViewMode;
  onSensorsUpdate: (sensors: SensorData, joints: RobotJointAngles) => void;
  onDetectionsUpdate: (detections: DetectedObject[]) => void;
  onSelectJointOrPart: (channel: number | null, name: string) => void;
  selectedChannel: number;
  isSimRunning: boolean;
  isEmergencyStopped: boolean;
  lcdState: LcdDisplayState;
  isFovVisible: boolean;
  sceneItems: SceneItem[];
}

export const Viewport3D: React.FC<Viewport3DProps> = ({
  gait,
  envType,
  bodyPose,
  strideLength,
  stepHeight,
  turnRate,
  speedMultiplier,
  cameraMode,
  onSensorsUpdate,
  onDetectionsUpdate,
  onSelectJointOrPart,
  selectedChannel,
  isSimRunning,
  isEmergencyStopped,
  lcdState,
  isFovVisible,
  sceneItems,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);

  // References for render loop state
  const stateRef = useRef({
    gait,
    envType,
    bodyPose,
    strideLength,
    stepHeight,
    turnRate,
    speedMultiplier,
    cameraMode,
    isSimRunning,
    isEmergencyStopped,
    selectedChannel,
    lcdState,
    isFovVisible,
    sceneItems,
  });

  useEffect(() => {
    stateRef.current = {
      gait,
      envType,
      bodyPose,
      strideLength,
      stepHeight,
      turnRate,
      speedMultiplier,
      cameraMode,
      isSimRunning,
      isEmergencyStopped,
      selectedChannel,
      lcdState,
      isFovVisible,
      sceneItems,
    };
  }, [
    gait,
    envType,
    bodyPose,
    strideLength,
    stepHeight,
    turnRate,
    speedMultiplier,
    cameraMode,
    isSimRunning,
    isEmergencyStopped,
    selectedChannel,
    lcdState,
    isFovVisible,
    sceneItems,
  ]);

  useEffect(() => {
    if (!mountRef.current) return;

    // 1. Detect Software WebGL
    const isSoftwareGl = (() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    // 2. Scene, Main Camera, Renderer
    const width = mountRef.current.clientWidth;
    const height = mountRef.current.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0c10);
    scene.fog = new THREE.FogExp2(0x0a0c10, 0.035);

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.05, 50);
    camera.position.set(0.7, 0.5, 0.95);

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    mountRef.current.appendChild(renderer.domElement);

    // 3. Procedural Studio Environment Reflection
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    // 4. Lighting Rig
    const hemiLight = new THREE.HemisphereLight(0x93c5fd, 0x1e293b, 1.2);
    hemiLight.position.set(0, 10, 0);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff7ed, 2.4);
    keyLight.position.set(3, 5, 4);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.width = 2048;
    keyLight.shadow.mapSize.height = 2048;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    keyLight.shadow.camera.left = -2;
    keyLight.shadow.camera.right = 2;
    keyLight.shadow.camera.top = 2;
    keyLight.shadow.camera.bottom = -2;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 1.0);
    rimLight.position.set(-3, 3, -4);
    scene.add(rimLight);

    // 5. Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2 - 0.02;
    controls.minDistance = 0.2;
    controls.maxDistance = 15;
    controls.target.set(0, 0.16, 0);
    controls.update();

    // 6. KUKUR Robot Model
    const robot = buildSpotMicroRobot();
    scene.add(robot.rootGroup);

    // Initial highlight for CH7 (Back-Left Hip Pitch)
    robot.highlightPart(7);

    // 7. Environment Scene
    let currentEnv: EnvironmentScene = buildEnvironment(stateRef.current.envType);
    scene.add(currentEnv.group);

    // 8. Click Raycaster for Joint Selection
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const handlePointerDown = (event: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(robot.selectableObjects, true);

      if (intersects.length > 0) {
        let hitObj: THREE.Object3D | null = intersects[0].object;
        while (hitObj && !hitObj.userData?.name && hitObj.parent) {
          hitObj = hitObj.parent;
        }

        if (hitObj && hitObj.userData) {
          const ch = typeof hitObj.userData.channel === 'number' ? hitObj.userData.channel : null;
          const name = hitObj.userData.name || 'Component';
          onSelectJointOrPart(ch, name);
          robot.highlightPart(ch !== null ? ch : name);
        }
      }
    };

    renderer.domElement.addEventListener('pointerdown', handlePointerDown);

    // Reusable math vectors to prevent GC
    const robotPosition = new THREE.Vector3(0, 0.165, 0);
    const robotRotation = { roll: 0, pitch: 0, yaw: 0 };
    let previousRotation = { ...robotRotation };
    let gaitPhase = 0;
    const clock = new THREE.Clock();

    let frameId = 0;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    let activeEnvType = stateRef.current.envType;
    let detectionThrottle = 0;

    const tick = () => {
      const delta = Math.min(0.1, clock.getDelta());
      const state = stateRef.current;

      // Handle environment switch
      if (state.envType !== activeEnvType) {
        scene.remove(currentEnv.group);
        currentEnv.dispose();
        currentEnv = buildEnvironment(state.envType);
        scene.add(currentEnv.group);
        activeEnvType = state.envType;
        robotPosition.set(0, 0.165, 0);
        robotRotation.yaw = 0;
      }

      // Update 3D environment animations (person walking)
      currentEnv.updateAnimation(delta);

      // Emergency stop check: freeze all movement if active
      if (!state.isEmergencyStopped && state.isSimRunning) {
        const gaitSpeed =
          (state.gait === 'trot' ? 2.2 : state.gait === 'walk' ? 1.4 : 1.8) *
          state.speedMultiplier;
        gaitPhase = (gaitPhase + delta * gaitSpeed) % 1.0;

        // Differential steering turn rate
        robotRotation.yaw += state.turnRate * delta * 45;

        // Forward progression along heading
        const forwardSpeed = (state.strideLength / 1000) * gaitSpeed * 0.5;
        const currentYawRad = (robotRotation.yaw * Math.PI) / 180;
        if (state.gait === 'trot' || state.gait === 'walk' || state.gait === 'pace') {
          robotPosition.x += Math.sin(currentYawRad) * forwardSpeed * delta;
          robotPosition.z += Math.cos(currentYawRad) * forwardSpeed * delta;
        }

        // Boundary protection
        if (Math.abs(robotPosition.x) > 7.5 || Math.abs(robotPosition.z) > 7.5) {
          robotPosition.x = 0;
          robotPosition.z = 0;
        }
      }

      const yawRad = (robotRotation.yaw * Math.PI) / 180;

      // Sample ground elevation under robot
      const groundY = currentEnv.groundHeightAt(robotPosition.x, robotPosition.z);
      const targetY = groundY + state.bodyPose.y / 1000;
      robotPosition.y = THREE.MathUtils.damp(robotPosition.y, targetY, 8, delta);

      robotRotation.roll = state.bodyPose.roll;
      robotRotation.pitch = state.bodyPose.pitch;

      // Apply transformations to 3D robot root
      robot.rootGroup.position.copy(robotPosition);
      robot.rootGroup.rotation.y = (robotRotation.yaw * Math.PI) / 180;
      robot.bodyMeshGroup.rotation.z = (robotRotation.roll * Math.PI) / 180;
      robot.bodyMeshGroup.rotation.x = (-robotRotation.pitch * Math.PI) / 180;

      // Compute Leg Kinematics
      const { joints, contacts } = generateGaitJoints(
        state.isEmergencyStopped ? 'stand' : state.gait,
        gaitPhase,
        state.isEmergencyStopped ? 0 : state.strideLength,
        state.stepHeight,
        state.bodyPose,
        state.turnRate
      );

      // Articulate 3D joints
      robot.updateJoints(joints);

      // Update 16x2 LCD on physical model
      robot.updateLcdDisplay(
        state.lcdState.line1,
        state.lcdState.line2,
        state.lcdState.backlight
      );

      // Update Camera FOV visualization
      robot.setFovVisible(state.isFovVisible);

      // Update selected joint highlight
      robot.highlightPart(state.selectedChannel);

      // Simulate Real-Time Sensors
      const simulatedSensors = simulateSensors(
        { x: robotPosition.x * 1000, y: robotPosition.y * 1000, z: robotPosition.z * 1000 },
        robotRotation,
        joints,
        contacts,
        currentEnv.obstacles,
        delta,
        previousRotation
      );

      previousRotation = { ...robotRotation };
      robot.updateSensorRay(simulatedSensors.ultrasonicDistanceCm);

      // Emit sensor telemetry to HUD
      onSensorsUpdate(simulatedSensors, joints);

      // Run Synthetic Object Detection (throttled to ~15 Hz)
      detectionThrottle += delta;
      if (detectionThrottle > 0.066) {
        detectionThrottle = 0;
        const detections = currentEnv.detectObjectsInCamera(
          robot.robotCamera,
          robotPosition,
          yawRad
        );
        onDetectionsUpdate(detections);
      }

      // Camera view modes
      if (state.cameraMode === 'follow') {
        const camDist = 0.8;
        const camHeight = 0.4;
        const targetX = robotPosition.x - Math.sin(yawRad) * camDist;
        const targetZ = robotPosition.z - Math.cos(yawRad) * camDist;
        camera.position.x = THREE.MathUtils.damp(camera.position.x, targetX, 5, delta);
        camera.position.y = THREE.MathUtils.damp(camera.position.y, robotPosition.y + camHeight, 5, delta);
        camera.position.z = THREE.MathUtils.damp(camera.position.z, targetZ, 5, delta);
        controls.target.copy(robotPosition);
      } else if (state.cameraMode === 'front_sensor') {
        // POV from HC-SR04 & Pi camera eyes
        const eyeX = robotPosition.x + Math.sin(yawRad) * 0.15;
        const eyeZ = robotPosition.z + Math.cos(yawRad) * 0.15;
        camera.position.set(eyeX, robotPosition.y + 0.05, eyeZ);
        controls.target.set(
          eyeX + Math.sin(yawRad) * 2,
          robotPosition.y + 0.05,
          eyeZ + Math.cos(yawRad) * 2
        );
      } else if (state.cameraMode === 'side_kinematics') {
        // Orthographic side profile
        const sideX = robotPosition.x + Math.cos(yawRad) * 0.9;
        const sideZ = robotPosition.z - Math.sin(yawRad) * 0.9;
        camera.position.set(sideX, robotPosition.y + 0.15, sideZ);
        controls.target.copy(robotPosition);
      } else {
        controls.update();
      }

      renderer.render(scene, camera);

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    };

    tick();

    const handleResize = () => {
      if (!mountRef.current) return;
      const w = mountRef.current.clientWidth;
      const h = mountRef.current.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      controls.dispose();
      currentEnv.dispose();
      renderer.dispose();
      if (mountRef.current && renderer.domElement) {
        mountRef.current.removeChild(renderer.domElement);
      }
    };
  }, []);

  return <div ref={mountRef} className="w-full h-full relative overflow-hidden" />;
};
