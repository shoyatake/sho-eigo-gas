#!/usr/bin/env bash
# ═══════════════════════════════════════════════
# sho eigo - sho voice 暫定無音化スクリプト
# ═══════════════════════════════════════════════
#
# 目的: 新 sho クローン (ZYHkwuG2yr4rcubJRUms) の fine-tune が
#       完了するまでの間、trial day1.html / day2.html で
#       sho voice の再生を client-side でスキップさせる。
#       これにより旧暫定 voice (9tnqrcdSuRMggTdDrs9C, おじさん声)
#       が体験ユーザーに流れるのを防ぐ。
#
# 解除手順 (fine-tune 完了後):
#   day1.html / day2.html から以下の 1 行を削除して再 FTP:
#     if (selectedVoice === 'sho') return; // 暫定: ...
#   または `bash scripts/silence_sho_voice.sh` を再実行する場合は
#   GUARD_FRAGMENT で grep して既存ガード行を消した上で再実行。
#
# 処理:
#   1. https://sho-blog.com/trial/dayN.html を取得
#   2. playNarration 内の `if (!text) return;` 直後にガード行挿入
#      (既に挿入済みなら何もせずスキップ)
#   3. FTP で sho-blog.com/public_html/trial/dayN.html を上書き
#   4. live を再取得してガード行が反映されているか検証
#
# 必須環境変数:
#   XSERVER_PASS         : Xserver FTP パスワード
#
# 任意 (デフォルト値あり):
#   XSERVER_HOST         : 既定 sv16546.xserver.jp
#   XSERVER_USER         : 既定 xs672802
#   TRIAL_URL_BASE       : 既定 https://sho-blog.com/trial
#   TRIAL_REMOTE_DIR     : 既定 sho-blog.com/public_html/trial
#                          (末尾 / なし、ホスト直下相対パス)
#   TRIAL_FILES          : 既定 "day1.html day2.html"
#   DRY_RUN              : 1 にするとパッチまで実行して FTP 送信しない
#
# 使い方:
#   export XSERVER_PASS='...'
#   bash scripts/silence_sho_voice.sh
#
#   # ドライラン (FTP 送信しない):
#   DRY_RUN=1 bash scripts/silence_sho_voice.sh
#
#   # 別パス (LINE 導線が /all/trial/trial_dayN.html だった場合等):
#   TRIAL_URL_BASE='https://sho-blog.com/all/trial' \
#   TRIAL_REMOTE_DIR='sho-blog.com/public_html/all/trial' \
#   TRIAL_FILES='trial_day1.html trial_day2.html' \
#     bash scripts/silence_sho_voice.sh
# ═══════════════════════════════════════════════

set -uo pipefail

XSERVER_HOST="${XSERVER_HOST:-sv16546.xserver.jp}"
XSERVER_USER="${XSERVER_USER:-xs672802}"
TRIAL_URL_BASE="${TRIAL_URL_BASE:-https://sho-blog.com/trial}"
TRIAL_REMOTE_DIR="${TRIAL_REMOTE_DIR:-sho-blog.com/public_html/trial}"
TRIAL_FILES="${TRIAL_FILES:-day1.html day2.html}"
DRY_RUN="${DRY_RUN:-0}"

ANCHOR='if (!text) return;'
GUARD_FRAGMENT="if (selectedVoice === 'sho') return;"
GUARD_COMMENT="// 暫定: 新 sho クローン fine-tune 完了まで無音"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo ""
echo "══════════════════════════════════════════════"
echo -e "  ${BLUE}🔇 sho voice 暫定無音化${NC}"
echo "══════════════════════════════════════════════"
echo "  URL base   : $TRIAL_URL_BASE"
echo "  Remote dir : $TRIAL_REMOTE_DIR"
echo "  Files      : $TRIAL_FILES"
echo "  Dry run    : $DRY_RUN"
echo ""

if [ "$DRY_RUN" != "1" ] && [ -z "${XSERVER_PASS:-}" ]; then
  echo -e "${RED}❌ XSERVER_PASS が未設定です${NC}"
  echo "   実行前に: export XSERVER_PASS='...'"
  echo "   または FTP 送信せず確認だけしたい場合: DRY_RUN=1 bash $0"
  exit 1
