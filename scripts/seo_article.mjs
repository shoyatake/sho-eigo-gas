#!/usr/bin/env node
// ============================================================
// sho eigo - SEO 記事生成 cron (毎週金曜 10:00 JST)
// ============================================================
//
// 役割:
//   - 過去 7 日の CLICK_LOG / FEEDBACK_LOG を Sheets API で集計
//   - Anthropic Claude Sonnet 4.6 で SEO 寄りの「英語の音」記事を 1 本生成
//   - pages/articles/YYYY-MM-DD-{slug}.html として書き出し
//   - pages/articles/index.html (一覧) を更新
//   - GitHub Actions の自動コミットで main にマージ → 既存 deploy.yml が FTP 同期
//
// 必要な環境変数 (GitHub Actions secrets):
//   ANTHROPIC_API_KEY
//   GOOGLE_SA_JSON
//   GOOGLE_SS_ID
// (LINE 通知などは不要)
//
// 実行:
//   node scripts/seo_article.mjs
//   node scripts/seo_article.mjs --dry-run    (ファイル書き出しのみ skip)
// ============================================================

import { google } from 'googleapis';
import Anthropic from '@anthropic-ai/sdk';
import fs from 'node:fs';
import path from 'node:path';

const DRY_RUN = process.argv.includes('--dry-run');
const ARTICLE_DIR = path.resolve('pages/articles');
const INDEX_PATH = path.join(ARTICLE_DIR, 'index.html');

const required = (name) => {
  const v = process.env[name];
  if (!v) { console.error(`[seo_article] missing env: ${name}`); process.exit(1); }
  return v;
};

const ANTHROPIC_API_KEY = required('ANTHROPIC_API_KEY');
const SA_JSON = required('GOOGLE_SA_JSON');
const SS_ID = required('GOOGLE_SS_ID');

async function fetchSignals() {
  const credentials = JSON.parse(SA_JSON);
  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const since = Date.now() - 7 * 24 * 60 * 60 * 1000;

  let topUrls = [];
  try {
    const r = await sheets.spreadsheets.values.get({ spreadsheetId: SS_ID, range: 'CLICK_LOG!A:D' });
    const rows = (r.data.values || []).slice(1);
    const counts = {};
    for (const row of rows) {
      if (!row[3] || !row[2]) continue;
      if (new Date(row[3]).getTime() < since) continue;
      counts[row[2]] = (counts[row[2]] || 0) + 1;
    }
    topUrls = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  } catch (e) { console.warn('[seo_article] CLICK_LOG warn:', e.message); }

  let feedback = [];
  try {
    const r = await sheets.spreadsheets.values.get({ spreadsheetId: SS_ID, range: 'FEEDBACK_LOG!A:D' });
    const rows = (r.data.values || []).slice(1);
    feedback = rows.filter(row => row[3] && new Date(row[3]).getTime() >= since)
                   .map(row => ({ type: row[1], content: row[2] }));
  } catch (e) { console.warn('[seo_article] FEEDBACK_LOG warn:', e.message); }

  return { topUrls, feedback };
}

async function generateArticle({ topUrls, feedback }) {
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const fbBrief = feedback.length === 0 ? '(無し)' :
    feedback.slice(0, 8).map(f => `[${f.type}] ${(f.content || '').slice(0, 150)}`).join('\n');
  const linkBrief = topUrls.length === 0 ? '(無し)' : topUrls.map(([u, c]) => `${c} clicks: ${u}`).join('\n');

  const userPrompt = `
sho eigo は「英語の音」を整える 2 日無料体験 + 月額 Pro の英語学習サービスです。
SEO 記事を 1 本書いてください。読者は「リスニングが伸びない社会人/受験生/保護者」のいずれか。
直近 7 日のサイト動向を踏まえて、最も需要がありそうな切り口を選んでください。

=== 直近 7 日のクリックトップ ===
${linkBrief}

=== 直近 7 日のフィードバック (抜粋) ===
${fbBrief}

=== 出力形式 (JSON のみ。コメント/前置き不要) ===
{
  "slug": "...kebab-case の英数字 30 文字以内...",
  "title": "...日本語タイトル 35 文字以内、SEO を意識...",
  "description": "...meta description 120 文字以内...",
  "audience": "...社会人 / 受験生 / 保護者 のいずれか...",
  "html_body": "...本文 HTML。<h2>2-3 個 + <p>。最低 800 字、最大 1500 字。<a href='/lp/'>2 日体験</a> への内部リンクを 1 つ含める..."
}
`.trim();

  const resp = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 3000,
    system: 'あなたは英語学習サービス "sho eigo" の SEO 編集者です。日本語で、読みやすい文体で、押し売りせず気づきを与える記事を書きます。',
    messages: [{ role: 'user', content: userPrompt }],
  });
  const text = resp.content?.[0]?.text || '';
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('Claude response not JSON: ' + text.slice(0, 200));
  return JSON.parse(m[0]);
}

