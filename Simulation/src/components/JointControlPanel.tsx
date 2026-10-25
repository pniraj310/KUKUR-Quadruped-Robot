import React from 'react';
import { SelectableTarget, ServoChannel } from '../types/simulator';
import { computeJointRadians } from '../simulation/kinematics';
import { Lock, RotateCcw, ShieldCheck } from 'lucide-react';

interface JointControlPanelProps {
  channels: ServoChannel[];
  selectedTarget: SelectableTarget;
  onSelectChannel: (channel: number) => void;
  onChangeChannelTarget: (channel: number, targetDeg: number) => void;
  onResetChannel: (channel: number) => void;
  onResetAllChannels: () => void;
  extendedSimBoundsUnlocked: boolean;
  onToggleExtendedSimBounds: (unlocked: boolean) => void;
  visualKinematicGain: number;
  onChangeVisualKinematicGain: (gain: number) => void;
}

export const JointControlPanel: React.FC<JointControlPanelProps> = ({
  channels,
  selectedTarget,
  onSelectChannel,
  onChangeChannelTarget,
  onResetChannel,
  onResetAllChannels,
  extendedSimBoundsUnlocked,
  onToggleExtendedSimBounds,
  visualKinematicGain,
  onChangeVisualKinematicGain,
}) => {
  const selectedChannel =
    selectedTarget?.kind === 'joint' ? selectedTarget.channel : null;

  return (
    <div className="space-y-4 text-sm">
      {/* Header & Safety Notice */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">12-Channel PCA9685 Servo Control</h2>
          <button
            type="button"
            onClick={onResetAllChannels}
            className="text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1 cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" /> Reset All (95°)
          </button>
        </div>

        <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-300 space-y-1.5">
          <div className="flex items-center gap-1.5 text-emerald-300 font-medium">
            <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
            <span>Software Command vs. Physical Position</span>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Values below are <strong>simulated software command targets</strong> (default 95°;
            initial bounds 90°–100°). Default pose is uncalibrated; no physical PCA9685 hardware is
            connected. <strong>CH7</strong> is permanently locked to 90°–100°.
          </p>
        </div>

        {/* Optional Explicit Simulation Controls */}
        <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 space-y-2">
          <label className="flex items-center justify-between text-xs text-slate-200 cursor-pointer">
            <span>Explicitly Widen Virtual Range (CH0–6, CH8–11; CH7 Locked)</span>
            <input
              type="checkbox"
              checked={extendedSimBoundsUnlocked}
              onChange={(e) => onToggleExtendedSimBounds(e.target.checked)}
              className="w-3.5 h-3.5 accent-blue-500 rounded cursor-pointer"
            />
          </label>

          <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-800">
            <span className="text-slate-400">3D Visual Deflection Scale (Sim View Only)</span>
            <div className="flex items-center gap-1">
              {[1, 3].map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => onChangeVisualKinematicGain(g)}
                  className={`px-2 py-0.5 rounded text-[11px] font-mono cursor-pointer ${
                    visualKinematicGain === g
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
                  }`}
                >
                  {g}x
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* All 12 Servo Channels */}
      <div className="space-y-2">
        {channels.map((ch) => {
          const isSelected = selectedChannel === ch.channel;
          const linkOrientationDeg =
            (computeJointRadians(ch, 1.0) * 180) / Math.PI;

          return (
            <div
              key={ch.channel}
              onClick={() => onSelectChannel(ch.channel)}
              className={`p-2.5 rounded-lg border transition-colors cursor-pointer ${
                isSelected
                  ? 'bg-sky-950/40 border-sky-500/70'
                  : 'bg-slate-900 border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`font-mono text-xs font-semibold px-1.5 py-0.5 rounded ${
                      isSelected
                        ? 'bg-sky-500 text-slate-950'
                        : ch.safetyLocked
                        ? 'bg-amber-950 text-amber-300 border border-amber-500/40'
                        : 'bg-slate-950 text-slate-300 border border-slate-800'
                    }`}
                  >
                    CH{ch.channel}
                  </span>
                  <span className="text-xs font-medium text-slate-100 truncate">
                    {ch.label}
                  </span>
                  {ch.safetyLocked && (
                    <span
                      title="CH7 strictly constrained to 90°–100°"
                      className="text-[10px] font-mono text-amber-400 flex items-center gap-0.5 shrink-0"
                    >
                      <Lock className="w-3 h-3" /> 90–100°
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <input
                    type="number"
                    min={ch.minAngle}
                    max={ch.maxAngle}
                    step={0.5}
                    value={ch.targetAngle}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      const parsed = parseFloat(e.target.value);
                      if (!Number.isNaN(parsed)) {
                        onChangeChannelTarget(ch.channel, parsed);
                      }
                    }}
                    className="w-16 px-1.5 py-0.5 text-right font-mono text-xs bg-slate-950 border border-slate-700 rounded text-white focus:border-sky-400 outline-none tabular-nums"
                  />
                  <span className="text-xs font-mono text-slate-400">°</span>
                  <button
                    type="button"
                    title="Reset joint to 95°"
                    onClick={(e) => {
                      e.stopPropagation();
                      onResetChannel(ch.channel);
                    }}
                    className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800 cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" />
                  </button>
                </div>
              </div>

              <input
                type="range"
                min={ch.minAngle}
                max={ch.maxAngle}
                step={0.5}
                value={ch.targetAngle}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) =>
                  onChangeChannelTarget(ch.channel, parseFloat(e.target.value))
                }
                className="w-full accent-sky-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
              />

              <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 mt-1 tabular-nums">
                <span>
                  Allowed: {ch.minAngle}°–{ch.maxAngle}°
                </span>
                <span>
                  Cmd: {ch.targetAngle.toFixed(1)}° · Sim Link: {linkOrientationDeg.toFixed(1)}°
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
