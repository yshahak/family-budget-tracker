import express from 'express';
import { PORT, WEBHOOK_URL, TELEGRAM_CHAT_ID, DISPLAY_NAME } from './config.mjs';
import { getBot } from './notifier.mjs';
import { runPipeline } from './pipeline.mjs';
import { updateCategory, updateIgnored } from './dedup.mjs';
import { saveRule } from './categorizer.mjs';
import { getDb } from './firestore.mjs';
import { CATEGORIES, CATEGORY_EMOJI } from './categories.mjs';
import { getMonthlyBudgetInfo } from './budget.mjs';
import { buildSummaryMessage, buildSummaryKeyboard, buildBucketMessage, buildBucketKeyboard, currentMonth } from './status.mjs';
import { buildBudgetMessage, buildBudgetKeyboard } from './budget-ui.mjs';
import { updateBucketAmount } from './budget.mjs';

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));

app.get('/test-browser', async (_req, res) => {
  const puppeteer = (await import('puppeteer')).default;
  const execPath = puppeteer.executablePath();
  console.log('[test-browser] Chrome path:', execPath);
  try {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote'],
      timeout: 15000,
    });
    const version = await browser.version();
    await browser.close();
    console.log('[test-browser] Chrome launched OK, version:', version);
    res.json({ ok: true, execPath, version });
  } catch (e) {
    console.error('[test-browser] Launch failed:', e.message);
    res.status(500).json({ ok: false, execPath, error: e.message });
  }
});

// Cards only (isracard + max) — runs every 2h Sun-Fri
app.post('/scrape', (req, res) => {
  console.log('[server] /scrape triggered');
  res.json({ ok: true });
  runPipeline({ companies: ['isracard', 'max'] }).catch(e => console.error('[pipeline] unhandled error:', e));
});

// Daily status summary — triggered by Cloud Scheduler once a day
app.post('/daily-status', async (req, res) => {
  console.log('[server] /daily-status triggered');
  res.json({ ok: true });
  try {
    const month = currentMonth();
    const text = await buildSummaryMessage(month);
    await getBot().sendMessage(TELEGRAM_CHAT_ID, text, {
      parse_mode: 'HTML',
      reply_markup: buildSummaryKeyboard(month),
    });
  } catch (e) {
    console.error('[daily-status] error:', e.message);
  }
});

// Hapoalim HTTP endpoint (kept for manual curl triggering)
app.post('/scrape-hapoalim', (req, res) => {
  console.log('[server] /scrape-hapoalim triggered via HTTP');
  res.json({ ok: true });
  runPipeline({ companies: ['hapoalim'] }).catch(e => console.error('[pipeline] unhandled error:', e));
});

if (WEBHOOK_URL) {
  app.post('/webhook', (req, res) => {
    getBot().processUpdate(req.body);
    res.sendStatus(200);
  });
  getBot().setWebHook(`${WEBHOOK_URL}/webhook`);
  console.log(`[bot] Webhook set to ${WEBHOOK_URL}/webhook`);
} else {
  console.log('[bot] Polling mode (local dev)');
}

// /otp command — store OTP code for Hapoalim scraper
getBot().onText(/\/otp\s+(\d+)/, async (msg, match) => {
  const code = match[1];
  try {
    await getDb().collection('otp_cache').doc('hapoalim').set({ code, createdAt: new Date() });
    await getBot().sendMessage(msg.chat.id, `✅ קוד OTP <code>${code}</code> התקבל — מזין לדפדפן...`, { parse_mode: 'HTML' });
  } catch (e) {
    console.error('[otp] error:', e.message);
  }
});

// /hapoalim command — trigger Hapoalim scrape manually (user must be ready to respond to OTP)
getBot().onText(/\/hapoalim/, async (msg) => {
  try {
    await getBot().sendMessage(msg.chat.id,
      '🏦 <b>מתחיל לסרוק פועלים...</b>\nהכן את הטלפון — תכף תגיע בקשת קוד SMS.',
      { parse_mode: 'HTML' }
    );
    const newCount = await runPipeline({ companies: ['hapoalim'] });
    await getBot().sendMessage(msg.chat.id,
      `✅ <b>פועלים הסתיים</b> — ${newCount} עסקאות חדשות`,
      { parse_mode: 'HTML' }
    );
  } catch (e) {
    console.error('[/hapoalim] error:', e.message);
    await getBot().sendMessage(msg.chat.id, `❌ שגיאה: ${e.message}`).catch(() => {});
  }
});

// /status command
getBot().onText(/\/status/, async (msg) => {
  try {
    const month = currentMonth();
    const text = await buildSummaryMessage(month);
    await getBot().sendMessage(msg.chat.id, text, {
      parse_mode: 'HTML',
      reply_markup: buildSummaryKeyboard(month),
    });
  } catch (e) {
    console.error('[status] error:', e.message);
  }
});

// /budget command
getBot().onText(/\/budget/, async (msg) => {
  try {
    const text = await buildBudgetMessage();
    await getBot().sendMessage(msg.chat.id, text, {
      parse_mode: 'HTML',
      reply_markup: buildBudgetKeyboard(),
    });
  } catch (e) {
    console.error('[budget] error:', e.message);
  }
});

