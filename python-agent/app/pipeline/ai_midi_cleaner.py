"""AI MIDI 后处理桥接。

这里不把“AI 降噪”伪装成固定阈值算法：
  - Python 侧只允许一个轻量预处理：删除短于 1/32 的明显碎音；
  - 默认 provider=local_ai，在 Python 本地用自适应概率模型保护旋律并清理毛刺；
  - AnthemScore / MIDI Cleaner AI 作为可选本机工具或私有服务接入，不再是必需项。
"""
from __future__ import annotations

import os
import shlex
import subprocess
import tempfile
from dataclasses import dataclass

import httpx
import pretty_midi
from loguru import logger

from ..models import CubyScore, Note, ScoreCleanupOptions, ScoreCleanupStats, Track


def cleanup_score(score: CubyScore, options: ScoreCleanupOptions) -> tuple[CubyScore, ScoreCleanupStats]:
    before = _count_notes(score)
    working, removed_short = _remove_one_thirty_second_noise(score, options)

    provider = _resolve_provider(options.provider)
    if provider == "local_ai":
        cleaned = _run_local_ai(working, options)
    elif provider == "midi_cleaner_ai":
        cleaned = _run_midi_cleaner_ai(working, options)
    elif provider == "anthem_score":
        cleaned = _run_anthem_score(working, options)
    else:
        raise RuntimeError(f"unsupported AI MIDI cleanup provider: {provider}")

    after = _count_notes(cleaned)
    return cleaned, ScoreCleanupStats(
        before=before,
        after=after,
        removedOneThirtySecond=removed_short,
        provider=provider,
        message="AI MIDI cleanup completed",
    )


def _resolve_provider(requested: str) -> str:
    midi_cleaner_url = os.environ.get("MIDI_CLEANER_AI_URL")
    anthem_template = os.environ.get("ANTHEMSCORE_CLI_TEMPLATE")
    anthem_bin = os.environ.get("ANTHEMSCORE_CLI")

    if requested == "local_ai":
        return "local_ai"
    if requested == "midi_cleaner_ai":
        if not midi_cleaner_url:
            raise RuntimeError("MIDI_CLEANER_AI_URL is not configured")
        return "midi_cleaner_ai"
    if requested == "anthem_score":
        if not (anthem_template or anthem_bin):
            raise RuntimeError("ANTHEMSCORE_CLI_TEMPLATE or ANTHEMSCORE_CLI is not configured")
        return "anthem_score"

    if midi_cleaner_url:
        return "midi_cleaner_ai"
    if anthem_template or anthem_bin:
        return "anthem_score"
    return "local_ai"


@dataclass(frozen=True)
class IndexedNote:
    track_index: int
    note_index: int
    note: Note


@dataclass(frozen=True)
class TrackProfile:
    pitch_q05: float
    pitch_q25: float
    pitch_q50: float
    pitch_q75: float
    pitch_q95: float
    dur_q10: float
    dur_q25: float
    vel_q10: float
    vel_q25: float


def _run_local_ai(score: CubyScore, options: ScoreCleanupOptions) -> CubyScore:
    """本地自适应 AI cleaner。

    这不是固定音域裁剪：模型先从当前曲子估计每条轨道的音区、持续时间、
    力度分布，再用 Viterbi 选择一条连续旋律线作为保护集。随后只对未被保护
    的音符计算“杂音概率”，并按当前曲子的分布自适应阈值删除。
    """
    working = score.model_copy(deep=True)
    indexed = _indexed_notes(working)
    if len(indexed) < 8:
        return working

    bpm = float(options.targetBpm or working.meta.bpm or 120)
    frame_sec = max(0.06, (60.0 / max(30.0, bpm)) / 4.0)
    profiles = _track_profiles(working)
    density = _density_by_frame(indexed, frame_sec)
    protected = _viterbi_melody(indexed, profiles, density, frame_sec)

    scored: list[tuple[tuple[int, int], float]] = []
    for item in indexed:
        key = (item.track_index, item.note_index)
        if key in protected:
            continue
        scored.append((key, _artifact_probability(item, profiles[item.track_index], density, frame_sec)))

    if not scored:
        return working

    values = [v for _, v in scored]
    threshold = _adaptive_threshold(values)
    remove = {key for key, value in scored if value >= threshold}

    # 过度删除保护：本地 AI 负责降噪，不负责重编曲；最多删掉非旋律候选的 55%。
    max_remove = int(len(scored) * 0.55)
    if len(remove) > max_remove:
        ranked = sorted(scored, key=lambda x: x[1], reverse=True)
        remove = {key for key, _ in ranked[:max_remove]}

    for track_index, track in enumerate(working.tracks):
        track.notes = [
            note
            for note_index, note in enumerate(track.notes)
            if (track_index, note_index) not in remove
        ]

    working.meta = working.meta.model_copy(update={"bpm": options.targetBpm or working.meta.bpm})
    return working


