#!/usr/bin/env bash
# v1.1 リリース後の e2e 検証 (read-only、破壊的操作なし)
# 使い方:
#   export GAS_URL='https://script.google.com/macros/s/<GAS_DEPLOYMENT_ID>/exec'
#   export TEST_LINE_UID='Uxxxxxxxx'
#   bash scripts/test_endpoints.sh

set -uo pipefail

SITE="${SITE:-https://sho-blog.com}"
GAS_URL="${GAS_URL:-}"
TEST_LINE_UID="${TEST_LINE_UID:-}"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
PASS=0; FAIL=0; WARN=0
ok()   { echo -e "${GREEN}[PASS]${NC} $*"; PASS=$((PASS+1)); }
fail() { echo -e "${RED}[FAIL]${NC} $*"; FAIL=$((FAIL+1)); }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; WARN=$((WARN+1)); }

echo ""
echo "▶ 1. 静的ページ"
for p in / /lp/ /products/ /next-step.html /payment/success.html /payment/cancel.html /trial/parent_lp.html /trial/day1.html /trial/day2.html; do
  code=$(curl -sS -o /dev/null -w "%{http_code}" "${SITE}${p}")
  if [ "$code" = "200" ]; then ok "${p} -> 200"; else fail "${p} -> ${code}"; fi
done

echo ""
echo "▶ 2. ページ内コンテンツ"
if curl -sS "${SITE}/products/" | grep -q '¥4,980'; then ok "/products/ に保護者プラン ¥4,980"; else fail "/products/ に新価格が反映されていない"; fi
if curl -sS "${SITE}/products/" | grep -q '¥2,980'; then ok "/products/ に L1 ¥2,980"; else fail "/products/ に L1 価格無し"; fi
if curl -sS "${SITE}/next-step.html" | grep -q '保護者プラン'; then ok "/next-step.html に保護者プラン"; else fail "/next-step.html に保護者プラン無し"; fi
if curl -sS "${SITE}/next-step.html?from=parent" | grep -q '保護者プラン'; then ok "/next-step.html?from=parent でも表示"; else fail "?from=parent 動作せず"; fi
if curl -sS "${SITE}/trial/parent_lp.html" | grep -q '成長のアルバム'; then ok "/trial/parent_lp.html に「成長のアルバム」"; else fail "親子LP のキーワード無し"; fi

# placeholder substitution の確認
for f in /next-step.html /trial/parent_lp.html; do
  if curl -sS "${SITE}${f}" | grep -q 'YOUR_GAS_DEPLOYMENT_ID'; then
    fail "${f} に placeholder YOUR_GAS_DEPLOYMENT_ID が残っている"
  else
    ok "${f} の GAS_DEPLOYMENT_ID 置換 OK"
  fi
done

if [ -n "$GAS_URL" ] && [ -n "$TEST_LINE_UID" ]; then
  echo ""
  echo "▶ 3. GAS Web App"

  # Checkout (uid あり、Stripe 設定済みなら 200 + 中身に stripe.com)
  co_code=$(curl -sS -o /tmp/co.html -w "%{http_code}" "${GAS_URL}?action=checkout&plan=l1&uid=${TEST_LINE_UID}")
  if [ "$co_code" = "200" ]; then
    if grep -q "stripe.com" /tmp/co.html 2>/dev/null; then
      ok "checkout (l1) -> Stripe へリダイレクト"
    elif grep -q "準備中" /tmp/co.html; then
      warn "checkout 準備中 (Script Properties 未設定?)"
    else
      fail "checkout 応答が想定外"
    fi
  else
    fail "checkout HTTP ${co_code}"
  fi

  # Stripe webhook unauthorized
  wh_code=$(curl -sS -X POST -o /tmp/wh.json -w "%{http_code}" \
    -H "Content-Type: application/json" -d '{"type":"test"}' \
    "${GAS_URL}?action=stripe_webhook&secret=invalid")
  if [ "$wh_code" = "200" ] && grep -q "unauthorized" /tmp/wh.json; then
    ok "stripe_webhook 不正 secret -> unauthorized"
  else
    fail "stripe_webhook の検証が機能していない (code=${wh_code})"
  fi
else
  warn "GAS_URL / TEST_LINE_UID 未設定のため GAS テストは skip"
fi

echo ""
echo "▶ 4. 既存音声 (Phase 1+2 の継続動作)"
for url in "${SITE}/_mgmt/voice.html" "${SITE}/trial/audio/sho/day1_step00_ようこそ.mp3"; do
  code=$(curl -sS -o /dev/null -w "%{http_code}" "$url")
  if [ "$code" = "200" ]; then ok "$url"; else fail "$url -> $code"; fi
done

rm -f /tmp/co.html /tmp/wh.json
echo ""
echo "結果: ${PASS} pass, ${FAIL} fail, ${WARN} warn"
[ $FAIL -gt 0 ] && exit 1 || exit 0
