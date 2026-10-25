import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Volume2, Play, Terminal, Shield, Check, AlertTriangle, Send } from 'lucide-react';
import { MicrophoneState } from '../types/robot';

interface MicrophoneVoicePanelProps {
  micState: MicrophoneState;
  setMicState: React.Dispatch<React.SetStateAction<MicrophoneState>>;
  onExecuteCommand: (cmd: string) => { success: boolean; message: string };
  isEmergencyStopped: boolean;
}

export const MicrophoneVoicePanel: React.FC<MicrophoneVoicePanelProps> = ({
  micState,
  setMicState,
  onExecuteCommand,
  isEmergencyStopped,
}) => {
  const [manualInput, setManualInput] = useState('');
  const [speechSupported, setSpeechSupported] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const recognitionRef = useRef<any>(null);

  // Supported robot commands
  const supportedCommands = [
    'Stand',
    'Sit',
    'Walk',
    'Stop',
    'Turn left',
    'Turn right',
    'Show detected objects',
    'Show robot status',
  ];

  // Check Web Speech API availability
  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (SpeechRecognition) {
      setSpeechSupported(true);
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.lang = 'en-US';

      recognition.onresult = (event: any) => {
        const lastResult = event.results[event.results.length - 1];
        if (lastResult.isFinal) {
          const transcript = lastResult[0].transcript.trim();
          handleProcessCommand(transcript);
        }
      };

      recognition.onerror = (e: any) => {
        console.warn('Speech recognition error:', e.error);
        setMicState((prev) => ({ ...prev, isListening: false }));
      };

      recognitionRef.current = recognition;
    }
  }, []);

  // Animate audio oscilloscope waveform on Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    let animId: number;
    let phase = 0;

    const renderWaveform = () => {
      ctx.fillStyle = '#0a0d14';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Center reference line
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, canvas.height / 2);
      ctx.lineTo(canvas.width, canvas.height / 2);
      ctx.stroke();

      // Waveform line
      const active = micState.isListening;
      const amp = active ? 28 : 3;

      ctx.strokeStyle = active ? '#38bdf8' : '#475569';
      ctx.lineWidth = 2;
      ctx.beginPath();

      phase += 0.1;
      for (let x = 0; x < canvas.width; x++) {
        const norm = (x / canvas.width) * 8 * Math.PI;
        const noise = active ? (Math.random() - 0.5) * 8 : 0;
        const y = canvas.height / 2 + Math.sin(norm + phase) * amp + noise;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      animId = requestAnimationFrame(renderWaveform);
    };

    renderWaveform();
    return () => cancelAnimationFrame(animId);
  }, [micState.isListening]);

  const handleToggleListening = () => {
    if (micState.isListening) {
      if (recognitionRef.current) recognitionRef.current.stop();
      setMicState((prev) => ({ ...prev, isListening: false, isRealMic: false }));
    } else {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.start();
          setMicState((prev) => ({ ...prev, isListening: true, isRealMic: true }));
        } catch {
          // Fallback to simulated audio listening
          setMicState((prev) => ({ ...prev, isListening: true, isRealMic: false }));
        }
      } else {
        setMicState((prev) => ({ ...prev, isListening: true, isRealMic: false }));
      }
    }
  };

  const handleProcessCommand = (cmdText: string) => {
    const result = onExecuteCommand(cmdText);

    setMicState((prev) => ({
      ...prev,
      lastCommand: cmdText,
      commandHistory: [
        {
          id: String(Date.now()),
          text: cmdText,
          timestamp: new Date().toLocaleTimeString(),
          status: result.success ? 'executed' : 'rejected',
        },
        ...prev.commandHistory.slice(0, 15),
      ],
    }));
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualInput.trim()) return;
    handleProcessCommand(manualInput.trim());
    setManualInput('');
  };

  return (
    <div className="flex flex-col h-full bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden shadow-2xl p-4 text-xs text-neutral-200">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-neutral-800">
        <div className="flex items-center gap-2">
          <Mic className="w-5 h-5 text-purple-400" />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-neutral-100">
                Microphone & Voice Command Interface
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20">
                {micState.isRealMic ? 'Hardware Web Speech' : 'Simulated Voice Engine'}
              </span>
            </div>
            <div className="text-[11px] text-neutral-400 font-mono">
              I2S Digital MEMS Microphone • Audio Processing 16kHz
            </div>
          </div>
        </div>

        {/* Listen Button */}
        <button
          onClick={handleToggleListening}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
            micState.isListening
              ? 'bg-rose-500 text-white border-rose-400 shadow-md'
              : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border-neutral-700'
          }`}
        >
          {micState.isListening ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
          <span>{micState.isListening ? 'Stop Listening' : 'Start Voice Recognition'}</span>
        </button>
      </div>

      {/* Grid: Waveform + Voice Command History */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-3 flex-1 overflow-auto">
        {/* Left: Live Audio Oscilloscope & Quick Command Pills */}
        <div className="p-4 bg-neutral-950 rounded-xl border border-neutral-800 flex flex-col justify-between space-y-3">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider flex items-center gap-1.5">
                <Volume2 className="w-3.5 h-3.5 text-sky-400" />
                Live Audio Waveform Oscilloscope
              </span>
              <span
                className={`text-[10px] font-mono px-2 py-0.5 rounded ${
                  micState.isListening
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                    : 'bg-neutral-800 text-neutral-500'
                }`}
              >
                {micState.isListening ? 'STREAMING 16kHz' : 'MUTED'}
              </span>
            </div>

            {/* Canvas Oscilloscope */}
            <canvas
              ref={canvasRef}
              width={400}
              height={100}
              className="w-full h-24 rounded-lg border border-neutral-800 bg-neutral-900"
            />

            {/* Quick Command Pills */}
            <div className="mt-3">
              <div className="text-[10.5px] text-neutral-400 font-semibold mb-1.5">
                Quick Voice Commands (Click to simulate speaking):
              </div>
              <div className="flex flex-wrap gap-1.5">
                {supportedCommands.map((cmd) => (
                  <button
                    key={cmd}
                    onClick={() => handleProcessCommand(cmd)}
                    disabled={isEmergencyStopped}
                    className="px-2.5 py-1 rounded bg-neutral-900 hover:bg-neutral-800 disabled:opacity-40 text-neutral-300 hover:text-white border border-neutral-800 font-mono text-[11px] transition cursor-pointer"
                  >
                    "{cmd}"
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Manual text alternative */}
          <form onSubmit={handleManualSubmit} className="pt-2 border-t border-neutral-800 flex gap-2">
            <input
              type="text"
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              placeholder="Or type command: 'Stand', 'Walk', 'Turn left'..."
              className="flex-1 px-3 py-1.5 bg-neutral-900 border border-neutral-700 rounded text-xs text-neutral-200 focus:outline-none focus:border-amber-500 font-mono"
            />
            <button
              type="submit"
              disabled={isEmergencyStopped || !manualInput.trim()}
              className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-neutral-950 font-bold rounded text-xs transition"
            >
              Run
            </button>
          </form>
        </div>

        {/* Right: Recognized Command Audit Trail */}
        <div className="p-4 bg-neutral-950 rounded-xl border border-neutral-800 flex flex-col justify-between space-y-3">
          <div>
            <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
              <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
                Recognized Command Log
              </span>
              <span className="text-[10px] font-mono text-neutral-500">
                Safety Validated
              </span>
            </div>

            <div className="mt-2.5 space-y-2 overflow-y-auto max-h-[200px]">
              {micState.commandHistory.map((item) => (
                <div
                  key={item.id}
                  className="p-2 rounded-lg bg-neutral-900 border border-neutral-800 flex items-center justify-between text-xs font-mono"
                >
                  <div className="flex items-center gap-2">
                    {item.status === 'executed' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    ) : (
                      <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                    )}
                    <span className="text-neutral-200 font-bold">"{item.text}"</span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px]">
                    <span className="text-neutral-500">{item.timestamp}</span>
                    <span
                      className={`px-1.5 py-0.2 rounded font-bold ${
                        item.status === 'executed'
                          ? 'bg-emerald-500/10 text-emerald-400'
                          : 'bg-rose-500/10 text-rose-400'
                      }`}
                    >
                      {item.status.toUpperCase()}
                    </span>
                  </div>
                </div>
              ))}

              {micState.commandHistory.length === 0 && (
                <div className="p-4 text-center text-neutral-500 font-mono text-xs">
                  No voice commands processed yet. Speak or click a command above.
                </div>
              )}
            </div>
          </div>

          <div className="pt-2 border-t border-neutral-800/80 text-[10.5px] text-neutral-500 font-mono">
            <strong>Safety Constraint:</strong> All voice commands pass through safety verification and are rejected if the virtual emergency stop is engaged.
          </div>
        </div>
      </div>
    </div>
  );
};
