# 2026-05-06 スプリント実行ハンドオフ

このブランチ `claude/pro-lp-recursive-shannon` には、Pro 決済 + 運用ダッシュボード + AI 添削 + 自律 cron 2 種が **コードレベルで実装済み**です。
明日 09:00 から動かす際の **事前準備 → 実行手順 → 検証** をこのドキュメントに集約しています。

最終的なロールバック地点: tag `pre-pro-2026-05-06`。問題発生時は `git revert <merge-commit>` か該当タグへチェックアウト。

---

## 1. 09:00 までに揃える 4 つのアカウント / トークン

### 1.1 Stripe アカウント
1. https://dashboard.stripe.com/register で **本番アカウント**作成 (法人 or 個人事業主)
2. Dashboard → Developers → **API keys** で `Secret key` (本番) をコピー → `STRIPE_SECRET_KEY` として保存
3. Products → **Add product** で 3 つ作成、価格は **JPY / 月次サブスク**:
   - 「個人 Pro」 ¥3,980/月 → Price ID をコピー (`price_xxxxx`)
   - 「保護者プラン」 ¥6,980/月 → Price ID をコピー
   - 「法人 Pro (1 シート)」 ¥9,800/月 → Price ID をコピー
4. Developers → **Webhooks** → Add endpoint:
   - URL: `https://script.google.com/macros/s/<GAS_DEPLOYMENT_ID>/exec?action=stripe_webhook&secret=<URL_SECRET>`
   - Events: `checkout.session.completed`, `customer.subscription.deleted`
   - `<URL_SECRET>` は適当な 32 文字以上のランダム文字列を生成（例: `openssl rand -hex 16`）
   - これを `STRIPE_WEBHOOK_URL_SECRET` として保存

### 1.2 Anthropic API key
1. https://console.anthropic.com/settings/keys → **Create key**
2. 表示された `sk-ant-api03-...` をコピー → `ANTHROPIC_API_KEY` として保存
3. Settings → **Plans & Billing** で必要に応じて従量課金チャージ ($10 程度)

### 1.3 Slack incoming webhook
1. Slack ワークスペース → **Apps** → 検索「Incoming Webhooks」→ Add to Slack
2. 投稿先チャネルを選択 (例: `#alerts`)
3. 表示された `https://hooks.slack.com/services/...` をコピー → `SLACK_WEBHOOK_URL` として保存

### 1.4 Notion DB + integration
1. Notion → 新規ページに DB 作成、名前 `SNS_DRAFTS`
2. Properties:
   - `Name` (title)
   - `Theme` (text)
   - `X` (text)
   - `Instagram` (text)
   - `Rationale` (text)
   - `Status` (select: draft / scheduled / published)
3. https://www.notion.so/my-integrations → New integration → Internal type → 名前 `sho-eigo-cron`
4. 表示された `Integration Token` をコピー → `NOTION_TOKEN` として保存
5. SNS_DRAFTS DB のページ右上「…」→ Connections → `sho-eigo-cron` を追加
6. DB の URL から ID をコピー (`...so/<32 字>?v=...`) → `NOTION_DB_ID` として保存

### 1.5 Google Service Account (sns_proposal cron 用)
1. https://console.cloud.google.com/ → 既存プロジェクト or 新規作成
2. IAM & Admin → Service Accounts → Create
3. 作成後、Keys → Add Key → JSON で発行 → ダウンロード
4. JSON 全文を `GOOGLE_SA_JSON` として保存 (改行も含めそのまま)
5. SS_ID のスプレッドシートを開き、サービスアカウントの email (`...@....iam.gserviceaccount.com`) を **閲覧者** で共有

---

## 2. GitHub Secrets 設定

`https://github.com/shoyatake/sho-eigo-gas/settings/secrets/actions` に以下を追加:

| 名前 | 用途 | 取得元 |
|---|---|---|
| `ANTHROPIC_API_KEY` | sns_proposal cron + (確認用) | 1.2 |
| `GOOGLE_SA_JSON` | sns_proposal Sheets 読取 | 1.5 |
| `GOOGLE_SS_ID` | sns_proposal Sheets ID | 既存スプレッドシート |
| `NOTION_TOKEN` | sns_proposal Notion 書込 | 1.4 |
| `NOTION_DB_ID` | sns_proposal Notion DB | 1.4 |
| `LINE_CHANNEL_ACCESS_TOKEN` | sns_proposal 通知用 | 既存 (現在 GAS 内) |
| `OWNER_LINE_USER_ID` | sns_proposal / GAS alert 宛先 | 自分の LINE userId |
| `LIFF_ID` | /payment/ で LINE userId を自動取得 (LINE Developers → LIFF) | 任意 |

GAS の既存 secrets (`CLASPRC_JSON`, `CLASP_JSON`, `GAS_DEPLOYMENT_ID`, `LINE_ID`, `FTP_PASS`) はそのまま。

---

## 3. GAS Script Properties 設定

clasp deploy 後、Apps Script コンソール → **プロジェクトの設定** → **スクリプトプロパティ** で以下を追加:

| 名前 | 値 | 必須 |
|---|---|---|
| `STRIPE_SECRET_KEY` | 1.1 の `sk_live_...` (テスト中は `sk_test_...`) | ✓ |
| `STRIPE_WEBHOOK_URL_SECRET` | 1.1 の URL secret | ✓ |
| `STRIPE_PRICE_PERSONAL` | 1.1 の個人 Pro Price ID | ✓ |
| `STRIPE_PRICE_FAMILY` | 1.1 の保護者プラン Price ID | ✓ |
| `STRIPE_PRICE_CORP` | 1.1 の法人 Pro Price ID | ✓ |
| `ANTHROPIC_API_KEY` | 1.2 の `sk-ant-api03-...` | ✓ |
| `ADMIN_TOKEN` | 自分しか知らない 32 字以上のランダム文字列 | ✓ |
| `SLACK_WEBHOOK_URL` | 1.3 の URL | 推奨 |
| `OWNER_LINE_USER_ID` | 自分の LINE userId | 推奨 |
| `LINE_RICHMENU_PRO_ID` | menu_pro リッチメニュー ID | 任意 |
| `ALLOWED_TEST_UIDS` | 翔也さんの LINE userId（カンマ区切り）| 安全装置 |
| `LIVE_OPEN_AFTER` | `2026-05-06T13:00:00Z` (JST 22:00) | 安全装置 |
| `WELCOME_AUDIO_URL` | 任意。フォロー時音声 URL を別 mp3 に切替 | 任意 |
| `WELCOME_AUDIO_DURATION_MS` | 任意。フォロー時音声の再生秒数 (ms) | 任意 |
| `AUDIO_ARCHIVE_FOLDER_ID` | Drive フォルダ ID。設定時のみアフター録音を Drive に保存 | 任意 |

`ALLOWED_TEST_UIDS` + `LIVE_OPEN_AFTER` は **Stripe 決済の本番ガード** です。`LIVE_OPEN_AFTER` の日時を過ぎるか、`ALLOWED_TEST_UIDS` を空にすると、誰でも決済できるようになります。

---

## 4. 09:00–21:30 タイムボックス

