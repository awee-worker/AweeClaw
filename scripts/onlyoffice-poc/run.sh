#!/usr/bin/env bash
# ONLYOFFICE Docs PoC 一键验证：容器 + 网关
# 用法：
#   ./run.sh                    # 用 sample.xlsx 验证
#   POC_FILE=/path/a.xlsx ./run.sh
set -euo pipefail
cd "$(dirname "$0")"

# 国内加速源镜像（官方源被墙时替换）；有官方镜像时可改回 onlyoffice/documentserver:9.4.0.1
IMAGE="${ONLYOFFICE_IMAGE:-docker.xuanyuan.run/onlyoffice/documentserver:9.4.0.1}"
NAME=onlyoffice-ds
FILE="${POC_FILE:-$(pwd)/sample.xlsx}"
PORT_DS="${PORT_DS:-8080}"

echo "==> [1/3] 启动 Document Server 容器"
if docker ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
  echo "    容器 $NAME 已存在，启动中…"
  docker start "$NAME" >/dev/null
else
  docker run -d --name "$NAME" \
    -p ${PORT_DS}:80 \
    -e JWT_ENABLED=false \
    -v "$(pwd)/ds-data:/var/www/onlyoffice/Data" \
    "$IMAGE" >/dev/null
fi

echo "==> [2/3] 等待容器健康（首次启动需 5~15 分钟生成字体缓存，可另开终端 tail 日志）"
for i in $(seq 1 180); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 3 "http://127.0.0.1:${PORT_DS}/healthcheck" || true)
  if [ "$code" = "200" ]; then echo "    容器已就绪 (${i}0s)"; break; fi
  if [ "$i" = "180" ]; then echo "    等待超时，请用 docker logs $NAME 排查"; exit 1; fi
  sleep 10
done

echo "==> [3/3] 启动文件网关（编辑对象: $FILE）"
POC_FILE="$FILE" PORT="${GATEWAY_PORT:-3001}" DOC_SERVER="http://127.0.0.1:${PORT_DS}" node server.js
