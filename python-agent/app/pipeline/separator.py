"""音轨分离：使用 Meta Demucs - 当前业界最强开源人声/乐器分离。

模式：
  - vocals  : 二轨分离 (vocals / no_vocals)，速度最快
  - 4stems  : 四轨分离 (vocals / drums / bass / other)，htdemucs
  - 6stems  : 六轨分离 (vocals / drums / bass / other / piano / guitar)，htdemucs_6s
"""
from __future__ import annotations
import os
import stat
import subprocess
import sys
import shutil
from datetime import datetime
from pathlib import Path
from typing import Dict, Iterable, Literal, Optional
from loguru import logger


SeparationMode = Literal["none", "vocals", "4stems", "6stems"]

# mode → 默认 demucs 模型名
MODE_MODELS: Dict[str, str] = {
    "vocals": "htdemucs",
    "4stems": "htdemucs",
    "6stems": "htdemucs_6s",
}


def _device() -> str:
    try:
        import torch
        if torch.backends.mps.is_available():
            return "mps"        # Apple Silicon GPU
        if torch.cuda.is_available():
            return "cuda"
        return "cpu"
    except Exception:
        return "cpu"


DEFAULT_MODEL = os.environ.get("DEMUCS_MODEL", "htdemucs")
MAX_RETRIES = int(os.environ.get("DEMUCS_RETRIES", "3"))


