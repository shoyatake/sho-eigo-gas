import fs from "node:fs/promises";
import { callOpenAI, createIssue, jstDate } from "./common.mjs";

function parseBool(name, defaultValue) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defaultValue;
  if (String(raw).toLowerCase() === "true") return true;
  if (String(raw).toLowerCase() === "false") return false;
  throw new Error(`${name} must be "true" or "false".`);
}

function parseTaskLimit(raw) {
  const value = Number(raw || "5");
  if (!Number.isInteger(value) || value < 1 || value > 20) {
    throw new Error("TASK_LIMIT must be an integer between 1 and 20.");
  }
  return value;
}

const dryRun = parseBool("DRY_RUN", true);
const createTaskIssues = parseBool("CREATE_TASK_ISSUES", false);
const taskLimit = parseTaskLimit(process.env.TASK_LIMIT);

async function githubRaw({ path, method = "GET", body }) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token) throw new Error("GITHUB_TOKEN is required for GitHub writes.");
  if (!repo) throw new Error("GITHUB_REPOSITORY is required for GitHub writes.");
  const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "sho-voice-diary-premium-sprint",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 422 && path === "/labels") return null;
    throw new Error(`GitHub API error ${res.status}: ${text}`);
  }

  if (res.status === 204) return null;
  return await res.json();
}

async function upsertLabel(name, color, description) {
  try {
    await githubRaw({
      path: "/labels",
      method: "POST",
      body: { name, color, description },
    });
  } catch (e) {
    if (String(e.message || "").includes("already_exists") || String(e.message || "").includes("Validation Failed")) {
      return;
    }
    throw e;
  }
}

async function openIssueTitles() {
  const issues = await githubRaw({ path: "/issues?state=open&per_page=100" });
  return new Set(
    issues
      .filter(issue => !issue.pull_request)
      .map(issue => issue.title)
  );
}

