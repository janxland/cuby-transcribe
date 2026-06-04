#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_DIR="$ROOT_DIR/.run"

stop_one() {
  local name="$1"
  local pid_file="$PID_DIR/$name.pid"

  if [[ ! -f "$pid_file" ]]; then
    echo "[skip] $name not running"
    return 0
  fi

  local pid
  pid="$(cat "$pid_file")"

  if [[ -z "$pid" ]]; then
    rm -f "$pid_file"
    echo "[skip] $name has empty pid file"
    return 0
  fi

  if kill -0 "$pid" >/dev/null 2>&1; then
    echo "[stop] $name (pid=$pid)"
    kill "$pid" >/dev/null 2>&1 || true

    for _ in {1..20}; do
      if ! kill -0 "$pid" >/dev/null 2>&1; then
        break
      fi
      sleep 0.2
    done

    if kill -0 "$pid" >/dev/null 2>&1; then
      echo "[force] $name still alive, sending SIGKILL"
      kill -9 "$pid" >/dev/null 2>&1 || true
    fi
  else
    echo "[skip] $name pid not alive (pid=$pid)"
  fi

  rm -f "$pid_file"
}

stop_one "web"
stop_one "node-backend"
stop_one "python-agent"

echo "All stop operations completed."
