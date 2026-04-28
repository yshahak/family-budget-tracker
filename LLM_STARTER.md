# LLM Setup Guide — Israeli Family Budget Bot

This document is intended to be read by an AI assistant (Claude, ChatGPT, etc.) to guide a user through setting up this system from scratch. Follow each section in order. Ask the user for confirmation at every step that requires them to perform an action outside the terminal.

---

## Prerequisites checklist

Ask the user to confirm they have:
- [ ] A **Google Cloud** account with billing enabled
- [ ] The **`gcloud` CLI** installed and authenticated (`gcloud auth login`)
- [ ] **Node.js 22+** installed (check with `node --version`; use `nvm` if needed)
- [ ] A **Telegram account** and access to create bots via @BotFather
- [ ] Credentials for at least one supported Israeli bank (Isracard, Max, or Hapoalim)

---

## Step 1 — Clone the repositories

The bot depends on [israeli-bank-scrapers](https://github.com/eshaham/israeli-bank-scrapers). Clone both into the same parent directory:

```bash
git clone https://github.com/eshaham/israeli-bank-scrapers
git clone https://github.com/YOUR_USERNAME/israeli-budget-bot
cd israeli-budget-bot
```

**Important patch for Hapoalim**: The default `hapoalim.ts` in the library has a 20-second redirect timeout that is too short for Cloud Run. Apply this patch before building:

```bash
# In israeli-bank-scrapers/src/scrapers/hapoalim/hapoalim.ts
# Find the line: waitForRedirect(this.page, 20000)
# Change it to: waitForRedirect(this.page, 300000)
```

Build the library:
```bash
cd ../israeli-bank-scrapers
npm ci
npx babel src --out-dir lib --extensions ".ts" --source-maps inline
cd ../israeli-budget-bot
```

Install bot dependencies:
```bash
npm ci
```

---

## Step 2 — Create a Telegram bot

1. Open Telegram and search for **@BotFather**
2. Send `/newbot` and follow the prompts (choose a name and username)
3. BotFather will give you a **bot token** — save it
4. Create a **Telegram group** for budget notifications (or use an existing one)
5. Add the bot to the group as an **administrator**
6. To find the **group chat ID**: add [@userinfobot](https://t.me/userinfobot) to the group, it will print the chat ID (a negative number like `-1001234567890`)

---

## Step 3 — Set up GCP project

```bash
# Create a new project or use an existing one
gcloud projects create YOUR_PROJECT_ID --name="Budget Bot"
gcloud config set project YOUR_PROJECT_ID

# Link billing (required for Cloud Run and Secret Manager)
# Do this in the GCP console: https://console.cloud.google.com/billing

# Enable required APIs
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  cloudscheduler.googleapis.com \
  firestore.googleapis.com \
  secretmanager.googleapis.com \
  artifactregistry.googleapis.com
```

Create Firestore database (native mode):
```bash
gcloud firestore databases create --location=europe-west1
# Change location to match your preferred region (europe-west1, us-central1, etc.)
```

Create Artifact Registry repository:
```bash
gcloud artifacts repositories create budget-bot \
  --repository-format=docker \
  --location=YOUR_REGION
```

---

## Step 4 — Configure credentials in Secret Manager

Create one secret per credential. The bot reads all config from environment variables injected by Secret Manager at runtime.

```bash
REGION=europe-west1      # change to your region
PROJECT=YOUR_PROJECT_ID

# Helper function
add_secret() {
  echo -n "$2" | gcloud secrets create "$1" --data-file=- --project=$PROJECT
}

# Telegram
add_secret TELEGRAM_BOT_TOKEN   "your_bot_token_here"
add_secret TELEGRAM_CHAT_ID     "-1001234567890"

# Owner display names (shown in Telegram messages)
add_secret OWNER1_DISPLAY  "Alice"
add_secret OWNER2_DISPLAY  "Bob"

# Isracard (Owner 1) — id = Israeli ID number, digits = last 6 of card
add_secret ISRACARD_ID     "123456789"
add_secret ISRACARD_DIGITS "123456"
add_secret ISRACARD_PASS   "yourpassword"

# Max credit card (Owner 1)
add_secret MAX_ID    "your_max_username"
add_secret MAX_PASS  "yourpassword"

# Isracard (Owner 2) — leave blank / skip if only one card holder
add_secret OWNER2_ISRACARD_ID     "987654321"
add_secret OWNER2_ISRACARD_DIGITS "654321"
add_secret OWNER2_ISRACARD_PASS   "yourpassword"

# Bank Hapoalim
add_secret HAPOALIM_USER "your_hapoalim_username"
add_secret HAPOALIM_PASS "yourpassword"

# Gemini API key (optional — for AI auto-categorization)
# Get free key at https://aistudio.google.com/
add_secret GEMINI_API_KEY "AIzaSy_your_key_here"
```

Grant Cloud Run access to secrets:
```bash
PROJECT_NUMBER=$(gcloud projects describe $PROJECT --format='value(projectNumber)')
gcloud projects add-iam-policy-binding $PROJECT \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

---

## Step 5 — Build and deploy to Cloud Run

```bash
REGION=europe-west1
PROJECT=YOUR_PROJECT_ID
IMAGE=europe-west1-docker.pkg.dev/$PROJECT/budget-bot/budget-bot:latest

# Build (runs on Cloud Build, no local Docker needed)
gcloud builds submit --tag $IMAGE --project=$PROJECT --region=$REGION

# Deploy
gcloud run deploy budget-bot \
  --image=$IMAGE \
  --region=$REGION \
  --project=$PROJECT \
  --platform=managed \
  --no-allow-unauthenticated \
  --memory=2Gi \
  --cpu=1 \
  --cpu-throttling \
  --min-instances=0 \
  --max-instances=1 \
  --timeout=900 \
  --set-secrets="\
TELEGRAM_BOT_TOKEN=TELEGRAM_BOT_TOKEN:latest,\
TELEGRAM_CHAT_ID=TELEGRAM_CHAT_ID:latest,\
OWNER1_DISPLAY=OWNER1_DISPLAY:latest,\
OWNER2_DISPLAY=OWNER2_DISPLAY:latest,\
ISRACARD_ID=ISRACARD_ID:latest,\
ISRACARD_DIGITS=ISRACARD_DIGITS:latest,\
ISRACARD_PASS=ISRACARD_PASS:latest,\
MAX_ID=MAX_ID:latest,\
MAX_PASS=MAX_PASS:latest,\
OWNER2_ISRACARD_ID=OWNER2_ISRACARD_ID:latest,\
OWNER2_ISRACARD_DIGITS=OWNER2_ISRACARD_DIGITS:latest,\
OWNER2_ISRACARD_PASS=OWNER2_ISRACARD_PASS:latest,\
HAPOALIM_USER=HAPOALIM_USER:latest,\
HAPOALIM_PASS=HAPOALIM_PASS:latest,\
GEMINI_API_KEY=GEMINI_API_KEY:latest"

# Get the service URL
SERVICE_URL=$(gcloud run services describe budget-bot --region=$REGION --project=$PROJECT --format='value(status.url)')
echo "Service URL: $SERVICE_URL"

# Set WEBHOOK_URL so the bot switches from polling to webhook mode
gcloud run services update budget-bot \
  --region=$REGION --project=$PROJECT \
  --set-env-vars="WEBHOOK_URL=$SERVICE_URL"
```

---

## Step 6 — Set up Cloud Scheduler

The scraper is split into two endpoints to save resources:
- `/scrape` — Isracard + Max (fast, no OTP)
- `/scrape-hapoalim` — Bank Hapoalim only (slower, session-based)

```bash
PROJECT=YOUR_PROJECT_ID
REGION=europe-west1
SERVICE_URL=https://your-service-url.run.app  # from Step 5

# Allow Cloud Scheduler to invoke Cloud Run
gcloud projects add-iam-policy-binding $PROJECT \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/run.invoker"

# Cards: Sun–Thu every 2h between 10:00–20:00
gcloud scheduler jobs create http budget-bot-cards-weekday \
  --location=$REGION \
  --schedule="0 10,12,14,16,18,20 * * 0,1,2,3,4" \
  --uri="$SERVICE_URL/scrape" \
  --http-method=POST \
  --time-zone="Asia/Jerusalem" \
  --oidc-service-account-email="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

# Cards: Friday (shorter day in Israel)
gcloud scheduler jobs create http budget-bot-cards-friday \
  --location=$REGION \
  --schedule="0 10,12,14,16 * * 5" \
  --uri="$SERVICE_URL/scrape" \
  --http-method=POST \
  --time-zone="Asia/Jerusalem" \
  --oidc-service-account-email="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

# Hapoalim: once daily Sun–Thu at 10:00
gcloud scheduler jobs create http budget-bot-hapoalim \
  --location=$REGION \
  --schedule="0 10 * * 0,1,2,3,4" \
  --uri="$SERVICE_URL/scrape-hapoalim" \
  --http-method=POST \
  --time-zone="Asia/Jerusalem" \
  --oidc-service-account-email="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
```

---

## Step 7 — First Hapoalim login (OTP required)

Bank Hapoalim requires SMS OTP on first login. The session is then saved to Firestore and reused for up to 14 days.

The flow uses a Firestore document (`otp_cache/hapoalim`) as a relay:
1. The cloud scraper detects the OTP page and polls Firestore waiting for a code
2. You (locally) write the received SMS code to Firestore

**First-time setup:**
```bash
# Make sure .env is filled in locally (copy from .env.example)
node src/scrape-hapoalim-local.mjs
# A browser will open. Complete any OTP prompt.
# Session cookies are saved to Firestore automatically.
```

**When the session expires** (after ~14 days), the bot will send a Telegram alert with a reminder to run this script again.

To check session health: trigger a scrape via Cloud Scheduler or `curl -X POST $SERVICE_URL/scrape-hapoalim`.

---

## Step 8 — Seed categorization rules (optional but recommended)

The bot ships with a set of common Israeli merchant patterns. Seed them into Firestore:

```bash
node src/seed-rules.mjs
```

Rules are stored in the `budget_rules` Firestore collection and can be edited there directly. When the bot categorizes a transaction manually via Telegram keyboard, it also saves the pattern as a rule for future transactions.

---

## Step 9 — Smoke test

```bash
# Trigger a manual card scrape
curl -X POST $SERVICE_URL/scrape

# Check Cloud Run logs
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=budget-bot" \
  --project=$PROJECT --format="value(timestamp,textPayload)" --limit=50 --freshness=5m

# Try Telegram commands in your group
/status   # shows monthly budget summary
/budget   # shows budget amounts (tap to edit)
```

---

## Firestore collections reference

| Collection | Purpose |
|-----------|---------|
| `budget_transactions` | All transactions (dedup, category, Telegram message ID) |
| `budget_rules` | Merchant → category patterns |
| `budget_amounts` | Per-bucket monthly amount overrides (edited via /budget) |
| `hapoalim_session` | Hapoalim browser cookies for session persistence |
| `otp_cache` | Temporary OTP relay between Cloud Run and local script |

---

## Customizing budget buckets

Edit `src/budget.mjs` to change bucket names, amounts, or which categories roll up into each bucket. Run `/budget` in Telegram to edit amounts without redeployment (stored in Firestore).

## Adding more scrapers

Add a new entry to the `profiles` array in `src/config.mjs` with a supported `company` value from [israeli-bank-scrapers](https://github.com/eshaham/israeli-bank-scrapers/blob/master/src/definitions.ts) and the matching credential env vars.

## CI/CD (optional)

The project can be deployed via GitHub Actions using Workload Identity Federation. See [this guide](https://cloud.google.com/blog/products/identity-security/enabling-keyless-authentication-from-github-actions) for the WIF setup, then add a workflow that runs `gcloud builds submit` on push to main.
