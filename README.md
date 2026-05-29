# cuby-transcribe

AI 扒谱服务 - 上传音频，自动转 MIDI/CubyScore，专为光遇 15 键设计。

## 架构

```
React 前端 (Vite + Tailwind v4) ──► Node.js (Fastify) ──► Python Agent (FastAPI + Basic Pitch)
                                             │
                                             └──► uploads/ (共享文件)
```

- **web** (端口 5173 dev / 8080 prod)：React + TS + Tailwind v4，含钢琴卷帘 + 光遇 15 键可视化
- **node-backend** (端口 3000)：Fastify + TypeScript，文件上传、任务管理
- **python-agent** (端口 8000)：FastAPI + Basic Pitch (ONNX) + 15 键算法

## 快速开始

### 方式一：Docker Compose（推荐）

```bash
docker-compose up --build
```

打开浏览器 http://localhost:8080

### 方式二：本地三服务并行

**1. Python Agent**
```bash
cd python-agent
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

**2. Node 后端**
```bash
cd node-backend && npm install && npm run dev
```

**3. React 前端**
```bash
cd web && npm install && npm run dev
# → http://localhost:5173 (自动代理 /api → Node)
```

## API

```bash
# 上传扒谱
curl -X POST http://localhost:3000/api/transcribe \
  -F "file=@song.mp3" \
  -F 'options={"transposeToC":true,"simplifyMelody":true,"quantizeGrid":16}'
# => { "taskId": "xxx", "status": "queued" }

# 查询状态
curl http://localhost:3000/api/transcribe/<taskId>
```

## 前端功能

- 🎵 拖拽上传 / 选项面板 / 实时进度
- ▶️ 音频播放器（HTML5 audio + 播放头联动）
- 🎹 **钢琴卷帘**（SVG，自动滚动跟随播放）
- ⭐ **光遇 3×5 键盘可视化**（实时高亮 + 使用热力图）
- 📄 CubyScore JSON 查看 + 一键下载

## 性能基准（Apple M 系列 CPU · ONNX Runtime）

| 音频长度 | 处理耗时 | RTF (实时因子) | 音符数 |
|---------|---------|---------------|--------|
| 5s (冷启动) | 2.93s | 0.587 | 10 |
| 10s | 0.53s | **0.053** | 19 |
| 30s | 2.01s | **0.067** | 57 |
| 60s | 2.14s | **0.036** | 112 |

**结论**：暖机后稳定运行在 **15-30× 实时速度**，1 分钟音频 ~2 秒完成。

跑基准：
```bash
cd python-agent && source .venv/bin/activate
python ../benchmarks/run_bench.py
```

## 当前实现

- ✅ Basic Pitch (ONNX) 音频转 MIDI
- ✅ Krumhansl-Schmuckler 调性检测
- ✅ 自动转 C 调（保留小调 → Am）
- ✅ 15 键映射（音域适配 + 变化音就近匹配 + 节奏量化）
- ✅ 输出 CubyScore v1.1 JSON
- ✅ React 现代前端（卷帘 + 15 键热力图）
- ⏳ Demucs 音轨分离（后续）
- ⏳ Bull 队列 / WebSocket 推送（当前为轮询）

## 目录

```
cuby-transcribe/
├── web/               # React + Vite + Tailwind v4
├── node-backend/      # Fastify + TypeScript
├── python-agent/      # FastAPI + Basic Pitch
├── benchmarks/        # 性能基准脚本
├── docker-compose.yml
└── README.md
```

## 故障排查

**Homebrew git 报 `remote-https`**：用系统自带的 `/usr/bin/git`，或 `brew reinstall git`。

**`basic-pitch` 报 ONNX 缺失**：`pip install onnxruntime`（已在 requirements 中）。

**端口冲突**：3000（Node）/8000（Python）/5173（Vite）/8080（Docker web）。
