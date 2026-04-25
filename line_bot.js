// ============================================================
// sho eigo — LINE自動化システム（GAS完全版）
// ProLine代替 / GAS + Google Sheets + LINE Messaging API
// ============================================================

const CONFIG = {
  LINE_TOKEN: 'YOUR_LINE_CHANNEL_ACCESS_TOKEN',
  SS_ID: 'YOUR_SPREADSHEET_ID',
  GAS_URL: 'YOUR_GAS_DEPLOY_URL',
};

const LINE_API = 'https://api.line.me/v2/bot/message';

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    body.events.forEach(function(event) {
      if (event.type === 'follow')   handleFollow(event);
      if (event.type === 'message')  handleMessage(event);
      if (event.type === 'postback') handlePostback(event);
    });
  } catch(err) {
    Logger.log('doPost Error: ' + err.toString());
  }
  return ContentService
    .createTextOutput(JSON.stringify({status:'ok'}))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  const userId    = e.parameter.uid  || '';
  const tag       = e.parameter.tag  || '';
  const redirectUrl = e.parameter.url || 'https://sho-blog.com/all/trial/trial_day1.html';

  if (userId && tag) {
    addTag(userId, tag);
    logClick(userId, tag, redirectUrl);
  }

  return HtmlService.createHtmlOutput(
    '<script>window.location.replace("' + redirectUrl.replace(/"/g, '&quot;') + '")</script>'
  );
}

function handleFollow(event) {
  const userId = event.source.userId;
  const profile = getLineProfile(userId);
  const displayName = profile ? profile.displayName : 'さん';
  const isNewUser = registerUser(userId, displayName, 'SC-MAIN', 0, new Date());
  addTag(userId, 'src_line');
  if (!isNewUser) return;
  const msg = buildMessage('SC-MAIN', 0, userId);
  if (msg) {
    sendPushMessage(userId, msg);
    updateUserStep(userId, 'SC-MAIN', 1, new Date());
  }
}

function handleMessage(event) {
  const userId = event.source.userId;
  const text   = (event.message && event.message.text) || '';
  const keywords = {
    '体験':  '▼ 2日間無料体験はこちら\nhttps://sho-blog.com/all/trial/trial_day1.html',
    'day1':  '▼ 体験Day 1\nhttps://sho-blog.com/all/trial/trial_day1.html',
    'day2':  '▼ 体験Day 2\nhttps://sho-blog.com/all/trial/trial_day2.html',
    'プラン': '▼ プランの詳細\nhttps://sho-blog.com/all/trial/next_step_day2.html',
  };
  const lowerText = text.toLowerCase();
  for (const key in keywords) {
    if (lowerText.indexOf(key) !== -1) {
      replyMessage(event.replyToken, keywords[key]);
      return;
    }
  }
}

function handlePostback(event) {
  const userId = event.source.userId;
  const data   = event.postback.data || '';
  const surveyMap = {
    'survey_parent':  { tag: 'attr_parent',  scenario: 'SC-PARENT',  reply: 'ありがとうございます！お子さんの英語に役立つ情報をお届けします 📚' },
    'survey_student': { tag: 'attr_student', scenario: 'SC-STUDENT', reply: 'ありがとうございます！英検対策に役立つ情報をお届けします 🎓' },
    'survey_adult':   { tag: 'attr_adult',   scenario: 'SC-ADULT',   reply: 'ありがとうございます！実用英語に役立つ情報をお届けします 🌍' },
  };
  if (surveyMap[data]) {
    const s = surveyMap[data];
    addTag(userId, s.tag);
    moveToScenario(userId, s.scenario, 0);
    logSurvey(userId, data, s.scenario);
    replyMessage(event.replyToken, s.reply);
    return;
  }
  if (data.indexOf('quiz_') === 0) {
    addTag(userId, 'reactivated');
    removeTag(userId, 'dormant');
    removeTag(userId, 'low_engagement');
    moveToScenario(userId, 'SC-MAIN', 3);
    replyMessage(event.replyToken, data === 'quiz_B'
      ? '正解です！Flap Tを知っているんですね。もう少し深い話を続けます 🎵'
      : '惜しい！正解は「ベラ」です。tがラ行に変わる現象、Flap Tといいます 🎵');
  }
}

