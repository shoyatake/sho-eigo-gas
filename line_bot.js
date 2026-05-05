// ============================================================
// sho eigo — LINE自動化システム（GAS完全版）
// ProLine代替 / GAS + Google Sheets + LINE Messaging API
// ============================================================

const CONFIG = {
  LINE_TOKEN: 'YOUR_LINE_CHANNEL_ACCESS_TOKEN',
  SS_ID: 'YOUR_SPREADSHEET_ID',
  GAS_URL: 'YOUR_GAS_DEPLOY_URL',
};

const MONITOR_CONFIG = {
  CAPACITY: 10,
  PERIOD_DAYS: 14,
};

const LINE_API = 'https://api.line.me/v2/bot/message';

function doPost(e) {
  try {
    if (e && e.parameter && e.parameter.action === 'improvement') {
      return handleImprovementRequest(e);
    }
    if (e && e.parameter && e.parameter.action === 'stripe_webhook') {
      if (!verifyStripeWebhookUrlSecret(e)) {
        return ContentService.createTextOutput(JSON.stringify({ok: false, reason: 'unauthorized'}))
          .setMimeType(ContentService.MimeType.JSON);
      }
      var rawBody = (e.postData && e.postData.contents) || '';
      var result = handleStripeWebhook(rawBody);
      return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }
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

function handleImprovementRequest(e) {
  const userId = (e.parameter.uid || '').trim();
  const content = (e.parameter.content || '').trim();
  const course = (e.parameter.course || 'main').trim();
  const category = (e.parameter.category || '').trim();
  const age = (e.parameter.age || '').trim();
  if (!userId || !content) {
    return renderDashboardResult(false, 'uid または内容が空です。');
  }
  if (!hasTag(userId, 'mon_active') && !hasTag(userId, 'mon_completed')) {
    return renderDashboardResult(false, 'モニター参加者として認証できませんでした。');
  }
  const meta = [course, category, age].filter(function(v){ return v; }).join(' / ');
  saveFeedback(userId, 'improvement', '[' + meta + '] ' + content);
  return renderDashboardResult(true, 'フィードバックを受け取りました。');
}

function renderDashboardResult(ok, message) {
  const color = ok ? '#1a2d45' : '#d04b30';
  const title = ok ? 'ありがとうございます' : '送信できませんでした';
  const html =
    '<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + title + '</title>' +
    '<style>body{font-family:"Hiragino Sans","Noto Sans JP",sans-serif;background:#fafaf7;color:#2a2a2a;margin:0;padding:48px 24px;text-align:center;line-height:1.7;}' +
    'h1{color:' + color + ';font-size:22px;margin-bottom:16px;}p{max-width:480px;margin:0 auto 24px;}' +
    'a{display:inline-block;background:#1a2d45;color:#fff;padding:12px 24px;border-radius:999px;text-decoration:none;font-weight:700;}</style>' +
    '</head><body><h1>' + title + '</h1><p>' + message + '</p>' +
    '<a href="javascript:history.back()">戻る</a></body></html>';
  return HtmlService.createHtmlOutput(html);
}

function doGet(e) {
  // Admin dashboard
  if (e && e.parameter && e.parameter.action === 'admin') {
    if (!checkAdminToken(e.parameter.token || '')) {
      return HtmlService.createHtmlOutput('<h1>403 Forbidden</h1>');
    }
    if (e.parameter.format === 'json') {
      return ContentService.createTextOutput(JSON.stringify(buildAdminDashboardJson()))
        .setMimeType(ContentService.MimeType.JSON);
    }
    return buildAdminDashboardHtml();
  }
  // Stripe Customer Portal (解約・カード変更)
  if (e && e.parameter && e.parameter.action === 'portal') {
    var puid = e.parameter.uid || '';
    if (!puid) {
      return HtmlService.createHtmlOutput('<h1>uid が必要です</h1><p>LINE Bot のメッセージから「解約」とお送りください。</p>');
    }
    var pres = createPortalSession(puid);
    if (pres && pres.url) {
      return HtmlService.createHtmlOutput(
        '<script>window.location.replace("' + pres.url.replace(/"/g, '&quot;') + '")</script>'
      );
    }
    var pmsg = (pres && pres.error === 'customer_not_found') ?
      'お客様情報が見つかりませんでした。LINE で「解約」とお送りください。' :
      'お客様ポータルの準備中にエラーが発生しました。';
    return HtmlService.createHtmlOutput('<h1>準備中</h1><p>' + pmsg + '</p>');
  }

  // Stripe Checkout 起動 (pages/payment/index.html から飛んでくる)
  if (e && e.parameter && e.parameter.action === 'checkout') {
    var plan = e.parameter.plan || '';
    var uid  = e.parameter.uid || '';
    if (!uid) {
      return HtmlService.createHtmlOutput('<h1>uid が必要です</h1><p>LINE Bot のメッセージから「Pro に進む」をタップしてください。</p>');
    }
    var result = createCheckoutSession(uid, plan);
    if (result && result.url) {
      return HtmlService.createHtmlOutput(
        '<script>window.location.replace("' + result.url.replace(/"/g, '&quot;') + '")</script>'
      );
    }
    var msg = result && result.error === 'not_allowed_yet' ?
      'Pro プランは現在テスト中です。明日以降にお試しください。' :
      '決済画面の準備中にエラーが発生しました。少し時間をおいてからお試しください。';
    return HtmlService.createHtmlOutput('<h1>準備中</h1><p>' + msg + '</p>');
  }

  // 既存: tracking redirect
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
    // 続けて sho の声で 1 通だけ音声を送る (オンボーディング体験の核)
    Utilities.sleep(800);
    sendWelcomeAudio(userId);
    updateUserStep(userId, 'SC-MAIN', 1, new Date());
  }
}

// 初回フォロー時、sho の IVC 声で「ようこそ」を audio message として送る
// 既に Phase 1+2 で /trial/audio/sho/ に配置済の mp3 を使うので追加コスト無し
function sendWelcomeAudio(userId) {
  if (!userId) return;
  // Script Properties で URL / duration を上書き可能 (本番音源に切り替えたい場合用)
  var url = getProp('WELCOME_AUDIO_URL') || 'https://sho-blog.com/trial/audio/sho/day1_step00_ようこそ.mp3';
  var durationMs = parseInt(getProp('WELCOME_AUDIO_DURATION_MS') || '15000', 10);
  try {
    UrlFetchApp.fetch(LINE_API + '/push', {
      method: 'post',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + CONFIG.LINE_TOKEN },
      payload: JSON.stringify({
        to: userId,
        messages: [{
          type: 'audio',
          originalContentUrl: url,
          duration: durationMs
        }]
      }),
      muteHttpExceptions: true
    });
    addTag(userId, 'welcome_audio_sent');
  } catch(e) {
    Logger.log('sendWelcomeAudio error: ' + e);
  }
}

