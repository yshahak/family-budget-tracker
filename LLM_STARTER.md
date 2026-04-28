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

Cards (Isracard + Max) run on a schedule. Hapoalim requires OTP so it is triggered manually via the `/hapoalim` Telegram command — no scheduler job needed for it.

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
```

---

## Step 7 — First Hapoalim scrape (OTP required)

Bank Hapoalim requires SMS OTP authentication. The flow is:
1. Send `/hapoalim` in your Telegram group
2. The bot starts the scraper and detects the OTP page automatically
3. The bot sends a prompt: "📱 פועלים מבקש קוד SMS"
4. Reply with `/otp [code]` — the bot fills it in and continues

No session is saved between runs — OTP is required each time you scrape Hapoalim. This is why Hapoalim is triggered manually via the Telegram command rather than on a schedule.

### ⚠️ OTP entry is fragile — read this before debugging

Getting the OTP to actually land in the right input fields on Hapoalim's page was **not straightforward** and required significant trial and error. The page structure is non-obvious:

- Hapoalim's OTP form has multiple hidden inputs alongside the visible digit boxes
- The OTP watcher identifies inputs by filtering for visible fields with no `id` or `name` attribute
- Input values must be set via `dispatchEvent` (Angular's change detection ignores direct `.value =` assignment without events)
- The submit button is identified by class `.btn-red_1` or inner text `"המשך"`

The code in `hapoalim-otp.mjs` logs extensive debug info to help if the OTP stops working — page title, all inputs (type/id/name/visibility), all buttons, and a screenshot saved to `/tmp/hapoalim-otp-page.png`. Check Cloud Run logs after a failed OTP attempt:

```bash
gcloud logging read "resource.labels.service_name=budget-bot" \
  --project=$PROJECT --format="value(timestamp,textPayload)" --limit=80 --freshness=10m \
  | grep -i "otp\|input\|button\|page state"
```

If the page structure has changed (Hapoalim redesigns their auth page occasionally), you'll need to inspect what `hapoalim-otp.mjs` logs and update the selector logic in the `filled = await page.evaluate(...)` block accordingly.

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
| `otp_cache` | Temporary OTP code relay (`/otp` command → scraper) |

---

## Customizing budget buckets

Edit `src/budget.mjs` to change bucket names, amounts, or which categories roll up into each bucket. Run `/budget` in Telegram to edit amounts without redeployment (stored in Firestore).

## Adding a new bank or credit card source

The bot can scrape any source supported by [israeli-bank-scrapers](https://github.com/eshaham/israeli-bank-scrapers/blob/master/src/definitions.ts). Walk the user through these steps:

### Step A — Identify the scraper company ID

Open the `CompanyTypes` enum in `israeli-bank-scrapers/src/definitions.ts` (or the library's README) and find the key for the new bank. Common values: `leumi`, `discount`, `mizrahi`, `visaCal`, `beinleumi`, `amex`, `yahav`.

### Step B — Gather credentials

Ask the user what credentials the bank requires (username/password, ID number, card digits, etc.). These vary by scraper — check the library docs or the existing profiles in `src/config.mjs` for examples.

### Step C — Add secrets to Secret Manager

```bash
echo -n "value" | gcloud secrets create MY_BANK_USER --data-file=- --project=$PROJECT
echo -n "value" | gcloud secrets create MY_BANK_PASS --data-file=- --project=$PROJECT
```

### Step D — Add a profile in `src/config.mjs`

```js
{
  name: 'my-bank',              // internal key stored in Firestore — NEVER change after first run
  displayName: 'שם לתצוגה',    // shown in Telegram messages
  company: 'leumi',             // CompanyTypes key
  credentials: {
    username: process.env.MY_BANK_USER,
    password: process.env.MY_BANK_PASS,
  },
},
```

Profiles with any `undefined` credential are automatically skipped at startup, so it is safe to define the profile before the secrets exist.

### Step E — Update the deploy command

Add the new secrets to the `--set-secrets` flag in the `gcloud run deploy` command (Step 5 above), then redeploy:

```bash
# Add to --set-secrets: MY_BANK_USER=MY_BANK_USER:latest,MY_BANK_PASS=MY_BANK_PASS:latest
gcloud run deploy budget-bot --source . --region=$REGION ...
```

### Step F — Test

Trigger a manual scrape and check logs:

```bash
curl -X POST $SERVICE_URL/scrape
gcloud logging read "resource.labels.service_name=budget-bot" --limit=30 --freshness=2m
```

### OTP / two-factor sources

If the new bank requires OTP, no extra code is needed. The existing OTP watcher (`hapoalim-otp.mjs`) detects any OTP page automatically, sends a Telegram prompt, and waits for `/otp [code]`. Add the new company to the manual-trigger flow by telling the user to use the `/hapoalim` command (or extend `index.mjs` with a dedicated command for the new bank).

---

## CI/CD (optional)

The project can be deployed via GitHub Actions using Workload Identity Federation. See [this guide](https://cloud.google.com/blog/products/identity-security/enabling-keyless-authentication-from-github-actions) for the WIF setup, then add a workflow that runs `gcloud builds submit` on push to main.
