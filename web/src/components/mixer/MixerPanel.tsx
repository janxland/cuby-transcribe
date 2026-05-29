/**
 * Mixer 根组件：
 *   - 接收业务侧的 stems 列表 + 当前扒谱目标 + 重扒回调
 *   - 提供 MixerProvider，把状态注入子组件
 *   - 注册全局键盘快捷键：Space / ← / → / Home / End
 *
 * 业务无关；可独立于本仓库复用。
 */
import { useEffect } from "react";
import { Plus } from "lucide-react";
import { useMixer, type MixerTrackInput } from "./useMixer";
import { Transport } from "./Transport";
import { Ruler } from "./Ruler";
import { Track } from "./Track";

export interface MixerPanelProps {
  tracks: MixerTrackInput[];
  /** 当前演奏列表中的 stem name（多选）；首位高亮为主显 */
  activeTracks?: string[];
  /** 已经生成过扒谱的 stem 名集合（用于显示「已扒」徽章） */
  transcribedTracks?: string[];
  /** 重扒回调；不传则不显示重扒按钮 */
  onRetranscribe?: (stem: string) => void;
  /** 点击某条已扒音轨的「谱」图标：在演奏列表中 toggle */
  onToggleScore?: (stem: string) => void;
  /** 操作禁用（任务进行中） */
  disabled?: boolean;
  /** 顶部展示 BPM */
  bpm?: number;
  /** 是否渲染顶部 Transport 条；嵌入到 Sky15 抽屉等已含 transport 的场景置 false */
  withTransport?: boolean;
}

/**
 * 注意：必须被外层 <MixerProvider> 包裹（在 ScoreViewer 中提升），
 * 这样切到其它 Tab（Sky15 / Roll）时 mixer 状态不丢失。
 */
export function MixerPanel(props: MixerPanelProps) {
  if (!props.tracks.length) return null;
  return <Shell {...props} />;
}

function Shell({
  tracks, activeTracks, transcribedTracks, onRetranscribe, onToggleScore,
  disabled, bpm, withTransport = true,
}: MixerPanelProps) {
  useKeyboardShortcuts();
  const scored = new Set(transcribedTracks ?? []);
  const active = new Set(activeTracks ?? []);
  const primary = activeTracks?.[0];
  return (
    <div className="h-full flex flex-col bg-slate-900/40 select-none overflow-hidden">
      {withTransport && <Transport bpm={bpm} />}
      <Ruler />
      <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-slate-800">
        {tracks.map((t) => (
          <Track
            key={t.name}
            name={t.name}
            url={t.url}
            active={active.has(t.name)}
            primary={primary === t.name}
            hasScore={scored.has(t.name)}
            onRetranscribe={onRetranscribe ? () => onRetranscribe(t.name) : undefined}
            onToggleScore={onToggleScore && scored.has(t.name) ? () => onToggleScore(t.name) : undefined}
            disabled={disabled}
          />
        ))}
      </div>
      {withTransport && <Footer />}
    </div>
  );
}

function Footer() {
  return (
    <div className="border-t border-dashed border-slate-800 px-3 py-2 flex items-center gap-2 text-xs text-slate-500">
      <Plus className="w-3.5 h-3.5" />
      <span>未来：钢琴 / 吉他 / 弦乐 等独立分离 → 自动加入新音轨</span>
      <span className="ml-auto text-slate-600">
        <Kbd>Space</Kbd> 播放/暂停　<Kbd>←</Kbd>/<Kbd>→</Kbd> ±5s　<Kbd>Shift</Kbd>+方向 ±1s　<Kbd>Home</Kbd>/<Kbd>End</Kbd> 跳转
      </span>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-block px-1.5 py-0.5 mx-0.5 rounded bg-slate-800 border border-slate-700 text-[10px] text-slate-300 font-mono">
      {children}
    </kbd>
  );
}

// ─── 键盘快捷键 ──────────────────────────────────────────────
function useKeyboardShortcuts() {
  const m = useMixer();
  useEffect(() => {
    const isTyping = (el: EventTarget | null) =>
      el instanceof HTMLElement &&
      (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);

    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const big = e.shiftKey ? 1 : 5;
      switch (e.code) {
        case "Space":
          e.preventDefault(); m.toggle(); break;
        case "ArrowRight":
          e.preventDefault(); m.seek(m.time + big); break;
        case "ArrowLeft":
          e.preventDefault(); m.seek(m.time - big); break;
        case "Home":
          e.preventDefault(); m.seek(0); break;
        case "End":
          e.preventDefault(); m.seek(m.duration); break;
        default: break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [m]);
}
