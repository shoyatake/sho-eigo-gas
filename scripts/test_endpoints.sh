#!/usr/bin/env bash
# ═══════════════════════════════════════════════
# sho eigo - 2026-05-06 リリース後の e2e 検証スクリプト
# ═══════════════════════════════════════════════
#
# 役割:
#   merge → CI デプロイ後に、各エンドポイントが期待通り応答するかをまとめて確認する。
#   破壊的操作は一切しない (read-only)。
#
# 必須環境変数:
#   GAS_URL          : GAS Web App URL (例: https://script.google.com/macros/s/.../exec)
#   ADMIN_TOKEN      : GAS スクリプトプロパティの ADMIN_TOKEN と同じ値
#   TEST_LINE_UID    : ALLOWED_TEST_UIDS に含まれる自分の LINE userId
#
# 任意:
#   SITE             : 既定 https://sho-blog.com
#
# 使い方:
#   export GAS_URL='...'
#   export ADMIN_TOKEN='...'
#   export TEST_LINE_UID='Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
#   bash scripts/test_endpoints.sh
# ═══════════════════════════════════════════════

set -uo pipefail

SITE="${SITE:-https://sho-blog.com}"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASS=0
FAIL=0
WARN=0

ok()   { echo -e "${GREEN}[PASS]${NC} $*"; PASS=$((PASS+1)); }
fail() { echo -e "${RED}[FAIL]${NC} $*";  FAIL=$((FAIL+1)); }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; WARN=$((WARN+1)); }

require() {
  if [ -z "${!1:-}" ]; then
    echo -e "${RED}必須 env $1 が未設定${NC}"; exit 1
  fi
}
require GAS_URL
require ADMIN_TOKEN
require TEST_LINE_UID

echo ""
echo "══════════════════════════════════════════════"
echo "  sho eigo e2e endpoint check"
echo "  SITE     = $SITE"
echo "  GAS_URL  = ${GAS_URL:0:60}..."
echo "══════════════════════════════════════════════"

# ----------------------------------------
# 1. 静的ページの 200 確認
# ----------------------------------------
echo ""
echo "▶ 1. 静的ページ"
for p in / /lp/ /products/ /payment/ /payment/success.html /payment/cancel.html /admin/ /monitor/; do
  code=$(curl -sS -o /dev/null -w "%{http_code}" "${SITE}${p}")
  if [ "$code" = "200" ]; then ok "${p} -> 200"; else fail "${p} -> ${code}"; fi
done

# ----------------------------------------
# 2. 各ページに新しい voice_id / 価格が反映されているか
# ----------------------------------------
echo ""
echo "▶ 2. ページ内コンテンツ確認"

if curl -sS "${SITE}/products/" | grep -q '¥3,980'; then
  ok "/products/ に個人 Pro 3,980 円"
else
  fail "/products/ に新価格が反映されていない"
fi

if curl -sS "${SITE}/payment/" | grep -q 'data-plan="personal"'; then
  ok "/payment/ に 3 プランカード存在"
else
  fail "/payment/ に 3 プランカードが見えない"
fi

if curl -sS "${SITE}/admin/" | grep -q 'ADMIN_TOKEN を入力'; then
  ok "/admin/ ログインフォーム描画"
else
  fail "/admin/ のログインフォームが見えない"
fi

# placeholder substitution の確認 (deploy.yml が置き換え済か)
if curl -sS "${SITE}/payment/" | grep -q 'YOUR_GAS_DEPLOYMENT_ID'; then
  fail "/payment/ に placeholder YOUR_GAS_DEPLOYMENT_ID が残存 (deploy.yml の sed 置換失敗?)"
else
  ok "/payment/ の GAS_DEPLOYMENT_ID 置換 OK"
fi
if curl -sS "${SITE}/admin/" | grep -q 'YOUR_GAS_DEPLOYMENT_ID'; then
  fail "/admin/ に placeholder YOUR_GAS_DEPLOYMENT_ID が残存"
else
  ok "/admin/ の GAS_DEPLOYMENT_ID 置換 OK"
fi
if curl -sS "${SITE}/products/" | grep -q '@YOUR_LINE_ID'; then
  fail "/products/ に placeholder @YOUR_LINE_ID が残存"
else
  ok "/products/ の LINE_ID 置換 OK"
fi

