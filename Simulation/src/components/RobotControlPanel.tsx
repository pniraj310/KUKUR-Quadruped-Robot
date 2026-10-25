import React, { useState } from 'react';
import {
  BodyPose,
  GaitConfig,
  GaitType,
  LegId,
  LegTestState,
  NavigationConfigAndState,
  PosePreset,
  ScenarioId,
  ServoChannel,
} from '../types/simulator';
import { getPosePresetTargets } from '../simulation/kinematics';
import { LEG_CHANNELS_MAP, SCENARIO_PRESETS } from '../simulation/initialState';
import {
  AlertOctagon,
  AlertTriangle,
  Navigation,
  OctagonX,
  Play,
  RotateCcw,
  Sliders,
  Square,
  Eye,
} from 'lucide-react';

interface RobotControlPanelProps {
  channels: ServoChannel[];
  bodyPose: BodyPose;
  onUpdateBodyPose: (patch: Partial<BodyPose>) => void;
  posePreset: PosePreset;
  onApplyPosePreset: (preset: PosePreset) => void;
  onStopSimulation: () => void;
  onResetAll: () => void;
  navigation: NavigationConfigAndState;
  onUpdateNavigation: (patch: Partial<NavigationConfigAndState>) => void;
  activeScenario: ScenarioId;
  onSelectScenario: (scenarioId: ScenarioId) => void;
  onResetScenario: () => void;
  gait: GaitConfig;
  onUpdateGait: (patch: Partial<GaitConfig>) => void;
  legTest: LegTestState;
  onUpdateLegTest: (leg: LegId | null, running: boolean) => void;
  onCoordinatedLegChange: (
    leg: LegId,
    lift: number,
    reach: number,
    spread: number
  ) => void;
}

