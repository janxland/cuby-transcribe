"""最佳可弹奏调搜索 —— 为 Sky 15 键找到「最少损失 + 最贴合」的移调。

Sky 15 键固定 = C 大调 [C4..C6] 的 15 个白键；游戏内提供「升降调键」
可以把整张键盘整体平移 N 个半音。所以"最佳扒谱"不应一刀切转 C：
我们应在 12 个移调候选里挑「自然音命中率最高 + 音域贴合最好 + 高低跳跃最少」
的那一个，并在 metadata 里输出 `recommendedShift`，告诉玩家
"在游戏里按 +N 升调键，谱面就是原调"。

不依赖任何外部包；只用纯 Python + 列表运算。
"""
from __future__ import annotations
from typing import List, Tuple

NATURAL_PCS = {0, 2, 4, 5, 7, 9, 11}   # C 大调白键 pitch class
SKY_MIN, SKY_MAX = 60, 84              # C4..C6
SKY_CENTER = 72                        # 居中目标
RANGE_SPAN = SKY_MAX - SKY_MIN         # 24

# 评分权重（凭经验 + 小数据集 tune；可在 env 调）
W_NATURAL = 1.0    # 落在白键上的比例
W_RANGE   = 0.6    # 中心音落在 [SKY_MIN,SKY_MAX] 的比例
W_SPREAD  = 0.3    # 八度跨度越小越好


def _fold_to_range(pitch: int) -> int:
    p = pitch
    while p < SKY_MIN:
        p += 12
    while p > SKY_MAX:
        p -= 12
    return p


def _score(notes: List[dict], shift: int) -> Tuple[float, dict]:
    """对给定移调量打分。返回 (score, breakdown)。"""
    if not notes:
        return 0.0, {}

    # 用时长加权（长音符更重要）
    total_w = 0.0
    natural_w = 0.0
    in_range_w = 0.0
    folded_pitches: List[float] = []
    for n in notes:
        w = max(0.05, n["end"] - n["start"])
        total_w += w
        p_shift = n["pitch"] + shift
        if (p_shift % 12) in NATURAL_PCS:
            natural_w += w
        if SKY_MIN <= p_shift <= SKY_MAX:
            in_range_w += w
        folded_pitches.append(_fold_to_range(p_shift))

    natural_ratio = natural_w / total_w
    in_range_ratio = in_range_w / total_w

    # 折叠后跨度（半音）。越小→玩家手在键盘上的横跳越少
    if folded_pitches:
        spread = (max(folded_pitches) - min(folded_pitches)) / RANGE_SPAN
    else:
        spread = 1.0

    score = (
        W_NATURAL * natural_ratio
        + W_RANGE   * in_range_ratio
        - W_SPREAD  * spread
    )
    return score, {
        "natural": round(natural_ratio, 3),
        "inRange": round(in_range_ratio, 3),
        "spread": round(spread, 3),
    }


def find_best_shift(notes: List[dict]) -> dict:
    """在 [-6, +5] 12 个半音里枚举，返回最优 shift（含说明）。

    返回:
      {
        "shift": int,            # 半音；正=升 N 键
        "score": float,
        "candidates": [(shift, score)],  # 全部 12 个
        "detail": {natural, inRange, spread},
      }
    """
    candidates: List[Tuple[int, float, dict]] = []
    for s in range(-6, 6):  # -6..+5
        sc, br = _score(notes, s)
        candidates.append((s, sc, br))

    candidates.sort(key=lambda x: x[1], reverse=True)
    best = candidates[0]
    return {
        "shift": best[0],
        "score": round(best[1], 4),
        "detail": best[2],
        "candidates": [(s, round(sc, 4)) for s, sc, _ in candidates],
    }


def apply_shift(notes: List[dict], shift: int) -> List[dict]:
    return [{**n, "pitch": n["pitch"] + shift} for n in notes]
