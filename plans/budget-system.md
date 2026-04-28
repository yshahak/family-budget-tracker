# Budget Monitoring System — Implementation Plan

## Goal

Automatically fetch Isracard + Max + Bank Hapoalim transactions for multiple card holders, categorize them (rules → Gemini → manual Telegram keyboard), store in Firestore, and notify a family Telegram group per new transaction with budget tracking.

## Status Tracking

| Phase | Step | Status |
|-------|------|--------|
| 0 | Repo & CLAUDE.md setup | ✅ Done |
| 0 | Isracard scraper working locally (`fetch.mjs`) | ✅ Done |
| 1 | Project structure & package.json | ✅ Done |
| 1 | Firestore client + transaction schema | ✅ Done |
| 1 | Dedup logic (store + skip already-seen transactions) | ✅ Done |
| 1 | Category rules engine + seed patterns | ✅ Done |
| 1 | Gemini 2.5 Flash + Google Search grounding | ✅ Done |
| 1 | Telegram bot created | ✅ Done |
| 1 | Telegram bot — inline keyboard on every transaction | ✅ Done |
| 1 | Telegram bot — category tap updates Firestore + saves rule | ✅ Done |
| 1 | Monthly budget tracking per transaction (budget.mjs) | ✅ Done |
| 1 | Progress bar UI — emoji squares (🟩/🟧/🟥 + ⬜, 10 segments) | ✅ Done |
| 1 | recategorize.mjs — backfill nulls via Gemini | ✅ Done |
| 1 | repost.mjs — re-post transactions (`--no-delete` flag) | ✅ Done |
| 1 | Second card holder Isracard credentials | ✅ Done |
| 1 | /status command — total summary + per-bucket + drill-down | ✅ Done |
| 1 | /budget command — view + edit amounts (Firestore-backed) | ✅ Done |
| 1 | מסעדות split into its own bucket (₪500) | ✅ Done |
| 1 | נסיעות renamed to חופשות | ✅ Done |
| 1 | חסכנות category + bucket (₪1,000) for ני"ע investments | ✅ Done |
| 1 | Bank Hapoalim scraper (password-only login) | ✅ Done |
| 1 | Hapoalim internal transfer skip list | ✅ Done |
| 1 | Hapoalim positive transaction filtering (income skipped) | ✅ Done |
| 1 | Hapoalim session persistence to Firestore (cookies) | ✅ Done |
| 1 | scrape-hapoalim-local.mjs — local OTP refresh script | ✅ Done |
| 1 | Telegram alert when Hapoalim session expires in Cloud Run | ✅ Done |
| 1 | Positive amount display with + prefix | ✅ Done |
| 1 | End-to-end local test | ✅ Done |
| 2 | Dockerfile | ✅ Done |
| 2 | Cloud Run service setup | ✅ Done |
| 2 | Secret Manager — add all required secrets | ✅ Done |
| 2 | Cloud Scheduler — 3 jobs (cards Sun-Thu, cards Fri, Hapoalim Sun-Thu) | ✅ Done |
| 2 | Telegram webhook registration (replace polling) | ✅ Done |
| 2 | CPU-always-allocated + 2Gi memory (Chrome in background) | ✅ Done |
| 2 | OTP flow: /otp command → Firestore → browser watcher types code | ✅ Done |
| 2 | /scrape (cards only) and /scrape-hapoalim endpoints | ✅ Done |
| 2 | Hapoalim staleness alert only after Hapoalim run | ✅ Done |
| 2 | Production smoke test | ✅ Done |
| 2 | GitHub Actions CI/CD | ⬜ Todo |

---

## Architecture

