import React, { useState, useRef, useEffect } from 'react';
import { Camera, Eye, Video, Scan, AlertCircle, Sparkles, Sliders, Layers } from 'lucide-react';
import { DetectedObject, SceneItem } from '../types/robot';

interface CameraVisionPanelProps {
  detections: DetectedObject[];
  isFovVisible: boolean;
  onToggleFov: () => void;
  sceneItems: SceneItem[];
  robotCanvasRef?: React.RefObject<HTMLCanvasElement>;
}

export const CameraVisionPanel: React.FC<CameraVisionPanelProps> = ({
  detections,
  isFovVisible,
  onToggleFov,
  sceneItems,
}) => {
  const [showBoundingBoxes, setShowBoundingBoxes] = useState(true);
  const [useWebcam, setUseWebcam] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [webcamError, setWebcamError] = useState<string | null>(null);

  // Toggle physical webcam if requested
  useEffect(() => {
    let stream: MediaStream | null = null;
    if (useWebcam) {
      navigator.mediaDevices
        ?.getUserMedia({ video: { width: 640, height: 480 } })
        .then((s) => {
          stream = s;
          if (videoRef.current) {
            videoRef.current.srcObject = s;
          }
          setWebcamError(null);
        })
        .catch((err) => {
          setWebcamError(err.message || 'Webcam access denied or unavailable');
          setUseWebcam(false);
        });
    } else {
      if (videoRef.current && videoRef.current.srcObject) {
        const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
        tracks.forEach((t) => t.stop());
        videoRef.current.srcObject = null;
      }
    }

    return () => {
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [useWebcam]);

  return (
    <div className="flex flex-col h-full bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden shadow-2xl p-4 text-xs text-neutral-200">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-neutral-800">
        <div className="flex items-center gap-2">
          <Camera className="w-5 h-5 text-sky-400" />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-neutral-100">
                Front-Mounted Camera & Object Detection
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20 font-mono">
                Synthetic Vision System (Labeled)
              </span>
            </div>
            <div className="text-[11px] text-neutral-400 font-mono">
              65° FOV • 30 FPS • Raycast & Frustum Geometry
            </div>
          </div>
        </div>

        {/* Action Toggles */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowBoundingBoxes(!showBoundingBoxes)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition ${
              showBoundingBoxes
                ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                : 'bg-neutral-800 border-neutral-700 text-neutral-400'
            }`}
          >
            <Scan className="w-3.5 h-3.5" />
            <span>Bounding Boxes {showBoundingBoxes ? 'ON' : 'OFF'}</span>
          </button>

          <button
            onClick={onToggleFov}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition ${
              isFovVisible
                ? 'bg-sky-500/20 border-sky-500/40 text-sky-300'
                : 'bg-neutral-800 border-neutral-700 text-neutral-400'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Camera FOV Cone {isFovVisible ? 'ON' : 'OFF'}</span>
          </button>

          <button
            onClick={() => setUseWebcam(!useWebcam)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition ${
              useWebcam
                ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                : 'bg-neutral-800 border-neutral-700 text-neutral-400'
            }`}
          >
            <Video className="w-3.5 h-3.5" />
            <span>{useWebcam ? 'Real Webcam Active' : 'Enable Webcam'}</span>
          </button>
        </div>
      </div>

      {/* Grid: Camera Viewport (Left) + Detection List (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-3 flex-1 overflow-auto">
        {/* Left: Viewport with Bounding Box Overlays */}
        <div className="lg:col-span-2 relative bg-neutral-950 rounded-xl border border-neutral-800 overflow-hidden flex flex-col justify-center items-center aspect-video max-h-[300px]">
          {useWebcam ? (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
          ) : (
            /* Virtual simulated camera rendering canvas / graphic */
            <div className="w-full h-full relative bg-radial from-slate-900 via-neutral-950 to-black overflow-hidden flex items-center justify-center">
              {/* Grid pattern mimicking image sensor */}
              <div className="absolute inset-0 bg-[linear-gradient(to_right,#1f293710_1px,transparent_1px),linear-gradient(to_bottom,#1f293710_1px,transparent_1px)] bg-[size:24px_24px]" />

              {/* Crosshair Center */}
              <div className="w-12 h-12 border border-sky-500/30 rounded-full flex items-center justify-center pointer-events-none">
                <div className="w-2 h-2 bg-sky-400 rounded-full opacity-60" />
              </div>

              {/* Watermark / HUD */}
              <div className="absolute top-2 left-3 font-mono text-[10px] text-sky-400 bg-neutral-950/80 px-2 py-0.5 rounded border border-sky-500/20">
                KUKUR CAM-01 [1080P] • 30.0 FPS
              </div>

              <div className="absolute bottom-2 left-3 font-mono text-[10px] text-neutral-400 bg-neutral-950/80 px-2 py-0.5 rounded border border-neutral-800">
                DETECTIONS IN FRUSTUM: {detections.length}
              </div>

              {/* Render 2D Bounding Boxes for detected objects */}
              {showBoundingBoxes &&
                detections.map((det) => (
                  <div
                    key={det.id}
                    className="absolute border-2 border-amber-400 rounded transition-all duration-150 pointer-events-none"
                    style={{
                      left: `${det.bbox.x * 100}%`,
                      top: `${det.bbox.y * 100}%`,
                      width: `${det.bbox.w * 100}%`,
                      height: `${det.bbox.h * 100}%`,
                    }}
                  >
                    {/* Label Badge */}
                    <div className="absolute -top-5 left-0 px-1.5 py-0.2 bg-amber-500 text-neutral-950 font-mono font-bold text-[9px] rounded-t flex items-center gap-1 shadow">
                      <span>{det.label}</span>
                      <span className="opacity-80">({det.confidence}%)</span>
                    </div>

                    {/* Distance Badge */}
                    <div className="absolute -bottom-4 right-0 px-1 py-0.2 bg-neutral-900 text-amber-300 font-mono text-[8.5px] rounded border border-neutral-700">
                      {det.distanceM}m / {det.directionDeg > 0 ? `+${det.directionDeg}` : det.directionDeg}°
                    </div>
                  </div>
                ))}

              {detections.length === 0 && (
                <div className="text-neutral-500 font-mono text-xs text-center z-10">
                  <Scan className="w-6 h-6 mx-auto mb-1 opacity-40 text-neutral-400" />
                  <span>No objects currently inside KUKUR camera field of view.</span>
                  <div className="text-[11px] text-neutral-600 mt-0.5">
                    Move the robot closer or adjust object positions in the Environment tab.
                  </div>
                </div>
              )}
            </div>
          )}

          {webcamError && (
            <div className="absolute bottom-2 bg-rose-500/20 text-rose-300 px-3 py-1 rounded text-xs border border-rose-500/40">
              {webcamError}
            </div>
          )}
        </div>

        {/* Right: Object Detection Telemetry List */}
        <div className="p-3 bg-neutral-950 rounded-xl border border-neutral-800 flex flex-col justify-between space-y-3">
          <div>
            <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
              <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
                Active Detections ({detections.length})
              </span>
              <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                LIVE
              </span>
            </div>

            <div className="mt-2.5 space-y-2 overflow-y-auto max-h-[190px]">
              {detections.map((det) => (
                <div
                  key={det.id}
                  className="p-2.5 rounded-lg bg-neutral-900 border border-neutral-800 text-xs font-mono space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-amber-400 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                      {det.label}
                    </span>
                    <span className="text-neutral-400 text-[11px]">
                      Conf: <strong className="text-emerald-400">{det.confidence}%</strong>
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[11px] text-neutral-400">
                    <div>
                      Dist: <span className="text-neutral-200 font-semibold">{det.distanceM} m</span>
                    </div>
                    <div>
                      Bearing:{' '}
                      <span className="text-neutral-200 font-semibold">
                        {det.directionDeg > 0 ? `+${det.directionDeg}` : det.directionDeg}°
                      </span>
                    </div>
                  </div>
                </div>
              ))}

              {detections.length === 0 && (
                <div className="p-3 text-center text-neutral-500 text-xs font-mono">
                  No objects in frame.
                </div>
              )}
            </div>
          </div>

          {/* System transparency disclaimer */}
          <div className="pt-2 border-t border-neutral-800/80 text-[10px] text-neutral-500 font-mono">
            <strong>Note:</strong> Synthetic CV detection calculates 3D camera projection and frustum bounds. Ready for ONNX / YOLOv8 edge deployment on Raspberry Pi 4.
          </div>
        </div>
      </div>
    </div>
  );
};
