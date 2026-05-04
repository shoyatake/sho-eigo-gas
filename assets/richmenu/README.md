# LINE Rich Menu — 登録ブートストラップ

このフォルダは、LINE Messaging API にリッチメニューを登録するための一回限りの資材置き場です。
登録が終わったら不要になったファイルは削除して構いません。

## バリエーション

| 用途 | 実行環境 | エントリーポイント |
| --- | --- | --- |
| PRO リッチメニュー（2026 / 1枚構成） | Cloud Shell（Linux / bash） | `setup_richmenu_pro.sh` |
| A / B / C リッチメニュー（旧 PHASE2） | Windows PowerShell | `phase2_run.ps1` |

---

## PRO リッチメニュー（Cloud Shell）

> 画像 `rich_menu_pro.png` はリポジトリのルートに配置済み。スクリプトが GitHub raw から直接取得するため Cloud Shell へのファイル転送は不要。

### 実行手順

1. [Cloud Shell](https://shell.cloud.google.com/) を開く（`shoya.eigo@gmail.com` でログイン）
2. リポジトリを取得（既に clone 済みなら `git pull`）
   ```bash
   git clone https://github.com/shoyatake/sho-eigo-gas.git
   cd sho-eigo-gas
   git pull
   ```
3. スクリプトを実行
   ```bash
   bash assets/richmenu/setup_richmenu_pro.sh
   ```
4. プロンプトが出たらチャネルアクセストークン（long-lived）を貼り付け
   - 取得元: <https://developers.line.biz/console/channel/1657843747/messaging-api>
   - 「Channel access token」セクションの Issue / Reissue で発行

### 自動で実行される処理

1. `rich_menu_pro.png` を GitHub raw から `~/rich_menu_pro.png` にダウンロード
2. トークン検証（`/v2/bot/info`）
3. 既存リッチメニューを全削除
4. 5タップ領域の richmenu object を生成（`/tmp/rm.json`）
5. `POST /v2/bot/richmenu` で作成
6. `POST /v2/bot/richmenu/{id}/content` で画像アップロード
7. `POST /v2/bot/user/all/richmenu/{id}` で全友だちのデフォルトに設定

### 完了確認

- sho eigo 公式 LINE のトーク画面を開き、新リッチメニューが表示されることを確認
- 各エリアのタップ遷移を確認
  - ヒーロー（左半分） → `https://sho-blog.com/lp/lp_katakana_trial.html`
  - 右上左 → `https://sho-blog.com/courses_v9.html`
  - 右上右 → `https://sho-blog.com/next-step.html`
  - 右下左 → `https://sho-blog.com/next-step.html`
  - 右下右 → 「質問があります」を自動送信

### トラブル対応

| エラー | 原因 | 対処 |
| --- | --- | --- |
| `画像取得失敗` | GitHub に画像なし | `rich_menu_pro.png` がリポジトリ root にあるか確認 |
| `トークン無効` | トークン期限切れ／コピペミス | LINE Developers で再発行して再実行 |
| `アップロード失敗 413` | 画像が 1MB 超 | 画像を再生成して 1MB 以下に圧縮 |
| `アップロード失敗 400` | richmenu object の不正 | `assets/richmenu/menu_pro.json` の定義を確認 |

---

## 旧 PHASE 2（Windows / PowerShell）

## 中身

| ファイル | 用途 |
| --- | --- |
| `menu_a.png` / `menu_b.png` / `menu_c.png` | 2500×1686 のリッチメニュー画像 |
| `menu_a.json` / `menu_b.json` / `menu_c.json` | LINE API に渡す richmenu object（タップ領域定義） |
| `phase2_run.ps1` | 上記6ファイルを使ってAPI登録を一括実行するスクリプト |

## 実行手順（Windows）

1. このリポジトリを最新化する
   ```
   git pull
   ```

2. **PowerShell**（"PowerShell" を検索して起動。管理者権限は不要）を開き、このフォルダへ移動
   ```powershell
   cd C:\path\to\sho-eigo-gas\assets\richmenu
   ```

3. LINE のチャネルアクセストークン（long-lived）を環境変数にセット
   ```powershell
   $env:CHANNEL_TOKEN = 'ここに貼る'
   ```
   - LINE Developers Console → 該当チャネル → Messaging API設定 → Channel access token (long-lived) → Issue/Reissue で取得
   - **このウィンドウを閉じればトークンは消えます**

4. スクリプトを実行
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\phase2_run.ps1
   ```
   または ExecutionPolicy が Bypass/RemoteSigned 等であれば
   ```powershell
   .\phase2_run.ps1
   ```

5. 出力された3つのUUIDをメモ
   ```
   RICHMENU_A=richmenu-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   RICHMENU_B=richmenu-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   RICHMENU_C=richmenu-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```

6. PowerShell を閉じる（環境変数のトークンが消える）

## トラブルシューティング

- `curl.exe : ...` のエラー → curl.exe は Windows 10/11 に標準同梱。古い Win7/8 では `winget install curl` 等で導入が必要
- `ConvertFrom-Json` で空応答エラー → トークンが無効/期限切れの可能性。Reissue して再試行
- 同名のメニューを再実行すると重複登録される → LINE API には name の一意制約がない。重複した場合は古いメニューを `DELETE /v2/bot/richmenu/{id}` で削除

## 注意

- トークンを `phase2_run.ps1` に直書きしないこと（コミット事故防止）
- PR を merge する前に、このフォルダごと削除（or `.gitignore` 追加）して後片付けすること