```
Cloud Scheduler (Asia/Jerusalem):
  Cards Sun-Thu: 0 10,12,14,16,18,20 * * 0-4  → POST /scrape
  Cards Friday:  0 10,12,14,16 * * 5           → POST /scrape
  Hapoalim:      0 10 * * 0-4                  → POST /scrape-hapoalim
        ▼
Cloud Run: budget-bot (Node.js 22, 2Gi, CPU-always-allocated)
  /scrape          → isracard + max profiles only (fire-and-forget)
  /scrape-hapoalim → hapoalim profile only (fire-and-forget)
        │
        ├── scraper.mjs        israeli-bank-scrapers per profile
        │                      Hapoalim: OTP watcher runs alongside scraper.scrape()
        │                      waitForRedirect patched to 300s timeout in hapoalim.ts
        │
        ├── hapoalim-otp.mjs   detects OTP page (waits 3s + checks for visible inputs)
        │                      sends Telegram "📱 שלח /otp [קוד]"
        │                      polls Firestore otp_cache/hapoalim every 4s
        │                      types each digit into individual inputs (.btn-red_1 container)
        │                      clicks "המשך" submit button
        │
        ├── hapoalim-session.mjs  save/load cookies to Firestore
        │                         markHapoalimSuccess() → lastScrapeAt timestamp
        │                         staleness alert (>2 days) only after Hapoalim run
        │
        ├── dedup.mjs          sha256 txn ID, skip if exists in Firestore
        │
        ├── categorizer.mjs    1. budget_rules (Firestore, 5min cache)
        │                      2. Gemini 2.5 Flash + googleSearch tool
        │                      3. null → keyboard in Telegram
        │
        ├── budget.mjs         monthly spend per bucket, Firestore-backed amounts
        │
        ├── notifier.mjs       send/edit Telegram messages (HTML parse mode)
        │                      inline keyboard on every message
        │
        └── index.mjs          Express: /scrape + /scrape-hapoalim + /webhook + callback_query
                               /otp command → stores code in Firestore otp_cache/hapoalim
                               /status command (summary + drill-down)
                               /budget command (view + edit amounts)
                               polling mode locally, webhook in Cloud Run
```

## Scrape Profiles

| Name | Company | Credentials |
|------|---------|-------------|
| owner1 | isracard | `ISRACARD_ID`, `ISRACARD_DIGITS`, `ISRACARD_PASS` |
| owner1-max | max | `MAX_ID`, `MAX_PASS` |
| owner2 | isracard | `OWNER2_ISRACARD_ID`, `OWNER2_ISRACARD_DIGITS`, `OWNER2_ISRACARD_PASS` |
| owner1 | hapoalim | `HAPOALIM_USER`, `HAPOALIM_PASS` |

Owner display names in Telegram messages come from `OWNER1_DISPLAY` / `OWNER2_DISPLAY` env vars.

## Hapoalim Session & OTP Flow

- Cookies saved to Firestore `hapoalim_session/cookies` after successful login
- On each Cloud Run scrape: cookies injected into browser before scraping
- Max cookie age: 14 days — after that, session treated as expired
- **OTP handling (Cloud Run)**: sessions are IP-bound, so Cloud Run always triggers OTP
  1. `startOtpWatcher(browser)` runs alongside `scraper.scrape()` in background
  2. Watcher polls browser pages every 3s, detects `/ng-portals/auth/he/` URL
  3. Waits 3s, checks if OTP inputs are visible (distinguishes OTP page from normal auth redirect)
  4. Sends Telegram: "📱 פועלים מבקש קוד SMS — שלח: /otp [קוד]"
  5. Polls Firestore `otp_cache/hapoalim` every 4s for up to 5 minutes
  6. User sends `/otp XXXXX` → bot writes code to Firestore
  7. Watcher finds code, types each digit into the 5 individual OTP inputs (inside `.btn-red_1` container)
  8. Clicks "המשך" submit button → page redirects → `waitForRedirect` (patched to 300s) continues
  9. Session cookies saved, `lastScrapeAt` updated, staleness alert reset
- **Staleness alert**: if `lastScrapeAt` > 2 days ago, Telegram message sent after each Hapoalim run
- `hapoalim.ts` patched: `waitForRedirect(this.page, 300000)` (was 20s default)

## Hapoalim Filters

**Skipped** (internal transfers / credit card payments / income):
- Credit card payments: מסטרקרד, דיינרס, מקס איט, כרטיסי אשראי
- Card loading: טעינת כרטיס, החזר טעינה
- Transfers: העברה, העב', bit העברת
- Securities: ני"ע-מכירה (sale = income)
- Income: זיכוי מ*, קצבת ילדים, תיקון מס, רבית
- **All positive chargedAmount** (salary, bonuses, grants, refunds)

