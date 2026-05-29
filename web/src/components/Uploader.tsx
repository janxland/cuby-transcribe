import { useRef, useState } from "react";
import { Upload, Music, X } from "lucide-react";
import { useStore } from "../store";

export function Uploader() {
  const { file, options, setFile, setOptions, startUpload, task } = useStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const busy = task && task.status !== "completed" && task.status !== "failed";

  return (
    <div className="space-y-4">
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
          "border-2 border-dashed rounded-xl p-6 cursor-pointer transition",
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
            <Music className="w-8 h-8 text-indigo-400" />
            <div className="flex-1 min-w-0">
              <div className="truncate font-medium">{file.name}</div>
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
          <div className="flex flex-col items-center gap-2 text-slate-400 py-6">
            <Upload className="w-10 h-10" />
            <div className="text-sm">点击或拖拽音频到这里</div>
            <div className="text-xs">mp3 / wav / flac / m4a · ≤ 50MB</div>
          </div>
        )}
      </div>

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
          <span>简化旋律</span>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-slate-400">网格</span>
          <select
            value={options.quantizeGrid}
            onChange={(e) => setOptions({ quantizeGrid: Number(e.target.value) as 8 | 16 })}
            className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm"
          >
            <option value={16}>1/16</option>
            <option value={8}>1/8</option>
          </select>
        </label>
      </div>

      <button
        disabled={!file || !!busy}
        onClick={() => startUpload()}
        className="w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-500 font-medium transition"
      >
        {busy ? "处理中…" : "开始扒谱"}
      </button>
    </div>
  );
}
