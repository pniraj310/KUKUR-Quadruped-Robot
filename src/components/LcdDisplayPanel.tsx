import React, { useState } from 'react';
import { Monitor, Sliders, Edit3, Check, RefreshCw, Cpu, ShieldCheck } from 'lucide-react';
import { LcdDisplayState, LcdMode, RobotJointAngles, SensorData, DetectedObject } from '../types/robot';

interface LcdDisplayPanelProps {
  lcdState: LcdDisplayState;
  setLcdState: React.Dispatch<React.SetStateAction<LcdDisplayState>>;
  sensors: SensorData;
  joints: RobotJointAngles;
  detections: DetectedObject[];
}

export const LcdDisplayPanel: React.FC<LcdDisplayPanelProps> = ({
  lcdState,
  setLcdState,
  sensors,
  joints,
  detections,
}) => {
  const [customL1, setCustomL1] = useState(lcdState.customLine1);
  const [customL2, setCustomL2] = useState(lcdState.customLine2);

  // Compute text for each mode
  const getModeText = (mode: LcdMode): { line1: string; line2: string } => {
    switch (mode) {
      case 'status':
        return {
          line1: 'KUKUR Quadruped',
          line2: 'SYS: OK 50Hz SIM',
        };
      case 'pose':
        return {
          line1: `P:${sensors.imu.pitch > 0 ? '+' : ''}${sensors.imu.pitch}° R:${sensors.imu.roll > 0 ? '+' : ''}${sensors.imu.roll}°`,
          line2: `Y:${sensors.imu.yaw > 0 ? '+' : ''}${sensors.imu.yaw}° H:165mm`,
        };
      case 'joints':
        return {
          line1: `FL:${joints.FL.shoulder}° BL:${joints.RL.shoulder}°`,
          line2: `FR:${joints.FR.shoulder}° BR:${joints.RR.shoulder}°`,
        };
      case 'imu':
        return {
          line1: `ACC: ${sensors.imu.accel.z.toFixed(1)}m/s²`,
          line2: `GYR: ${sensors.imu.gyro.x.toFixed(2)}rad/s`,
        };
      case 'detection':
        return {
          line1: detections.length > 0 ? `FOUND: ${detections[0].label}` : 'NO OBJECT IN FOV',
          line2: detections.length > 0 ? `DST:${detections[0].distanceM}m C:${detections[0].confidence}%` : 'SCANNING 360...',
        };
      case 'ultrasonic':
        return {
          line1: `DIST: ${sensors.ultrasonicDistanceCm.toFixed(1)}cm`,
          line2: sensors.ultrasonicDistanceCm < 30 ? 'STATUS: DANGER' : 'STATUS: CLEAR',
        };
      case 'camera_mic':
        return {
          line1: 'CAM: 1080P 30FPS',
          line2: 'MIC: ACTIVE I2S',
        };
      case 'hardware':
        return {
          line1: 'PCA9685: 0x40 OK',
          line2: `I2C LCD: ${lcdState.i2cAddress} VIRT`,
        };
      case 'custom':
        return {
          line1: customL1 || 'CUSTOM TEXT 1',
          line2: customL2 || 'CUSTOM TEXT 2',
        };
    }
  };

  const currentDisplay = getModeText(lcdState.mode);

  const handleApplyCustom = () => {
    setLcdState((prev) => ({
      ...prev,
      mode: 'custom',
      customLine1: customL1,
      customLine2: customL2,
      line1: customL1,
      line2: customL2,
    }));
  };

  const handleModeChange = (newMode: LcdMode) => {
    const text = getModeText(newMode);
    setLcdState((prev) => ({
      ...prev,
      mode: newMode,
      line1: text.line1,
      line2: text.line2,
    }));
  };

  return (
    <div className="flex flex-col h-full bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden shadow-2xl p-4 text-xs text-neutral-200">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-neutral-800">
        <div className="flex items-center gap-2">
          <Monitor className="w-5 h-5 text-amber-400" />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-neutral-100">
                16×2 I2C Character LCD Display Controller
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                I2C Address: 0x27
              </span>
            </div>
            <div className="text-[11px] text-neutral-400 font-mono">
              HD44780 Controller Protocol • High-Contrast Blue Backlight
            </div>
          </div>
        </div>

        {/* Backlight toggle */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setLcdState((prev) => ({ ...prev, backlight: !prev.backlight }))}
            className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium border transition ${
              lcdState.backlight
                ? 'bg-blue-600/20 border-blue-500 text-blue-300'
                : 'bg-neutral-800 border-neutral-700 text-neutral-400'
            }`}
          >
            Backlight: {lcdState.backlight ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>

      {/* Main Grid: Realistic 16x2 Display Preview (Left) + Mode Controls (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-3 flex-1 overflow-auto">
        {/* Left: Pixel-accurate 16x2 Physical LCD Simulator */}
        <div className="p-4 bg-neutral-950 rounded-xl border border-neutral-800 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3 text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
              <span>Virtual 16×2 Display Output</span>
              <span className="font-mono text-neutral-500">Rendered in 3D & Preview</span>
            </div>

            {/* Realistic Physical LCD Frame */}
            <div className="p-3 bg-neutral-900 border-4 border-neutral-800 rounded-lg shadow-inner">
              <div
                className={`p-4 rounded border-2 border-blue-950 font-mono transition-colors duration-200 select-none ${
                  lcdState.backlight
                    ? 'bg-[#003da5] text-white shadow-[0_0_15px_rgba(0,80,255,0.3)]'
                    : 'bg-[#081426] text-neutral-600'
                }`}
              >
                {/* 16 character cells per row */}
                <div className="text-xl sm:text-2xl font-bold tracking-widest leading-relaxed whitespace-pre font-mono">
                  {currentDisplay.line1.padEnd(16, ' ').slice(0, 16)}
                </div>
                <div className="text-xl sm:text-2xl font-bold tracking-widest leading-relaxed whitespace-pre font-mono mt-1">
                  {currentDisplay.line2.padEnd(16, ' ').slice(0, 16)}
                </div>
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between text-[11px] text-neutral-500 font-mono">
              <span>Controller: HD44780 + PCF8574</span>
              <span>Mode: {lcdState.mode.toUpperCase()}</span>
            </div>
          </div>

          {/* Custom Text Editor */}
          <div className="pt-3 border-t border-neutral-800/80 space-y-2">
            <span className="text-[11px] font-semibold text-neutral-300 flex items-center gap-1.5">
              <Edit3 className="w-3.5 h-3.5 text-amber-400" />
              Custom Text Editor (Max 16 chars per line)
            </span>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                type="text"
                maxLength={16}
                value={customL1}
                onChange={(e) => setCustomL1(e.target.value)}
                placeholder="Line 1 (16 chars)"
                className="px-3 py-1.5 bg-neutral-900 border border-neutral-700 rounded text-neutral-200 font-mono text-xs focus:outline-none focus:border-amber-500"
              />
              <input
                type="text"
                maxLength={16}
                value={customL2}
                onChange={(e) => setCustomL2(e.target.value)}
                placeholder="Line 2 (16 chars)"
                className="px-3 py-1.5 bg-neutral-900 border border-neutral-700 rounded text-neutral-200 font-mono text-xs focus:outline-none focus:border-amber-500"
              />
            </div>

            <button
              onClick={handleApplyCustom}
              className="w-full py-1.5 bg-amber-500 hover:bg-amber-400 text-neutral-950 font-bold rounded-lg text-xs transition"
            >
              Push Custom Text to LCD
            </button>
          </div>
        </div>

        {/* Right: Display Preset Modes Selector */}
        <div className="p-4 bg-neutral-950 rounded-xl border border-neutral-800 flex flex-col justify-between space-y-3">
          <div>
            <div className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider mb-2">
              Select Display Telemetry Mode
            </div>

            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { id: 'status', label: '1. Robot Status', desc: 'Startup & loop frequency' },
                  { id: 'pose', label: '2. Body Pose', desc: 'Pitch, Roll, Yaw, Height' },
                  { id: 'joints', label: '3. Joint Angles', desc: '12-channel shoulder summary' },
                  { id: 'imu', label: '4. IMU 6-DOF', desc: 'Accel & Gyro rates' },
                  { id: 'detection', label: '5. AI Vision', desc: 'Nearest detected object' },
                  { id: 'ultrasonic', label: '6. Ultrasonic', desc: 'HC-SR04 distance & alert' },
                  { id: 'camera_mic', label: '7. Cam & Mic', desc: 'FPS & audio active state' },
                  { id: 'hardware', label: '8. Hardware Link', desc: 'PCA9685 & I2C addresses' },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  onClick={() => handleModeChange(m.id)}
                  className={`p-2.5 rounded-lg border text-left transition ${
                    lcdState.mode === m.id
                      ? 'bg-amber-500/15 border-amber-500 text-amber-200 shadow-sm'
                      : 'bg-neutral-900 border-neutral-800 text-neutral-300 hover:border-neutral-700'
                  }`}
                >
                  <div className="font-semibold text-xs text-neutral-100">{m.label}</div>
                  <div className="text-[10.5px] text-neutral-500 mt-0.5">{m.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="p-2.5 rounded-lg bg-sky-500/10 border border-sky-500/20 text-[10.5px] text-sky-300 font-mono flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 shrink-0 text-sky-400" />
            <span>Ready for physical I2C LCD (PCF8574 at 0x27). In simulation mode, output updates virtual canvas on 3D chassis.</span>
          </div>
        </div>
      </div>
    </div>
  );
};
