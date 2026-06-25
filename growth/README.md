# Sho Growth Engine

sho eigo の認知拡大タスクをGitHub Actionsで生成し、GitHub Issue化する仕組みです。

## 必要なSecret

Repository Settings → Secrets and variables → Actions に以下を登録します。

- `OPENAI_API_KEY`

## 実行方法

GitHubで以下を開きます。

Actions → Sho Growth Engine → Run workflow

おすすめ初回:

- mode: `daily`
- dry_run: `true`

問題なければ次に:

- mode: `daily`
- dry_run: `false`

`dry_run=false` の場合、GitHub Issueが作成されます。

## mode

- `daily`: 今日のSNS投稿案、DM案、SEO小タスク
- `weekly`: 7日間の認知拡大計画
- `seo`: SEO改善案
- `offer`: 無料体験から有料化への導線改善

## 注意

自動投稿、自動いいね、スパムDMはしません。AIは下書きとIssue作成までです。
