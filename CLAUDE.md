# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository purpose

LINE 自動化システム（ProLine 代替）と、それに連動する静的ランディング/ダッシュボードページの一体運用リポジトリ。GAS（Google Apps Script）+ Google Sheets + LINE Messaging API。

## Two deployment targets in one repo

このリポジトリは **2 つの異なる配信先**に同時デプロイされる。`.github/workflows/deploy.yml` の `deploy-gas` と `deploy-pages` ジョブが対応する。

1. **GAS（Web App / Bot バックエンド）**
   - 対象ファイル: `line_bot.js`, `appsscript.json` のみ
   - 配信は `clasp push` → `clasp deploy -i $GAS_DEPLOYMENT_ID`
   - `.claspignore` で `pages/` を除外している（`**/**` 全除外 + `!appsscript.json` `!line_bot.js` のみ許可）。新しい GAS 用 `.js` を増やしたい場合は `.claspignore` への追記が必須。

2. **静的ページ（Xserver FTP）**
   - 対象: `pages/**`
   - `pages/` の中身が `sho-blog.com/public_html/` 配下にミラーされる（`mirror --reverse --no-delete --only-newer`、つまり**サーバ側の既存ファイルは消さない**）。
   - デプロイ前にプレースホルダ `@YOUR_LINE_ID` と `YOUR_GAS_DEPLOYMENT_ID` が secrets で置換される。HTML/CSS にこれらの文字列を書いておけば本番値に展開される。

`main` への push で両ジョブが自動実行される。`paths` フィルタにより `line_bot.js`/`appsscript.json`/`pages/**`/`.claspignore`/`deploy.yml` 以外の変更ではトリガーされない。

## Manual FTP deploy（緊急時のみ）

ルートにある `CODE SPACE` ファイルは GitHub Actions を介さず手元から FTP で個別ファイルを上書きする手順メモ。通常運用は CI に任せ、これは CI が止まっている場合のフォールバックとして扱う。

## GAS code architecture (`line_bot.js`, ~780 行・単一ファイル)

GAS は単一ファイル前提（`.claspignore` の制約）。論理的には以下のレイヤに分かれる：

- **エントリポイント**: `doPost`（LINE webhook + ダッシュボードからのフィードバック POST）, `doGet`（タグ付与つきリダイレクト）
- **イベントハンドラ**: `handleFollow` / `handleMessage` / `handlePostback`
- **シナリオ駆動**: ユーザーは `USERS` シートで `(scenarioId, stepNumber)` を持ち、`checkAndSendScheduled`（1時間ごとのトリガー）が `isSendDue` の判定で次ステップを送る
- **タグシステム**: `TAGS` シートに `(userId, tag, addedAt)` を append。`addTag`/`removeTag`/`hasTag` が API。クリック計測（`logClick`）やシナリオ分岐に使う
- **モニター機能**: 10 名限定/14 日間。`MONITORS` シート + `mon_active`/`mon_completed` タグで状態管理
- **ダッシュボード連携**: `pages/monitor/dashboard.html` から `doPost` の `action=improvement` を叩き、`FEEDBACK_LOG` に保存

### Sheets schema（`setupSheets` が真実の定義）

`USERS` / `TAGS` / `CLICK_LOG` / `SURVEY_LOG` / `MONITORS` / `FEEDBACK_LOG` / `DELETION_LOG`。カラム順を変えるとロジック全体が壊れる（添字アクセス多数）。スキーマ変更時は `setupSheets` を更新し、本番スプレッドシートで一度実行する。

### 初回セットアップ（GAS エディタから手動実行）

- `setupSheets` — シート 6 種を作成しヘッダ着色
- `setupTrigger` — `checkAndSendScheduled` を 1 時間ごとに登録（既存トリガーは削除して再作成）

### CONFIG の本番値

`line_bot.js` 冒頭の `CONFIG` には `'YOUR_LINE_CHANNEL_ACCESS_TOKEN'` などプレースホルダが入っている。**本番では GAS のスクリプトプロパティではなく直接書き換えて clasp push する運用**になっている点に注意（`appsscript.json` も `executeAs: USER_DEPLOYING` / `access: ANYONE_ANONYMOUS`）。トークンを含むコミットを公開リポジトリに push しないよう、変更前に必ず `git diff` で確認すること。

## Common tasks

| やりたいこと | 手順 |
|---|---|
| GAS のロジック変更 | `line_bot.js` を編集 → `main` に push（CI が `clasp push` + `clasp deploy` を実行） |
| 静的ページ修正 | `pages/**` を編集 → push（CI が FTP ミラー） |
| 新しいページ追加 | `pages/` 配下に置く + `deploy.yml` の `Verify endpoints` ループに URL を追加（任意） |
| GAS シート構造変更 | `setupSheets` の定義を更新 → デプロイ後 GAS エディタで `setupSheets` を再実行 |
| トリガー間隔変更 | `setupTrigger` を編集してデプロイ後手動再実行 |
| ローカルからの緊急 FTP | `CODE SPACE` の手順を参考（FTP パスワード対話入力） |

ローカルで `clasp push` を直接叩く運用は推奨しない（CI 経由でデプロイ ID が固定される）。
