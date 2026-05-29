# Cursor 提示词包：AI 扒谱后端开发完整方案

> 架构：**Node.js (业务层) + Python (AI Agent 层)**
> 复制对应提示词到 Cursor 即可，已按执行顺序排列。

---

## 🏗️ 整体架构设计

```
┌─────────────────────────────────────────────────────────┐
│  前端（Cuby Sheet Editor）                                │
│  - 音频上传组件                                          │
│  - 处理进度展示                                          │
│  - CubyScore 编辑器                                      │
└───────────────────────┬─────────────────────────────────┘
                        │ HTTP REST
                        ▼
┌─────────────────────────────────────────────────────────┐
│  Node.js 业务后端（Express/Fastify）                       │
│  - 文件上传接收（multer）                                 │
│  - 任务队列管理（Bull + Redis）                           │
│  - 状态轮询/WebSocket 推送                                │
│  - 结果存储（COS/本地）                                   │
│  - 调用 Python Agent                                    │
└───────────────────────┬─────────────────────────────────┘
                        │ HTTP / gRPC / Subprocess
                        ▼
┌─────────────────────────────────────────────────────────┐
│  Python AI Agent 层（FastAPI）                            │
│  - Demucs 音轨分离                                       │
│  - Basic Pitch / SOME 音频转 MIDI                        │
│  - 调性检测 + 转调                                       │
│  - 15 键映射 + 旋律优化                                  │
│  - 输出 CubyScore JSON                                   │
└─────────────────────────────────────────────────────────┘
```

**目录结构：**
```
transcribe-service/
├── node-backend/           # Node.js 业务层
│   ├── src/
│   │   ├── routes/        # API 路由
│   │   ├── services/      # 业务服务
│   │   ├── queue/         # 任务队列
│   │   └── utils/
│   ├── package.json
│   └── Dockerfile
│
└── python-agent/           # Python AI 层
    ├── app/
    │   ├── main.py        # FastAPI 入口
    │   ├── pipeline/      # 处理流水线
    │   │   ├── separator.py    # Demucs
    │   │   ├── transcriber.py  # Basic Pitch
    │   │   ├── key_detector.py # 调性检测
    │   │   ├── transposer.py   # 转调
    │   │   ├── sky_mapper.py   # 15 键映射
    │   │   └── exporter.py     # 导出
    │   └── models/        # 数据模型
    ├── requirements.txt
    └── Dockerfile
```

---

## 📝 提示词 1：项目初始化

```
请帮我初始化一个 AI 扒谱服务项目，目录结构如下：

transcribe-service/
├── node-backend/    # Node.js + TypeScript + Fastify
├── python-agent/    # Python 3.10 + FastAPI
├── docker-compose.yml
└── README.md

要求：
1. node-backend 使用 Fastify + TypeScript，配置 ESLint + Prettier
2. python-agent 使用 FastAPI + Pydantic + uv（包管理）
3. docker-compose 包含：node-backend、python-agent、redis（任务队列）
4. 两个服务通过 HTTP 内部通信（python-agent 监听 8000，node-backend 监听 3000）
5. 生成完整的 package.json、pyproject.toml、Dockerfile、.env.example
6. 编写 README.md，说明启动方式：docker-compose up

技术约束：
- Node 后端不做任何 AI 计算，只负责文件、队列、API
- Python Agent 只做 AI 处理，无业务逻辑
- 两端通过明确的 JSON 契约通信（请定义 OpenAPI schema）
```

---

## 📝 提示词 2：定义 API 契约

```
请为 AI 扒谱服务定义完整的 API 契约（包括前端↔Node、Node↔Python 两层）。

【前端 → Node 后端】REST API：

POST /api/transcribe
- Content-Type: multipart/form-data
- Body: file (audio file, mp3/wav/flac, max 50MB)
- Body: options (JSON):
  {
    "target": "vocal" | "instrument" | "auto",  // 扒什么
    "transposeToC": boolean,                     // 是否转调
    "quantizeGrid": 8 | 16,                      // 节奏量化
    "simplifyMelody": boolean                    // 简化旋律
  }
- Response: { taskId: string, status: "queued" }

GET /api/transcribe/:taskId
- Response: {
    taskId: string,
    status: "queued" | "separating" | "transcribing" | "mapping" | "completed" | "failed",
    progress: 0-100,
    message: string,
    result?: CubyScore,
    error?: string
  }

WebSocket /api/transcribe/:taskId/subscribe
- 推送实时进度

【Node 后端 → Python Agent】内部 API：

POST /internal/process
- Body: {
    audioPath: string,        // Node 上传的本地文件路径
    options: {...}
  }
- Response: {
    success: boolean,
    cubyScore: {...},
    metadata: {
      detectedKey: string,
      bpm: number,
      duration: number,
      noteCount: number
    }
  }

POST /internal/process-async
- 同上但返回 taskId，通过 webhook 回调结果

请生成：
1. Node 端的 TypeScript 类型定义（types/api.ts）
2. Python 端的 Pydantic 模型（app/models/schemas.py）
3. CubyScore 的完整 JSON Schema（参考 cuby sheet 项目的 v1.1 格式）

CubyScore 格式参考：
{
  "version": "1.1",
  "meta": { "title", "composer", "bpm", "timeSignature", "keySignature", "ppq" },
  "tracks": [{ "id", "name", "instrument", "notes": [{ "pitch", "time", "duration", "velocity" }] }]
}
```

