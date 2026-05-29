import { useRef, useState } from "react";
import { Upload, Music, X, Sparkles } from "lucide-react";
import { useStore } from "../store";
import type { SeparationMode } from "../types";
import { STEMS_BY_MODE, STEM_REGISTRY } from "../stems";

const SEP_OPTIONS: { value: SeparationMode; label: string; desc: string }[] = [
  { value: "none", label: "不分离", desc: "最快 · 直接整段扒谱" },
  { value: "vocals", label: "人声 / 伴奏", desc: "Demucs 2 轨 · 推荐" },
  { value: "4stems", label: "4 轨分离", desc: "人声 / 鼓 / 贝斯 / 其它" },
];

export function Uploader() {
  const { file, options, setFile, setOptions, startUpload, task } = useStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const busy = task && task.status !== "completed" && task.status !== "failed";

  const stemOpts = STEMS_BY_MODE[options.separationMode];
  const currentStem = options.transcribeStem ?? stemOpts[0];

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

      {/* 分离模式 */}
      <div>
        <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-2">
          <Sparkles className="w-3.5 h-3.5" />
          <span>音轨分离 (Demucs)</span>
        </div>
        <div className="space-y-1.5">
          {SEP_OPTIONS.map((o) => (
            <label
              key={o.value}
              className={[
                "flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition text-sm",
                options.separationMode === o.value
                  ? "border-indigo-500 bg-indigo-500/10"
                  : "border-slate-800 hover:border-slate-700",
              ].join(" ")}
            >
              <input
                type="radio"
                name="sep"
                value={o.value}
                checked={options.separationMode === o.value}
                onChange={() => setOptions({
                  separationMode: o.value,
                  transcribeStem: STEMS_BY_MODE[o.value][0],
                })}
                className="accent-indigo-500"
              />
              <span className="flex-1">{o.label}</span>
              <span className="text-[11px] text-slate-500">{o.desc}</span>
            </label>
          ))}
        </div>
      </div>

      {/* 选哪条转录 */}
      {options.separationMode !== "none" && (
        <div>
          <div className="text-xs text-slate-400 mb-2">扒谱目标</div>
          <div className="grid grid-cols-2 gap-1.5">
            {stemOpts.map((name) => {
              const m = STEM_REGISTRY[name];
              return (
                <button
                  key={name}
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

      {/* 高级选项 */}
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
        {busy ? "处理中…" : options.separationMode === "none" ? "开始扒谱" : "分离 + 扒谱"}
      </button>
    </div>
  );
}
