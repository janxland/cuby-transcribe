/**
 * MIDI 模式下的播放条：直接控 toneClock，与 mixer 解耦。
 * 视觉与 mixer/Transport 保持一致，但去掉了"主静音 / 解码中"等 mixer 专属信息。
 */
import { Play, Pause, SkipBack } from "lucide-react";
import { toneClock } from "@/utils/toneClock";
import { useToneClockState } from "@/hooks/useToneClock";

interface Props { bpm?: number; }

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function ToneTransport({ bpm }: Props) {
  const s = useToneClockState();
  return (
    <div className="bg-slate-950/80 border-b border-slate-800 px-3 py-2 flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-1">
        <button
          onClick={() => toneClock.seek(0)}
          className="w-8 h-8 rounded bg-slate-800 hover:bg-slate-700 flex items-center justify-center"
          title="回到开头"
        >
          <SkipBack className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => toneClock.toggle()}
          className="w-10 h-10 rounded-full bg-indigo-600 hover:bg-indigo-500 flex items-center justify-center shadow-md"
          title={s.playing ? "暂停 (Space)" : "播放 (Space)"}
        >
          {s.playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
        </button>
      </div>

      <div className="px-3 py-1.5 rounded bg-slate-900 border border-slate-800 font-mono text-base tabular-nums leading-none">
        <span className="text-indigo-300">{fmt(s.time)}</span>
        <span className="text-slate-600 mx-1">/</span>
        <span className="text-slate-400">{fmt(s.duration)}</span>
      </div>

      {typeof bpm === "number" && Number.isFinite(bpm) && (
        <div className="px-2 py-1 rounded bg-slate-900 border border-slate-800 text-xs text-slate-400">
          BPM <span className="text-slate-200 font-semibold tabular-nums">{bpm.toFixed(0)}</span>
        </div>
      )}

      <div className="px-2 py-1 rounded bg-emerald-900/40 border border-emerald-800 text-[11px] text-emerald-300">
        MIDI · Tone.js
      </div>
    </div>
  );
}