function checkAndSendScheduled() {
  const ss = SpreadsheetApp.openById(CONFIG.SS_ID);
  const usersSheet = ss.getSheetByName('USERS');
  if (!usersSheet) return;
  const users = usersSheet.getDataRange().getValues();
  const now = new Date();
  for (var i = 1; i < users.length; i++) {
    const row = users[i];
    const userId     = row[0];
    const scenarioId = row[2];
    const stepNum    = parseInt(row[3]) || 0;
    const stepSentAt = row[4] ? new Date(row[4]) : null;
    if (!userId || !scenarioId) continue;
    const step = getScenarioStep(scenarioId, stepNum);
    if (!step) continue;
    if (!isSendDue(stepSentAt, step.delayDays, step.sendHour, now)) continue;
    if (step.skipIfTag && hasTag(userId, step.skipIfTag)) {
      updateUserStep(userId, scenarioId, stepNum + 1, now);
      continue;
    }
    const msg = buildMessage(scenarioId, stepNum, userId);
    if (msg) {
      sendPushMessage(userId, msg);
      updateUserStep(userId, scenarioId, stepNum + 1, now);
    }
    if (step.sendSurvey) { Utilities.sleep(500); sendSurveyButtons(userId); }
    if (step.sendQuiz)   { Utilities.sleep(500); sendQuizButtons(userId); }
    Utilities.sleep(200);
  }
  checkEngagement();
}

function isSendDue(lastSentAt, delayDays, sendHour, now) {
  if (!lastSentAt) return true;
  const target = new Date(lastSentAt);
  target.setDate(target.getDate() + (delayDays || 0));
  target.setHours(sendHour || 8, 0, 0, 0);
  return now >= target;
}

function checkEngagement() {
  const ss = SpreadsheetApp.openById(CONFIG.SS_ID);
  const users = ss.getSheetByName('USERS').getDataRange().getValues();
  const now = new Date();
  for (var i = 1; i < users.length; i++) {
    const userId = users[i][0];
    if (!userId) continue;
    if (hasTag(userId, 'purchased') || hasTag(userId, 'dormant')) continue;
    const registeredAt = users[i][5] ? new Date(users[i][5]) : null;
    if (!registeredAt) continue;
    const daysSince = (now - registeredAt) / (1000 * 60 * 60 * 24);
    if (daysSince >= 30 && !hasAnyReadTag(userId)) {
      addTag(userId, 'dormant');
      moveToScenario(userId, 'SC-DORMANT', 0);
    } else if (daysSince >= 14 && !hasAnyReadTag(userId)) {
      addTag(userId, 'low_engagement');
    }
  }
}

function hasAnyReadTag(userId) {
  var data = SpreadsheetApp.openById(CONFIG.SS_ID).getSheetByName('TAGS').getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] !== userId) continue;
    var tag = data[i][1];
    if (typeof tag !== 'string') continue;
    if (tag === 'trial_click' || tag.indexOf('read_') === 0) return true;
  }
  return false;
}

