import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  INITIAL_BODY_POSE,
  INITIAL_CAMERA_MODULE,
  INITIAL_GAIT_CONFIG,
  INITIAL_LAB_OBJECTS,
  INITIAL_LCD_MODULE,
  INITIAL_NAVIGATION_STATE,
  INITIAL_SERVO_CHANNELS,
  INITIAL_TELEMETRY,
  LEG_CHANNELS_MAP,
  SCENARIO_PRESETS,
} from '../initialState';
import {
  clampChannelAngle,
  computeCoordinatedLegTargets,
  computeGaitTargets,
  computeJointRadians,
  detectSceneCollisions,
  getPosePresetTargets,
  resolveSolidBodyMovement,
} from '../kinematics';
import {
  checkRobotPoseCollision,
  computeRobotWorldColliders,
  getObstacleLocalDimensions,
} from '../collision';
import {
  isRobotLiftedOffFloor,
  scanNavigationSensors,
  stepAutonomousNavigation,
} from '../navigation';
import {
  computeSimulatedUltrasonicCm,
  computeVirtualDetections,
} from '../sensors';
import { buildKukurModel } from '../../three/buildKukurModel';
import { createLabObjectGroup } from '../../three/buildLabObjects';
import { buildLcdLines } from '../../three/lcdTexture';
import { LegId, ServoChannel } from '../../types/simulator';

const ALLOWED_GREEN_HEX = new Set([0x16a34a, 0x15803d]);
const ALLOWED_BLUE_HEX = new Set([0x2563eb, 0x1d4ed8]);

test('Appearance & Structure: KUKUR body and legs use ONLY Blue & Green, with 2 Green legs and 2 Blue legs', () => {
  const dummyTex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  const rig = buildKukurModel(dummyTex as unknown as THREE.CanvasTexture);

  const legIds: LegId[] = ['FL', 'FR', 'BL', 'BR'];
  const greenLegs = legIds.filter((id) => rig.legColorScheme[id] === 'green');
  const blueLegs = legIds.filter((id) => rig.legColorScheme[id] === 'blue');
  assert.equal(greenLegs.length, 2, 'Exactly two complete legs must be green');
  assert.equal(blueLegs.length, 2, 'Exactly two complete legs must be blue');

  const chassisMeshes = Object.values(rig.chassisPartMeshes).flat();
  assert.ok(chassisMeshes.length >= 8);
  for (const mesh of chassisMeshes) {
    const mat = mesh.material as THREE.MeshStandardMaterial;
    const hex = mat.color.getHex();
    assert.ok(
      ALLOWED_GREEN_HEX.has(hex) || ALLOWED_BLUE_HEX.has(hex),
      `Unexpected chassis mesh color 0x${hex.toString(16)}`
    );
  }

  for (const legId of legIds) {
    const expectedPalette =
      rig.legColorScheme[legId] === 'green' ? ALLOWED_GREEN_HEX : ALLOWED_BLUE_HEX;
    const [abdCh, hipCh, kneeCh] = LEG_CHANNELS_MAP[legId];
    for (const ch of [abdCh, hipCh, kneeCh]) {
      const meshes = rig.channelMeshesMap[ch];
      assert.ok(meshes.length > 0, `Expected meshes for CH${ch}`);
      for (const m of meshes) {
        const mat = m.material as THREE.MeshStandardMaterial;
        const hex = mat.color.getHex();
        assert.ok(
          expectedPalette.has(hex),
          `Leg ${legId} CH${ch} mesh has inconsistent color 0x${hex.toString(16)}`
        );
      }
    }
  }

  assert.ok(rig.cameraModuleGroup.children.length > 0);
  assert.ok(rig.lcdModuleGroup.children.length > 0);
  assert.ok(rig.micModuleGroup.children.length > 0);
  assert.ok(rig.ultrasonicSensorGroup.children.length > 0);
});

test('Solid Obstacles: Walls and boxes block body, legs, and feet before penetration; floor pads stay walkable', () => {
  const selectables: THREE.Object3D[] = [];
  const wallBuilt = createLabObjectGroup(
    {
      id: 'wall-test',
      type: 'wall',
      label: 'Solid Wall',
      position: [0, 0, 0.55],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      color: '#475569',
    },
    selectables
  );
  const wallBox = new THREE.Box3().setFromObject(wallBuilt.group);
  const wallSize = new THREE.Vector3();
  wallBox.getSize(wallSize);
  const wallDims = getObstacleLocalDimensions('wall');
  assert.equal(wallDims.isSolid, true);
  assert.ok(Math.abs(wallSize.x - wallDims.halfX * 2) < 0.06);
  assert.ok(Math.abs(wallSize.y - wallDims.heightY) < 0.06);

  assert.equal(getObstacleLocalDimensions('rough-terrain').isSolid, false);

  const solidWall = [
    {
      id: 'solid-wall-1',
      type: 'wall' as const,
      label: 'Blocking Wall',
      position: [0, 0, 0.55] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
      scale: [1, 1, 1] as [number, number, number],
      color: '#475569',
    },
  ];

  let pose = { ...INITIAL_BODY_POSE, z: -0.4 };
  for (let step = 0; step < 60; step++) {
    const requested = { ...pose, z: pose.z + 0.04 };
    const resolved = resolveSolidBodyMovement(
      pose,
      requested,
      INITIAL_SERVO_CHANNELS,
      solidWall,
      1.0
    );
    pose = resolved.resolvedPose;
    const penCheck = checkRobotPoseCollision(pose, INITIAL_SERVO_CHANNELS, solidWall, 1.0, 0.0);
    assert.equal(penCheck.colliding, false, 'Robot penetrated solid wall');
  }
  assert.ok(pose.z < 0.25, `Expected robot to stop well in front of wall, got z=${pose.z}`);
});