export const RobotControlPanel: React.FC<RobotControlPanelProps> = ({
  channels,
  bodyPose,
  onUpdateBodyPose,
  posePreset,
  onApplyPosePreset,
  onStopSimulation,
  onResetAll,
  navigation,
  onUpdateNavigation,
  activeScenario,
  onSelectScenario,
  onResetScenario,
  gait,
  onUpdateGait,
  legTest,
  onUpdateLegTest,
  onCoordinatedLegChange,
}) => {
  const [selectedLeg, setSelectedLeg] = useState<LegId>('FL');
  const [previewedPose, setPreviewedPose] = useState<'stand' | 'sit' | null>(null);
  const [showProtoPhoto, setShowProtoPhoto] = useState<boolean>(false);
  const [imgFailed, setImgFailed] = useState<boolean>(false);

  const isAnySimRunning =
    navigation.enabled ||
    (gait.gaitEnabled && gait.isRunning) ||
    (legTest.running && legTest.activeLeg !== null);

  const standPreview = getPosePresetTargets('stand', channels);
  const sitPreview = getPosePresetTargets('sit', channels);

  const curLift = legTest.liftFactor[selectedLeg];
  const curReach = legTest.reachFactor[selectedLeg];
  const curSpread = legTest.spreadFactor[selectedLeg];
  const [legAbd, legHip, legKnee] = LEG_CHANNELS_MAP[selectedLeg];

  const scenarioOrder: ScenarioId[] = [
    'default-lab',
    'single-box',
    'wall-one-side',
    'wall-right-side',
    'either-side-bypass',
    'blocked-corridor',
  ];

  const isBlockedWait =
    navigation.enabled &&
    (navigation.fsmState === 'PATH_BLOCKED' || navigation.fsmState === 'WAITING_FOR_CLEARANCE');
  const isLifted = bodyPose.y > 0.43 || navigation.isLiftedOffFloor;

  return (
    <div className="space-y-6 text-sm">
      {/* Safety Stop & Quick Reset */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Simulation Execution & Poses</h2>
          <span className="text-xs text-slate-400">
            Active: <strong className="text-slate-200 uppercase">{posePreset}</strong>
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={onStopSimulation}
            className={`px-3 py-2.5 rounded-lg font-semibold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer ${
              isAnySimRunning
                ? 'bg-red-600 hover:bg-red-500 text-white'
                : 'bg-red-950/70 border border-red-500/40 text-red-200 hover:bg-red-900/60'
            }`}
          >
            <OctagonX className="w-4 h-4 shrink-0" />
            Stop Simulation
          </button>

          <button
            type="button"
            onClick={onResetScenario}
            className="px-3 py-2.5 rounded-lg font-medium text-xs bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5 shrink-0" />
            Reset Robot & Scene
          </button>
        </div>

        {/* Stand & Sit Pose Previews */}
        <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-2.5">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Pose Previews (Clamped 90°–100°)</span>
            <button
              type="button"
              onClick={onResetAll}
              className="text-sky-400 hover:text-sky-300 underline cursor-pointer"
            >
              Neutral 95°
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onMouseEnter={() => setPreviewedPose('stand')}
              onMouseLeave={() => setPreviewedPose(null)}
              onClick={() => onApplyPosePreset('stand')}
              className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                posePreset === 'stand'
                  ? 'bg-blue-600 text-white border-blue-500'
                  : 'bg-slate-950 text-slate-200 border-slate-800 hover:border-slate-600'
              }`}
            >
              Stand Pose
            </button>
            <button
              type="button"
              onMouseEnter={() => setPreviewedPose('sit')}
              onMouseLeave={() => setPreviewedPose(null)}
              onClick={() => onApplyPosePreset('sit')}
              className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                posePreset === 'sit'
                  ? 'bg-blue-600 text-white border-blue-500'
                  : 'bg-slate-950 text-slate-200 border-slate-800 hover:border-slate-600'
              }`}
            >
              Sit Pose
            </button>
          </div>

          {previewedPose && (
            <div className="text-[11px] font-mono text-slate-300 bg-slate-950 p-2 rounded border border-slate-800">
              {previewedPose === 'stand' ? (
                <span>
                  Preview STAND → Height {(standPreview.bodyPose.y ?? 0.375).toFixed(3)}m · Hip{' '}
                  {standPreview.targets[1]}° · CH7 {standPreview.targets[7]}°
                </span>
              ) : (
                <span>
                  Preview SIT → Height {(sitPreview.bodyPose.y ?? 0.31).toFixed(2)}m · Pitch -11° ·
                  BL CH7 {sitPreview.targets[7]}°
                </span>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Autonomous Obstacle Avoidance & Test Scenarios */}
      <section className="pt-4 border-t border-slate-800/80 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-white flex items-center gap-1.5">
            <Navigation className="w-3.5 h-3.5 text-emerald-400" />
            Autonomous Obstacle Avoidance
          </h3>
          <div className="flex items-center gap-1.5">
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold ${
                navigation.activityState === 'MOVING'
                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40'
                  : navigation.activityState === 'WAITING'
                  ? 'bg-amber-950 text-amber-300 border border-amber-500/40'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              {navigation.activityState}
            </span>
            <span className="text-[11px] font-mono text-slate-300">{navigation.fsmState}</span>
          </div>
        </div>

        {isBlockedWait && (
          <div className="p-2.5 rounded-lg bg-red-950 border border-red-500 text-xs text-red-100 font-mono flex items-center gap-2">
            <AlertOctagon className="w-4 h-4 text-red-400 shrink-0" />
            <span>
              <strong>PATH BLOCKED — WAITING FOR CLEARANCE</strong> — Both routes blocked; monitoring
              front, left, and right paths to resume automatically.
            </span>
          </div>
        )}

        <button
          type="button"
          onClick={() => onUpdateNavigation({ enabled: !navigation.enabled })}
          className={`w-full py-2.5 px-4 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer ${
            navigation.enabled
              ? 'bg-amber-500 text-slate-950'
              : 'bg-emerald-600 hover:bg-emerald-500 text-white'
          }`}
        >
          {navigation.enabled ? (
            <>
              <Square className="w-3.5 h-3.5" /> Disable Autonomous Avoidance
            </>
          ) : (
            <>
              <Play className="w-3.5 h-3.5" /> Enable Autonomous Obstacle Avoidance
            </>
          )}
        </button>

        <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-2.5">
          <div className="text-[11px] font-mono text-slate-200 bg-slate-950 px-2.5 py-1.5 rounded border border-slate-800">
            {navigation.statusMessage}
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-slate-300">Safety Stop Distance</span>
              <span className="font-mono text-emerald-300 tabular-nums">
                {navigation.safetyDistanceM.toFixed(2)} m
              </span>
            </div>
            <input
              type="range"
              min={0.45}
              max={1.55}
              step={0.05}
              value={navigation.safetyDistanceM}
              onChange={(e) =>
                onUpdateNavigation({ safetyDistanceM: parseFloat(e.target.value) })
              }
              className="w-full accent-emerald-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
            />
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-slate-300">Bypass Turn Angle</span>
              <span className="font-mono text-sky-300 tabular-nums">
                {navigation.turnAngleDeg.toFixed(0)}°
              </span>
            </div>
            <input
              type="range"
              min={30}
              max={90}
              step={5}
              value={navigation.turnAngleDeg}
              onChange={(e) =>
                onUpdateNavigation({ turnAngleDeg: parseFloat(e.target.value) })
              }
              className="w-full accent-sky-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
            />
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-slate-300">Clearance Threshold</span>
              <span className="font-mono text-amber-300 tabular-nums">
                {navigation.clearanceThresholdM.toFixed(2)} m
              </span>
            </div>
            <input
              type="range"
              min={0.45}
              max={1.15}
              step={0.05}
              value={navigation.clearanceThresholdM}
              onChange={(e) =>
                onUpdateNavigation({ clearanceThresholdM: parseFloat(e.target.value) })
              }
              className="w-full accent-amber-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
            />
          </div>

          <label className="flex items-center justify-between text-xs text-slate-300 cursor-pointer pt-0.5">
            <span>Show 3D Sensor Detection Rays</span>
            <input
              type="checkbox"
              checked={navigation.showSensorRays}
              onChange={(e) => onUpdateNavigation({ showSensorRays: e.target.checked })}
              className="w-3.5 h-3.5 accent-emerald-500 rounded cursor-pointer"
            />
          </label>

          <div className="grid grid-cols-3 gap-1.5 pt-1 text-[11px] font-mono tabular-nums text-center">
            <div className="bg-slate-950 border border-slate-800 rounded p-1.5">
              <div className="text-[10px] text-slate-400">LEFT / RIGHT</div>
              <div className="text-slate-100 font-semibold">
                {navigation.leftClearanceM.toFixed(1)}/{navigation.rightClearanceM.toFixed(1)}m
              </div>
            </div>
            <div className="bg-slate-950 border border-slate-800 rounded p-1.5">
              <div className="text-[10px] text-slate-400">FWD DIST</div>
              <div className="text-emerald-300 font-semibold">
                {navigation.nearestForwardM.toFixed(2)}m
              </div>
            </div>
            <div className="bg-slate-950 border border-slate-800 rounded p-1.5">
              <div className="text-[10px] text-slate-400">TURN DIR</div>
              <div className="text-sky-300 font-semibold">
                {navigation.selectedTurnDirection}
              </div>
            </div>
          </div>
        </div>

        {/* Obstacle Avoidance Test Scenarios */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-300 font-medium">Navigation Test Scenarios</span>
            <button
              type="button"
              onClick={onResetScenario}
              className="text-sky-400 hover:text-sky-300 flex items-center gap-1 cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" /> Reset Scenario
            </button>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {scenarioOrder.map((scId) => {
              const sc = SCENARIO_PRESETS[scId];
              const isSelected = activeScenario === scId;
              return (
                <button
                  key={scId}
                  type="button"
                  onClick={() => onSelectScenario(scId)}
                  className={`px-2.5 py-2 rounded-lg text-left text-xs border transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-blue-600/25 border-blue-500 text-white font-semibold'
                      : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-600'
                  }`}
                >
                  {sc.title}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            {SCENARIO_PRESETS[activeScenario].description}
          </p>
        </div>
      </section>

      {/* Body Translation & Orientation */}
      <section className="pt-4 border-t border-slate-800/80 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Chassis Position & Attitude</h3>
          <button
            type="button"
            onClick={() =>
              onUpdateBodyPose({ x: 0, y: 0.36, z: 0, pitch: 0, roll: 0, yaw: 0 })
            }
            className="text-xs text-sky-400 hover:text-sky-300 cursor-pointer"
          >
            Center Chassis
          </button>
        </div>

        <div className="grid grid-cols-3 gap-1.5">
          <button
            type="button"
            onClick={() => onUpdateBodyPose({ y: isLifted ? 0.36 : 0.52 })}
            className={`px-2 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
              isLifted
                ? 'bg-amber-500 text-slate-950 border-amber-400 font-semibold'
                : 'bg-slate-900 text-slate-200 border-slate-800 hover:border-slate-600'
            }`}
          >
            {isLifted ? 'Place on Floor' : 'Lift Off Floor'}
          </button>
          <button
            type="button"
            onClick={() =>
              onUpdateBodyPose({
                yaw: ((((bodyPose.yaw + 45 + 180) % 360) + 360) % 360) - 180,
              })
            }
            className="px-2 py-1.5 rounded-lg text-xs font-medium bg-slate-900 text-slate-200 border border-slate-800 hover:border-slate-600 cursor-pointer"
          >
            Rotate +45° (L)
          </button>
          <button
            type="button"
            onClick={() =>
              onUpdateBodyPose({
                yaw: ((((bodyPose.yaw - 45 + 180) % 360) + 360) % 360) - 180,
              })
            }
            className="px-2 py-1.5 rounded-lg text-xs font-medium bg-slate-900 text-slate-200 border border-slate-800 hover:border-slate-600 cursor-pointer"
          >
            Rotate -45° (R)
          </button>
        </div>

        <div className="space-y-2.5">
          {[
            {
              label: 'Body Height (Y)',
              val: bodyPose.y,
              min: 0.18,
              max: 0.62,
              step: 0.005,
              unit: 'm',
              key: 'y' as const,
            },
            {
              label: 'Body Pitch',
              val: bodyPose.pitch,
              min: -25,
              max: 25,
              step: 0.5,
              unit: '°',
              key: 'pitch' as const,
            },
            {
              label: 'Body Roll',
              val: bodyPose.roll,
              min: -25,
              max: 25,
              step: 0.5,
              unit: '°',
              key: 'roll' as const,
            },
            {
              label: 'Body Yaw',
              val: bodyPose.yaw,
              min: -180,
              max: 180,
              step: 1,
              unit: '°',
              key: 'yaw' as const,
            },
            {
              label: 'Floor X Position',
              val: bodyPose.x,
              min: -3.5,
              max: 3.5,
              step: 0.02,
              unit: 'm',
              key: 'x' as const,
            },
            {
              label: 'Floor Z Position',
              val: bodyPose.z,
              min: -3.5,
              max: 3.5,
              step: 0.02,
              unit: 'm',
              key: 'z' as const,
            },
          ].map((ctrl) => (
            <div key={ctrl.key} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-300">{ctrl.label}</span>
                <span className="font-mono text-slate-200 tabular-nums">
                  {ctrl.val.toFixed(ctrl.unit === 'm' ? 2 : 1)}
                  {ctrl.unit}
                </span>
              </div>
              <input
                type="range"
                min={ctrl.min}
                max={ctrl.max}
                step={ctrl.step}
                value={ctrl.val}
                onChange={(e) =>
                  onUpdateBodyPose({ [ctrl.key]: parseFloat(e.target.value) })
                }
                className="w-full accent-blue-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
              />
            </div>
          ))}
        </div>
      </section>

      {/* Independent Leg Testing & Coordinated 3-Joint Movement */}
      <section className="pt-4 border-t border-slate-800/80 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white flex items-center gap-1.5">
            <Sliders className="w-3.5 h-3.5 text-sky-400" />
            Independent Leg Test (3-Joint)
          </h3>
          <span className="text-xs font-mono text-slate-400">
            CH{legAbd}/{legHip}/{legKnee}
          </span>
        </div>

        <div className="grid grid-cols-4 gap-1.5 bg-slate-900 p-1 rounded-lg border border-slate-800">
          {(['FL', 'FR', 'BL', 'BR'] as LegId[]).map((leg) => (
            <button
              key={leg}
              type="button"
              onClick={() => setSelectedLeg(leg)}
              className={`py-1.5 rounded text-xs font-semibold transition-colors cursor-pointer ${
                selectedLeg === leg
                  ? 'bg-slate-700 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {leg}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              const isThisRunning = legTest.running && legTest.activeLeg === selectedLeg;
              onUpdateLegTest(isThisRunning ? null : selectedLeg, !isThisRunning);
            }}
            className={`flex-1 py-2 px-3 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
              legTest.running && legTest.activeLeg === selectedLeg
                ? 'bg-amber-500 text-slate-950 font-semibold'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700'
            }`}
          >
            {legTest.running && legTest.activeLeg === selectedLeg ? (
              <>
                <Square className="w-3.5 h-3.5" /> Stop {selectedLeg} Sweep
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" /> Test {selectedLeg} Cycle
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => onCoordinatedLegChange(selectedLeg, 0, 0, 0)}
            className="px-3 py-2 rounded-lg text-xs bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 cursor-pointer"
          >
            Zero {selectedLeg}
          </button>
        </div>

        <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-2.5">
          <div className="text-xs text-slate-400">
            Coordinated 3-Joint {selectedLeg} Control (within channel bounds)
          </div>
          {[
            {
              label: 'Foot Lift (Hip + Knee)',
              val: curLift,
              onChange: (v: number) => onCoordinatedLegChange(selectedLeg, v, curReach, curSpread),
            },
            {
              label: 'Stride Reach (Forward/Back)',
              val: curReach,
              onChange: (v: number) => onCoordinatedLegChange(selectedLeg, curLift, v, curSpread),
            },
            {
              label: 'Abduction Splay',
              val: curSpread,
              onChange: (v: number) => onCoordinatedLegChange(selectedLeg, curLift, curReach, v),
            },
          ].map((item) => (
            <div key={item.label} className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-slate-300">{item.label}</span>
                <span className="font-mono text-slate-200 tabular-nums">
                  {(item.val * 100).toFixed(0)}%
                </span>
              </div>
              <input
                type="range"
                min={-1}
                max={1}
                step={0.05}
                value={item.val}
                onChange={(e) => item.onChange(parseFloat(e.target.value))}
                className="w-full accent-sky-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
              />
            </div>
          ))}
        </div>
      </section>

      {/* Gait Settings (Disabled by Default) */}
      <section className="pt-4 border-t border-slate-800/80 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Manual Gait Simulation</h3>
          <span className="text-xs text-slate-400">
            {gait.gaitEnabled ? 'Unlocked (Sim)' : 'Disabled by Default'}
          </span>
        </div>

        <div className="p-2.5 rounded-lg bg-amber-950/40 border border-amber-500/30 flex items-start gap-2 text-xs text-amber-200/90">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <span>
            Kinematic preview only. Forward gait automatically halts before contacting any solid
            obstacle in the scene.
          </span>
        </div>

        <div className="grid grid-cols-4 gap-1.5 bg-slate-900 p-1 rounded-lg border border-slate-800">
          {(['trot', 'walk', 'pace', 'gallop'] as GaitType[]).map((gt) => (
            <button
              key={gt}
              type="button"
              onClick={() => onUpdateGait({ selectedGait: gt })}
              className={`py-1.5 rounded text-xs font-medium capitalize transition-colors cursor-pointer ${
                gait.selectedGait === gt
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {gt}
            </button>
          ))}
        </div>

        <label className="flex items-center justify-between p-2.5 rounded-lg bg-slate-900 border border-slate-800 cursor-pointer">
          <span className="text-xs text-slate-200 font-medium">
            Explicitly Enable Gait Execution (Virtual Only)
          </span>
          <input
            type="checkbox"
            checked={gait.gaitEnabled}
            onChange={(e) =>
              onUpdateGait({
                gaitEnabled: e.target.checked,
                isRunning: e.target.checked ? gait.isRunning : false,
              })
            }
            className="w-4 h-4 accent-blue-500 rounded cursor-pointer"
          />
        </label>

        <div className="space-y-2.5">
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-slate-300">Step Cadence</span>
              <span className="font-mono text-slate-200 tabular-nums">
                {gait.cadenceHz.toFixed(1)} Hz
              </span>
            </div>
            <input
              type="range"
              min={0.4}
              max={2.6}
              step={0.1}
              disabled={!gait.gaitEnabled}
              value={gait.cadenceHz}
              onChange={(e) => onUpdateGait({ cadenceHz: parseFloat(e.target.value) })}
              className="w-full accent-blue-500 h-1.5 bg-slate-800 rounded-lg disabled:opacity-40 cursor-pointer"
            />
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-slate-300">Command Sweep Amplitude</span>
              <span className="font-mono text-slate-200 tabular-nums">
                ±{gait.stepAmplitudeDeg.toFixed(1)}°
              </span>
            </div>
            <input
              type="range"
              min={1.0}
              max={5.0}
              step={0.5}
              disabled={!gait.gaitEnabled}
              value={gait.stepAmplitudeDeg}
              onChange={(e) => onUpdateGait({ stepAmplitudeDeg: parseFloat(e.target.value) })}
              className="w-full accent-blue-500 h-1.5 bg-slate-800 rounded-lg disabled:opacity-40 cursor-pointer"
            />
          </div>

          <label className="flex items-center justify-between text-xs text-slate-300 pt-1 cursor-pointer">
            <span>Translate Robot Forward on Lab Floor</span>
            <input
              type="checkbox"
              disabled={!gait.gaitEnabled}
              checked={gait.locomotionTranslate}
              onChange={(e) => onUpdateGait({ locomotionTranslate: e.target.checked })}
              className="w-3.5 h-3.5 accent-blue-500 rounded disabled:opacity-40 cursor-pointer"
            />
          </label>

          <button
            type="button"
            disabled={!gait.gaitEnabled}
            onClick={() => onUpdateGait({ isRunning: !gait.isRunning })}
            className={`w-full py-2.5 px-4 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
              gait.isRunning
                ? 'bg-amber-500 text-slate-950'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white'
            }`}
          >
            {gait.isRunning ? (
              <>
                <Square className="w-3.5 h-3.5" /> Pause {gait.selectedGait.toUpperCase()} Gait
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" /> Start {gait.selectedGait.toUpperCase()} Simulation
              </>
            )}
          </button>
        </div>
      </section>

      {/* Physical Prototype Reference */}
      <section className="pt-4 border-t border-slate-800/80 space-y-2">
        <button
          type="button"
          onClick={() => setShowProtoPhoto((v) => !v)}
          className="w-full flex items-center justify-between text-xs text-slate-300 hover:text-white cursor-pointer"
        >
          <span className="flex items-center gap-1.5 font-medium">
            <Eye className="w-3.5 h-3.5 text-emerald-400" />
            KUKUR Structural Appearance Reference
          </span>
          <span className="text-slate-400">{showProtoPhoto ? 'Hide' : 'Show'}</span>
        </button>

        {showProtoPhoto && (
          <div className="rounded-lg overflow-hidden border border-slate-800 bg-slate-900">
            {!imgFailed ? (
              <img
                src="/assets/aistudio/image_541e940d.png"
                alt="KUKUR physical quadruped robot prototype"
                referrerPolicy="no-referrer"
                onError={() => setImgFailed(true)}
                className="w-full h-36 object-cover"
              />
            ) : (
              <div className="w-full h-24 flex items-center justify-center text-xs text-slate-400 p-4 text-center">
                KUKUR Blue & Green Quadruped Structure · 2 Green Legs (FL, BL) · 2 Blue Legs (FR, BR)
              </div>
            )}
            <div className="px-3 py-2 text-[11px] text-slate-400">
              Structure color scheme: Green & Blue central body panels · Two complete Green legs
              (FL, BL) · Two complete Blue legs (FR, BR) across upper links, lower links, and joint
              covers.
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
