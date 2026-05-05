#!/usr/bin/env bash
# ═══════════════════════════════════════════════
# sho eigo - Phase 1: IVC 再作成 + /all/trial/ 検証
# ═══════════════════════════════════════════════
#
# 目的:
#   TASK A) ElevenLabs IVC を新規作成し、
#           https://sho-blog.com/_mgmt/voice.html の
#           VOICE_ID を新 ID に置換して FTP デプロイ。
#   TASK B) 旧 /all/trial/ 系パスの 404 状態を調査し、
#           内部参照と .htaccess 修正候補を提示 (変更はしない)。
#
# 必須環境変数:
#   ELEVEN_API_KEY   : ElevenLabs API key (Voices:Write 権限要)
#   XSERVER_PASS     : Xserver FTP パスワード
#
# 引数:
#   $1               : IVC 用音源ファイルのパス (mp3/wav/m4a/ogg)
#
# 任意 (デフォルト値あり):
#   OLD_VOICE_ID         : 既定 ZYHkwuG2yr4rcubJRUms (削除候補)
#   NEW_VOICE_NAME       : 既定 "sho full power IVC"
#   NEW_VOICE_DESC       : 既定 "本人音声からのIVC"
#   XSERVER_HOST         : 既定 sv16546.xserver.jp
#   XSERVER_USER         : 既定 xs672802
#   XSERVER_VOICE_PATH   : 既定 /sho-blog.com/public_html/_mgmt/voice.html
#   VOICE_HTML_URL       : 既定 https://sho-blog.com/_mgmt/voice.html
#   TASK                 : A | B | all (既定 all)
#   DRY_RUN              : 1 で破壊的操作 (旧PVC削除/IVC作成/FTPアップ) を skip
#   AUTO_DELETE_OLD      : 1 で旧PVC削除の確認プロンプトを skip
#
# 使い方:
#   export ELEVEN_API_KEY='sk_...'
#   export XSERVER_PASS='...'
#   bash scripts/phase1.sh /path/to/sho_voice_sample.m4a
#
#   # B タスクだけ:
#   TASK=B bash scripts/phase1.sh
#
#   # 破壊的操作なしで dry-run:
#   DRY_RUN=1 bash scripts/phase1.sh /path/to/sample.m4a
# ═══════════════════════════════════════════════

set -uo pipefail

OLD_VOICE_ID="${OLD_VOICE_ID:-ZYHkwuG2yr4rcubJRUms}"
NEW_VOICE_NAME="${NEW_VOICE_NAME:-sho full power IVC}"
NEW_VOICE_DESC="${NEW_VOICE_DESC:-本人音声からのIVC}"
XSERVER_HOST="${XSERVER_HOST:-sv16546.xserver.jp}"
XSERVER_USER="${XSERVER_USER:-xs672802}"
XSERVER_VOICE_PATH="${XSERVER_VOICE_PATH:-/sho-blog.com/public_html/_mgmt/voice.html}"
VOICE_HTML_URL="${VOICE_HTML_URL:-https://sho-blog.com/_mgmt/voice.html}"
TASK="${TASK:-all}"
DRY_RUN="${DRY_RUN:-0}"
AUTO_DELETE_OLD="${AUTO_DELETE_OLD:-0}"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${BLUE}[*]${NC} $*"; }
ok()   { echo -e "${GREEN}[ok]${NC} $*"; }
warn() { echo -e "${YELLOW}[warn]${NC} $*"; }
err()  { echo -e "${RED}[err]${NC} $*" >&2; }

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    err "必須コマンドが無い: $1"
    exit 1
  fi
}

require_cmd curl
require_cmd python3
require_cmd sed
require_cmd grep
require_cmd file
require_cmd diff

SAMPLE_FILE="${1:-}"

