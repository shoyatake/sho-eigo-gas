#!/usr/bin/env node
// ============================================================
// sho eigo - SNS 投稿提案 cron (毎週月曜 10:00 JST)
// ============================================================
//
// 役割:
//   - 直近 7 日の FEEDBACK_LOG / CLICK_LOG を Sheets API で読み取り
//   - Anthropic Claude Sonnet 4.6 で X / Instagram 用ドラフトを 3 案生成
//   - Notion DB SNS_DRAFTS に append
//   - 運営者の LINE に通知
//
// 必要な環境変数 (GitHub Actions secrets で渡す):
//   ANTHROPIC_API_KEY           : Claude API key
//   GOOGLE_SA_JSON              : Service Account の JSON (Sheets 読み取り権限付き)
//   GOOGLE_SS_ID                : Spreadsheet ID
//   NOTION_TOKEN                : Notion integration secret
//   NOTION_DB_ID                : SNS_DRAFTS データベース ID
//   LINE_CHANNEL_ACCESS_TOKEN   : LINE Bot のアクセストークン
//   OWNER_LINE_USER_ID          : 通知先の LINE userId
//
// 実行:
//   node scripts/sns_proposal.mjs
//   node scripts/sns_proposal.mjs --dry-run   (Notion / LINE への書き込みを skip)
// ============================================================

import { google } from 'googleapis';
import Anthropic from '@anthropic-ai/sdk';

const DRY_RUN = process.argv.includes('--dry-run');

const required = (name) => {
  const v = process.env[name];
  if (!v) {
    console.error(`[sns_proposal] missing env: ${name}`);
    process.exit(1);
  }
  return v;
};

const ANTHROPIC_API_KEY = required('ANTHROPIC_API_KEY');
const SS_ID             = required('GOOGLE_SS_ID');
const SA_JSON           = required('GOOGLE_SA_JSON');
const NOTION_TOKEN      = DRY_RUN ? process.env.NOTION_TOKEN || '' : required('NOTION_TOKEN');
const NOTION_DB_ID      = DRY_RUN ? process.env.NOTION_DB_ID || '' : required('NOTION_DB_ID');
const LINE_TOKEN        = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
const OWNER_UID         = process.env.OWNER_LINE_USER_ID || '';

// ----------------------------------------
// 1. Sheets から直近 7 日のデータ取得
// ----------------------------------------
async function fetchRecentSignals() {
  const credentials = JSON.parse(SA_JSON);
  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  const since = Date.now() - 7 * 24 * 60 * 60 * 1000;

  // FEEDBACK_LOG 取得
  let feedback = [];
  try {
    const r = await sheets.spreadsheets.values.get({
      spreadsheetId: SS_ID,
      range: 'FEEDBACK_LOG!A:D',
    });
    const rows = (r.data.values || []).slice(1);  // skip header
    feedback = rows
      .filter(row => row[3] && new Date(row[3]).getTime() >= since)
      .map(row => ({ type: row[1], content: row[2], at: row[3] }));
  } catch (e) {
    console.warn('[sns_proposal] FEEDBACK_LOG fetch warn:', e.message);
  }

  // CLICK_LOG 取得 → URL 別に集計
  let urlCounts = {};
  try {
    const r = await sheets.spreadsheets.values.get({
      spreadsheetId: SS_ID,
      range: 'CLICK_LOG!A:D',
    });
    const rows = (r.data.values || []).slice(1);
    for (const row of rows) {
      const at = row[3];
      const url = row[2];
      if (!url || !at) continue;
      if (new Date(at).getTime() < since) continue;
      urlCounts[url] = (urlCounts[url] || 0) + 1;
    }
  } catch (e) {
    console.warn('[sns_proposal] CLICK_LOG fetch warn:', e.message);
  }
  const topUrls = Object.entries(urlCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([url, count]) => ({ url, count }));

  return { feedback, topUrls };
}

