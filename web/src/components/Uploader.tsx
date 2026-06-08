/**
 * 上传面板 v5 · 流行音乐场景化重设计
 *
 * 设计原则（用户反馈）：
 *  - 流行音乐扒谱实际只需要「人声 vs 伴奏」两个轴；分离 drums/bass/piano/guitar 的需求极少
 *  - 100% 保真：不再展示「转 C 调 / 简化 / 量化网格 / 最佳可弹奏调 / 同按上限」等驯化开关
 *  - UI 收敛为 4 个核心模式（单选）+ 一个上传区 + 一个开始按钮
 */
import { useRef, useState, useMemo } from "react";
import { Upload, Music, X, FileMusic, Mic2, Music2, Layers, SlidersHorizontal } from "lucide-react";
import { useStore } from "@/store";
import type { UploadOptions } from "@/types";
import { STEM_REGISTRY, type StemName } from "@/stems";

type Mode = "full" | "vocals" | "instrumental" | "dual";

interface ModeDef {
  id: Mode;
  title: string;
  hint: string;
  icon: typeof FileMusic;
  recommended?: boolean;
  /** 派生为 UploadOptions 的部分字段 */
  toOptions: () => Partial<UploadOptions>;
}

const MODES: ModeDef[] = [
  {
    id: "dual",
    title: "人声 + 伴奏 双轨",
    hint: "推荐 · 分离后两条都扒：人声单音旋律 + 伴奏复音和声",
    icon: Layers,
    recommended: true,
    toOptions: () => ({
      fidelityMode: "raw",
      separationMode: "vocals",
      stems: ["vocals", "no_vocals"],
      transcribeStem: "vocals",
    }),
  },
  {
    id: "vocals",
    title: "仅扒人声主旋律",
    hint: "分离后只扒人声轨，PYIN 单音 → 干净的主旋律线",
    icon: Mic2,
    toOptions: () => ({
      fidelityMode: "raw",
      separationMode: "vocals",
      stems: ["vocals"],
      transcribeStem: "vocals",
    }),
  },
  {
    id: "instrumental",
    title: "仅扒伴奏",
    hint: "分离后只扒伴奏轨，Basic Pitch 复音 → 全乐器和声",
    icon: Music2,
    toOptions: () => ({
      fidelityMode: "raw",
      separationMode: "vocals",
      stems: ["no_vocals"],
      transcribeStem: "no_vocals",
    }),
  },
  {
    id: "full",
    title: "整曲扒谱（不分离）",
    hint: "最快 · Basic Pitch 直接对原音整段复音转录",
    icon: FileMusic,
    toOptions: () => ({
      fidelityMode: "raw",
      separationMode: "none",
      stems: [],
      transcribeStem: "original",
    }),
  },
];

function deriveModeFromOptions(o: UploadOptions): Mode {
  if (o.separationMode === "none") return "full";
  const stems = o.stems ?? [];
  const hasV = stems.includes("vocals");
  const hasI = stems.includes("no_vocals");
  if (hasV && hasI) return "dual";
  if (hasV) return "vocals";
  if (hasI) return "instrumental";
  return "dual";
}

const ALL_STEMS: StemName[] = ["vocals", "no_vocals", "drums", "bass", "other", "piano", "guitar"];

function deriveSeparationMode(stems: StemName[]) {
  if (!stems.length) return "none" as const;
  if (stems.includes("piano") || stems.includes("guitar")) return "6stems" as const;
  if (stems.includes("drums") || stems.includes("bass") || stems.includes("other")) return "4stems" as const;
  return "vocals" as const;
}

