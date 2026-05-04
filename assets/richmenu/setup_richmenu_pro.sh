#!/bin/bash
# sho eigo PRO リッチメニュー登録スクリプト (Cloud Shell / Linux bash)
# 1) GitHub上の rich_menu_pro.png を取得
# 2) 既存リッチメニューをすべて削除
# 3) PRO リッチメニューを作成し画像を紐付け
# 4) 全友だちのデフォルトリッチメニューに設定

set -e
G='\033[0;32m'; R='\033[0;31m'; Y='\033[1;33m'; C='\033[0;36m'; N='\033[0m'
ok()    { echo -e "${G}✓${N} $1"; }
fail()  { echo -e "${R}✗${N} $1"; exit 1; }
info()  { echo -e "${C}▸${N} $1"; }
title() { echo -e "\n${Y}━━━ $1 ━━━${N}"; }

# STEP 1: 画像取得
title "1/7: 画像準備"
IMG="$HOME/rich_menu_pro.png"
curl -sL "https://raw.githubusercontent.com/shoyatake/sho-eigo-gas/main/rich_menu_pro.png" -o "$IMG" || fail "画像取得失敗"
[ ! -f "$IMG" ] && fail "画像なし"
SZ=$(stat -c%s "$IMG")
[ "$SZ" -gt 1048576 ] && fail "1MB超"
ok "画像確認: $((SZ/1024))KB"

# STEP 2: トークン
title "2/7: LINE認証"
echo ""
echo "LINEトークン取得: https://developers.line.biz/console/channel/1657843747/messaging-api"
read -p "トークン: " TOKEN
[ -z "$TOKEN" ] && fail "トークン未入力"
BOT=$(curl -s "https://api.line.me/v2/bot/info" -H "Authorization: Bearer $TOKEN")
BOT_ID=$(echo "$BOT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('basicId',''))" 2>/dev/null)
[ -z "$BOT_ID" ] && fail "トークン無効: $BOT"
ok "認証OK: @$BOT_ID"

# STEP 3: 既存削除
title "3/7: 既存リッチメニュー削除"
EX=$(curl -s "https://api.line.me/v2/bot/richmenu/list" -H "Authorization: Bearer $TOKEN")
CNT=$(echo "$EX" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('richmenus',[])))" 2>/dev/null)
info "既存: ${CNT}件"
if [ "$CNT" -gt 0 ]; then
  echo "$EX" | python3 -c "
import sys, json
for rm in json.load(sys.stdin).get('richmenus', []):
    print(rm['richMenuId'])
" | while read RM; do
    curl -s -X DELETE "https://api.line.me/v2/bot/richmenu/${RM}" -H "Authorization: Bearer $TOKEN" > /dev/null
    info "削除: $RM"
  done
fi
ok "削除完了"

# STEP 4: 定義
title "4/7: リッチメニュー定義"
cat > /tmp/rm.json << 'JSONEOF'
{
  "size": {"width": 2500, "height": 843},
  "selected": true,
  "name": "sho eigo PRO 2026",
  "chatBarText": "メニュー",
  "areas": [
    {"bounds":{"x":0,"y":0,"width":1250,"height":843},"action":{"type":"uri","label":"2日間無料体験","uri":"https://sho-blog.com/lp/lp_katakana_trial.html"}},
    {"bounds":{"x":1250,"y":0,"width":625,"height":421},"action":{"type":"uri","label":"コース一覧","uri":"https://sho-blog.com/courses_v9.html"}},
    {"bounds":{"x":1875,"y":0,"width":625,"height":421},"action":{"type":"uri","label":"伴走コース","uri":"https://sho-blog.com/next-step.html"}},
    {"bounds":{"x":1250,"y":421,"width":625,"height":422},"action":{"type":"uri","label":"プラン選択","uri":"https://sho-blog.com/next-step.html"}},
    {"bounds":{"x":1875,"y":421,"width":625,"height":422},"action":{"type":"message","label":"質問・相談","text":"質問があります"}}
  ]
}
JSONEOF
ok "定義OK"

# STEP 5: 作成
title "5/7: リッチメニュー作成"
RES=$(curl -s -X POST "https://api.line.me/v2/bot/richmenu" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d @/tmp/rm.json)
RM_ID=$(echo "$RES" | python3 -c "import sys,json; print(json.load(sys.stdin).get('richMenuId',''))")
[ -z "$RM_ID" ] && fail "作成失敗: $RES"
ok "ID: $RM_ID"

# STEP 6: 画像アップロード
title "6/7: 画像アップロード"
CODE=$(curl -s -o /tmp/up.txt -w "%{http_code}" \
  -X POST "https://api-data.line.me/v2/bot/richmenu/${RM_ID}/content" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: image/png" \
  --data-binary "@${IMG}")
[ "$CODE" != "200" ] && fail "アップロード失敗: $CODE / $(cat /tmp/up.txt)"
ok "画像OK"

# STEP 7: デフォルト設定
title "7/7: 全友だちに反映"
CODE=$(curl -s -o /tmp/df.txt -w "%{http_code}" \
  -X POST "https://api.line.me/v2/bot/user/all/richmenu/${RM_ID}" \
  -H "Authorization: Bearer $TOKEN")
[ "$CODE" != "200" ] && fail "デフォルト失敗: $CODE / $(cat /tmp/df.txt)"
ok "全友だちに反映完了"

echo ""
echo -e "${G}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}"
echo -e "${G}  PRO リッチメニュー登録完了${N}"
echo -e "${G}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}"
echo ""
echo -e "  ID: ${C}$RM_ID${N}"
echo "  確認: sho eigo公式LINEのトーク画面を開く"
echo ""
