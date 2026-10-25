import React, { useCallback, useRef, useState } from 'react';
import {
  BodyPose,
  CameraModuleConfig,
  CameraViewMode,
  GaitConfig,
  LabSceneObject,
  LcdModuleConfig,
  LegId,
  LegTestState,
  LightingPreset,
  MicModuleConfig,
  NavigationConfigAndState,
  PosePreset,
  ScenarioId,
  SelectableTarget,
  SensorTelemetry,
  ServoChannel,
  SimulatedDetection,
} from './types/simulator';
import {
  INITIAL_BODY_POSE,
  INITIAL_CAMERA_MODULE,
  INITIAL_GAIT_CONFIG,
  INITIAL_LAB_OBJECTS,
  INITIAL_LCD_MODULE,
  INITIAL_LEG_TEST,
  INITIAL_MIC_MODULE,
  INITIAL_NAVIGATION_STATE,
  INITIAL_SERVO_CHANNELS,
  INITIAL_TELEMETRY,
  LEG_CHANNELS_MAP,
  SCENARIO_PRESETS,
} from './simulation/initialState';
import {
  clampChannelAngle,
  computeCoordinatedLegTargets,
  getPosePresetTargets,
  resolveSolidBodyMovement,
} from './simulation/kinematics';
import { checkRobotPoseCollision } from './simulation/collision';
import { Viewport3D } from './components/Viewport3D';
import { RobotControlPanel } from './components/RobotControlPanel';
import { JointControlPanel } from './components/JointControlPanel';
import { ModulesVisionPanel } from './components/ModulesVisionPanel';
import { SceneLabPanel } from './components/SceneLabPanel';
import { TelemetryPanel } from './components/TelemetryPanel';
import { OctagonX, PanelRightClose, PanelRightOpen } from 'lucide-react';

type DashboardTab = 'control' | 'joints' | 'modules' | 'scene' | 'telemetry';

function cloneSceneObjects(objs: LabSceneObject[]): LabSceneObject[] {
  return objs.map((o) => ({
    ...o,
    position: [...o.position] as [number, number, number],
    rotation: [...o.rotation] as [number, number, number],
    scale: [...o.scale] as [number, number, number],
  }));
}

