// ============================================================
// sho eigo — LINE自動化システム（GAS完全版）
// ProLine代替 / GAS + Google Sheets + LINE Messaging API
// ============================================================

const CONFIG = {
  LINE_TOKEN: 'YOUR_LINE_CHANNEL_ACCESS_TOKEN',
  SS_ID: 'YOUR_SPREADSHEET_ID',
  GAS_URL: 'YOUR_GAS_DEPLOY_URL',
  ADMIN_EMAIL: '',
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
    logError('doPost', err);
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
  // Stripe Customer Portal (解約・カード変更)
  if (e && e.parameter && e.parameter.action === 'portal') {
    var puid = e.parameter.uid || '';
    if (!puid) {
      return HtmlService.createHtmlOutput('<h1>uid が必要です</h1><p>LINE で「解約」とお送りください。</p>');
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

  // Stripe Checkout 起動 (next-step.html / payment/index.html から飛んでくる)
  if (e && e.parameter && e.parameter.action === 'checkout') {
    var plan = e.parameter.plan || '';
    var uid  = e.parameter.uid || '';
    if (!uid) {
      return HtmlService.createHtmlOutput('<h1>uid が必要です</h1><p>LINE Bot のメッセージから「プラン選択」をタップしてください。</p>');
    }
    var result = createCheckoutSession(uid, plan);
    if (result && result.url) {
      return HtmlService.createHtmlOutput(
        '<script>window.location.replace("' + result.url.replace(/"/g, '&quot;') + '")</script>'
      );
    }
    var msg = (result && result.error === 'stripe_not_configured') ?
      'プランの準備中です。少しお待ちください。' :
      '決済画面の準備中にエラーが発生しました。少し時間をおいてからお試しください。';
    return HtmlService.createHtmlOutput('<h1>準備中</h1><p>' + msg + '</p>');
  }

  // 既存: tracking redirect
  const userId    = e.parameter.uid  || '';
  const tag       = e.parameter.tag  || '';
  const redirectUrl = e.parameter.url || 'https://sho-blog.com/trial/day1.html';

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

function handleMessage(event) {
  const userId = event.source.userId;
  const text   = (event.message && event.message.text) || '';

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

  // 解約 / キャンセル: Stripe Customer Portal に誘導 (購入者のみ)
  if (text.indexOf('解約') !== -1 || text.indexOf('キャンセル') !== -1 || text.toLowerCase() === 'cancel') {
    if (hasTag(userId, 'purchased')) {
      var portalUrl = (CONFIG.GAS_URL && CONFIG.GAS_URL.indexOf('http') === 0)
        ? CONFIG.GAS_URL + '?action=portal&uid=' + encodeURIComponent(userId)
        : 'https://sho-blog.com/next-step.html';
      replyMessage(event.replyToken, '解約・カード情報の変更は下記のお客様ポータルから行えます。\n\n' + portalUrl);
      return;
    }
  }

  // 親子体験への導線
  if (text.indexOf('親子') !== -1) {
    replyMessage(event.replyToken, '▼ 親子体験 (音で残す成長のアルバム)\nhttps://sho-blog.com/trial/parent_lp.html\n\n小1〜高3 のお子さんと、2 日間で英語の音を変える体験ができます。');
    return;
  }

  // UI/UX カスタマイズ相談 (保護者プラン契約者向け、人手で受ける)
  if (text.indexOf('カスタマイズ') !== -1) {
    var planTag = hasTag(userId, 'purchased_plan_parent') ? '保護者プラン契約者' :
                  hasTag(userId, 'purchased') ? 'L プラン契約者' : '体験中';
    addTag(userId, 'customize_request');
    replyMessage(event.replyToken,
      'カスタマイズのご相談ありがとうございます。\n\n専任アドバイザー (sho) が承りました。\n以下を簡単に教えていただけますか:\n\n1. お子さんの学年 (例: 小4)\n2. 一番気になっている英語の困りごと\n3. レポート / アルバムで「もっとこうしたい」点があれば\n\n3 営業日以内にご提案を返信します。');
    return;
  }

  const keywords = {
    '体験':  '▼ 2日間無料体験はこちら\nhttps://sho-blog.com/trial/day1.html',
    'day1':  '▼ 体験Day 1\nhttps://sho-blog.com/trial/day1.html',
    'day2':  '▼ 体験Day 2\nhttps://sho-blog.com/trial/day2.html',
    'プラン': '▼ プランの詳細\nhttps://sho-blog.com/next-step.html',
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
    try {
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
      Utilities.sleep(200);
    } catch(err) {
      logError('checkAndSendScheduled', err, { userId: userId, scenarioId: scenarioId, stepNum: stepNum });
    }
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

// ------------------------------------------------------------
// Deletion-flow consolidation (2026-05-02)
//
// Two competing designs existed:
//   - SC-DELETE-NOTICE  : merged in PR #2 (already in production).
//                         4 steps over ~7 days (Day 0/3/6/7),
//                         logical deletion via the 'deleted' tag,
//                         DELETION_LOG schema = [userId, deletedAt, reason],
//                         reactivation via the existing quiz_* postback
//                         (sets the 'reactivated' tag, skipIfTag honors it).
//   - SC-DELETION       : proposed in PR #1 (open, NOT merged).
//                         4 steps over 30 days (T-30/7/3/0),
//                         physical row deletion of USERS + TAGS,
//                         DELETION_LOG schema = [userId, deletedAt],
//                         reactivation via a dedicated 'keep_account'
//                         postback button on every step.
//
// Decision: keep SC-DELETE-NOTICE as-is. It is already shipped, it is
// non-destructive (logical deletion preserves audit history and is
// reversible), and reactivation is wired to the existing quiz path so
// no new postback handler is required. PR #1 is superseded by this
// consolidation; closure recommended pending owner approval.
//
// If a longer 30-day cooldown is later desired, prefer extending
// SC-DELETE-NOTICE delays here rather than swapping in physical
// deletion — keep DELETION_LOG's [userId, deletedAt, reason] schema
// stable so existing rows remain valid.
// ------------------------------------------------------------
const SCENARIOS_DATA = {
  'SC-MAIN': [
    { stepNum: 0, delayDays: 0, sendHour: 0, trackingTag: 'read_s0',
      message: 'はじめまして、翔也です。\n\nsho eigoのLINEに\n来てくれてありがとうございます。\n\n最初に一つだけ聞かせてください。\n\n「water」って頭の中でどう聞こえますか？\n\n「ウォーター」と浮かぶなら\nそれが今日の話の出発点です。\n\nwaterの本物の音は「ワラ」です。\n\n▼ 続きを無料体験で\nhttps://sho-blog.com/trial/day1.html' },
    { stepNum: 1, delayDays: 1, sendHour: 6, trackingTag: 'read_s1',
      message: 'おはようございます。\n\nDay 2 が今日から始められます。\n\n昨日と同じ文章をもう一度聴いたとき\n「あ、さっきより聴こえる」\nという感覚が来るかもしれません。\n\n▼ Day 2 はこちら\nhttps://sho-blog.com/trial/day2.html' },
    { stepNum: 2, delayDays: 2, sendHour: 8, trackingTag: 'read_s2', sendSurvey: true,
      message: '少しだけ教えていただけますか。\n\nあなたのことを知ることで\nお届けする情報をより役立てます。\n\n下のボタンからお答えください。' },
    { stepNum: 3, delayDays: 5, sendHour: 8, trackingTag: 'read_s3',
      message: '声に出してみてください。\n\n「turn it off」\n\nこれ、実は「ターニラフ」と読みます。\n単語がつながって全然別の音になる。\nこれがLinkingという現象です。\n\n▼ 体験で音の違いを確かめる\nhttps://sho-blog.com/trial/day1.html' },
  ],
  'SC-PARENT': [
    { stepNum: 0, delayDays: 0, sendHour: 8, trackingTag: 'read_p0',
      message: 'はじめまして、翔也です。\n\n親子体験を試してくれてありがとうございます。\n\nお子さんの英語が変わる音を、アルバムに残す。\nそんなコンセプトで作っています。\n\n明日から 5 日間にわたって、保護者プランの「見本」を 3 通お届けします。\n\n▼ 親子体験 (まだの方)\nhttps://sho-blog.com/trial/parent_lp.html' },
    { stepNum: 1, delayDays: 1, sendHour: 7, trackingTag: 'read_p1',
      message: '【週次レポート見本】\n\n〇〇くんの今週の英語の音\n（保護者プランで毎週日曜の朝に届くレポートの見本です）\n\n✨ 今週の変化\n・water の発音が「ウォーター」→「ワラ」に近づいてきました\n・連続発音 (Linking) を 3 回試して、3 回目で成功\n・録音時間: 累計 47 分\n\n🎵 今週の声のハイライト\n日曜日の朝に録音した「I have a little brother」\nリズムが自然になっています。\n\n📝 来週のおすすめ\nシャドーイング訓練講座の Day 3-4 を続けてみましょう。\nFlap T が中心のレッスンです。\n\n―――――――――――――――――――\nこれは「保護者プラン」に加入すると毎週届くレポートの見本です。実際のレポートはお子さんの学習データから自動生成されます。' },
    { stepNum: 2, delayDays: 2, sendHour: 8, trackingTag: 'read_p2',
      message: '【月初の思い出アルバム見本】\n\n〇〇くん 今月のアルバム\n（保護者プランで毎月 1 日に届くアルバムの見本です）\n\n🎵 今月の声 (1 日 vs 30 日)\n[音声リンク 2 つを想定]\n\n📊 30 日間の歩み\n・完了レッスン: 28 日 / 30 日\n・録音時間: 累計 4 時間 12 分\n・一番難しかった音: Flap T (ワラ・ベラ)\n・一番自信がついた音: Linking\n\n✏️ エピソード\n初めてレッスンを「もう 1 回やる」と言った日。そこから音が変わり始めました。お母さんに自分から「今日の英語聴いて」と言うように。\n\n―――――――――――――――――――\nこれは「保護者プラン」に加入すると毎月届くアルバムの見本です。お子さんの実際の録音と、振り返りが含まれます。' },
    { stepNum: 3, delayDays: 2, sendHour: 9, trackingTag: 'read_p3',
      message: '体験から 5 日たちました。\nお子さんと一緒に聴いた録音は、まだ覚えていますか？\n\n毎日続けると、毎月こうなります。\n・30 日後 → アルバム 1 冊\n・6 ヶ月後 → アルバム 6 冊\n・1 年後 → 子どもの声の歴史\n\n▼ 保護者プランで続ける\nhttps://sho-blog.com/next-step.html?from=parent\n\n▼ L1〜L3 で続ける (レポート・アルバムなし)\nhttps://sho-blog.com/next-step.html\n\n迷ったら、最初は L3 (¥3,980) で始めて、あとから保護者プランに切り替えることもできます。' },
  ],
  'SC-STUDENT': [
    { stepNum: 0, delayDays: 0, sendHour: 8, trackingTag: 'read_st1',
      message: '英検のリスニングで\n「知ってるはずの単語が聴こえない」\n\nこれ、単語力の問題じゃないんです。\n\n音の設定がずれているだけ。\n音を直せば、知っている単語が聴こえます。\n\n▼ 体験で確認する\nhttps://sho-blog.com/trial/day1.html' },
    { stepNum: 1, delayDays: 3, sendHour: 8, trackingTag: 'read_st2',
      message: '音の土台を作った人の\n半年後・1年後の伸び方は変わります。\n\n遠回りに見えて一番近道です。\n\n▼ 体験で音の基礎を確かめる\nhttps://sho-blog.com/trial/day1.html' },
  ],
  'SC-ADULT': [
    { stepNum: 0, delayDays: 0, sendHour: 8, trackingTag: 'read_a1',
      message: '1日15〜20分あれば変わります。\n\n通勤の電車の中、昼休みの15分。\n音を体に入れる練習は\n机に向かわなくてもできます。\n\n▼ 20分で体験できます\nhttps://sho-blog.com/trial/day1.html' },
    { stepNum: 1, delayDays: 3, sendHour: 8, trackingTag: 'read_a2',
      message: '「ある日、映画の台詞が聴こえた」\n\n音の基礎ができた人がよく言う言葉です。\n\nその日が来るのを楽しみに続けてほしいです。\n\n▼ 体験はこちら\nhttps://sho-blog.com/trial/day1.html' },
  ],
  'SC-DORMANT': [
    { stepNum: 0, delayDays: 0, sendHour: 8, trackingTag: null, sendQuiz: true,
      message: '突然ですが、クイズです。\n\n「better」の本物の発音はどちら？' },
    { stepNum: 1, delayDays: 7, sendHour: 8, trackingTag: 'read_dormant',
      message: 'お久しぶりです。\n\n気が向いたときに戻ってきてください。\n\n▼ いつでも体験できます\nhttps://sho-blog.com/trial/day1.html' },
  ],
  'SC-MONITOR': [
    { stepNum: 0, delayDays: 0, sendHour: 0, trackingTag: 'read_m0',
      message: 'モニターに参加してくれてありがとうございます。\n翔也です。\n\n10名限定の枠に\n入っていただきました。\n\n■ お渡しするもの\n・1講座 無料プレゼント（参加者全員）\n・口コミを投稿してくれた方には\n　次回サブスク 半額（3ヶ月間）\n\n■ お願いしたいこと\n・14日間、Day 1とDay 2を実際に体験してください\n・5日目と最終日に簡単なアンケートに答えてください\n・気づいたことがあれば「フィードバック」と送るか\n　専用ダッシュボードから提出してください\n\n▼ あなた専用ダッシュボード\n{{DASHBOARD_URL}}\n\nまずは Day 1 から始めましょう。\n\n▼ Day 1 はこちら\nhttps://sho-blog.com/trial/day1.html' },
    { stepNum: 1, delayDays: 1, sendHour: 8, trackingTag: 'read_m1',
      message: 'おはようございます、翔也です。\n\n昨日のDay 1、いかがでしたか。\n\n今日からDay 2 に進めます。\n音の変化が少しずつ\n見えてくる頃です。\n\n▼ Day 2 はこちら\nhttps://sho-blog.com/trial/day2.html' },
    { stepNum: 2, delayDays: 4, sendHour: 8, trackingTag: 'read_m2', sendMonitorMidSurvey: true,
      message: 'モニター開始から5日目です。\n\nここまでの感触を\n簡単に教えてください。\n\n下のボタンから1タップでお答えいただけます。\n\n細かい感想は「フィードバック」と\n送っていただければ\n次のメッセージを記録します。' },
    { stepNum: 3, delayDays: 5, sendHour: 8, trackingTag: 'read_m3',
      message: 'モニター10日目です。\n\nここまでで気づいたこと、\n変化したこと、\n逆に分かりにくかったことなど\n何でも教えてください。\n\n「フィードバック」と送っていただくと\n次のメッセージを記録に残します。\n\n残り4日、引き続きよろしくお願いします。' },
    { stepNum: 4, delayDays: 4, sendHour: 8, trackingTag: 'read_m4', sendMonitorFinalSurvey: true,
      message: 'モニター期間最終日です。\n14日間、本当にありがとうございました。\n\nこの体験の感想を\n短くで構いませんので\n口コミとしていただけませんか。\n\nいただいた方には\n次回サブスクを 半額（3ヶ月）で\nご利用いただけます。\n\n下のボタンからお答えください。' },
  ],
  'SC-DELETE-NOTICE': [
    { stepNum: 0, delayDays: 0, sendHour: 9, trackingTag: 'read_del1', skipIfTag: 'reactivated',
      message: 'お久しぶりです、翔也です。\n\n長くご連絡が取れていないため\n7日後にこのリストから\n自動的に登録解除させていただきます。\n\nもしまだ続けたい気持ちがあれば\n下のリンクから一度反応してください。\n反応があれば解除を取り消します。\n\n▼ 続けたい方はこちら\nhttps://sho-blog.com/trial/day1.html' },
    { stepNum: 1, delayDays: 3, sendHour: 9, trackingTag: 'read_del2', skipIfTag: 'reactivated',
      message: '先日のメッセージ、届いていますか。\n\nあと4日でこのリストから\n自動解除されます。\n\n最後にもう一度だけ\nお声がけしました。\n\n▼ もう一度試してみる\nhttps://sho-blog.com/trial/day1.html' },
    { stepNum: 2, delayDays: 3, sendHour: 9, trackingTag: 'read_del3', skipIfTag: 'reactivated',
      message: '明日、自動的に登録解除します。\n\n今までありがとうございました。\n\nもし「やっぱり続けたい」と\n思ったら明日までに\n下のリンクから反応してください。\n\n▼ 最後のチャンス\nhttps://sho-blog.com/trial/day1.html' },
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

function logError(funcName, err, context) {
  var errStr = String(err) + (err && err.stack ? '\n' + err.stack : '');
  var contextStr = '';
  if (context) {
    try { contextStr = JSON.stringify(context); } catch(e) { contextStr = String(context); }
  }
  try {
    var ss = SpreadsheetApp.openById(CONFIG.SS_ID);
    var sheet = ss.getSheetByName('ERROR_LOG');
    if (!sheet) {
      sheet = ss.insertSheet('ERROR_LOG');
      sheet.appendRow(['timestamp','function','error','context']);
      sheet.getRange(1,1,1,4).setBackground('#1a2d45').setFontColor('#fff').setFontWeight('bold');
    }
    sheet.appendRow([new Date(), funcName, errStr, contextStr]);
  } catch(sheetErr) {
    Logger.log('logError sheet failure: ' + sheetErr + ' | original: ' + funcName + ' ' + errStr);
  }
  try {
    if (CONFIG.ADMIN_EMAIL) {
      var props = PropertiesService.getScriptProperties();
      var lastAt = props.getProperty('last_error_alert_at');
      var now = new Date();
      var shouldSend = true;
      if (lastAt) {
        var diffMs = now.getTime() - new Date(lastAt).getTime();
        if (diffMs < 24 * 60 * 60 * 1000) shouldSend = false;
      }
      if (shouldSend) {
        MailApp.sendEmail({
          to: CONFIG.ADMIN_EMAIL,
          subject: '[sho-eigo] Error in ' + funcName,
          body: 'Function: ' + funcName + '\n\nError:\n' + errStr + '\n\nContext:\n' + contextStr
        });
        props.setProperty('last_error_alert_at', now.toISOString());
      }
    }
  } catch(mailErr) {
    Logger.log('logError mail failure: ' + mailErr);
  }
}

function sendPushMessage(userId, text) {
  if (!text) return;
  try {
    var res = UrlFetchApp.fetch(LINE_API + '/push', {
      method: 'post',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + CONFIG.LINE_TOKEN },
      payload: JSON.stringify({ to: userId, messages: [{ type: 'text', text: text }] }),
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    if (code >= 400) {
      logError('sendPushMessage', new Error('HTTP ' + code + ': ' + res.getContentText()), { userId: userId });
    }
  } catch(err) {
    logError('sendPushMessage', err, { userId: userId });
  }
}

function replyMessage(replyToken, text) {
  if (!text || !replyToken) return;
  try {
    var res = UrlFetchApp.fetch(LINE_API + '/reply', {
      method: 'post',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + CONFIG.LINE_TOKEN },
      payload: JSON.stringify({ replyToken: replyToken, messages: [{ type: 'text', text: text }] }),
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    if (code >= 400) {
      logError('replyMessage', new Error('HTTP ' + code + ': ' + res.getContentText()), { replyToken: replyToken });
    }
  } catch(err) {
    logError('replyMessage', err, { replyToken: replyToken });
  }
}

function sendSurveyButtons(userId) {
  try {
    var res = UrlFetchApp.fetch(LINE_API + '/push', {
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
    var code = res.getResponseCode();
    if (code >= 400) {
      logError('sendSurveyButtons', new Error('HTTP ' + code + ': ' + res.getContentText()), { userId: userId });
    }
  } catch(err) {
    logError('sendSurveyButtons', err, { userId: userId });
  }
}

function sendQuizButtons(userId) {
  try {
    var res = UrlFetchApp.fetch(LINE_API + '/push', {
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
    var code = res.getResponseCode();
    if (code >= 400) {
      logError('sendQuizButtons', new Error('HTTP ' + code + ': ' + res.getContentText()), { userId: userId });
    }
  } catch(err) {
    logError('sendQuizButtons', err, { userId: userId });
  }
}

function getLineProfile(userId) {
  try {
    var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/profile/' + userId, {
      headers: { 'Authorization': 'Bearer ' + CONFIG.LINE_TOKEN }, muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    if (code >= 400) {
      logError('getLineProfile', new Error('HTTP ' + code + ': ' + res.getContentText()), { userId: userId });
      return null;
    }
    return JSON.parse(res.getContentText());
  } catch(err) {
    logError('getLineProfile', err, { userId: userId });
    return null;
  }
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
    'SUMMARY':      ['weekStart','weekEnd','newUsers','totalClicks','readClicks','surveyParent','surveyStudent','surveyAdult','deletions','dormantAdded'],
    'ERROR_LOG':    ['timestamp','function','error','context'],
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

function generateWeeklySummary() {
  var ss = SpreadsheetApp.openById(CONFIG.SS_ID);
  var header = ['weekStart','weekEnd','newUsers','totalClicks','readClicks','surveyParent','surveyStudent','surveyAdult','deletions','dormantAdded'];
  var summarySheet = ss.getSheetByName('SUMMARY') || ss.insertSheet('SUMMARY');
  if (summarySheet.getLastRow() === 0) {
    summarySheet.appendRow(header);
    summarySheet.getRange(1, 1, 1, header.length).setBackground('#1a2d45').setFontColor('#fff').setFontWeight('bold');
  }

  var now = new Date();
  var weekEnd = new Date(now.getTime());
  var weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  var weekStartIso = Utilities.formatDate(weekStart, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var weekEndIso = Utilities.formatDate(weekEnd, Session.getScriptTimeZone(), 'yyyy-MM-dd');

  var inWindow = function(d) {
    if (!d) return false;
    var t = (d instanceof Date) ? d.getTime() : new Date(d).getTime();
    if (isNaN(t)) return false;
    return t >= weekStart.getTime() && t <= weekEnd.getTime();
  };

  var newUsers = 0;
  var usersSheet = ss.getSheetByName('USERS');
  if (usersSheet) {
    var usersData = usersSheet.getDataRange().getValues();
    for (var i = 1; i < usersData.length; i++) {
      if (inWindow(usersData[i][5])) newUsers++;
    }
  }

  var totalClicks = 0;
  var readClicks = 0;
  var clickSheet = ss.getSheetByName('CLICK_LOG');
  if (clickSheet) {
    var clickData = clickSheet.getDataRange().getValues();
    for (var j = 1; j < clickData.length; j++) {
      if (!inWindow(clickData[j][3])) continue;
      totalClicks++;
      var ctag = clickData[j][1];
      if (typeof ctag === 'string' && ctag.indexOf('read_') === 0) readClicks++;
    }
  }

  var surveyParent = 0;
  var surveyStudent = 0;
  var surveyAdult = 0;
  var surveySheet = ss.getSheetByName('SURVEY_LOG');
  if (surveySheet) {
    var surveyData = surveySheet.getDataRange().getValues();
    for (var k = 1; k < surveyData.length; k++) {
      if (!inWindow(surveyData[k][3])) continue;
      var answer = surveyData[k][1];
      if (answer === 'survey_parent') surveyParent++;
      else if (answer === 'survey_student') surveyStudent++;
      else if (answer === 'survey_adult') surveyAdult++;
    }
  }

  var deletions = 0;
  var deletionSheet = ss.getSheetByName('DELETION_LOG');
  if (deletionSheet) {
    var deletionData = deletionSheet.getDataRange().getValues();
    for (var m = 1; m < deletionData.length; m++) {
      if (inWindow(deletionData[m][1])) deletions++;
    }
  }

  var dormantAdded = 0;
  var tagsSheet = ss.getSheetByName('TAGS');
  if (tagsSheet) {
    var tagsData = tagsSheet.getDataRange().getValues();
    for (var n = 1; n < tagsData.length; n++) {
      if (tagsData[n][1] === 'dormant' && inWindow(tagsData[n][2])) dormantAdded++;
    }
  }

  summarySheet.appendRow([weekStartIso, weekEndIso, newUsers, totalClicks, readClicks, surveyParent, surveyStudent, surveyAdult, deletions, dormantAdded]);
  Logger.log('週次サマリー生成完了: ' + weekStartIso + ' 〜 ' + weekEndIso);
}

function setupWeeklyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'generateWeeklySummary') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('generateWeeklySummary')
    .timeBased()
    .everyWeeks(1)
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(9)
    .create();
  Logger.log('週次トリガー設定完了');
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
// v1.1 拡張: Stripe / Welcome audio / ERROR_LOG / 運用ヘルパー
// CLAUDE.md 凍結ルール準拠: 新 cron / AI 添削 / モニター変種は未追加。
// ============================================================

const PRO_PLANS = {
  l1:     { price_jpy: 2980, label: 'L1 Foundation',     stripe_price_id_prop: 'STRIPE_PRICE_L1' },
  l2:     { price_jpy: 3480, label: 'L2 Intermediate',   stripe_price_id_prop: 'STRIPE_PRICE_L2' },
  l3:     { price_jpy: 3980, label: 'L3 Advanced',       stripe_price_id_prop: 'STRIPE_PRICE_L3' },
  parent: { price_jpy: 4980, label: '保護者プラン',       stripe_price_id_prop: 'STRIPE_PRICE_PARENT' }
};

function getProp(name) {
  return PropertiesService.getScriptProperties().getProperty(name) || '';
}

// ----------------------------------------
// Welcome audio (handleFollow 直後)
// ----------------------------------------
function sendWelcomeAudio(userId) {
  if (!userId) return;
  var url = getProp('WELCOME_AUDIO_URL') || 'https://sho-blog.com/trial/audio/sho/day1_step00_ようこそ.mp3';
  var durationMs = parseInt(getProp('WELCOME_AUDIO_DURATION_MS') || '15000', 10);
  try {
    UrlFetchApp.fetch(LINE_API + '/push', {
      method: 'post',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + CONFIG.LINE_TOKEN },
      payload: JSON.stringify({
        to: userId,
        messages: [{ type: 'audio', originalContentUrl: url, duration: durationMs }]
      }),
      muteHttpExceptions: true
    });
    addTag(userId, 'welcome_audio_sent');
  } catch(e) { Logger.log('sendWelcomeAudio error: ' + e); }
}

// ----------------------------------------
// Stripe Checkout
// ----------------------------------------
function createCheckoutSession(userId, plan) {
  if (!userId || !plan) return { error: 'missing_params' };
  if (!PRO_PLANS[plan]) return { error: 'unknown_plan' };
  var stripeKey = getProp('STRIPE_SECRET_KEY');
  if (!stripeKey) return { error: 'stripe_not_configured' };
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
  if (resp.getResponseCode() !== 200) {
    Logger.log('Stripe checkout failed: ' + resp.getResponseCode() + ' ' + resp.getContentText().substr(0, 300));
    logError('createCheckoutSession', 'HTTP ' + resp.getResponseCode(), { plan: plan });
    return { error: 'stripe_api_error', status: resp.getResponseCode() };
  }
  try { var data = JSON.parse(resp.getContentText()); return { url: data.url, id: data.id }; }
  catch(e) { return { error: 'stripe_parse_error' }; }
}

// ----------------------------------------
// Stripe Webhook (URL secret + Stripe API 再 GET の 2 段認証)
// GAS doPost は HTTP ヘッダを取れないため HMAC 検証は使わない
// ----------------------------------------
function verifyStripeWebhookUrlSecret(e) {
  var urlSecret = getProp('STRIPE_WEBHOOK_URL_SECRET');
  if (!urlSecret) return false;
  return ((e && e.parameter && e.parameter.secret) || '') === urlSecret;
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
    logError('reverifyStripeObject', 'HTTP ' + resp.getResponseCode(), { objType: objType, objId: objId });
    return null;
  }
  try { return JSON.parse(resp.getContentText()); } catch(e) { return null; }
}

function handleStripeWebhook(rawBody) {
  var event;
  try { event = JSON.parse(rawBody); } catch(e) { return { ok: false, reason: 'parse_error' }; }
  if (event.type === 'checkout.session.completed') {
    var s = event.data && event.data.object;
    if (!s || !s.id) return { ok: false, reason: 'no_session' };
    var verified = reverifyStripeObject('session', s.id);
    if (!verified || verified.payment_status !== 'paid') {
      logError('handleStripeWebhook', 'reverify failed', { sessionId: s.id });
      return { ok: false, reason: 'reverify_failed' };
    }
    var lineUid = (verified.metadata && verified.metadata.lineUserId) || verified.client_reference_id || '';
    var plan = (verified.metadata && verified.metadata.plan) || '';
    if (lineUid) {
      addTag(lineUid, 'purchased');
      if (plan) addTag(lineUid, 'purchased_plan_' + plan);
      sendPushMessage(lineUid, 'ご登録ありがとうございます！\n' + (PRO_PLANS[plan] ? PRO_PLANS[plan].label : 'プラン') + 'へようこそ。\n今日からよろしくお願いします。');
    }
    logCheckoutSuccess(verified);
  } else if (event.type === 'customer.subscription.deleted') {
    var sub = event.data && event.data.object;
    if (sub && sub.id) {
      var verifiedSub = reverifyStripeObject('subscription', sub.id);
      if (verifiedSub && verifiedSub.metadata && verifiedSub.metadata.lineUserId) {
        var uid = verifiedSub.metadata.lineUserId;
        removeTag(uid, 'purchased');
        ['l1','l2','l3','parent'].forEach(function(p){ removeTag(uid, 'purchased_plan_' + p); });
      }
    }
  } else if (event.type === 'charge.refunded' || event.type === 'invoice.payment_failed') {
    var obj = event.data && event.data.object;
    var customerId = obj && obj.customer;
    if (customerId) {
      var uid2 = findLineUidByStripeCustomer(customerId);
      if (uid2) {
        removeTag(uid2, 'purchased');
        ['l1','l2','l3','parent'].forEach(function(p){ removeTag(uid2, 'purchased_plan_' + p); });
      }
    }
  }
  return { ok: true };
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

// ----------------------------------------
// Stripe Customer Portal (解約・カード変更)
// ----------------------------------------
function createPortalSession(userId) {
  if (!userId) return { error: 'missing_uid' };
  var key = getProp('STRIPE_SECRET_KEY');
  if (!key) return { error: 'stripe_not_configured' };
  var ss = SpreadsheetApp.openById(CONFIG.SS_ID);
  var sheet = ss.getSheetByName('PURCHASES');
  if (!sheet) return { error: 'no_purchase_record' };
  var data = sheet.getDataRange().getValues();
  var customerId = '';
  for (var i = data.length - 1; i >= 1; i--) {
    if (data[i][0] === userId && data[i][3]) { customerId = data[i][3]; break; }
  }
  if (!customerId) return { error: 'customer_not_found' };
  var resp = UrlFetchApp.fetch('https://api.stripe.com/v1/billing_portal/sessions', {
    method: 'post',
    headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/x-www-form-urlencoded' },
    payload: 'customer=' + encodeURIComponent(customerId) + '&return_url=' + encodeURIComponent('https://sho-blog.com/next-step.html'),
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) {
    logError('createPortalSession', 'HTTP ' + resp.getResponseCode(), { userId: userId });
    return { error: 'stripe_api_error' };
  }
  try { return { url: JSON.parse(resp.getContentText()).url }; }
  catch(e) { return { error: 'parse_error' }; }
}

// ----------------------------------------
// ERROR_LOG / safeFetch
// ----------------------------------------
function logError(source, message, payload) {
  try {
    var ss = SpreadsheetApp.openById(CONFIG.SS_ID);
    var sheet = ss.getSheetByName('ERROR_LOG') || ss.insertSheet('ERROR_LOG');
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['receivedAt','source','message','payload']);
      sheet.getRange(1,1,1,4).setBackground('#1a2d45').setFontColor('#fff').setFontWeight('bold');
    }
    sheet.appendRow([new Date(), source || '', String(message || '').substr(0, 1000), payload ? JSON.stringify(payload).substr(0, 1500) : '']);
  } catch(e) { Logger.log('logError itself failed: ' + e); }
}

// ----------------------------------------
// 運用ヘルパー (Apps Script Editor から手動実行)
// ----------------------------------------
function _seedTestData() {
  setupSheets();
  var ss = SpreadsheetApp.openById(CONFIG.SS_ID);
  var usersSheet = ss.getSheetByName('USERS');
  var tagsSheet = ss.getSheetByName('TAGS');
  var now = new Date();
  var seed = [
    ['Useed_001','テスト 個人A','SC-MAIN', 1, new Date(now.getTime() - 1*86400000), new Date(now.getTime() - 2*86400000), ['src_line','read_s0']],
    ['Useed_002','テスト 個人B','SC-MAIN', 2, new Date(now.getTime() - 2*86400000), new Date(now.getTime() - 4*86400000), ['src_line','read_s0','read_s1']],
    ['Useed_003','テスト 保護者C','SC-PARENT', 1, new Date(now.getTime() - 1*86400000), new Date(now.getTime() - 5*86400000), ['src_line','attr_parent','read_p0','purchased','purchased_plan_parent']],
  ];
  seed.forEach(function(u) {
    usersSheet.appendRow([u[0], u[1], u[2], u[3], u[4], u[5]]);
    u[6].forEach(function(t) { tagsSheet.appendRow([u[0], t, new Date(now.getTime() - Math.random() * 5 * 86400000)]); });
  });
  Logger.log('seed 完了 (3 ユーザー)。purge は _purgeTestData()');
}

function _purgeTestData() {
  var ss = SpreadsheetApp.openById(CONFIG.SS_ID);
  ['USERS','TAGS','CLICK_LOG','FEEDBACK_LOG','PURCHASES'].forEach(function(name) {
    var sheet = ss.getSheetByName(name); if (!sheet) return;
    var data = sheet.getDataRange().getValues();
    for (var i = data.length - 1; i >= 1; i--) {
      if (String(data[i][0] || '').indexOf('Useed_') === 0) sheet.deleteRow(i + 1);
    }
  });
  Logger.log('purge 完了');
}

function checkProductionReadiness() {
  var required = ['STRIPE_SECRET_KEY','STRIPE_WEBHOOK_URL_SECRET','STRIPE_PRICE_L1','STRIPE_PRICE_L2','STRIPE_PRICE_L3','STRIPE_PRICE_PARENT'];
  var props = PropertiesService.getScriptProperties();
  var missing = required.filter(function(k){ return !props.getProperty(k); });
  var triggers = ScriptApp.getProjectTriggers().map(function(t){ return t.getHandlerFunction(); });
  var ss = SpreadsheetApp.openById(CONFIG.SS_ID);
  var requiredSheets = ['USERS','TAGS','CLICK_LOG','SURVEY_LOG','FEEDBACK_LOG','MONITORS'];
  var missingSheets = requiredSheets.filter(function(s){ return !ss.getSheetByName(s); });
  Logger.log('=== Production Readiness Check ===');
  Logger.log('Missing properties: ' + (missing.length === 0 ? 'NONE' : missing.join(', ')));
  Logger.log('Triggers: ' + (triggers.indexOf('checkAndSendScheduled') === -1 ? 'MISSING checkAndSendScheduled' : 'OK'));
  Logger.log('Missing sheets: ' + (missingSheets.length === 0 ? 'NONE' : missingSheets.join(', ')));
  Logger.log('Ready: ' + (missing.length === 0 && triggers.indexOf('checkAndSendScheduled') !== -1 && missingSheets.length === 0 ? 'YES ✅' : 'NO ❌'));
}
