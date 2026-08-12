# Sho Ops Suite

追加したもの:

1. Search Console / GA4 セットアップIssue生成
2. GitHub Projects セットアップIssue生成
3. PRレビューAI
4. 週次レポート
5. CEO Agent

## 使い方

Actionsから各workflowを手動実行します。

- Sho Analytics Setup Advisor
- Sho Projects Setup Advisor
- Sho PR Review AI
- Sho Weekly Report
- Sho CEO Agent

## 必要なSecret

- OPENAI_API_KEY

## 任意のVariables

- OPENAI_MODEL
- GSC_SITE_URL
- GA4_PROPERTY_ID

## Voice Diary Premium Focus

追加方針:

- 主力商品は「声日記プレミアム」
- 対面型伴走コースは作らない
- 対面時間、個別通話、毎日個別返信を増やさない
- 14日無料体験 → 声日記見守り → 声日記プレミアム の導線を強化する
- 拡散テーマは「英語が伸びる」だけでなく「子どもの今の声を家族に残す」

### 追加Workflow

- Sho Voice Diary Premium Sprint

実行設定:

- dry_run: false
- create_task_issues: true
- task_limit: 20

このActionは、声日記プレミアム強化の上位20タスクをGitHub Issueとして作成します。