function handleMessage(event) {
  const userId = event.source.userId;
  const text   = (event.message && event.message.text) || '';

  // AI 添削モード (SC-MAIN step 4 後に ai_writing_pending を付与してある)
  if (hasTag(userId, 'ai_writing_pending')) {
    handleAiWriting(event);
    return;
  }

  if (hasTag(userId, 'mon_feedback_pending')) {
    const isTestimonial = hasTag(userId, 'mon_testimonial_pending');
    saveFeedback(userId, isTestimonial ? 'testimonial' : 'free', text);
    removeTag(userId, 'mon_feedback_pending');
    if (isTestimonial) {
      removeTag(userId, 'mon_testimonial_pending');
      addTag(userId, 'mon_testimonial_done');
      completeMonitor(userId);
      replyMessage(event.replyToken, '口コミありがとうございます！\n\n次回サブスクを半額（3ヶ月）で\nご利用いただけます。\n詳細は別途ご案内します。');
    } else {
      replyMessage(event.replyToken, 'フィードバックありがとうございます。\nしっかり読ませていただきます。');
    }
    return;
  }

  if (text.indexOf('モニター') !== -1) {
    handleMonitorInquiry(event);
    return;
  }

  if (text.indexOf('フィードバック') !== -1 || text.indexOf('感想') !== -1) {
    if (hasTag(userId, 'mon_active') || hasTag(userId, 'mon_completed')) {
      addTag(userId, 'mon_feedback_pending');
      replyMessage(event.replyToken, '次のメッセージをフィードバックとして記録します。\n何でも自由に書いてください。');
      return;
    }
  }

  // 解約 / キャンセル: Stripe Customer Portal に誘導 (Pro ユーザーのみ)
  if (text.indexOf('解約') !== -1 || text.indexOf('キャンセル') !== -1 || text.toLowerCase() === 'cancel') {
    if (hasTag(userId, 'purchased')) {
      var portalUrl = (CONFIG.GAS_URL && CONFIG.GAS_URL.indexOf('http') === 0)
        ? CONFIG.GAS_URL + '?action=portal&uid=' + encodeURIComponent(userId)
        : 'https://sho-blog.com/payment/';
      replyMessage(event.replyToken, '解約・カード情報の変更は下記のお客様ポータルから行えます。\n\n' + portalUrl);
      return;
    }
  }

  const keywords = {
    '体験':  '▼ 2日間無料体験はこちら\nhttps://sho-blog.com/all/trial/trial_day1.html',
    'day1':  '▼ 体験Day 1\nhttps://sho-blog.com/all/trial/trial_day1.html',
    'day2':  '▼ 体験Day 2\nhttps://sho-blog.com/all/trial/trial_day2.html',
    'プラン': '▼ Pro プランの詳細\nhttps://sho-blog.com/payment/',
    'pro':   '▼ Pro プランの詳細\nhttps://sho-blog.com/payment/',
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

  if (data === 'monitor_join') {
    if (joinMonitor(userId)) {
      replyMessage(event.replyToken, 'モニター登録が完了しました。\nこれから14日間、よろしくお願いします。\n\n1講座プレゼントの受け取り方法は\n後ほど個別にご案内します。');
    } else {
      replyMessage(event.replyToken, 'モニター枠が満席か、すでに参加済みです。');
    }
    return;
  }

  if (data.indexOf('mon_mid_') === 0) {
    saveFeedback(userId, 'mid', data.replace('mon_mid_', ''));
    addTag(userId, 'mon_mid_done');
    replyMessage(event.replyToken, 'ありがとうございます。\n引き続きよろしくお願いします。');
    return;
  }

  if (data === 'mon_final_yes') {
    saveFeedback(userId, 'final', 'agree_testimonial');
    addTag(userId, 'mon_final_done');
    addTag(userId, 'mon_testimonial_pending');
    addTag(userId, 'mon_feedback_pending');
    replyMessage(event.replyToken, 'ありがとうございます！\n口コミは次のメッセージに書いていただけますか。\n（このまま自由に書いてOKです）');
    return;
  }

  if (data === 'mon_final_no') {
    saveFeedback(userId, 'final', 'pass_testimonial');
    addTag(userId, 'mon_final_done');
    completeMonitor(userId);
    replyMessage(event.replyToken, 'モニター期間、本当にお疲れ様でした。\nありがとうございました。');
    return;
  }

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
    return;
  }

  // Pro プラン選択 (SC-MAIN step 5 から飛んでくる)
  if (data.indexOf('plan_') === 0) {
    var plan = data.replace('plan_', '');
    handlePlanSelected(event, plan);
    return;
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
    if (hasTag(userId, 'deleted')) continue;
    const step = getScenarioStep(scenarioId, stepNum);
    if (!step) continue;
    if (!isSendDue(stepSentAt, step.delayDays, step.sendHour, now)) continue;
    if (step.skipIfTag && hasTag(userId, step.skipIfTag)) {
      updateUserStep(userId, scenarioId, stepNum + 1, now);
      continue;
    }
    if (step.executeDeletion) {
      executeUserDeletion(userId);
      updateUserStep(userId, scenarioId, stepNum + 1, now);
      continue;
    }
    const msg = buildMessage(scenarioId, stepNum, userId);
    if (msg) {
      sendPushMessage(userId, msg);
      updateUserStep(userId, scenarioId, stepNum + 1, now);
    }
    if (step.sendSurvey)            { Utilities.sleep(500); sendSurveyButtons(userId); }
    if (step.sendQuiz)              { Utilities.sleep(500); sendQuizButtons(userId); }
    if (step.sendMonitorMidSurvey)  { Utilities.sleep(500); sendMonitorMidSurvey(userId); }
    if (step.sendMonitorFinalSurvey){ Utilities.sleep(500); sendMonitorFinalSurvey(userId); }
    if (step.markAiWritingPending)  { addTag(userId, 'ai_writing_pending'); }
    if (step.sendPlanSelect)        { Utilities.sleep(500); sendPlanSelectButtons(userId); }
    Utilities.sleep(200);
  }
  checkEngagement();
  checkDeletionEligibility();
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
    if (hasTag(userId, 'purchased') || hasTag(userId, 'dormant') || hasTag(userId, 'deleted')) continue;
    if (hasTag(userId, 'mon_active') || hasTag(userId, 'mon_completed')) continue;
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

function checkDeletionEligibility() {
  const ss = SpreadsheetApp.openById(CONFIG.SS_ID);
  const tagsSheet = ss.getSheetByName('TAGS');
  if (!tagsSheet) return;
  const tagsData = tagsSheet.getDataRange().getValues();
  const dormantSince = {};
  for (var i = 1; i < tagsData.length; i++) {
    if (tagsData[i][1] === 'dormant') {
      dormantSince[tagsData[i][0]] = tagsData[i][2] ? new Date(tagsData[i][2]) : null;
    }
  }
  const usersSheet = ss.getSheetByName('USERS');
  const users = usersSheet.getDataRange().getValues();
  const now = new Date();
  for (var j = 1; j < users.length; j++) {
    const userId = users[j][0];
    if (!userId) continue;
    if (!dormantSince[userId]) continue;
    if (hasTag(userId, 'purchased') || hasTag(userId, 'deleted') || hasTag(userId, 'reactivated')) continue;
    if (hasTag(userId, 'mon_active')) continue;
    if (users[j][2] === 'SC-DELETE-NOTICE') continue;
    const daysDormant = (now - dormantSince[userId]) / (1000 * 60 * 60 * 24);
    if (daysDormant >= 30 && !hasAnyReadTag(userId)) {
      moveToScenario(userId, 'SC-DELETE-NOTICE', 0);
    }
  }
}

function executeUserDeletion(userId) {
  if (!userId) return;
  addTag(userId, 'deleted');
  const ss = SpreadsheetApp.openById(CONFIG.SS_ID);
  const sheet = ss.getSheetByName('DELETION_LOG') || ss.insertSheet('DELETION_LOG');
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['userId', 'deletedAt', 'reason']);
    sheet.getRange(1, 1, 1, 3).setBackground('#1a2d45').setFontColor('#fff').setFontWeight('bold');
  }
  sheet.appendRow([userId, new Date(), 'auto_inactivity_60d']);
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
    { stepNum: 4, delayDays: 2, sendHour: 19, trackingTag: 'read_s4', markAiWritingPending: true,
      message: '今日は AI 添削を 1 行だけ試してみませんか。\n\nお題:「昨日は雨でした」\n\nこの文を英語 1 行にして、このトークに送ってください。\n（200 字以内 / 日本語訳は不要）\n\nsho の AI が改善文と 1 つだけのコツを返します。' },
    { stepNum: 5, delayDays: 2, sendHour: 8, trackingTag: 'read_s5', sendPlanSelect: true,
      message: 'ここまで体験してみていかがでしたか。\n\n続けてみたい場合、プランをご用意しています。\n\n・個人 Pro 3,980円/月\n・保護者プラン 6,980円/月\n  （音声学習は、思い出になる。週次レポートと音声ログ保管付き）\n・法人 Pro はご相談\n\nいつでも 1 クリック解約できます。\nどのプランで進めますか？' }
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
  'SC-MONITOR': [
    { stepNum: 0, delayDays: 0, sendHour: 0, trackingTag: 'read_m0',
      message: 'モニターに参加してくれてありがとうございます。\n翔也です。\n\n10名限定の枠に\n入っていただきました。\n\n■ お渡しするもの\n・1講座 無料プレゼント（参加者全員）\n・口コミを投稿してくれた方には\n　次回サブスク 半額（3ヶ月間）\n\n■ お願いしたいこと\n・14日間、Day 1とDay 2を実際に体験してください\n・5日目と最終日に簡単なアンケートに答えてください\n・気づいたことがあれば「フィードバック」と送るか\n　専用ダッシュボードから提出してください\n\n▼ あなた専用ダッシュボード\n{{DASHBOARD_URL}}\n\nまずは Day 1 から始めましょう。\n\n▼ Day 1 はこちら\nhttps://sho-blog.com/all/trial/trial_day1.html' },
    { stepNum: 1, delayDays: 1, sendHour: 8, trackingTag: 'read_m1',
      message: 'おはようございます、翔也です。\n\n昨日のDay 1、いかがでしたか。\n\n今日からDay 2 に進めます。\n音の変化が少しずつ\n見えてくる頃です。\n\n▼ Day 2 はこちら\nhttps://sho-blog.com/all/trial/trial_day2.html' },
    { stepNum: 2, delayDays: 4, sendHour: 8, trackingTag: 'read_m2', sendMonitorMidSurvey: true,
      message: 'モニター開始から5日目です。\n\nここまでの感触を\n簡単に教えてください。\n\n下のボタンから1タップでお答えいただけます。\n\n細かい感想は「フィードバック」と\n送っていただければ\n次のメッセージを記録します。' },
    { stepNum: 3, delayDays: 5, sendHour: 8, trackingTag: 'read_m3',
      message: 'モニター10日目です。\n\nここまでで気づいたこと、\n変化したこと、\n逆に分かりにくかったことなど\n何でも教えてください。\n\n「フィードバック」と送っていただくと\n次のメッセージを記録に残します。\n\n残り4日、引き続きよろしくお願いします。' },
    { stepNum: 4, delayDays: 4, sendHour: 8, trackingTag: 'read_m4', sendMonitorFinalSurvey: true,
      message: 'モニター期間最終日です。\n14日間、本当にありがとうございました。\n\nこの体験の感想を\n短くで構いませんので\n口コミとしていただけませんか。\n\nいただいた方には\n次回サブスクを 半額（3ヶ月）で\nご利用いただけます。\n\n下のボタンからお答えください。' },
  ],
  'SC-DELETE-NOTICE': [
    { stepNum: 0, delayDays: 0, sendHour: 9, trackingTag: 'read_del1', skipIfTag: 'reactivated',
      message: 'お久しぶりです、翔也です。\n\n長くご連絡が取れていないため\n7日後にこのリストから\n自動的に登録解除させていただきます。\n\nもしまだ続けたい気持ちがあれば\n下のリンクから一度反応してください。\n反応があれば解除を取り消します。\n\n▼ 続けたい方はこちら\nhttps://sho-blog.com/all/trial/trial_day1.html' },
    { stepNum: 1, delayDays: 3, sendHour: 9, trackingTag: 'read_del2', skipIfTag: 'reactivated',
      message: '先日のメッセージ、届いていますか。\n\nあと4日でこのリストから\n自動解除されます。\n\n最後にもう一度だけ\nお声がけしました。\n\n▼ もう一度試してみる\nhttps://sho-blog.com/all/trial/trial_day1.html' },
    { stepNum: 2, delayDays: 3, sendHour: 9, trackingTag: 'read_del3', skipIfTag: 'reactivated',
      message: '明日、自動的に登録解除します。\n\n今までありがとうございました。\n\nもし「やっぱり続けたい」と\n思ったら明日までに\n下のリンクから反応してください。\n\n▼ 最後のチャンス\nhttps://sho-blog.com/all/trial/trial_day1.html' },
    { stepNum: 3, delayDays: 1, sendHour: 9, trackingTag: null, skipIfTag: 'reactivated',
      executeDeletion: true, message: null },
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
  var msg = step.message;
  if (userId) {
    msg = msg.replace(/\{\{DASHBOARD_URL\}\}/g,
      'https://sho-blog.com/monitor/dashboard.html?uid=' + encodeURIComponent(userId));
    msg = msg.replace(/\{\{DASHBOARD_PARENT_URL\}\}/g,
      'https://sho-blog.com/monitor/parent/dashboard.html?uid=' + encodeURIComponent(userId));
  }
  if (step.trackingTag && userId) {
    return wrapTrackingUrls(msg, userId, step.trackingTag);
  }
  return msg;
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

function sendTestDeletionNotice(userId) {
  if (!userId) return;
  const steps = SCENARIOS_DATA['SC-DELETE-NOTICE'];
  for (var i = 0; i < steps.length; i++) {
    if (steps[i].message) {
      sendPushMessage(userId, '[テスト配信] ' + steps[i].message);
      Utilities.sleep(500);
    }
  }
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
  if (step && step.sendSurvey)             { Utilities.sleep(500); sendSurveyButtons(userId); }
  if (step && step.sendQuiz)               { Utilities.sleep(500); sendQuizButtons(userId); }
  if (step && step.sendMonitorMidSurvey)   { Utilities.sleep(500); sendMonitorMidSurvey(userId); }
  if (step && step.sendMonitorFinalSurvey) { Utilities.sleep(500); sendMonitorFinalSurvey(userId); }
  if (step && step.markAiWritingPending)   { addTag(userId, 'ai_writing_pending'); }
  if (step && step.sendPlanSelect)         { Utilities.sleep(500); sendPlanSelectButtons(userId); }
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
    'USERS':        ['userId','displayName','scenarioId','stepNumber','stepSentAt','registeredAt'],
    'TAGS':         ['userId','tag','addedAt'],
    'CLICK_LOG':    ['userId','tag','url','clickedAt'],
    'SURVEY_LOG':   ['userId','answer','scenarioMoved','answeredAt'],
    'MONITORS':     ['userId','displayName','joinedAt','expectedEndAt','status','completedAt'],
    'FEEDBACK_LOG': ['userId','type','content','receivedAt'],
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

// ============================================================
// モニター機能（10名限定 / 14日間 / 1講座プレゼント / 口コミでサブスク半額3ヶ月）
// ============================================================

function getActiveMonitorCount() {
  var ss = SpreadsheetApp.openById(CONFIG.SS_ID);
  var sheet = ss.getSheetByName('MONITORS');
  if (!sheet) return 0;
  var data = sheet.getDataRange().getValues();
  var count = 0;
  for (var i = 1; i < data.length; i++) {
    if (data[i][4] === 'active') count++;
  }
  return count;
}

function isMonitorRecruitmentOpen() {
  return getActiveMonitorCount() < MONITOR_CONFIG.CAPACITY;
}

function handleMonitorInquiry(event) {
  var userId = event.source.userId;
  if (hasTag(userId, 'mon_active')) {
    replyMessage(event.replyToken, 'すでにモニターとしてご参加いただいています。\nありがとうございます。');
    return;
  }
  if (hasTag(userId, 'mon_completed') || hasTag(userId, 'mon_dropout')) {
    replyMessage(event.replyToken, 'モニター参加履歴があります。\n今後の取り組みもよろしくお願いします。');
    return;
  }
  if (!isMonitorRecruitmentOpen()) {
    replyMessage(event.replyToken, 'モニター枠（10名）は現在満席です。\n次回募集の際にあらためてご案内します。');
    return;
  }
  sendMonitorJoinButton(event.replyToken);
}

function joinMonitor(userId) {
  if (!userId) return false;
  if (!isMonitorRecruitmentOpen()) return false;
  if (hasTag(userId, 'mon_active') || hasTag(userId, 'mon_completed')) return false;

  var profile = getLineProfile(userId);
  var displayName = profile ? profile.displayName : '';
  var now = new Date();
  var expectedEnd = new Date(now.getTime() + MONITOR_CONFIG.PERIOD_DAYS * 86400000);

  recordMonitor(userId, displayName, now, expectedEnd);
  addTag(userId, 'mon_active');
  registerUser(userId, displayName, 'SC-MONITOR', 0, now);
  sendStepNow(userId, 'SC-MONITOR', 0);
  return true;
}

function recordMonitor(userId, displayName, joinedAt, expectedEndAt) {
  var ss = SpreadsheetApp.openById(CONFIG.SS_ID);
  var sheet = ss.getSheetByName('MONITORS') || ss.insertSheet('MONITORS');
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['userId','displayName','joinedAt','expectedEndAt','status','completedAt']);
    sheet.getRange(1,1,1,6).setBackground('#1a2d45').setFontColor('#fff').setFontWeight('bold');
  }
  sheet.appendRow([userId, displayName, joinedAt, expectedEndAt, 'active', '']);
}

