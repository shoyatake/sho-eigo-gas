#!/usr/bin/env bash
# ═══════════════════════════════════════════════
# sho eigo - Phase 2: 27 セグメント生成 + Xserver アップロード
# ═══════════════════════════════════════════════
#
# 前提（Phase 1 で完了済み）:
#   - ElevenLabs クローン作成済み
#   - voice_id 取得済み（ZYHkwuG2yr4rcubJRUms）
#
# このスクリプトの処理:
#   1. segments.json を読み込み
#   2. ElevenLabs TTS で 27 ファイル生成
#   3. ZIP 化
#   4. Xserver に FTP アップロード
#
# 必要な環境変数:
#   ELEVENLABS_API_KEY   : ElevenLabs API キー
#   XSERVER_PASS         : Xserver FTP パスワード（アップロードする場合）
#
# 任意（デフォルト値あり）:
#   VOICE_ID             : クローンの voice_id（既定: voice_id.txt から取得）
#   WORK_DIR             : 作業ディレクトリ（既定: ~/sho_audio_work）
#   OUTPUT_DIR           : 出力ディレクトリ（既定: ~/sho_audio_output）
#   SEGMENTS_JSON        : セグメント定義ファイル（既定: <repo>/scripts/segments.json）
#   XSERVER_HOST         : 既定 sv16546.xserver.jp
#   XSERVER_USER         : 既定 xs672802
#   XSERVER_REMOTE_DIR   : 既定 /trial/audio/sho/
#   SKIP_UPLOAD          : "1" で Xserver アップロードをスキップ
#
# 使い方:
#   export ELEVENLABS_API_KEY='sk_...'
#   export XSERVER_PASS='...'
#   bash scripts/sho_voice_phase2.sh
# ═══════════════════════════════════════════════

set -euo pipefail

# ─── 設定 ───
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK_DIR="${WORK_DIR:-$HOME/sho_audio_work}"
OUTPUT_DIR="${OUTPUT_DIR:-$HOME/sho_audio_output}"
SEGMENTS_JSON="${SEGMENTS_JSON:-${SCRIPT_DIR}/segments.json}"
MODEL_ID="${MODEL_ID:-eleven_multilingual_v2}"
STABILITY="${STABILITY:-0.5}"
SIMILARITY="${SIMILARITY:-0.75}"
STYLE="${STYLE:-0.2}"
SPEAKER_BOOST="${SPEAKER_BOOST:-true}"
MIN_BYTES="${MIN_BYTES:-10000}"
SLEEP_BETWEEN="${SLEEP_BETWEEN:-1}"

XSERVER_HOST="${XSERVER_HOST:-sv16546.xserver.jp}"
XSERVER_USER="${XSERVER_USER:-xs672802}"
XSERVER_REMOTE_DIR="${XSERVER_REMOTE_DIR:-/trial/audio/sho/}"
SKIP_UPLOAD="${SKIP_UPLOAD:-0}"

# ─── 色 ───
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo ""
echo "══════════════════════════════════════════════"
echo "  🎙️  sho eigo Phase 2: 27 セグメント生成 + アップロード"
echo "══════════════════════════════════════════════"
echo ""

# ═══════════════════════════════════════════════
# Step 0: 環境チェック
# ═══════════════════════════════════════════════
echo -e "${BLUE}▶ Step 0: 環境チェック${NC}"

if [ -z "${ELEVENLABS_API_KEY:-}" ]; then
  echo -e "${RED}❌ ELEVENLABS_API_KEY が未設定${NC}"
  echo "  実行前に: export ELEVENLABS_API_KEY='sk_...'"
  exit 1
fi
echo "  ✅ ELEVENLABS_API_KEY 設定済み (prefix: ${ELEVENLABS_API_KEY:0:5}***)"

if [ ! -f "$SEGMENTS_JSON" ]; then
  echo -e "${RED}❌ segments.json が見つからない: $SEGMENTS_JSON${NC}"
  exit 1
fi
SEG_COUNT=$(python3 -c "import json; print(len(json.load(open('$SEGMENTS_JSON'))))")
echo "  ✅ segments.json: $SEGMENTS_JSON ($SEG_COUNT segments)"