test('Test 1 (Scenario A): Box directly ahead with both sides clear — turns left, passes box, and resumes forward walking', () => {
  const sc = SCENARIO_PRESETS['single-box'];
  let pose = { ...sc.robotPose };
  let nav = { ...INITIAL_NAVIGATION_STATE, enabled: true, safetyDistanceM: 0.75 };

  const visitedStates = new Set<string>();
  const turnStates = new Set<string>();
  const statusMessages = new Set<string>();

  for (let i = 0; i < 320; i++) {
    const out = stepAutonomousNavigation(
      0.05,
      nav,
      pose,
      INITIAL_SERVO_CHANNELS,
      sc.objects,
      [],
      1.0
    );
    nav = out.nextNav;
    pose = out.nextBodyPose;
    visitedStates.add(nav.fsmState);
    statusMessages.add(nav.statusMessage);
    if (nav.fsmState === 'TURNING_LEFT' || nav.fsmState === 'TURNING_RIGHT') {
      turnStates.add(nav.fsmState);
    }

    const col = checkRobotPoseCollision(pose, INITIAL_SERVO_CHANNELS, sc.objects, 1.0, 0.0);
    assert.equal(col.colliding, false, `Collision occurred at step ${i}`);
  }

  assert.ok(visitedStates.has('OBSTACLE_DETECTED'), 'Should enter OBSTACLE_DETECTED');
  assert.ok(visitedStates.has('CHECKING_PATHS'), 'Should enter CHECKING_PATHS');
  assert.ok(visitedStates.has('TURNING_LEFT'), 'Should turn left when left path is clear');
  assert.equal(turnStates.size, 1, 'Must commit to single turn direction without oscillation');
  assert.ok(visitedStates.has('BYPASSING_OBSTACLE'), 'Should enter BYPASSING_OBSTACLE');
  assert.ok(visitedStates.has('RESUMING_MOVEMENT'), 'Should enter RESUMING_MOVEMENT after passing box');
  assert.ok(
    statusMessages.has('Obstacle detected — checking alternate routes'),
    'Should emit obstacle detected status message'
  );
  assert.ok(
    statusMessages.has('Obstacle cleared — resuming walk'),
    'Should emit resuming walk status message'
  );
  assert.equal(nav.fsmState, 'MOVING_FORWARD', 'Should resume MOVING_FORWARD once past box');
  assert.ok(pose.z > 0.5, `Expected robot to pass box at z=0.1 and continue forward, got z=${pose.z}`);
});

test('Test 2 (Scenario A): Left side blocked and right side clear — turns right and bypasses obstacle', () => {
  const sc = SCENARIO_PRESETS['wall-one-side'];
  let pose = { ...sc.robotPose };
  let nav = { ...INITIAL_NAVIGATION_STATE, enabled: true, safetyDistanceM: 0.75 };

  const turnStates = new Set<string>();
  const messages = new Set<string>();

  for (let i = 0; i < 320; i++) {
    const out = stepAutonomousNavigation(
      0.05,
      nav,
      pose,
      INITIAL_SERVO_CHANNELS,
      sc.objects,
      [],
      1.0
    );
    nav = out.nextNav;
    pose = out.nextBodyPose;
    messages.add(nav.statusMessage);
    if (nav.fsmState === 'TURNING_LEFT' || nav.fsmState === 'TURNING_RIGHT') {
      turnStates.add(nav.fsmState);
    }

    const col = checkRobotPoseCollision(pose, INITIAL_SERVO_CHANNELS, sc.objects, 1.0, 0.0);
    assert.equal(col.colliding, false, `Collided during wall-one-side at step ${i}`);
  }

  assert.ok(turnStates.has('TURNING_RIGHT'), 'Should turn RIGHT when left path is blocked');
  assert.equal(turnStates.has('TURNING_LEFT'), false, 'Must not turn into left blocking wall');
  assert.ok(messages.has('Left blocked — turning right'), 'Should report Left blocked — turning right');
  assert.ok(pose.x < -0.25, `Expected robot to bypass on right (-X) side, got x=${pose.x}`);
  assert.ok(pose.z > 0.35, `Expected robot to pass obstacle and resume forward walking, got z=${pose.z}`);
});

test('Test 3 (Scenario A): Right side blocked and left side clear — turns left and bypasses obstacle', () => {
  const sc = SCENARIO_PRESETS['wall-right-side'];
  let pose = { ...sc.robotPose };
  let nav = { ...INITIAL_NAVIGATION_STATE, enabled: true, safetyDistanceM: 0.75 };

  const turnStates = new Set<string>();
  const messages = new Set<string>();

  for (let i = 0; i < 320; i++) {
    const out = stepAutonomousNavigation(
      0.05,
      nav,
      pose,
      INITIAL_SERVO_CHANNELS,
      sc.objects,
      [],
      1.0
    );
    nav = out.nextNav;
    pose = out.nextBodyPose;
    messages.add(nav.statusMessage);
    if (nav.fsmState === 'TURNING_LEFT' || nav.fsmState === 'TURNING_RIGHT') {
      turnStates.add(nav.fsmState);
    }

    const col = checkRobotPoseCollision(pose, INITIAL_SERVO_CHANNELS, sc.objects, 1.0, 0.0);
    assert.equal(col.colliding, false, `Collided during wall-right-side at step ${i}`);
  }

  assert.ok(turnStates.has('TURNING_LEFT'), 'Should turn LEFT when right path is blocked');
  assert.equal(turnStates.has('TURNING_RIGHT'), false, 'Must not turn into right blocking wall');
  assert.ok(messages.has('Right blocked — turning left'), 'Should report Right blocked — turning left');
  assert.ok(pose.x > 0.25, `Expected robot to bypass on left (+X) side, got x=${pose.x}`);
  assert.ok(pose.z > 0.35, `Expected robot to pass obstacle and resume forward walking, got z=${pose.z}`);
});

