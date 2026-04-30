// Local mock harness for the SC-DELETION flow.
// Runs line_bot.js inside a vm context with stubbed GAS globals.
// Run: node test/test_deletion_flow.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const HEADERS = {
  USERS: ['userId','displayName','scenarioId','stepNumber','stepSentAt','registeredAt'],
  TAGS: ['userId','tag','addedAt'],
  CLICK_LOG: ['userId','tag','url','clickedAt'],
  SURVEY_LOG: ['userId','answer','scenarioMoved','answeredAt'],
  DELETION_LOG: ['userId','deletedAt'],
};

function makeSheet(name, header) {
  const rows = [header.slice()];
  return {
    name,
    rows,
    appendRow(r) { rows.push(r.slice()); },
    getDataRange() { return { getValues: () => rows.map(r => r.slice()) }; },
    getLastRow() { return rows.length; },
    getRange(row, col, _h, w) {
      const r = row - 1, c = col - 1;
      return {
        setValue(v) { rows[r][c] = v; },
        setBackground() { return this; },
        setFontColor() { return this; },
        setFontWeight() { return this; },
      };
    },
    deleteRow(rowIndex) { rows.splice(rowIndex - 1, 1); },
  };
}

function makeSpreadsheet() {
  const sheets = {};
  for (const k of Object.keys(HEADERS)) sheets[k] = makeSheet(k, HEADERS[k]);
  return {
    getSheetByName: (n) => sheets[n] || null,
    insertSheet: (n) => (sheets[n] = makeSheet(n, HEADERS[n] || ['col1'])),
    _sheets: sheets,
  };
}

const ss = makeSpreadsheet();

const fetchCalls = [];
const UrlFetchApp = {
  fetch(url, opts) {
    fetchCalls.push({ url, opts });
    return { getContentText: () => '{}' };
  },
};

const SpreadsheetApp = {
  openById: () => ss,
};

const Utilities = { sleep: () => {} };
const Logger = { log: () => {} };
const ScriptApp = {
  getProjectTriggers: () => [],
  newTrigger: () => ({ timeBased: () => ({ everyHours: () => ({ create: () => {} }) }) }),
  deleteTrigger: () => {},
};
const ContentService = {
  MimeType: { JSON: 'application/json' },
  createTextOutput: (s) => ({ setMimeType: () => ({ _body: s }) }),
};
const HtmlService = {
  createHtmlOutput: (s) => ({ _html: s }),
};

const sandbox = {
  CONFIG: undefined,
  SpreadsheetApp, UrlFetchApp, Utilities, Logger, ScriptApp,
  ContentService, HtmlService,
  console,
};
vm.createContext(sandbox);

const code = fs.readFileSync(path.join(__dirname, '..', 'line_bot.js'), 'utf8');
vm.runInContext(code, sandbox);

// Bootstrap sheets
sandbox.setupSheets();

const TEST_UID = 'U_TEST_DELETION';

function reset() {
  for (const k of Object.keys(HEADERS)) {
    ss._sheets[k].rows.length = 0;
    ss._sheets[k].rows.push(HEADERS[k].slice());
  }
  fetchCalls.length = 0;
}

function rowsByUser(sheetName, uid) {
  return ss._sheets[sheetName].rows.slice(1).filter(r => r[0] === uid);
}

function pushFetchCount() {
  return fetchCalls.filter(c => c.url.endsWith('/push')).length;
}

let passed = 0, failed = 0;
function test(name, fn) {
  reset();
  try { fn(); passed++; console.log('  PASS  ' + name); }
  catch (e) { failed++; console.log('  FAIL  ' + name + '\n        ' + e.message); }
}

console.log('SC-DELETION flow test suite\n');

test('checkEngagement escalates SC-DORMANT user (31d, no read tags) to SC-DELETION step 0', () => {
  const now = new Date();
  const stepSentAt = new Date(now.getTime() - 31 * 86400000);
  const registeredAt = new Date(now.getTime() - 90 * 86400000);
  ss._sheets.USERS.appendRow([TEST_UID, 'tester', 'SC-DORMANT', 1, stepSentAt, registeredAt]);
  ss._sheets.TAGS.appendRow([TEST_UID, 'dormant', new Date()]);

  sandbox.checkEngagement();

  const u = rowsByUser('USERS', TEST_UID)[0];
  assert.strictEqual(u[2], 'SC-DELETION', 'scenarioId should escalate');
  assert.strictEqual(u[3], 0, 'stepNumber should reset to 0');
});

test('checkEngagement does NOT escalate purchased user', () => {
  const now = new Date();
  const stepSentAt = new Date(now.getTime() - 60 * 86400000);
  ss._sheets.USERS.appendRow([TEST_UID, 'tester', 'SC-DORMANT', 1, stepSentAt, stepSentAt]);
  ss._sheets.TAGS.appendRow([TEST_UID, 'dormant', new Date()]);
  ss._sheets.TAGS.appendRow([TEST_UID, 'purchased', new Date()]);

  sandbox.checkEngagement();
  const u = rowsByUser('USERS', TEST_UID)[0];
  assert.strictEqual(u[2], 'SC-DORMANT', 'purchased user must stay');
});

