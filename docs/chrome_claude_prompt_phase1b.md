# Chrome Claude 用プロンプト: Phase 1-B 自動実行

このファイル全体を Chrome Claude のチャット欄に貼り付けて送信してください。
Claude Code Web の GitHub MCP ツールを使って、L3 Advanced ページの生成 →
公開検証までを 1 セッションで完結させます。

---

```
あなたは sho eigo プロジェクト (https://github.com/shoyatake/sho-eigo-gas) の
オペレーターです。以下の手順を順に実行し、最後に結果を報告してください。

## 前提条件

- 対象リポジトリ: shoyatake/sho-eigo-gas
- 対象ブランチ: claude/v1.1-parent-trial-realign (PR #28、Draft)
- 対象ワークフロー: .github/workflows/phase1b_l3_advanced.yml
- 必要な secret: secrets.FTP_PASS (既存の deploy.yml が使っているので登録済の想定)

## 手順

### Step 1: 状況確認

GitHub MCP で以下を確認:
1. リポジトリ shoyatake/sho-eigo-gas の最新の claude/v1.1-parent-trial-realign
   ブランチに .github/workflows/phase1b_l3_advanced.yml が存在するか
2. 該当ワークフローが workflow_dispatch を受け付けるか
3. 直近の同ワークフロー実行履歴があれば、最新 1 件のステータス

不一致や失敗があれば、ここで報告して停止してください。

### Step 2: dry-run (skip_upload=true) を起動

GitHub Actions API で workflow_dispatch を発火:
- workflow_id: phase1b_l3_advanced.yml
- ref: claude/v1.1-parent-trial-realign
- inputs: { skip_upload: "true", skip_top_inject: "false" }

### Step 3: dry-run 実行を監視

新しく作成されたワークフロー実行を取得し、status が completed になるまで
30 秒間隔で最大 5 分待つ。

実行ログを取得して以下を確認:
1. ジョブ "generate" が success で終わっているか
2. ログ内に "✅ Phase 1-B 完了" の文字列があるか
3. ログ内に [x] や [err] が無いか
4. 「古い値の残存なし」が parent_advanced と student_advanced の両方で出ているか

### Step 4: dry-run 結果の判定

- 上記 1-4 すべて満たす → Step 5 へ進む
- いずれか満たさない → ログの該当部分を抜粋して報告し、Step 5 へ進まずに停止

### Step 5: 翔也さんに本番実行の確認を取る

Step 4 が OK だった場合、以下のサマリと共に「本番実行 (skip_upload=false)
に進めますか?」と日本語で質問してください。

- dry-run の Run URL
- 生成された parent_advanced.html / student_advanced.html のサイズ
- ログから抽出した価格・コース数・レッスン数の件数
- 残存していた古い値の有無

ユーザーが「はい」「進めて」「OK」等の肯定的な返答をしたら Step 6 へ。
否定や曖昧な返答なら、Step 6 には進まずユーザーに次の指示を仰ぐ。

### Step 6: 本番実行 (skip_upload=false)

GitHub Actions API で workflow_dispatch を発火:
- workflow_id: phase1b_l3_advanced.yml
- ref: claude/v1.1-parent-trial-realign
- inputs: { skip_upload: "false", skip_top_inject: "false" }

### Step 7: 本番実行を監視

Step 3 と同様に completed まで待機。ログから以下を確認:

- ジョブ "generate" が success
- "▶ Step 4: FTP アップロード" 配下に [ok] アップ: 4 件
  (parent/advanced/index.html, student/advanced/index.html,
   parent/index.html, student/index.html)
- "▶ Step 5: 公開ページ検証" 配下:
  - HTTP 200 が 4 つの URL すべて
  - parent/advanced と student/advanced で ¥3,980>=1, ¥3,480=0,
    51コース>=1, 39コース=0
  - parent top と student top に /advanced/ リンクが 1 件以上

### Step 8: 完了報告

最後に以下のフォーマットで報告:

```
✅ Phase 1-B 完了

dry-run Run URL: https://github.com/shoyatake/sho-eigo-gas/actions/runs/<id>
本番 Run URL:    https://github.com/shoyatake/sho-eigo-gas/actions/runs/<id>

公開ページ:
  https://sho-blog.com/courses/parent/advanced/   [200]
  https://sho-blog.com/courses/student/advanced/  [200]

トップページ更新:
  https://sho-blog.com/courses/parent/   (advanced リンク N 個)
  https://sho-blog.com/courses/student/  (advanced リンク N 個)

検証結果:
  parent/advanced/  ¥3,980=N件  51コース=N件  古い値=0件
  student/advanced/ ¥3,980=N件  51コース=N件  古い値=0件

バックアップ:
  Artifacts (14日間保管): https://github.com/shoyatake/sho-eigo-gas/actions/runs/<id>
```

## 注意事項

- 凍結ルール (CLAUDE.md §1) に従い、新機能を追加してはいけません。
  このタスクは既存ワークフローの 1 クリック起動だけです。
- 検証 NG の場合は本番実行に進まず停止してください。
- secrets.FTP_PASS が無いエラーが出たら、ユーザーに登録方法を伝えて停止。
- スクリーンショットは禁止。すべて API レスポンス / ログテキストで確認。
- 本番アップロードに失敗してロールバックが必要な場合は、Artifacts に
  含まれる *_intermediate.html のバックアップを使って FTP に再アップする
  Cloud Shell コマンドをユーザーに提示してください。
```

---

## このプロンプトの使い方

1. 上記コードブロック全体 (` ``` ` で囲まれた部分) をコピー
2. https://claude.ai/code を開いて新しいセッション
3. 「sho eigo」リポジトリへの GitHub アクセス権を持つアカウントでログイン済か確認
4. プロンプトを貼り付けて送信
5. Step 5 の確認質問が来たら「進めて」と返答
6. Step 8 の完了報告を待つ

GitHub MCP ツールが利用可能な Claude Code Web セッションなら、Cloud Shell を
開かなくても全自動で進みます。
