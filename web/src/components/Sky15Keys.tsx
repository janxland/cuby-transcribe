import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, SlidersHorizontal, X } from "lucide-react";
import { useStore } from "@/store";
import { useStoreShallow, usePrimaryMeta } from "@/selectors";
import { useMixerOptional } from "./mixer";
import { Transport } from "./mixer/Transport";
import { StemsPanel } from "./StemsPanel";
import { PRESETS, playNote, type PresetId } from "./synth";
import { stemMeta } from "@/stems";
import { pitchName } from "@/utils/music";
import { isTypingTarget } from "@/utils/dom";
import type { Note } from "@/types";

// ─────────────────────────────────────────────────────────────
// 25 键布局：15 主键（C4..C6 自然音）+ 10 半音键（C#4..A#5）
// 主键沿用 Sky 光遇 3 行 × 5 列；半音键以小圆形「叠在两主键之间的上沿」。
// 详见根目录《25键键盘映射规范.md》。
// ─────────────────────────────────────────────────────────────

const MAIN_KEYS = [60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 81, 83, 84];
const MAIN_LABELS = ["1", "2", "3", "4", "5", "Q", "W", "E", "R", "T", "A", "S", "D", "F", "G"];
const MAIN_KEY_MAP: Record<string, number> = {
  "1": 0, "2": 1, "3": 2, "4": 3, "5": 4,
  "q": 5, "w": 6, "e": 7, "r": 8, "t": 9,
  "a": 10, "s": 11, "d": 12, "f": 13, "g": 14,
};

interface BlackKey {
  pitch: number;
  /** 行号 0/1/2 = 上 / 中 / 下 */
  row: 0 | 1 | 2;
  /** 横向位置（0..1 内插，0=行最左、1=行最右） */
  x: number;
  /** 提示用 Shift 文本 */
  shiftLabel: string;
  /** Shift+ 该键触发；e.key.toLowerCase() */
  shiftKey: string;
}

/**
 * 行 0 (C4 D4 E4 F4 G4)：C#4 / D#4 / F#4
 * 行 1 (A4 B4 C5 D5 E5)：G#4 / A#4 / C#5 / D#5  ← G#4 是图中"缺一个"的位置
 * 行 2 (F5 G5 A5 B5 C6)：F#5 / G#5 / A#5
 *
 * x 取值：每行 5 个主键中心点位于 0.1 / 0.3 / 0.5 / 0.7 / 0.9，
 * 黑键定位在两主键中点（如 0.2 = C4 与 D4 之间）；
 * G#4 比较特殊，几何上夹在「行 0 末 G4 / 行 1 首 A4」之间——
 * 既然要画在行 1 上方，就贴在 A4 左侧（x=0）。
 *
 * Shift 映射：尽量用「该黑键左侧主键」的字母，少数为避免冲突借用临近字母键。
 */
const BLACK_KEYS: BlackKey[] = [
  { pitch: 61, row: 0, x: 0.20, shiftLabel: "⇧1", shiftKey: "1" }, // C#4
  { pitch: 63, row: 0, x: 0.40, shiftLabel: "⇧2", shiftKey: "2" }, // D#4
  { pitch: 66, row: 0, x: 0.80, shiftLabel: "⇧4", shiftKey: "4" }, // F#4
  { pitch: 68, row: 1, x: 0.00, shiftLabel: "⇧5", shiftKey: "5" }, // G#4 ← 补"缺一个"
  { pitch: 70, row: 1, x: 0.20, shiftLabel: "⇧A", shiftKey: "a" }, // A#4
  { pitch: 73, row: 1, x: 0.60, shiftLabel: "⇧S", shiftKey: "s" }, // C#5（借 S 键）
  { pitch: 75, row: 1, x: 0.80, shiftLabel: "⇧D", shiftKey: "d" }, // D#5（借 D 键）
  { pitch: 78, row: 2, x: 0.20, shiftLabel: "⇧Z", shiftKey: "z" }, // F#5
  { pitch: 80, row: 2, x: 0.40, shiftLabel: "⇧X", shiftKey: "x" }, // G#5
  { pitch: 82, row: 2, x: 0.60, shiftLabel: "⇧C", shiftKey: "c" }, // A#5
];

const SHIFT_KEY_TO_BLACK: Record<string, number> = (() => {
  const m: Record<string, number> = {};
  for (const b of BLACK_KEYS) m[b.shiftKey] = b.pitch;
  return m;
})();

