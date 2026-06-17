# Cuby Transcribe · AI 扒谱升级 Todo 列表

> 来源：AI 扒谱流程可视化文档整理  
> 更新：2026-06-12

---

## 🔴 P0 — 第一阶段：原始高保真扒谱数据源头（零新依赖）

> 目标：先得到尽可能完整、精细、未被场景化处理污染的原始 MIDI 数据。  
> 原则：第一阶段只做「分轨 + 音符提取」，不做 Sky/25 键适配、不转调、不量化、不简化、不限制同按、不裁剪音域。  
> 第二阶段再基于这份原始数据做演奏适配、简化、移调、量化等处理。

- [x] **默认走 raw 高保真链路**
  - `fidelityMode = "raw"`
  - 人声 + 伴奏默认分离：`vocals / no_vocals`
  - raw 阶段跳过 `sky_mapper.process()` / `process_polyphonic()` 场景化处理
- [x] **关闭 raw 阶段默认 25 键人声适配**
  - `vocalToSky25 = false`
  - 避免第一阶段对 vocals 做 `find_best_shift()` / `apply_shift()` / `adapt_range()`，防止原始音高被改写
- [x] **人声旋律 HMM/Viterbi 状态机**
  - 状态空间：`{rest} ∪ {MIDI 40..84}`
  - 转移矩阵：stay=0.92 / ±1半音=0.025 / ±12半音=0.001 / note↔rest=0.04
  - 解决：音符碎片化 + 八度跳错
- [x] **voicing 滞回阈值替换**
  - 进入阈值 0.6，退出阈值 0.4（替代原单一阈值）
  - 解决：浊音边缘频繁开关产生的碎片
- [x] **八度纠错后处理**
  - 滑窗 1.5s，中位数外的离群点向中位数靠拢一个八度
- [x] **onset 强制拆分同音连击**
  - 调用 `librosa.onset.onset_detect()`
  - 每个 onset 强制切新 note，解决 `do do do` 被合并问题
- [x] **去掉默认 `forceMonophonic`**
  - 允许同时间多音符存在，开启复音输出
- [ ] **检查 raw 伴奏轨是否需要“零过滤”开关**
  - 当前 raw Basic Pitch 仍会丢弃 `<25ms 且极弱`、`velocity < 8` 的毛刺
  - 如果目标是绝对保真，可增加 `strictRaw=true` 时完全保留 Basic Pitch 输出
- [x] **检查 raw 阶段是否应禁止自动左右手拆轨**
  - 已移除 `_run_raw` 中两处 `split_two_hand_tracks()` 调用，第一阶段完全保持原始 stem track 结构

---

## 🟠 P1 — 安装新依赖，精度再提升 30%+（预计 1-2 天）

- [x] **`pip install torchcrepe`** — 替代 PYIN 作为默认 F0 后端
  - 精度从 RPA ~85% 提升至 ~93%，内置 Viterbi 解码
- [ ] **`pip install allin1`** — 一次推理全出音乐分析结果
  - 输出：beat / downbeat / chord / key / section
- [ ] **重写 `quantize_rhythm`** — 基于真实 beat 位置吸附
  - 替代等距 BPM 网格，解决节奏对不上拍问题
- [ ] **新建 `voicing_reducer.py`** — 25 键和弦感知压缩
  - 旋律锁定放高区 C5-C6，根音放低区 C4-B4，同按上限 ≤ 4
  - 黑键精确保留（`clamp_to_range` 而非近似到白键）

---

## 🟡 P2 — 接入端到端模型（质的飞跃，预计 1-2 天）

- [ ] **`pip install pop2piano`** — 接入端到端路线 A
  - 流行歌一步输出钢琴 cover MIDI，作为"专业模式"
- [ ] **`pip install audio-separator[gpu]`** — 升级音源分离
  - Mel-RoFormer 替代 htdemucs，SDR 从 8.5 → 10.2 dB（+20%）
- [ ] **前端新增三档模式切换**
  - 快速模式（Pop2Piano 端到端）/ 精准模式（模块化 Pipeline）/ 专业模式

---

## 🟢 P3 — 建立评测体系

- [ ] **引入 POP909 数据集**，切 30 首作为评测基准
- [ ] **接入 `mir_eval` 评测指标**
  - Note F1 / Chord Accuracy / Voicing Recall
- [ ] **A/B 对比测试**：旧版 vs 新版 vs Pop2Piano

---

## 📁 新增模块文件清单

> 路径：`python-agent/app/pipeline/`

- [ ] 新建 `f0_estimator.py` — 支持 CREPE / PENN / PYIN 三后端
- [ ] 新建 `note_segmenter.py` — HMM/Viterbi 音符切段
- [ ] 新建 `onset_detector.py` — onset 检测 + 同音拆分
- [ ] 新建 `music_analyzer.py` — All-In-One 封装
- [ ] 新建 `beat_quantizer.py` — 真实 beat 吸附量化
- [ ] 新建 `voicing_reducer.py` — 25 键复音压缩（核心）
- [ ] 新建 `pop2piano_backend.py` — 端到端路线
- [ ] 修改 `separator.py` — 加入 Mel-RoFormer 分支
- [ ] 修改 `sky_mapper.py` — 改为 25 键全音域映射，去掉白键约束

---

## ⚠️ 已知 Bug 需修复

- [ ] **时间单位不匹配**：`processor.py` 输出用秒，editor 期望 tick（ppq=480）
  - 在最终输出前调用 `seconds_to_ticks(notes, bpm, ppq=480)`
- [ ] **Basic Pitch 幽灵音符过滤不足**
  - `transcriber.py` 加强：极短+极弱毛刺过滤 / 密度过滤（100ms 窗口内 ≤ 8 音）/ 音域离群过滤