export function Uploader() {
  const { file, options, setFile, setOptions, startUpload, task } = useStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const busy = task && task.status !== "completed" && task.status !== "failed";

  const currentMode = useMemo(() => deriveModeFromOptions(options), [options]);

  const selectMode = (m: ModeDef) => {
    setOptions({
      ...m.toOptions(),
      fidelityMode: "raw",
      separationQuality: options.separationQuality ?? "high",
    } as Partial<UploadOptions>);
  };

  const chosenStems = (options.stems ?? []) as StemName[];
  const toggleStem = (stem: StemName) => {
    const next = chosenStems.includes(stem)
      ? chosenStems.filter((s) => s !== stem)
      : [...chosenStems, stem];
    const sepMode = deriveSeparationMode(next);
    setOptions({
      stems: next,
      separationMode: sepMode,
      transcribeStem: next.includes((options.transcribeStem as StemName) || "")
        ? options.transcribeStem
        : (next[0] ?? "original"),
    });
  };

  return (
    <div className="space-y-5">
      {/* ── 上传区 ── */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault(); setDragging(false);
          const f = e.dataTransfer.files?.[0];
          if (f) setFile(f);
        }}
        onClick={() => inputRef.current?.click()}
        className={[
          "border-2 border-dashed rounded-xl p-5 cursor-pointer transition",
          dragging ? "border-indigo-400 bg-indigo-500/10" : "border-slate-700 hover:border-slate-500",
          file ? "bg-slate-800/50" : "",
        ].join(" ")}
      >
        <input
          ref={inputRef}
          type="file"
          accept="audio/*,.mp3,.wav,.flac,.m4a,.ogg"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) setFile(f);
          }}
        />
        {file ? (
          <div className="flex items-center gap-3">
            <Music className="w-7 h-7 text-indigo-400" />
            <div className="flex-1 min-w-0">
              <div className="truncate font-medium text-sm">{file.name}</div>
              <div className="text-xs text-slate-400">{(file.size / 1024 / 1024).toFixed(2)} MB</div>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); setFile(null); }}
              className="p-1 hover:bg-slate-700 rounded"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-slate-400 py-4">
            <Upload className="w-9 h-9" />
            <div className="text-sm">点击或拖拽音频</div>
            <div className="text-xs">mp3 / wav / flac / m4a · ≤ 50MB</div>
          </div>
        )}
      </div>

      {/* ── 模式单选 ── */}
      <div className="space-y-2">
        <div className="text-xs text-slate-400 px-1">扒谱模式</div>
        <div className="space-y-1.5">
          {MODES.map((m) => {
            const Icon = m.icon;
            const active = currentMode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => selectMode(m)}
                className={[
                  "w-full text-left px-3 py-2.5 rounded-lg border transition flex items-start gap-3",
                  active
                    ? "border-indigo-500 bg-indigo-500/10"
                    : "border-slate-800 hover:border-slate-700 bg-slate-900/40",
                ].join(" ")}
              >
                <div
                  className={[
                    "mt-0.5 w-8 h-8 rounded-md flex items-center justify-center shrink-0",
                    active ? "bg-indigo-500/20 text-indigo-200" : "bg-slate-800 text-slate-400",
                  ].join(" ")}
                >
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={active ? "text-indigo-100 font-medium text-sm" : "text-slate-200 text-sm"}>
                      {m.title}
                    </span>
                    {m.recommended && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                        推荐
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">{m.hint}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── 提示：100% 保真 ── */}
      <div className="text-[11px] text-emerald-400/80 bg-emerald-500/5 border border-emerald-500/20 rounded-md px-3 py-2">
        ✓ 100% 保真 · 全 0–127 音域 · 不移调 · 不量化 · 不限制同按数 · 完成后可导出 .mid
      </div>

      {/* ── 高级配置（保留全量控制） ── */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40">
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="w-full px-3 py-2.5 text-left flex items-center justify-between"
        >
          <span className="text-sm text-slate-200 flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4" />
            专业配置（分离轨道 / 目标轨 / 质量）
          </span>
          <span className="text-xs text-slate-500">{showAdvanced ? "收起" : "展开"}</span>
        </button>
        {showAdvanced && (
          <div className="px-3 pb-3 space-y-3 border-t border-slate-800">
            <div className="grid grid-cols-2 gap-2 pt-3">
              <label className="text-xs text-slate-400">分离质量</label>
              <select
                value={options.separationQuality ?? "high"}
                onChange={(e) => setOptions({ separationQuality: e.target.value as "fast" | "high" })}
                className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs"
              >
                <option value="high">高质量（更稳）</option>
                <option value="fast">快速（更快）</option>
              </select>
            </div>

            <div>
              <div className="text-xs text-slate-400 mb-2">保留分离轨道（可多选）</div>
              <div className="grid grid-cols-3 gap-1.5">
                {ALL_STEMS.map((s) => {
                  const on = chosenStems.includes(s);
                  const meta = STEM_REGISTRY[s];
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => toggleStem(s)}
                      className={[
                        "py-1.5 px-2 text-xs rounded-lg border transition",
                        on ? "border-indigo-500 bg-indigo-500/10 text-indigo-100" : "border-slate-800 hover:border-slate-700 text-slate-300",
                      ].join(" ")}
                    >
                      {meta.icon} {meta.label}
                    </button>
                  );
                })}
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                当前分离模式：{options.separationMode ?? "none"}
              </div>
            </div>

            {(chosenStems.length > 0 || options.separationMode === "none") && (
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-slate-400">扒谱目标轨</label>
                <select
                  value={options.transcribeStem ?? (chosenStems[0] || "original")}
                  onChange={(e) => setOptions({ transcribeStem: e.target.value as StemName })}
                  className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs"
                >
                  {options.separationMode === "none" && <option value="original">原音</option>}
                  {chosenStems.map((s) => (
                    <option key={s} value={s}>{STEM_REGISTRY[s].label}</option>
                  ))}
                </select>
              </div>
            )}

            {(options.transcribeStem ?? chosenStems[0]) === "vocals" && (
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={options.vocalToSky25 ?? true}
                  onChange={(e) => setOptions({ vocalToSky25: e.target.checked })}
                  className="accent-amber-400"
                />
                纯人声自动转调到 25 键可按演奏
              </label>
            )}
          </div>
        )}
      </div>

      {/* ── 开始按钮 ── */}
      <button
        disabled={!file || !!busy}
        onClick={() => startUpload()}
        className="w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-500 font-medium transition"
      >
        {busy
          ? "处理中…"
          : currentMode === "full"
            ? "开始扒谱（不分离）"
            : currentMode === "dual"
              ? "分离 + 双轨扒谱"
              : currentMode === "vocals"
                ? "分离 + 扒人声"
                : "分离 + 扒伴奏"}
      </button>
    </div>
  );
}
