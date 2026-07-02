import { GoogleGenerativeAI } from '@google/generative-ai';
import { GEMINI_API_KEY } from './config.mjs';
import { getDb } from './firestore.mjs';
import { CATEGORIES } from './categories.mjs';

const genai = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;
if (!genai) console.warn('[categorizer] GEMINI_API_KEY not set — Gemini categorization disabled, all unknowns will go to manual');

let rulesCache = null;
let rulesCacheTime = 0;

async function getRules() {
  // Cache rules for 5 minutes to avoid repeated Firestore reads during a pipeline run
  if (rulesCache && Date.now() - rulesCacheTime < 5 * 60 * 1000) return rulesCache;
  const snap = await getDb().collection('budget_rules').get();
  rulesCache = snap.docs.map(d => d.data());
  rulesCacheTime = Date.now();
  return rulesCache;
}

export function invalidateRulesCache() {
  rulesCache = null;
}

export async function categorize(description, memo) {
  const searchText = `${description} ${memo ?? ''}`.toLowerCase();

  // 1. Rule match — checks description + memo, so standing orders/transfers sharing a
  // generic description (e.g. "הוראת-קבע") can still be told apart once memo carries
  // the actual recipient/reference detail.
  const rules = await getRules();
  for (const rule of rules) {
    if (searchText.includes(rule.pattern.toLowerCase())) {
      return { category: rule.category, source: 'rule' };
    }
  }

  // 2. Gemini + Google Search grounding
  if (genai) {
    try {
      const model = genai.getGenerativeModel({
        model: 'gemini-2.5-flash',
        tools: [{ googleSearch: {} }],
      });
      const result = await model.generateContent(
        `אתה מסווג עסקאות עבור תקציב משפחתי ישראלי.\n` +
        `חפש את שם בית העסק הבא כדי להבין מה סוג העסק, ואז סווג אותו.\n` +
        `שם בית העסק: "${description}"\n` +
        `קטגוריות אפשריות: ${CATEGORIES.join(', ')}\n` +
        `ענה בשם קטגוריה אחת בלבד מהרשימה. אם לא ברור, ענה אחר.`
      );
      const text = result.response.text().trim();
      const matched = CATEGORIES.find(c => text.includes(c));
      if (matched && matched !== 'אחר') {
        await saveRule(description, matched, 'gemini');
        return { category: matched, source: 'gemini' };
      }
    } catch (e) {
      console.error('[categorizer] Gemini error:', e.message);
    }
  }

  return { category: null, source: null };
}

export async function saveRule(description, category, createdBy = 'manual') {
  const pattern = description.toLowerCase().trim();
  const docId = Buffer.from(pattern).toString('base64url').slice(0, 64);
  await getDb().collection('budget_rules').doc(docId).set(
    { pattern, category, createdBy, updatedAt: new Date() },
    { merge: true }
  );
  invalidateRulesCache();
}