test('Test 4 (Scenario B): All directions blocked waits safely with PATH BLOCKED — WAITING FOR CLEARANCE, then automatically selects side route when one obstacle is removed', () => {
  const sc = SCENARIO_PRESETS['blocked-corridor'];
  let pose = { ...sc.robotPose };
  let nav = { ...INITIAL_NAVIGATION_STATE, enabled: true, safetyDistanceM: 0.75 };

  const statesPhase1 = new Set<string>();
  let yawWhileBlocked: number | null = null;

  for (let i = 0; i < 120; i++) {
    const out = stepAutonomousNavigation(
      0.05,
      nav,
      pose,
      INITIAL_SERVO_CHANNELS,
      sc.objects,
      [],
      1.0
    );
    nav = out.nextNav;
    pose = out.nextBodyPose;
    statesPhase1.add(nav.fsmState);

    if (nav.fsmState === 'WAITING_FOR_CLEARANCE') {
      if (yawWhileBlocked === null) yawWhileBlocked = pose.yaw;
      assert.equal(
        pose.yaw,
        yawWhileBlocked,
        'Must not keep turning against a wall while waiting for clearance'
      );
      assert.equal(out.shouldAnimateGait, false);
    }

    const col = checkRobotPoseCollision(pose, INITIAL_SERVO_CHANNELS, sc.objects, 1.0, 0.0);
    assert.equal(col.colliding, false, `Collided while blocked at step ${i}`);
  }

  assert.ok(statesPhase1.has('PATH_BLOCKED'), 'Should enter PATH_BLOCKED');
  assert.equal(nav.fsmState, 'WAITING_FOR_CLEARANCE', 'Should wait in WAITING_FOR_CLEARANCE');
  assert.equal(nav.activityState, 'WAITING');
  assert.ok(
    nav.statusMessage.includes('PATH BLOCKED — WAITING FOR CLEARANCE'),
    `Expected PATH BLOCKED — WAITING FOR CLEARANCE in status, got: ${nav.statusMessage}`
  );

  const lcdLines = buildLcdLines(
    INITIAL_LCD_MODULE,
    'stand',
    false,
    INITIAL_SERVO_CHANNELS,
    INITIAL_TELEMETRY,
    nav
  );
  assert.equal(lcdLines[0], 'PATH BLOCKED');
  assert.equal(lcdLines[1], 'WAITING FOR CLEARANCE');

  // Remove ONLY the left corridor wall while keeping front & right walls — robot must automatically turn LEFT and exit!
  const objectsLeftOpened = sc.objects.filter((o) => o.id !== 'corridor-left-wall');
  const statesPhase2 = new Set<string>();

  for (let i = 0; i < 200; i++) {
    const out = stepAutonomousNavigation(
      0.05,
      nav,
      pose,
      INITIAL_SERVO_CHANNELS,
      objectsLeftOpened,
      [],
      1.0
    );
    nav = out.nextNav;
    pose = out.nextBodyPose;
    statesPhase2.add(nav.fsmState);

    const col = checkRobotPoseCollision(pose, INITIAL_SERVO_CHANNELS, objectsLeftOpened, 1.0, 0.0);
    assert.equal(col.colliding, false, `Collided exiting opened left corridor at step ${i}`);
  }

  assert.ok(statesPhase2.has('TURNING_LEFT'), 'Should automatically turn left into opened side route');
  assert.ok(pose.x > 0.65, `Expected robot to walk out opened left corridor (+X), got x=${pose.x}`);
});

test('Test 5 (Scenario C): Front obstacle removed while robot is waiting — automatically resumes walking without pressing Start', () => {
  const sc = SCENARIO_PRESETS['blocked-corridor'];
  let pose = { ...sc.robotPose };
  let nav = { ...INITIAL_NAVIGATION_STATE, enabled: true, safetyDistanceM: 0.75 };

  for (let i = 0; i < 80; i++) {
    const out = stepAutonomousNavigation(
      0.05,
      nav,
      pose,
      INITIAL_SERVO_CHANNELS,
      sc.objects,
      [],
      1.0
    );
    nav = out.nextNav;
    pose = out.nextBodyPose;
  }
  assert.equal(nav.fsmState, 'WAITING_FOR_CLEARANCE');
  const haltedZ = pose.z;

  // Remove the front blocking wall while robot is waiting (without toggling nav.enabled)
  const objectsFrontRemoved = sc.objects.filter((o) => o.id !== 'corridor-front-wall');
  const statesAfterRemoval = new Set<string>();
  const messagesAfterRemoval = new Set<string>();

  for (let i = 0; i < 80; i++) {
    const out = stepAutonomousNavigation(
      0.05,
      nav,
      pose,
      INITIAL_SERVO_CHANNELS,
      objectsFrontRemoved,
      [],
      1.0
    );
    nav = out.nextNav;
    pose = out.nextBodyPose;
    statesAfterRemoval.add(nav.fsmState);
    messagesAfterRemoval.add(nav.statusMessage);
  }

  assert.ok(statesAfterRemoval.has('RESUMING_MOVEMENT'), 'Should transition through RESUMING_MOVEMENT');
  assert.ok(
    messagesAfterRemoval.has('Obstacle cleared — resuming walk'),
    'Should display Obstacle cleared — resuming walk'
  );
  assert.equal(nav.fsmState, 'MOVING_FORWARD', 'Should resume MOVING_FORWARD automatically');
  assert.equal(nav.activityState, 'MOVING');
  assert.ok(pose.z > haltedZ + 0.5, `Expected robot to walk forward after front obstacle removal, got z=${pose.z}`);
});

