# cuby-transcribe

AI 扒谱服务 - 上传音频，自动转 MIDI/CubyScore，专为光遇 15 键设计。

## 架构

```
前端 (静态测试页) ──► Node.js (Fastify) ──► Python Agent (FastAPI + Basic Pitch)
                              │
                              └──► uploads/ (共享文件)
```

- **node-backend** (端口 3000)：文件上传、API、状态管理
- **python-agent** (端口 8000)：Basic Pitch 音频转录 + 15 键映射
- **web** (端口 8080，可选)：极简测试页

## 快速开始

### 方式一：Docker Compose（推荐）

```bash
docker-compose up --build
```

打开浏览器：
- 测试页：http://localhost:8080
- Node API：http://localhost:3000/health
- Python Agent：http://localhost:8000/docs

### 方式二：本地开发

**1. 启动 Python Agent**
```bash
cd python-agent
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

**2. 启动 Node 后端**
```bash
cd node-backend
npm install
npm run dev
```

**3. 打开测试页**
```bash
cd web && python3 -m http.server 8080
```

## API

### 上传扒谱
```bash
curl -X POST http://localhost:3000/api/transcribe \
  -F "file=@song.mp3" \
  -F 'options={"transposeToC":true}'
# => { "taskId": "xxx", "status": "queued" }
```

### 查询状态
```bash
curl http://localhost:3000/api/transcribe/<taskId>
```

## 当前实现

- ✅ Basic Pitch 音频转 MIDI（CPU/GPU 自动适配）
- ✅ Krumhansl-Schmuckler 调性检测
- ✅ 自动转 C 调
- ✅ 15 键映射（音域适配 + 变化音就近匹配）
- ✅ 输出 CubyScore v1.1 JSON
- ⏳ Demucs 音轨分离（后续）
- ⏳ Bull 队列（当前为内存任务表）

## 目录

```
cuby-transcribe/
├── node-backend/      # Fastify + TypeScript
├── python-agent/      # FastAPI + Basic Pitch
├── web/               # 极简前端测试页
├── docker-compose.yml
└── README.md
```