---

## 📝 提示词 3：Python Agent - 音轨分离模块

```
请用 Python 实现音轨分离模块（separator.py），技术要求：

1. 使用 Demucs v4（htdemucs_ft 模型，质量最优）
2. 支持两种模式：
   - "vocals": 仅分离人声和伴奏（--two-stems=vocals）
   - "6stems": 分离 6 轨（人声/鼓/贝斯/吉他/钢琴/其他）
3. 自动选择 GPU 或 CPU（torch.cuda.is_available()）
4. 异步执行（不阻塞 FastAPI 事件循环）
5. 详细的进度回调（callback 函数）

接口设计：
```python
class AudioSeparator:
    def __init__(self, model: str = "htdemucs_ft", device: str = "auto"):
        ...
    
    async def separate(
        self,
        audio_path: str,
        output_dir: str,
        mode: Literal["vocals", "6stems"] = "vocals",
        progress_callback: Optional[Callable[[float, str], None]] = None
    ) -> SeparationResult:
        """
        返回 SeparationResult:
        {
            "vocals_path": str,
            "instrumental_path": str,  # 或 6 轨字典
            "duration": float,
            "elapsed": float
        }
        """
```

要求：
- 使用 subprocess 调用 demucs CLI，或直接调用 demucs Python API
- 错误处理：模型未下载时自动下载
- 性能优化：处理完后清理中间文件
- 单元测试：使用 pytest，准备 1 个测试音频文件

依赖：
- demucs >= 4.0
- torch
- torchaudio
- fastapi
```

---

## 📝 提示词 4：Python Agent - 音频转 MIDI 模块

```
请用 Python 实现音频转 MIDI 模块（transcriber.py），支持多种模型：

1. Basic Pitch（Spotify，通用，默认）
2. SOME（OpenVPI，歌声专用，需先下载 ckpt）
3. ByteDance Piano Transcription（钢琴专用）

接口设计：
```python
class Transcriber:
    def __init__(self, model: Literal["basic_pitch", "some", "bytedance"] = "basic_pitch"):
        ...
    
    async def transcribe(
        self,
        audio_path: str,
        progress_callback: Optional[Callable] = None
    ) -> TranscriptionResult:
        """
        返回 TranscriptionResult:
        {
            "notes": [
                {"pitch": int, "start": float, "end": float, "velocity": int}
            ],
            "bpm": float,
            "duration": float
        }
        """
    
    @staticmethod
    def detect_bpm(audio_path: str) -> float:
        """使用 librosa.beat.beat_track 检测 BPM"""
```

要求：
1. Basic Pitch：使用官方 Python API `from basic_pitch.inference import predict`
2. SOME：通过 subprocess 调用 infer.py（如果安装了）
3. ByteDance：使用 piano_transcription_inference 库
4. 统一输出格式（NoteEvent 列表）
5. 自动检测 BPM（用于后续节奏量化）
6. 错误处理：模型不可用时降级到 Basic Pitch

依赖：
- basic-pitch
- librosa
- piano-transcription-inference (可选)

请同时生成：
- 简单的单元测试（用一段钢琴音频验证转录结果）
- 性能基准测试（处理 1 分钟音频的耗时）
```

---

## 📝 提示词 5：Python Agent - 调性检测 + 转调 + 15 键映射

