import React, { useState } from 'react';
import { Terminal, Download, Trash2, Filter, AlertTriangle, CheckCircle, Info, Octagon } from 'lucide-react';
import { LogEntry, RobotActivityState } from '../types/robot';

interface LogsDiagnosticsPanelProps {
  logs: LogEntry[];
  onClearLogs: () => void;
  robotState: RobotActivityState;
  selectedChannel: number;
  simTimeSeconds: number;
  isEmergencyStopped: boolean;
}

export const LogsDiagnosticsPanel: React.FC<LogsDiagnosticsPanelProps> = ({
  logs,
  onClearLogs,
  robotState,
  selectedChannel,
  simTimeSeconds,
  isEmergencyStopped,
}) => {
  const [filter, setFilter] = useState<'all' | 'cmd' | 'warn' | 'error'>('all');

  const filteredLogs = logs.filter((l) => {
    if (filter === 'all') return true;
    return l.level === filter;
  });

  const handleExport = () => {
    const text = logs
      .map((l) => `[${l.timestamp}] [${l.level.toUpperCase()}] [${l.source}]: ${l.message}`)
      .join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kukur_sim_diagnostics_${Date.now()}.log`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="flex flex-col h-full bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden shadow-2xl p-4 text-xs text-neutral-200">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-neutral-800">
        <div className="flex items-center gap-2">
          <Terminal className="w-5 h-5 text-amber-400" />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-neutral-100">
                System Logs & Telemetry Diagnostics
              </span>
              <span
                className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                  isEmergencyStopped
                    ? 'bg-rose-500/20 text-rose-400 border-rose-500/30 font-bold'
                    : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                }`}
              >
                STATE: {robotState}
              </span>
            </div>
            <div className="text-[11px] text-neutral-400 font-mono">
              Sim Time: {simTimeSeconds.toFixed(1)}s • Selected Joint: CH{selectedChannel} • 50 Hz Loop
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {/* Filter Pills */}
          <div className="flex items-center bg-neutral-950 p-0.5 rounded-lg border border-neutral-800">
            {(['all', 'cmd', 'warn', 'error'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-2 py-1 text-[10.5px] font-mono rounded capitalize ${
                  filter === f
                    ? 'bg-neutral-800 text-amber-400 font-bold'
                    : 'text-neutral-400 hover:text-neutral-200'
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg border border-neutral-700 transition"
          >
            <Download className="w-3.5 h-3.5" />
            Export Log
          </button>

          <button
            onClick={onClearLogs}
            className="p-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-rose-400 rounded-lg border border-neutral-700 transition"
            title="Clear logs"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Terminal Log Stream */}
      <div className="mt-3 flex-1 bg-neutral-950 rounded-xl border border-neutral-800 p-3 font-mono text-[11px] overflow-y-auto space-y-1.5 leading-relaxed">
        {filteredLogs.map((log) => {
          const color =
            log.level === 'error'
              ? 'text-rose-400 bg-rose-500/5'
              : log.level === 'warn'
              ? 'text-amber-400 bg-amber-500/5'
              : log.level === 'cmd'
              ? 'text-sky-400 bg-sky-500/5'
              : 'text-neutral-300';

          return (
            <div key={log.id} className={`p-1.5 rounded flex items-start gap-2 ${color}`}>
              <span className="text-neutral-500 shrink-0">[{log.timestamp}]</span>
              <span
                className={`text-[9.5px] px-1 py-0.2 rounded font-bold shrink-0 ${
                  log.level === 'error'
                    ? 'bg-rose-500/20 text-rose-300'
                    : log.level === 'warn'
                    ? 'bg-amber-500/20 text-amber-300'
                    : log.level === 'cmd'
                    ? 'bg-sky-500/20 text-sky-300'
                    : 'bg-neutral-800 text-neutral-400'
                }`}
              >
                {log.level.toUpperCase()}
              </span>
              <span className="text-neutral-400 font-semibold shrink-0">[{log.source}]</span>
              <span className="flex-1">{log.message}</span>
            </div>
          );
        })}

        {filteredLogs.length === 0 && (
          <div className="text-neutral-500 p-4 text-center">No logs match filter.</div>
        )}
      </div>
    </div>
  );
};
