/**
 * 编辑器工具栏 —— 纯展示组件；行为通过 props 注入，便于在 Storybook / 单元测试中独立验证。
 */
import {
  MousePointer2, Pencil, Eraser, Undo2, Redo2,
  ZoomIn, ZoomOut, Magnet, Trash2, Volume2,
} from "lucide-react";
import type { GridConfig, Tool } from "./types";

export interface ToolbarProps {
  tool: Tool;
  onToolChange: (t: Tool) => void;
  grid: GridConfig;
  onGridChange: (g: GridConfig) => void;
  pxPerSec: number;
  rowH: number;
  onZoomH: (delta: number) => void;
  onZoomV: (delta: number) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  selectionCount: number;
  onDeleteSelected: () => void;
  onAuditionSelected: () => void;
  /** 当存在多份扒谱时显示 stem 选择器 */
  stems: { id: string; label: string; icon: string }[];
  editingStem: string;
  onEditingStemChange: (stem: string) => void;
}

export function EditorToolbar(p: ToolbarProps) {
  return (
    <div className="shrink-0 flex items-center gap-1.5 flex-wrap px-2 py-1.5 border-b border-slate-800 bg-slate-900/60">
      {/* 多谱切换 */}
      {p.stems.length > 1 && (
        <Group label="编辑">
          <select
            value={p.editingStem}
            onChange={(e) => p.onEditingStemChange(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-xs text-slate-200"
          >
            {p.stems.map((s) => (
              <option key={s.id} value={s.id}>{s.icon} {s.label}</option>
            ))}
          </select>
        </Group>
      )}

      {/* 工具 */}
      <Group label="工具">
        <ToolBtn active={p.tool === "select"} onClick={() => p.onToolChange("select")} title="选择 / 拖动"><MousePointer2 className="w-3.5 h-3.5" /></ToolBtn>
        <ToolBtn active={p.tool === "draw"} onClick={() => p.onToolChange("draw")} title="绘制新音符"><Pencil className="w-3.5 h-3.5" /></ToolBtn>
        <ToolBtn active={p.tool === "erase"} onClick={() => p.onToolChange("erase")} title="擦除音符"><Eraser className="w-3.5 h-3.5" /></ToolBtn>
      </Group>

      {/* 撤销 */}
      <Group label="历史">
        <ToolBtn disabled={!p.canUndo} onClick={p.onUndo} title="撤销 (Ctrl+Z)"><Undo2 className="w-3.5 h-3.5" /></ToolBtn>
        <ToolBtn disabled={!p.canRedo} onClick={p.onRedo} title="重做 (Ctrl+Y)"><Redo2 className="w-3.5 h-3.5" /></ToolBtn>
      </Group>

      {/* 网格 + Snap */}
      <Group label="网格">
        <select
          value={p.grid.division}
          onChange={(e) => p.onGridChange({ ...p.grid, division: Number(e.target.value) as GridConfig["division"] })}
          className="bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-xs text-slate-200"
          title="一拍分几格"
        >
          <option value={4}>1/4</option>
          <option value={8}>1/8</option>
          <option value={16}>1/16</option>
          <option value={32}>1/32</option>
        </select>
        <ToolBtn active={p.grid.snap} onClick={() => p.onGridChange({ ...p.grid, snap: !p.grid.snap })} title="吸附到网格"><Magnet className="w-3.5 h-3.5" /></ToolBtn>
      </Group>

      {/* 缩放 */}
      <Group label="缩放">
        <ToolBtn onClick={() => p.onZoomH(-1)} title="横向 -"><ZoomOut className="w-3.5 h-3.5" /></ToolBtn>
        <span className="text-[10px] tabular-nums text-slate-400 w-12 text-center">{Math.round(p.pxPerSec)} px/s</span>
        <ToolBtn onClick={() => p.onZoomH(+1)} title="横向 +"><ZoomIn className="w-3.5 h-3.5" /></ToolBtn>
        <span className="w-2" />
        <ToolBtn onClick={() => p.onZoomV(-1)} title="纵向 -"><ZoomOut className="w-3.5 h-3.5 -rotate-90" /></ToolBtn>
        <span className="text-[10px] tabular-nums text-slate-400 w-10 text-center">{p.rowH}px</span>
        <ToolBtn onClick={() => p.onZoomV(+1)} title="纵向 +"><ZoomIn className="w-3.5 h-3.5 -rotate-90" /></ToolBtn>
      </Group>

      {/* 选区操作 */}
      <Group label={`选区 ${p.selectionCount || ""}`}>
        <ToolBtn disabled={!p.selectionCount} onClick={p.onAuditionSelected} title="试听选中音符"><Volume2 className="w-3.5 h-3.5" /></ToolBtn>
        <ToolBtn disabled={!p.selectionCount} onClick={p.onDeleteSelected} title="删除选中 (Del)"><Trash2 className="w-3.5 h-3.5" /></ToolBtn>
      </Group>
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-slate-800 bg-slate-950/40">
      <span className="text-[10px] uppercase tracking-wider text-slate-500 mr-1">{label}</span>
      {children}
    </div>
  );
}

function ToolBtn({
  active, disabled, onClick, title, children,
}: {
  active?: boolean; disabled?: boolean; onClick?: () => void;
  title: string; children: React.ReactNode;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      title={title}
      className={[
        "w-7 h-7 rounded flex items-center justify-center transition",
        disabled
          ? "text-slate-600 cursor-not-allowed"
          : active
            ? "bg-indigo-500/30 text-indigo-100 ring-1 ring-indigo-400/60"
            : "text-slate-300 hover:bg-slate-800",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