const tasks = [
  {
    title: "声日記プレミアム専用LPを作る",
    labels: ["revenue", "voice-diary-premium", "lp", "today"],
    objective: "声日記プレミアムを主力商品として売るための専用ページを作る。",
    actions: [
      "URL案: /lp/voice-diary-premium",
      "見出し: 英語が伸びるだけで終わらない。今しかない声を家族に残す。",
      "料金: 月額6,980円 / 年額69,800円を明記",
      "14日無料体験から自然に誘導するCTAを置く",
    ],
    kpi: ["LP閲覧数", "CTAクリック数", "14日無料体験開始数", "声日記プレミアム申込数"],
  },
  {
    title: "トップページのファーストビューに声日記プレミアム導線を追加する",
    labels: ["revenue", "voice-diary-premium", "lp"],
    objective: "トップページ訪問者に、声日記プレミアムの価値を早い段階で伝える。",
    actions: [
      "コピー案: 英語の音を、体に入れる。そして、今しかない声を家族に残す。",
      "CTAを「14日無料体験」と「声日記プレミアムを見る」の2つに整理する",
      "親向けの一文を追加する",
    ],
    kpi: ["ファーストビューCTAクリック率", "プレミアムLP遷移数"],
  },
  {
    title: "Day14卒業オファーを声日記プレミアム中心に変更する",
    labels: ["revenue", "voice-diary-premium", "trial"],
    objective: "14日無料体験の完走者を、声日記プレミアムへつなげる。",
    actions: [
      "Day14ページに卒業オファーを追加",
      "コピー案: この14日間の声を、ここで終わらせますか？家族の記録として残していきませんか？",
      "見守りプランとプレミアムの比較を入れる",
    ],
    kpi: ["Day14到達数", "オファークリック数", "申込数"],
  },
  {
    title: "Instagram固定投稿を声日記プレミアム訴求に変える",
    labels: ["viral", "revenue", "sns", "today"],
    objective: "プロフィール訪問者に、主力商品を一瞬で伝える。",
    actions: [
      "固定投稿1: 子どもの英語学習を、ただの勉強で終わらせない",
      "固定投稿2: 14日無料体験の流れ",
      "固定投稿3: 声日記プレミアムの価値",
    ],
    kpi: ["プロフィールアクセス", "リンククリック", "DM数"],
  },
  {
    title: "DMキーワード『声日記』導線を作る",
    labels: ["revenue", "viral", "dm", "today"],
    objective: "SNS反応を相談と無料体験へ変える。",
    actions: [
      "投稿CTA: 気になる方はDMで「声日記」と送ってください",
      "返信テンプレを作る",
      "無料体験URLを自然に案内する",
    ],
    kpi: ["DM数", "無料体験クリック数", "返信率"],
  },
  {
    title: "声日記プレミアム用DM返信テンプレを3種類作る",
    labels: ["revenue", "dm", "voice-diary-premium"],
    objective: "DM対応時間を減らしつつ、成約率を上げる。",
    actions: [
      "保護者向けテンプレ",
      "英検学習者向けテンプレ",
      "親子記録に反応した人向けテンプレ",
    ],
    kpi: ["DM返信時間", "無料体験遷移率", "申込率"],
  },
  {
    title: "声日記プレミアム訴求のReels案を7本作る",
    labels: ["viral", "sns", "voice-diary-premium"],
    objective: "感情訴求で拡散し、無料体験へつなげる。",
    actions: [
      "子どもの声って、気づいたら変わってる",
      "英語学習を家族の記録にする",
      "Day1とDay14の声の変化",
      "親が毎日教えなくても見守れる",
      "英検リスニングと声日記の相性",
      "月2,000円差でプレミアムにする理由",
      "未来の子どもに今の声を残す",
    ],
    kpi: ["再生数", "保存数", "プロフィールアクセス", "DM数"],
  },
  {
    title: "物理アルバムのモック画像案を作る",
    labels: ["viral", "revenue", "creative"],
    objective: "年額69,800円の価値を視覚化する。",
    actions: [
      "表紙案を作る",
      "QRコード付きページ案を作る",
      "親の声入りページ案を作る",
      "SNS投稿用の画像プロンプトを作る",
    ],
    kpi: ["保存数", "LP滞在時間", "年額プランクリック数"],
  },
  {
    title: "年額69,800円の価値訴求を作る",
    labels: ["revenue", "pricing", "voice-diary-premium"],
    objective: "年額プランの心理的ハードルを下げる。",
    actions: [
      "月額換算ではなく、家族の記録価値で説明する",
      "親の声入り声日記ブックを前面に出す",
      "月額との比較表を作る",
    ],
    kpi: ["年額プランクリック数", "申込率"],
  },
  {
    title: "見守りプランとプレミアムの比較表を作る",
    labels: ["revenue", "lp", "voice-diary-premium"],
    objective: "月額4,980円から6,980円へのアップセルを強くする。",
    actions: [
      "月2,000円差で何が増えるかを明確化",
      "声日記5機能を表示",
      "親子レイヤー3機能を表示",
      "年額特典を表示",
    ],
    kpi: ["比較表閲覧数", "プレミアム選択率"],
  },
  {
    title: "声日記5機能をカード化する",
    labels: ["revenue", "lp", "creative"],
    objective: "プレミアムの中身を見える化する。",
    actions: [
      "5機能の名前と説明を整理",
      "1機能1カードでLPに入れる",
      "Instagramカルーセルにも流用する",
    ],
    kpi: ["LP滞在時間", "保存数", "CTAクリック数"],
  },
  {
    title: "親子レイヤー3機能をカード化する",
    labels: ["revenue", "lp", "creative"],
    objective: "親子で使う価値を分かりやすくする。",
    actions: [
      "声かけスタンプ",
      "順番音読",
      "せーの共演",
      "各機能を親目線で説明する",
    ],
    kpi: ["LP滞在時間", "プレミアム選択率"],
  },
  {
    title: "FAQに『対面なし・個別通話なし』を明記する",
    labels: ["ops", "revenue", "lp"],
    objective: "提供範囲を明確化し、運営時間を守る。",
    actions: [
      "対面レッスンは含まれません",
      "個別通話は基本ありません",
      "親はLINE/レポートで見守れます",
      "サポート範囲を明文化する",
    ],
    kpi: ["問い合わせ削減", "解約率低下"],
  },
  {
    title: "14日無料体験のDay1/Day7/Day14メッセージを作る",
    labels: ["revenue", "trial", "dm"],
    objective: "無料体験から有料化への自然な流れを作る。",
    actions: [
      "Day1: 始め方案内",
      "Day7: 声の変化確認",
      "Day14: 声日記プレミアム提案",
    ],
    kpi: ["Day14到達率", "有料化率"],
  },
  {
    title: "英検無料模試完了後に声日記導線を入れる",
    labels: ["revenue", "eiken", "trial"],
    objective: "英検入口からプレミアム導線を作る。",
    actions: [
      "模試後にリスニング課題を提示",
      "音読/声日記で改善できることを説明",
      "14日無料体験へ誘導",
    ],
    kpi: ["模試完了数", "無料体験クリック数"],
  },
  {
    title: "価格ページでプレミアムを一番選びやすくする",
    labels: ["revenue", "pricing", "lp"],
    objective: "COREではなく声日記プレミアムへの選択率を上げる。",
    actions: [
      "おすすめ表示をプレミアムにつける",
      "見守りとの差分を強調",
      "年額特典を強調",
    ],
    kpi: ["プレミアム選択率", "年額選択率"],
  },
  {
    title: "お客様の声収集フォームを作る",
    labels: ["revenue", "trust", "ops"],
    objective: "信頼材料を増やす。",
    actions: [
      "体験前の悩み",
      "14日で変わったこと",
      "子どもの声で嬉しかったこと",
      "掲載許可",
    ],
    kpi: ["回答数", "掲載可能な声の数"],
  },
  {
    title: "GA4で声日記プレミアム導線のKPIを設計する",
    labels: ["analytics", "revenue", "voice-diary-premium"],
    objective: "どこで離脱しているかを測れるようにする。",
    actions: [
      "プレミアムLP閲覧",
      "CTAクリック",
      "無料体験開始",
      "Day14到達",
      "申込クリック",
    ],
    kpi: ["各イベント数", "CVR"],
  },
  {
    title: "Search Consoleで親向け検索クエリを抽出する",
    labels: ["seo", "revenue", "voice-diary-premium"],
    objective: "親向けSEO記事の優先順位を決める。",
    actions: [
      "子ども 英語 続かない",
      "英検 リスニング 聞き取れない",
      "小学生 英語 音読",
      "親子 英語 学習",
    ],
    kpi: ["表示回数", "CTR", "検索順位"],
  },
  {
    title: "CEO/Growth Engineの前提を声日記プレミアム中心に更新する",
    labels: ["ops", "today", "voice-diary-premium"],
    objective: "今後AIが伴走コース新設などズレた提案をしないようにする。",
    actions: [
      "sho-eigo-profile.mdを更新",
      "CEO Agentの評価軸を更新",
      "Growth Engineはプロフィールを参照する",
    ],
    kpi: ["AI提案のズレ減少", "売上直結Issue比率"],
  },
];