# ───────────────────────────────────────────────
# TASK A
# ───────────────────────────────────────────────
task_a() {
  echo ""
  echo "══════════════════════════════════════════════"
  echo "  TASK A: IVC 作成 → voice.html 反映"
  echo "══════════════════════════════════════════════"

  if [ -z "${ELEVEN_API_KEY:-}" ]; then
    err "ELEVEN_API_KEY が未設定"
    exit 1
  fi
  if [ -z "${XSERVER_PASS:-}" ]; then
    err "XSERVER_PASS が未設定"
    exit 1
  fi
  if [ -z "$SAMPLE_FILE" ] || [ ! -f "$SAMPLE_FILE" ]; then
    err "音源ファイルが見つからない: '$SAMPLE_FILE'"
    err "使い方: bash scripts/phase1.sh <audio file path>"
    exit 1
  fi

  # ---------- A-1: API key 検証 ----------
  log "A-1: API key 検証中..."
  local user_json
  user_json=$(mktemp)
  local code
  code=$(curl -sS -H "xi-api-key: $ELEVEN_API_KEY" \
    https://api.elevenlabs.io/v1/user \
    -o "$user_json" -w "%{http_code}")
  if [ "$code" != "200" ]; then
    err "/v1/user HTTP $code"
    cat "$user_json"
    rm -f "$user_json"
    exit 1
  fi
  python3 - <<PY
import json
d = json.load(open("$user_json"))
sub = d.get("subscription", {}) or {}
print("  Tier:", sub.get("tier"))
print("  Char limit:", sub.get("character_limit"))
print("  Chars used:", sub.get("character_count"))
print("  Voice slots:", sub.get("voice_slots_used"), "/", sub.get("voice_limit"))
print("  Pro voice limit:", sub.get("professional_voice_limit"))
PY
  rm -f "$user_json"
  ok "A-1: API key OK"

  # ---------- A-2: 音源ファイル検証 ----------
  log "A-2: 音源ファイル検証中..."
  ls -la "$SAMPLE_FILE"
  file "$SAMPLE_FILE"
  du -h "$SAMPLE_FILE"
  local size_bytes
  size_bytes=$(stat -c %s "$SAMPLE_FILE" 2>/dev/null || stat -f %z "$SAMPLE_FILE")
  if [ "$size_bytes" -lt 102400 ]; then
    warn "サイズが 100KB 未満です ($size_bytes bytes)。IVC 品質に影響する可能性。"
    if [ "$AUTO_DELETE_OLD" != "1" ]; then
      read -r -p "そのまま続行しますか? (yes/no): " ans
      [ "$ans" = "yes" ] || { err "中止"; exit 1; }
    fi
  fi
  ok "A-2: 音源 OK"

  # ---------- A-3: 旧 PVC 削除 ----------
  log "A-3: 旧 PVC 確認 (id=$OLD_VOICE_ID)"
  local old_json
  old_json=$(mktemp)
  code=$(curl -sS -H "xi-api-key: $ELEVEN_API_KEY" \
    "https://api.elevenlabs.io/v1/voices/$OLD_VOICE_ID" \
    -o "$old_json" -w "%{http_code}")
  if [ "$code" = "200" ]; then
    python3 - <<PY
import json
d = json.load(open("$old_json"))
print("  name:", d.get("name"), "/ category:", d.get("category"))
PY
    if [ "$DRY_RUN" = "1" ]; then
      warn "DRY_RUN=1 のため削除 skip"
    else
      local confirm="$AUTO_DELETE_OLD"
      if [ "$confirm" != "1" ]; then
        read -r -p "  削除しますか? (yes/no): " ans
        [ "$ans" = "yes" ] && confirm=1
      fi
      if [ "$confirm" = "1" ]; then
        local del_resp
        del_resp=$(curl -sS -X DELETE \
          -H "xi-api-key: $ELEVEN_API_KEY" \
          "https://api.elevenlabs.io/v1/voices/$OLD_VOICE_ID" \
          -w "\nHTTP %{http_code}")
        echo "$del_resp"
        ok "A-3: 削除完了"
      else
        warn "A-3: 削除 skip"
      fi
    fi
  else
    warn "  旧 voice 取得 HTTP $code (既に削除済みの可能性)"
  fi
  rm -f "$old_json"

  # ---------- A-4: IVC 作成 ----------
  log "A-4: IVC 作成中..."
  if [ "$DRY_RUN" = "1" ]; then
    warn "DRY_RUN=1 のため IVC 作成 skip。NEW_VOICE_ID は既存値を使用するか中断してください。"
    NEW_VOICE_ID="${NEW_VOICE_ID:-DRY_RUN_PLACEHOLDER}"
  else
    local add_resp
    add_resp=$(mktemp)
    code=$(curl -sS -X POST \
      -H "xi-api-key: $ELEVEN_API_KEY" \
      -F "name=$NEW_VOICE_NAME" \
      -F "description=$NEW_VOICE_DESC, $(date +%Y-%m-%d)作成" \
      -F 'labels={"language":"ja","gender":"male"}' \
      -F "remove_background_noise=true" \
      -F "files=@$SAMPLE_FILE" \
      https://api.elevenlabs.io/v1/voices/add \
      -o "$add_resp" -w "%{http_code}")
    echo "  HTTP $code"
    cat "$add_resp"
    echo ""
    if [ "$code" != "200" ] && [ "$code" != "201" ]; then
      err "IVC 作成失敗"
      rm -f "$add_resp"
      exit 1
    fi
    NEW_VOICE_ID=$(python3 - <<PY
import json
d = json.load(open("$add_resp"))
print(d.get("voice_id",""))
PY
)
    rm -f "$add_resp"
    if [ -z "$NEW_VOICE_ID" ]; then
      err "voice_id を抽出できなかった"
      exit 1
    fi
    ok "A-4: 新 voice_id = $NEW_VOICE_ID"
  fi

  # ---------- A-5: TTS テスト ----------
  log "A-5: TTS テスト..."
  if [ "$DRY_RUN" = "1" ] && [ "$NEW_VOICE_ID" = "DRY_RUN_PLACEHOLDER" ]; then
    warn "DRY_RUN のため TTS skip"
  else
    code=$(curl -sS -X POST \
      -H "xi-api-key: $ELEVEN_API_KEY" \
      -H "Content-Type: application/json" \
      -H "Accept: audio/mpeg" \
      -d '{
        "text": "こんにちは、テストです。",
        "model_id": "eleven_multilingual_v2",
        "voice_settings": {"stability":0.35,"similarity_boost":0.75,"style":0.5,"use_speaker_boost":true}
      }' \
      "https://api.elevenlabs.io/v1/text-to-speech/$NEW_VOICE_ID" \
      -o /tmp/phase1_test_output.mp3 \
      -w "%{http_code}")
    local out_size
    out_size=$(stat -c %s /tmp/phase1_test_output.mp3 2>/dev/null || stat -f %z /tmp/phase1_test_output.mp3)
    echo "  HTTP $code / size $out_size bytes"
    if [ "$code" = "200" ] && [ "$out_size" -gt 5000 ]; then
      file /tmp/phase1_test_output.mp3
      ok "A-5: TTS OK (/tmp/phase1_test_output.mp3)"
    else
      err "A-5: TTS 失敗"
      cat /tmp/phase1_test_output.mp3
      exit 1
    fi
  fi

  # ---------- A-6: voice.html 更新 ----------
  log "A-6: voice.html 取得 → 置換 → アップロード"

  local cur_html
  cur_html=$(mktemp /tmp/voice_current.XXXX.html)
  code=$(curl -sS "$VOICE_HTML_URL" -o "$cur_html" -w "%{http_code}")
  if [ "$code" != "200" ]; then
    err "voice.html 取得 HTTP $code"
    rm -f "$cur_html"
    exit 1
  fi

  local old_in_html
  old_in_html=$(grep -oE "VOICE_ID='[A-Za-z0-9]+'" "$cur_html" | head -1 | sed "s/VOICE_ID='//; s/'//")
  if [ -z "$old_in_html" ]; then
    err "voice.html から VOICE_ID を抽出できない"
    rm -f "$cur_html"
    exit 1
  fi
  echo "  HTML 上の旧 ID: $old_in_html / 新 ID: $NEW_VOICE_ID"

  local backup="/tmp/voice_backup_$(date +%s).html"
  cp "$cur_html" "$backup"
  echo "  backup: $backup"

  sed -i "s/${old_in_html}/${NEW_VOICE_ID}/g" "$cur_html"
  local new_count old_count
  new_count=$(grep -c "$NEW_VOICE_ID" "$cur_html")
  old_count=$(grep -c "$old_in_html" "$cur_html" || true)
  echo "  新ID 出現: $new_count / 旧ID 残存: $old_count"
  if [ "$new_count" -lt 1 ] || [ "$old_count" -gt 0 ]; then
    err "置換結果が不正"
    diff "$backup" "$cur_html" | head -40
    rm -f "$cur_html"
    exit 1
  fi

  if [ "$DRY_RUN" = "1" ]; then
    warn "DRY_RUN=1 のため FTP アップロード skip"
    echo "  ローカル更新版: $cur_html"
  else
    log "  FTP アップロード中: ftp://$XSERVER_HOST$XSERVER_VOICE_PATH"
    if ! curl --silent --show-error -T "$cur_html" \
        "ftp://$XSERVER_HOST$XSERVER_VOICE_PATH" \
        --user "$XSERVER_USER:$XSERVER_PASS"; then
      err "FTP アップロード失敗"
      exit 1
    fi
    ok "  FTP アップロード OK"

    sleep 2
    local http_status server_vid
    http_status=$(curl -sS -o /dev/null -w "%{http_code}" "$VOICE_HTML_URL")
    server_vid=$(curl -sS "$VOICE_HTML_URL" | grep -oE "VOICE_ID='[A-Za-z0-9]+'" | head -1 | sed "s/VOICE_ID='//; s/'//")
    echo "  検証: HTTP $http_status / Server VID: $server_vid / Expected: $NEW_VOICE_ID"
    if [ "$http_status" = "200" ] && [ "$server_vid" = "$NEW_VOICE_ID" ]; then
      ok "A-6: デプロイ確認 OK"
    else
      err "A-6: デプロイ検証失敗。ロールバック: curl -T $backup ftp://$XSERVER_HOST$XSERVER_VOICE_PATH --user $XSERVER_USER:\$XSERVER_PASS"
      exit 1
    fi
  fi

  rm -f "$cur_html"

  echo ""
  ok "TASK A 完了: voice_id $OLD_VOICE_ID → $NEW_VOICE_ID"
}