```
请实现光遇 15 键扒谱的核心算法模块，包含三个文件：

【1】key_detector.py - 调性检测
使用 Krumhansl-Schmuckler 算法：

```python
class KeyDetector:
    # Krumhansl-Kessler 调性轮廓
    MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
    MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
    
    @classmethod
    def detect(cls, notes: List[Note]) -> KeyInfo:
        """
        返回 KeyInfo:
        {
            "key": "G",                # 调名
            "mode": "major" | "minor",
            "confidence": 0.85,
            "transposeToC": -7         # 移调到 C/Am 需要的半音数
        }
        """
```

【2】transposer.py - 转调
```python
class Transposer:
    @staticmethod
    def transpose(notes: List[Note], semitones: int) -> List[Note]:
        """整体移调"""
    
    @staticmethod
    def transpose_to_c(notes: List[Note], detected_key: KeyInfo) -> List[Note]:
        """根据检测到的调性，自动转到 C 大调或 A 小调"""
```

【3】sky_mapper.py - 15 键映射 + 旋律优化
```python
SKY_KEYS = [60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 81, 83, 84]
SKY_RANGE = (60, 84)
NATURAL_PCS = {0, 2, 4, 5, 7, 9, 11}

class SkyMapper:
    def __init__(self, options: SkyMapperOptions):
        ...
    
    def process(self, notes: List[Note]) -> List[SkyNote]:
        """
        完整流程：
        1. 音域适配（adapt_range）：整体平移 + 极端音折叠
        2. 变化音处理（resolve_accidentals）：上下文感知就近匹配
        3. 旋律简化（simplify_melody）：去装饰音、合并重复音
        4. 节奏量化（quantize_rhythm）：对齐 1/8 或 1/16 网格
        5. 映射到 15 键
        """
    
    def adapt_range(self, notes): ...
    def resolve_accidentals(self, notes): ...
    def simplify_melody(self, notes, min_duration: float = 0.12): ...
    def quantize_rhythm(self, notes, bpm: float, grid: int = 8): ...
    def map_to_keys(self, notes): ...
```

算法要求（必须严格实现）：
- 音域适配：先计算旋律中心，整体平移八度到 C5 附近，剩余音再做八度折叠
- 变化音处理：根据前后音符判断旋律方向，决定向上还是向下解决变化音
- 旋律简化：删除 < 120ms 的经过音、合并 50ms 内的重复同音
- 节奏量化：基于 BPM 计算每格 tick 数，对齐时间和时值

输出 SkyNote 格式：
{
    "key": 0-14,           # 15 键索引
    "midi_pitch": int,     # 对应 MIDI 值（用于校验）
    "start": float,        # 秒
    "end": float,
    "velocity": 0-127,
    "track": "melody" | "chord"
}

请生成完整代码 + 单元测试 + 算法文档。
```

---

## 📝 提示词 6：Python Agent - 主流水线 + FastAPI

```
请将所有模块组装成完整的 FastAPI 服务（app/main.py）。

【流水线编排】（pipeline/processor.py）：
```python
class TranscribePipeline:
    def __init__(self, config: Config):
        self.separator = AudioSeparator()
        self.transcriber = Transcriber()
        self.key_detector = KeyDetector()
        self.transposer = Transposer()
        self.sky_mapper = SkyMapper()
        self.exporter = CubyScoreExporter()
    
    async def process(
        self,
        audio_path: str,
        options: ProcessOptions,
        progress_callback: Optional[Callable] = None
    ) -> CubyScore:
        """
        完整 6 步流水线：
        1. [10%] 音轨分离 → vocals.wav
        2. [40%] AI 转录 → notes + bpm
        3. [50%] 调性检测 → key_info
        4. [60%] 转调到 C → notes
        5. [85%] 15 键映射 + 优化 → sky_notes
        6. [100%] 导出 CubyScore JSON
        
        每步调用 progress_callback(percent, message)
        """
```

【FastAPI 应用】（app/main.py）：
```python
from fastapi import FastAPI, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Cuby Transcribe Agent")

# 端点：
@app.post("/internal/process")
async def process_sync(request: ProcessRequest) -> ProcessResponse:
    """同步处理（适合短音频 < 30s）"""

@app.post("/internal/process-async")
async def process_async(request: ProcessRequest, background_tasks: BackgroundTasks):
    """异步处理 + webhook 回调"""

@app.get("/internal/status/{task_id}")
async def get_status(task_id: str):
    """查询任务状态"""

@app.get("/health")
async def health():
    """健康检查 + 模型加载状态"""