export default function App() {
  const [activeTab, setActiveTab] = useState<DashboardTab>('control');
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);

  const [channels, setChannels] = useState<ServoChannel[]>(INITIAL_SERVO_CHANNELS);
  const [extendedSimBoundsUnlocked, setExtendedSimBoundsUnlocked] = useState<boolean>(false);
  const [visualKinematicGain, setVisualKinematicGain] = useState<number>(1);

  const [bodyPose, setBodyPose] = useState<BodyPose>(INITIAL_BODY_POSE);
  const [manualPoseToken, setManualPoseToken] = useState<number>(0);
  const [posePreset, setPosePreset] = useState<PosePreset>('stand');
  const [gait, setGait] = useState<GaitConfig>(INITIAL_GAIT_CONFIG);
  const [legTest, setLegTest] = useState<LegTestState>(INITIAL_LEG_TEST);

  const [navigation, setNavigation] = useState<NavigationConfigAndState>(
    INITIAL_NAVIGATION_STATE
  );
  const [activeScenario, setActiveScenario] = useState<ScenarioId>('default-lab');
  const [scenarioResetToken, setScenarioResetToken] = useState<number>(0);

  const [cameraModule, setCameraModule] = useState<CameraModuleConfig>(INITIAL_CAMERA_MODULE);
  const [lcdModule, setLcdModule] = useState<LcdModuleConfig>(INITIAL_LCD_MODULE);
  const [micModule, setMicModule] = useState<MicModuleConfig>(INITIAL_MIC_MODULE);

  const [labObjects, setLabObjects] = useState<LabSceneObject[]>(() =>
    cloneSceneObjects(INITIAL_LAB_OBJECTS)
  );
  const [collidingIds, setCollidingIds] = useState<string[]>([]);
  const [detections, setDetections] = useState<SimulatedDetection[]>([]);
  const [telemetry, setTelemetry] = useState<SensorTelemetry>(INITIAL_TELEMETRY);

  const [selectedTarget, setSelectedTarget] = useState<SelectableTarget>(null);
  const [attachmentMode, setAttachmentMode] = useState<boolean>(false);
  const [cameraViewMode, setCameraViewMode] = useState<CameraViewMode>('orbit');

  const [lightingPreset, setLightingPreset] = useState<LightingPreset>('studio');
  const [lightIntensity, setLightIntensity] = useState<number>(1.0);
  const [shadowsEnabled, setShadowsEnabled] = useState<boolean>(true);

  const robotFeedCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const spawnCounterRef = useRef<number>(2);

  // Stop all active animations & autonomous navigation immediately (never auto-restarts until user starts again)
  const handleStopSimulation = useCallback(() => {
    setGait((prev) => ({ ...prev, isRunning: false }));
    setLegTest((prev) => ({ ...prev, running: false, activeLeg: null }));
    setNavigation((prev) => ({
      ...prev,
      enabled: false,
      fsmState: 'IDLE',
      activityState: 'IDLE',
      selectedTurnDirection: 'NONE',
      statusMessage: 'Stopped by user (IDLE)',
      committedTurn: null,
      targetYawDeg: null,
      initialBypassHeadingDeg: null,
      bypassObstacleId: null,
      lastCommandedPose: null,
    }));
  }, []);

  const handleStopGaitBeforeCollision = useCallback(() => {
    setGait((prev) => (prev.isRunning ? { ...prev, isRunning: false } : prev));
  }, []);

  // Update body pose from user interaction (sliders, gizmo, floor-drag, lift/place) while enforcing solid obstacles
  const handleUpdateBodyPose = useCallback(
    (patch: Partial<BodyPose>) => {
      setBodyPose((prev) => {
        const requested: BodyPose = { ...prev, ...patch };
        const res = resolveSolidBodyMovement(
          prev,
          requested,
          channels,
          labObjects,
          visualKinematicGain
        );
        return res.resolvedPose;
      });
      setManualPoseToken((t) => t + 1);
    },
    [channels, labObjects, visualKinematicGain]
  );

  // Sync body pose from autonomous navigation / gait controller without flagging external user manipulation
  const handleUpdateBodyPoseFromSim = useCallback((nextSimPose: BodyPose) => {
    setBodyPose(nextSimPose);
  }, []);

  // Reset all joints to 95° and reset robot pose within current scene
  const handleResetAll = useCallback(() => {
    handleStopSimulation();
    setPosePreset('neutral');
    const scenarioDef = SCENARIO_PRESETS[activeScenario];
    setBodyPose({ ...scenarioDef.robotPose });
    setLegTest(INITIAL_LEG_TEST);
    setChannels((prev) =>
      prev.map((ch) => ({
        ...ch,
        targetAngle: clampChannelAngle(ch, 95),
        currentSimulatedAngle: clampChannelAngle(ch, 95),
      }))
    );
    setScenarioResetToken((t) => t + 1);
  }, [activeScenario, handleStopSimulation]);

  // Apply a navigation test scenario (restoring both robot and obstacles to scenario initial positions)
  const applyScenarioLayout = useCallback((scenarioId: ScenarioId) => {
    const def = SCENARIO_PRESETS[scenarioId];
    setActiveScenario(scenarioId);
    setSelectedTarget(null);
    setGait((prev) => ({ ...prev, isRunning: false }));
    setLegTest(INITIAL_LEG_TEST);
    setPosePreset('stand');
    setBodyPose({ ...def.robotPose });
    setLabObjects(cloneSceneObjects(def.objects));
    setChannels((prev) =>
      prev.map((ch) => ({
        ...ch,
        targetAngle: clampChannelAngle(ch, 95),
        currentSimulatedAngle: clampChannelAngle(ch, 95),
      }))
    );
    setNavigation((prev) => ({
      ...INITIAL_NAVIGATION_STATE,
      safetyDistanceM: prev.safetyDistanceM,
      turnAngleDeg: prev.turnAngleDeg,
      clearanceThresholdM: prev.clearanceThresholdM,
      showSensorRays: prev.showSensorRays,
      enabled: prev.enabled,
      fsmState: prev.enabled ? 'IDLE' : 'IDLE',
      activityState: prev.enabled ? 'WAITING' : 'IDLE',
    }));
    setScenarioResetToken((t) => t + 1);
  }, []);

  const handleResetScenario = useCallback(() => {
    const def = SCENARIO_PRESETS[activeScenario];
    setSelectedTarget(null);
    setGait((prev) => ({ ...prev, isRunning: false }));
    setLegTest(INITIAL_LEG_TEST);
    setPosePreset('stand');
    setBodyPose({ ...def.robotPose });
    setLabObjects(cloneSceneObjects(def.objects));
    setChannels((prev) =>
      prev.map((ch) => ({
        ...ch,
        targetAngle: clampChannelAngle(ch, 95),
        currentSimulatedAngle: clampChannelAngle(ch, 95),
      }))
    );
    setNavigation((prev) => ({
      ...INITIAL_NAVIGATION_STATE,
      safetyDistanceM: prev.safetyDistanceM,
      turnAngleDeg: prev.turnAngleDeg,
      clearanceThresholdM: prev.clearanceThresholdM,
      showSensorRays: prev.showSensorRays,
      enabled: false,
      fsmState: 'IDLE',
      activityState: 'IDLE',
    }));
    setScenarioResetToken((t) => t + 1);
  }, [activeScenario]);

  const handleUpdateNavigation = useCallback((patch: Partial<NavigationConfigAndState>) => {
    setNavigation((prev) => {
      const next = { ...prev, ...patch };
      if (patch.enabled === true && !prev.enabled) {
        setGait((g) => ({ ...g, isRunning: false }));
        setLegTest((lt) => ({ ...lt, running: false, activeLeg: null }));
        if (next.fsmState === 'IDLE') {
          next.fsmState = 'MOVING_FORWARD';
          next.activityState = 'MOVING';
          next.statusMessage = 'Forward path clear — walking';
        }
      } else if (patch.enabled === false && prev.enabled) {
        next.fsmState = 'IDLE';
        next.activityState = 'IDLE';
        next.selectedTurnDirection = 'NONE';
        next.committedTurn = null;
        next.targetYawDeg = null;
        next.initialBypassHeadingDeg = null;
        next.bypassObstacleId = null;
        next.lastCommandedPose = null;
        next.statusMessage = 'Autonomous avoidance standby (IDLE)';
      }
      return next;
    });
  }, []);

  // Apply Stand or Sit pose preset (clamped within channel bounds & solid obstacle bounds)
  const handleApplyPosePreset = useCallback(
    (preset: PosePreset) => {
      handleStopSimulation();
      setPosePreset(preset);
      setChannels((prev) => {
        const computed = getPosePresetTargets(preset, prev);
        setBodyPose((bp) => {
          const candPose: BodyPose = { ...bp, ...computed.bodyPose };
          const res = resolveSolidBodyMovement(
            bp,
            candPose,
            prev,
            labObjects,
            visualKinematicGain
          );
          return res.resolvedPose;
        });
        return prev.map((ch, idx) => ({
          ...ch,
          targetAngle: computed.targets[idx],
        }));
      });
      setManualPoseToken((t) => t + 1);
    },
    [handleStopSimulation, labObjects, visualKinematicGain]
  );

  // Update individual servo channel target while preventing leg penetration into solid obstacles
  const handleChangeChannelTarget = useCallback(
    (channelIdx: number, requestedDeg: number) => {
      setPosePreset('custom');
      setChannels((prev) => {
        const candidate = prev.map((ch) =>
          ch.channel === channelIdx
            ? {
                ...ch,
                targetAngle: clampChannelAngle(ch, requestedDeg),
                currentSimulatedAngle: clampChannelAngle(ch, requestedDeg),
              }
            : ch
        );
        const wasCol = checkRobotPoseCollision(
          bodyPose,
          prev,
          labObjects,
          visualKinematicGain,
          0.008
        ).colliding;
        const nowCol = checkRobotPoseCollision(
          bodyPose,
          candidate,
          labObjects,
          visualKinematicGain,
          0.008
        ).colliding;
        if (!wasCol && nowCol) return prev;
        return prev.map((ch) =>
          ch.channel === channelIdx
            ? { ...ch, targetAngle: clampChannelAngle(ch, requestedDeg) }
            : ch
        );
      });
    },
    [bodyPose, labObjects, visualKinematicGain]
  );

  const handleResetChannel = useCallback((channelIdx: number) => {
    setChannels((prev) =>
      prev.map((ch) =>
        ch.channel === channelIdx ? { ...ch, targetAngle: clampChannelAngle(ch, 95) } : ch
      )
    );
  }, []);

  // Explicitly widen/restore virtual simulation bounds for non-CH7 channels ONLY
  const handleToggleExtendedSimBounds = useCallback((unlocked: boolean) => {
    setExtendedSimBoundsUnlocked(unlocked);
    setChannels((prev) =>
      prev.map((ch) => {
        if (ch.channel === 7 || ch.safetyLocked) {
          return {
            ...ch,
            minAngle: 90,
            maxAngle: 100,
            targetAngle: Math.min(100, Math.max(90, ch.targetAngle)),
          };
        }
        const nextMin = unlocked ? 65 : 90;
        const nextMax = unlocked ? 125 : 100;
        return {
          ...ch,
          minAngle: nextMin,
          maxAngle: nextMax,
          targetAngle: Math.min(nextMax, Math.max(nextMin, ch.targetAngle)),
        };
      })
    );
  }, []);

  const handleUpdateChannelsFromSim = useCallback(
    (targets: number[], simulatedCurrent?: number[]) => {
      setChannels((prev) =>
        prev.map((ch, idx) => ({
          ...ch,
          targetAngle: clampChannelAngle(ch, targets[idx] ?? ch.targetAngle),
          currentSimulatedAngle:
            simulatedCurrent?.[idx] !== undefined
              ? simulatedCurrent[idx]
              : ch.currentSimulatedAngle,
        }))
      );
    },
    []
  );

  // Coordinated 3-Joint movement for a single leg (with solid obstacle check)
  const handleCoordinatedLegChange = useCallback(
    (leg: LegId, lift: number, reach: number, spread: number) => {
      setPosePreset('custom');
      setChannels((prev) => {
        const [abdTarget, hipTarget, kneeTarget] = computeCoordinatedLegTargets(
          leg,
          prev,
          lift,
          reach,
          spread
        );
        const [abdIdx, hipIdx, kneeIdx] = LEG_CHANNELS_MAP[leg];
        const candidate = prev.map((ch) => {
          if (ch.channel === abdIdx)
            return { ...ch, targetAngle: abdTarget, currentSimulatedAngle: abdTarget };
          if (ch.channel === hipIdx)
            return { ...ch, targetAngle: hipTarget, currentSimulatedAngle: hipTarget };
          if (ch.channel === kneeIdx)
            return { ...ch, targetAngle: kneeTarget, currentSimulatedAngle: kneeTarget };
          return ch;
        });

        const wasCol = checkRobotPoseCollision(
          bodyPose,
          prev,
          labObjects,
          visualKinematicGain,
          0.008
        ).colliding;
        const nowCol = checkRobotPoseCollision(
          bodyPose,
          candidate,
          labObjects,
          visualKinematicGain,
          0.008
        ).colliding;
        if (!wasCol && nowCol) return prev;

        setLegTest((lt) => ({
          ...lt,
          liftFactor: { ...lt.liftFactor, [leg]: lift },
          reachFactor: { ...lt.reachFactor, [leg]: reach },
          spreadFactor: { ...lt.spreadFactor, [leg]: spread },
        }));

        return prev.map((ch) => {
          if (ch.channel === abdIdx) return { ...ch, targetAngle: abdTarget };
          if (ch.channel === hipIdx) return { ...ch, targetAngle: hipTarget };
          if (ch.channel === kneeIdx) return { ...ch, targetAngle: kneeTarget };
          return ch;
        });
      });
    },
    [bodyPose, labObjects, visualKinematicGain]
  );

  const handleUpdateLegTest = useCallback((leg: LegId | null, running: boolean) => {
    if (running) {
      setGait((prev) => ({ ...prev, isRunning: false }));
      setNavigation((prev) => ({ ...prev, enabled: false, fsmState: 'IDLE' }));
    }
    setLegTest((prev) => ({ ...prev, activeLeg: leg, running }));
  }, []);

  const handleUpdateGait = useCallback((patch: Partial<GaitConfig>) => {
    setGait((prev) => {
      const next = { ...prev, ...patch };
      if (!next.gaitEnabled) next.isRunning = false;
      if (next.isRunning) {
        setLegTest((lt) => ({ ...lt, running: false, activeLeg: null }));
        setNavigation((nav) => ({ ...nav, enabled: false, fsmState: 'IDLE' }));
      }
      return next;
    });
  }, []);

  // Spawn new movable lab object outside robot collision footprint
  const handleSpawnLabObject = useCallback(
    (type: LabSceneObject['type']) => {
      const n = spawnCounterRef.current++;
      const angle = (n * 1.15) % (Math.PI * 2);
      const radius = 1.45 + (n % 3) * 0.35;
      const px = Math.round((bodyPose.x + Math.sin(angle) * radius) * 100) / 100;
      const pz = Math.round((bodyPose.z + Math.cos(angle) * radius) * 100) / 100;

      const meta: Record<LabSceneObject['type'], { label: string; color: string }> = {
        wall: { label: `Barrier Wall #${n}`, color: '#475569' },
        human: { label: `Person #${n}`, color: '#2563eb' },
        box: { label: `Calibration Box #${n}`, color: '#d97706' },
        cylinder: { label: `Pillar Obstacle #${n}`, color: '#0d9488' },
        ramp: { label: `Incline Ramp #${n}`, color: '#475569' },
        'rough-terrain': { label: `Rough Terrain #${n}`, color: '#57534e' },
      };

      const newObj: LabSceneObject = {
        id: `${type}-${n}`,
        type,
        label: meta[type].label,
        position: [
          Math.max(-4.8, Math.min(4.8, px)),
          0,
          Math.max(-4.8, Math.min(4.8, pz)),
        ],
        rotation: [0, Math.round((angle * 180) / Math.PI), 0],
        scale: [1, 1, 1],
        color: meta[type].color,
      };

      setLabObjects((prev) => [...prev, newObj]);
      setSelectedTarget({ kind: 'scene-object', objectId: newObj.id });
    },
    [bodyPose.x, bodyPose.z]
  );

  // Prevent solid obstacles from being pushed directly through KUKUR's body/legs via sliders
  const handleUpdateLabObject = useCallback(
    (id: string, patch: Partial<LabSceneObject>) => {
      setLabObjects((prev) => {
        const targetObj = prev.find((o) => o.id === id);
        if (!targetObj) return prev;
        const updatedObj: LabSceneObject = { ...targetObj, ...patch };
        const wasCol = checkRobotPoseCollision(
          bodyPose,
          channels,
          [targetObj],
          visualKinematicGain,
          0.01
        ).colliding;
        const nowCol = checkRobotPoseCollision(
          bodyPose,
          channels,
          [updatedObj],
          visualKinematicGain,
          0.01
        ).colliding;
        if (!wasCol && nowCol) {
          return prev;
        }
        return prev.map((obj) => (obj.id === id ? updatedObj : obj));
      });
    },
    [bodyPose, channels, visualKinematicGain]
  );

  const handleDeleteLabObject = useCallback((id: string) => {
    setLabObjects((prev) => prev.filter((obj) => obj.id !== id));
    setSelectedTarget((prev) =>
      prev?.kind === 'scene-object' && prev.objectId === id ? null : prev
    );
  }, []);

  // Execute Simulated / Voice Commands (Virtual Robot Only)
  const handleExecuteVoiceCommand = useCallback(
    (phrase: string, source: 'simulated-text' | 'browser-voice') => {
      const norm = phrase.toLowerCase().trim();
      let actionTaken = 'Unrecognized command';

      if (norm.includes('stop') || norm.includes('halt')) {
        handleStopSimulation();
        actionTaken = 'Stopped virtual simulation';
      } else if (norm.includes('reset')) {
        handleResetScenario();
        actionTaken = 'Reset robot & scene to initial positions';
      } else if (norm.includes('avoid') || norm.includes('navigate')) {
        handleUpdateNavigation({ enabled: true });
        actionTaken = 'Enabled autonomous obstacle avoidance (Sim)';
      } else if (norm.includes('stand')) {
        handleApplyPosePreset('stand');
        actionTaken = 'Applied STAND pose (Sim)';
      } else if (norm.includes('sit')) {
        handleApplyPosePreset('sit');
        actionTaken = 'Applied SIT pose (Sim)';
      } else if (norm.includes('trot') || norm.includes('walk')) {
        actionTaken = gait.gaitEnabled
          ? 'Started virtual gait'
          : 'Blocked: Enable Gait Execution first';
        if (gait.gaitEnabled) {
          setGait((prev) => ({
            ...prev,
            selectedGait: norm.includes('walk') ? 'walk' : 'trot',
            isRunning: true,
          }));
        }
      }

      setMicModule((prev) => ({
        ...prev,
        lastCommand: phrase,
        commandLog: [
          {
            id: `${Date.now()}-${Math.random()}`,
            timestamp: new Date().toLocaleTimeString(),
            source,
            phrase,
            actionTaken,
          },
          ...prev.commandLog,
        ].slice(0, 12),
      }));
    },
    [
      gait.gaitEnabled,
      handleApplyPosePreset,
      handleResetScenario,
      handleStopSimulation,
      handleUpdateNavigation,
    ]
  );

  const handleUpdateLiveTelemetry = useCallback(
    (
      patch: Partial<SensorTelemetry>,
      nextDetections: SimulatedDetection[],
      nextCollidingIds: string[]
    ) => {
      setTelemetry((prev) => ({ ...prev, ...patch }));
      setDetections(nextDetections);
      setCollidingIds(nextCollidingIds);
    },
    []
  );

  const isSimRunning =
    navigation.enabled ||
    (gait.gaitEnabled && gait.isRunning) ||
    (legTest.running && legTest.activeLeg !== null);

  return (
    <div className="h-screen w-screen flex flex-col bg-slate-950 text-slate-100 overflow-hidden">
      {/* Strict 3-Zone Top Navigation Bar */}
      <header className="flex items-center justify-between gap-8 px-6 py-3 bg-slate-950 border-b border-slate-800 shrink-0 z-30">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#top"
          onClick={(e) => e.preventDefault()}
          className="text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0"
        >
          KUKUR
        </a>

        {/* Zone 2: 5 concise single-line navigation links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-400">
          {(
            [
              { id: 'control', label: 'Control' },
              { id: 'joints', label: 'Joints' },
              { id: 'modules', label: 'Modules' },
              { id: 'scene', label: 'Lab Scene' },
              { id: 'telemetry', label: 'Telemetry' },
            ] as Array<{ id: DashboardTab; label: string }>
          ).map((nav) => (
            <button
              key={nav.id}
              type="button"
              onClick={() => {
                setActiveTab(nav.id);
                setSidebarOpen(true);
              }}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 cursor-pointer ${
                activeTab === nav.id && sidebarOpen
                  ? 'text-white border-blue-500'
                  : 'border-transparent hover:text-slate-100'
              }`}
            >
              {nav.label}
            </button>
          ))}
        </nav>

        {/* Zone 3: 1 primary safety action */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={handleStopSimulation}
            className="px-4 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-500 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <OctagonX className="w-3.5 h-3.5" />
            Stop Simulation
          </button>
        </div>
      </header>

      {/* Main 3D Workspace + Collapsible Robotics Engineering Dashboard */}
      <div className="flex-1 flex min-h-0 relative">
        <Viewport3D
          channels={channels}
          onUpdateChannelsFromSim={handleUpdateChannelsFromSim}
          bodyPose={bodyPose}
          onUpdateBodyPose={handleUpdateBodyPose}
          onUpdateBodyPoseFromSim={handleUpdateBodyPoseFromSim}
          manualPoseToken={manualPoseToken}
          posePreset={posePreset}
          gait={gait}
          onStopGaitBeforeCollision={handleStopGaitBeforeCollision}
          legTest={legTest}
          navigation={navigation}
          onUpdateNavigation={handleUpdateNavigation}
          scenarioResetToken={scenarioResetToken}
          cameraModule={cameraModule}
          onUpdateCameraModule={(patch) => setCameraModule((prev) => ({ ...prev, ...patch }))}
          lcdModule={lcdModule}
          onUpdateLcdModule={(patch) => setLcdModule((prev) => ({ ...prev, ...patch }))}
          micModule={micModule}
          onUpdateMicModule={(patch) => setMicModule((prev) => ({ ...prev, ...patch }))}
          labObjects={labObjects}
          onUpdateLabObject={handleUpdateLabObject}
          onSpawnLabObject={handleSpawnLabObject}
          selectedTarget={selectedTarget}
          onSelectTarget={setSelectedTarget}
          attachmentMode={attachmentMode}
          onToggleAttachmentMode={() => setAttachmentMode((v) => !v)}
          cameraViewMode={cameraViewMode}
          onChangeCameraViewMode={setCameraViewMode}
          lightingPreset={lightingPreset}
          lightIntensity={lightIntensity}
          shadowsEnabled={shadowsEnabled}
          visualKinematicGain={visualKinematicGain}
          telemetry={telemetry}
          onUpdateLiveTelemetry={handleUpdateLiveTelemetry}
          detections={detections}
          robotFeedCanvasRef={robotFeedCanvasRef}
        />

        {!sidebarOpen && (
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="absolute top-4 right-4 z-30 px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs font-medium text-slate-200 hover:text-white flex items-center gap-1.5 shadow-lg cursor-pointer"
          >
            <PanelRightOpen className="w-4 h-4 text-sky-400" />
            Open Controls
          </button>
        )}

        <aside
          className={`${
            sidebarOpen ? 'w-full sm:w-[420px] border-l border-slate-800' : 'w-0 overflow-hidden'
          } bg-slate-950 flex flex-col shrink-0 transition-opacity duration-150 z-20`}
        >
          <div className="px-4 py-2.5 border-b border-slate-800 flex items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-1.5 text-[11px] font-mono text-slate-400 truncate">
              <span className="text-emerald-400 font-semibold">SIMULATION</span>
              <span aria-hidden="true">·</span>
              <span>NO HARDWARE</span>
              <span aria-hidden="true">·</span>
              <span>CH7 90–100°</span>
            </div>
            <button
              type="button"
              title="Collapse Dashboard"
              onClick={() => setSidebarOpen(false)}
              className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer shrink-0"
            >
              <PanelRightClose className="w-4 h-4" />
            </button>
          </div>

          <div className="px-4 pt-3 pb-2 shrink-0">
            <div className="grid grid-cols-5 gap-1 p-1 bg-slate-900 rounded-lg border border-slate-800">
              {(
                [
                  { id: 'control', label: 'Control' },
                  { id: 'joints', label: 'Joints' },
                  { id: 'modules', label: 'Modules' },
                  { id: 'scene', label: 'Lab' },
                  { id: 'telemetry', label: 'Sensors' },
                ] as Array<{ id: DashboardTab; label: string }>
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveTab(t.id)}
                  className={`py-1.5 px-1 rounded text-xs font-medium transition-colors whitespace-nowrap truncate cursor-pointer ${
                    activeTab === t.id
                      ? 'bg-slate-800 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {activeTab === 'control' && (
              <RobotControlPanel
                channels={channels}
                bodyPose={bodyPose}
                onUpdateBodyPose={handleUpdateBodyPose}
                posePreset={posePreset}
                onApplyPosePreset={handleApplyPosePreset}
                onStopSimulation={handleStopSimulation}
                onResetAll={handleResetAll}
                navigation={navigation}
                onUpdateNavigation={handleUpdateNavigation}
                activeScenario={activeScenario}
                onSelectScenario={applyScenarioLayout}
                onResetScenario={handleResetScenario}
                gait={gait}
                onUpdateGait={handleUpdateGait}
                legTest={legTest}
                onUpdateLegTest={handleUpdateLegTest}
                onCoordinatedLegChange={handleCoordinatedLegChange}
              />
            )}

            {activeTab === 'joints' && (
              <JointControlPanel
                channels={channels}
                selectedTarget={selectedTarget}
                onSelectChannel={(ch) => setSelectedTarget({ kind: 'joint', channel: ch })}
                onChangeChannelTarget={handleChangeChannelTarget}
                onResetChannel={handleResetChannel}
                onResetAllChannels={handleResetAll}
                extendedSimBoundsUnlocked={extendedSimBoundsUnlocked}
                onToggleExtendedSimBounds={handleToggleExtendedSimBounds}
                visualKinematicGain={visualKinematicGain}
                onChangeVisualKinematicGain={setVisualKinematicGain}
              />
            )}

            <div className={activeTab === 'modules' ? 'block' : 'hidden'}>
              <ModulesVisionPanel
                cameraModule={cameraModule}
                onUpdateCameraModule={(patch) =>
                  setCameraModule((prev) => ({ ...prev, ...patch }))
                }
                cameraViewMode={cameraViewMode}
                onChangeCameraViewMode={setCameraViewMode}
                detections={detections}
                robotFeedCanvasRef={robotFeedCanvasRef}
                lcdModule={lcdModule}
                onUpdateLcdModule={(patch) =>
                  setLcdModule((prev) => ({ ...prev, ...patch }))
                }
                micModule={micModule}
                onUpdateMicModule={(patch) =>
                  setMicModule((prev) => ({ ...prev, ...patch }))
                }
                onExecuteVoiceCommand={handleExecuteVoiceCommand}
                onSelectTarget={setSelectedTarget}
                posePreset={posePreset}
                isSimRunning={isSimRunning}
                channels={channels}
                telemetry={telemetry}
                navigation={navigation}
              />
            </div>

            {activeTab === 'scene' && (
              <SceneLabPanel
                labObjects={labObjects}
                collidingIds={collidingIds}
                detectedObstacleIds={navigation.detectedObstacleIds}
                activeScenario={activeScenario}
                onSelectScenario={applyScenarioLayout}
                onResetScenario={handleResetScenario}
                selectedTarget={selectedTarget}
                onSelectTarget={setSelectedTarget}
                onSpawnLabObject={handleSpawnLabObject}
                onUpdateLabObject={handleUpdateLabObject}
                onDeleteLabObject={handleDeleteLabObject}
                attachmentMode={attachmentMode}
                onToggleAttachmentMode={() => setAttachmentMode((v) => !v)}
                lightingPreset={lightingPreset}
                onChangeLightingPreset={setLightingPreset}
                lightIntensity={lightIntensity}
                onChangeLightIntensity={setLightIntensity}
                shadowsEnabled={shadowsEnabled}
                onToggleShadows={setShadowsEnabled}
              />
            )}

            {activeTab === 'telemetry' && (
              <TelemetryPanel
                telemetry={telemetry}
                onUpdateTelemetryConfig={(patch) =>
                  setTelemetry((prev) => ({ ...prev, ...patch }))
                }
                navigation={navigation}
                onUpdateNavigation={handleUpdateNavigation}
                channels={channels}
                cameraModule={cameraModule}
              />
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