const SCENARIOS_DATA = {
  'SC-MAIN': [
    { stepNum: 0, delayDays: 0, sendHour: 0, trackingTag: 'read_s0',
      message: 'はじめまして、翔也です。\n\nsho eigoのLINEに\n来てくれてありがとうございます。\n\n最初に一つだけ聞かせてください。\n\n「water」って頭の中でどう聞こえますか？\n\n「ウォーター」と浮かぶなら\nそれが今日の話の出発点です。\n\nwaterの本物の音は「ワラ」です。\n\n▼ 続きを無料体験で\nhttps://sho-blog.com/all/trial/trial_day1.html' },
    { stepNum: 1, delayDays: 1, sendHour: 6, trackingTag: 'read_s1',
      message: 'おはようございます。\n\nDay 2 が今日から始められます。\n\n昨日と同じ文章をもう一度聴いたとき\n「あ、さっきより聴こえる」\nという感覚が来るかもしれません。\n\n▼ Day 2 はこちら\nhttps://sho-blog.com/all/trial/trial_day2.html' },
    { stepNum: 2, delayDays: 2, sendHour: 8, trackingTag: 'read_s2', sendSurvey: true,
      message: '少しだけ教えていただけますか。\n\nあなたのことを知ることで\nお届けする情報をより役立てます。\n\n下のボタンからお答えください。' },
    { stepNum: 3, delayDays: 5, sendHour: 8, trackingTag: 'read_s3',
      message: '声に出してみてください。\n\n「turn it off」\n\nこれ、実は「ターニラフ」と読みます。\n単語がつながって全然別の音になる。\nこれがLinkingという現象です。\n\n▼ 体験で音の違いを確かめる\nhttps://sho-blog.com/all/trial/trial_day1.html' },
  ],
  'SC-PARENT': [
    { stepNum: 0, delayDays: 0, sendHour: 8, trackingTag: 'read_p1',
      message: 'はじめまして、翔也です。\n\n「塾に通わせているのに\nリスニングが伸びない」\n\nそういうお話をよく聞きます。\n\n実はこれ、塾の問題でも\nお子さんの頭の問題でもないんです。\n\n▼ この話の続き\nhttps://sho-blog.com/all/trial/trial_day1.html' },
    { stepNum: 1, delayDays: 3, sendHour: 8, trackingTag: 'read_p2',
      message: 'お子さんの学習、続いているか気になりませんか。\n\nsho eigoの保護者プランには\n毎週日曜日に「学習レポート」が届く仕組みがあります。\n\n▼ 保護者プランについて\nhttps://sho-blog.com/all/trial/next_step_day2.html' },
  ],
  'SC-STUDENT': [
    { stepNum: 0, delayDays: 0, sendHour: 8, trackingTag: 'read_st1',
      message: '英検のリスニングで\n「知ってるはずの単語が聴こえない」\n\nこれ、単語力の問題じゃないんです。\n\n音の設定がずれているだけ。\n音を直せば、知っている単語が聴こえます。\n\n▼ 体験で確認する\nhttps://sho-blog.com/all/trial/trial_day1.html' },
    { stepNum: 1, delayDays: 3, sendHour: 8, trackingTag: 'read_st2',
      message: '音の土台を作った人の\n半年後・1年後の伸び方は変わります。\n\n遠回りに見えて一番近道です。\n\n▼ 体験で音の基礎を確かめる\nhttps://sho-blog.com/all/trial/trial_day1.html' },
  ],
  'SC-ADULT': [
    { stepNum: 0, delayDays: 0, sendHour: 8, trackingTag: 'read_a1',
      message: '1日15〜20分あれば変わります。\n\n通勤の電車の中、昼休みの15分。\n音を体に入れる練習は\n机に向かわなくてもできます。\n\n▼ 20分で体験できます\nhttps://sho-blog.com/all/trial/trial_day1.html' },
    { stepNum: 1, delayDays: 3, sendHour: 8, trackingTag: 'read_a2',
      message: '「ある日、映画の台詞が聴こえた」\n\n音の基礎ができた人がよく言う言葉です。\n\nその日が来るのを楽しみに続けてほしいです。\n\n▼ 体験はこちら\nhttps://sho-blog.com/all/trial/trial_day1.html' },
  ],
  'SC-DORMANT': [
    { stepNum: 0, delayDays: 0, sendHour: 8, trackingTag: null, sendQuiz: true,
      message: '突然ですが、クイズです。\n\n「better」の本物の発音はどちら？' },
    { stepNum: 1, delayDays: 7, sendHour: 8, trackingTag: 'read_dormant',
      message: 'お久しぶりです。\n\n気が向いたときに戻ってきてください。\n\n▼ いつでも体験できます\nhttps://sho-blog.com/all/trial/trial_day1.html' },
  ],
};

