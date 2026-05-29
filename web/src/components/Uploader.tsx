import { useMemo, useRef, useState } from "react";
import { Upload, Music, X, Sparkles, CheckSquare, Square } from "lucide-react";
import { useStore } from "../store";
import { STEM_REGISTRY, SELECTABLE_STEMS, deriveMode, type StemName } from "../stems";

// 模式说明（根据已选 stems 自动派生展示，仅作"成本预估"提示）
const MODE_HINTS: Record<string, string> = {
  none:     "不分离 · 最快 · 直接整段扒谱",
  vocals:   "Demucs 2 轨 · 仅人声/伴奏 · 最快",
  "4stems": "Demucs htdemucs · 4 轨 · 约 1× 时长",
  "6stems": "Demucs htdemucs_6s · 6 轨含钢琴/吉他 · 约 1.5× 时长",
};

export function Uploader() {
  const { file, options, setFile, setOptions, startUpload, task } = useStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const busy = task && task.status !== "completed" && task.status !== "failed";

  const chosen = options.stems;
  const mode = useMemo(() => deriveMode(chosen), [chosen]);

  const toggleStem = (s: StemName) => {
    const next = chosen.includes(s) ? chosen.filter((x) => x !== s) : [...chosen, s];
    setOptions({
      stems: next,
      separationMode: deriveMode(next),
      // 若移除了原扒谱目标，自动改为首个；空则清空
      transcribeStem: options.transcribeStem && next.includes(options.transcribeStem)
        ? options.transcribeStem
        : next[0],
    });
  };
  const setAll = (all: boolean) => {
    const next: StemName[] = all ? [...SELECTABLE_STEMS] : [];
    setOptions({
      stems: next,
      separationMode: deriveMode(next),
      transcribeStem: next[0],
    });
  };

  const currentStem = options.transcribeStem ?? chosen[0];

  return (
    <div className="space-y-5">
      {/* 文件选择 */}
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

      {/* 音轨多选 */}
      <div>
        <div className="flex items-center gap-2 text-xs text-slate-400 mb-2">
          <Sparkles className="w-3.5 h-3.5" />
          <span>分离音轨（可多选）</span>
          <button
            type="button"
            onClick={() => setAll(chosen.length !== SELECTABLE_STEMS.length)}
            className="ml-auto flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border border-slate-700 hover:border-slate-500 text-slate-300"
          >
            {chosen.length === SELECTABLE_STEMS.length
              ? <><CheckSquare className="w-3 h-3" /> 取消全选</>
              : <><Square className="w-3 h-3" /> 全选</>}
          </button>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {SELECTABLE_STEMS.map((name) => {
            const m = STEM_REGISTRY[name];
            const on = chosen.includes(name);
            return (
              <button
                key={name}
                type="button"
                onClick={() => toggleStem(name)}
                className={[
                  "py-2 px-2 text-sm rounded-lg border transition flex items-center justify-center gap-1.5",
                  on
                    ? "border-indigo-500 bg-indigo-500/10 text-indigo-100"
                    : "border-slate-800 hover:border-slate-700 text-slate-300",
                ].join(" ")}
              >
                <span className="text-base leading-none">{m.icon}</span>
                <span>{m.label}</span>
              </button>
            );
          })}
        </div>
        <div className="mt-1.5 text-[11px] text-slate-500">{MODE_HINTS[mode]}</div>
      </div>

      {/* 扒谱目标 */}
      {chosen.length > 0 && (
        <div>
          <div className="text-xs text-slate-400 mb-2">扒谱目标（从已选音轨中选）</div>
          <div className="grid grid-cols-3 gap-1.5">
            {chosen.map((name) => {
              const m = STEM_REGISTRY[name];
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => setOptions({ transcribeStem: name })}
                  className={[
                    "py-1.5 px-3 text-sm rounded-lg border transition",
                    currentStem === name
                      ? "border-amber-400 bg-amber-400/10 text-amber-200"
                      : "border-slate-800 hover:border-slate-700",
                  ].join(" ")}
                >
                  {m.icon} {m.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 音乐处理 */}
      <div>
        <div className="text-xs text-slate-400 mb-2">音乐处理</div>
        <div className="grid grid-cols-3 gap-3 text-sm">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={options.transposeToC}
              onChange={(e) => setOptions({ transposeToC: e.target.checked })}
              className="accent-indigo-500"
            />
            <span>转 C 调</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={options.simplifyMelody}
              onChange={(e) => setOptions({ simplifyMelody: e.target.checked })}
              className="accent-indigo-500"
            />
            <span>简化</span>
          </label>
          <label className="flex items-center gap-1.5">
            <span className="text-slate-400 text-xs">网格</span>
            <select
              value={options.quantizeGrid}
              onChange={(e) => setOptions({ quantizeGrid: Number(e.target.value) as 8 | 16 })}
              className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs"
            >
              <option value={16}>1/16</option>
              <option value={8}>1/8</option>
            </select>
          </label>
        </div>
      </div>

      <button
        disabled={!file || !!busy}
        onClick={() => startUpload()}
        className="w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-500 font-medium transition"
      >
        {busy ? "处理中…" : mode === "none" ? "直接扒谱（不分离）" : `分离 ${chosen.length} 轨 + 扒谱`}
      </button>
    </div>
  );
}
