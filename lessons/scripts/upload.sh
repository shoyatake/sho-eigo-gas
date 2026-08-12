#!/bin/bash
# Upload generated HTML files under ../output/ to Xserver via FTP.
# FTP_PASS must be set in the environment.
#   $ export FTP_PASS='...'
#   $ ./scripts/upload.sh
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LESSONS_DIR="$(dirname "$SCRIPT_DIR")"
OUTPUT_DIR="$LESSONS_DIR/output"
LOG_DIR="$LESSONS_DIR/logs"
mkdir -p "$LOG_DIR"

FTP_HOST="${FTP_HOST:-sv16546.xserver.jp}"
FTP_USER="${FTP_USER:-xs672804}"
REMOTE_BASE="${REMOTE_BASE:-/sho-blog.com/public_html/all}"

if [ -z "${FTP_PASS:-}" ]; then
    echo "error: FTP_PASS is not set. Run: export FTP_PASS='...'" >&2
    exit 2
fi
if [ ! -d "$OUTPUT_DIR" ]; then
    echo "error: output directory not found: $OUTPUT_DIR" >&2
    exit 2
fi

total=0
success=0
fail=0

cd "$OUTPUT_DIR"
for folder in */; do
    folder_name="${folder%/}"
    echo "uploading: $folder_name"

    for file in "$folder"*.html; do
        [ -e "$file" ] || continue
        filename="$(basename "$file")"
        remote="${REMOTE_BASE}/${folder_name}/${filename}"
        total=$((total + 1))

        if curl -sS -T "$file" "ftp://${FTP_HOST}${remote}" \
                --user "${FTP_USER}:${FTP_PASS}" \
                --ftp-pasv --ftp-create-dirs > /dev/null; then
            success=$((success + 1))
        else
            fail=$((fail + 1))
            echo "failed: $file" | tee -a "$LOG_DIR/upload.err"
        fi
    done
done

echo
echo "total: $total / success: $success / fail: $fail"
[ "$fail" -eq 0 ]