test('checkEngagement does NOT escalate user with read_* tag', () => {
  const now = new Date();
  const stepSentAt = new Date(now.getTime() - 60 * 86400000);
  ss._sheets.USERS.appendRow([TEST_UID, 'tester', 'SC-DORMANT', 1, stepSentAt, stepSentAt]);
  ss._sheets.TAGS.appendRow([TEST_UID, 'read_s2', new Date()]);

  sandbox.checkEngagement();
  const u = rowsByUser('USERS', TEST_UID)[0];
  assert.strictEqual(u[2], 'SC-DORMANT');
});

test('checkAndSendScheduled at step 0 sends T-30 message + keep-account button, advances step', () => {
  const past = new Date(Date.now() - 1000); // delayDays:0 so any past time is due
  ss._sheets.USERS.appendRow([TEST_UID, 'tester', 'SC-DELETION', 0, past, past]);

  sandbox.checkAndSendScheduled();

  assert.strictEqual(pushFetchCount(), 2, 'expected 2 push calls (text + keep button)');
  const textPayload = JSON.parse(fetchCalls[0].opts.payload);
  assert.ok(textPayload.messages[0].text.includes('30日後'), 'first push should mention 30日後');
  const buttonPayload = JSON.parse(fetchCalls[1].opts.payload);
  assert.strictEqual(buttonPayload.messages[0].template.actions[0].data, 'keep_account');

  const u = rowsByUser('USERS', TEST_UID)[0];
  assert.strictEqual(u[3], 1, 'step should advance to 1');
});

test('handlePostback keep_account reactivates user, restores SC-MAIN 0 + resubscribed tag', () => {
  ss._sheets.USERS.appendRow([TEST_UID, 'tester', 'SC-DELETION', 2, new Date(), new Date()]);
  ss._sheets.TAGS.appendRow([TEST_UID, 'dormant', new Date()]);
  ss._sheets.TAGS.appendRow([TEST_UID, 'low_engagement', new Date()]);

  sandbox.handlePostback({
    source: { userId: TEST_UID },
    postback: { data: 'keep_account' },
    replyToken: 'rt_dummy',
  });

  const u = rowsByUser('USERS', TEST_UID)[0];
  assert.strictEqual(u[2], 'SC-MAIN');
  assert.strictEqual(u[3], 0);
  assert.ok(rowsByUser('TAGS', TEST_UID).some(r => r[1] === 'resubscribed'));
  assert.ok(!rowsByUser('TAGS', TEST_UID).some(r => r[1] === 'dormant'));
  assert.ok(!rowsByUser('TAGS', TEST_UID).some(r => r[1] === 'low_engagement'));
});

test('handleMessage during SC-DELETION reactivates user (any text reply)', () => {
  ss._sheets.USERS.appendRow([TEST_UID, 'tester', 'SC-DELETION', 1, new Date(), new Date()]);

  sandbox.handleMessage({
    source: { userId: TEST_UID },
    message: { text: 'やっぱり続けます' },
    replyToken: 'rt_dummy',
  });

  const u = rowsByUser('USERS', TEST_UID)[0];
  assert.strictEqual(u[2], 'SC-MAIN');
  assert.strictEqual(u[3], 0);
});

test('checkAndSendScheduled at step 3 executes deletion (USERS+TAGS rows removed, DELETION_LOG appended)', () => {
  const past = new Date(Date.now() - 5 * 86400000); // beyond delayDays:3 + sendHour:8
  ss._sheets.USERS.appendRow([TEST_UID, 'tester', 'SC-DELETION', 3, past, past]);
  ss._sheets.TAGS.appendRow([TEST_UID, 'dormant', new Date()]);
  ss._sheets.TAGS.appendRow([TEST_UID, 'src_line', new Date()]);

  sandbox.checkAndSendScheduled();

  assert.strictEqual(rowsByUser('USERS', TEST_UID).length, 0, 'USERS row removed');
  assert.strictEqual(rowsByUser('TAGS', TEST_UID).length, 0, 'all TAGS removed');
  const log = ss._sheets.DELETION_LOG.rows.slice(1);
  assert.strictEqual(log.length, 1, 'DELETION_LOG appended');
  assert.strictEqual(log[0][0], TEST_UID);
});

test('full lifecycle: dormant 31d -> escalate -> step0 send -> keep_account -> back to SC-MAIN', () => {
  const now = new Date();
  const stepSentAt = new Date(now.getTime() - 31 * 86400000);
  ss._sheets.USERS.appendRow([TEST_UID, 'tester', 'SC-DORMANT', 1, stepSentAt, stepSentAt]);
  ss._sheets.TAGS.appendRow([TEST_UID, 'dormant', new Date()]);

  sandbox.checkEngagement();
  let u = rowsByUser('USERS', TEST_UID)[0];
  assert.strictEqual(u[2], 'SC-DELETION');

  // Force step due
  ss._sheets.USERS.rows[1][4] = new Date(Date.now() - 1000);
  sandbox.checkAndSendScheduled();
  assert.strictEqual(pushFetchCount(), 2);

  sandbox.handlePostback({
    source: { userId: TEST_UID },
    postback: { data: 'keep_account' },
    replyToken: 'rt_dummy',
  });
  u = rowsByUser('USERS', TEST_UID)[0];
  assert.strictEqual(u[2], 'SC-MAIN');
  assert.ok(rowsByUser('TAGS', TEST_UID).some(r => r[1] === 'resubscribed'));
});

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
