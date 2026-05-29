import { useMemo } from "react";
import { useStore } from "../store";

// 光遇 15 键，按游戏内 3 行 × 5 列布局
const SKY_KEYS = [60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 81, 83, 84];
const LABELS = ["1", "2", "3", "4", "5", "Q", "W", "E", "R", "T", "A", "S", "D", "F", "G"];

export function Sky15Keys() {
  const { score, currentTime } = useStore();
  const notes = score?.tracks?.[0]?.notes ?? [];

  // 当前活跃键
  const active = useMemo(() => {
    const set = new Set<number>();
    for (const n of notes) {
      if (currentTime >= n.time && currentTime < n.time + n.duration) {
        const idx = SKY_KEYS.indexOf(n.pitch);
        if (idx >= 0) set.add(idx);
      }
    }
    return set;
  }, [notes, currentTime]);

  // 统计每个键的使用次数
  const counts = useMemo(() => {
    const arr = new Array(15).fill(0);
    for (const n of notes) {
      const i = SKY_KEYS.indexOf(n.pitch);
      if (i >= 0) arr[i] += 1;
    }
    return arr;
  }, [notes]);

  const maxCount = Math.max(1, ...counts);

  return (
    <div className="rounded-xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 p-6">
      <div className="text-sm text-slate-400 mb-4">光遇 15 键 · 实时高亮 + 热力图</div>
      <div className="grid grid-cols-5 gap-3 max-w-md mx-auto">
        {SKY_KEYS.map((pitch, i) => {
          const isActive = active.has(i);
          const heat = counts[i] / maxCount;
          return (
            <div
              key={i}
              className={[
                "aspect-square rounded-xl flex flex-col items-center justify-center font-mono",
                "transition-all duration-100 border-2 relative overflow-hidden",
                isActive
                  ? "border-amber-300 bg-amber-400 text-slate-900 scale-110 shadow-[0_0_20px_rgba(251,191,36,0.6)]"
                  : "border-slate-700 bg-slate-800/60 text-slate-300",
              ].join(" ")}
            >
              {!isActive && (
                <div
                  className="absolute inset-0 bg-indigo-500"
                  style={{ opacity: heat * 0.4 }}
                />
              )}
              <span className="relative text-lg font-bold">{LABELS[i]}</span>
              <span className="relative text-[10px] opacity-70">
                {pitchName(pitch)}
              </span>
              <span className="relative text-[10px] opacity-50 mt-0.5">×{counts[i]}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function pitchName(p: number): string {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  return `${names[p % 12]}${Math.floor(p / 12) - 1}`;
}
