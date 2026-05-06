#!/usr/bin/env bash
# ═══════════════════════════════════════════════
# sho eigo - Phase 1-B: L3 Advanced ページ作成 (Cloud Shell 専用)
# ═══════════════════════════════════════════════
#
# 役割: 既存 /courses/parent/intermediate/ と /courses/student/intermediate/ を
#       FTP で取得し、¥3,480→¥3,980 / 39→51 / 720→900 / intermediate→advanced /
#       中級→上級 / 英検2級→1級 に置換した advanced 版を生成、
#       FTP で /courses/parent/advanced/ と /courses/student/advanced/ にアップロード。
#       両カテゴリのトップページに advanced カードリンクも追加する。
#
# 必須環境変数:
#   XSERVER_PASS    : Xserver FTP パスワード (現行 Take1216)
#
# 任意:
#   SKIP_UPLOAD     : 1 でアップロードを skip (生成のみ)
#   SKIP_TOP_INJECT : 1 でトップページ更新を skip
#
# 使い方 (Cloud Shell):
#   export XSERVER_PASS='Take1216'
#   bash scripts/phase1b_l3_advanced.sh
#
# 二重実行対策:
#   既存 advanced ページがあれば上書き。トップページの advanced リンクは
#   重複検出して既存があれば挿入 skip。
# ═══════════════════════════════════════════════

set -uo pipefail

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}[ok]${NC}  $*"; }
warn() { echo -e "${YELLOW}[!]${NC}  $*"; }
err()  { echo -e "${RED}[x]${NC}  $*" >&2; }

if [ -z "${XSERVER_PASS:-}" ]; then
  err "XSERVER_PASS が未設定。export XSERVER_PASS='Take1216' してください。"
  exit 1
fi

FTP_BASE="ftp://sv16546.xserver.jp/sho-blog.com/public_html"
HTTPS_BASE="https://sho-blog.com"
WORK_DIR="${WORK_DIR:-$HOME/phase1b_workdir}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/phase1b_backup}"
SKIP_UPLOAD="${SKIP_UPLOAD:-0}"
SKIP_TOP_INJECT="${SKIP_TOP_INJECT:-0}"

mkdir -p "$WORK_DIR" "$BACKUP_DIR"
cd "$WORK_DIR"

echo ""
echo "══════════════════════════════════════════════"
echo "  sho eigo Phase 1-B: L3 Advanced 生成 + アップ"
echo "  WORK_DIR  = $WORK_DIR"
echo "  BACKUP    = $BACKUP_DIR"
echo "  SKIP_UPLOAD=$SKIP_UPLOAD  SKIP_TOP_INJECT=$SKIP_TOP_INJECT"
echo "══════════════════════════════════════════════"

# ----------------------------------------
# Step 1: 既存ファイル取得
# ----------------------------------------
echo ""
echo "▶ Step 1: 既存 intermediate / トップページを取得"

declare -A FILES=(
  [parent_intermediate]="$FTP_BASE/courses/parent/intermediate/index.html"
  [student_intermediate]="$FTP_BASE/courses/student/intermediate/index.html"
  [parent_top]="$FTP_BASE/courses/parent/index.html"
  [student_top]="$FTP_BASE/courses/student/index.html"
)

for key in "${!FILES[@]}"; do
  url="${FILES[$key]}"
  out="$WORK_DIR/${key}.html"
  if curl -sS --user "xs672802:$XSERVER_PASS" "$url" -o "$out" 2>/dev/null && [ -s "$out" ]; then
    size=$(wc -c < "$out")
    ok "${key}: $size bytes 取得"
    cp "$out" "$BACKUP_DIR/${key}_$(date +%Y%m%d_%H%M%S).html"
  else
    err "${key}: 取得失敗 (URL: $url)"
    err "  本番に存在しない可能性。手動確認後に再実行してください。"
    exit 1
  fi
done

# ----------------------------------------
# Step 2: advanced 版生成 (sed 一括置換)
# ----------------------------------------
echo ""
echo "▶ Step 2: parent_advanced.html / student_advanced.html を生成"

