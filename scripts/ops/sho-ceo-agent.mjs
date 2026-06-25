import { callOpenAI, github, createIssue, jstDate } from "./common.mjs";

const issues = await github({ path: "/issues?state=open&per_page=30" });
const pulls = await github({ path: "/pulls?state=open&per_page=10" });

const prompt = `
あなたはsho eigoのCEO Agentです。
今日やるべきことを、1人運営者向けに絞ってください。

# Open Issues
${JSON.stringify(issues.map(i => ({ title: i.title, url: i.html_url })), null, 2)}

# Open PRs
${JSON.stringify(pulls.map(p => ({ title: p.title, url: p.html_url })), null, 2)}

出力:
- 今日の最重要判断
- 今日やるTOP3
- やらないこと
- 認知/開発/売上のバランス
- 15分でできる行動
- 60分ある時の行動
`;

const body = await callOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  model: process.env.OPENAI_MODEL,
  prompt,
});

const issue = await createIssue(`sho CEO Agent: ${jstDate()}`, body);
console.log(issue.html_url);
