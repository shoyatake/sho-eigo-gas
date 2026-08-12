#!/usr/bin/env bash
# ═══════════════════════════════════════════════
# sho eigo - アップロード専用スクリプト
# ═══════════════════════════════════════════════
#
# 目的: scripts/sho_voice_phase2.sh が Step 2(生成) で成功した後、
#       Step 5(アップロード) だけが失敗した場合のリカバリ用。
#       ElevenLabs API は呼ばないので文字数を消費しない。
#
# 処理:
#   1. ローカルの mp3 数を確認
#   2. Xserver FTP に接続できるか検証
#   3. ターゲットディレクトリの存在確認 (失敗したら親をたどって自動作成)
#   4. 27 ファイルを一気にアップロード (失敗しても全件試行)
#   5. 成否サマリ
#
# 必須環境変数:
#   XSERVER_PASS         : Xserver FTP パスワード
#
# 任意 (デフォルト値あり):
#   OUTPUT_DIR           : ローカル mp3 ディレクトリ (既定: ~/sho_audio_output)
#   XSERVER_HOST         : 既定 sv16546.xserver.jp
#   XSERVER_USER         : 既定 xs672802
#   XSERVER_REMOTE_DIR   : 既定 /trial/audio/sho/
#                          (末尾 / 必須、絶対パス)
#   AUTO_MKDIR           : 既定 1。0 にすると不在ディレクトリを作らず終了
#   PROBE_ONLY           : 1 にすると探索だけ実行 (アップロードしない)
#
# 使い方:
#   export XSERVER_PASS='...'
#   bash scripts/sho_voice_upload_only.sh
#
#   # 別ディレクトリへ:
#   XSERVER_REMOTE_DIR='/example.com/public_html/audio/sho/' \
#     bash scripts/sho_voice_upload_only.sh
#
#   # 探索だけ:
#   PROBE_ONLY=1 bash scripts/sho_voice_upload_only.sh
# ═══════════════════════════════════════════════

set -uo pipefail

OUTPUT_DIR="${OUTPUT_DIR:-$HOME/sho_audio_output}"
XSERVER_HOST="${XSERVER_HOST:-sv16546.xserver.jp}"
XSERVER_USER="${XSERVER_USER:-xs672802}"
XSERVER_REMOTE_DIR="${XSERVER_REMOTE_DIR:-/trial/audio/sho/}"
AUTO_MKDIR="${AUTO_MKDIR:-1}"
PROBE_ONLY="${PROBE_ONLY:-0}"
TIMEOUT="${TIMEOUT:-60}"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo ""
echo "══════════════════════════════════════════════"
echo "  📤 sho eigo Xserver アップロード専用"
echo "══════════════════════════════════════════════"
echo ""

# ─── 環境チェック ───
echo -e "${BLUE}▶ 環境チェック${NC}"
if [ -z "${XSERVER_PASS:-}" ]; then
  echo -e "${RED}❌ XSERVER_PASS が未設定${NC}"
  echo "  実行前に: export XSERVER_PASS='...'"
  exit 1
fi
echo "  ✅ XSERVER_PASS 設定済み (length=${#XSERVER_PASS})"

if [ ! -d "$OUTPUT_DIR" ]; then
  echo -e "${RED}❌ OUTPUT_DIR が存在しない: $OUTPUT_DIR${NC}"
  exit 1
fi