function completeMonitor(userId) {
  if (!userId) return;
  removeTag(userId, 'mon_active');
  addTag(userId, 'mon_completed');
  var ss = SpreadsheetApp.openById(CONFIG.SS_ID);
  var sheet = ss.getSheetByName('MONITORS');
  if (!sheet) return;
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === userId && data[i][4] === 'active') {
      sheet.getRange(i+1, 5).setValue('completed');
      sheet.getRange(i+1, 6).setValue(new Date());
      return;
    }
  }
}

function saveFeedback(userId, type, content) {
  var ss = SpreadsheetApp.openById(CONFIG.SS_ID);
  var sheet = ss.getSheetByName('FEEDBACK_LOG') || ss.insertSheet('FEEDBACK_LOG');
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['userId','type','content','receivedAt']);
    sheet.getRange(1,1,1,4).setBackground('#1a2d45').setFontColor('#fff').setFontWeight('bold');
  }
  sheet.appendRow([userId, type, content, new Date()]);
}

function sendMonitorJoinButton(replyToken) {
  UrlFetchApp.fetch(LINE_API + '/reply', {
    method: 'post',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + CONFIG.LINE_TOKEN },
    payload: JSON.stringify({
      replyToken: replyToken,
      messages: [{ type: 'template', altText: 'モニター参加', template: {
        type: 'buttons',
        title: 'モニター募集（10名限定）',
        text: '・1講座プレゼント\n・口コミ投稿で次回サブスク半額3ヶ月\n・期間 14日間',
        actions: [
          { type: 'postback', label: 'モニターに参加する', data: 'monitor_join' },
        ]
      }}]
    }),
    muteHttpExceptions: true
  });
}

function sendMonitorMidSurvey(userId) {
  UrlFetchApp.fetch(LINE_API + '/push', {
    method: 'post',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + CONFIG.LINE_TOKEN },
    payload: JSON.stringify({
      to: userId,
      messages: [{ type: 'template', altText: '5日目アンケート', template: {
        type: 'buttons', text: 'ここまでの感触に近いものは？',
        actions: [
          { type: 'postback', label: '何か変わってきた', data: 'mon_mid_change' },
          { type: 'postback', label: 'まだよく分からない', data: 'mon_mid_unclear' },
          { type: 'postback', label: '合わない / 難しい', data: 'mon_mid_hard' },
        ]
      }}]
    }),
    muteHttpExceptions: true
  });
}

function sendMonitorFinalSurvey(userId) {
  UrlFetchApp.fetch(LINE_API + '/push', {
    method: 'post',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + CONFIG.LINE_TOKEN },
    payload: JSON.stringify({
      to: userId,
      messages: [{ type: 'template', altText: '最終アンケート', template: {
        type: 'confirm', text: '口コミを書いていただけますか？\n（次回サブスク半額3ヶ月の特典付）',
        actions: [
          { type: 'postback', label: '書く', data: 'mon_final_yes' },
          { type: 'postback', label: '今回はパス', data: 'mon_final_no' },
        ]
      }}]
    }),
    muteHttpExceptions: true
  });
}

function registerMonitorManually(userId) {
  if (!userId) { Logger.log('userId が必要です'); return; }
  if (joinMonitor(userId)) {
    Logger.log('モニター登録完了: ' + userId);
  } else {
    Logger.log('登録できませんでした（満席 or 既登録）: ' + userId);
  }
}