function getScenarioStep(scenarioId, stepNum) {
  var scenario = SCENARIOS_DATA[scenarioId];
  if (!scenario) return null;
  for (var i = 0; i < scenario.length; i++) {
    if (scenario[i].stepNum === stepNum) return scenario[i];
  }
  return null;
}

function buildMessage(scenarioId, stepNum, userId) {
  var step = getScenarioStep(scenarioId, stepNum);
  if (!step || !step.message) return null;
  if (step.trackingTag && userId) {
    return wrapTrackingUrls(step.message, userId, step.trackingTag);
  }
  return step.message;
}

function wrapTrackingUrls(message, userId, trackingTag) {
  if (!message || !userId || !trackingTag) return message;
  if (!CONFIG.GAS_URL || CONFIG.GAS_URL.indexOf('http') !== 0) return message;
  return message.replace(/https?:\/\/[^\s]+/g, function(url) {
    return CONFIG.GAS_URL +
      '?uid=' + encodeURIComponent(userId) +
      '&tag=' + encodeURIComponent(trackingTag) +
      '&url=' + encodeURIComponent(url);
  });
}

function registerUser(userId, displayName, scenarioId, stepNum, now) {
  var ss = SpreadsheetApp.openById(CONFIG.SS_ID);
  var sheet = ss.getSheetByName('USERS');
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) { if (data[i][0] === userId) return false; }
  sheet.appendRow([userId, displayName, scenarioId, stepNum, now, now]);
  return true;
}

function updateUserStep(userId, scenarioId, stepNum, sentAt) {
  var ss = SpreadsheetApp.openById(CONFIG.SS_ID);
  var sheet = ss.getSheetByName('USERS');
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === userId) {
      sheet.getRange(i+1, 3).setValue(scenarioId);
      sheet.getRange(i+1, 4).setValue(stepNum);
      sheet.getRange(i+1, 5).setValue(sentAt);
      return;
    }
  }
}

function moveToScenario(userId, scenarioId, stepNum) {
  updateUserStep(userId, scenarioId, stepNum || 0, new Date());
}

function addTag(userId, tag) {
  if (!userId || !tag || hasTag(userId, tag)) return;
  SpreadsheetApp.openById(CONFIG.SS_ID).getSheetByName('TAGS').appendRow([userId, tag, new Date()]);
}

function removeTag(userId, tag) {
  var sheet = SpreadsheetApp.openById(CONFIG.SS_ID).getSheetByName('TAGS');
  var data = sheet.getDataRange().getValues();
  for (var i = data.length - 1; i >= 1; i--) {
    if (data[i][0] === userId && data[i][1] === tag) sheet.deleteRow(i + 1);
  }
}

function hasTag(userId, tag) {
  var data = SpreadsheetApp.openById(CONFIG.SS_ID).getSheetByName('TAGS').getDataRange().getValues();
  return data.some(function(row) { return row[0] === userId && row[1] === tag; });
}

function logClick(userId, tag, url) {
  SpreadsheetApp.openById(CONFIG.SS_ID).getSheetByName('CLICK_LOG').appendRow([userId, tag, url, new Date()]);
}

function logSurvey(userId, answer, scenarioMoved) {
  var ss = SpreadsheetApp.openById(CONFIG.SS_ID);
  var sheet = ss.getSheetByName('SURVEY_LOG') || ss.insertSheet('SURVEY_LOG');
  sheet.appendRow([userId, answer, scenarioMoved, new Date()]);
}

function sendPushMessage(userId, text) {
  if (!text) return;
  UrlFetchApp.fetch(LINE_API + '/push', {
    method: 'post',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + CONFIG.LINE_TOKEN },
    payload: JSON.stringify({ to: userId, messages: [{ type: 'text', text: text }] }),
    muteHttpExceptions: true
  });
}