| 時間 | 作業 | 詳細 |
|---|---|---|
| 09:00 | 準備完了確認 | §1〜§3 すべて埋まったか確認 |
| 09:30 | このブランチを main にマージ | PR を merge → CI が clasp push + FTP 同期 |
| 10:00 | A. Stripe テスト | テストモードに切替 (Script Properties の SECRET を `sk_test_...` に) → LINE で「プラン」と送信 → /payment/ で個人 Pro → カード `4242 4242 4242 4242` → 成功画面 → USERS シートに `purchased` タグ確認 |
| 13:00 | A. 本番テスト | Script Properties の SECRET を `sk_live_...` に戻す → 自分の LINE で 1 件決済 (実カード) → Stripe Dashboard で確認 → 後で全額返金 |
| 14:00 | C. AI 添削テスト | Script Properties の `ANTHROPIC_API_KEY` 設定済 → 自分宛に SC-MAIN step 4 を強制配信 (`sendStepNow(uid, 'SC-MAIN', 4)` を Apps Script Editor から実行) → 英文 1 行送信 → 5 秒以内に添削が返る |
| 16:30 | B. ダッシュボード | https://sho-blog.com/admin/ にアクセス → ADMIN_TOKEN 入力 → 数値表示確認。SLACK_WEBHOOK_URL を一時的に閾値ギリギリにして手動 `snapshotDailyMetrics()` 実行 → Slack 通知到達 |
| 18:00 | D-1 cron + 親レポート設置 | Apps Script Editor で `setupEverything()` を 1 回実行 → Sheets 6 種 + 全 trigger (`checkAndSendScheduled` 毎時, `snapshotDailyMetrics` 23:55, `nudgeTrialDropouts` 21:00, `weeklyParentReport` 日曜 9:00) を一括登録。`nudgeTrialDropouts()` と `weeklyParentReport()` を手動実行 → 各 1 件届く（or 対象なしのログ）|
| 20:00 | D-2 cron 設置 | GitHub → Actions → SNS Proposal (weekly) → **Run workflow** で `dry_run: true` 実行 → ログで Claude が JSON を返すか確認 → `dry_run: false` で実走 → Notion に 3 行 + LINE 通知到達 |
| 21:00 | リリース確認 | Stripe Dashboard, Apps Script ログ, Slack, Notion に異常無し |
| 21:30 | 完了 | 当日返金分は Stripe で `Refund` 実行 (テスト課金用)。`_goLiveNow()` を実行して `ALLOWED_TEST_UIDS` ガードを解除 → 一般ユーザー解放 |

---

## 4.1 Customer Portal & 解約フロー

- **解約**: ユーザーが LINE で「解約」「キャンセル」と送信すると、`createPortalSession` が PURCHASES シートから Stripe customer_id を逆引きして Billing Portal URL を生成、案内する。
- **Refund**: Stripe Dashboard で返金を実行すると、`charge.refunded` Webhook が飛び、自動で `purchased` タグが剥がされる。
- **支払い失敗**: `invoice.payment_failed` Webhook で同様にタグ剥がし + 運営者に通知。
- **解約 (subscription.deleted)**: タグ剥がし + Slack 通知。
- 上記 Webhook イベントを Stripe Dashboard の Webhook 設定で必ず有効化する: `checkout.session.completed`, `customer.subscription.deleted`, `charge.refunded`, `invoice.payment_failed`。

---

## 5. テストコマンド集

### 5.1 GAS doGet 単体テスト (curl)

```bash
GAS_URL='https://script.google.com/macros/s/<GAS_DEPLOYMENT_ID>/exec'
ADMIN_TOKEN='<your_admin_token>'

# Admin JSON
curl -s "$GAS_URL?action=admin&format=json&token=$ADMIN_TOKEN" | python3 -m json.tool

# Admin HTML
curl -s "$GAS_URL?action=admin&token=$ADMIN_TOKEN" -o /tmp/admin.html
head -20 /tmp/admin.html

# Checkout 起動 (ALLOWED_TEST_UIDS 内のみ動作)
curl -s -L "$GAS_URL?action=checkout&plan=personal&uid=<your_line_uid>" | head -3
```

### 5.2 Apps Script Editor で実行