interface SchedNote { time: number; duration: number; pitch: number; stem: string; }

/** 25 键键盘 = score 播放器（多 stem 合流，跟随 mixer 时钟） */
export function Sky15Keys() {
  const { scores, activeStems } = useStoreShallow((s) => ({ scores: s.scores, activeStems: s.activeStems }));
  const toggleActiveStem = useStore((s) => s.toggleActiveStem);
  const primaryMeta = usePrimaryMeta();
  const mixer = useMixerOptional();

  const [presetMap, setPresetMap] = useState<Record<string, PresetId>>({});
  const presetOf = useCallback((stem: string): PresetId => presetMap[stem] ?? "piano", [presetMap]);
  /** 视觉脉冲集合：以 pitch 为 key（覆盖 25 键全部） */
  const [pressed, setPressed] = useState<Set<number>>(new Set());
  const [drawerOpen, setDrawerOpen] = useState(false);

  const stream: SchedNote[] = useMemo(() => {
    const out: SchedNote[] = [];
    for (const stem of activeStems) {
      const ns: Note[] = scores[stem]?.score?.tracks?.[0]?.notes ?? [];
      for (const n of ns) out.push({ time: n.time, duration: n.duration, pitch: n.pitch, stem });
    }
    out.sort((a, b) => a.time - b.time);
    return out;
  }, [activeStems, scores]);

  // 热力图：以 pitch 为索引；25 个键各自计数
  const counts = useMemo(() => {
    const map: Record<number, number> = {};
    for (const n of stream) map[n.pitch] = (map[n.pitch] ?? 0) + 1;
    return map;
  }, [stream]);
  const maxCount = Math.max(1, ...Object.values(counts));

  const playheadTime = mixer?.time ?? 0;
  const followMixer = !!mixer && mixer.playing;
  const autoActive = useMemo(() => {
    const set = new Set<number>();
    if (!followMixer) return set;
    for (const n of stream) {
      if (playheadTime >= n.time && playheadTime < n.time + n.duration) set.add(n.pitch);
    }
    return set;
  }, [stream, playheadTime, followMixer]);

  const fireNote = useCallback((pitch: number, preset: PresetId) => {
    void playNote(preset, pitch);
    setPressed((s) => { const n = new Set(s); n.add(pitch); return n; });
    window.setTimeout(() => {
      setPressed((s) => { const n = new Set(s); n.delete(pitch); return n; });
    }, 180);
  }, []);

  const manualPreset: PresetId = activeStems[0] ? presetOf(activeStems[0]) : "piano";
  const triggerPitch = useCallback(
    (pitch: number) => fireNote(pitch, manualPreset),
    [fireNote, manualPreset],
  );

  // 键盘：纯键 → 主键，Shift+ → 半音键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.repeat) return;
      const k = e.key.toLowerCase();
      if (e.shiftKey) {
        const p = SHIFT_KEY_TO_BLACK[k];
        if (p === undefined) return;
        e.preventDefault();
        triggerPitch(p);
        return;
      }
      const idx = MAIN_KEY_MAP[k];
      if (idx === undefined) return;
      e.preventDefault();
      triggerPitch(MAIN_KEYS[idx]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [triggerPitch]);

  // 自动调度（与 v0.3 相同逻辑）
  const cursorRef = useRef(0);
  const lastTimeRef = useRef(0);
  useEffect(() => {
    const t = mixer?.time ?? 0;
    let i = 0;
    while (i < stream.length && stream[i].time <= t) i++;
    cursorRef.current = i;
    lastTimeRef.current = t;
  }, [stream, mixer?.playing]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!followMixer) return;
    const t = mixer!.time;
    const last = lastTimeRef.current;
    if (t < last || t - last > 0.5) {
      let i = 0;
      while (i < stream.length && stream[i].time <= t) i++;
      cursorRef.current = i;
      lastTimeRef.current = t;
      return;
    }
    if (t > last) {
      let i = cursorRef.current;
      while (i < stream.length && stream[i].time <= t) {
        const n = stream[i];
        if (n.time > last) fireNote(n.pitch, presetOf(n.stem));
        i++;
      }
      cursorRef.current = i;
      lastTimeRef.current = t;
    }
  }, [mixer?.time, followMixer, stream, fireNote, presetOf]);

  const bpm = primaryMeta?.bpm;
  const rows = useMemo(() => [
    MAIN_KEYS.slice(0, 5),
    MAIN_KEYS.slice(5, 10),
    MAIN_KEYS.slice(10, 15),
  ], []);

  return (
    <div className="flex flex-col gap-3">
      {mixer && <Transport bpm={bpm} />}

      <div className="rounded-xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 p-6 space-y-4">
        {/* 演奏轨 chip 行 */}
        <div className="flex items-start gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-slate-500 mt-1.5">演奏轨</span>
          {activeStems.length === 0 ? (
            <span className="text-xs text-slate-500 py-1.5">
              在上方「演奏谱子」或「音轨混音」点击 ✓ / 👁 即可加入；支持多个谱子同时弹奏
            </span>
          ) : (
            activeStems.map((stem, i) => {
              const sm = stemMeta(stem);
              const noteCount = scores[stem]?.score?.tracks?.[0]?.notes?.length ?? 0;
              return (
                <StemPresetChip
                  key={stem}
                  stem={stem}
                  label={sm.label}
                  icon={sm.icon}
                  isPrimary={i === 0}
                  noteCount={noteCount}
                  preset={presetOf(stem)}
                  onPresetChange={(p) => setPresetMap((m) => ({ ...m, [stem]: p }))}
                  onRemove={() => toggleActiveStem(stem)}
                />
              );
            })
          )}
        </div>

        {/* 25 键面板：3 行主键 + 行间穿插的半音键 */}
        <div className="max-w-md mx-auto space-y-7 pt-7">
          {rows.map((rowPitches, rowIdx) => {
            const rowBlacks = BLACK_KEYS.filter((b) => b.row === rowIdx);
            return (
              <div key={rowIdx} className="relative">
                {/* 半音键（绝对定位在该行上方） */}
                {rowBlacks.map((b) => {
                  const lit = autoActive.has(b.pitch) || pressed.has(b.pitch);
                  const cnt = counts[b.pitch] ?? 0;
                  const heat = cnt / maxCount;
                  return (
                    <button
                      key={b.pitch}
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); triggerPitch(b.pitch); }}
                      onTouchStart={(e) => { e.preventDefault(); triggerPitch(b.pitch); }}
                      title={`${pitchName(b.pitch)} (${simpleNumberWithDot(b.pitch)}) · 键盘 ${b.shiftLabel}`}
                      className={[
                        "absolute -top-6 -translate-x-1/2 z-10",
                        "w-9 h-9 rounded-full flex items-center justify-center font-mono",
                        "border-2 transition-all duration-100 select-none cursor-pointer",
                        "focus:outline-none focus:ring-2 focus:ring-cyan-300/60",
                        lit
                          ? "border-amber-200 bg-amber-300 text-slate-900 scale-110 shadow-[0_0_14px_rgba(251,191,36,0.7)]"
                          : "border-cyan-700/70 bg-cyan-950/80 text-cyan-100 hover:border-cyan-300 active:scale-95",
                      ].join(" ")}
                      style={{ left: `${b.x * 100}%` }}
                    >
                      {!lit && (
                        <div
                          className="absolute inset-0 rounded-full bg-cyan-400 pointer-events-none"
                          style={{ opacity: heat * 0.5 }}
                        />
                      )}
                      <span className="relative text-[10px] leading-none">
                        {simpleNumberWithDot(b.pitch)}
                      </span>
                    </button>
                  );
                })}

                {/* 主键行 */}
                <div className="grid grid-cols-5 gap-3">
                  {rowPitches.map((pitch, colIdx) => {
                    const idx = rowIdx * 5 + colIdx;
                    const lit = autoActive.has(pitch) || pressed.has(pitch);
                    const cnt = counts[pitch] ?? 0;
                    const heat = cnt / maxCount;
                    return (
                      <button
                        key={pitch}
                        type="button"
                        onMouseDown={(e) => { e.preventDefault(); triggerPitch(pitch); }}
                        onTouchStart={(e) => { e.preventDefault(); triggerPitch(pitch); }}
                        title={`${pitchName(pitch)} · 键盘 ${MAIN_LABELS[idx]}`}
                        className={[
                          "aspect-square rounded-xl flex flex-col items-center justify-center font-mono",
                          "transition-all duration-100 border-2 relative overflow-hidden select-none cursor-pointer",
                          "focus:outline-none focus:ring-2 focus:ring-indigo-400/60",
                          lit
                            ? "border-amber-300 bg-amber-400 text-slate-900 scale-110 shadow-[0_0_20px_rgba(251,191,36,0.6)]"
                            : "border-slate-700 bg-slate-800/60 text-slate-300 hover:border-slate-500 active:scale-95",
                        ].join(" ")}
                      >
                        {!lit && (
                          <div
                            className="absolute inset-0 bg-indigo-500 pointer-events-none"
                            style={{ opacity: heat * 0.4 }}
                          />
                        )}
                        <span className="relative text-lg font-bold">{MAIN_LABELS[idx]}</span>
                        <span className="relative text-[10px] opacity-70">{pitchName(pitch)}</span>
                        <span className="relative text-[10px] opacity-50 mt-0.5">×{cnt}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="text-[11px] text-slate-500 text-center space-y-0.5">
          <div>
            主键 <Kbd>1-5</Kbd> <Kbd>QWERT</Kbd> <Kbd>ASDFG</Kbd> · 半音键 <Kbd>Shift</Kbd>+ 上方圆形按钮提示字母
          </div>
          <div>按 <Kbd>Space</Kbd> 播放谱子 · 鼠标 / 触屏点击直接弹奏</div>
        </div>
      </div>

      {mixer && (
        <div className="rounded-xl border border-slate-800 bg-slate-950/40 overflow-hidden">
          <button
            onClick={() => setDrawerOpen((v) => !v)}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800/40 transition"
            title={drawerOpen ? "收起混音台" : "拉起混音台，联动对比原音 / 各 stem"}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span className="font-medium">混音控制台</span>
            <span className="text-slate-500">— 拉起后可与 25 键联动播放、A/B 对比</span>
            <span className="ml-auto">
              {drawerOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
            </span>
          </button>
          {drawerOpen && (
            <div className="border-t border-slate-800 h-[420px]">
              <StemsPanel withTransport={false} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── helpers ─────────────────────────────────────────────────

/** MIDI → 简谱（黑键专用，附八度点）：1#·、2#·、4#、5#、6# 等 */
function simpleNumberWithDot(pitch: number): string {
  const PC_TO_NUM: Record<number, string> = { 1: "1#", 3: "2#", 6: "4#", 8: "5#", 10: "6#" };
  const pc = ((pitch % 12) + 12) % 12;
  const base = PC_TO_NUM[pc] ?? "?";
  // C5(72) 起视为高八度，标点
  return pitch >= 72 ? `${base}\u0307` : base;
}

function StemPresetChip({
  stem, label, icon, isPrimary, noteCount, preset, onPresetChange, onRemove,
}: {
  stem: string; label: string; icon: string; isPrimary: boolean; noteCount: number;
  preset: PresetId; onPresetChange: (p: PresetId) => void; onRemove: () => void;
}) {
  return (
    <div
      className={[
        "flex items-center gap-1 px-1.5 py-0.5 rounded-lg border text-xs",
        isPrimary
          ? "bg-amber-400/15 border-amber-400/60"
          : "bg-slate-800/60 border-slate-700",
      ].join(" ")}
      title={`${label} · ${noteCount} 个音符${isPrimary ? "（主显）" : ""}`}
    >
      <span className="px-1">{icon}</span>
      <span className={isPrimary ? "text-amber-100" : "text-slate-200"}>{label}</span>
      <span className="text-[10px] text-slate-500">×{noteCount}</span>
      <select
        value={preset}
        onChange={(e) => onPresetChange(e.target.value as PresetId)}
        onClick={(e) => e.stopPropagation()}
        className="bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-[11px] text-slate-200 focus:outline-none focus:border-indigo-400"
        title="切换音色"
      >
        {PRESETS.map((p) => (
          <option key={p.id} value={p.id}>{p.icon} {p.label}</option>
        ))}
      </select>
      <button
        onClick={onRemove}
        title={`从演奏列表移出 ${label}`}
        className="p-0.5 rounded hover:bg-rose-500/30 text-slate-400 hover:text-rose-100"
      >
        <X className="w-3 h-3" />
      </button>
      <span className="sr-only">{stem}</span>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-block px-1 py-0.5 mx-0.5 rounded bg-slate-800 border border-slate-700 text-[10px] text-slate-300">
      {children}
    </kbd>
  );
}