```

要求：
1. 启动时预加载所有 AI 模型（避免首次请求慢）
2. 任务状态用 Redis 存储（key: task:{id}，含 status/progress/result）
3. 处理完成后调用 webhook URL（如果提供）
4. 异常处理：每步失败时记录详细 trace，返回友好错误
5. 日志：使用 loguru，输出 JSON 格式便于聚合

请生成：
- 完整的 main.py
- pipeline/processor.py
- 完整的 requirements.txt（含版本号）
- Dockerfile（基于 python:3.10-slim，预装 ffmpeg）
```

---

## 📝 提示词 7：Node.js 后端 - 业务层

```
请用 Node.js + TypeScript + Fastify 实现业务层。

【目录结构】：
node-backend/src/
├── app.ts                  # Fastify 实例
├── routes/
│   ├── transcribe.ts      # POST /api/transcribe
│   ├── status.ts          # GET /api/transcribe/:taskId
│   └── websocket.ts       # WS /api/transcribe/:taskId/subscribe
├── services/
│   ├── upload.ts          # 文件上传 + 校验
│   ├── queue.ts           # Bull 队列管理
│   ├── pythonAgent.ts     # 调用 Python Agent（axios）
│   └── storage.ts         # 文件存储（本地/COS）
├── workers/
│   └── transcribeWorker.ts # Bull worker
└── types/
    └── api.ts

【核心功能】：

1. 文件上传（routes/transcribe.ts）：
   - 使用 @fastify/multipart
   - 校验：格式（mp3/wav/flac）、大小（< 50MB）、时长（< 10分钟）
   - 保存到 uploads/{taskId}.{ext}
   - 创建任务并加入队列
   - 返回 { taskId, status: "queued" }

2. 任务队列（services/queue.ts）：
   - 使用 Bull + Redis
   - 队列名：'transcribe'
   - 并发数：根据 GPU 数量配置（默认 2）
   - 失败重试：1 次
   - 进度更新：job.progress(percent)

3. Worker 处理（workers/transcribeWorker.ts）：
   - 调用 Python Agent: POST http://python-agent:8000/internal/process-async
   - 监听 webhook 回调更新状态
   - 处理完成：保存结果 + 通知 WebSocket
   - 处理失败：记录错误 + 通知

4. WebSocket 推送（routes/websocket.ts）：
   - 使用 @fastify/websocket
   - 订阅 taskId 的进度更新
   - 从 Redis pubsub 接收事件

5. 状态查询（routes/status.ts）：
   - GET /api/transcribe/:taskId
   - 从 Redis 读取状态
   - 完成时返回 CubyScore JSON

【依赖】：
- fastify
- @fastify/multipart
- @fastify/websocket
- @fastify/cors
- bull
- ioredis
- axios
- pino (日志)
- zod (校验)

【环境变量】：
- PYTHON_AGENT_URL
- REDIS_URL
- UPLOAD_DIR
- MAX_FILE_SIZE
- MAX_DURATION_SEC

请生成所有文件 + 完整的类型定义 + 错误处理中间件 + 启动脚本。
```

---

## 📝 提示词 8：Docker 部署 + 集成测试

```
请完善 Docker 部署配置并编写集成测试。

【docker-compose.yml】要求：
1. 三个服务：
   - node-backend（端口 3000，依赖 redis 和 python-agent）
   - python-agent（端口 8000，配置 GPU 支持可选）
   - redis（端口 6379，持久化数据）

2. 挂载卷：
   - ./uploads:/app/uploads（共享上传文件）
   - ./output:/app/output（共享输出）
   - python-models:/root/.cache（持久化 AI 模型缓存）

3. 网络：内部网络 cuby-net，仅 node-backend 暴露外部端口

4. 健康检查：每个服务定义 healthcheck

5. 资源限制：python-agent 限制 8GB 内存

【GPU 支持版本】docker-compose.gpu.yml：
- python-agent 添加 deploy.resources.reservations.devices for nvidia
- 基础镜像改为 nvidia/cuda:12.2.0-runtime-ubuntu22.04

【集成测试】tests/integration.test.ts：
1. 启动 docker-compose
2. 准备测试音频（一段 30 秒的流行歌片段）
3. 测试用例：
   - 上传成功 → 返回 taskId
   - WebSocket 订阅 → 收到进度更新
   - 完成 → 返回有效的 CubyScore JSON
   - 验证 CubyScore：
     * 至少有 1 个 track
     * 所有 note.pitch 在 60-84 之间（光遇音域）
     * 所有 note.pitch 是 C 大调自然音
     * notes 按 time 排序

【Traefik 集成】（适配现有项目）：
在 docker-compose.yml 中给 node-backend 添加 labels：
- traefik.http.routers.transcribe.rule=Host(`transcribe.cuby.fun`)
- traefik.http.services.transcribe.loadbalancer.server.port=3000

【README】部署文档：
- 快速启动：docker-compose up -d
- GPU 启动：docker-compose -f docker-compose.gpu.yml up -d
- 测试：npm run test:integration
- 日志查看、故障排查、模型预下载

请生成所有配置文件 + 集成测试 + 详细的部署文档。
```

