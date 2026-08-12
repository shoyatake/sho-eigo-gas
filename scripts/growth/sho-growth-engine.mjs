import fs from "node:fs/promises";

const apiKey = process.env.OPENAI_API_KEY;
const githubToken = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;
const mode = (process.env.MODE || "daily").toLowerCase();
const dryRun = String(process.env.DRY_RUN || "true").toLowerCase() === "true";
const model = process.env.OPENAI_MODEL || "gpt-5.4-mini";
const siteUrl = process.env.SITE_URL || "https://sho-blog.com/";

if (!apiKey) {
  throw new Error("OPENAI_API_KEY がありません。GitHub Secrets に OPENAI_API_KEY を登録してください。");
}

function jstDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function modeInstruction(currentMode) {
  switch (currentMode) {
    case "weekly":
      return `
今週7日間の認知拡大計画を作る。
- 今週のテーマ
- 7日分の投稿カレンダー
- Instagram / Reels / Threads / X案
- DM導線
- SEO記事案3本
- KPI
`;
    case "seo":
      return `
SEO改善Issueを作る。
- 狙う検索意図
- 記事タイトル案10本
- 内部リンク案
- 無料体験CTA
- 既存ページ改善仮説
- 実行チェックリスト
`;
    case "offer":
      return `
無料体験から有料化への導線改善案を作る。
- ファーストビュー改善
- 14日無料体験CTA改善
- 親向け訴求
- 大人向け訴求
- 英検向け訴求
- DM返信テンプレ
`;
    default:
      return `
今日1日の認知拡大実行プランを作る。
- 今日の勝ち筋
- 15分でやること
- 45分でやること
- Instagram Stories案3本
- Reels案1本
- Carousel案1本
- Threads/X投稿案3本
- DM返信テンプレ3本
- SEO小タスク
- KPI記録欄
- 今日やらないこと
`;
  }
}

async function readProfile() {
  try {
    return await fs.readFile("growth/sho-eigo-profile.md", "utf8");
  } catch {
    return "sho eigo: 英語の音を、体に入れる。英検・シャドーイング・発音をやさしく実践支援する。";
  }
}

async function callOpenAI(prompt) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      instructions:
        "あなたは日本語の英語学習サービスの認知拡大責任者です。実行しやすいMarkdownだけを出力してください。",
      input: prompt,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  if (data.output_text) return data.output_text;

  const chunks = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.text) chunks.push(content.text);
    }
  }
  return chunks.join("\n\n") || JSON.stringify(data, null, 2);
}

async function createIssue(title, body) {
  const response = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${githubToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "sho-growth-engine",
    },
    body: JSON.stringify({ title, body }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GitHub issue creation failed ${response.status}: ${errorText}`);
  }

  return await response.json();
}

const date = jstDate();
const profile = await readProfile();

const prompt = `
# 今日
- Date: ${date} JST
- Mode: ${mode}
- Site: ${siteUrl}

# ブランド情報
${profile}

# 今回のタスク
${modeInstruction(mode)}

# ルール
- 日本語Markdown
- 具体的に
- 1人運営でも実行できる粒度
- 自動投稿・自動いいね・スパムDMは禁止
- AIは戦略、下書き、Issue化まで
- 最終投稿とDM送信は人間が確認する
- CTAは「14日無料体験」「英検無料模試」「英語ダンジョン」「DM相談」のどれか
`;

const generated = await callOpenAI(prompt);

const body = `# sho eigo Growth Brief

- Date: ${date} JST
- Mode: ${mode}
- Model: ${model}
- Dry run: ${dryRun}

---

${generated}
`;

await fs.mkdir("growth-output", { recursive: true });
const outputPath = `growth-output/${date}-${mode}.md`;
await fs.writeFile(outputPath, body, "utf8");
console.log(`Wrote ${outputPath}`);

if (!dryRun) {
  if (!githubToken || !repo) {
    throw new Error("GITHUB_TOKEN または GITHUB_REPOSITORY がありません。");
  }
  const issue = await createIssue(`sho eigo Growth Brief: ${date} (${mode})`, body);
  console.log(`Created issue: ${issue.html_url}`);
} else {
  console.log("DRY_RUN=true のためIssue作成はスキップしました。");
}
