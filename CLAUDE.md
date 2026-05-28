# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## GCP / GitHub accounts — always check first

Before any `gcloud`, Firestore, or Cloud Run command:
```bash
gcloud config set account yshahak@gmail.com
gcloud config set project siud-payslip-bot
```

Before any `git push`:
```bash
gh auth switch --user yshahak
```

The default active account is `yaakov@lightricks.com` (work) which has no access to this project.

## Runtime Requirement

Node.js >= 22.13.0 is required (enforced by `israeli-bank-scrapers`). Use nvm:

```bash
export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh" && nvm use 22.13.0
```

## Running locally

```bash
cp .env.example .env        # fill in your credentials
node src/index.mjs          # starts bot in polling mode on port 8080
curl -X POST localhost:8080/scrape          # trigger card scrape
curl -X POST localhost:8080/scrape-hapoalim # trigger Hapoalim scrape
curl -X POST localhost:8080/daily-status    # send daily status summary to Telegram
node src/scrape-hapoalim-local.mjs          # run Hapoalim scrape locally (OTP via Telegram /otp)
```

**Never run locally while Cloud Run is active** — polling mode calls `deleteWebhook` and kills the Cloud Run webhook. Re-register after with:
```bash
curl "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook?url=${WEBHOOK_URL}/webhook"
```

## Architecture

The bot is an Express server running in Cloud Run. Key modules:

- **`config.mjs`** — loads all env vars, defines `SCRAPE_PROFILES` (one entry per bank/card). Profiles with missing credentials are automatically excluded. `DISPLAY_NAME` maps profile name → human-readable label for Telegram.
- **`scraper.mjs`** — launches Puppeteer, runs `createScraper()` per profile, filters Hapoalim transactions via `HAPOALIM_SKIP_PATTERNS`. Also filters `chargedAmount === 0` (pre-auth charges).
- **`pipeline.mjs`** — orchestrates scrape → dedup → categorize → notify. Accepts `{ companies, startDate }` overrides for backfill. Skips zero-amount transactions.
- **`categorizer.mjs`** — Firestore rules (5min cache) → Gemini 2.5 Flash → null (manual). `saveRule(description, category)` saves full description as pattern — patterns are `.trim()`ed so never use trailing spaces in patterns.
- **`dedup.mjs`** — SHA-256 dedup hash: `sha256(date|identifier|chargedAmount|accountNumber|owner)`. `updateCategory()`, `updateIgnored()`. Owner is part of hash — never change `PROFILE1_NAME`/`PROFILE2_NAME` after first run.
- **`notifier.mjs`** — Telegram message formatting. Exports `categoryKeyboard(txnId, category, ignored, backContext)` and `buildText()`. `backContext = { bucketName, month }` adds a back button to the keyboard.
- **`status.mjs`** — `/status` command: monthly summary + per-bucket drill-down with clickable transaction buttons + month navigation. `buildBucketMessage()` returns `{ text, txns }`.
- **`hapoalim-otp.mjs`** — watches browser pages for OTP prompt, relays code from Telegram via Firestore `otp_cache/hapoalim`. Triggered by `/hapoalim` Telegram command.
- **`hapoalim-session.mjs`** — dead code (session saving doesn't work in Cloud Run). Safe to delete.

## HTTP endpoints

- `POST /scrape` — scrape Isracard + Max (triggered by Cloud Scheduler)
- `POST /scrape-hapoalim` — scrape Hapoalim (manual or curl)
- `POST /daily-status` — send monthly status summary to Telegram (triggered by Cloud Scheduler at 21:00)
- `GET /health` — health check

## Telegram commands

- `/status` — monthly budget summary with month navigation and per-bucket drill-down
- `/budget` — view and edit monthly budget amounts per bucket
- `/hapoalim` — trigger Hapoalim scrape (be ready for OTP SMS)
- `/otp [code]` — submit OTP code during Hapoalim scrape

## Categories and budget buckets

- **`src/categories.mjs`** — defines `CATEGORIES` and `CATEGORY_EMOJI`. To add a category, add to both.
- **`src/budget.mjs`** — defines `BUDGET_BUCKETS`. Amounts overridable via Firestore `budget_amounts` (written by `/budget` command).
- **`src/seed-rules.mjs`** — merchant pattern → category rules. Run once: `node src/seed-rules.mjs`. Patterns matched case-insensitively as substrings — avoid short patterns (`'ביט'` matches `'ביטוח'`). Use specific phrases like `'העברה בbit'`.

## Callback data format (Telegram inline keyboards)

All callback_data must be ≤ 64 bytes (UTF-8). Hebrew chars = 2 bytes each.

- `cat|txnId|category` — set transaction category
- `ignore|txnId` — toggle ignored flag
- `apply_similar|txnId|category` — bulk-apply category to all matching descriptions
- `txn_detail|txnId|bucketName|month` — open transaction from bucket drill-down
- `status_month|YYYY-MM` — navigate to month in summary
- `status_bucket|bucketName|YYYY-MM` — open bucket drill-down
- `status_back|YYYY-MM` — return to summary
- `budget_edit|bucketName` — prompt for new budget amount

`txnEditContext` (in-memory Map, `txnId → { bucketName, month }`) tracks when a transaction was opened from a bucket drill-down, so the back button persists through category/ignore edits.

## Key env vars

See `.env.example` for the full list. The most important:
- `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` — required
- `PROFILE1_NAME` / `PROFILE2_NAME` — stable internal owner keys (part of dedup hash — never change after first run)
- `OWNER1_DISPLAY` / `OWNER2_DISPLAY` — display names shown in Telegram messages
- `WEBHOOK_URL` — when set, switches bot from polling to webhook mode (Cloud Run sets this automatically)
- `GEMINI_API_KEY` — optional; categorization falls back to manual keyboard if absent

## Firestore collections

| Collection | Purpose |
|---|---|
| `budget_transactions` | All transactions (dedup, category, ignored, Telegram message ID) |
| `budget_rules` | Merchant → category patterns (also used for auto-ignore in future) |
| `budget_amounts` | Per-bucket monthly amount overrides |
| `otp_cache` | Temporary OTP relay (`/otp` command → scraper) |

## GCP deployment

Deploy from inside the `family-budget-tracker/` directory:
```bash
gcloud config set account yshahak@gmail.com
gcloud config set project siud-payslip-bot
gcloud run deploy budget-bot --source . --region=europe-west1 --quiet
```

Cloud Run: `siud-payslip-bot` project, `europe-west1`, 2Gi memory, CPU-always-allocated, max 1 instance, timeout 900s.

Three Cloud Scheduler jobs (Asia/Jerusalem timezone):
- `budget-bot-cards-weekday` — `/scrape` every 2h 10:00–20:00, Sun–Thu
- `budget-bot-cards-friday` — `/scrape` every 2h 10:00–16:00, Fri
- `budget-bot-daily-status` — `/daily-status` at 21:00, Sun–Fri

## Utility scripts

- `node src/backfill.mjs --month=2026-03 [--companies=isracard,max,hapoalim]` — fetch historical transactions for a past month
- `node src/recategorize-paybox.mjs [--dry-run]` — bulk-recategorize transactions by description pattern
- `node src/seed-rules.mjs` — seed initial merchant rules into Firestore (run once, safe to re-run). Also seeds `EXTRA_SEED_RULES` from `src/local-config.mjs`.
- `node src/cleanup-owner-rename.mjs [--dry-run]` — delete transactions by owner value (one-time cleanup)
- `node src/local-dump.mjs` — dump Firestore collections to `local-data/*.json` for offline analysis (gitignored)
- `node src/local-analyze.mjs [--months=4]` — monthly spend vs budget table from local dump

## Personal config

`src/local-config.mjs` is gitignored and optional — if absent, built-in defaults are used. Copy from `src/local-config.example.mjs` to customize. Controls:
- `BUDGET_BUCKETS` — household bucket amounts (ILS)
- `CATEGORIES` / `CATEGORY_EMOJI` — override category list and emoji map
- `EXTRA_SEED_RULES` — personal merchant patterns merged into `seed-rules.mjs`

## Hapoalim patch (required after rebuilding library)

In `israeli-bank-scrapers/src/scrapers/hapoalim/hapoalim.ts`, change:
```
waitForRedirect(this.page, 20000)
```
to:
```
waitForRedirect(this.page, 300000)
```
Then rebuild: `cd israeli-bank-scrapers && npx babel src --out-dir lib --extensions ".ts" --source-maps inline`