```javascript
// AI 添削の Claude 接続テスト
function _testClaudeApi() {
  Logger.log(callClaudeApi('Translate to English: 雨が降っています'));
}

// Stripe Checkout 作成テスト (ALLOWED_TEST_UIDS 内 UID 使用)
function _testCheckout() {
  Logger.log(createCheckoutSession('U1234567890abcdef', 'personal'));
}

// 全トリガー設定 (1 回だけ実行すれば 24/7 自律稼働) — 推奨ワンショット関数
function _setupAll() {
  setupEverything();  // Sheets + 全 trigger を一括
}

// 本番リリース前のヘルスチェック (Properties / triggers / sheets が揃ってるか)
function _readiness() {
  checkProductionReadiness();
}

// 保護者プラン の週次レポート手動実行
function _testParentReport() {
  weeklyParentReport();
}

// 月次成長アルバム手動実行 (保護者プラン)
function _testMonthlyAlbum() {
  monthlyParentAlbum();
}

// シェアテキスト cron 手動実行 (Day 2 完了直後の人がいれば送信)
function _testShareText() {
  shareTextForDay2Completers();
}

// 自分宛にウェルカム音声を送信して動作確認
function _testWelcomeAudio() {
  sendWelcomeAudio('<your_line_uid>');
}

// ダッシュボード見栄え確認用にダミーデータを 5 ユーザー分挿入 (Useed_001..005)
function _seedDashboard() {
  _seedTestData();
}
// 上で seed したダミーを全削除
function _purgeDashboard() {
  _purgeTestData();
}

// 自分の招待コードを取得
function _myReferralCode() {
  Logger.log(getReferralCode('<your_line_uid>'));
}

// 本番ガードを解除して即時 go-live (確認後に実行)
function _goLiveNow() {
  goLive();
}

// ダッシュボード値の手動計算
function _checkMetrics() {
  Logger.log(JSON.stringify(buildAdminDashboardJson()));
}

// 自分宛に SC-MAIN step 4 (AI 添削) を強制配信
function _testStep4() {
  sendStepNow('<your_line_uid>', 'SC-MAIN', 4);
}

// 自分宛に SC-MAIN step 5 (Pro 選択) を強制配信
function _testStep5() {
  sendStepNow('<your_line_uid>', 'SC-MAIN', 5);
}

// nudge cron の手動実行 (実際に 1 件 push される)
function _testNudge() {
  nudgeTrialDropouts();
}

// アラート発火テスト
function _testAlert() {
  notifyAlert('[テスト] アラート動作確認 ' + new Date(), 'all');
}
```

### 5.2.1 Cloud Shell から e2e 検証 (deploy 後に必須)

```bash
cd ~/sho-eigo-gas
git pull origin main

export GAS_URL='https://script.google.com/macros/s/<GAS_DEPLOYMENT_ID>/exec'
export ADMIN_TOKEN='<your_admin_token>'
export TEST_LINE_UID='U<your_line_uid>'

bash scripts/test_endpoints.sh
# 全 PASS で OK。FAIL がある場合は handoff §6 のロールバック判断材料に。
```

### 5.3 SNS proposal のローカル試走

```bash
# Cloud Shell or 任意の Linux 環境で
cd ~/sho-eigo-gas
npm install --no-save googleapis@^144 @anthropic-ai/sdk@^0.40

export ANTHROPIC_API_KEY='sk-ant-api03-...'
export GOOGLE_SA_JSON="$(cat /path/to/sa.json)"
export GOOGLE_SS_ID='<your_spreadsheet_id>'
export NOTION_TOKEN='secret_xxx'
export NOTION_DB_ID='<32 char id>'
# LINE は省略可

node scripts/sns_proposal.mjs --dry-run
# → Claude が drafts JSON を返すか確認 (Notion 書込はしない)
```

---

## 6. ロールバック手順

### 軽微な不具合 → コード差し戻し
```bash
# main の merge commit を revert
git checkout main
git pull origin main
git revert -m 1 <merge_commit_sha>
git push origin main
# CI が pre-pro 状態に戻す
```

### Stripe 決済停止 (緊急)
Apps Script コンソール → スクリプトプロパティ → `STRIPE_SECRET_KEY` を空文字に変更 → 保存
→ `createCheckoutSession` が `stripe_not_configured` を返すようになり全決済が止まる。

### AI 添削停止 (緊急)
スクリプトプロパティ → `ANTHROPIC_API_KEY` を空文字に変更
→ `callClaudeApi` が `anthropic_not_configured` を返し、graceful degradation 文に切り替わる。

