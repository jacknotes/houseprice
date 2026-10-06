#!/bin/bash
# 安居客小区详情自动补真（供定时任务调用）
# 会话: data/raw/anjuke-cookie.txt 存在则注入; 无 Cookie 也尝试（限流窗口偶尔开放）
# 人工介入通知: 带 Cookie 且整轮被拦(0 收获) => 会话失效, POST webhook 通知用户(6h 节流)
# 有新增 -> 自动同步远程；全部完成 -> 写 complete 标志自停
set -u
cd "$(dirname "$0")/.."
DONE_FLAG="data/raw/anjuke-backfill.complete"
WEBHOOK="https://notice.markli.cn/api/webhook/1b4d0ad4-3f46-48a1-b39f-552c3ecf73f4776aee88fbef8404"
if [ -f "$DONE_FLAG" ]; then echo "[anjuke] already complete, skip"; exit 0; fi

export ANJUKE_REFRESH=0
if [ -f data/raw/anjuke-cookie.txt ]; then
  export ANJUKE_COOKIE=$(head -1 data/raw/anjuke-cookie.txt | tr -d '\r')
  echo "[anjuke] session cookie loaded"
else
  echo "[anjuke] no cookie file, trying anonymous window"
fi

OUT=$(node scripts/fetch-anjuke-prices.js run 2>&1)
echo "$OUT"
if echo "$OUT" | grep -qE "network error"; then echo "[anjuke] network issue, wait next round"; exit 0; fi

HARVESTED=$(echo "$OUT" | grep -c "^OK " || true)
BLOCKED=$(echo "$OUT" | grep -c "anjuke-blocked" || true)

# 会话失效判定: 带 Cookie + 连续 2 轮 0 收获且被拦 => 需要人工重新验证(6h 节流)
CB_STATE="data/raw/anjuke-consec.json"
if [ "$BLOCKED" != "0" ] && [ "$HARVESTED" = "0" ]; then
  CB=$(( $(node -e "console.log((require('fs').existsSync('$CB_STATE')?JSON.parse(require('fs').readFileSync('$CB_STATE','utf8')).c:0)+1)") ))
  node -e "require('fs').writeFileSync('$CB_STATE', JSON.stringify({c: $CB}))"
else
  node -e "require('fs').writeFileSync('$CB_STATE', JSON.stringify({c: 0}))"
  CB=0
fi

if [ "$CB" -ge 2 ] && [ -f data/raw/anjuke-cookie.txt ]; then
  NOW=$(date +%s)
  LAST=$(cat data/raw/anjuke-notify.state 2>/dev/null || echo 0)
  if [ $((NOW - LAST)) -gt 21600 ]; then
    curl -s -X POST "$WEBHOOK" -H "Content-Type: application/json" \
      -d '{"message":"[需人工] 安居客会话已失效(连续两轮被拦截且无收获)。请在浏览器打开 anjuke.com 过一次人机验证,然后告知我重新提取会话;或自行更新 data/raw/anjuke-cookie.txt。其余任务(房天下)不受影响。"}' \
      --max-time 15 > /dev/null
    echo "$NOW" > data/raw/anjuke-notify.state
    echo "[anjuke] session expired -> webhook notified (throttled 6h)"
  else
    echo "[anjuke] session expired -> webhook throttled, skip notify"
  fi
fi

DONE_COUNT=$(node -e "
const s = require('fs').existsSync('data/raw/anjuke-state.json') ? JSON.parse(require('fs').readFileSync('data/raw/anjuke-state.json','utf8')) : {done:{}};
console.log(Object.keys(s.done).filter(k => s.done[k] === 'done').length)")
PREV=$(node -e "
const s = require('fs').existsSync('data/raw/anjuke-state.json') ? JSON.parse(require('fs').readFileSync('data/raw/anjuke-state.json','utf8')) : {};
console.log(s.syncedDone || 0)")

if [ "$DONE_COUNT" -gt "$PREV" ]; then
  bash scripts/sync-db-to-remote.sh || exit 1
  node -e "
const fs = require('fs');
const s = fs.existsSync('data/raw/anjuke-state.json') ? JSON.parse(fs.readFileSync('data/raw/anjuke-state.json','utf8')) : {};
s.syncedDone = $DONE_COUNT;
fs.writeFileSync('data/raw/anjuke-state.json', JSON.stringify(s, null, 1));"
  echo "[anjuke] synced ($DONE_COUNT real details so far)"
else
  echo "[anjuke] no new details this round"
fi

FINAL=$(node scripts/fetch-anjuke-prices.js status)
echo "[anjuke] status: $FINAL"
if [ "$FINAL" = "complete" ]; then touch "$DONE_FLAG"; echo "[anjuke] all done"; fi