sed_replace_advanced() {
  local src="$1"; local dst="$2"
  cp "$src" "$dst"

  # CSS クラス名 intermediate を一時退避 (スタイル崩れ防止)
  sed -i 's|class="intermediate"|class="__KEEP_CSS_intermediate"|g; s|class="[^"]*intermediate[^"]*"|__INSPECT_CLASS_&|g' "$dst"

  sed -i \
    -e 's|¥3,480|¥3,980|g' \
    -e 's|3,480円|3,980円|g' \
    -e 's|39コース|51コース|g' \
    -e 's|39 コース|51 コース|g' \
    -e 's|39レッスン|51レッスン|g' \
    -e 's|720レッスン|900レッスン|g' \
    -e 's|720 レッスン|900 レッスン|g' \
    -e 's|/intermediate/|/advanced/|g' \
    -e 's|"intermediate"|"advanced"|g' \
    -e "s|'intermediate'|'advanced'|g" \
    -e 's|>intermediate<|>advanced<|g' \
    -e 's|>Intermediate<|>Advanced<|g' \
    -e 's|中級コース|上級コース|g' \
    -e 's|中級プラン|上級プラン|g' \
    -e 's|中級向け|上級向け|g' \
    -e 's|中級レベル|上級レベル|g' \
    -e 's|（中級）|（上級）|g' \
    -e 's|（中級・|（上級・|g' \
    -e 's|英検2級まで|英検1級まで|g' \
    -e 's|英検準2級〜2級|英検準1級〜1級|g' \
    -e 's|英検準2級・2級|英検準1級・1級|g' \
    -e 's|準2級〜2級|準1級〜1級|g' \
    -e 's|Intermediate / 中級|Advanced / 上級|g' \
    -e 's|Intermediate|Advanced|g' \
    "$dst"

  # CSS クラス名 intermediate を復元
  sed -i 's|__KEEP_CSS_intermediate|intermediate|g; s|__INSPECT_CLASS_class="\([^"]*\)intermediate\([^"]*\)"|class="\1intermediate\2"|g' "$dst"

  # データ確認
  echo "  --- $dst の置換後抽出 ---"
  grep -nE '¥[0-9,]+|[0-9]+コース|[0-9]+レッスン|advanced|Advanced|上級|英検1級' "$dst" | head -10 | sed 's/^/    /'
}

# 親向け
sed_replace_advanced "$WORK_DIR/parent_intermediate.html" "$WORK_DIR/parent_advanced.html"
ok "parent_advanced.html 生成"

# 親向け追加: 高校生→大学受験生・社会人
sed -i \
  -e 's|高校生のお子さま|大学受験生・社会人のお子さま|g' \
  -e 's|高校生のお子さん|大学受験生・社会人のお子さん|g' \
  "$WORK_DIR/parent_advanced.html"

# 生徒向け
sed_replace_advanced "$WORK_DIR/student_intermediate.html" "$WORK_DIR/student_advanced.html"
ok "student_advanced.html 生成"

# 生徒向け追加: 高校生→大学受験生・社会人
sed -i \
  -e 's|高校生のあなたへ|大学受験生・社会人のあなたへ|g' \
  -e 's|高校生のための|大学受験生・社会人のための|g' \
  -e 's|高校生向け|大学受験生・社会人向け|g' \
  "$WORK_DIR/student_advanced.html"

# 残存検査
echo ""
echo "▶ Step 2-Verify: 古い数値が残っていないか"
for f in parent_advanced student_advanced; do
  remain_old_price=$(grep -c '¥3,480' "$WORK_DIR/${f}.html" || true)
  remain_old_count=$(grep -c '39コース\|39 コース' "$WORK_DIR/${f}.html" || true)
  remain_old_lesson=$(grep -c '720レッスン\|720 レッスン' "$WORK_DIR/${f}.html" || true)
  if [ "$remain_old_price" -eq 0 ] && [ "$remain_old_count" -eq 0 ] && [ "$remain_old_lesson" -eq 0 ]; then
    ok "${f}: 古い値の残存なし"
  else
    warn "${f}: 残存 ¥3,480=${remain_old_price} 39コース=${remain_old_count} 720レッスン=${remain_old_lesson}"
  fi
