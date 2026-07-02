import { scrapeAll } from './scraper.mjs';
import { filterNew, saveTxn, updateTelegramMessageId, updateCategoryAuto } from './dedup.mjs';
import { categorize } from './categorizer.mjs';
import { sendTransaction } from './notifier.mjs';
import { getMonthlyBudgetInfo } from './budget.mjs';
import { logger } from './logger.mjs';

export async function runPipeline({ companies, startDate: startDateOverride } = {}) {
  const startDate = startDateOverride ?? (() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d;
  })();
  logger.info('[pipeline] Start date', { startDate: startDate.toISOString().slice(0, 10) });

  const accounts = await scrapeAll(startDate, { companies });
  let totalNew = 0;
  let totalFound = 0;
  let totalPendingResolved = 0;
  const profiles = [];
  const errors = [];

  for (const { owner, accountNumber, txns } of accounts) {
    profiles.push(`${owner}/${accountNumber}`);
    totalFound += txns.length;

    let newTxns, pendingResolved, resolved;
    try {
      ({ newTxns, pendingResolved, resolved } = await filterNew(txns, accountNumber, owner));
    } catch (err) {
      const msg = `filterNew failed for ${owner}/${accountNumber}: ${err.message}`;
      logger.error(msg, { owner, accountNumber, error: err.message });
      errors.push(msg);
      continue;
    }

    newTxns = newTxns.filter(t => t.chargedAmount !== 0);
    totalPendingResolved += pendingResolved;
    logger.info(`[pipeline] ${owner}/${accountNumber}: ${newTxns.length} new of ${txns.length}, ${pendingResolved} pending resolved`, {
      owner, accountNumber, newCount: newTxns.length, total: txns.length, pendingResolved,
    });

    // Memo/beneficiary detail only becomes available once a transaction settles — re-run
    // categorization now that it's here, unless the user already categorized it manually.
    for (const { id, txn, previousCategorySource } of resolved) {
      if (previousCategorySource === 'manual' || !txn.memo) continue;
      try {
        const { category, source } = await categorize(txn.description, txn.memo);
        if (category) await updateCategoryAuto(id, category, source);
      } catch (err) {
        logger.error(`Failed to re-categorize resolved txn ${id}: ${err.message}`, { id, error: err.message });
      }
    }

    for (const txn of newTxns) {
      try {
        const { category, source } = await categorize(txn.description, txn.memo);

        // Save first so spending query includes this transaction
        await saveTxn(txn, accountNumber, owner, category, source, null);

        const txnMonth = txn.date?.slice(0, 7) ?? null;
        const budgetInfo = category ? await getMonthlyBudgetInfo(category, txnMonth) : null;
        const messageId = await sendTransaction(txn, accountNumber, owner, txn._id, category, budgetInfo);

        if (messageId) await updateTelegramMessageId(txn._id, messageId);
        totalNew++;
      } catch (err) {
        const msg = `Failed to process txn ${txn.description}: ${err.message}`;
        logger.error(msg, { description: txn.description, error: err.message });
        errors.push(msg);
      }

      // Telegram group rate limit: 20 msg/min — stay safe with 3s gap
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  logger.info(`[pipeline] Done — ${totalNew} new transactions processed`, {
    totalNew, totalFound, pendingResolved: totalPendingResolved,
  });

  await logger.logScrapeRun({
    startDate: startDate.toISOString().slice(0, 10),
    profiles,
    totalFound,
    totalNew,
    pendingResolved: totalPendingResolved,
    errors,
  });

  return totalNew;
}
