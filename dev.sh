#!/usr/bin/env bash
set -euo pipefail
project_dir="$(cd "$(dirname "$0")" && pwd)"
session_name=herdr-mobile-dev
if ! tmux has-session -t "$session_name" 2>/dev/null; then
  tmux new-session -d -s "$session_name" -c "$project_dir" 'npm run bridge'
  tmux split-window -h -t "$session_name" -c "$project_dir" 'npm run mobile'
fi
exec tmux attach-session -t "$session_name"
