#!/bin/sh
# 后端容器入口：先启动 NeteaseCloudMusicApi（Node，端口 3000），再启动 FastAPI（端口 8000）
set -e

echo "=== [1/2] 启动 NeteaseCloudMusicApi (http://127.0.0.1:3000) ==="
cd /app/ncm
nohup node app.js > /tmp/ncm.log 2>&1 &
NCM_PID=$!

# 等待 ncm 就绪（最多 60 秒）
echo "等待网易云 API 就绪..."
i=0
until curl -sf http://127.0.0.1:3000/ >/dev/null 2>&1 || [ $i -ge 60 ]; do
  i=$((i + 1))
  sleep 1
done
if ! kill -0 $NCM_PID 2>/dev/null; then
  echo "❌ NeteaseCloudMusicApi 启动失败，日志："
  cat /tmp/ncm.log
  exit 1
fi
echo "✅ NeteaseCloudMusicApi 已就绪 (pid=$NCM_PID)"

# 优雅退出：同时终止 ncm
trap "kill $NCM_PID 2>/dev/null || true" EXIT INT TERM

echo "=== [2/2] 启动 FastAPI (端口 8000) ==="
cd /app
exec python3 -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
