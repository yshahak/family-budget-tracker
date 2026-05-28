import { scrapeAll } from './scraper.mjs';
import { filterNew, saveTxn, updateTelegramMessageId } from './dedup.mjs';
import { categorize } from './categorizer.mjs';
import { sendTransaction } from './notifier.mjs';
import { getMonthlyBudgetInfo } from './budget.mjs';

export async function runPipeline({ companies, startDate: startDateOverride } = {}) {
  const startDate = startDateOverride ?? (() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d;
  })();
  console.log(`[pipeline] Start date: ${startDate.toISOString().slice(0, 10)}`);

  const accounts = await scrapeAll(startDate, { companies });
  let totalNew = 0;

  for (const { owner, accountNumber, txns } of accounts) {
    const newTxns = (await filterNew(txns, accountNumber, owner))
      .filter(t => t.chargedAmount !== 0);
    console.log(`[pipeline] ${owner}/${accountNumber}: ${newTxns.length} new of ${txns.length}`);

    for (const txn of newTxns) {
      const { category, source } = await categorize(txn.description);

      // Save first so spending query includes this transaction
      await saveTxn(txn, accountNumber, owner, category, source, null);

      const txnMonth = txn.date?.slice(0, 7) ?? null;
      const budgetInfo = category ? await getMonthlyBudgetInfo(category, txnMonth) : null;
      const messageId = await sendTransaction(txn, accountNumber, owner, txn._id, category, budgetInfo);

      if (messageId) await updateTelegramMessageId(txn._id, messageId);
      totalNew++;

      // Telegram group rate limit: 20 msg/min — stay safe with 3s gap
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  console.log(`[pipeline] Done — ${totalNew} new transactions processed`);
  return totalNew;
}