### cron 停止 (緊急)
Apps Script コンソール → トリガー一覧 → `nudgeTrialDropouts` / `snapshotDailyMetrics` を削除
GitHub Actions → SNS Proposal (weekly) → 右上 `...` → Disable workflow

### 完全ロールバック (タグへ復帰)
```bash
git checkout main
git reset --hard pre-pro-2026-05-06
git push --force-with-lease origin main
# CI が pre-pro 時点の状態にデプロイし直す
```
※ `--force-with-lease` 必須、main protection があれば一度 disable。

---

## 7. リスク対応

| リスク | 検知 | 対応 |
|---|---|---|
| 他人が Stripe 決済を起動 | `LIVE_OPEN_AFTER` 未到達 + `ALLOWED_TEST_UIDS` 範囲外 | `not_allowed_yet` で自動拒否、LINE で「準備中」返答 |
| Stripe Webhook なりすまし | `STRIPE_WEBHOOK_URL_SECRET` 検証 + Stripe API 再 GET 検証 | 失敗時 `notifyAlert` で運営者通知 |
| Claude API 障害 | `callClaudeApi` が `error: api_error` 返す | 添削/ナッジは graceful degradation 文を返信 |
| AI 悪用 | 日次 1 回 (`ai_writing_done_yyyyMMdd`) + 1 分 5 回 グローバル | レート制限超で「アクセス集中」返答 |
| LINE 送信枠超過 | 月次送信数 4,000 通到達で `notifyAlert` (要メトリクス追加) | Stretch プラン (5,000 円) 切替 |
| GAS 実行時間 6 分超過 | `nudgeTrialDropouts` は最大 30 通 / 回でストップ | 翌日に持ち越し |

---

## 8. 取り扱う秘密の保管場所まとめ

- **GAS スクリプトプロパティ** (Apps Script コンソール内): Stripe / Anthropic / Slack / Admin token / Owner UID
- **GitHub Secrets**: 上記 + Notion / Service Account / 既存の clasp / FTP
- **メモ帳 (翔也さん管理)**: 上記の元控え + Stripe Dashboard ログイン情報 + Notion DB ID
- **コード上 (このリポ)**: 値は一切持たない、placeholder のみ

ローテーション運用: 90 日に 1 回、上記すべてを再発行する習慣を推奨。

---

## 9. 完了チェックリスト

明日 21:30 時点でこれが全て ✓ なら本番リリース成功:

- [ ] CI 緑 (deploy.yml + sns_proposal.yml の最新ラン)
- [ ] LINE で「プラン」 → /payment/ ページが開く
- [ ] /payment/?plan=personal の CTA → Stripe Checkout 画面が表示
- [ ] 個人 Pro テスト決済 (`4242...`) 成功 → USERS シートに `purchased` + `purchased_plan_personal`
- [ ] 自分の本番カードで 1 件決済成功 → 完了後 Stripe Dashboard で Refund
- [ ] /admin/ にアクセス → ADMIN_TOKEN で数値表示
- [ ] `_testStep4` 実行 → 英文返信 → 5 秒以内に添削メッセージ着信
- [ ] `_testNudge` 手動実行 → テスト LINE で受信 (24h 経過した離脱者 が居れば)
- [ ] Slack に手動アラート通知が 1 件届いている
- [ ] GitHub Actions → SNS Proposal `dry_run: false` 成功 → Notion に 3 案 + LINE 通知
- [ ] Apps Script トリガー一覧に `nudgeTrialDropouts` (21:00) / `snapshotDailyMetrics` (23:55) / `shareTextForDay2Completers` (12:00) / `weeklyParentReport` (日曜 9:00) / `monthlyParentAlbum` (月初 9:00) が登録済
- [ ] `_readiness()` 実行で `Ready: YES ✅` 表示

完了したら `pre-pro-2026-05-06` タグは保持したまま、新しい安定タグ `v-prod-2026-05-06` を打って締める。
