"""复音 → 单旋律线的提取器（"skyline" + salience）。

为什么需要：Basic Pitch 是复音模型，对伴奏轨（去人声后的 instrumental）
会同时识别出主旋律、和声、bass、装饰音。直接喂给 sky_mapper 会产生
大量重叠和杂乱音符 —— 这就是用户反馈"谱子杂乱"的根因。

本模块做一件事：**把任意复音 note 列表，约束成单声部主旋律**。

策略（适合流行歌曲器乐主旋律）：
  1. 时间网格 20ms 量化；
  2. 每一帧从所有"还在持续"的音符里挑一个"显著度"最高的：
       salience = pitch（skyline，主旋律通常在最高声部）
                + velocity 加权（小幅 tie-break）
                + 在 [C4..C6=60..84] 范围内额外加分（光遇/口袋音乐的甜区）
  3. 把连续相同 pitch 的帧合并回 note。

输出严格单调（任何时刻只有一个音），节奏/时长信息保留。
"""
from __future__ import annotations
from typing import List

FRAME_SEC = 0.02
MELODY_BAND = (60, 84)   # Sky 15 键音域 = C4..C6；在此区间额外加 salience
BAND_BONUS  = 4.0        # 落在甜区奖励（约等于 4 个半音的优势）
VEL_WEIGHT  = 0.05       # velocity 0..127 → 最多 ~6 加成（次级 tie-break）


def _salience(pitch: int, velocity: int) -> float:
    s = float(pitch) + velocity * VEL_WEIGHT
    if MELODY_BAND[0] <= pitch <= MELODY_BAND[1]:
        s += BAND_BONUS
    return s


def to_monophonic(notes: List[dict]) -> List[dict]:
    """把复音 note 列表压缩到单旋律。已按 start 排序输入更优，但不强制。"""
    if not notes:
        return notes

    end_time = max(n["end"] for n in notes)
    if end_time <= 0:
        return []
    n_frames = int(end_time / FRAME_SEC) + 1

    # 每帧记录当选 pitch / vel / 当选 salience（>-inf 表示有音）
    best_pitch = [-1] * n_frames
    best_vel = [0] * n_frames
    best_sal = [float("-inf")] * n_frames

    for n in notes:
        s = max(0, int(n["start"] / FRAME_SEC))
        e = min(n_frames, max(s + 1, int(round(n["end"] / FRAME_SEC))))
        if e <= s:
            continue
        vel = int(n.get("velocity", 80))
        sal = _salience(int(n["pitch"]), vel)
        for i in range(s, e):
            if sal > best_sal[i]:
                best_sal[i] = sal
                best_pitch[i] = int(n["pitch"])
                best_vel[i] = vel

    # 把连续相同 pitch 帧合并
    out: List[dict] = []
    i = 0
    while i < n_frames:
        p = best_pitch[i]
        if p < 0:
            i += 1
            continue
        s_idx = i
        v_acc = 0
        v_cnt = 0
        while i < n_frames and best_pitch[i] == p:
            v_acc += best_vel[i]
            v_cnt += 1
            i += 1
        out.append({
            "pitch": p,
            "start": s_idx * FRAME_SEC,
            "end": i * FRAME_SEC,
            "velocity": int(v_acc / max(1, v_cnt)),
        })
    return out
