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

## v1.1 で残すもの (非凍結)

凍結ルールに違反しない、以下の「土台」は v1.1 で稼働させる:

- Stripe Checkout / Webhook (URL secret + Stripe API 再 GET 検証)
- Stripe Customer Portal + 「解約」キーワード + Refund webhook
- ERROR_LOG シート + safeFetch ラッパー (運用必需)
- Welcome audio (handleFollow に sho IVC 1 通追加、思い出テーマ整合)
- `goLive` / `checkProductionReadiness` / `_seedTestData` ヘルパー (運用必需)
- `scripts/test_endpoints.sh` (テスト必需)
- `pre-pro-2026-05-06` git タグ (ロールバック地点)
