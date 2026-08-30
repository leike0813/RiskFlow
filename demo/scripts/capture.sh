#!/usr/bin/env bash
# 导出五张 1920×1080 汇报截图到 demo/screenshots/
# 用法：demo/scripts/capture.sh
set -euo pipefail

cd "$(dirname "$0")/.."
OUT_DIR="screenshots"
PORT=5319
mkdir -p "$OUT_DIR"

echo "==> 构建"
npm run build

echo "==> 启动预览服务 (port $PORT)"
npm run preview -- --port "$PORT" --strictPort >/tmp/riskflow-demo-preview.log 2>&1 &
PREVIEW_PID=$!
trap 'kill "$PREVIEW_PID" 2>/dev/null || true' EXIT

for i in $(seq 1 30); do
  if curl -sf "http://localhost:$PORT/" >/dev/null 2>&1; then break; fi
  sleep 0.5
done

declare -A SCREENS=(
  ["01-risk-overview"]="/"
  ["02-agent-workbench"]="/agent"
  ["03-identification-center"]="/identification/runs/RUN-20260827-001"
  ["04-assessment-warning"]="/assessment/records/ASSESS-2026-001"
  ["05-risk-response-trace"]="/risks/RISK-2026-001"
)

for name in "${!SCREENS[@]}"; do
  url="http://localhost:$PORT${SCREENS[$name]}"
  echo "==> 截图 $name  $url"
  google-chrome --headless --disable-gpu --hide-scrollbars \
    --window-size=1920,1080 \
    --virtual-time-budget=8000 \
    --screenshot="$OUT_DIR/$name.png" "$url" >/dev/null 2>&1
done

echo "==> 完成，输出："
ls -la "$OUT_DIR"/*.png
