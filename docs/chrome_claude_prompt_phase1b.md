# Chrome Claude 用プロンプト: Phase 1-B 完全自動実行 (人の確認なし)

このファイル全体を Chrome Claude のチャット欄に貼り付けて送信してください。
dry-run の検証結果が良好なら **人の確認を取らずに本番実行まで進めます**。

---

```
あなたは sho eigo プロジェクト (https://github.com/shoyatake/sho-eigo-gas) の
オペレーターです。以下の手順を **全部一気通貫で** 実行してください。
途中で人 (翔也) に確認を取る必要はありません。

## 前提条件

- 対象リポジトリ: shoyatake/sho-eigo-gas
- 対象ブランチ: claude/v1.1-parent-trial-realign
- 対象ワークフロー: .github/workflows/phase1b_l3_advanced.yml
- 必要な secret: secrets.FTP_PASS (登録済み想定)

## 手順 (1 セッション完結、ヒトの確認なし)

### Step 1: ワークフロー存在確認

GitHub MCP で確認:
- claude/v1.1-parent-trial-realign に
  .github/workflows/phase1b_l3_advanced.yml が存在
- workflow_dispatch を受け付ける

存在しない / 受け付けない場合のみここで停止。

### Step 2: dry-run 起動 (skip_upload=true)

GitHub Actions API で workflow_dispatch:
- workflow_id: phase1b_l3_advanced.yml
- ref: claude/v1.1-parent-trial-realign
- inputs: { skip_upload: "true", skip_top_inject: "false" }

### Step 3: dry-run 完了待機 + ログ検証

最大 5 分、30 秒間隔で status=completed を待機。
完了したらログを取得し、以下を機械的にチェック:

  ✓ ジョブ "generate" が success
  ✓ "✅ Phase 1-B 完了" の文字列が含まれる
  ✓ "[x]" や "[err]" の出現が 0
  ✓ 「古い値の残存なし」が parent_advanced と student_advanced の両方
  ✓ artifact が phase1b-html-<run_number> として正常に生成

### Step 4: 自動分岐

すべて満たす → **そのまま Step 5 に進む。人の確認を取らない**。
1 つでも満たさない → ログの該当部分 50 行を抜粋して報告し停止。

### Step 5: 本番実行 (skip_upload=false) — 自動的に発火

GitHub Actions API で workflow_dispatch:
- workflow_id: phase1b_l3_advanced.yml
- ref: claude/v1.1-parent-trial-realign
- inputs: { skip_upload: "false", skip_top_inject: "false" }

### Step 6: 本番実行を監視

最大 5 分、30 秒間隔で待機。完了後ログを取得して:

  ✓ ジョブ success
  ✓ "[ok] アップ:" が 4 行
  ✓ "▶ Step 5: 公開ページ検証" 配下に [ok] が 4 つ以上
  ✓ "parent/advanced/: ¥3,980=N件 ¥3,480=0件 51=N件 39=0件" 形式の OK 行
  ✓ "student/advanced/: ..." OK 行

満たさない場合は、即時にロールバック手順を提示して報告:

  ロールバック: Artifacts に保管された *_intermediate.html を
  https://github.com/shoyatake/sho-eigo-gas/actions/runs/<id>
  からダウンロードし、Cloud Shell で
    curl -u xs672802:$XSERVER_PASS -T parent_intermediate.html \
      "ftp://sv16546.xserver.jp/sho-blog.com/public_html/courses/parent/intermediate/index.html"
  で再アップロード。

### Step 7: 完了報告

下記フォーマットで報告:

  ✅ Phase 1-B 完全自動完了

  dry-run Run URL: https://github.com/shoyatake/sho-eigo-gas/actions/runs/<id1>
  本番 Run URL:    https://github.com/shoyatake/sho-eigo-gas/actions/runs/<id2>

  公開ページ:
    https://sho-blog.com/courses/parent/advanced/   [200]
    https://sho-blog.com/courses/student/advanced/  [200]

  検証:
    parent/advanced/  ¥3,980=N  51コース=N  古い値=0
    student/advanced/ ¥3,980=N  51コース=N  古い値=0
    parent top advanced リンク: N
    student top advanced リンク: N

  バックアップ:
    https://github.com/shoyatake/sho-eigo-gas/actions/runs/<id1> の Artifacts

## 注意事項

- 凍結ルール (CLAUDE.md §1) は維持。ワークフロー起動と検証のみ。
- ヒトに「進めますか?」と聞かない (今回は完全自動モード)。
- スクリーンショット撮影禁止。すべて API レスポンス / ログテキストで確認。
- dry-run NG なら本番に絶対進まない (これだけは守る)。
- secrets.FTP_PASS が無いエラーで停止したらユーザーに登録方法を伝える。
```

---

## このプロンプトの使い方

1. 上記のコードブロック (` ``` ` で囲まれた部分) をコピー
2. https://claude.ai/code を開いて新規セッション
3. プロンプトを貼り付けて送信
4. **席を立って戻ってくると完了レポートが出ている** (約 5〜10 分)

dry-run の自動検証が通れば、人の操作なしで本番反映まで走ります。
ロールバックが必要なケースのみ手順が指示されます。
