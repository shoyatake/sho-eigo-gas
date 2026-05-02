# LINE Rich Menu — PHASE 2 (Windows / PowerShell)

このフォルダの中身は、LINE Messaging API にリッチメニュー A / B / C を登録するための一回限りのブートストラップ資材です。
登録が終わったら（PR本文の指示に従って）削除して構いません。

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