function renderArticleHtml({ slug, title, description, audience, html_body, dateStr }) {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} | sho eigo</title>
<meta name="description" content="${escapeHtml(description)}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<link rel="stylesheet" href="/assets/style.css">
</head>
<body>
<header class="site">
  <a href="/" class="brand">sho eigo</a>
  <nav>
    <a href="/">ホーム</a>
    <a href="/lp/">体験</a>
    <a href="/articles/">記事一覧</a>
  </nav>
</header>
<main class="container">
  <p class="muted small">${dateStr} / ${escapeHtml(audience)}向け</p>
  <h1>${escapeHtml(title)}</h1>
  ${html_body}
  <div class="cta-area" style="margin-top:48px;">
    <a href="/lp/" class="btn accent">2 日間 無料体験</a>
    <p class="muted small" style="margin-top:12px;">「water は実は『ワラ』」を体験で確かめてみてください。</p>
  </div>
</main>
<footer class="site">
  © sho eigo
  <div style="margin-top:6px;"><a href="/">ホーム</a> <a href="/articles/">記事一覧</a> <a href="/products/">コース</a></div>
</footer>
</body>
</html>
`;
}

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function rebuildIndex() {
  const files = fs.readdirSync(ARTICLE_DIR).filter(f => f.endsWith('.html') && f !== 'index.html').sort().reverse();
  const items = files.slice(0, 50).map(f => {
    const m = f.match(/^(\d{4}-\d{2}-\d{2})-(.+)\.html$/);
    if (!m) return '';
    return `  <li><a href="/articles/${f}">${m[1]} — ${m[2].replace(/-/g, ' ')}</a></li>`;
  }).join('\n');
  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>記事一覧 | sho eigo</title>
<meta name="description" content="sho eigo の英語の音に関する記事一覧。週次更新。">
<link rel="stylesheet" href="/assets/style.css">
</head>
<body>
<header class="site"><a href="/" class="brand">sho eigo</a></header>
<main class="container">
  <h1>記事一覧</h1>
  <ul class="list-plain">
${items}
  </ul>
  <div class="cta-area" style="margin-top:48px;"><a href="/lp/" class="btn accent">2 日間 無料体験</a></div>
</main>
<footer class="site">© sho eigo</footer>
</body>
</html>
`;
  fs.writeFileSync(INDEX_PATH, html);
}

async function main() {
  console.log('[seo_article] start' + (DRY_RUN ? ' (dry-run)' : ''));
  if (!fs.existsSync(ARTICLE_DIR)) fs.mkdirSync(ARTICLE_DIR, { recursive: true });

  const signals = await fetchSignals();
  console.log('[seo_article] signals: topUrls=' + signals.topUrls.length + ' feedback=' + signals.feedback.length);

  const article = await generateArticle(signals);
  if (!article.slug || !article.title || !article.html_body) throw new Error('article incomplete');
  const dateStr = new Date().toISOString().slice(0, 10);
  const safeSlug = String(article.slug).replace(/[^a-z0-9-]/gi, '-').slice(0, 30);
  const filename = `${dateStr}-${safeSlug}.html`;
  const target = path.join(ARTICLE_DIR, filename);

  const html = renderArticleHtml({ ...article, dateStr });
  if (DRY_RUN) {
    console.log('[seo_article] DRY_RUN: would write ' + target + ' (' + html.length + ' bytes)');
    return;
  }
  fs.writeFileSync(target, html);
  console.log('[seo_article] wrote ' + target);
  rebuildIndex();
  console.log('[seo_article] index updated');
}

main().catch((e) => { console.error('[seo_article] fatal:', e.message); process.exit(1); });
