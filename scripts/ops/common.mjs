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
      instructions: "あなたはsho eigoの実務責任者です。日本語Markdownで、具体的・安全・実行可能に答えてください。",
      input: prompt,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  if (data.output_text) return data.output_text;
  return (data.output || []).flatMap(x => x.content || []).map(c => c.text || "").join("\n\n");
}

export async function github({ path, method = "GET", body }) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const url = `https://api.github.com/repos/${repo}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "sho-ops-suite",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`GitHub API error ${res.status}: ${await res.text()}`);
  return await res.json();
}

export async function createIssue(title, body, labels = []) {
  return github({ path: "/issues", method: "POST", body: { title, body, labels } });
}

export function jstDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