done

# ----------------------------------------
# Step 3: トップページに advanced カード追加
# ----------------------------------------
if [ "$SKIP_TOP_INJECT" = "1" ]; then
  warn "SKIP_TOP_INJECT=1 のためトップページ更新 skip"
else
  echo ""
  echo "▶ Step 3: parent_top / student_top に advanced カードを挿入"
  for top in parent_top student_top; do
    in_html="$WORK_DIR/${top}.html"
    out_html="$WORK_DIR/${top}_updated.html"
    python3 <<PY
import re

src_path = "$in_html"
out_path = "$out_html"
html = open(src_path, "r", encoding="utf-8").read()

# 既に /advanced/ リンクが含まれていれば挿入 skip
if "/advanced/" in html:
    print("  既に advanced リンクあり、挿入 skip")
    open(out_path, "w", encoding="utf-8").write(html)
    raise SystemExit(0)

# /intermediate/ を含む最初の祖先ブロックを推測する
# 戦略:
#   1. <article|section|div|li> ... </...> で /intermediate/ を含む最も近いブロックを探す
#   2. 見つかったら同じタグ範囲を複製し intermediate→advanced 等を置換して直後に挿入

candidates = []
# 単純実装: <li ... /intermediate/ ... </li>, <article ... /intermediate/ ... </article>, <div ... /intermediate/ ... </div>
for tag in ['li', 'article', 'section', 'div']:
    pattern = re.compile(r'<' + tag + r'[^>]*>(?:(?!<' + tag + r'\\b).)*?/intermediate/.*?</' + tag + r'>', re.DOTALL)
    for m in pattern.finditer(html):
        candidates.append((tag, m.start(), m.end(), m.group(0)))

if not candidates:
    print("  intermediate を含むブロックが見つからない → 挿入失敗")
    open(out_path, "w", encoding="utf-8").write(html)
    raise SystemExit(0)

# 最も内側 (短い) のブロックを採用
candidates.sort(key=lambda c: c[2] - c[1])
tag, s, e, block = candidates[0]
print(f"  detected <{tag}> block at {s}:{e} ({e-s} bytes)")

# advanced 版に書き換え
adv = block
adv = adv.replace("¥3,480", "¥3,980")
adv = adv.replace("3,480円", "3,980円")
adv = adv.replace("39コース", "51コース")
adv = adv.replace("39 コース", "51 コース")
adv = adv.replace("720レッスン", "900レッスン")
adv = adv.replace("720 レッスン", "900 レッスン")
adv = adv.replace("/intermediate/", "/advanced/")
adv = adv.replace("Intermediate / 中級", "Advanced / 上級")
adv = adv.replace("Intermediate", "Advanced")
adv = adv.replace("中級", "上級")
adv = adv.replace("英検2級まで", "英検1級まで")
adv = adv.replace("英検準2級〜2級", "英検準1級〜1級")

# CSS クラス名 intermediate は保護したいが、jp テキストとの区別が難しいので
# class="...intermediate..." だけは元に戻す
adv = re.sub(r'class="([^"]*)上級([^"]*)"',
             lambda m: 'class="' + m.group(1).replace('上級','intermediate') + m.group(2).replace('上級','intermediate') + '"' if 'class="' in m.group(0) and any(c in m.group(0) for c in ['plan-','card-','badge']) else m.group(0),
             adv)

# 元 block の直後に挿入
new_html = html[:e] + "\n" + adv + html[e:]
open(out_path, "w", encoding="utf-8").write(new_html)
print(f"  inserted advanced block ({len(adv)} bytes) after intermediate block")
PY
    if [ -s "$out_html" ]; then
      mv "$out_html" "$in_html"
      ok "${top}: 更新完了"
    else
      err "${top}: 更新失敗"
      exit 1
    fi
  done
