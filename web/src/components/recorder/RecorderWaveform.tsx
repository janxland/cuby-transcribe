import { AudioWaveform } from "lucide-react";
import type { RecorderStatus } from "./types";

interface RecorderWaveformProps {
  waveform: number[];
  level: number;
  status: RecorderStatus;
}

export function RecorderWaveform({ waveform, level, status }: RecorderWaveformProps) {
  const active = status === "recording";
  const ready = status === "ready";

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-slate-500">
          <AudioWaveform className="w-3.5 h-3.5" />
          <span>输入电平</span>
        </div>
        <div className="h-1.5 w-20 rounded-full bg-slate-800 overflow-hidden">
          <div
            className={[
              "h-full transition-all",
              active ? "bg-rose-400" : ready ? "bg-emerald-400" : "bg-slate-600",
            ].join(" ")}
            style={{ width: `${Math.round(level * 100)}%` }}
          />
        </div>
      </div>
      <div className="h-14 flex items-center gap-1 overflow-hidden">
        {waveform.map((value, index) => {
          const height = Math.max(8, Math.round(value * 48));
          return (
            <div
              key={index}
              className={[
                "flex-1 rounded-full transition-[height,background-color] duration-150",
                active ? "bg-rose-400/80" : ready ? "bg-emerald-400/70" : "bg-slate-700",
              ].join(" ")}
              style={{ height }}
            />
          );
        })}
      </div>
    </div>
  );
}