def _indexed_notes(score: CubyScore) -> list[IndexedNote]:
    out: list[IndexedNote] = []
    for track_index, track in enumerate(score.tracks):
        for note_index, note in enumerate(track.notes):
            if note.duration > 0 and 0 <= note.pitch <= 127:
                out.append(IndexedNote(track_index, note_index, note))
    return out


def _track_profiles(score: CubyScore) -> list[TrackProfile]:
    profiles: list[TrackProfile] = []
    all_notes = [n for t in score.tracks for n in t.notes]
    fallback_pitches = [float(n.pitch) for n in all_notes] or [60.0]
    fallback_durs = [float(n.duration) for n in all_notes] or [0.25]
    fallback_vels = [float(n.velocity) for n in all_notes] or [80.0]

    for track in score.tracks:
        notes = track.notes or all_notes
        pitches = [float(n.pitch) for n in notes] or fallback_pitches
        durs = [float(n.duration) for n in notes] or fallback_durs
        vels = [float(n.velocity) for n in notes] or fallback_vels
        profiles.append(TrackProfile(
            pitch_q05=_quantile(pitches, 0.05),
            pitch_q25=_quantile(pitches, 0.25),
            pitch_q50=_quantile(pitches, 0.50),
            pitch_q75=_quantile(pitches, 0.75),
            pitch_q95=_quantile(pitches, 0.95),
            dur_q10=max(0.01, _quantile(durs, 0.10)),
            dur_q25=max(0.01, _quantile(durs, 0.25)),
            vel_q10=_quantile(vels, 0.10),
            vel_q25=_quantile(vels, 0.25),
        ))
    return profiles


def _density_by_frame(indexed: list[IndexedNote], frame_sec: float) -> dict[int, int]:
    density: dict[int, int] = {}
    for item in indexed:
        frame = _frame(item.note.time, frame_sec)
        density[frame] = density.get(frame, 0) + 1
    return density


def _viterbi_melody(
    indexed: list[IndexedNote],
    profiles: list[TrackProfile],
    density: dict[int, int],
    frame_sec: float,
) -> set[tuple[int, int]]:
    by_frame: dict[int, list[IndexedNote]] = {}
    for item in indexed:
        by_frame.setdefault(_frame(item.note.time, frame_sec), []).append(item)

    frames = sorted(by_frame)
    if not frames:
        return set()

    states: dict[int, list[IndexedNote]] = {}
    for frame in frames:
        candidates = sorted(
            by_frame[frame],
            key=lambda item: _melody_salience(item, profiles[item.track_index], density, frame_sec),
            reverse=True,
        )
        states[frame] = candidates[:8]

    dp: dict[tuple[int, int], tuple[float, tuple[int, int] | None]] = {}
    for fi, frame in enumerate(frames):
        for si, item in enumerate(states[frame]):
            salience = _melody_salience(item, profiles[item.track_index], density, frame_sec)
            if fi == 0:
                dp[(fi, si)] = (salience, None)
                continue

            best_score = -1e9
            best_prev: tuple[int, int] | None = None
            prev_frame = frames[fi - 1]
            frame_gap = max(1, frame - prev_frame)
            for pi, prev in enumerate(states[prev_frame]):
                prev_score = dp[(fi - 1, pi)][0]
                pitch_jump = abs(item.note.pitch - prev.note.pitch) / 12.0
                time_gap = max(0.0, item.note.time - (prev.note.time + prev.note.duration))
                transition = pitch_jump * 0.55 + time_gap * 0.20 + (frame_gap - 1) * 0.08
                score = prev_score + salience - transition
                if score > best_score:
                    best_score = score
                    best_prev = (fi - 1, pi)
            dp[(fi, si)] = (best_score, best_prev)

    last_fi = len(frames) - 1
    best_last = max(((last_fi, si) for si in range(len(states[frames[-1]]))), key=lambda key: dp[key][0])
    protected: set[tuple[int, int]] = set()
    cur: tuple[int, int] | None = best_last
    while cur is not None:
        fi, si = cur
        item = states[frames[fi]][si]
        protected.add((item.track_index, item.note_index))
        cur = dp[cur][1]
    return protected


