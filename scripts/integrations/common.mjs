export async function callOpenAI({ apiKey, model, prompt }) {
  if (!apiKey) throw new Error("OPENAI_API_KEY がありません。");
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      instructions: "あなたはsho eigoのSEO/分析責任者です。日本語Markdownで、具体的な改善Issueとして出力してください。",
      input: prompt,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  if (data.output_text) return data.output_text;
  return (data.output || []).flatMap(x => x.content || []).map(c => c.text || "").join("\n\n");
}

export async function createIssue(title, body) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "sho-real-data-integrations",
    },
    body: JSON.stringify({ title, body }),
  });
  if (!res.ok) throw new Error(`GitHub issue creation failed ${res.status}: ${await res.text()}`);
  return await res.json();
}

export function dateDaysAgo(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export function jstDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function requireJsonSecret(name) {
  const raw = process.env[name];
  if (!raw) {
    throw new Error(`${name} がありません。GitHub SecretsにサービスアカウントJSONを1行で登録してください。`);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${name} がJSONとして読めません。SecretにサービスアカウントJSON全体を貼ってください。`);
  }
}
