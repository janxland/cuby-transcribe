import { useEffect, useMemo, useState } from "react";
import { Loader2, CheckCircle2, XCircle, Download } from "lucide-react";
import { useStore } from "@/store";
import { usePrimaryMeta, usePrimaryScore } from "@/selectors";
import { stemMeta } from "@/stems";
import { downloadMidi } from "@/utils/midiExporter";
import type { CubyScore } from "@/types";

function downloadTrackMidi(score: CubyScore, trackIdx: number) {
  const track = score.tracks[trackIdx];
  if (!track) return;
  const safeName = (score.meta.title || "cuby").replace(/[^\w.\-]+/g, "_");
  const safeTk = (track.name || track.id || `track_${trackIdx + 1}`).replace(/[^\w.\-]+/g, "_");
  downloadMidi(score, `${safeName}_${safeTk}.mid`, "multi", { trackIndices: [trackIdx] });
}

function trackDisplayName(stem: string, trackName: string, trackCount: number): string {
  const source = stemMeta(stem).label;
  const cleanTrack = (trackName || "Track").trim();
  if (!stem || stem === "midi") return cleanTrack;
  if (trackCount <= 1 && cleanTrack.toLowerCase() === stem.toLowerCase()) return source;
  if (cleanTrack.includes(source) || cleanTrack.includes(stem)) return cleanTrack;
  return `${source} · ${cleanTrack}`;
}

export function ProgressCard() {
  const task = useStore((s) => s.task);
  const cancelCurrentTask = useStore((s) => s.cancelCurrentTask);
  const meta = usePrimaryMeta();
  const score = usePrimaryScore();
  const scores = useStore((s) => s.scores);
  const taskResult = task?.result;
  const [selectedTrackIndices, setSelectedTrackIndices] = useState<number[]>([]);

  const exportScore = useMemo<CubyScore | null>(() => {
    const entries = Object.entries(scores);
    if (entries.length > 0) {
      const base = entries[0]?.[1].score ?? taskResult ?? score;
      if (!base) return null;
      const tracks = entries.flatMap(([stem, entry], entryIdx) => {
        const sourceTracks = entry.score.tracks ?? [];
        return sourceTracks.flatMap((track, trackIdx) => {
          if (!track || !track.notes?.length) return [];
          const name = trackDisplayName(stem, track.name || track.id, sourceTracks.length);
          return [{
            ...track,
            id: `export_${entryIdx}_${trackIdx}_${track.id || "track"}`,
            name,
          }];
        });
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

  const exportTrackKey = useMemo(
    () => exportScore?.tracks.map((track, idx) => `${idx}:${track.id}:${track.notes.length}`).join("|") ?? "",
    [exportScore],
  );
  const allTrackIndices = useMemo(
    () => exportScore?.tracks.map((_track, idx) => idx) ?? [],
    [exportTrackKey, exportScore],
  );
  const selectedSet = useMemo(() => new Set(selectedTrackIndices), [selectedTrackIndices]);
  const selectedCount = selectedTrackIndices.filter((idx) => Boolean(exportScore?.tracks[idx])).length;

  useEffect(() => {
    setSelectedTrackIndices(allTrackIndices);
  }, [allTrackIndices]);

  const toggleTrack = (trackIdx: number) => {
    setSelectedTrackIndices((prev) => {
      const next = new Set(prev);
      if (next.has(trackIdx)) next.delete(trackIdx);
      else next.add(trackIdx);
      return allTrackIndices.filter((idx) => next.has(idx));
    });
  };

  const selectedFilename = (mode: "multi" | "single") => {
    const safeName = (exportScore?.meta.title || "cuby").replace(/[^\w.\-]+/g, "_");
    const suffix = mode === "single" ? "selected_single" : "selected_tracks";
    return `${safeName}_${suffix}.mid`;
  };

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
                  disabled={selectedCount === 0}
                  onClick={() => downloadMidi(
                    exportScore,
                    selectedFilename("multi"),
                    "multi",
                    { trackIndices: selectedTrackIndices },
                  )}
                  className="flex-1 py-2 rounded-lg bg-emerald-600/90 hover:bg-emerald-500 text-white text-sm font-medium flex items-center justify-center gap-2 transition"
                >
                  <Download className="w-4 h-4" />
                  导出选中 MIDI（{selectedCount} 轨）
                </button>
                <button
                  disabled={selectedCount === 0}
                  onClick={() => downloadMidi(
                    exportScore,
                    selectedFilename("single"),
                    "single",
                    { trackIndices: selectedTrackIndices },
                  )}
                  title="选中轨道合并为单轨 MIDI"
                  className="px-3 py-2 rounded-lg border border-slate-700 hover:border-slate-500 text-slate-300 text-xs flex items-center gap-1.5 transition"
                >
                  <Download className="w-3.5 h-3.5" />
                  合并单轨
                </button>
              </div>
              {/* 逐轨下载（多轨时展示） */}
              {exportScore.tracks.length > 1 && (
                <div className="rounded-lg border border-slate-800 bg-slate-950/60 divide-y divide-slate-800/60">
                  <div className="flex items-center gap-2 px-3 py-2">
                    <span className="text-[10px] uppercase tracking-wider text-slate-500">下载轨道</span>
                    <button
                      onClick={() => setSelectedTrackIndices(allTrackIndices)}
                      className="ml-auto px-2 py-1 rounded border border-slate-700 hover:border-emerald-500 text-slate-300 text-xs transition"
                    >
                      全选
                    </button>
                    <button
                      onClick={() => setSelectedTrackIndices([])}
                      className="px-2 py-1 rounded border border-slate-700 hover:border-slate-500 text-slate-300 text-xs transition"
                    >
                      清空
                    </button>
                  </div>
                  {exportScore.tracks.map((track, idx) => (
                    <div key={track.id} className="flex items-center justify-between px-3 py-1.5 gap-2">
                      <label className="min-w-0 flex-1 flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedSet.has(idx)}
                          onChange={() => toggleTrack(idx)}
                          className="h-3.5 w-3.5 accent-emerald-500 shrink-0"
                        />
                        <span className="text-xs text-slate-300 truncate">
                          {track.name || track.instrument || track.id}
                        </span>
                      </label>
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