# ----------------------------------------
# 3. GAS doGet エンドポイント
# ----------------------------------------
echo ""
echo "▶ 3. GAS Web App エンドポイント"

# Admin (token 認証)
admin_code=$(curl -sS -o /tmp/admin.json -w "%{http_code}" \
  "${GAS_URL}?action=admin&format=json&token=${ADMIN_TOKEN}")
if [ "$admin_code" = "200" ] && python3 -c "import json,sys; d=json.load(open('/tmp/admin.json')); sys.exit(0 if 'dau' in d else 1)" 2>/dev/null; then
  ok "/?action=admin&format=json -> JSON with 'dau' field"
else
  fail "/?action=admin&format=json failed (code=${admin_code})"
  head -c 300 /tmp/admin.json; echo
fi

# Admin token 不一致 -> 403
admin_403=$(curl -sS -o /dev/null -w "%{http_code}" \
  "${GAS_URL}?action=admin&token=invalidtoken")
if [ "$admin_403" = "200" ]; then
  # GAS は 200 を返して中身に Forbidden がある場合がある
  body=$(curl -sS "${GAS_URL}?action=admin&token=invalidtoken")
  if echo "$body" | grep -q "Forbidden"; then
    ok "admin invalid token -> Forbidden body"
  else
    fail "admin invalid token でも認可 (Forbidden 表示なし)"
  fi
else
  warn "admin invalid token -> HTTP ${admin_403} (期待: 200 + Forbidden)"
fi

# Checkout (uid あり、ALLOWED_TEST_UIDS に居る前提)
co_code=$(curl -sS -o /tmp/co.html -w "%{http_code}" \
  "${GAS_URL}?action=checkout&plan=personal&uid=${TEST_LINE_UID}")
if [ "$co_code" = "200" ]; then
  if grep -q "stripe.com" /tmp/co.html 2>/dev/null; then
    ok "/?action=checkout&plan=personal -> Stripe へリダイレクト"
  elif grep -q "準備中" /tmp/co.html; then
    warn "checkout 準備中ページ (Script Properties が未設定 or LIVE_OPEN_AFTER 未到達)"
  else
    fail "checkout 応答が想定外"
    head -c 300 /tmp/co.html; echo
  fi
else
  fail "checkout HTTP ${co_code}"
fi

# Checkout (uid なし) -> 案内ページ
co_nouid=$(curl -sS "${GAS_URL}?action=checkout&plan=personal")
if echo "$co_nouid" | grep -q "uid が必要"; then
  ok "checkout uid なし -> 案内ページ"
else
  fail "checkout uid なしの応答が想定外"
fi

# ----------------------------------------
# 4. Stripe Webhook のシークレット検証 (URL secret 不正なら拒否)
# ----------------------------------------
echo ""
echo "▶ 4. Stripe Webhook unauthorized check"
wh_code=$(curl -sS -X POST -o /tmp/wh.json -w "%{http_code}" \
  -H "Content-Type: application/json" \
  -d '{"type":"test","data":{}}' \
  "${GAS_URL}?action=stripe_webhook&secret=invalidvalue")
if [ "$wh_code" = "200" ] && grep -q "unauthorized" /tmp/wh.json; then
  ok "stripe_webhook 不正 secret -> unauthorized"
else
  fail "stripe_webhook の不正 secret 検証が機能していない (code=${wh_code})"
  head -c 200 /tmp/wh.json; echo
fi

# ----------------------------------------
# 5. 既存音声配信 (Phase 1+2 の継続動作)
# ----------------------------------------
echo ""
echo "▶ 5. 既存音声配信"
for f in voice.html day1_step00_ようこそ.mp3; do
  if [ "$f" = "voice.html" ]; then
    url="${SITE}/_mgmt/voice.html"
  else
    url="${SITE}/trial/audio/sho/${f}"
  fi
  code=$(curl -sS -o /dev/null -w "%{http_code}" "$url")
  if [ "$code" = "200" ]; then ok "$url"; else fail "$url -> $code"; fi
done

# ----------------------------------------
# 結果
# ----------------------------------------
echo ""
echo "══════════════════════════════════════════════"
echo "  結果: ${PASS} pass, ${FAIL} fail, ${WARN} warn"
echo "══════════════════════════════════════════════"

# クリーンアップ
rm -f /tmp/admin.json /tmp/co.html /tmp/wh.json

if [ $FAIL -gt 0 ]; then
  exit 1
else
  exit 0
fi
