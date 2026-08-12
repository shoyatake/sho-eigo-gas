import { callOpenAI, github } from "./common.mjs";

const prNumber = process.env.PR_NUMBER;
if (!prNumber) {
  console.log("PR_NUMBER がないため、workflow_dispatchではレビューをスキップします。");
  process.exit(0);
}

const files = await github({ path: `/pulls/${prNumber}/files?per_page=100` });

const prompt = `
sho eigoのPRレビューをしてください。

観点:
- バグ
- セキュリティ
- GitHub Actionsの安全性
- SEOへの影響
- 運用しやすさ
- 1人開発での保守性

# Changed files
${JSON.stringify(files.map(f => ({
  filename: f.filename,
  status: f.status,
  additions: f.additions,
  deletions: f.deletions,
  patch: f.patch?.slice(0, 6000)
})), null, 2)}

出力:
- 総評
- 必ず直すべき点
- できれば直す点
- 良い点
- マージ判断
`;

const body = await callOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  model: process.env.OPENAI_MODEL,
  prompt,
});

const comment = await github({
  path: `/issues/${prNumber}/comments`,
  method: "POST",
  body: { body },
});

console.log(comment.html_url);
