#!/usr/bin/env node
/**
 * 既存 Apps Script プロジェクトに対する再 push + 再 deploy。
 *   - /root/.sprint_c1_token.json から refresh_token を読み、access_token を更新
 *   - /root/.sprint_c1_project.json と /root/.sprint_c1_deployment.json から ID を取得
 *   - Init.gs.txt 内の placeholder を /root/.line_creds 値で置換して push
 *   - 新しい version を作成 → 既存 deployment を新 version に紐付け（URL 不変）
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const CLIENT_ID = '1072944905499-vm2v2i5dvn0a0d2o4ca36i1vge8cvbn0.apps.googleusercontent.com';
const CLIENT_SECRET = 'v6V3fKV_zWU7iw1DrpO1rknX';
const SOURCE_DIR = '/root/sprint_c1';

function loadCreds() {
  const txt = fs.readFileSync('/root/.line_creds', 'utf8');
  const out = {};
  txt.split('\n').forEach((line) => {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  });
  return out;
}

function request(host, options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: host, ...options }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(data)); } catch { resolve(data); }
        } else reject(new Error(`HTTP ${res.statusCode}: ${data}`));
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function refreshAccessToken(refreshToken) {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  }).toString();
  return request('oauth2.googleapis.com', {
    path: '/token',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(params),
    },
  }, params);
}

function authedReq(token, host, method, path, body) {
  return request(host, {
    path, method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  }, body);
}

function readGasFiles(creds) {
  const order = ['Code', 'Sheets', 'JWT', 'Auth', 'LINELogin', 'Bootstrap', 'Init'];
  const files = order.map((name) => {
    let src = fs.readFileSync(path.join(SOURCE_DIR, `${name}.gs.txt`), 'utf8');
    if (name === 'Init') {
      src = src
        .replace('__SPREADSHEET_ID__', creds.SPREADSHEET_ID)
        .replace('__JWT_SECRET__', creds.JWT_SECRET)
        .replace('__LINE_CHANNEL_SECRET__', creds.LINE_CHANNEL_SECRET)
        .replace('__TEST_EMAIL__', creds.TEST_EMAIL);
    }
    return { name, type: 'SERVER_JS', source: src };
  });
  files.unshift({
    name: 'appsscript',
    type: 'JSON',
    source: JSON.stringify({
      timeZone: 'Asia/Tokyo',
      dependencies: {},
      exceptionLogging: 'STACKDRIVER',
      runtimeVersion: 'V8',
      webapp: { executeAs: 'USER_DEPLOYING', access: 'ANYONE_ANONYMOUS' },
    }, null, 2),
  });
  return files;
}

(async () => {
  const tokenStore = JSON.parse(fs.readFileSync('/root/.sprint_c1_token.json', 'utf8'));
  const project = JSON.parse(fs.readFileSync('/root/.sprint_c1_project.json', 'utf8'));
  const deployment = JSON.parse(fs.readFileSync('/root/.sprint_c1_deployment.json', 'utf8'));
  const creds = loadCreds();

  console.log('==== 1. refresh access_token ====');
  const fresh = await refreshAccessToken(tokenStore.refresh_token);
  const accessToken = fresh.access_token;
  console.log('new access_token: ' + accessToken.slice(0, 20) + '…');

  console.log('\n==== 2. push updated content ====');
  const files = readGasFiles(creds);
  console.log('files: ' + files.map((f) => f.name).join(', '));
  const pushRes = await authedReq(accessToken, 'script.googleapis.com', 'PUT',
    `/v1/projects/${project.scriptId}/content`, { files });
  console.log('pushed: ' + pushRes.files.length);

  console.log('\n==== 3. create new version ====');
  const ver = await authedReq(accessToken, 'script.googleapis.com', 'POST',
    `/v1/projects/${project.scriptId}/versions`, { description: 'Sprint C1 v2 (auto-init + selftest)' });
  console.log('version: ' + ver.versionNumber);

  console.log('\n==== 4. update existing deployment to new version ====');
  const upd = await authedReq(accessToken, 'script.googleapis.com', 'PUT',
    `/v1/projects/${project.scriptId}/deployments/${deployment.deploymentId}`, {
      deploymentConfig: {
        scriptId: project.scriptId,
        versionNumber: ver.versionNumber,
        manifestFileName: 'appsscript',
        description: 'Sprint C1 v2 (auto-init + selftest)',
      },
    });
  const webEntry = (upd.entryPoints || []).find((e) => e.entryPointType === 'WEB_APP');
  const url = webEntry && webEntry.webApp && webEntry.webApp.url;

  console.log('\n==== DONE ====');
  console.log('SCRIPT_ID=' + project.scriptId);
  console.log('WEBAPP_URL=' + url);
  console.log('INIT_URL=' + url + '?action=selftest  (1 click triggers auto-init then selftest)');
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