fi

WORK_DIR="$(mktemp -d -t silence-sho-XXXXXX)"
trap 'rm -rf "$WORK_DIR"' EXIT
cd "$WORK_DIR"

OK_COUNT=0
SKIP_COUNT=0
FAIL_COUNT=0

for f in $TRIAL_FILES; do
  echo -e "${BLUE}── $f ──${NC}"
  if ! curl -fsS -o "$f" "$TRIAL_URL_BASE/$f"; then
    echo -e "  ${RED}❌ ダウンロード失敗: $TRIAL_URL_BASE/$f${NC}"
    FAIL_COUNT=$((FAIL_COUNT + 1))
    continue
  fi
  before_size=$(wc -c < "$f")
  echo "  📥 ダウンロード OK ($before_size bytes)"

  if grep -qF "$GUARD_FRAGMENT" "$f"; then
    echo -e "  ${YELLOW}⏭  既にガード行が挿入済み → スキップ${NC}"
    SKIP_COUNT=$((SKIP_COUNT + 1))
    continue
  fi

  n=$(grep -cF "$ANCHOR" "$f" || true)
  if [ "$n" != "1" ]; then
    echo -e "  ${RED}❌ アンカー '$ANCHOR' のヒット数 = $n (期待値 1)${NC}"
    echo "     自動パッチを中止します。手動で確認してください。"
    FAIL_COUNT=$((FAIL_COUNT + 1))
    continue
  fi

  # アンカー行のインデントを検出してガード行を組み立てる
  indent=$(grep -F "$ANCHOR" "$f" | head -1 | sed -E 's/^([[:space:]]*).*/\1/')
  guard_line="${indent}${GUARD_FRAGMENT} ${GUARD_COMMENT}"

  awk -v anchor="$ANCHOR" -v guard="$guard_line" '
    BEGIN { inserted = 0 }
    {
      print
      if (!inserted && index($0, anchor) > 0) {
        print guard
        inserted = 1
      }
    }
  ' "$f" > "${f}.new" && mv "${f}.new" "$f"

  after_size=$(wc -c < "$f")
  echo -e "  ${GREEN}✏️  パッチ適用${NC} ($before_size → $after_size bytes)"
  echo "  --- patched playNarration head ---"
  grep -n -A4 "function playNarration" "$f" | head -6 | sed 's/^/    /'

  if [ "$DRY_RUN" = "1" ]; then
    echo -e "  ${YELLOW}🛈  DRY_RUN=1 のため FTP 送信スキップ${NC}"
    OK_COUNT=$((OK_COUNT + 1))
    continue
  fi

  if curl -fsS -T "$f" \
       "ftp://$XSERVER_HOST/$TRIAL_REMOTE_DIR/$f" \
       --user "$XSERVER_USER:$XSERVER_PASS" --ftp-pasv; then
    echo -e "  ${GREEN}📤 FTP upload 完了${NC}"
    OK_COUNT=$((OK_COUNT + 1))
  else
    echo -e "  ${RED}❌ FTP upload 失敗${NC}"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
done

if [ "$DRY_RUN" != "1" ]; then
  echo ""
  echo "══════════════════════════════════════════════"
  echo -e "  ${BLUE}📡 反映確認 (live)${NC}"
  echo "══════════════════════════════════════════════"
  for f in $TRIAL_FILES; do
    printf "── %s/%s ──\n" "$TRIAL_URL_BASE" "$f"
    if curl -fsS "$TRIAL_URL_BASE/$f" | grep -qF "$GUARD_FRAGMENT"; then
      echo -e "  ${GREEN}✅ ガード行を検出 → デプロイ済み${NC}"
    else
      echo -e "  ${RED}❌ ガード行が見えない${NC}"
      echo "     CDN キャッシュ等を確認してください。"
    fi
  done
fi

echo ""
echo "══════════════════════════════════════════════"
echo -e "  サマリ: ${GREEN}OK=$OK_COUNT${NC} ${YELLOW}SKIP=$SKIP_COUNT${NC} ${RED}FAIL=$FAIL_COUNT${NC}"
echo "══════════════════════════════════════════════"

if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
fi
