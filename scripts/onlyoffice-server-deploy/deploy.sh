#!/usr/bin/env bash
# ONLYOFFICE Docs 服务器一键部署 / 更新脚本
# 用法:
#   ./deploy.sh            # 首次部署或升级（--pull 拉取最新镜像）
#   ./deploy.sh --no-pull  # 仅用本地镜像启动
#   ./deploy.sh logs       # 跟踪容器日志
#   ./deploy.sh stop|rm    # 停止 / 移除
set -euo pipefail
cd "$(dirname "$0")"

# 首次运行自动生成 .env
if [ ! -f .env ]; then
  cp .env.example .env
  echo "==> 已生成 .env，请先编辑其中 JWT_SECRET 再运行！"
  echo "    生成随机 secret: openssl rand -hex 32"
  exit 1
fi

case "${1:-}" in
  logs)   docker compose logs -f --tail 200; exit 0 ;;
  stop)   docker compose stop;                exit 0 ;;
  rm)     docker compose down -v;             exit 0 ;;
  ""|up)  ;;  # 默认走部署流程
  --no-pull) PULL_FLAG=""; shift ;;
esac

# docker compose up -d（默认 --pull always 升级到已配置 tag 的最新）
echo "==> [1/2] 启动容器…"
docker compose up -d ${PULL_FLAG:---pull always}

DS_PORT=$(grep -E '^DS_PORT=' .env | cut -d= -f2 | tr -d '[:space:]')
DS_PORT=${DS_PORT:-8080}

echo "==> [2/2] 等待健康检查（首次启动 5~15 分钟生成字体缓存）…"
for i in $(seq 1 240); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 3 "http://127.0.0.1:${DS_PORT}/healthcheck" || true)
  if [ "$code" = "200" ]; then
    echo "    ✅ 就绪 (约 $((i * 5))s): http://<服务器IP>:${DS_PORT}/healthcheck"
    exit 0
  fi
  sleep 5
done
echo "    ❌ 等待超时，排查: docker compose logs -f"
exit 1
