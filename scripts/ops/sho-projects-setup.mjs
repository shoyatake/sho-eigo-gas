import { callOpenAI, createIssue, jstDate } from "./common.mjs";

const prompt = `
GitHub Projects連携を進めるためのセットアップIssueを作ってください。

目的:
- Growth/SNS/SEO/CEO Agentが作るIssueを管理しやすくする
- To Do / Doing / Done / Waiting で運用する
- 1人開発でも迷わないボードにする

出力:
- 推奨Project構成
- カラム
- ラベル
- Issueテンプレ
- 自動化ルール
- 最初にやる手順
`;

const body = await callOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  model: process.env.OPENAI_MODEL,
  prompt,
});

const issue = await createIssue(`Sho Projects Setup: ${jstDate()}`, body);
console.log(issue.html_url);