# voice_id 解決
if [ -z "${VOICE_ID:-}" ]; then
  if [ -f "$WORK_DIR/voice_id.txt" ]; then
    VOICE_ID=$(tr -d '[:space:]' < "$WORK_DIR/voice_id.txt")
  else
    echo -e "${RED}❌ VOICE_ID 未設定 かつ $WORK_DIR/voice_id.txt も無い${NC}"
    echo "  実行前に: export VOICE_ID='ZYHkwuG2yr4rcubJRUms'"
    echo "  または: mkdir -p $WORK_DIR && echo 'ZYHkwuG2yr4rcubJRUms' > $WORK_DIR/voice_id.txt"
    exit 1
  fi
fi
echo "  ✅ VOICE_ID: $VOICE_ID"

mkdir -p "$WORK_DIR" "$OUTPUT_DIR"
echo "  ✅ OUTPUT_DIR: $OUTPUT_DIR"
echo ""

# ═══════════════════════════════════════════════
# Step 1: voice_id 検証（任意 - voices:read 権限がない API key でも続行）
# ═══════════════════════════════════════════════
echo -e "${BLUE}▶ Step 1: voice_id 検証${NC}"
HTTP=$(curl -s -o /tmp/voice_check.json -w "%{http_code}" \
  -H "xi-api-key: $ELEVENLABS_API_KEY" \
  "https://api.elevenlabs.io/v1/voices/$VOICE_ID" || echo "000")
if [ "$HTTP" = "200" ]; then
  VOICE_NAME=$(python3 -c "import json; print(json.load(open('/tmp/voice_check.json')).get('name','?'))")
  echo "  ✅ voice 確認: $VOICE_NAME"
elif [ "$HTTP" = "401" ] && grep -q "missing_permissions" /tmp/voice_check.json 2>/dev/null; then
  echo -e "${YELLOW}  ⚠️ API key に voices:read 権限なし - 検証スキップして続行${NC}"
elif [ "$HTTP" = "404" ]; then
  echo -e "${RED}❌ voice_id がアカウントに存在しません: $VOICE_ID${NC}"
  exit 1
else
  echo -e "${YELLOW}  ⚠️ HTTP $HTTP - 検証スキップして続行${NC}"
  head -c 300 /tmp/voice_check.json 2>/dev/null
  echo
fi
echo ""

# ═══════════════════════════════════════════════
# Step 2: 27 セグメント生成
# ═══════════════════════════════════════════════
echo -e "${BLUE}▶ Step 2: 27 セグメント生成${NC}"

VOICE_ID="$VOICE_ID" \
OUTPUT_DIR="$OUTPUT_DIR" \
SEGMENTS_JSON="$SEGMENTS_JSON" \
MODEL_ID="$MODEL_ID" \
STABILITY="$STABILITY" \
SIMILARITY="$SIMILARITY" \
STYLE="$STYLE" \
SPEAKER_BOOST="$SPEAKER_BOOST" \
MIN_BYTES="$MIN_BYTES" \
SLEEP_BETWEEN="$SLEEP_BETWEEN" \
python3 - <<'PYEOF'
import json, os, sys, time, urllib.request, urllib.error

api_key   = os.environ["ELEVENLABS_API_KEY"]
voice_id  = os.environ["VOICE_ID"]
out_dir   = os.environ["OUTPUT_DIR"]
seg_file  = os.environ["SEGMENTS_JSON"]
model_id  = os.environ["MODEL_ID"]
stab      = float(os.environ["STABILITY"])
sim       = float(os.environ["SIMILARITY"])
style     = float(os.environ["STYLE"])
boost     = os.environ["SPEAKER_BOOST"].lower() == "true"
min_bytes = int(os.environ["MIN_BYTES"])
sleep_s   = float(os.environ["SLEEP_BETWEEN"])

with open(seg_file, encoding="utf-8") as f:
    segments = json.load(f)

print(f"  全 {len(segments)} セグメントを生成開始")
print()

ok = 0
ng = 0
ng_list = []

