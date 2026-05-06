# Sprint C1 高速セットアップ（5 分版）

> 詳細版は CHECKLIST.md を参照。こちらは Bootstrap.gs / AllInOne.gs を使った最短ルート。

## 前提
- Google スプレッドシートに `生徒マスター` シート（1 行目ヘッダー、2 行目以降データ）が存在
- LINE Developers で Login チャネルを作成済み（email スコープ申請済が望ましい）

---

## ① 1 ファイル貼り付け（30 秒）
1. スプレッドシート → 拡張機能 → Apps Script を開く
2. 既存の `Code.gs` を全選択削除
3. Cloud Shell で `cat ~/sprint_c1/AllInOne.gs.txt` の出力をコピーして貼り付け
4. Ctrl+S で保存

> AllInOne.gs は Bootstrap / Sheets / JWT / Auth / LINELogin / Code を機械的に連結したもの（731 行）。

---

## ② bootstrap を実行（1 回目 / 10 秒）
1. 関数選択ドロップダウンを **`bootstrap`** にする
2. 「実行」をクリック
3. 初回のみ権限承認（許可）
4. `_setup_` シートが自動生成 → ダイアログ「セットアップ準備完了」が出る → OK

---

## ③ `_setup_` シートに値を入力（2 分）

タブを `_setup_` に切り替え、value 列を埋める：

| key | value | 取得方法 |
|---|---|---|
| `SPREADSHEET_ID` | （自動入力済） | 編集不要 |
| `JWT_SECRET` | 64 文字の乱数 | Cloud Shell: `openssl rand -hex 32` |
| `JWT_TTL_DAYS` | `30`（既定値のまま可） | — |
| `LINE_CHANNEL_ID` | LINE のチャネル ID | LINE Developers → Login チャネル → 基本設定 |
| `LINE_CHANNEL_SECRET` | LINE のチャネル シークレット | 同上 |
| `LINE_REDIRECT_URI` | `__after_deploy__` のまま | デプロイ後に手動設定 |
| `FRONTEND_REDIRECT_URI` | 例: `https://sho-blog.com/monitor/dashboard.html` | 自サイトの遷移先 |

---

## ④ bootstrap を実行（2 回目 / 5 秒）
1. もう一度 `bootstrap` を実行
2. 自動で実施される処理：
   - ScriptProperties 6 件設定
   - 生徒マスターに `email` 列が無ければ追加
   - `setupSheets()` 実行（列拡張 + SESSIONS 作成 + 空シート削除）
   - `_setup_` シートを自動削除（秘密情報を残さない）
3. 完了ダイアログ → 次のアクション 4 つが表示される

---

## ⑤ ウェブアプリとしてデプロイ（1 分）
1. 右上「デプロイ」→ 新しいデプロイ → ウェブアプリ
2. 実行ユーザー: 自分／アクセス: 全員
3. URL をコピー（`https://script.google.com/macros/s/XXX/exec`）

---

## ⑥ LINE_REDIRECT_URI を完成（30 秒）
- ⚙ プロジェクト設定 → スクリプトプロパティ
- `LINE_REDIRECT_URI` を編集して以下を入力：
  ```
  <⑤の URL>?action=line_callback
  ```

---

## ⑦ LINE Developers でコールバック URL 登録（1 分）
- console.line.biz/console → Login チャネル → LINE Login設定
- コールバックURL に **⑥と同じ値** を貼って保存

---

## ⑧ 動作確認（30 秒）
**翔也さんが Cloud Shell で：**
```bash
export WEBAPP_URL='⑤でコピーした URL'
export TEST_EMAIL='生徒マスターに登録した email'
bash ~/sprint_c1/test.sh
```

**または URL を共有してくれれば、Claude が代わりに実行します。**

---

## 比較

| 項目 | 旧 CHECKLIST | 高速版 |
|---|---|---|
| GAS にファイル貼付 | 5 ファイル | **1 ファイル** |
| ScriptProperties 入力 | ⚙画面で 7 行手入力 | **シート上で 5 行入力** |
| setupSheets 実行 | 手動 | **bootstrap が自動実行** |
| email 列追加 | 手動 | **bootstrap が自動追加** |
| 所要時間 | 30〜45 分 | **5〜10 分** |

GAS UI のデプロイと LINE Developers の登録だけは **本人の権限承認が必須**で、自動化不可です。
