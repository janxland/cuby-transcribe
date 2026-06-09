import { useMemo, useState } from "react";
import type { CleanupOptions, CleanupStats } from "./cleanup";

export interface CleanupForm extends Required<Omit<CleanupOptions, "bpm">> {
  bpm: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  cleanup: CleanupForm;
  onCleanupChange: (next: CleanupForm) => void;
  onApplyCleanupCurrent: () => CleanupStats | null;
  onApplyCleanupAllTracks: () => CleanupStats[];
  onReduceToTwoTracks: () => void;
  onTransposeTrack: (semitones: number) => void;
  onStretchTrack: (factor: number, selectionOnly: boolean) => void;
  onSeek: (seconds: number) => void;
  onPlayFrom: (seconds: number) => void;
  currentPlayheadSec: number;
}

export function AssistPanel(props: Props) {
  const {
    open,
    onClose,
    cleanup,
    onCleanupChange,
    onApplyCleanupCurrent,
    onApplyCleanupAllTracks,
    onReduceToTwoTracks,
    onTransposeTrack,
    onStretchTrack,
    onSeek,
    onPlayFrom,
    currentPlayheadSec,
  } = props;

  const [seekInput, setSeekInput] = useState("0");
  const [stretchInput, setStretchInput] = useState("1.00");
  const [transposeInput, setTransposeInput] = useState("12");
  const [lastCleanupSummary, setLastCleanupSummary] = useState("");

  const cleanupHint = useMemo(() => {
    const minDurSec = (60 / Math.max(30, cleanup.bpm || 120)) * (4 / cleanup.minDivision);
    return `当前阈值: 小于 ${minDurSec.toFixed(3)}s 的音符会被视为过短音`;
  }, [cleanup]);

  if (!open) return null;

  return (
    <div className="border-b border-slate-800 bg-slate-900/80 px-3 py-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-slate-100">专业 MIDI 编辑设置</div>
        <button onClick={onClose} className="text-xs text-slate-400 hover:text-slate-200">关闭</button>
      </div>

      <section className="rounded-lg border border-slate-800 bg-slate-950/40 p-3 space-y-2">
        <div className="text-xs text-slate-300 font-medium">1) 可定制精简（点击后不自动执行）</div>
        <div className="grid grid-cols-5 gap-2 text-xs">
          <LabelInput label="BPM" value={String(cleanup.bpm)} onChange={(v) => onCleanupChange({ ...cleanup, bpm: clampNum(v, 30, 280, cleanup.bpm) })} />
          <div>
            <div className="text-slate-500 mb-1">最小时值</div>
            <select
              value={cleanup.minDivision}
              onChange={(e) => onCleanupChange({ ...cleanup, minDivision: Number(e.target.value) as 16 | 32 | 64 })}
              className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1"
            >
              <option value={16}>1/16</option>
              <option value={32}>1/32</option>
              <option value={64}>1/64</option>
            </select>
          </div>
          <LabelInput label="最低音高" value={String(cleanup.pitchMin)} onChange={(v) => onCleanupChange({ ...cleanup, pitchMin: clampNum(v, 0, 127, cleanup.pitchMin) })} />
          <LabelInput label="最高音高" value={String(cleanup.pitchMax)} onChange={(v) => onCleanupChange({ ...cleanup, pitchMax: clampNum(v, 0, 127, cleanup.pitchMax) })} />
          <LabelInput label="去重窗口(s)" value={String(cleanup.dedupeWindowSec)} onChange={(v) => onCleanupChange({ ...cleanup, dedupeWindowSec: clampFloat(v, 0.005, 0.2, cleanup.dedupeWindowSec) })} />
        </div>
        <div className="grid grid-cols-5 gap-2 text-xs">
          <LabelInput label="合并间隙(s)" value={String(cleanup.mergeGapSec)} onChange={(v) => onCleanupChange({ ...cleanup, mergeGapSec: clampFloat(v, 0, 0.2, cleanup.mergeGapSec) })} />
          <div className="col-span-4 flex items-end gap-2">
            <button
              onClick={() => {
                const stats = onApplyCleanupCurrent();
                if (!stats) return;
                setLastCleanupSummary(formatSummary("当前轨", stats));
              }}
              className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white"
            >
              应用到当前轨
            </button>
            <button
              onClick={() => {
                const stats = onApplyCleanupAllTracks();
                if (!stats.length) return;
                const total = stats.reduce((acc, s) => ({
                  before: acc.before + s.before,
                  after: acc.after + s.after,
                  removedShort: acc.removedShort + s.removedShort,
                  removedOutOfRange: acc.removedOutOfRange + s.removedOutOfRange,
                  removedDuplicate: acc.removedDuplicate + s.removedDuplicate,
                  mergedPairs: acc.mergedPairs + s.mergedPairs,
                }), { before: 0, after: 0, removedShort: 0, removedOutOfRange: 0, removedDuplicate: 0, mergedPairs: 0 });
                setLastCleanupSummary(formatSummary(`全轨(${stats.length})`, total));
              }}
              className="px-3 py-1.5 rounded border border-slate-700 hover:border-slate-500 text-slate-100"
            >
              应用到全轨
            </button>
            <button
              onClick={onReduceToTwoTracks}
              className="px-3 py-1.5 rounded border border-amber-600/60 hover:border-amber-400 text-amber-200"
            >
              2轨化（主+辅）
            </button>
          </div>
        </div>
        <div className="text-[11px] text-slate-500">{cleanupHint}</div>
        {lastCleanupSummary && <div className="text-[11px] text-emerald-300">{lastCleanupSummary}</div>}
      </section>

      <section className="rounded-lg border border-slate-800 bg-slate-950/40 p-3 space-y-2">
        <div className="text-xs text-slate-300 font-medium">2) 轨道音区提升</div>
        <div className="flex items-center gap-2 text-xs">
          <button onClick={() => onTransposeTrack(12)} className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700">+12 半音（升八度）</button>
          <button onClick={() => onTransposeTrack(-12)} className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700">-12 半音（降八度）</button>
          <input
            value={transposeInput}
            onChange={(e) => setTransposeInput(e.target.value)}
            className="w-20 bg-slate-900 border border-slate-700 rounded px-2 py-1"
          />
          <button
            onClick={() => onTransposeTrack(Math.round(clampNum(transposeInput, -48, 48, 0)))}
            className="px-3 py-1.5 rounded border border-slate-700 hover:border-slate-500"
          >
            应用半音偏移
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-slate-800 bg-slate-950/40 p-3 space-y-2">
        <div className="text-xs text-slate-300 font-medium">3) 曲谱时间拉伸（不改音高）</div>
        <div className="flex items-center gap-2 text-xs">
          <input
            value={stretchInput}
            onChange={(e) => setStretchInput(e.target.value)}
            className="w-24 bg-slate-900 border border-slate-700 rounded px-2 py-1"
          />
          <button
            onClick={() => onStretchTrack(clampFloat(stretchInput, 0.25, 4, 1), true)}
            className="px-3 py-1.5 rounded border border-slate-700 hover:border-slate-500"
          >
            拉伸选区
          </button>
          <button
            onClick={() => onStretchTrack(clampFloat(stretchInput, 0.25, 4, 1), false)}
            className="px-3 py-1.5 rounded border border-slate-700 hover:border-slate-500"
          >
            拉伸当前轨
          </button>
          <span className="text-slate-500">示例：0.80=压缩 20%，1.25=拉长 25%</span>
        </div>
      </section>

      <section className="rounded-lg border border-slate-800 bg-slate-950/40 p-3 space-y-2">
        <div className="text-xs text-slate-300 font-medium">4) 设置播放位置</div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-500">当前</span>
          <span className="font-mono text-slate-200">{currentPlayheadSec.toFixed(2)}s</span>
          <input
            value={seekInput}
            onChange={(e) => setSeekInput(e.target.value)}
            placeholder="秒"
            className="w-28 bg-slate-900 border border-slate-700 rounded px-2 py-1"
          />
          <button
            onClick={() => onSeek(clampFloat(seekInput, 0, 60 * 60, 0))}
            className="px-3 py-1.5 rounded border border-slate-700 hover:border-slate-500"
          >
            定位
          </button>
          <button
            onClick={() => onPlayFrom(clampFloat(seekInput, 0, 60 * 60, 0))}
            className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white"
          >
            从此播放
          </button>
        </div>
      </section>
    </div>
  );
}

function LabelInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <div className="text-slate-500 mb-1">{label}</div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1"
      />
    </div>
  );
}

function clampNum(input: string, min: number, max: number, fallback: number): number {
  const n = Number(input);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function clampFloat(input: string, min: number, max: number, fallback: number): number {
  const n = Number(input);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function formatSummary(scope: string, stats: CleanupStats): string {
  return `${scope}: ${stats.before} -> ${stats.after}，短音-${stats.removedShort}，越界-${stats.removedOutOfRange}，去重-${stats.removedDuplicate}，合并+${stats.mergedPairs}`;
}
