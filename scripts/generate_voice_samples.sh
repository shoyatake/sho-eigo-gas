#!/usr/bin/env bash
# ElevenLabs voice sample generator for voice_id sVWsMHkLPX1qFn88g9s4.
# Generates 5 preview MP3s and packages them into a ZIP for review.
#
# Usage:
#   export ELEVENLABS_API_KEY='xxx'
#   ./scripts/generate_voice_samples.sh [output_dir]
#
# Default output_dir: ./voice_samples (gitignored).

set -euo pipefail

VOICE_ID="${VOICE_ID:-sVWsMHkLPX1qFn88g9s4}"
MODEL_ID="${MODEL_ID:-eleven_multilingual_v2}"
STABILITY="${STABILITY:-0.5}"
SIMILARITY="${SIMILARITY:-0.75}"
STYLE="${STYLE:-0.2}"
SPEAKER_BOOST="${SPEAKER_BOOST:-true}"

OUT_DIR="${1:-$(pwd)/voice_samples}"
MIN_BYTES=10000

if [ -z "${ELEVENLABS_API_KEY:-}" ]; then
  echo "ELEVENLABS_API_KEY is not set. Run: export ELEVENLABS_API_KEY='xxx'" >&2
  exit 1
fi

echo "API key prefix: ${ELEVENLABS_API_KEY:0:5}***"
echo "Voice ID:       ${VOICE_ID}"
echo "Output dir:     ${OUT_DIR}"
mkdir -p "${OUT_DIR}"

# name|text
SAMPLES=(
  "sample_01_intro|こんにちは、sho先生です。今日からあなたは、英語の音を体に入れる学習を始めます。"
  "sample_02_lesson|今日のレッスン、始めるで！まずは今の自分の声を、録音してみよう。"
  "sample_03_explain|英語の water は、ウォーターじゃなくて、ワラ。これがフラップ T のルールやで。"
  "sample_04_encourage|よく頑張ったな！2日間、本当にお疲れさま。明日からも、一緒に続けていこう。"
  "sample_05_long|カタカナ英語を一度リセットして、本物の英語の音を耳と口から直接体に染み込ませる。これがシャドーイング学習法です。最初は難しく感じるかもしれません。でも大丈夫、毎日15分続けるだけで、3ヶ月後には英語が確実に変わります。"
)

generate_sample() {
  local name="$1"
  local text="$2"
  local out_file="${OUT_DIR}/${name}.mp3"

  local payload
  payload=$(VOICE_TEXT="$text" MODEL_ID="$MODEL_ID" STABILITY="$STABILITY" \
            SIMILARITY="$SIMILARITY" STYLE="$STYLE" SPEAKER_BOOST="$SPEAKER_BOOST" \
            python3 -c '
import json, os
print(json.dumps({
  "text": os.environ["VOICE_TEXT"],
  "model_id": os.environ["MODEL_ID"],
  "voice_settings": {
    "stability": float(os.environ["STABILITY"]),
    "similarity_boost": float(os.environ["SIMILARITY"]),
    "style": float(os.environ["STYLE"]),
    "use_speaker_boost": os.environ["SPEAKER_BOOST"].lower() == "true",
  },
}))')

  local http_code
  http_code=$(curl -X POST "https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}" \
    -H "xi-api-key: ${ELEVENLABS_API_KEY}" \
    -H "Content-Type: application/json" \
    -H "Accept: audio/mpeg" \
    --data-raw "${payload}" \
    --output "${out_file}" \
    --silent --show-error --write-out "%{http_code}")

  if [ "${http_code}" != "200" ]; then
    echo "  ${name}: HTTP ${http_code}"
    echo "  response body:"
    cat "${out_file}" | head -c 500
    echo
    return 1
  fi

  local size
  size=$(stat -c%s "${out_file}")
  if [ "${size}" -lt "${MIN_BYTES}" ]; then
    echo "  ${name}: file too small (${size} bytes)"
    cat "${out_file}" | head -c 500
    echo
    return 1
  fi

  echo "  ${name}.mp3 OK (${size} bytes)"
}

echo
echo "Generating samples..."
fail=0
for entry in "${SAMPLES[@]}"; do
  name="${entry%%|*}"
  text="${entry#*|}"
  if ! generate_sample "${name}" "${text}"; then
    fail=$((fail + 1))
  fi
done

echo
echo "=== Files ==="
ls -lh "${OUT_DIR}"

if [ "${fail}" -gt 0 ]; then
  echo
  echo "${fail} sample(s) failed." >&2
  exit 1
fi

ZIP_PATH="${OUT_DIR%/}.zip"
rm -f "${ZIP_PATH}"
( cd "$(dirname "${OUT_DIR}")" && zip -rq "${ZIP_PATH}" "$(basename "${OUT_DIR}")" )
echo
echo "ZIP: ${ZIP_PATH}"
ls -lh "${ZIP_PATH}"
