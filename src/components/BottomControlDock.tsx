import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Activity,
  Layers,
  Cpu,
  Bot,
  Box,
  Compass,
  Play,
  Pause,
  RotateCcw,
  Sliders,
  Camera,
  Monitor,
  Mic,
  Terminal,
  Octagon,
  ShieldCheck,
} from 'lucide-react';
import {
  BodyPose,
  DetectedObject,
  EnvironmentType,
  GaitType,
  LcdDisplayState,
  LogEntry,
  MicrophoneState,
  RobotActivityState,
  RobotJointAngles,
  SceneItem,
  SensorData,
  Vector3D,
} from '../types/robot';
import { SensorsHUD } from './SensorsHUD';
import { JointServoController } from './JointServoController';
import { CameraVisionPanel } from './CameraVisionPanel';
import { LcdDisplayPanel } from './LcdDisplayPanel';
import { MicrophoneVoicePanel } from './MicrophoneVoicePanel';
import { EnvironmentEditorPanel } from './EnvironmentEditorPanel';
import { PiDeploymentHub } from './PiDeploymentHub';
import { LogsDiagnosticsPanel } from './LogsDiagnosticsPanel';
import { CameraViewMode } from './Viewport3D';

export type DockTab =
  | 'gaits'
  | 'joints'
  | 'sensors'
  | 'camera'
  | 'lcd'
  | 'mic'
  | 'env'
  | 'pi4'
  | 'logs';

interface BottomControlDockProps {
  gait: GaitType;
  setGait: (gait: GaitType) => void;
  envType: EnvironmentType;
  setEnvType: (env: EnvironmentType) => void;
  bodyPose: BodyPose;
  setBodyPose: React.Dispatch<React.SetStateAction<BodyPose>>;
  strideLength: number;
  setStrideLength: (val: number) => void;
  turnRate: number;
  setTurnRate: (val: number) => void;
  speedMultiplier: number;
  setSpeedMultiplier: (val: number) => void;
  cameraMode: CameraViewMode;
  setCameraMode: (mode: CameraViewMode) => void;
  sensors: SensorData;
  joints: RobotJointAngles;
  setJoints: React.Dispatch<React.SetStateAction<RobotJointAngles>>;
  selectedChannel: number;
  setSelectedChannel: (ch: number) => void;
  isSimRunning: boolean;
  setIsSimRunning: React.Dispatch<React.SetStateAction<boolean>>;
  isEmergencyStopped: boolean;
  onEmergencyStop: () => void;
  onResetSimulation: () => void;
  robotState: RobotActivityState;
  detections: DetectedObject[];
  isFovVisible: boolean;
  onToggleFov: () => void;
  lcdState: LcdDisplayState;
  setLcdState: React.Dispatch<React.SetStateAction<LcdDisplayState>>;
  micState: MicrophoneState;
  setMicState: React.Dispatch<React.SetStateAction<MicrophoneState>>;
  onExecuteVoiceCommand: (cmd: string) => { success: boolean; message: string };
  sceneItems: SceneItem[];
  onAddItem: (item: SceneItem) => void;
  onRemoveItem: (id: string) => void;
  onUpdateItemPos: (id: string, pos: Vector3D) => void;
  logs: LogEntry[];
  onClearLogs: () => void;
  simTimeSeconds: number;
}