def _melody_salience(item: IndexedNote, profile: TrackProfile, density: dict[int, int], frame_sec: float) -> float:
    note = item.note
    pitch_span = max(1.0, profile.pitch_q95 - profile.pitch_q05)
    pitch_upperness = (note.pitch - profile.pitch_q25) / pitch_span
    duration_strength = _soft_ratio(note.duration, profile.dur_q25)
    velocity_strength = _soft_ratio(note.velocity, max(1.0, profile.vel_q25))
    density_penalty = min(0.35, max(0, density.get(_frame(note.time, frame_sec), 1) - 4) * 0.035)
    return pitch_upperness * 0.50 + duration_strength * 0.28 + velocity_strength * 0.18 - density_penalty


def _artifact_probability(
    item: IndexedNote,
    profile: TrackProfile,
    density: dict[int, int],
    frame_sec: float,
) -> float:
    note = item.note
    shortness = _lower_tail_score(note.duration, profile.dur_q10, profile.dur_q25)
    weakness = _lower_tail_score(note.velocity, profile.vel_q10, profile.vel_q25)
    low_out = max(0.0, profile.pitch_q05 - note.pitch)
    high_out = max(0.0, note.pitch - profile.pitch_q95)
    pitch_outlier = min(1.0, (low_out + high_out) / 18.0)
    frame_density = density.get(_frame(note.time, frame_sec), 1)
    crowding = min(1.0, max(0, frame_density - 3) / 8.0)

    return (
        shortness * 0.40
        + weakness * 0.18
        + pitch_outlier * 0.22
        + crowding * 0.20
    )


def _adaptive_threshold(values: list[float]) -> float:
    med = _quantile(values, 0.50)
    q75 = _quantile(values, 0.75)
    q25 = _quantile(values, 0.25)
    iqr = max(0.01, q75 - q25)
    return max(0.42, min(0.82, med + iqr * 0.85))


def _lower_tail_score(value: float, q10: float, q25: float) -> float:
    if value >= q25:
        return 0.0
    denom = max(1e-6, q25 - q10)
    return max(0.0, min(1.0, (q25 - value) / denom))


def _soft_ratio(value: float, pivot: float) -> float:
    return max(0.0, min(1.0, value / max(1e-6, pivot))) - 0.5


def _frame(seconds: float, frame_sec: float) -> int:
    return int(round(float(seconds) / frame_sec))


def _quantile(values: list[float], q: float) -> float:
    if not values:
        return 0.0
    xs = sorted(values)
    pos = max(0.0, min(1.0, q)) * (len(xs) - 1)
    lo = int(pos)
    hi = min(len(xs) - 1, lo + 1)
    frac = pos - lo
    return xs[lo] * (1 - frac) + xs[hi] * frac


def _run_midi_cleaner_ai(score: CubyScore, options: ScoreCleanupOptions) -> CubyScore:
    url = os.environ["MIDI_CLEANER_AI_URL"]
    headers = {"content-type": "application/json"}
    api_key = os.environ.get("MIDI_CLEANER_AI_API_KEY")
    if api_key:
        headers["authorization"] = f"Bearer {api_key}"

    payload = {
        "score": score.model_dump(),
        "options": options.model_dump(),
        "instruction": (
            "Clean MIDI noise with melody preservation. Do not remove valid piano left/right hand "
            "notes only because they are in different ranges. Preserve the lead melody and musical "
            "harmony; remove non-musical artifacts and recognition noise."
        ),
    }
    timeout = float(os.environ.get("MIDI_CLEANER_AI_TIMEOUT_SEC", "180"))
    with httpx.Client(timeout=timeout) as client:
        resp = client.post(url, headers=headers, json=payload)
        resp.raise_for_status()
        data = resp.json()

    cleaned = data.get("cubyScore") or data.get("score")
    if not cleaned:
        raise RuntimeError("MIDI Cleaner AI response did not include cubyScore")
    return CubyScore.model_validate(cleaned)


