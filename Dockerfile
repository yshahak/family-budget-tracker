FROM --platform=linux/amd64 node:22-bookworm-slim

# Shared libraries required by Chrome/Chromium
RUN apt-get update && apt-get install -y \
    ca-certificates fonts-liberation libappindicator3-1 libasound2 libatk-bridge2.0-0 \
    libatk1.0-0 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgbm1 \
    libgcc1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 libpangocairo-1.0-0 \
    libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 \
    libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 \
    lsb-release wget xdg-utils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Shared cache so both puppeteer instances (app + library) use the same Chrome binary
ENV PUPPETEER_CACHE_DIR=/root/.cache/puppeteer

WORKDIR /app

# ── Build israeli-bank-scrapers (downloads compatible Chrome into shared cache) ─
COPY israeli-bank-scrapers/package*.json ./israeli-bank-scrapers/
RUN cd israeli-bank-scrapers && npm ci

COPY israeli-bank-scrapers/src            ./israeli-bank-scrapers/src/
COPY israeli-bank-scrapers/tsconfig.json  ./israeli-bank-scrapers/
COPY israeli-bank-scrapers/tsconfig.build.json ./israeli-bank-scrapers/
COPY israeli-bank-scrapers/.babelrc.js         ./israeli-bank-scrapers/

RUN cd israeli-bank-scrapers && npx babel src --out-dir lib --extensions ".ts" --source-maps inline

# ── Install app dependencies (puppeteer reuses Chrome already in shared cache) ──
COPY package*.json ./
RUN npm ci --omit=dev

# ── Copy application source ───────────────────────────────────────────────────
COPY src/ ./src/

ENV NODE_ENV=production
EXPOSE 8080

CMD ["node", "src/index.mjs"]
