import { Play, Pause, Volume2, VolumeX, SkipBack } from "lucide-react";
import { useMixer } from "./useMixer";
import { fmt } from "./utils";

interface Props { bpm?: number; }

export function Transport({ bpm }: Props) {
  const m = useMixer();
  return (
    <div className="bg-slate-950/80 border-b border-slate-800 px-3 py-2 flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-1">
        <button
          onClick={() => m.seek(0)}
          className="w-8 h-8 rounded bg-slate-800 hover:bg-slate-700 flex items-center justify-center"
          title="回到开头 (Home)"
        >
          <SkipBack className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => m.toggle()}
          className="w-10 h-10 rounded-full bg-indigo-600 hover:bg-indigo-500 flex items-center justify-center shadow-md"
          title={m.playing ? "暂停 (Space)" : "播放 (Space)"}
        >
          {m.playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
        </button>
      </div>

      <div className="px-3 py-1.5 rounded bg-slate-900 border border-slate-800 font-mono text-base tabular-nums leading-none">
        <span className="text-indigo-300">{fmt(m.time)}</span>
        <span className="text-slate-600 mx-1">/</span>
        <span className="text-slate-400">{fmt(m.duration)}</span>
      </div>

      {typeof bpm === "number" && Number.isFinite(bpm) && (
        <div className="px-2 py-1 rounded bg-slate-900 border border-slate-800 text-xs text-slate-400">
          BPM <span className="text-slate-200 font-semibold tabular-nums">{bpm.toFixed(0)}</span>
        </div>
      )}

      {m.loading && (
        <div className="px-2 py-1 rounded bg-slate-900 border border-slate-800 text-[11px] text-amber-300">
          解码音频中…
        </div>
      )}

      <div className="flex-1" />

      {/* Master */}
      <div className="flex items-center gap-2 px-2 py-1 rounded bg-slate-900 border border-slate-800">
        <button
          onClick={() => m.toggleMasterMute()}
          title={m.master.muted ? "取消主静音" : "主静音"}
          className={m.master.muted ? "text-rose-400" : "text-slate-300"}
        >
          {m.master.muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </button>
        <span className="text-[10px] text-slate-500 uppercase tracking-wider">Master</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={m.master.volume}
          onChange={(e) => m.setMaster(Number(e.target.value))}
          className="w-28 accent-indigo-500 h-1"
        />
        <span className="text-[10px] tabular-nums text-slate-400 w-8 text-right">
          {Math.round(m.master.volume * 100)}
        </span>
      </div>
    </div>
  );
}