test('Test 6 (Scenario E): Robot manually rotated to face a clear path (or an obstacle) recalculates relative to new orientation and resumes without snapping back', () => {
  const sc = SCENARIO_PRESETS['blocked-corridor'];
  // Leave rear open so rotating 180° faces an open corridor (-Z)
  const uShapedWalls = sc.objects.filter((o) => o.id !== 'corridor-back-wall');
  let pose = { ...sc.robotPose };
  let nav = { ...INITIAL_NAVIGATION_STATE, enabled: true, safetyDistanceM: 0.75 };

  // Let robot walk forward until blocked by u-shaped dead end
  for (let i = 0; i < 70; i++) {
    const out = stepAutonomousNavigation(0.05, nav, pose, INITIAL_SERVO_CHANNELS, uShapedWalls, [], 1.0);
    nav = out.nextNav;
    pose = out.nextBodyPose;
  }
  assert.equal(nav.fsmState, 'WAITING_FOR_CLEARANCE');

  // User manually rotates KUKUR to yaw = 180° (facing clear -Z path)
  pose = { ...pose, yaw: 180 };
  const relocStep = stepAutonomousNavigation(
    0.05,
    nav,
    pose,
    INITIAL_SERVO_CHANNELS,
    uShapedWalls,
    [],
    1.0
  );
  nav = relocStep.nextNav;
  pose = relocStep.nextBodyPose;
  assert.equal(nav.fsmState, 'RELOCALIZING', 'Must detect manual heading change and enter RELOCALIZING');
  assert.equal(nav.statusMessage, 'Robot repositioned — recalculating route');
  assert.equal(pose.yaw, 180, 'Must NOT snap yaw back to old orientation');
  assert.equal(relocStep.shouldAnimateGait, false, 'Pause locomotion during relocalization');

  const zBeforeResume = pose.z;
  for (let i = 0; i < 50; i++) {
    const out = stepAutonomousNavigation(0.05, nav, pose, INITIAL_SERVO_CHANNELS, uShapedWalls, [], 1.0);
    nav = out.nextNav;
    pose = out.nextBodyPose;
  }
  assert.equal(nav.fsmState, 'MOVING_FORWARD', 'Should automatically resume walking along new 180° heading');
  assert.equal(pose.yaw, 180);
  assert.ok(pose.z < zBeforeResume - 0.5, `Expected robot to advance along -Z (yaw=180°), got z=${pose.z}`);

  // Now manually rotate KUKUR to face a nearby box -> must stop forward motion and turn safely
  const boxNearNegativeZ = [
    {
      id: 'box-neg-z',
      type: 'box' as const,
      label: 'South Box',
      position: [0, 0, pose.z - 0.82] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
      scale: [1, 1, 1] as [number, number, number],
      color: '#d97706',
    },
  ];
  pose = { ...pose, yaw: 175 }; // Trigger manual rotation event facing the obstacle
  const turnObserved = new Set<string>();
  for (let i = 0; i < 80; i++) {
    const out = stepAutonomousNavigation(
      0.05,
      nav,
      pose,
      INITIAL_SERVO_CHANNELS,
      boxNearNegativeZ,
      [],
      1.0
    );
    nav = out.nextNav;
    pose = out.nextBodyPose;
    if (nav.fsmState === 'TURNING_LEFT' || nav.fsmState === 'TURNING_RIGHT') {
      turnObserved.add(nav.fsmState);
    }
  }
  assert.ok(
    turnObserved.size >= 1,
    'When new manual heading faces an obstacle, robot must stop forward movement and select a safe turn'
  );
});

