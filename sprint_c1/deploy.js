#!/usr/bin/env node
/**
 * Sprint C1 自動デプロイ：OAuth code → token → create project → push → deploy
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const CLIENT_ID = '1072944905499-vm2v2i5dvn0a0d2o4ca36i1vge8cvbn0.apps.googleusercontent.com';
const CLIENT_SECRET = 'v6V3fKV_zWU7iw1DrpO1rknX';
const REDIRECT_URI = 'http://localhost:8888';

const CODE = process.env.OAUTH_CODE;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SOURCE_DIR = process.env.SOURCE_DIR || '/root/sprint_c1';

if (!CODE) throw new Error('OAUTH_CODE 未設定');
if (!SPREADSHEET_ID) throw new Error('SPREADSHEET_ID 未設定');

function request(host, options, body) {
  return new Promise((resolve, reject) => {
    const opts = { hostname: host, ...options };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(data)); } catch { resolve(data); }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function exchangeCode() {
  const params = new URLSearchParams({
    code: CODE,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
    grant_type: 'authorization_code',
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
    path,
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  }, body);
}

async function createProject(token) {
  return authedReq(token, 'script.googleapis.com', 'POST', '/v1/projects', {
    title: 'sho-eigo-gas Sprint C1',
    parentId: SPREADSHEET_ID,
  });
}

function readGasFiles() {
  // 順序重要: Code, Sheets, JWT, Auth, LINELogin, Bootstrap
  const order = ['Code', 'Sheets', 'JWT', 'Auth', 'LINELogin', 'Bootstrap'];
  const files = order.map((name) => ({
    name: name,
    type: 'SERVER_JS',
    source: fs.readFileSync(path.join(SOURCE_DIR, `${name}.gs.txt`), 'utf8'),
  }));
  // appsscript.json マニフェスト
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

async function pushFiles(token, scriptId, files) {
  return authedReq(token, 'script.googleapis.com', 'PUT', `/v1/projects/${scriptId}/content`, { files });
}

async function createVersion(token, scriptId) {
  return authedReq(token, 'script.googleapis.com', 'POST', `/v1/projects/${scriptId}/versions`, {
    description: 'Sprint C1 v1',
  });
}

async function createDeployment(token, scriptId, versionNumber) {
  return authedReq(token, 'script.googleapis.com', 'POST', `/v1/projects/${scriptId}/deployments`, {
    versionNumber,
    manifestFileName: 'appsscript',
    description: 'Sprint C1 v1 (web app)',
  });
}

(async () => {
  console.log('==== 1. code → tokens ====');
  const tok = await exchangeCode();
  console.log('access_token: ' + tok.access_token.slice(0, 20) + '…');
  console.log('refresh_token: ' + (tok.refresh_token ? '取得済' : 'なし'));
  console.log('scope: ' + tok.scope);

  // Save tokens for later reuse
  fs.writeFileSync('/root/.sprint_c1_token.json', JSON.stringify(tok, null, 2));

  console.log('\n==== 2. create Apps Script project ====');
  const project = await createProject(tok.access_token);
  console.log('scriptId: ' + project.scriptId);
  console.log('title: ' + project.title);
  fs.writeFileSync('/root/.sprint_c1_project.json', JSON.stringify(project, null, 2));

  console.log('\n==== 3. push files ====');
  const files = readGasFiles();
  console.log('files: ' + files.map((f) => f.name).join(', '));
  const pushRes = await pushFiles(tok.access_token, project.scriptId, files);
  console.log('pushed files: ' + pushRes.files.length);

  console.log('\n==== 4. create version ====');
  const ver = await createVersion(tok.access_token, project.scriptId);
  console.log('version: ' + ver.versionNumber);

  console.log('\n==== 5. create web app deployment ====');
  const dep = await createDeployment(tok.access_token, project.scriptId, ver.versionNumber);
  console.log('deploymentId: ' + dep.deploymentId);
  const webEntry = (dep.entryPoints || []).find((e) => e.entryPointType === 'WEB_APP');
  const webUrl = webEntry && webEntry.webApp && webEntry.webApp.url;
  console.log('webApp URL: ' + (webUrl || '(not present yet)'));

  fs.writeFileSync('/root/.sprint_c1_deployment.json', JSON.stringify(dep, null, 2));

  console.log('\n==== DONE ====');
  console.log('SCRIPT_ID=' + project.scriptId);
  console.log('WEBAPP_URL=' + (webUrl || ''));
})().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