// pendingEdits: messageId → { bucketName, chatId }
const pendingEdits = new Map();
// txnEditContext: txnId → { bucketName, month } — set when transaction opened from bucket detail
const txnEditContext = new Map();

// Handle text replies (budget amount editing)
getBot().on('message', async (msg) => {
  if (!msg.reply_to_message || !msg.text) return;
  const pending = pendingEdits.get(msg.reply_to_message.message_id);
  if (!pending) return;

  const amount = parseInt(msg.text.replace(/[^\d]/g, ''), 10);
  if (isNaN(amount) || amount <= 0) {
    await getBot().sendMessage(msg.chat.id, '❌ סכום לא תקין, נסה שוב עם מספר חיובי.');
    return;
  }

  try {
    await updateBucketAmount(pending.bucketName, amount);
    pendingEdits.delete(msg.reply_to_message.message_id);
    await getBot().sendMessage(msg.chat.id,
      `✅ תקציב <b>${pending.bucketName}</b> עודכן ל־₪${amount.toLocaleString('he-IL')}`,
      { parse_mode: 'HTML' }
    );
    // Re-send updated /budget view
    const text = await buildBudgetMessage();
    await getBot().sendMessage(msg.chat.id, text, {
      parse_mode: 'HTML',
      reply_markup: buildBudgetKeyboard(),
    });
  } catch (e) {
    console.error('[budget edit] error:', e.message);
  }
});