// ----------------------------------------
// 2. Claude で 3 案生成
// ----------------------------------------
async function generateDrafts({ feedback, topUrls }) {
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  const feedbackBrief = feedback.length === 0
    ? '(過去 7 日のフィードバック無し)'
    : feedback.slice(0, 10).map(f => `[${f.type}] ${(f.content || '').slice(0, 200)}`).join('\n');

  const linksBrief = topUrls.length === 0
    ? '(クリックログ無し)'
    : topUrls.map(u => `${u.count} clicks: ${u.url}`).join('\n');

  const userPrompt = `
sho eigo は「英語の音」を整える 2 日無料体験 + 月額 Pro の英語学習サービスです。
直近 7 日のユーザー動向を元に、来週前半に投稿する SNS ドラフトを 3 案、X 用と Instagram 用で書いてください。

=== 直近 7 日のフィードバック ===
${feedbackBrief}

=== 直近 7 日のクリックトップ ===
${linksBrief}

=== 出力形式 (JSON のみ。前置き・コメント不要) ===
{
  "drafts": [
    {
      "theme": "...短いテーマ名...",
      "x_post": "...140 字以内...",
      "instagram_caption": "...5 行以内 + ハッシュタグ...",
      "rationale": "...80 字以内、なぜこの切り口か..."
    },
    ... (合計 3 案)
  ]
}
`.trim();

  const resp = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1500,
    system: 'あなたは英語学習サービス "sho eigo" の SNS 編集者です。日本語で、押し売りせず気づきを与える投稿を作ります。',
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = resp.content?.[0]?.text || '';
  // JSON 抽出 (前後に文字列が混じる可能性に対応)
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('Claude response not JSON: ' + text.slice(0, 200));
  return JSON.parse(m[0]);
}

// ----------------------------------------
// 3. Notion に append
// ----------------------------------------
async function appendToNotion(drafts) {
  if (DRY_RUN) {
    console.log('[sns_proposal] DRY_RUN: would append', drafts.length, 'drafts to Notion');
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  for (const d of drafts) {
    const body = {
      parent: { database_id: NOTION_DB_ID },
      properties: {
        Name:     { title:     [{ text: { content: `${today} ${d.theme || 'untitled'}` } }] },
        Theme:    { rich_text: [{ text: { content: d.theme || '' } }] },
        X:        { rich_text: [{ text: { content: (d.x_post || '').slice(0, 2000) } }] },
        Instagram:{ rich_text: [{ text: { content: (d.instagram_caption || '').slice(0, 2000) } }] },
        Rationale:{ rich_text: [{ text: { content: (d.rationale || '').slice(0, 2000) } }] },
        Status:   { select: { name: 'draft' } },
      },
    };
    const resp = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + NOTION_TOKEN,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const t = await resp.text();
      throw new Error('Notion append failed: ' + resp.status + ' ' + t.slice(0, 300));
    }
  }
}

// ----------------------------------------
// 4. LINE 通知
// ----------------------------------------
async function notifyLine(drafts) {
  if (!LINE_TOKEN || !OWNER_UID) {
    console.log('[sns_proposal] LINE notify skipped (missing token/uid)');
    return;
  }
  if (DRY_RUN) {
    console.log('[sns_proposal] DRY_RUN: would notify LINE');
    return;
  }
  const summary = `[SNS 提案] ${drafts.length} 案を Notion に投入しました。\n\n` +
    drafts.map((d, i) => `${i + 1}. ${d.theme || '?'}`).join('\n') +
    `\n\nNotion で確認 → 公開判断してください。`;
  const resp = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + LINE_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      to: OWNER_UID,
      messages: [{ type: 'text', text: summary }],
    }),
  });
  if (!resp.ok) {
    console.warn('[sns_proposal] LINE notify failed:', resp.status, await resp.text());
  }
}

// ----------------------------------------
// main
// ----------------------------------------
async function main() {
  console.log('[sns_proposal] start' + (DRY_RUN ? ' (dry-run)' : ''));
  const signals = await fetchRecentSignals();
  console.log('[sns_proposal] signals:', { feedback: signals.feedback.length, topUrls: signals.topUrls.length });

  const result = await generateDrafts(signals);
  if (!result.drafts || !Array.isArray(result.drafts) || result.drafts.length === 0) {
    throw new Error('drafts not generated');
  }
  console.log('[sns_proposal] drafts:', result.drafts.length);

  await appendToNotion(result.drafts);
  await notifyLine(result.drafts);
  console.log('[sns_proposal] done');
}

main().catch((e) => {
  console.error('[sns_proposal] fatal:', e.message);
  process.exit(1);
});
