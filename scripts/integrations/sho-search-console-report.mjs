import { google } from "googleapis";
import { callOpenAI, createIssue, dateDaysAgo, jstDate, requireJsonSecret } from "./common.mjs";

const credentials = requireJsonSecret("GOOGLE_SERVICE_ACCOUNT_JSON");
const siteUrl = process.env.GSC_SITE_URL || "https://sho-blog.com/";

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
});

const webmasters = google.webmasters({ version: "v3", auth });

const startDate = dateDaysAgo(28);
const endDate = dateDaysAgo(2);

const query = async (dimensions) => {
  const res = await webmasters.searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate,
      endDate,
      dimensions,
      rowLimit: 25,
      startRow: 0,
    },
  });
  return res.data.rows || [];
};

const queries = await query(["query"]);
const pages = await query(["page"]);
const queryPages = await query(["query", "page"]);

const prompt = `
Search Consoleの実データから、sho eigoのSEO改善Issueを作ってください。

# 期間
${startDate} 〜 ${endDate}

# サイト
${siteUrl}

# 上位クエリ
${JSON.stringify(queries, null, 2)}

# 上位ページ
${JSON.stringify(pages, null, 2)}

# クエリ×ページ
${JSON.stringify(queryPages, null, 2)}

出力:
- 重要サマリー
- 伸びている検索意図
- CTR改善候補
- 掲載順位はあるがクリックが弱い候補
- 新規記事案10本
- 既存記事リライト案5本
- 内部リンク案
- 14日無料体験/英検無料模試への導線改善
- 今週やるTOP5
`;

const body = await callOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  model: process.env.OPENAI_MODEL || "gpt-5.4-mini",
  prompt,
});

const issue = await createIssue(`Sho GSC Report: ${jstDate()}`, body);
console.log(issue.html_url);