function taskBody(task, index) {
  return `# ${task.title}

## 優先順位
${index + 1} / ${tasks.length}

## 目的
${task.objective}

## 具体作業
${task.actions.map(a => `- ${a}`).join("\n")}

## KPI
${task.kpi.map(k => `- ${k}`).join("\n")}

## 前提
- 主力商品は対面伴走ではなく「声日記プレミアム」
- 対面時間、個別通話、毎日個別返信は増やさない
- 14日無料体験 → 声日記見守り → 声日記プレミアム の導線を強化する
- 拡散テーマは「英語が伸びる」だけでなく「子どもの今の声を家族に残す」

## 完了条件
- 実装または投稿/文案が作成されている
- 次に取るべき行動が明確になっている
- 可能なら関連URLまたはスクリーンショットをコメントに残す
`;
}

const labels = [
  ["revenue", "0E8A16", "売上に直結するタスク"],
  ["viral", "D93F0B", "SNS拡散に関わるタスク"],
  ["voice-diary-premium", "5319E7", "声日記プレミアム強化"],
  ["today", "B60205", "今日やる優先タスク"],
  ["lp", "1D76DB", "LP/サイト改善"],
  ["sns", "FBCA04", "SNS投稿/拡散"],
  ["dm", "C5DEF5", "DM導線/返信テンプレ"],
  ["trial", "7057FF", "14日無料体験導線"],
  ["pricing", "006B75", "価格/プラン改善"],
  ["creative", "F9D0C4", "画像/カード/クリエイティブ"],
  ["ops", "D4C5F9", "運用整備"],
  ["analytics", "0052CC", "分析/KPI"],
  ["seo", "1A7F37", "SEO"],
  ["eiken", "F2A60C", "英検導線"],
  ["trust", "BFD4F2", "信頼/お客様の声"],
];

