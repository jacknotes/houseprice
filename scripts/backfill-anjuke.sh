#!/bin/bash
# 安居客小区详情自动补真（供定时任务调用）
# 若存在 data/raw/anjuke-cookie.txt（用户浏览器过一次验证后导出的 Cookie），以之注入会话；无 Cookie 时也尝试（限流窗口偶尔开放）
# 被反爬拦截 -> 本轮优雅退出；有新增 -> 自动同步远程；全部完成 -> 写 complete 标志自停
set -u
cd "$(dirname "$0")/.."
DONE_FLAG="data/raw/anjuke-backfill.complete"
if [ -f "$DONE_FLAG" ]; then echo "[anjuke] already complete, skip"; exit 0; fi

export ANJUKE_REFRESH=0
if [ -f data/raw/anjuke-cookie.txt ]; then
  export ANJUKE_COOKIE=$(head -1 data/raw/anjuke-cookie.txt | tr -d '\r')
  echo "[anjuke] session cookie loaded"
else
  echo "[anjuke] no cookie file, trying anonymous window"
fi

RESOLVED=$(node scripts/fetch-anjuke-prices.js status | grep -o -E "complete|pending" || echo pending)
node scripts/fetch-anjuke-prices.js run || exit 0
RESOLVED2=$(node scripts/fetch-anjuke-prices.js status)

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