test('Test 7 (Scenario D): Robot dragged to a new safe position pauses while dragged, retains new coordinates, and automatically resumes gait', () => {
  const sc = SCENARIO_PRESETS['blocked-corridor'];
  let pose = { ...sc.robotPose };
  let nav = { ...INITIAL_NAVIGATION_STATE, enabled: true, safetyDistanceM: 0.75 };

  // Start inside blocked corridor
  for (let i = 0; i < 60; i++) {
    const out = stepAutonomousNavigation(0.05, nav, pose, INITIAL_SERVO_CHANNELS, sc.objects, [], 1.0);
    nav = out.nextNav;
    pose = out.nextBodyPose;
  }
  assert.equal(nav.fsmState, 'WAITING_FOR_CLEARANCE');

  // User drags robot outside the corridor to a clear safe spot (x = 2.0, z = -1.2, yaw = 0)
  pose = { ...pose, x: 2.0, z: -1.2, yaw: 0 };

  // While user is still dragging (`userManipulating: true`), robot stays paused in RELOCALIZING
  const dragFrame = stepAutonomousNavigation(
    0.05,
    nav,
    pose,
    INITIAL_SERVO_CHANNELS,
    sc.objects,
    [],
    1.0,
    { userManipulating: true }
  );
  nav = dragFrame.nextNav;
  pose = dragFrame.nextBodyPose;
  assert.equal(nav.fsmState, 'RELOCALIZING');
  assert.equal(dragFrame.shouldAnimateGait, false);
  assert.equal(pose.x, 2.0, 'Must never snap robot back to old X position');
  assert.equal(pose.z, -1.2, 'Must never snap robot back to old Z position');

  // User releases drag -> robot finishes relocalizing and automatically resumes forward gait from (2.0, -1.2)
  let sawGaitResume = false;
  for (let i = 0; i < 40; i++) {
    const out = stepAutonomousNavigation(0.05, nav, pose, INITIAL_SERVO_CHANNELS, sc.objects, [], 1.0);
    nav = out.nextNav;
    pose = out.nextBodyPose;
    if (out.shouldAnimateGait) sawGaitResume = true;
  }

  assert.equal(sawGaitResume, true, 'Should automatically resume gait animation after placement');
  assert.equal(nav.fsmState, 'MOVING_FORWARD');
  assert.equal(pose.x, 2.0, 'Should continue walking from new X=2.0 coordinate');
  assert.ok(pose.z > -0.7, `Expected robot to advance forward from new Z=-1.2, got z=${pose.z}`);
});

test('Test 8 (Scenario D): Robot lifted from ground suspends ground locomotion and resumes automatically when placed back down', () => {
  let pose = { ...INITIAL_BODY_POSE, x: 0, y: 0.36, z: -1.5, yaw: 0 };
  let nav = { ...INITIAL_NAVIGATION_STATE, enabled: true, safetyDistanceM: 0.75 };

  // Walk a few frames on the floor
  for (let i = 0; i < 10; i++) {
    const out = stepAutonomousNavigation(0.05, nav, pose, INITIAL_SERVO_CHANNELS, [], [], 1.0);
    nav = out.nextNav;
    pose = out.nextBodyPose;
  }
  assert.equal(isRobotLiftedOffFloor(pose, INITIAL_SERVO_CHANNELS, 1.0), false);
  assert.equal(nav.fsmState, 'MOVING_FORWARD');

  // Lift robot off the floor (y = 0.52m)
  pose = { ...pose, y: 0.52 };
  assert.equal(isRobotLiftedOffFloor(pose, INITIAL_SERVO_CHANNELS, 1.0), true);

  const zWhenLifted = pose.z;
  for (let i = 0; i < 25; i++) {
    const out = stepAutonomousNavigation(0.05, nav, pose, INITIAL_SERVO_CHANNELS, [], [], 1.0);
    nav = out.nextNav;
    pose = out.nextBodyPose;
    assert.equal(out.shouldAnimateGait, false, 'Ground locomotion must be suspended while lifted in air');
    assert.equal(nav.isLiftedOffFloor, true);
    assert.equal(nav.activityState, 'WAITING');
  }
  assert.equal(pose.z, zWhenLifted, 'Robot must not translate across floor while lifted');

  // Place robot back on the floor at (x = -0.8, y = 0.36, z = -1.0)
  pose = { ...pose, x: -0.8, y: 0.36, z: -1.0 };
  for (let i = 0; i < 30; i++) {
    const out = stepAutonomousNavigation(0.05, nav, pose, INITIAL_SERVO_CHANNELS, [], [], 1.0);
    nav = out.nextNav;
    pose = out.nextBodyPose;
  }
  assert.equal(nav.isLiftedOffFloor, false);
  assert.equal(nav.fsmState, 'MOVING_FORWARD', 'Must automatically resume walking once placed back on floor');
  assert.equal(pose.x, -0.8);
  assert.ok(pose.z > -0.6, `Expected robot to resume walking forward after placement, got z=${pose.z}`);
});

test('Test 9 (Manual Stop Override): Stop Simulation disables autonomous mode immediately and never auto-restarts until user starts again', () => {
  const sc = SCENARIO_PRESETS['single-box'];
  let pose = { ...sc.robotPose };
  let nav = { ...INITIAL_NAVIGATION_STATE, enabled: true, safetyDistanceM: 0.75 };

  // Walk forward into active autonomous navigation
  for (let i = 0; i < 15; i++) {
    const out = stepAutonomousNavigation(0.05, nav, pose, INITIAL_SERVO_CHANNELS, sc.objects, [], 1.0);
    nav = out.nextNav;
    pose = out.nextBodyPose;
  }
  assert.notEqual(nav.fsmState, 'IDLE', 'Should be actively navigating before Stop Simulation');

  // User presses Stop Simulation -> nav.enabled becomes false
  nav = { ...nav, enabled: false };
  const stoppedPose = { ...pose };

  // Even if obstacles are removed AND robot is dragged/rotated, autonomous mode must remain IDLE and never auto-restart
  for (let i = 0; i < 30; i++) {
    const testPose = i === 10 ? { ...stoppedPose, x: 1.2, yaw: 45 } : stoppedPose;
    const out = stepAutonomousNavigation(0.05, nav, testPose, INITIAL_SERVO_CHANNELS, [], [], 1.0);
    nav = out.nextNav;
    assert.equal(nav.enabled, false);
    assert.equal(nav.fsmState, 'IDLE');
    assert.equal(nav.activityState, 'IDLE');
    assert.equal(out.shouldAnimateGait, false);
    assert.deepEqual(out.nextBodyPose, testPose);
  }
});

