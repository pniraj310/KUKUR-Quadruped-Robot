import React, { useState } from 'react';
import { Bot, Send, Sparkles, Loader2, RefreshCw, MessageSquare } from 'lucide-react';
import { SensorData } from '../types/robot';

interface AiRoboticsCopilotProps {
  sensors: SensorData;
  activeGait: string;
}

export const AiRoboticsCopilot: React.FC<AiRoboticsCopilotProps> = ({ sensors, activeGait }) => {
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; text: string }>>([
    {
      role: 'assistant',
      text: "Hello! I am your SpotMicroAI Robotics & RL Copilot. I can help you with PyBullet/Gazebo training, custom PPO reward functions, 12-DOF kinematics calculations, and Raspberry Pi 4 (2018) hardware wiring & calibration. What would you like to explore?",
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const quickPrompts = [
    'How do I eliminate MG996R servo jitter on PCA9685?',
    'Design a PPO reward function for climbing steep steps in PyBullet',
    'How to wire HC-SR04 ultrasonic sensor safely to Pi 4 GPIO?',
    'Explain 12-DOF Inverse Kinematics math for SpotMicro',
  ];

  const handleSend = async (textToSend?: string) => {
    const prompt = (textToSend || input).trim();
    if (!prompt || loading) return;

    const userMessage = { role: 'user' as const, text: prompt };
    setMessages((prev) => [...prev, userMessage]);
    if (!textToSend) setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/gemini/robot-assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          context: {
            activeGait,
            ultrasonicDistanceCm: sensors.ultrasonicDistanceCm,
            imu: sensors.imu,
            batteryVoltage: sensors.batteryVoltage,
            footContacts: sensors.footContacts,
          },
        }),
      });

      const data = await res.json();
      if (data.text) {
        setMessages((prev) => [...prev, { role: 'assistant', text: data.text }]);
      } else if (data.error) {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', text: `Error: ${data.error}` },
        ]);
      }
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: `Failed to contact AI Copilot: ${err.message}` },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-neutral-950 border-b border-neutral-800">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-amber-400" />
          <span className="text-sm font-semibold text-neutral-100">
            SpotMicro AI Robotics Copilot
          </span>
          <span className="text-[11px] px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20 font-mono">
            Powered by Gemini
          </span>
        </div>
        <div className="text-xs text-neutral-400 font-mono">
          Tele: {sensors.ultrasonicDistanceCm}cm | Roll: {sensors.imu.roll}° | Pitch: {sensors.imu.pitch}°
        </div>
      </div>

      {/* Quick Prompts Bar */}
      <div className="flex items-center gap-2 px-4 py-2 bg-neutral-950/70 border-b border-neutral-800/80 overflow-x-auto text-xs no-scrollbar">
        <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
        <span className="text-neutral-500 shrink-0 font-medium text-[11px]">Quick:</span>
        {quickPrompts.map((q, idx) => (
          <button
            key={idx}
            onClick={() => handleSend(q)}
            disabled={loading}
            className="shrink-0 px-2.5 py-1 rounded-full bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-[11px] border border-neutral-700 transition cursor-pointer"
          >
            {q}
          </button>
        ))}
      </div>

      {/* Message Chat Stream */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs font-sans">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-xl px-4 py-3 leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-amber-500 text-neutral-950 font-medium'
                  : 'bg-neutral-950 border border-neutral-800 text-neutral-200 shadow-sm'
              }`}
            >
              <div className="font-semibold text-[10px] uppercase tracking-wider mb-1 opacity-70">
                {msg.role === 'user' ? 'You' : 'SpotMicro AI Expert'}
              </div>
              <div className="whitespace-pre-wrap font-mono text-[11.5px] leading-relaxed">
                {msg.text}
              </div>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2.5 flex items-center gap-2 text-neutral-400 text-xs">
              <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
              <span>Analyzing SpotMicro kinematics and generating solution...</span>
            </div>
          </div>
        )}
      </div>

      {/* Input bar */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
        className="p-3 bg-neutral-950 border-t border-neutral-800 flex items-center gap-2"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about PyBullet RL rewards, Pi 4 GPIO wiring, servo calibration, or SpotMicro kinematics..."
          className="flex-1 px-3 py-2 bg-neutral-900 border border-neutral-800 rounded-lg text-neutral-200 text-xs focus:outline-none focus:border-amber-500 transition"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="px-4 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-neutral-950 font-semibold rounded-lg text-xs flex items-center gap-1.5 transition"
        >
          <Send className="w-3.5 h-3.5" />
          Send
        </button>
      </form>
    </div>
  );
};