// Handle inline keyboard taps
getBot().on('callback_query', async (query) => {
  const parts = query.data.split('|');

  // Budget edit: ask for new amount via ForceReply
  if (parts[0] === 'budget_edit' && parts[1]) {
    const bucketName = parts[1];
    try {
      await getBot().answerCallbackQuery(query.id);
      const sent = await getBot().sendMessage(
        query.message.chat.id,
        `✏️ הזן סכום חדש עבור <b>${bucketName}</b> (בשקלים):`,
        {
          parse_mode: 'HTML',
          reply_markup: { force_reply: true, input_field_placeholder: 'לדוגמה: 1500' },
        }
      );
      pendingEdits.set(sent.message_id, { bucketName, chatId: query.message.chat.id });
    } catch (e) {
      console.error('[budget_edit] error:', e.message);
    }
    return;
  }

  // Status month navigation (prev/next/refresh)
  if (parts[0] === 'status_month' && parts[1]) {
    try {
      await getBot().answerCallbackQuery(query.id);
      const month = parts[1];
      const text = await buildSummaryMessage(month);
      await getBot().editMessageText(text, {
        chat_id: query.message.chat.id,
        message_id: query.message.message_id,
        parse_mode: 'HTML',
        reply_markup: buildSummaryKeyboard(month),
      });
    } catch (e) {
      if (!e.message?.includes('message is not modified')) console.error('[status_month] error:', e.message);
    }
    return;
  }

  // Status drill-down: bucket detail
  if (parts[0] === 'status_bucket' && parts[1]) {
    try {
      await getBot().answerCallbackQuery(query.id);
      const bucketName = parts[1];
      const month = parts[2] || currentMonth();
      const { text, txns } = await buildBucketMessage(bucketName, month);
      await getBot().editMessageText(text, {
        chat_id: query.message.chat.id,
        message_id: query.message.message_id,
        parse_mode: 'HTML',
        reply_markup: buildBucketKeyboard(bucketName, txns, month),
      });
    } catch (e) {
      if (!e.message?.includes('message is not modified')) console.error('[status_bucket] error:', e.message);
    }
    return;
  }

  // Transaction detail from bucket drill-down
  if (parts[0] === 'txn_detail' && parts[1]) {
    const txnId = parts[1];
    const bucketName = parts[2];
    const month = parts[3] || currentMonth();
    try {
      await getBot().answerCallbackQuery(query.id);
      const doc = await getDb().collection('budget_transactions').doc(txnId).get();
      if (!doc.exists) return;
      const txn = doc.data();
      txnEditContext.set(txnId, { bucketName, month });
      const { buildText, categoryKeyboard } = await import('./notifier.mjs');
      const txnMonth = txn.date?.slice(0, 7) ?? null;
      const budgetInfo = txn.category && !txn.ignored ? await getMonthlyBudgetInfo(txn.category, txnMonth) : null;
      const text = buildText(txn, txn.accountNumber, txn.owner, txn.category, budgetInfo, txn.ignored ?? false);
      await getBot().editMessageText(text, {
        chat_id: query.message.chat.id,
        message_id: query.message.message_id,
        parse_mode: 'HTML',
        reply_markup: categoryKeyboard(txnId, txn.category, txn.ignored ?? false, { bucketName, month }),
      });
    } catch (e) {
      if (!e.message?.includes('message is not modified')) console.error('[txn_detail] error:', e.message);
    }
    return;
  }

  // Status back: return to summary
  if (parts[0] === 'status_back') {
    try {
      await getBot().answerCallbackQuery(query.id);
      const month = parts[1] || currentMonth();
      const text = await buildSummaryMessage(month);
      await getBot().editMessageText(text, {
        chat_id: query.message.chat.id,
        message_id: query.message.message_id,
        parse_mode: 'HTML',
        reply_markup: buildSummaryKeyboard(month),
      });
    } catch (e) {
      if (!e.message?.includes('message is not modified')) console.error('[status_back] error:', e.message);
    }
    return;
  }

  // Ignore / un-ignore transaction
  if (parts[0] === 'ignore' && parts[1]) {
    const txnId = parts[1];
    try {
      const doc = await getDb().collection('budget_transactions').doc(txnId).get();
      if (!doc.exists) { await getBot().answerCallbackQuery(query.id); return; }
      const txn = doc.data();
      const newIgnored = !txn.ignored;
      await updateIgnored(txnId, newIgnored);
      await getBot().answerCallbackQuery(query.id, { text: newIgnored ? '🚫 מסומן כמתעלם' : '↩️ בוטל' });
      const { updateMessageText } = await import('./notifier.mjs');
      const txnMonth = txn.date?.slice(0, 7) ?? null;
      const budgetInfo = txn.category && !newIgnored ? await getMonthlyBudgetInfo(txn.category, txnMonth) : null;
      const backContext = txnEditContext.get(txnId) ?? null;
      await updateMessageText(
        query.message.message_id, txn, txn.accountNumber, txn.owner,
        txnId, txn.category, budgetInfo, newIgnored, backContext
      );
    } catch (e) {
      if (!e.message?.includes('message is not modified')) console.error('[ignore] error:', e.message);
    }
    return;
  }

  // Apply category to all similar transactions
  if (parts[0] === 'apply_similar' && parts[1] && parts[2]) {
    const txnId = parts[1];
    const category = parts[2];
    try {
      await getBot().answerCallbackQuery(query.id);
      const doc = await getDb().collection('budget_transactions').doc(txnId).get();
      if (!doc.exists) return;
      const pattern = doc.data().description.toLowerCase().trim();

      const allSnap = await getDb().collection('budget_transactions').get();
      const batch = getDb().batch();
      let count = 0;
      for (const d of allSnap.docs) {
        if (d.id === txnId) continue;
        const t = d.data();
        if ((t.description || '').toLowerCase().includes(pattern) && t.category !== category) {
          batch.update(d.ref, { category });
          count++;
        }
      }
      if (count > 0) await batch.commit();

      await getBot().editMessageReplyMarkup(
        { inline_keyboard: [] },
        { chat_id: query.message.chat.id, message_id: query.message.message_id }
      );
      await getBot().sendMessage(
        query.message.chat.id,
        `✅ עודכנו ${count} עסקאות דומות ל<b>${category}</b>`,
        { parse_mode: 'HTML' }
      );
    } catch (e) {
      console.error('[apply_similar] error:', e.message);
    }
    return;
  }

  // Category tap
  if (parts[0] !== 'cat' || parts.length < 3) return;
  const [, txnId, category] = parts;
  if (!CATEGORIES.includes(category)) return;

  try {
    await getBot().answerCallbackQuery(query.id, { text: `✅ ${category}` });
    await updateCategory(txnId, category);
    await updateIgnored(txnId, false);

    const doc = await getDb().collection('budget_transactions').doc(txnId).get();
    if (!doc.exists) return;
    const txn = doc.data();
    await saveRule(txn.description, category, 'manual');

    // Check for other transactions with the same description that have a different category
    const pattern = txn.description.toLowerCase().trim();
    const allSnap = await getDb().collection('budget_transactions').get();
    const similarCount = allSnap.docs.filter(d =>
      d.id !== txnId &&
      (d.data().description || '').toLowerCase().includes(pattern) &&
      d.data().category !== category
    ).length;

    const txnMonth = txn.date?.slice(0, 7) ?? null;
    const budgetInfo = await getMonthlyBudgetInfo(category, txnMonth);
    const { updateMessageText, categoryKeyboard } = await import('./notifier.mjs');
    const backContext = txnEditContext.get(txnId) ?? null;
    await updateMessageText(
      query.message.message_id, txn, txn.accountNumber, txn.owner,
      txnId, category, budgetInfo, false, backContext
    );

    // If similar transactions exist, append an "apply to all" button via a separate edit
    if (similarCount > 0) {
      const kb = categoryKeyboard(txnId, category, false, backContext);
      kb.inline_keyboard.push([{
        text: `📎 החל ל־${similarCount} עסקאות דומות`,
        callback_data: `apply_similar|${txnId}|${category}`,
      }]);
      await getBot().editMessageReplyMarkup(kb, {
        chat_id: query.message.chat.id,
        message_id: query.message.message_id,
      });
    }
  } catch (e) {
    if (!e.message?.includes('message is not modified')) {
      console.error('[callback] error:', e.message);
    }
  }
});

app.listen(PORT, () => console.log(`[server] Listening on port ${PORT}`));