const selectedTasks = tasks.slice(0, taskLimit);
const profile = await fs.readFile("growth/sho-eigo-profile.md", "utf8").catch(() => "");

const prompt = `
sho eigoの声日記プレミアムを主力商品として、収益性と拡散性を最大化するSprint Briefを作ってください。

# 前提
${profile}

# 今回確認する上位タスク
${selectedTasks.map((t, i) => `${i + 1}. ${t.title}`).join("\n")}

# 出力
- 戦略サマリー
- タスク100個を考えた前提で、上位20個を選んだ理由
- 今日やる3つ
- 3日以内にやる5つ
- 7日以内にやる12個
- Instagram投稿案
- Reels案
- DM返信テンプレ
- LP改善案
- やらないこと
`;

let strategicBrief = "";
if (dryRun) {
  strategicBrief = `DRY_RUN=true のため、OpenAI API呼び出しとGitHub書き込みは行いません。

この実行では、作成予定のタスクと設定値だけを確認します。`;
} else {
  strategicBrief = await callOpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || "gpt-5.4-mini",
    prompt,
  });
}

const summaryBody = `# Voice Diary Premium Sprint

- Date: ${jstDate()}
- Dry run: ${dryRun}
- Create task issues: ${createTaskIssues}
- Task limit: ${taskLimit}

---

${strategicBrief}

---

## 確認対象の上位タスク

${selectedTasks.map((t, i) => `### ${i + 1}. ${t.title}

目的: ${t.objective}

Labels: ${t.labels.join(", ")}
`).join("\n")}
`;

if (dryRun) {
  console.log(summaryBody);
  process.exit(0);
}

for (const [name, color, description] of labels) {
  await upsertLabel(name, color, description);
}

const existingTitles = await openIssueTitles();
const summaryTitle = `Voice Diary Premium Sprint: ${jstDate()}`;
if (existingTitles.has(summaryTitle)) {
  console.log(`Skip existing summary issue: ${summaryTitle}`);
} else {
  const summaryIssue = await createIssue(summaryTitle, summaryBody, [
    "revenue",
    "voice-diary-premium",
    "today",
  ]);
  existingTitles.add(summaryTitle);
  console.log(`Summary issue: ${summaryIssue.html_url}`);
}

if (createTaskIssues) {
  for (let i = 0; i < selectedTasks.length; i++) {
    const task = selectedTasks[i];
    const title = `[Voice Premium ${i + 1}] ${task.title}`;
    if (existingTitles.has(title)) {
      console.log(`Skip existing task issue ${i + 1}: ${title}`);
      continue;
    }
    const issue = await createIssue(title, taskBody(task, i), task.labels);
    existingTitles.add(title);
    console.log(`Task issue ${i + 1}: ${issue.html_url}`);
  }
}
