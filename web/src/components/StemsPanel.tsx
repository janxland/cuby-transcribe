/**
 * 业务适配层：从全局 store 取 stems / 当前扒谱目标 / BPM，
 * 透传给与业务解耦的 <MixerPanel/>。
 *
 * 只做"取数据 + 调动作"，不含任何 UI 逻辑。
 */
import { useStore } from "@/store";
import { useStoreShallow, usePrimaryMeta } from "@/selectors";
import { MixerPanel } from "./mixer";

interface Props {
  /** 是否渲染顶部 Transport（在 Sky15 内嵌时由外层提供，置 false） */
  withTransport?: boolean;
}

export function StemsPanel({ withTransport = true }: Props = {}) {
  const { stems, scores, activeStems, task } = useStoreShallow((s) => ({
    stems: s.stems, scores: s.scores, activeStems: s.activeStems, task: s.task,
  }));
  const retranscribeWith = useStore((s) => s.retranscribeWith);
  const toggleActiveStem = useStore((s) => s.toggleActiveStem);
  const meta = usePrimaryMeta();
  if (!stems.length) {
    return (
      <div className="h-full flex items-center justify-center text-slate-500 text-sm">
        上传并选择需要分离的音轨即可在此进行混音
      </div>
    );
  }
  const busy = !!task && task.status !== "completed" && task.status !== "failed";
  const bpm = meta?.bpm;
  const transcribedStems = Object.keys(scores);
  // 「重扒」需要后端有分离出的 stem 文件；当列表只剩前端注入的 synthetic 'original'
  // （未分离场景）时禁用，避免点了拿到 404。
  const hasSeparatedStems = stems.some((s) => s.name !== "original");
  return (
    <MixerPanel
      tracks={stems}
      activeTracks={activeStems}
      transcribedTracks={transcribedStems}
      bpm={bpm}
      disabled={busy}
      withTransport={withTransport}
      onRetranscribe={hasSeparatedStems ? (stem) => retranscribeWith(stem) : undefined}
      onToggleScore={(stem) => toggleActiveStem(stem)}
    />
  );
}