fi

# ----------------------------------------
# Step 4: アップロード
# ----------------------------------------
if [ "$SKIP_UPLOAD" = "1" ]; then
  warn "SKIP_UPLOAD=1 のためアップロード skip"
else
  echo ""
  echo "▶ Step 4: FTP アップロード"

  upload() {
    local local_path="$1"; local remote_path="$2"
    if curl -sS --user "xs672802:$XSERVER_PASS" --ftp-create-dirs -T "$local_path" "$remote_path"; then
      ok "アップ: ${remote_path#${FTP_BASE}}"
    else
      err "アップ失敗: $remote_path"
      return 1
    fi
  }

  upload "$WORK_DIR/parent_advanced.html"  "$FTP_BASE/courses/parent/advanced/index.html"
  upload "$WORK_DIR/student_advanced.html" "$FTP_BASE/courses/student/advanced/index.html"
  if [ "$SKIP_TOP_INJECT" != "1" ]; then
    upload "$WORK_DIR/parent_top.html"  "$FTP_BASE/courses/parent/index.html"
    upload "$WORK_DIR/student_top.html" "$FTP_BASE/courses/student/index.html"
  fi
fi

# ----------------------------------------
# Step 5: 検証
# ----------------------------------------
if [ "$SKIP_UPLOAD" != "1" ]; then
  echo ""
  echo "▶ Step 5: 公開ページ検証"
  sleep 2

  echo "[HTTP ステータス]"
  for path in "/courses/parent/advanced/" "/courses/student/advanced/" "/courses/parent/" "/courses/student/"; do
    code=$(curl -sS -o /dev/null -w "%{http_code}" "${HTTPS_BASE}${path}")
    if [ "$code" = "200" ]; then ok "[$code] $path"; else err "[$code] $path"; fi
  done

  echo ""
  echo "[コンテンツ検証]"
  for cat in parent student; do
    body=$(curl -sS "${HTTPS_BASE}/courses/${cat}/advanced/")
    p3980=$(echo "$body" | grep -c '¥3,980')
    p3480=$(echo "$body" | grep -c '¥3,480')
    c51=$(echo "$body"   | grep -c '51コース\|51 コース')
    c39=$(echo "$body"   | grep -c '39コース\|39 コース')
    if [ "$p3980" -gt 0 ] && [ "$p3480" -eq 0 ] && [ "$c51" -gt 0 ] && [ "$c39" -eq 0 ]; then
      ok "${cat}/advanced/: ¥3,980=${p3980} ¥3,480=${p3480} 51=${c51} 39=${c39}"
    else
      err "${cat}/advanced/: ¥3,980=${p3980} ¥3,480=${p3480} 51=${c51} 39=${c39} (異常)"
    fi
  done

  echo ""
  echo "[トップページの advanced リンク]"
  for cat in parent student; do
    body=$(curl -sS "${HTTPS_BASE}/courses/${cat}/")
    n=$(echo "$body" | grep -c '/advanced/')
    if [ "$n" -gt 0 ]; then ok "${cat} top: advanced リンク ${n} 個"; else warn "${cat} top: advanced リンクなし"; fi
  done
fi

# ----------------------------------------
# 完了報告
# ----------------------------------------
cat <<EOF

══════════════════════════════════════════════
  ✅ Phase 1-B 完了
══════════════════════════════════════════════

  作成したページ:
    ${HTTPS_BASE}/courses/parent/advanced/
    ${HTTPS_BASE}/courses/student/advanced/

  更新したページ:
    ${HTTPS_BASE}/courses/parent/   (advanced リンク追加)
    ${HTTPS_BASE}/courses/student/  (advanced リンク追加)

  バックアップ: $BACKUP_DIR

  次のステップ:
    Phase 1-C は別途プロンプトで指示。
    勝手に進めない。

══════════════════════════════════════════════

EOF
