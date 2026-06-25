import { callOpenAI, createIssue, jstDate } from "./common.mjs";

const prompt = `
Search Console連携とGoogle Analytics連携を進めるためのセットアップIssueを作ってください。

現状:
- GSC_SITE_URL: ${process.env.GSC_SITE_URL || ""}
- GA4_PROPERTY_ID: ${process.env.GA4_PROPERTY_ID || ""}
- まだサービスアカウントや認証情報は未設定の可能性が高い

出力:
- Search Console連携の目的
- GA4連携の目的
- 必要なSecret/Variable一覧
- Google Cloudでやること
- GitHubでやること
- 実装ステップ
- 最初に作るべき自動レポート
- 注意点
`;

const body = await callOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  model: process.env.OPENAI_MODEL,
  prompt,
});

const issue = await createIssue(`Sho Analytics Setup: ${jstDate()}`, body);
console.log(issue.html_url);