function getMonitorReport() {
  var ss = SpreadsheetApp.openById(CONFIG.SS_ID);
  var monSheet = ss.getSheetByName('MONITORS');
  if (!monSheet) { Logger.log('MONITORS シートがありません。setupSheets を実行してください。'); return; }
  var data = monSheet.getDataRange().getValues();
  var active = 0, completed = 0;
  var activeList = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][4] === 'active')    { active++; activeList.push(data[i][0] + '  ' + (data[i][1] || '')); }
    if (data[i][4] === 'completed') { completed++; }
  }
  var fbSheet = ss.getSheetByName('FEEDBACK_LOG');
  var fbCount = fbSheet ? Math.max(0, fbSheet.getLastRow() - 1) : 0;
  Logger.log('=== モニターレポート ===');
  Logger.log('募集枠       : ' + MONITOR_CONFIG.CAPACITY);
  Logger.log('アクティブ   : ' + active);
  Logger.log('残り枠       : ' + Math.max(0, MONITOR_CONFIG.CAPACITY - active));
  Logger.log('完了済み     : ' + completed);
  Logger.log('フィードバック: ' + fbCount + ' 件');
  Logger.log('--- アクティブモニター ---');
  activeList.forEach(function(s){ Logger.log(s); });
}

// ============================================================
// Pro / Stripe / AI 添削 / Admin / cron (sprint 2026-05-06)
// 既存コードと干渉しないよう独立セクションで追加。
// 全機能は Script Properties で必要な値が未設定なら no-op + Logger.log。
// ============================================================

const PRO_PLANS = {
  personal: { price_jpy: 3980, ai_writing_quota: 20, label: '個人 Pro',           stripe_price_id_prop: 'STRIPE_PRICE_PERSONAL' },
  family:   { price_jpy: 6980, ai_writing_quota: 40, label: '保護者プラン',        stripe_price_id_prop: 'STRIPE_PRICE_FAMILY'   },
  corp:     { price_jpy: 9800, ai_writing_quota: 0,  label: '法人 Pro (1 シート)', stripe_price_id_prop: 'STRIPE_PRICE_CORP'     }
};

function getProp(name) {
  return PropertiesService.getScriptProperties().getProperty(name) || '';
}

function todayJSTKey() {
  return Utilities.formatDate(new Date(), 'JST', 'yyyyMMdd');
}

// ----------------------------------------
// Stripe Checkout
// ----------------------------------------
function createCheckoutSession(userId, plan) {
  if (!userId || !plan) return { error: 'missing_params' };
  if (!PRO_PLANS[plan]) return { error: 'unknown_plan' };
  var stripeKey = getProp('STRIPE_SECRET_KEY');
  if (!stripeKey) return { error: 'stripe_not_configured' };

  // Safety guard: ALLOWED_TEST_UIDS が設定されており LIVE_OPEN_AFTER 未到達なら、リスト内 UID のみ許可
  var allowedUidsRaw = getProp('ALLOWED_TEST_UIDS');
  if (allowedUidsRaw) {
    var allowedUids = allowedUidsRaw.split(',').map(function(s){ return s.trim(); }).filter(function(s){ return s; });
    var liveOpenAfterStr = getProp('LIVE_OPEN_AFTER');
    var liveOpenAfter = liveOpenAfterStr ? new Date(liveOpenAfterStr) : null;
    var stillGated = !liveOpenAfter || new Date() < liveOpenAfter;
    if (stillGated && allowedUids.indexOf(userId) === -1) {
      Logger.log('createCheckoutSession blocked: ' + userId + ' not in ALLOWED_TEST_UIDS');
      return { error: 'not_allowed_yet' };
    }
  }

  var priceId = getProp(PRO_PLANS[plan].stripe_price_id_prop);
  if (!priceId) return { error: 'price_id_missing' };

  var payload = {
    'mode': 'subscription',
    'success_url': 'https://sho-blog.com/payment/success.html?session_id={CHECKOUT_SESSION_ID}',
    'cancel_url':  'https://sho-blog.com/payment/cancel.html',
    'client_reference_id': userId,
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': 1,
    'metadata[lineUserId]': userId,
    'metadata[plan]': plan,
    // subscription にも metadata を引き継ぐ (subscription.deleted 等で使う)
    'subscription_data[metadata][lineUserId]': userId,
    'subscription_data[metadata][plan]': plan,
    'allow_promotion_codes': 'true'
  };
  var formData = Object.keys(payload).map(function(k){
    return encodeURIComponent(k) + '=' + encodeURIComponent(payload[k]);
  }).join('&');

  var resp = UrlFetchApp.fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'post',
    headers: { 'Authorization': 'Bearer ' + stripeKey, 'Content-Type': 'application/x-www-form-urlencoded' },
    payload: formData,
    muteHttpExceptions: true
  });
  var status = resp.getResponseCode();
  var body = resp.getContentText();
  if (status !== 200) {
    Logger.log('Stripe checkout create failed: ' + status + ' ' + body.substr(0, 300));
    notifyAlert('[Stripe] checkout 作成失敗 status=' + status, 'all');
    return { error: 'stripe_api_error', status: status };
  }
  try {
    var data = JSON.parse(body);
    return { url: data.url, id: data.id };
  } catch(e) {
    return { error: 'stripe_parse_error' };
  }
}

// GAS doPost は HTTP ヘッダを取れないため、Stripe-Signature による HMAC 検証は使わず、
// 1) URL クエリ secret 一致 + 2) Stripe API で session を再 GET して整合性確認、の 2 段で守る。
function verifyStripeWebhookUrlSecret(e) {
  var urlSecret = getProp('STRIPE_WEBHOOK_URL_SECRET');
  if (!urlSecret) return false;  // 未設定なら全部弾く
  var got = (e && e.parameter && e.parameter.secret) || '';
  return got === urlSecret;
}

function reverifyStripeObject(objType, objId) {
  if (!objId) return null;
  var key = getProp('STRIPE_SECRET_KEY');
  if (!key) return null;
  var path = (objType === 'session') ? '/v1/checkout/sessions/' : '/v1/subscriptions/';
  var resp = UrlFetchApp.fetch('https://api.stripe.com' + path + objId, {
    method: 'get',
    headers: { 'Authorization': 'Bearer ' + key },
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) {
    Logger.log('reverifyStripeObject ' + objType + '/' + objId + ' failed: ' + resp.getResponseCode());
    return null;
  }
  try { return JSON.parse(resp.getContentText()); } catch(e) { return null; }
}

function handleStripeWebhook(rawBody) {
  var event;
  try { event = JSON.parse(rawBody); } catch(e) { return { ok: false, reason: 'parse_error' }; }
  if (event.type === 'checkout.session.completed') {
    var session = event.data && event.data.object;
    if (!session || !session.id) return { ok: false, reason: 'no_session' };
    // Stripe API で再確認 (なりすまし防止)
    var verified = reverifyStripeObject('session', session.id);
    if (!verified || verified.payment_status !== 'paid') {
      Logger.log('Stripe webhook reverify failed for session ' + session.id);
      notifyAlert('[Stripe] webhook reverify 失敗 session=' + session.id, 'all');
      return { ok: false, reason: 'reverify_failed' };
    }
    session = verified;  // 信頼できるソースで上書き
    {
      var lineUid = (session.metadata && session.metadata.lineUserId) || session.client_reference_id || '';
      var plan = (session.metadata && session.metadata.plan) || '';
      if (lineUid) {
        addTag(lineUid, 'purchased');
        if (plan) addTag(lineUid, 'purchased_plan_' + plan);
        var proMenuId = getProp('LINE_RICHMENU_PRO_ID');
        if (proMenuId) {
          UrlFetchApp.fetch('https://api.line.me/v2/bot/user/' + lineUid + '/richmenu/' + proMenuId, {
            method: 'post',
            headers: { 'Authorization': 'Bearer ' + CONFIG.LINE_TOKEN },
            muteHttpExceptions: true
          });
        }
        sendPushMessage(lineUid, 'ご登録ありがとうございます！\n\nPro プランへようこそ。\n今日からよろしくお願いします。');
      }
      logCheckoutSuccess(session);
      notifyAlert('[Pro] 決済完了 plan=' + plan + ' uid=' + (lineUid || '?').substr(0, 10) + '...', 'all');
    }
  } else if (event.type === 'customer.subscription.deleted') {
    var sub = event.data && event.data.object;
    if (sub && sub.id) {
      var verifiedSub = reverifyStripeObject('subscription', sub.id);
      if (verifiedSub && verifiedSub.metadata && verifiedSub.metadata.lineUserId) {
        var uid = verifiedSub.metadata.lineUserId;
        removeTag(uid, 'purchased');
        ['personal','family','corp'].forEach(function(p){ removeTag(uid, 'purchased_plan_' + p); });
        notifyAlert('[Pro] 解約 uid=' + uid.substr(0, 10) + '...', 'slack');
      }
    }
  } else if (event.type === 'charge.refunded' || event.type === 'invoice.payment_failed') {
    // 返金 or 支払い失敗時は Pro タグを剥がす (defensive)
    var obj = event.data && event.data.object;
    var customerId = obj && obj.customer;
    if (customerId) {
      var uid2 = findLineUidByStripeCustomer(customerId);
      if (uid2) {
        removeTag(uid2, 'purchased');
        ['personal','family','corp'].forEach(function(p){ removeTag(uid2, 'purchased_plan_' + p); });
        notifyAlert('[Pro] ' + event.type + ' → 解約処理 uid=' + uid2.substr(0, 10) + '...', 'all');
      } else {
        notifyAlert('[Pro] ' + event.type + ' customer=' + customerId + ' に紐づく LINE uid 不明', 'all');
      }
    }
  }
  return { ok: true };
}

// PURCHASES シートから Stripe customer_id → LINE userId を逆引き
function findLineUidByStripeCustomer(customerId) {
  if (!customerId) return null;
  var ss = SpreadsheetApp.openById(CONFIG.SS_ID);
  var sheet = ss.getSheetByName('PURCHASES');
  if (!sheet) return null;
  var data = sheet.getDataRange().getValues();
  for (var i = data.length - 1; i >= 1; i--) {
    if (data[i][3] === customerId) return data[i][0];
  }
  return null;
}

// Customer Portal セッション発行 (解約・カード変更を Stripe 上で完結させる)
function createPortalSession(userId) {
  if (!userId) return { error: 'missing_uid' };
  var key = getProp('STRIPE_SECRET_KEY');
  if (!key) return { error: 'stripe_not_configured' };
  // PURCHASES から最新の customer_id を取得
  var ss = SpreadsheetApp.openById(CONFIG.SS_ID);
  var sheet = ss.getSheetByName('PURCHASES');
  if (!sheet) return { error: 'no_purchase_record' };
  var data = sheet.getDataRange().getValues();
  var customerId = '';
  for (var i = data.length - 1; i >= 1; i--) {
    if (data[i][0] === userId && data[i][3]) { customerId = data[i][3]; break; }
  }
  if (!customerId) return { error: 'customer_not_found' };

  var payload = 'customer=' + encodeURIComponent(customerId) +
                '&return_url=' + encodeURIComponent('https://sho-blog.com/payment/');
  var resp = UrlFetchApp.fetch('https://api.stripe.com/v1/billing_portal/sessions', {
    method: 'post',
    headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/x-www-form-urlencoded' },
    payload: payload,
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) {
    Logger.log('Stripe portal create failed: ' + resp.getResponseCode() + ' ' + resp.getContentText().substr(0, 300));
    return { error: 'stripe_api_error' };
  }
  try {
    var body = JSON.parse(resp.getContentText());
    return { url: body.url };
  } catch(e) { return { error: 'parse_error' }; }
}

function logCheckoutSuccess(session) {
  var ss = SpreadsheetApp.openById(CONFIG.SS_ID);
  var sheet = ss.getSheetByName('PURCHASES') || ss.insertSheet('PURCHASES');
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['lineUserId','plan','sessionId','customerId','amount','currency','completedAt']);
    sheet.getRange(1,1,1,7).setBackground('#1a2d45').setFontColor('#fff').setFontWeight('bold');
  }
  sheet.appendRow([
    (session.metadata && session.metadata.lineUserId) || session.client_reference_id || '',
    (session.metadata && session.metadata.plan) || '',
    session.id || '',
    session.customer || '',
    session.amount_total || '',
    session.currency || 'jpy',
    new Date()
  ]);
}