function replyMessage(replyToken, text) {
  if (!text || !replyToken) return;
  UrlFetchApp.fetch(LINE_API + '/reply', {
    method: 'post',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + CONFIG.LINE_TOKEN },
    payload: JSON.stringify({ replyToken: replyToken, messages: [{ type: 'text', text: text }] }),
    muteHttpExceptions: true
  });
}

function sendSurveyButtons(userId) {
  UrlFetchApp.fetch(LINE_API + '/push', {
    method: 'post',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + CONFIG.LINE_TOKEN },
    payload: JSON.stringify({
      to: userId,
      messages: [{ type: 'template', altText: 'あなたはどちらですか？', template: {
        type: 'buttons', text: 'あなたはどちらですか？',
        actions: [
          { type: 'postback', label: '👩 子どもの英語を伸ばしたい', data: 'survey_parent' },
          { type: 'postback', label: '🎓 英検を目指す中学・高校生', data: 'survey_student' },
          { type: 'postback', label: '💼 自分の英語を使えるようにしたい', data: 'survey_adult' },
        ]
      }}]
    }),
    muteHttpExceptions: true
  });
}

function sendQuizButtons(userId) {
  UrlFetchApp.fetch(LINE_API + '/push', {
    method: 'post',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + CONFIG.LINE_TOKEN },
    payload: JSON.stringify({
      to: userId,
      messages: [{ type: 'template', altText: '「better」の発音クイズ', template: {
        type: 'confirm', text: '「better」の本物の発音はどちら？',
        actions: [
          { type: 'postback', label: 'A：ベター', data: 'quiz_A' },
          { type: 'postback', label: 'B：ベラ',   data: 'quiz_B' },
        ]
      }}]
    }),
    muteHttpExceptions: true
  });
}

function getLineProfile(userId) {
  try {
    var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/profile/' + userId, {
      headers: { 'Authorization': 'Bearer ' + CONFIG.LINE_TOKEN }, muteHttpExceptions: true
    });
    return JSON.parse(res.getContentText());
  } catch(e) { return null; }
}

function sendStepNow(userId, scenarioId, stepNum) {
  var msg = buildMessage(scenarioId, stepNum, userId);
  if (!msg) { Logger.log('No message for ' + scenarioId + ' step ' + stepNum); return; }
  sendPushMessage(userId, msg);
  updateUserStep(userId, scenarioId, stepNum + 1, new Date());
  var step = getScenarioStep(scenarioId, stepNum);
  if (step && step.sendSurvey) { Utilities.sleep(500); sendSurveyButtons(userId); }
  if (step && step.sendQuiz)   { Utilities.sleep(500); sendQuizButtons(userId); }
  Logger.log('送信完了: ' + scenarioId + ' step ' + stepNum + ' → ' + userId);
}

function monitorAdvanceNextStep(userId) {
  var ss = SpreadsheetApp.openById(CONFIG.SS_ID);
  var data = ss.getSheetByName('USERS').getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] !== userId) continue;
    sendStepNow(userId, data[i][2], parseInt(data[i][3]) || 0);
    return;
  }
  Logger.log('ユーザー未登録: ' + userId);
}

function setupSheets() {
  var ss = SpreadsheetApp.openById(CONFIG.SS_ID);
  var sheets = {
    'USERS':      ['userId','displayName','scenarioId','stepNumber','stepSentAt','registeredAt'],
    'TAGS':       ['userId','tag','addedAt'],
    'CLICK_LOG':  ['userId','tag','url','clickedAt'],
    'SURVEY_LOG': ['userId','answer','scenarioMoved','answeredAt'],
  };
  for (var name in sheets) {
    var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(sheets[name]);
      sheet.getRange(1,1,1,sheets[name].length).setBackground('#1a2d45').setFontColor('#fff').setFontWeight('bold');
    }
  }
  Logger.log('シート設定完了');
}

function setupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'checkAndSendScheduled') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('checkAndSendScheduled').timeBased().everyHours(1).create();
  Logger.log('トリガー設定完了');
}
