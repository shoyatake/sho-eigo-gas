#!/usr/bin/env bash
# ═══════════════════════════════════════════════
# sho eigo - Stripe 一括セットアップ (Cloud Shell 専用)
# ═══════════════════════════════════════════════
#
# 役割:
#   1. STRIPE_SECRET_KEY を使って 4 商品 (L1/L2/L3/保護者プラン) と
#      対応する Price を JPY 月次サブスクで作成
#   2. Webhook URL secret をランダム生成し、Stripe Webhook を登録
#   3. 全 ID と GAS Script Properties に貼るべき値を出力
#
# 使い方 (Cloud Shell):
#   export STRIPE_SECRET_KEY='sk_test_...'   # 最初はテストモードを推奨
#   export GAS_DEPLOYMENT_ID='AKfycbxxxxxxxxxxxxx'
#   bash scripts/stripe_setup.sh
#
#   出力された値を GAS スクリプトプロパティに貼り付ける。
#
# 二重実行対策:
#   既存 Product (metadata に sho_eigo_plan=l1 等) が見つかった場合は再利用。
#   Webhook も同 URL のものがあれば再利用。
# ═══════════════════════════════════════════════

set -uo pipefail

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}[ok]${NC}  $*"; }
warn() { echo -e "${YELLOW}[!]${NC}  $*"; }
err()  { echo -e "${RED}[x]${NC}  $*" >&2; }

# 必須 env 確認
if [ -z "${STRIPE_SECRET_KEY:-}" ]; then
  err "STRIPE_SECRET_KEY が未設定。export STRIPE_SECRET_KEY='sk_...' してください。"
  exit 1
fi
if [ -z "${GAS_DEPLOYMENT_ID:-}" ]; then
  err "GAS_DEPLOYMENT_ID が未設定。Webhook URL 登録に必須。"
  err "Apps Script Editor → デプロイ → ウェブアプリ → デプロイ ID をコピー"
  exit 1
fi

MODE="test"
if [[ "$STRIPE_SECRET_KEY" == sk_live_* ]]; then MODE="live"; fi
echo ""
echo "══════════════════════════════════════════════"
echo "  sho eigo Stripe Setup ($MODE モード)"
echo "  GAS Deployment ID: ${GAS_DEPLOYMENT_ID:0:24}..."
echo "══════════════════════════════════════════════"
if [ "$MODE" = "live" ]; then
  warn "本番モードで実行します。続行しますか? (yes/no)"
  read -r confirm
  [ "$confirm" = "yes" ] || { echo "中止"; exit 1; }
fi

# Stripe API ヘルパー
stripe_api() {
  local method="$1"; shift
  local path="$1"; shift
  curl -sS -X "$method" "https://api.stripe.com/v1${path}" \
    -u "${STRIPE_SECRET_KEY}:" \
    "$@"
}

# ----------------------------------------
# 1. プラン定義
# ----------------------------------------
declare -a PLANS=(
  "l1|L1 Foundation|2980|英語の音をゼロから整える 27 コース 540 レッスン"
  "l2|L2 Intermediate|3480|L1 + 英検準2級・2級 の 39 コース 720 レッスン"
  "l3|L3 Advanced|3980|L2 + 英検準1級・1級 の 51 コース 900 レッスン"
  "parent|保護者プラン|4980|L3 全コース + 週次レポート + 月次アルバム"
)

declare -A PRICE_IDS

