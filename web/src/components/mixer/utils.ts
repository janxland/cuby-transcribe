// 纯函数工具
export function fmt(t: number, withDeci = true): string {
  if (!Number.isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const ss = s.toString().padStart(2, "0");
  if (!withDeci) return `${m}:${ss}`;
  const ms = Math.floor((t - Math.floor(t)) * 10);
  return `${m}:${ss}.${ms}`;
}

/** 把可能是 NaN/Infinity/负数 的时长规范到 [0, 6h] */
export function safeDur(d: number, fallback = 0): number {
  if (!Number.isFinite(d) || d <= 0) return fallback;
  return Math.min(d, 60 * 60 * 6);
}

export function safeTime(t: number, dur: number): number {
  if (!Number.isFinite(t) || t < 0) return 0;
  return dur > 0 ? Math.min(t, dur) : 0;
}

export function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

/** 时间百分比，duration 异常时返回 0% */
export function pct(t: number, duration: number): number {
  const d = safeDur(duration);
  if (d <= 0) return 0;
  return (safeTime(t, d) / d) * 100;
}

/** 线性增益 → dB；0 显示为 -∞ */
export function gainToDb(g: number): string {
  if (g <= 0.0001) return "-∞";
  const db = 20 * Math.log10(g);
  return `${db >= 0 ? "+" : ""}${db.toFixed(1)}`;
}

/** 颜色映射：未来新增 stem 在 STEM_REGISTRY 里加项后此处自动 fallback */
export function waveColor(name: string): string {
  switch (name) {
    case "vocals":    return "#f472b6";
    case "no_vocals": return "#38bdf8";
    case "drums":     return "#fbbf24";
    case "bass":      return "#a78bfa";
    case "other":     return "#34d399";
    case "original":  return "#94a3b8";
    default:          return "#818cf8";
  }
}
