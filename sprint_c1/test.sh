#!/usr/bin/env bash
# Sprint C1 動作確認スクリプト
#
# 使い方:
#   export WEBAPP_URL='https://script.google.com/macros/s/XXXXXX/exec'
#   bash ~/sprint_c1/test.sh
#
# オプション環境変数:
#   TEST_EMAIL    既定 test@example.com（生徒マスターに事前登録が必要）
#   TEST_PASSWORD 既定 testpassword123
#   TEST_ROLE     既定 student（parent / student / single）

set -uo pipefail

: "${WEBAPP_URL:?WEBAPP_URL が未設定。export WEBAPP_URL='https://script.google.com/macros/s/.../exec' を実行してから再実行してください}"

EMAIL="${TEST_EMAIL:-test@example.com}"
PASSWORD="${TEST_PASSWORD:-testpassword123}"
ROLE="${TEST_ROLE:-student}"

post() {
  curl -sS -L -X POST "$WEBAPP_URL" \
    -H 'Content-Type: application/json' \
    -d "$1"
  echo
}

extract() {
  # 簡易 JSON 値抽出（jq が無い環境向け）
  echo "$1" | sed -n "s/.*\"$2\":\"\\([^\"]*\\)\".*/\\1/p" | head -n 1
}

separator() { echo "---------- $1 ----------"; }

separator "1. signup（初回のみ成功、2回目以降は \"既に登録済み\" でも可）"
SIGNUP_BODY="$(printf '{"action":"signup","email":"%s","password":"%s","role":"%s","lineDisplayName":"テストユーザー"}' "$EMAIL" "$PASSWORD" "$ROLE")"
post "$SIGNUP_BODY"

separator "2. login"
LOGIN_RES="$(curl -sS -L -X POST "$WEBAPP_URL" -H 'Content-Type: application/json' \
  -d "$(printf '{"action":"login","email":"%s","password":"%s"}' "$EMAIL" "$PASSWORD")")"
echo "$LOGIN_RES"
TOKEN="$(extract "$LOGIN_RES" token)"
if [ -z "$TOKEN" ]; then
  echo
  echo "❌ login で token を取得できませんでした。signup が成功しているか、生徒マスターに $EMAIL が登録されているか確認してください。"
  exit 1
fi
echo
echo "TOKEN（先頭40文字）: ${TOKEN:0:40}…"

separator "3. verify（有効）"
post "$(printf '{"action":"verify","token":"%s"}' "$TOKEN")"

separator "4. line_auth_url"
post '{"action":"line_auth_url","state":"test-state-123"}'

separator "5. logout（jti を revoke）"
post "$(printf '{"action":"logout","token":"%s"}' "$TOKEN")"

separator "6. verify（revoke 後 → revoked エラーが返れば正常）"
post "$(printf '{"action":"verify","token":"%s"}' "$TOKEN")"

separator "完了"
echo "期待する結果:"
echo "  1. signup       ok:true（または ok:false で error=既に登録済みの email）"
echo "  2. login        ok:true で token あり"
echo "  3. verify       ok:true で userId が返る"
echo "  4. line_auth_url ok:true で url が返る"
echo "  5. logout       ok:true で ok:true"
echo "  6. verify       ok:false で error=revoked"
