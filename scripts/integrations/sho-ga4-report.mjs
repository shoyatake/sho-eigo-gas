import { BetaAnalyticsDataClient } from "@google-analytics/data";
import { callOpenAI, createIssue, dateDaysAgo, jstDate, requireJsonSecret } from "./common.mjs";

const credentials = requireJsonSecret("GOOGLE_SERVICE_ACCOUNT_JSON");
const propertyId = process.env.GA4_PROPERTY_ID;

if (!propertyId) {
  throw new Error("GA4_PROPERTY_ID がありません。GitHub VariablesにGA4_PROPERTY_IDを登録してください。");
}

const client = new BetaAnalyticsDataClient({ credentials });

const [report] = await client.runReport({
  property: `properties/${propertyId}`,
  dateRanges: [{ startDate: dateDaysAgo(28), endDate: dateDaysAgo(1) }],
  dimensions: [{ name: "pagePath" }, { name: "pageTitle" }],
  metrics: [
    { name: "screenPageViews" },
    { name: "activeUsers" },
    { name: "engagementRate" },
    { name: "averageSessionDuration" },
  ],
  limit: 25,
});

const rows = (report.rows || []).map(r => ({
  pagePath: r.dimensionValues?.[0]?.value,
  pageTitle: r.dimensionValues?.[1]?.value,
  views: r.metricValues?.[0]?.value,
  activeUsers: r.metricValues?.[1]?.value,
  engagementRate: r.metricValues?.[2]?.value,
  avgSessionDuration: r.metricValues?.[3]?.value,
}));

const prompt = `
GA4の実データから、sho eigoのサイト改善Issueを作ってください。

# GA4 Property
${propertyId}

# 上位ページ
${JSON.stringify(rows, null, 2)}

出力:
- 重要サマリー
- 人気ページの仮説
- 離脱/改善が必要そうなページ仮説
- CTA改善案
- 無料体験導線改善
- 英検無料模試導線改善
- 今週直すTOP5
- A/Bテスト案
`;

const body = await callOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  model: process.env.OPENAI_MODEL || "gpt-5.4-mini",
  prompt,
});

const issue = await createIssue(`Sho GA4 Report: ${jstDate()}`, body);
console.log(issue.html_url);
