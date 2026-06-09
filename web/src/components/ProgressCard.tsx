import { useMemo } from "react";
import { Loader2, CheckCircle2, XCircle, Download } from "lucide-react";
import { useStore } from "@/store";
import { usePrimaryMeta, usePrimaryScore } from "@/selectors";
import { downloadMidi, buildMidi } from "@/utils/midiExporter";
import type { CubyScore } from "@/types";

function downloadTrackMidi(score: CubyScore, trackIdx: number) {
  const track = score.tracks[trackIdx];
  if (!track) return;
  const single: CubyScore = { ...score, tracks: [track] };
  const data = buildMidi(single, "multi");
  const ab = new ArrayBuffer(data.byteLength);
  new Uint8Array(ab).set(data);
  const blob = new Blob([ab], { type: "audio/midi" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const safeName = (score.meta.title || "cuby").replace(/[^\w.\-]+/g, "_");
  const safeTk = track.name.replace(/[^\w.\-]+/g, "_");
  a.download = `${safeName}_${safeTk}.mid`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ProgressCard() {
  const task = useStore((s) => s.task);
  const cancelCurrentTask = useStore((s) => s.cancelCurrentTask);
  const meta = usePrimaryMeta();
  const score = usePrimaryScore();
  const scores = useStore((s) => s.scores);
  const taskResult = task?.result;

  const exportScore = useMemo<CubyScore | null>(() => {
    const entries = Object.values(scores);
    if (entries.length > 0) {
      const base = entries[0]?.score ?? taskResult ?? score;
      if (!base) return null;
      const tracks = entries.flatMap((entry, idx) => {
        const head = entry.score.tracks[0];
        if (!head || !head.notes?.length) return [];
        return [{
          ...head,
          id: `export_${idx}_${head.id || "track"}`,
        }];
      });
      if (tracks.length > 0) {
        return {
          ...base,
          tracks,
        };
      }
    }
    return taskResult ?? score;
  }, [scores, taskResult, score]);

  if (!task) return null;

  const Icon =
    task.status === "completed" ? CheckCircle2 :
    task.status === "failed" ? XCircle :
    task.status === "canceled" ? XCircle : Loader2;
  const color =
    task.status === "completed" ? "text-emerald-400" :
    task.status === "failed" ? "text-rose-400" :
    task.status === "canceled" ? "text-amber-400" : "text-indigo-400";
  const spin = task.status !== "completed" && task.status !== "failed" && task.status !== "canceled";
  const canCancel = task.status === "queued" || task.status === "processing";

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Icon className={`w-5 h-5 ${color} ${spin ? "animate-spin" : ""}`} />
        <span className="font-medium capitalize">{task.status}</span>
        <span className="text-slate-400 text-sm">{task.message}</span>
        {canCancel && (
          <button
            onClick={() => void cancelCurrentTask()}
            className="ml-auto px-2.5 py-1 rounded border border-rose-500/60 text-rose-300 hover:bg-rose-500/10 text-xs transition"
            title="终止当前任务并释放后台占用"
          >
            终止任务
          </button>
        )}
      </div>
      <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all"
          style={{ width: `${task.progress}%` }}
        />
      </div>
      {task.error && (
        <div className="text-rose-400 text-xs font-mono break-all">{task.error}</div>
      )}
      {meta && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 pt-2 text-xs">
            <Stat label="调性" value={`${meta.detectedKey} ${meta.detectedMode}`} />
            <Stat
              label="BPM"
              value={`${meta.bpm.toFixed(1)}${
                meta.tempoSource === "user"
                  ? "（手动）"
                  : meta.tempoSource === "refined"
                    ? "（自动纠偏）"
                    : "（自动）"
              }`}
            />
            <Stat label="时长" value={`${meta.duration.toFixed(1)}s`} />
            <Stat label="音符" value={meta.noteCount} />
            <Stat label="耗时" value={`${meta.elapsed.toFixed(1)}s`} />
          </div>

          {/* 导出 MIDI */}
          {task.status === "completed" && exportScore && (
            <div className="space-y-1.5 pt-1">
              {/* 全局导出 */}
              <div className="flex gap-2">
                <button
                  onClick={() => downloadMidi(exportScore, undefined, "multi")}
                  className="flex-1 py-2 rounded-lg bg-emerald-600/90 hover:bg-emerald-500 text-white text-sm font-medium flex items-center justify-center gap-2 transition"
                >
                  <Download className="w-4 h-4" />
                  导出 MIDI（多轨保真）
                </button>
                <button
                  onClick={() => downloadMidi(exportScore, undefined, "single")}
                  title="所有轨合并为单轨 MIDI"
                  className="px-3 py-2 rounded-lg border border-slate-700 hover:border-slate-500 text-slate-300 text-xs flex items-center gap-1.5 transition"
                >
                  <Download className="w-3.5 h-3.5" />
                  单轨
                </button>
              </div>
              {/* 逐轨下载（多轨时展示） */}
              {exportScore.tracks.length > 1 && (
                <div className="rounded-lg border border-slate-800 bg-slate-950/60 divide-y divide-slate-800/60">
                  {exportScore.tracks.map((track, idx) => (
                    <div key={track.id} className="flex items-center justify-between px-3 py-1.5 gap-2">
                      <span className="text-xs text-slate-300 truncate flex-1">
                        {track.instrument || track.name}
                      </span>
                      <span className="text-[10px] text-slate-500 shrink-0">
                        {track.notes.length} 音符
                      </span>
                      <button
                        onClick={() => downloadTrackMidi(exportScore, idx)}
                        title={`下载 ${track.name} 的 MIDI`}
                        className="shrink-0 px-2 py-1 rounded border border-slate-700 hover:border-emerald-500 hover:text-emerald-300 text-slate-400 text-xs flex items-center gap-1 transition"
                      >
                        <Download className="w-3 h-3" />
                        下载
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {(meta.recommendedShift != null || meta.melodyAlgo || meta.arrangementMode || meta.fidelityMode) && (
            <div className="grid grid-cols-2 gap-3 text-xs">
              {meta.fidelityMode === "raw" && (
                <Stat
                  label="模式"
                  value={
                    <span className="text-emerald-300">
                      100% 保真
                      {meta.perStemAlgo
                        ? ` · ${Object.keys(meta.perStemAlgo).length} 轨`
                        : ""}
                    </span>
                  }
                />
              )}
              {meta.fidelityMode !== "raw" && meta.arrangementMode && (
                <Stat
                  label="编配"
                  value={
                    <span>
                      {meta.arrangementMode === "polyphonic" ? "复音 · 保留和弦" : "单音 · 仅主旋律"}
                      {meta.maxConcurrent != null && meta.arrangementMode === "polyphonic"
                        ? ` · 峰值 ${meta.maxConcurrent} 指`
                        : ""}
                    </span>
                  }
                />
              )}
              {meta.melodyAlgo && (
                <Stat
                  label="算法"
                  value={
                    meta.melodyAlgo === "pyin"
                      ? "PYIN 单音"
                      : meta.melodyAlgo.startsWith("basic_pitch")
                        ? `Basic Pitch${meta.melodyAlgo.includes("skyline") ? " + skyline" : ""}`
                        : meta.melodyAlgo
                  }
                />
              )}
              {meta.recommendedShift != null && (
                <Stat
                  label="推荐升降调键"
                  value={
                    <span className="text-amber-300">
                      {meta.recommendedShift > 0 ? `+${meta.recommendedShift}` : meta.recommendedShift}
                      {meta.playableKey ? ` · ${meta.playableKey}` : ""}
                    </span>
                  }
                />
              )}
              {meta.chords && meta.chords.length > 0 && (
                <Stat
                  label={`和弦 (${meta.chords.length})`}
                  value={
                    <span className="text-emerald-300 break-all">
                      {meta.chords.slice(0, 8).map((c) => c.label).join(" → ")}
                      {meta.chords.length > 8 ? " …" : ""}
                    </span>
                  }
                />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded-lg bg-slate-800/60 px-3 py-2">
      <div className="text-slate-500">{label}</div>
      <div className="text-slate-100 font-mono break-all">{value}</div>
    </div>
  );
}
