#!/bin/bash
# VPS 远程部署：后台构建 cloudmusic-v2 并写日志
cd /root/cloudmusic-v2 || exit 1
rm -f build.log build2.log build3.log
nohup docker compose up -d --build > /root/cloudmusic-v2/build3.log 2>&1 &
echo "BUILD_PID=$!"
sleep 8
echo "=== build3.log (tail) ==="
tail -3 /root/cloudmusic-v2/build3.log 2>/dev/null || echo "(build3.log 尚未生成)"
echo "=== docker ps ==="
docker ps