import React, { useEffect, useRef, useState } from 'react';
import {
  CameraModuleConfig,
  CameraViewMode,
  LcdModuleConfig,
  LcdOrientation,
  LcdScreenPreset,
  MicModuleConfig,
  NavigationConfigAndState,
  PosePreset,
  SelectableTarget,
  SensorTelemetry,
  ServoChannel,
  SimulatedDetection,
} from '../types/simulator';
import { buildLcdLines, drawLcdCanvas } from '../three/lcdTexture';
import {
  Camera,
  Link2,
  Link2Off,
  Mic,
  MicOff,
  Monitor,
  Send,
  Video,
  Crosshair,
} from 'lucide-react';

interface ModulesVisionPanelProps {
  cameraModule: CameraModuleConfig;
  onUpdateCameraModule: (patch: Partial<CameraModuleConfig>) => void;
  cameraViewMode: CameraViewMode;
  onChangeCameraViewMode: (mode: CameraViewMode) => void;
  detections: SimulatedDetection[];
  robotFeedCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  lcdModule: LcdModuleConfig;
  onUpdateLcdModule: (patch: Partial<LcdModuleConfig>) => void;
  micModule: MicModuleConfig;
  onUpdateMicModule: (patch: Partial<MicModuleConfig>) => void;
  onExecuteVoiceCommand: (phrase: string, source: 'simulated-text' | 'browser-voice') => void;
  onSelectTarget: (target: SelectableTarget) => void;
  posePreset: PosePreset;
  isSimRunning: boolean;
  channels: ServoChannel[];
  telemetry: SensorTelemetry;
  navigation?: NavigationConfigAndState;
}

