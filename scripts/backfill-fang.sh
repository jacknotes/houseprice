#!/bin/bash
# 房天下小区均价自动补真（供定时任务调用，也可手动执行）
# 每轮: discover(限量30页) -> fetch(限量12个) -> 有新增则 apply + 同步远程
# 完成后写入 data/raw/fang-backfill.complete，后续运行直接退出
# 合规: 低频限速、遇滑块验证自动退避，不绕过任何人机校验
set -u
cd "$(dirname "$0")/.."
DONE_FLAG="data/raw/fang-backfill.complete"
if [ -f "$DONE_FLAG" ]; then echo "[backfill] already complete, skip"; exit 0; fi

node scripts/fetch-fang-prices.js discover || exit 1
node scripts/fetch-fang-prices.js fetch || exit 1

COUNTS=$(python - <<'EOF'
import json, os
rep = json.load(open('data/raw/fang-report.json', encoding='utf-8'))
ok = sum(1 for r in rep if r['status'] == 'ok')
sf = 'data/raw/fang-backfill-state.json'
prev = json.load(open(sf, encoding='utf-8')).get('okApplied', 0) if os.path.exists(sf) else 0
print(ok, prev)
EOF
)
OK=$(echo $COUNTS | cut -d' ' -f1)
PREV=$(echo $COUNTS | cut -d' ' -f2)
echo "[backfill] ok=$OK prev=$PREV"

if [ "$OK" != "$PREV" ]; then
  node scripts/fetch-fang-prices.js apply || exit 1
  bash scripts/sync-db-to-remote.sh || exit 1
  python -c "import json; json.dump({'okApplied': $OK}, open('data/raw/fang-backfill-state.json', 'w'))"
  echo "[backfill] applied+synced ($OK real prices so far)"
else
  echo "[backfill] no new prices this round"
fi

ST=$(node scripts/fetch-fang-prices.js status)
echo "[backfill] status: $ST"
if [ "$ST" = "complete" ]; then
  touch "$DONE_FLAG"
  echo "[backfill] all targets resolved, marking complete"
fi
echo "[backfill] round finished"
