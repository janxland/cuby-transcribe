#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_DIR="$ROOT_DIR/.run"
LOG_DIR="$ROOT_DIR/.logs"

mkdir -p "$PID_DIR" "$LOG_DIR"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[error] missing command: $1"
    exit 1
  fi
}

is_running() {
  local pid="$1"
  kill -0 "$pid" >/dev/null 2>&1
}

check_service_not_running() {
  local name="$1"
  local pid_file="$PID_DIR/$name.pid"

  if [[ -f "$pid_file" ]]; then
    local pid
    pid="$(cat "$pid_file")"
    if [[ -n "$pid" ]] && is_running "$pid"; then
      echo "[cleanup] stopping previous $name (pid=$pid)"
      kill "$pid" >/dev/null 2>&1 || true

      for _ in {1..20}; do
        if ! is_running "$pid"; then
          break
        fi
        sleep 0.2
      done

      if is_running "$pid"; then
        echo "[cleanup] force killing previous $name (pid=$pid)"
        kill -9 "$pid" >/dev/null 2>&1 || true
      fi
    fi
    rm -f "$pid_file"
  fi
}

bootstrap_python() {
  local service_dir="$ROOT_DIR/python-agent"

  require_cmd python3

  if [[ ! -d "$service_dir/.venv" ]]; then
    echo "[setup] creating python virtual env..."
    python3 -m venv "$service_dir/.venv"
  fi

  if [[ ! -f "$service_dir/.venv/.deps_ok" ]] || [[ "${FORCE_INSTALL:-0}" == "1" ]]; then
    echo "[setup] installing python deps..."
    "$service_dir/.venv/bin/pip" install -r "$service_dir/requirements.txt"
    touch "$service_dir/.venv/.deps_ok"
  fi
}

bootstrap_node() {
  local service_dir="$1"

  require_cmd node
  require_cmd npm

  if [[ ! -d "$service_dir/node_modules" ]] || [[ "${FORCE_INSTALL:-0}" == "1" ]]; then
    echo "[setup] npm install in $(basename "$service_dir")..."
    (cd "$service_dir" && npm install)
  fi
}

start_python_agent() {
  local name="python-agent"
  local service_dir="$ROOT_DIR/python-agent"
  local log_file="$LOG_DIR/$name.log"
  local pid_file="$PID_DIR/$name.pid"

  echo "[1/3] starting $name on :8000"
  (
    cd "$service_dir"
    exec "$service_dir/.venv/bin/python" -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
  ) >"$log_file" 2>&1 &

  echo "$!" > "$pid_file"
}

start_node_backend() {
  local name="node-backend"
  local service_dir="$ROOT_DIR/node-backend"
  local log_file="$LOG_DIR/$name.log"
  local pid_file="$PID_DIR/$name.pid"

  echo "[2/3] starting $name on :3000"
  (
    cd "$service_dir"
    exec npm run dev
  ) >"$log_file" 2>&1 &

  echo "$!" > "$pid_file"
}

start_web_frontend() {
  local name="web"
  local service_dir="$ROOT_DIR/web"
  local log_file="$LOG_DIR/$name.log"
  local pid_file="$PID_DIR/$name.pid"

  echo "[3/3] starting $name on :5173"
  (
    cd "$service_dir"
    exec npm run dev
  ) >"$log_file" 2>&1 &

  echo "$!" > "$pid_file"
}

verify_started() {
  local name="$1"
  local pid_file="$PID_DIR/$name.pid"
  local log_file="$LOG_DIR/$name.log"

  local pid
  pid="$(cat "$pid_file")"

  sleep 1
  if ! is_running "$pid"; then
    echo "[error] $name failed to start. log: $log_file"
    echo "--------"
    tail -n 40 "$log_file" || true
    echo "--------"
    exit 1
  fi
}

main() {
  check_service_not_running "python-agent"
  check_service_not_running "node-backend"
  check_service_not_running "web"

  bootstrap_python
  bootstrap_node "$ROOT_DIR/node-backend"
  bootstrap_node "$ROOT_DIR/web"

  start_python_agent
  start_node_backend
  start_web_frontend

  verify_started "python-agent"
  verify_started "node-backend"
  verify_started "web"

  echo
  echo "All services started."
  echo "  Web:    http://localhost:5173"
  echo "  Node:   http://localhost:3000/health"
  echo "  Agent:  http://localhost:8000/docs"
  echo
  echo "Logs:"
  echo "  $LOG_DIR/python-agent.log"
  echo "  $LOG_DIR/node-backend.log"
  echo "  $LOG_DIR/web.log"
  echo
  echo "Stop all: ./stop-all.sh"
}

main "$@"