**Kept** (actual expenses):
- הוראות קבע: טפחות משכנתא, הו"ק הלוואה, ביטוח
- ני"ע-קניה, ני"ע-דמי ניהול → חסכנות
- מנורה השתלמות → הלוואות (loan against hishtalmut fund)
- All other negative transactions

## Categories & Budget Buckets

| Category | Emoji | Bucket | Default ₪ |
|----------|-------|--------|-----------|
| קניות לבית | 🛒 | אוכל | 7,000 |
| מסעדות | 🍽️ | מסעדות | 500 |
| תחבורה | 🚗 | תחבורה | 3,546 |
| בריאות | 💊 | בריאות | 1,003 |
| ביגוד | 👕 | ביגוד | 1,500 |
| בידור | 🎬 | בידור | 76 |
| חשבונות | 📄 | חשבונות | 2,254 |
| חינוך | 🏫 | חינוך | 3,260 |
| חוגים | 🎯 | חוגים | 545 |
| נסיעות | ✈️ | חופשות | 700 |
| קניות אונליין | 🛍️ | שונות | 3,000 |
| הלוואות | 🏦 | הלוואות | 7,087 |
| חסכנות | 💰 | חסכנות | 1,000 |
| תרומות | 🤲 | תרומות | 300 |
| אחר | 📦 | שונות | 3,000 |

Budget amounts are editable via `/budget` → stored in Firestore `budget_amounts` collection.

## Firestore Collections

| Collection | Purpose |
|-----------|---------|
| `budget_transactions` | All transactions with category, telegramMessageId |
| `budget_rules` | Merchant → category patterns (rule engine) |
| `budget_amounts` | Per-bucket amount overrides (editable via /budget) |
| `hapoalim_session` | Hapoalim browser cookies + `lastScrapeAt` timestamp |
| `otp_cache` | Temporary OTP code storage (`hapoalim` doc, written by /otp command, read+deleted by watcher) |

## Telegram Bot

- **Token**: `TELEGRAM_BOT_TOKEN` in `.env` / Secret Manager
- **Commands**: `/status` (budget summary + drill-down), `/budget` (view + edit amounts), `/otp [code]` (submit Hapoalim OTP)

## GCP / Infrastructure

- **Cloud Run service**: `budget-bot`
- **Region**: `europe-west1` (or your preferred region)
- **Secret Manager secrets**:
  - `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
  - `OWNER1_DISPLAY`, `OWNER2_DISPLAY`
  - `GEMINI_API_KEY`
  - `ISRACARD_ID`, `ISRACARD_DIGITS`, `ISRACARD_PASS`
  - `OWNER2_ISRACARD_ID`, `OWNER2_ISRACARD_DIGITS`, `OWNER2_ISRACARD_PASS`
  - `MAX_ID`, `MAX_PASS`
  - `HAPOALIM_USER`, `HAPOALIM_PASS`

## Tech Stack

- Node.js 22.13.0 (ESM, `.mjs`)
- `israeli-bank-scrapers` — cloned at `israeli-bank-scrapers/`, built to `lib/`
- `puppeteer` — external browser for Hapoalim session management
- `@google-cloud/firestore`
- `@google/generative-ai` — Gemini 2.5 Flash + googleSearch tool
- `node-telegram-bot-api`
- `express`
- `dotenv`

## Utility Scripts

| Script | Purpose |
|--------|---------|
| `node src/seed-rules.mjs` | Populate Firestore with merchant category patterns |
| `node src/recategorize.mjs` | Backfill null-category transactions via Gemini |
| `node src/repost.mjs [--no-delete] [--limit N]` | Re-post transactions with current UI |
| `node src/clear-chat.mjs` | Delete all messages in Telegram group |
| `node src/scrape-hapoalim-local.mjs` | Local Hapoalim scrape with OTP + session save |

## Local Dev

```bash
export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh" && nvm use 22.13.0
node src/index.mjs                          # polling mode, port 8080
curl -X POST localhost:8080/scrape          # trigger card scrape
curl -X POST localhost:8080/scrape-hapoalim # trigger Hapoalim scrape
node src/scrape-hapoalim-local.mjs          # refresh Hapoalim session (OTP required)
```
