#!/usr/bin/env bash
# pages/auth/ を sho-blog.com/public_html/auth/ に FTP でアップロード
#
# 使い方:
#   cd "$(git rev-parse --show-toplevel)"
#   bash scripts/deploy_auth.sh
#
# 実行中に FTP パスワードを対話で聞かれます。

set -uo pipefail

cd "$(git rev-parse --show-toplevel)"

read -rs -p "FTPパスワード: " FTPPASS; echo

PAGES=(
  "pages/auth/lib.js|sho-blog.com/public_html/auth/lib.js"
  "pages/auth/login.html|sho-blog.com/public_html/auth/login.html"
  "pages/auth/callback.html|sho-blog.com/public_html/auth/callback.html"
  "pages/auth/dashboard.html|sho-blog.com/public_html/auth/dashboard.html"
)

echo "==== Uploading ===="
for entry in "${PAGES[@]}"; do
  src="${entry%%|*}"
  dst="${entry##*|}"
  printf "  %s → %s ... " "$src" "$dst"
  if curl -sS -T "$src" "ftp://sv16546.xserver.jp/${dst}" \
       --user "xs672802:$FTPPASS" --ftp-pasv --ftp-create-dirs; then
    echo "OK"
  else
    echo "FAIL"
  fi
done

echo ""
echo "==== Verifying ===="
for u in https://sho-blog.com/auth/login.html \
         https://sho-blog.com/auth/callback.html \
         https://sho-blog.com/auth/dashboard.html \
         https://sho-blog.com/auth/lib.js ; do
  printf "%s → " "$u"; curl -sI "$u" | head -1
done

unset FTPPASS
echo ""
echo "==== 完了。ブラウザで https://sho-blog.com/auth/login.html を開いて確認 ===="