function sendPlanSelectButtons(userId) {
  UrlFetchApp.fetch(LINE_API + '/push', {
    method: 'post',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + CONFIG.LINE_TOKEN },
    payload: JSON.stringify({
      to: userId,
      messages: [{ type: 'template', altText: 'プランを選ぶ', template: {
        type: 'buttons', text: 'どのプランで進めますか？',
        actions: [
          { type: 'postback', label: '個人 Pro 3,980円/月',         data: 'plan_personal' },
          { type: 'postback', label: '保護者プラン 6,980円/月',     data: 'plan_family'   },
          { type: 'postback', label: '法人 Pro 相談',                data: 'plan_corp'     }
        ]
      }}]
    }),
    muteHttpExceptions: true
  });
}

function handlePlanSelected(event, plan) {
  var userId = event.source.userId;
  if (plan === 'corp') {
    replyMessage(event.replyToken, '法人 Pro はカスタマイズが入るので、LINE で直接お話しさせてください。\n（10 シート〜 / シート単位課金 / 月次サマリ Slack 通知付き）');
    return;
  }
  var result = createCheckoutSession(userId, plan);
  if (result.error || !result.url) {
    if (result.error === 'not_allowed_yet') {
      replyMessage(event.replyToken, 'プランは現在、本番テスト中です。\n明日以降にもう一度お試しください。');
    } else if (result.error === 'stripe_not_configured' || result.error === 'price_id_missing') {
      replyMessage(event.replyToken, 'プランの準備中です。\n少しお待ちください。');
    } else {
      replyMessage(event.replyToken, '決済画面の準備中にエラーが発生しました。\nしばらく経ってからお試しください。');
    }
    Logger.log('handlePlanSelected error: ' + JSON.stringify(result));
    return;
  }
  var prefix = '';
  if (plan === 'family') {
    prefix = '保護者プラン: 音声学習は、思い出になる。\n週次レポート + 音声ログ保管付き。\n\n';
  }
  replyMessage(event.replyToken, prefix + '下記から決済を完了してください。\n（解約はいつでもお客様ポータルから可能）\n\n' + result.url);
}

// ----------------------------------------
// Claude API
// ----------------------------------------
function callClaudeApi(prompt, opts) {
  var key = getProp('ANTHROPIC_API_KEY');
  if (!key) return { error: 'anthropic_not_configured' };
  opts = opts || {};
  var model = opts.model || 'claude-haiku-4-5-20251001';
  var maxTokens = opts.maxTokens || 300;
  var system = opts.system || 'あなたは優しい英語の先生です。日本語で温かく、200 字以内で答えてください。';
  var resp = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    payload: JSON.stringify({ model: model, max_tokens: maxTokens, system: system, messages: [{ role: 'user', content: prompt }] }),
    muteHttpExceptions: true
  });
  var status = resp.getResponseCode();
  if (status !== 200) {
    Logger.log('Claude API error: ' + status + ' ' + resp.getContentText().substr(0, 300));
    return { error: 'api_error', status: status };
  }
  try {
    var data = JSON.parse(resp.getContentText());
    if (data.content && data.content[0] && data.content[0].text) {
      return { text: data.content[0].text };
    }
    return { error: 'unexpected_response' };
  } catch(e) { return { error: 'parse_error' }; }
}

// ----------------------------------------
// AI 添削
// ----------------------------------------
function checkRateLimit(key, maxCalls, windowSec) {
  var props = PropertiesService.getScriptProperties();
  var now = Math.floor(Date.now() / 1000);
  var windowKey = 'rate_' + key + '_' + Math.floor(now / windowSec);
  var cur = parseInt(props.getProperty(windowKey) || '0');
  if (cur >= maxCalls) return false;
  props.setProperty(windowKey, String(cur + 1));
  return true;
}

function handleAiWriting(event) {
  var userId = event.source.userId;
  var text = (event.message && event.message.text) || '';
  if (text.length > 200 || !/[a-zA-Z]/.test(text)) {
    replyMessage(event.replyToken, '英作文は 200 字以内 + 英文で送ってください。\n（日本語訳は不要です）');
    return;
  }
  var todayTag = 'ai_writing_done_' + todayJSTKey();
  if (hasTag(userId, todayTag)) {
    replyMessage(event.replyToken, '今日の AI 添削は完了しています。\n明日また送ってください。');
    return;
  }
  if (!checkRateLimit('ai_writing_global', 5, 60)) {
    replyMessage(event.replyToken, '今アクセスが集中しています。\n1〜2 分してからもう一度送ってください。');
    return;
  }
  var prompt =
    '次の英作文を添削してください。元の意図を尊重し、自然な英語にしてください。\n\n' +
    '生徒の英作文:\n' + text + '\n\n' +
    '以下の形式で 200 字以内で返してください。\n\n' +
    '✅ 改善文:\n（1行で書き直した英文）\n\n' +
    '💡 ポイント:\n（80 字以内で1つの改善ポイント。日本語）';
  var result = callClaudeApi(prompt, { maxTokens: 300 });
  if (result.error) {
    replyMessage(event.replyToken, 'ありがとうございます！\n明日また送ってくださいね。');
    Logger.log('AI 添削 graceful degradation: ' + result.error);
    return;
  }
  removeTag(userId, 'ai_writing_pending');
  addTag(userId, todayTag);
  saveFeedback(userId, 'ai_writing', '原文:\n' + text + '\n\n添削:\n' + result.text);
  replyMessage(event.replyToken, result.text);
}

// SC-MAIN step 4 配信時、ユーザーに ai_writing_pending タグを付与する
// (checkAndSendScheduled で送信した直後に呼ばれる想定。step.beforeSendHook で対応)
function arrangeAiWritingPrompt(userId) {
  addTag(userId, 'ai_writing_pending');
}

// ----------------------------------------
// Admin Dashboard
// ----------------------------------------
function checkAdminToken(token) {
  var expected = getProp('ADMIN_TOKEN');
  return expected && token === expected;
}