def _default_jobs() -> int:
    """CPU 上让 demucs 并行：默认用一半物理核（留资源给 BPM 线程 / OS）。"""
    n = os.cpu_count() or 2
    return max(1, n // 2)


DEMUCS_JOBS = int(os.environ.get("DEMUCS_JOBS", str(_default_jobs())))
DEMUCS_OVERLAP = os.environ.get("DEMUCS_OVERLAP", "0.10")   # 默认 0.25，降到 0.10 显著提速
DEMUCS_SHIFTS = os.environ.get("DEMUCS_SHIFTS", "1")        # 1 = 不做随机平均，最快


def _build_demucs_env() -> tuple[dict[str, str], str | None]:
    """构造 demucs 子进程环境；优先系统 ffmpeg，缺失时尝试 imageio-ffmpeg。"""
    env = dict(os.environ)
    system_ffmpeg = shutil.which("ffmpeg")
    if system_ffmpeg:
        return env, system_ffmpeg

    try:
        import imageio_ffmpeg  # type: ignore

        ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
        ffmpeg_path = Path(ffmpeg_exe).resolve()

        # demucs/librosa 等通常通过 `ffmpeg` 命令名查找，
        # 而 imageio-ffmpeg 提供的是 `ffmpeg-macos-aarch64-vX.Y` 这样的文件名。
        # 这里创建一个稳定的 shim：/tmp/cuby-ffmpeg-shim/ffmpeg -> real binary。
        shim_dir = Path("/tmp/cuby-ffmpeg-shim")
        shim_dir.mkdir(parents=True, exist_ok=True)
        shim = shim_dir / "ffmpeg"
        shim_text = f"#!/usr/bin/env bash\nexec \"{ffmpeg_path}\" \"$@\"\n"
        if (not shim.exists()) or (shim.read_text(encoding="utf-8", errors="ignore") != shim_text):
            shim.write_text(shim_text, encoding="utf-8")
            shim.chmod(shim.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)

        env["PATH"] = str(shim_dir) + os.pathsep + env.get("PATH", "")
        # 某些库会读取 FFMPEG_BINARY / IMAGEIO_FFMPEG_EXE
        env["FFMPEG_BINARY"] = str(shim)
        env["IMAGEIO_FFMPEG_EXE"] = str(ffmpeg_path)
        return env, str(shim)
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[demucs] ffmpeg not found and imageio-ffmpeg unavailable: {e}")
        return env, None


def _python_agent_pid_file() -> Path:
    # .../python-agent/app/pipeline/separator.py -> repo root = parents[3]
    return Path(__file__).resolve().parents[3] / ".run" / "python-agent.pid"


def _append_error_to_pid(summary: str, detail: str) -> None:
    """把关键错误追加到 .run/python-agent.pid，便于线上快速回溯。"""
    try:
        pid_file = _python_agent_pid_file()
        pid_file.parent.mkdir(parents=True, exist_ok=True)

        if not pid_file.exists():
            pid_file.write_text("\n", encoding="utf-8")

        raw = pid_file.read_text(encoding="utf-8", errors="ignore")
        lines = raw.splitlines()
        first = lines[0] if lines else ""

        stamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        summary_clean = summary.replace("\n", " ").strip()
        detail_clean = detail.replace("\n", " | ").strip()[:3000]
        note = f"# [{stamp}] demucs_error: {summary_clean} | detail: {detail_clean}"

        new_body = [first] if first else []
        # 控制体积：最多保留 40 行历史备注
        hist = [ln for ln in lines[1:] if ln.strip()][:39]
        new_body.extend(hist)
        new_body.append(note)
        pid_file.write_text("\n".join(new_body) + "\n", encoding="utf-8")
    except Exception as e:  # noqa: BLE001
        logger.warning(f"append pid error note failed: {e}")


def _pick_demucs_error(stderr: str, stdout: str) -> str:
    """从 demucs 输出中抽取最有信息量的一行，避免只拿到 warnings.warn。"""
    merged = "\n".join([stderr or "", stdout or ""])
    lines = [ln.strip() for ln in merged.splitlines() if ln.strip()]
    if not lines:
        return "unknown"

    bad_prefix = (
        "warnings.warn(",
        "futurewarning",
        "userwarning",
        "/usr/",
        "  warnings.warn",
    )
    good_keys = ("error", "exception", "traceback", "failed", "not found", "no module")

    # 先抓最可行动的问题（优先级最高）
    for ln in reversed(lines):
        low = ln.lower()
        if "ffmpeg is not installed" in low:
            return "FFmpeg is not installed (Demucs cannot decode this audio format)."
        if "could not load file" in low and "maybe it is not a supported file format" in low:
            return ln

    for ln in reversed(lines):
        low = ln.lower()
        if any(k in low for k in good_keys) and not any(low.startswith(p) for p in bad_prefix):
            return ln

    for ln in reversed(lines):
        low = ln.lower()
        if not any(low.startswith(p) for p in bad_prefix):
            return ln

    return lines[-1]


def _prepare_audio_for_demucs(audio_path: str, env: dict[str, str]) -> str:
    """把输入统一转成标准 wav，避免 demucs 在无扩展名/奇怪容器上解码失败。"""
    src = Path(audio_path)
    # 已是 wav 且路径安全时直接使用
    if src.suffix.lower() == ".wav" and src.is_file():
        return str(src)

    ffmpeg_bin = env.get("FFMPEG_BINARY") or shutil.which("ffmpeg", path=env.get("PATH"))
    if not ffmpeg_bin:
        return str(src)

    out_dir = Path("/tmp/cuby-demucs-input")
    out_dir.mkdir(parents=True, exist_ok=True)
    out_wav = out_dir / f"{src.stem}.wav"

    cmd = [
        ffmpeg_bin,
        "-y",
        "-i", str(src),
        "-vn",
        "-ac", "2",
        "-ar", "44100",
        "-f", "wav",
        str(out_wav),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, env=env)
    if proc.returncode != 0 or not out_wav.exists():
        logger.warning(f"[demucs] ffmpeg pre-convert failed, fallback original: {src}")
        logger.warning((proc.stderr or "")[-1200:])
        return str(src)

    logger.info(f"[demucs] pre-convert: {src} -> {out_wav}")
    return str(out_wav)


def _prefetch_model(model: str) -> None:
    """预下载模型并对网络抖动做重试。命中缓存即立即返回。"""
    last_err: Optional[Exception] = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            from demucs.pretrained import get_model
            get_model(model)
            return
        except Exception as e:  # noqa: BLE001
            last_err = e
            logger.warning(f"[demucs] prefetch attempt {attempt}/{MAX_RETRIES} failed: {e}")
            # 清掉 torch hub 里可能残留的 .tmp / 0 字节文件
            cache_dir = os.path.expanduser("~/.cache/torch/hub/checkpoints")
            if os.path.isdir(cache_dir):
                for f in os.listdir(cache_dir):
                    fp = os.path.join(cache_dir, f)
                    if f.endswith(".tmp") or (os.path.isfile(fp) and os.path.getsize(fp) == 0):
                        try: os.remove(fp)
                        except OSError: pass
    raise RuntimeError(f"failed to download demucs model `{model}` after {MAX_RETRIES} attempts: {last_err}")


def separate(
    audio_path: str,
    output_dir: str,
    mode: SeparationMode = "vocals",
    model: Optional[str] = None,
    keep_stems: Optional[Iterable[str]] = None,
    quality: Literal["fast", "high"] = "fast",
) -> Dict[str, str]:
    """运行 Demucs。返回 {stem_name: absolute_path_to_wav}。

    keep_stems: 仅保留指定名字的 stems；其它会被删除以省盘/带宽。
                None 表示保留全部输出。
    """
    os.makedirs(output_dir, exist_ok=True)
    device = _device()
    # 优先 mode→model 映射；用户显式 model 优先
    model = model or MODE_MODELS.get(mode, DEFAULT_MODEL)

    # 第一次会下载模型，做重试避免 CDN 抖动
    _prefetch_model(model)

    if quality == "high":
        overlap = os.environ.get("DEMUCS_OVERLAP_HIGH", "0.25")
        shifts = os.environ.get("DEMUCS_SHIFTS_HIGH", "2")
    else:
        overlap = str(DEMUCS_OVERLAP)
        shifts = str(DEMUCS_SHIFTS)

    cmd = [
        sys.executable, "-m", "demucs.separate",
        "-n", model,
        "-d", device,
        "-o", output_dir,
        "--filename", "{stem}.{ext}",     # 平铺命名
        "--overlap", overlap,
        "--shifts", shifts,
    ]
    # GPU 上多 worker 反而抢显存；只在 CPU 路径开 -j
    if device == "cpu" and DEMUCS_JOBS > 1:
        cmd += ["-j", str(DEMUCS_JOBS)]
    if mode == "vocals":
        cmd += ["--two-stems=vocals"]

    env, ffmpeg_used = _build_demucs_env()
    demucs_input = _prepare_audio_for_demucs(audio_path, env)
    cmd.append(demucs_input)
    logger.info(
        f"[demucs] device={device} model={model} mode={mode} quality={quality} jobs={DEMUCS_JOBS} "
        f"ffmpeg={'none' if not ffmpeg_used else ffmpeg_used} → {output_dir}"
    )
    logger.info("[demucs] cmd: " + " ".join(cmd))
    proc = subprocess.run(cmd, capture_output=True, text=True, env=env)
    if proc.returncode != 0:
        stderr_tail = (proc.stderr or "")[-4000:]
        stdout_tail = (proc.stdout or "")[-2000:]
        logger.error(stderr_tail)
        if stdout_tail:
            logger.error(stdout_tail)
        err_line = _pick_demucs_error(proc.stderr or "", proc.stdout or "")
        _append_error_to_pid(
            summary=err_line,
            detail=f"rc={proc.returncode}; cmd={' '.join(cmd)}; stderr_tail={stderr_tail}; stdout_tail={stdout_tail}",
        )
        if "ffmpeg is not installed" in err_line.lower():
            raise RuntimeError(
                "demucs failed: FFmpeg is not installed and bundled fallback is unavailable. "
                "Install one of: `brew install ffmpeg` or `pip install imageio-ffmpeg`, then restart services and retry."
            )
        raise RuntimeError(f"demucs failed: {err_line}")

    # Demucs 输出到 output_dir/<model>/<track_basename>/<stem>.wav
    track_name = os.path.splitext(os.path.basename(audio_path))[0]
    sub = os.path.join(output_dir, model, track_name)
    if not os.path.isdir(sub):
        # 兜底：在 output_dir 里搜
        for root, _, files in os.walk(output_dir):
            if any(f.endswith(".wav") for f in files):
                sub = root
                break

    # 把所有 stems 复制到 output_dir 根目录下，方便 URL 路由
    stems: Dict[str, str] = {}
    keep_set = {s for s in keep_stems} if keep_stems else None
    for fn in os.listdir(sub):
        if not fn.endswith(".wav"):
            continue
        stem_name = os.path.splitext(fn)[0]  # vocals / drums / bass / other / piano / guitar / no_vocals
        src = os.path.join(sub, fn)
        if keep_set is not None and stem_name not in keep_set:
            try: os.remove(src)
            except OSError: pass
            continue
        dst = os.path.join(output_dir, f"{stem_name}.wav")
        if src != dst:
            shutil.move(src, dst)
        stems[stem_name] = dst

    # 清理 demucs 留下的空目录
    shutil.rmtree(os.path.join(output_dir, model), ignore_errors=True)

    logger.info(f"[demucs] done: {list(stems.keys())}")
    return stems


def default_stem_for_mode(mode: SeparationMode) -> str:
    """根据分离模式，给出默认要转录的 stem。"""
    if mode == "vocals":
        return "vocals"
    if mode == "4stems":
        return "vocals"
    return "original"