export const ModulesVisionPanel: React.FC<ModulesVisionPanelProps> = ({
  cameraModule,
  onUpdateCameraModule,
  cameraViewMode,
  onChangeCameraViewMode,
  detections,
  robotFeedCanvasRef,
  lcdModule,
  onUpdateLcdModule,
  micModule,
  onUpdateMicModule,
  onExecuteVoiceCommand,
  onSelectTarget,
  posePreset,
  isSimRunning,
  channels,
  telemetry,
  navigation,
}) => {
  const [subTab, setSubTab] = useState<'camera' | 'lcd' | 'mic'>('camera');
  const [commandInput, setCommandInput] = useState<string>('stand');
  const [webcamError, setWebcamError] = useState<string | null>(null);
  const [micPermissionError, setMicPermissionError] = useState<string | null>(null);

  const webcamVideoRef = useRef<HTMLVideoElement | null>(null);
  const webcamStreamRef = useRef<MediaStream | null>(null);
  const lcdPreviewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const waveformCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const speechRecRef = useRef<any>(null);

  // Sync 2D LCD Dashboard Preview whenever LCD config / robot state updates
  useEffect(() => {
    const canvas = lcdPreviewCanvasRef.current;
    if (!canvas) return;
    const lines = buildLcdLines(
      lcdModule,
      posePreset,
      isSimRunning,
      channels,
      telemetry,
      navigation
    );
    drawLcdCanvas(canvas, lines, lcdModule);
  }, [lcdModule, posePreset, isSimRunning, channels, telemetry, navigation, subTab]);

  // Optional Browser Webcam Lifecycle (only upon explicit user opt-in)
  useEffect(() => {
    if (!cameraModule.webcamEnabled) {
      if (webcamStreamRef.current) {
        webcamStreamRef.current.getTracks().forEach((t) => t.stop());
        webcamStreamRef.current = null;
      }
      return;
    }

    let cancelled = false;
    setWebcamError(null);
    navigator.mediaDevices
      ?.getUserMedia({ video: { width: 640, height: 400 } })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        webcamStreamRef.current = stream;
        if (webcamVideoRef.current) {
          webcamVideoRef.current.srcObject = stream;
          webcamVideoRef.current.play().catch(() => {});
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setWebcamError(
            err instanceof Error ? err.message : 'Webcam permission denied or unavailable.'
          );
          onUpdateCameraModule({ webcamEnabled: false });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [cameraModule.webcamEnabled]);

  // Optional Browser Microphone + Waveform Canvas Animation
  useEffect(() => {
    if (!micModule.browserMicEnabled) {
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach((t) => t.stop());
        micStreamRef.current = null;
      }
      if (speechRecRef.current) {
        try {
          speechRecRef.current.stop();
        } catch {}
        speechRecRef.current = null;
      }
      return;
    }

    let cancelled = false;
    setMicPermissionError(null);
    navigator.mediaDevices
      ?.getUserMedia({ audio: true })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        micStreamRef.current = stream;
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        const actx: AudioContext = new AudioCtx();
        const source = actx.createMediaStreamSource(stream);
        const analyser = actx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        audioCtxRef.current = actx;
        analyserRef.current = analyser;

        // Optional Web Speech API recognition for virtual commands
        const SpeechRec =
          (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (SpeechRec) {
          const rec = new SpeechRec();
          rec.continuous = true;
          rec.interimResults = false;
          rec.lang = 'en-US';
          rec.onresult = (ev: any) => {
            const last = ev.results[ev.results.length - 1];
            if (last?.isFinal && last[0]?.transcript) {
              onExecuteVoiceCommand(String(last[0].transcript).trim(), 'browser-voice');
            }
          };
          try {
            rec.start();
            speechRecRef.current = rec;
          } catch {}
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setMicPermissionError(
            err instanceof Error ? err.message : 'Microphone access denied or unavailable.'
          );
          onUpdateMicModule({ browserMicEnabled: false });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [micModule.browserMicEnabled]);

  // Waveform Canvas Loop
  useEffect(() => {
    let raf = 0;
    let phase = 0;
    const dataArray = new Uint8Array(128);

    const drawWave = () => {
      const canvas = waveformCanvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const w = canvas.width;
          const h = canvas.height;
          ctx.fillStyle = '#020617';
          ctx.fillRect(0, 0, w, h);

          // Center line
          ctx.strokeStyle = '#1e293b';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, h / 2);
          ctx.lineTo(w, h / 2);
          ctx.stroke();

          ctx.strokeStyle = micModule.listening ? '#10b981' : '#475569';
          ctx.lineWidth = 2;
          ctx.beginPath();

          if (micModule.listening && micModule.browserMicEnabled && analyserRef.current) {
            analyserRef.current.getByteTimeDomainData(dataArray);
            const slice = w / dataArray.length;
            for (let i = 0; i < dataArray.length; i++) {
              const v = (dataArray[i] - 128) / 128;
              const y = h / 2 + v * (h * 0.44) * micModule.simulatedGain;
              if (i === 0) ctx.moveTo(0, y);
              else ctx.lineTo(i * slice, y);
            }
          } else if (micModule.listening) {
            phase += 0.14;
            for (let x = 0; x < w; x += 3) {
              const env = Math.sin((x / w) * Math.PI);
              const wave =
                Math.sin(x * 0.08 + phase) * 0.55 +
                Math.sin(x * 0.19 - phase * 1.6) * 0.3 +
                Math.cos(x * 0.04 + phase * 0.7) * 0.15;
              const y = h / 2 + wave * env * (h * 0.34) * micModule.simulatedGain;
              if (x === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            }
          } else {
            ctx.moveTo(0, h / 2);
            ctx.lineTo(w, h / 2);
          }
          ctx.stroke();
        }
      }
      raf = requestAnimationFrame(drawWave);
    };

    raf = requestAnimationFrame(drawWave);
    return () => cancelAnimationFrame(raf);
  }, [micModule.listening, micModule.browserMicEnabled, micModule.simulatedGain, subTab]);

  // Cleanup media streams on unmount
  useEffect(() => {
    return () => {
      webcamStreamRef.current?.getTracks().forEach((t) => t.stop());
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      audioCtxRef.current?.close().catch(() => {});
    };
  }, []);

  const renderMountSliders = (
    cfg: CameraModuleConfig | LcdModuleConfig | MicModuleConfig,
    onUpdate: (patch: any) => void
  ) => {
    const pos = cfg.attached ? cfg.mountPosition : cfg.worldPosition;
    const rot = cfg.attached ? cfg.mountRotation : cfg.worldRotation;
    const posKey = cfg.attached ? 'mountPosition' : 'worldPosition';
    const rotKey = cfg.attached ? 'mountRotation' : 'worldRotation';
    const rangeMax = cfg.attached ? 0.35 : 2.5;
    const rangeMin = cfg.attached ? -0.35 : -2.5;

    return (
      <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-slate-200">
            {cfg.attached ? 'Chassis Mount Offset' : 'Detached World Pose'}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onSelectTarget({ kind: 'module', moduleId: cfg.id })}
              className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[11px] text-sky-300 flex items-center gap-1 cursor-pointer"
            >
              <Crosshair className="w-3 h-3" /> 3D Gizmo
            </button>
            <button
              type="button"
              onClick={() => onUpdate({ attached: !cfg.attached })}
              className={`px-2 py-1 rounded text-[11px] font-medium flex items-center gap-1 cursor-pointer ${
                cfg.attached
                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40'
                  : 'bg-amber-950 text-amber-300 border border-amber-500/40'
              }`}
            >
              {cfg.attached ? (
                <>
                  <Link2 className="w-3 h-3" /> Attached
                </>
              ) : (
                <>
                  <Link2Off className="w-3 h-3" /> Detached
                </>
              )}
            </button>
          </div>
        </div>

        {(['X', 'Y', 'Z'] as const).map((axis, idx) => (
          <div key={axis} className="space-y-0.5">
            <div className="flex justify-between text-[11px]">
              <span className="text-slate-400">Position {axis}</span>
              <span className="font-mono text-slate-200 tabular-nums">
                {pos[idx].toFixed(3)}m
              </span>
            </div>
            <input
              type="range"
              min={axis === 'Y' && !cfg.attached ? 0.12 : rangeMin}
              max={rangeMax}
              step={0.005}
              value={pos[idx]}
              onChange={(e) => {
                const next: [number, number, number] = [...pos] as [number, number, number];
                next[idx] = parseFloat(e.target.value);
                onUpdate({ [posKey]: next });
              }}
              className="w-full accent-sky-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
            />
          </div>
        ))}

        {[
          { label: 'Tilt (Pitch)', idx: 0 },
          { label: 'Pan (Yaw)', idx: 1 },
        ].map((r) => (
          <div key={r.label} className="space-y-0.5">
            <div className="flex justify-between text-[11px]">
              <span className="text-slate-400">{r.label}</span>
              <span className="font-mono text-slate-200 tabular-nums">
                {rot[r.idx].toFixed(0)}°
              </span>
            </div>
            <input
              type="range"
              min={-90}
              max={90}
              step={1}
              value={rot[r.idx]}
              onChange={(e) => {
                const next: [number, number, number] = [...rot] as [number, number, number];
                next[r.idx] = parseFloat(e.target.value);
                onUpdate({ [rotKey]: next });
              }}
              className="w-full accent-sky-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
            />
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-4 text-sm">
      {/* Module Sub-Selector */}
      <div className="grid grid-cols-3 gap-1 p-1 bg-slate-900 rounded-lg border border-slate-800">
        <button
          type="button"
          onClick={() => setSubTab('camera')}
          className={`py-1.5 px-2 rounded text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer ${
            subTab === 'camera' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
          }`}
        >
          <Camera className="w-3.5 h-3.5" /> Camera
        </button>
        <button
          type="button"
          onClick={() => setSubTab('lcd')}
          className={`py-1.5 px-2 rounded text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer ${
            subTab === 'lcd' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
          }`}
        >
          <Monitor className="w-3.5 h-3.5" /> LCD
        </button>
        <button
          type="button"
          onClick={() => setSubTab('mic')}
          className={`py-1.5 px-2 rounded text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer ${
            subTab === 'mic' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
          }`}
        >
          <Mic className="w-3.5 h-3.5" /> Audio
        </button>
      </div>

      {/*Always keep robotFeedCanvasRef mounted in DOM so Viewport3D can draw live frames */}
      <div className={subTab === 'camera' ? 'space-y-4' : 'hidden'}>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">
              Virtual Camera & Object Detection
            </h3>
            <span className="text-[11px] font-mono text-sky-400">
              {cameraModule.webcamEnabled ? 'WEBCAM INPUT' : 'SIMULATED RGB-D'}
            </span>
          </div>

          {/* Live Virtual Camera Feed or Optional Webcam */}
          <div className="relative rounded-xl overflow-hidden border border-slate-700 bg-slate-950 aspect-[16/10]">
            <canvas
              ref={robotFeedCanvasRef}
              width={400}
              height={250}
              className={`w-full h-full block ${cameraModule.webcamEnabled ? 'hidden' : ''}`}
            />
            {cameraModule.webcamEnabled && (
              <video
                ref={webcamVideoRef}
                muted
                playsInline
                className="w-full h-full object-cover"
              />
            )}

            {/* Simulated Bounding Boxes Overlay */}
            {!cameraModule.webcamEnabled &&
              cameraModule.showDetections &&
              detections.map((det) => (
                <div
                  key={det.id}
                  style={{
                    left: `${det.bbox.x * 100}%`,
                    top: `${det.bbox.y * 100}%`,
                    width: `${det.bbox.width * 100}%`,
                    height: `${det.bbox.height * 100}%`,
                  }}
                  className="absolute border-2 border-emerald-400 bg-emerald-500/10 pointer-events-none"
                >
                  <span className="bg-emerald-500 text-slate-950 text-[10px] font-mono font-semibold px-1 py-0.5 block truncate">
                    {det.label} {(det.confidence * 100).toFixed(0)}%
                    {cameraModule.showDepth ? ` · ${det.distanceMeters.toFixed(2)}m` : ''}
                  </span>
                </div>
              ))}

            <div className="absolute bottom-1.5 left-2 right-2 flex items-center justify-between text-[10px] font-mono bg-slate-950/85 px-2 py-0.5 rounded text-slate-300">
              <span>
                {cameraModule.webcamEnabled
                  ? 'MODE: REAL WEBCAM (NO FABRICATED DETECTIONS)'
                  : `SIMULATED DETECTIONS: ${detections.length}`}
              </span>
              <span>FOV {cameraModule.fov}°</span>
            </div>
          </div>

          {webcamError && (
            <p className="text-xs text-amber-300 bg-amber-950/50 border border-amber-500/30 p-2 rounded">
              {webcamError}
            </p>
          )}

          {/* Camera Viewport & Overlay Controls */}
          <div className="grid grid-cols-3 gap-1.5">
            {(
              [
                { id: 'orbit', label: 'Lab Orbit' },
                { id: 'split', label: 'Split PiP' },
                { id: 'first-person', label: '1st-Person' },
              ] as const
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onChangeCameraViewMode(m.id)}
                className={`py-1.5 px-2 rounded-lg text-xs font-medium border cursor-pointer ${
                  cameraViewMode === m.id
                    ? 'bg-blue-600 text-white border-blue-500'
                    : 'bg-slate-900 text-slate-300 border-slate-800 hover:border-slate-600'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-2">
            <label className="flex items-center justify-between text-xs text-slate-200 cursor-pointer">
              <span>Show Simulated Bounding Boxes</span>
              <input
                type="checkbox"
                checked={cameraModule.showDetections}
                onChange={(e) => onUpdateCameraModule({ showDetections: e.target.checked })}
                className="w-3.5 h-3.5 accent-blue-500 rounded cursor-pointer"
              />
            </label>
            <label className="flex items-center justify-between text-xs text-slate-200 cursor-pointer">
              <span>Show Simulated Depth Distance (m)</span>
              <input
                type="checkbox"
                checked={cameraModule.showDepth}
                onChange={(e) => onUpdateCameraModule({ showDepth: e.target.checked })}
                className="w-3.5 h-3.5 accent-blue-500 rounded cursor-pointer"
              />
            </label>
            <label className="flex items-center justify-between text-xs text-slate-200 pt-1 border-t border-slate-800 cursor-pointer">
              <span className="flex items-center gap-1.5">
                <Video className="w-3.5 h-3.5 text-sky-400" />
                Optional Browser Webcam Input
              </span>
              <input
                type="checkbox"
                checked={cameraModule.webcamEnabled}
                onChange={(e) => onUpdateCameraModule({ webcamEnabled: e.target.checked })}
                className="w-3.5 h-3.5 accent-blue-500 rounded cursor-pointer"
              />
            </label>
          </div>

          {/* Detected Objects List */}
          {!cameraModule.webcamEnabled && (
            <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1.5">
              <div className="text-xs font-medium text-slate-300">
                Simulated 3D Scene Detections ({detections.length})
              </div>
              {detections.length === 0 ? (
                <p className="text-xs text-slate-500">
                  No people or obstacles inside virtual camera frustum. Pan camera or move lab
                  objects into view (+Z front).
                </p>
              ) : (
                <div className="space-y-1">
                  {detections.map((d) => (
                    <div
                      key={d.id}
                      className="flex items-center justify-between text-xs font-mono bg-slate-950 px-2 py-1 rounded border border-slate-800 tabular-nums"
                    >
                      <span className="text-emerald-300">{d.label}</span>
                      <span className="text-slate-300">
                        {(d.confidence * 100).toFixed(0)}% · {d.distanceMeters.toFixed(2)}m [SIM]
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {renderMountSliders(cameraModule, onUpdateCameraModule)}
        </div>
      </div>

      {/* TAB 2: ATTACHABLE LCD DISPLAY */}
      {subTab === 'lcd' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Attachable LCD Display</h3>
            <span className="text-xs font-mono text-slate-400">
              {lcdModule.attached ? 'CHASSIS MOUNTED' : 'DETACHED'}
            </span>
          </div>

          {/* Large 2D Preview of 3D LCD Surface */}
          <div className="rounded-xl overflow-hidden border border-slate-700 bg-slate-950 p-2">
            <canvas
              ref={lcdPreviewCanvasRef}
              width={512}
              height={256}
              className="w-full h-auto rounded-lg block"
            />
          </div>

          {/* Screen Preset Selector */}
          <div className="space-y-1.5">
            <span className="text-xs text-slate-400">Simulated Status Screen</span>
            <div className="grid grid-cols-2 gap-1.5">
              {(
                [
                  { id: 'status', label: 'System Status' },
                  { id: 'servos', label: '12-CH Servos' },
                  { id: 'sensors', label: 'IMU & Sonar' },
                  { id: 'custom', label: 'Custom Text' },
                ] as Array<{ id: LcdScreenPreset; label: string }>
              ).map((scr) => (
                <button
                  key={scr.id}
                  type="button"
                  onClick={() => onUpdateLcdModule({ screenPreset: scr.id })}
                  className={`py-1.5 px-2.5 rounded-lg text-xs font-medium border cursor-pointer ${
                    lcdModule.screenPreset === scr.id
                      ? 'bg-blue-600 text-white border-blue-500'
                      : 'bg-slate-900 text-slate-300 border-slate-800 hover:border-slate-600'
                  }`}
                >
                  {scr.label}
                </button>
              ))}
            </div>
          </div>

          {/* Editable Text Area */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300">Displayed LCD Text (Live 3D Sync)</span>
              {lcdModule.screenPreset !== 'custom' && (
                <button
                  type="button"
                  onClick={() => onUpdateLcdModule({ screenPreset: 'custom' })}
                  className="text-sky-400 hover:text-sky-300 cursor-pointer"
                >
                  Switch to Custom Edit
                </button>
              )}
            </div>
            <textarea
              rows={5}
              value={lcdModule.customText}
              onChange={(e) =>
                onUpdateLcdModule({
                  screenPreset: 'custom',
                  customText: e.target.value,
                })
              }
              className="w-full p-2.5 rounded-lg bg-slate-950 border border-slate-700 font-mono text-xs text-sky-100 focus:border-sky-400 outline-none"
            />
          </div>

          {/* Screen Orientation & Backlight */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <span className="text-xs text-slate-400">Screen Orientation</span>
              <div className="grid grid-cols-4 gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800">
                {([0, 90, 180, 270] as LcdOrientation[]).map((deg) => (
                  <button
                    key={deg}
                    type="button"
                    onClick={() => onUpdateLcdModule({ orientation: deg })}
                    className={`py-1 rounded text-[11px] font-mono cursor-pointer ${
                      lcdModule.orientation === deg
                        ? 'bg-slate-700 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {deg}°
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <span className="text-xs text-slate-400">Backlight Color</span>
              <div className="grid grid-cols-3 gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800">
                {(['ice-blue', 'emerald', 'amber'] as const).map((col) => (
                  <button
                    key={col}
                    type="button"
                    onClick={() => onUpdateLcdModule({ backlightColor: col })}
                    className={`py-1 rounded text-[11px] capitalize cursor-pointer ${
                      lcdModule.backlightColor === col
                        ? 'bg-slate-700 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {col.split('-')[0]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {renderMountSliders(lcdModule, onUpdateLcdModule)}
        </div>
      )}

      {/* TAB 3: ATTACHABLE MICROPHONE & AUDIO SIMULATION */}
      {subTab === 'mic' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Microphone & Voice Simulation</h3>
            <span className="text-xs font-mono text-emerald-300">
              {micModule.listening ? 'LISTENING [VIRTUAL]' : 'IDLE'}
            </span>
          </div>

          <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-[11px] text-slate-300">
            Voice and text commands control the <strong>virtual 3D robot only</strong>. Physical
            robot servo execution is permanently disabled.
          </div>

          {/* Start / Stop Listening + Activity Waveform */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onUpdateMicModule({ listening: !micModule.listening })}
                className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer ${
                  micModule.listening
                    ? 'bg-amber-500 text-slate-950'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                }`}
              >
                {micModule.listening ? (
                  <>
                    <MicOff className="w-3.5 h-3.5" /> Stop Listening
                  </>
                ) : (
                  <>
                    <Mic className="w-3.5 h-3.5" /> Start Listening
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() =>
                  onUpdateMicModule({
                    browserMicEnabled: !micModule.browserMicEnabled,
                    listening: !micModule.browserMicEnabled ? true : micModule.listening,
                  })
                }
                className={`px-3 py-2 rounded-lg text-xs font-medium border cursor-pointer ${
                  micModule.browserMicEnabled
                    ? 'bg-sky-950 text-sky-300 border-sky-500/50'
                    : 'bg-slate-900 text-slate-300 border-slate-800 hover:border-slate-600'
                }`}
              >
                {micModule.browserMicEnabled ? 'Browser Mic On' : 'Use Browser Mic'}
              </button>
            </div>

            {micPermissionError && (
              <p className="text-xs text-amber-300 bg-amber-950/40 border border-amber-500/30 p-2 rounded">
                {micPermissionError}
              </p>
            )}

            <div className="rounded-xl overflow-hidden border border-slate-800 bg-slate-950 p-2">
              <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 mb-1">
                <span>
                  {micModule.browserMicEnabled
                    ? 'LIVE BROWSER AUDIO WAVEFORM'
                    : 'SIMULATED ACOUSTIC WAVEFORM'}
                </span>
                <span>{micModule.listening ? 'ACTIVE' : 'MUTED'}</span>
              </div>
              <canvas
                ref={waveformCanvasRef}
                width={360}
                height={72}
                className="w-full h-16 block rounded"
              />
            </div>
          </div>

          {/* Simulated Command Input & Presets */}
          <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-2.5">
            <span className="text-xs font-medium text-slate-200 block">
              Simulate Recognized Voice Command
            </span>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (commandInput.trim()) {
                  onExecuteVoiceCommand(commandInput.trim(), 'simulated-text');
                }
              }}
              className="flex items-center gap-1.5"
            >
              <input
                type="text"
                value={commandInput}
                onChange={(e) => setCommandInput(e.target.value)}
                placeholder="Type stand, sit, stop simulation, reset pose..."
                className="flex-1 px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white outline-none focus:border-sky-400"
              />
              <button
                type="submit"
                className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium flex items-center gap-1 cursor-pointer"
              >
                <Send className="w-3 h-3" /> Run
              </button>
            </form>

            <div className="flex flex-wrap gap-1.5">
              {['stand', 'sit', 'stop simulation', 'reset pose'].map((cmd) => (
                <button
                  key={cmd}
                  type="button"
                  onClick={() => onExecuteVoiceCommand(cmd, 'simulated-text')}
                  className="px-2 py-1 rounded bg-slate-950 hover:bg-slate-800 border border-slate-800 text-[11px] font-mono text-slate-300 cursor-pointer"
                >
                  "{cmd}"
                </button>
              ))}
            </div>

            {micModule.commandLog.length > 0 && (
              <div className="pt-2 border-t border-slate-800 space-y-1 max-h-28 overflow-y-auto">
                {micModule.commandLog.slice(0, 4).map((entry) => (
                  <div
                    key={entry.id}
                    className="text-[11px] font-mono flex items-center justify-between text-slate-300 bg-slate-950 px-2 py-1 rounded"
                  >
                    <span className="truncate">"{entry.phrase}"</span>
                    <span className="text-emerald-400 shrink-0 ml-2">{entry.actionTaken}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {renderMountSliders(micModule, onUpdateMicModule)}
        </div>
      )}
    </div>
  );
};
