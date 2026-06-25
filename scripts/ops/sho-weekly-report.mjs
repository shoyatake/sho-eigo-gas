import { callOpenAI, github, createIssue, jstDate } from "./common.mjs";

const issues = await github({ path: "/issues?state=all&per_page=20" });
const pulls = await github({ path: "/pulls?state=all&per_page=10" });

const prompt = `
sho eigoの週次レポートを作ってください。

# Issues
${JSON.stringify(issues.map(i => ({ title: i.title, state: i.state, url: i.html_url })), null, 2)}

# Pull Requests
${JSON.stringify(pulls.map(p => ({ title: p.title, state: p.state, url: p.html_url })), null, 2)}

出力:
- 今週の進捗
- 認知拡大
- 開発
- SEO
- 来週の優先順位TOP5
- 今日すぐやる3つ
`;

const body = await callOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  model: process.env.OPENAI_MODEL,
  prompt,
});

const issue = await createIssue(`sho eigo Weekly Report: ${jstDate()}`, body);
console.log(issue.html_url);
