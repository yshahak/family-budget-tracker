# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
node src/scrape-hapoalim-local.mjs          # run Hapoalim scrape locally (OTP via Telegram /otp)
```

## Project Structure

```
src/                        # All bot source code (ESM .mjs)
israeli-bank-scrapers/      # Cloned library — do not edit except the hapoalim.ts patch
  lib/                      # Built output (babel-compiled TypeScript)
  src/                      # TypeScript source
plans/                      # Architecture plans with status tracking
.env.example                # Template for all required env vars
```

## Architecture

The bot is an Express server running in Cloud Run. Key modules:

- **`config.mjs`** — loads all env vars, defines `SCRAPE_PROFILES` (one entry per bank/card). Profiles with missing credentials are automatically excluded. `DISPLAY_NAME` maps profile name → human-readable label for Telegram.
- **`scraper.mjs`** — launches Puppeteer, runs `createScraper()` per profile, filters Hapoalim transactions
- **`pipeline.mjs`** — orchestrates scrape → dedup → categorize → notify. Accepts `{ companies, startDate }` overrides for backfill.
- **`categorizer.mjs`** — Firestore rules (5min cache) → Gemini 2.5 Flash → null (manual)
- **`dedup.mjs`** — SHA-256 dedup, Firestore persistence, `updateCategory()`, `updateIgnored()`
- **`notifier.mjs`** — Telegram message formatting. Exports `categoryKeyboard(txnId, category, ignored, backContext)` and `buildText()`. `backContext = { bucketName, month }` adds a back button to the keyboard.
- **`status.mjs`** — `/status` command: monthly summary + per-bucket drill-down with clickable transaction buttons + month navigation. `buildBucketMessage()` returns `{ text, txns }`.
- **`hapoalim-otp.mjs`** — watches browser pages for OTP prompt, relays code from Telegram via Firestore `otp_cache/hapoalim`. Triggered by `/hapoalim` Telegram command or `/scrape-hapoalim` HTTP endpoint.

## Categories and budget buckets

- **`src/categories.mjs`** — defines `CATEGORIES` (the fixed list shown in every transaction keyboard) and `CATEGORY_EMOJI`. To add a category, add it to both arrays.
- **`src/budget.mjs`** — defines `BUDGET_BUCKETS` (name, default amount, which categories roll up into it). Budget amounts are overridable at runtime via Firestore `budget_amounts` collection (the `/budget` Telegram command writes there). Firestore values always win over code defaults.
- **`src/seed-rules.mjs`** — merchant pattern → category rules seeded into Firestore `budget_rules`. Run once with `node src/seed-rules.mjs`. Patterns are matched case-insensitively as substrings — avoid overly short patterns (e.g. `'ביט'` matches `'ביטוח'`). Use specific phrases like `'העברה בbit'` instead.

## Callback data format (Telegram inline keyboards)

- `cat|txnId|category` — set transaction category
- `ignore|txnId` — toggle ignored flag
- `apply_similar|txnId|category` — bulk-apply category to all matching descriptions
- `txn_detail|txnId|bucketName|month` — open transaction from bucket drill-down (sets `txnEditContext`)
- `status_month|YYYY-MM` — navigate to month in summary
- `status_bucket|bucketName|YYYY-MM` — open bucket drill-down
- `status_back|YYYY-MM` — return to summary
- `budget_edit|bucketName` — prompt for new budget amount

`txnEditContext` (in-memory Map, `txnId → { bucketName, month }`) tracks when a transaction was opened from a bucket drill-down, so the back button persists through category/ignore edits.

## Hapoalim patch (required)

In `israeli-bank-scrapers/src/scrapers/hapoalim/hapoalim.ts`, change:
```
waitForRedirect(this.page, 20000)
```
to:
```
waitForRedirect(this.page, 300000)
```
Then rebuild: `cd israeli-bank-scrapers && npx babel src --out-dir lib --extensions ".ts" --source-maps inline`

## Key env vars

See `.env.example` for the full list. The most important:
- `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` — required
- `PROFILE1_NAME` / `PROFILE2_NAME` — stable internal owner keys stored in Firestore (part of dedup hash — never change after first run)
- `OWNER1_DISPLAY` / `OWNER2_DISPLAY` — display names shown in Telegram messages
- `WEBHOOK_URL` — when set, switches bot from polling to webhook mode (Cloud Run sets this automatically). **Never run in polling mode locally while Cloud Run is active** — polling calls `deleteWebhook` and kills the Cloud Run webhook.
- `GEMINI_API_KEY` — optional; categorization falls back to manual keyboard if absent

## Utility scripts

- `node src/backfill.mjs --month=2026-03 [--companies=isracard,max,hapoalim]` — fetch historical transactions for a past month
- `node src/recategorize-paybox.mjs [--dry-run]` — bulk-recategorize transactions by description pattern
- `node src/seed-rules.mjs` — seed initial merchant rules into Firestore (run once, safe to re-run)
- `node src/cleanup-owner-rename.mjs [--dry-run]` — delete transactions by owner value (one-time cleanup)

## GCP deployment

Always deploy from inside `IsracardFetcher/`:
```bash
cd IsracardFetcher && gcloud config set project siud-payslip-bot && gcloud config set account yshahak@gmail.com
gcloud run deploy budget-bot --source . --region=europe-west1 --quiet
```

Cloud Run service: 2Gi memory, CPU-always-allocated, max 1 instance, timeout 900s.
Two Cloud Scheduler jobs (Asia/Jerusalem timezone): cards scrape every 2h Sun-Fri, no scheduled Hapoalim (triggered manually via `/hapoalim` Telegram command).

## Adding a new bank

Add a new object to the `profiles` array in `src/config.mjs` with a `company` value from the [israeli-bank-scrapers supported list](https://github.com/eshaham/israeli-bank-scrapers/blob/master/src/definitions.ts) and matching credential env vars in `.env`.
