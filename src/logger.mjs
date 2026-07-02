import { getDb } from './firestore.mjs';

function log(level, message, data = {}) {
  const entry = { level, message, ...data, ts: new Date().toISOString() };
  process.stdout.write(JSON.stringify(entry) + '\n');
}

export const logger = {
  info(message, data = {}) { log('info', message, data); },
  warn(message, data = {}) { log('warn', message, data); },
  error(message, data = {}) { log('error', message, data); },

  async logScrapeRun(stats) {
    const docId = new Date().toISOString().replace(/[:.]/g, '-');
    try {
      await getDb().collection('scrape_logs').doc(docId).set({
        ...stats,
        createdAt: new Date(),
      });
    } catch (err) {
      log('error', 'Failed to write scrape log to Firestore', { error: err.message });
    }
  },
};