---

## 📝 提示词 9（可选）：前端集成组件

```
为现有的 Cuby Sheet Editor（React + TypeScript + Vite + Zustand）添加 AI 扒谱入口。

在 editor/src/components/views/ 新增：
1. TranscribeModal.tsx - 上传弹窗
2. TranscribeProgress.tsx - 进度展示
3. useTranscribe.ts - hook

功能要求：
1. 文件上传：拖拽 + 点击，支持 mp3/wav/flac，预览音频
2. 选项面板：
   - 扒谱目标：人声/伴奏/自动
   - 转调到 C：开关（默认开）
   - 节奏量化：1/8 / 1/16
   - 简化旋律：开关（默认开）
3. 进度展示：
   - 实时进度条（WebSocket 连接 ws://backend/api/transcribe/:taskId/subscribe）
   - 阶段提示：分离中/转录中/映射中
   - 预计剩余时间
4. 完成后：
   - 自动加载到编辑器（调用 useEditorStore.setScore）
   - 显示检测到的调性、BPM、音符数
   - 提供"重新扒谱"按钮

API 调用：
```typescript
const response = await fetch('/api/transcribe', {
  method: 'POST',
  body: formData
});
const { taskId } = await response.json();

const ws = new WebSocket(`ws://localhost:3000/api/transcribe/${taskId}/subscribe`);
ws.onmessage = (e) => {
  const { status, progress, message, result } = JSON.parse(e.data);
  if (status === 'completed') {
    useEditorStore.getState().setScore(result);
  }
};
```

UI 风格：
- 使用现有的 TailwindCSS 风格
- 弹窗居中显示，半透明遮罩
- 进度条使用主题色

请生成完整的 React 组件 + hook + 类型定义。
```

---

## 🚀 使用建议

### 推荐执行顺序

```
Day 1: 提示词 1 → 2 → 3        （项目初始化 + API 契约 + 音轨分离）
Day 2: 提示词 4 → 5            （音频转 MIDI + 15 键算法核心）
Day 3: 提示词 6                 （Python 服务整合）
Day 4: 提示词 7                 （Node 后端）
Day 5: 提示词 8                 （Docker + 测试）
Day 6: 提示词 9                 （前端集成）
```

### Cursor 使用技巧

1. **每次只喂一个提示词**，让 Cursor 完整生成后再继续
2. **遇到问题时追加**："上面的 `xxx` 模块报错 `yyy`，请修复"
3. **强制使用最新版本**：在提示词末尾加 "请使用 2025 年最新的库版本"
4. **要求生成测试**：每个提示词都已包含测试要求

### 关键技术决策

| 决策点 | 推荐选择 | 理由 |
|--------|----------|------|
| Node 框架 | Fastify | 比 Express 性能高 2-3 倍 |
| Python 框架 | FastAPI | 异步 + 自动文档 |
| 队列 | Bull + Redis | 成熟稳定，有 UI 监控 |
| 文件存储 | 本地 + 可选 COS | 初期本地即可 |
| 通信 | HTTP REST | 简单可调试 |
| 部署 | Docker Compose | 与现有架构一致 |

### 性能预期

| 处理阶段 | 4 分钟流行歌（CPU） | 4 分钟流行歌（GPU） |
|----------|---------------------|---------------------|
| Demucs 分离 | ~6 分钟 | ~10 秒 |
| Basic Pitch 转录 | ~30 秒 | ~5 秒 |
| 调性检测 + 映射 | <1 秒 | <1 秒 |
| **总耗时** | **~7 分钟** | **~15 秒** |

### 注意事项

⚠️ **首次启动**：Demucs/Basic Pitch 会自动下载模型（约 200MB），需要等待
⚠️ **磁盘空间**：每首歌临时占用约 100MB，建议定期清理 uploads/output
⚠️ **GPU 显存**：Demucs 需要 ≥ 3GB 显存，T4/A10 均可
⚠️ **并发限制**：CPU 模式下并发设为 1，GPU 模式下根据显存调整