function buildAdminDashboardHtml() {
  var html = '<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>sho eigo Admin</title>' +
    '<style>body{font-family:"Hiragino Sans",sans-serif;background:#f4f4f0;color:#222;margin:0;padding:24px;line-height:1.6;}' +
    '.card{background:#fff;border-radius:12px;padding:16px;margin-bottom:16px;box-shadow:0 2px 6px rgba(0,0,0,0.06);}' +
    'h1{font-size:18px;margin:0 0 16px;}h2{font-size:14px;color:#666;margin:0 0 8px;}' +
    '.metric{font-size:28px;font-weight:bold;color:#1a2d45;}' +
    '.row{display:flex;gap:12px;flex-wrap:wrap;}.row .card{flex:1;min-width:140px;}' +
    '.muted{color:#888;font-size:12px;}</style></head><body>' +
    '<h1>sho eigo Admin</h1>' +
    '<p class="muted">JST タイムスタンプで日次集計。手動リロードで更新。</p>' +
    '<div id="container">読み込み中...</div>' +
    '<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>' +
    '<script>(function(){' +
    'var url = location.href + (location.search ? "&" : "?") + "format=json";' +
    'fetch(url).then(function(r){return r.json();}).then(function(d){' +
    'var c=document.getElementById("container");var h="";' +
    'h+=\'<div class="row">\'+\'<div class="card"><h2>本日 DAU</h2><div class="metric">\'+d.dau+\'</div></div>\'+' +
    '\'<div class="card"><h2>トライアル完走率</h2><div class="metric">\'+d.trial_completion_pct+\'%</div></div>\'+' +
    '\'<div class="card"><h2>Pro 転換率</h2><div class="metric">\'+d.conversion_pct+\'%</div></div>\'+' +
    '\'<div class="card"><h2>API エラー率/h</h2><div class="metric">\'+d.api_error_rate_pct+\'%</div></div>\'+' +
    '\'</div>\';' +
    'h+=\'<div class="card"><h2>過去 14 日の DAU</h2><canvas id="chartDau" height="120"></canvas></div>\';' +
    'h+=\'<div class="card"><h2>過去 14 日の Pro 転換</h2><canvas id="chartConv" height="120"></canvas></div>\';' +
    'h+=\'<div class="card"><h2>モニター枠</h2><div class="metric">\'+d.monitor_active+\' / \'+d.monitor_capacity+\'</div></div>\';' +
    'c.innerHTML=h;' +
    'new Chart(document.getElementById("chartDau"),{type:"line",data:{labels:d.history_dates,datasets:[{label:"DAU",data:d.history_dau,borderColor:"#1a2d45",fill:false}]}});' +
    'new Chart(document.getElementById("chartConv"),{type:"bar",data:{labels:d.history_dates,datasets:[{label:"Pro 転換",data:d.history_conv,backgroundColor:"#d04b30"}]}});' +
    '});})();</script></body></html>';
  return HtmlService.createHtmlOutput(html);
}

function buildAdminDashboardJson() {
  var ss = SpreadsheetApp.openById(CONFIG.SS_ID);
  var metricsSheet = ss.getSheetByName('METRICS_DAILY');
  var history = [];
  if (metricsSheet) {
    var rows = metricsSheet.getDataRange().getValues();
    history = rows.slice(Math.max(1, rows.length - 14));
  }
  var historyDates = history.map(function(r){ return Utilities.formatDate(new Date(r[0]),'JST','MM/dd'); });
  var historyDau   = history.map(function(r){ return r[1] || 0; });
  var historyConv  = history.map(function(r){ return r[3] || 0; });
  var today = computeMetricsToday();
  return {
    dau: today.dau,
    trial_completion_pct: today.trial_completion_pct,
    conversion_pct: today.conversion_pct,
    api_error_rate_pct: today.api_error_rate_pct,
    monitor_active: getActiveMonitorCount(),
    monitor_capacity: MONITOR_CONFIG.CAPACITY,
    history_dates: historyDates,
    history_dau: historyDau,
    history_conv: historyConv
  };
}

function computeMetricsToday() {
  var ss = SpreadsheetApp.openById(CONFIG.SS_ID);
  var usersSheet = ss.getSheetByName('USERS');
  if (!usersSheet) return { dau: 0, trial_completion_pct: 0, conversion_pct: 0, api_error_rate_pct: 0 };
  var users = usersSheet.getDataRange().getValues();
  var now = new Date();
  var dayMs = 24 * 60 * 60 * 1000;
  var dau = 0, scStarted = 0, scCompleted = 0, purchased = 0;
  for (var i = 1; i < users.length; i++) {
    var userId = users[i][0]; if (!userId) continue;
    var stepSentAt   = users[i][4] ? new Date(users[i][4]) : null;
    var registeredAt = users[i][5] ? new Date(users[i][5]) : null;
    var scenarioId   = users[i][2];
    var stepNum      = parseInt(users[i][3]) || 0;
    if (stepSentAt && (now - stepSentAt) < dayMs) dau++;
    if (registeredAt && (now - registeredAt) < (30 * dayMs)) {
      if (scenarioId === 'SC-MAIN' || scenarioId === 'SC-PARENT' || scenarioId === 'SC-STUDENT' || scenarioId === 'SC-ADULT') {
        scStarted++;
        if (stepNum >= 2 || hasTag(userId, 'read_s2')) scCompleted++;
        if (hasTag(userId, 'purchased')) purchased++;
      }
    }
  }
  return {
    dau: dau,
    trial_completion_pct: scStarted > 0 ? Math.round(scCompleted * 100 / scStarted) : 0,
    conversion_pct: scCompleted > 0 ? Math.round(purchased * 100 / scCompleted) : 0,
    api_error_rate_pct: 0
  };
}

function snapshotDailyMetrics() {
  var ss = SpreadsheetApp.openById(CONFIG.SS_ID);
  var sheet = ss.getSheetByName('METRICS_DAILY') || ss.insertSheet('METRICS_DAILY');
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['date','dau','trial_completion_pct','conversion_pct','api_error_rate_pct','monitor_active']);
    sheet.getRange(1,1,1,6).setBackground('#1a2d45').setFontColor('#fff').setFontWeight('bold');
  }
  var m = computeMetricsToday();
  var monActive = getActiveMonitorCount();
  sheet.appendRow([new Date(), m.dau, m.trial_completion_pct, m.conversion_pct, m.api_error_rate_pct, monActive]);

  if (m.api_error_rate_pct > 5) {
    notifyAlert('[Alert] LINE API エラー率 ' + m.api_error_rate_pct + '% (>5%)', 'all');
  }
  var allRows = sheet.getDataRange().getValues();
  if (allRows.length >= 3) {
    var yesterday = allRows[allRows.length - 2];
    var yesterdayDau = yesterday[1] || 0;
    if (yesterdayDau > 0 && m.dau < yesterdayDau * 0.5) {
      notifyAlert('[Alert] DAU 前日比 -50% 超 (' + yesterdayDau + ' → ' + m.dau + ')', 'slack');
    }
  }
  if (monActive >= MONITOR_CONFIG.CAPACITY - 1) {
    notifyAlert('[Alert] モニター枠 ' + monActive + '/' + MONITOR_CONFIG.CAPACITY + ' (あと1枠)', 'slack');
  }
}

// ----------------------------------------
// Alert
// ----------------------------------------
function notifyAlert(message, channel) {
  channel = channel || 'all';
  if (channel === 'all' || channel === 'line') {
    var ownerUid = getProp('OWNER_LINE_USER_ID');
    if (ownerUid) {
      try { sendPushMessage(ownerUid, '[sho eigo alert]\n' + message); } catch(e) { Logger.log('LINE alert failed: ' + e); }
    }
  }
  if (channel === 'all' || channel === 'slack') {
    var slackUrl = getProp('SLACK_WEBHOOK_URL');
    if (slackUrl) {
      try {
        UrlFetchApp.fetch(slackUrl, {
          method: 'post',
          headers: { 'Content-Type': 'application/json' },
          payload: JSON.stringify({ text: message }),
          muteHttpExceptions: true
        });
      } catch(e) { Logger.log('Slack alert failed: ' + e); }
    }
  }
}

// ----------------------------------------
// D-1 cron: トライアル離脱ナッジ
// ----------------------------------------
function nudgeTrialDropouts() {
  var ss = SpreadsheetApp.openById(CONFIG.SS_ID);
  var usersSheet = ss.getSheetByName('USERS');
  if (!usersSheet) return;
  var users = usersSheet.getDataRange().getValues();
  var now = new Date();
  var sentCount = 0;
  for (var i = 1; i < users.length; i++) {
    var userId = users[i][0]; if (!userId) continue;
    var scenarioId = users[i][2];
    var stepNum    = parseInt(users[i][3]) || 0;
    var stepSentAt = users[i][4] ? new Date(users[i][4]) : null;
    if (scenarioId !== 'SC-MAIN') continue;
    if (stepNum < 2)              continue;  // step 1 (Day 2 案内) 配信済みのみ対象
    if (!stepSentAt)              continue;
    var hoursSince = (now - stepSentAt) / (60 * 60 * 1000);
    if (hoursSince < 24 || hoursSince > 48) continue;
    if (hasTag(userId, 'read_s1'))      continue;
    if (hasTag(userId, 'nudge_sent_d1')) continue;
    if (hasTag(userId, 'purchased') || hasTag(userId, 'deleted') || hasTag(userId, 'dormant')) continue;

    var displayName = users[i][1] || '';
    var prompt =
      '英語学習サービスのトライアル離脱ユーザーに送る短い再起動メッセージを 1 つだけ書いてください。\n' +
      '制約:\n' +
      '- 100 字以内\n' +
      '- 押し付けがましくない柔らかいトーン\n' +
      '- 「Day 2 はこちら」リンクは別途付くので含めない\n' +
      '- 名前は使わない\n';
    var result = callClaudeApi(prompt, { maxTokens: 120 });
    var nudgeText = '昨日のメッセージ、届いてますか。\nDay 2 のリンク、置いておきます。\n気が向いたタイミングでどうぞ。';
    if (!result.error && result.text) nudgeText = result.text.trim();

    sendPushMessage(userId, nudgeText + '\n\n▼ Day 2 はこちら\nhttps://sho-blog.com/all/trial/trial_day2.html');
    addTag(userId, 'nudge_sent_d1');
    sentCount++;
    Utilities.sleep(500);
    if (sentCount >= 30) break;
  }
  Logger.log('nudgeTrialDropouts: ' + sentCount + ' messages sent');
  if (sentCount > 0) notifyAlert('[D-1 cron] nudge sent: ' + sentCount, 'slack');
}

