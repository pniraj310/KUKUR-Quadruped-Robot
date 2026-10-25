import React, { useState } from 'react';
import { Sliders, AlertTriangle, ShieldCheck, Play, RotateCcw, Octagon, Check, ArrowRight } from 'lucide-react';
import { JointChannelInfo, LegId, PCA9685_CHANNELS, RobotJointAngles } from '../types/robot';

interface JointServoControllerProps {
  joints: RobotJointAngles;
  setJoints: React.Dispatch<React.SetStateAction<RobotJointAngles>>;
  selectedChannel: number;
  setSelectedChannel: (channel: number) => void;
  onEmergencyStop: () => void;
  onResetSimulation: () => void;
  isEmergencyStopped: boolean;
  onStand: () => void;
  onSit: () => void;
  onNeutral: () => void;
}

export const JointServoController: React.FC<JointServoControllerProps> = ({
  joints,
  setJoints,
  selectedChannel,
  setSelectedChannel,
  onEmergencyStop,
  onResetSimulation,
  isEmergencyStopped,
  onStand,
  onSit,
  onNeutral,
}) => {
  const [testingLeg, setTestingLeg] = useState<LegId | null>(null);
  const [testingJoint, setTestingJoint] = useState<number | null>(null);

  const selectedInfo = PCA9685_CHANNELS.find((c) => c.channel === selectedChannel) || PCA9685_CHANNELS[7];

  // Get current angle of a given joint channel
  const getAngleForChannel = (chInfo: JointChannelInfo): number => {
    const legJoints = joints[chInfo.leg];
    if (!legJoints) return 0;
    if (chInfo.joint === 'abduction') return legJoints.hip;
    if (chInfo.joint === 'hip_pitch') return legJoints.shoulder;
    if (chInfo.joint === 'knee') return legJoints.knee;
    return 0;
  };

  // Update a single joint channel with software limit validation
  const handleAngleChange = (chInfo: JointChannelInfo, rawVal: number) => {
    if (isEmergencyStopped) return;

    // Enforce software limits (e.g. CH7: 90 to 100)
    const clamped = Math.min(chInfo.softwareMax, Math.max(chInfo.softwareMin, rawVal));

    setJoints((prev) => {
      const leg = { ...prev[chInfo.leg] };
      if (chInfo.joint === 'abduction') leg.hip = clamped;
      else if (chInfo.joint === 'hip_pitch') leg.shoulder = clamped;
      else if (chInfo.joint === 'knee') leg.knee = clamped;

      return {
        ...prev,
        [chInfo.leg]: leg,
      };
    });
  };

  // Coordinated test for an entire leg (e.g. lift and lower leg)
  const testLeg = (legId: LegId) => {
    if (isEmergencyStopped) return;
    setTestingLeg(legId);

    // Temporarily flex hip pitch and knee
    setJoints((prev) => ({
      ...prev,
      [legId]: { hip: 0, shoulder: 70, knee: -60 },
    }));

    setTimeout(() => {
      setJoints((prev) => ({
        ...prev,
        [legId]: { hip: 0, shoulder: 45, knee: -90 },
      }));
      setTestingLeg(null);
    }, 1200);
  };

  // Test individual joint sweep
  const testSingleJoint = (chInfo: JointChannelInfo) => {
    if (isEmergencyStopped) return;
    setTestingJoint(chInfo.channel);
    setSelectedChannel(chInfo.channel);

    const initial = getAngleForChannel(chInfo);
    handleAngleChange(chInfo, chInfo.softwareMax);

    setTimeout(() => {
      handleAngleChange(chInfo, chInfo.softwareMin);
      setTimeout(() => {
        handleAngleChange(chInfo, chInfo.neutralAngle);
        setTestingJoint(null);
      }, 700);
    }, 700);
  };

  return (
    <div className="flex flex-col h-full bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden shadow-2xl p-4 text-xs text-neutral-200">
      {/* Top Banner & Quick Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-neutral-800">
        <div className="flex items-center gap-2">
          <Sliders className="w-5 h-5 text-amber-400" />
          <div>
            <span className="text-sm font-bold text-neutral-100">
              12-Channel Servo & Joint Controller
            </span>
            <div className="text-[11px] text-neutral-400 font-mono">
              PCA9685 I2C 0x40 • 50 Hz PWM Frequency
            </div>
          </div>
        </div>

        {/* Global Quick Pose & Safety Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={onStand}
            disabled={isEmergencyStopped}
            className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-40 text-neutral-200 rounded-lg font-medium border border-neutral-700 transition"
          >
            Stand
          </button>
          <button
            onClick={onSit}
            disabled={isEmergencyStopped}
            className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-40 text-neutral-200 rounded-lg font-medium border border-neutral-700 transition"
          >
            Sit
          </button>
          <button
            onClick={onNeutral}
            disabled={isEmergencyStopped}
            className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-40 text-neutral-200 rounded-lg font-medium border border-neutral-700 transition"
          >
            Neutral Pose
          </button>
          <button
            onClick={onResetSimulation}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 rounded-lg font-medium border border-sky-500/30 transition"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset Sim
          </button>
          <button
            onClick={onEmergencyStop}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold border transition ${
              isEmergencyStopped
                ? 'bg-rose-600 text-white border-rose-500 animate-pulse'
                : 'bg-rose-500/20 hover:bg-rose-600 text-rose-300 hover:text-white border-rose-500/40'
            }`}
          >
            <Octagon className="w-4 h-4" />
            {isEmergencyStopped ? 'E-STOPPED (CLICK RESET)' : 'EMERGENCY STOP'}
          </button>
        </div>
      </div>

      {/* Main Grid: Channel List & Detailed Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-3 flex-1 overflow-auto">
        {/* Col 1 & 2: 12-Channel Servo Matrix */}
        <div className="lg:col-span-2 space-y-3">
          <div className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider flex items-center justify-between">
            <span>PCA9685 Channel Matrix (12 DOFs)</span>
            <span className="text-[10px] text-amber-400 font-mono">
              Click joint to inspect & articulate
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {(['FL', 'FR', 'RL', 'RR'] as const).map((legId) => {
              const legChannels = PCA9685_CHANNELS.filter((c) => c.leg === legId);
              const legName =
                legId === 'FL'
                  ? 'Front-Left'
                  : legId === 'FR'
                  ? 'Front-Right'
                  : legId === 'RL'
                  ? 'Back-Left (BL)'
                  : 'Back-Right (BR)';

              return (
                <div
                  key={legId}
                  className="p-3 rounded-xl bg-neutral-950 border border-neutral-800 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-neutral-100 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-amber-500" />
                      {legName}
                    </span>
                    <button
                      onClick={() => testLeg(legId)}
                      disabled={isEmergencyStopped || testingLeg === legId}
                      className="px-2 py-0.5 rounded text-[10px] bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-700 transition"
                    >
                      {testingLeg === legId ? 'Testing...' : 'Test Leg'}
                    </button>
                  </div>

                  <div className="space-y-1.5">
                    {legChannels.map((ch) => {
                      const isSelected = selectedChannel === ch.channel;
                      const currentAngle = getAngleForChannel(ch);
                      const isCH7 = ch.channel === 7;

                      return (
                        <div
                          key={ch.channel}
                          onClick={() => setSelectedChannel(ch.channel)}
                          className={`p-2 rounded-lg border cursor-pointer transition flex items-center justify-between gap-2 ${
                            isSelected
                              ? 'bg-amber-500/15 border-amber-500 text-amber-200 shadow-sm'
                              : isCH7
                              ? 'bg-sky-500/5 border-sky-500/30 hover:border-sky-400'
                              : 'bg-neutral-900 border-neutral-800/80 hover:border-neutral-700 text-neutral-300'
                          }`}
                        >
                          <div className="flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono font-bold text-[11px] text-amber-400">
                                CH{ch.channel}
                              </span>
                              <span className="font-medium text-xs text-neutral-200">
                                {ch.jointLabel}
                              </span>
                              {isCH7 && (
                                <span className="px-1.5 py-0.2 rounded text-[9px] bg-sky-500/20 text-sky-300 border border-sky-500/40 font-mono">
                                  TEST TARGET (90°-100°)
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-neutral-500 font-mono mt-0.5">
                              Limits: [{ch.softwareMin}°, {ch.softwareMax}°]
                            </div>
                          </div>

                          <div className="text-right font-mono">
                            <span className="text-sm font-bold text-neutral-100">
                              {currentAngle}°
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Col 3: Selected Joint Inspector & Micro-Tuning */}
        <div className="p-4 bg-neutral-950 rounded-xl border border-neutral-800 flex flex-col justify-between space-y-3">
          <div>
            <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
              <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
                Joint Inspector
              </span>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-500/10 text-amber-300 border border-amber-500/20">
                CH{selectedInfo.channel} SELECTED
              </span>
            </div>

            <div className="mt-3">
              <div className="text-base font-bold text-neutral-100">{selectedInfo.name}</div>
              <div className="text-xs text-neutral-400 mt-0.5">
                {selectedInfo.legLabel} Leg • {selectedInfo.jointLabel} Joint
              </div>
            </div>

            {/* Special Callout for CH7 */}
            {selectedInfo.channel === 7 && (
              <div className="mt-3 p-2.5 rounded-lg bg-sky-500/10 border border-sky-500/20 text-[11px] text-sky-200">
                <div className="font-semibold flex items-center gap-1.5 text-sky-300">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  CH7 Initial Software Limits Active
                </div>
                <p className="text-[10.5px] text-neutral-400 mt-1">
                  Enforced range: <strong>90° min</strong> to <strong>100° max</strong>. Initial target: <strong>95°</strong>.
                  (Command limits are strictly enforced).
                </p>
              </div>
            )}

            {/* Slider & Angle Numeric Input */}
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-neutral-300 font-medium">Target Angle:</span>
                <div className="flex items-center gap-1 font-mono">
                  <input
                    type="number"
                    min={selectedInfo.softwareMin}
                    max={selectedInfo.softwareMax}
                    value={getAngleForChannel(selectedInfo)}
                    onChange={(e) =>
                      handleAngleChange(selectedInfo, parseFloat(e.target.value) || 0)
                    }
                    disabled={isEmergencyStopped}
                    className="w-16 px-2 py-1 bg-neutral-900 border border-neutral-700 rounded text-amber-400 font-bold text-sm text-right focus:outline-none focus:border-amber-500"
                  />
                  <span className="text-neutral-400 text-xs">deg</span>
                </div>
              </div>

              {/* Slider */}
              <input
                type="range"
                min={selectedInfo.softwareMin}
                max={selectedInfo.softwareMax}
                step="1"
                value={getAngleForChannel(selectedInfo)}
                onChange={(e) =>
                  handleAngleChange(selectedInfo, parseFloat(e.target.value))
                }
                disabled={isEmergencyStopped}
                className="w-full accent-amber-500 h-2 bg-neutral-800 rounded-lg appearance-none cursor-pointer"
              />

              <div className="flex justify-between text-[10px] text-neutral-500 font-mono">
                <span>Min: {selectedInfo.softwareMin}°</span>
                <span>Neutral: {selectedInfo.neutralAngle}°</span>
                <span>Max: {selectedInfo.softwareMax}°</span>
              </div>
            </div>

            {/* Nudge Buttons (-5, -1, +1, +5) */}
            <div className="mt-4 grid grid-cols-4 gap-1.5 font-mono">
              {[-5, -1, 1, 5].map((delta) => (
                <button
                  key={delta}
                  onClick={() =>
                    handleAngleChange(
                      selectedInfo,
                      getAngleForChannel(selectedInfo) + delta
                    )
                  }
                  disabled={isEmergencyStopped}
                  className="px-2 py-1.5 rounded bg-neutral-900 hover:bg-neutral-800 text-neutral-300 border border-neutral-800 text-xs transition"
                >
                  {delta > 0 ? `+${delta}°` : `${delta}°`}
                </button>
              ))}
            </div>
          </div>

          {/* Action buttons */}
          <div className="space-y-2 pt-3 border-t border-neutral-800">
            <button
              onClick={() => testSingleJoint(selectedInfo)}
              disabled={isEmergencyStopped || testingJoint === selectedInfo.channel}
              className="w-full py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-neutral-950 font-bold rounded-lg text-xs transition flex items-center justify-center gap-1.5"
            >
              <Play className="w-3.5 h-3.5" />
              {testingJoint === selectedInfo.channel ? 'Sweeping Joint...' : 'Test Joint Sweep'}
            </button>

            <div className="text-[10px] text-neutral-500 text-center font-mono">
              Simulation Only • Physical Servos Isolated
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
