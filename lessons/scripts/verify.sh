#!/bin/bash
# Verify deployed lessons by fetching each course's day01 over HTTP and
# checking the embedded DATA object. No screenshots: curl + grep only.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LESSONS_DIR="$(dirname "$SCRIPT_DIR")"
MANIFEST="$LESSONS_DIR/manifest.json"
BASE_URL="${BASE_URL:-https://sho-blog.com/all}"

if [ ! -f "$MANIFEST" ]; then
    echo "error: manifest.json not found: $MANIFEST" >&2
    exit 2
fi

ok=0
ng=0
total=0

while IFS= read -r folder; do
    url="${BASE_URL}/${folder}/day01.html"
    body="$(curl -sS "$url" || true)"
    if echo "$body" | grep -q '"lesson_id"'; then
        echo "OK  $url"
        ok=$((ok + 1))
    else
        echo "NG  $url"
        ng=$((ng + 1))
    fi
    total=$((total + 1))
done < <(python3 -c "
import json
m = json.load(open('$MANIFEST'))
for c in m['courses']:
    print(c['folder'])
")

echo
echo "total: $total / ok: $ok / ng: $ng"
[ "$ng" -eq 0 ]