# ----------------------------------------
# 2. Product + Price を idempotent に作成
# ----------------------------------------
echo ""
echo "▶ Step 1: 4 商品を作成 / 検出"
for spec in "${PLANS[@]}"; do
  IFS='|' read -r key name amount desc <<< "$spec"

  # 既存検索 (metadata.sho_eigo_plan=key)
  existing=$(stripe_api GET "/products/search" --data-urlencode "query=metadata['sho_eigo_plan']:'${key}'")
  product_id=$(echo "$existing" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['data'][0]['id'] if d.get('data') else '')")

  if [ -n "$product_id" ]; then
    ok "${key}: 既存 Product 発見 ${product_id}"
  else
    # 新規作成
    create_resp=$(stripe_api POST "/products" \
      -d "name=${name}" \
      -d "description=${desc}" \
      -d "metadata[sho_eigo_plan]=${key}")
    product_id=$(echo "$create_resp" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id',''))")
    if [ -z "$product_id" ]; then
      err "${key}: Product 作成失敗"
      echo "$create_resp" | head -c 500
      exit 1
    fi
    ok "${key}: 新規 Product 作成 ${product_id}"
  fi

  # 既存の active Price を探す
  prices=$(stripe_api GET "/prices?product=${product_id}&active=true&limit=10")
  price_id=$(echo "$prices" | python3 -c "
import json, sys
d = json.load(sys.stdin)
target = ${amount} * 100   # JPY は zero-decimal なので minor units = amount そのまま、ただし統一のため
target = ${amount}          # JPY は zero-decimal
for p in d.get('data', []):
    if p.get('currency') == 'jpy' and p.get('unit_amount') == target and p.get('recurring',{}).get('interval') == 'month':
        print(p['id']); break
")

  if [ -n "$price_id" ]; then
    ok "${key}: 既存 Price 発見 ${price_id} (¥${amount}/月)"
  else
    create_price=$(stripe_api POST "/prices" \
      -d "product=${product_id}" \
      -d "unit_amount=${amount}" \
      -d "currency=jpy" \
      -d "recurring[interval]=month" \
      -d "metadata[sho_eigo_plan]=${key}")
    price_id=$(echo "$create_price" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id',''))")
    if [ -z "$price_id" ]; then
      err "${key}: Price 作成失敗"
      echo "$create_price" | head -c 500
      exit 1
    fi
    ok "${key}: 新規 Price 作成 ${price_id} (¥${amount}/月)"
  fi

  PRICE_IDS["$key"]="$price_id"
done

# ----------------------------------------
# 3. Webhook 登録
# ----------------------------------------
echo ""
echo "▶ Step 2: Webhook 登録"
WEBHOOK_URL_SECRET=$(openssl rand -hex 16)
WEBHOOK_URL="https://script.google.com/macros/s/${GAS_DEPLOYMENT_ID}/exec?action=stripe_webhook&secret=${WEBHOOK_URL_SECRET}"

# 既存 Webhook (metadata.sho_eigo_role=primary) を検索 → URL のみ更新 or 新規
existing_hooks=$(stripe_api GET "/webhook_endpoints?limit=100")
existing_id=$(echo "$existing_hooks" | python3 -c "
import json, sys
d = json.load(sys.stdin)
for h in d.get('data', []):
    if h.get('metadata',{}).get('sho_eigo_role') == 'primary':
        print(h['id']); break
")

EVENTS="checkout.session.completed customer.subscription.deleted charge.refunded invoice.payment_failed"
EVENT_ARGS=""
for ev in $EVENTS; do
  EVENT_ARGS="$EVENT_ARGS -d enabled_events[]=$ev"
done

if [ -n "$existing_id" ]; then
  warn "既存 Webhook 発見 (${existing_id}) → URL 更新 (新 secret)"
  upd=$(stripe_api POST "/webhook_endpoints/${existing_id}" \
    -d "url=${WEBHOOK_URL}" \
    $EVENT_ARGS)
  hook_id=$(echo "$upd" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id',''))")
  ok "Webhook 更新完了 ${hook_id}"
else
  cre=$(stripe_api POST "/webhook_endpoints" \
    -d "url=${WEBHOOK_URL}" \
    -d "metadata[sho_eigo_role]=primary" \
    -d "description=sho eigo primary webhook" \
    $EVENT_ARGS)
  hook_id=$(echo "$cre" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id',''))")
  if [ -z "$hook_id" ]; then
    err "Webhook 作成失敗"
    echo "$cre" | head -c 500
    exit 1
  fi
  ok "Webhook 新規作成 ${hook_id}"
fi

# ----------------------------------------
# 4. 出力
# ----------------------------------------
cat <<EOF

══════════════════════════════════════════════
  ✅ Stripe セットアップ完了 ($MODE モード)
══════════════════════════════════════════════

GAS Apps Script Editor → 歯車 → スクリプトプロパティ に以下を登録:

  STRIPE_SECRET_KEY            = ${STRIPE_SECRET_KEY:0:12}***** (今回使ったキー)
  STRIPE_WEBHOOK_URL_SECRET    = ${WEBHOOK_URL_SECRET}
  STRIPE_PRICE_L1              = ${PRICE_IDS[l1]}
  STRIPE_PRICE_L2              = ${PRICE_IDS[l2]}
  STRIPE_PRICE_L3              = ${PRICE_IDS[l3]}
  STRIPE_PRICE_PARENT          = ${PRICE_IDS[parent]}

Webhook URL (Stripe Dashboard で確認):
  ${WEBHOOK_URL}
  Events: ${EVENTS}

次のステップ:
  1. 上記の値を GAS スクリプトプロパティに貼り付け (秘密値はコピペで)
  2. main にマージしてデプロイ → bash scripts/test_endpoints.sh
  3. テストカード 4242 4242 4242 4242 で 1 件決済してみる
  4. 動作確認 OK なら STRIPE_SECRET_KEY を sk_live_... に切替して再実行

══════════════════════════════════════════════

EOF