def _run_anthem_score(score: CubyScore, options: ScoreCleanupOptions) -> CubyScore:
    template = os.environ.get("ANTHEMSCORE_CLI_TEMPLATE")
    binary = os.environ.get("ANTHEMSCORE_CLI")

    with tempfile.TemporaryDirectory(prefix="cuby-ai-clean-") as tmp:
        in_path = os.path.join(tmp, "input.mid")
        out_path = os.path.join(tmp, "output.mid")
        _write_midi(score, in_path)

        if template:
            command = shlex.split(template.format(input=in_path, output=out_path))
        elif binary:
            command = [binary, in_path, out_path]
        else:
            raise RuntimeError("AnthemScore CLI is not configured")

        logger.info(f"[ai-cleanup] AnthemScore command: {command}")
        subprocess.run(command, check=True, timeout=float(os.environ.get("ANTHEMSCORE_TIMEOUT_SEC", "300")))
        if not os.path.exists(out_path):
            raise RuntimeError("AnthemScore did not produce output MIDI")
        return _read_midi(out_path, source=score, options=options)


def _remove_one_thirty_second_noise(score: CubyScore, options: ScoreCleanupOptions) -> tuple[CubyScore, int]:
    if not options.removeOneThirtySecondNoise:
        return score.model_copy(deep=True), 0

    bpm = float(options.targetBpm or score.meta.bpm or 120)
    min_dur = (60.0 / max(30.0, bpm)) * (4.0 / 32.0)
    removed = 0
    tracks: list[Track] = []
    for track in score.tracks:
        notes = [n for n in track.notes if n.duration >= min_dur]
        removed += len(track.notes) - len(notes)
        tracks.append(track.model_copy(update={"notes": notes}, deep=True))

    meta = score.meta.model_copy(update={"bpm": options.targetBpm or score.meta.bpm})
    return score.model_copy(update={"meta": meta, "tracks": tracks}, deep=True), removed


def _write_midi(score: CubyScore, path: str) -> None:
    bpm = float(score.meta.bpm or 120)
    midi = pretty_midi.PrettyMIDI(initial_tempo=bpm)
    for track in score.tracks:
        program = _program_for_track(track)
        inst = pretty_midi.Instrument(program=program, name=track.name or track.id)
        for note in track.notes:
            start = max(0.0, float(note.time))
            end = max(start + 0.02, start + float(note.duration))
            inst.notes.append(pretty_midi.Note(
                velocity=max(1, min(127, int(note.velocity))),
                pitch=max(0, min(127, int(note.pitch))),
                start=start,
                end=end,
            ))
        midi.instruments.append(inst)
    midi.write(path)


def _read_midi(path: str, source: CubyScore, options: ScoreCleanupOptions) -> CubyScore:
    midi = pretty_midi.PrettyMIDI(path)
    bpm = float(options.targetBpm or source.meta.bpm or 120)
    tracks: list[Track] = []
    for i, inst in enumerate(midi.instruments):
        notes = [
            Note(
                pitch=int(n.pitch),
                time=round(float(n.start), 4),
                duration=round(max(0.01, float(n.end - n.start)), 4),
                velocity=int(n.velocity),
            )
            for n in sorted(inst.notes, key=lambda x: (x.start, x.pitch))
        ]
        if not notes:
            continue
        original = source.tracks[i] if i < len(source.tracks) else None
        tracks.append(Track(
            id=original.id if original else f"track_{i + 1}",
            name=inst.name or (original.name if original else f"Track {i + 1}"),
            instrument=original.instrument if original else "AI Cleaned MIDI",
            notes=notes,
        ))

    if not tracks:
        raise RuntimeError("AI cleanup returned an empty MIDI")

    meta = source.meta.model_copy(update={"bpm": bpm})
    return CubyScore(version=source.version, meta=meta, tracks=tracks)


def _program_for_track(track: Track) -> int:
    text = f"{track.name} {track.instrument}".lower()
    if "bass" in text:
        return 33
    if "guitar" in text:
        return 24
    if "vocal" in text or "人声" in text:
        return 53
    if "string" in text:
        return 48
    if "synth" in text:
        return 81
    return 0


def _count_notes(score: CubyScore) -> int:
    return sum(len(track.notes) for track in score.tracks)
