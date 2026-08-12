#!/usr/bin/env bash
# ═══════════════════════════════════════════════
# sho eigo - 親子体験 day1/day2 を生成 (Cloud Shell 専用)
# ═══════════════════════════════════════════════
#
# 役割:
#   既存 https://sho-blog.com/trial/day1.html と day2.html を取得し、
#   parent_trial_spec.md §3-2, §3-3 の差分指示に従って
#   pages/trial/parent_day1.html / parent_day2.html を生成する。
#
# 使い方 (Cloud Shell):
#   cd ~/sho-eigo-gas
#   bash scripts/build_parent_trial.sh
#   git add pages/trial/parent_day*.html
#   git commit -m "Generate parent_day1/day2 from production trial pages"
#   git push
#
# 注意:
#   - スクリプト本体は本番ページの取得 + 機械的な置換のみ。
#   - 完成したファイルは必ず一度ブラウザで開いて (curl で head -50)
#     パッセージ・録音 UI が壊れていないかを確認してから push。
# ═══════════════════════════════════════════════

set -uo pipefail

OUT_DIR="pages/trial"
mkdir -p "$OUT_DIR"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

ok()   { echo -e "${GREEN}[ok]${NC}  $*"; }
warn() { echo -e "${YELLOW}[!]${NC}  $*"; }
err()  { echo -e "${RED}[x]${NC}  $*" >&2; }

# 1. day1 取得
echo ""
echo "▶ Step 1: 既存 day1.html を取得"
if curl -fsS "https://sho-blog.com/trial/day1.html" -o /tmp/parent_day1_src.html; then
  ok "day1.html 取得成功 ($(wc -l < /tmp/parent_day1_src.html) 行)"
else
  err "day1.html 取得失敗。本番に存在するか確認してください。"; exit 1
fi

# 2. day1 → parent_day1 改造
echo ""
echo "▶ Step 2: parent_day1.html 生成"
cp /tmp/parent_day1_src.html "$OUT_DIR/parent_day1.html"

# パッセージは触らず、保護者向け文言に上書き
sed -i \
  -e "s|これからシャドーイング体験を始めます|お子さんの今の声は、今しか録音できません。これから 2 日間で、成長アルバムの最初の 1 ページを一緒に作りましょう|g" \
  -e "s|今の自分の英語を録音してください|今日のお子さんの英語の声を録ります。これがアルバムの 1 ページ目になります。お母さん・お父さんも一緒に聴いてあげてください|g" \
  -e "s|最後にもう一度録音します|同じ英文を、もう一度録ります。20 分前との変化を、ぜひ親子で聴き比べてください|g" \
  -e "s|Day1 完了！明日 6 時に Day2 が解放されます|Day1 のページが完成しました ✨ 明日 6 時に Day2 が解放されます。Day2 では、今日のビフォー・アフターと明日の音読を並べて聴くことができます|g" \
  -e "s|Day1 完了！|Day1 のページが完成しました ✨|g" \
  -e "s|<title>.*</title>|<title>音で残す成長のアルバム — Day1 \\| sho eigo</title>|" \
  "$OUT_DIR/parent_day1.html"

# Day2 リンクを parent 版に差し替え
sed -i 's|trial/day2\.html|trial/parent_day2.html|g; s|/trial/day2"|/trial/parent_day2.html"|g' "$OUT_DIR/parent_day1.html"

# ローカルストレージキーを別空間に
sed -i 's|trial_day1_completed_at|parent_trial_day1_completed_at|g; s|day1_before|parent_day1_before|g; s|day1_after|parent_day1_after|g' "$OUT_DIR/parent_day1.html"

ok "parent_day1.html 生成完了 ($(wc -l < "$OUT_DIR/parent_day1.html") 行)"

# 3. day2 取得 + 改造
echo ""
echo "▶ Step 3: 既存 day2.html を取得 → parent_day2.html 生成"
if curl -fsS "https://sho-blog.com/trial/day2.html" -o /tmp/parent_day2_src.html; then
  ok "day2.html 取得成功"
else
  err "day2.html 取得失敗"; exit 1
fi
cp /tmp/parent_day2_src.html "$OUT_DIR/parent_day2.html"

# 同じく保護者向け文言と key に書き換え
sed -i \
  -e "s|<title>.*</title>|<title>音で残す成長のアルバム — Day2 \\| sho eigo</title>|" \
  -e 's|trial_day1_completed_at|parent_trial_day1_completed_at|g' \
  -e 's|day1_before|parent_day1_before|g' \
  -e 's|day1_after|parent_day1_after|g' \
  -e 's|day2_reading|parent_day2_reading|g' \
  "$OUT_DIR/parent_day2.html"

