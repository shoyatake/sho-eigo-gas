# v2 延期機能 (PR #27 で先行実装、v1.1 で凍結)

⚠️ **CLAUDE.md §1 の凍結ルールに従い、最初の有料ユーザーが Stripe で課金確定するまでこれらは触らない。**

PR #27 (`claude/pro-lp-recursive-shannon`, Draft 保持) で実装済みのコードはブランチに残してあるので、v2 着手時は cherry-pick で取り込める。

---

## 凍結中の機能とブランチ参照

| 機能 | コード位置 (PR #27) | 延期理由 |
|---|---|---|
| 法人 Pro プラン (¥9,800/シート) | `line_bot.js` PRO_PLANS, `pages/products/index.html` | CLAUDE.md §4 v2 延期 |
| 一般モニター 14 日 / 10 名 | `line_bot.js` SC-MONITOR の延長分 | v1.1 はモニターを使わない |
| 親子モニター 14 日 / 5 名 | `pages/monitor/parent/index.html`, `joinParentMonitor` | CLAUDE.md §4「親子は『体験』で代替」 |
| AI 添削 (Claude Haiku) | `callClaudeApi`, `handleAiWriting`, SC-MAIN step 4 | v1.1 では「見本」静的表示のみ |
| nudgeTrialDropouts cron | `line_bot.js` | §1 凍結ルール「新 cron 増やさない」 |
| shareTextForDay2Completers cron | `line_bot.js` | 同上 |
| weeklyParentReport cron | `line_bot.js` | 「実際の週次レポート自動生成は v2」 |
| monthlyParentAlbum cron | `line_bot.js` | 「実際の月次アルバム自動生成は v2」 |
| snapshotDailyMetrics + admin dashboard | `line_bot.js`, `pages/admin/index.html` | 管理ダッシュボード v2/v3 |
| sns_proposal cron | `scripts/sns_proposal.mjs`, `.github/workflows/sns_proposal.yml` | v2 |
| seo_article cron | `scripts/seo_article.mjs`, `.github/workflows/seo_article.yml` | v2 |
| Drive 音声アーカイブ | `saveLineAudioToDrive`, `appsscript.json` の drive.file scope | 「実際の月次アルバム自動生成は v2」 |
| 友達招待コード | `getReferralCode`, `tryConsumeReferralCode` | 凍結ルールで新機能不可 |
| 子ども専用ダッシュボード | `pages/child/dashboard.html`, `buildChildDashboardJson` | v2 延期 |
| LIFF 統合 | `pages/payment/index.html` の LIFF SDK | 凍結ルール (uid は URL クエリで十分) |
| モニター → 初月 1,980 円コンバート | SC-MONITOR step 5/6/7, `createMonitorConvertCheckoutSession` | モニター自体が v2 |
| handleIncomingAudio (音声受信) | `line_bot.js` | 親子体験 LP 内に「録音はアルバム」と訴求するに留める |

---

## v2 着手時の手順

```bash
# PR #27 ブランチから関連コードを cherry-pick
git checkout claude/pro-lp-recursive-shannon -- <path>
# または
git log claude/pro-lp-recursive-shannon --oneline   # commit 一覧
git cherry-pick <commit_sha>
```

PR #27 ブランチは Draft のまま保持。Close せず参照資産として残す。

---

## v1.1 のページ訴求への統合 (2026-05-06 追加)

凍結ルール下でも「将来何が追加されるか」を契約検討者に伝える価値はあるため、v2 機能の **訴求のみ** を以下のページに統合済み:

| ページ | 統合した v2 機能 |
|---|---|
| `/products/` の L3 カード | AI 添削 / 紹介コード / Pro リッチメニュー (将来追加予定) |
| `/products/` の 保護者プラン カード | AI 添削月40回 / 子ども専用ダッシュボード / Drive 音声アーカイブ / 月次アルバム音声添付 / 紹介コード |
| `/products/` 末尾 | 法人導入相談 (L3 ベースのシート課金、見積もり制) |
| `/next-step.html` の L3 カード | 同上 (将来追加予定として併記) |
| `/next-step.html` の 保護者プラン カード | 同上 |
| `/next-step.html` 末尾 | 法人導入相談 |
| `/trial/parent_lp.html` FAQ | 「保護者プランに将来追加される機能」節を新設 |

**契約者は自動アップグレード**を約束することで、価格を据え置きつつ将来価値を訴求。
コードは凍結のまま、訴求文だけが先行する形。

法人 Pro は独立プランとして廃止し「L3 のシート単位カスタム導入」として個別相談の入口だけ残した。
モニター系は親子体験で代替済み。

---

## v2 候補に追加 (2026-05-06 追加分)

### クラス管理ダッシュボード v2 + マルチテナント認証

要望: 「モニターを 1 クラスで管理。生徒同士は見えないが、運営からは全員が見えるダッシュボード」

#### v1.1 での代替 (コード変更ゼロで運用)
- 運営は Google Spreadsheet (USERS / TAGS / FEEDBACK_LOG / PURCHASES / MONITORS) を直接見る → 全契約者の状態把握可
- 生徒同士の情報露出経路は現状ゼロ (LINE 1on1 のみ)
- 生徒・保護者は各自の `?uid=...` 個別 URL でダッシュボードにアクセス (現存)

#### v2 で実装する内容
- 認証つき運営者ダッシュボード (Google Sign-In + ホワイトリスト or `ADMIN_TOKEN`)
- クラス概念の追加 (`CLASSES` シート + USERS への class_id 列)
- 生徒/保護者向け認証 UI (LINE Login + LIFF or Magic Link)
- UI/UX プロが画面設計を担当する想定 (Figma → Tailwind/HTML)
- 学習サポートのアドバイザー枠 (人的運用、コードはタグ + 通知のみ)

#### 着手条件
最初の有料ユーザー 1 件 + クラス管理が必要なほどの契約者 (例: 5 名以上の保護者プラン契約) が出た時点。

---

## v1.1 で残すもの (非凍結)

凍結ルールに違反しない、以下の「土台」は v1.1 で稼働させる:

- Stripe Checkout / Webhook (URL secret + Stripe API 再 GET 検証)
- Stripe Customer Portal + 「解約」キーワード + Refund webhook
- ERROR_LOG シート + safeFetch ラッパー (運用必需)
- Welcome audio (handleFollow に sho IVC 1 通追加、思い出テーマ整合)
- `goLive` / `checkProductionReadiness` / `_seedTestData` ヘルパー (運用必需)
- `scripts/test_endpoints.sh` (テスト必需)
- `pre-pro-2026-05-06` git タグ (ロールバック地点)