// ----------------------------------------
// 週次保護者レポート (保護者プランの差別化機能, 毎週日曜 9:00)
// テーマ: 「音声学習は、思い出になる」
// ----------------------------------------
function weeklyParentReport() {
  var ss = SpreadsheetApp.openById(CONFIG.SS_ID);
  var usersSheet = ss.getSheetByName('USERS');
  if (!usersSheet) return;
  var users = usersSheet.getDataRange().getValues();
  var sevenDayMs = 7 * 24 * 60 * 60 * 1000;
  var since = new Date(Date.now() - sevenDayMs);

  // 過去 7 日の click / ai_writing を一旦 in-memory に集約
  var clickByUser = {};
  var clickSheet = ss.getSheetByName('CLICK_LOG');
  if (clickSheet) {
    var rows = clickSheet.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      var at = rows[i][3] ? new Date(rows[i][3]) : null;
      if (!at || at < since) continue;
      var uid = rows[i][0];
      clickByUser[uid] = (clickByUser[uid] || 0) + 1;
    }
  }

  var fbByUser = {};
  var fbSheet = ss.getSheetByName('FEEDBACK_LOG');
  if (fbSheet) {
    var fbRows = fbSheet.getDataRange().getValues();
    for (var j = 1; j < fbRows.length; j++) {
      var fAt = fbRows[j][3] ? new Date(fbRows[j][3]) : null;
      if (!fAt || fAt < since) continue;
      if (fbRows[j][1] !== 'ai_writing') continue;
      var fUid = fbRows[j][0];
      fbByUser[fUid] = (fbByUser[fUid] || 0) + 1;
    }
  }

  var sentCount = 0;
  for (var k = 1; k < users.length; k++) {
    var userId = users[k][0]; if (!userId) continue;
    if (!hasTag(userId, 'purchased_plan_family')) continue;
    if (hasTag(userId, 'deleted')) continue;

    var clicks = clickByUser[userId] || 0;
    var aiCount = fbByUser[userId] || 0;
    var displayName = users[k][1] || '保護者';

    // 「音声学習は、思い出になる」テーマで保護者向けレポートを生成
    var prompt =
      'sho eigo の「保護者プラン」を契約している ' + displayName + ' さん向けに、過去 7 日間の振り返りメッセージを書いてください。\n\n' +
      'コンセプト: 「音声学習は、思い出になる」\n' +
      '英語の上達を測るレポートではなく、お子さんがその週に英語に向き合った時間を、後から振り返れる「ことば」として残すのが目的。\n\n' +
      '事実:\n' +
      '- 配信教材へのアクセス: ' + clicks + ' 回\n' +
      '- AI 添削 (英作文 1 行): ' + aiCount + ' 回\n\n' +
      '形式 (300 字以内、日本語、保護者目線):\n' +
      '・最初の 1 行: 今週を一言で表すフレーズ (例:「今週、お子さんは○○な週でした」)\n' +
      '・中盤: 数字を 1〜2 個、自然に織り込む。事実だけでなく「その時間に何があったか」を想像できる温度感で。\n' +
      '・最後: 1 文だけ、来週も並走する保護者へのねぎらい。\n\n' +
      '禁則: 「上達」「成長」のような評価語は控えめに。代わりに「向き合った」「触れた」「重ねた」を使う。\n' +
      '「お子さん」という呼び方で。';

    var result = callClaudeApi(prompt, { maxTokens: 500 });
    var reportText;
    if (result.error || !result.text) {
      reportText =
        '今週、お子さんは英語に ' + clicks + ' 回触れて、AI 添削を ' + aiCount + ' 回やりました。\n\n' +
        '一回一回が、後から振り返れる時間になります。\n' +
        '来週も並走、よろしくお願いします。';
    } else {
      reportText = result.text.trim();
    }

    sendPushMessage(userId, '【保護者プラン 週次レポート】\n' + Utilities.formatDate(new Date(), 'JST', 'yyyy/MM/dd') + '\n音声学習は、思い出になる。\n\n' + reportText);
    sentCount++;
    Utilities.sleep(500);
    if (sentCount >= 50) break;  // 1 回の cron で最大 50 通
  }
  Logger.log('weeklyParentReport: ' + sentCount + ' reports sent');
  if (sentCount > 0) notifyAlert('[週次レポート] ' + sentCount + ' 件送信', 'slack');
}

// ----------------------------------------
// シェア用テキスト配信 cron (Day 2 完了直後、24h 以内、毎日 12:00 JST)
// 「体験が良かったら誰かに話したくなる」瞬間を逃さない
// ----------------------------------------
function shareTextForDay2Completers() {
  var ss = SpreadsheetApp.openById(CONFIG.SS_ID);
  var tagsSheet = ss.getSheetByName('TAGS');
  if (!tagsSheet) return;
  var tags = tagsSheet.getDataRange().getValues();
  var now = new Date();
  var dayMs = 24 * 60 * 60 * 1000;

  // read_s1 タグが過去 24h 以内に付いたユーザーを集める
  var recentReaders = [];
  for (var i = 1; i < tags.length; i++) {
    if (tags[i][1] !== 'read_s1') continue;
    var addedAt = tags[i][2] ? new Date(tags[i][2]) : null;
    if (!addedAt) continue;
    if ((now - addedAt) > dayMs) continue;
    recentReaders.push(tags[i][0]);
  }
  if (recentReaders.length === 0) {
    Logger.log('shareTextForDay2Completers: no recent Day 2 clickers');
    return;
  }

  var sentCount = 0;
  for (var k = 0; k < recentReaders.length; k++) {
    var userId = recentReaders[k];
    if (hasTag(userId, 'share_text_sent')) continue;
    if (hasTag(userId, 'deleted')) continue;
    if (hasTag(userId, 'purchased')) continue;  // Pro ユーザーには別フロー

    // Claude で「コピペ歓迎」のシェア文 1 つを生成
    var prompt =
      'sho eigo の 2 日無料体験を完走した直後のユーザーが、SNS や友人に体験を共有するときに使えそうな短い「ことば」を 1 つだけ書いてください。\n\n' +
      '制約:\n' +
      '- 60 字以内\n' +
      '- 「英語の音」「ワラ (water)」「ターニラフ (turn it off)」のいずれかに触れる\n' +
      '- 押し売りや商品名は書かない\n' +
      '- 体験者の独白、もしくは小さな気づきの形で\n' +
      '- 過剰な絵文字は使わない (1 個までなら可)\n\n' +
      '出力形式: ことば 1 行のみ、引用符不要、前後に説明不要';
    var result = callClaudeApi(prompt, { maxTokens: 120 });
    var quote = (result && result.text) ? result.text.trim().split('\n')[0] : 'water は「ワラ」だった。英語の音の正体を見たら、世界が変わった。';

    var msg =
      'Day 2 まで触れてくれてありがとう。\n\n' +
      'もし誰かにこの体験を話すなら、\nこんな言葉が伝わるかも:\n\n' +
      '「' + quote + '」\n\n' +
      'コピペ歓迎です。\n（友人を誘ってもらえると嬉しいです）';

    sendPushMessage(userId, msg);
    addTag(userId, 'share_text_sent');
    sentCount++;
    Utilities.sleep(500);
    if (sentCount >= 30) break;
  }
  Logger.log('shareTextForDay2Completers: ' + sentCount + ' share texts sent');
  if (sentCount > 0) notifyAlert('[Share cron] ' + sentCount + ' share texts sent', 'slack');
}