test('Preserved Core Features: 12-channel mapping, 90°–100° bounds, CH7 safety lock, hierarchy, and virtual sensors remain intact', () => {
  assert.equal(INITIAL_SERVO_CHANNELS.length, 12);
  for (const ch of INITIAL_SERVO_CHANNELS) {
    assert.equal(ch.targetAngle, 95);
    assert.equal(ch.minAngle, 90);
    assert.equal(ch.maxAngle, 100);
  }

  const ch7Modified = { ...INITIAL_SERVO_CHANNELS[7], minAngle: 40, maxAngle: 150 };
  assert.equal(clampChannelAngle(ch7Modified, 70), 90);
  assert.equal(clampChannelAngle(ch7Modified, 125), 100);

  const stand = getPosePresetTargets('stand', INITIAL_SERVO_CHANNELS);
  const sit = getPosePresetTargets('sit', INITIAL_SERVO_CHANNELS);
  for (const angle of [...stand.targets, ...sit.targets]) {
    assert.ok(angle >= 90 && angle <= 100);
  }

  const coord = computeCoordinatedLegTargets('BL', INITIAL_SERVO_CHANNELS, 1, -1, 1);
  for (const angle of coord) {
    assert.ok(angle >= 90 && angle <= 100);
  }

  const gaitTargets = computeGaitTargets(
    0.35,
    { ...INITIAL_GAIT_CONFIG, gaitEnabled: true, isRunning: true, selectedGait: 'trot' },
    INITIAL_SERVO_CHANNELS
  );
  assert.equal(gaitTargets.length, 12);
  assert.ok(gaitTargets[7] >= 90 && gaitTargets[7] <= 100);

  const dummyTex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  const rig = buildKukurModel(dummyTex as unknown as THREE.CanvasTexture);
  rig.rootGroup.position.set(0, 0.36, 0);
  rig.cameraModuleGroup.position.set(0, 0.035, 0.285);
  rig.rootGroup.updateMatrixWorld(true);

  const fl = rig.legs.FL;
  const kneeBefore = new THREE.Vector3();
  const footBefore = new THREE.Vector3();
  fl.kneePivot.getWorldPosition(kneeBefore);
  fl.footTip.getWorldPosition(footBefore);

  fl.kneePivot.rotation.x = computeJointRadians({
    ...INITIAL_SERVO_CHANNELS[2],
    currentSimulatedAngle: 100,
  });
  rig.rootGroup.updateMatrixWorld(true);

  const kneeAfter = new THREE.Vector3();
  const footAfter = new THREE.Vector3();
  fl.kneePivot.getWorldPosition(kneeAfter);
  fl.footTip.getWorldPosition(footAfter);
  assert.ok(kneeBefore.distanceTo(kneeAfter) < 1e-6);
  assert.ok(footBefore.distanceTo(footAfter) > 0.01);

  const dets = computeVirtualDetections(rig.robotCamera, INITIAL_LAB_OBJECTS);
  assert.ok(dets.some((d) => d.label === 'person'));

  const selectables: THREE.Object3D[] = [];
  const frontBox = createLabObjectGroup(
    {
      id: 'front-box',
      type: 'box',
      label: 'Front Box',
      position: [0, 0, 1.0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      color: '#d97706',
    },
    selectables
  );
  frontBox.group.updateMatrixWorld(true);
  const sonarCm = computeSimulatedUltrasonicCm(rig.chassisGroup, [frontBox.group]);
  assert.ok(sonarCm > 40 && sonarCm < 90);

  const collisions = detectSceneCollisions(INITIAL_BODY_POSE, [
    {
      id: 'overlap-box',
      type: 'box',
      label: 'Overlap',
      position: [0.1, 0, 0.1],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      color: '#ef4444',
    },
  ]);
  assert.ok(collisions.has('overlap-box'));
});

function applyChannelsToRig(rig: ReturnType<typeof buildKukurModel>, channels: ServoChannel[], gain = 1.0) {
  for (let i = 0; i < 12; i++) {
    const rad = computeJointRadians(channels[i], gain);
    const pivot = rig.channelPivotMap[i];
    if (channels[i].role === 'abduction') {
      pivot.rotation.z = rad;
    } else {
      pivot.rotation.x = rad;
    }
  }
  rig.rootGroup.updateMatrixWorld(true);
}

test('Head & Leg Orientation Alignment: Head, camera, front sensors, and FL/FR front legs all point toward human model (+Z)', () => {
  const dummyTex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  const rig = buildKukurModel(dummyTex as unknown as THREE.CanvasTexture);

  rig.rootGroup.position.set(INITIAL_BODY_POSE.x, INITIAL_BODY_POSE.y, INITIAL_BODY_POSE.z);
  rig.rootGroup.rotation.set(
    THREE.MathUtils.degToRad(INITIAL_BODY_POSE.pitch),
    THREE.MathUtils.degToRad(INITIAL_BODY_POSE.yaw),
    THREE.MathUtils.degToRad(INITIAL_BODY_POSE.roll),
    'YXZ'
  );
  rig.cameraModuleGroup.position.set(...INITIAL_CAMERA_MODULE.mountPosition);
  rig.cameraModuleGroup.rotation.set(
    THREE.MathUtils.degToRad(INITIAL_CAMERA_MODULE.mountRotation[0]),
    THREE.MathUtils.degToRad(INITIAL_CAMERA_MODULE.mountRotation[1]),
    THREE.MathUtils.degToRad(INITIAL_CAMERA_MODULE.mountRotation[2])
  );
  rig.lcdModuleGroup.position.set(...INITIAL_LCD_MODULE.mountPosition);
  applyChannelsToRig(rig, INITIAL_SERVO_CHANNELS, 1.0);

  // 1. Human model & primary obstacles sit in front (+Z) of KUKUR
  const humanObj = INITIAL_LAB_OBJECTS.find((o) => o.id === 'human-1');
  assert.ok(humanObj, 'Human model must exist in default lab');
  assert.ok(humanObj.position[2] > INITIAL_BODY_POSE.z + 1.0, 'Human model must be in +Z front');

  // 2. Head nose panel, ultrasonic sensor, LCD, and camera all sit on +Z front, tail on -Z rear
  const noseBox = new THREE.Box3().setFromObject(rig.chassisPartMeshes['Green Front Nose Panel'][0]);
  const tailBox = new THREE.Box3().setFromObject(rig.chassisPartMeshes['Green Rear Cap Panel'][0]);
  const sonarBox = new THREE.Box3().setFromObject(rig.ultrasonicSensorGroup);
  const lcdPos = new THREE.Vector3();
  const camPos = new THREE.Vector3();
  const camForward = new THREE.Vector3();
  rig.lcdModuleGroup.getWorldPosition(lcdPos);
  rig.cameraModuleGroup.getWorldPosition(camPos);
  rig.robotCamera.getWorldDirection(camForward);

  assert.ok(noseBox.max.z > 0.25, 'Front nose snout must point toward +Z');
  assert.ok(tailBox.min.z < -0.2, 'Rear tail cap must sit on -Z');
  assert.ok(sonarBox.max.z > 0.25, 'Ultrasonic sensor must sit on +Z front');
  assert.ok(lcdPos.z > 0.25, 'LCD must sit on +Z front');
  assert.ok(camPos.z > 0.25, 'Camera must sit on +Z front');
  assert.ok(camForward.z > 0.98, `Robot camera view must face +Z toward human, got z=${camForward.z}`);

  // 3. FL, FR, BL, BR joint labels and 3D positions match robot's actual front/back/left/right
  const hipPos: Record<LegId, THREE.Vector3> = {
    FL: new THREE.Vector3(),
    FR: new THREE.Vector3(),
    BL: new THREE.Vector3(),
    BR: new THREE.Vector3(),
  };
  const kneePos: Record<LegId, THREE.Vector3> = {
    FL: new THREE.Vector3(),
    FR: new THREE.Vector3(),
    BL: new THREE.Vector3(),
    BR: new THREE.Vector3(),
  };
  const footPos: Record<LegId, THREE.Vector3> = {
    FL: new THREE.Vector3(),
    FR: new THREE.Vector3(),
    BL: new THREE.Vector3(),
    BR: new THREE.Vector3(),
  };

  for (const legId of ['FL', 'FR', 'BL', 'BR'] as LegId[]) {
    rig.legs[legId].hipPivot.getWorldPosition(hipPos[legId]);
    rig.legs[legId].kneePivot.getWorldPosition(kneePos[legId]);
    rig.legs[legId].footTip.getWorldPosition(footPos[legId]);
    const [abdCh, hipCh, kneeCh] = LEG_CHANNELS_MAP[legId];
    assert.ok(INITIAL_SERVO_CHANNELS[abdCh].label.startsWith(legId));
    assert.ok(INITIAL_SERVO_CHANNELS[hipCh].label.startsWith(legId));
    assert.ok(INITIAL_SERVO_CHANNELS[kneeCh].label.startsWith(legId));
  }

  // Front legs (FL, FR) are closer to the +Z human than Back legs (BL, BR); Left is +X, Right is -X
  assert.ok(hipPos.FL.z > 0.15 && hipPos.FR.z > 0.15, 'FL & FR hips must be at front (+Z)');
  assert.ok(hipPos.BL.z < -0.15 && hipPos.BR.z < -0.15, 'BL & BR hips must be at back (-Z)');
  assert.ok(hipPos.FL.x > 0.12 && hipPos.BL.x > 0.12, 'FL & BL must be on robot left (+X)');
  assert.ok(hipPos.FR.x < -0.12 && hipPos.BR.x < -0.12, 'FR & BR must be on robot right (-X)');

  // 4. Anatomical & mechanical leg orientation: all 4 upper legs angle down-and-backward to trailing knees,
  //    and all 4 lower legs angle down-and-forward (+Z, toward the head and human model)
  for (const legId of ['FL', 'FR', 'BL', 'BR'] as LegId[]) {
    assert.ok(
      kneePos[legId].z < hipPos[legId].z - 0.08,
      `${legId} knee (${kneePos[legId].z.toFixed(3)}) must bend rearward behind hip (${hipPos[legId].z.toFixed(3)})`
    );
    assert.ok(
      footPos[legId].z > kneePos[legId].z + 0.08,
      `${legId} lower leg/foot (${footPos[legId].z.toFixed(3)}) must angle forward (+Z) ahead of knee (${kneePos[legId].z.toFixed(3)})`
    );
  }

  // 5. Collision spheres match rendered 3D leg joint coordinates
  const colliders = computeRobotWorldColliders(INITIAL_BODY_POSE, INITIAL_SERVO_CHANNELS, 1.0);
  for (const legId of ['FL', 'FR', 'BL', 'BR'] as LegId[]) {
    const colKnee = colliders.find((c) => c.part === `${legId}-knee`);
    assert.ok(colKnee, `Missing collider for ${legId}-knee`);
    assert.ok(
      colKnee.center.distanceTo(kneePos[legId]) < 1e-4,
      `${legId} collision knee must match rendered 3D knee position`
    );
  }
});

test('Forward Walking & Rotation Invariance: Gait swings lifted feet forward (+Z) with head, and rotating yaw preserves leg orientation', () => {
  const dummyTex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  const rig = buildKukurModel(dummyTex as unknown as THREE.CanvasTexture);
  rig.rootGroup.position.set(0, 0.36, 0);

  const gaitCfg = {
    ...INITIAL_GAIT_CONFIG,
    selectedGait: 'trot' as const,
    gaitEnabled: true,
    isRunning: true,
    cadenceHz: 1.0,
    stepAmplitudeDeg: 4.5,
  };

  // Sample FL leg (phase = 0) at:
  // - t = 0.75s (theta = 1.5*pi -> liftoff at rear of stance)
  // - t = 0.00s (theta = 0      -> peak lift in mid-swing, moving forward)
  // - t = 0.25s (theta = 0.5*pi -> touchdown at front of stride)
  // - t = 0.50s (theta = pi     -> mid-stance on ground, pushing backward)
  const footAtTime = (tSec: number): THREE.Vector3 => {
    const targets = computeGaitTargets(tSec, gaitCfg, INITIAL_SERVO_CHANNELS);
    const chs = INITIAL_SERVO_CHANNELS.map((c, idx) => ({
      ...c,
      targetAngle: targets[idx],
      currentSimulatedAngle: targets[idx],
    }));
    applyChannelsToRig(rig, chs, 1.0);
    const v = new THREE.Vector3();
    rig.legs.FL.footTip.getWorldPosition(v);
    return v;
  };

  const pLiftoff = footAtTime(0.75);
  const pMidSwing = footAtTime(0.0);
  const pTouchdown = footAtTime(0.25);
  const pMidStance = footAtTime(0.5);

  assert.ok(
    pMidSwing.y > pMidStance.y + 0.005,
    `Foot must lift upward during swing (midSwing.y=${pMidSwing.y.toFixed(4)} vs midStance.y=${pMidStance.y.toFixed(4)})`
  );
  assert.ok(
    pTouchdown.z > pLiftoff.z + 0.03,
    `Lifted foot must swing forward (+Z, head direction) from liftoff (${pLiftoff.z.toFixed(4)}) to touchdown (${pTouchdown.z.toFixed(4)})`
  );

  // Verify rotating the robot (yaw = 90°, 180°, -90°) rotates head, legs, sensor rays, and walking direction together without reversing leg orientation
  for (const yawDeg of [0, 90, 180, -90]) {
    const yawRad = THREE.MathUtils.degToRad(yawDeg);
    const fwd = new THREE.Vector3(Math.sin(yawRad), 0, Math.cos(yawRad));

    rig.rootGroup.position.set(0, 0.36, 0);
    rig.rootGroup.rotation.set(0, yawRad, 0, 'YXZ');
    rig.cameraModuleGroup.position.set(...INITIAL_CAMERA_MODULE.mountPosition);
    applyChannelsToRig(rig, INITIAL_SERVO_CHANNELS, 1.0);

    const camPos = new THREE.Vector3();
    rig.cameraModuleGroup.getWorldPosition(camPos);
    assert.ok(camPos.dot(fwd) > 0.25, `Head/camera must project forward at yaw=${yawDeg}°`);

    for (const legId of ['FL', 'FR', 'BL', 'BR'] as LegId[]) {
      const h = new THREE.Vector3();
      const k = new THREE.Vector3();
      const f = new THREE.Vector3();
      rig.legs[legId].hipPivot.getWorldPosition(h);
      rig.legs[legId].kneePivot.getWorldPosition(k);
      rig.legs[legId].footTip.getWorldPosition(f);

      const hipToKneeAlongFwd = k.clone().sub(h).dot(fwd);
      const kneeToFootAlongFwd = f.clone().sub(k).dot(fwd);
      assert.ok(
        hipToKneeAlongFwd < -0.08,
        `At yaw=${yawDeg}°, ${legId} knee must still bend rearward relative to robot heading`
      );
      assert.ok(
        kneeToFootAlongFwd > 0.08,
        `At yaw=${yawDeg}°, ${legId} lower leg must still angle forward along robot heading`
      );
    }

    const rotatedPose = { ...INITIAL_BODY_POSE, yaw: yawDeg };
    const scan = scanNavigationSensors(rotatedPose, [], []);
    const fwdRay = scan.rays.find((r) => r.id === 'fwd-center');
    assert.ok(fwdRay);
    const rayVec = new THREE.Vector3(
      fwdRay.endPoint[0] - fwdRay.origin[0],
      0,
      fwdRay.endPoint[2] - fwdRay.origin[2]
    ).normalize();
    assert.ok(rayVec.dot(fwd) > 0.99, `Forward sensor ray must align with heading at yaw=${yawDeg}°`);
  }
});