for i, seg in enumerate(segments, 1):
    fname = seg["filename"]
    text  = seg["text"]
    out_path = os.path.join(out_dir, fname)

    payload = json.dumps({
        "text": text,
        "model_id": model_id,
        "voice_settings": {
            "stability": stab,
            "similarity_boost": sim,
            "style": style,
            "use_speaker_boost": boost,
        },
    }).encode("utf-8")

    req = urllib.request.Request(
        f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
        data=payload,
        method="POST",
        headers={
            "xi-api-key": api_key,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg",
        },
    )

    print(f"  [{i:>2}/{len(segments)}] {fname}", end=" ", flush=True)
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = resp.read()
        with open(out_path, "wb") as f:
            f.write(data)
        size = len(data)
        if size < min_bytes:
            print(f"⚠️ size={size} (small)")
            ng += 1
            ng_list.append(fname)
        else:
            print(f"✅ {size} bytes")
            ok += 1
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")[:200]
        print(f"❌ HTTP {e.code}: {body}")
        ng += 1
        ng_list.append(fname)
    except Exception as e:
        print(f"❌ {e}")
        ng += 1
        ng_list.append(fname)

    time.sleep(sleep_s)

print()
print(f"  生成結果: OK={ok}, NG={ng}")
if ng:
    print("  失敗:")
    for n in ng_list:
        print(f"   - {n}")
    sys.exit(1)
PYEOF

echo ""
echo -e "${BLUE}▶ Step 3: 生成結果確認${NC}"
ls -lh "$OUTPUT_DIR"/*.mp3 | head -40
TOTAL=$(ls "$OUTPUT_DIR"/*.mp3 2>/dev/null | wc -l)
echo -e "${GREEN}  ✅ 合計: $TOTAL ファイル${NC}"
echo ""

# ═══════════════════════════════════════════════
# Step 4: ZIP 化
# ═══════════════════════════════════════════════
echo -e "${BLUE}▶ Step 4: ZIP 化${NC}"
ZIP_PATH="$HOME/sho_voice_clone_audio.zip"
( cd "$(dirname "$OUTPUT_DIR")" && zip -r "$ZIP_PATH" "$(basename "$OUTPUT_DIR")" -q )
ls -lh "$ZIP_PATH"
echo ""

# ═══════════════════════════════════════════════
# Step 5: Xserver アップロード（FTP）
# ═══════════════════════════════════════════════
echo -e "${BLUE}▶ Step 5: Xserver アップロード${NC}"

if [ "$SKIP_UPLOAD" = "1" ]; then
  echo -e "${YELLOW}  ⏭ SKIP_UPLOAD=1 のためスキップ${NC}"
elif [ -z "${XSERVER_PASS:-}" ]; then
  echo -e "${YELLOW}  ⚠️ XSERVER_PASS 未設定 - スキップ${NC}"
  echo "  あとで手動アップロード:"
  echo "    export XSERVER_PASS='...'"
  echo "    cd $OUTPUT_DIR"
  echo "    for f in *.mp3; do curl -T \"\$f\" \"ftp://${XSERVER_HOST}${XSERVER_REMOTE_DIR}\$f\" --user \"${XSERVER_USER}:\$XSERVER_PASS\"; done"
else
  cd "$OUTPUT_DIR"
  fail=0
  for f in *.mp3; do
    code=$(curl -s -o /tmp/ftp_resp.txt -w "%{http_code}" \
      -T "$f" \
      "ftp://${XSERVER_HOST}${XSERVER_REMOTE_DIR}$f" \
      --user "${XSERVER_USER}:${XSERVER_PASS}" \
      --max-time 60 || echo "ERR")
    if [ "$code" = "226" ] || [ "$code" = "0" ] || [ "$code" = "250" ]; then
      echo "  ✅ $f"
    else
      echo "  ❌ $f (code=$code)"
      head -c 200 /tmp/ftp_resp.txt 2>/dev/null || true
      echo
      fail=$((fail + 1)) || true
    fi
  done
  if [ "$fail" -gt 0 ]; then
    echo -e "${RED}  アップロード失敗: $fail 件${NC}"
    exit 1
  fi
fi

echo ""
echo "══════════════════════════════════════════════"
echo "  🎉 Phase 2 完了"
echo "══════════════════════════════════════════════"
echo "  生成: $TOTAL ファイル -> $OUTPUT_DIR"
echo "  ZIP:  $ZIP_PATH"
[ -n "${XSERVER_PASS:-}" ] && [ "$SKIP_UPLOAD" != "1" ] && \
  echo "  Xserver: ftp://${XSERVER_HOST}${XSERVER_REMOTE_DIR}"
echo ""