# ───────────────────────────────────────────────
# TASK B
# ───────────────────────────────────────────────
task_b() {
  echo ""
  echo "══════════════════════════════════════════════"
  echo "  TASK B: /all/trial/ 404 検証"
  echo "══════════════════════════════════════════════"

  log "B-1: 旧 /all/ パスの状態"
  local paths=(
    "/all/trial/"
    "/all/trial/day1.html"
    "/all/trial/day2.html"
    "/all/"
    "/all/index.html"
    "/trial/day1.html"
    "/trial/day2.html"
  )
  for p in "${paths[@]}"; do
    local s r
    s=$(curl -sS -o /dev/null -w "%{http_code}" "https://sho-blog.com${p}")
    r=$(curl -sS -o /dev/null -w "%{redirect_url}" "https://sho-blog.com${p}")
    printf "  %-30s -> %s  redirect=%s\n" "$p" "$s" "$r"
  done

  echo ""
  log "B-2: 内部に残っている /all/ 参照"
  local urls=(
    "https://sho-blog.com/"
    "https://sho-blog.com/trial/day1.html"
    "https://sho-blog.com/trial/day2.html"
    "https://sho-blog.com/courses/"
    "https://sho-blog.com/report/"
  )
  for u in "${urls[@]}"; do
    local body cnt
    body=$(curl -sS "$u")
    cnt=$(echo "$body" | grep -c "/all/" || true)
    printf "  %-50s : %s refs\n" "$u" "$cnt"
    if [ "$cnt" -gt 0 ]; then
      echo "$body" | grep -oE 'href="[^"]*/all/[^"]*"' | sort -u | head -10 | sed 's/^/      /'
    fi
  done

  echo ""
  log "B-3: 判断材料と .htaccess 修正候補"
  cat <<'NOTE'
  判定指針:
    ・B-1 が全て 404 で、B-2 の参照件数が全て 0 → 何もしない (404 のままで良い)
    ・B-2 で内部参照が残っている → 該当 HTML を /all/trial/ → /trial/ 等に置換し再アップロード
    ・SNS や旧記事から外部流入を維持したい → 下記 .htaccess 追記候補を検討

  .htaccess 追記候補 (本番影響大、必ずバックアップしてから):

    # /all/ レガシーパスを 301 リダイレクト
    RewriteEngine On
    RewriteRule ^all/trial/(.*)$ /trial/$1 [R=301,L]
    RewriteRule ^all/courses/(.*)$ /courses/$1 [R=301,L]
    RewriteRule ^all/report/(.*)$ /report/$1 [R=301,L]
    RewriteRule ^all/(.*)$ /$1 [R=301,L]

  本スクリプトは .htaccess を変更しません。必要であれば
    curl -O ftp://${XSERVER_HOST}/sho-blog.com/public_html/.htaccess --user "$XSERVER_USER:$XSERVER_PASS"
  で取得し、追記後に再アップロードしてください。
NOTE
  echo ""
  ok "TASK B 完了 (調査のみ)"
}

# ───────────────────────────────────────────────
# main
# ───────────────────────────────────────────────
case "$TASK" in
  A|a)   task_a ;;
  B|b)   task_b ;;
  all|*) task_a; task_b ;;
esac

echo ""
echo "══════════════════════════════════════════════"
echo "  Phase 1 終了"
echo "══════════════════════════════════════════════"
echo "  ブラウザで $VOICE_HTML_URL を強制リロードして再生確認してください。"
echo "  クリーンアップ:"
echo "    unset ELEVEN_API_KEY XSERVER_PASS"
echo "    rm -f /tmp/phase1_test_output.mp3 /tmp/voice_current.*.html"
echo "  バックアップ:"
echo "    /tmp/voice_backup_*.html (ロールバック時に再アップ)"
