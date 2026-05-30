# 流行歌曲专业级 AI 扒谱 · 调研与升级方案

> 目标：把 cuby-transcribe 的"一键 AI 扒谱"从「能跑」推到「专业可用」——  
> 输入流行歌曲 → 转成 **保留和声的 钢琴 cover** → 落到光遇/Sky **15 个白键** 上的多指演奏谱。  
> 更新：2026-05-30 · v2（修正定位：**复音保留和弦**，不是单音 melody）

---

## 0. 关键定位修正（v2 重要）

**前一版理解错了**："光遇一指弹 → 单音旋律"。  
**真实需求**：光遇 15 键支持**多指同按**，所以专业方案应该是 ——

> **流行歌 → 钢琴 cover 风格简化编配 → 落到 C4–C6 两个八度的 15 个白键**

也就是 **"piano arrangement reduction for Sky 15-key"**。包含三个层次同时存在：
1. **主旋律线**（top voice，可由人声轨提取，最显著）
2. **和弦伴奏**（chord backbone，给和声"撑"起来 —— 没它单音听起来"空"）
3. **简化的低音/根音**（可选；低音落到 C4 octave，与右手错开）

**学术对应任务名**：**Pop-to-Piano transcription / Audio-to-Piano-cover / Piano arrangement reduction**。  
**最相关的 SOTA 工作**：[**Pop2Piano** (Suh et al., ICASSP 2023)](https://arxiv.org/abs/2211.00895) —— 端到端从流行歌 audio 直出钢琴 cover MIDI；正是你要的形态，已开源。详见 §2bis。

---

## 0bis. TL;DR（一页结论 · 修正版）

**核心观点**：放弃"强行单音"，转向 **"复音保留 → 和弦感知简化 → 15 白键 voicing 约束"**。

最简洁的高质量路线：

```
原音 ──► (可选)Demucs vocals 提取
   │
   ├──► [A] 人声轨 → CREPE/PENN + Viterbi → 主旋律线 (top voice)
   │
   └──► [B] 整曲 → Pop2Piano（端到端）→ 钢琴 cover MIDI (双手)
                  ║
                  ║ 或: Demucs 4-stems → other/bass/drums →
                  ║      Chordino / BTC 和弦识别 → 伴奏 voicing 生成
                  ▼
        merge([A 旋律], [B 伴奏和弦]) → quantize-to-beat
                  ▼
        15-key voicing reducer:
          · 旋律放在右手高八度 (C5-C6 白键)
          · 和弦根音/三/五音落到左手低八度 (C4-G4 白键)
          · 黑键 → 调内 voice-leading 就近替换
          · 同帧内 ≥ 4 个音 → 留旋律 + 根音 + 三音（最多 3-4 同按）
                  ▼
        CubyScore (allow polyphony)
```

三件事最优先：
1. **接入 Pop2Piano**（最快路径）：给"和弦保留 + 钢琴风演奏"一个开箱可用的强 baseline。
2. **写一个 15-key voicing reducer**：把任意复音 MIDI（Pop2Piano / Basic Pitch / 你自己的）压成 15 白键内的 ≤3-4 同按和弦，且**旋律最高音永远不被丢**。
3. **和弦感知量化**：每个小节的 downbeat 上用 Chordino / madmom / BTC 拿到当前和弦标签，**在 voicing reducer 里把要保留的非旋律音强制落到该和弦的根/三/五**（或 7th/9th 看密度）—— 这是"AI 扒出来听着对劲"的根本。

详细方案见 §2bis、§3-rev、§4-rev。

---

## 0ter. 旧版 TL;DR（仅供对照，定位是单音 melody 的版本）

当前实现已经搭对了骨架（**Demucs 分离 → PYIN/Basic Pitch → 调性优化 → 15 键映射**），但与「专业级流行歌扒谱」之间还差三件事：

1. **F0 引擎弱**：PYIN 是 2014 年的方案，对带噪 / 残伴 / 滑音 / 混音重的现代 pop 主旋律，会出现**八度跳错、清辅音误判、滑音碎段**。专业方案用 **CREPE / SPICE / PENN / MT-Vocal**（深度学习 F0），并叠 **Viterbi/HMM 平滑** + **八度纠错**。
2. **没有"主旋律选择器"**：去人声后用户希望扒**纯器乐版本主旋律**（前奏/间奏/纯音乐曲）时，你的 `melody_picker` 只用了"最高声部 + 甜区"启发，对真实流行编曲（主旋律时常被合成器、贝斯垫高）准确率有限。专业方案是 **Melodia (salience-based)** 或 **DeepSalience / MSNet (CNN multi-pitch salience)** —— 直接从混音/伴奏里"显著度地图"上提取一条连续旋律线。
3. **节奏/小节没对齐拍点**：你按 BPM 等距网格量化，但流行歌存在 swing、rubato、起拍偏移；专业方案用 **madmom downbeat** 或 **BeatNet** 提供小节起点 + 节拍位置，再做"音符在拍点上吸附 + onset 优先"。

落地优先级：**P0 替换 F0 引擎 + 加 Viterbi/八度纠错 → P1 加节拍对齐 → P2 引入 salience-based 主旋律检测 → P3 数据微调**。

---

## 1. 任务的本质

「流行歌曲扒成 Sky 15 键单旋律谱」=  
**(a)** singing voice separation  
+ **(b)** predominant-melody F0 estimation（带 voicing detection）  
+ **(c)** F0 → note segmentation（含 onset / 时长 / 强度）  
+ **(d)** 节拍/小节网格对齐  
+ **(e)** 调性检测 + 最佳可弹奏调（diatonic 折叠）  
+ **(f)** 音域适配 + 装饰音简化 + 15 键约束

学术上对应两条研究线：

| 子任务 | 经典子任务名 | SOTA 关键词 |
|---|---|---|
| (a) 人声分离 | Music Source Separation / Singing Voice Separation | **Demucs v4 / HT-Demucs**, MDX23, BS-RoFormer, **Mel-RoFormer** |
| (b) 主旋律 F0 | Predominant-F0 / Vocal Pitch Tracking / Melody Extraction | **CREPE**, **SPICE**, **PENN**, **MT-Vocal**, Melodia, DeepSalience, MSNet |
| (c) F0 → notes | Singing Voice Transcription / Note Segmentation | MIR-ST500 baseline, **Sheet-Sage**, **JDC-Note**, **EffNet-b0 SVT**, MuseScore VocalScore |
| (d) 节拍 | Beat / Downbeat Tracking | **madmom**, **BeatNet**, **All-In-One** |
| (e) 调性 | Key Detection | Krumhansl-Schmuckler（你已用），**essentia.KeyExtractor** |
| (f) 简化 | Melody simplification / Diatonic constraint | 自定义；学术上常借 **HMM / Viterbi** + 调内 prior |

---

## 2. 工业界 / 开源界的"专业方案"地图

> 以下都是实际跑得起来、有论文背书、licensing 可商用或 MIT 友好的方案，按层级列出。

### 2.1 人声分离（你已使用 Demucs，整体已经达到 SOTA 边缘）

| 方案 | 论文/团队 | 备注 |
|---|---|---|
| **HT-Demucs (htdemucs)** | Défossez, Meta 2023 | 你**已使用**；MDX'23 季军级别；4 stems；Apache-2.0 |
| **htdemucs_ft** | 同上 fine-tuned | 质量略升、慢 4 倍。建议作为"高质量"开关 |
| **MDX23 / BS-RoFormer / Mel-RoFormer** | ZFTurbo / KimberleyJensen | **2024 SOTA**（vocals SDR 比 htdemucs 再高 1–2 dB）；模型更大（~600 MB），但人声更"干净"，对后续 F0 极有利 |
| **Spleeter** | Deezer 2019 | 已过时，不推荐 |

**给你的建议**：保留 htdemucs 作默认；增加可选 `separationModel: 'mel_roformer'`（Apache 2.0 权重，HuggingFace 上有），仅在用户勾选"高品质模式"时启用。这是"流行歌主旋律稳"最大的单一杠杆 —— 输入 SNR 上去了，下游 F0 就稳。

参考：
- https://github.com/facebookresearch/demucs
- https://github.com/ZFTurbo/Music-Source-Separation-Training（含 Mel-RoFormer 训好权重）

### 2.2 单音 F0 估计（**这是当前最大短板**）

| 方案 | 类型 | 优缺点 | 推荐度 |
|---|---|---|---|
| **PYIN（你当前用的）** | 概率信号处理 | 轻、零依赖；但对**滑音/呼气/混音残伴**易碎、**易八度跳错**；2014 年算法 | ★★ |
| **CREPE** | 深度 CNN（jongwook/marl） | 训练数据含 vocals + 合成乐器；论文级 SOTA-2018；提供 voicing confidence；TF/PyTorch 都有；MIT | ★★★★ |
| **SPICE** | Google self-supervised | 轻量；浏览器都能跑；但 voicing 不带 → 需配合阈值；Apache 2.0 | ★★★ |
| **PENN (Pitch Estimating Neural Networks)** | maxrmorrison 2023 | **当前精度第一**（FCNF0 架构）；提供 PyTorch；MIT | ★★★★★ |
| **TorchCREPE** | jongwook 的 PyTorch 版 | 与 CREPE 等价，能在 CPU/CUDA/MPS；接口干净 | ★★★★ |

**关键升级点（远比换库本身重要）**：

- **Viterbi 解码**：所有现代 F0 估计器都给 [n_frames × n_pitch_bins] 的 salience 矩阵，PYIN/CREPE 都内置 Viterbi。**你现在调 librosa.pyin 没传 viterbi 平滑路径，用的是 argmax+段聚合**，这是"碎/跳"的元凶之一。改用 `crepe.predict(..., viterbi=True)` 或 `penn.from_audio(..., decoder='viterbi')` 立竿见影。
- **八度纠错（octave correction）**：流行 vocals 在弱呼吸/气声段会被 PYIN 报成低八度。专业做法：在 Viterbi 转移矩阵里**强惩罚 ±12 半音跳**；或后处理时窗口众数对齐。
- **voicing 双阈值滞回（hysteresis）**：单一 0.55 阈值会在边缘频繁开关 → 改成 "进入 0.6 / 退出 0.4 "（hysteresis），段更稳。

**参考实现 / 论文**：
- CREPE: https://github.com/marl/crepe ｜ ICASSP 2018, *CREPE: A Convolutional Representation for Pitch Estimation*
- PENN: https://github.com/interactiveaudiolab/penn ｜ ICASSP 2023, *Cross-domain Neural Pitch and Periodicity Estimation*
- TorchCREPE: https://github.com/maxrmorrison/torchcrepe

### 2.3 F0 曲线 → 音符（singing voice transcription）

PYIN/CREPE 给你 10ms 一个 F0 + 浊音概率，但要"切成音符"还需：onset 检测、时长合并、quantize-to-semitone、动态颤音抑制。专业方案：

| 方案 | 思路 | 备注 |
|---|---|---|
| **JDC-Note** (Kum 2019) | 联合训练"是否唱 + F0"，再 HMM 切段 | ISMIR 2019，对人声专精 |
| **MIR-ST500 baseline** | EfficientNet-b0 → onset/offset/pitch | 有公开 PyTorch 实现，对中文/英文歌都好 |
| **VOCANO / Sheet-Sage** | 端到端 vocals → MIDI/lead-sheet | Sheet-Sage 还会顺带做和弦 |
| **传统：HMM viterbi over (semitone, rest)**  | 每帧 41 态（C2..F5 + rest），转移矩阵编码"同音保持 / 邻音过渡惩罚 / 静默切换"，重写本仓 `_segment` | **零额外依赖**，立刻能写，效果远超你当前的"等于上一帧 round 半音就连"逻辑 |

**给你的建议**：P0 阶段不要立刻替换为深度模型；**先把 `melody_extractor._segment` 重写成 HMM/Viterbi**：
- 状态空间：`{rest} ∪ MIDI[40..84]`；
- 观测：当前 F0 round 后 + voicing prob；
- 转移：`P(stay)=0.92 / P(±1 半音)=0.025 / P(rest↔note)=0.04 / P(±12 跳)=0.001 / 其它=低`；
- 结果：**段落天然连续、八度跳错被天然惩罚**，比"medianl漂移阈值"更鲁棒。

ref: Mauch & Dixon, *PYIN*, ICASSP 2014；Kum et al., *JDC*, MDPI 2019。

### 2.4 节拍 / 小节对齐（你目前缺）

`librosa.beat.beat_track` 只给 BPM 和 beat 帧序列，**没有 downbeat（小节起点）**，且对鼓不显著的歌不稳。专业首选：

| 方案 | 备注 |
|---|---|
| **madmom (RNN+DBN beat/downbeat)** | 工业事实标准；BSD；MIDI/ESM 项目都用它 |
| **BeatNet (2021)** | 在线 + 离线 SOTA；CRNN+particle filter；MIT |
| **All-In-One** (Won 2024) | 一并出 beat/downbeat/structure/key；MIT；模型 ~70MB |

接入位置：你现在有了精准 beat 时间序列后，**`quantize_rhythm` 不再用等距 step**，改成"每个 onset 吸附到最近的 beat / sub-beat"，并以 downbeat 划分小节，便于后续展示乐谱。

### 2.5 主旋律 from 整曲混音（伴奏/纯器乐路径）

**纯人声主旋律（vocals.wav）可以用 F0 路线（PYIN/CREPE/PENN）**，但当用户上传纯器乐（`melodyMode != vocal`，扒 `no_vocals` 或 `other`），简单的"最高声部 skyline"对真实编曲不够：bass 上行琶音、合成 pad 颤音、打击乐打出非乐音的高频都会被 skyline 抓到。

学术对应方案：**predominant melody extraction from polyphonic music**（不是分离 + F0，而是直接在多声部里"找一条最显著的线"）：

| 方案 | 思路 | 是否开源 |
|---|---|---|
| **Melodia (Salamon 2012)** | salience contour + 旋律选择启发 | C++ Vamp 插件 (essentia 自带) |
| **DeepSalience (Bittner 2017)** | CNN 输出多基频 salience 图，再选轨 | 有公开权重 |
| **MSNet (Hsieh 2019)** | 轻量 CNN，主旋律 F0 | PyTorch 开源 |
| **MT3 / Multi-Task transformers** | 直接出 MIDI 多轨 | T5-style，要 GPU；可考虑只取主轨 |

**给你的建议**：保留你的 `melody_picker.to_monophonic` 作 fallback；P2 引入 essentia 的 Melodia（pip 装 essentia 即可）作为"伴奏轨主旋律"路径。Melodia 论文经过 12 年验证，在流行歌 lead extraction 上仍是非常稳的 baseline。

### 2.6 一些"端到端"的参考工程（可借鉴的产品形态）

| 项目 | 形态 | 借鉴点 |
|---|---|---|
| **Sheet-Sage** (Donahue 2022) | vocals → 主旋律 + 和弦 → lead sheet | 流水线最像你的需求；CREPE + Madmom + 简化器 |
| **Klangio / Melody Scanner**（商用） | 上传歌曲 → MIDI/MusicXML | 黑盒；流水线被多次反推就是 Demucs+CREPE+HMM+key |
| **AnthemScore**（商用） | piano AMT | 复音强；不适合单旋律 |
| **NeuralNote (DamRsn)** | Basic Pitch 套壳 VST | 与你当前类似 |
| **piano-trans / hFT-Transformer** (Sony 2023) | piano AMT（钢琴专精） | 不是 vocals，但模型设计可借鉴 |

---

## 3. 你当前实现 vs. 专业方案 · 差距清单

| 模块 | 你现在 | 专业方案 | 差距严重度 |
|---|---|---|---|
| 人声分离 | htdemucs（默认） | + 可选 Mel-RoFormer 高品质 | 🟡 中 |
| F0 估计 | PYIN argmax + 段聚合 | CREPE/PENN + **Viterbi** + **八度纠错** + **滞回阈值** | 🔴 **大** |
| F0 → notes | 中位数+漂移阈值切段 | HMM/Viterbi over {rest, semitones} | 🔴 **大** |
| onset | 无（隐含在切段里） | 显式 onset 检测（librosa.onset / madmom RNN onset），与 F0 联合 | 🟠 中大 |
| 节拍 | librosa.beat（无 downbeat） | madmom/BeatNet（含 downbeat） | 🟡 中 |
| 量化 | BPM 等距 step | onset 吸附到 beat/sub-beat 网格 | 🟠 中大 |
| 主旋律（伴奏轨） | skyline + 甜区 bonus | Melodia / DeepSalience / MSNet | 🟡 中 |
| 调性 | KS 算法 | KS（已足）；可加 essentia 交叉验证 | 🟢 小 |
| 最佳可弹奏调 | 白键命中+音域+跨度评分 | 已经做得不错；可加"主音落在白键"额外分 | 🟢 小 |
| 15 键映射 | 折叠+变化音就近+量化+约束 | 不错；建议加 "**phrasing 简化**"——一个小节内同音重复合并 | 🟢 小 |
| 装饰音 | <120ms 一刀切 | 视为颤音/倚音，附加到长音 velocity 包络（高级） | 🟢 小（视产品要求） |

---

## 4. 落地路线图（按优先级）

### P0 · 立刻可做，零新依赖（半天 ~ 一天）

> 目标：在不引入新模型的情况下，让 PYIN 的输出"听起来不再碎/跳"。

1. **打开 viterbi**：`librosa.pyin(..., resolution=0.1)` 已用 viterbi 内核，但**你 round 后又自己切段**，等于丢了平滑结果。改为 **直接对 PYIN 返回的 f0_hz 做窗口中位数 (5–7 帧) → round → HMM/Viterbi over semitone-states**。
2. **HMM 段化重写 `_segment`**：见 §2.3 的状态机。零依赖，纯 numpy。**这一改预期带来最大可感提升**。
3. **voicing 滞回**：进入阈值 0.6、退出阈值 0.4。
4. **八度纠错后处理**：滑窗 1.5s 内若中位数 ±12 半音外离群点，向中位数靠拢。
5. **onset 强化**：调用 `librosa.onset.onset_detect(units='time')`，把每个 onset 强制成新 note 起点（即便 F0 round 后没变也分裂），解决"同音连击合成长音"问题（流行旋律里 `do do do` 会被你合并成单 note）。

### P1 · 工程上换轮子（1–2 天）

1. **接 TorchCREPE 作为 `melodyMode='vocal_pro'`**：保留 PYIN 作 fallback。CREPE small 模型 ~3MB，CPU 也跑得动；MPS/CUDA 提升明显。直接得到 f0+confidence，仍接你重写后的 HMM 段化。
2. **接 madmom 或 BeatNet**：拿到 beats + downbeats，重写 `quantize_rhythm`：
   ```
   for n in notes:
     n.start = nearest_subbeat(n.start, beats, subdiv=4)  # 1/16 网格
     n.end   = max(n.start + min_step, nearest_subbeat(n.end, beats, subdiv=4))
   ```
   并把 downbeats 暴露到 metadata，前端可画小节线。
3. **PYIN 的小节合并 + onset 拆分**结合，得到"既贴拍、又不会粘连重复音"的旋律。

### P2 · 深度增强（按需）

1. **Mel-RoFormer 高品质分离**作为可选项（前端打勾"高品质模式"），后台 ~3× 时间换 ~2 dB SDR，对长副歌很有用。
2. **Melodia 兜底纯器乐路径**（essentia 一行调用，C++ 实现极快）。
3. **JDC-Note / MIR-ST500 baseline 微调**：如果你有标注数据（MIDI + audio 对齐），fine-tune 一个 ~5MB 的 SVT 模型，专对你目标语料（中文流行 / 日系动漫 OST 等）。

### P3 · 数据 / 评估（专业级团队该做的）

1. 建小型评测集：50 首流行歌片段，**人工标注主旋律 MIDI**（用 MuseScore 或直接 piano roll 写）。
2. 跑指标：**COnPOff F-measure**（onset/offset/pitch 联合），**音符级 P/R/F1**（mir_eval.transcription），**Voicing Recall/False-Alarm**（mir_eval.melody）。
3. 每次改算法看指标变化，避免"听感主观跳来跳去"。
4. ref: mir_eval https://github.com/craffel/mir_eval

---

## 5. 关键文献清单（可下载）

| 主题 | 论文 |
|---|---|
| Demucs v4 / HT-Demucs | Défossez, *Hybrid Transformers for Music Source Separation*, ICASSP 2023 ([arXiv:2211.08553](https://arxiv.org/abs/2211.08553)) |
| Mel-RoFormer / BS-RoFormer | Lu et al., *Music Source Separation with Band-Split RoPE Transformer*, ICASSP 2024 ([arXiv:2309.02612](https://arxiv.org/abs/2309.02612)) |
| Basic Pitch | Bittner et al., *A Lightweight Instrument-Agnostic Model for Polyphonic Note Transcription*, ICASSP 2022 ([arXiv:2203.09893](https://arxiv.org/abs/2203.09893)) |
| CREPE | Kim et al., *CREPE: A Convolutional Representation for Pitch Estimation*, ICASSP 2018 ([arXiv:1802.06182](https://arxiv.org/abs/1802.06182)) |
| PENN | Morrison et al., *Cross-domain Neural Pitch and Periodicity Estimation*, ICASSP 2023 |
| PYIN | Mauch & Dixon, *pYIN: A Fundamental Frequency Estimator Using Probabilistic Threshold Distributions*, ICASSP 2014 |
| Melodia | Salamon & Gómez, *Melody Extraction from Polyphonic Music Signals using Pitch Contour Characteristics*, IEEE TASLP 2012 |
| DeepSalience | Bittner et al., *Deep Salience Representations for F0 Estimation in Polyphonic Music*, ISMIR 2017 |
| JDC-Note | Kum & Nam, *Joint Detection and Classification of Singing Voice Melody Using Convolutional Recurrent Neural Networks*, Applied Sciences 2019 |
| Sheet-Sage | Donahue et al., *Sheet Sage: Lead Sheets from Music Audio*, ISMIR 2022 LBD |
| madmom / Beat | Böck et al., *madmom: a new Python Audio and Music Signal Processing Library*, ACM MM 2016 |
| BeatNet | Heydari et al., *BeatNet: CRNN and Particle Filtering for Online Joint Beat Downbeat and Meter Tracking*, ISMIR 2021 |
| All-In-One | Won et al., *A Foundation Model for Music Informatics*, ICASSP 2024 |
| hFT-Transformer | Toyama et al., *Automatic Piano Transcription with Hierarchical Frequency-Time Transformer*, ISMIR 2023 |
| MIR-ST500 SVT | Wang et al., *Preparation, Investigation, and Recommendation of Audio Features for Singing Transcription*, TASLP 2022 |
| mir_eval | Raffel et al., *mir_eval: A Transparent Implementation of Common MIR Metrics*, ISMIR 2014 |

---

## 6. 直接可用的代码骨架（P0 + P1）

> 下面是一个最小重写 `melody_extractor.py` 的伪代码（融合 P0 全部要点 + P1 可选 CREPE 后端）。**仅作参考**，不直接覆盖你的文件。

```python
# F0 后端可插拔
def get_f0(audio_path, backend="pyin"):
    if backend == "crepe":
        import torchcrepe, torchaudio
        wav, sr = torchaudio.load(audio_path)
        wav = torchaudio.functional.resample(wav.mean(0, keepdim=True), sr, 16000)
        f0_hz, periodicity = torchcrepe.predict(
            wav, 16000, hop_length=160,  # 10ms
            fmin=65, fmax=1200, model="full",
            decoder=torchcrepe.decode.viterbi,   # *关键* viterbi
            return_periodicity=True, device="cpu",
        )
        f0_hz = f0_hz[0].numpy(); voicing = periodicity[0].numpy()
        return f0_hz, voicing, 0.010
    else:  # pyin
        ...

# voicing 滞回
def hysteresis(voicing, hi=0.6, lo=0.4):
    out = np.zeros_like(voicing, dtype=bool)
    state = False
    for i, v in enumerate(voicing):
        state = (state and v > lo) or (not state and v > hi)
        out[i] = state
    return out

# HMM/Viterbi semitone 段化
def viterbi_semitone(f0_hz, voiced_mask, midi_min=40, midi_max=84):
    # states: 0=rest, 1..N=midi_min..midi_max
    N = midi_max - midi_min + 1 + 1
    log_obs = np.full((len(f0_hz), N), -1e9)
    for t, (hz, voi) in enumerate(zip(f0_hz, voiced_mask)):
        if not voi or hz != hz or hz <= 0:
            log_obs[t, 0] = 0.0  # rest 强观测
        else:
            midi = 69 + 12*np.log2(hz/440)
            for s in range(1, N):
                target = midi_min + (s - 1)
                # 高斯式：σ ≈ 0.6 半音
                log_obs[t, s] = -0.5 * ((midi - target)/0.6)**2
            log_obs[t, 0] = -3.0  # rest 弱观测
    # 转移：log P
    logA = np.full((N, N), -8.0)
    for s in range(N):
        logA[s, s] = np.log(0.92)        # stay
        if s > 0:
            logA[s, 0] = np.log(0.04)    # note → rest
        if s == 0:
            logA[0, s] = np.log(0.04 / max(1, N-1))  # rest → any note (uniform)
        for ds in (1, -1):
            ns = s + ds
            if 1 <= ns < N: logA[s, ns] = np.log(0.025)  # ±1 半音
        for ds in (12, -12):
            ns = s + ds
            if 1 <= ns < N: logA[s, ns] = np.log(0.001)  # 八度跳 极低概率
    # 标准 viterbi
    path = viterbi_decode(log_obs, logA)
    return path  # array of state indices per frame

# onset 拆分：相邻同 state 帧若中间有 onset → 拆成两个 note
def split_by_onsets(states, frame_dt, onset_times):
    ...
```

---

## 7. 给前端 / 产品的小建议（与算法配套）

1. 处理完后，**显示置信度**：voicing recall、key confidence、tempo confidence；让用户知道哪段"AI 不确定"，可点击试听原片段。
2. 在 15 键键盘上，对**置信度低 / 落在变化音被强行修正的音符**用浅色或叹号标记；点开能看"AI 觉得这是 G#，但被改成了 G"。
3. 「一键扒旋律」结果默认勾选 **"原音轨试听 vs. AI 旋律切换"**，让用户秒判对错。
4. 节拍/小节出来后，给乐谱画小节线（4/4 一小节 4 beat），可读性飞跃。

---

## 8. 风险与注意

- **版权**：所有上述模型的权重大多 MIT/Apache，但用户上传的歌曲是有版权的；不得商业化转售扒出来的谱（这是产品法律风险，与你算法无关）。
- **CPU 冷启动**：CREPE full 模型 ~80MB，首次 load 慢；用 small/tiny + viterbi 通常已超过 PYIN 质量。
- **实时性**：当前 pipeline 60s 音频 ~13s（含分离）；P1 加 CREPE/madmom 预计 +3–5s（CPU），可接受；Mel-RoFormer 会到 ~30s，作为可选高品质开关。

---

## 9. 立即下手的 3 个最小 PR

1. **`melody_extractor.py` 重写为 HMM/Viterbi + voicing 滞回 + onset 拆分**（零依赖，§4 P0）。
2. **加 `f0Backend` 选项**：`"pyin" | "crepe"`，后端用 torchcrepe（可选依赖，懒加载）。
3. **加 `beat_aligner.py`**：先 librosa beat → 后续可平替 madmom/BeatNet；`quantize_rhythm` 改成"吸附到 beat 网格"。

完成这三件，扒出来的谱**听感上会跨一大档**，并且 API/前端不需要破坏性改动。

---
---

# v2 增补 · 复音保留 / 钢琴 cover / 15 键 voicing reduction

> 以下是修正定位后（保留和弦、不强行单音）新增的核心内容。结合 §0、§0bis 一起读。

## 2bis. 复音保留路线的方案地图

### 2bis.1 端到端 Pop → Piano（最快路径）

| 方案 | 说明 | 是否开源 / 可用 |
|---|---|---|
| **Pop2Piano** (Suh et al., ICASSP 2023, arXiv 2211.00895) | T5-style transformer，输入流行歌 audio，**直接输出钢琴 cover MIDI**，含旋律 + 伴奏。训练数据来自 YouTube"流行歌→钢琴翻奏"成对样本。 | ✅ MIT，权重在 HuggingFace `sweetcocoa/pop2piano`，PyPI `pip install pop2piano` 直接可用 |
| **PiCoGen / PiCoGen2** (Lin et al., 2024) | 两阶段：先 lead sheet（旋律+和弦）再钢琴 voicing。可控性更好。 | ✅ 开源（github.com/tanchihpin0517/PiCoGen） |
| **AudioLDM2-Piano-Cover** | 生成式 Diffusion，质量参差但风格化强 | 实验级，不推荐生产 |
| **Klangio Audio-to-MIDI**（商用 API） | 直接出钢琴 MIDI；闭源 | 收费 |

**强烈建议**：把 Pop2Piano 作为「**专业模式**」一键扒谱后端。它解决了你 90% 的问题——它给出的 MIDI 已经是有旋律 + 有和弦伴奏的"双手钢琴谱"，你只需做一道 **15 键 voicing reduction** 就能落到光遇键盘。

### 2bis.2 模块化路线（更可控、可调）

如果想要完全可控、不依赖端到端模型（Pop2Piano CPU 推理 ~1× 实时，权重 ~1GB），可以走"分离 + 复音转录 + 和弦识别 + 编排"的模块化路径：

```
原音 ──► Demucs 4-stems
         ├── vocals      → CREPE+Viterbi → 主旋律 (右手 top voice)
         ├── bass        → Basic Pitch / pYIN → 根音线 (左手 bass)
         ├── other       → Basic Pitch (复音)  → 中声部 pad/chord
         └── drums       → BeatNet/madmom     → beat & downbeat
                            │
                            ▼
                     Chord Recognition (BTC / Chordino / madmom-chords)
                     得到 [(t_start, t_end, "C", "Am", ...)] 序列
                            │
              ┌─────────────┴────────────┐
              ▼                           ▼
   每个 beat-step 的 voicing 选择       旋律保留
   = chord_tones(C major: C-E-G)       (top 不能丢)
              ▼
   合并 → 15-key reducer → CubyScore (复音)
```

涉及的技术点：

#### A. 和弦识别（Chord Recognition）

| 方案 | 备注 |
|---|---|
| **Chordino (NNLS-Chroma)** | C++ Vamp 插件；可经 Sonic Annotator CLI 调；轻量；输出小写/大写和弦 | 
| **BTC (Bi-directional Transformer for Chord recognition)** (2019) | PyTorch；large-vocab；流行歌 ~80% F1 | 
| **madmom CRFChordRecognitionProcessor** | 与 madmom beat 配套，少依赖 | 
| **All-In-One** (Won 2024) | beat / downbeat / structure / **chord / key** 全出 | 
| **Crema-pp** | librosa 团队，开源稳定 | 

**首选**：All-In-One（一次推理拿到 beat+downbeat+chord+key+section），仓库 `mir-aidj/all-in-one` MIT。

#### B. 复音 AMT（钢琴/通用）

| 方案 | 用途 |
|---|---|
| **Basic Pitch**（你已用） | 通用复音 baseline |
| **Onsets&Frames** (Magenta) | 钢琴专精，老牌 SOTA |
| **hFT-Transformer** (Sony 2023) | 钢琴 SOTA；MAESTRO F1 ≈ 88% |
| **MT3 / YPTF.MoE** (Gardner 2022 / 2024) | 多乐器多轨道 transformer；可只取 piano 轨 |

#### C. Lead-sheet / arrangement 生成（学术）

| 论文 | 关键词 |
|---|---|
| **PopMAG** (Ren et al., MM 2020) | 流行歌多轨道伴奏生成 |
| **SongGen / AccoMontage** (Zhao 2021) | chord progression → piano accompaniment style |
| **Audio2Score** (Sheng 2024) | end-to-end 流行 audio → MusicXML lead sheet |
| **Sheet Sage** (Donahue 2022) | vocals → 旋律 + 和弦 → lead sheet |

### 2bis.3 15 键 voicing reduction（**这是你必须自己写的部分**）

无论用 Pop2Piano 还是模块化路线，最终都要把"任意复音 MIDI"压缩到 **C4-C6 两个八度的 7 个白键 ×2 = 15 个键**，并保持**听感上和弦/旋律仍然成立**。这是个"piano voicing constraint"问题，文献关键词 **automatic piano reduction / score reduction**（Chiu & Chen 2009、Nakamura 2015）。

实战可用的简化算法：

```
对每个时间网格步 (sub-beat):
  notes_on = 当前正在持续的所有音
  if 没有音: continue

  # 1. 锁定旋律：选 top voice = max pitch among "melody-track" 输入
  melody = top(notes_on ∩ melody_track)
  把 melody 折叠到 [C5, C6] 的白键八度 (右手区)

  # 2. 锁定根音：当前 chord 标签的 root pitch class
  bass = chord.root, 折叠到 [C4, B4] 的白键
  if root 是黑键 (e.g. F#major): 用 chord.root 在 C 大调里的就近白键替代 (F# → F or G，看下一拍走向)

  # 3. 填充和弦音：从 chord_tones \ {root, melody_pc} 里挑 1-2 个，落到 [D4..A4] 白键区
  #    优先级：3rd > 5th > 7th；都不在白键就调内 voice-leading 替换
  fillers = pick(chord.tones, k=min(2, 4 - 已选数量), 偏好白键)

  # 4. 黑键 → 白键就近映射 (你已有 resolve_accidentals)，
  #    但必须知道当前 chord 才能决定方向 —— 这就是为什么需要 chord-aware

  # 5. 同按数量上限：默认 max_simultaneous = 4 (玩家 4 指可控)
  if len(selected) > 4: drop 优先级 = filler-7th > filler-5th > 重复音
```

**关键设计点**：
1. **旋律永远不丢**：voicing reducer 输入要标好"哪些音是旋律"。
2. **黑键解决依赖和弦**：旋律里的 F# 在 G7 chord 下解决到 G（上行），在 D chord 下解决到 F（=E 的就近）；目前你的 `resolve_accidentals` 只看前后音方向，**接入 chord 标签后会精确得多**。
3. **同按数量节流**：光遇用户多数 2-3 指弹，4 指已是高阶；超过 4 个同时要砍。
4. **节奏疏密控制**：副歌可全和弦 + 旋律，主歌可只留 root + melody（更"空"更动人）。结构信息来自 All-In-One 的 section 标签。

学术参考：
- Chiu & Chen, *Automatic system for the arrangement of piano reductions*, ISMIR 2009  
- Nakamura & Sagayama, *Automatic Piano Reduction from Ensemble Scores*, ICASSP 2015  
- Chou et al., *Automatic Piano Reduction with Pitch Salience*, ISMIR 2021

### 2bis.4 数据集（用来训练 / 评测自家 reducer）

- **POP909** (Wang 2020)：909 首流行中文歌的钢琴 MIDI 标注，含 melody / bridge / piano 三轨；MIT；这是最贴近你需求的数据集。
- **Lakh MIDI**: 大规模通用 MIDI 库
- **GiantMIDI-Piano** (Bytedance 2020)：万首钢琴 MIDI（自动转录），可作钢琴风格目标
- **Pop2Piano dataset**：YouTube 流行→翻奏配对（论文中有清单脚本）

---

## 3-rev. 修正版差距清单（v2）

| 模块 | 你现在 | 复音保留方案 | 差距 |
|---|---|---|---|
| 任务定位 | 强行单音（`forceMonophonic` + `melody_picker.to_monophonic`） | **保留复音 + 和弦感知** voicing | 🔴 **方向偏了** |
| 复音转录 | Basic Pitch（你已有，但被 skyline 浪费了） | Basic Pitch / Pop2Piano | 🟢 已有，只是被错误后处理 |
| 和弦识别 | ❌ 完全没有 | All-In-One / Chordino / BTC | 🔴 **缺失** |
| 节拍/小节 | librosa.beat (无 downbeat) | All-In-One / madmom / BeatNet | 🟠 中 |
| Voicing reducer | `sky_mapper` 单音对单音映射 | 多音 → ≤4 同按 + 旋律保留 + 调内填充 | 🔴 **缺失** |
| 黑键解决 | 仅看前后音方向 | + 当前和弦标签 → 调内 voice-leading | 🟠 中 |
| 端到端备选 | ❌ 无 | **Pop2Piano** 一键路径 | 🟠 强烈建议接 |

---

## 4-rev. 修正版路线图（v2 · 复音保留为主线）

### P0' · 改方向（半天）

1. **去掉默认的 `forceMonophonic`**：把它降级为可选（保留给"我就要单音"的用户）。
2. **让 `sky_mapper` 接受复音输入**：不要再"每帧只留一个音"。允许同 `time` 上多 note。
3. **`constrain_to_sky` + `resolve_accidentals` 复音化**：每个音独立判定；同帧若有重复 pitch 则去重；同帧 ≥ 5 音先按 (是否旋律 → velocity → 是否在中央八度) 排序留前 4。
4. **CubyScore 自然支持复音**（你已是 `notes:[{time,duration,pitch}]`，无需改 schema）。

### P1' · 接和弦识别（1 天）

1. `pip install all-in-one`（mir-aidj/all-in-one），一次调用得到 `beats / downbeats / chords / key / sections`。
2. 新增 `pipeline/chord_detector.py`，输出 `[(t_start, t_end, root_pc, quality, bass_pc)]`。
3. 改造 `resolve_accidentals` 为 **chord-aware**：黑键 → 看当前 chord 的调内最近音替代（如 G7 chord 中 F → F 保留；C chord 中 F# → G）。
4. metadata 暴露 chord progression，前端在 piano-roll 上方显示和弦标签。

### P2' · 加 voicing reducer（1-2 天）

1. 新建 `pipeline/voicing_reducer.py`：接口 `reduce(notes, chords, beats, melody_mask, max_voices=4)`。
2. 旋律标记：从 vocals + CREPE 拿到的旋律 timeline，给每个音打 `is_melody=True`。
3. 在每个 sub-beat 网格上，按 §2bis.3 的算法挑选 voicing（root + melody + ≤2 fillers）。
4. 落地白键 + 八度折叠（旋律→C5–C6，根音→C4–B4，filler→D4–A4）。

### P3' · 接入 Pop2Piano（可选，作"专业模式"）

1. `pip install pop2piano` + 下载权重（~1.2GB，首次启动预热）。
2. 新增端点 `mode=pop2piano`：直接调 `Pop2Piano.predict(audio_path)` → `pretty_midi.PrettyMIDI`。
3. 解析 PrettyMIDI 两轨（左右手）→ 标注 `is_melody`（右手最高音）→ 进同一 voicing reducer → 出 CubyScore。
4. 性能：CPU ~1× 实时（60s 歌 ~60s）；GPU/MPS ~5× 实时。建议挂在异步队列 + 进度回调。

### P4' · 评测

- 用 POP909 切 30 首作评测集，自动测：
  - mir_eval.transcription Note F1（pitch + onset）
  - 和弦帧准确率（mir_eval.chord）
  - "可弹性"指标：同帧最大并发 ≤ 4 的占比、白键命中率、无重复音占比
- 对比：你旧版（强单音）vs 新版（复音+和弦）vs Pop2Piano+reducer。

---

## 5-rev. 新增文献清单（复音保留方向）

| 主题 | 论文 |
|---|---|
| Pop2Piano | Suh et al., *Pop2Piano: Pop Audio-based Piano Cover Generation*, ICASSP 2023 ([arXiv:2211.00895](https://arxiv.org/abs/2211.00895)) |
| PiCoGen | Lin et al., *PiCoGen: Generate Piano Covers with a Two-stage Approach*, ICMR 2024 |
| BTC chord | Park et al., *A Bi-directional Transformer for Musical Chord Recognition*, ISMIR 2019 |
| All-In-One | Won et al., *A Foundation Model for Music Informatics*, ICASSP 2024 ([github](https://github.com/mir-aidj/all-in-one)) |
| POP909 | Wang et al., *POP909: A Pop-song Dataset for Music Arrangement Generation*, ISMIR 2020 |
| Piano Reduction | Chiu & Chen 2009; Nakamura & Sagayama 2015; Chou 2021 |
| Onsets&Frames | Hawthorne et al., *Onsets and Frames: Dual-Objective Piano Transcription*, ISMIR 2018 |
| MT3 | Gardner et al., *MT3: Multi-Task Multitrack Music Transcription*, ICLR 2022 |

---

## 6-rev. 推荐的最小可行 PR 清单（v2 修正后）

1. **`processor.py`** 中默认关掉 `forceMonophonic`；新增 `arrangementMode: "monophonic" | "polyphonic" | "pop2piano"` 选项。
2. **`sky_mapper.py` 复音化**：去掉"同帧只留一个音"逻辑；加 `max_simultaneous=4` 截断（按显著度）。
3. 新建 **`chord_detector.py`**（接 All-In-One 或 madmom）→ 输出 chord 序列；存到 metadata。
4. 改造 **`resolve_accidentals`** → `resolve_accidentals_chord_aware(notes, chords)`。
5. 新建 **`voicing_reducer.py`**：根 + 旋律 + filler 三层选择，落到 15 白键。
6. （可选）新增 **`pop2piano_backend.py`**：懒加载，作"专业模式"。
7. 前端 ScoreViewer：piano-roll 上方画 chord 标签、小节线、section 色块（用 All-In-One 的 sections）。

---

## 7-rev. 一句话总结

> **"流行歌专业级扒谱 = Pop2Piano 端到端 / 模块化(分离+AMT+和弦+beat) → 15 键 voicing reducer (旋律保留 + 根音 + ≤2 filler + 白键约束)"**。  
> 当前代码骨架可复用，但要**砍掉强单音逻辑**、**加和弦识别**、**写复音 voicing reducer** —— 这三步是从"能跑"到"专业"的核心跨越。

