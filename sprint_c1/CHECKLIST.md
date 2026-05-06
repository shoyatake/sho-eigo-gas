# Sprint C1 セットアップ チェックリスト

> 翔也さん用。上から順に実施。各 ☐ をクリアしたらチェック。
> 所要時間の目安: 30〜45 分（LINE 設定済みなら 20 分）

---

## 0. 前提
- ☐ Google スプレッドシートを開ける（`生徒マスター` シートを含む）
- ☐ LINE Developers コンソールにログイン済み
- ☐ Cloud Shell で `~/sprint_c1/` に 5 つの `.gs.txt` ファイルがある

---

## 1. 生徒マスターに `email` 列を準備
- ☐ スプレッドシートを開く
- ☐ 1 行目（ヘッダー）に `email` があるか確認
- ☐ 無ければ末尾に列を追加し、ヘッダーに `email` と入力
- ☐ 動作確認用にテスト行を 1 つ作成（例: `email = test@example.com`、その他列は任意）

---

## 2. GAS エディタを開く
- ☐ スプレッドシート → メニュー「拡張機能」→「Apps Script」

---

## 3. 5 つの `.gs` ファイルを貼り付け

GAS エディタ左の「ファイル」一覧で以下を実施。

| GAS ファイル名 | 元ファイル | 操作 |
|---|---|---|
| `Code.gs`（既存） | `~/sprint_c1/Code.gs.txt` | 開く → 全選択 Delete → 貼り付け |
| `Sheets`（新規） | `~/sprint_c1/Sheets.gs.txt` | ＋ → スクリプト → 名前 `Sheets` → 貼り付け |
| `JWT`（新規） | `~/sprint_c1/JWT.gs.txt` | ＋ → スクリプト → 名前 `JWT` → 貼り付け |
| `Auth`（新規） | `~/sprint_c1/Auth.gs.txt` | ＋ → スクリプト → 名前 `Auth` → 貼り付け |
| `LINELogin`（新規） | `~/sprint_c1/LINELogin.gs.txt` | ＋ → スクリプト → 名前 `LINELogin` → 貼り付け |

- ☐ 5 ファイル分すべて貼り付け
- ☐ Ctrl+S（または Cmd+S）で保存

> **コピー方法**：Cloud Shell で `cat ~/sprint_c1/JWT.gs.txt` 等を実行して全選択コピー。

---

## 4. ScriptProperties を設定

GAS エディタ → 左メニュー「⚙ プロジェクトの設定」→「スクリプト プロパティ」→「スクリプト プロパティを追加」

事前準備：Cloud Shell で JWT_SECRET を生成
```bash
openssl rand -hex 32
# → 64文字の乱数が出力される
```

| プロパティ | 値 |
|---|---|
| ☐ `SPREADSHEET_ID` | スプレッドシート URL `https://docs.google.com/spreadsheets/d/XXXXX/edit` の `XXXXX` 部分 |
| ☐ `JWT_SECRET` | 上で生成した 64 文字の乱数 |
| ☐ `JWT_TTL_DAYS` | `30`（省略可） |
| ☐ `LINE_CHANNEL_ID` | LINE Developers → Login チャネル → 基本設定 |
| ☐ `LINE_CHANNEL_SECRET` | 同上（チャネルシークレット） |
| ☐ `LINE_REDIRECT_URI` | **後で⑦で記入**（今は空でも保存可） |
| ☐ `FRONTEND_REDIRECT_URI` | `https://sho-blog.com/monitor/dashboard.html`（実際の遷移先 URL） |

- ☐ 「保存」をクリック

> 🚨 `JWT_SECRET` と `LINE_CHANNEL_SECRET` はターミナルに出した後、**履歴から削除**することを推奨：`history -d $(history 1 | awk '{print $1}')`

---