export const BottomControlDock: React.FC<BottomControlDockProps> = ({
  gait,
  setGait,
  envType,
  setEnvType,
  bodyPose,
  setBodyPose,
  strideLength,
  setStrideLength,
  turnRate,
  setTurnRate,
  speedMultiplier,
  setSpeedMultiplier,
  cameraMode,
  setCameraMode,
  sensors,
  joints,
  setJoints,
  selectedChannel,
  setSelectedChannel,
  isSimRunning,
  setIsSimRunning,
  isEmergencyStopped,
  onEmergencyStop,
  onResetSimulation,
  robotState,
  detections,
  isFovVisible,
  onToggleFov,
  lcdState,
  setLcdState,
  micState,
  setMicState,
  onExecuteVoiceCommand,
  sceneItems,
  onAddItem,
  onRemoveItem,
  onUpdateItemPos,
  logs,
  onClearLogs,
  simTimeSeconds,
}) => {
  const [activeTab, setActiveTab] = useState<DockTab>('gaits');
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Keyboard shortcut 'H' to toggle dock
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key.toLowerCase() === 'h' &&
        !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)
      ) {
        setIsCollapsed((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const tabList: Array<{ id: DockTab; label: string; icon: React.ReactNode }> = [
    { id: 'gaits', label: '1. Gaits & Pose', icon: <Layers className="w-3.5 h-3.5" /> },
    { id: 'joints', label: '2. Joint & Servo Control', icon: <Sliders className="w-3.5 h-3.5" /> },
    { id: 'sensors', label: '3. Sensors & Telemetry', icon: <Activity className="w-3.5 h-3.5" /> },
    { id: 'camera', label: '4. Camera & Detection', icon: <Camera className="w-3.5 h-3.5" /> },
    { id: 'lcd', label: '5. LCD Display', icon: <Monitor className="w-3.5 h-3.5" /> },
    { id: 'mic', label: '6. Mic & Voice Commands', icon: <Mic className="w-3.5 h-3.5" /> },
    { id: 'env', label: '7. Environment Editor', icon: <Box className="w-3.5 h-3.5" /> },
    { id: 'pi4', label: '8. Raspberry Pi Hardware', icon: <Cpu className="w-3.5 h-3.5" /> },
    { id: 'logs', label: '9. Logs & Diagnostics', icon: <Terminal className="w-3.5 h-3.5" /> },
  ];

  return (
    <div
      className={`fixed bottom-3 left-1/2 -translate-x-1/2 w-[96vw] max-w-6xl z-30 transition-all duration-300 ease-in-out ${
        isCollapsed ? 'translate-y-[calc(100%-42px)]' : 'translate-y-0'
      }`}
    >
      {/* Top Dock Header Tab Bar */}
      <div className="bg-neutral-900/95 border border-neutral-800 rounded-t-xl px-3 py-1.5 flex flex-wrap items-center justify-between gap-1.5 shadow-2xl backdrop-blur-none">
        {/* Navigation Tabs (9 Tabs requested) */}
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
          {tabList.map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id);
                if (isCollapsed) setIsCollapsed(false);
              }}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition ${
                activeTab === tab.id && !isCollapsed
                  ? 'bg-amber-500 text-neutral-950 shadow-sm'
                  : 'text-neutral-300 hover:text-neutral-100 hover:bg-neutral-800'
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Global Emergency Stop & Sim Controls */}
        <div className="flex items-center gap-2">
          {/* Quick Sim Play/Pause */}
          <button
            onClick={() => setIsSimRunning(!isSimRunning)}
            disabled={isEmergencyStopped}
            className={`p-1.5 rounded-lg text-xs font-semibold border transition flex items-center gap-1 ${
              isSimRunning
                ? 'bg-neutral-800 border-neutral-700 text-neutral-200'
                : 'bg-emerald-500 border-emerald-400 text-neutral-950 font-bold'
            }`}
            title={isSimRunning ? 'Pause Animation' : 'Start Animation'}
          >
            {isSimRunning ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          </button>

          {/* Emergency Stop Button */}
          <button
            onClick={onEmergencyStop}
            className={`flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded-lg border transition ${
              isEmergencyStopped
                ? 'bg-rose-600 text-white border-rose-500 animate-pulse'
                : 'bg-rose-500/20 hover:bg-rose-600 text-rose-300 hover:text-white border-rose-500/40'
            }`}
          >
            <Octagon className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">
              {isEmergencyStopped ? 'E-STOPPED' : 'E-STOP'}
            </span>
          </button>

          {/* Collapse/Expand Toggle */}
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="flex items-center gap-1 px-2 py-1 text-xs font-medium bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg border border-neutral-700 transition"
          >
            {isCollapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            <span className="hidden md:inline">{isCollapsed ? 'Show' : 'Hide (H)'}</span>
          </button>
        </div>
      </div>

      {/* Dock Content Body */}
      <div className="bg-neutral-950 border-x border-b border-neutral-800 rounded-b-xl max-h-[380px] overflow-hidden shadow-2xl">
        {/* Tab 1: Gaits & Pose */}
        {activeTab === 'gaits' && (
          <div className="p-4 space-y-4 overflow-y-auto max-h-[360px]">
            {/* Gaits row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <div className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider flex items-center justify-between">
                  <span>Locomotion Gait Animation</span>
                  <span className="font-mono text-amber-400 text-xs uppercase">{gait}</span>
                </div>
                <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5">
                  {(['stand', 'trot', 'walk', 'pace', 'gallop', 'sit', 'wave'] as const).map((g) => (
                    <button
                      key={g}
                      onClick={() => setGait(g)}
                      disabled={isEmergencyStopped}
                      className={`px-2 py-1.5 rounded-lg text-xs font-medium capitalize transition text-center ${
                        gait === g
                          ? 'bg-amber-500 text-neutral-950 font-semibold'
                          : 'bg-neutral-900 hover:bg-neutral-800 text-neutral-300 border border-neutral-800 disabled:opacity-40'
                      }`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>

              {/* Terrain quick selector */}
              <div className="space-y-1.5">
                <div className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider flex items-center justify-between">
                  <span>Training Environment</span>
                  <span className="font-mono text-sky-400 text-xs capitalize">{envType}</span>
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {(
                    [
                      { id: 'lab', label: 'Lab Arena' },
                      { id: 'obstacles', label: 'Step Course' },
                      { id: 'slopes', label: 'Ramp Incline' },
                      { id: 'rough', label: 'Rough Ground' },
                    ] as const
                  ).map((e) => (
                    <button
                      key={e.id}
                      onClick={() => setEnvType(e.id)}
                      className={`px-2 py-1.5 rounded-lg text-xs font-medium transition text-center ${
                        envType === e.id
                          ? 'bg-sky-500 text-neutral-950 font-semibold'
                          : 'bg-neutral-900 hover:bg-neutral-800 text-neutral-300 border border-neutral-800'
                      }`}
                    >
                      {e.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Stride, Turning, Camera View */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-neutral-800/80">
              <div>
                <div className="flex justify-between text-xs text-neutral-300 mb-1">
                  <span>Stride Length</span>
                  <span className="font-mono text-amber-400">{strideLength} mm</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="65"
                  value={strideLength}
                  onChange={(e) => setStrideLength(parseInt(e.target.value, 10))}
                  disabled={isEmergencyStopped}
                  className="w-full accent-amber-500 h-1.5 bg-neutral-800 rounded-lg cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs text-neutral-300 mb-1">
                  <span>Differential Steering (Turn)</span>
                  <span className="font-mono text-sky-400">
                    {turnRate < 0
                      ? `Left ${Math.abs(Math.round(turnRate * 100))}%`
                      : turnRate > 0
                      ? `Right ${Math.round(turnRate * 100)}%`
                      : 'Center'}
                  </span>
                </div>
                <input
                  type="range"
                  min="-1"
                  max="1"
                  step="0.05"
                  value={turnRate}
                  onChange={(e) => setTurnRate(parseFloat(e.target.value))}
                  disabled={isEmergencyStopped}
                  className="w-full accent-sky-500 h-1.5 bg-neutral-800 rounded-lg cursor-pointer"
                />
              </div>

              <div>
                <div className="text-xs text-neutral-300 mb-1">Camera Perspective</div>
                <div className="grid grid-cols-4 gap-1">
                  {(
                    [
                      { id: 'orbit', label: 'Orbit' },
                      { id: 'follow', label: 'Follow' },
                      { id: 'front_sensor', label: 'POV Eye' },
                      { id: 'side_kinematics', label: 'Side IK' },
                    ] as const
                  ).map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setCameraMode(m.id)}
                      className={`px-1.5 py-1 rounded text-[11px] font-medium transition text-center ${
                        cameraMode === m.id
                          ? 'bg-neutral-800 text-amber-300 border border-amber-500/30'
                          : 'bg-neutral-900 text-neutral-400 hover:text-neutral-200 border border-neutral-800'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Direct Body Inverse Kinematics */}
            <div className="pt-2 border-t border-neutral-800/80">
              <div className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider mb-2">
                Body Kinematics & Stance Trim
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <div className="flex justify-between text-neutral-300 mb-1">
                    <span>Height</span>
                    <span className="font-mono text-amber-400">{bodyPose.y} mm</span>
                  </div>
                  <input
                    type="range"
                    min="130"
                    max="200"
                    value={bodyPose.y}
                    onChange={(e) =>
                      setBodyPose((prev) => ({ ...prev, y: parseInt(e.target.value, 10) }))
                    }
                    disabled={isEmergencyStopped}
                    className="w-full accent-amber-500 h-1 bg-neutral-800 rounded cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-neutral-300 mb-1">
                    <span>Pitch</span>
                    <span className="font-mono text-amber-400">{bodyPose.pitch}°</span>
                  </div>
                  <input
                    type="range"
                    min="-20"
                    max="20"
                    value={bodyPose.pitch}
                    onChange={(e) =>
                      setBodyPose((prev) => ({ ...prev, pitch: parseInt(e.target.value, 10) }))
                    }
                    disabled={isEmergencyStopped}
                    className="w-full accent-amber-500 h-1 bg-neutral-800 rounded cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-neutral-300 mb-1">
                    <span>Roll</span>
                    <span className="font-mono text-amber-400">{bodyPose.roll}°</span>
                  </div>
                  <input
                    type="range"
                    min="-20"
                    max="20"
                    value={bodyPose.roll}
                    onChange={(e) =>
                      setBodyPose((prev) => ({ ...prev, roll: parseInt(e.target.value, 10) }))
                    }
                    disabled={isEmergencyStopped}
                    className="w-full accent-amber-500 h-1 bg-neutral-800 rounded cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-neutral-300 mb-1">
                    <span>Yaw</span>
                    <span className="font-mono text-amber-400">{bodyPose.yaw}°</span>
                  </div>
                  <input
                    type="range"
                    min="-25"
                    max="25"
                    value={bodyPose.yaw}
                    onChange={(e) =>
                      setBodyPose((prev) => ({ ...prev, yaw: parseInt(e.target.value, 10) }))
                    }
                    disabled={isEmergencyStopped}
                    className="w-full accent-amber-500 h-1 bg-neutral-800 rounded cursor-pointer"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Joint & Servo Control (Highlighting CH7) */}
        {activeTab === 'joints' && (
          <div className="h-[360px]">
            <JointServoController
              joints={joints}
              setJoints={setJoints}
              selectedChannel={selectedChannel}
              setSelectedChannel={setSelectedChannel}
              onEmergencyStop={onEmergencyStop}
              onResetSimulation={onResetSimulation}
              isEmergencyStopped={isEmergencyStopped}
              onStand={() => setGait('stand')}
              onSit={() => setGait('sit')}
              onNeutral={() => {
                setJoints({
                  FL: { hip: 0, shoulder: 45, knee: -90 },
                  FR: { hip: 0, shoulder: 45, knee: -90 },
                  RL: { hip: 0, shoulder: 45, knee: -90 },
                  RR: { hip: 0, shoulder: 45, knee: -90 },
                });
                setGait('stand');
              }}
            />
          </div>
        )}

        {/* Tab 3: Sensors & Telemetry */}
        {activeTab === 'sensors' && (
          <div className="p-4 max-h-[360px] overflow-y-auto">
            <SensorsHUD sensors={sensors} joints={joints} />
          </div>
        )}

        {/* Tab 4: Camera & Object Detection */}
        {activeTab === 'camera' && (
          <div className="h-[360px]">
            <CameraVisionPanel
              detections={detections}
              isFovVisible={isFovVisible}
              onToggleFov={onToggleFov}
              sceneItems={sceneItems}
            />
          </div>
        )}

        {/* Tab 5: LCD Display */}
        {activeTab === 'lcd' && (
          <div className="h-[360px]">
            <LcdDisplayPanel
              lcdState={lcdState}
              setLcdState={setLcdState}
              sensors={sensors}
              joints={joints}
              detections={detections}
            />
          </div>
        )}

        {/* Tab 6: Microphone & Voice Commands */}
        {activeTab === 'mic' && (
          <div className="h-[360px]">
            <MicrophoneVoicePanel
              micState={micState}
              setMicState={setMicState}
              onExecuteCommand={onExecuteVoiceCommand}
              isEmergencyStopped={isEmergencyStopped}
            />
          </div>
        )}

        {/* Tab 7: Environment Editor */}
        {activeTab === 'env' && (
          <div className="h-[360px]">
            <EnvironmentEditorPanel
              envType={envType}
              setEnvType={setEnvType}
              sceneItems={sceneItems}
              onAddItem={onAddItem}
              onRemoveItem={onRemoveItem}
              onUpdateItemPos={onUpdateItemPos}
            />
          </div>
        )}

        {/* Tab 8: Raspberry Pi Hardware Mapping */}
        {activeTab === 'pi4' && (
          <div className="h-[360px]">
            <PiDeploymentHub />
          </div>
        )}

        {/* Tab 9: Logs & Diagnostics */}
        {activeTab === 'logs' && (
          <div className="h-[360px]">
            <LogsDiagnosticsPanel
              logs={logs}
              onClearLogs={onClearLogs}
              robotState={robotState}
              selectedChannel={selectedChannel}
              simTimeSeconds={simTimeSeconds}
              isEmergencyStopped={isEmergencyStopped}
            />
          </div>
        )}
      </div>
    </div>
  );
};