# Day2 完了後のセクションに「3 録音並列再生 + 24 時間でこれだけ変わりました + LINE 配信導線」を挿入する
# 既存ページの </main> 直前に追記する形にしておく (機械的に確実な箇所)
APPEND_HTML='<section class="album-reveal" style="background:#fff;padding:24px;border-radius:14px;margin:24px 0;box-shadow:0 2px 8px rgba(0,0,0,0.05);">
  <h2 style="color:#1a2d45;text-align:center;">✨ 24 時間でこれだけ変わりました</h2>
  <p style="text-align:center;line-height:1.9;">
    あなたのお子さんは、たった 2 日で<br>
    リズム・連続発音 (Linking)・Flap T を<br>
    体に入れ始めています。<br><br>
    これが、保護者プランで毎月届く<br>
    「成長のアルバム」の最初の 1 ページです。
  </p>
  <h3 style="margin-top:24px;text-align:center;font-size:14px;color:#666;">昨日のビフォー・アフター・今日の音読</h3>
  <div class="three-recordings" style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin-top:12px;">
    <div class="rec rec-before" style="flex:1;min-width:120px;text-align:center;background:#fafaf7;padding:10px;border-radius:8px;">
      <div class="rec-label" style="font-size:12px;color:#888;">Day1 ビフォー</div>
      <button class="play-btn" data-src="local:parent_day1_before" style="margin-top:6px;padding:8px 14px;background:#1a2d45;color:#fff;border:0;border-radius:6px;">▶ 再生</button>
    </div>
    <div class="rec rec-after" style="flex:1;min-width:120px;text-align:center;background:#fafaf7;padding:10px;border-radius:8px;">
      <div class="rec-label" style="font-size:12px;color:#888;">Day1 アフター</div>
      <button class="play-btn" data-src="local:parent_day1_after" style="margin-top:6px;padding:8px 14px;background:#1a2d45;color:#fff;border:0;border-radius:6px;">▶ 再生</button>
    </div>
    <div class="rec rec-day2" style="flex:1;min-width:120px;text-align:center;background:#fafaf7;padding:10px;border-radius:8px;">
      <div class="rec-label" style="font-size:12px;color:#888;">Day2 音読</div>
      <button class="play-btn" data-src="local:parent_day2_reading" style="margin-top:6px;padding:8px 14px;background:#1a2d45;color:#fff;border:0;border-radius:6px;">▶ 再生</button>
    </div>
  </div>
  <div style="text-align:center;margin-top:24px;">
    <a href="https://lin.ee/whBrh29" class="btn accent" style="background:#1a2d45;color:#fff;padding:14px 28px;border-radius:999px;text-decoration:none;display:inline-block;">LINE で見本を受け取る</a>
    <p class="muted small" style="margin-top:8px;color:#888;font-size:12px;">5 日間で 3 通、保護者プランの「見本」をお届けします</p>
  </div>
  <script>
  document.querySelectorAll(".play-btn").forEach(function(btn) {
    btn.addEventListener("click", function() {
      var key = btn.dataset.src.replace("local:", "");
      var src = localStorage.getItem(key);
      if (!src) { alert("録音が見つかりません。Day1 から録音してください。"); return; }
      var audio = new Audio(src); audio.play();
    });
  });
  </script>
</section>'

# </main> の直前に挿入
python3 - "$OUT_DIR/parent_day2.html" <<PY
import sys
path = sys.argv[1]
with open(path, "r", encoding="utf-8") as f:
    html = f.read()
inject = '''$APPEND_HTML'''
if "</main>" in html:
    html = html.replace("</main>", inject + "\n</main>", 1)
elif "</body>" in html:
    html = html.replace("</body>", inject + "\n</body>", 1)
else:
    html = html + inject
with open(path, "w", encoding="utf-8") as f:
    f.write(html)
PY

ok "parent_day2.html 生成完了 ($(wc -l < "$OUT_DIR/parent_day2.html") 行)"

# 4. 検証
echo ""
echo "▶ Step 4: 検証"
for f in "$OUT_DIR/parent_day1.html" "$OUT_DIR/parent_day2.html"; do
  if grep -q "アルバム" "$f"; then ok "$f に「アルバム」キーワードあり"; else warn "$f に「アルバム」キーワード無し"; fi
done

if grep -q "24 時間でこれだけ変わりました" "$OUT_DIR/parent_day2.html"; then
  ok "parent_day2.html に「24 時間でこれだけ変わりました」あり"
else
  warn "parent_day2.html に「24 時間でこれだけ変わりました」が見つからない (挿入失敗)"
fi

echo ""
echo "══════════════════════════════════════════════"
echo "  完成: $OUT_DIR/parent_day1.html"
echo "  完成: $OUT_DIR/parent_day2.html"
echo "══════════════════════════════════════════════"
echo ""
echo "次のステップ:"
echo "  git add $OUT_DIR/parent_day*.html"
echo "  git commit -m 'Generate parent_day1/day2'"
echo "  git push"
echo ""
echo "推奨確認:"
echo "  ブラウザで /trial/parent_day1.html を実機表示してビフォー録音 → Day2 まで完走できるか"
echo "  特に <audio>, recorder.js 等の旧 day1 依存スクリプトが残っていれば動作確認"