shopt -s nullglob
MP3_FILES=( "$OUTPUT_DIR"/*.mp3 )
shopt -u nullglob
LOCAL_COUNT=${#MP3_FILES[@]}
if [ "$LOCAL_COUNT" -eq 0 ]; then
  echo -e "${RED}❌ $OUTPUT_DIR に mp3 ファイルが無い${NC}"
  echo "  先に bash scripts/sho_voice_phase2.sh で生成してください"
  exit 1
fi
echo "  ✅ ローカル mp3: $LOCAL_COUNT 件"
echo "  ✅ ターゲット: ftp://${XSERVER_HOST}${XSERVER_REMOTE_DIR}"
echo ""

# ─── 接続確認 ───
echo -e "${BLUE}▶ FTP 接続確認${NC}"
ROOT_LIST=$(curl -s --max-time "$TIMEOUT" \
  "ftp://${XSERVER_HOST}/" \
  --user "${XSERVER_USER}:${XSERVER_PASS}" 2>&1)
ROOT_RC=$?
if [ "$ROOT_RC" -ne 0 ]; then
  echo -e "${RED}❌ FTP 接続/認証失敗 (curl exit=$ROOT_RC)${NC}"
  echo "$ROOT_LIST" | head -5
  exit 1
fi
echo "  ✅ ログイン成功"
echo "  ── ルート直下のディレクトリ ──"
echo "$ROOT_LIST" | awk '{print "    " $0}' | head -40
echo ""

# ─── ターゲット存在確認 ───
echo -e "${BLUE}▶ ターゲットディレクトリ確認: $XSERVER_REMOTE_DIR${NC}"
TARGET_LIST=$(curl -s --max-time "$TIMEOUT" \
  "ftp://${XSERVER_HOST}${XSERVER_REMOTE_DIR}" \
  --user "${XSERVER_USER}:${XSERVER_PASS}" 2>&1)
TARGET_RC=$?

if [ "$TARGET_RC" -eq 0 ]; then
  echo -e "${GREEN}  ✅ ターゲット到達可${NC}"
  EXISTING=$(echo "$TARGET_LIST" | grep -c "\.mp3$" || true)
  echo "  既存 mp3: $EXISTING 件"
else
  echo -e "${YELLOW}  ⚠️ ターゲット未到達 (curl exit=$TARGET_RC)${NC}"
  if [ "$AUTO_MKDIR" = "1" ]; then
    echo "  → 親ディレクトリから順に MKD で作成試行"
    # 末尾 / を削って path 分解
    REL="${XSERVER_REMOTE_DIR%/}"
    REL="${REL#/}"
    IFS='/' read -ra PARTS <<< "$REL"
    ACCUM=""
    for p in "${PARTS[@]}"; do
      [ -z "$p" ] && continue
      PARENT="${ACCUM}/"
      ACCUM="${ACCUM}/${p}"
      MKD_OUT=$(curl -s --max-time "$TIMEOUT" \
        -Q "MKD ${p}" \
        "ftp://${XSERVER_HOST}${PARENT}" \
        --user "${XSERVER_USER}:${XSERVER_PASS}" 2>&1)
      MKD_RC=$?
      if [ "$MKD_RC" -eq 0 ]; then
        echo "    ✅ MKD ${ACCUM}"
      else
        # 既存だったら 550 が返るので、それを判別
        if echo "$MKD_OUT" | grep -qiE "(file exists|already exists|550)"; then
          echo "    ・ ${ACCUM} (既存)"
        else
          echo "    ⚠️ MKD ${ACCUM} 失敗 (rc=$MKD_RC)"
          echo "$MKD_OUT" | head -3 | awk '{print "      " $0}'
        fi
      fi
    done
    # 再確認
    TARGET_LIST=$(curl -s --max-time "$TIMEOUT" \
      "ftp://${XSERVER_HOST}${XSERVER_REMOTE_DIR}" \
      --user "${XSERVER_USER}:${XSERVER_PASS}" 2>&1)
    TARGET_RC=$?
    if [ "$TARGET_RC" -ne 0 ]; then
      echo -e "${RED}  ❌ 作成後もターゲット到達不可 (rc=$TARGET_RC)${NC}"
      echo "$TARGET_LIST" | head -5 | awk '{print "    " $0}'
      echo ""
      echo "  💡 XSERVER_REMOTE_DIR を別パスに上書きして再実行:"
      echo "     XSERVER_REMOTE_DIR='/your-domain.com/public_html/audio/sho/' \\"
      echo "       bash scripts/sho_voice_upload_only.sh"
      exit 1
    fi
    echo -e "${GREEN}  ✅ ターゲット到達可になりました${NC}"
  else
    echo -e "${RED}  ❌ AUTO_MKDIR=0 のため作成スキップ。終了。${NC}"
    exit 1
  fi
fi
echo ""

if [ "$PROBE_ONLY" = "1" ]; then
  echo -e "${YELLOW}▶ PROBE_ONLY=1 のためアップロードはスキップ${NC}"
  exit 0
fi

# ─── アップロード ───
echo -e "${BLUE}▶ アップロード ($LOCAL_COUNT 件)${NC}"
ok=0
ng=0
ng_files=()
i=0
for f in "${MP3_FILES[@]}"; do
  i=$((i + 1))
  base=$(basename "$f")
  code=$(curl -s -o /tmp/upload_resp.txt -w "%{http_code}" \
    --max-time "$TIMEOUT" \
    -T "$f" \
    "ftp://${XSERVER_HOST}${XSERVER_REMOTE_DIR}${base}" \
    --user "${XSERVER_USER}:${XSERVER_PASS}" 2>/dev/null || echo "ERR")
  if [ "$code" = "226" ] || [ "$code" = "250" ] || [ "$code" = "0" ]; then
    printf "  [%2d/%2d] ✅ %s\n" "$i" "$LOCAL_COUNT" "$base"
    ok=$((ok + 1))
  else
    printf "  [%2d/%2d] ❌ %s (code=%s)\n" "$i" "$LOCAL_COUNT" "$base" "$code"
    body=$(head -c 200 /tmp/upload_resp.txt 2>/dev/null || true)
    [ -n "$body" ] && echo "         $body"
    ng=$((ng + 1))
    ng_files+=("$base")
  fi
done

echo ""
echo "══════════════════════════════════════════════"
echo "  📊 結果: OK=$ok  NG=$ng"
echo "══════════════════════════════════════════════"
if [ "$ng" -gt 0 ]; then
  echo -e "${RED}失敗ファイル:${NC}"
  for n in "${ng_files[@]}"; do
    echo "  - $n"
  done
  echo ""
  echo "  💡 失敗したファイルだけ後で個別に再試行可能"
  exit 1
fi
echo -e "${GREEN}🎉 全 $ok ファイル アップロード完了${NC}"
echo "  確認URL例: https://${XSERVER_HOST/sv*.xserver.jp/(あなたのドメイン)}${XSERVER_REMOTE_DIR}$(basename "${MP3_FILES[0]}")"
echo ""
