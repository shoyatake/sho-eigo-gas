const projectId = process.env.PROJECT_ID;
const token = process.env.GH_PROJECT_TOKEN || process.env.GITHUB_TOKEN;
let issueNodeId = process.env.ISSUE_NODE_ID;
const issueNumber = process.env.ISSUE_NUMBER;
const repo = process.env.GITHUB_REPOSITORY;

if (!projectId) throw new Error("PROJECT_ID がありません。GitHub VariablesにProject v2のNode IDを登録してください。");
if (!token) throw new Error("GH_PROJECT_TOKEN がありません。Projects権限付きPATをGitHub Secretsに登録してください。");

async function rest(path) {
  const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "sho-projects-auto-add",
    },
  });
  if (!res.ok) throw new Error(`GitHub REST error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function graphql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "sho-projects-auto-add",
    },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json();
  if (!res.ok || data.errors) throw new Error(`GitHub GraphQL error: ${JSON.stringify(data.errors || data)}`);
  return data.data;
}

if (!issueNodeId && issueNumber) {
  const issue = await rest(`/issues/${issueNumber}`);
  issueNodeId = issue.node_id;
}

if (!issueNodeId) throw new Error("ISSUE_NODE_ID が取得できません。");

const mutation = `
mutation($projectId: ID!, $contentId: ID!) {
  addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
    item { id }
  }
}
`;

const data = await graphql(mutation, { projectId, contentId: issueNodeId });
console.log(`Added to project: ${data.addProjectV2ItemById.item.id}`);
