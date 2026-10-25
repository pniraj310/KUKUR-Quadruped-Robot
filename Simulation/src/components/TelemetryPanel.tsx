import React from 'react';
import {
  CameraModuleConfig,
  NavigationConfigAndState,
  SensorTelemetry,
  ServoChannel,
} from '../types/simulator';
import { angleToSimulatedPwmUs } from '../simulation/kinematics';
import {
  Activity,
  AlertOctagon,
  BatteryCharging,
  Cpu,
  Navigation,
  Radio,
  Unplug,
} from 'lucide-react';

interface TelemetryPanelProps {
  telemetry: SensorTelemetry;
  onUpdateTelemetryConfig: (patch: Partial<SensorTelemetry>) => void;
  navigation: NavigationConfigAndState;
  onUpdateNavigation: (patch: Partial<NavigationConfigAndState>) => void;
  channels: ServoChannel[];
  cameraModule: CameraModuleConfig;
}

export const TelemetryPanel: React.FC<TelemetryPanelProps> = ({
  telemetry,
  onUpdateTelemetryConfig,
  navigation,
  onUpdateNavigation,
  channels,
  cameraModule,
}) => {
  return (
    <div className="space-y-5 text-sm">
      {/* Explicit Hardware Separation Banner */}
      <div className="p-3 rounded-lg bg-slate-900 border border-slate-700 space-y-1">
        <div className="flex items-center justify-between text-xs font-mono">
          <span className="text-amber-300 font-semibold flex items-center gap-1.5">
            <Unplug className="w-3.5 h-3.5" /> NO HARDWARE CONNECTED
          </span>
          <span className="text-sky-300">VIRTUAL SENSORS</span>
        </div>
        <p className="text-[11px] text-slate-400">
          Raspberry Pi & PCA9685 I2C buses are not connected. All readings below are synthesized
          from the 3D virtual scene or manual test sliders.
        </p>
      </div>

      {/* Autonomous Navigation & Obstacle Avoidance Telemetry */}
      <section className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-white flex items-center gap-1.5">
            <Navigation className="w-3.5 h-3.5 text-emerald-400" />
            Autonomous Navigation & Clearance
          </span>
          <button
            type="button"
            onClick={() => onUpdateNavigation({ enabled: !navigation.enabled })}
            className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold cursor-pointer ${
              navigation.enabled
                ? 'bg-emerald-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:text-white'
            }`}
          >
            {navigation.enabled ? 'ENABLED' : 'STANDBY'}
          </button>
        </div>

        {(navigation.fsmState === 'PATH_BLOCKED' ||
          navigation.fsmState === 'WAITING_FOR_CLEARANCE') && (
          <div className="p-2.5 rounded bg-red-950 border border-red-500 text-xs font-mono text-red-100 flex items-center gap-2">
            <AlertOctagon className="w-4 h-4 text-red-400 shrink-0" />
            <span>
              <strong>PATH BLOCKED — WAITING FOR CLEARANCE</strong> — Both routes blocked; waiting
              for route opening.
            </span>
          </div>
        )}

        <div className="grid grid-cols-3 gap-2 font-mono">
          <div className="p-2 rounded bg-slate-950 border border-slate-800">
            <div className="text-[10px] text-slate-400">FSM STATE</div>
            <div
              className={`text-[11px] font-semibold mt-0.5 truncate ${
                navigation.fsmState === 'PATH_BLOCKED' ||
                navigation.fsmState === 'WAITING_FOR_CLEARANCE'
                  ? 'text-red-400'
                  : navigation.enabled
                  ? 'text-emerald-300'
                  : 'text-slate-300'
              }`}
              title={navigation.fsmState}
            >
              {navigation.fsmState}
            </div>
          </div>

          <div className="p-2 rounded bg-slate-950 border border-slate-800">
            <div className="text-[10px] text-slate-400">ACTIVITY</div>
            <div
              className={`text-xs font-semibold mt-0.5 ${
                navigation.activityState === 'MOVING'
                  ? 'text-emerald-300'
                  : navigation.activityState === 'WAITING'
                  ? 'text-amber-300'
                  : 'text-slate-400'
              }`}
            >
              {navigation.activityState}
              {navigation.isLiftedOffFloor ? ' (AIR)' : ''}
            </div>
          </div>

          <div className="p-2 rounded bg-slate-950 border border-slate-800">
            <div className="text-[10px] text-slate-400">SELECTED DIR</div>
            <div
              className={`text-xs font-semibold mt-0.5 ${
                navigation.selectedTurnDirection === 'BLOCKED'
                  ? 'text-red-400'
                  : navigation.selectedTurnDirection === 'NONE'
                  ? 'text-slate-300'
                  : 'text-amber-300'
              }`}
            >
              {navigation.selectedTurnDirection}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 font-mono text-center tabular-nums">
          <div className="p-2 rounded bg-slate-950 border border-slate-800">
            <div className="text-[10px] text-slate-400">LEFT DIST</div>
            <div className="text-xs font-semibold text-sky-300 mt-0.5">
              {navigation.leftClearanceM.toFixed(2)} m
            </div>
          </div>
          <div className="p-2 rounded bg-slate-950 border border-slate-800">
            <div className="text-[10px] text-slate-400">OBSTACLE FWD</div>
            <div
              className={`text-xs font-semibold mt-0.5 ${
                navigation.nearestForwardM <= navigation.safetyDistanceM
                  ? 'text-red-400'
                  : 'text-emerald-300'
              }`}
            >
              {navigation.nearestForwardM.toFixed(2)} m
            </div>
          </div>
          <div className="p-2 rounded bg-slate-950 border border-slate-800">
            <div className="text-[10px] text-slate-400">RIGHT DIST</div>
            <div className="text-xs font-semibold text-sky-300 mt-0.5">
              {navigation.rightClearanceM.toFixed(2)} m
            </div>
          </div>
        </div>

        <div className="text-[11px] font-mono text-slate-200 bg-slate-950 px-2.5 py-1.5 rounded border border-slate-800">
          Status: {navigation.statusMessage}
        </div>

        <div className="space-y-2 pt-0.5">
          <div className="space-y-1">
            <div className="flex justify-between text-[11px]">
              <span className="text-slate-400">Safety Stop Distance</span>
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
            <div className="flex justify-between text-[11px]">
              <span className="text-slate-400">Bypass Turn Angle</span>
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
            <div className="flex justify-between text-[11px]">
              <span className="text-slate-400">Clearance Threshold</span>
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
        </div>
      </section>

      {/* Simulated MPU6050 IMU */}
      <section className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-white flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-sky-400" />
            MPU6050 6-Axis IMU
          </span>
          <span className="text-[10px] font-mono text-slate-400">SIMULATED</span>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center font-mono">
          {(['X', 'Y', 'Z'] as const).map((axis, idx) => (
            <div
              key={`acc-${axis}`}
              className="p-2 rounded bg-slate-950 border border-slate-800"
            >
              <div className="text-[10px] text-slate-400">ACCEL {axis}</div>
              <div className="text-xs font-semibold text-slate-100 tabular-nums mt-0.5">
                {telemetry.accel[idx].toFixed(2)} g
              </div>
            </div>
          ))}
          {(['X', 'Y', 'Z'] as const).map((axis, idx) => (
            <div
              key={`gyr-${axis}`}
              className="p-2 rounded bg-slate-950 border border-slate-800"
            >
              <div className="text-[10px] text-slate-400">GYRO {axis}</div>
              <div className="text-xs font-semibold text-sky-300 tabular-nums mt-0.5">
                {telemetry.gyro[idx].toFixed(1)} °/s
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-1 pt-1">
          <div className="flex justify-between text-[11px]">
            <span className="text-slate-400">Simulated IMU Sensor Noise</span>
            <span className="font-mono text-slate-300 tabular-nums">
              ±{telemetry.manualImuNoise.toFixed(3)} g
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={0.08}
            step={0.005}
            value={telemetry.manualImuNoise}
            onChange={(e) =>
              onUpdateTelemetryConfig({ manualImuNoise: parseFloat(e.target.value) })
            }
            className="w-full accent-sky-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
          />
        </div>
      </section>

      {/* Simulated Ultrasonic HC-SR04 + Battery + Camera Status */}
      <section className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-white flex items-center gap-1.5">
            <Radio className="w-3.5 h-3.5 text-emerald-400" />
            Ultrasonic, Power & Vision Status
          </span>
          <span className="text-[10px] font-mono text-slate-400">VIRTUAL SENSOR</span>
        </div>

        <div className="grid grid-cols-2 gap-2 font-mono">
          <div className="p-2.5 rounded bg-slate-950 border border-slate-800">
            <div className="text-[10px] text-slate-400">HC-SR04 DISTANCE</div>
            <div className="text-sm font-semibold text-emerald-300 tabular-nums mt-0.5">
              {telemetry.ultrasonicCm.toFixed(1)} cm
            </div>
            <div className="text-[10px] text-slate-500">
              {telemetry.manualSensorOverride ? 'MANUAL OVERRIDE' : '3D RAYCAST'}
            </div>
          </div>

          <div className="p-2.5 rounded bg-slate-950 border border-slate-800">
            <div className="text-[10px] text-slate-400 flex items-center gap-1">
              <BatteryCharging className="w-3 h-3 text-amber-400" /> BATTERY (SIM)
            </div>
            <div className="text-sm font-semibold text-amber-300 tabular-nums mt-0.5">
              {telemetry.batteryVoltage.toFixed(2)} V
            </div>
            <div className="text-[10px] text-slate-500">2S LiPo Virtual</div>
          </div>
        </div>

        <div className="p-2 rounded bg-slate-950 border border-slate-800 flex items-center justify-between text-xs font-mono">
          <span className="text-slate-400">CAMERA STATUS</span>
          <span className="text-sky-300">
            {cameraModule.webcamEnabled ? 'WEBCAM STREAM' : 'SIMULATED 3D RGB-D'}
          </span>
        </div>

        <label className="flex items-center justify-between text-xs text-slate-200 pt-1 cursor-pointer">
          <span>Override Ultrasonic Distance Manually</span>
          <input
            type="checkbox"
            checked={telemetry.manualSensorOverride}
            onChange={(e) =>
              onUpdateTelemetryConfig({ manualSensorOverride: e.target.checked })
            }
            className="w-3.5 h-3.5 accent-emerald-500 rounded cursor-pointer"
          />
        </label>

        {telemetry.manualSensorOverride && (
          <div className="space-y-1">
            <div className="flex justify-between text-[11px]">
              <span className="text-slate-400">Manual Sonar Distance</span>
              <span className="font-mono text-slate-200 tabular-nums">
                {telemetry.manualUltrasonicCm.toFixed(0)} cm
              </span>
            </div>
            <input
              type="range"
              min={4}
              max={400}
              step={1}
              value={telemetry.manualUltrasonicCm}
              onChange={(e) =>
                onUpdateTelemetryConfig({
                  manualUltrasonicCm: parseFloat(e.target.value),
                })
              }
              className="w-full accent-emerald-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
            />
          </div>
        )}

        <div className="space-y-1">
          <div className="flex justify-between text-[11px]">
            <span className="text-slate-400">Simulated Battery Voltage</span>
            <span className="font-mono text-slate-200 tabular-nums">
              {telemetry.batteryVoltage.toFixed(2)} V
            </span>
          </div>
          <input
            type="range"
            min={6.4}
            max={8.4}
            step={0.02}
            value={telemetry.batteryVoltage}
            onChange={(e) =>
              onUpdateTelemetryConfig({ batteryVoltage: parseFloat(e.target.value) })
            }
            className="w-full accent-amber-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
          />
        </div>
      </section>

      {/* 12 Servo Command Targets Telemetry Table */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-white flex items-center gap-1.5">
            <Cpu className="w-3.5 h-3.5 text-blue-400" />
            12-Channel PCA9685 Command Targets
          </span>
          <span className="text-[10px] font-mono text-slate-400">SIMULATED PWM</span>
        </div>

        <div className="rounded-lg border border-slate-800 overflow-hidden">
          <table className="w-full text-left border-collapse font-mono text-[11px] tabular-nums">
            <thead>
              <tr className="bg-slate-900 text-slate-400 border-b border-slate-800">
                <th className="py-1.5 px-2">CH</th>
                <th className="py-1.5 px-2">Joint</th>
                <th className="py-1.5 px-2 text-right">Target</th>
                <th className="py-1.5 px-2 text-right">Bounds</th>
                <th className="py-1.5 px-2 text-right">PWM</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 bg-slate-950">
              {channels.map((ch) => (
                <tr
                  key={ch.channel}
                  className={ch.channel === 7 ? 'bg-amber-950/20 text-amber-200' : 'text-slate-200'}
                >
                  <td className="py-1.5 px-2 font-semibold">CH{ch.channel}</td>
                  <td className="py-1.5 px-2 font-sans text-slate-300">{ch.label}</td>
                  <td className="py-1.5 px-2 text-right font-semibold">
                    {ch.targetAngle.toFixed(1)}°
                  </td>
                  <td className="py-1.5 px-2 text-right text-slate-400">
                    {ch.minAngle}–{ch.maxAngle}°
                  </td>
                  <td className="py-1.5 px-2 text-right text-sky-300">
                    {angleToSimulatedPwmUs(ch.targetAngle)}µs
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