// ----------------------------------------
// 月次成長アルバム (保護者プラン、毎月 1 日 9:00 JST)
// テーマ: 「音声学習は、思い出になる」
// 過去 30 日のクリック / AI 添削 / シナリオ進捗を 1 通の長文「アルバム」にして送信
// ----------------------------------------
function monthlyParentAlbum() {
  var ss = SpreadsheetApp.openById(CONFIG.SS_ID);
  var usersSheet = ss.getSheetByName('USERS');
  if (!usersSheet) return;
  var users = usersSheet.getDataRange().getValues();
  var since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // 30 日のシグナル収集
  var clickByUser = {};
  var clickPeakByUser = {};  // userId → { day: 'MM/dd', count: n }
  var clickSheet = ss.getSheetByName('CLICK_LOG');
  if (clickSheet) {
    var rows = clickSheet.getDataRange().getValues();
    var perDay = {};  // userId → { dayKey: count }
    for (var i = 1; i < rows.length; i++) {
      var at = rows[i][3] ? new Date(rows[i][3]) : null;
      if (!at || at < since) continue;
      var uid = rows[i][0];
      clickByUser[uid] = (clickByUser[uid] || 0) + 1;
      var dayKey = Utilities.formatDate(at, 'JST', 'MM/dd');
      perDay[uid] = perDay[uid] || {};
      perDay[uid][dayKey] = (perDay[uid][dayKey] || 0) + 1;
    }
    Object.keys(perDay).forEach(function(uid) {
      var entries = Object.entries(perDay[uid]);
      entries.sort(function(a, b) { return b[1] - a[1]; });
      if (entries.length) clickPeakByUser[uid] = { day: entries[0][0], count: entries[0][1] };
    });
  }

  var aiHighlights = {};  // userId → [{ text, day }]
  var fbSheet = ss.getSheetByName('FEEDBACK_LOG');
  if (fbSheet) {
    var fbRows = fbSheet.getDataRange().getValues();
    for (var j = 1; j < fbRows.length; j++) {
      if (fbRows[j][1] !== 'ai_writing') continue;
      var fAt = fbRows[j][3] ? new Date(fbRows[j][3]) : null;
      if (!fAt || fAt < since) continue;
      var fUid = fbRows[j][0];
      var content = fbRows[j][2] || '';
      var firstLine = content.split('\n')[1] || content.split('\n')[0] || '';  // "原文:" の次の行
      aiHighlights[fUid] = aiHighlights[fUid] || [];
      if (aiHighlights[fUid].length < 3) {
        aiHighlights[fUid].push({
          text: firstLine.substr(0, 60),
          day: Utilities.formatDate(fAt, 'JST', 'MM/dd')
        });
      }
    }
  }

  var sentCount = 0;
  for (var k = 1; k < users.length; k++) {
    var userId = users[k][0]; if (!userId) continue;
    if (!hasTag(userId, 'purchased_plan_family')) continue;
    if (hasTag(userId, 'deleted')) continue;

    var totalClicks = clickByUser[userId] || 0;
    var peak = clickPeakByUser[userId];
    var highlights = aiHighlights[userId] || [];
    var displayName = users[k][1] || '保護者';
    var monthLabel = Utilities.formatDate(new Date(Date.now() - 24 * 60 * 60 * 1000), 'JST', 'yyyy 年 M 月');

    // Claude で「思い出アルバム」風メッセージ
    var prompt =
      'sho eigo の「保護者プラン」を契約している ' + displayName + ' さん向けに、' + monthLabel + ' の「思い出アルバム」を書いてください。\n\n' +
      'コンセプト: 「音声学習は、思い出になる」\n' +
      '上達ではなく、お子さんが英語に触れた時間そのものを残す。1 年後にこの月を読み返して、その時の家庭の風景がよみがえることを目指します。\n\n' +
      '今月の事実:\n' +
      '- 配信教材アクセス回数: ' + totalClicks + ' 回\n' +
      (peak ? '- 一番触れた日: ' + peak.day + ' (' + peak.count + ' 回)\n' : '') +
      '- AI 添削で書いた英文 (抜粋): ' + (highlights.length ? highlights.map(function(h){ return '「' + h.text + '」(' + h.day + ')'; }).join(', ') : 'なし') + '\n\n' +
      '形式 (450 字以内、日本語、保護者目線、温度感重視):\n' +
      '・冒頭: 「' + monthLabel + 'の音声アルバム」のような 1 行タイトル\n' +
      '・1 段落目: 今月の様子を一言で。数字は 1〜2 個さりげなく。\n' +
      '・2 段落目: 抜粋した英文があれば、その 1 つを引用しつつ、書いた瞬間のお子さんを保護者に想像させる文。なければ 1 行で省略。\n' +
      '・3 段落目: 来月への並走の言葉。1 文だけ。\n' +
      '・末尾: 「— sho より」と添える。\n\n' +
      '禁則: 「成長」「上達」を 2 回以上使わない。代わりに「触れた」「重ねた」「向き合った」「残った」を使う。';

    var result = callClaudeApi(prompt, { maxTokens: 700, model: 'claude-haiku-4-5-20251001' });
    var albumText;
    if (result.error || !result.text) {
      albumText =
        monthLabel + 'の音声アルバム\n\n' +
        'お子さんは今月、' + totalClicks + ' 回 sho の配信に触れました。\n' +
        (peak ? '一番熱心だった日は ' + peak.day + ' でした。\n\n' : '\n') +
        (highlights.length ? '書いた英文の中から:\n「' + highlights[0].text + '」(' + highlights[0].day + ')\n\n' : '') +
        '来月もこの時間が、後から振り返れる思い出として残るように、並走します。\n\n— sho より';
    } else {
      albumText = result.text.trim();
    }

    sendPushMessage(userId, '【月次成長アルバム】\n音声学習は、思い出になる。\n\n' + albumText);
    sentCount++;
    Utilities.sleep(800);
    if (sentCount >= 50) break;
  }
  Logger.log('monthlyParentAlbum: ' + sentCount + ' albums sent');
  if (sentCount > 0) notifyAlert('[月次アルバム] ' + sentCount + ' 件送信', 'all');
}

// ----------------------------------------
// Trigger setup (extend)
// ----------------------------------------
function setupAllTriggers() {
  setupTrigger();  // 既存の checkAndSendScheduled (毎時)
  ScriptApp.getProjectTriggers().forEach(function(t) {
    var fn = t.getHandlerFunction();
    if (fn === 'snapshotDailyMetrics' || fn === 'nudgeTrialDropouts' ||
        fn === 'weeklyParentReport' || fn === 'monthlyParentAlbum' ||
        fn === 'shareTextForDay2Completers') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('snapshotDailyMetrics')        .timeBased().atHour(23).nearMinute(55).everyDays(1).create();
  ScriptApp.newTrigger('nudgeTrialDropouts')          .timeBased().atHour(21).everyDays(1).create();
  ScriptApp.newTrigger('shareTextForDay2Completers')  .timeBased().atHour(12).everyDays(1).create();
  ScriptApp.newTrigger('weeklyParentReport')          .timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(9).create();
  ScriptApp.newTrigger('monthlyParentAlbum')          .timeBased().onMonthDay(1).atHour(9).create();
  Logger.log('全トリガー設定完了 (checkAndSendScheduled + snapshotDailyMetrics + nudgeTrialDropouts + shareTextForDay2Completers + weeklyParentReport + monthlyParentAlbum)');
}

// ----------------------------------------
// 1 回だけ実行する初期セットアップ helper
// ----------------------------------------
// Apps Script Editor で実行すると、必要な Sheets と全 trigger を一括で用意する。
// Script Properties は手動で UI から設定すること (このスクリプトには値を持たない)。
function setupEverything() {
  setupSheets();
  setupAllTriggers();
  Logger.log('Setup complete. 残りは Script Properties (Stripe / Anthropic / Slack / ADMIN_TOKEN) を手動で設定してください。');
  Logger.log('必須プロパティ一覧: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_URL_SECRET, STRIPE_PRICE_PERSONAL, STRIPE_PRICE_FAMILY, STRIPE_PRICE_CORP, ANTHROPIC_API_KEY, ADMIN_TOKEN');
  Logger.log('推奨プロパティ: SLACK_WEBHOOK_URL, OWNER_LINE_USER_ID, LINE_RICHMENU_PRO_ID, ALLOWED_TEST_UIDS, LIVE_OPEN_AFTER');
}

// 全プロパティ設定状況をまとめてチェックする (本番リリース前のヘルスチェック)
function checkProductionReadiness() {
  var required = ['STRIPE_SECRET_KEY','STRIPE_WEBHOOK_URL_SECRET','STRIPE_PRICE_PERSONAL','STRIPE_PRICE_FAMILY','STRIPE_PRICE_CORP','ANTHROPIC_API_KEY','ADMIN_TOKEN'];
  var recommended = ['SLACK_WEBHOOK_URL','OWNER_LINE_USER_ID','LINE_RICHMENU_PRO_ID','ALLOWED_TEST_UIDS','LIVE_OPEN_AFTER'];
  var props = PropertiesService.getScriptProperties();
  var missingRequired = [];
  var missingRecommended = [];
  required.forEach(function(k){ if (!props.getProperty(k)) missingRequired.push(k); });
  recommended.forEach(function(k){ if (!props.getProperty(k)) missingRecommended.push(k); });

  var triggers = ScriptApp.getProjectTriggers();
  var triggerNames = triggers.map(function(t){ return t.getHandlerFunction(); });
  var requiredTriggers = ['checkAndSendScheduled','snapshotDailyMetrics','nudgeTrialDropouts','weeklyParentReport','monthlyParentAlbum','shareTextForDay2Completers'];
  var missingTriggers = requiredTriggers.filter(function(t){ return triggerNames.indexOf(t) === -1; });

  var ss = SpreadsheetApp.openById(CONFIG.SS_ID);
  var requiredSheets = ['USERS','TAGS','CLICK_LOG','SURVEY_LOG','FEEDBACK_LOG','MONITORS'];
  var missingSheets = requiredSheets.filter(function(s){ return !ss.getSheetByName(s); });

  Logger.log('=== Production Readiness Check ===');
  Logger.log('Missing required properties: ' + (missingRequired.length === 0 ? 'NONE' : missingRequired.join(', ')));
  Logger.log('Missing recommended properties: ' + (missingRecommended.length === 0 ? 'NONE' : missingRecommended.join(', ')));
  Logger.log('Missing triggers: ' + (missingTriggers.length === 0 ? 'NONE' : missingTriggers.join(', ')));
  Logger.log('Missing sheets: ' + (missingSheets.length === 0 ? 'NONE' : missingSheets.join(', ')));
  Logger.log('Ready: ' + (missingRequired.length === 0 && missingTriggers.length === 0 && missingSheets.length === 0 ? 'YES ✅' : 'NO ❌'));
}
