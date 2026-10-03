#!/bin/bash
# 将本地 data/app.db 整库同步到远程部署（本地库为唯一数据源，覆盖远程数据）
# 用法:  bash scripts/sync-db-to-remote.sh
# 可用环境变量覆盖默认值:
#   REMOTE      远程主机(默认 root@tencent.markli.cn，需已配置 SSH 免密)
#   COMPOSE_DIR 远程 compose 目录(默认 /opt/houseprice)
#   CONTAINER   容器名(默认 houseprice)
# 流程: WAL 合并 -> scp 上传 -> 停容器 -> 换库 -> 清残留 wal/shm -> 起容器 -> 健康检查
# 注意: 远程库会被整体覆盖，直接在远程站点导入的数据会在下次同步时丢失。
set -euo pipefail
REMOTE="${REMOTE:-root@tencent.markli.cn}"
COMPOSE_DIR="${COMPOSE_DIR:-/opt/houseprice}"
CONTAINER="${CONTAINER:-houseprice}"

cd "$(dirname "$0")/.."
node -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('data/app.db');db.exec('PRAGMA wal_checkpoint(TRUNCATE)');db.close()"
echo "[1/4] WAL 已合并，上传 $(du -h data/app.db | cut -f1) ..."
scp -o BatchMode=yes data/app.db "$REMOTE:/tmp/app.db.sync"

ssh -o BatchMode=yes "$REMOTE" "REMOTE_COMPOSE_DIR='$COMPOSE_DIR' REMOTE_CONTAINER='$CONTAINER' bash -s" <<'EOS'
set -euo pipefail
cd "$REMOTE_COMPOSE_DIR"
VOL=$(docker inspect "$REMOTE_CONTAINER" --format '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Name}}{{end}}{{end}}')
echo "[2/4] 停止容器并换库 (卷 $VOL) ..."
docker compose stop "$REMOTE_CONTAINER" >/dev/null
docker cp /tmp/app.db.sync "$REMOTE_CONTAINER":/app/data/app.db
IMG=$(docker inspect "$REMOTE_CONTAINER" --format '{{.Config.Image}}')
echo "[3/4] 清理残留 wal/shm (镜像 $IMG) ..."
docker run --rm -v "$VOL":/d "$IMG" rm -f /d/app.db-wal /d/app.db-shm
rm -f /tmp/app.db.sync
docker compose start "$REMOTE_CONTAINER" >/dev/null
sleep 6
echo "[4/4] 健康检查 ..."
curl -s -o /dev/null -w '  remote /houseprice/api/cities: %{http_code}\n' http://127.0.0.1:8082/houseprice/api/cities
EOS
echo "同步完成"
