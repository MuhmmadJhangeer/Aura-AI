import React, { useEffect, useRef } from "react";
import { MyraaAudioSession, LiveState } from "../lib/audio";
import { motion } from "motion/react";

export type MyraaEmotion = 
  | "idle" 
  | "happy" 
  | "excited" 
  | "curious" 
  | "thinking" 
  | "proud" 
  | "sad" 
  | "confused" 
  | "surprised" 
  | "embarrassed" 
  | "playful";

interface MyraaCoreVisualizerProps {
  session: MyraaAudioSession | null;
  state: LiveState;
  themeColor: string;
  activeEmotion?: MyraaEmotion;
  characterState: "idle" | "thinking" | "talking";
}

export const MyraaCoreVisualizer: React.FC<MyraaCoreVisualizerProps> = ({
  session,
  state,
  themeColor,
  activeEmotion = "idle",
  characterState
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | null>(null);
  const speechVolumeRef = useRef<number>(0);

  // Theme matching mapping function
  const getGlowColors = () => {
    switch (themeColor) {
      case "violet":
        return { primary: "rgba(168, 85, 247, 1)", secondary: "rgba(217, 70, 239, 0.8)", glow: "rgba(168, 85, 247, 0.5)" };
      case "crimson":
        return { primary: "rgba(244, 63, 94, 1)", secondary: "rgba(249, 115, 22, 0.8)", glow: "rgba(244, 63, 94, 0.5)" };
      case "emerald":
        return { primary: "rgba(16, 185, 129, 1)", secondary: "rgba(20, 184, 166, 0.8)", glow: "rgba(16, 185, 129, 0.5)" };
      case "celestial":
        return { primary: "rgba(14, 165, 233, 1)", secondary: "rgba(99, 102, 241, 0.8)", glow: "rgba(14, 165, 233, 0.5)" };
      case "gold":
        return { primary: "rgba(245, 158, 11, 1)", secondary: "rgba(234, 179, 8, 0.8)", glow: "rgba(245, 158, 11, 0.5)" };
      case "rose":
        return { primary: "rgba(236, 72, 153, 1)", secondary: "rgba(244, 63, 94, 0.8)", glow: "rgba(236, 72, 153, 0.5)" };
      default:
        return { primary: "rgba(34, 211, 238, 1)", secondary: "rgba(168, 85, 247, 0.8)", glow: "rgba(34, 211, 238, 0.5)" };
    }
  };

  // Canvas render loop for background ambient stardust & audio waves
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = (canvas.width = canvas.offsetWidth);
    let height = (canvas.height = canvas.offsetHeight);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = canvas.offsetWidth;
      height = canvas.height = canvas.offsetHeight;
    };

    window.addEventListener("resize", handleResize);

    const render = () => {
      ctx.clearRect(0, 0, width, height);
      const systemTime = performance.now();
      const colors = getGlowColors();

      // Audio frequency analyzer
      let audioLevel = 0;
      const bufferLength = 64;
      const dataArray = new Uint8Array(bufferLength);
      let activeAnalyser = null;

      if (state === "speaking" && session?.outputAnalyser) {
        activeAnalyser = session.outputAnalyser;
      } else if (state === "listening" && session?.inputAnalyser) {
        activeAnalyser = session.inputAnalyser;
      }

      if (activeAnalyser) {
        try {
          activeAnalyser.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i];
          }
          audioLevel = sum / bufferLength;
        } catch (e) {}
      }

      speechVolumeRef.current += (audioLevel / 255 - speechVolumeRef.current) * 0.2;

      // Draw subtle background audio sine wave ribbon
      ctx.save();
      const waveCount = 2;
      for (let i = 0; i < waveCount; i++) {
        ctx.beginPath();
        ctx.lineWidth = i === 0 ? 2 : 1;
        ctx.strokeStyle = i === 0 ? colors.primary.replace("1)", "0.2") : colors.secondary.replace("0.8)", "0.15");

        const offset = systemTime * (0.0008 + i * 0.0004);
        const amplitude = (10 + i * 6) * (1 + speechVolumeRef.current * 2);
        const frequency = 0.003 + i * 0.001;
        const centerY = height * 0.85;

        for (let x = 0; x < width; x += 6) {
          const y = centerY + Math.sin(x * frequency + offset) * amplitude;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.restore();

      animationRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener("resize", handleResize);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [session, state, themeColor]);

  return (
    <div className="relative w-full h-full flex items-center justify-center overflow-hidden">
      {/* Background Soft Ambient Backlight */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
        <div className="w-[450px] h-[300px] sm:w-[650px] sm:h-[450px] rounded-full blur-[140px] opacity-20 bg-gradient-to-r from-cyan-600 via-purple-600 to-indigo-600" />
      </div>

      {/* Main Modern Soundstage Visualizer Container */}
      <div className="relative z-10 w-full max-w-xl mx-auto px-3 sm:px-4 flex flex-col items-center justify-center space-y-3 sm:space-y-6">
        
        {/* Sleek Modern Audio Spectrum Matrix Card */}
        <div className="w-full p-3.5 sm:p-8 rounded-2xl sm:rounded-3xl bg-slate-950/70 border border-white/10 shadow-[0_0_50px_rgba(34,211,238,0.12)] backdrop-blur-2xl flex flex-col items-center justify-center space-y-3 sm:space-y-6">
          
          {/* Header Status */}
          <div className="flex items-center justify-between w-full border-b border-white/10 pb-2.5 sm:pb-4">
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${
                state === "speaking"
                  ? "bg-purple-400 animate-ping"
                  : state === "listening"
                  ? "bg-cyan-400 animate-pulse"
                  : state === "connecting"
                  ? "bg-amber-400 animate-bounce"
                  : "bg-slate-500"
              }`} />
              <span className="text-xs font-mono font-semibold uppercase tracking-widest text-slate-300">
                {state === "speaking"
                  ? "Aura Speaking"
                  : state === "listening"
                  ? "Listening to Voice"
                  : state === "connecting"
                  ? "Connecting Core"
                  : "Standby Mode"}
              </span>
            </div>
          </div>

          {/* Dynamic Frequency Equalizer Spectrum Bars */}
          <div className="w-full flex items-center justify-center gap-1.5 sm:gap-2 h-16 sm:h-36 py-1 sm:py-2 px-1">
            {Array.from({ length: 24 }).map((_, idx) => {
              // Calculate lively bar height
              const centerDist = Math.abs(idx - 11.5) / 11.5;
              const weight = 1 - centerDist * 0.4;
              
              let heightPct = 15;
              if (state === "speaking") {
                heightPct = 25 + Math.abs(Math.sin(Date.now() * 0.008 + idx * 0.4)) * 70 * weight;
              } else if (state === "listening") {
                heightPct = 20 + Math.abs(Math.sin(Date.now() * 0.005 + idx * 0.3)) * 50 * weight;
              } else if (state === "connecting") {
                heightPct = 20 + Math.abs(Math.sin(Date.now() * 0.003 + idx * 0.5)) * 25;
              } else {
                heightPct = 12 + Math.sin(idx * 0.5) * 6;
              }

              return (
                <motion.div
                  key={idx}
                  className={`w-1.5 sm:w-2 rounded-full transition-all duration-150 ${
                    state === "speaking"
                      ? "bg-gradient-to-t from-purple-600 via-pink-500 to-cyan-300 shadow-[0_0_10px_rgba(168,85,247,0.5)]"
                      : state === "listening"
                      ? "bg-gradient-to-t from-cyan-600 via-teal-400 to-emerald-300 shadow-[0_0_10px_rgba(34,211,238,0.5)]"
                      : "bg-white/10"
                  }`}
                  style={{ height: `${Math.min(100, Math.max(8, heightPct))}%` }}
                />
              );
            })}
          </div>

        </div>

      </div>

      {/* Background Interactive Canvas */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none z-0"
      />
    </div>
  );
};