## 5. setupSheets を実行
- ☐ GAS エディタ上部の関数選択ドロップダウン → `setupSheets` を選択
- ☐ 「実行」ボタンをクリック
- ☐ 初回のみ権限承認ダイアログ表示 → アカウント選択 → 詳細 → 「（プロジェクト名）（安全ではないページ）に移動」→「許可」
- ☐ 実行完了後、下部「実行ログ」で以下を確認：
  - `生徒マスター: N行のデータ`
  - `✅ 列追加: passwordHash` ほか 6 列（既に追加済みなら `⏩ 既存`）
  - `Users シート: 空だったので削除`（または「存在しない」）
  - `parent_links シート: 空だったので削除`（または「存在しない」）
  - `SESSIONS シート: 作成完了`
  - `========== Setup 完了 ==========`

---

## 6. Web アプリとしてデプロイ
- ☐ 右上「デプロイ」→「新しいデプロイ」
- ☐ ⚙（種類選択） → 「ウェブアプリ」
- ☐ 設定：
  - 説明: `Sprint C1 v1`
  - 実行ユーザー: **自分**
  - アクセスできるユーザー: **全員**（匿名アクセス可、必須）
- ☐ 「デプロイ」→ URL をコピー（`https://script.google.com/macros/s/XXXXX/exec`）

---

## 7. LINE_REDIRECT_URI を完成させる
- ☐ ScriptProperties に戻り、`LINE_REDIRECT_URI` に以下を設定：
  ```
  <⑥でコピーした URL>?action=line_callback
  ```
  例: `https://script.google.com/macros/s/AKfyc.../exec?action=line_callback`

---

## 8. LINE Developers でコールバック URL を登録
- ☐ https://developers.line.biz/console/ を開く
- ☐ 対象プロバイダー → LINE Login チャネル を選択
- ☐ 「LINE Login設定」タブ → コールバックURL → 編集 → 上の `LINE_REDIRECT_URI` と**同じ値**を貼り付け
- ☐ 「メールアドレス取得権限」が「申請中／承認済」か確認
  - **未申請の場合は申請フォームから申請する必要あり**（承認まで数日）
  - 申請が通るまでは LINE ログインは email スコープエラーで動かない

---

## 9. 動作確認（自動テスト）
Cloud Shell で：
```bash
export WEBAPP_URL='⑥でコピーした URL'
export TEST_EMAIL='生徒マスターに登録した email'
bash ~/sprint_c1/test.sh
```

- ☐ 1. signup → `"ok":true`（または既に登録済みエラー）
- ☐ 2. login → `"ok":true` で `token` が返る
- ☐ 3. verify → `"ok":true` で `userId` が返る
- ☐ 4. line_auth_url → `"ok":true` で `url` が返る
- ☐ 5. logout → `"ok":true`
- ☐ 6. verify（revoke 後） → `"ok":false, "error":"revoked"`

---

## 10. LINE ログインの手動確認（任意）
- ☐ ④で返った `url` をブラウザで開く
- ☐ LINE で「許可する」
- ☐ `FRONTEND_REDIRECT_URI` に `#token=...` が付いて遷移すれば成功

---

## トラブルシュート

| 症状 | 原因と対処 |
|---|---|
| `ScriptProperties に X が設定されていません` | ④を再確認。プロパティ名のタイポに注意 |
| `生徒マスターに列が存在しません: email` | ①で `email` 列を追加し直す |
| `email が 生徒マスター に存在しません`（signup 時） | テスト用メアドを生徒マスターに 1 行追加 |
| `LINE から email が取得できない` | LINE 側で email スコープが未承認。⑧で申請 |
| `id_token verify 失敗` | `LINE_CHANNEL_ID` が間違っている可能性 |
| Web アプリ URL が 401 を返す | デプロイ時に「アクセス: 全員」になっているか確認 |
| `setupSheets` が無権限エラー | 権限承認ダイアログを再度通す |

---

## 完了報告フォーマット
チェックがすべて埋まったら：
```
✅ Sprint C1 セットアップ完了
- WEBAPP_URL: <URL>
- 動作確認: 6 ステップすべて期待通り
- LINE email スコープ: 申請中／承認済
```
