/**
 * 业务适配层：从全局 store 取 stems / 当前扒谱目标 / BPM，
 * 透传给与业务解耦的 <MixerPanel/>。
 *
 * 只做"取数据 + 调动作"，不含任何 UI 逻辑。
 */
import { useStore } from "../store";
import { MixerPanel } from "./mixer";

export function StemsPanel() {
  const { stems, meta, score, task, retranscribeWith } = useStore();
  if (!stems.length) {
    return (
      <div className="h-full flex items-center justify-center text-slate-500 text-sm">
        上传并选择需要分离的音轨即可在此进行混音
      </div>
    );
  }
  const busy = !!task && task.status !== "completed" && task.status !== "failed";
  const bpm = (score?.meta as any)?.bpm as number | undefined;
  return (
    <MixerPanel
      tracks={stems}
      activeTrack={meta?.transcribedStem}
      bpm={bpm}
      disabled={busy}
      onRetranscribe={(stem) => retranscribeWith(stem)}
    />
  );
}
