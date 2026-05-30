from pydantic import BaseModel, Field
from typing import List, Literal, Optional


SeparationMode = Literal["none", "vocals", "4stems", "6stems"]
TranscribeStem = Literal[
    "original", "vocals", "no_vocals", "drums", "bass", "other", "piano", "guitar",
]


class ProcessOptions(BaseModel):
    transposeToC: bool = True
    quantizeGrid: Literal[8, 16] = 16
    simplifyMelody: bool = True

    # 音轨分离（Demucs）
    separationMode: SeparationMode = "none"
    # 要扒哪条音轨；为 None 时根据 separationMode 自动决定
    transcribeStem: Optional[TranscribeStem] = None
    # 用户实际想要保留的 stems 名单；为 None 时保留全部 demucs 输出
    stems: Optional[List[str]] = None

    # —— 旋律提取模式 ——
    # auto    : 走 Basic Pitch（复音；适合纯器乐扒主旋律 / 复音编配）
    # vocal   : 仅对 vocals stem 启用 PYIN 单音提取（针对流行歌人声主旋律最佳）
    melodyMode: Literal["auto", "vocal"] = "auto"

    # —— 编配模式（v2 关键开关）——
    # polyphonic : 保留和弦/和声 → 15 键多指演奏谱（推荐 · 听感接近原曲）
    # monophonic : 强行单音主旋律（旧版默认；只有一根线条）
    # 默认 polyphonic：流行歌纯单音听起来太空，光遇 15 键支持多指同按。
    arrangementMode: Literal["polyphonic", "monophonic"] = "polyphonic"

    # —— 同时按键上限（仅 polyphonic 模式生效）——
    # 流行歌钢琴 cover 通常 2-4 指，光遇玩家上限实际也 4 指可控。
    maxSimultaneous: int = 4

    # —— 启用和弦识别 ——
    # 仅 polyphonic 模式下会真正参与 voicing；monophonic 时仅作元数据展示。
    detectChords: bool = True

    # —— 强制单旋律（兼容旧字段，等价 arrangementMode='monophonic'）——
    # 保留此字段是为了不破坏旧前端；新代码请用 arrangementMode。
    forceMonophonic: bool = False

    # —— 最佳可弹奏调搜索 ——
    # 开启后会枚举 12 个移调候选，挑「自然音命中率 + 音域贴合」最高的一个，
    # 并在 metadata.recommendedShift 输出建议的游戏内升降调键。
    # 与 transposeToC 互斥：若同时开，optimizePlayKey 优先。
    optimizePlayKey: bool = False


class ProcessRequest(BaseModel):
    audioPath: str
    options: ProcessOptions = Field(default_factory=ProcessOptions)
    taskId: Optional[str] = None


class Note(BaseModel):
    pitch: int
    time: float
    duration: float
    velocity: int = 90


class Track(BaseModel):
    id: str
    name: str
    instrument: str
    notes: List[Note]


class Meta(BaseModel):
    title: str = "Untitled"
    composer: str = "AI Transcribed"
    bpm: float = 120.0
    timeSignature: str = "4/4"
    keySignature: str = "C"
    ppq: int = 480


class CubyScore(BaseModel):
    version: str = "1.1"
    meta: Meta
    tracks: List[Track]


class StemInfo(BaseModel):
    name: str
    url: str
    duration: float


class ChordSegment(BaseModel):
    start: float
    end: float
    label: str  # 如 "C", "Am", "G7", "F"
    root: int   # 0..11 pitch class
    quality: str  # "maj" | "min" | "dim" | "aug" | "maj7" | "min7" | "7" | "sus" | "N" (no chord)


class Metadata(BaseModel):
    detectedKey: str
    detectedMode: str
    bpm: float
    duration: float
    noteCount: int
    elapsed: float
    transcribedStem: str
    # 进入旋律提取阶段实际使用的算法：'basic_pitch' | 'pyin'
    melodyAlgo: str = "basic_pitch"
    # 实际生效的编配模式：'polyphonic' | 'monophonic'
    arrangementMode: str = "polyphonic"
    # 全曲同时按键峰值（polyphonic 模式下的 voicing 信息）
    maxConcurrent: int = 1
    # 识别到的和弦序列（每段 [start,end,label] e.g. "C","Am","G7"）
    chords: Optional[List[ChordSegment]] = None
    # 最佳可弹奏调搜索建议玩家在游戏内按下的「升降调键」半音数（正=升）。
    # None 表示未启用 optimizePlayKey。
    recommendedShift: Optional[int] = None
    # 推荐升调键对应的「玩家手感调」（C / D / Eb …），方便 UI 显示
    playableKey: Optional[str] = None


class ProcessResponse(BaseModel):
    success: bool
    cubyScore: Optional[CubyScore] = None
    metadata: Optional[Metadata] = None
    stems: List[StemInfo] = Field(default_factory=list)
    taskId: Optional[str] = None
    error: Optional[str] = None
