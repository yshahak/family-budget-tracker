/**
 * Optionally copy this file to local-config.mjs and customize for your household.
 * local-config.mjs is gitignored — safe to put personal amounts and patterns here.
 * If the file doesn't exist, all built-in defaults are used automatically.
 *
 * null → use the built-in defaults from categories.mjs / budget.mjs
 */

// Override the full categories list (or null to use defaults)
export const CATEGORIES = null;

// Override category → emoji mapping (or null to use defaults)
export const CATEGORY_EMOJI = null;

/**
 * Your household budget buckets. Each entry:
 *   { name: string, amount: number (ILS), categories: string[] }
 *
 * Set to null to use the built-in example buckets.
 */
export const BUDGET_BUCKETS = null;

/**
 * Personal merchant patterns to seed on top of the built-in rules.
 * Same format as seed-rules.mjs: { pattern, category }
 * Run `node src/seed-rules.mjs` to push these to Firestore.
 */
export const EXTRA_SEED_RULES = [
  // { pattern: 'my gym', category: 'חוגים' },
];
