import { callOpenAI, github, createIssue, jstDate } from "./common.mjs";
import fs from "node:fs/promises";

async function readProfile() {
  try {
    return await fs.readFile("growth/sho-eigo-profile.md", "utf8");
  } catch {
    return "sho eigo: 英語の音を、体に入れる。主力商品は声日記プレミアム。";
  }
}

const profile = await readProfile();
const issues = await github({ path: "/issues?state=open&per_page=40" });
const pulls = await github({ path: "/pulls?state=open&per_page=10" });

const prompt = `
あなたはsho eigoのCEO Agentです。
1人運営者が今日やるべきことを、収益性と拡散性を基準に絞ってください。

# ブランド/商品前提
${profile}

# 評価軸
1. 収益性: 今月の売上に直結するか
2. 拡散性: SNSで保存・共有・DMにつながるか
3. 実行速度: 今日〜3日以内にできるか
4. 資産性: SEO・LP・自動化として残るか
5. 省時間性: 対面時間や個別返信を増やさないか

# 禁止
- 対面型伴走コースを新設しない
- 週1回面談や個別通話を前提にしない
- 毎日個別返信を前提にしない
- 自動投稿、自動いいね、スパムDMを前提にしない

# Open Issues
${JSON.stringify(issues.map(i => ({ title: i.title, url: i.html_url })), null, 2)}

# Open PRs
${JSON.stringify(pulls.map(p => ({ title: p.title, url: p.html_url })), null, 2)}

# 出力
- 今日の最重要判断
- 今日やるTOP3
- 3日以内にやるTOP5
- 7日以内にやるTOP10
- 声日記プレミアムの売上導線改善
- SNSで拡散しやすい投稿テーマ
- DMで使う短文テンプレ
- やらないこと
- 最後にGitHub Issue化しやすいタイトル一覧
`;

const body = await callOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  model: process.env.OPENAI_MODEL || "gpt-5.4-mini",
  prompt,
});

const issue = await createIssue(`sho CEO Agent: ${jstDate()} - Voice Diary Premium Focus`, body);
console.log(issue.html_url);
