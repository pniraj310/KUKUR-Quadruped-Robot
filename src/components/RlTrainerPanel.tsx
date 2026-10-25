import React, { useState, useEffect } from 'react';
import { Play, Pause, RotateCcw, TrendingUp, Sliders, Shield, Download, Zap, Award } from 'lucide-react';
import { RlHyperparameters, RlTrainingMetrics, SensorData } from '../types/robot';
import { DEFAULT_RL_HYPERPARAMS, SpotMicroRlPolicy, computeStepReward } from '../simulation/rlEngine';

interface RlTrainerPanelProps {
  sensors: SensorData;
  isTraining: boolean;
  onToggleTraining: () => void;
  onStepTrain: () => void;
}

export const RlTrainerPanel: React.FC<RlTrainerPanelProps> = ({
  sensors,
  isTraining,
  onToggleTraining,
  onStepTrain,
}) => {
  const [hyperparams, setHyperparams] = useState<RlHyperparameters>(DEFAULT_RL_HYPERPARAMS);
  const [speedMultiplier, setSpeedMultiplier] = useState<1 | 2 | 5 | 10>(1);
  const [policy] = useState(() => new SpotMicroRlPolicy());

  // Metrics state
  const [metrics, setMetrics] = useState<RlTrainingMetrics>({
    episode: 1,
    step: 0,
    currentReward: 0,
    averageReward: 1.2,
    bestReward: 2.8,
    rewardHistory: [0.2, 0.4, 0.6, 0.9, 1.1, 1.3, 1.2, 1.5, 1.8, 2.1, 2.3, 2.8],
    policyLoss: 0.042,
    valueLoss: 0.015,
    distanceTraveledMeters: 0,
    isTraining,
    speedMultiplier: 1,
  });

  const [rewardBreakdown, setRewardBreakdown] = useState<Record<string, number>>({
    forward: 1.2,
    upright: 0.9,
    energy: -0.2,
    slip: -0.1,
    obstacle: 0,
    stance: 0.2,
  });

  // Simulated RL step updates when training
  useEffect(() => {
    if (!isTraining) return;

    const intervalMs = Math.max(20, Math.round(100 / speedMultiplier));
    const timer = setInterval(() => {
      // Forward velocity simulated from gait
      const v_fwd = 0.35 + (Math.random() - 0.45) * 0.1;
      const energy = sensors.servoCurrentAmps;
      const { totalReward, breakdown } = computeStepReward(sensors, v_fwd, energy, hyperparams);

      setRewardBreakdown(breakdown);

      setMetrics((prev) => {
        const nextStep = prev.step + 1;
        const nextDist = prev.distanceTraveledMeters + (v_fwd * (intervalMs / 1000));

        // Episode ends every 150 steps or on collision
        if (nextStep >= 150 || (sensors.ultrasonicDistanceCm < 20 && hyperparams.obstaclePenaltyWeight > 1)) {
          const episodeReward = prev.currentReward + totalReward;
          const newHistory = [...prev.rewardHistory.slice(-35), Math.round(episodeReward * 10) / 10];
          const newAvg = Math.round((newHistory.reduce((a, b) => a + b, 0) / newHistory.length) * 10) / 10;
          const newBest = Math.max(prev.bestReward, episodeReward);

          // Update policy weights via evolutionary policy gradient
          policy.updateWeights(episodeReward > newAvg ? 1.0 : -0.5, hyperparams.learningRate);

          return {
            ...prev,
            episode: prev.episode + 1,
            step: 0,
            currentReward: 0,
            averageReward: newAvg,
            bestReward: Math.round(newBest * 10) / 10,
            rewardHistory: newHistory,
            distanceTraveledMeters: 0,
            policyLoss: Math.max(0.005, prev.policyLoss * 0.98 + (Math.random() - 0.5) * 0.002),
            valueLoss: Math.max(0.002, prev.valueLoss * 0.98 + (Math.random() - 0.5) * 0.001),
          };
        }

        return {
          ...prev,
          step: nextStep,
          currentReward: Math.round((prev.currentReward + totalReward) * 100) / 100,
          distanceTraveledMeters: Math.round(nextDist * 100) / 100,
        };
      });
    }, intervalMs);

    return () => clearInterval(timer);
  }, [isTraining, speedMultiplier, sensors, hyperparams, policy]);

  const handleReset = () => {
    setMetrics({
      episode: 1,
      step: 0,
      currentReward: 0,
      averageReward: 0,
      bestReward: 0,
      rewardHistory: [0],
      policyLoss: 0.08,
      valueLoss: 0.04,
      distanceTraveledMeters: 0,
      isTraining: false,
      speedMultiplier: 1,
    });
  };

  const handleExportPolicy = () => {
    const jsonStr = policy.exportJson();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'spotmicro_trained_policy.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="flex flex-col h-full bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden shadow-2xl p-4 text-xs text-neutral-200">
      {/* Top Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-neutral-800">
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleTraining}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold text-xs transition ${
              isTraining
                ? 'bg-amber-500 hover:bg-amber-400 text-neutral-950'
                : 'bg-emerald-500 hover:bg-emerald-400 text-neutral-950'
            }`}
          >
            {isTraining ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            {isTraining ? 'Pause Training' : 'Start RL Training'}
          </button>

          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg border border-neutral-700 transition"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset
          </button>

          {/* Speed Multiplier */}
          <div className="flex items-center bg-neutral-950 p-0.5 rounded-lg border border-neutral-800">
            {([1, 2, 5, 10] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSpeedMultiplier(s)}
                className={`px-2 py-1 text-[11px] font-mono rounded ${
                  speedMultiplier === s
                    ? 'bg-neutral-800 text-amber-400 font-bold'
                    : 'text-neutral-400 hover:text-neutral-200'
                }`}
              >
                {s}x
              </button>
            ))}
          </div>
        </div>

        {/* Sim-to-Real Domain Randomization Badge & Export */}
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-neutral-300 bg-neutral-950 px-2.5 py-1 rounded-lg border border-neutral-800">
            <input
              type="checkbox"
              checked={hyperparams.simToRealNoise}
              onChange={(e) =>
                setHyperparams({ ...hyperparams, simToRealNoise: e.target.checked })
              }
              className="accent-amber-500"
            />
            <Shield className="w-3.5 h-3.5 text-sky-400" />
            Sim-to-Real Noise
          </label>

          <button
            onClick={handleExportPolicy}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-lg border border-neutral-700 transition text-[11px]"
          >
            <Download className="w-3.5 h-3.5 text-amber-400" />
            Export Weights (JSON)
          </button>
        </div>
      </div>

      {/* Main Grid: Metrics, Graph, and Reward Shaping */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-3 flex-1 overflow-auto">
        {/* Col 1: Live Episode Metrics */}
        <div className="p-3 bg-neutral-950 rounded-lg border border-neutral-800 flex flex-col justify-between">
          <div>
            <div className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider mb-2 flex items-center justify-between">
              <span>Training State</span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-mono ${isTraining ? 'bg-emerald-500/10 text-emerald-400' : 'bg-neutral-800 text-neutral-400'}`}>
                {isTraining ? 'RUNNING' : 'IDLE'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 font-mono">
              <div className="p-2 rounded bg-neutral-900 border border-neutral-800">
                <div className="text-[10px] text-neutral-500">EPISODE</div>
                <div className="text-base font-bold text-neutral-100">#{metrics.episode}</div>
              </div>
              <div className="p-2 rounded bg-neutral-900 border border-neutral-800">
                <div className="text-[10px] text-neutral-500">STEP</div>
                <div className="text-base font-bold text-neutral-100">{metrics.step} / 150</div>
              </div>
              <div className="p-2 rounded bg-neutral-900 border border-neutral-800">
                <div className="text-[10px] text-neutral-500">AVG REWARD</div>
                <div className="text-base font-bold text-amber-400">{metrics.averageReward}</div>
              </div>
              <div className="p-2 rounded bg-neutral-900 border border-neutral-800">
                <div className="text-[10px] text-neutral-500">BEST REWARD</div>
                <div className="text-base font-bold text-emerald-400 flex items-center gap-1">
                  <Award className="w-3.5 h-3.5" />
                  {metrics.bestReward}
                </div>
              </div>
            </div>

            <div className="mt-3 space-y-1 font-mono text-[11px] text-neutral-400">
              <div className="flex justify-between">
                <span>Distance Traveled:</span>
                <span className="text-neutral-200">{metrics.distanceTraveledMeters.toFixed(2)} m</span>
              </div>
              <div className="flex justify-between">
                <span>Policy Loss:</span>
                <span className="text-neutral-200">{metrics.policyLoss.toFixed(4)}</span>
              </div>
              <div className="flex justify-between">
                <span>Value Loss:</span>
                <span className="text-neutral-200">{metrics.valueLoss.toFixed(4)}</span>
              </div>
            </div>
          </div>

          {/* Reward Components Breakdown */}
          <div className="mt-3 pt-2 border-t border-neutral-800/80">
            <div className="text-[10px] text-neutral-500 uppercase font-semibold mb-1">Live Step Rewards</div>
            <div className="grid grid-cols-3 gap-1 font-mono text-[10px] text-center">
              <div className="p-1 rounded bg-neutral-900 text-emerald-400">Fwd: +{rewardBreakdown.forward}</div>
              <div className="p-1 rounded bg-neutral-900 text-sky-400">Bal: +{rewardBreakdown.upright}</div>
              <div className="p-1 rounded bg-neutral-900 text-rose-400">NRG: {rewardBreakdown.energy}</div>
            </div>
          </div>
        </div>

        {/* Col 2: Reward Convergence Graph */}
        <div className="p-3 bg-neutral-950 rounded-lg border border-neutral-800 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5 text-amber-400" />
              Episodic Reward Convergence
            </span>
            <span className="text-[10px] font-mono text-neutral-500">PPO Curve</span>
          </div>

          {/* SVG Sparkline Graph */}
          <div className="h-32 w-full bg-neutral-900/60 rounded border border-neutral-800/80 p-2 flex items-end relative overflow-hidden">
            {metrics.rewardHistory.length > 1 ? (
              <svg className="w-full h-full overflow-visible" viewBox="0 0 100 50" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="rewardGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.4" />
                    <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.0" />
                  </linearGradient>
                </defs>
                {/* Grid horizontal lines */}
                <line x1="0" y1="12" x2="100" y2="12" stroke="#1f2937" strokeWidth="0.5" strokeDasharray="2" />
                <line x1="0" y1="25" x2="100" y2="25" stroke="#1f2937" strokeWidth="0.5" strokeDasharray="2" />
                <line x1="0" y1="38" x2="100" y2="38" stroke="#1f2937" strokeWidth="0.5" strokeDasharray="2" />

                {/* Polyline Path */}
                {(() => {
                  const maxR = Math.max(3.0, ...metrics.rewardHistory);
                  const minR = Math.min(0.0, ...metrics.rewardHistory);
                  const range = Math.max(1, maxR - minR);
                  const points = metrics.rewardHistory
                    .map((val, idx) => {
                      const x = (idx / (metrics.rewardHistory.length - 1)) * 100;
                      const y = 48 - ((val - minR) / range) * 44;
                      return `${x},${y}`;
                    })
                    .join(' ');
                  return (
                    <>
                      <polygon
                        points={`0,50 ${points} 100,50`}
                        fill="url(#rewardGrad)"
                      />
                      <polyline
                        points={points}
                        fill="none"
                        stroke="#f59e0b"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </>
                  );
                })()}
              </svg>
            ) : (
              <div className="m-auto text-neutral-500 font-mono text-[11px]">Collecting episode samples...</div>
            )}
          </div>

          <div className="mt-2 text-[10px] text-neutral-500 flex justify-between font-mono">
            <span>Ep 1</span>
            <span>Ep {metrics.episode}</span>
          </div>
        </div>

        {/* Col 3: Interactive Reward Function Shaping */}
        <div className="p-3 bg-neutral-950 rounded-lg border border-neutral-800 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-sky-400" />
              Reward Function Tuning
            </span>
          </div>

          <div className="space-y-2.5">
            {/* Forward Velocity */}
            <div>
              <div className="flex justify-between text-[11px] text-neutral-300">
                <span>Forward Velocity Weight (w_fwd)</span>
                <span className="font-mono text-amber-400">{hyperparams.forwardRewardWeight}</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="3.0"
                step="0.1"
                value={hyperparams.forwardRewardWeight}
                onChange={(e) =>
                  setHyperparams({ ...hyperparams, forwardRewardWeight: parseFloat(e.target.value) })
                }
                className="w-full accent-amber-500 h-1 bg-neutral-800 rounded-lg appearance-none cursor-pointer"
              />
            </div>

            {/* Upright Balance */}
            <div>
              <div className="flex justify-between text-[11px] text-neutral-300">
                <span>Upright Balance Weight (w_bal)</span>
                <span className="font-mono text-amber-400">{hyperparams.uprightRewardWeight}</span>
              </div>
              <input
                type="range"
                min="0.2"
                max="2.5"
                step="0.1"
                value={hyperparams.uprightRewardWeight}
                onChange={(e) =>
                  setHyperparams({ ...hyperparams, uprightRewardWeight: parseFloat(e.target.value) })
                }
                className="w-full accent-amber-500 h-1 bg-neutral-800 rounded-lg appearance-none cursor-pointer"
              />
            </div>

            {/* Energy Penalty */}
            <div>
              <div className="flex justify-between text-[11px] text-neutral-300">
                <span>Servo Energy Penalty (w_energy)</span>
                <span className="font-mono text-rose-400">{hyperparams.energyPenaltyWeight}</span>
              </div>
              <input
                type="range"
                min="0.0"
                max="1.0"
                step="0.05"
                value={hyperparams.energyPenaltyWeight}
                onChange={(e) =>
                  setHyperparams({ ...hyperparams, energyPenaltyWeight: parseFloat(e.target.value) })
                }
                className="w-full accent-rose-500 h-1 bg-neutral-800 rounded-lg appearance-none cursor-pointer"
              />
            </div>

            {/* Obstacle Penalty */}
            <div>
              <div className="flex justify-between text-[11px] text-neutral-300">
                <span>Obstacle Collision Penalty (w_obs)</span>
                <span className="font-mono text-rose-400">{hyperparams.obstaclePenaltyWeight}</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="5.0"
                step="0.5"
                value={hyperparams.obstaclePenaltyWeight}
                onChange={(e) =>
                  setHyperparams({ ...hyperparams, obstaclePenaltyWeight: parseFloat(e.target.value) })
                }
                className="w-full accent-rose-500 h-1 bg-neutral-800 rounded-lg appearance-none cursor-pointer"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
