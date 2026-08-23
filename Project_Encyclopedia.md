# Project Encyclopedia — ICT Trade Journal + PnL Tracker

## 0. Scope, sources, and how to read this document

This document was produced by directly reading the source of the two live production repositories:

- **`aicubeapps/Trade_Journal`** — single file `index.html` (1,081,341 bytes / 20,216 lines). Referred to throughout as **the Journal**. Internally the app calls itself "ICT Trade Journal". Live at `https://trade-journal-5xk.pages.dev`.
- **`aicubeapps/Profit_Tracker`** — single file `index.html` (141,390 bytes / 2,549 lines). Referred to throughout as **PnL Tracker** (its own `<title>`). Live at `https://profit-tracker-35v.pages.dev`.

Both are single-page apps: all HTML, CSS and JavaScript live in one file each, loaded directly by Cloudflare Pages with no build step. They share one Supabase backend (same project, same `SUPA_URL`/`SUPA_KEY` hardcoded in both files) and one Cloudflare Worker (`pnl-worker`).

Two supporting repositories were also read in full to document the backend accurately:

- **`aicubeapps/stox_worker`** (local folder name `pnl-worker`) — the actual deployed source of `pnl-worker.aicube-apps.workers.dev`, the Worker both apps call.
- **`aicubeapps/trade-journal-worker`** — a public, generic "Deploy to Cloudflare" template of the same Worker, intended for buyers/end-users who self-host their own Worker instance (see §8, Buyer Onboarding).

Where something could not be determined from these four repositories (e.g. exact Supabase Dashboard configuration, DNS, billing), it is explicitly flagged:
⚠️ *Cannot be determined from source — manual verification required*

---

# Table of Contents

0. Scope, sources, and how to read this document
1. High-level architecture
2. Cloudflare Pages hosting
3. GitHub integration
4. Cloudflare Workers
5. Supabase architecture
6. Cloudflare Worker code — deployment recap
7. The three-tier trade hierarchy
8. Buyer onboarding / configurator system
9. Offline build
10. Replication guide
11. Dependency map & call chains
12. Trade_Journal — Function Reference (469 functions)
13. Profit_Tracker — Function Reference (68 functions)

---

## 1. High-level architecture

```
┌─────────────────────────┐        ┌──────────────────────────┐
│   Trade_Journal          │        │   Profit_Tracker          │
│   (trade-journal-5xk     │        │   (profit-tracker-35v     │
│   .pages.dev)             │        │   .pages.dev)              │
│   single index.html       │        │   single index.html        │
└──────────┬────────────────┘        └───────────┬────────────────┘
           │  Supabase JS client (@supabase/supabase-js@2, UMD via jsDelivr CDN)
           │  same project on both sides
           ▼
┌───────────────────────────────────────────────────────────────────┐
│  Supabase project  klgibccfziktzvlomwve.supabase.co                │
│  - Postgres (12 tables, see §5)                                    │
│  - Auth (email/password)                                           │
│  - Storage bucket "screenshots"                                    │
└───────────────────────────────────────────────────────────────────┘
           ▲                                     ▲
           │ GET/POST (fetch, CORS)               │ GET/POST
┌──────────┴────────────────────┐      ┌──────────┴──────────────────┐
│ pnl-worker.aicube-apps          │      │ ebp-tracker-worker.aicube-   │
│ .workers.dev  (Cloudflare       │      │ apps.workers.dev              │
│ Worker — see §4.2)              │      │ (external product, only the  │
│  - GET /ff-calendar             │      │  GET /signals/:id route is    │
│  - GET /discord-messages        │      │  consumed by the Journal —    │
│  - POST /  (Gemini proxy)       │      │  see §4.5)                    │
│  - /bse/* (BSE_Trader routes,   │      └───────────────────────────────┘
│    unrelated to this suite)     │
└──────────┬───────────────────────┘
           │ server-side only (secrets never reach the browser)
           ▼
   Forex Factory JSON · Discord API v10 · Gemini generateContent API

Also called directly from the browser (no proxy):
  - Trade_Journal → generativelanguage.googleapis.com (Gemini Vision, user's own API key) — AI Review
  - Profit_Tracker → api.frankfurter.app (ECB FX rates, no key) — cross-pair conversion
```

Both apps are deployed as **Cloudflare Pages** projects connected via Git integration to their respective GitHub repos (`aicubeapps/Trade_Journal` → `trade-journal-5xk.pages.dev`, `aicubeapps/Profit_Tracker` → `profit-tracker-35v.pages.dev`). Because each app is a single static HTML file with no build tooling (no `package.json`, no bundler config in either repo), Cloudflare Pages serves it as a static asset with build command "none" / output directory `/`.

---

## 2. Cloudflare Pages hosting

### 2.1 Trade_Journal (`trade-journal-5xk.pages.dev`)

- Repo: `aicubeapps/Trade_Journal`, single tracked file `index.html` + `_headers`.
- `_headers` file (verbatim):
  ```
  /*
    X-Frame-Options: SAMEORIGIN
    Content-Security-Policy: frame-src 'self' https://*.tradingview.com https://s.tradingview.com https://profit-tracker-35v.pages.dev;
  ```
  This allows the Journal to iframe TradingView widgets and the PnL Tracker Pages URL specifically, and prevents the Journal itself from being framed by third parties other than itself.
- Build settings: ⚠️ *Cannot be determined from source — manual verification required* (no `wrangler.toml`/`_routes.json`/build config file exists in the repo; a static-file Pages project needs none). Expected: Framework preset "None", Build command empty, Build output directory `/`.
- Environment variables: **none** — all configuration (Supabase URL/anon key, Worker URL, default pairs) is hardcoded in the `CONFIG` object at the top of the inline `<script>` (line 7337), not injected via Pages environment variables. See §8 for why (buyer/configurator token-replacement model).

### 2.2 Profit_Tracker (`profit-tracker-35v.pages.dev`)

- Repo: `aicubeapps/Profit_Tracker`, single tracked file `index.html` + `_headers`.
- `_headers` file (verbatim):
  ```
  /*
    Content-Security-Policy: frame-ancestors *
  ```
  Deliberately permissive — allows this app to be framed by anything (consistent with it being embedded as a "PnL" tab/iframe from elsewhere, e.g. the Journal's own `page-pnl`, which the Journal's CSP explicitly allows in reverse).
- Same CONFIG-block-hardcoded-credentials pattern as the Journal (own copy of `SUPA_URL`, `SUPA_KEY`, `CF_WORKER`, duplicated verbatim from the Journal's CONFIG block).
- Environment variables: none.

---

## 3. GitHub integration

- Org: **`aicubeapps`**.
- Repos directly relevant to this suite:
  | Repo | Purpose |
  |---|---|
  | `Trade_Journal` | Journal frontend (this doc's primary subject) |
  | `Profit_Tracker` | PnL Tracker frontend (this doc's primary subject) |
  | `stox_worker` (deployed as **pnl-worker**) | Private source of truth for the live `pnl-worker.aicube-apps.workers.dev` Worker |
  | `trade-journal-worker` | Public generic Worker template for buyers (§8) |
- Cloudflare Pages Git integration auto-deploys both `Trade_Journal` and `Profit_Tracker` on push to their default branch (`main`) — this is the standard Pages behavior; no custom CI config (no `.github/workflows`) exists in either repo.
- The Worker (`pnl-worker`/`stox_worker`) is explicitly **not** on this auto-deploy path — see §4.2.1 "Deploy pipeline note" for the documented reason (a broken shared Cloudflare "build token" makes Git-triggered Worker builds fail; the team deploys it manually with `wrangler deploy` instead).
- `aicubeapps.github.io` appears in the Worker's `ALLOWED_ORIGINS` CORS allow-list, implying a GitHub Pages site also calls this Worker, but no such repo was discoverable via the tooling used to write this document (a `git ls-remote` probe for `aicubeapps/aicubeapps.github.io` returned "Repository not found").
  ⚠️ *Cannot be determined from source — manual verification required* (purpose of this origin; possibly a marketing/landing page or the buyer configurator page itself).

---

## 4. Cloudflare Workers

### 4.1 Overview

One Worker, **`pnl-worker`**, deployed at `pnl-worker.aicube-apps.workers.dev`, backs both apps plus two unrelated sibling apps in the same Cloudflare account (`BSE_Trader`, a stock trading journal — its `/bse/*` routes are documented here only because they live in the same file, not because they are part of this project). There is also a **separate**, publicly-templated version of similar code in `trade-journal-worker` intended for buyers to deploy on their own Cloudflare account (§8), and a **wholly separate** third-party Worker, `ebp-tracker-worker`, that the Journal calls as an external signal-lookup integration (§4.5) but does not own or deploy.

### 4.2 `pnl-worker` (the live, private Worker)

**Source:** `stox_worker/src/worker.js` (local checkout name `pnl-worker`). **Config:** `wrangler.toml`:
```toml
name = "pnl-worker"
main = "src/worker.js"
compatibility_date = "2026-07-13"
account_id = "ceccc63b3818d9285b86119580bfbebf"
preview_urls = false

[observability]
enabled = true

[[r2_buckets]]
binding = "BSE_SCREENSHOTS"
bucket_name = "bse-trader-screenshots"
```

**Secrets** (set via `wrangler secret put <NAME>` or CF Dashboard → Workers & Pages → pnl-worker → Settings → Variables):
| Secret | Required for | Notes |
|---|---|---|
| `GEMINI_API_KEY` | `POST /` (Gemini proxy, used by PnL Tracker) | Google AI Studio key |
| `DISCORD_TOKEN` | `GET /discord-messages` | Personal Discord **user** token, not a bot token |
| `OPENAI_API_KEY` | *(reserved, unused by any route in this file)* | Documented in README as reserved for future use |

**CORS.** `ALLOWED_ORIGINS = ["https://profit-tracker-35v.pages.dev", "https://trade-journal-5xk.pages.dev", "https://bse-trader.pages.dev", "https://aicubeapps.github.io", "null"]`, plus any `http://localhost:<port>` origin (regex `^http:\/\/localhost:\d+$`, to tolerate Vite's auto-incrementing dev-server port). `resolveOrigin(request)` echoes the request's `Origin` header back if it matches, else falls back to the first allowed origin. `corsHeaders(origin)` sets `Access-Control-Allow-Origin`, `-Methods: GET, POST, OPTIONS`, `-Headers: Content-Type, Authorization, x-dhan-token, x-dhan-client-id, x-upstox-token`. `OPTIONS` requests short-circuit to a 204-style empty response with these headers (preflight).

**Routes:**

| Method | Path | Used by | Auth | Behavior |
|---|---|---|---|---|
| `GET` | `/ff-calendar` | Journal (`EC` module) | none | Server-side fetch of `https://nfs.faireconomy.media/ff_calendar_thisweek.json` (browsers are blocked from calling this directly — no CORS on the upstream). Returns the JSON verbatim with `Content-Type: application/json`. On upstream failure/non-2xx → `502 {error:"FF calendar fetch failed", detail}`. |
| `GET` | `/discord-messages?channel=<id>&limit=<n≤50>` | Journal (`DC` module) | none (Worker holds the real secret) | Requires `env.DISCORD_TOKEN`, else `503`. Validates `channel` is all-digits, else `400`. Proxies `GET https://discord.com/api/v10/channels/{channel}/messages?limit={limit}` with `Authorization: {DISCORD_TOKEN}` and a spoofed `User-Agent: DiscordBot (personal-journal, 1.0)`. Maps the raw Discord message array down to a minimal safe shape: `{id, content, timestamp, author:{username, display_name, avatar}, embeds:[{title,description,url,color}], attachments:[{url,filename,content_type}]}` — strips everything else so no extra Discord account data leaks to the browser. Non-2xx upstream → passes through Discord's status + error text. |
| `POST` | `/bse/upload-screenshot` | BSE_Trader (unrelated app) | Supabase JWT (decode-only, see below) | Writes to R2 bucket `BSE_SCREENSHOTS`, key `{userId}/{tradeId}/{timestamp}_{filename}`. |
| `GET` | `/bse/screenshot?key=&token=` | BSE_Trader | Supabase JWT | Serves object from R2, 403 if key doesn't start with `{userId}/`. |
| `POST` | `/bse/dhan-proxy` | BSE_Trader | `x-dhan-token` header | Proxies Dhan broker API. |
| `GET` | `/bse/upstox-ltp` | BSE_Trader | `x-upstox-token` header | Proxies Upstox LTP quote API. |
| `GET` | `/bse/upstox-search` | BSE_Trader | `x-upstox-token` header | Proxies Upstox instrument search. |
| `POST` | `/` (any other POST) | PnL Tracker (`fetchProfileRules`, `ensureAssetSpecLookup`) | none | **Gemini AI proxy.** See §4.3. |
| any other method | any other path | — | — | `405 {error:"Method not allowed"}` |

> The `/bse/*` routes and the R2 bucket `bse-trader-screenshots` belong to the sibling **BSE_Trader** app, not to the Journal or PnL Tracker — neither of the two apps this document covers reads or writes R2/`BSE_SCREENSHOTS` anywhere in their source. They are documented here only because they live in the same `worker.js` file and share its CORS/secret configuration. The Journal and PnL Tracker instead use **Supabase Storage** (bucket `screenshots`) for all their own screenshot persistence (§5.9).

**`validateSupabaseJwt(authHeader, env)`** (used only by the `/bse/*` routes): decodes the JWT payload with `atob()` **without verifying the signature** — the code comment is explicit that this is intentional: *"Supabase RLS is the actual data security boundary; this just extracts the user id and expiry."* Checks `payload.exp` against current time, returns `payload.sub` (the user id) or `null`.

#### 4.2.1 Deploy pipeline note (from the repo's own README)

> Tried Cloudflare Workers Builds (Git-connected auto-deploy) on 2026-08-07 — abandoned. Builds failed on a stale account-level "build token" shared with this Cloudflare account's other 7 connected repos; reconnecting the repo just re-selected the same broken token instead of minting a new one, and fixing it at the account level risked breaking those other repos' pipelines. Not worth the blast radius for one Worker.
>
> **Deploy manually with `npx wrangler deploy` after every change.**

This means: unlike the two Pages projects (which auto-deploy on `git push`), **pushing to the `stox_worker`/`pnl-worker` GitHub repo does NOT redeploy the live Worker.** A human must run `wrangler deploy` from a local checkout after every change, or paste `worker.js` into the CF Dashboard's "Quick Edit". Anyone replicating this project should be aware the GitHub repo can silently drift from what's actually running.

### 4.3 Gemini AI proxy (`POST /` on `pnl-worker`)

Used exclusively by **PnL Tracker**, for two purposes — never by the Journal (the Journal calls Gemini directly from the browser instead, see §4.4).

Request body: `{ mode: "asset_spec" | "profile_rules", firmName?, accountType?, symbol?, brokerContext? }`.

- `mode: "asset_spec"` — requires `symbol`. Builds a prompt asking Gemini for the standard contract specification of a trading instrument (used when PnL Tracker encounters a pair it doesn't recognize — indices, commodities, exotic crosses). Expected JSON shape: `{contract_size, quote_currency, point_value_usd, source_confidence: "high"|"low", notes}`.
- `mode: "profile_rules"` — requires `firmName`. Builds a prompt asking Gemini for a prop firm's or broker's trading rules and commission structure across 4 asset classes (forex/metals/indices/commodities), used to auto-fill a new Broker/Firm Profile. Expected JSON shape includes optional `prop_rules` (profit target %, drawdown type/%, daily loss limit %, daily reset UTC hour) when `brokerContext==="prop"`, plus per-asset-class commission/lot-size/point-value fields, each with a `source_confidence`.

Call chain: `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key={GEMINI_API_KEY}` (live worker) — note the public `trade-journal-worker` template still targets `gemini-2.0-flash-lite` too, while the live worker's file header comment says "Model: gemini-3.5-flash" but the actual fetch URL in the same file uses `gemini-3.5-flash` — ⚠️ *the live pnl-worker's actual model string in the fetch call is `gemini-3.5-flash`, differing from both its own header comment intent and the public template's `gemini-2.0-flash-lite`; this looks like an un-synced upgrade between the private and public copies — verify which model is actually live before replicating.* `generationConfig.temperature = 0.2`. Response text is stripped of Markdown code fences (`` ```json``/`` ``` ``) and `JSON.parse`d; a parse failure returns `502 {error:"Could not parse Gemini response as JSON", raw}`. No retry loop on this proxy (unlike the Journal's direct-call path, §4.4, which does retry).

### 4.4 Gemini AI Review (direct browser call, Trade_Journal only)

The Journal's "AI Review" feature (scoring a closed daily trade or a completed weekly review) calls Gemini **directly from the browser**, bypassing the Worker entirely, using an API key the user pastes into Settings (`geminiKeyInput` → `saveGeminiKey()` → `localStorage['ict_gemini_key_' + userId]`). Function `callGeminiVision(promptText, imageDataUrls)`:
- Endpoint: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key={key}`.
- Retries on HTTP 429 (rate limit) up to 3 times before surfacing `Error('Gemini rate limit (429) — retried 3 times')`.
- Sends the prompt text plus one or more images (`imageDataUrls`) as multimodal input — the images are the trade's chart screenshots, so the AI can visually assess entries/exits against the user's own annotated charts. (See chunk-4 function docs, §2, for the exact request payload shape, image encoding, and compression handled by the screenshot-upload pipeline before this call.)
- The Worker is never involved — no server-side key, no proxy, no rate limiting beyond Gemini's own. This is a deliberate **BYOK (bring your own key)** design so the app owner doesn't pay for or rate-limit every user's AI review usage.

### 4.5 EBP integration (external signal lookup — NOT an owned Worker)

The Journal integrates with a **separate product**, "EBP" (its own worker `ebp-tracker-worker.aicube-apps.workers.dev`, a different codebase/business than this Journal — the local `EBP_TRACKER` checkout available for reference during this audit is that separate product's own repo, not part of Trade_Journal/Profit_Tracker). The Journal only *consumes* one read endpoint of it, configured per-user in Settings:

- Settings fields: `ebpWorkerUrl` (placeholder `https://ebp-tracker-worker.aicube-apps.workers.dev`) and a secret, both saved to `localStorage` (`ict_ebp_worker_url`, `ict_ebp_secret`) via `ebpSaveSettings()`.
- `ebpTestConnection()` — sanity-checks the configured URL/secret by requesting `GET {workerUrl}/signals/TEST` with header `X-Journal-Secret: {secret}`; a `404` is treated as "✓ Connected" (endpoint reachable, TEST id just doesn't exist), `401` as "✕ Wrong secret".
- `cmFetchSignal()` — used from the **close-trade modal**: `GET {workerUrl}/signals/{signalId}` with header `X-Journal-Secret: {secret}`. Response shape consumed: `{template_type, symbol, direction, htf_tf, ltf_tf, htf_bias, session, price_at_signal, fired_at}`. On success, populates `S._cmSignalData` and the trade's `signal_*` columns (`signal_id, signal_template, signal_htf, signal_ltf, signal_direction, signal_fired_at, signal_price, signal_htf_bias, signal_session` — see `tradeToDb()`, §5.2) so a trade can record which automated EBP signal it was based on. `401` → "Unauthorised", `404` → "Signal not found".
- No outbound EBP calls exist besides these three (`/signals/TEST` for test-connection, `/signals/{id}` for fetch). The Journal never writes to EBP; it is read-only from the Journal's side.

### 4.6 Other external network calls (not Cloudflare Workers, no proxy)

| Call | Made by | Purpose |
|---|---|---|
| `https://api.frankfurter.app/latest?from=USD&to=<CCYs>` | PnL Tracker, `fetchFxRates()` | Free ECB daily exchange rates, no key, used to convert cross-currency-pair P&L into USD. |
| Supabase Auth / REST / Storage (`*.supabase.co`) | Both apps | Primary data backend, see §5. |

---

## 5. Supabase architecture

Both apps share **one Supabase project**: `https://klgibccfziktzvlomwve.supabase.co` (hardcoded `SUPA_URL`/anon `SUPA_KEY` in both `CONFIG` blocks — see §8 for why credentials are committed to source rather than using env vars). All access from the browser uses the Supabase anon key plus the signed-in user's JWT; every table is scoped by a `user_id` column, and every application-level query the source contains filters `.eq('user_id', <current user's id>)`, strongly implying Row Level Security policies of the shape `auth.uid() = user_id` are in force (this is the Supabase-idiomatic pattern that makes an anon key safe to hardcode client-side, and it is the standard/expected setup — but the actual `CREATE POLICY` statements were not present in either repo, so their exact wording is an inference, flagged below).

### 5.1 Table inventory

| Table | Owner app(s) | Purpose |
|---|---|---|
| `trades` | Journal (owns), PnL Tracker (reads only) | Every Daily Bias entry AND every Intraday trade (see §7) — both are rows in this one table, distinguished by `is_intraday`. |
| `weeklies` | Journal | Weekly Bias entries (one per pair per week), each with a running log of dated updates. |
| `notes` | Journal | Free-form journal notes (unrelated to trades). |
| `core_rules` | Journal | User's personal trading rulebook, stored as one JSON blob. |
| `cumulative_stats` | Journal | Running lifetime aggregate stats (survives archiving, see §9). |
| `insight_snapshots` | Journal | Cached pre-computed analytics aggregates for the Insights page. |
| `archive_log` | Journal | Audit trail of archive-and-export runs (§9). |
| `sync_meta` | Journal | One row per user: last-modified timestamp + last-writing device id (multi-device cache-busting) + saved Discord channel list. |
| `accounts` | PnL Tracker (owns), Journal (reads only) | A trading account/prop-firm evaluation the user is tracking P&L against. |
| `trade_account_map` | PnL Tracker (owns), Journal (writes on trade close) | Many-to-one: which `trades.id` (intraday only) is assigned to which `accounts.id`. |
| `broker_profiles` | PnL Tracker | Reusable broker/prop-firm commission & rule presets, shared across multiple `accounts`. |
| `asset_specs` | PnL Tracker | Per-symbol contract-spec cache (AI-looked-up or user-edited), for P&L calc on non-standard instruments. |

Plus one **Supabase Storage** bucket: **`screenshots`** (§5.9).

### 5.2 `trades`

The single largest and most important table — holds Weekly-linked "Daily Bias" rows (`is_intraday = false`) and actual "Intraday Execution" rows (`is_intraday = true`). Reverse-engineered column-for-column from `tradeToDb()`/`dbToTrade()` (Trade_Journal/index.html, lines 8746–8890) and the `LIGHT_TRADE_COLS` select-list constant (used for the fast/list load path):

| Column | Type (inferred) | Nullable | Default | Description |
|---|---|---|---|---|
| `id` | `uuid` (client-generated, `crypto.randomUUID()`) | NOT NULL, PK | — | Trade/Daily-Bias id. |
| `user_id` | `uuid` | NOT NULL | — | FK → `auth.users.id`. |
| `status` | `text` | NOT NULL | — | e.g. `'open'`, `'closed'` (also used for Daily Bias lifecycle — see §7). |
| `is_intraday` | `boolean` | NOT NULL | `false` | `true` = Intraday Execution row; `false` = Daily Bias row. |
| `weekly_link_id` | `uuid` | NULL | `null` | FK → `trades.id` of the **parent Daily Bias row** (only set on intraday rows — misleadingly named; does not point at `weeklies`). |
| `wb_entry_id` | `uuid` | NULL | `null` | FK → `weeklies.id` (only meaningfully set on Daily Bias rows — the "Link to Weekly Bias" dropdown). |
| `date` | `date` (ISO string) | NOT NULL | — | Trading/plan date. |
| `pair` | `text` | NOT NULL | — | Instrument symbol. |
| `session` | `text` | NULL | — | Trading session label (e.g. London/NY). |
| `trade_type` | `text` | NULL | `'BUY'` | Direction. |
| `score` | `numeric`/`text` | NULL | — | Computed checklist score. |
| `grade` | `text` | NULL | — | Letter/label grade derived from score. |
| `bias_set` | `text` | NULL | — | The directional bias this Daily Bias/trade declares. |
| `bias_played` | `text` | NULL | — | What actually happened (for grading bias-match). |
| `bias_match` | `text` | NULL | — | `'YES'`/`'NO'`/etc — whether execution matched the declared bias. |
| `result` | `text` | NULL | — | `'WIN'`/`'LOSS'`/etc. |
| `tp2r` | `numeric`/`text` | NULL | — | Stored from client field `tp1r` (comment: *"column name kept for DB compat"* — a historical rename mismatch). |
| `tp15r` | `numeric`/`text` | NULL | — | 1.5R take-profit tag. |
| `idea_notes` | `text` | NULL | `''` | Notes at Daily-Bias/idea stage. |
| `update_notes` | `text` | NULL | `''` | Notes added while trade is open. |
| `close_notes` | `text` | NULL | `''` | Notes at close. |
| `followup_notes` | `text` | NULL | `''` | Post-close follow-up notes. |
| `entry_price` | `numeric` | NULL | `null` | |
| `close_price` | `numeric` | NULL | `null` | |
| `sl_price` | `numeric` | NULL | `null` | |
| `tp_price` | `numeric` | NULL | `null` | |
| `lot_size` | `numeric` | NULL | `null` | Consumed by PnL Tracker's P&L calc. |
| `open_time` | `timestamptz` (ISO string) | NULL | — | |
| `close_time` | `timestamptz` (ISO string) | NULL | `null` | Consumed by PnL Tracker for sorting/calendar. |
| `tags` | `jsonb` (array) | NULL | `[]` | |
| `close_tags` | `jsonb` (array) | NULL | `[]` | |
| `is_paper` | `boolean` | NOT NULL | `false` | |
| `ai_review` | `jsonb` | NULL | `null` | Gemini AI Review result object (`{model, ...scores/verdict}`). |
| `screenshots` | `jsonb` (array) | NULL | — | Entry-stage screenshot refs `{dataUrl (storage path), ...}` — **lazy-loaded**, only present on the row once `_ssLoaded`. |
| `eod_screenshots` | `jsonb` (array) | NULL | — | End-of-day screenshots. |
| `followup_screenshots` | `jsonb` (array) | NULL | — | Follow-up screenshots. |
| `trade_notes` | `jsonb` (array) | NULL | `[]` | Threaded notes added to a trade after creation, each may carry its own `screenshots`. |
| `checklist_answers` | `jsonb` | NULL | `{}` | Raw answers to the trading checklist. |
| `checklist_kills` | `jsonb` | NULL | `{}` | Which checklist items were "kill" (disqualifying) violations. |
| `checklist_model` | `text` | NULL | `'omar'` | Which checklist/scoring model was used (the app calls its core methodology "OMAR"). |
| `intra_alignment` | `text` | NULL | `null` | Alignment grade between intraday execution and its linked Daily Bias. |
| `intra_decision` | `text` | NULL | `null` | |
| `intra_kill` | `boolean` | NULL | `false` | |
| `intra_ex_data` | `jsonb` | NULL | `{}` | Extra intraday-execution structured data. |
| `intra_scores` | `jsonb` | NULL | `null` | |
| `review_notes` | `jsonb` (array) | NULL | `[]` | |
| `review_screenshots` | `jsonb` (array) | NULL | `[]` | Screenshots attached specifically to the AI/manual review stage. |
| `signal_id` | `text` | NULL | `null` | EBP integration (§4.5): the external signal ID this trade was based on. |
| `signal_template` | `text` | NULL | `null` | |
| `signal_htf` | `text` | NULL | `null` | |
| `signal_ltf` | `text` | NULL | `null` | |
| `signal_direction` | `text` | NULL | `null` | |
| `signal_fired_at` | `timestamptz` | NULL | `null` | |
| `signal_price` | `numeric` | NULL | `null` | |
| `signal_htf_bias` | `text` | NULL | `null` | |
| `signal_session` | `text` | NULL | `null` | |
| `created_at` | `timestamptz` | NOT NULL | `now()` | Used for default ordering (`order('created_at', {ascending:false})`). ⚠️ Not explicitly set client-side — assumed table default. |

**Read/write functions:** `tradeToDb`/`dbToTrade` (mapping), `saveTrade`, `deleteTradeSupa`, `loadAllData` (bulk read via `LIGHT_TRADE_COLS`), `loadTradeScreenshots`/`loadTradeScreenshotsForOpen` (lazy screenshot columns), `cleanStaleDisplayUrls` (maintenance), the whole Archive flow (§9), PnL Tracker's `syncFromJournal`/`renderActiveAccount` (read-only, filtered `is_intraday=true, status='closed'`).

### 5.3 `weeklies`

Reverse-engineered from `weeklyToDb`/`dbToWeekly` (lines 8926–8965):

| Column | Type | Nullable | Default | Description |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL, PK | — | |
| `user_id` | `uuid` | NOT NULL | — | FK → `auth.users.id`. |
| `status` | `text` | NOT NULL | — | e.g. `'open'` (filtered on when building the "link to weekly" dropdown), `'closed'`. |
| `pair` | `text` | NOT NULL | — | |
| `date` | `date` | NOT NULL | — | |
| `bias` | `text` | NULL | — | Declared weekly directional bias (also defaults to `'NEUTRAL'` in the UI when absent). |
| `notes` | `text` | NULL | `''` | |
| `tags` | `jsonb` (array) | NULL | `[]` | |
| `screenshots` | `jsonb` (array) | NULL | `[]` | |
| `updates` | `jsonb` (array of `{text, screenshots[], at}`) | NULL | `[]` | Dated log entries added via `saveWbNote()` — a running commentary thread on the weekly bias, NOT a second bias tier (see §7 for the actual tier mechanism). |
| `wb_checklist_answers` | `jsonb` | NULL | `{}` | |
| `weekly_review` | `jsonb` | NULL | — | Set only when a weekly review is completed (`if (w.weeklyReview) row.weekly_review = ...` — conditionally included). |
| `created_at` | `timestamptz` | NOT NULL | — | |
| `closed_at` | `timestamptz` | NULL | `null` | |

### 5.4 `notes`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL, PK | |
| `user_id` | `uuid` | NOT NULL | |
| `title` | `text` | NULL | `''` |
| `body` | `text` | NULL | `''` |
| `created_at` | `timestamptz` | NOT NULL | |
| `updated_at` | `timestamptz` | NOT NULL | defaults to `created_at` client-side if absent |

### 5.5 `core_rules`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `user_id` | `uuid` | NOT NULL, PK (unique — `onConflict:'user_id'`) | |
| `rules` | `jsonb` (array) | NULL | `[]` |

One row per user; the whole rulebook is one JSON array blob.

### 5.6 `cumulative_stats`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `user_id` | `uuid` | NOT NULL, PK (`onConflict:'user_id'`) | |
| `stats` | `jsonb` | NULL | — object shape: `{totalClosed, totalWins, totalLosses, totalBiasMatch, totalBiasTotal, sumR, wins2r, wins15r, wins1r, be, loss05, loss1, totalR, archivedThrough, lastUpdatedAt}` |
| `updated_at` | `timestamptz` | NOT NULL | |

Purpose: a running lifetime total that survives the Archive process (§9) — when trades get archived out of the `trades` table, their contribution is folded into this row first (`archivedThrough` cursor) so historical win-rate/R stats never reset.

### 5.7 `insight_snapshots`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `user_id` | `uuid` | NOT NULL, PK (`onConflict:'user_id'`) | |
| `snapshots` | `jsonb` | NULL | Pre-computed analytics aggregates (see `computeSnapshotAggregates()`), refreshed via `saveInsightSnapshot()` |
| `updated_at` | `timestamptz` | NOT NULL | |

Purely a cache/materialized-view table for the Insights page — safe to truncate and will self-heal on next `saveInsightSnapshot()` call.

### 5.8 `archive_log`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | `uuid`/`bigint` (server-generated — client does `.insert(row).select('id').single()`) | NOT NULL, PK | server default |
| `user_id` | `uuid` | NOT NULL | |
| `started_at` | `timestamptz` | NOT NULL | |
| `completed_at` | `timestamptz` | NULL | set on completion or failure |
| `status` | `text` | NOT NULL | observed values: (running — implicit initial state), `'completed'`, `'failed'` |
| `stats` | `jsonb` | NULL | Free-form: on success, archive counts; on failure, `{..., error: message}` or `{reason: "No data to archive"}` |

Audit trail so `checkPriorIncompleteArchive()` can detect and warn about an archive run that started but never reached `completed_at` (e.g. tab closed mid-run).

### 5.9 `sync_meta`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `user_id` | `uuid` | NOT NULL, PK (`onConflict:'user_id'`) | |
| `last_modified` | `timestamptz` (ISO string) | NULL | Written by `touchSyncMeta()` after every write; read at login to decide cached-vs-full-refetch (§ call chains). |
| `last_device` | `text` | NULL | `DEVICE_ID` — a `crypto.randomUUID()` generated once per browser and cached in `localStorage['ict_device_id']`. Lets multi-device users see "synced from another device" style logic. |
| `discord_channels` | `jsonb` (array of channel-id strings) | NULL | User's saved Discord channel list (§4.2 `/discord-messages`), max 5 per the Settings UI copy. |

### 5.10 Supabase Storage bucket: `screenshots`

Not a table — a Storage bucket. Referenced via `_sb.storage.from('screenshots')`:
- `.upload(path, blob, {...})` — path convention: ⚠️ *exact key format not pinned down verbatim in the reviewed excerpts — the reconstruction agents covering the screenshot-upload chunk (chunk 4/5) document the precise path template; expected pattern based on the rest of the app's `{userId}/...` convention is `{user_id}/{trade_or_weekly_id}/{timestamp}_{filename}`.*
- `.createSignedUrl(path, 604800)` — signed URLs valid **7 days**, regenerated at render time (never persisted — see `_stripSS()`, which strips the transient `_displayUrl` field before every DB write specifically because it expires).
- `.remove(paths)` — batch delete, used heavily by the Archive flow (§9) and `deleteScreenshotsFromStorage`.
- `.list(prefix, {limit})` — used by the Archive flow to enumerate a user's full screenshot folder before wiping it.

### 5.11 `accounts` (PnL Tracker)

Reverse-engineered from `confirmSaveAccount()`'s insert payload (Profit_Tracker/index.html lines 1961–1981) plus fields read elsewhere (`acct.commission_per_lot`, `acct.profit_target_pct`, etc. — legacy direct fields, pre-dating the `broker_profiles` feature, still read as a fallback when no profile is linked):

| Column | Type | Nullable | Default | Description |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL, PK | server default | |
| `user_id` | `uuid` | NOT NULL | | |
| `name` | `text` | NOT NULL | | |
| `account_kind` | `text` | NOT NULL | | `'prop'` \| `'personal'` |
| `is_paper` | `boolean` | NOT NULL | `false` | |
| `starting_balance` | `numeric` | NOT NULL | | Always the drawdown reference point. |
| `current_balance_override` | `numeric` | NULL | `null` | Mid-evaluation entry point — set only if the user started using the app partway through an existing account. |
| `currency` | `text` | NOT NULL | `'USD'` | |
| `status` | `text` | NOT NULL | `'active'` | `'active'` \| `'passed'` \| `'breached'`. |
| `broker_profile_id` | `uuid` | NULL | `null` | FK → `broker_profiles.id`. |
| `firm_name` | `text` | NULL | | prop accounts only |
| `account_type` | `text` | NULL | | prop accounts only, e.g. "Phase 1/2/Funded" |
| `broker_name` | `text` | NULL | | personal accounts only |
| `user_confirmed_at` | `timestamptz` | NOT NULL | | |
| `created_at` | `timestamptz` | NOT NULL | `now()` (assumed) | |
| *(legacy, pre-profile fallback fields, read but not written by current UI)* `commission_per_lot`, `profit_target_pct`, `drawdown_pct`, `daily_loss_limit_pct`, `drawdown_type`, `daily_reset_utc_hour` | mixed | NULL | | Still consulted in `resolveCommission()`/`renderActiveAccount()` if no `broker_profile_id` is linked — kept for backward compatibility with accounts created before profiles existed. |

### 5.12 `trade_account_map` (PnL Tracker)

| Column | Type | Nullable | Default |
|---|---|---|---|
| `trade_id` | `uuid` | NOT NULL, UNIQUE (`onConflict:'trade_id'`) — effectively PK | FK → `trades.id` |
| `user_id` | `uuid` | NOT NULL | |
| `account_id` | `uuid` | NOT NULL | FK → `accounts.id` |
| `assigned_at` | `timestamptz` | NOT NULL | |

One row per intraday trade at most (a trade can be assigned to zero or one account). Written from the **Journal's** close-trade modal (`assignTradeAccount()`), read by **PnL Tracker** to know which trades belong to which account.

### 5.13 `broker_profiles` (PnL Tracker)

Reverse-engineered from `saveProfileEdit()`/`_buildProfilePayload()` (Profit_Tracker/index.html lines ~2146–2392):

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL, PK | server default |
| `user_id` | `uuid` | NOT NULL | |
| `profile_name` | `text` | NOT NULL | |
| `profile_type` | `text` | NOT NULL | `'prop'` \| `'broker'` |
| `profit_target_pct` | `numeric` | NULL | prop only |
| `drawdown_pct` | `numeric` | NULL | prop only |
| `daily_loss_limit_pct` | `numeric` | NULL | prop only |
| `daily_reset_utc_hour` | `smallint` | NOT NULL | `22` |
| `drawdown_type` | `text` | NOT NULL | `'static'` \| `'trailing'` \| `'trailing_to_be'`, default `'static'` |
| `commission_forex` | `numeric` | NULL | |
| `lot_size_forex` | `numeric` | NOT NULL | `100000` |
| `pip_size_forex` | `numeric` | NOT NULL | `0.0001` |
| `point_value_forex_usd` | `numeric` | NULL | |
| `commission_metals` | `numeric` | NULL | |
| `lot_size_xau` | `numeric` | NOT NULL | `100` |
| `lot_size_xag` | `numeric` | NOT NULL | `5000` |
| `pip_size_xau` | `numeric` | NOT NULL | `0.01` |
| `point_value_metals_xau_usd` | `numeric` | NULL | |
| `point_value_metals_xag_usd` | `numeric` | NULL | |
| `commission_indices` | `numeric` | NULL | |
| `lot_size_indices` | `numeric` | NOT NULL | `1` |
| `point_value_indices_usd` | `numeric` | NULL | |
| `commission_commodities` | `numeric` | NULL | |
| `lot_size_commodities` | `numeric` | NOT NULL | `1` |
| `point_value_commodities_usd` | `numeric` | NULL | |
| `created_at` | `timestamptz` | NOT NULL | `now()` |

### 5.14 `asset_specs` (PnL Tracker)

| Column | Type | Nullable | Default |
|---|---|---|---|
| `user_id` | `uuid` | NOT NULL, part of composite unique key (`onConflict:'user_id,symbol'`) | |
| `symbol` | `text` | NOT NULL, part of composite unique key | |
| `asset_class` | `text` | NULL | `'forex'`\|`'metal'`\|`'index'`\|`'commodity'`\|`'crypto'`\|`'other'` |
| `contract_size` | `numeric` | NULL | |
| `pip_size` | `numeric` | NULL | |
| `point_value_usd` | `numeric` | NULL | |
| `quote_currency` | `text` | NULL | |
| `commission_per_lot` | `numeric` | NULL | |
| `source` | `text` | NOT NULL | `'ai_lookup'` \| `'user_edit'` |
| `source_confidence` | `text` | NOT NULL | `'high'` \| `'low'` |
| `notes` | `text` | NULL | AI-generated notes |
| `user_notes` | `text` | NULL | user-entered notes |
| `fetched_at` | `timestamptz` | NOT NULL | |

Recommended PK: a surrogate `id uuid` plus a `UNIQUE (user_id, symbol)` constraint (matches the `onConflict` used everywhere).

### 5.15 Recommended SQL — full setup, in dependency order

⚠️ *These `CREATE TABLE` statements are reverse-engineered from client read/write code, not copied from an original migration file (none exists in either repo). Column types are the best SQL-typed inference from JS usage; verify before running in production.*

```sql
-- ═══════════════════════════════════════════════════════════
-- 1. Extensions
-- ═══════════════════════════════════════════════════════════
create extension if not exists "pgcrypto"; -- for gen_random_uuid()

-- ═══════════════════════════════════════════════════════════
-- 2. weeklies  (Weekly Bias) — no FK dependencies
-- ═══════════════════════════════════════════════════════════
create table public.weeklies (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  status                text not null default 'open',
  pair                  text not null,
  date                  date not null,
  bias                  text,
  notes                 text default '',
  tags                  jsonb default '[]'::jsonb,
  screenshots           jsonb default '[]'::jsonb,
  updates               jsonb default '[]'::jsonb,
  wb_checklist_answers  jsonb default '{}'::jsonb,
  weekly_review         jsonb,
  created_at            timestamptz not null default now(),
  closed_at             timestamptz
);
create index weeklies_user_id_idx on public.weeklies(user_id);
create index weeklies_user_date_idx on public.weeklies(user_id, date);

-- ═══════════════════════════════════════════════════════════
-- 3. trades  (Daily Bias rows + Intraday Execution rows)
--    self-referencing FKs, so table must exist before adding them
-- ═══════════════════════════════════════════════════════════
create table public.trades (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users(id) on delete cascade,
  status                 text not null,
  is_intraday            boolean not null default false,
  weekly_link_id         uuid references public.trades(id) on delete set null,
  wb_entry_id            uuid references public.weeklies(id) on delete set null,
  date                   date not null,
  pair                   text not null,
  session                text,
  trade_type             text default 'BUY',
  score                  numeric,
  grade                  text,
  bias_set               text,
  bias_played            text,
  bias_match             text,
  result                 text,
  tp2r                   text,
  tp15r                  text,
  idea_notes             text default '',
  update_notes           text default '',
  close_notes            text default '',
  followup_notes         text default '',
  entry_price            numeric,
  close_price            numeric,
  sl_price               numeric,
  tp_price               numeric,
  lot_size               numeric,
  open_time              timestamptz,
  close_time             timestamptz,
  tags                   jsonb default '[]'::jsonb,
  close_tags             jsonb default '[]'::jsonb,
  is_paper               boolean not null default false,
  ai_review              jsonb,
  screenshots            jsonb,
  eod_screenshots        jsonb,
  followup_screenshots   jsonb,
  trade_notes            jsonb default '[]'::jsonb,
  checklist_answers      jsonb default '{}'::jsonb,
  checklist_kills        jsonb default '{}'::jsonb,
  checklist_model        text default 'omar',
  intra_alignment        text,
  intra_decision         text,
  intra_kill             boolean default false,
  intra_ex_data          jsonb default '{}'::jsonb,
  intra_scores           jsonb,
  review_notes           jsonb default '[]'::jsonb,
  review_screenshots     jsonb default '[]'::jsonb,
  signal_id              text,
  signal_template        text,
  signal_htf             text,
  signal_ltf             text,
  signal_direction       text,
  signal_fired_at        timestamptz,
  signal_price           numeric,
  signal_htf_bias        text,
  signal_session         text,
  created_at             timestamptz not null default now()
);
create index trades_user_id_idx on public.trades(user_id);
create index trades_user_created_idx on public.trades(user_id, created_at desc);
create index trades_user_date_idx on public.trades(user_id, date);
create index trades_weekly_link_idx on public.trades(weekly_link_id);
create index trades_wb_entry_idx on public.trades(wb_entry_id);
create index trades_is_intraday_idx on public.trades(user_id, is_intraday, status);

-- ═══════════════════════════════════════════════════════════
-- 4. notes, core_rules, cumulative_stats, insight_snapshots,
--    archive_log, sync_meta — all independent, keyed off user_id
-- ═══════════════════════════════════════════════════════════
create table public.notes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text default '',
  body        text default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index notes_user_updated_idx on public.notes(user_id, updated_at desc);

create table public.core_rules (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  rules    jsonb default '[]'::jsonb
);

create table public.cumulative_stats (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  stats       jsonb,
  updated_at  timestamptz not null default now()
);

create table public.insight_snapshots (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  snapshots   jsonb,
  updated_at  timestamptz not null default now()
);

create table public.archive_log (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  started_at    timestamptz not null default now(),
  completed_at  timestamptz,
  status        text not null default 'running',
  stats         jsonb
);
create index archive_log_user_idx on public.archive_log(user_id, started_at desc);

create table public.sync_meta (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  last_modified     timestamptz,
  last_device       text,
  discord_channels  jsonb default '[]'::jsonb
);

-- ═══════════════════════════════════════════════════════════
-- 5. broker_profiles — must exist before accounts (FK)
-- ═══════════════════════════════════════════════════════════
create table public.broker_profiles (
  id                            uuid primary key default gen_random_uuid(),
  user_id                       uuid not null references auth.users(id) on delete cascade,
  profile_name                  text not null,
  profile_type                  text not null check (profile_type in ('prop','broker')),
  profit_target_pct             numeric,
  drawdown_pct                  numeric,
  daily_loss_limit_pct          numeric,
  daily_reset_utc_hour          smallint not null default 22,
  drawdown_type                 text not null default 'static'
                                 check (drawdown_type in ('static','trailing','trailing_to_be')),
  commission_forex              numeric,
  lot_size_forex                numeric not null default 100000,
  pip_size_forex                numeric not null default 0.0001,
  point_value_forex_usd         numeric,
  commission_metals             numeric,
  lot_size_xau                  numeric not null default 100,
  lot_size_xag                  numeric not null default 5000,
  pip_size_xau                  numeric not null default 0.01,
  point_value_metals_xau_usd    numeric,
  point_value_metals_xag_usd    numeric,
  commission_indices            numeric,
  lot_size_indices               numeric not null default 1,
  point_value_indices_usd        numeric,
  commission_commodities        numeric,
  lot_size_commodities           numeric not null default 1,
  point_value_commodities_usd    numeric,
  created_at                    timestamptz not null default now()
);
create index broker_profiles_user_idx on public.broker_profiles(user_id);

-- ═══════════════════════════════════════════════════════════
-- 6. accounts — depends on broker_profiles
-- ═══════════════════════════════════════════════════════════
create table public.accounts (
  id                          uuid primary key default gen_random_uuid(),
  user_id                     uuid not null references auth.users(id) on delete cascade,
  name                        text not null,
  account_kind                text not null check (account_kind in ('prop','personal')),
  is_paper                    boolean not null default false,
  starting_balance            numeric not null,
  current_balance_override    numeric,
  currency                    text not null default 'USD',
  status                      text not null default 'active'
                               check (status in ('active','passed','breached')),
  broker_profile_id           uuid references public.broker_profiles(id) on delete set null,
  firm_name                   text,
  account_type                text,
  broker_name                 text,
  user_confirmed_at           timestamptz,
  created_at                  timestamptz not null default now(),
  -- legacy pre-profile fallback fields (kept for backward compatibility)
  commission_per_lot           numeric,
  profit_target_pct            numeric,
  drawdown_pct                 numeric,
  daily_loss_limit_pct         numeric,
  drawdown_type                text,
  daily_reset_utc_hour         smallint
);
create index accounts_user_idx on public.accounts(user_id);

-- ═══════════════════════════════════════════════════════════
-- 7. trade_account_map — depends on trades + accounts
-- ═══════════════════════════════════════════════════════════
create table public.trade_account_map (
  trade_id     uuid primary key references public.trades(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  account_id   uuid not null references public.accounts(id) on delete cascade,
  assigned_at  timestamptz not null default now()
);
create index trade_account_map_account_idx on public.trade_account_map(account_id);

-- ═══════════════════════════════════════════════════════════
-- 8. asset_specs — independent
-- ═══════════════════════════════════════════════════════════
create table public.asset_specs (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  symbol                text not null,
  asset_class           text,
  contract_size         numeric,
  pip_size              numeric,
  point_value_usd       numeric,
  quote_currency        text,
  commission_per_lot    numeric,
  source                text not null default 'ai_lookup' check (source in ('ai_lookup','user_edit')),
  source_confidence     text not null default 'low' check (source_confidence in ('high','low')),
  notes                 text,
  user_notes            text,
  fetched_at            timestamptz not null default now(),
  unique (user_id, symbol)
);
```

### 5.16 Row Level Security

⚠️ *No `CREATE POLICY` statement was found in either repository — the app relies entirely on Supabase's default-deny-until-policy-added behavior plus the consistent client-side `.eq('user_id', ...)` filtering. The policies below are the standard, idiomatic Supabase pattern that matches every observed access pattern in the code, and are what should be applied; they are a recommendation, not a transcription of an existing policy.*

```sql
-- Enable RLS on every table
alter table public.trades              enable row level security;
alter table public.weeklies            enable row level security;
alter table public.notes               enable row level security;
alter table public.core_rules          enable row level security;
alter table public.cumulative_stats    enable row level security;
alter table public.insight_snapshots   enable row level security;
alter table public.archive_log         enable row level security;
alter table public.sync_meta           enable row level security;
alter table public.accounts            enable row level security;
alter table public.trade_account_map   enable row level security;
alter table public.broker_profiles     enable row level security;
alter table public.asset_specs         enable row level security;

-- One identical "owner-only" policy shape per table (repeat per table name):
create policy "owner_all_trades" on public.trades
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner_all_weeklies" on public.weeklies
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner_all_notes" on public.notes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner_all_core_rules" on public.core_rules
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner_all_cumulative_stats" on public.cumulative_stats
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner_all_insight_snapshots" on public.insight_snapshots
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner_all_archive_log" on public.archive_log
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner_all_sync_meta" on public.sync_meta
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner_all_accounts" on public.accounts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner_all_trade_account_map" on public.trade_account_map
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner_all_broker_profiles" on public.broker_profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner_all_asset_specs" on public.asset_specs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Storage bucket policies (bucket "screenshots", path convention {user_id}/...)
insert into storage.buckets (id, name, public) values ('screenshots', 'screenshots', false)
  on conflict (id) do nothing;

create policy "owner_read_screenshots" on storage.objects for select
  using (bucket_id = 'screenshots' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "owner_write_screenshots" on storage.objects for insert
  with check (bucket_id = 'screenshots' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "owner_delete_screenshots" on storage.objects for delete
  using (bucket_id = 'screenshots' and (storage.foldername(name))[1] = auth.uid()::text);
```

### 5.17 Seed data

None required — every table is populated per-user at runtime as the user creates their first Weekly Bias/Daily Bias/trade/account. No fixture/lookup tables exist (e.g. instrument lists are hardcoded JS constants in the frontend — `CONFIG.DEFAULT_PAIRS`, `METAL_OZ_PER_LOT`, `STANDARD_FX_LOT`, `ISO_CCY` — not database rows).

### 5.18 Auth configuration

- **Provider:** email/password only (`_sb.auth.signInWithPassword`, `_sb.auth.signUp`, `_sb.auth.resetPasswordForEmail`) — no OAuth/social providers referenced anywhere in either app.
- **Email confirmation:** signup flow tells the user to "check your email to confirm" — implies Supabase's default "Confirm email" toggle is ON.
- **Session handling:** both apps call `_sb.auth.getSession()` on load and subscribe via `_sb.auth.onAuthStateChange` to react to `SIGNED_IN`/`SIGNED_OUT`. Supabase's default JWT/refresh-token behavior is used as-is (no custom JWT expiry configuration found).
- **Redirect URLs:** `resetPasswordForEmail` is called with no explicit `redirectTo` option, so Supabase falls back to the project's configured **Site URL** / **Redirect URLs** allow-list.
  ⚠️ *Cannot be determined from source — manual verification required*: the exact Auth → URL Configuration values (Site URL, additional redirect URLs) must be set in the Supabase Dashboard to include both `https://trade-journal-5xk.pages.dev/**` and `https://profit-tracker-35v.pages.dev/**` (and any custom domains), otherwise password-reset links will not resolve correctly.
- **Password minimum length:** enforced client-side only (`p.length < 6` in `doSignup`) — verify the Supabase Auth project setting for minimum password length is set to at least 6 to match, or the client check becomes the only enforcement.

### 5.19 Frontend environment variables / keys needed

Neither app uses build-time environment variables (no bundler). Both hardcode the following directly in a `CONFIG` object at the top of their `<script>` block — to stand up a fresh instance, edit these four values in **both** files:

```js
const CONFIG = {
    SUPA_URL:      'https://<your-project-ref>.supabase.co',
    SUPA_KEY:      '<your-anon-public-key>',   // safe to expose — protected by RLS
    CF_WORKER:     'https://<your-worker>.workers.dev',   // or '' to disable FF/Discord/Gemini-proxy features
    PNL_URL:       'https://<your-pnl-tracker-pages-url>',   // Journal only
    DEFAULT_PAIRS: ['EURUSD', 'GBPUSD', 'USDCHF', 'XAUUSD'],  // Journal only
};
```
(`PNL_URL` and `DEFAULT_PAIRS` do not appear in Profit_Tracker's own CONFIG block — it only has `SUPA_URL`, `SUPA_KEY`, `CF_WORKER`.)

Two more values are entered by the **end user** at runtime (not baked into deployment), both persisted to `localStorage`, never to Supabase or the Worker:
- Gemini API key (Journal Settings → AI Review) — user's own free Google AI Studio key.
- EBP Worker URL + secret (Journal Settings → EBP integration) — only relevant to users of the separate EBP product.

---

## 6. Cloudflare Worker code — deployment recap

(See §4.2 for the full route-by-route breakdown; this section is the condensed "how to deploy" reference requested for Step 6.)

**`wrangler.toml` (private/live `pnl-worker`):**
```toml
name = "pnl-worker"
main = "src/worker.js"
compatibility_date = "2026-07-13"
account_id = "ceccc63b3818d9285b86119580bfbebf"
preview_urls = false

[observability]
enabled = true

[[r2_buckets]]
binding = "BSE_SCREENSHOTS"
bucket_name = "bse-trader-screenshots"
```
Note: the R2 binding is only exercised by the unrelated `/bse/*` routes — a from-scratch redeploy of *just* the Journal/PnL Tracker functionality (`/ff-calendar`, `/discord-messages`, `POST /`) needs **no R2 bucket at all**; the `[[r2_buckets]]` block can be omitted entirely, and every route that doesn't touch `env.BSE_SCREENSHOTS` will work unchanged.

**`wrangler.toml` (public buyer template, simpler, no R2):**
```toml
name = "trade-journal-worker"
main = "src/worker.js"
compatibility_date = "2024-01-01"
```

**Deploy commands:**
```bash
npx wrangler dev        # local dev server
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put DISCORD_TOKEN   # optional
npx wrangler deploy     # ships to <name>.<your-subdomain>.workers.dev
```

**CORS allow-list to edit before deploying your own copy** — `ALLOWED_ORIGINS` array at the top of `worker.js`: replace with your own Pages URLs (Journal + PnL Tracker) plus any localhost dev ports you use.

---

## 7. The three-tier trade hierarchy

```
 WEEKLY BIAS                     DAILY BIAS                    INTRADAY EXECUTION
 (table: weeklies)               (table: trades,               (table: trades,
                                   is_intraday = false)          is_intraday = true)
 ┌─────────────────┐             ┌──────────────────┐          ┌───────────────────┐
 │ id (uuid)  ◀──────────────────┤ wb_entry_id       │◀─────────┤ weekly_link_id     │
 │ pair, date, bias │             │ (FK → weeklies.id)│          │ (FK → trades.id,   │
 │ status: open/    │             │                    │          │  points at the      │
 │  closed          │             │ id (uuid) ◀────────┼──────────┤  PARENT Daily Bias  │
 │ updates[] (dated │             │ pair, date, session│          │  row — NOT at       │
 │  commentary log, │             │ bias_set, checklist │          │  weeklies, despite  │
 │  NOT a 2nd tier) │             │  _answers/_kills,   │          │  the field's name) │
 │ weekly_review     │             │ score/grade         │          │                     │
 └─────────────────┘             │ status: open/closed  │          │ entry/close/sl/tp   │
                                   │ (its own lifecycle,  │          │  _price, lot_size   │
                                   │  independent of       │          │ result, tp2r/tp15r  │
                                   │  linked intraday      │          │ bias_played/        │
                                   │  trades' status)      │          │  bias_match         │
                                   └──────────────────────┘          │ intra_alignment/     │
                                                                        │  _decision/_kill     │
                                                                        │ signal_* (EBP link)  │
                                                                        │ status: open/closed  │
                                                                        └───────────────────┘
```

### 7.1 What each tier actually is

1. **Weekly Bias** — a `weeklies` row. Created via the "Weekly Bias" nav page (`navTo('weekly')`), modal `saveWeeklyBias()`. Represents a directional read on one pair for one week. Has its own `status` (`open`/`closed`) and can be closed/reopened (`closeWeeklyBias()`/`reopenWeeklyBias()`) and reviewed (`openWeeklyReview()`/`saveWeeklyReview()`/`closeWeeklyReview()`). Its `updates[]` array is a running dated log (screenshots + notes) attached to the SAME weekly row — it is not a separate Daily Bias tier, just commentary history.

2. **Daily Bias** — a **`trades`** row with `is_intraday = false`. Created via the "Daily Bias" nav page (`navTo('idea')`, section header literally reads "DAILY BIAS" in the HTML). Represents a single day's checklist-driven directional plan for a pair/session, independently scored and graded (its own `score`/`grade`/`checklist_answers`/`checklist_kills`). Optionally links UP to a Weekly Bias via `wb_entry_id`, chosen from a dropdown (`refreshWbEntryDropdown()`/`onWbEntryDropdownChange()`) populated from `S.weeklies.filter(w => w.status === 'open')`. Has its own independent `status` lifecycle (a Daily Bias entry can be logged/closed on its own even with no intraday execution ever created against it).

3. **Intraday Execution** — a **`trades`** row with `is_intraday = true`. Created via the "Intraday" nav page (`navTo('intraday')`), `saveIntradayIdea()` (idea stage) or `saveIdeaAsOpen()` (straight to open). Links DOWN to its parent Daily Bias row via `weekly_link_id` (chosen from the `#intraWeeklyLink` dropdown, which despite the element's name lists **Daily Bias trades**, i.e. `S.trades.filter(t => !t.isIntraday)`, not `weeklies` rows). `getIntraBias()` reads the linked Daily Bias trade's `biasSet` to check alignment. Carries the actual price/lot/result fields and the EBP `signal_*` columns (§4.5).

### 7.2 ID-linkage summary

| Field | Lives on | Points to | Name accuracy |
|---|---|---|---|
| `weeklies.id` | Weekly Bias row | — (top of chain) | — |
| `trades.wb_entry_id` | Daily Bias row (and, per the schema, technically settable on any trade row) | `weeklies.id` | Accurately named. |
| `trades.id` (of a Daily Bias row) | Daily Bias row | — (middle of chain) | — |
| `trades.weekly_link_id` | Intraday Execution row | `trades.id` **of its parent Daily Bias row** | **Misleadingly named** — does not point at `weeklies` at all, despite the name. This is called out explicitly in the source's own changelog comment (line 24): *"Weekly Bias card: fixed two-hop linking bug (was comparing intraday's parent-daily-bias..."* — i.e. the team itself has previously had bugs from this naming ambiguity. |

### 7.3 Full lifecycle of a trade (creation → open → closed → archived)

1. **(Optional) Weekly Bias created** — `saveWeeklyBias()` → `weeklies` row, `status='open'`.
2. **Daily Bias logged** — user fills the checklist on the "Daily Bias" page, optionally linking to the open Weekly Bias (`wb_entry_id`). `saveIdeaAsOpen()` (or the idea-only variant) inserts a `trades` row with `is_intraday=false`.
3. **Intraday Execution opened** — from the Intraday page, user optionally links to that Daily Bias row (`weekly_link_id`), fills entry/SL/TP/lot size. `saveIntradayIdea()` inserts a `trades` row with `is_intraday=true`, `status='open'`.
4. **Trade managed while open** — `patchOpen()`/`addSsToOpenTrade()` etc. update notes/screenshots/prices in place (`saveTrade()` upserts by `id`).
5. **Trade closed** — close-trade modal computes result/grade (`updateCmAutoResult()`), optionally attaches an EBP signal (`cmFetchSignal()`) and a PnL Tracker account assignment (`assignTradeAccount()` → `trade_account_map` upsert), then `saveClosure()` → `saveTrade()` with `status='closed'`. On close, `saveInsightSnapshot()` and `saveCumulativeStats()` fire (fire-and-forget) to refresh cached analytics.
6. **AI Review (optional)** — `triggerDailyAiReview()` calls `callGeminiVision()` with the trade's screenshots + prompt, stores the parsed verdict in `trades.ai_review`.
7. **Archived** — once a trade's `date` is older than the user-chosen cutoff, the Archive flow (§9) exports it (+ its screenshots) to a downloaded ZIP, folds its stats into `cumulative_stats`, and deletes the `trades` row (and its Storage screenshots) from Supabase permanently. This is the terminal state — an archived trade no longer exists in the live database at all, only in the user's local ZIP export and in the aggregate `cumulative_stats` numbers.

### 7.4 State fields and their values

| Field | Table | Observed / implied values |
|---|---|---|
| `status` (weeklies) | Weekly Bias | `'open'`, `'closed'` |
| `status` (trades) | Daily Bias / Intraday | `'open'`, `'closed'` (independent per row) |
| `result` | trades | `'WIN'`, `'LOSS'`, (implied `'BE'`/other — used in R-bucketing: `r > -0.2 && r < 1` treated as breakeven-ish, `r < -0.5` a "loss1" bucket, etc. in `saveCumulativeStats()`) |
| `bias_match` | trades | `'YES'`, `'NO'` |
| `is_paper` | trades | boolean — paper vs live trade |
| `is_intraday` | trades | boolean — Daily Bias (`false`) vs Intraday Execution (`true`) |
| `intra_kill` | trades | boolean — a checklist "kill" violation was present on the intraday execution |
| `checklist_model` | trades | `'omar'` (the app's named methodology; presumably extensible) |

### 7.5 How the UI reflects the hierarchy

- Separate nav items/pages for each tier: "Weekly Bias" (`page-weekly`), "Daily Bias" (`page-idea`), "Intraday" (`page-intraday`), plus "Open"/"Closed" (`page-open`/`page-closed`) as status-filtered views across both Daily Bias and Intraday trades.
- The Weekly Bias card UI shows "Linked Daily Bias" entries (trades whose `wb_entry_id` matches), and per the changelog comment even shows "a new read-only checklist viewer for closed trades" nested under it.
- The Daily Bias / idea creation form shows a "Link to Weekly Bias (optional)" dropdown.
- The Intraday creation form shows a "Link to Daily Bias Trade" dropdown (labelled correctly in the UI even though the underlying element id is `intraWeeklyLink`).
- Dashboard quick-tiles separately summarize "WEEKLY BIAS" ("Swing journals") and "DAILY BIAS" ("Daily market analysis") counts.

---

## 8. Buyer onboarding / configurator system

This app is sold/distributed as a template product. Evidence for the mechanism, all found in the source itself:

- Both `index.html` files contain the identical banner comment immediately above their `CONFIG` object:
  ```
  ═══════════════════════════════════════════════════════════
  BUYER CONFIGURATION
  All hardcoded deployment values live here.
  The configurator page replaces %%TOKENS%% for buyer downloads.
  ═══════════════════════════════════════════════════════════
  ```
- The literal string `%%TOKENS%%` appears once in each file, inside that comment only — i.e. **the copies of `index.html` in the `Trade_Journal`/`Profit_Tracker` GitHub repos are the seller's own already-configured production copies**, not the raw buyer-facing template. The actual `%%SUPA_URL%%`/`%%SUPA_KEY%%`/`%%CF_WORKER%%`-style placeholder template (with real `%%TOKEN%%` markers substituted per buyer) lives in a separate configurator tool that was **not discoverable** from these two repos or from probing likely GitHub repo names in the `aicubeapps` org (`aicubeapps.github.io`, `configurator`, `buyer-configurator`, `trade-journal-configurator` all return "Repository not found").
  ⚠️ *Cannot be determined from source — manual verification required*: the configurator page's own implementation (where it lives, how it performs the substitution, whether it's a Cloudflare Worker, a GitHub Action, or a manual script) is outside the boundary of the two repos this document was scoped to.
- What **is** fully documented and buyer-facing: the **`trade-journal-worker`** public repo (§4.2, §6) — a separate, generic, secrets-free Worker template with a Cloudflare "Deploy to Cloudflare" one-click button (`https://deploy.workers.cloudflare.com/?url=https://github.com/aicubeapps/trade-journal-worker`), and a full README walking a non-technical buyer through: forking the Worker, deploying it to their own Cloudflare account, adding their own `GEMINI_API_KEY`/`DISCORD_TOKEN` secrets via the CF Dashboard, and pasting their new Worker's URL into the Journal's Settings page.

### 8.1 Reconstructed end-to-end buyer setup flow

Based on the `%%TOKENS%%` comment, the CONFIG block shape, and the `trade-journal-worker` README, the intended buyer onboarding flow is:

1. Buyer purchases access to a **configurator page** (location unknown — see disclaimer above).
2. Configurator page asks the buyer for their own Supabase project URL + anon key (buyer must have already run the Supabase setup SQL from §5.15/§5.16 against their own new Supabase project — this is the "schema.sql delivery" referenced in the brief; no such standalone `schema.sql` file exists in either repo, so it would need to be generated from §5.15 of this document, or handed to the buyer as a separate deliverable file by the seller).
3. Configurator substitutes those values (and optionally a Worker URL, if the buyer already deployed one) into the `%%TOKENS%%` placeholders of a template copy of `index.html`, producing a ready-to-deploy file.
4. Buyer downloads the resulting `index.html` (+ `_headers`) and creates their own GitHub repo, or deploys it directly to Cloudflare Pages via drag-and-drop.
5. Buyer optionally clicks "Deploy to Cloudflare" on `trade-journal-worker` to get their own Worker (for FF calendar / Discord / Gemini-proxy features), adds their two secrets, and pastes the resulting Worker URL into the Journal's Settings page (this step does NOT require rebuilding/redeploying the frontend — the Worker URL is also persisted to `localStorage` client-side as a fallback/override path in some flows, though the primary path is the baked-in `CONFIG.CF_WORKER`).
6. Buyer's Gemini AI Review key (Journal's own AI Review feature, §4.4) is entered separately, directly by the buyer's own end users, in Settings — never part of the configurator/deployment step at all.

---

## 9. Offline build

Both files were inspected specifically for the offline-build indicator names the brief asked about: `_replica*`, `_output*`, `setupReplicaFolder`, `setupOutputFolder`, `replicateToLocal`, `importArchiveZip`, `maybeShowReplicaBanner`, `renderReplicaSettingsCard`, and replica-aware branches inside `runArchive`/`collectArchiveData`/`downloadAllScreenshotBlobs`/`triggerZipDownload`/`onLoggedIn`.

**None of these identifiers exist anywhere in `Trade_Journal/index.html` or `Profit_Tracker/index.html`.** A full-text search for `_replica`, `_output`, `setupReplicaFolder`, `setupOutputFolder`, `replicateToLocal`, `importArchiveZip`, `maybeShowReplicaBanner`, `renderReplicaSettingsCard`, `isReplica`, `OFFLINE_BUILD`, and `IS_OFFLINE` returns zero matches in either file. `onLoggedIn()` (line 8619) contains no replica/offline branch — it unconditionally calls `requestPersistentStorage()`, `loadAllData()`, and schedules `checkPriorIncompleteArchive`/`cleanStaleDisplayUrls`. `runArchive`/`collectArchiveData`/`downloadAllScreenshotBlobs`/`triggerZipDownload` (documented in full under the Archive module, §Function Reference) likewise contain no conditional branch on any replica/offline/local-folder concept — the Archive flow always produces a browser-downloaded ZIP via the standard `Blob`/`URL.createObjectURL`/`<a download>` pattern, with no filesystem/local-replica alternative path.

⚠️ *Cannot be determined from source — manual verification required*: this strongly suggests that either (a) no separate "offline build" of this app currently exists — the online build reviewed here may be the only build — or (b) an offline build exists as a **separate, unseen codebase/fork** that was never merged back with feature-detection guards into the reviewed `index.html` files. The brief's premise (that the online build contains replica-aware branches to diff against) does not hold for the two repos actually available; there is nothing here to enumerate a diff from.

---

## 10. Replication guide

A from-zero, numbered walkthrough to rebuild this entire project. Cross-references point to the sections above with full detail.

### Step 1 — GitHub org and repos
1. Create (or use) a GitHub organization, e.g. `your-org`.
2. Create two repos: `your-org/trade-journal` and `your-org/pnl-tracker`, each initialized with a single `index.html` (start from the reference source, or write fresh using §2/§7/Function Reference as the spec) and a Cloudflare `_headers` file (§2.1/§2.2 — copy the CSP values, swapping in your own Pages domain names once known).
3. (Optional, for the buyer-facing Worker template) create `your-org/journal-worker` — see Step 3.

### Step 2 — Supabase
1. Go to supabase.com → New Project. Note the generated project URL and the **anon/public** API key (Project Settings → API).
2. In the SQL Editor, run the extension + table statements from §5.15 in the exact order given (weeklies → trades → notes/core_rules/cumulative_stats/insight_snapshots/archive_log/sync_meta → broker_profiles → accounts → trade_account_map → asset_specs).
3. Run the RLS statements from §5.16 (enable RLS + owner-only policy per table + storage bucket + storage policies).
4. Auth → Providers: ensure Email provider is enabled; decide whether to require email confirmation (the reference app expects it — signup flow says "check your email to confirm").
5. Auth → URL Configuration: set Site URL and add Redirect URLs for both Pages domains you'll create in Step 6 (§5.18).
6. Auth → Policies: set minimum password length to 6+ to match the client-side check, or relax the client-side check to match your chosen minimum.

### Step 3 — Cloudflare Workers
1. Create a new Worker project (e.g. via `npx wrangler init` or the "Deploy to Cloudflare" button pattern from `trade-journal-worker`, §4.2/§6).
2. Paste in the worker source, keeping only the routes you need: `/ff-calendar`, `/discord-messages`, `POST /` (Gemini proxy). Drop the `/bse/*` routes and the `[[r2_buckets]]` binding entirely — they belong to an unrelated sibling app and add no value here.
3. Edit `ALLOWED_ORIGINS` to your own two Pages URLs (plus `http://localhost:*` for dev, via the regex pattern shown in §4.2).
4. `npx wrangler secret put GEMINI_API_KEY` (get a free key at aistudio.google.com/app/apikey). Optionally `npx wrangler secret put DISCORD_TOKEN` if you want the Discord feed (get it from a browser DevTools Network tab request's `Authorization` header while logged into Discord — §4.2's README steps).
5. `npx wrangler deploy`. Note the resulting `https://<name>.<subdomain>.workers.dev` URL.
6. **Important:** do not rely on Git-push auto-deploy for this Worker unless you've confirmed your Cloudflare account's Workers Builds token works — the reference project documented this failing and reverted to manual `wrangler deploy` (§4.2.1). Budget for manual redeploys after every Worker change.

### Step 4 — Cloudflare Pages environment / config
Neither app uses Pages environment variables. Instead, before deploying, hand-edit the `CONFIG` object at the top of each `index.html`'s `<script>` block (§5.19) with your Supabase URL/anon key and your new Worker URL. If you want to support the buyer/configurator model (§8), keep the same `%%TOKENS%%`-style comment convention and build your own substitution tool — none of the substitution tooling itself was recoverable from the reference repos, so this part is a from-scratch design decision, not a port.

### Step 5 — Configure Gemini API
- For the Worker-proxied features (PnL Tracker's asset-spec/profile-rules AI lookups): the `GEMINI_API_KEY` Worker secret from Step 3.4 is sufficient — no frontend change needed.
- For the Journal's own AI Review feature: nothing to configure at deploy time — each end user pastes their own free Gemini key into Settings at runtime (§4.4). If you want this to work out of the box for your own testing, get a key at aistudio.google.com/app/apikey and paste it into the deployed app's Settings → AI Review.

### Step 6 — Set up the FF Calendar proxy
Already covered by Step 3 — `GET /ff-calendar` requires no secret, it works as soon as the Worker is deployed with `ALLOWED_ORIGINS` correctly set. Verify with `curl https://<your-worker>.workers.dev/ff-calendar` and confirm you get back JSON (not an HTML rate-limit page — the public template's version explicitly checks for this: `text.trim().startsWith('<')` → treated as upstream rate-limiting).

### Step 7 — Deploy frontend via Cloudflare Pages Git integration
1. Push each `index.html` + `_headers` pair to its GitHub repo (Step 1).
2. Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git → select the repo.
3. Framework preset: **None**. Build command: *(leave empty)*. Build output directory: `/`.
4. Deploy. Repeat for the second repo. Note both resulting `*.pages.dev` URLs.
5. Go back and update each `_headers` CSP (§2.1) to reference the **other** app's real `*.pages.dev` URL (there's a circular dependency: the Journal's CSP needs to know PnL Tracker's URL and vice versa — deploy once to learn the URLs, then commit a follow-up fix with the correct cross-references, matching the reference project's own `frame-src`/`frame-ancestors` values).
6. Update each `CONFIG.PNL_URL` (Journal only) to match the real PnL Tracker Pages URL, and each `CONFIG.CF_WORKER` to the Worker URL from Step 3.5, then push again.

### Step 8 — Test end-to-end
1. Sign up a test user on the Journal (Supabase Auth email/password) — confirm the email if confirmation is required.
2. Create a Weekly Bias → confirm it appears in `weeklies` (Supabase Table Editor) and on the Weekly Bias page.
3. Create a Daily Bias linked to that Weekly Bias → confirm `trades.wb_entry_id` matches the weekly's `id`.
4. Open an Intraday trade linked to that Daily Bias → confirm `trades.weekly_link_id` matches the Daily Bias trade's `id` (not the weekly's `id` — §7.2).
5. Close the trade, attach a screenshot, confirm it lands in Supabase Storage bucket `screenshots` and a signed URL renders it back.
6. Paste a Gemini key into Settings, run AI Review on the closed trade, confirm `trades.ai_review` populates.
7. Open PnL Tracker, sign in with the same Supabase user, create an Account, confirm the closed intraday trade appears once assigned via the Journal's close-modal account-assignment field (`trade_account_map`).
8. Visit `/ff-calendar` and the Discord page in the Journal to confirm the Worker proxy routes are reachable (skip Discord if you didn't configure `DISCORD_TOKEN`).
9. Run the Archive flow on a trade dated far enough in the past, confirm: a ZIP downloads, the `trades`/`weeklies` rows disappear from Supabase, their Storage screenshots are gone, and `cumulative_stats`/`archive_log` reflect the run (§9, Function Reference Archive module for exact steps).



## 11. Dependency map & call chains

This section covers Step 3 of the brief: entry points, leaf functions, and the exact call chain for each major user-facing action. All chains below are built directly from the static call-graph extraction (cross-referenced against the full source for every function named) — see the Function Reference (§12–13) for the full per-function detail behind each name mentioned here.

### 11.1 Entry points

An "entry point" is a function reached from something other than another documented JS function — a `<script>`-top-level call, an `addEventListener`/`onAuthStateChange` callback, a `setTimeout`, or (very commonly in this codebase) an inline HTML `onclick`/`onchange`/`oninput` attribute.

**Trade_Journal:**
| Entry point | Triggered by |
|---|---|
| `onLoggedIn(user)` | `_sb.auth.getSession().then(...)` (page load, existing session) AND `_sb.auth.onAuthStateChange` on `SIGNED_IN` (fresh login) — **two independent paths converge on the same function**, unlike PnL Tracker which only checks the session once. |
| `doLogin()` / `doSignup()` / `doReset()` | Inline `onclick` on the Auth screen's buttons. |
| `navTo(page)` | Inline `onclick="navTo('...')"` on every nav-bar item (12 pages) plus dozens of in-app "go to X" links/buttons. |
| `checkPriorIncompleteArchive()` | `setTimeout(..., 3000)` inside `onLoggedIn`. |
| `cleanStaleDisplayUrls()` | `setTimeout(..., 5000)` inside `onLoggedIn`. |
| `runArchive()` | Inline `onclick="runArchive()"` on the Archive settings card (confirmed by chunk-5's review: the JSON's apparent `populateArchiveInfo → runArchive` call edge is a false positive from a code *comment*, not a real call). |
| Dozens of `save*`/`open*Modal`/`toggle*` functions | Inline HTML event attributes — flagged individually throughout §12 wherever the static analysis found zero in-code callers. |
| `NR.init()` (News page) | First navigation into the News page (`navTo('news')` → `init` in the JSON call list resolves to `NR.init`). Lazily cascades into `EC.init()` (economic calendar) and `DC.init()` (Discord) — neither of the latter two is called eagerly at page load. |

**Profit_Tracker:**
| Entry point | Triggered by |
|---|---|
| IIFE `restoreTheme` | Runs immediately at parse time (before any user interaction). |
| `checkExistingSession()` | The literal last line of the script (unconditional call) — the true app bootstrap. |
| `doLogin()` | Inline `onclick` on the login button. |
| Every `on*` handler in the modals/settings page | Inline HTML attributes (this app has almost no functions with detected in-code callers outside the `render*`/`load*` core chains — see §13 notes per function). |

### 11.2 Leaf functions (pure utilities, no outbound calls)

Representative sample (full list is every function in §12/§13 whose "Calls" field reads "(none)"): `idEq`, `_cacheKey`, `_stripSS`, `_inferAssetClass`, `pipSize`, `normalizeDirection`, `calDateKey`, `classifySymbol`, `resolveContractSpec`, `withComm`, `g`, `pf`, `confBadge`, `_arcWriteLog`, `_arcUpdateLog`, `collectArchiveData`, `collectAllScreenshotUrls`, `requestPersistentStorage`. These are safe to unit-test in isolation and safe to port verbatim to another language/runtime with no dependency untangling required.

### 11.3 Call chain — Login

```
doLogin()
  → _sb.auth.signInWithPassword({email, password})
  → onLoggedIn(user)                              [also reached via getSession()/onAuthStateChange]
      → requestPersistentStorage()                  (leaf — navigator.storage.persist())
      → loadAllData()                                (see §11.4 — full data load)
      → setTimeout(checkPriorIncompleteArchive, 3000)
      → setTimeout(cleanStaleDisplayUrls, 5000)
```
`doSignup()` is a sibling path that does NOT call `onLoggedIn` — it only shows a "check your email to confirm" message; the user must then use `doLogin()` separately once confirmed.

### 11.4 Call chain — Load data on login

```
loadAllData(force?)
  → setSyncStatus('syncing')
  → loadPnlAccounts()                               (fire-and-forget, reads PnL Tracker's `accounts`/`trade_account_map`)
  → _sb.from('sync_meta').select(...)                 → compare serverLastMod vs getCachedLastMod()
     ├─ [cache still valid AND loadLocalCache() succeeds] → fast path:
     │     setSyncStatus('synced') → updateSyncBar() → renderDashboard() → renderOpen()
     │     → updateOpenBadge() → updateWeeklyBadge() → updateIntradayBadge()
     │     → refreshIntraWeeklyDropdown() → loadCoreRules() → renderNotes()
     │     → showToast('✓ Up to date (cached)') → setTimeout(refreshSsCacheInfo, 800)
     │     → loadInsightSnapshot() → loadCumulativeStats()      [RETURNS here]
     └─ [cache stale or forced] → full fetch path:
           Promise.all([
             _sb.from('trades').select(LIGHT_TRADE_COLS)...,
             _sb.from('weeklies').select('*')...,
             _sb.from('notes').select('*')...
           ])
           → S.trades = data.map(dbToTrade); S.weeklies = data.map(dbToWeekly); S.notes = data.map(dbToNote)
           → touchSyncMeta() [only if server had no last_modified yet] → saveLocalCache()
           → setSyncStatus('synced') → updateSyncBar() → renderDashboard() → renderOpen()
           → updateOpenBadge() → updateWeeklyBadge() → updateIntradayBadge()
           → refreshIntraWeeklyDropdown() → loadCoreRules() → renderNotes()
           → showToast('✓ Data synced') → setTimeout(refreshSsCacheInfo, 800)
           → loadInsightSnapshot() → loadCumulativeStats()
  → [on any thrown error] setSyncStatus('error') → showToast(...) → loadLocalCache() fallback → re-render subset
```
Screenshots are deliberately NOT fetched here (`LIGHT_TRADE_COLS` excludes all screenshot columns) — they're lazy-loaded per-trade by `loadTradeScreenshots()`/`loadTradeScreenshotsForOpen()` only when a trade card is actually expanded/opened, keeping the initial login load fast.

### 11.5 Call chain — Create Weekly Bias

```
openNewWeeklyModal()                                (inline onclick — nav button)
  → rteSet(...) [clear rich-text field] → remove(...) [clear screenshot cache slot]
  → renderTagsInWrap(...) → renderWBCards(...)        [populate the checklist UI]
... user fills the Weekly Bias checklist + fields, clicks Save ...
saveWeeklyBias()                                     (inline onclick on Save button)
  → harvestTags(...) [collect tags from the tag-input UI]
  → runWBEngine(ans) → getWBBias(...)                  [derive the checklist-computed bias]
  → idEq(...) [find existing weekly if editing]
  → rteGet(...) [pull rich-text note content]
  → saveWeekly(w)
      → setSyncStatus('syncing') → weeklyToDb(w) → _sb.from('weeklies').upsert(row, {onConflict:'id'})
      → touchSyncMeta() → saveLocalCache() → setSyncStatus('synced')/'error'
  → remove(...) [clear pending screenshot upload slot]
  → renderWeekly() → updateWeeklyBadge() → refreshIntraWeeklyDropdown()
```

### 11.6 Call chain — Create Daily Bias

```
(navigate to the "Daily Bias" page, id="page-idea")
... user completes the checklist; two possible save actions ...

saveIdeaAsOpen()                                     (log Daily Bias, no intraday execution yet)
  → harvestTags(...) → showToast(...)
  → getBias() → runTTEngine/runHTFEngine (checklist scoring engines, computed earlier in the flow)
  → rteGet(...) [notes]
  → saveTrade(t)   with is_intraday=false, wb_entry_id = <selected Weekly Bias id, from refreshWbEntryDropdown/onWbEntryDropdownChange>
      → setSyncStatus('syncing') → tradeToDb(t) → _sb.from('trades').upsert(row, {onConflict:'id'})
      → [if status==='closed', which it usually isn't yet at this stage] saveInsightSnapshot()/saveCumulativeStats()
      → touchSyncMeta() → saveLocalCache() → setSyncStatus('synced')
  → rteSet(...) [reset form] → remove(...) [clear screenshot slot] → setTradeType(...) [reset]
  → updateOpenBadge() → navTo('open')                  [jumps the user to the Open page to see it]
```

### 11.7 Call chain — Log a new (Intraday) trade

```
(user is on the "Intraday" page, optionally selects a parent Daily Bias via #intraWeeklyLink)
saveIntradayIdea()
  → harvestTags(...) → showToast(...)
  → getIntraBias()                                   [reads the linked Daily Bias trade's biasSet, via idEq lookup in S.trades filtered to !isIntraday]
  → rteGet(...) [idea/entry notes]
  → saveTrade(t)   with is_intraday=true, weekly_link_id = <selected Daily Bias trade id, from #intraWeeklyLink>
      (same saveTrade→tradeToDb→upsert→touchSyncMeta→saveLocalCache chain as §11.6)
  → fullResetIntraday() [clear the form for the next entry]
  → renderIntradayView() → updateOpenBadge() → updateIntradayBadge()
  → navTo('open')
```

### 11.8 Call chain — Edit an open trade

```
(user is viewing the Open trades list)
renderOpen() / tradeCard(...)  → generates each open trade's card, including its onclick handlers

patchOpen(id, field, val)                            (inline quick-edit, e.g. changing a single field directly on the card)
  → idEq(...) [locate the trade in S.trades]
  → saveTrade(t)  (as above)

... OR, for a fuller edit via modal ...
openEditOpenModal(id)  → (not shown in the extracted call list above but documented per-function in §12 chunk 3) populates the Edit Open modal
saveEditOpen()
  → idEq(...) → showToast(...) → rteGet(...) [pull edited notes]
  → loadTradeScreenshots(id) [ensure screenshot data is loaded before re-saving, since the light trade object may not have it yet]
  → saveTrade(t)  (as above)
  → remove(...) [clear a pending upload slot] → renderOpen()
```

### 11.9 Call chain — Close a trade

```
openCloseModal(id)                                    (inline onclick on an open trade's "Close" button)
  → idEq(...) → rteSet(...) → populateCmAccountSelect(...) [PnL Tracker account dropdown]
  → updateCmAutoResult()  [live-computed WIN/LOSS/BE preview as the user types close price]
... user optionally clicks "Fetch Signal" (EBP) ...
cmFetchSignal()  → GET {ebpWorkerUrl}/signals/{id}  → populates S._cmSignalData + signal_* preview fields
... user clicks the final Close/Save button ...
saveClosure()
  → showToast(...) → idEq(...) → _calcTpR(...) [compute R-multiple tags]
  → rteGet(...) [close notes]
  → fetch(...) [any final signal/account-assignment network call inline in this function]
  → loadTradeScreenshots(id) [ensure screenshots loaded before persisting]
  → assignTradeAccount(tradeId, accountId)             → _sb.from('trade_account_map').upsert/delete   [PnL Tracker linkage]
  → computeHiddenScores(...)  [derive score/grade for the now-closed trade]
  → saveTrade(t)  with status='closed'
      → ... → [status==='closed' branch fires] saveInsightSnapshot() AND saveCumulativeStats() (fire-and-forget)
  → filter(...) [housekeeping on some in-memory array]
  → _geminiKey()  [check whether an AI Review key is configured]
      └─ [if configured] triggerDailyAiReview(tradeId)          (see §11.10 — fire-and-forget, does not block the close)
  → closeModalHide() → updateOpenBadge() → updateIntradayBadge() → renderOpen() → renderDashboard()
  → navTo('closed')
```

### 11.10 Call chain — Run AI Review

```
triggerDailyAiReview(tradeId)                         (called from saveClosure on close, OR manually from a "Re-run AI Review" button on a closed trade card, per renderTradeAiReviewBlock)
  → idEq(...) [locate trade]
  → loadTradeScreenshots(tradeId) [ensure screenshots are loaded — AI review needs the actual images]
  → _resolveDataUrls(...) [turn stored Storage paths back into fetchable/base64 image data — signed URLs or cached blobs]
  → _buildDailyPrompt(t) [construct the text prompt describing the trade + checklist + rules]
  → callGeminiVision(promptText, imageDataUrls)
      → fetch https://generativelanguage.googleapis.com/.../gemini-2.0-flash-lite:generateContent?key={userKey}
      → retries up to 3× on HTTP 429
  → _parseDailyAiResponse(rawText) [strip markdown fences, JSON.parse, validate shape]
  → saveTrade(t)  with ai_review = {model, ...parsed}
  → renderClosed()  [refresh the UI to show the new AI Review block]

triggerWeeklyAiReview(weeklyId)                       (analogous, for a completed Weekly Bias review)
  → idEq(...) → getWeekTrades(weeklyId) → filter(...) → calcR(...)  [gather the week's trades + their R-multiples as review context]
  → _resolveDataUrls(...) → _buildWeeklyPrompt(w, weekTrades)
  → callGeminiVision(...)  (same Gemini call + retry logic as above)
  → _parseWeeklyAiResponse(rawText)
  → saveWeekly(w)  with weekly_review = {...parsed}
  → renderWeekly() → renderWeeklyAiReviewBlock(...)
```
Both AI Review entry points are **entirely client-side and BYOK** — no Cloudflare Worker involvement (§4.4). If `_geminiKey()` returns `null`, the AI Review UI shows a "disabled — add Gemini API key in Settings" message instead of ever calling these functions.

### 11.11 Call chain — Archive

```
runArchive()                                          (inline onclick on the Archive settings card's confirm button)
  → showToast(...) → _arcSetStep(1, 'active') → _arcStatus('...')
  → getArchiveCutoffDate()                              [user-configured cutoff, e.g. "archive anything older than 90 days"]
  → [STEP 1] _arcWriteLog('running', null)                → INSERT archive_log row, returns its id
  → [guard] if any OPEN trades exist before the cutoff → _arcShowError(...) and abort (open trades are never silently archived)
  → [STEP 2-3] collectArchiveData(cutoff)
      → Promise.all([ trades.select('*').lt('date',cutoff), weeklies.select('*').lt('date',cutoff) ])
  → [if nothing found] _arcUpdateLog(logId, {status:'failed', stats:{reason:'No data to archive'}}) → _arcShowError(...) → abort
  → [STEP 3] collectAllScreenshotUrls(trades, weeklies)     [enumerate every screenshot path across trades/weeklies/trade_notes]
  → _arcSetStep(3,'active') → _arcStatus('Collecting screenshot paths…')
  → [STEP 4] downloadAllScreenshotBlobs(urlEntries, onProgress)
      → resolveStoragePath(...) → fetch(signedUrl) [per screenshot] → set(...) [cache blob]
  → buildArchiveZip(trades, weeklies, blobs)              [construct the exportable ZIP in memory, e.g. via a JS zip library]
  → computeArchiveChecksum(zip)                            [integrity hash embedded in/alongside the zip]
  → triggerZipDownload(zip, stats, cutoff)
      → archiveConfirmCheckChanged(...)                     [gates the destructive step behind an explicit user checkbox: "I have verified the downloaded zip"]
  → [only after the user confirms the zip] _extractStoragePath(...) → remove(...) [Supabase Storage batch delete of every archived screenshot]
  → finaliseArchive(cutoff, logId, stats)
      → filter(...) [drop archived trades/weeklies out of S.trades/S.weeklies in memory]
      → _emptyCumulativeStats() [baseline object shape] → calcR(...) [fold R-values into the cumulative baseline]
      → saveInsightSnapshot() [refresh the cache now that older trades are gone from the live set]
      → _arcUpdateLog(logId, {status:'completed', completed_at: now, stats})
  → touchSyncMeta() → saveLocalCache()
  → renderDashboard() → renderOpen() → updateOpenBadge() → updateWeeklyBadge() → updateIntradayBadge()
  → populateArchiveInfo(...)  [refresh the Archive card's own summary of past runs]
```
**This is the single most destructive user-facing action in the app.** Per chunk-5's review of the actual source: `runArchive()` enforces (a) a hard failsafe that refuses to run if open trades exist before the cutoff, (b) a mandatory zip-download-and-confirm gate before any Supabase delete happens, and (c) an explicit "point of no return" flag once deletion has begun, so a mid-run failure can be reported to the user as a partial/inconsistent state requiring manual verification rather than silently retried. `runArchiveDestructive()` (a similarly-named but NOT called function found in the same area of the file) is dead code — it duplicates part of the deletion logic but has zero call sites; `checkPriorIncompleteArchive()` is what detects and warns about a prior run that reached `_arcWriteLog` but never reached `_arcUpdateLog(...{status:'completed'})`.

### 11.12 Call chain — Sync to Supabase

There is no single dedicated "Sync" button/function in the Journal (unlike PnL Tracker's explicit `syncFromJournal()`) — instead, every mutation function ends its own chain with the same three-step pattern:
```
<mutation, e.g. saveTrade / saveWeekly / saveNoteToDb / saveRulesToSupa>
  → _sb.from(<table>).upsert(...)  [or .delete()/.insert() as appropriate]
  → touchSyncMeta()                  → _sb.from('sync_meta').upsert({user_id, last_modified: now, last_device: DEVICE_ID})
  → saveLocalCache()                 → localStorage.setItem(...) [light snapshot, screenshots stripped]
```
`touchSyncMeta()`'s write to `sync_meta.last_modified` is what makes the next `loadAllData()` call (on this or another device) correctly detect "server is newer than my cache" and force a full refetch instead of using the stale local cache — this is the entire mechanism behind the app's informal multi-device sync.

### 11.13 Dead / unreferenced functions worth flagging

Cross-referencing every chunk's own findings (§12), these functions have zero detected callers from either static analysis or a manual re-check of the source, and are plausible dead code rather than inline-onclick entry points:
- `runArchiveDestructive(trades, weeklies, blobMap)` — superseded by inline logic in `runArchive()` itself (§11.11).
- `getGrade` — per chunk 2's finding, superseded by `deriveDisplayGrade`, with an explicit code comment saying so.
- `loadTradeScreenshotsForOpen` — per chunk 3's finding, looks superseded by the generic `loadTradeScreenshots`.
- `deriveAlignmentStatus`/`toDirection` — per chunk 3's finding, an apparently unused "alignment engine" not currently wired into the UI.
- `toggleWeeklyShowClosed` — per chunk 2's finding, possibly vestigial (`renderWeekly()`'s current logic doesn't appear to read the flag it sets).

None of these were deleted or altered — they are documented in full in §12 exactly as found, with these caveats repeated inline.


## 12. Trade_Journal — Function Reference (469 functions)

> Documented in 8 sequential chunks covering the full inline script (lines 7330-20216). Each chunk groups its functions into logical modules per the brief's Step 2 requirement. Cross-reference callers/callees using the exact function names, which are consistent across chunks.

## Trade_Journal — Functions (chunk 0 of 8, lines 7330-9187)

> Scope note: this chunk begins right after the HTML/CSS block, at the top of the
> inline `<script>`. It defines the app's global `CONFIG` object, the Supabase
> client, the device-id bootstrap, the local-cache and IndexedDB screenshot-cache
> modules, the entire `S` global state object literal, the three checklist "bias
> engines" (HTF/OMAR, Weekly-Bias, TTrades), and the Auth + Supabase data-layer
> (trade/weekly CRUD, sync-meta, PnL-tracker account linking). Non-function
> declarations encountered along the way (`CONFIG`, `_sb`, `DEVICE_ID`, `S`,
> `HTF_DISPLAY`, `CONFIDENCE_RULES`, `ENVIRONMENT_MAP`, `HTF_STATE_META`,
> `BIAS_CARDS_WEEKLY`, `WB_DISPLAY`, `TT_STATE_PLANS`, `TT_FALLBACK_PLAN`, etc.)
> are referenced for context but are not documented as functions since they are
> not in scope of the function inventory.

---

### Module: Utilities

#### idEq(a, b)

- **File:** Trade_Journal/index.html (line 7330)
- **Module:** Utilities
- **Purpose:** Safe identity comparison for record IDs, which may be legacy numeric IDs or Supabase UUID strings. Used everywhere instead of `===`/`==` to avoid type-mismatch bugs (e.g. `5 === "5"` is false, but these should be treated as the same record).
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| a | any (string \| number \| null \| undefined) | First ID to compare |
| b | any (string \| number \| null \| undefined) | Second ID to compare |

- **Returns:** `boolean` — `true` only if both `a` and `b` are non-null/non-undefined and `String(a) === String(b)`.
- **Internal logic:**
  - Single-expression guard: `a != null && b != null && String(a) === String(b)`.
  - Short-circuits to `false` if either argument is `null`/`undefined`.
  - Otherwise coerces both to strings and compares.
- **Calls:** (none)
- **Called by:** loadTradeScreenshots, deleteTradeSupa, navTo, _syncCloseTags, getRecentTagsForContext, saveWeeklyBias, openWeeklyReview, computeProcessAdherenceDisplay, saveWeeklyReview, closeWeeklyReview, closeWeeklyBias, reopenWeeklyBias, renderWeekly, deleteWbScreenshot, openEditWeeklyModal, deleteWeeklyBias, openAddNoteModal, saveWbNote, renderIntradayList, editIntradayFromList, computeAlignmentAndBanner, saveIntradayIdea, getIntraBias, onIntraWeeklyLink, openChecklistView, openChecklistEdit, saveChecklistUpdate, refreshWbEntryDropdown, onWbEntryDropdownChange, computeHiddenScores, patchOpen, addSsToOpenTrade, deleteOpenTrade, loadTradeScreenshotsForOpen, ssLazySection, toggleWbScreenshots, toggleWbUpdateScreenshots, renderOpen, tradeCard, openCloseModal, updateCmAutoResult, saveClosure, openEditOpenModal, saveEditOpen, openEditClosedModal, updateEcAutoResult, saveEditClosed, deleteTrade, openTradeHistory, thSaveNote, openEditNoteModal, saveNote, openIntraForTrade, linkAndPullIntra, pullPricesFromIntra, openTradeNoteModal, saveTradeNote, shareOpenTrade, shareClosedTrade, triggerDailyAiReview, triggerWeeklyAiReview (85 total call sites file-wide — this is one of the most heavily used helpers in the app)
- **Side effects:** None — pure function.
- **Notes:** Deliberately loose/duck-typed comparison by design (the whole app mixes legacy numeric primary keys with newer UUID strings after a Supabase migration). Because it is so widely relied upon, any change to its null-handling semantics would ripple through nearly every CRUD path in the app.

---

#### _renderNeedsConfig(containerId)

- **File:** Trade_Journal/index.html (lines 7346-7355)
- **Module:** Utilities / UI Rendering
- **Purpose:** Renders a standard "this feature needs additional configuration" placeholder into a given container, shown when an integration (Discord feed, News/EBP, etc.) hasn't had its Cloudflare Worker configured yet.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| containerId | string | DOM element id of the container to render the placeholder into |

- **Returns:** `void`
- **Internal logic:**
  - Looks up `document.getElementById(containerId)`.
  - If the element doesn't exist, returns silently (no-op/no throw).
  - Otherwise overwrites its `innerHTML` with a centered, monospace-font message: a gear emoji, "Needs additional configuration", and a hint to set up the CF Worker in Settings.
- **Calls:** (none)
- **Called by:** _fetch, _fetchChannel, NewsView, EC
- **Side effects:** DOM mutation — replaces `innerHTML` of `#<containerId>`.
- **Notes:** Purely presentational fallback; reused across several unrelated features (Discord feed fetchers, news view, "EC" — an economic-calendar-ish view) that all depend on `CONFIG.CF_WORKER` being reachable.

---

### Module: Local Cache (localStorage)

#### _cacheKey(suffix)

- **File:** Trade_Journal/index.html (line 7372)
- **Module:** Local Cache
- **Purpose:** Builds the per-user localStorage key used for a given cache "bucket" (trades/weeklies/notes/lastmod), namespaced by the logged-in user's id so multiple accounts on one device/browser don't collide.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| suffix | string | Cache bucket name, e.g. `'trades'`, `'weeklies'`, `'notes'`, `'lastmod'` |

- **Returns:** `string` — e.g. `'ict_cache_trades_3f9a...'` or `'ict_cache_trades_anon'` if logged out.
- **Internal logic:** Template-concatenates `'ict_cache_' + suffix + '_' + (_currentUser ? _currentUser.id : 'anon')`.
- **Calls:** (none)
- **Called by:** saveLocalCache, loadLocalCache, getCachedLastMod, setCachedLastMod
- **Side effects:** Reads the global `_currentUser` variable (no mutation).
- **Notes:** The `'anon'` fallback means pre-login cache reads/writes are namespaced together, but since these functions guard on `_currentUser` elsewhere (e.g. `touchSyncMeta`), in practice this path is rarely hit meaningfully before login.

---

#### saveLocalCache()

- **File:** Trade_Journal/index.html (lines 7374-7392)
- **Module:** Local Cache
- **Purpose:** Persists a "light" snapshot of the in-memory trades/weeklies/notes (`S.trades`, `S.weeklies`, `S.notes`) into `localStorage`, so the app can render instantly on next load without waiting on a network round-trip, and can fall back to this cache if Supabase is unreachable.
- **Parameters:** None
- **Returns:** `void`
- **Internal logic:**
  - Builds `lightTrades` by mapping `S.trades`, destructuring off (and discarding) the heavy `screenshots`, `eodScreenshots`, `followupScreenshots`, and `_ssLoaded` fields from each trade — screenshots are never persisted to localStorage.
  - Builds `lightWeeklies` by mapping `S.weeklies`, stripping `_displayUrl` from each weekly's `screenshots` array and from each `updates[].screenshots` array via `_stripSS`.
  - Writes three JSON blobs to `localStorage` under keys produced by `_cacheKey('trades' | 'weeklies' | 'notes')`.
  - Entire body wrapped in `try/catch`; on failure (e.g. `QuotaExceededError`) logs `console.warn('Cache save failed (quota?)', e)` and otherwise does nothing (no user-facing error).
- **Calls:** _stripSS, _cacheKey
- **Called by:** loadAllData, saveTrade, deleteTradeSupa, saveWeekly, deleteWeeklySupa, saveNoteToDb, deleteNoteFromDb, runArchive
- **Side effects:** localStorage writes to `ict_cache_trades_<uid>`, `ict_cache_weeklies_<uid>`, `ict_cache_notes_<uid>`.
- **Notes:** Called after essentially every successful mutation to keep the offline cache in sync with the in-memory `S` object. Screenshots are intentionally excluded to avoid blowing the ~5-10MB localStorage quota; they live in IndexedDB (`_ssDB`) and Supabase Storage instead.

---

#### loadLocalCache()

- **File:** Trade_Journal/index.html (lines 7394-7405)
- **Module:** Local Cache
- **Purpose:** Rehydrates `S.trades`, `S.weeklies`, `S.notes` from the localStorage cache — used both as a fast-path when the server hasn't changed since last sync, and as an offline fallback when a Supabase fetch fails.
- **Parameters:** None
- **Returns:** `boolean` — `true` if both the trades and weeklies caches existed and parsed successfully (notes cache is optional); `false` if either is missing (`null`) or a JSON parse throws.
- **Internal logic:**
  - Reads `ict_cache_trades_*`, `ict_cache_weeklies_*`, `ict_cache_notes_*` via `_cacheKey`.
  - If trades or weeklies string is `null`, returns `false` immediately (nothing to hydrate).
  - Otherwise `JSON.parse`s trades and weeklies into `S.trades`/`S.weeklies`; notes parses to `S.notes` if present, else defaults to `[]`.
  - Wrapped in `try/catch` returning `false` on any parse error.
- **Calls:** _cacheKey
- **Called by:** loadAllData
- **Side effects:** Mutates global state `S.trades`, `S.weeklies`, `S.notes`.
- **Notes:** Does not restore per-trade screenshots (those were never cached here) — screenshots are lazy-loaded separately via `loadTradeScreenshots`/IndexedDB when a trade is actually opened.

---

#### getCachedLastMod()

- **File:** Trade_Journal/index.html (line 7407)
- **Module:** Local Cache
- **Purpose:** Reads the last-known "server last modified" timestamp from localStorage, used to short-circuit a full data refetch when nothing has changed server-side.
- **Parameters:** None
- **Returns:** `string | null` — an ISO-8601 timestamp string, or `null` if never set.
- **Internal logic:** Single-line `localStorage.getItem(_cacheKey('lastmod'))`.
- **Calls:** _cacheKey
- **Called by:** loadAllData, updateSyncBar
- **Side effects:** localStorage read only.
- **Notes:** Paired with `setCachedLastMod`; compared against `sync_meta.last_modified` fetched from Supabase in `loadAllData` to decide whether to trust the local cache.

---

#### setCachedLastMod(ts)

- **File:** Trade_Journal/index.html (line 7409)
- **Module:** Local Cache
- **Purpose:** Writes the "server last modified" timestamp to localStorage.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| ts | string | ISO-8601 timestamp to store |

- **Returns:** `void`
- **Internal logic:** Single-line `localStorage.setItem(_cacheKey('lastmod'), ts)`.
- **Calls:** _cacheKey
- **Called by:** touchSyncMeta, loadAllData
- **Side effects:** localStorage write to `ict_cache_lastmod_<uid>`.
- **Notes:** None beyond what's noted above.

---

### Module: Supabase Sync Meta / Discord Config

#### touchSyncMeta()

- **File:** Trade_Journal/index.html (lines 7411-7419)
- **Module:** Data Layer / Supabase Sync
- **Purpose:** Marks the current user's data as "modified now, by this device" in the `sync_meta` table — a lightweight cross-device change-detection signal so other devices know to refetch instead of trusting their local cache.
- **Parameters:** None
- **Returns:** `Promise<void>`
- **Internal logic:**
  - Guard: if no `_currentUser`, return immediately.
  - Computes `ts = new Date().toISOString()`.
  - `try`: `_sb.from('sync_meta').upsert({ user_id, last_modified: ts, last_device: DEVICE_ID }, { onConflict: 'user_id' })`, then calls `setCachedLastMod(ts)` to keep the local cache's notion of "last mod" in sync with what was just written.
  - `catch`: logs `console.warn('sync_meta update failed', e)` — failure here does not throw/propagate to the caller.
- **Calls:** setCachedLastMod
- **Called by:** loadAllData, saveTrade, deleteTradeSupa, saveWeekly, deleteWeeklySupa, saveNoteToDb, deleteNoteFromDb, saveRulesToSupa, runArchive
- **Side effects:** Supabase write — upsert into `sync_meta` (columns `user_id`, `last_modified`, `last_device`); localStorage write via `setCachedLastMod`.
- **Notes:** Called after nearly every successful create/update/delete across trades, weeklies, notes, core rules, and archive operations — it's the app's core "dirty" heartbeat. Failure is deliberately non-fatal (swallowed) so a `sync_meta` hiccup never blocks the actual data save that already succeeded.

---

#### saveDiscordChannels(channels)

- **File:** Trade_Journal/index.html (lines 7421-7431)
- **Module:** Data Layer / Discord Integration
- **Purpose:** Persists the user's configured list of Discord feed channel IDs/settings to `sync_meta.discord_channels` so the configuration follows the user across devices.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| channels | Array | List of Discord channel config objects/IDs to persist |

- **Returns:** `Promise<void>`
- **Internal logic:**
  - Guard: if no `_currentUser`, return.
  - `try`: `_sb.from('sync_meta').upsert({ user_id, discord_channels: channels }, { onConflict: 'user_id' })`.
  - `catch`: `console.warn('saveDiscordChannels failed:', e)`.
- **Calls:** (none — only Supabase client calls)
- **Called by:** saveChannels
- **Side effects:** Supabase write — `sync_meta.discord_channels` column.
- **Notes:** Unlike `touchSyncMeta`, this does **not** bump `last_modified`/`last_device`, so saving Discord channel config alone will not trigger other devices to treat the account's trade/weekly data as changed.

---

### Module: Screenshot Storage (IndexedDB Cache — `_ssDB` module)

> The following 11 functions (`open`, `get`, `set`, `remove`, `clear`, `sizeInfo`,
> `count`, `getBlob`, `setBlob`, `removeBlob`, `clearBlobs`) are all declared
> inside a single IIFE (lines 7434-7579) that produces the module-level singleton
> `_ssDB = { get, set, remove, clear, sizeInfo, count, getBlob, setBlob, removeBlob, clearBlobs }`.
> It wraps a browser IndexedDB database named `ict_ss_cache` (version 2) with two
> object stores: `screenshots` (keyed by `String(tradeId)`, holds a trade's
> screenshot arrays) and `blob_cache` (keyed by raw Supabase Storage path, holds a
> base64 data-URL blob). Because several of these functions have generic names
> (`open`, `get`, `set`, `remove`, `clear`, `count`) that collide with many
> unrelated identifiers elsewhere in the 20k-line file (native `Map`/`Array`
> methods, DOM `classList` calls, native `IDBObjectStore.get/put/delete` method
> calls, other locally-scoped helpers of the same name in unrelated closures),
> the static-analysis `inboundCallers`/`outboundCalls` lists for this group are
> noisier than usual — likely callers are called out explicitly below; the rest
> of the JSON list is included for completeness but should be treated with
> skepticism.

#### open()

- **File:** Trade_Journal/index.html (lines 7441-7457)
- **Module:** Screenshot Storage (IndexedDB)
- **Purpose:** Opens (or returns an already-open handle to) the `ict_ss_cache` IndexedDB database, creating its two object stores on first run / version upgrade.
- **Parameters:** None
- **Returns:** `Promise<IDBDatabase>`
- **Internal logic:**
  - If module-level closure variable `_db` is already set, resolves immediately with it (singleton/memoization — avoids reopening the DB on every call).
  - Otherwise calls `indexedDB.open(DB_NAME, DB_VER)`.
  - `onupgradeneeded`: creates the `screenshots` object store if missing, and the `blob_cache` object store if missing (this is what allows a version-1→version-2 upgrade to add the blob cache without wiping existing screenshot data).
  - `onsuccess`: caches the resulting `db` in `_db` and resolves.
  - `onerror`: logs `console.warn('IDB open error', e)` and rejects.
- **Calls:** (none)
- **Called by (per static analysis):** get, set, remove, clear, count, getBlob, setBlob, removeBlob, clearBlobs, initPnlPage
- **Side effects:** Creates/opens a browser IndexedDB database; caches the handle in the closure-local `_db` variable.
- **Notes:** `initPnlPage` in the caller list is very likely a false positive (a different, unrelated `open(...)`-shaped call elsewhere in the file) rather than a genuine caller of this IndexedDB opener — verify before relying on it. All 9 sibling functions in this module do genuinely call this `open()` to obtain their DB handle.

---

#### get(tradeId)

- **File:** Trade_Journal/index.html (lines 7459-7469)
- **Module:** Screenshot Storage (IndexedDB)
- **Purpose:** Reads a trade's cached screenshot payload out of the `screenshots` IndexedDB object store.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| tradeId | string \| number | Trade ID whose cached screenshot payload to fetch (coerced to `String`) |

- **Returns:** `Promise<object|null>` — the previously-stored payload object (`{screenshots, eodScreenshots, followupScreenshots, cachedAt}`), or `null` if not cached or on error.
- **Internal logic:**
  - `await open()` to get the DB handle.
  - Opens a `'readonly'` transaction on `STORE` ('screenshots'), calls `.get(String(tradeId))`.
  - Resolves with `req.result || null` on success; rejects with `req.error` on failure — but the whole thing is wrapped in an outer `try/catch` that returns `null` on any thrown/rejected error.
- **Calls:** open
- **Called by (genuine):** loadTradeScreenshots, loadTradeScreenshotsForOpen (both call `_ssDB.get(id)` directly); `getBlob` in this same module logically parallels it but actually calls the native `IDBObjectStore.get` method, not this function.
- **Called by (per static analysis, likely false positives from name collision):** _parseDailyAiResponse, _parseWeeklyAiResponse, getAllInstruments, _esc, openAssetForm, removeCustomAsset, _CustomAssets, NewsView, NR
- **Side effects:** IndexedDB read (no mutation).
- **Notes:** See module-level caveat above about generic-name collisions in the static caller graph.

---

#### set(tradeId, payload)

- **File:** Trade_Journal/index.html (lines 7471-7481)
- **Module:** Screenshot Storage (IndexedDB)
- **Purpose:** Stores/overwrites a trade's screenshot payload in the `screenshots` object store — the write-side counterpart to `get`.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| tradeId | string \| number | Trade ID to key the cache entry by (coerced to `String`) |
| payload | object | `{screenshots, eodScreenshots, followupScreenshots, cachedAt}` snapshot to persist |

- **Returns:** `Promise<boolean>` — `true` on success, `false` on failure (caught internally).
- **Internal logic:**
  - `await open()`.
  - `'readwrite'` transaction on `STORE`; `.put(payload, String(tradeId))`.
  - Resolves `true` on `onsuccess`, rejects with `req.error` on `onerror`; outer `try/catch` converts any failure to `false`.
- **Calls:** open
- **Called by:** loadTradeScreenshots, saveTrade, loadTradeScreenshotsForOpen, downloadAllScreenshotBlobs
- **Side effects:** IndexedDB write to the `screenshots` store.
- **Notes:** Used both to populate the cache after a first network fetch of screenshots, and to keep it fresh whenever a trade with `_ssLoaded === true` is re-saved (see `saveTrade`).

---

#### remove(tradeId)

- **File:** Trade_Journal/index.html (lines 7483-7493)
- **Module:** Screenshot Storage (IndexedDB)
- **Purpose:** Evicts a single trade's cached screenshot payload from the `screenshots` store (used when a trade is deleted).
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| tradeId | string \| number | Trade ID whose cache entry should be deleted |

- **Returns:** `Promise<boolean>` — intended to be `true` on success, `false` on failure.
- **Internal logic:**
  - `await open()`.
  - Opens the transaction as **`'readonly'`**, then calls `.delete(String(tradeId))` on the object store obtained from it.
  - Resolves `true` on `onsuccess` / rejects on `onerror`; wrapped in `try/catch` returning `false`.
- **Calls:** open
- **Called by (genuine):** deleteTradeSupa (`await _ssDB.remove(tid)`, itself wrapped in a local `try/catch` at the call site)
- **Called by (per static analysis, almost all false positives from the generic name `remove`):** onLoggedIn, _close, showToast, closeSidebar, navTo, renderIntradayView, renderTagsInWrap, renderTagSuggestions, openNewWeeklyModal, saveWeeklyBias, saveWeeklyReview, closeWeeklyReview, openEditWeeklyModal, saveWbNote, editIntradayFromList, fullResetIntraday, saveIdeaAsOpen, openChecklistEdit, closeModalHide, saveEditOpen, saveEditClosed, thAddScreenshots, deleteScreenshotsFromStorage, closeLightbox, closeNoteModal, pullPricesFromIntra, goNewIntradayForTrade, saveTradeNote, archiveModalClose, runArchiveDestructive, runArchive, showInstallBanner, _esc, renderArticles, openKeyModal, closeKeyModal, closeAssetForm, removeChannelRow, NewsView, NR
- **Side effects:** IndexedDB delete on the `screenshots` store.
- **Notes:** **Likely bug**: the transaction is opened as `'readonly'` but a `.delete()` call is issued against it. `IDBObjectStore.delete()` requires a `'readwrite'` transaction; calling it on a read-only transaction throws a synchronous `InvalidStateError` when `.delete(...)` is invoked. Because that throw happens synchronously inside the `new Promise((res, rej) => {...})` executor, the `Promise` constructor itself swallows it and turns it into a *rejected* promise rather than a synchronous exception — but since the `return new Promise(...)` statement is never `await`ed inside `remove`'s own `try` block, the surrounding `try/catch` in `remove` does **not** actually catch this rejection; it only catches synchronous exceptions thrown before the `return`. The rejection instead propagates to whatever `await`s the promise returned by `remove()`. This still "works" only because every real call site (`deleteTradeSupa`) wraps `await _ssDB.remove(tid)` in its own local `try/catch`. Contrast with the structurally-identical `removeBlob` below, which correctly uses `'readwrite'`.

---

#### clear()

- **File:** Trade_Journal/index.html (lines 7495-7505)
- **Module:** Screenshot Storage (IndexedDB)
- **Purpose:** Wipes the entire `screenshots` object store (all cached trade screenshot payloads for all trades).
- **Parameters:** None
- **Returns:** `Promise<boolean>` — `true` on success, `false` on failure.
- **Internal logic:** `await open()`; `'readwrite'` transaction on `STORE`; `.clear()`; resolves `true`/rejects, outer `try/catch` → `false`.
- **Calls:** open
- **Called by:** clearBlobs (via `_ssDB.clear`... actually see Notes), clearSsCache
- **Side effects:** IndexedDB — deletes all records in the `screenshots` store.
- **Notes:** Per the JSON inventory, `clearBlobs` is listed as an inbound caller of `clear`, but reading the source, `clearBlobs` operates on `BLOB_STORE` independently and does not call this `clear()` — this is likely a static-analysis artifact from the shared name `clear`. The genuine caller is `clearSsCache` (an app-level "reset screenshot cache" action, defined outside this chunk), which calls `_ssDB.clear()` to wipe the screenshots store as part of a broader cache-reset flow.

---

#### sizeInfo()

- **File:** Trade_Journal/index.html (lines 7507-7515)
- **Module:** Screenshot Storage (IndexedDB)
- **Purpose:** Reports the browser's current storage usage/quota (via the Storage API), used to show the user how much space the local screenshot cache is consuming.
- **Parameters:** None
- **Returns:** `Promise<{usageMB: string, quotaMB: string} | null>` — `usageMB`/`quotaMB` are strings formatted with `toFixed`; `null` if the Storage API is unavailable or the estimate call fails.
- **Internal logic:**
  - Checks `navigator.storage && navigator.storage.estimate` exist.
  - If so, awaits `navigator.storage.estimate()`, destructures `{usage, quota}`, and returns `{ usageMB: (usage/1024/1024).toFixed(1), quotaMB: (quota/1024/1024).toFixed(0) }`.
  - Wrapped in `try/catch` (empty catch — swallows errors).
  - Falls through to `return null` if the API is unavailable or nothing was returned above.
- **Calls:** (none)
- **Called by:** refreshSsCacheInfo
- **Side effects:** None (read-only browser API call).
- **Notes:** Does not touch IndexedDB directly — reports whole-origin storage usage, not specifically the `ict_ss_cache` database's size.

---

#### count()

- **File:** Trade_Journal/index.html (lines 7517-7527)
- **Module:** Screenshot Storage (IndexedDB)
- **Purpose:** Returns the number of records currently stored in the `screenshots` object store (i.e., how many trades have cached screenshot payloads).
- **Parameters:** None
- **Returns:** `Promise<number>` — record count, or `0` on error.
- **Internal logic:** `await open()`; `'readonly'` transaction on `STORE`; `.count()`; resolves `req.result` on success or `0` on `onerror` (note: the error path resolves `0` rather than rejecting); outer `try/catch` also returns `0`.
- **Calls:** open
- **Called by:** refreshSsCacheInfo
- **Called by (per static analysis, likely false positive):** _canonicalModelStats
- **Side effects:** IndexedDB read (count only).
- **Notes:** Used to display cache stats in a settings/diagnostics panel (`refreshSsCacheInfo`).

---

#### getBlob(storagePath)

- **File:** Trade_Journal/index.html (lines 7530-7540)
- **Module:** Screenshot Storage (IndexedDB)
- **Purpose:** Reads a cached base64 data-URL for a given Supabase Storage path out of the `blob_cache` object store — an optimization so a screenshot's raw bytes don't have to be re-fetched from Supabase Storage every time it's displayed.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| storagePath | string | Raw Supabase Storage object path (the `dataUrl` field stored on a screenshot record) used as the cache key |

- **Returns:** `Promise<string|null>` — the cached data-URL string, or `null` if not cached/on error.
- **Internal logic:** `await open()`; `'readonly'` transaction on `BLOB_STORE`; `.get(storagePath)`; resolves `req.result || null`; outer `try/catch` → `null`.
- **Calls:** open (and, per static analysis, `get` — this is the native `IDBObjectStore.get` method call, not the module's own `get(tradeId)` function; the two share a name but are different call targets)
- **Called by:** resolveScreenshotForDisplay
- **Side effects:** IndexedDB read on `blob_cache`.
- **Notes:** Distinct cache from the `screenshots` store — this one is keyed by storage path and stores actual image bytes (as data URLs), while `screenshots`/`get`/`set` store the *metadata arrays* describing which screenshots a trade has.

---

#### setBlob(storagePath, dataUrl)

- **File:** Trade_Journal/index.html (lines 7542-7552)
- **Module:** Screenshot Storage (IndexedDB)
- **Purpose:** Caches a screenshot's resolved base64 data-URL in the `blob_cache` store, keyed by its storage path, so subsequent renders can skip re-downloading/re-signing it.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| storagePath | string | Supabase Storage object path (cache key) |
| dataUrl | string | Base64 data-URL (or similar) representing the image bytes to cache |

- **Returns:** `Promise<boolean>` — `true` on success, `false` on failure.
- **Internal logic:** `await open()`; `'readwrite'` transaction on `BLOB_STORE`; `.put(dataUrl, storagePath)`; resolves `true`/`false` as usual.
- **Calls:** open
- **Called by:** resolveScreenshotForDisplay
- **Side effects:** IndexedDB write on `blob_cache`.
- **Notes:** None beyond the above.

---

#### removeBlob(storagePath)

- **File:** Trade_Journal/index.html (lines 7554-7564)
- **Module:** Screenshot Storage (IndexedDB)
- **Purpose:** Evicts a single cached blob (by storage path) from `blob_cache`, e.g. when the underlying screenshot is deleted from Supabase Storage.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| storagePath | string | Supabase Storage object path whose cached blob should be removed |

- **Returns:** `Promise<boolean>`
- **Internal logic:** `await open()`; **`'readwrite'`** transaction on `BLOB_STORE`; `.delete(storagePath)`; resolves `true`/`false`.
- **Calls:** open
- **Called by:** deleteScreenshotsFromStorage
- **Side effects:** IndexedDB delete on `blob_cache`.
- **Notes:** Correctly uses a `'readwrite'` transaction for the delete, unlike the sibling `remove(tradeId)` function above (see its Notes for the readonly/delete mismatch bug).

---

#### clearBlobs()

- **File:** Trade_Journal/index.html (lines 7566-7576)
- **Module:** Screenshot Storage (IndexedDB)
- **Purpose:** Wipes the entire `blob_cache` object store (all cached screenshot image data for all trades/weeklies).
- **Parameters:** None
- **Returns:** `Promise<boolean>`
- **Internal logic:** `await open()`; `'readwrite'` transaction on `BLOB_STORE`; `.clear()`; resolves `true`/`false`.
- **Calls:** open, clear (per static analysis — see Notes)
- **Called by:** clearSsCache
- **Side effects:** IndexedDB — deletes all records in `blob_cache`.
- **Notes:** The JSON inventory lists `clear` as an outbound call of `clearBlobs`, but reading the source, `clearBlobs` calls `tx.objectStore(BLOB_STORE).clear()` — the native `IDBObjectStore.clear()` method — not the sibling module function `clear()` (which operates on `STORE`/`screenshots`). Likely a static-analysis name collision rather than a real function-to-function call.

---

### Module: Device Storage Permissions

#### requestPersistentStorage()

- **File:** Trade_Journal/index.html (lines 7581-7588)
- **Module:** Device Storage Permissions
- **Purpose:** Asks the browser to grant "persistent storage" for the origin (reduces the chance the browser evicts IndexedDB/localStorage data under storage pressure), called once after login.
- **Parameters:** None
- **Returns:** `Promise<void>`
- **Internal logic:**
  - Guard: if `navigator.storage` or `navigator.storage.persist` is unavailable (older/unsupported browsers), return immediately.
  - `try`: checks `navigator.storage.persisted()`; if already granted (`already` truthy), returns early (no need to re-request).
  - Otherwise calls `navigator.storage.persist()` to request the permission (result not checked/used).
  - `catch`: empty — silently ignores any error.
- **Calls:** (none)
- **Called by:** onLoggedIn
- **Side effects:** Browser permission request (may trigger a native prompt or be silently granted/denied depending on browser heuristics/installed-PWA status).
- **Notes:** Fire-and-forget; the app does not check or react to whether persistence was actually granted.

---

### Module: HTF Bias Engine (OMAR Model)

> This engine powers the "Idea/Intraday" checklist's higher-timeframe (HTF)
> market-state classification for the default `'omar'` checklist model. It
> consumes `S.answers` (a map of question-id → `{val, ...}`) filled in by the
> HTF checklist UI (`BIAS_CARDS_OMAR`, defined later in the file) and produces a
> discrete market state, a confidence level, and an "environment" grade (A+/A/B/C).

#### extractHTFValues(ans)

- **File:** Trade_Journal/index.html (lines 7748-7757)
- **Module:** HTF Bias Engine (OMAR)
- **Purpose:** Pulls the six raw checklist answer values needed by the HTF engine out of the generic `ans` answers map, normalizing missing answers to `null`.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| ans | object (map of questionId → `{val, ...}`) | The current checklist answers map (`S.answers` for the intraday/idea flow) |

- **Returns:** `{structure, location, dol, phase, irl, sweep}` — object of six string values (or `null` for any unanswered question).
- **Internal logic:** For each of the 6 known question IDs (`q_swing_structure`, `q_price_location`, `q_htf_dol`, `q_swing_phase`, `q_htf_irl`, `q_ext_sweep`), reads `ans[id] ? ans[id].val : null`.
- **Calls:** (none)
- **Called by:** computeHTFMarketState, computeHTFConfidence
- **Side effects:** None (pure).
- **Notes:** The specific question-id strings (`q_swing_structure` etc.) tie this function to the `BIAS_CARDS_OMAR` checklist definition elsewhere in the file — renaming a question id there without updating here would silently break bias detection.

---

#### computeHTFMarketState(ans)

- **File:** Trade_Journal/index.html (lines 7759-7774)
- **Module:** HTF Bias Engine (OMAR)
- **Purpose:** Classifies the current HTF market state (bullish/bearish continuation or reversal, or neutral) from the six checklist answers, using ICT-style swing-structure/premium-discount/DOL/phase/reaction-area/sweep logic.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| ans | object | Checklist answers map, same shape as consumed by `extractHTFValues` |

- **Returns:** `string | null` — one of `'bearish_reversal'`, `'bullish_reversal'`, `'bullish_continuation'`, `'bearish_continuation'`, `'neutral'`, or `null` if any of the 6 required answers is missing.
- **Internal logic:**
  - Calls `extractHTFValues(ans)`; if any of the 6 fields is falsy, returns `null` (incomplete checklist).
  - Derives booleans: `irlPresent` (irl !== 'none'), `dolReached`, `isActivePh` (phase is frontside or backside), `dolNotReached`, `dolPartial`.
  - Rule order (first match wins):
    1. Bullish structure + premium location + DOL reached + IRL present → `'bearish_reversal'`.
    2. Bearish structure + discount location + DOL reached + IRL present → `'bullish_reversal'`.
    3. Bullish structure + (discount or equilibrium) + (DOL not-reached or partial) + active phase → `'bullish_continuation'`.
    4. Bearish structure + (premium or equilibrium) + (DOL not-reached or partial) + active phase → `'bearish_continuation'`.
    5. Otherwise → `'neutral'`.
- **Calls:** extractHTFValues
- **Called by:** runHTFEngine, renderEntrySection
- **Side effects:** None (pure).
- **Notes:** This is the "reversal requires the DOL to already be reached AND a reaction zone to be present" rule — continuation requires an *active* phase (frontside/backside) and DOL not fully reached; "range" phase never yields continuation, only neutral.

---

#### computeHTFConfidence(state, ans)

- **File:** Trade_Journal/index.html (lines 7776-7783)
- **Module:** HTF Bias Engine (OMAR)
- **Purpose:** Given a classified market state, determines a confidence tier (`'high'`/`'medium'`/`'low'`) by matching the checklist answers against the shared `CONFIDENCE_RULES` rule table.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| state | string \| null | Market state returned by `computeHTFMarketState` |
| ans | object | Checklist answers map |

- **Returns:** `string | null` — `'high'`/`'medium'`/`'low'`, or `null` if `state` is falsy.
- **Internal logic:**
  - Guard: if no `state`, return `null`.
  - Re-derives `v = extractHTFValues(ans)`.
  - Iterates the module-level `CONFIDENCE_RULES` array (shared with the Weekly-Bias engine — declared once, reused for both); for the first rule whose `states` array includes `state` and whose `test(v)` predicate returns truthy, returns that rule's `confidence`.
  - Falls back to `'low'` if no rule matches.
- **Calls:** extractHTFValues
- **Called by:** runHTFEngine
- **Side effects:** None (pure).
- **Notes:** `CONFIDENCE_RULES` (defined earlier in the file, outside this chunk's function list) encodes rules like "reversal states get 'high' confidence only if the reaction zone is a Weekly-timeframe IRL and there's a matching external sweep," etc.

---

#### computeHTFEnvironment(state, confidence)

- **File:** Trade_Journal/index.html (lines 7785-7789)
- **Module:** HTF Bias Engine (OMAR)
- **Purpose:** Maps a (state, confidence) pair to an "environment grade" (A+/A/B/C) with associated display color/label, used to tell the trader how favorable current conditions are for trading.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| state | string \| null | Market state |
| confidence | string \| null | Confidence tier (`'high'`/`'medium'`/`'low'`) |

- **Returns:** object from `ENVIRONMENT_MAP` (e.g. `{env, envLabel, envColor, envBg}`), or `null` if either input is falsy.
- **Internal logic:**
  - Guard: if `!state || !confidence`, return `null`.
  - If `state === 'neutral'`, always returns `ENVIRONMENT_MAP.neutral_override` (grade `'C'`) regardless of confidence — neutral states are capped at a C environment.
  - Otherwise looks up `ENVIRONMENT_MAP[confidence]`, defaulting to `ENVIRONMENT_MAP.low` if `confidence` isn't a recognized key.
- **Calls:** (none)
- **Called by:** runHTFEngine
- **Side effects:** None (pure).
- **Notes:** `ENVIRONMENT_MAP` keys are `high→A+`, `medium→A`, `low→B`, `neutral_override→C` — so a "high confidence, non-neutral" read is the only way to reach the top A+ grade.

---

#### runHTFEngine(ans)

- **File:** Trade_Journal/index.html (lines 7791-7798)
- **Module:** HTF Bias Engine (OMAR)
- **Purpose:** Top-level orchestrator that runs the full HTF checklist → state → confidence → environment pipeline and packages the result with display metadata for rendering.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| ans | object | Checklist answers map (typically `S.answers`) |

- **Returns:** `{state, confidence, envData, meta} | null` — `null` if the checklist is incomplete (state couldn't be determined); otherwise `meta` is looked up from `HTF_STATE_META[state]` (emoji/label/color/bg for that state).
- **Internal logic:**
  1. `state = computeHTFMarketState(ans)`; if falsy, return `null`.
  2. `confidence = computeHTFConfidence(state, ans)`.
  3. `envData = computeHTFEnvironment(state, confidence)`.
  4. `meta = HTF_STATE_META[state]`.
  5. Return the combined object.
- **Calls:** computeHTFMarketState, computeHTFConfidence, computeHTFEnvironment
- **Called by:** getBias, renderBiasCards, updateScoreStrip, deriveDisplayGrade, computeHiddenScores, renderOpen, tradeCard, tradeScorePill, computeNoTradeAnalysis, renderExtraInsights
- **Side effects:** None (pure) — but see Notes re: which "ans" callers pass.
- **Notes:** This is the most widely reused function in the HTF engine — called from a mix of live-checklist UI (`renderBiasCards`, `updateScoreStrip`) and after-the-fact trade grading/analysis (`renderOpen`, `tradeCard`, `computeHiddenScores`), where it is typically invoked with a *closed trade's stored* `checklistAnswers` rather than the live `S.answers`.

---

#### getBias()

- **File:** Trade_Journal/index.html (lines 7800-7813)
- **Module:** HTF Bias Engine (OMAR) / Model Dispatch
- **Purpose:** Returns a simplified 3-way bias label (`'BULLISH'`/`'BEARISH'`/`'NEUTRAL'`) for the currently-in-progress idea/intraday checklist, dispatching to either the TTrades engine or the HTF/OMAR engine depending on which checklist model the user has selected.
- **Parameters:** None
- **Returns:** `'BULLISH' | 'BEARISH' | 'NEUTRAL' | null`
- **Internal logic:**
  - If `S.ideaModel === 'ttrades'`: runs `runTTEngine(S.answers)`; if no result, returns `null`. Maps `state` `'bullish_expansion'`/`'bullish_continuation'` → `'BULLISH'`; `'bearish_expansion'`/`'bearish_continuation'` → `'BEARISH'`; anything else → `'NEUTRAL'`.
  - Otherwise (default/`'omar'` model): runs `runHTFEngine(S.answers)`; if no result, returns `null`. Maps `'bullish_continuation'`/`'bullish_reversal'` → `'BULLISH'`; `'bearish_continuation'`/`'bearish_reversal'` → `'BEARISH'`; else `'NEUTRAL'`.
- **Calls:** runTTEngine, runHTFEngine
- **Called by:** renderBiasCards, updateScoreStrip, saveIdeaAsOpen
- **Side effects:** Reads globals `S.ideaModel`, `S.answers` (no mutation).
- **Notes:** This is the "live idea checklist" bias getter, distinct from `getWBBias` (Weekly Bias) below — it always operates on `S.answers`/`S.ideaModel`, never on an already-saved trade's data.

---

### Module: Weekly Bias (WB) Engine

> Structurally a near-duplicate of the HTF/OMAR engine above, but scoped to the
> Weekly Bias checklist (`BIAS_CARDS_WEEKLY`, shown fully in this chunk) and its
> own answers map convention (`wb_*` prefixed ids, typically stored per-weekly
> as `wbChecklistAnswers` rather than the live `S.answers`). Shares
> `CONFIDENCE_RULES`, `ENVIRONMENT_MAP`, and `HTF_STATE_META` with the HTF engine.

#### extractWBValues(ans)

- **File:** Trade_Journal/index.html (lines 7954-7963)
- **Module:** Weekly Bias (WB) Engine
- **Purpose:** Pulls the six Weekly-Bias checklist answer values out of an answers map (analogous to `extractHTFValues` but reading `wb_*`-prefixed question ids).
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| ans | object | Weekly-Bias checklist answers map (e.g. a weekly's `wbChecklistAnswers`) |

- **Returns:** `{structure, location, dol, phase, irl, sweep}` — reads `wb_swing_structure`, `wb_price_location`, `wb_htf_dol`, `wb_swing_phase`, `wb_htf_irl`, `wb_ext_sweep` respectively, each `ans[id] ? ans[id].val : null`.
- **Internal logic:** Straight field-by-field extraction, same shape as `extractHTFValues`.
- **Calls:** (none)
- **Called by:** computeWBMarketState, computeWBConfidence, _buildDailyPrompt, _buildWeeklyPrompt
- **Side effects:** None (pure).
- **Notes:** Also consumed directly by the Gemini AI prompt builders (`_buildDailyPrompt`, `_buildWeeklyPrompt`, outside this chunk) to include the raw weekly-bias inputs in the AI review prompt text.

---

#### computeWBMarketState(ans)

- **File:** Trade_Journal/index.html (lines 7965-7980)
- **Module:** Weekly Bias (WB) Engine
- **Purpose:** Classifies the Weekly Bias market state using the same rule logic as `computeHTFMarketState`, but sourced from Weekly-Bias-specific answers.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| ans | object | Weekly-Bias checklist answers map |

- **Returns:** `string | null` — same 5 possible states as `computeHTFMarketState` (`bearish_reversal`, `bullish_reversal`, `bullish_continuation`, `bearish_continuation`, `neutral`), or `null` if incomplete.
- **Internal logic:** Byte-for-byte identical rule structure to `computeHTFMarketState`, just built on `extractWBValues(ans)` instead of `extractHTFValues(ans)`. Same guard (all 6 fields required), same booleans (`irlPresent`, `dolReached`, `isActivePh`, `dolNotReached`, `dolPartial`), same 4 ordered rules + neutral fallback.
- **Calls:** extractWBValues
- **Called by:** runWBEngine
- **Side effects:** None (pure).
- **Notes:** Duplicated logic rather than a shared helper parameterized by an extractor — a refactor opportunity, but functionally intentional/safe as-is since the two checklists (HTF/intraday vs Weekly) are edited independently and could diverge in the future.

---

#### computeWBConfidence(state, ans)

- **File:** Trade_Journal/index.html (lines 7982-7989)
- **Module:** Weekly Bias (WB) Engine
- **Purpose:** Confidence-tier lookup for the Weekly Bias state, mirroring `computeHTFConfidence`.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| state | string \| null | Weekly market state |
| ans | object | Weekly-Bias answers map |

- **Returns:** `string | null` — `'high'`/`'medium'`/`'low'`, `null` if `state` is falsy.
- **Internal logic:** Identical to `computeHTFConfidence`: guard on `state`; `v = extractWBValues(ans)`; iterate shared `CONFIDENCE_RULES`, return first matching rule's `confidence`; default `'low'`.
- **Calls:** extractWBValues
- **Called by:** runWBEngine
- **Side effects:** None (pure).
- **Notes:** Reuses the same `CONFIDENCE_RULES` table as the HTF engine — confidence semantics are identical across both checklists by design.

---

#### computeWBEnvironment(state, confidence)

- **File:** Trade_Journal/index.html (lines 7991-7995)
- **Module:** Weekly Bias (WB) Engine
- **Purpose:** Environment-grade lookup for Weekly Bias, mirroring `computeHTFEnvironment`.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| state | string \| null | Weekly market state |
| confidence | string \| null | Confidence tier |

- **Returns:** object from `ENVIRONMENT_MAP`, or `null` if either input is falsy.
- **Internal logic:** Identical to `computeHTFEnvironment`: neutral state forces `ENVIRONMENT_MAP.neutral_override`; otherwise `ENVIRONMENT_MAP[confidence] || ENVIRONMENT_MAP.low`.
- **Calls:** (none)
- **Called by:** runWBEngine
- **Side effects:** None (pure).
- **Notes:** None beyond the above.

---

#### runWBEngine(ans)

- **File:** Trade_Journal/index.html (lines 7997-8004)
- **Module:** Weekly Bias (WB) Engine
- **Purpose:** Top-level Weekly Bias pipeline orchestrator, mirroring `runHTFEngine` but for the Weekly checklist.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| ans | object | Weekly-Bias checklist answers map |

- **Returns:** `{state, confidence, envData, meta} | null` (same shape as `runHTFEngine`'s return; `meta` again comes from the shared `HTF_STATE_META` map).
- **Internal logic:** `state = computeWBMarketState(ans)` (return `null` if falsy) → `confidence = computeWBConfidence(state, ans)` → `envData = computeWBEnvironment(state, confidence)` → `meta = HTF_STATE_META[state]` → return combined object.
- **Calls:** computeWBMarketState, computeWBConfidence, computeWBEnvironment
- **Called by:** getWBBias, renderWBCards, saveWeeklyBias, openWeeklyReview, renderWeekly, deriveDisplayGrade, computeHiddenScores, _buildWeeklyPrompt
- **Side effects:** None (pure).
- **Notes:** Used both while a Weekly Bias entry is being actively filled out (`renderWBCards`, `saveWeeklyBias`) and later when reviewing/grading it (`openWeeklyReview`, `renderWeekly`, `deriveDisplayGrade`, `_buildWeeklyPrompt` for the AI prompt).

---

#### getWBBias(ans)

- **File:** Trade_Journal/index.html (lines 8006-8012)
- **Module:** Weekly Bias (WB) Engine
- **Purpose:** Simplified 3-way Weekly Bias label, mirroring `getBias()` but for the Weekly checklist and taking an explicit `ans` argument (rather than reading `S.answers` implicitly).
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| ans | object | Weekly-Bias checklist answers map |

- **Returns:** `'BULLISH' | 'BEARISH' | 'NEUTRAL' | null`
- **Internal logic:** `result = runWBEngine(ans)`; if falsy return `null`; map `'bullish_continuation'`/`'bullish_reversal'` → `'BULLISH'`; `'bearish_continuation'`/`'bearish_reversal'` → `'BEARISH'`; else `'NEUTRAL'`.
- **Calls:** runWBEngine
- **Called by:** saveWeeklyBias
- **Side effects:** None (pure).
- **Notes:** Called at weekly-bias save time to compute and persist the derived `bias` field on the weekly record.

---

#### renderWBDecisionDashboard(result, ans, compact)

- **File:** Trade_Journal/index.html (lines 8014-8191)
- **Module:** Weekly Bias (WB) Engine / UI Rendering
- **Purpose:** Renders the "Strategic Market Environment Engine" dashboard HTML — a rich, styled summary panel presenting the Weekly Bias engine's output (environment grade, confidence, narrative, trading focus, and a weekly playbook checklist) either as a full detailed panel or a compact variant.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| result | `{state, confidence, envData, meta} \| null` | Output of `runWBEngine` |
| ans | object | Weekly-Bias answers map (accepted but not directly read in the function body shown — reserved/unused parameter as of this version, since all needed data comes via `result`) |
| compact | boolean | If truthy, renders a condensed single-card layout instead of the full 7-section dashboard |

- **Returns:** `string` — an HTML template string to be injected into the DOM by the caller.
- **Internal logic:**
  - If `result` is falsy, returns a placeholder message: "Complete the checklist above to generate the Strategic Market Environment Engine output."
  - Destructures `{state, confidence, envData, meta}` from `result`.
  - Derives display variables: `envIcon`/`envName`/`envColor`/`envBg` from `meta` (falling back to neutral/grey defaults if `meta` is missing); `confLabel` (capitalized confidence or `'Low'`); `confColor` (green/orange/red by tier); `envLabel`/`envQualityClass` from `envData` (falling back to `'C Environment'`/`'c'`).
  - Looks up a static `narratives` map (keyed by `state`) for a 2-3 sentence strategic narrative paragraph, defaulting to the neutral narrative if `state` isn't recognized.
  - Looks up a static `focusMap` (keyed by `state`) giving a `{label, cls, icon}` "trading focus" pill (e.g. `▲ LONG BIAS` / `cls:'long'`), defaulting to neutral.
  - Looks up a static `playbooks` map (keyed by `state`) giving an array of 4 bullet-point playbook action items, defaulting to the neutral playbook.
  - **If `compact` is truthy:** returns a condensed dashboard `<div class="wb-dashboard">` containing: a header bar with title + environment badge; an environment icon/name/confidence-badge row; a focus-pill + environment-quality-pill row; the narrative paragraph; and small playbook pill chips — all inline-styled using the derived colors.
  - **Else (full mode):** returns a larger `<div class="wb-dashboard">` with 7 numbered sections: (1) Market Environment card, (2) Confidence badge + explanation text (from a `confExplanations` map), (3) Environment Quality badge + a longer explanation string chosen by `envData.env` value (`A+`/`A`/`B`/other), (4) Strategic Narrative, (5) Trading Focus pill + explanatory text switched on `focus.cls`, (6) Weekly Playbook — each item rendered with an icon chosen by whether `state` contains `'bullish'`/`'bearish'`/`'reversal'`, (7) an "Alignment Preview" 4-cell grid (Weekly Bias / Confidence / Environment / Direction) plus a footer note that this data feeds "the TTrades Daily Alignment Engine."
- **Calls:** (none — pure string templating; no other app functions invoked)
- **Called by:** renderWBCards, renderWeekly
- **Side effects:** None directly (returns a string; the DOM mutation happens at the call site where the returned HTML is assigned to some container's `innerHTML`).
- **Notes:** Almost entirely presentational — a very large (178-line) function whose "logic" is mostly lookup-table dispatch (`narratives`, `focusMap`, `playbooks`, `confExplanations`) plus template-literal branching for `compact` vs full. The `ans` parameter is accepted but not referenced in the function body — likely a signature retained from an earlier implementation or reserved for future per-answer detail rendering.

---

### Module: TTrades (TT) Bias Engine

> A third, alternate checklist model (`S.ideaModel === 'ttrades'`) with its own
> question set (`tt_*` ids), state space (`bullish_expansion`,
> `bearish_expansion`, `bullish_continuation`, `bearish_continuation`,
> `reversal`, `range`), and rule table `TT_STATE_RULES` (defined earlier in the
> file, not shown in this chunk, but referenced by `computeTTStateAndConfidence`).
> Also relies on `TT_STATE_META`, `TT_STATE_PLANS`, and `TT_FALLBACK_PLAN` (shown
> in this chunk as data, not functions) for its planning text.

#### extractTTValues(ans)

- **File:** Trade_Journal/index.html (lines 8481-8490)
- **Module:** TTrades (TT) Bias Engine
- **Purpose:** Pulls the six TTrades-model checklist answer values out of an answers map.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| ans | object | TTrades checklist answers map |

- **Returns:** `{closure, cisd, delivery, fractal, closeStrength, extLiquidity}` — reads `tt_closure_event`, `tt_cisd`, `tt_delivery_type`, `tt_fractal`, `tt_close_strength`, `tt_ext_liquidity` respectively, each `ans[id] ? ans[id].val : null`.
- **Internal logic:** Field-by-field extraction, same pattern as `extractHTFValues`/`extractWBValues`.
- **Calls:** (none)
- **Called by:** computeTTStateAndConfidence, runTTEngine
- **Side effects:** None (pure).
- **Notes:** Question domain is different from the HTF/WB engines — TTrades concepts are "closure event," "CISD" (Change In State of Delivery), "delivery type," "fractal," "close strength," and "external liquidity target."

---

#### computeTTStateAndConfidence(ans)

- **File:** Trade_Journal/index.html (lines 8492-8499)
- **Module:** TTrades (TT) Bias Engine
- **Purpose:** Classifies both the TTrades market state and its confidence in a single pass by testing the six extracted values against an ordered rule table (`TT_STATE_RULES`), unlike the HTF/WB engines which split state and confidence into two separate functions/rule tables.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| ans | object | TTrades checklist answers map |

- **Returns:** `{state, confidence} | null` — `null` if any of the 6 required fields is missing.
- **Internal logic:**
  - `v = extractTTValues(ans)`; guard: if any of `closure/cisd/delivery/fractal/closeStrength/extLiquidity` is falsy, return `null`.
  - Iterates the module-level `TT_STATE_RULES` array (defined earlier in the file, outside this chunk); for the first rule whose `.test(v)` predicate is truthy, returns `{ state: rule.state, confidence: rule.confidence }` (each rule apparently carries its own fixed confidence rather than a separate lookup table).
  - Falls back to `{ state: 'range', confidence: 'low' }` if no rule matches.
- **Calls:** extractTTValues
- **Called by:** runTTEngine
- **Side effects:** None (pure).
- **Notes:** Structurally simpler than the HTF/WB pair (one function does both jobs) — reflects that `TT_STATE_RULES`' rule objects bundle `{test, state, confidence}` together, whereas `CONFIDENCE_RULES` used by HTF/WB is a separate table keyed by already-known `state`.

---

#### runTTEngine(ans)

- **File:** Trade_Journal/index.html (lines 8546-8554)
- **Module:** TTrades (TT) Bias Engine
- **Purpose:** Top-level TTrades pipeline orchestrator — computes state/confidence, looks up display metadata and a strategic "plan" (list of action bullet points), and returns everything needed to render the TTrades dashboard.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| ans | object | TTrades checklist answers map |

- **Returns:** `{state, confidence, meta, v, plan} | null` — `null` if the checklist is incomplete.
- **Internal logic:**
  - `result = computeTTStateAndConfidence(ans)`; if falsy, return `null`.
  - Destructure `{state, confidence}`.
  - `meta = TT_STATE_META[state]` (display emoji/label/color, table defined earlier in the file).
  - `v = extractTTValues(ans)` — re-extracts the raw values a second time (redundant with the extraction already done inside `computeTTStateAndConfidence`, but done again here so the raw values are available to the caller/renderer alongside the derived state).
  - `plan = TT_STATE_PLANS[state] || TT_FALLBACK_PLAN` — looks up the 4-bullet strategic plan for this state, or a generic fallback plan if the state isn't recognized.
  - Returns `{ state, confidence, meta, v, plan }`.
- **Calls:** computeTTStateAndConfidence, extractTTValues
- **Called by:** getBias, renderBiasCards, renderEntrySection, updateScoreStrip, deriveDisplayGrade, renderOpen, tradeCard, tradeScorePill, computeNoTradeAnalysis
- **Side effects:** None (pure).
- **Notes:** Like `runHTFEngine`, this is invoked both from the live "filling out the checklist" UI and from later trade-grading/analysis code paths operating on a saved trade's stored `checklistAnswers`.

---

### Module: Auth

#### authTab(t)

- **File:** Trade_Journal/index.html (lines 8560-8566)
- **Module:** Auth
- **Purpose:** Switches the login screen between the "Login" and "Sign Up" tabs by toggling CSS classes and form visibility.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| t | string | Tab to activate — `'login'` or `'signup'` |

- **Returns:** `void`
- **Internal logic:**
  - Toggles the `'active'` class on `#atLogin` and `#atSignup` tab-button elements based on whether `t` matches each.
  - Sets `#afLogin` and `#afSignup` form containers' inline `display` style to `''` (visible) if `t` matches, else `'none'`.
  - Resets `#authMsg`'s class back to the bare `'auth-msg'` (clearing any prior error/success styling).
- **Calls:** (none)
- **Called by (per static analysis):** (none detected)
- **Side effects:** DOM mutation — classList on `#atLogin`/`#atSignup`, inline style on `#afLogin`/`#afSignup`, className reset on `#authMsg`.
- **Notes:** Despite no inbound callers being detected by static analysis, this is almost certainly wired up via an inline `onclick="authTab('login')"` / `onclick="authTab('signup')"` attribute on the tab buttons in the HTML (outside this chunk's line range) — a case the instructions specifically flag as something static analysis of `<script>` content alone would miss.

---

#### showAuthMsg(m, t = 'err')

- **File:** Trade_Journal/index.html (lines 8568-8570)
- **Module:** Auth
- **Purpose:** Displays a message (error or success) in the auth screen's message area.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| m | string | Message text to display |
| t | string (default `'err'`) | Message type/style — `'err'` or `'ok'`, appended as a CSS class |

- **Returns:** `void`
- **Internal logic:** Gets `#authMsg`; sets its `textContent` to `m`; sets its `className` to `'auth-msg ' + t`.
- **Calls:** (none)
- **Called by:** doLogin, doSignup, doReset
- **Side effects:** DOM mutation — `#authMsg` text and class.
- **Notes:** The `t` default parameter (`= 'err'`) means most call sites that pass only an error message can omit the second argument.

---

#### doLogin()

- **File:** Trade_Journal/index.html (lines 8572-8581)
- **Module:** Auth
- **Purpose:** Handles the login form submission — validates input, calls Supabase Auth's password sign-in, and on success hands off to `onLoggedIn`.
- **Parameters:** None
- **Returns:** `Promise<void>`
- **Internal logic:**
  - Reads and trims `#authEmail` value and raw `#authPass` value.
  - If either is empty, shows `'Enter email and password.'` via `showAuthMsg` and returns.
  - Shows `#authLoading` (sets `display:block`).
  - Awaits `_sb.auth.signInWithPassword({ email, password })`.
  - Hides `#authLoading`.
  - If `error`, shows the error message via `showAuthMsg` and returns.
  - Otherwise calls `onLoggedIn(data.user)`.
- **Calls:** showAuthMsg, onLoggedIn
- **Called by (per static analysis):** (none detected)
- **Side effects:** DOM reads (`#authEmail`, `#authPass`), DOM mutation (`#authLoading` visibility, and indirectly `#authMsg` via `showAuthMsg`), network call to Supabase Auth (`signInWithPassword`), sets global `_currentUser` indirectly via `onLoggedIn`.
- **Notes:** No detected caller — almost certainly bound via an inline `onclick="doLogin()"` on the login screen's submit button in the HTML portion of the file (outside this chunk), consistent with the same pattern as `authTab`.

---

#### doSignup()

- **File:** Trade_Journal/index.html (lines 8583-8593)
- **Module:** Auth
- **Purpose:** Handles the sign-up form submission — validates input (including a minimum password length), calls Supabase Auth sign-up, and shows a confirmation-email prompt on success.
- **Parameters:** None
- **Returns:** `Promise<void>`
- **Internal logic:**
  - Reads/trims `#authEmailS`, reads raw `#authPassS`.
  - If either empty, shows `'Enter email and password.'` and returns.
  - If password length `< 6`, shows `'Password must be at least 6 characters.'` and returns.
  - Shows `#authLoading`; awaits `_sb.auth.signUp({ email, password })`; hides `#authLoading`.
  - If `error`, shows the error message and returns.
  - Otherwise shows a success message (`'✓ Account created! Check your email to confirm, then sign in.'`, type `'ok'`).
- **Calls:** showAuthMsg
- **Called by (per static analysis):** (none detected — likely wired via inline `onclick="doSignup()"`)
- **Side effects:** DOM reads/mutation as above; network call to Supabase Auth `signUp`.
- **Notes:** Does not log the user in immediately (Supabase email confirmation flow) — no call to `onLoggedIn` here, unlike `doLogin`.

---

#### doReset()

- **File:** Trade_Journal/index.html (lines 8595-8601)
- **Module:** Auth
- **Purpose:** Handles the "forgot password" flow — sends a password-reset email via Supabase Auth.
- **Parameters:** None
- **Returns:** `Promise<void>`
- **Internal logic:**
  - Reads/trims `#authEmail`.
  - If empty, shows `'Enter your email first.'` and returns.
  - Awaits `_sb.auth.resetPasswordForEmail(e)`.
  - If `error`, shows the error message and returns.
  - Otherwise shows `'✓ Reset email sent — check your inbox.'` (type `'ok'`).
- **Calls:** showAuthMsg
- **Called by (per static analysis):** (none detected — likely wired via inline `onclick="doReset()"`)
- **Side effects:** DOM read (`#authEmail`), DOM mutation via `showAuthMsg`, network call to Supabase Auth (`resetPasswordForEmail`).
- **Notes:** Does not show/hide `#authLoading` around this call, unlike `doLogin`/`doSignup` (minor inconsistency; reset likely feels "instant" in the UI regardless).

---

#### doLogout()

- **File:** Trade_Journal/index.html (lines 8603-8617)
- **Module:** Auth
- **Purpose:** Signs the user out — confirms with the user, calls Supabase Auth sign-out, clears in-memory state and this user's localStorage cache entries, and reloads the page to reset the app to a logged-out state.
- **Parameters:** None
- **Returns:** `Promise<void>`
- **Internal logic:**
  - `if (!confirm('Sign out?')) return;` — native browser confirm dialog; aborts if declined.
  - Captures `userId = _currentUser?.id` before clearing it.
  - Awaits `_sb.auth.signOut()`.
  - Sets `_currentUser = null`; clears `S.trades`, `S.weeklies`, `S.notes`, `S.coreRules` to `[]`.
  - If there was a `userId`, builds the same per-user cache key format inline (`'ict_cache_' + s + '_' + userId'`) and removes the `trades`/`weeklies`/`notes`/`lastmod` localStorage entries for that user, wrapped in a `try/catch` that silently ignores errors.
  - Calls `location.reload()` unconditionally at the end.
- **Calls:** (none — only `_sb.auth.signOut`, `confirm`, `location.reload`)
- **Called by (per static analysis):** (none detected — almost certainly wired via inline `onclick="doLogout()"` on a "Sign out" menu item, consistent with the other Auth functions)
- **Side effects:** Supabase Auth sign-out (network call); clears globals `_currentUser`/`S.trades`/`S.weeklies`/`S.notes`/`S.coreRules`; localStorage removal of that user's 4 cache keys; full page reload.
- **Notes:** Because it reloads the page unconditionally, any code after the call to `doLogout()` in a caller would never run in practice.

---

#### onLoggedIn(user)

- **File:** Trade_Journal/index.html (lines 8619-8630)
- **Module:** Auth
- **Purpose:** Central "user is now authenticated" entry point — stores the user, tears down the auth screen, updates topbar UI, requests persistent storage, kicks off the initial data load, and schedules two delayed one-time maintenance tasks.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| user | object (Supabase `User`) | The authenticated Supabase user object (has at least `.id`, `.email`) |

- **Returns:** `void`
- **Internal logic:**
  - Sets global `_currentUser = user`.
  - If `#authScreen` exists, removes it from the DOM entirely.
  - If `#sbUserEmail` exists, sets its text to `user.email`.
  - Sets `.topbar-brand p` element's text to `user.email` (unconditional `querySelector`, not existence-checked — would throw if the element is absent from the DOM at this point; presumably it's always present outside the auth screen).
  - Calls `requestPersistentStorage()` (fire-and-forget, not awaited).
  - Calls `loadAllData()` (fire-and-forget, not awaited) — kicks off the main sync.
  - `setTimeout(checkPriorIncompleteArchive, 3000)` — after 3s, checks for an interrupted prior archive operation (function defined elsewhere).
  - `setTimeout(cleanStaleDisplayUrls, 5000)` — after 5s, runs the one-time `_displayUrl` cleanup pass.
- **Calls:** remove (via `authScreenEl.remove()` — a DOM method call, not the `_ssDB` module's `remove` function; likely a false-positive attribution in the static analysis), requestPersistentStorage, loadAllData
- **Called by:** doLogin (directly); also invoked by the module-level `_sb.auth.getSession().then(...)` and `_sb.auth.onAuthStateChange(...)` listeners registered right after this chunk's functions (lines 8707-8712) for session restoration and cross-tab `SIGNED_IN` events
- **Side effects:** Sets global `_currentUser`; DOM mutation (removes `#authScreen`, updates `#sbUserEmail` and `.topbar-brand p` text); triggers `requestPersistentStorage`, `loadAllData`, and two deferred maintenance calls.
- **Notes:** The `remove` in the JSON `outboundCalls` list refers to `authScreenEl.remove()` (the standard DOM `Element.remove()` method), not `_ssDB`'s module-level `remove(tradeId)` function — another instance of the generic-name collision flagged in the Screenshot Storage module notes above. Also worth noting: this is called both from the explicit `doLogin()` success path and automatically by Supabase's session-restore/`onAuthStateChange` listener, so it can fire without any of the Auth module's other functions running first (e.g. on a page refresh with an existing session).

---

#### cleanStaleDisplayUrls()

- **File:** Trade_Journal/index.html (lines 8634-8705)
- **Module:** Auth / Data Migration Cleanup
- **Purpose:** One-time (idempotent, safe-to-repeat) maintenance routine that scrubs a legacy bug's leftovers from the database: transient `_displayUrl` fields (7-day signed URLs) that were mistakenly persisted into `weeklies` and `trades` rows instead of being regenerated at render time, and normalizes any `dataUrl` fields that ended up holding a full signed URL instead of the raw storage path.
- **Parameters:** None
- **Returns:** `Promise<void>`
- **Internal logic:**
  - Guard: if no `_currentUser`, return.
  - **Weeklies pass:** fetches all of the user's `weeklies` rows (`id, screenshots, updates`). Filters to rows where any screenshot in `screenshots` or in any `updates[].screenshots` has a truthy `_displayUrl`. For each dirty row, strips `_displayUrl` via `_stripSS` from both `screenshots` and each update's `screenshots`, then `update()`s that row back with the cleaned arrays (scoped by `id` + `user_id`). Logs a count of cleaned rows if any.
  - **Trades pass:** fetches all of the user's `trades` rows (`id, screenshots, eod_screenshots, followup_screenshots, review_screenshots, trade_notes`). Defines two local helpers:
    - `_hasDirty(arr)`: true if any element has `_displayUrl` or a `dataUrl` that starts with `'https://'` (i.e. a full signed URL leaked into the path field).
    - `_cleanArr(arr)`: for each element, if `dataUrl` starts with `'https://'`, tries to extract the raw storage path by locating either `/object/sign/screenshots/` or `/object/authenticated/screenshots/` in the URL and taking the substring after it (stripping any `?...` query string); if neither marker is found, leaves `dataUrl` unchanged (to avoid data loss). Also destructures off `_displayUrl` from the element.
  - For each trade, checks `_hasDirty` across `screenshots`, `eod_screenshots`, `followup_screenshots`, `review_screenshots`, and note screenshots (`trade_notes[].screenshots` flattened); if none are dirty, `continue`s (skips the row).
  - Otherwise cleans all four screenshot arrays plus each trade note's screenshots via `_cleanArr`, and `update()`s the row back (scoped by `id` + `user_id`); increments a `fixedCount`.
  - Logs a count of fixed trade rows if any.
  - Entire function wrapped in an outer `try/catch` that logs `console.warn('cleanStaleDisplayUrls error:', e)` on any failure.
- **Calls:** filter (Array.prototype.filter — generic, not a distinct app function), _stripSS
- **Called by:** onLoggedIn (via a 5-second `setTimeout`)
- **Side effects:** Supabase reads: `weeklies` (select `id, screenshots, updates`), `trades` (select `id, screenshots, eod_screenshots, followup_screenshots, review_screenshots, trade_notes`) — both filtered `eq('user_id', _currentUser.id)`. Supabase writes: `weeklies.update(...)` and `trades.update(...)` per dirty row found, each scoped by both `id` and `user_id`.
- **Notes:** Purely a data-hygiene migration — it does not touch `S.*` in-memory state or the UI at all; it only fixes rows in the remote database (any already-loaded in-memory trades/weeklies with stale `_displayUrl` are unaffected until next reload). Designed to be safe to run on every login (only touches rows that are actually dirty) rather than gated by a one-time flag.

---

### Module: Data Layer / Supabase Sync (Trades & Weeklies)

#### setSyncStatus(s)

- **File:** Trade_Journal/index.html (lines 8714-8743)
- **Module:** Data Layer / Supabase Sync (UI)
- **Purpose:** Updates the small "sync status" indicator in the topbar (a dot + label + button, plus a couple of legacy-ID mirrors) to reflect the current sync state: syncing / error / synced.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| s | string | Sync status — `'syncing'`, `'error'`, or `'synced'` |

- **Returns:** `void`
- **Internal logic:**
  - Sets global `S.syncStatus = s`.
  - Looks up (may or may not exist) `#syncChipDot`, `#syncChipLabel`, `#syncBtnTop`, plus legacy-alias elements `#dbDotTopbar`, `#dbLabelTopbar` — all lookups are null-guarded before use.
  - `s === 'syncing'`: sets dot class to `'sync-chip-dot syncing'`, label class/text to `'sync-chip-label syncing'`/`'SYNC'`, button inner HTML to a spinning `⟳` glyph, legacy dot background to amber (`#f59e0b`), legacy label text/color to `'SYNC'`/amber.
  - `s === 'error'`: dot/label classes set to `'error'` variants with text `'ERR'`; sync button reset to plain `⟳` with red border/text color; legacy dot/label set to red (`#ef4444`)/`'ERR'`; additionally, if `#perfSyncStatus` exists, sets its text to `'Sync error'` in red.
  - `s === 'synced'`: dot/label classes set to `'live'` variants with text `'LIVE'`; sync button reset to plain `⟳` with default (empty-string) border/text color; legacy dot/label set to green (`#22c55e`)/`'LIVE'`.
  - No `else` branch — any other value for `s` updates `S.syncStatus` but changes no DOM element.
- **Calls:** (none)
- **Called by:** loadAllData, saveTrade, saveWeekly
- **Side effects:** Global state `S.syncStatus`; DOM mutation on `#syncChipDot`, `#syncChipLabel`, `#syncBtnTop`, `#dbDotTopbar`, `#dbLabelTopbar`, and conditionally `#perfSyncStatus`.
- **Notes:** All element lookups are defensively null-checked, so this function is safe to call even on pages/states where the topbar sync widget isn't present in the DOM. Passing an unrecognized status string (e.g. `'idle'`) is effectively a silent no-op for the UI (only updates the in-memory flag).

---

#### _stripSS(ssArr)

- **File:** Trade_Journal/index.html (lines 8752-8759)
- **Module:** Data Layer / Supabase Sync
- **Purpose:** Strips the transient `_displayUrl` field from an array of screenshot objects before writing them to the database — only the raw Supabase Storage path (`dataUrl`) should ever be persisted, since `_displayUrl` is a temporary 7-day signed URL that must be regenerated at render time (this is precisely the bug that `cleanStaleDisplayUrls` exists to retroactively fix).
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| ssArr | Array\<object\> \| null \| undefined | Array of screenshot metadata objects (each potentially carrying a `_displayUrl`) |

- **Returns:** Same type as input — the original `ssArr` unchanged if falsy/empty; otherwise a new array with `_displayUrl` removed from each element (elements without `_displayUrl` are returned as-is).
- **Internal logic:**
  - Guard: if `!ssArr || !ssArr.length`, return `ssArr` unchanged (covers `null`/`undefined`/`[]`).
  - Otherwise `.map()`s each `ss`: if falsy or no `_displayUrl`, returns it unchanged; else destructures off `_displayUrl` and returns the rest (`{...rest}`, i.e. every other field preserved).
- **Calls:** (none)
- **Called by:** saveLocalCache, cleanStaleDisplayUrls, tradeToDb, weeklyToDb
- **Side effects:** None (pure — returns a new array/objects, does not mutate the input in place).
- **Notes:** This is the app's single choke point for the "never persist `_displayUrl`" rule; both `tradeToDb` and `weeklyToDb` route every screenshot array through it before building the row to upsert.

---

#### tradeToDb(t)

- **File:** Trade_Journal/index.html (lines 8761-8830)
- **Module:** Data Layer / Supabase Sync
- **Purpose:** Converts an in-memory trade object (camelCase JS shape) into the snake_case row shape expected by the Supabase `trades` table, ready for an `upsert`.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| t | object | In-memory trade record (`S.trades[i]` shape) |

- **Returns:** `object` — a `trades` table row.
- **Internal logic:**
  - Builds a `row` object mapping camelCase trade fields to snake_case DB columns: `id`, `user_id` (from global `_currentUser.id`), `status`, `is_intraday` (defaults `false`), `weekly_link_id` (defaults `null`), `date`, `pair`, `session`, `trade_type` (defaults `'BUY'`), `score`, `grade`, `bias_set`, `bias_played`, `bias_match`, `result`, `tp2r` (mapped from `t.tp1r` — note the column-name/field-name mismatch, called out in the source comment "column name kept for DB compat"), `tp15r`, `idea_notes`/`update_notes`/`close_notes`/`followup_notes` (all default `''`), `entry_price`/`close_price`/`sl_price`/`tp_price` (default `null`), `open_time`, `close_time` (default `null`), `tags`/`close_tags` (default `[]`), `is_paper` (coerced boolean), `ai_review` (default `null`), `trade_notes` (default `[]`), `checklist_answers`/`checklist_kills` (default `{}`), `checklist_model` (default `'omar'`), `wb_entry_id` (default `null`), `intra_alignment`/`intra_decision` (default `null`), `intra_kill` (default `false`), `intra_ex_data` (default `{}`), `intra_scores` (default `null`), `review_notes` (default `[]`), `review_screenshots` (stripped via `_stripSS`).
  - **Conditional screenshot inclusion:** only if `t._ssLoaded` is truthy does it set `row.screenshots`, `row.eod_screenshots`, `row.followup_screenshots` (each stripped via `_stripSS`) — i.e. if the trade's screenshots were never lazy-loaded into memory, the upsert omits those columns entirely rather than overwriting them with empty arrays (avoids clobbering existing DB data with an incomplete in-memory trade object).
  - If `row.trade_notes` is non-empty, remaps each note's `screenshots` through `_stripSS` as well.
  - If `t.lotSize != null`, sets `row.lot_size` (otherwise the column is omitted, presumably to avoid overwriting with `null`/`undefined` unintentionally).
  - Appends a block of "signal_*" columns (`signal_id`, `signal_template`, `signal_htf`, `signal_ltf`, `signal_direction`, `signal_fired_at`, `signal_price`, `signal_htf_bias`, `signal_session`) mapped from the corresponding camelCase `t.signal*` fields (part of the EBP external-signal integration), each defaulting to `null` (with `signal_price` specifically checked via `!= null` since `0` is a valid price).
  - Returns `row`.
- **Calls:** _stripSS
- **Called by:** saveTrade
- **Side effects:** None directly (pure transform); reads global `_currentUser.id`.
- **Notes:** The `tp2r: t.tp1r` mapping is a notable "gotcha" — the DB column is literally named `tp2r` but stores what the app calls `tp1r` in memory, explicitly preserved for backward DB compatibility rather than renamed. The conditional screenshot-column inclusion (only when `_ssLoaded`) is the key mechanism that lets the app do "light" trade saves (e.g. updating just notes/status) without needing to have fetched/loaded that trade's screenshots first.

---

#### dbToTrade(r)

- **File:** Trade_Journal/index.html (lines 8832-8890)
- **Module:** Data Layer / Supabase Sync
- **Purpose:** Converts a raw Supabase `trades` row (snake_case) back into the in-memory camelCase trade object shape used throughout the app — the inverse of `tradeToDb`.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| r | object | Raw row from the `trades` table (or a partial row selected via `LIGHT_TRADE_COLS`) |

- **Returns:** `object` — an in-memory trade record.
- **Internal logic:**
  - Maps every snake_case column back to its camelCase field: `id`, `status`, `isIntraday` (`r.is_intraday`), `weeklyLinkId`, `date`, `pair`, `session`, `tradeType`, `score`, `grade`, `biasSet`, `biasPlayed`, `biasMatch`, `result`, `tp1r` (`r.tp2r || 'N/A'` — reversing the earlier column-name compat mapping, defaulting to the string `'N/A'` rather than `null`), `tp15r` (`r.tp15r || 'N/A'`), `ideaNotes`/`updateNotes`/`closeNotes`/`followupNotes` (default `''`), `entryPrice`/`closePrice`/`slPrice`/`tpPrice` (passed through as-is, no default), `lotSize` (`r.lot_size || null`), `openTime`, `closeTime`, `tags`/`closeTags` (default `[]`), `isPaper` (coerced boolean), `aiReview` (default `null`), `screenshots`/`eodScreenshots`/`followupScreenshots` (default `[]` each, from `r.screenshots`/`r.eod_screenshots`/`r.followup_screenshots`), `_ssLoaded` (computed as `r.screenshots !== undefined` — i.e. `true` only if the query actually selected the `screenshots` column, which distinguishes a "light" list-load from a full screenshot-included fetch), `checklistAnswers`/`checklistKills` (default `{}`), `checklistModel` (default `'omar'`), `wbEntryId` (default `null`), `intraAlignment`/`intraDecision` (default `null`), `intraKill` (default `false`), `intraExData` (default `{}`), `intraScores` (default `null`), `reviewNotes`/`reviewScreenshots` (default `[]`), and the full `signal*` block (`signalId`, `signalTemplate`, `signalHtf`, `signalLtf`, `signalDirection`, `signalFiredAt`, `signalPrice` (`!= null` check, preserving `0`), `signalHtfBias`, `signalSession`), each defaulting to `null`.
- **Calls:** (none)
- **Called by (per static analysis):** (none detected)
- **Side effects:** None (pure transform).
- **Notes:** The `_ssLoaded` flag computed here (`r.screenshots !== undefined`) is the linchpin of the app's lazy-screenshot-loading strategy: `loadAllData`'s list query uses `LIGHT_TRADE_COLS` (which excludes `screenshots`), so trades loaded that way get `_ssLoaded = false` and must go through `loadTradeScreenshots` before their screenshots are usable; a full-column fetch (e.g. inside `loadTradeScreenshots` itself, or `cleanStaleDisplayUrls`) would set it `true`. Despite no statically-detected callers, this is unambiguously invoked from `loadAllData` in this same chunk via `(tr.data || []).map(dbToTrade)` — the JSON's caller-graph miss here is likely because `loadAllData`'s `outboundCalls` list (as provided) does not enumerate every call and this is a straightforward gap, not a same-name collision.

---

#### loadTradeScreenshots(id)

- **File:** Trade_Journal/index.html (lines 8892-8924)
- **Module:** Data Layer / Supabase Sync / Screenshot Storage
- **Purpose:** Lazily loads a specific trade's screenshot arrays (main/EOD/follow-up/review + trade notes' screenshots) on demand — first checking the IndexedDB cache, then falling back to a Supabase fetch, and populating the cache after a network fetch. Also triggers signed-URL resolution so the screenshots are immediately displayable.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| id | string \| number | Trade ID to load screenshots for |

- **Returns:** `Promise<object|undefined>` — the (mutated) trade object from `S.trades` with screenshots populated, or `undefined`/the trade object itself if not found (see logic below), or `undefined` implicitly if an error occurs after the return statement isn't reached... (see logic).
- **Internal logic:**
  - Finds `t = S.trades.find(x => idEq(x.id, id))`. If not found, returns `t` (i.e. `undefined`).
  - If `t._ssLoaded` is already `true` (already loaded, e.g. from a full fetch or a prior call), returns `t` immediately — no-op fast path.
  - Checks the IndexedDB cache: `cached = await _ssDB.get(id)`. If present: assigns `t.screenshots`/`t.eodScreenshots`/`t.followupScreenshots` from the cached payload (each defaulting to `[]`), sets `t._ssLoaded = true`, calls `await resolveTradeScreenshots(t)` to regenerate fresh signed URLs from the cached raw storage paths (since signed URLs expire but the paths don't), and returns `t`.
  - If not cached: `try`s a Supabase fetch of `screenshots, eod_screenshots, followup_screenshots, trade_notes, review_screenshots` for that trade id + current user; on error, throws (caught below). On success: assigns the four screenshot-ish fields onto `t` (`screenshots`, `eodScreenshots`, `followupScreenshots`, `reviewScreenshots`), and if `data.trade_notes` is present, also overwrites `t.tradeNotes`. Sets `t._ssLoaded = true`. Calls `resolveTradeScreenshots(t)`. Then writes the freshly-fetched screenshot data back into the IndexedDB cache via `_ssDB.set(id, {screenshots, eodScreenshots, followupScreenshots, cachedAt: <now>})` for next time.
  - Any error in the fetch/cache-write path is caught by an outer `try/catch` logging `console.warn('Screenshot load error', e)` (silently swallowed).
  - Returns `t` at the end regardless of which path was taken (except the early not-found return).
- **Calls:** idEq, get (i.e. `_ssDB.get`), resolveTradeScreenshots, set (i.e. `_ssDB.set`)
- **Called by:** addSsToOpenTrade, toggleTradeScreenshots, saveClosure, saveEditOpen, saveEditClosed, openTradeHistory, shareOpenTrade, shareClosedTrade, triggerDailyAiReview
- **Side effects:** Mutates the matching trade object in `S.trades` in place (`screenshots`, `eodScreenshots`, `followupScreenshots`, `reviewScreenshots`, possibly `tradeNotes`, `_ssLoaded`); Supabase read (`trades` table, single row, 5 columns); IndexedDB read (`_ssDB.get`) and conditionally write (`_ssDB.set`); calls `resolveTradeScreenshots` which (outside this chunk) presumably resolves/refreshes signed URLs, itself likely doing further Supabase Storage or IndexedDB blob-cache calls.
- **Notes:** This is the central lazy-loading gate for trade screenshots — nearly every UI path that needs to actually display or attach to a trade's screenshots (opening its history, editing it, sharing it, running an AI review on it) calls this first. The IndexedDB-first strategy means opening a previously-viewed trade doesn't re-hit Supabase at all, only regenerates signed URLs.

---

#### weeklyToDb(w)

- **File:** Trade_Journal/index.html (lines 8926-8947)
- **Module:** Data Layer / Supabase Sync
- **Purpose:** Converts an in-memory weekly-bias object into the row shape for the Supabase `weeklies` table, ready for `upsert`.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| w | object | In-memory weekly record (`S.weeklies[i]` shape) |

- **Returns:** `object` — a `weeklies` table row.
- **Internal logic:**
  - Builds `row`: `id`, `user_id` (from `_currentUser.id`), `status`, `pair`, `date`, `bias`, `notes` (default `''`), `tags` (default `[]`), `screenshots` (stripped via `_stripSS`, default `[]`), `updates` (each update's `screenshots` also stripped via `_stripSS`), `wb_checklist_answers` (default `{}`), `created_at`, `closed_at` (default `null`).
  - Conditionally sets `row.weekly_review = w.weeklyReview` only if `w.weeklyReview` is truthy (so an absent review doesn't overwrite an existing DB value with `undefined`/omit the field rather than nulling it).
- **Calls:** _stripSS
- **Called by:** saveWeekly
- **Side effects:** None directly (pure transform); reads global `_currentUser.id`.
- **Notes:** Unlike `tradeToDb`'s conditional screenshot inclusion (gated on `_ssLoaded`), weekly screenshots are always included in the upsert here — weeklies apparently don't have the same lazy-loading split as trades within this codebase (there's no `_ssLoaded` equivalent visible for weeklies in this row builder).

---

#### dbToWeekly(r)

- **File:** Trade_Journal/index.html (lines 8949-8965)
- **Module:** Data Layer / Supabase Sync
- **Purpose:** Converts a raw Supabase `weeklies` row back into the in-memory camelCase weekly object — the inverse of `weeklyToDb`.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| r | object | Raw row from the `weeklies` table |

- **Returns:** `object` — an in-memory weekly record: `id`, `status`, `pair`, `date`, `bias`, `notes` (default `''`), `tags` (default `[]`), `screenshots` (default `[]`), `updates` (default `[]`), `wbChecklistAnswers` (`r.wb_checklist_answers || {}`), `createdAt` (`r.created_at`), `closedAt` (`r.closed_at`), `weeklyReview` (`r.weekly_review || null`).
- **Internal logic:** Direct field-by-field remap with sensible defaults, no branching logic.
- **Calls:** (none)
- **Called by (per static analysis):** (none detected)
- **Side effects:** None (pure transform).
- **Notes:** Same situation as `dbToTrade`: no statically-detected caller, but is unambiguously invoked from `loadAllData` in this chunk (`(wr.data || []).map(dbToWeekly)`).

---

#### loadPnlAccounts()

- **File:** Trade_Journal/index.html (lines 8971-8989)
- **Module:** Data Layer / PnL Tracker Integration
- **Purpose:** Reads the user's trading accounts (owned by a companion "PnL Tracker" app sharing the same Supabase project) and the trade→account assignment map, populating `S.pnlAccounts` and `S.tradeAccountMap` for use in the close-trade account-selection dropdown.
- **Parameters:** None
- **Returns:** `Promise<void>`
- **Internal logic:**
  - Guard: if no `_currentUser`, return.
  - `try`: runs two Supabase queries concurrently via `Promise.all`: (1) `accounts` table — `select id,name,account_kind,is_paper,status`, filtered to the current user, ordered by `created_at` ascending; (2) `trade_account_map` table — `select trade_id,account_id`, filtered to the current user.
  - Throws if either query errored.
  - Sets `S.pnlAccounts = accts || []`.
  - Rebuilds `S.tradeAccountMap` from scratch as `{}`, then populates it from the `maps` rows: `S.tradeAccountMap[m.trade_id] = m.account_id` for each row.
  - `catch`: logs `console.warn('PnL accounts load failed (tracker may be unreachable):', e.message)` — explicitly non-fatal, since the Journal is designed to function without the PnL Tracker present/reachable.
- **Calls:** (none — only `_sb`/`Promise.all` calls)
- **Called by:** loadAllData
- **Side effects:** Supabase reads: `accounts` table, `trade_account_map` table (both scoped to `user_id`); mutates globals `S.pnlAccounts`, `S.tradeAccountMap`.
- **Notes:** Called via `loadAllData` as "fire-and-forget" (not awaited there — see `loadAllData`'s internal logic below), so the accounts dropdown may briefly be empty/stale immediately after login until this resolves.

---

#### assignTradeAccount(tradeId, accountId)

- **File:** Trade_Journal/index.html (lines 8991-9008)
- **Module:** Data Layer / PnL Tracker Integration
- **Purpose:** Creates, updates, or removes the association between a trade and one of the user's PnL Tracker accounts, writing to the shared `trade_account_map` table (owned by the tracker app, but written here per the app's documented "confirmed linking design").
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| tradeId | string \| number | The trade being (un)assigned |
| accountId | string \| number \| null \| falsy | The account to link, or a falsy value to unlink |

- **Returns:** `Promise<void>`
- **Internal logic:**
  - Guard: if no `_currentUser`, return.
  - `try`: if `accountId` is falsy — deletes any existing `trade_account_map` row for `(tradeId, user_id)`, then `delete S.tradeAccountMap[tradeId]` (removes the in-memory mapping entry entirely rather than setting it to `null`).
  - Else — upserts `{trade_id, user_id, account_id, assigned_at: <now ISO>}` into `trade_account_map` with `onConflict: 'trade_id'`, then sets `S.tradeAccountMap[tradeId] = accountId`.
  - `catch`: calls `showToast('Account link failed: ' + e.message, 'warn')` — user-visible failure notification (unlike most other data-layer functions in this chunk, which only `console.warn` on failure).
- **Calls:** showToast
- **Called by:** saveClosure, saveEditClosed
- **Side effects:** Supabase write — `trade_account_map` table (delete or upsert, scoped by `trade_id`/`user_id`); mutates global `S.tradeAccountMap`; on failure, shows a toast notification.
- **Notes:** The `onConflict: 'trade_id'` in the upsert implies `trade_id` is (effectively) a unique/primary key in `trade_account_map` — i.e. a trade can only ever be mapped to one account at a time, consistent with deleting the row entirely (rather than nulling `account_id`) when unassigning.

---

#### loadAllData(force)

- **File:** Trade_Journal/index.html (lines 9011-9086)
- **Module:** Data Layer / Supabase Sync
- **Purpose:** The main data-sync entry point — decides whether the local cache is still fresh (comparing the server's `sync_meta.last_modified` against the cached copy) and either short-circuits to rendering from cache, or does a full fetch of trades/weeklies/notes from Supabase, then triggers a whole cascade of UI re-renders and badge updates. Falls back to the local cache and a degraded render if the network call fails.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| force | boolean (optional) | If truthy, skips the "cache is still fresh" short-circuit and always does a full network fetch |

- **Returns:** `Promise<void>`
- **Internal logic:**
  - Guard: if no `_currentUser`, return.
  - `setSyncStatus('syncing')`.
  - Calls `loadPnlAccounts()` without awaiting it (fire-and-forget, runs concurrently with the rest).
  - `try`:
    - Fetches `sync_meta` (`last_modified,last_device,discord_channels`) for the current user via `.maybeSingle()` (tolerates zero rows).
    - Throws on error.
    - `serverLastMod = meta ? meta.last_modified : null`; if truthy, updates global `S.serverLastMod`.
    - If `meta.last_device` present, updates `S.serverLastDevice`.
    - If `meta.discord_channels` is a non-empty array, calls `DC.setChannels(meta.discord_channels)` (hands off Discord-feed channel config to another module, `DC`, outside this chunk).
    - Reads `cachedLastMod = getCachedLastMod()`.
    - **Fast path:** if not `force`, and `serverLastMod` is truthy, and it equals `cachedLastMod`, and `loadLocalCache()` succeeds (returns `true`): sets status `'synced'`, then calls a long sequence of render/update functions — `updateSyncBar()`, `renderDashboard()`, `renderOpen()`, `updateOpenBadge()`, `updateWeeklyBadge()`, `updateIntradayBadge()`, `refreshIntraWeeklyDropdown()`, `loadCoreRules()`, `renderNotes()`, a `showToast('✓ Up to date (cached)')`, schedules `refreshSsCacheInfo` after 800ms, and calls `loadInsightSnapshot()` + `loadCumulativeStats()` — then **returns early**, skipping the network fetch entirely.
    - **Full-fetch path** (cache stale, forced, or no server timestamp yet): runs three Supabase queries concurrently via `Promise.all` — `trades` (columns = `LIGHT_TRADE_COLS`, i.e. screenshots excluded), `weeklies` (`select *`), `notes` (`select *`) — each filtered to the user and ordered (`created_at`/`updated_at` descending). Throws if any errored.
    - Maps results into `S.trades` (via `dbToTrade`), `S.weeklies` (via `dbToWeekly`), `S.notes` (via `dbToNote` — not listed in the JSON's `outboundCalls` for this function, but visibly called in the source).
    - If `serverLastMod` exists, calls `setCachedLastMod(serverLastMod)`; else calls `await touchSyncMeta()` (i.e. if the server had no `sync_meta` row yet, this device creates the initial one).
    - Calls `saveLocalCache()` to persist the freshly-fetched data as the new local cache.
    - Sets status `'synced'`; runs the same render/update cascade as the fast path (`updateSyncBar`, `renderDashboard`, `renderOpen`, badges, `refreshIntraWeeklyDropdown`, `loadCoreRules`, `renderNotes`), shows `'✓ Data synced'` toast, schedules `refreshSsCacheInfo` after 800ms, calls `loadInsightSnapshot()` + `loadCumulativeStats()`.
  - `catch (e)`: sets status `'error'`; shows a toast `'Sync error: ' + e.message`; attempts `loadLocalCache()` as a degraded fallback — if it succeeds, still runs a (shorter) render cascade (`renderDashboard`, `renderOpen`, badges, `refreshIntraWeeklyDropdown`, `renderNotes`) so the app is at least usable offline/on error.
- **Calls:** setSyncStatus, loadPnlAccounts, setChannels (i.e. `DC.setChannels`), getCachedLastMod, loadLocalCache, updateSyncBar, renderDashboard, renderOpen, updateOpenBadge, updateWeeklyBadge, updateIntradayBadge, refreshIntraWeeklyDropdown, renderNotes, showToast, loadInsightSnapshot, loadCumulativeStats, setCachedLastMod, touchSyncMeta, saveLocalCache
- **Called by:** onLoggedIn, manualSync, settingsForceSync
- **Side effects:** Global state: `S.serverLastMod`, `S.serverLastDevice`, `S.trades`, `S.weeklies`, `S.notes`, plus everything mutated transitively by the many render/update functions it calls and by `loadPnlAccounts`. Supabase reads: `sync_meta` (single row), `trades`, `weeklies`, `notes` (bulk, on the full-fetch path). localStorage: read via `getCachedLastMod`/`loadLocalCache`, written via `setCachedLastMod`/`saveLocalCache`. Numerous DOM mutations via the called render functions (not detailed here — out of this chunk's scope).
- **Notes:** The core "smart sync" mechanism of the whole app: comparing a single `sync_meta.last_modified` timestamp against a cached copy lets every device avoid re-downloading all trades/weeklies/notes unless something has actually changed anywhere (on any device). `force=true` (used by `manualSync`/`settingsForceSync`) is the user-facing "pull to refresh" escape hatch that bypasses this optimization. Note `loadPnlAccounts()` is deliberately not awaited, so its failure/slowness is fully decoupled from the rest of this function's success/failure path. Also note the source calls `dbToNote` (line 9056) which is missing from this function's `outboundCalls` in the JSON inventory — flagged here as an addition based on reading the actual code.

---

#### saveTrade(t)

- **File:** Trade_Journal/index.html (lines 9088-9108)
- **Module:** Data Layer / Supabase Sync / Trade CRUD
- **Purpose:** Persists a trade (new or updated) to Supabase, and on success keeps the IndexedDB screenshot cache, `sync_meta` timestamp, and local cache all in sync; also triggers insight-snapshot/cumulative-stats recomputation whenever a trade is closed.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| t | object | In-memory trade record to save |

- **Returns:** `Promise<boolean>` — `true` on success, `false` if not logged in or the upsert failed.
- **Internal logic:**
  - Guard: if no `_currentUser`, return `false`.
  - `setSyncStatus('syncing')`.
  - Upserts `tradeToDb(t)` into the `trades` table (`onConflict: 'id'`).
  - If `error`: sets status `'error'`, shows a toast with the error message, returns `false`.
  - If `t.status === 'closed'`: fires (without awaiting) `saveInsightSnapshot()` and `saveCumulativeStats()` — recomputes/persists aggregate stats whenever a trade transitions to/is saved as closed.
  - If `t._ssLoaded` is truthy: awaits `_ssDB.set(t.id, {screenshots, eodScreenshots, followupScreenshots, cachedAt: <now>})` to keep the IndexedDB cache aligned with what was just saved (using `|| []` fallback for each array).
  - Awaits `touchSyncMeta()`.
  - Calls `saveLocalCache()`.
  - Sets status `'synced'`.
  - Returns `true`.
- **Calls:** setSyncStatus, tradeToDb, showToast, saveInsightSnapshot, saveCumulativeStats, set (i.e. `_ssDB.set`), touchSyncMeta, saveLocalCache
- **Called by:** _syncCloseTags, saveIntradayIdea, saveIdeaAsOpen, saveChecklistUpdate, patchOpen, addSsToOpenTrade, saveClosure, saveEditOpen, saveEditClosed, thSaveNote, linkAndPullIntra, pullPricesFromIntra, saveTradeNote, triggerDailyAiReview
- **Side effects:** Supabase write — `trades` table upsert; conditionally fires `saveInsightSnapshot`/`saveCumulativeStats` (their own Supabase writes, outside this chunk); IndexedDB write (`_ssDB.set`) when screenshots are loaded; Supabase write — `sync_meta` (via `touchSyncMeta`); localStorage write (via `saveLocalCache`); global `S.syncStatus` mutation (via `setSyncStatus`); on failure, a toast notification.
- **Notes:** This is the single most-called save function in the app (19 call sites file-wide per the inventory) — essentially every trade-mutating flow (idea creation, checklist updates, opening, closing, editing, adding notes, linking intraday trades, AI review) funnels through this one function. The `saveInsightSnapshot`/`saveCumulativeStats` calls on close are explicitly not awaited ("fire and forget" per the inline comment), so `saveTrade`'s own returned promise resolves before those complete.

---

#### deleteTradeSupa(id)

- **File:** Trade_Journal/index.html (lines 9110-9153)
- **Module:** Data Layer / Supabase Sync / Trade CRUD
- **Purpose:** Fully deletes a trade (and, if it's a non-intraday/weekly-style trade, any intraday trades linked to it) from Supabase — including removing their screenshot files from Supabase Storage and evicting them from the IndexedDB cache — then updates sync metadata and the local cache.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| id | string \| number | ID of the trade to delete |

- **Returns:** `Promise<void>`
- **Internal logic:**
  - Guard: if no `_currentUser`, return.
  - Finds `tradeToDelete` in `S.trades` by `idEq`.
  - If found and it is **not** itself an intraday trade, computes `linkedIntraIds` = the IDs of every intraday trade in `S.trades` whose `weeklyLinkId` `idEq`s this trade's `id` (i.e. cascades deletion to child intraday trades of a weekly/parent trade). If the trade wasn't found or is itself intraday, `linkedIntraIds` is `[]`.
  - Builds `allIdsToDelete = [id, ...linkedIntraIds]`.
  - **For each** id in `allIdsToDelete`: fetches that row's full screenshot-bearing columns (`screenshots, eod_screenshots, followup_screenshots, review_screenshots, trade_notes`) directly from Supabase (not from in-memory state, to guarantee completeness even if the in-memory trade hadn't loaded its screenshots yet); if data returned, flattens all screenshot URLs from all four arrays plus every trade note's screenshots into one list, filters out falsy `dataUrl`s, and calls `deleteScreenshotsFromStorage(allUrls)` to remove them from Supabase Storage. Wrapped per-iteration in its own `try/catch` logging a warning on failure (so one trade's screenshot cleanup failing doesn't stop the others or abort the whole delete).
  - **Deletes the DB row(s):** if only one id, does a single `.delete().eq('id', id)`; if multiple (cascaded intraday trades included), does one `.delete().in('id', allIdsToDelete)` — both scoped additionally by `user_id`.
  - **For each** id in `allIdsToDelete`: attempts `_ssDB.remove(tid)` to evict the IndexedDB screenshot cache entry, each wrapped in its own `try/catch` that silently ignores failures (comment: "safe to ignore").
  - Awaits `touchSyncMeta()`.
  - Calls `saveLocalCache()`.
- **Calls:** idEq, filter (Array.prototype.filter), deleteScreenshotsFromStorage, remove (i.e. `_ssDB.remove`), touchSyncMeta, saveLocalCache
- **Called by:** deleteOpenTrade, deleteTrade
- **Side effects:** Supabase reads (per-id, 5 screenshot-bearing columns from `trades`); Supabase Storage deletes (via `deleteScreenshotsFromStorage`, for every screenshot URL collected); Supabase write — `trades` table row delete (single or batch `.in()`); IndexedDB delete (`_ssDB.remove`, per id); Supabase write — `sync_meta` (via `touchSyncMeta`); localStorage write (via `saveLocalCache`).
- **Notes:** Does **not** remove the deleted trade(s) from the in-memory `S.trades` array itself within this function — that responsibility apparently belongs to the caller (`deleteOpenTrade`/`deleteTrade`, outside this chunk). The cascade-delete-linked-intraday-trades behavior means deleting a parent "weekly-style" trade silently also deletes all of its child intraday executions and their screenshots — a destructive side effect worth flagging to anyone reusing this logic. Screenshot cleanup and cache eviction are both deliberately best-effort/non-blocking (wrapped per-item in try/catch) so partial failures don't prevent the core DB row deletion from completing.

---

#### saveWeekly(w)

- **File:** Trade_Journal/index.html (lines 9155-9166)
- **Module:** Data Layer / Supabase Sync / Bias CRUD
- **Purpose:** Persists a Weekly Bias record (new or updated) to Supabase, then updates sync metadata and the local cache — the Weekly-Bias analog of `saveTrade`.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| w | object | In-memory weekly-bias record to save |

- **Returns:** `Promise<boolean>` — `true` on success, `false` if not logged in or the upsert failed.
- **Internal logic:**
  - Guard: if no `_currentUser`, return `false`.
  - `setSyncStatus('syncing')`.
  - `row = weeklyToDb(w)`.
  - Upserts `row` into the `weeklies` table (`onConflict: 'id'`).
  - If `error`: sets status `'error'`, shows a toast with the error message, returns `false`.
  - Awaits `touchSyncMeta()`.
  - Calls `saveLocalCache()`.
  - Sets status `'synced'`.
  - Returns `true`.
- **Calls:** setSyncStatus, weeklyToDb, showToast, touchSyncMeta, saveLocalCache
- **Called by:** saveWeeklyBias, saveWeeklyReview, reopenWeeklyBias, deleteWbScreenshot, saveWbNote, triggerWeeklyAiReview
- **Side effects:** Supabase write — `weeklies` table upsert; Supabase write — `sync_meta` (via `touchSyncMeta`); localStorage write (via `saveLocalCache`); global `S.syncStatus` mutation; on failure, a toast notification.
- **Notes:** Structurally identical to `saveTrade` minus the screenshot-cache and insight-snapshot side effects (weeklies don't have an IndexedDB screenshot cache entry of their own in this codebase, nor do they trigger cumulative-stats recomputation).

---

#### deleteWeeklySupa(id)

- **File:** Trade_Journal/index.html (lines 9168-9187)
- **Module:** Data Layer / Supabase Sync / Bias CRUD
- **Purpose:** Fully deletes a Weekly Bias record from Supabase, including removing its (and its updates') screenshot files from Supabase Storage, then updates sync metadata and the local cache — the Weekly-Bias analog of `deleteTradeSupa`.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| id | string \| number | ID of the weekly-bias record to delete |

- **Returns:** `Promise<void>`
- **Internal logic:**
  - Guard: if no `_currentUser`, return.
  - `try`: fetches the row's `screenshots, updates` columns directly from Supabase (not from in-memory state, for the same completeness guarantee as `deleteTradeSupa`); if data returned, flattens `screenshots` plus every update's `screenshots` into one list of URLs, filters out falsy `dataUrl`s, and calls `deleteScreenshotsFromStorage(allUrls)`.
  - `catch`: logs `console.warn('Screenshot pre-fetch for weekly delete failed:', e)` (non-fatal — proceeds to delete the row regardless).
  - Deletes the `weeklies` row scoped by `id` + `user_id` (unconditionally, outside the try block — so it runs even if the screenshot pre-fetch/cleanup above failed).
  - Awaits `touchSyncMeta()`.
  - Calls `saveLocalCache()`.
- **Calls:** filter (Array.prototype.filter), deleteScreenshotsFromStorage, touchSyncMeta, saveLocalCache
- **Called by:** deleteWeeklyBias
- **Side effects:** Supabase read (`weeklies.screenshots, updates` for the given id); Supabase Storage deletes (via `deleteScreenshotsFromStorage`); Supabase write — `weeklies` table row delete; Supabase write — `sync_meta` (via `touchSyncMeta`); localStorage write (via `saveLocalCache`).
- **Notes:** Unlike `deleteTradeSupa`, there is no IndexedDB cache eviction step here (weeklies don't have a `_ssDB` screenshot-cache entry keyed by weekly id in this codebase) and no cascade-delete of related records — a weekly's row is deleted standalone. The row delete happening outside/after the `try/catch` (rather than being contingent on successful screenshot cleanup) means the DB record is removed even if orphaned files are left behind in Storage on a pre-fetch failure.

---

*End of chunk 0 — 59 functions documented.*


---

## Trade_Journal — Functions (chunk 1 of 8, lines 9197-10769)

### Module: Insight Snapshots (Supabase Aggregate Cache)

#### loadInsightSnapshot()

- **File:** Trade_Journal/index.html (lines 9197-9205)
- **Module:** Insight Snapshots
- **Purpose:** Loads the persisted "insight snapshot" (a rollup of historical analytics aggregates) from Supabase into memory so the Deeper Insights page can merge it with live trade data.
- **Parameters:** None
- **Returns:** `Promise<void>` — mutates `S.insightSnapshot` as a side effect; nothing returned.
- **Internal logic:**
  - Guard: if no `_currentUser`, returns immediately (no-op for logged-out state).
  - Queries `insight_snapshots` table for the single row matching `user_id`, selecting only the `snapshots` column, via `.maybeSingle()` (tolerates zero rows).
  - On Supabase error, logs a warning and returns without throwing.
  - On success, sets `S.insightSnapshot` to `data.snapshots` if present, else to an empty object `{}`.
  - Wraps the whole body in try/catch to swallow unexpected exceptions (network failure, etc.), logging a warning.
- **Calls:** (none)
- **Called by:** loadAllData
- **Side effects:** Supabase read (`insight_snapshots` table, `select`); mutates global state `S.insightSnapshot`.
- **Notes:** Silent-failure design — never surfaces errors to the user via toast, only console.warn. This is intentional since insight snapshots are a "nice to have" cache, not critical path data.

#### saveInsightSnapshot()

- **File:** Trade_Journal/index.html (lines 9207-9217)
- **Module:** Insight Snapshots
- **Purpose:** Computes a fresh aggregate snapshot of the user's current trade/weekly data and upserts it to Supabase, refreshing the in-memory cache used to merge with historical (pre-archive) stats.
- **Parameters:** None
- **Returns:** `Promise<void>`.
- **Internal logic:**
  - Guard: no-op if `!_currentUser`.
  - Calls `computeSnapshotAggregates()` to build the `snap` object from current `S.trades`/`S.weeklies`.
  - Upserts a row into `insight_snapshots` with `user_id`, `snapshots: snap`, and `updated_at` timestamp, using `onConflict: 'user_id'` (one row per user).
  - On success, updates `S.insightSnapshot = snap` so subsequent renders reflect the just-saved data immediately without a re-fetch.
  - try/catch swallows errors with a console warning only.
- **Calls:** computeSnapshotAggregates
- **Called by:** saveTrade, finaliseArchive
- **Side effects:** Supabase write (`insight_snapshots` upsert); mutates `S.insightSnapshot`.
- **Notes:** Called after every trade save and after archival finalisation — keeps the historical snapshot continuously up to date so the merge logic (`getMergedInsightData`) always has fresh baseline numbers.

#### computeSnapshotAggregates()

- **File:** Trade_Journal/index.html (lines 9222-9465)
- **Module:** Insight Snapshots
- **Purpose:** The core aggregation engine — scans all of `S.trades` and `S.weeklies` and produces a large raw-aggregate object (counts and sum-of-R, not pre-averaged) covering every analytics section of the Deeper Insights page, so it can be safely merged with live data later without double-counting or losing precision from averaging averages.
- **Parameters:** None
- **Returns:** `Object` (`snap`) with many sub-keys: `opportunityQuality`, `alignment`, `context`, `setup`, `execution`, `components`, `modelPerf`, `captureRate`, `violations`, `noTrade`, `leaks`, `monthly`, `processAverages`, `gradePerformance`, `additionalInsights`, `lastComputedAt`.
- **Internal logic:**
  - Defines a local helper `buildAggArray(groups)` (documented separately below) used repeatedly to turn `{meta, trades}` groups into aggregate records.
  - **Section 1 (opportunityQuality):** filters closed intraday trades with `intraScores`, groups by grade (`A+`,`A`,`B`,`Invalid`).
  - **Section 2 (alignment):** groups closed intraday trades by `intraAlignment` (`Strong`,`Moderate`,`Conflict`).
  - **Section 3–5 (context/setup/execution):** groups intra-scored trades into four score bands (90-100, 80-89, 70-79, below 70) by `contextScore`, `setupScore`, `executionScore` respectively.
  - **Section 6 (components):** for each of `lq`,`disp`,`mss`,`ret` intraday checklist components, counts trades where `intraExData[c] === true`, tallies wins/losses/sumR.
  - **Section 7 (modelPerf):** for swing (non-intraday) closed trades, splits by `checklistModel` (`omar` vs `ttrades`), counting how many have `biasMatch === 'YES'` and summing R; also computes weekly-bias accuracy count/correct from `S.weeklies` closed entries with `weeklyReview.biasAccuracy.result === 'Correct'`.
  - **Section 8 (captureRate):** among A+-graded intraday trades, counts how many were actually taken (`result !== 'SKIP'`) vs available, and sums R of taken trades.
  - **Section 9 (violations):** for a fixed list of rule-violation types, counts intraday closed trades whose `checklistKills` map has that type truthy, and sums R.
  - **Section 10 (noTrade):** for swing closed trades, tallies `SKIP` and `LOSS` counts broken down by pair.
  - **Section 11 (leaks):** swing performance broken down by session and by pair (count/wins/sumR); intraday score sums (context/setup/exec) and count.
  - **Section 12 (monthly):** builds a `YYYY-MM`-keyed object for every month that has swing or intraday closed trades, each containing swing/intra counts, wins, sumR, plus nested breakdowns by alignment, component, grade, session, and pair — all scoped to that month.
  - **processAverages:** overall sums of context/setup/exec scores and count (used to compute long-run averages elsewhere).
  - **gradePerformance:** swing trades with a `grade` field, bucketed into A+/A/B/Invalid (Invalid catches `C`, `No Trade`, or `Invalid`).
  - **additionalInsights:** swing and intraday breakdowns by session and pair (count/wins/sumR).
  - Sets `snap.lastComputedAt` to current ISO timestamp and returns `snap`.
- **Calls:** buildAggArray (local), Array.prototype.filter, calcR
- **Called by:** saveInsightSnapshot
- **Side effects:** None beyond returning a data structure (pure computation over `S.trades`/`S.weeklies`).
- **Notes:** Deliberately stores raw sums (`sumR`, `wins`, `losses`, `count`) rather than derived averages/win-rates, per the comment at line 9219-9221, specifically so `mergeAggArrays` can combine live and historical data correctly (averaging pre-averaged numbers would be mathematically wrong when group sizes differ).

#### buildAggArray(groups)

- **File:** Trade_Journal/index.html (lines 9226-9238) — nested inside `computeSnapshotAggregates`
- **Module:** Insight Snapshots
- **Purpose:** Converts an array of `{meta, trades}` groupings into aggregate summary records (count, wins, losses, sumR, sumWinR, sumLossR) merged with each group's `meta` fields.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| groups | Array<{meta: Object, trades: Array}> | Each entry pairs a metadata object (e.g. `{grade:'A+'}`) with the subset of trades belonging to that bucket |

- **Returns:** `Array<Object>` — one aggregate record per input group, shaped `{...meta, count, wins, losses, sumR, sumWinR, sumLossR}`.
- **Internal logic:**
  - For each group: counts trades with `result === 'WIN'` and `result === 'LOSS'`.
  - Computes `rVals` = R-multiple of every trade via `calcR`, filtering out nulls, then sums to `sumR`.
  - Separately computes `sumWinR` (sum of R for winning trades only) and `sumLossR` (sum of R for losing trades only).
  - Spreads `g.meta` into the result alongside `count`/`wins`/`losses`/`sumR`/`sumWinR`/`sumLossR`.
- **Calls:** Array.prototype.filter, calcR
- **Called by:** computeSnapshotAggregates (called 7 times within it, once per analytics section that uses grouped aggregation)
- **Side effects:** None (pure function).
- **Notes:** Closure defined fresh on every `computeSnapshotAggregates()` call; not reachable from outside that function's scope.

#### mergeAggArrays(live, hist, keyField)

- **File:** Trade_Journal/index.html (lines 9471-9497)
- **Module:** Insight Snapshots
- **Purpose:** Merges a "live" (current in-memory) aggregate array with a "historical" (previously saved snapshot) aggregate array by matching on a key field, summing counts/R sums and recomputing derived stats (avgR, win rate, expectancy) from the combined raw totals.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| live | Array<Object> | Current aggregate records (from computeSnapshotAggregates on today's data) |
| hist | Array<Object> | Previously saved aggregate records from `S.insightSnapshot` |
| keyField | string | Property name used to match corresponding live/hist entries (e.g. `'grade'`, `'alignment'`, `'range'`) |

- **Returns:** `Array<Object>` — merged aggregate array with recomputed `count`, `wins`, `losses`, `sumR`, `sumWinR`, `sumLossR`, `avgR`, `wr`, `expectancy` per entry.
- **Internal logic:**
  - If `hist` is empty/undefined, returns `live` unchanged; if `live` is empty/undefined, returns `hist` unchanged.
  - For each `liveItem`, finds the matching `histItem` by `keyField`; if none found, keeps `liveItem` as-is.
  - Otherwise sums `count`, `wins`, `losses`, `sumR`, `sumWinR`, `sumLossR` from both.
  - Recomputes `avgR = sumR/count`, win rate `wr = wins/count*100`, `avgWin = sumWinR/wins`, `avgLoss = sumLossR/losses`, and `expectancy = winPct*avgWin + lossPct*avgLoss` (all guarded against divide-by-zero via `count > 0 ? … : 0` style checks).
  - After processing all live items, appends any historical entries whose `keyField` value wasn't present in the live array at all (i.e., a category that existed historically but has no live trades yet).
- **Calls:** (none — pure arithmetic/array logic; Array.prototype.map/find/forEach used but not separately tracked)
- **Called by:** getMergedInsightData
- **Side effects:** None (pure function).
- **Notes:** This is the mathematical core that makes archiving safe — because raw sums are stored rather than averages, combining periods never loses precision or introduces averaging bias.

#### getMergedInsightData(sectionKey, liveData)

- **File:** Trade_Journal/index.html (lines 9501-9517)
- **Module:** Insight Snapshots
- **Purpose:** Public-facing accessor used by the various "render*" analytics functions to fetch a section's data merged with historical snapshot data (falling back to live-only data when no snapshot exists).
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| sectionKey | string | Which snapshot section to merge (e.g. `'opportunityQuality'`, `'alignment'`, `'context'`, `'setup'`, `'execution'`, `'gradePerformance'`) |
| liveData | Array<Object> | The current live-computed aggregate array for that section |

- **Returns:** `Array<Object>` — either `liveData` unchanged (no snapshot / non-array section) or the result of `mergeAggArrays`.
- **Internal logic:**
  - Reads `S.insightSnapshot`; if missing or the given `sectionKey` isn't present in it, returns `liveData` as-is.
  - Maintains a lookup map `keyFields` associating each array-type section name with its merge key field (`grade`, `alignment`, `range`, etc.).
  - If `sectionKey` is in that map, delegates to `mergeAggArrays(liveData, hist, keyFields[sectionKey])`.
  - Otherwise (object-shaped sections like `modelPerf`, `leaks`, `monthly`), returns `liveData` unchanged — those sections are merged ad hoc inside their respective render functions instead.
- **Calls:** mergeAggArrays
- **Called by:** renderGradePerformance, renderOpportunityQuality, renderAlignment, renderContext, renderSetup, renderExecution
- **Side effects:** None (pure function, reads global `S.insightSnapshot`).
- **Notes:** Acts as the single entry point that hides the live/historical merge decision from all the render functions — they always just call this and get back "the right data to display."

### Module: Cumulative Stats (Dashboard Totals Across Archive Cycles)

#### _emptyCumulativeStats()

- **File:** Trade_Journal/index.html (lines 9529-9537)
- **Module:** Cumulative Stats
- **Purpose:** Returns a zeroed-out cumulative-stats object used as the default/fallback shape whenever no stats exist yet (first run) or as a computation seed.
- **Parameters:** None
- **Returns:** `Object` with all-zero counters: `totalClosed`, `totalWins`, `totalLosses`, `totalBiasMatch`, `totalBiasTotal`, `sumR`, `wins2r`, `wins15r`, `wins1r`, `be`, `loss05`, `loss1`, `totalR`, plus `archivedThrough: null` and `lastUpdatedAt: null`.
- **Internal logic:** Simple object literal construction; no branching.
- **Calls:** (none)
- **Called by:** loadCumulativeStats, saveCumulativeStats, finaliseArchive
- **Side effects:** None (pure factory function).
- **Notes:** The R-multiple bucket fields (`wins2r`, `wins15r`, `wins1r`, `be`, `loss05`, `loss1`) correspond to specific R-multiple ranges used elsewhere for a distribution chart (see saveCumulativeStats/getDashboardTotals for the exact thresholds).

#### loadCumulativeStats()

- **File:** Trade_Journal/index.html (lines 9539-9547)
- **Module:** Cumulative Stats
- **Purpose:** Loads the persisted cumulative stats baseline from Supabase into `S.cumulativeStats`, used by the dashboard to show combined archived + live totals.
- **Parameters:** None
- **Returns:** `Promise<void>`.
- **Internal logic:**
  - Guard: no-op if `!_currentUser`.
  - Selects the `stats` column from `cumulative_stats` for the current user via `.maybeSingle()`.
  - On error, logs and returns.
  - Sets `S.cumulativeStats` to `data.stats` if present, otherwise to `_emptyCumulativeStats()`.
  - try/catch wraps the whole body, swallowing unexpected errors with a console warning.
- **Calls:** _emptyCumulativeStats
- **Called by:** loadAllData
- **Side effects:** Supabase read (`cumulative_stats` table); mutates `S.cumulativeStats`.
- **Notes:** Mirrors the pattern of `loadInsightSnapshot` — silent failure, no user-facing toast.

#### saveCumulativeStats()

- **File:** Trade_Journal/index.html (lines 9549-9623)
- **Module:** Cumulative Stats
- **Purpose:** Recomputes and persists the cumulative stats row, merging the previously-archived baseline with newly-closed trades that occurred after the last archive cutoff (`archivedThrough`), so the dashboard total never double-counts archived trades.
- **Parameters:** None
- **Returns:** `Promise<void>`.
- **Internal logic:**
  - Guard: no-op if `!_currentUser`.
  - Takes a shallow copy of `S.cumulativeStats` (or an empty stats object) as `base`; reads `base.archivedThrough`.
  - Filters `S.trades` to `closed` trades that are not weekly-linked intraday trades (`t.isIntraday && t.weeklyLinkId` excluded) and that closed strictly after `archivedThrough` (if set) — this is the "incremental" set not yet folded into the archived baseline.
  - Computes wins, losses, bias-match count, bias-total count (`YES`or `NO`), and `sumR` over that incremental set via `calcR`.
  - Computes an R-multiple distribution over trades with result WIN or LOSS: `wins2r` (R ≥ 1.5), `wins15r` (1.0 ≤ R < 1.5), `wins1r` (0 < R < 1.0), `be` (breakeven band, -0.2 < R < 1), `loss05` (-0.5 ≤ R < 0), `loss1` (R < -0.5), and `totalR` (sum of these R values).
  - Builds an `archived` object: if `base.archivedThrough` is truthy, carries forward each `base.*` field (defaulting missing fields to 0); otherwise zeroes everything out (i.e., there is no prior archive yet, so nothing to carry forward).
  - Adds the incremental numbers on top of `archived` to produce the final `stats` object, retaining `archivedThrough` unchanged and stamping `lastUpdatedAt`.
  - Upserts `{user_id, stats, updated_at}` into `cumulative_stats` (`onConflict: 'user_id'`).
  - Updates `S.cumulativeStats = stats` on success.
  - try/catch swallows errors with console warning only (no toast).
- **Calls:** _emptyCumulativeStats, Array.prototype.filter, calcR
- **Called by:** saveTrade
- **Side effects:** Supabase write (`cumulative_stats` upsert); mutates `S.cumulativeStats`.
- **Notes:** Note the R-bucket boundary logic has an overlap quirk: `be` is defined as `-0.2 < R < 1`, which overlaps with `wins1r` (`0 < R < 1`) and `loss05`'s lower portion — these buckets are not mutually exclusive by construction and are likely intended as separate, possibly overlapping display categories (e.g. "near-breakeven" as its own metric alongside win/loss buckets) rather than a strict partition.

#### getDashboardTotals()

- **File:** Trade_Journal/index.html (lines 9627-9694)
- **Module:** Cumulative Stats
- **Purpose:** Computes the numbers shown on the Home dashboard's stat boxes by combining the archived baseline (`S.cumulativeStats`) with live (not-yet-archived) trades, respecting the current paper/live/combined insights-mode filter.
- **Parameters:** None
- **Returns:** `Object` — `{totalClosed, totalWins, totalLosses, totalBiasMatch, totalBiasTotal, sumR, wins2r, wins15r, wins1r, be, loss05, loss1, totalR, openCount}`.
- **Internal logic:**
  - Reads `cs = S.cumulativeStats` and `archivedThrough = cs?.archivedThrough || null`.
  - Reads `S.insightsMode` to determine `combined` (both paper+live) vs `paperOnly` mode filtering.
  - Filters `S.trades` to closed, non-weekly-linked-intraday trades that closed after `archivedThrough` (if any), and that match the paper/live filter: excluded if `paperOnly` and not paper, or if not `combined`/not `paperOnly` and is paper (i.e., default "live only" mode excludes paper trades unless combined or paper-only mode is active).
  - Computes live wins/losses/bias-match/bias-total/sumR and the same R-multiple bucket breakdown as in `saveCumulativeStats` (duplicated logic, same thresholds).
  - If there's no `cs` or no `archivedThrough` yet, returns live-only totals directly, plus `openCount` — the count of currently open trades matching the same paper/live filter (also excluding weekly-linked intraday).
  - Otherwise, builds an `archived` object from `cs.*` fields (defaulting missing to 0) and adds the live incremental numbers on top for every field, again computing `openCount` the same way.
- **Calls:** Array.prototype.filter, calcR
- **Called by:** renderDashboard
- **Side effects:** None (pure read of global state; no mutation).
- **Notes:** Duplicates the R-bucket computation logic from `saveCumulativeStats` almost verbatim (not shared as a helper) — a maintenance risk if the bucket thresholds ever need to change (would need updating in two places). The paper/live filter logic (`(paperOnly && !t.isPaper) || (!combined && !paperOnly && t.isPaper)`) is duplicated across all three filter usages (closed, live, openCount) within this same function.

### Module: Sync Status UI

#### manualSync()

- **File:** Trade_Journal/index.html (line 9696)
- **Module:** Sync Status UI
- **Purpose:** Entry point for a user-triggered manual data refresh (e.g. a "Sync now" button), forcing a full reload from Supabase.
- **Parameters:** None
- **Returns:** `Promise<void>`.
- **Internal logic:** Single statement — awaits `loadAllData(true)`, passing `true` presumably to force a refresh/bypass any "already loaded" short-circuit inside `loadAllData`.
- **Calls:** loadAllData
- **Called by:** (none detected in static analysis — verify: likely wired via an inline `onclick="manualSync()"` attribute on a sync button in the HTML, since it is exported as a plain top-level function and its only purpose is as a UI action target)
- **Side effects:** Triggers the full data-loading side effects of `loadAllData` (many Supabase reads, `S.*` mutations, re-renders).
- **Notes:** No parameters, no error handling of its own — relies entirely on `loadAllData`'s internal try/catch.

#### updateSyncBar()

- **File:** Trade_Journal/index.html (lines 9698-9747)
- **Module:** Sync Status UI
- **Purpose:** Refreshes the sync status popover UI (server last-modified time, which device last pushed, whether this device is up to date) and keeps the sync button styled green.
- **Parameters:** None
- **Returns:** `void`.
- **Internal logic:**
  - Looks up `#spServerTime`, `#spLastDevice`, `#spDeviceStatus` elements; each block is guarded by `if (el)`.
  - **Server time:** if `S.serverLastMod` is set, formats it via `toLocaleDateString`/`toLocaleTimeString` (`en-GB`, e.g. "24 Aug · 14:30"); else shows an em-dash.
  - **Last device:** if `S.serverLastDevice` is unset, shows em-dash; if it equals the local `DEVICE_ID`, shows "This device"; otherwise shows "Other device ·" plus the last 6 characters of the other device's UUID, uppercased, as a short identifier.
  - **Device status:** compares `S.serverLastMod` to `getCachedLastMod()` (the locally cached last-modified marker). If they match and both exist, shows "✓ Up to date" with an `up-to-date` CSS class. Else if `S.syncStatus === 'error'`, shows "✕ Sync error" with an `error` class. Otherwise shows "⚠ Behind server" with a `behind` class.
  - Finally, unconditionally forces the `#syncBtnTop` element's border/text color to green (`#22c55e`), regardless of the actual status computed above (a hard-coded visual choice).
- **Calls:** getCachedLastMod
- **Called by:** loadAllData
- **Side effects:** DOM mutation of `#spServerTime`, `#spLastDevice`, `#spDeviceStatus` (text and class), `#syncBtnTop` (inline style).
- **Notes:** The final line that forces the sync button to always render green regardless of status looks like a leftover/likely-intentional simplification — it means the button's color never reflects an actual error or "behind" state, only the popover text does.

#### _close(e)

- **File:** Trade_Journal/index.html (lines 9759-9764)
- **Module:** Sync Status UI
- **Purpose:** A one-shot outside-click handler that closes the sync popover when the user clicks outside it, then unregisters itself.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| e | MouseEvent | The document-level click event |

- **Returns:** `void`.
- **Internal logic:**
  - Defined as a named function expression inside `window.toggleSyncPopover`'s `setTimeout` callback, closing over `pop` (the popover element).
  - If the click target is outside both the popover (`pop.contains(e.target)`) and the sync chip (`#syncChip`), removes the `open` class from the popover (closing it).
  - Always removes itself as a `click` listener on `document` afterward (`document.removeEventListener('click', _close)`), regardless of whether it closed the popover — a strict one-shot listener.
- **Calls:** Element.classList.remove (native DOM API — not a project function; listed in JSON outboundCalls as `remove`)
- **Called by:** (none detected via static call-site analysis — it is registered as an event listener via `document.addEventListener('click', _close)` inside `window.toggleSyncPopover`, not called directly by name)
- **Side effects:** DOM mutation (removes `.open` class from `#syncPopover`); adds/removes a `document` click event listener.
- **Notes:** Re-registered every time the popover is opened (inside a `setTimeout(..., 10)` in `toggleSyncPopover`), and always tears itself down after the very next document click, whether or not that click was the one that closed the popover — meaning a single stray click anywhere after opening always unregisters the handler, even a click that hits something else inside the popover interaction flow before the popover would otherwise be dismissed by other means.

### Module: Toast Notifications

#### showToast(msg, type = 'ok')

- **File:** Trade_Journal/index.html (lines 9769-9776)
- **Module:** Toast Notifications
- **Purpose:** Displays a short-lived toast notification message at the bottom/corner of the UI, styled according to severity (`ok`, `err`, `warn`).
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| msg | string | The message text to display |
| type | string (default `'ok'`) | Severity/style: `'ok'`, `'err'`, or `'warn'` |

- **Returns:** `void`.
- **Internal logic:**
  - Looks up `#toastMsg`; if missing, returns silently.
  - Sets `textContent` to `msg`.
  - Sets `className` to `'toast-msg show'` plus `' err'` if `type==='err'`, `' warn'` if `type==='warn'`, or nothing for `'ok'`.
  - Clears any previous auto-hide timer stored on the element (`el._t`) via `clearTimeout`.
  - Schedules a new `setTimeout` (3200ms) that removes the `show` class, storing the timer id back on `el._t` so a rapid second call can cancel the first fade-out.
- **Calls:** Element.classList.remove (native — tracked as `remove` in outboundCalls)
- **Called by:** Extremely widely used across the app (49 call sites) — including assignTradeAccount, loadAllData, saveTrade, saveWeekly, saveNoteToDb, deleteNoteFromDb, saveRulesToSupa, saveWeeklyBias, openWeeklyReview, saveWeeklyReview, saveWbNote, saveIntradayIdea, saveIdeaAsOpen, saveChecklistUpdate, addSsToOpenTrade, ebpSaveSettings, saveClosure, saveEditOpen, saveEditClosed, thSaveNote, thAddScreenshots, readImg, saveNote, pullPricesFromIntra, saveTradeNote, shareOpenTrade, shareClosedTrade, clearSsCache, archiveModalCancel, checkPriorIncompleteArchive, runArchive, addChannelRow, saveChannels
- **Side effects:** DOM mutation of `#toastMsg` (text + class); schedules/cancels a `setTimeout` stored on the element itself.
- **Notes:** The single, app-wide feedback mechanism for success/error/warning messages — essentially every CRUD operation in the app funnels user-facing status through this function. Storing the timer handle on the DOM element (`el._t`) is a lightweight way to avoid a module-level variable.

### Module: Notes Data Layer

#### noteToDb(n)

- **File:** Trade_Journal/index.html (lines 9779-9782)
- **Module:** Notes Data Layer
- **Purpose:** Converts an in-memory note object (camelCase fields) into the shape expected by the Supabase `notes` table (snake_case columns).
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| n | Object | In-memory note: `{id, title, body, createdAt, updatedAt}` |

- **Returns:** `Object` — `{id, user_id, title, body, created_at, updated_at}` ready for Supabase upsert.
- **Internal logic:**
  - `id` passed through unchanged.
  - `user_id` taken from `_currentUser.id`.
  - `title`/`body` default to `''` if falsy.
  - `created_at` set to `n.createdAt`.
  - `updated_at` set to `n.updatedAt`, falling back to `n.createdAt` if not set (i.e., a never-edited note has equal created/updated timestamps).
- **Calls:** (none)
- **Called by:** saveNoteToDb
- **Side effects:** None (pure transform). Reads module-level `_currentUser`.
- **Notes:** Assumes `_currentUser` is non-null; would throw if called while logged out (guarded by the caller `saveNoteToDb`, which checks `_currentUser` first).

#### dbToNote(r)

- **File:** Trade_Journal/index.html (lines 9784-9787)
- **Module:** Notes Data Layer
- **Purpose:** Converts a Supabase `notes` row (snake_case) back into the app's in-memory note shape (camelCase).
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| r | Object | Raw Supabase row: `{id, title, body, created_at, updated_at}` |

- **Returns:** `Object` — `{id, title, body, createdAt, updatedAt}`.
- **Internal logic:** Straight field mapping; `title`/`body` default to `''` if falsy; `id`, `createdAt`, `updatedAt` passed straight through from `r.id`/`r.created_at`/`r.updated_at`.
- **Calls:** (none)
- **Called by:** (none detected in static analysis within this chunk/file scan — likely dead code, or used inside a bulk-load/mapping routine elsewhere such as `loadAllData`'s notes fetch that wasn't captured as a named caller by the static analyzer, e.g. via `.map(dbToNote)`)
- **Side effects:** None (pure transform).
- **Notes:** Despite having zero detected callers, this is the natural counterpart to `noteToDb` and is almost certainly used somewhere in the bulk notes-loading code (e.g. `S.notes = data.map(dbToNote)`), possibly outside this chunk's line range or via a call pattern the static analyzer didn't attribute (e.g. passed as a callback reference rather than invoked by name at a traceable call site).

#### saveNoteToDb(n)

- **File:** Trade_Journal/index.html (lines 9789-9797)
- **Module:** Notes Data Layer
- **Purpose:** Persists a single note to Supabase (upsert), then touches the sync metadata and refreshes the local cache so other devices/tabs see the update.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| n | Object | In-memory note object to save |

- **Returns:** `Promise<void>`.
- **Internal logic:**
  - Guard: if `!_currentUser`, shows an error toast ("Not logged in — note saved locally only") and returns without attempting a Supabase call.
  - Converts `n` via `noteToDb(n)` and upserts into the `notes` table with `onConflict: 'id'`.
  - Throws on Supabase error to be caught below.
  - On success, awaits `touchSyncMeta()` (updates the shared sync timestamp so other devices know data changed) and calls `saveLocalCache()` (refreshes the local cache mirror).
  - try/catch logs the error and shows an error toast with the message.
- **Calls:** showToast, noteToDb, touchSyncMeta, saveLocalCache
- **Called by:** saveNote
- **Side effects:** Supabase write (`notes` upsert); localStorage write (via `saveLocalCache`); toast UI feedback; sync metadata update (Supabase `sync_meta` table, via `touchSyncMeta`).
- **Notes:** Unlike `saveInsightSnapshot`/`saveCumulativeStats`, this function surfaces failures to the user via toast rather than silently swallowing them — notes are treated as higher-priority user data.

#### deleteNoteFromDb(id)

- **File:** Trade_Journal/index.html (lines 9799-9807)
- **Module:** Notes Data Layer
- **Purpose:** Deletes a note row from Supabase by id (scoped to the current user), then updates sync metadata and local cache.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| id | string/number | The note's id (UUID or legacy numeric) |

- **Returns:** `Promise<void>`.
- **Internal logic:**
  - Guard: no-op if `!_currentUser`.
  - Deletes from `notes` where `id` equals the given id AND `user_id` equals the current user (double-scoped delete, preventing cross-user deletion even if an id were guessable).
  - Throws on Supabase error.
  - On success, awaits `touchSyncMeta()` and calls `saveLocalCache()`.
  - try/catch logs and shows an error toast on failure.
- **Calls:** touchSyncMeta, saveLocalCache, showToast
- **Called by:** deleteNote
- **Side effects:** Supabase delete (`notes` table); localStorage write; sync metadata update; toast on error.
- **Notes:** The `.eq('user_id', _currentUser.id)` clause is a defense-in-depth measure against deleting another user's note, beyond whatever RLS policy Supabase may also enforce.

### Module: Core Rules

#### _coreRulesKey()

- **File:** Trade_Journal/index.html (lines 9812-9814)
- **Module:** Core Rules
- **Purpose:** Computes the user-scoped localStorage key used to store the "core rules" checklist locally, falling back to a legacy shared key if no user is logged in.
- **Parameters:** None
- **Returns:** `string` — either `` `ict_core_rules_${_currentUser.id}` `` or the legacy constant `STORAGE_KEY` (`'ict_core_rules'`).
- **Internal logic:** Ternary based on truthiness of `_currentUser`.
- **Calls:** (none)
- **Called by:** loadRules, saveRulesData
- **Side effects:** None (pure function reading module-level `_currentUser`).
- **Notes:** The comment at line 9810 clarifies `STORAGE_KEY` is a legacy/shared key retained for migration purposes; new data is always written under the user-scoped key.

#### loadRules()

- **File:** Trade_Journal/index.html (lines 9816-9824)
- **Module:** Core Rules
- **Purpose:** Loads the core-rules array, preferring an in-memory cache, then the user-scoped localStorage key, then falling back to the legacy shared key (for migrating pre-multi-user data).
- **Parameters:** None
- **Returns:** `Array<string>` — list of rule text strings (or `[]` on parse failure).
- **Internal logic:**
  - If `S.coreRules` is already populated (truthy), returns it directly without touching localStorage (in-memory cache short-circuit).
  - Otherwise tries `localStorage.getItem(_coreRulesKey())`; if that key exists (`!== null`), parses and returns it as JSON.
  - If the scoped key doesn't exist, falls back to `JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')`.
  - Wrapped in try/catch; returns `[]` on any JSON parse error.
- **Calls:** _coreRulesKey
- **Called by:** renderCoreRules
- **Side effects:** localStorage read (both the scoped key and the legacy `STORAGE_KEY`).
- **Notes:** Does NOT populate `S.coreRules` itself — that only happens via `saveRulesData`. So the in-memory short-circuit at the top only helps after a save has occurred in the current session; a fresh page load always re-reads localStorage the first time.

#### saveRulesData(arr)

- **File:** Trade_Journal/index.html (lines 9826-9829)
- **Module:** Core Rules
- **Purpose:** Updates the in-memory core-rules cache and persists it to the user-scoped localStorage key.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| arr | Array<string> | The full list of rule strings to store |

- **Returns:** `void`.
- **Internal logic:** Sets `S.coreRules = arr`; writes `JSON.stringify(arr)` to `localStorage` under `_coreRulesKey()`.
- **Calls:** _coreRulesKey
- **Called by:** (none detected via static analysis within this file's call graph — but it is directly invoked from `window.saveCoreRules` (a global function defined at line 9890, just outside the documented chunk boundary/JSON inventory) as part of the "save core rules" UI flow)
- **Side effects:** Mutates global `S.coreRules`; localStorage write (scoped core-rules key).
- **Notes:** The apparent "0 callers" in the static analysis is because its real caller, `window.saveCoreRules`, is a `window.*`-assigned function likely excluded from (or named differently in) the inventory's call-graph extraction — this is a case worth flagging per the task instructions as an additional caller found by inspection.

#### saveRulesToSupa(arr)

- **File:** Trade_Journal/index.html (lines 9831-9839)
- **Module:** Core Rules
- **Purpose:** Persists the core-rules array to Supabase (`core_rules` table) so it syncs across devices, then touches sync metadata.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| arr | Array<string> | The full list of rule strings to sync |

- **Returns:** `Promise<void>`.
- **Internal logic:**
  - Guard: no-op if `!_currentUser`.
  - Upserts `{user_id, rules: arr}` into `core_rules` with `onConflict: 'user_id'`.
  - Throws on error; on success awaits `touchSyncMeta()`.
  - try/catch logs and shows an error toast (`'Core rules sync error: ' + e.message`) on failure.
- **Calls:** touchSyncMeta, showToast
- **Called by:** (none detected via static analysis — but directly invoked from `window.saveCoreRules`, same as `saveRulesData` above, just outside the inventoried chunk)
- **Side effects:** Supabase write (`core_rules` upsert); sync metadata update; toast on error.
- **Notes:** Same "hidden caller via window.* function" situation as `saveRulesData` — both are called together from `window.saveCoreRules`.

#### renderCoreRules()

- **File:** Trade_Journal/index.html (lines 9852-9870)
- **Module:** Core Rules
- **Purpose:** Renders the core-rules list into the sidebar/panel UI as a numbered `<ol>` list, or shows an empty-state message if there are no rules.
- **Parameters:** None
- **Returns:** `void`.
- **Internal logic:**
  - Loads rules via `loadRules()`.
  - Looks up `#coreRulesOl`, `#coreRulesEmpty`, `#coreRulesCount`; returns early if the list container is missing.
  - If `rules.length === 0`: clears the `<ol>`, shows the empty-state element, clears the count label.
  - Otherwise: hides the empty-state, sets the count label text to `"N RULE(S)"` (pluralizing "RULE" when count ≠ 1), and rebuilds the `<ol>` innerHTML by mapping each rule to an `<li>` containing a numbered badge span and the rule text — the rule text is HTML-escaped (`&`, `<`, `>` replaced with entities) to prevent injection since rules are free-typed user text.
- **Calls:** loadRules
- **Called by:** (none detected via static analysis in-file — but is called from `window.loadCoreRules` right after a Supabase load, and from `window.saveCoreRules` after a save, both defined just outside this chunk's line range)
- **Side effects:** DOM mutation of `#coreRulesOl` (innerHTML), `#coreRulesEmpty` (display style), `#coreRulesCount` (text).
- **Notes:** The task brief calls out that inline `onclick` attributes can hide callers from static analysis; here the missed callers are actually other `window.*`-scoped functions (`loadCoreRules`, `saveCoreRules`) rather than inline HTML attributes — worth flagging as the analyzer's call-graph likely only tracked plain top-level `function` declarations, not `window.foo = function(){}` assignments, as call sites.

### Module: Sidebar / Navigation

#### toggleSidebar()

- **File:** Trade_Journal/index.html (lines 9904-9909)
- **Module:** Sidebar / Navigation
- **Purpose:** Toggles the mobile/collapsible sidebar open or closed, syncing the overlay backdrop's visibility with it.
- **Parameters:** None
- **Returns:** `void`.
- **Internal logic:** Toggles the `open` class on `#sidebar` via `classList.toggle('open')` (capturing the resulting boolean), then explicitly sets the `#sidebarOverlay` element's `open` class to match that same boolean via `classList.toggle('open', open)`.
- **Calls:** (none tracked — uses native `classList.toggle`)
- **Called by:** (none detected via static analysis — verify: almost certainly wired to a hamburger-menu button via inline `onclick="toggleSidebar()"` in the HTML, since it is a plain UI toggle with no other logical trigger)
- **Side effects:** DOM mutation — toggles CSS classes on `#sidebar` and `#sidebarOverlay`.
- **Notes:** None beyond likely inline-onclick invocation.

#### closeSidebar()

- **File:** Trade_Journal/index.html (lines 9911-9914)
- **Module:** Sidebar / Navigation
- **Purpose:** Forcibly closes the sidebar and its overlay (as opposed to `toggleSidebar`'s toggle behavior) — used when navigating away.
- **Parameters:** None
- **Returns:** `void`.
- **Internal logic:** Removes the `open` class from both `#sidebar` and `#sidebarOverlay` unconditionally.
- **Calls:** Element.classList.remove (native — tracked as `remove`)
- **Called by:** navTo
- **Side effects:** DOM mutation — removes CSS classes on `#sidebar`/`#sidebarOverlay`.
- **Notes:** Also likely bound to the overlay's own click handler (clicking the dark backdrop to dismiss the sidebar) via inline HTML, in addition to its detected caller `navTo`.

#### navTo(page)

- **File:** Trade_Journal/index.html (lines 9916-10027)
- **Module:** Sidebar / Navigation
- **Purpose:** The app's central page router — switches the visible "page" section, updates the browser history, and triggers each page's specific render/initialization logic. This is the single hub through which all in-app navigation flows.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| page | string | Target page key, e.g. `'home'`, `'settings'`, `'pnl'`, `'insights'`, `'idea'`, `'weekly'`, `'open'`, `'intraday'`, `'notes'`, `'news'`, `'closed'` |

- **Returns:** `void`.
- **Internal logic:**
  - Calls `closeSidebar()` first (always close the mobile nav on navigation).
  - If leaving the `'idea'` page while in checklist "edit" mode (`S.checklistMode === 'edit'`), resets edit-mode state: clears `checklistMode`, `checklistEditId`, `answers`, `kills`, and resets `ideaModel` from localStorage (or defaults to `'omar'`).
  - If the destination is neither `'idea'` nor `'intraday'`, records it as `S._returnPage` (so the "cancel" flows on those two form pages know where to return to).
  - Removes `active` class from all `.page` and `.nav-item` elements, then adds `active` to `#page-{page}` and `#navitem-{page}` if they exist.
  - Resets `#content` scroll position to top.
  - Updates `S.currentPage = page`.
  - Shows/hides the idea-page and intraday-page "cancel/back" buttons (`#ideaCancelBtn`, `#intraFormBackBtn`) based on whether the target page matches.
  - Pushes vs replaces browser history state: `history.pushState` for `'idea'`/`'intraday'` (so browser back button can step out of a multi-step form), `history.replaceState` otherwise.
  - Then runs a long if-chain of page-specific initialization:
    - `'home'` → `renderDashboard()`
    - `'settings'` → `populateSettingsPage()`
    - `'pnl'` → `initPnlPage()`
    - `'insights'` → `renderDeeperInsights()`
    - `'idea'` → extensive setup: `renderBiasCards()`, `renderEntrySection()`, `updateScoreStrip()`; determines `editMode` from `S.checklistMode`; looks up the trade being edited (if any) via `idEq`; updates the section heading text and the primary action button's label/handler (toggles between "SAVE CHECKLIST UPDATE" → `saveChecklistUpdate` and "LOG AS OPEN TRADE" → `saveIdeaAsOpen`); in edit mode, locks and pre-fills pair/date/session fields from the found trade, calls `setTradeType`, and restores `S.wbEntryId` from the trade's `wbEntryId`; in create mode, unlocks those fields and assigns a fresh `_pendingUploadTradeId` (via `crypto.randomUUID()`) if none pending, for screenshot upload path correctness; renders tags via `renderTagsInWrap`; refreshes the weekly-bias-entry dropdown via `refreshWbEntryDropdown()` and pre-selects it if `S.wbEntryId` is set.
    - `'weekly'` → `renderWeekly()`
    - `'open'` → `renderOpen()`
    - `'intraday'` → resets several `S.intra*` state fields (`intradayView` to `'list'`, `intraAlignment`, `intraDecision`, `intraKill`, `intraExData`), assigns a fresh `_pendingUploadTradeId` if none pending, calls `renderIntradayView()`, `refreshIntraWeeklyDropdown()`, `updateIntradayBadge()`; if `S._pendingIntraLink` was set (a deep-link from elsewhere in the app), pre-selects the `#intraWeeklyLink` dropdown to that value and fires `onIntraWeeklyLink()`, then clears the pending link.
    - `'notes'` → `renderNotes()`
    - `'news'` → `NR.init()` (Forex Factory / news module init)
    - `'pnl'` → no-op comment (iframe self-loads)
    - `'closed'` → `renderClosed()`
- **Calls:** closeSidebar, remove (DOM classList), renderDashboard, populateSettingsPage, initPnlPage, renderDeeperInsights, renderBiasCards, renderEntrySection, updateScoreStrip, idEq, setTradeType, renderTagsInWrap, refreshWbEntryDropdown, renderWeekly, renderOpen, renderIntradayView, refreshIntraWeeklyDropdown, updateIntradayBadge, onIntraWeeklyLink, renderNotes, init (NR.init), renderClosed
- **Called by:** cancelIdeaPage, cancelIntradayPage, renderWeekly, newIntradayFromWeekly, saveIntradayIdea, saveIdeaAsOpen, openChecklistEdit, saveChecklistUpdate, renderOpen, saveClosure, renderDashboard, goNewIntradayForTrade, renderTradeAiReviewBlock, renderWeeklyAiReviewBlock (40 total call sites across the file)
- **Side effects:** Extensive DOM mutation (page/nav active classes, scroll position, button text/handlers, form field values/disabled state); browser History API (`pushState`/`replaceState`); mutates many `S.*` fields (`currentPage`, `_returnPage`, `checklistMode`, `checklistEditId`, `answers`, `kills`, `ideaModel`, `wbEntryId`, `intradayView`, `intraAlignment`, `intraDecision`, `intraKill`, `intraExData`, `_pendingIntraLink`); mutates module-level `_pendingUploadTradeId`.
- **Notes:** This is one of the largest and most heavily-relied-upon functions in the file (112 lines, 40 call sites) — effectively the SPA's router. Also registers a `popstate` window listener (immediately following this function, lines 10029-10040) that calls back into `navTo` when the user presses the browser back/forward button while on the `'idea'` or `'intraday'` pages, restoring `S._returnPage`.

#### cancelIdeaPage()

- **File:** Trade_Journal/index.html (lines 10042-10068)
- **Module:** Sidebar / Navigation
- **Purpose:** Handles the "cancel" action on the Daily Bias / idea page — if currently in checklist-edit mode, resets the edit state and form fields back to their "new entry" defaults, then navigates back to the return page.
- **Parameters:** None
- **Returns:** `void`.
- **Internal logic:**
  - If `S.checklistMode === 'edit'`: clears `checklistMode`, `checklistEditId`, `answers`, `kills`, resets `ideaModel` from localStorage/default; re-enables and clears the pair field, resets the date field to today's date (`new Date().toISOString().split('T')[0]`) and re-enables it, resets the session dropdown to its first option and re-enables it (each field's inline background style is also cleared to remove the "disabled" grey styling); resets the section heading text back to `'DAILY BIAS'`; resets the primary button's label back to `'📊 LOG AS OPEN TRADE'` and its `onclick` handler back to `saveIdeaAsOpen`.
  - Unconditionally calls `navTo(S._returnPage || 'open')` at the end (runs whether or not it was in edit mode).
- **Calls:** navTo
- **Called by:** (none detected via static analysis — verify: certainly wired via inline `onclick="cancelIdeaPage()"` on `#ideaCancelBtn`, referenced by id in `navTo`'s own logic)
- **Side effects:** DOM mutation (form field values, disabled state, styles, heading text, button text/handler); mutates `S.checklistMode`, `S.checklistEditId`, `S.answers`, `S.kills`, `S.ideaModel`; navigation via `navTo`.
- **Notes:** Duplicates a chunk of the edit-mode-reset logic also present inline in `navTo`'s `popstate`-triggered reset — both places independently reset the same five `S.*` fields.

#### cancelIntradayPage()

- **File:** Trade_Journal/index.html (lines 10070-10078)
- **Module:** Sidebar / Navigation
- **Purpose:** Handles the "back/cancel" action on the Intraday page — if currently showing the entry form, returns to the intraday list view (resetting the form); otherwise navigates away from the intraday page entirely.
- **Parameters:** None
- **Returns:** `void`.
- **Internal logic:**
  - If `S.intradayView === 'form'`: sets `S.intradayView = 'list'`, calls `fullResetIntraday()` (clears the intraday form's in-memory state), then `renderIntradayView()` to re-render as the list.
  - Otherwise (already on the list view): calls `navTo(S._returnPage || 'open')` to leave the intraday page altogether.
- **Calls:** fullResetIntraday, renderIntradayView, navTo
- **Called by:** (none detected via static analysis — verify: wired via inline `onclick="cancelIntradayPage()"` on `#intraFormBackBtn`)
- **Side effects:** Mutates `S.intradayView`; delegates further state mutation to `fullResetIntraday`; DOM re-render via `renderIntradayView`; navigation via `navTo`.
- **Notes:** Two-level back behavior — first back-press exits the form to the list, second exits the whole page. Mirrors the two-tier structure of `openIntradayForm`/`renderIntradayView`.

#### openIntradayForm()

- **File:** Trade_Journal/index.html (lines 10080-10091)
- **Module:** Sidebar / Navigation
- **Purpose:** Switches the Intraday page into "new setup" form mode, resetting all form state and rendering a blank entry form.
- **Parameters:** None
- **Returns:** `void`.
- **Internal logic:**
  - Sets `S.intradayView = 'form'`.
  - Calls `fullResetIntraday()` to clear prior form state.
  - Calls `renderIntradayView()` to switch the DOM to form mode.
  - Shows the `#intraFormBackBtn` (removing any `display:none`).
  - Sets `#intraFormTitle` text to `'NEW INTRADAY SETUP'`.
  - Hides `#intraAlignmentBanner` (no alignment computed yet for a fresh form).
  - Calls `renderDecisionEngine()` and `renderIntradayDecisionStrip()` to initialize the decision-support UI for the blank form.
- **Calls:** fullResetIntraday, renderIntradayView, renderDecisionEngine, renderIntradayDecisionStrip
- **Called by:** (none detected via static analysis — verify: wired via inline `onclick="openIntradayForm()"` on an "add intraday setup" button, since this is a clear UI entry-point with no other logical caller)
- **Side effects:** Mutates `S.intradayView`; DOM mutation (`#intraFormBackBtn` display, `#intraFormTitle` text, `#intraAlignmentBanner` display) plus whatever `renderIntradayView`/`renderDecisionEngine`/`renderIntradayDecisionStrip` mutate internally.
- **Notes:** None additional.

#### renderIntradayView()

- **File:** Trade_Journal/index.html (lines 10093-10110)
- **Module:** Sidebar / Navigation
- **Purpose:** Switches the Intraday page's DOM between "list" mode (showing existing intraday entries) and "form" mode (showing the entry/edit form), and triggers the appropriate sub-renders for whichever mode is active.
- **Parameters:** None
- **Returns:** `void`.
- **Internal logic:**
  - Looks up `#intraListView`, `#intraFormView`, `#intraFormBackBtn`.
  - If `S.intradayView === 'list'`: shows the list view (`display:block`), removes the `open` class from the form view, hides the back button, and calls `renderIntradayList()`.
  - Else (form mode): hides the list view (`display:none`), adds `open` class to the form view, shows the back button, and calls `renderDecisionEngine()`, `renderIntradayDecisionStrip()`, and `computeAlignmentAndBanner()` to populate the form's decision-support widgets and alignment banner.
- **Calls:** Element.classList.remove/add (native — tracked as `remove`), renderIntradayList, renderDecisionEngine, renderIntradayDecisionStrip, computeAlignmentAndBanner
- **Called by:** navTo, cancelIntradayPage, openIntradayForm, newIntradayFromWeekly, editIntradayFromList, saveIntradayIdea, openChecklistEdit, deleteOpenTrade (10 total call sites)
- **Side effects:** DOM mutation (`#intraListView`/`#intraFormView` display and classes, `#intraFormBackBtn` display) plus downstream renders.
- **Notes:** Reads `S.intradayView` as its sole branching condition — every caller that wants to switch modes sets that field first, then calls this to reflect it in the DOM. Heavily reused (10 call sites) as the standard "refresh the intraday page" function after any state change relevant to that page.

### Module: Rich Text Helpers

#### sanitiseHtml(html)

- **File:** Trade_Journal/index.html (lines 10116-10142)
- **Module:** Rich Text Helpers
- **Purpose:** Sanitizes user-authored rich-text HTML (from the app's simple `contenteditable` rich text editor) by stripping any tag not on an explicit allow-list and stripping any attribute not on an explicit allow-list, plus blocking `javascript:` URLs — a defense against stored XSS from note/trade bodies.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| html | string | Raw HTML string to sanitize (may be user-typed via `document.execCommand`-based editing) |

- **Returns:** `string` — sanitized HTML (empty string if input falsy).
- **Internal logic:**
  - Returns `''` immediately if `html` is falsy.
  - Creates a detached `<div>`, sets its `innerHTML` to the input (this parses it into a DOM tree without attaching to the document, so scripts don't execute).
  - Defines `ALLOWED_TAGS` (a `Set`): `B, I, U, EM, STRONG, BR, P, UL, OL, LI, H4, SPAN, DIV, A`.
  - Defines `ALLOWED_ATTRS` (a `Set`): `href, style, class`.
  - Recursively `walk`s the tree (see `walk` below): any element not in the allow-list is replaced by a plain text node containing its `textContent` (so the text content survives but the tag/markup is stripped, including any nested malicious tags since only `textContent` — not `innerHTML` — is preserved); any element that IS allowed has its attributes filtered to the allow-list, and any attribute whose value matches `/javascript:/i` is stripped even if the attribute name (`href`) is otherwise allowed.
  - Returns `tmp.innerHTML` after the walk completes.
- **Calls:** walk
- **Called by:** rteDisplay
- **Side effects:** None persisted — creates a temporary detached DOM element for parsing purposes only.
- **Notes:** Because disallowed elements are replaced with their `textContent` (not recursively sanitized first), any nested allowed tags inside a disallowed wrapper are also flattened to plain text — e.g. `<script><b>x</b></script>` becomes the plain text `x`, not `<b>x</b>`. This is actually safer (no risk of a "nested allowed tag" escaping sanitization) at the cost of losing legitimate nested formatting inside an unrecognized wrapper tag.

#### walk(node)

- **File:** Trade_Journal/index.html (lines 10123-10139) — nested inside `sanitiseHtml`
- **Module:** Rich Text Helpers
- **Purpose:** Recursive tree-walking helper that performs the actual tag/attribute filtering for `sanitiseHtml`.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| node | Node | The DOM node whose children should be sanitized in place |

- **Returns:** `void` (mutates the DOM tree in place).
- **Internal logic:**
  - Iterates `node.childNodes` (a live NodeList, iterated via `.forEach`, which works because `NodeList.forEach` snapshots the collection reference but replacement below happens on the current node, not future siblings — see Notes).
  - For each child that is an element node (`nodeType === 1`):
    - If its tag name is not in `ALLOWED_TAGS`, replaces it in the DOM with a text node of its `textContent` (flattening it and discarding any children/markup).
    - Otherwise, iterates its attributes (converted to array via `Array.from`) and removes any attribute not in `ALLOWED_ATTRS`, or whose value matches `/javascript:/i` regardless of name.
    - Then recurses into the (now-attribute-filtered) child via `walk(child)` to sanitize its descendants too.
- **Calls:** (none — recurses into itself, not tracked as an outbound call in the JSON since it's a self-reference)
- **Called by:** sanitiseHtml (recursively, and as the initial call)
- **Side effects:** Mutates the detached DOM subtree in place (element replacement, attribute removal).
- **Notes:** Closure defined fresh on every `sanitiseHtml()` invocation; captures `ALLOWED_TAGS`/`ALLOWED_ATTRS` from the enclosing scope. Because `forEach` iterates a live-ish snapshot and mutation happens on `child` itself (via `replaceChild`) rather than inserting new siblings, this does not skip nodes — but note that this pattern generally requires care with live NodeLists in other contexts.

#### rteExec(id, cmd, val)

- **File:** Trade_Journal/index.html (lines 10144-10150)
- **Module:** Rich Text Helpers
- **Purpose:** Executes a `document.execCommand` rich-text formatting command (bold, italic, list, etc.) against a specific contenteditable element, used by the custom RTE toolbar buttons.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| id | string | Element id of the contenteditable/textarea target |
| cmd | string | The `execCommand` command name (e.g. `'bold'`, `'italic'`, `'insertUnorderedList'`) |
| val | string \| undefined | Optional command value argument |

- **Returns:** `void`.
- **Internal logic:** Looks up the element by id; returns if not found. Focuses it, runs `document.execCommand(cmd, false, val || null)`, then focuses it again (to ensure the caret/selection returns to the editable area after the command, since toolbar buttons steal focus on click).
- **Calls:** (none — uses native `document.execCommand`/`.focus()`)
- **Called by:** (none detected via static analysis — 64 total call sites in the file, all presumably via inline `onclick`/`onmousedown` attributes on RTE toolbar buttons, e.g. `onclick="rteExec('wbNotes','bold')"`)
- **Side effects:** Mutates the focused/selected contenteditable element's content via the browser's `execCommand` (deprecated but still functional API); shifts DOM focus.
- **Notes:** `document.execCommand` is a deprecated Web API still widely supported in evergreen browsers as of writing; this app relies on it for its entire rich-text editing toolbar (64 usages) rather than a modern editor library.

#### rteClear(id)

- **File:** Trade_Journal/index.html (lines 10152-10158)
- **Module:** Rich Text Helpers
- **Purpose:** Clears all formatting from the current selection/content in a contenteditable element and resets its block type to a plain paragraph.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| id | string | Element id of the contenteditable target |

- **Returns:** `void`.
- **Internal logic:** Looks up the element; returns if missing. Focuses it, then runs `document.execCommand('removeFormat', false, null)` followed by `document.execCommand('formatBlock', false, 'p')` (strip inline formatting, then force block-level formatting to `<p>`).
- **Calls:** (none — native `execCommand`)
- **Called by:** (none detected via static analysis — 10 total call sites, presumably an inline `onclick` on a "clear formatting" toolbar button per RTE instance)
- **Side effects:** Mutates the target contenteditable element's content/formatting; shifts DOM focus.
- **Notes:** None additional.

#### rteGet(id)

- **File:** Trade_Journal/index.html (lines 10160-10165)
- **Module:** Rich Text Helpers
- **Purpose:** Reads the current content out of a rich-text field, whether it's a `<textarea>` (plain value) or a contenteditable element (innerHTML).
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| id | string | Element id of the field to read |

- **Returns:** `string` — the field's value/innerHTML (trimmed if contenteditable), or `''` if the element doesn't exist.
- **Internal logic:** Looks up the element; returns `''` if missing. If `tagName === 'TEXTAREA'`, returns `el.value` unmodified. Otherwise returns `el.innerHTML.trim()`.
- **Calls:** (none)
- **Called by:** saveWeeklyBias, saveWbNote, saveIntradayIdea, saveIdeaAsOpen, saveClosure, saveEditOpen, saveEditClosed, saveNote, saveTradeNote
- **Side effects:** None (pure DOM read).
- **Notes:** Used at every save point that has an associated rich-text/notes field — 13 total call sites per the JSON, 9 distinct named callers listed.

#### rteSet(id, val)

- **File:** Trade_Journal/index.html (lines 10167-10172)
- **Module:** Rich Text Helpers
- **Purpose:** Writes a value into a rich-text field, whether it's a `<textarea>` or a contenteditable element, used when populating edit modals/forms with existing content.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| id | string | Element id of the field to write |
| val | string | The value/HTML to set |

- **Returns:** `void`.
- **Internal logic:** Looks up the element; returns if missing. If `tagName === 'TEXTAREA'`, sets `el.value = val || ''`. Otherwise sets `el.innerHTML = val || ''`.
- **Calls:** (none)
- **Called by:** openNewWeeklyModal, openEditWeeklyModal, openAddNoteModal, editIntradayFromList, fullResetIntraday, fullResetChecklist, saveIdeaAsOpen, openChecklistEdit, openCloseModal, openEditOpenModal, openEditClosedModal, openNewNoteModal, openEditNoteModal, openTradeNoteModal
- **Side effects:** DOM mutation (writes to the target element's `value` or `innerHTML`).
- **Notes:** Directly setting `innerHTML` here (rather than via `rteDisplay`/`sanitiseHtml`) is presumably safe because these callers are populating an editable field from the user's own previously-saved (and originally sanitized-on-save-or-display) content within a modal the same user controls, not rendering into a general read-only display surface.

#### rteDisplay(html)

- **File:** Trade_Journal/index.html (lines 10174-10179)
- **Module:** Rich Text Helpers
- **Purpose:** Prepares rich-text content for safe read-only display, sanitizing it and converting plain-text newlines to `<br>` tags when the content contains no HTML markup at all.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| html | string | Raw stored content (may be plain text or rich HTML) |

- **Returns:** `string` — sanitized, display-ready HTML (or `''` if input falsy).
- **Internal logic:**
  - Returns `''` if `html` is falsy.
  - Runs `sanitiseHtml(html)` to get `safe`.
  - If `safe` contains no HTML tag start (`/<[a-z]/` test fails, meaning legacy or non-RTE plain-text content), converts `\n` characters to `<br>` and returns that.
  - Otherwise returns `safe` as-is (already proper HTML from the RTE).
- **Calls:** sanitiseHtml
- **Called by:** renderWeekly, renderOpen, tradeCard, openTradeHistory, noteBlock, timelineHtml
- **Side effects:** None (pure function).
- **Notes:** This dual-path handling (plain-text-with-newlines vs. real HTML) supports backward compatibility with older data saved before the rich-text editor existed (plain strings with `\n`), while still safely rendering newer RTE-authored HTML.

### Module: Tag System

#### renderTagsInWrap(wrapId, tagsArr, ctx)

- **File:** Trade_Journal/index.html (lines 10184-10199)
- **Module:** Tag System
- **Purpose:** Renders the removable tag "pill" chips for a given tag-input widget (used across Daily Bias, Weekly Bias, Intraday, and Closed-trade contexts), then re-renders the suggestion chips alongside them.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| wrapId | string | Element id of the wrapping container that holds the tag pills + text input |
| tagsArr | Array<string> | The current tags to render as pills |
| ctx | string | Context key (`'idea'`, `'wb'`, `'intra'`, `'closed'`) used to route the remove-click back to the right array |

- **Returns:** `void`.
- **Internal logic:**
  - Looks up the wrap element; returns if missing.
  - Removes any existing `.tag.rm` pill elements from the wrap (clears previous render) — but leaves the `.tag-input` element itself and any suggestion chips alone (suggestion chips are cleaned up separately inside `renderTagSuggestions`).
  - Finds the `.tag-input` element inside the wrap (used as an insertion anchor).
  - For each tag in `tagsArr`, creates a `<span>` with class `tag tag-custom rm tag-clickable` (overridden to `tag tag-weekly rm tag-clickable` for the literal tag `'weekly'`, or `tag tag-intraday rm tag-clickable` for `'intraday'` — special built-in tag styling), sets its innerHTML to `#tagname` plus an inline `✕` remove icon whose `onclick` attribute string directly calls `removeTag(i,'ctx')` (built via string concatenation), and inserts it into the wrap immediately before the input element.
  - Finally calls `renderTagSuggestions(ctx)` to refresh the quick-pick suggestion chips.
- **Calls:** Element.remove (native, tracked as `remove`), removeTag (indirectly, via the generated inline `onclick` string — not a direct JS call), renderTagSuggestions
- **Called by:** navTo, handleTagKey, removeTag, harvestTags, addTagFromSuggestion, openNewWeeklyModal, openEditWeeklyModal, editIntradayFromList, fullResetIntraday, openChecklistEdit, openTradeHistory
- **Side effects:** DOM mutation (removes/inserts `<span>` tag-pill elements inside `#{wrapId}`).
- **Notes:** The remove icon's click handler is built as a raw HTML string (`onclick="removeTag(...)"`) rather than an addEventListener — this is exactly the kind of "call only visible via inline onclick attribute" the task brief warns about; `removeTag` is correctly listed as an inbound caller of this function already (since `removeTag` calls back into `renderTagsInWrap` after removing an item), and this function in turn invokes `removeTag` only via that generated markup string, not a traceable direct call — worth noting explicitly since the static analyzer's `outboundCalls` for this function does list `removeTag`, likely detected via the string literal reference.

#### handleTagKey(event, ctx)

- **File:** Trade_Journal/index.html (lines 10201-10222)
- **Module:** Tag System
- **Purpose:** Keyboard handler for a tag-input text field — commits the typed text as a new tag on Enter/comma, or removes the last tag on Backspace when the input is empty (a common "chip input" UX pattern).
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| event | KeyboardEvent | The keydown/keyup event from the tag input field |
| ctx | string | Context key (`'idea'`, `'wb'`, `'intra'`, `'closed'`) |

- **Returns:** `void`.
- **Internal logic:**
  - Maps `ctx` to the corresponding `S.*` array name (`ideaTags`/`wbTags`/`intraTags`/`closeTags`) and wrap element id, via two lookup objects.
  - Returns early if `ctx` doesn't map to a known array.
  - On Enter, comma, or their keyCode/which equivalents (13): prevents default, normalizes the typed value (strips `#`/`,`, trims, lowercases, replaces whitespace runs with hyphens), and — if non-empty and not already present — pushes it onto the mapped `S[arr]` array, re-renders the tag pills via `renderTagsInWrap`, and (if `ctx === 'closed'`) immediately persists via `_syncCloseTags()`. Clears the input value regardless.
  - On Backspace when the input is empty and the array is non-empty: pops the last tag off `S[arr]`, re-renders, and syncs if `ctx === 'closed'`.
- **Calls:** renderTagsInWrap, _syncCloseTags
- **Called by:** (none detected via static analysis — verify: certainly wired via an inline `onkeydown="handleTagKey(event,'idea')"`-style attribute on each context's tag-input element, per the multiple contexts it supports)
- **Side effects:** Mutates `S.ideaTags`/`S.wbTags`/`S.intraTags`/`S.closeTags` (whichever matches `ctx`); DOM mutation via `renderTagsInWrap`; for closed-trade context, also a Supabase write via `_syncCloseTags` → `saveTrade`.
- **Notes:** Tag normalization (lowercase, hyphenate spaces, strip `#`/`,`) is duplicated verbatim across `handleTagKey`, `harvestTags`, and effectively inline throughout the tag system — no shared helper for the normalization itself.

#### removeTag(i, ctx)

- **File:** Trade_Journal/index.html (lines 10224-10233)
- **Module:** Tag System
- **Purpose:** Removes a single tag by index from the given context's tag array and re-renders (called from the "✕" click on a tag pill).
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| i | number | Index of the tag to remove within the context's array |
| ctx | string | Context key (`'idea'`, `'wb'`, `'intra'`, `'closed'`) |

- **Returns:** `void`.
- **Internal logic:** Maps `ctx` to array/wrap names; returns early if unmapped. Splices out index `i` from `S[arr]`. Re-renders via `renderTagsInWrap`. If `ctx === 'closed'`, immediately persists via `_syncCloseTags()`.
- **Calls:** renderTagsInWrap, _syncCloseTags
- **Called by:** renderTagsInWrap (indirectly, via the generated inline `onclick="removeTag(i,'ctx')"` string on each tag pill's ✕ icon — see notes on renderTagsInWrap above)
- **Side effects:** Mutates `S[arr]` (splice); DOM mutation via `renderTagsInWrap`; for closed context, Supabase write via `_syncCloseTags`.
- **Notes:** Its only real invocation path is the inline `onclick` string embedded by `renderTagsInWrap` — there is no direct JS-level call site anywhere in the file, exactly the "static analysis can miss inline onclick" scenario flagged in the task brief.

#### harvestTags(ctx)

- **File:** Trade_Journal/index.html (lines 10235-10249)
- **Module:** Tag System
- **Purpose:** Commits whatever text is currently sitting, un-submitted, in a tag-input field at the moment a form is saved — ensuring the user doesn't lose a typed-but-not-Entered tag when they click Save.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| ctx | string | Context key (`'idea'`, `'wb'`, `'intra'`, `'closed'`) |

- **Returns:** `void`.
- **Internal logic:** Maps `ctx` to array/wrap names; returns early if unmapped. Finds the `.tag-input` element inside the wrap via optional chaining. If it exists and has non-whitespace content, normalizes the value the same way as `handleTagKey` (strip `#`/`,`, trim, lowercase, hyphenate spaces), pushes it onto `S[arr]` if non-empty and not a duplicate, clears the input, re-renders via `renderTagsInWrap`, and syncs immediately if `ctx === 'closed'`.
- **Calls:** renderTagsInWrap, _syncCloseTags
- **Called by:** saveWeeklyBias, saveIntradayIdea, saveIdeaAsOpen
- **Side effects:** Mutates `S[arr]`; DOM mutation via `renderTagsInWrap`; conditional Supabase write via `_syncCloseTags`.
- **Notes:** Always called as the very first step of the corresponding save function, before reading any other field values — guarantees any dangling typed tag is captured before the trade/bias entry object is constructed.

#### addTagFromSuggestion(val, ctx)

- **File:** Trade_Journal/index.html (lines 10252-10262)
- **Module:** Tag System
- **Purpose:** Adds a tag directly from a clicked "recent tag" quick-pick suggestion chip, without requiring the user to type it.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| val | string | The tag text to add (already normalized, taken from a suggestion chip) |
| ctx | string | Context key (`'idea'`, `'wb'`, `'intra'`, `'closed'`) |

- **Returns:** `void`.
- **Internal logic:** Maps `ctx` to array/wrap names. Returns early if the array key is unmapped, `val` is falsy, or `val` is already present in `S[arr]` (no duplicates). Pushes `val` onto `S[arr]`, re-renders tag pills via `renderTagsInWrap`, re-renders suggestions via `renderTagSuggestions` (since the just-added tag should no longer appear as a suggestion), and syncs immediately if `ctx === 'closed'`.
- **Calls:** renderTagsInWrap, renderTagSuggestions, _syncCloseTags
- **Called by:** renderTagSuggestions (wired via each suggestion chip's `span.onclick = () => addTagFromSuggestion(tag, ctx)`, a real JS closure assignment, not a string-built inline attribute)
- **Side effects:** Mutates `S[arr]`; DOM mutation via `renderTagsInWrap`/`renderTagSuggestions`; conditional Supabase write via `_syncCloseTags`.
- **Notes:** Unlike `removeTag`'s string-built `onclick`, this one is wired via a genuine JS function reference (`span.onclick = () => ...`), so it IS traceable/detected correctly by static analysis (hence it does show a caller).

#### _syncCloseTags()

- **File:** Trade_Journal/index.html (lines 10266-10272)
- **Module:** Tag System
- **Purpose:** Immediately persists the currently-open Closed-Trade modal's edited tags to the underlying trade object and saves it, matching the "save-as-you-go" behavior of other widgets in that modal (as opposed to waiting for an explicit Save button).
- **Parameters:** None
- **Returns:** `void`.
- **Internal logic:** Finds the trade in `S.trades` matching `S.closeTagsEditId` via `idEq`. Returns if not found. Sets `t.closeTags` to a shallow copy of `S.closeTags` (the modal's working tag array). Calls `saveTrade(t)` to persist. Re-renders suggestion chips for the `'closed'` context via `renderTagSuggestions('closed')`.
- **Calls:** idEq, saveTrade, renderTagSuggestions
- **Called by:** handleTagKey, removeTag, harvestTags, addTagFromSuggestion (all four tag-mutation entry points call this when `ctx === 'closed'`)
- **Side effects:** Mutates the matched trade object's `closeTags` field within `S.trades`; delegates to `saveTrade` (Supabase write + related side effects); DOM mutation via `renderTagSuggestions`.
- **Notes:** This is the mechanism by which the Closed-Trade modal's tags never need an explicit "Save" click for the tags specifically — every tag mutation (add/remove/type-and-enter/suggestion-click) triggers an immediate autosave via `saveTrade`.

#### getRecentTagsForContext(ctx)

- **File:** Trade_Journal/index.html (lines 10277-10299)
- **Module:** Tag System
- **Purpose:** Computes the 5 most-recently-used tags for a given tag context, to power the quick-pick suggestion chips, scoping the "recency pool" separately per context so daily/weekly/intraday/closed tags don't bleed into each other's suggestions.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| ctx | string | Context key (`'idea'`, `'wb'`, `'intra'`, `'closed'`) |

- **Returns:** `Array<string>` — up to 5 tag strings, most-recently-used first.
- **Internal logic:**
  - Builds a `pool` array of all tags ever used in that context:
    - `'idea'`: all non-intraday trades' tags, PLUS the tags of any intraday trades linked to one of those idea trades via `weeklyLinkId` (checked with `idEq`) — i.e. idea + its linked executions share a tag pool.
    - `'wb'`: all `S.weeklies` entries' `tags`.
    - `'intra'`: all intraday trades' `tags`.
    - `'closed'`: all closed trades' `closeTags`.
  - De-duplicates while preserving "most recent wins" ordering: iterates the pool in original (chronological, oldest-inserted-first since arrays are typically unshifted/pushed in creation order... actually built from `.flatMap` over `S.trades`/`S.weeklies` in their stored order) and maintains a `seen` array; if a tag reappears later in the pool, it's removed from its earlier position and re-pushed at the end, so the final order in `seen` has the most-recently-encountered occurrence last.
  - Returns `seen.reverse().slice(0, 5)` — reversing puts the most-recent-occurrence first, then takes the top 5.
- **Calls:** Array.prototype.filter, idEq
- **Called by:** renderTagSuggestions
- **Side effects:** None (pure read of `S.trades`/`S.weeklies`).
- **Notes:** "Most recently used" here is really "most recently encountered while scanning the array in its current stored order," which depends on how trades/weeklies are ordered in `S.trades`/`S.weeklies` (e.g. `unshift`-based insertion, as seen in `saveWeeklyBias`, would put newest first) — the actual "recency" semantics hinge on the underlying array's sort order, not on the tag's own timestamp.

#### renderTagSuggestions(ctx)

- **File:** Trade_Journal/index.html (lines 10303-10322)
- **Module:** Tag System
- **Purpose:** Renders quick-pick suggestion chips (from `getRecentTagsForContext`) inline within a tag-input wrap, positioned before the text input, excluding any tag already applied.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| ctx | string | Context key (`'idea'`, `'wb'`, `'intra'`, `'closed'`) |

- **Returns:** `void`.
- **Internal logic:**
  - Looks up the wrap element for `ctx`; returns if missing.
  - Removes any existing `.tag-suggestion` chips (clears previous suggestion render).
  - Finds the `.tag-input` element as an insertion anchor.
  - Reads the currently-applied tags (`current`) for this context from `S[arrMap[ctx]]`.
  - Computes `suggestions` = the recent tags from `getRecentTagsForContext(ctx)` filtered to exclude any already in `current`.
  - For each suggestion, creates a `<span class="tag tag-suggestion tag-clickable">` styled at reduced opacity (`0.55`) with a pointer cursor and title `"Add tag"`, text `#tagname`, and a genuine JS `onclick` handler (`() => addTagFromSuggestion(tag, ctx)`), inserted before the input.
- **Calls:** Element.remove (native), getRecentTagsForContext, Array.prototype.filter, addTagFromSuggestion (via closure assignment, not string-built)
- **Called by:** renderTagsInWrap, addTagFromSuggestion, _syncCloseTags
- **Side effects:** DOM mutation (removes/inserts suggestion chip `<span>` elements inside the context's wrap).
- **Notes:** None additional.

### Module: Weekly Bias UI

#### updateWeeklyBadge()

- **File:** Trade_Journal/index.html (lines 10328-10335)
- **Module:** Weekly Bias UI
- **Purpose:** Updates the sidebar's Weekly Bias nav badge (count of currently-open weekly biases) and the tile subtitle text on the dashboard/home tile for Weekly Bias.
- **Parameters:** None
- **Returns:** `void`.
- **Internal logic:**
  - Counts `S.weeklies` entries with `status === 'open'` as `active`.
  - If `#weeklyBadge` exists, sets its text to `active` and hides it (`display:none`) when `active` is 0, else shows it (empty string clears any inline override).
  - If `#weeklyTileSub` exists, sets its text to `"N active bias(es)"` (pluralizing "bias" → "biases" when `active > 1`) when `active > 0`, else `"Swing journals"`.
- **Calls:** Array.prototype.filter
- **Called by:** loadAllData, saveWeeklyBias, saveWeeklyReview, reopenWeeklyBias, deleteWeeklyBias, renderDashboard, runArchive
- **Side effects:** DOM mutation of `#weeklyBadge` (text, display) and `#weeklyTileSub` (text).
- **Notes:** Called after every operation that could change the count/status of weekly biases (save, review, reopen, delete, archive) to keep the badge in sync.

#### openNewWeeklyModal()

- **File:** Trade_Journal/index.html (lines 10337-10356)
- **Module:** Weekly Bias UI
- **Purpose:** Opens the "New Weekly Bias" modal in create mode, resetting all working state (`S.wbEditId`, `S.wbData`, screenshots, checklist answers) and pre-populating the form's default values.
- **Parameters:** None
- **Returns:** `void`.
- **Internal logic:**
  - Sets `S.wbEditId = null` (signals "create" rather than "edit" mode to `saveWeeklyBias`).
  - Assigns a fresh `_pendingUploadTradeId` via `crypto.randomUUID()` (for screenshot upload path association before the entry itself is saved).
  - Resets `S.wbData = {bias:''}`, `S.wbSS = []` (screenshots), `S.wbAnswers = {}`, `S.wbKills = {}`.
  - Sets modal title text to `'NEW WEEKLY BIAS'` and the save button's label to `'📅 SAVE WEEKLY BIAS'`.
  - Clears the pair input value and resets the date input to today's date.
  - Clears the rich-text notes field via `rteSet('wbNotes', '')`.
  - Clears the screenshot grid's innerHTML.
  - Resets `S.wbTags = ['weekly']` (default starter tag) and, if the tag wrap element exists, removes any existing `.tag.rm` pills then re-renders via `renderTagsInWrap`.
  - Calls `renderWBCards()` to render the (now-blank) weekly-bias checklist.
  - Adds the `open` class to `#weeklyModal` to display it.
- **Calls:** rteSet, Element.classList/remove (native, tracked as `remove`), renderTagsInWrap, renderWBCards
- **Called by:** (none detected via static analysis — verify: wired via inline `onclick="openNewWeeklyModal()"` on a "New Weekly Bias" button, being a clear UI entry point)
- **Side effects:** Mutates `S.wbEditId`, `S.wbData`, `S.wbSS`, `S.wbAnswers`, `S.wbKills`, `S.wbTags`; module-level `_pendingUploadTradeId`; DOM mutation across multiple modal form fields; opens the modal.
- **Notes:** None additional.

#### answerWB(qid, val)

- **File:** Trade_Journal/index.html (lines 10358-10362)
- **Module:** Weekly Bias UI
- **Purpose:** Records the user's answer to one Weekly Bias checklist question and re-renders the checklist cards (to update completion state, progress bar, and the derived decision-engine output).
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| qid | string | The checklist question's id |
| val | string | The selected option's value |

- **Returns:** `void`.
- **Internal logic:** Ensures `S.wbAnswers` exists (defaults to `{}`). Sets `S.wbAnswers[qid] = {val}`. Calls `renderWBCards()` to re-render.
- **Calls:** renderWBCards
- **Called by:** renderWBCards (indirectly — each `<select>` in the rendered checklist has `onchange="answerWB('${q.id}',this.value)"`, a string-built inline handler; not a direct JS call from renderWBCards's own body, but the JSON's inbound-caller list attributes it there, likely because the analyzer matched the string template reference)
- **Side effects:** Mutates `S.wbAnswers`; triggers a full re-render of the checklist section via `renderWBCards` (DOM mutation of `#wbChecklistSection`).
- **Notes:** Every single dropdown change in the Weekly Bias checklist causes a full HTML re-render of the entire checklist section (not just the changed card) — acceptable given the section is small, but worth knowing for anyone optimizing render performance.

#### renderWBCards()

- **File:** Trade_Journal/index.html (lines 10364-10408)
- **Module:** Weekly Bias UI
- **Purpose:** Renders the full Weekly Bias checklist UI — all question cards with their dropdowns, a progress indicator, and the derived decision-engine dashboard output (bias/environment/confidence) computed from the current answers.
- **Parameters:** None
- **Returns:** `void`.
- **Internal logic:**
  - Looks up `#wbChecklistSection`; returns if missing.
  - Reads `cards = BIAS_CARDS_WEEKLY` (a static question-card definition array, presumably a module-level constant defined elsewhere in the file).
  - Reads current answers `ans = S.wbAnswers || {}`.
  - Computes `answered`/`total` counts across all questions in all cards (for the progress bar).
  - Runs the decision engine: `result = runWBEngine(ans)`.
  - Builds `cardsHtml` by mapping each card to a `<div>` block: header shows card number/title/timeframe and a checkmark if all its questions are answered (`cardDone`), styled with a highlighted border/background when done; body renders each question as a `<label>` + `<select>` with `onchange="answerWB('${q.id}',this.value)"`, each `<option>` marked `selected` if it matches the current answer, with border/background styling reflecting whether that question has been answered.
  - Builds `progHtml`: a small bar showing `"{answered}/{total} answered"` text plus a percentage-width filled progress bar.
  - Builds `dashboardHtml` via `renderWBDecisionDashboard(result, ans, false)` (the derived-decision display, e.g. bias/environment output — rendered elsewhere).
  - Concatenates `progHtml + cardsHtml + dashboardHtml` into `section.innerHTML`.
- **Calls:** Array.prototype.filter, runWBEngine, answerWB (only via generated `onchange` string, not a direct call), renderWBDecisionDashboard
- **Called by:** openNewWeeklyModal, answerWB, openEditWeeklyModal
- **Side effects:** DOM mutation (full innerHTML replacement of `#wbChecklistSection`).
- **Notes:** Entirely re-renders the whole checklist section (all cards + dashboard) on every single answer change — a coarse-grained re-render strategy consistent with the rest of the app's UI update style (no virtual-DOM diffing).

#### saveWeeklyBias()

- **File:** Trade_Journal/index.html (lines 10410-10457)
- **Module:** Weekly Bias UI
- **Purpose:** Validates and persists the Weekly Bias modal's form (pair, date, derived bias from the checklist engine, notes, tags, screenshots) — either updating an existing weekly-bias entry (edit mode) or creating a new one — then syncs to Supabase and refreshes all dependent UI.
- **Parameters:** None
- **Returns:** `void` (fires an async save via `saveWeekly` but the function itself is synchronous).
- **Internal logic:**
  - Calls `harvestTags('wb')` first to capture any un-submitted typed tag.
  - Reads and trims `#wbPair` and `#wbDate` values; if either is empty, shows a blocking `alert('Pair and date are required.')` and returns.
  - Guards against saving while a screenshot upload is still in progress: if any `S.wbSS` entry has `_uploading` truthy, shows a warning toast and returns without saving.
  - Runs the decision engine (`runWBEngine(S.wbAnswers || {})`); if it produced a result, derives the bias via `getWBBias(S.wbAnswers)`, else falls back to `S.wbData.bias || null`.
  - If no `derivedBias` could be determined, shows a blocking `alert('Complete the Weekly Bias checklist before saving.')` and returns (checklist completion is mandatory).
  - **Edit branch** (`S.wbEditId` set): finds the matching weekly entry via `idEq`; returns if not found; updates its `pair`, `date`, `bias`, `wbChecklistAnswers` (a copy of `S.wbAnswers`), `notes` (via `rteGet('wbNotes')`, trimmed), `tags` (a copy of `S.wbTags`); if there are newly-added screenshots in `S.wbSS`, appends them to the existing `screenshots` array (rather than replacing it).
  - **Create branch**: builds a new `entry` object with a fresh id (`_pendingUploadTradeId` or a new UUID), `status:'open'`, the form fields, `screenshots` set to a copy of `S.wbSS`, empty `updates` array, `createdAt` timestamp, `closedAt: null`, `weeklyReview: null`; unshifts it onto the front of `S.weeklies`.
  - Determines the just-saved entry (`_savedW`) — either the found edit-mode entry or `S.weeklies[0]` (the just-unshifted new entry) — and calls `saveWeekly(_savedW)` to persist it (Supabase write, defined elsewhere).
  - Closes the modal (removes `open` class from `#weeklyModal`).
  - Resets `S.wbEditId`, `S.wbSS`, `S.wbAnswers`, `S.wbKills` to their empty/null states.
  - Calls `renderWeekly()` to refresh the Weekly Bias list page, `updateWeeklyBadge()` to refresh the sidebar badge, and `refreshIntraWeeklyDropdown()` to refresh the intraday page's weekly-link dropdown (since a new/edited weekly entry may need to appear there).
- **Calls:** harvestTags, showToast, runWBEngine, getWBBias, idEq, rteGet, saveWeekly, Element.classList.remove (native, tracked as `remove`), renderWeekly, updateWeeklyBadge, refreshIntraWeeklyDropdown
- **Called by:** (none detected via static analysis — verify: wired via inline `onclick="saveWeeklyBias()"` on `#wbSaveBtn`, the modal's save button, whose label text is set by both `openNewWeeklyModal` and presumably `openEditWeeklyModal`)
- **Side effects:** DOM mutation (modal close, subsequent re-renders); mutates `S.weeklies` (push/update entry), `S.wbEditId`, `S.wbSS`, `S.wbAnswers`, `S.wbKills`; delegates a Supabase write to `saveWeekly`; toast/alert user feedback.
- **Notes:** Uses blocking `alert()` (not `showToast`) for its two validation failures (missing pair/date, incomplete checklist) — an inconsistency with the rest of the app's toast-based feedback pattern, though it does use `showToast` for the "still uploading" warning case.

### Module: Weekly Review — Accuracy Computation & Review Modal

#### computeBiasAccuracy(predictedEnv, actualEnv)

- **File:** Trade_Journal/index.html (lines 10463-10474)
- **Module:** Weekly Review — Accuracy Computation
- **Purpose:** Scores how accurate the weekly bias's predicted market environment grade was versus the actual delivered environment, based on their distance in a fixed ordered scale.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| predictedEnv | string | One of `ENV_ORDER` (`'A+'`,`'A'`,`'B'`,`'C'`,`'No Trade'`) — the pre-week predicted environment |
| actualEnv | string | Same scale — the environment actually delivered, selected during the review |

- **Returns:** `Object` — `{result: string, explanation: string}` where `result` is one of `'—'`, `'Correct'`, `'Partially Correct'`, `'Incorrect'`.
- **Internal logic:**
  - If either argument is falsy, returns a placeholder `{result:'—', explanation:'Select both predicted and actual environment.'}`.
  - Looks up each value's index in the module-level `ENV_ORDER` array; if either isn't found (`-1`), returns `{result:'—', explanation:'Invalid environment selection.'}`.
  - Computes `diff = Math.abs(pIdx - aIdx)`.
  - `diff === 0` → `'Correct'` (exact match).
  - `diff === 1` → `'Partially Correct'` (one grade off).
  - Anything else (`diff >= 2`) → `'Incorrect'`.
- **Calls:** (none)
- **Called by:** computeBiasAccuracyDisplay
- **Side effects:** None (pure function; reads module-level `ENV_ORDER` constant).
- **Notes:** `ENV_ORDER` and `ENV_WEIGHTS` are defined just above this function (lines 10460-10461) as shared constants for the whole Weekly Review accuracy suite.

#### computeLiquidityAccuracy(predictedDOL, actualReached)

- **File:** Trade_Journal/index.html (lines 10476-10510)
- **Module:** Weekly Review — Accuracy Computation
- **Purpose:** Scores how accurately the predicted "draw on liquidity" (DOL) reach level matched what was actually observed during the week, via an explicit case table.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| predictedDOL | string | One of `'not_reached'`, `'partial'`, `'reached'` — predicted at bias time |
| actualReached | string | One of the fixed phrase strings selected in the review UI, e.g. `'DOL fully reached'`, `'DOL partially reached'`, `'DOL not reached'`, `'Opposite side reached'`, `'Both sides reached'` |

- **Returns:** `Object` — `{result, explanation}`, `result` one of `'—'`, `'Correct'`, `'Partially Correct'`, `'Incorrect'`.
- **Internal logic:**
  - If either arg is falsy, returns placeholder `{result:'—', explanation:'Select liquidity reached above.'}`.
  - Maps `predictedDOL` to a human label via `dolMap` (computed but only used implicitly — `predLabel` itself isn't referenced in any returned explanation string, appears to be vestigial).
  - Explicit case table (evaluated in order, first match wins):
    - `actualReached==='DOL fully reached'` & `predictedDOL==='reached'` → Correct.
    - `actualReached==='DOL partially reached'` & `predictedDOL==='partial'` → Correct.
    - `actualReached==='DOL not reached'` & `predictedDOL==='not_reached'` → Correct.
    - `actualReached==='DOL fully reached'` & predicted was `'partial'` or `'not_reached'` → Partially Correct (prediction was too conservative).
    - `actualReached==='DOL partially reached'` & predicted was `'not_reached'` → Partially Correct.
    - `actualReached==='Opposite side reached'` → Incorrect (directionally wrong), regardless of prediction.
    - `actualReached==='Both sides reached'` → Partially Correct (two-sided market).
    - Fallback (any other combination not explicitly matched) → Partially Correct, generic explanation.
- **Calls:** (none)
- **Called by:** computeLiquidityAccuracyDisplay
- **Side effects:** None (pure function).
- **Notes:** The `dolMap`/`predLabel` local variable is computed but never actually used in any branch's output — dead code within the function (harmless, but a minor cleanup opportunity). No case exists for `predictedDOL==='reached'` combined with `actualReached==='DOL partially reached'` or `'DOL not reached'` — those fall through to the generic "Partially Correct" fallback rather than being explicitly classified as Incorrect, even though a fully-predicted-but-not-reached DOL seems like it should arguably be scored more harshly.

#### computeSwingPhaseAccuracy(predictedPhase, actualEvolved)

- **File:** Trade_Journal/index.html (lines 10512-10547)
- **Module:** Weekly Review — Accuracy Computation
- **Purpose:** Scores how accurately the predicted swing-phase (frontside/backside/range) matched what actually evolved during the week, via an explicit case table similar to `computeLiquidityAccuracy`.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| predictedPhase | string | One of `'frontside'`, `'backside'`, `'range'` |
| actualEvolved | string | One of the fixed review-UI phrase strings, e.g. `'Frontside played out as expected'`, `'Backside played out as expected'`, `'Range / consolidation dominated'`, `'Phase flipped unexpectedly'` |

- **Returns:** `Object` — `{result, explanation}`.
- **Internal logic:**
  - Placeholder result if either arg falsy.
  - Maps `predictedPhase` to a label via `phaseMap` (again computed but `predLabel` isn't used in any explanation string — same vestigial pattern as `computeLiquidityAccuracy`).
  - Case table:
    - Exact match cases (frontside/frontside, backside/backside, range/range) → Correct.
    - `actualEvolved==='Phase flipped unexpectedly'` → Incorrect, regardless of prediction (a structural invalidation always scores as wrong).
    - `actualEvolved==='Range/consolidation dominated'` when prediction was directional (frontside or backside) → Partially Correct (market didn't deliver the expected leg).
    - Frontside-actual/backside-predicted or backside-actual/frontside-predicted (direction right conceptually reversed) → Partially Correct ("direction was correct but phase timing was off" — note: this explanation text seems inverted/copy-pasted, since frontside vs backside are opposite legs, not the same direction with different timing; see Notes).
    - Fallback → Partially Correct, generic explanation.
- **Calls:** (none)
- **Called by:** computePhaseAccuracy
- **Side effects:** None (pure function).
- **Notes:** The explanation text for the "frontside actual vs backside predicted" (and vice versa) branches reads "the direction was correct but the phase timing was off," which is questionable phrasing since frontside/backside are typically opposite market phases, not merely differently-timed instances of the same direction — likely a copy/paste from a similar branch without fully rewriting the explanation for this specific mismatch. Same vestigial unused `phaseMap`/`predLabel` pattern as in `computeLiquidityAccuracy`.

#### computeEnvQualityValidation(predictedEnv, actualQuality)

- **File:** Trade_Journal/index.html (lines 10549-10565)
- **Module:** Weekly Review — Accuracy Computation
- **Purpose:** Validates whether the predicted environment grade's implied quality matches the actual subjectively-rated opportunity quality observed during the week, using numeric weight comparison rather than a case table.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| predictedEnv | string | One of `ENV_ORDER` values (`'A+'`,`'A'`,`'B'`,`'C'`,`'No Trade'`) |
| actualQuality | string | One of `'Exceptional'`, `'Good'`, `'Average'`, `'Poor'` |

- **Returns:** `Object` — `{result, explanation}`.
- **Internal logic:**
  - Placeholder if either arg falsy.
  - Maps `actualQuality` to a numeric score via `qualityMap` (`Exceptional:4, Good:3, Average:2, Poor:1`).
  - Looks up `envScore` from the module-level `ENV_WEIGHTS` map (defaulting to 3 if not found).
  - `diff = envScore - qualityScore`.
  - `diff === 0` → Correct.
  - `diff === 1 || diff === -1` → Partially Correct ("within one grade").
  - `diff >= 2` → Incorrect ("actual quality significantly worse" — over-estimated).
  - `diff <= -2` → Incorrect ("actual quality significantly better" — under-estimated).
  - Fallback → Partially Correct, generic explanation (technically unreachable given the above branches cover all integer diffs, but retained as a safety net).
- **Calls:** (none)
- **Called by:** computeEnvQualityValidationDisplay
- **Side effects:** None (pure function; reads module-level `ENV_WEIGHTS`).
- **Notes:** The final fallback branch is dead code in practice since every possible integer `diff` value is already covered by the four preceding conditions (0, ±1, ≥2, ≤-2 exhaustively partition all integers) — included defensively.

#### computeAutoAlignment(weekTrades, dominantOutcome)

- **File:** Trade_Journal/index.html (lines 10569-10582)
- **Module:** Weekly Review — Accuracy Computation
- **Purpose:** Automatically computes how well the week's actual closed swing trades aligned directionally with the week's realized dominant bias outcome, as a percentage-based classification, to feed into the process-adherence score.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| weekTrades | Array<Object> | All trades falling within the reviewed week (from `getWeekTrades`) |
| dominantOutcome | string | One of `'Strong Bullish'`, `'Mild Bullish'`, `'Strong Bearish'`, `'Mild Bearish'` (or other/falsy) — the week's realized directional outcome as selected in the review form |

- **Returns:** `Object` — `{alignment: 'Yes'|'Mostly'|'No'|null, reason: string, count: number, aligned?: number, pct?: number}`.
- **Internal logic:**
  - Maps `dominantOutcome` to a simplified direction (`'BULLISH'`/`'BEARISH'`) via `dirMap`; unmapped/falsy values yield `dominantDir = null`.
  - Filters `weekTrades` to closed, non-intraday trades that have a `biasPlayed` value set → `closed`.
  - If no `dominantDir` could be determined, returns `{alignment:null, reason:'no-direction', count: closed.length}` (can't judge alignment without knowing the realized direction).
  - If `closed.length === 0`, returns `{alignment:null, reason:'no-trades', count:0}` (nothing to judge).
  - Otherwise counts `aligned` = trades whose `biasPlayed` matches `dominantDir` exactly; computes `pct = aligned/closed.length`.
  - Classifies: `pct >= 0.7` → `'Yes'`; `pct <= 0.3` → `'No'`; otherwise → `'Mostly'`.
  - Returns `{alignment, reason:'computed', count: closed.length, aligned, pct}`.
- **Calls:** Array.prototype.filter
- **Called by:** computeProcessAdherenceDisplay
- **Side effects:** None (pure function).
- **Notes:** The 70%/30% thresholds are hard-coded magic numbers defining the three-tier classification band; the middle band (30%-70% aligned) is labeled "Mostly" regardless of which side of 50% it falls on.

#### computeProcessAdherence(alignment)

- **File:** Trade_Journal/index.html (lines 10584-10592)
- **Module:** Weekly Review — Accuracy Computation
- **Purpose:** Converts a bias-alignment classification (`'Yes'`/`'Mostly'`/`'No'`) into a human-readable process-adherence score/label pair for display in the weekly review.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| alignment | string \| null | The alignment classification, typically from `computeAutoAlignment` or a manually-selected value |

- **Returns:** `Object` — `{score: string, label: string}`.
- **Internal logic:**
  - If `alignment` is falsy, returns `{score:'—', label:'Select bias alignment above.'}`.
  - Looks up `alignment` in a fixed `map`: `'Yes'` → `{score:'Excellent', label:'Excellent — fully aligned with the weekly bias.'}`; `'Mostly'` → `{score:'Good', label:'Good — mostly aligned with the weekly bias.'}`; `'No'` → `{score:'Poor', label:'Poor — traded against the weekly bias.'}`.
  - If `alignment` doesn't match any of those three (e.g. some other string), falls back to `{score:'Fair', label:'Fair — some alignment with the weekly bias.'}`.
- **Calls:** (none)
- **Called by:** computeProcessAdherenceDisplay
- **Side effects:** None (pure function).
- **Notes:** None additional.

#### getWeekTrades(weekDate)

- **File:** Trade_Journal/index.html (lines 10594-10608)
- **Module:** Weekly Review — Accuracy Computation
- **Purpose:** Returns all trades (of any type) whose `date` falls within the Monday-through-Sunday calendar week containing the given date — the basis for all per-week performance aggregation in the review flow.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| weekDate | string | An ISO date string (`YYYY-MM-DD`) — any date within the target week (typically the weekly-bias entry's own `date` field) |

- **Returns:** `Array<Object>` — the subset of `S.trades` falling within that Monday-Sunday window.
- **Internal logic:**
  - Returns `[]` immediately if `weekDate` is falsy.
  - Parses `weekDate` as a local-midnight `Date` (`weekDate + 'T00:00:00'`).
  - Computes the day-of-week offset needed to reach Monday: JS `getDay()` returns 0=Sunday..6=Saturday; the code computes `diff = (day === 0 ? 6 : day - 1)` — i.e. Sunday is treated as 6 days after the preceding Monday, and any other day `day-1` days after Monday.
  - `monday` = `d` minus `diff` days; `sunday` = `monday` plus 6 days.
  - Filters `S.trades` to those with a truthy `date`, parsed the same local-midnight way, falling within `[monday, sunday]` inclusive.
- **Calls:** Array.prototype.filter
- **Called by:** openWeeklyReview, computeProcessAdherenceDisplay, triggerWeeklyAiReview
- **Side effects:** None (pure function).
- **Notes:** This week-boundary logic (Monday-start week) is duplicated conceptually wherever "this week's trades" is needed; the Sunday-as-day-0 handling (`day===0 ? 6 : day-1`) is the standard trick for converting JS's Sunday-first `getDay()` into a Monday-first week offset.

#### computePerformanceStats(trades)

- **File:** Trade_Journal/index.html (lines 10610-10622)
- **Module:** Weekly Review — Accuracy Computation
- **Purpose:** Computes summary performance statistics (win rate, net R, average R, largest winner/loser) for a given set of trades, scoped specifically to closed, non-intraday (swing) trades — used for the weekly review's performance panel.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| trades | Array<Object> | Candidate trade set (typically the week's trades, possibly pre-filtered by pair) |

- **Returns:** `Object` — `{count, wins, losses, winRate, netR, avgR, largestWinner, largestLoser}`.
- **Internal logic:**
  - Filters `trades` to `status==='closed' && !isIntraday` → `closed`.
  - Splits into `wins` (`result==='WIN'`) and `losses` (`result==='LOSS'`) subsets.
  - `count = closed.length`; `winRate = wins.length/count*100` (0 if count is 0).
  - Computes `rValues` via `calcR` over `closed`, filtering out nulls.
  - `netR` = sum of `rValues`; `avgR` = same sum divided by `rValues.length` (0 if empty) — note `netR` and the numerator of `avgR` are computed via two separate `.reduce()` calls over the same array rather than reusing one sum.
  - `largestWinner` = the largest positive R value (sorted descending, take first) or `0` if none positive.
  - `largestLoser` = the most negative R value (sorted ascending, take first) or `0` if none negative.
- **Calls:** Array.prototype.filter, calcR
- **Called by:** openWeeklyReview
- **Side effects:** None (pure function).
- **Notes:** `netR` is computed twice independently (once directly, once as the numerator inside the `avgR` expression) — functionally harmless but a minor redundancy.

#### openWeeklyReview(id)

- **File:** Trade_Journal/index.html (lines 10624-10769)
- **Module:** Weekly Review — Accuracy Computation
- **Purpose:** Opens and fully populates the Weekly Review modal for a given weekly-bias entry — displaying the auto-populated forecast summary (from the OMAR decision engine), pre-filling review fields (editable if still open, read-only/locked if already closed with a saved review), rendering AI-review content if present, and computing live week-to-date performance stats for entries still open.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| id | string/number | The weekly-bias entry's id to review |

- **Returns:** `void`.
- **Internal logic:**
  - Finds the weekly entry `w` in `S.weeklies` via `idEq`; if not found, shows an error toast and returns.
  - Sets `S.wrEditId = id` (tracks which entry the review modal is currently working on).
  - Runs the OMAR/weekly decision engine on the entry's saved checklist answers (`w.wbChecklistAnswers`) via `runWBEngine`, if present, to re-derive `envLabel`, `confLabel` (confidence, capitalized), `stateLabel` (market state), `dolLabel`, `phaseLabel`, `irlLabel` (internal reaction area), `sweepLabel` (external liquidity sweep) — all pulled from the specific named checklist answer ids (`wb_htf_dol`, `wb_swing_phase`, `wb_htf_irl`, `wb_ext_sweep`).
  - Maps `dolLabel`/`phaseLabel` to friendly display strings via inline lookup objects (`dolDisplay`, `phaseDisplay`); maps `irlLabel`/`sweepLabel` via the module-level `WB_DISPLAY.irl`/`WB_DISPLAY.sweep` lookup tables.
  - Renders `#wrPairDisplay` with `"{pair} — Week of {date}"`.
  - Renders `#wrSection1` innerHTML with a "Weekly Forecast Summary" grid showing Environment/Confidence/Market State/DOL Status/Swing Phase/Reaction Area/External Liquidity/Bias, all auto-populated from the (re-run) decision engine and the entry's own `bias` field.
  - Stashes the predicted values into `S.wrData` (`predictedEnv`, `predictedDOL`, `predictedPhase`, `predictedEnvQuality`) for use by the accuracy-computation functions once the user fills in "actual" values.
  - Updates three read-only display spans (`#wrPredictedDOL`, `#wrPredictedPhase`, `#wrPredictedEnv`) with the friendly display strings.
  - Determines `isClosed = w.status==='closed' && w.weeklyReview` and `r = isClosed ? w.weeklyReview : null`.
  - Renders the AI review block into `#wrAiReviewContainer` via `renderWeeklyAiReviewBlock(w)` if closed, else clears it.
  - Populates a list of 10 review input fields (actual environment, dominant outcome, structure outcome, liquidity reached, phase evolved, opportunity quality, and four lesson-learned text fields) from the saved review `r` if closed, else blank; each field is disabled (with dimmed/not-allowed styling) when `isClosed`, editable otherwise.
  - Hides the `#wrSaveBtn` entirely when `isClosed` (a closed review can't be re-saved through this modal).
  - **If closed:** renders the four accuracy-result blocks (`#wrBiasAccuracyDisplay`, `#wrLiquidityAccuracyDisplay`, `#wrPhaseAccuracyDisplay`, `#wrEnvQualityDisplay`) and the process-adherence block (`#wrProcessAdherenceDisplay`) directly from the saved `r.*Accuracy`/`r.processAdherence` sub-objects (bold result + explanation text); shows a "REVIEW COMPLETED — {date}" banner in `#wrReviewDashboard`; renders the saved `r.performanceStats` into `#wrPerformanceStats` as a formatted stat-row table (count, wins/losses, win rate with bull/bear coloring, net R, average R, largest winner/loser), using stored numbers rather than recomputing live.
  - **If not closed:** sets all those same display elements to placeholder prompt text ("Select … above.") and `#wrPerformanceStats` to `"Loading trades for this week…"`.
  - After a `setTimeout(…, 50)` delay (to let the modal finish rendering before a heavier computation): if `isClosed`, skips (no need to recompute, already showing saved stats); otherwise fetches `weekTrades = getWeekTrades(w.date).filter(t => t.pair === w.pair)` (this week's trades for the SAME currency pair as the weekly bias), computes `stats = computePerformanceStats(weekTrades)`, formats win rate/net R/avg R strings, and re-renders `#wrPerformanceStats` with the live numbers; also stashes `stats` into `S.wrData.performanceStats` for later use (presumably by `saveWeeklyReview` when the user eventually submits the review).
  - Finally adds the `open` class to `#weeklyReviewModal` to display it.
- **Calls:** idEq, showToast, runWBEngine, renderWeeklyAiReviewBlock, getWeekTrades, Array.prototype.filter, computePerformanceStats
- **Called by:** closeWeeklyBias, renderWeekly, renderClosed
- **Side effects:** Extensive DOM mutation across ~20 `#wr*` elements (text/innerHTML/disabled/style) and the modal's open state; mutates `S.wrEditId` and `S.wrData` (predicted values + performance stats).
- **Notes:** The 50ms `setTimeout` for the live stats recompute is a deliberate deferral to let the rest of the modal paint first — this is the one place in the function that does real (filtered) computation rather than just reading already-saved review data, and it's skipped entirely for already-closed reviews since those show frozen, saved numbers instead of live recalculation (an important distinction: a closed weekly's stats will NOT reflect any trades added/edited after the review was completed, by design).


---

## Trade_Journal — Functions (chunk 2 of 8, lines 10771-12510)

### Module: Weekly Review — Accuracy Computation Engine

#### computeAllAccuracies()

- **File:** Trade_Journal/index.html (lines 10771-10778)
- **Module:** Weekly Review — Accuracy Computation Engine
- **Purpose:** Orchestrator that recomputes every auto-graded accuracy metric on the Weekly Review modal (bias, liquidity, phase, environment quality, process adherence) and refreshes the summary dashboard, typically wired to `onchange` handlers of the review form's dropdowns.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Calls each of the five `compute*Display` functions in sequence.
  - Calls `updateReviewDashboard()` last to refresh the aggregated summary panel.
- **Calls:** computeBiasAccuracyDisplay, computeLiquidityAccuracyDisplay, computePhaseAccuracy, computeEnvQualityValidationDisplay, computeProcessAdherenceDisplay, updateReviewDashboard
- **Called by:** (none detected — verify: likely wired via inline `onchange="computeAllAccuracies()"` attributes on the Weekly Review modal's `<select>` elements, e.g. `wrActualEnv`, `wrLiquidityReached`, `wrPhaseEvolved`, `wrOpportunityQuality`, `wrDominantOutcome`)
- **Side effects:** None directly (delegates all DOM/state mutation to the called functions).
- **Notes:** Pure dispatcher with no guards; if any downstream function throws it aborts the rest of the chain.

#### computeBiasAccuracyDisplay()

- **File:** Trade_Journal/index.html (lines 10780-10793)
- **Module:** Weekly Review — Accuracy Computation Engine
- **Purpose:** Compares the predicted weekly environment (`S.wrData.predictedEnv`) against the reviewer's selected actual environment outcome, renders a color-coded verdict badge, and stashes the result on `S.wrData`.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Reads `S.wrData.predictedEnv` (set earlier when the review modal was opened, presumably from the weekly bias's engine output) and the current value of `#wrActualEnv`.
  - Delegates the actual comparison logic to `computeBiasAccuracy(predicted, actual)` (defined outside this chunk).
  - Maps `result.result` ('Correct' / 'Partially Correct' / 'Incorrect' / other) to a CSS badge class.
  - Injects a badge + explanation string into `#wrBiasAccuracyDisplay`.
  - Persists `result` to `S.wrData.biasAccuracy`.
- **Calls:** computeBiasAccuracy
- **Called by:** computeAllAccuracies
- **Side effects:** DOM: writes innerHTML of `#wrBiasAccuracyDisplay`. Global state: `S.wrData.biasAccuracy`.
- **Notes:** No guard against `predicted` being undefined; if the review is opened for a weekly with no prior engine run, `computeBiasAccuracy` must handle that itself.

#### computeLiquidityAccuracyDisplay()

- **File:** Trade_Journal/index.html (lines 10795-10808)
- **Module:** Weekly Review — Accuracy Computation Engine
- **Purpose:** Same pattern as `computeBiasAccuracyDisplay` but for the predicted draw-on-liquidity (DOL) target vs. actual liquidity reached.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Reads `S.wrData.predictedDOL` and `#wrLiquidityReached`.value.
  - Delegates to `computeLiquidityAccuracy(predicted, actual)`.
  - Maps result to badge class, writes HTML into `#wrLiquidityAccuracyDisplay`.
  - Stores result on `S.wrData.liquidityAccuracy`.
- **Calls:** computeLiquidityAccuracy
- **Called by:** computeAllAccuracies
- **Side effects:** DOM: `#wrLiquidityAccuracyDisplay` innerHTML. Global state: `S.wrData.liquidityAccuracy`.
- **Notes:** Identical structure to `computeBiasAccuracyDisplay` — could be refactored into one generic helper parameterized by field names.

#### computePhaseAccuracy()

- **File:** Trade_Journal/index.html (lines 10810-10823)
- **Module:** Weekly Review — Accuracy Computation Engine
- **Purpose:** Compares predicted swing phase evolution vs. actual phase evolved during the week, renders badge.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Reads `S.wrData.predictedPhase` and `#wrPhaseEvolved`.value.
  - Delegates to `computeSwingPhaseAccuracy(predicted, actual)`.
  - Renders badge into `#wrPhaseAccuracyDisplay`.
  - Stores result on `S.wrData.phaseAccuracy`.
- **Calls:** computeSwingPhaseAccuracy
- **Called by:** computeAllAccuracies
- **Side effects:** DOM: `#wrPhaseAccuracyDisplay` innerHTML. Global state: `S.wrData.phaseAccuracy`.
- **Notes:** Despite the name lacking "Display" (unlike its siblings), it behaves identically — writes DOM directly rather than returning a value.

#### computeEnvQualityValidationDisplay()

- **File:** Trade_Journal/index.html (lines 10825-10838)
- **Module:** Weekly Review — Accuracy Computation Engine
- **Purpose:** Compares predicted environment quality vs. actual opportunity quality reported by the trader, renders badge.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Reads `S.wrData.predictedEnvQuality` and `#wrOpportunityQuality`.value.
  - Delegates to `computeEnvQualityValidation(predicted, actual)`.
  - Renders badge into `#wrEnvQualityDisplay`.
  - Stores result on `S.wrData.envQualityValidation`.
- **Calls:** computeEnvQualityValidation
- **Called by:** computeAllAccuracies
- **Side effects:** DOM: `#wrEnvQualityDisplay` innerHTML. Global state: `S.wrData.envQualityValidation`.
- **Notes:** Same badge-class mapping duplicated a fourth time.

#### computeProcessAdherenceDisplay()

- **File:** Trade_Journal/index.html (lines 10840-10872)
- **Module:** Weekly Review — Accuracy Computation Engine
- **Purpose:** Determines how well the trader's actual intraday/daily trades that week aligned with the stated weekly bias direction, and renders a process-adherence score badge — with early-exit messaging when there's no clear direction or no trades to evaluate.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Finds the weekly bias `w` in `S.weeklies` by `idEq(w.id, S.wrEditId)`.
  - Reads `#wrDominantOutcome`.value.
  - Computes `weekTrades` = `getWeekTrades(w.date)` filtered to trades matching `w.pair` (only if `w` exists, else `[]`).
  - Calls `computeAutoAlignment(weekTrades, dominantOutcome)` to get `{alignment, reason, aligned, count}`.
  - Stores `auto.alignment` on `S.wrData.autoAlignment`.
  - **Guard 1:** if `auto.reason === 'no-direction'`, writes a muted "no clear direction" message, sets `S.wrData.processAdherence = {score:'—', label:'No clear direction that week.'}`, calls `updateReviewDashboard()`, and returns early.
  - **Guard 2:** if `auto.reason === 'no-trades'`, writes "no trades taken" message, sets a similar placeholder `processAdherence`, calls `updateReviewDashboard()`, and returns early.
  - Otherwise calls `computeProcessAdherence(auto.alignment)` to get a `{score, label}` result, maps `score` ('Excellent'/'Good'/'Fair'/'Poor') to badge class, renders badge + "(aligned/count trades aligned)" text into `#wrProcessAdherenceDisplay`.
  - Stores `result` on `S.wrData.processAdherence` and calls `updateReviewDashboard()`.
- **Calls:** idEq, getWeekTrades, filter, computeAutoAlignment, updateReviewDashboard, computeProcessAdherence
- **Called by:** computeAllAccuracies
- **Side effects:** DOM: `#wrProcessAdherenceDisplay` innerHTML. Global state: `S.wrData.autoAlignment`, `S.wrData.processAdherence`.
- **Notes:** The only one of the five accuracy functions with early-return guards and the only one that itself calls `updateReviewDashboard()` (the others rely on `computeAllAccuracies` to do it once at the end); this means when called via `computeAllAccuracies` the dashboard can be updated twice in the no-direction/no-trades paths (once here, once by the caller).

#### updateReviewDashboard()

- **File:** Trade_Journal/index.html (lines 10874-10902)
- **Module:** Weekly Review — Accuracy Computation Engine
- **Purpose:** Renders the aggregated "Review Dashboard" summary panel showing all five accuracy verdicts plus performance stats (trade count, win rate, net R) for the weekly review being edited.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Reads `S.wrData.biasAccuracy`, `.liquidityAccuracy`, `.phaseAccuracy`, `.envQualityValidation`, `.processAdherence`, `.performanceStats`, each defaulted to a placeholder object if unset.
  - Defines local `badge(r)` arrow function mapping result strings to emoji-prefixed labels ('✅ Correct', '⚠️ Partially Correct', '❌ Incorrect', else '—').
  - Builds a 2-column grid of labeled stat lines using the `badge()` helper for the four "Correct/Incorrect"-style metrics and the raw `.score`/`.label` for process adherence.
  - Appends a footer showing trade count, win rate (formatted to 1 decimal, or '—' if count is 0), and net R (with +/- sign, 2 decimals).
  - Appends a timestamp line: "Review completed: " + current date/time formatted via `en-GB` locale.
  - Writes the composed HTML into `#wrReviewDashboard`.
- **Calls:** badge (local const-arrow)
- **Called by:** computeAllAccuracies, computeProcessAdherenceDisplay
- **Side effects:** DOM: `#wrReviewDashboard` innerHTML.
- **Notes:** The "Review completed" timestamp is regenerated every call (i.e., every keystroke/dropdown change while filling the review), not just once at save time — cosmetic only, does not affect the persisted `completedAt` set in `saveWeeklyReview`.

#### badge(r)

- **File:** Trade_Journal/index.html (lines 10882-10887)
- **Module:** Weekly Review — Accuracy Computation Engine
- **Purpose:** Small local helper (const arrow function scoped inside `updateReviewDashboard`) that maps an accuracy result string to a display label with emoji.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| r | string | One of 'Correct', 'Partially Correct', 'Incorrect', or any other/undefined value |

- **Returns:** string — '✅ Correct', '⚠️ Partially Correct', '❌ Incorrect', or '—' for anything else.
- **Internal logic:** Sequential if/else string comparison, default fallback '—'.
- **Calls:** (none)
- **Called by:** updateReviewDashboard
- **Side effects:** None (pure function).
- **Notes:** Not globally accessible — it's a closure-local const, so it cannot be called from outside `updateReviewDashboard`; the "called by" is limited to its own enclosing function despite the JSON scoping it as a top-level entry.

### Module: Weekly Bias — Review Save/Close Lifecycle

#### saveWeeklyReview()

- **File:** Trade_Journal/index.html (lines 10904-10964)
- **Module:** Weekly Bias — Review Save/Close Lifecycle
- **Purpose:** Validates and persists the completed Weekly Review form, marking the weekly bias entry as "closed", then optionally kicks off an async AI review via Gemini.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Finds `w` in `S.weeklies` via `idEq(w.id, S.wrEditId)`; if not found, shows an error toast and aborts.
  - Reads all review form field values: `wrActualEnv`, `wrDominantOutcome`, `wrStructureOutcome`, `wrLiquidityReached`, `wrPhaseEvolved`, `wrOpportunityQuality`, plus free-text lesson fields (`wrLessonWorked`, `wrLessonFailed`, `wrLessonSurprised`, `wrLessonFocus`).
  - Reads `S.wrData.autoAlignment` for `biasAlignment`.
  - **Validation guard:** if any of the six required dropdowns is empty, shows `alert(...)` and aborts (no save).
  - Builds a `review` object bundling all form values, the lessons sub-object, all five auto-computed accuracy results (falling back to placeholder objects if unset), and `completedAt: new Date().toISOString()`.
  - Sets `w.weeklyReview = review`, `w.status = 'closed'`, `w.closedAt = new Date().toISOString()`.
  - Calls `saveWeekly(w)` to persist (Supabase + local cache, per global architecture).
  - Closes the `#weeklyReviewModal` (removes `.open` class), clears `S.wrEditId` and `S.wrData`.
  - Calls `renderWeekly()` and `updateWeeklyBadge()` to refresh UI.
  - Shows a success toast.
  - If a Gemini API key is present (`_geminiKey()` truthy), schedules `triggerWeeklyAiReview(w.id)` via `setTimeout(..., 500)` — non-blocking, fire-and-forget.
- **Calls:** idEq, showToast, saveWeekly, remove (DOM classList.remove), renderWeekly, updateWeeklyBadge, _geminiKey, triggerWeeklyAiReview
- **Called by:** (none detected — verify: almost certainly bound via inline `onclick="saveWeeklyReview()"` on the Weekly Review modal's save button, e.g. `#wrSaveBtn`)
- **Side effects:** Global state: `w.weeklyReview`, `w.status`, `w.closedAt` mutated in place within `S.weeklies`; `S.wrEditId`/`S.wrData` reset. DOM: removes `.open` from `#weeklyReviewModal`. Persistence: `saveWeekly(w)` (Supabase `weeklies` table write + local cache). Network: conditionally triggers a delayed Gemini AI review call.
- **Notes:** The 500ms delay before triggering the AI review is likely to let the save/UI-refresh settle before firing a second async flow; there's no loading indicator shown for the AI review kickoff itself (that's presumably handled inside `triggerWeeklyAiReview`).

#### closeWeeklyReview()

- **File:** Trade_Journal/index.html (lines 10966-10992)
- **Module:** Weekly Bias — Review Save/Close Lifecycle
- **Purpose:** Cancels/dismisses the Weekly Review modal, with an unsaved-progress confirmation guard for reviews still in progress, and re-enables any fields that may have been disabled (e.g. when viewing an already-completed review read-only).
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - If `S.wrEditId` is set: looks up `w`; determines `isClosed` = weekly status is 'closed' AND has a `weeklyReview`.
  - If NOT already closed (i.e., a review is being actively filled out): checks whether any of `wrActualEnv`, `wrLiquidityReached`, `wrLessonWorked` has a non-empty value (`hasInput`); if so, prompts `confirm(...)` and aborts (returns) if the user cancels.
  - Regardless of the confirm outcome (if not aborted) or if already closed: iterates a fixed list of review field ids and re-enables each (`disabled = false`, clears inline `opacity`/`cursor` styles) — this undoes the read-only styling applied when viewing a completed review.
  - Re-shows the `#wrSaveBtn` (clears `display` style) if present.
  - Removes `.open` from `#weeklyReviewModal`, clears `S.wrEditId` and `S.wrData`.
- **Calls:** idEq, remove (classList.remove / forEach el mutation)
- **Called by:** (none detected — verify: bound via inline `onclick="closeWeeklyReview()"` on the modal's close/cancel button, e.g. `×` icon)
- **Side effects:** DOM: enables/re-styles 10 form fields, shows `#wrSaveBtn`, closes `#weeklyReviewModal`. Global state: clears `S.wrEditId`, `S.wrData`.
- **Notes:** The re-enable loop is defensive cleanup, presumably countering `openWeeklyReview` (defined elsewhere) disabling fields when displaying an already-completed/read-only review.

#### closeWeeklyBias(id)

- **File:** Trade_Journal/index.html (lines 10994-11010)
- **Module:** Weekly Bias — Review Save/Close Lifecycle
- **Purpose:** Entry point for the "REVIEW & CLOSE" button on an open weekly bias card; guards against re-reviewing an already-reviewed weekly and warns about open linked intraday trades before opening the review modal.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| id | string/number | Weekly bias record id |

- **Returns:** void
- **Internal logic:**
  - Finds `w` in `S.weeklies` by `idEq`; aborts silently if not found.
  - If `w.weeklyReview` already exists: prompts `confirm('...already has a review. Re-open it?')`; if confirmed, calls `openWeeklyReview(id)` and returns; if cancelled, function ends (no-op).
  - Otherwise, finds `linkedIntra` = trades where `t.isIntraday && idEq(t.weeklyLinkId, id) && t.status === 'open'`.
  - If any linked open intraday trades exist, prompts a confirm warning; if cancelled, aborts.
  - Otherwise (or after confirming to proceed anyway) calls `openWeeklyReview(id)`.
- **Calls:** idEq, openWeeklyReview, filter
- **Called by:** renderWeekly (via inline `onclick="closeWeeklyBias('${w.id}')"` on the "📋 REVIEW & CLOSE" button)
- **Side effects:** None directly besides invoking `openWeeklyReview` (which is outside this chunk) and blocking `confirm()` dialogs.
- **Notes:** Despite its name, this function does not itself close anything — it only gatekeeps opening the review modal; actual closing happens in `saveWeeklyReview`.

#### reopenWeeklyBias(id)

- **File:** Trade_Journal/index.html (lines 11012-11024)
- **Module:** Weekly Bias — Review Save/Close Lifecycle
- **Purpose:** Reverts a closed weekly bias back to 'open' status, preserving the existing review but stamping a `reopenedAt` timestamp on it.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| id | string/number | Weekly bias record id |

- **Returns:** void
- **Internal logic:**
  - Finds `w` via `idEq`; aborts if not found.
  - Sets `w.status = 'open'`, `w.closedAt = null`.
  - If `w.weeklyReview` exists, sets `w.weeklyReview.reopenedAt = new Date().toISOString()` (keeps the review data, just annotates it).
  - Calls `saveWeekly(w)`, `renderWeekly()`, `updateWeeklyBadge()`, `refreshIntraWeeklyDropdown()`.
- **Calls:** idEq, saveWeekly, renderWeekly, updateWeeklyBadge, refreshIntraWeeklyDropdown
- **Called by:** renderWeekly (via inline `onclick="reopenWeeklyBias('${w.id}')"` on the "REOPEN" button)
- **Side effects:** Global state: mutates `w.status`, `w.closedAt`, possibly `w.weeklyReview.reopenedAt` in `S.weeklies`. Persistence: `saveWeekly` (Supabase `weeklies` write). DOM: re-renders weekly list and badges, refreshes the intraday-linking dropdown.
- **Notes:** No confirmation dialog before reopening (unlike delete/close actions) — reopening is treated as low-risk/reversible.

### Module: Weekly Bias — List Rendering

#### renderWeekly()

- **File:** Trade_Journal/index.html (lines 11026-11154)
- **Module:** Weekly Bias — List Rendering
- **Purpose:** Main renderer for the Weekly Bias page — builds the tag filter bar and renders open and closed weekly bias cards (each showing bias direction, notes, screenshots, update timeline, linked daily-bias trades, review summary, and action buttons).
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Reads active tag filter from `S.weeklyTagFilter`.
  - Splits `S.weeklies` into `openList` (status !== 'closed') and `closedList` (status === 'closed'), both filtered by the active tag if set.
  - Computes `allTags` = deduped set of all tags across all weeklies; renders the filter bar (`#weeklyTagFilter`) with an "ALL" chip plus one chip per tag, each with an inline `onclick="setWeeklyTagFilter(...)"`.
  - If `#weeklyContainer` doesn't exist, aborts.
  - If both lists are empty, renders an empty-state message (mentioning the active tag if any) and returns.
  - Defines a local `renderCards(arr)` closure that maps each weekly `w` to an HTML card string:
    - Computes bias direction class/symbol (▲ bullish / ▼ bearish / — neutral).
    - Renders tag chips.
    - Builds lazy-loaded screenshot summary (`toggleWbScreenshots` on click) if `w.screenshots` non-empty.
    - Builds a reversed "notes timeline" from `w.updates`, each with a timestamp (`formatTsWithNY`), rich-text body (`rteDisplay`), and lazy screenshot toggle (`toggleWbUpdateScreenshots`) per update.
    - Finds `linkedDaily` = trades where `!d.isIntraday && idEq(d.wbEntryId, w.id)`; renders a list of linked daily-bias entries, each clickable to `openTradeHistory` (if closed) or `openChecklistEdit` (if open).
    - Runs the Weekly OMAR engine on `w.wbChecklistAnswers` (if present) via `runWBEngine`, and renders a decision dashboard via `renderWBDecisionDashboard(wbResult, answers, true)`.
    - Computes a "REVIEWED"/"NO REVIEW" badge based on whether `w.weeklyReview` has keys.
    - If reviewed, builds a `reviewSummary` block showing bias accuracy result, process adherence score, trade count, and win rate.
    - Assembles the full card with header (pair, week date, status, review badge, tags), bias badge, engine dashboard, notes, screenshots, updates timeline, linked daily list, review summary, and an actions row whose buttons differ for open vs. closed weeklies (+ADD NOTE / +NEW INTRADAY / EDIT / REVIEW & CLOSE for open; VIEW REVIEW / REOPEN for closed; DEL always).
  - Concatenates `renderCards(openList)`, and if `closedList.length > 0`, appends a "CLOSED ENTRIES (n)" divider header with a link (`onclick="S.closedActiveChips=['weekly'];navTo('closed')"`) to view them on the unified Closed Trades page, followed by... (note: closed cards themselves are NOT appended in this function — only the divider/link is shown; actual closed weekly rendering happens on the "closed" page via a different renderer).
  - Writes final HTML into `#weeklyContainer`.
- **Calls:** filter, setWeeklyTagFilter, toggleWbScreenshots, formatTsWithNY, rteDisplay, toggleWbUpdateScreenshots, idEq, openTradeHistory, openChecklistEdit, runWBEngine, renderWBDecisionDashboard, openAddNoteModal, newIntradayFromWeekly, openEditWeeklyModal, closeWeeklyBias, openWeeklyReview, reopenWeeklyBias, deleteWeeklyBias, navTo
- **Called by:** navTo, saveWeeklyBias, saveWeeklyReview, reopenWeeklyBias, setWeeklyTagFilter, toggleWeeklyShowClosed, deleteWbScreenshot, deleteWeeklyBias, saveWbNote, triggerWeeklyAiReview
- **Side effects:** DOM: writes innerHTML of `#weeklyTagFilter` and `#weeklyContainer`; embeds numerous inline `onclick` handlers referencing other functions by id.
- **Notes:** Interesting design detail: closed weeklies are summarized only via a link-out to the "Closed Trades" page rather than rendered inline here, even though `closedList` is computed — meaning the closed-card markup for weekly bias may live in a separate `renderClosed`-family function that this chunk's `deleteWeeklyBias` inbound-caller list references (`renderClosed`).

#### setWeeklyTagFilter(tag)

- **File:** Trade_Journal/index.html (lines 11156-11157)
- **Module:** Weekly Bias — List Rendering
- **Purpose:** Sets the active tag filter for the Weekly Bias list and re-renders it.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| tag | string | Tag name to filter by, or '' for "ALL" |

- **Returns:** void
- **Internal logic:** Assigns `S.weeklyTagFilter = tag`; calls `renderWeekly()`.
- **Calls:** renderWeekly
- **Called by:** renderWeekly (via inline `onclick="setWeeklyTagFilter('...')"` on filter chips)
- **Side effects:** Global state: `S.weeklyTagFilter`. DOM: full re-render of weekly list via `renderWeekly`.
- **Notes:** One-line function, minimal logic.

#### toggleWeeklyShowClosed()

- **File:** Trade_Journal/index.html (lines 11159-11160)
- **Module:** Weekly Bias — List Rendering
- **Purpose:** Toggles a boolean flag controlling whether closed weekly bias entries are shown, then re-renders.
- **Parameters:** None
- **Returns:** void
- **Internal logic:** Flips `S.weeklyShowClosed = !S.weeklyShowClosed`; calls `renderWeekly()`.
- **Calls:** renderWeekly
- **Called by:** (none detected — verify: likely bound to a "Show Closed" toggle button via inline onclick, though not visibly used inside `renderWeekly`'s current logic; possibly vestigial/legacy since `renderWeekly` itself doesn't appear to branch on `S.weeklyShowClosed`)
- **Side effects:** Global state: `S.weeklyShowClosed`.
- **Notes:** `renderWeekly()`'s current implementation (as read in this chunk) doesn't reference `S.weeklyShowClosed` anywhere — this toggle may be dead/legacy code left over from a prior UI design, or the flag is consumed elsewhere outside this chunk.

#### deleteWbScreenshot(wId, ssIdx)

- **File:** Trade_Journal/index.html (lines 11162-11169)
- **Module:** Weekly Bias — List Rendering
- **Purpose:** Deletes a single screenshot from a weekly bias entry's screenshot array after user confirmation.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| wId | string/number | Weekly bias record id |
| ssIdx | number | Index into `w.screenshots` array to remove |

- **Returns:** void
- **Internal logic:**
  - `confirm('Delete this screenshot?')`; aborts if cancelled.
  - Finds `w` via `idEq`; aborts if not found.
  - Splices `ssIdx` out of `w.screenshots`.
  - Calls `saveWeekly(w)` and `renderWeekly()`.
- **Calls:** idEq, saveWeekly, renderWeekly
- **Called by:** toggleWbScreenshots (outside this chunk, presumably rendering a delete "x" button per thumbnail with inline onclick)
- **Side effects:** Global state: mutates `w.screenshots` array in place. Persistence: `saveWeekly` (Supabase write — note this only updates the `weeklies` row metadata, doesn't appear to delete the actual file from Supabase Storage `screenshots` bucket within this function).
- **Notes:** Does not call any storage-deletion helper here, so the underlying stored image blob may become orphaned in the `screenshots` bucket unless `saveWeekly` or another mechanism handles cleanup.

#### openEditWeeklyModal(id)

- **File:** Trade_Journal/index.html (lines 11171-11192)
- **Module:** Weekly Bias — List Rendering
- **Purpose:** Opens the Weekly Bias edit modal pre-populated with an existing weekly bias entry's data (pair, date, notes, tags, checklist answers) for in-place editing.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| id | string/number | Weekly bias record id to edit |

- **Returns:** void
- **Internal logic:**
  - Finds `w` via `idEq`; aborts if not found.
  - Sets `S.wbEditId = id`, `_pendingUploadTradeId = id` (so any new screenshot uploads during this edit session attach to this record's id).
  - Initializes `S.wbData = {bias: w.bias || ''}`, resets `S.wbSS = []` and `S.wbKills = {}`.
  - Deep-clones `w.wbChecklistAnswers` into `S.wbAnswers` (via `JSON.parse(JSON.stringify(...))`), defaulting to `{}`.
  - Sets modal title text to "EDIT — {pair}", save button label to "💾 SAVE CHANGES".
  - Populates `#wbPair` and `#wbDate` fields; calls `rteSet('wbNotes', w.notes || '')` to load rich-text notes.
  - Clears `#wbSsGrid` (existing screenshots UI presumably lazy-rendered elsewhere).
  - Sets `S.wbTags = [...(w.tags || ['weekly'])]`; clears any existing removable tag chips in `#wbTagWrap` and re-renders them via `renderTagsInWrap`.
  - Calls `renderWBCards()` to render the weekly checklist question cards pre-filled with `S.wbAnswers`.
  - Adds `.open` class to `#weeklyModal`.
- **Calls:** idEq, rteSet, remove (querySelectorAll .tag.rm forEach remove), renderTagsInWrap, renderWBCards
- **Called by:** renderWeekly (via inline `onclick="openEditWeeklyModal('${w.id}')"` on the "✏ EDIT" button)
- **Side effects:** Global state: `S.wbEditId`, `_pendingUploadTradeId`, `S.wbData`, `S.wbSS`, `S.wbKills`, `S.wbAnswers`, `S.wbTags`. DOM: sets modal title/button text, form field values, clears/rebuilds tag chips and screenshot grid, opens `#weeklyModal`.
- **Notes:** Defaults `w.tags` to `['weekly']` if the record has no tags — ensures every weekly always carries at least the "weekly" tag once edited.

#### deleteWeeklyBias(id)

- **File:** Trade_Journal/index.html (lines 11194-11204)
- **Module:** Weekly Bias — List Rendering
- **Purpose:** Permanently deletes a weekly bias entry (and its associated Supabase Storage screenshots) after confirmation.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| id | string/number | Weekly bias record id to delete |

- **Returns:** void
- **Internal logic:**
  - `confirm('Delete this weekly bias permanently?')`; aborts if cancelled.
  - Calls `deleteWeeklySupa(id)` (outside this chunk) — an async operation that presumably looks up and deletes the entry's screenshots from Supabase Storage plus the `weeklies` row — and chains a `.then()`.
  - Inside the `.then()` callback (i.e., only after the Supabase deletion resolves): filters `id` out of `S.weeklies`, calls `renderWeekly()`, `updateWeeklyBadge()`, `refreshIntraWeeklyDropdown()`.
  - A code comment explicitly notes the ordering requirement: `S.weeklies` must NOT be filtered before `deleteWeeklySupa` runs, because that function needs to still find the weekly in `S.weeklies` to collect its screenshot URLs for storage cleanup.
- **Calls:** deleteWeeklySupa, filter, idEq, renderWeekly, updateWeeklyBadge, refreshIntraWeeklyDropdown
- **Called by:** renderWeekly (inline `onclick="deleteWeeklyBias('${w.id}')"`), renderClosed (elsewhere in the file, for closed-list delete buttons)
- **Side effects:** Global state: removes entry from `S.weeklies` array (post-async). Persistence: Supabase deletes via `deleteWeeklySupa` (likely `weeklies` table row + Storage objects in `screenshots` bucket). DOM: re-renders weekly list and badge, refreshes intraday link dropdown.
- **Notes:** Fully async/non-blocking from the caller's perspective — the local array isn't touched until the promise resolves, so a slow network could leave the UI showing the (soon to be deleted) entry momentarily after the confirm dialog.

#### openAddNoteModal(id)

- **File:** Trade_Journal/index.html (lines 11206-11216)
- **Module:** Weekly Bias — List Rendering
- **Purpose:** Opens the "Add Note" modal for appending a timestamped note/screenshot update to a weekly bias entry.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| id | string/number | Weekly bias record id to add a note to |

- **Returns:** void
- **Internal logic:**
  - Sets `S.wbNoteEditId = id`, `_pendingUploadTradeId = id`, resets `S.wbnSS = []` (note-specific screenshot buffer).
  - Finds `w` via `idEq`; aborts (after already mutating the above state) if not found.
  - Sets modal title to "ADD NOTE — {pair}".
  - Clears rich-text field `wbNoteText` via `rteSet('wbNoteText', '')` and clears `#wbNSsGrid`.
  - Adds `.open` to `#wbNoteModal`.
- **Calls:** idEq, rteSet
- **Called by:** renderWeekly (inline `onclick="openAddNoteModal('${w.id}')"` on "+ ADD NOTE" button)
- **Side effects:** Global state: `S.wbNoteEditId`, `_pendingUploadTradeId`, `S.wbnSS`. DOM: sets modal title, clears note text/screenshot grid, opens `#wbNoteModal`.
- **Notes:** If `w` is not found, the function has already set `_pendingUploadTradeId`/`S.wbNoteEditId` to the (invalid) `id` before returning — a minor inconsistency but harmless since the modal never opens in that path.

#### saveWbNote()

- **File:** Trade_Journal/index.html (lines 11218-11231)
- **Module:** Weekly Bias — List Rendering
- **Purpose:** Persists a new note/screenshot update onto the weekly bias entry currently targeted by `S.wbNoteEditId`, appending it to the entry's `updates` timeline array.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Finds `w` via `idEq(w.id, S.wbNoteEditId)`; aborts if not found.
  - Reads and trims rich-text content via `rteGet('wbNoteText')`.
  - Guard: if text is empty AND `S.wbnSS.length === 0`, alerts "Add a note or screenshot." and aborts.
  - Guard: if any screenshot in `S.wbnSS` has `_uploading === true`, shows a warning toast and aborts (prevents saving mid-upload).
  - Initializes `w.updates = w.updates || []`; pushes `{text, screenshots: [...S.wbnSS], at: new Date().toISOString()}`.
  - Calls `saveWeekly(w)`; closes `#wbNoteModal`; clears `S.wbNoteEditId` and `S.wbnSS`; calls `renderWeekly()`.
- **Calls:** idEq, rteGet, showToast, saveWeekly, remove (classList.remove), renderWeekly
- **Called by:** (none detected — verify: bound via inline `onclick="saveWbNote()"` on the Add Note modal's save button)
- **Side effects:** Global state: appends to `w.updates` array in `S.weeklies`; clears `S.wbNoteEditId`/`S.wbnSS`. Persistence: `saveWeekly` (Supabase `weeklies` write). DOM: closes modal, re-renders weekly list.
- **Notes:** Uploading-in-progress guard mirrors the pattern used throughout the file (`saveIntradayIdea`, `saveIdeaAsOpen`) to avoid saving a screenshot reference before its upload completes.

#### newIntradayFromWeekly(weeklyId)

- **File:** Trade_Journal/index.html (lines 11233-11242)
- **Module:** Weekly Bias — List Rendering
- **Purpose:** Navigates to the Intraday tab and pre-links a new intraday setup form to the given weekly bias entry.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| weeklyId | string/number | Weekly bias record id to link the new intraday idea to |

- **Returns:** void
- **Internal logic:**
  - Calls `navTo('intraday')` to switch pages.
  - Schedules a `setTimeout(..., 100)` callback (delay lets the intraday page DOM render/become available) that:
    - Sets `#intraWeeklyLink` select value to `weeklyId` and calls `onIntraWeeklyLink()` to populate the linked-context UI, if the select element exists.
    - Sets `S.intradayView = 'form'` and calls `renderIntradayView()` to show the new-setup form immediately (rather than the list view).
- **Calls:** navTo, onIntraWeeklyLink, renderIntradayView
- **Called by:** renderWeekly (inline `onclick="newIntradayFromWeekly('${w.id}')"` on "⚡ NEW INTRADAY" button)
- **Side effects:** Global state: `S.intradayView`. DOM: navigates page, sets `#intraWeeklyLink` value, triggers dependent re-renders.
- **Notes:** The 100ms delay is a common pattern in this file to sequence DOM-ready timing after `navTo` swaps visible pages; a race condition is possible if `navTo` takes longer than 100ms to finish rendering the intraday page's DOM (the `sel` null-check guards against this partially, but `renderIntradayView`/`onIntraWeeklyLink` internals aren't guaranteed to be ready).

### Module: Intraday — List View

#### renderIntradayList()

- **File:** Trade_Journal/index.html (lines 11248-11305)
- **Module:** Intraday — List View
- **Purpose:** Renders the list of currently open intraday setups as clickable summary cards, showing decision/alignment/direction pills, price levels, and any linked parent (daily-bias) trade.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Aborts if `#intraListContainer` doesn't exist.
  - Filters `S.trades` to `openIntra` = intraday trades with `status === 'open'`.
  - Updates `#intraListCount` text to "{n} open".
  - If none open, renders an empty-state prompt and returns.
  - Sorts `openIntra` descending by `date` string (`localeCompare(...) * -1`).
  - Maps each trade `t` to a card:
    - Determines decision pill class from `t.intraDecision` (EXECUTE/WAIT/other → NO TRADE styling).
    - Determines alignment pill class from `t.intraAlignment` (Strong/Moderate/else→Conflict styling).
    - Determines direction label/pill from `t.tradeType` (BUY→Bullish, SELL→Bearish).
    - Builds a `prices` array of any of Entry/SL/TP that are set, joined into spans.
    - If `t.weeklyLinkId` is set, looks up the parent trade (`!isIntraday`) and if found renders a "🔗 Parent: pair · date" line.
    - Assembles the card HTML with `onclick="editIntradayFromList('${t.id}')"` on the whole card.
  - Joins all cards and writes into `container.innerHTML`.
- **Calls:** filter, idEq, editIntradayFromList
- **Called by:** renderIntradayView
- **Side effects:** DOM: writes `#intraListContainer` innerHTML, updates `#intraListCount` text.
- **Notes:** Sort is purely by date string descending, no secondary sort key — same-date entries retain original array order (insertion order, since new trades are `unshift`ed elsewhere, effectively newest-added-first within a date).

#### editIntradayFromList(id)

- **File:** Trade_Journal/index.html (lines 11307-11352)
- **Module:** Intraday — List View
- **Purpose:** Switches the Intraday page into edit mode for a specific existing intraday trade, fully repopulating the form fields, segmented buttons, tags, and decision-engine state from the stored trade record.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| id | string/number | Trade id (intraday) to load for editing |

- **Returns:** void
- **Internal logic:**
  - Finds `t` in `S.trades` via `idEq`; aborts if not found.
  - Sets `S.intradayView = 'form'`, `S.intradayEditId = id`, `S.intradayMode = 'edit'`, `_pendingUploadTradeId = id`.
  - Sets form title to "EDIT — {pair}".
  - Populates `#intraPair`, `#intraDate` (default today if unset), `#intraSession` (default 'London'), `#intraEntry`, `#intraSL`, `#intraTP`, `#intraLot` from the trade record.
  - Calls `rteSet('intraNotes', t.ideaNotes || '')`.
  - Sets `S.intraType = t.tradeType || 'BUY'`; updates the BUY/SELL segmented button classes by stripping existing `sel-*` classes and re-adding `sel-bull`/`sel-bear` based on button text match.
  - Sets `S.intraPaper = !!t.isPaper`; similarly updates LIVE/PAPER segmented buttons.
  - Sets `S.intraTags = [...(t.tags || ['intraday'])]`; clears removable tag chips in `#intraTagWrap` and re-renders via `renderTagsInWrap`.
  - Sets `S.intraExData = t.intraExData || {lq:null,disp:null,mss:null,ret:null}`, `S.intraAlignment`, `S.intraDecision`, `S.intraKill` from the trade (each with a falsy fallback).
  - If `t.weeklyLinkId` is set: sets `#intraWeeklyLink` select value and calls `onIntraWeeklyLink()`.
  - Calls `renderIntradayView()`, `renderDecisionEngine()`, `renderIntradayDecisionStrip()`, `computeAlignmentAndBanner()` to fully refresh the form's derived UI.
- **Calls:** idEq, rteSet, remove (classList mutation), renderTagsInWrap, onIntraWeeklyLink, renderIntradayView, renderDecisionEngine, renderIntradayDecisionStrip, computeAlignmentAndBanner
- **Called by:** renderIntradayList (inline `onclick="editIntradayFromList('${t.id}')"` on each list card)
- **Side effeffects:** Global state: numerous `S.intra*` fields and `_pendingUploadTradeId`. DOM: sets ~10 form field values, rebuilds segmented button styling, rebuilds tag chips, triggers four downstream re-renders.
- **Notes:** Nearly line-for-line identical to the intraday branch of `openChecklistEdit` (lines 12356-12400) — both fully repopulate the intraday form; this duplication means any future field addition must be kept in sync in two places.

### Module: Intraday — Decision Engine

#### computeIntradayDecision(exData)

- **File:** Trade_Journal/index.html (lines 11368-11396)
- **Module:** Intraday — Decision Engine
- **Purpose:** Pure rules-engine function that evaluates the four-question intraday execution checklist (liquidity event, displacement, MSS, return+confirmation) against a fixed rule table (`DECISION_RULES`) to output an EXECUTE / WAIT / NO TRADE decision with a human-readable reason, incorporating hard kill-switches (alignment conflict, daily trade-count cap).
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| exData | object `{lq, disp, mss, ret}` | Current answers to the four decision-engine questions: lq (boolean, liquidity event swept), disp ('Strong'/'Weak'/'None'/null, displacement quality), mss (boolean, market structure shift), ret (boolean, return+confirmation) |

- **Returns:** object `{decision: 'EXECUTE'|'WAIT'|'NO TRADE', reason: string}`
- **Internal logic:**
  - Destructures `{lq, disp, mss, ret}` from `exData`.
  - **Hard guard 1:** if `S.intraKill` is true, returns `{decision:'NO TRADE', reason:'Kill condition active'}` immediately.
  - **Hard guard 2:** if `S.intraAlignment === 'Conflict'`, returns `{decision:'NO TRADE', reason:'Alignment Conflict'}`.
  - **Hard guard 3:** counts today's already-open intraday trades (`t.isIntraday && status==='open' && t.date===today`); if `>= 2`, returns `{decision:'NO TRADE', reason:'Second trade today — block'}` (caps to at most 2 open intraday trades per day).
  - Otherwise iterates the module-level `DECISION_RULES` array of partial-match rule objects; for each rule, checks each defined field (`lq`,`disp`,`mss`,`ret`) against the corresponding `exData` value — if any defined field mismatches, the rule doesn't match.
  - On first matching rule: if `rule.decision === 'EXECUTE'`, reason = 'All conditions met'; if `'WAIT'`, derives a specific reason by checking which of `lq`/`disp`/`mss`/`ret` is still blocking, in priority order (liquidity → displacement → MSS → return), falling back to 'Conditions incomplete'.
  - If no rule matches (shouldn't normally happen given the rule table's coverage), falls through to a default `{decision:'WAIT', reason:'Conditions incomplete'}`.
- **Calls:** filter (Array.filter to count today's trades)
- **Called by:** computeIntradayDecisionAndStrip
- **Side effects:** None (pure function — reads `S.intraKill`, `S.intraAlignment`, `S.trades` but does not mutate them).
- **Notes:** Despite being "pure" in output computation, it reads global mutable state (`S.intraKill`, `S.intraAlignment`, `S.trades`) rather than receiving them as parameters, so it's not side-effect-free in the strict sense — testing it in isolation requires mocking those globals. The two-trades-per-day cap is a hard business rule embedded directly in this function.

#### renderDecisionEngine()

- **File:** Trade_Journal/index.html (lines 11398-11456)
- **Module:** Intraday — Decision Engine
- **Purpose:** Renders the four progressive decision-engine questions (Liquidity Event, Displacement Quality, Market Structure Shift, Return+Confirmation) as an interactive Q&A UI, showing/hiding each question based on prior answers (a wizard-like dependency chain), then triggers the decision recomputation.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Aborts if `#intraDecisionEngine` container doesn't exist.
  - Reads current answers from `S.intraExData` into `ex`.
  - Defines a local `qs` array of 4 question definitions (`lq`, `disp`, `mss`, `ret`), each with `label`, `hint`, `options` (value/label pairs), and a `depends` object describing which prior answers must hold for the question to be shown (e.g. `disp` depends on `lq===true`; `mss` depends on `lq===true && disp in ['Strong','Weak']`; `ret` depends on all three prior answers).
  - For each question, computes `visible` by checking `q.depends` conditions, plus extra explicit visibility overrides duplicating/reinforcing the same dependency logic for `disp`, `mss`, `ret` (redundant with the `depends` checks but written as belt-and-suspenders).
  - For each option, determines if it's the currently selected value (`sel`) and assigns a CSS class (`sel-yes`/`sel-no`/`sel-weak`/`sel`) based on the option's value.
  - Builds an `onclick="setIntraEx('qid', value)"` button per option (numeric/boolean values passed unquoted, string values quoted).
  - Wraps each question in a `.de-question` div (with `.hidden` class if not visible), showing label, hint text, option buttons, and an "✓ Answered"/"—" status line.
  - Writes the composed HTML into the container.
  - Calls `computeIntradayDecisionAndStrip()` to refresh the decision badge/strip based on current answers.
- **Calls:** setIntraEx (referenced only inside generated onclick strings, not directly invoked), computeIntradayDecisionAndStrip
- **Called by:** openIntradayForm, renderIntradayView, editIntradayFromList, setIntraEx, fullResetIntraday, openChecklistEdit
- **Side effects:** DOM: writes `#intraDecisionEngine` innerHTML (embedding inline `onclick="setIntraEx(...)"` handlers).
- **Notes:** The `outboundCalls` list includes `setIntraEx`, but that's only because it appears inside a generated onclick-attribute string in the HTML template, not as a direct JS call within `renderDecisionEngine`'s own execution — the static analysis correctly flags it as a call site, but it fires later on user interaction, not during this function's execution.

#### setIntraEx(key, val)

- **File:** Trade_Journal/index.html (lines 11458-11463)
- **Module:** Intraday — Decision Engine
- **Purpose:** Records the user's answer to one decision-engine question and cascades a full re-render of the decision engine, strip, and alignment banner.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| key | string | One of 'lq', 'disp', 'mss', 'ret' |
| val | boolean or string | The selected answer value |

- **Returns:** void
- **Internal logic:**
  - Sets `S.intraExData[key] = val`.
  - Calls `renderDecisionEngine()` (re-renders questions, may reveal newly-visible dependent questions).
  - Calls `renderIntradayDecisionStrip()` (updates the sticky decision badge).
  - Calls `computeAlignmentAndBanner()` (recomputes alignment banner, which itself also recomputes the decision).
- **Calls:** renderDecisionEngine, renderIntradayDecisionStrip, computeAlignmentAndBanner
- **Called by:** renderDecisionEngine (via inline `onclick="setIntraEx(...)"` on generated question option buttons)
- **Side effects:** Global state: `S.intraExData[key]`. DOM: triggers three cascading re-renders.
- **Notes:** Because `computeAlignmentAndBanner()` internally also calls `computeIntradayDecisionAndStrip()` and `renderIntradayDecisionStrip()` again, the decision strip is effectively rendered twice per call (once directly, once via the alignment cascade) — redundant but harmless.

#### computeIntradayDecisionAndStrip()

- **File:** Trade_Journal/index.html (lines 11465-11470)
- **Module:** Intraday — Decision Engine
- **Purpose:** Thin wrapper that computes the current intraday decision from `S.intraExData` and immediately re-renders the decision strip badge.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Reads `S.intraExData` into `ex`.
  - Calls `computeIntradayDecision(ex)` to get `result`.
  - Sets `S.intraDecision = result.decision`.
  - Calls `renderIntradayDecisionStrip()`.
- **Calls:** computeIntradayDecision, renderIntradayDecisionStrip
- **Called by:** renderDecisionEngine, computeAlignmentAndBanner
- **Side effects:** Global state: `S.intraDecision`. DOM: triggers decision-strip re-render.
- **Notes:** Note this function discards `result.reason` — the reason string is recomputed separately/redundantly inside `renderIntradayDecisionStrip()` itself rather than being passed through from here.

#### renderIntradayDecisionStrip()

- **File:** Trade_Journal/index.html (lines 11472-11511)
- **Module:** Intraday — Decision Engine
- **Purpose:** Renders the sticky decision-strip UI (badge text/color, reason text, answered-count progress) shown while filling out the intraday decision engine questions.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Grabs `#dsBadge`, `#dsReason`, `#dsProg` elements (no null-guard — will throw if any is missing on the current page).
  - Reads `S.intraExData` into `ex`; computes `answered` = count of non-null/undefined/empty-string values in `ex`; `total = 4` (hardcoded).
  - **Priority guard:** if `S.intraKill` or `S.intraAlignment === 'Conflict'`: sets badge to "NO TRADE" (`.ds-badge.notrade`), reason text to either "Alignment Conflict" or "Kill condition active", updates progress text, and returns early (skips the normal decision-based branch).
  - Otherwise reads `S.intraDecision` (default 'WAIT') and re-derives the reason text independently (duplicating the reason logic from `computeIntradayDecision` rather than reusing its output):
    - EXECUTE → badge "EXECUTE" (`.ds-badge.execute`), reason "All conditions met — execute plan".
    - NO TRADE → badge "NO TRADE" (`.ds-badge.notrade`), reason "Kill condition active" (hardcoded, even though the actual NO-TRADE reason could differ, e.g. second-trade-today block).
    - Otherwise (WAIT) → badge "WAIT" (`.ds-badge.wait`), and picks a reason string by checking `ex2.lq`/`disp`/`mss`/`ret` in priority order, matching the same priority order as `computeIntradayDecision`.
  - Sets `reason.textContent` and `prog.textContent = answered + '/' + total`.
- **Calls:** filter (via `Object.values(ex).filter(...)` to count answered questions)
- **Called by:** openIntradayForm, renderIntradayView, editIntradayFromList, setIntraEx, computeIntradayDecisionAndStrip, computeAlignmentAndBanner, fullResetIntraday, openChecklistEdit
- **Side effects:** DOM: sets textContent/className on `#dsBadge`, `#dsReason`, `#dsProg`.
- **Notes:** No null-check on `badge`/`reason`/`prog` — if this is called on a page where the decision strip markup isn't present in the DOM, it will throw a TypeError. The NO-TRADE reason text is hardcoded to "Kill condition active" even when the real cause (per `computeIntradayDecision`) might be "Second trade today — block" — a minor logic/UX inconsistency versus the actual rules engine.

#### computeAlignmentAndBanner()

- **File:** Trade_Journal/index.html (lines 11514-11585)
- **Module:** Intraday — Decision Engine
- **Purpose:** Computes how the current intraday setup's linked parent (daily-bias) trade's weekly and daily bias directions align with each other, renders the color-coded alignment banner, and enforces a hard "Conflict = kill switch" rule that feeds into the decision engine.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Grabs `#intraAlignmentBanner`; aborts if missing.
  - Reads `parentId` from `#intraWeeklyLink` select value; if empty/null, hides the banner, clears `S.intraAlignment = null`, and returns.
  - Finds `parentTrade` in `S.trades` (non-intraday, matching id); if not found, hides banner, clears alignment, returns.
  - If `parentTrade.wbEntryId` is set, looks up the corresponding weekly bias in `S.weeklies` and extracts its `.bias` into `weeklyBias`.
  - Reads `dailyBias = parentTrade.biasSet`.
  - Determines `alignment`, `reason`, `icon`, `cls` via cascading conditions:
    - If either `weeklyBias` or `dailyBias` missing → `alignment=null`, reason "Weekly or daily bias missing", icon ⚠️, no class.
    - If `weeklyBias === dailyBias` → `Strong` alignment, reason "Weekly + Daily both {bias}", icon ✓, class `strong`.
    - If weekly is directional and daily is `NEUTRAL` (either direction) → `Moderate`, reason "Weekly {bias} · Daily Neutral", icon ◆, class `moderate`.
    - If weekly is `NEUTRAL` and daily is directional → `Moderate`, reason "Weekly Neutral · Daily {bias}", icon ◆, class `moderate`.
    - Else (opposing directional biases) → `Conflict`, reason "Weekly {w} ⚡ Daily {d}", icon ✕, class `conflict`.
  - Sets `S.intraAlignment = alignment`.
  - **Kill-switch rule:** if `alignment === 'Conflict'`, sets `S.intraKill = true`; otherwise `S.intraKill = false` (this unconditionally resets the kill switch to false whenever alignment isn't Conflict, even if the user had manually set some other kill condition — though no other kill toggle is visible in this chunk).
  - If `alignment` is non-null: shows the banner, sets its class, and sets `#abIcon` text and `#abText` text (appending " — HARD KILL: NO TRADE" if Conflict). Else hides the banner.
  - Calls `computeIntradayDecisionAndStrip()` and `renderIntradayDecisionStrip()` at the end (redundant double-render as noted above).
- **Calls:** idEq, computeIntradayDecisionAndStrip, renderIntradayDecisionStrip
- **Called by:** renderIntradayView, editIntradayFromList, setIntraEx, onIntraWeeklyLink, openChecklistEdit
- **Side effects:** Global state: `S.intraAlignment`, `S.intraKill`. DOM: shows/hides `#intraAlignmentBanner`, sets its class, sets `#abIcon`/`#abText` text content, plus cascading decision-strip re-render.
- **Notes:** `S.intraKill` is fully controlled by this function based solely on alignment — there's no separate manual kill toggle for intraday found in this chunk, contrasting with the Daily Bias checklist's separate `S.kills`/`toggleKillItem` kill-condition system.

#### fullResetIntraday()

- **File:** Trade_Journal/index.html (lines 11588-11624)
- **Module:** Intraday — Decision Engine / Form Lifecycle
- **Purpose:** Resets the entire Intraday "new setup" form back to a blank/default state — clearing decision-engine answers, alignment, tags, screenshots, and all input fields — preparing for a new entry.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Resets `S.intraExData` to all-null, `S.intraAlignment = null`, `S.intraDecision = null`, `S.intraKill = false`, `S.intraScores = null`, `S.intraSS = []`.
  - Generates a fresh `_pendingUploadTradeId = crypto.randomUUID()` (pre-assigns an id for the next entry's screenshot uploads before the trade object itself exists).
  - Resets `S.intraType = 'BUY'`, `S.intraPaper = false`, `S.intraTags = ['intraday']`, `S.intradayEditId = null`, `S.intradayMode = ''`.
  - Clears/reset form fields: `#intraPair` (empty), `#intraDate` (today), `#intraSession` (first option), rich-text `intraNotes` (empty), `#intraEntry`/`#intraSL`/`#intraTP`/`#intraLot` (empty), `#intraSsGrid` (empty), `#intraWeeklyLink` (empty), hides `#intraContextBar`.
  - Rebuilds `#intraTagWrap` tag chips from the reset `S.intraTags`.
  - Resets the BUY/SELL and LIVE/PAPER segmented button visual state (strips `sel-*` classes, re-selects the first button of each group).
  - Sets form title back to "NEW INTRADAY SETUP".
  - Hides `#intraAlignmentBanner` if present.
  - Calls `renderDecisionEngine()` and `renderIntradayDecisionStrip()` to refresh the now-empty decision UI.
- **Calls:** rteSet, remove (classList mutation via forEach), renderTagsInWrap, renderDecisionEngine, renderIntradayDecisionStrip
- **Called by:** cancelIntradayPage, openIntradayForm, saveIntradayIdea
- **Side effects:** Global state: resets ~11 `S.intra*`/`_pendingUploadTradeId` fields. DOM: clears/resets ~10 form fields and button groups, hides alignment banner, re-renders decision engine/strip.
- **Notes:** Pre-generating `_pendingUploadTradeId` here means screenshots uploaded before the user fills in pair/date are already associated with a stable id that becomes the trade's real `id` once saved (see `saveIntradayIdea`).

### Module: Intraday — Save / Form Handlers

#### saveIntradayIdea()

- **File:** Trade_Journal/index.html (lines 11626-11742)
- **Module:** Intraday — Save / Form Handlers
- **Purpose:** Validates and saves the Intraday setup form, either creating a new intraday trade record or updating an existing one (edit mode), including syncing certain fields back onto a linked parent daily-bias trade.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Calls `harvestTags('intra')` to collect current tag chips into `S.intraTags` (defined elsewhere).
  - Reads and trims `#intraPair`; reads `#intraDate`. Guard: if either empty, `alert(...)` and abort.
  - Guard: if any screenshot in `S.intraSS` has `_uploading`, shows warning toast and aborts.
  - Reads `weeklyLinkId` from `#intraWeeklyLink` (or null); computes `bias = getIntraBias() || 'NEUTRAL'`.
  - **Edit branch:** if `S.intradayMode === 'edit' && S.intradayEditId`, finds the existing `trade` in `S.trades`; alerts and aborts if not found.
  - **Create branch:** otherwise builds a brand-new `trade` object with a large set of default fields (id from `_pendingUploadTradeId` or a fresh UUID; `status:'open'`; `isIntraday:true`; score/grade placeholders; empty result/close fields; `screenshots:[...S.intraSS]`; `checklistAnswers:{}`; `intraExData:{...S.intraExData}` snapshot; etc.), then `S.trades.unshift(trade)` (prepends to the front of the trades array).
  - Regardless of branch, re-applies the current form values onto `trade` (pair, date, session, tradeType, biasSet, ideaNotes, entryPrice, slPrice, tpPrice, lotSize, tags, isPaper) — this "apply twice" pattern ensures edited fields overwrite the freshly-created defaults too.
  - If `trade.isPaper` and a `weeklyLinkId` is set: finds the parent trade and if it isn't already flagged `isPaper`, sets it and calls `saveTrade(parent)` — i.e. marking an intraday as paper-trade promotes its linked parent to paper status too.
  - If in edit mode and there are newly-added screenshots (`S.intraSS.length > 0`), appends them to `trade.screenshots` (with a code comment explaining why this append-only-in-edit-mode logic avoids duplicating screenshots already set during creation).
  - Sets `trade.weeklyLinkId`, `intraAlignment`, `intraDecision`, `intraKill`, `intraExData` (fresh snapshot) from current `S.intra*` state; ensures `trade.intraScores` defaults to null if unset.
  - Calls `saveTrade(trade)` to persist.
  - If `weeklyLinkId` is set and the parent trade is open: propagates any non-null entry/SL/TP/lot values from the intraday `trade` back onto the parent trade fields (only overwriting fields that have a value), and if any field was updated, calls `saveTrade(parent)` again.
  - Calls `fullResetIntraday()`, sets `S.intradayView = 'list'`, calls `renderIntradayView()`, `updateOpenBadge()`, `updateIntradayBadge()`, shows a success toast, and calls `navTo('intraday')`.
- **Calls:** harvestTags, showToast, getIntraBias, idEq, rteGet, saveTrade, fullResetIntraday, renderIntradayView, updateOpenBadge, updateIntradayBadge, navTo
- **Called by:** (none detected — verify: bound via inline `onclick="saveIntradayIdea()"` on the intraday form's save button)
- **Side effects:** Global state: mutates/pushes into `S.trades`; resets `S.intra*` fields via `fullResetIntraday`; sets `S.intradayView`. Persistence: `saveTrade` called up to twice — once for the intraday trade, potentially once more for the linked parent trade (Supabase `trades` table writes). DOM: numerous field resets, badge updates, page navigation, toast.
- **Notes:** The comment in the source explicitly documents the reasoning behind the conditional screenshot-append (avoiding double-adding screenshots for newly created trades) — an important maintenance note for anyone modifying screenshot handling here. The two-trades-per-day cap enforced in `computeIntradayDecision` is NOT enforced here at save time — a user could still save a 3rd/4th open intraday trade of the day; the cap only affects the *decision recommendation* shown, not a hard save-block.

#### getIntraBias()

- **File:** Trade_Journal/index.html (lines 11744-11752)
- **Module:** Intraday — Save / Form Handlers
- **Purpose:** Looks up the bias direction (`biasSet`) of the daily-bias trade currently linked via the "link to open trade idea" dropdown, for use as the intraday setup's inherited bias.
- **Parameters:** None
- **Returns:** string ('BULLISH'/'BEARISH'/'NEUTRAL') or `null` if no link selected or parent not found.
- **Internal logic:**
  - Reads `#intraWeeklyLink` select's value (despite the "Weekly" name, this actually links to a daily-bias/open-trade-idea record, per the lookup logic) as `id`.
  - If `id` is set, finds a non-intraday trade in `S.trades` matching `id`; if found, returns its `.biasSet`.
  - Otherwise returns `null`.
- **Calls:** idEq
- **Called by:** saveIntradayIdea
- **Side effects:** None (pure read).
- **Notes:** Despite the element id being `intraWeeklyLink`, this links to a *daily-bias trade* (`!isIntraday` trades in `S.trades`), not to `S.weeklies` — naming is a bit misleading; the actual weekly-bias linkage for a daily trade is done via `wbEntryId` on the daily trade, one level up. This function name/element together form the "intraday → daily bias" link, not "intraday → weekly bias" directly.

#### onIntraWeeklyLink()

- **File:** Trade_Journal/index.html (lines 11754-11784)
- **Module:** Intraday — Save / Form Handlers
- **Purpose:** Handles the "link to open trade idea" dropdown's change event on the Intraday form — populates a context summary card showing the linked daily-bias trade's pair/bias/date/notes, and auto-fills the intraday pair and direction from it.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Reads `#intraWeeklyLink` value as `id`; grabs `#intraContextBar`.
  - If no `id`: hides the context bar (if present), calls `computeAlignmentAndBanner()`, returns.
  - Finds the linked non-intraday trade `t`; if not found, hides context bar, calls `computeAlignmentAndBanner()`, returns.
  - Shows the context bar (`display:'block'`).
  - Populates `#intraCtxPair` (pair), `#intraCtxBiasTag` (formatted bias label with ▲/▼ symbol), `#intraCtxDate` (date) — each guarded by element-existence check.
  - Sets `#intraCtxBias` textContent to raw `t.biasSet`.
  - Strips HTML tags from `t.ideaNotes` and truncates to 120 chars (with ellipsis) for `#intraCtxNotes`.
  - Auto-fills `#intraPair` with `t.pair` only if the pair field is currently empty (`!pairIn.value`).
  - Auto-sets the intraday trade direction to match the parent's bias: `setIntraType('BUY', ...)` if BULLISH, `setIntraType('SELL', ...)` if BEARISH (using `querySelector` to grab the first/last segmented button as the `el` argument).
  - Calls `computeAlignmentAndBanner()` at the end regardless of path taken (except the two early-return paths above, which call it before returning).
- **Calls:** computeAlignmentAndBanner, idEq, setIntraType
- **Called by:** navTo, newIntradayFromWeekly, editIntradayFromList, onIntraPairChange, openChecklistEdit
- **Side effects:** DOM: shows/hides `#intraContextBar`, sets several `#intraCtx*` text contents, conditionally sets `#intraPair` value, conditionally updates BUY/SELL segmented button classes.
- **Notes:** Only auto-fills the pair field if it's currently blank — won't clobber a value the user already typed. Notes truncation strips all HTML tags via a regex (`/<[^>]+>/g`), meaning rich formatting from `rteDisplay`-rendered notes is discarded for this short preview.

#### onIntraPairChange()

- **File:** Trade_Journal/index.html (lines 11786-11798)
- **Module:** Intraday — Save / Form Handlers
- **Purpose:** When the user manually types/changes the intraday pair field, attempts to auto-select a matching open daily-bias trade in the "link" dropdown by substring match on pair name.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Reads and trims/uppercases `#intraPair` value; returns early if empty.
  - Grabs `#intraWeeklyLink` select; returns early if missing.
  - Iterates the select's `<option>` elements; for the first option whose uppercase text includes the typed pair substring, sets the select's value to that option's value, calls `onIntraWeeklyLink()`, and breaks the loop.
- **Calls:** onIntraWeeklyLink
- **Called by:** (none detected — verify: bound via inline `oninput`/`onchange="onIntraPairChange()"` on the `#intraPair` text input)
- **Side effects:** DOM: may set `#intraWeeklyLink` select value, triggering `onIntraWeeklyLink()`'s side effects.
- **Notes:** Substring match on option *text* (not value) — since option text is formatted as "PAIR — BIAS (date)" (per `refreshIntraWeeklyDropdown`), a pair substring like "EUR" would match "EURUSD — BULLISH (...)" correctly, but could also false-positive match if the pair substring happens to appear elsewhere in the bias/date text (unlikely in practice given typical pair naming).

#### refreshIntraWeeklyDropdown()

- **File:** Trade_Journal/index.html (lines 11800-11809)
- **Module:** Intraday — Save / Form Handlers
- **Purpose:** Rebuilds the "link to open trade idea" dropdown options (and an associated pair-name datalist for autocomplete) from all currently open, non-intraday trades.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Grabs `#intraWeeklyLink`; aborts if missing.
  - Filters `S.trades` to `openTrades` = `status==='open' && !isIntraday`.
  - Rebuilds the select's innerHTML: a placeholder "— Select open trade idea (optional) —" option plus one `<option>` per open trade showing "{pair} — {biasSet||'—'} ({date})".
  - Grabs `#intraPairSuggestions` datalist; if present, rebuilds it with one `<option value="{pair}">` per open trade (for native browser autocomplete on the pair text input).
- **Calls:** filter
- **Called by:** loadAllData, navTo, saveWeeklyBias, reopenWeeklyBias, deleteWeeklyBias
- **Side effects:** DOM: rebuilds `#intraWeeklyLink` and `#intraPairSuggestions` innerHTML.
- **Notes:** Called from many places whenever the set of open daily-bias trades might have changed (new weekly saved, weekly reopened/deleted, etc.) to keep the dropdown in sync.

#### updateIntradayBadge()

- **File:** Trade_Journal/index.html (lines 11811-11819)
- **Module:** Intraday — Save / Form Handlers
- **Purpose:** Updates the navigation badge count and home-tile subtitle text showing how many intraday setups are currently open.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Filters `S.trades` to open intraday trades; `n` = count.
  - Sets `#intradayBadge` text to `n` and hides it (`display:'none'`) if `n === 0`, shows otherwise (guarded by element existence).
  - Sets `#intradayTileSub` text to "{n} setup(s) open" (pluralized) if `n>0`, else "Log day-trade entry" (guarded by element existence).
- **Calls:** filter
- **Called by:** loadAllData, navTo, saveIntradayIdea, renderOpen, saveClosure, renderDashboard, runArchive
- **Side effects:** DOM: sets `#intradayBadge` text/visibility, `#intradayTileSub` text.
- **Notes:** Called from many lifecycle points across the app (load, nav, save, close, dashboard render, archive) to keep the badge accurate everywhere an intraday trade's open/closed status could change.

### Module: Dashboard / Insights Mode Controls

#### setInsightsMode(mode, el)

- **File:** Trade_Journal/index.html (lines 11821-11838)
- **Module:** Dashboard / Insights Mode Controls
- **Purpose:** Switches the dashboard's statistics scope between Live / Paper / Combined trades, updating segmented-button visuals across two possible locations (home widget and dedicated insights page) and toggling a "combined mode" banner.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| mode | string | One of 'live', 'paper', 'combined' |
| el | HTMLElement | The clicked button element (accepted but not directly used in the body shown) |

- **Returns:** void
- **Internal logic:**
  - Sets `S.insightsMode = mode`.
  - For each of `['insightsModeBtns', 'insightsModeBtnsPage']` (two possible duplicate button groups, home + insights page): finds the wrap element, and for each `.seg-btn` inside it strips `sel-*` classes, then re-adds `sel-bull` if the button's text is 'LIVE' and mode is 'live', or `sel-bear` if text is 'PAPER' and mode is 'paper', or `sel-bear` if text is 'COMBINED' and mode is 'combined'.
  - Shows/hides `#combinedBanner` and `#combinedBannerPage` (`inline-block` vs none) based on whether mode is 'combined'.
  - Calls `renderDashboard()` to refresh stats under the new scope.
- **Calls:** renderDashboard
- **Called by:** (none detected — verify: bound via inline `onclick="setInsightsMode('live', this)"` etc. on segmented buttons in both the home dashboard widget and the dedicated Insights page)
- **Side effects:** Global state: `S.insightsMode`. DOM: restyles two sets of segmented buttons, toggles two banner elements, triggers `renderDashboard()`.
- **Notes:** The `el` parameter is accepted (likely for consistency with other `set*(value, el)` handlers in the file) but this implementation instead re-derives selected state purely from button text content across both wraps, rather than using `el` directly — meaning it's robust to being called from either UI location. Both 'PAPER' and 'COMBINED' reuse the `sel-bear` class (visually the same "alternate" color), only 'LIVE' gets `sel-bull`.

### Module: Intraday — Segmented Toggle Setters

#### setIntraType(type, el)

- **File:** Trade_Journal/index.html (lines 11840-11845)
- **Module:** Intraday — Segmented Toggle Setters
- **Purpose:** Sets the intraday trade direction (BUY/SELL) and updates the corresponding segmented button's visual selected state.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| type | string | 'BUY' or 'SELL' |
| el | HTMLElement | The button element to visually mark as selected |

- **Returns:** void
- **Internal logic:**
  - Sets `S.intraType = type`.
  - Strips `sel-*` classes from all `.seg-btn` children of `#intraTypeBtns`.
  - Adds `sel-bull` to `el` if type is 'BUY', else `sel-bear`.
- **Calls:** (none)
- **Called by:** onIntraWeeklyLink
- **Side effects:** Global state: `S.intraType`. DOM: restyles `#intraTypeBtns` button group.
- **Notes:** Also bound directly via inline `onclick="setIntraType('BUY', this)"`/`'SELL'` on the intraday form's BUY/SELL buttons (the static inbound-caller list only captured the programmatic call from `onIntraWeeklyLink`, since the JSON tool doesn't trace inline onclick attributes as callers — add this as an additional caller).

#### setIntraPaper(isPaper, el)

- **File:** Trade_Journal/index.html (lines 11847-11852)
- **Module:** Intraday — Segmented Toggle Setters
- **Purpose:** Sets the intraday trade's paper/live status flag and updates the corresponding segmented button's visual state.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| isPaper | boolean | true for paper trade, false for live |
| el | HTMLElement | The button element to visually mark as selected |

- **Returns:** void
- **Internal logic:**
  - Sets `S.intraPaper = isPaper`.
  - Strips `sel-*` classes from `.seg-btn` children of `#intraPaperBtns`.
  - Adds `sel-bear` to `el` if `isPaper` is true, else `sel-bull`.
- **Calls:** (none)
- **Called by:** (none detected — verify: bound via inline `onclick="setIntraPaper(true, this)"`/`(false, this)` on the intraday form's LIVE/PAPER buttons, which is why no in-code caller shows up)
- **Side effects:** Global state: `S.intraPaper`. DOM: restyles `#intraPaperBtns` button group.
- **Notes:** Mirrors `setIntraType`'s structure exactly, just for a different flag/element group.

#### setIdeaPaper(isPaper, el)

- **File:** Trade_Journal/index.html (lines 11854-11859)
- **Module:** Intraday — Segmented Toggle Setters
- **Purpose:** Sets the Daily Bias "idea" form's paper/live status flag and updates its segmented button visual state (parallel to `setIntraPaper` but for the Daily Bias/idea page rather than Intraday).
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| isPaper | boolean | true for paper trade, false for live |
| el | HTMLElement | The button element to visually mark as selected |

- **Returns:** void
- **Internal logic:**
  - Sets `S.ideaPaper = isPaper`.
  - Strips `sel-*` classes from `.seg-btn` children of `#ideaPaperBtns`.
  - Adds `sel-bear` to `el` if `isPaper` is true, else `sel-bull`.
- **Calls:** (none)
- **Called by:** (none detected — verify: bound via inline `onclick="setIdeaPaper(true, this)"`/`(false, this)` on the Daily Bias form's LIVE/PAPER buttons)
- **Side effects:** Global state: `S.ideaPaper`. DOM: restyles `#ideaPaperBtns` button group.
- **Notes:** Third near-duplicate of the same segmented-toggle pattern (`setIntraType`, `setIntraPaper`, `setIdeaPaper`) — differs only in the state field and DOM ids targeted.

### Module: Daily Bias (OMAR/TTrades) — Checklist Cards

#### getActiveCards()

- **File:** Trade_Journal/index.html (lines 11865-11867)
- **Module:** Daily Bias (OMAR/TTrades) — Checklist Cards
- **Purpose:** Returns the active set of checklist card definitions depending on which analysis model (OMAR vs TTrades) is currently selected.
- **Parameters:** None
- **Returns:** array — `BIAS_CARDS_TTRADES` if `S.ideaModel === 'ttrades'`, else `BIAS_CARDS_OMAR` (both constants defined elsewhere in the file).
- **Internal logic:** Single ternary expression on `S.ideaModel`.
- **Calls:** (none)
- **Called by:** countAnswered, totalQs, renderBiasCards
- **Side effects:** None (pure read of `S.ideaModel`).
- **Notes:** Central single point of model-switching for the entire Daily Bias checklist UI — any function needing "the current question set" goes through this.

#### countAnswered()

- **File:** Trade_Journal/index.html (lines 11869-11870)
- **Module:** Daily Bias (OMAR/TTrades) — Checklist Cards
- **Purpose:** Counts how many of the active model's checklist questions currently have a non-empty answer recorded in `S.answers`.
- **Parameters:** None
- **Returns:** number — count of answered questions.
- **Internal logic:** `getActiveCards().flatMap(c => c.questions).filter(q => S.answers[q.id] && S.answers[q.id].val !== '').length`.
- **Calls:** getActiveCards, filter
- **Called by:** renderBiasCards, renderEntrySection, updateScoreStrip
- **Side effects:** None (pure read of `S.answers`).
- **Notes:** A question counts as "answered" only if its `S.answers[qid]` entry exists AND its `.val` is not the empty string (so a stored entry with `val: ''` — e.g. after a dropdown reset — is treated as unanswered).

#### totalQs()

- **File:** Trade_Journal/index.html (lines 11872)
- **Module:** Daily Bias (OMAR/TTrades) — Checklist Cards
- **Purpose:** Returns the total number of checklist questions in the currently active model (6 for both OMAR and TTrades per the UI text elsewhere, but computed dynamically here).
- **Parameters:** None
- **Returns:** number — total question count.
- **Internal logic:** `getActiveCards().flatMap(c => c.questions).length`.
- **Calls:** getActiveCards
- **Called by:** renderBiasCards, renderEntrySection, updateScoreStrip
- **Side effects:** None (pure).
- **Notes:** One-line function, no braces (`function totalQs() { return ...; }` on a single line).

#### onDropChange(qid, sel)

- **File:** Trade_Journal/index.html (lines 11874-11882)
- **Module:** Daily Bias (OMAR/TTrades) — Checklist Cards
- **Purpose:** Handles a checklist question dropdown's `onchange` event — records or clears the answer in `S.answers`, updates the select's visual "answered" styling, and cascades a re-render of the score strip and both card sections.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| qid | string | Question id (e.g. 'q_htf_dol') |
| sel | HTMLSelectElement | The `<select>` element that changed |

- **Returns:** void
- **Internal logic:**
  - Reads `val` from the selected option's `.value`.
  - If `val === ''`, deletes `S.answers[qid]`; else sets `S.answers[qid] = {val, label: selectedOption.text}`.
  - Sets `sel.className = 'drop-select' + (val ? ' sel-good' : '')` to visually flag answered dropdowns.
  - Calls `updateScoreStrip()`, `renderBiasCards()`, `renderEntrySection()`.
- **Calls:** updateScoreStrip, renderBiasCards, renderEntrySection
- **Called by:** renderBiasCards (via inline `onchange="onDropChange('${q.id}',this)"` on each generated question `<select>`)
- **Side effects:** Global state: adds/removes `S.answers[qid]`. DOM: updates the changed select's className; triggers three full re-renders (score strip, bias cards, entry/verdict section).
- **Notes:** Calling `renderBiasCards()` from within a handler that was itself invoked via markup generated by `renderBiasCards()` means the entire card list (including the just-changed dropdown) is rebuilt from scratch on every single answer change — acceptable for a form of this size but not cheap; also re-triggers the underlying grading engines (`runHTFEngine`/`runTTEngine`) each time.

#### renderBiasCards()

- **File:** Trade_Journal/index.html (lines 11884-12051)
- **Module:** Daily Bias (OMAR/TTrades) — Checklist Cards
- **Purpose:** Renders the full set of Daily Bias checklist question cards (kill-condition items + dropdown questions) for the currently active model, plus a trailing summary card showing the computed market-state/daily-expectation verdict, confidence, and (for TTrades) tomorrow's plan.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Aborts if `#biasCards` container missing; clears its innerHTML.
  - Determines `editMode = S.checklistMode === 'edit'`.
  - Updates all `.model-sel-btn` elements' active state (`toggle('active', dataset.model === S.ideaModel)`) and disables them while in edit mode (model switching disallowed mid-edit).
  - Shows/hides `#modelEditNotice` based on edit mode.
  - For each card in `getActiveCards()`:
    - Computes `allAns` (every question in the card answered) and `cardKillOn` (any of the card's kill items toggled on in `S.kills`).
    - Creates a `.score-card` div, classed `scored-bad` if kill is on, `scored` if all answered, else neither.
    - Renders any kill-condition checkboxes (`.kill-item`, toggled via inline `onclick="toggleKillItem('id');renderBiasCards();"`).
    - Renders the card header (number, title, timeframe, a "✓ Complete"/"Pending" badge).
    - Renders each question as a `.drop-row` with label, hint, and a `<select>` — in edit mode, questions not in the `UPDATABLE_QS` set are rendered `disabled` with a "🔒 LOCKED" badge, while updatable ones show an "✏ UPDATABLE" badge; the select's `onchange` calls `onDropChange`.
    - Appends the card to the container.
  - After all cards, computes `ans`/`tot`/`hasAll` via `countAnswered()`/`totalQs()`; determines `isTT = S.ideaModel==='ttrades'`; runs the appropriate engine (`runTTEngine(S.answers)` or `runHTFEngine(S.answers)`) to get `result`; computes `bias = getBias()`.
  - Builds a final summary `.score-card` (`sd`) styled with the engine's color if a result exists:
    - **TTrades branch:** shows local helpers `confStyle`/`confLabel` for confidence badge styling; builds `ttSummaryRows` mapping each of the 6 answer values through `TT_DISPLAY` lookup tables (closure, cisd, delivery, fractal, closeStrength, extLiquidity); renders an "ANALYSIS INPUTS" table, the Expected Delivery row, confidence badge, and (if a result exists) a "TOMORROW'S EXPECTATION" section listing `result.plan` items; if a `bias` is set, shows a trade-direction pill.
    - **OMAR/HTF branch:** builds `summaryRows` via `HTF_DISPLAY` lookup tables (structure, location, dol, phase, irl, sweep); renders an "ANALYSIS SUMMARY" table with Market State, Confidence, and Environment rows; if `bias` set, shows trade-direction pill.
    - If no result yet (not all questions answered), shows a prompt message instead ("Answer all 6 questions above to generate...").
  - Appends the summary card to the container.
- **Calls:** getActiveCards, toggleKillItem, onDropChange, countAnswered, totalQs, runTTEngine, runHTFEngine, getBias
- **Called by:** navTo, onDropChange, switchIdeaModel, fullResetChecklist
- **Side effects:** DOM: fully rebuilds `#biasCards` innerHTML; toggles `.active`/`disabled` state on `.model-sel-btn` elements; shows/hides `#modelEditNotice`.
- **Notes:** In edit mode, the "LOCKED" vs "UPDATABLE" distinction (driven by the `UPDATABLE_QS` set: `q_htf_dol`, `q_htf_irl`, `q_ext_sweep`, `q_swing_phase`) is a core business rule — only 4 of the checklist's fields can be revised after initial save, presumably because the others represent frozen pre-market analysis that shouldn't be retroactively changed, while these 4 represent things that evolve during/after the session (DOL reached, reaction area, external sweep, phase evolved).

### Module: Daily Bias — Kill Conditions & Verdict

#### toggleKillItem(key)

- **File:** Trade_Journal/index.html (lines 12055-12056)
- **Module:** Daily Bias — Kill Conditions & Verdict
- **Purpose:** Toggles a single kill-condition checkbox on/off in the Daily Bias checklist and refreshes the entry/verdict section.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| key | string | Kill-condition item id |

- **Returns:** void
- **Internal logic:** `S.kills[key] = !S.kills[key]`; calls `renderEntrySection()`.
- **Calls:** renderEntrySection
- **Called by:** renderBiasCards (via inline `onclick="toggleKillItem('${k.id}');renderBiasCards();"` on each kill item)
- **Side effects:** Global state: `S.kills[key]`.
- **Notes:** Note the calling markup invokes `toggleKillItem(...)` AND `renderBiasCards()` as two separate statements in the onclick attribute — so `renderBiasCards()` (which rebuilds the entire card list, including re-evaluating `cardKillOn`) runs after this function's own `renderEntrySection()` call, meaning both the cards and the verdict section get refreshed on every kill toggle, just via two different call paths.

#### renderEntrySection()

- **File:** Trade_Journal/index.html (lines 12058-12130)
- **Module:** Daily Bias — Kill Conditions & Verdict
- **Purpose:** Renders the trading verdict/guidance panel beneath the checklist — a single card showing an icon, title, and message describing what the trader should do given the current kill-condition state, answer completeness, and computed market-state/expectation.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Aborts if `#entrySection` missing; clears its innerHTML.
  - Computes `killOn` (any kill toggled), `allAns` (all questions answered), `isTT` (model check).
  - **Branch 1 — kill active:** icon ⛔, title "NO TRADE — KILL CONDITION ACTIVE", message instructing to log a skip, border color bear-red.
  - **Branch 2 — not all answered:** icon 📋, title varies by model ("Complete TTrades/HTF Analysis"), message prompting to answer all 6 questions, neutral border.
  - **Branch 3 — TTrades, fully answered:** runs `runTTEngine(S.answers)`, reads `result.state` (default 'range'); looks up a `verdicts` map keyed by state (`bullish_expansion`, `bearish_expansion`, `bullish_continuation`, `bearish_continuation`, `reversal`, `range`), each providing `[icon, title, msg, borderColor]`; destructures the matched (or 'range' fallback) entry.
  - **Branch 4 — OMAR/HTF, fully answered:** calls `computeHTFMarketState(S.answers)` to get a state string, then a long if/else chain mapping `bullish_continuation`/`bearish_continuation`/`bullish_reversal`/`bearish_reversal`/else(neutral) to icon/title/message/border-color describing the appropriate directional guidance (e.g. "BULLISH CONTINUATION — SEEK LONGS ONLY").
  - Creates a `.verdict` div with the resolved `bc` (border color), inner icon + title + message HTML, and appends it to `#entrySection`.
- **Calls:** countAnswered, totalQs, runTTEngine, computeHTFMarketState
- **Called by:** navTo, onDropChange, toggleKillItem, switchIdeaModel, fullResetChecklist
- **Side effects:** DOM: rebuilds `#entrySection` innerHTML.
- **Notes:** For OMAR mode, `runHTFEngine` (used elsewhere, e.g. `renderBiasCards`/`updateScoreStrip`) is NOT used here — instead a separate, more granular `computeHTFMarketState(S.answers)` call directly drives a bespoke 4-state (+neutral) verdict message chain, distinct from the environment-labeling logic used in the summary card. This means the "market state" verdict text and the "environment" badge shown elsewhere are computed by two different underlying functions that could theoretically diverge if their internal rules aren't kept in sync.

### Module: Daily Bias — Model Switching / Reset

#### switchIdeaModel(model)

- **File:** Trade_Journal/index.html (lines 12132-12144)
- **Module:** Daily Bias — Model Switching / Reset
- **Purpose:** Switches the active Daily Bias analysis model between 'omar' and 'ttrades', clearing all in-progress answers/kills (since the question sets differ) and persisting the model choice to localStorage.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| model | string | 'omar' or 'ttrades' |

- **Returns:** void
- **Internal logic:**
  - Guard: if `S.ideaModel === model` already, no-op return (avoids unnecessary reset/re-render).
  - Sets `S.ideaModel = model`; persists via `localStorage.setItem('ict_ideaModel', model)`.
  - Clears `S.answers = {}` and `S.kills = {}` (switching models discards all current answers, since question ids differ between OMAR and TTrades card sets).
  - Calls `updateScoreStrip()`, `renderBiasCards()`, `renderEntrySection()`.
  - Updates `.model-sel-btn` active states to match the new `model`.
- **Calls:** updateScoreStrip, renderBiasCards, renderEntrySection
- **Called by:** (none detected — verify: bound via inline `onclick="switchIdeaModel('omar')"`/`('ttrades')` on the model-selector buttons)
- **Side effects:** Global state: `S.ideaModel`, clears `S.answers`/`S.kills`. localStorage: writes `ict_ideaModel` key. DOM: three cascading re-renders, updates model-selector button active classes.
- **Notes:** No confirmation prompt before discarding in-progress answers when switching models — differs from `fullResetChecklist` which does confirm; a user could accidentally lose checklist progress with a single misclick on the other model's button.

#### fullResetChecklist()

- **File:** Trade_Journal/index.html (lines 12146-12188)
- **Module:** Daily Bias — Model Switching / Reset
- **Purpose:** Fully resets the Daily Bias ("idea") entry form back to blank defaults after user confirmation — clearing answers, kills, screenshots, pair/date/session fields, notes, and restoring the default model from localStorage.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - `confirm('Clear ALL — dropdowns, screenshots, pair name, notes? Daily Bias data is preserved.')`; aborts if cancelled.
  - Resets `S.answers={}`, `S.kills={}`, `S.killOpen=false`, `S.ideaSS=[]`.
  - Generates fresh `_pendingUploadTradeId`.
  - Clears `S.checklistMode`, `S.checklistEditId` (exits edit mode if it was active).
  - Resets `S.ideaModel` from localStorage (`ict_ideaModel`, default 'omar') — i.e. reverts to the user's last-used default model, not necessarily the model that was active before reset.
  - Clears `S.wbEntryId = null`.
  - Re-enables and clears `#ideaPair`, `#ideaDate` (reset to today), `#ideaSession` (first option) — each guarded by element existence, also clearing any `disabled`/inline background styling that may have been applied (e.g. by a locked-edit state elsewhere).
  - Clears rich-text `ideaNotes`; clears `#ideaSsGrid`; hides `#ideaVerdict` if present.
  - Calls `setTradeType('BUY')`.
  - Resets `S.ideaPaper=false` and the idea-page LIVE/PAPER segmented buttons to default LIVE-selected state.
  - Calls `updateScoreStrip()`, `renderBiasCards()`, `renderEntrySection()`.
  - Resets the primary action button (`#logPrimaryBtn`) text to "📊 LOG AS OPEN TRADE" and its onclick handler to `saveIdeaAsOpen` (undoing any prior rebinding to an edit-mode save handler).
  - Resets the section heading (`#page-idea .sec-head h2`) text to "DAILY BIAS" (undoing any "EDIT —" title set during edit mode).
  - Clears `#wbEntryDropdown` value.
- **Calls:** rteSet, setTradeType, updateScoreStrip, renderBiasCards, renderEntrySection
- **Called by:** (none detected — verify: bound via inline `onclick="fullResetChecklist()"` on a "Clear/Reset" button on the Daily Bias page)
- **Side effects:** Global state: resets ~9 `S.*` fields plus `_pendingUploadTradeId`. localStorage: reads `ict_ideaModel`. DOM: resets/re-enables ~6 form fields, resets primary button text+handler, resets section heading text, resets paper toggle buttons, three cascading re-renders.
- **Notes:** Directly reassigns `primaryBtn.onclick = saveIdeaAsOpen` as a JS property (not an HTML attribute string) — this is the mechanism by which the same button is repurposed between "create" and "update" modes elsewhere in the app (the edit-mode entry point presumably reassigns `.onclick` to `saveChecklistUpdate` instead).

#### setTradeType(type)

- **File:** Trade_Journal/index.html (line 12190)
- **Module:** Daily Bias — Model Switching / Reset
- **Purpose:** Sets the global "current trade type" flag (BUY/SELL) used as a fallback direction for the Daily Bias idea form when no auto-bias is computed.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| type | string | 'BUY' or 'SELL' (falsy defaults to 'BUY') |

- **Returns:** void
- **Internal logic:** Single statement: `S.tradeType = type || 'BUY'`.
- **Calls:** (none)
- **Called by:** navTo, fullResetChecklist, saveIdeaAsOpen
- **Side effects:** Global state: `S.tradeType`.
- **Notes:** Unlike `setIntraType`/`setIntraPaper`/`setIdeaPaper`, this variant takes no `el` parameter and does not touch any DOM/button styling — it's purely a state setter, presumably because the Daily Bias direction is normally auto-derived from `getBias()` (the checklist engine's computed bias) rather than manually toggled via a segmented button in the primary flow; it exists mainly as a fallback default.

### Module: Daily Bias — Score Strip

#### updateScoreStrip()

- **File:** Trade_Journal/index.html (lines 12192-12235)
- **Module:** Daily Bias — Score Strip
- **Purpose:** Renders the sticky progress/score strip at the top of the Daily Bias page — showing questions-answered count, a grade/state badge, a progress bar, a verdict summary line with confidence, and the auto-derived trade direction.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Computes `ans`/`tot`/`hasAll` via `countAnswered()`/`totalQs()`; `isTT` model check.
  - Runs the appropriate engine (`runTTEngine`/`runHTFEngine`) only if `hasAll` is true, else `result = null`; extracts `meta = result?.meta`.
  - Sets `#scoreNum` text to `ans`.
  - Sets `#scoreGrade` text/class: if a result exists, text is the TTrades label or OMAR `envData.envLabel`; class is `'score-grade grade-' + tier`, where tier is looked up from a TTrades state→tier map (`aplus`/`a`/`b`/`none`) or via `gradeClass(result.envData.env)` for OMAR. If no result, shows a placeholder label ("DAILY EXPECTATION"/"MARKET STATE") with `grade-none` class.
  - Computes `pct = ans/tot*100`; sets `#scoreBarFill` width and background color (dark neutral if not all answered, else the engine's meta color or muted fallback).
  - Builds `ttVerdictMap`/`htfVerdictMap` (emoji + label per state); picks the applicable map; computes `confLabel` string ('· High/Medium/Low Confidence') from `result.confidence`; sets `#scoreVerdict` text to the mapped verdict + confidence, or a "pending" prompt if no result.
  - Sets `#progFill` width and `#progLabel` text to "{ans}/{tot}".
  - Computes `bias = getBias()`; sets `#ideaDirAuto` text and CSS class (bull/bear coloring) to reflect the auto-derived direction.
  - Sets `#stripModelBadge` text to 'TTRADES' or 'OMAR'.
- **Calls:** countAnswered, totalQs, runTTEngine, runHTFEngine, gradeClass, getBias
- **Called by:** navTo, onDropChange, switchIdeaModel, fullResetChecklist
- **Side effects:** DOM: writes to `#scoreNum`, `#scoreGrade` (text+class), `#scoreBarFill` (width+background), `#scoreVerdict`, `#progFill` (width), `#progLabel`, `#ideaDirAuto` (text+class), `#stripModelBadge`.
- **Notes:** No null-guards on any of the many `document.getElementById(...)` calls except `#ideaDirAuto` — if this function is invoked while the Daily Bias page's score-strip markup isn't present in the DOM, most lines would throw; presumably callers only invoke it when `#page-idea` is the active page.

### Module: Daily Bias — Save as Open Trade

#### saveIdeaAsOpen()

- **File:** Trade_Journal/index.html (lines 12237-12318)
- **Module:** Daily Bias — Save as Open Trade
- **Purpose:** Validates and saves the Daily Bias checklist form as a brand-new "open" trade record (non-intraday), capturing the frozen checklist answers/kills/model, then resets the form for the next entry.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Calls `harvestTags('idea')` to collect tag chips into `S.ideaTags`.
  - Reads/trims `#ideaPair`, reads `#ideaDate`. Guard: if either empty, alert and abort.
  - Guard: if any screenshot in `S.ideaSS` is still `_uploading`, warning toast and abort.
  - Computes `bias = getBias() || 'NEUTRAL'`.
  - Reads `wbEntryId` from `#wbEntryDropdown` (or null).
  - Builds a new `trade` object: id from `_pendingUploadTradeId` or fresh UUID; `status:'open'`; not flagged `isIntraday` (implicitly, since the field is absent — daily-bias trades are distinguished from intraday ones by the absence of `isIntraday:true`); `tradeType` derived as BUY if bias is BULLISH, SELL if BEARISH, else falls back to `S.tradeType||'BUY'`; `score:null, grade:null`; `biasSet:bias`; empty result/close fields; `ideaNotes` from rich text; null entry/SL/TP/lot (Daily Bias ideas don't capture price levels at creation, unlike Intraday); `screenshots:[...S.ideaSS]`; `checklistAnswers:{...S.answers}` and `checklistKills:{...S.kills}` (snapshotted/frozen at save time); `checklistModel:S.ideaModel`; `tags:[...S.ideaTags]`; `wbEntryId`; `isPaper:!!S.ideaPaper`; intraday-related fields all nulled/false (since this isn't an intraday trade, these are placeholder defaults presumably for schema consistency).
  - Pushes the trade to the front of `S.trades` via `unshift`; calls `saveTrade(trade)`.
  - Resets `S.answers={}`, `S.kills={}`, `S.killOpen=false`, `S.ideaSS=[]`, `S.ideaTags=[]`, `S.wbEntryId=null`; pre-generates a new `_pendingUploadTradeId`.
  - Clears `#ideaPair`, resets `#ideaDate` to today, resets `#ideaSession` to first option, clears rich-text notes, clears `#ideaSsGrid`.
  - Removes any removable tag chips from `#ideaTagWrap`.
  - Hides `#ideaVerdict` if present.
  - Calls `setTradeType('BUY')`; resets `S.ideaPaper=false` and the idea-page paper segmented buttons to default.
  - Clears `#wbEntryDropdown` value.
  - Calls `updateOpenBadge()`; shows a success toast; schedules `navTo('home')` after a 600ms delay.
- **Calls:** harvestTags, showToast, getBias, rteGet, saveTrade, rteSet, remove (classList/tag chip removal), setTradeType, updateOpenBadge, navTo
- **Called by:** (none detected — verify: this is the default handler bound to `#logPrimaryBtn.onclick` per `fullResetChecklist`'s reset logic, and likely also referenced directly via inline `onclick="saveIdeaAsOpen()"` in the initial page markup)
- **Side effects:** Global state: prepends to `S.trades`; resets ~7 `S.*` fields; regenerates `_pendingUploadTradeId`. Persistence: `saveTrade` (Supabase `trades` table insert). DOM: clears/resets ~6 form fields, hides verdict panel, resets paper toggle, updates open-trade badge, shows toast, delayed navigation to home.
- **Notes:** The 600ms delayed `navTo('home')` (vs. the immediate navigation in `saveIntradayIdea`) gives the user time to see the success toast/verdict before the page changes — a deliberate UX pacing difference between the two save flows. Checklist answers/kills are deep-copied via spread (`{...S.answers}`) so later checklist edits (`S.answers` being reused for the next entry) won't retroactively mutate this saved trade's frozen record.

### Module: Checklist Viewer / Editor (Read-only and Edit modes)

#### openChecklistView(id)

- **File:** Trade_Journal/index.html (lines 12323-12351)
- **Module:** Checklist Viewer / Editor
- **Purpose:** Opens a read-only modal displaying the frozen checklist Q&A record for a Daily Bias trade (typically a closed one), without exposing any save/edit capability, to protect historical grading data from accidental modification.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| id | string/number | Trade id to view |

- **Returns:** void
- **Internal logic:**
  - Finds `t` in `S.trades`; aborts if not found or if `t.isIntraday` (this viewer is Daily-Bias-only; intraday trades don't have this style of checklist).
  - Determines `model = t.checklistModel || 'omar'`; selects the matching card definitions (`BIAS_CARDS_TTRADES` or `BIAS_CARDS_OMAR`).
  - Reads `answers = t.checklistAnswers || {}`, `kills = t.checklistKills || {}`.
  - For each card: renders its title/number, then for each question a labeled block showing either the recorded answer's label or "— Not answered —" (muted styling if unanswered); then for each kill item, a checked/unchecked line (☒/☐) styled bear-red if checked.
  - Sets `#checklistViewTitle` to "{pair} · {date} — Checklist ({Model})".
  - Sets `#checklistViewBody` innerHTML to the composed HTML, or an empty-state message if no HTML was produced (no cards/questions to show — unlikely given card constants are static, but guards against an empty checklist entirely).
  - Adds `.open` to `#checklistViewModal`.
- **Calls:** idEq
- **Called by:** openTradeHistory
- **Side effects:** DOM: sets `#checklistViewTitle` text, `#checklistViewBody` innerHTML, opens `#checklistViewModal`.
- **Notes:** Explicit code comments confirm the intentional design: this is a read-only viewer distinct from `openChecklistEdit`, specifically to prevent altering historical grading data on closed trades — invoked from the trade history view rather than from the open-trades/edit flow.

#### openChecklistEdit(id)

- **File:** Trade_Journal/index.html (lines 12353-12410)
- **Module:** Checklist Viewer / Editor
- **Purpose:** Opens the appropriate edit flow for a given trade's checklist/setup — routing to the full Intraday form repopulation if the trade is an intraday setup, or to the Daily Bias checklist edit mode (navigating to the 'idea' page with `S.checklistMode='edit'`) otherwise.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| id | string/number | Trade id to edit |

- **Returns:** void
- **Internal logic:**
  - Finds `t` in `S.trades`; aborts if not found.
  - **Intraday branch** (`t.isIntraday` true): sets `S.intradayView='form'`, `S.intradayEditId=id`, `S.intradayMode='edit'`; repopulates the entire intraday form (title, pair, date, session, entry/SL/TP/lot, notes, BUY/SELL and LIVE/PAPER segmented buttons, tags, `S.intraExData`/`intraAlignment`/`intraDecision`/`intraKill` from the trade record, weekly-link select + `onIntraWeeklyLink()` if linked); calls `renderIntradayView()`, `renderDecisionEngine()`, `renderIntradayDecisionStrip()`, `computeAlignmentAndBanner()`, `navTo('intraday')`; then returns (skips the Daily Bias branch below).
  - **Daily Bias branch** (non-intraday, falls through if the above `return` wasn't hit): sets `S.checklistEditId=id`; deep-copies `t.checklistAnswers`/`t.checklistKills` into `S.answers`/`S.kills` (shallow spread, not deep clone); sets `S.tradeType=t.tradeType||'BUY'`, `S.ideaModel=t.checklistModel||'omar'`, `S.wbEntryId=t.wbEntryId||null`, `S.checklistMode='edit'`; calls `navTo('idea')`.
- **Calls:** idEq, rteSet, remove (classList), renderTagsInWrap, onIntraWeeklyLink, renderIntradayView, renderDecisionEngine, renderIntradayDecisionStrip, computeAlignmentAndBanner, navTo
- **Called by:** renderWeekly, renderOpen, tradeCard
- **Side effects:** Global state: (intraday branch) numerous `S.intra*` fields; (daily branch) `S.checklistEditId`, `S.answers`, `S.kills`, `S.tradeType`, `S.ideaModel`, `S.wbEntryId`, `S.checklistMode`. DOM: (intraday branch) full form repopulation as described in `editIntradayFromList`; (daily branch) none directly — relies on `navTo('idea')` to trigger the idea page's own render cycle (which presumably calls `renderBiasCards`/`updateScoreStrip`/`renderEntrySection` internally, picking up the pre-set `S.answers`/`S.kills`/`S.ideaModel`).
- **Notes:** This function's intraday branch duplicates `editIntradayFromList`'s logic almost verbatim (as noted there) — a prime refactor candidate. Note that unlike `renderBiasCards`'s edit-mode "LOCKED" behavior driven by `UPDATABLE_QS`, this function doesn't itself enforce which fields are editable — that enforcement happens later, at render time, in `renderBiasCards`.

#### saveChecklistUpdate()

- **File:** Trade_Journal/index.html (lines 12412-12425)
- **Module:** Checklist Viewer / Editor
- **Purpose:** Persists an in-place edit to a Daily Bias trade's checklist — but only updates the four fields flagged as "updatable" post-creation (`UPDATABLE_QS`), leaving the rest of the frozen checklist answers untouched.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Finds `t` via `idEq(t.id, S.checklistEditId)`; aborts if not found.
  - For each `qid` in the `UPDATABLE_QS` set, overwrites `t.checklistAnswers[qid] = S.answers[qid]` (copies only these 4 fields' current in-memory values back onto the trade's frozen record; all other fields in `t.checklistAnswers` remain as originally saved, even if `S.answers` for the edit session happened to contain different values for them, since edit-mode disables those inputs at render time).
  - Overwrites `t.checklistKills = {...S.kills}` wholesale (kills ARE fully replaceable on edit, unlike answers).
  - Reads `#wbEntryDropdown` value, if present, and sets `t.wbEntryId` from it.
  - Calls `saveTrade(t)`.
  - Clears `S.checklistMode`, `S.checklistEditId`; resets `S.ideaModel` from localStorage default.
  - Shows a success toast including the freshly-derived grade text: `'✓ Checklist updated — ' + deriveDisplayGrade(t)`.
  - Calls `navTo('open')`.
- **Calls:** idEq, saveTrade, showToast, deriveDisplayGrade, navTo
- **Called by:** (none detected — verify: bound via inline `onclick="saveChecklistUpdate()"` on the Daily Bias page's save button while in edit mode, i.e. the `#logPrimaryBtn` onclick would have been reassigned to this function when entering edit mode, analogous to how `fullResetChecklist` reassigns it back to `saveIdeaAsOpen`)
- **Side effects:** Global state: mutates `t.checklistAnswers` (4 fields) and `t.checklistKills` (wholesale) in `S.trades`; clears edit-mode state flags. Persistence: `saveTrade` (Supabase `trades` update). DOM: none directly besides toast + navigation.
- **Notes:** This is the concrete enforcement point of the "locked vs updatable" business rule described in `renderBiasCards`'s notes — even though the render layer disables the locked dropdowns, this save function provides a second, authoritative guarantee that only `UPDATABLE_QS` fields can ever be overwritten during an edit, regardless of what ends up in `S.answers` by the time save is clicked.

### Module: Grading Utilities

#### getGrade(score)

- **File:** Trade_Journal/index.html (lines 12427-12433)
- **Module:** Grading Utilities
- **Purpose:** Legacy points-based grade lookup — converts a numeric score into a letter grade.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| score | number | A numeric point score |

- **Returns:** string — 'A+' (score>=9), 'A' (>=8), 'B' (>=7), 'C' (>=5), else 'No Trade'.
- **Internal logic:** Sequential if-cascade of threshold comparisons, returning the first match.
- **Calls:** (none)
- **Called by:** (none detected — verify: appears to be dead/legacy code; the surrounding code comments in `deriveDisplayGrade` explicitly state the app "Never reads t.score or t.grade (legacy broken pts-based fields)", strongly suggesting `getGrade` is a vestige of the old points-based system no longer wired into any active flow)
- **Side effects:** None (pure function).
- **Notes:** Very likely dead code given the adjacent large comment block (lines 12443-12451) explicitly documenting that the app has moved away from points-based `score`/`grade` fields in favor of the engine-derived `deriveDisplayGrade` system. Kept for reference/no callers found in this chunk or cross-file analysis.

#### gradeClass(g)

- **File:** Trade_Journal/index.html (lines 12435-12441)
- **Module:** Grading Utilities
- **Purpose:** Maps a letter grade string to its corresponding CSS class suffix for grade-colored badges/pills.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| g | string | Letter grade: 'A+', 'A', 'B', 'C', or other |

- **Returns:** string — 'aplus', 'a', 'b', 'c', or 'none' (default).
- **Internal logic:** Sequential if-cascade, default 'none'.
- **Calls:** (none)
- **Called by:** updateScoreStrip, tradeScorePill
- **Side effects:** None (pure function).
- **Notes:** Actively used (unlike `getGrade`) — takes the OMAR engine's `envData.env` value (e.g. 'A+', 'A', 'B', 'C') and converts it to a CSS class suffix consumed by grade-colored UI elements.

### Module: Display Grade Engine

#### deriveDisplayGrade(trade)

- **File:** Trade_Journal/index.html (lines 12453-12491)
- **Module:** Display Grade Engine
- **Purpose:** The single authoritative function for determining what grade/label to display for any trade record, correctly routing between three different grading sources depending on trade type and checklist model (Intraday's frozen `intraScores`, Weekly Bias engine, Daily OMAR engine, or TTrades engine) — explicitly bypassing the legacy/broken `t.score`/`t.grade` fields.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| trade | object | A trade record from `S.trades` (or occasionally `S.weeklies`, though this chunk's logic is trade-shaped) |

- **Returns:** string — a grade/label string (e.g. 'A+', 'Bullish Expansion Day', an envData label) or 'N/A' if ungradeable.
- **Internal logic:**
  - Guard: if `trade` falsy, return 'N/A'.
  - **Layer 3 — Intraday:** if `trade.isIntraday`, returns `trade.intraScores?.grade || 'N/A'` immediately (a code comment explains open intraday trades have no `intraScores` yet, and intraday trades don't run their own independent checklist engine — they inherit their parent's `checklistAnswers` — so falling through to the engine logic below would be wrong for them).
  - Reads `ans = trade.checklistAnswers`; guard: if missing or empty object, return 'N/A'.
  - Reads `model = trade.checklistModel || 'omar'`.
  - **Layer 1 — Weekly Bias** (`model === 'weekly'`): runs `runWBEngine(ans)`; if no result, 'N/A'; else returns `result.envData?.envLabel || result.meta?.label || 'N/A'`.
  - **Layer 2a — Daily OMAR** (`model === 'omar'`): runs `runHTFEngine(ans)`; same fallback chain as above.
  - **Layer 2b — TTrades** (`model === 'ttrades'`): runs `runTTEngine(ans)`; since TTrades results have no `envData`, returns `result.meta?.label || 'N/A'` directly.
  - Falls through to 'N/A' if `model` matches none of the above (shouldn't normally happen).
- **Calls:** runWBEngine, runHTFEngine, runTTEngine
- **Called by:** saveChecklistUpdate, deriveDisplayGradeClass, renderClosed, openTradeHistory, renderDashboard, exportExcel, openIntraForTrade, tradeScorePill, shareOpenTrade, shareClosedTrade
- **Side effects:** None (pure — computes and returns without mutating `trade` or global state; though the underlying `run*Engine` functions may themselves be pure computations over the passed `ans`).
- **Notes:** This is a heavily cross-referenced utility (10 distinct callers elsewhere in the file per the static analysis) — effectively the single source of truth for "what grade does this trade show," replacing an older/broken points-based system. The large doc comment directly above it in the source (lines 12443-12451) is essentially inline documentation of exactly this dispatch table, confirming the intent.

#### deriveDisplayGradeClass(trade)

- **File:** Trade_Journal/index.html (lines 12496-12510)
- **Module:** Display Grade Engine
- **Purpose:** Companion to `deriveDisplayGrade` — maps its returned grade/label string to a CSS class suffix for consistent pill/badge coloring across both the intraScores grade-space and the TTrades directional-state label-space.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| trade | object | A trade record, passed through to `deriveDisplayGrade` |

- **Returns:** string — one of 'aplus', 'a', 'b', 'c', 'invalid', 'none'.
- **Internal logic:**
  - Calls `g = deriveDisplayGrade(trade)`.
  - Checks against intraScores-space values: `'A+'`/`'A+ Environment'` → 'aplus'; `'A'`/`'A Environment'` → 'a'; `'B'`/`'B Environment'` → 'b'; `'C'`/`'C Environment'` → 'c'; `'Invalid'` → 'invalid'.
  - Checks against TTrades meta.label-space values: `'Bullish Expansion Day'`/`'Bearish Expansion Day'` → 'aplus'; `'Bullish Continuation Day'`/`'Bearish Continuation Day'` → 'a'; `'Reversal Day'` → 'b'; `'Range Day'` → 'none'.
  - Default: 'none'.
- **Calls:** deriveDisplayGrade
- **Called by:** renderOpen, tradeCard, renderClosed, openTradeHistory, tradeScorePill
- **Side effects:** None (pure function).
- **Notes:** Handles two entirely different label vocabularies (letter-grade strings like 'A+' vs. TTrades' descriptive day-type strings like 'Bullish Expansion Day') in a single flat if-chain — since `deriveDisplayGrade` can return either depending on trade type/model, this function must recognize both forms to always produce a valid CSS class; any new label added to either engine's output would need a matching entry here or it silently falls back to 'none' styling.


---

## Trade_Journal — Functions (chunk 3 of 8, lines 12517-14377)

### Module: Alignment Engine / Score Derivation

#### deriveDisplayScore(trade)

- **File:** Trade_Journal/index.html (lines 12517-12523)
- **Module:** Alignment Engine / Score Derivation
- **Purpose:** Returns the "post-trade review" final numeric score for an intraday trade, if one exists, for use in badges/pills across the UI.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| trade | Object | A trade record from `S.trades` |

- **Returns:** `number|null` — `trade.intraScores.finalScore` if the trade is intraday and has scores, else `null`.
- **Internal logic:**
  - Guard: if `trade` is falsy, return `null`.
  - If `trade.isIntraday` and `trade.intraScores?.finalScore != null`, return that score.
  - Otherwise return `null`.
- **Calls:** (none)
- **Called by:** openTradeHistory, exportExcel, tradeScorePill, shareOpenTrade, shareClosedTrade
- **Side effects:** None (pure read).
- **Notes:** Purely derived — never persisted separately from `intraScores`. Only meaningful for `isIntraday` trades.

#### deriveAlignmentStatus(weeklyResult, dailyResult, ttResult)

- **File:** Trade_Journal/index.html (lines 12534-12613)
- **Module:** Alignment Engine / Score Derivation
- **Purpose:** Pure "alignment engine" that measures directional agreement between the Weekly Bias, Daily Bias (Omar model), and TTrades checklist engine results, producing a star rating and label (Triple Alignment / Partial Alignment / Conflict / Insufficient Data).
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| weeklyResult | Object\|null | Result of `runWBEngine(w.wbChecklistAnswers)` |
| dailyResult | Object\|null | Result of `runHTFEngine(t.checklistAnswers)` when model is 'omar' |
| ttResult | Object\|null | Result of `runTTEngine(t.checklistAnswers)` when model is 'ttrades' |

- **Returns:** `Object` — `{ stars, label, alignmentType, direction? }` where `alignmentType` is one of `'unknown'|'triple'|'partial'|'conflict'`.
- **Internal logic:**
  - Defines local helper `toDirection(result)` (see below) to normalize each engine's `state` field to `'BULLISH'|'BEARISH'|'NEUTRAL'|null`.
  - Computes `wDir`, `dDir`, `ttDir` via `toDirection`.
  - Builds `available = [wDir,dDir,ttDir].filter(Boolean)` — non-null directions.
  - If fewer than 2 directions available → returns Insufficient Data (`☆☆☆☆☆`, `unknown`).
  - If all 3 available and all agree (all bullish or all bearish) → Triple Alignment (`★★★★★`).
  - Else if Weekly and Daily agree on a non-neutral direction:
    - If TTrades is available, non-neutral, and opposes that consensus → Conflict (`★☆☆☆☆`).
    - Otherwise → Partial Alignment (`★★★☆☆`) with `direction = wDir`.
  - Else checks for a two-layer conflict: Weekly vs Daily directional disagreement (`hasConflict`), or TTrades opposing a W+D consensus (`ttOpposes`) → Conflict.
  - Default fallback → Partial Alignment, direction = first non-neutral direction found (or null).
- **Calls:** toDirection, filter
- **Called by:** (none detected — verify: may be dead code or called only from a section of the file outside this chunk / future feature not yet wired up)
- **Side effects:** None — pure function.
- **Notes:** Despite having no detected callers in the whole-file static analysis, the comment block above it explicitly documents it as the "ALIGNMENT ENGINE" and lists its parameter sources, implying it's intended to be wired to per-trade alignment display (possibly superseded by the `intraAlignment` field which is set elsewhere and used directly by `computeHiddenScores`). Likely present for future/partial use or replaced by a different code path.

#### toDirection(result)

- **File:** Trade_Journal/index.html (lines 12537-12546)
- **Module:** Alignment Engine / Score Derivation
- **Purpose:** Inner helper of `deriveAlignmentStatus` that maps an engine result's `state` string to a coarse direction label.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| result | Object\|null | An engine result object with a `.state` string field |

- **Returns:** `'BULLISH'|'BEARISH'|'NEUTRAL'|null` — null only if `result` itself is falsy.
- **Internal logic:**
  - If `!result`, return `null`.
  - Read `s = result.state || ''`.
  - If `s` is one of `bullish_continuation`, `bullish_reversal`, `bullish_expansion` → `'BULLISH'`.
  - If `s` is one of `bearish_continuation`, `bearish_reversal`, `bearish_expansion` → `'BEARISH'`.
  - Anything else (neutral/range/ambiguous reversal states) → `'NEUTRAL'`.
- **Calls:** (none)
- **Called by:** deriveAlignmentStatus (as a closure defined and called only within it)
- **Side effects:** None.
- **Notes:** Defined as a nested function declaration inside `deriveAlignmentStatus`, not at top level — its true scope is private to that function, which is why static "called by" cross-reference correctly shows only `deriveAlignmentStatus`.

### Module: Weekly Bias Entry Dropdown

#### refreshWbEntryDropdown()

- **File:** Trade_Journal/index.html (lines 12616-12635)
- **Module:** Weekly Bias Entry Dropdown / Trade-Idea Form
- **Purpose:** Rebuilds the `#wbEntryDropdown` `<select>` options on the new-idea form, listing open Weekly Bias entries (optionally filtered by the currently typed pair), so a new trade idea can be linked to a parent Weekly Bias.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Grabs `#wbEntryDropdown`; bails if missing.
  - Reads the current `#ideaPair` input value, uppercased/trimmed, as `pair`.
  - Filters `S.weeklies` to `status === 'open'` → `openWeeklies`.
  - Builds an options string starting with `— None —`.
  - If `pair` is non-empty, further filters `openWeeklies` to those whose `.pair` includes `pair` (case-insensitive) → `filtered`.
  - For each weekly in `filtered`, appends an `<option>` with value = weekly id, marking it `selected` if it matches `S.wbEntryId` (via `idEq`); label shows pair, date, and bias (default `NEUTRAL`).
  - Sets `sel.innerHTML = options`.
  - If `S.wbEntryId` is set but no longer exists in the filtered list, clears `S.wbEntryId` to `null` (so stale/filtered-out selections don't linger).
- **Calls:** filter, idEq
- **Called by:** navTo, onWbEntryDropdownChange
- **Side effects:** DOM: rewrites `#wbEntryDropdown` innerHTML. Reads `#ideaPair` DOM value. Global state: may null out `S.wbEntryId`.
- **Notes:** Designed to be re-invoked whenever the pair filter text changes, to keep the dropdown relevant to the currently-typed pair.

#### onWbEntryDropdownChange()

- **File:** Trade_Journal/index.html (lines 12637-12652)
- **Module:** Weekly Bias Entry Dropdown / Trade-Idea Form
- **Purpose:** Change handler for `#wbEntryDropdown` — records the selected Weekly Bias link and auto-fills the pair field from the linked weekly if empty.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Grabs `#wbEntryDropdown`; bails if missing.
  - Sets `S.wbEntryId = sel.value || null`.
  - If a weekly is selected, looks it up in `S.weeklies` via `idEq`.
  - If found and it has a `.pair`, and the `#ideaPair` field exists, is not disabled, and is currently empty, sets the pair field's value to the weekly's pair and calls `refreshWbEntryDropdown()` again to re-filter the dropdown to match the now-populated pair.
- **Calls:** idEq, refreshWbEntryDropdown
- **Called by:** (none detected — verify: this is almost certainly wired as an inline `onchange="onWbEntryDropdownChange()"` attribute on the `#wbEntryDropdown` `<select>` element in the HTML form, which the static analyzer does not pick up as a call site)
- **Side effects:** DOM: reads/writes `#wbEntryDropdown` and `#ideaPair` values. Global state: sets `S.wbEntryId`.
- **Notes:** Classic onchange-only entry point; never called programmatically elsewhere in the script.

### Module: Post-Trade Review / Hidden Scoring Engine

#### computeHiddenScores(trade)

- **File:** Trade_Journal/index.html (lines 12658-12750)
- **Module:** Post-Trade Review / Hidden Scoring Engine
- **Purpose:** Computes the "hidden analytics" opportunity-quality score (Context / Setup / Execution / Final / Grade / Explanation) for a closed intraday trade, blending the linked Weekly Bias engine output, the linked Daily Bias engine output, alignment, and execution-quality signals.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| trade | Object | A trade record (expected intraday & closed) |

- **Returns:** `Object|null` — `{ contextScore, setupScore, execScore, finalScore, grade, explanation }`, or `null` if the trade is missing, not intraday, or not closed.
- **Internal logic:**
  - Guard: returns `null` unless `trade && trade.isIntraday && trade.status === 'closed'`.
  - **Context score** (max blend of components, additive):
    - If `trade.wbEntryId` links to a Weekly Bias (`S.weeklies` lookup via `idEq`) that has `wbChecklistAnswers`, runs `runWBEngine` on it; adds points for `envData.env` grade (`A+`=25, `A`=20, `B`=12, `C`=5) and for `confidence` (`high`=15, `medium`=10, `low`=5).
    - If `trade.weeklyLinkId` links to a parent daily-bias trade in `S.trades` (non-intraday, matched via `idEq`) with `checklistAnswers`, runs `runHTFEngine`; adds points for its `envData.env` (`A+`=20, `A`=16, `B`=10, `C`=4) and `confidence` (`high`=15, `medium`=10, `low`=5).
    - Adds points from `trade.intraAlignment`: `Strong`=15, `Moderate`=8, `Conflict`=0, else (including undefined) = 5.
  - **Setup score:** from `trade.intraExData` (`ex`): `ex.lq === true` → +25; `ex.disp === 'Strong'` → +35, `'Weak'` → +15, `'None'` → +0; `ex.mss === true` → +20; `ex.ret === true` → +20.
  - **Execution score:**
    - `allSteps` = true if `lq===true && disp!=='None' && disp!=null && mss===true && ret===true`; if so +40.
    - Counts other closed intraday trades on the same `trade.date` (`todayTrades`); if this is the only trade that day (`length <= 1`) → +30 (rewards not overtrading).
    - If `trade.biasSet && trade.biasPlayed` and they're equal → +30; if both set but different → +15; else (missing) → +5.
  - **Final score:** weighted blend `finalScore = context*0.35 + setup*0.40 + exec*0.25`.
  - **Grade:** `finalScore>=85` → `A+`; `>=70` → `A`; `>=55` → `B`; else `Invalid`.
  - **Explanation:** base text per grade tier, plus appended caveats if `contextScore<40`, `setupScore<40`, or `execScore<40` respectively.
  - Returns the full score object.
- **Calls:** idEq, runWBEngine, runHTFEngine, filter
- **Called by:** saveClosure, saveEditClosed
- **Side effects:** Reads `S.weeklies`, `S.trades` (no mutation itself — caller assigns the result to `trade.intraScores`).
- **Notes:** Pure/derived calculation; "hidden" in that it's not directly editable by the user, only computed at close time. The weighting (0.35/0.40/0.25) and thresholds are hardcoded business rules.

#### renderIntraPostTradeReview(trade)

- **File:** Trade_Journal/index.html (lines 12752-12795)
- **Module:** Post-Trade Review / Hidden Scoring Engine
- **Purpose:** Renders the HTML markup for the "POST-TRADE REVIEW — HIDDEN ANALYTICS" panel (Context/Setup/Execution bars, final score, grade pill, explanation) shown in trade history / intraday sub-views.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| trade | Object | A trade record expected to carry `intraScores` |

- **Returns:** `string` — HTML markup, or `''` if trade is not intraday/closed or has no `intraScores`.
- **Internal logic:**
  - Guards: returns `''` if trade missing, not intraday, not closed, or `trade.intraScores` falsy.
  - Defines a local `barColor(v)` arrow function (see next entry) to color-code each metric bar (bull/gold/bear thresholds at 70/50).
  - Maps `scores.grade` to a pill CSS class (`pill-aplus`/`pill-a`/`pill-b`/`pill-invalid`).
  - Builds and returns a template-literal HTML block with three progress bars (Context, Setup, Execution — each showing rounded score and colored fill), a "Final" row with `finalScore.toFixed(1)` and the grade pill, and an explanation line.
- **Calls:** barColor (local closure)
- **Called by:** openTradeHistory
- **Side effects:** None (pure string builder); no direct DOM writes (caller inserts the returned HTML).
- **Notes:** Also referenced by name from `openTradeHistory`'s own internal per-intraday loop (`renderIntraPostTradeReview(intraItem)`), consistent with the `totalCallSitesInFile: 3` count (once for the main trade, once inside the intras.map loop, and via `postTradeHtml` assignment).

#### barColor(v)

- **File:** Trade_Journal/index.html (lines 12757-12761)
- **Module:** Post-Trade Review / Hidden Scoring Engine
- **Purpose:** Small local helper (const arrow function) that maps a 0-100 score to a CSS color variable for progress-bar fills.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| v | number | Score value, 0-100 |

- **Returns:** `string` — CSS var: `'var(--bull)'` if `v>=70`, `'var(--gold)'` if `v>=50`, else `'var(--bear)'`.
- **Internal logic:** Simple threshold ladder as described above.
- **Calls:** (none)
- **Called by:** renderIntraPostTradeReview, openTradeHistory
- **Side effects:** None.
- **Notes:** This is declared independently as a local `const barColor = (v) => {...}` inside both `renderIntraPostTradeReview` (line 12757) and again inside `openTradeHistory` (line 13971) — they are two separate closures with identical logic, not a shared top-level function. The JSON inventory treats them as one logical entry since the code is duplicated verbatim.

### Module: Open Trades — Badge, Patch, Screenshots

#### updateOpenBadge()

- **File:** Trade_Journal/index.html (lines 12801-12810)
- **Module:** Open Trades
- **Purpose:** Updates the "Open Trades" nav badge count and the dashboard tile label/sub-text to reflect the number of open, non-linked-intraday trade ideas.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Counts `n = S.trades.filter(t => t.status==='open' && (!t.isIntraday || !t.weeklyLinkId)).length` — i.e., open trades that are either daily/weekly ideas or standalone (unlinked) intraday scalps, excluding intraday trades linked to a parent.
  - Sets `#openBadge` textContent to `n` and shows/hides it (`display:''` vs `'none'`) based on `n>0`.
  - Updates `#openTileLabel` text to `"OPEN TRADES (n)"` or `"OPEN TRADES"`.
  - Updates `#openTileSub` text to `"n idea(s) pending"` or `"View pending ideas"`.
- **Calls:** filter
- **Called by:** loadAllData, saveIntradayIdea, saveIdeaAsOpen, renderOpen, saveClosure, renderDashboard, runArchive
- **Side effects:** DOM: `#openBadge`, `#openTileLabel`, `#openTileSub`.
- **Notes:** Purely a badge/count refresher; called defensively after almost every open-trades mutation.

#### patchOpen(id, field, val)

- **File:** Trade_Journal/index.html (lines 12812-12818)
- **Module:** Open Trades
- **Purpose:** Inline-edit handler for numeric price fields (Entry/SL/TP/Close) on open trade cards — updates a single field on a trade and persists it.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| id | string/number | Trade id |
| field | string | Field name to patch (e.g. `entryPrice`, `slPrice`) |
| val | string | Raw input value from the `<input onchange>` |

- **Returns:** void
- **Internal logic:**
  - Finds trade `t` in `S.trades` via `idEq`; returns if not found.
  - If `val === ''`, sets `t[field] = null`.
  - Otherwise parses `val` as float; if `NaN`, silently returns (no update); else sets `t[field] = n`.
  - Calls `saveTrade(t)` to persist.
- **Calls:** idEq, saveTrade
- **Called by:** renderOpen, tradeCard (via inline `onchange="patchOpen(...)"` attributes generated in the card HTML)
- **Side effects:** Global state: mutates matching trade object in `S.trades`. Persists via `saveTrade` (Supabase `trades` upsert + local cache, per global context).
- **Notes:** No re-render triggered — since the value came directly from the input the DOM already reflects it; avoids an unnecessary full re-render of the open trades list.

#### addSsToOpenTrade(id)

- **File:** Trade_Journal/index.html (lines 12820-12857)
- **Module:** Open Trades / Screenshot Storage
- **Purpose:** Opens a native file picker to let the user attach one or more screenshots to an open trade, compressing and uploading each to Supabase Storage (falling back to base64 inline storage on failure).
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| id | string/number | Trade id to attach screenshots to |

- **Returns:** void (fires an async file-picker flow)
- **Internal logic:**
  - Dynamically creates a hidden `<input type=file accept=image/* multiple>`.
  - Registers `onchange` handler (async):
    - Reads selected `files`.
    - Finds trade `t` via `idEq`; bails if not found.
    - Awaits `loadTradeScreenshots(t.id)` to ensure existing screenshots are loaded before appending (prevents overwrite race).
    - Ensures `t.screenshots` array exists.
    - For each file: tries `compressImage(f)` then `uploadScreenshotToStorage(compressed, id, f.name)`.
      - On success, uses `result.path` as the persisted `dataUrl` and `result.signedUrl` as `_displayUrl`.
      - On failure/no result, falls back to reading the file as a base64 data URL via `FileReader`, uses that as both stored and display URL, and shows a warning toast ("Storage upload failed — saved locally as fallback").
      - Pushes a new screenshot object `{id: crypto.randomUUID(), name, dataUrl, _displayUrl, label:'Trade Chart', at: <timestamp>}` onto `t.screenshots`.
      - Wraps each file's processing in try/catch, logging a console warning on error (does not abort the whole loop).
    - After processing all files, calls `saveTrade(t)` and `renderOpen()`.
  - Triggers the picker via `inp.click()`.
- **Calls:** idEq, loadTradeScreenshots, compressImage, uploadScreenshotToStorage, showToast, saveTrade, renderOpen
- **Called by:** renderOpen, tradeCard (via inline `onclick="addSsToOpenTrade('...')"`)
- **Side effects:** Network: Supabase Storage upload (`screenshots` bucket, via `uploadScreenshotToStorage`). Global state: pushes to `t.screenshots`. Persists trade. DOM: re-renders `#openContainer` via `renderOpen()`. Uses `crypto.randomUUID()`.
- **Notes:** Uploads happen sequentially in a `for...of` loop (not parallel) — each `await`ed in turn. Errors per-file are swallowed (loop continues) so a single bad file won't block the rest.

#### deleteOpenTrade(id)

- **File:** Trade_Journal/index.html (lines 12859-12876)
- **Module:** Open Trades / Trade CRUD
- **Purpose:** Deletes an open trade (idea) after user confirmation, removing it and any child intraday trades linked to it, both from Supabase and local state.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| id | string/number | Trade id to delete |

- **Returns:** void
- **Internal logic:**
  - Shows a native `confirm()` dialog; aborts if not confirmed.
  - Calls `deleteTradeSupa(id)` (Supabase delete), then in `.then()`:
    - Filters `S.trades` to drop the trade itself and any trades whose `weeklyLinkId` equals `id` (i.e., linked children), using `idEq` for both id and negated match.
    - Calls `renderOpen()`, `renderIntradayView()`, `renderDashboard()`.
  - In `.catch()` (error path): logs a console warning, but performs the exact same local-state cleanup and re-renders anyway — i.e., the UI proceeds as if deleted even if the Supabase call failed (optimistic/best-effort cleanup).
- **Calls:** deleteTradeSupa, filter, idEq, renderOpen, renderIntradayView, renderDashboard
- **Called by:** renderOpen, tradeCard
- **Side effects:** Supabase: DELETE on `trades` table (via `deleteTradeSupa`). Global state: removes entries from `S.trades`. DOM: re-renders Open, Intraday, and Dashboard views.
- **Notes:** Deliberately still purges local state even when the delete request fails — a design choice to keep local UI in sync at the risk of the row surviving server-side if the delete truly failed (no retry/error surfaced to the user beyond a console warning).

#### loadTradeScreenshotsForOpen(id)

- **File:** Trade_Journal/index.html (lines 12878-12908)
- **Module:** Open Trades / Screenshot Storage / Local Cache
- **Purpose:** Lazily loads (and caches) a trade's screenshot arrays (`screenshots`, `eodScreenshots`, `followupScreenshots`) from an IndexedDB-like cache (`_ssDB`) or Supabase if not already loaded, then resolves display URLs.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| id | string/number | Trade id |

- **Returns:** `Promise<Object|undefined>` — the trade object (mutated in place with screenshot fields), or the not-found result of the `.find()` if trade doesn't exist.
- **Internal logic:**
  - Finds trade `t` in `S.trades` via `idEq`; if not found, returns `t` (undefined).
  - If `t._ssLoaded` is already true, returns `t` immediately (no reload).
  - Tries `_ssDB.get(id)` (local cache lookup). If a cache hit exists:
    - Assigns `screenshots`/`eodScreenshots`/`followupScreenshots` from cache (defaulting to `[]`).
    - Sets `t._ssLoaded = true`.
    - Awaits `resolveTradeScreenshots(t)` (resolves signed/display URLs).
    - Returns `t`.
  - Otherwise (cache miss), wrapped in try/catch:
    - Queries Supabase `trades` table for `screenshots,eod_screenshots,followup_screenshots` where `id` matches and `user_id` matches `_currentUser.id`, `.single()`.
    - Throws on error.
    - Assigns fields from `data` (snake_case → camelCase field names), sets `_ssLoaded = true`.
    - Awaits `resolveTradeScreenshots(t)`.
    - Writes the resolved screenshots back into `_ssDB` cache with a `cachedAt` timestamp.
    - Catches and logs any error via `console.warn('Screenshot load error', e)`.
  - Returns `t` at the end regardless of which path was taken.
- **Calls:** idEq, get (`_ssDB.get`), resolveTradeScreenshots, set (`_ssDB.set`)
- **Called by:** (none detected — verify: likely dead code or superseded by the more commonly used `loadTradeScreenshots` function referenced throughout the rest of the file; naming strongly suggests it was an "open trades" specific variant that may no longer be wired up)
- **Side effects:** Reads local `_ssDB` cache; Supabase read (`trades` table select); writes back to `_ssDB` cache; mutates the trade object's screenshot fields and `_ssLoaded` flag.
- **Notes:** Nearly identical in shape to the generically-named `loadTradeScreenshots` (used pervasively elsewhere in the file) — this looks like an unused/legacy duplicate specific to the Open view that was likely replaced by the shared helper.

#### ssLazySection(id)

- **File:** Trade_Journal/index.html (lines 12910-12925)
- **Module:** Open Trades / Screenshot Storage / UI Rendering
- **Purpose:** Returns the HTML for a trade's screenshot section — either the already-loaded thumbnail grid (if `_ssLoaded`) or a lazy "TAP TO LOAD" placeholder that will populate on click.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| id | string/number | Trade id |

- **Returns:** `string` — HTML markup for the screenshot section.
- **Internal logic:**
  - Finds trade `t` via `idEq`.
  - If `t` exists and `t._ssLoaded` is true:
    - Combines `t.screenshots` and `t.eodScreenshots` into `allSS`.
    - If empty, returns `''`.
    - Else maps each screenshot to a `.ss-thumb` `<div>` with `onclick="openLb(src)"` (src = `_displayUrl` or `dataUrl`) and a label overlay; joins into a grid with a count header.
  - Otherwise (not loaded yet), returns a placeholder block: a clickable "📷 SCREENSHOTS TAP TO LOAD" label with `onclick="toggleTradeScreenshots(id)"`, plus an empty container `#ss-section-{id}` to be filled later.
- **Calls:** idEq, openLb (embedded in generated onclick string), toggleTradeScreenshots (embedded in generated onclick string)
- **Called by:** renderOpen, tradeCard
- **Side effects:** None directly (pure string builder); the generated markup wires up later DOM-mutating calls via inline `onclick`.
- **Notes:** `openLb`/`toggleTradeScreenshots` appear in the outboundCalls list because they're referenced by name inside the generated onclick HTML strings, not called directly — the static analyzer counted the string literal reference as a call.

#### toggleTradeScreenshots(id)

- **File:** Trade_Journal/index.html (lines 12927-12939)
- **Module:** Open Trades / Screenshot Storage
- **Purpose:** Click handler for the lazy-load screenshot placeholder — loads a trade's screenshots on demand and renders them into the `#ss-section-{id}` container.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| id | string/number | Trade id |

- **Returns:** `Promise<void>`
- **Internal logic:**
  - Finds `#ss-section-{id}` container; returns if missing.
  - Sets a "Loading…" placeholder message.
  - Awaits `loadTradeScreenshots(id)` to get the (possibly newly-fetched) trade object `t`.
  - Combines `t.screenshots` + `t.eodScreenshots` into `allSS`.
  - If empty, shows "No screenshots" message.
  - Otherwise builds thumbnail HTML (each with `onclick="openLb(src)"`) and injects into the container as a grid.
- **Calls:** loadTradeScreenshots, openLb
- **Called by:** ssLazySection (via generated inline `onclick` attribute)
- **Side effects:** DOM: `#ss-section-{id}` innerHTML. Triggers `loadTradeScreenshots` (Supabase read / cache, per global context).
- **Notes:** Only entry point is the inline onclick generated by `ssLazySection`; not called elsewhere.

#### toggleWbScreenshots(wbId)

- **File:** Trade_Journal/index.html (lines 12942-12965)
- **Module:** Bias CRUD / Screenshot Storage
- **Purpose:** Lazily loads and renders the main screenshots for a Weekly Bias entry into its `#wb-ss-{wbId}` container, including per-image delete buttons.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| wbId | string/number | Weekly bias entry id |

- **Returns:** `Promise<void>`
- **Internal logic:**
  - Finds `#wb-ss-{wbId}` container; returns if missing.
  - Shows "Loading…" message.
  - Finds the weekly `w` in `S.weeklies` via `idEq`.
  - If not found or has no screenshots, shows "No screenshots" message and returns.
  - Resolves each screenshot's display URL via `Promise.all(w.screenshots.map(resolveScreenshotForDisplay))`, reassigning `w.screenshots`.
  - Builds HTML: for each screenshot (indexed `si`), a `.ss-item` with a clickable thumbnail (`onclick="openLb(src)"`) and a delete bar button `onclick="deleteWbScreenshot(wbId, si)"`.
  - Injects the combined HTML into the container.
- **Calls:** idEq, resolveScreenshotForDisplay, openLb, deleteWbScreenshot
- **Called by:** renderWeekly
- **Side effects:** DOM: `#wb-ss-{wbId}` innerHTML. Global state: mutates `w.screenshots` in place (replacing entries with resolved-URL versions).
- **Notes:** Index-based delete (`si`) means it relies on array order staying stable between render and click — could be fragile if the array is re-sorted/mutated concurrently.

#### toggleWbUpdateScreenshots(wbId, atStr)

- **File:** Trade_Journal/index.html (lines 12968-12986)
- **Module:** Bias CRUD / Screenshot Storage
- **Purpose:** Lazily loads and renders screenshots attached to a specific timestamped "update" entry within a Weekly Bias's notes timeline.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| wbId | string/number | Weekly bias entry id |
| atStr | string | ISO timestamp string identifying which update entry (matched against `update.at`) |

- **Returns:** `Promise<void>`
- **Internal logic:**
  - Sanitizes `atStr` by stripping all non-digit characters (`safeAt`) to build a DOM-safe container id `wb-uss-{wbId}-{safeAt}`.
  - Finds that container; returns if missing.
  - Shows "Loading…".
  - Finds weekly `w` via `idEq`; returns if not found.
  - Finds the specific `update` in `w.updates` whose `.at === atStr` (exact match, unsanitized).
  - If no update or it has no screenshots, clears the container (empty string) and returns.
  - Resolves each screenshot's display URL via `Promise.all(...resolveScreenshotForDisplay)`, reassigning `update.screenshots`.
  - Builds a simple thumbnail grid (no delete buttons here) with `onclick="openLb(src)"`.
  - Injects into the container.
- **Calls:** idEq, resolveScreenshotForDisplay, openLb
- **Called by:** renderWeekly
- **Side effects:** DOM: the sanitized container's innerHTML. Global state: mutates `update.screenshots` in place.
- **Notes:** The container id sanitization (`replace(/[^0-9]/g,'')`) exists because timestamp strings contain characters (colons, dashes, "T", "Z") that aren't safe/unique-enough for use directly in an `id`/lookup without escaping; note this could theoretically collide if two different `atStr` values reduce to the same digit-only string, though unlikely given millisecond-precision ISO timestamps.

#### toggleNoteScreenshots(btn, noteObj)

- **File:** Trade_Journal/index.html (lines 12989-13001)
- **Module:** Trade CRUD / Screenshot Storage
- **Purpose:** Lazily loads and renders screenshots attached to a single trade note (from the notes timeline on an open trade card), replacing the "tap to load" button with the images.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| btn | HTMLElement | The clicked "📷 N screenshots — tap to load" button/span |
| noteObj | Object | The note object (`{at, text, screenshots}`) this button belongs to |

- **Returns:** `Promise<void>`
- **Internal logic:**
  - Gets `btn.nextElementSibling` as the target `container` (expected to be an empty `.note-ss-lazy` div); returns if missing.
  - If the container already has content (`innerHTML.trim()` truthy), returns early (already loaded — idempotent guard).
  - Sets `btn.textContent = 'Loading…'`.
  - Resolves each screenshot in `noteObj.screenshots` via `Promise.all(...resolveScreenshotForDisplay)`.
  - Builds thumbnail HTML with `onclick="openLb(src)"` for each.
  - Injects into `container`.
  - Hides the button (`btn.style.display = 'none'`) once loaded.
- **Calls:** resolveScreenshotForDisplay, openLb
- **Called by:** renderOpen, tradeCard
- **Side effects:** DOM: mutates `btn` text/visibility and the sibling container's innerHTML.
- **Notes:** Relies on DOM sibling structure (`btn.nextElementSibling`) rather than an id lookup — must match how `renderOpen`/`tradeCard` emit the button immediately followed by the empty div in the template string.

#### renderOpen()

- **File:** Trade_Journal/index.html (lines 13004-13188)
- **Module:** Open Trades / UI Rendering
- **Purpose:** Main renderer for the "Open Trades" view — filters trades to open (and, per a checkbox, paper or not), separates swing/weekly trades from standard trades, and renders each as a card (including nested linked-intraday sub-cards) into `#openContainer`. Also defines the `tradeCard` closure used per-trade.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Reads the `#openShowPaper` checkbox (`showPaper`), defaulting to true if unchecked state is not explicitly `false`.
  - Filters `S.trades` to `status==='open'`, respecting `showPaper` vs `isPaper`, and excluding "child" intraday trades that have a `weeklyLinkId` (those render nested inside their parent card instead) — keeps daily/weekly ideas and unlinked (scalp) intraday trades.
  - Grabs `#openContainer`; returns if missing.
  - Calls `updateOpenBadge()` and `updateIntradayBadge()` to refresh nav badges.
  - If no open trades: renders an empty-state block with two CTA buttons (`onclick="navTo('idea')"`) describing "Omar Model" and "TTrades Model" daily bias entry paths, then returns.
  - Splits `open` into `swingTrades` (trades tagged `weekly`) and `standardTrades` (all others).
  - Defines an inner function `tradeCard(t)` (documented separately below) that renders a single trade's full card HTML, including: pair/date header with tag pills, an "intel" panel showing checklist-model badge, bias, market state, confidence, and environment (computed via `runHTFEngine`/`runTTEngine` depending on `t.checklistModel`), idea/update notes, notes timeline, price input fields (wired to `patchOpen`), any linked open intraday sub-trades (each rendered as a nested `.intra-sub` block with its own price fields, screenshot section, and action buttons), the trade's own screenshot section (`ssLazySection`), and the action button row (Close, Intraday-idea, +Note, Edit, Checklist, +Shot, Share, Delete).
  - Builds final `html` string: a "SWING / WEEKLY TRADES" section header + mapped swing cards (if any), followed by a "STANDARD TRADES" section header + mapped standard cards (if any).
  - Sets `c.innerHTML = html`.
- **Calls:** filter, updateOpenBadge, updateIntradayBadge, navTo, tradeCard, deriveDisplayGradeClass, runHTFEngine, runTTEngine, idEq, rteDisplay, formatTsWithNY, toggleNoteScreenshots, patchOpen, toggleIntraSub, ssLazySection, openCloseModal, openTradeNoteModal, openEditOpenModal, openChecklistEdit, addSsToOpenTrade, shareOpenTrade, pullPricesFromIntra, deleteOpenTrade, openIntraForTrade
- **Called by:** loadAllData, navTo, addSsToOpenTrade, deleteOpenTrade, saveClosure, saveEditOpen, pullPricesFromIntra, saveTradeNote, runArchive
- **Side effects:** DOM: full rewrite of `#openContainer` innerHTML (and calls that update badges). Reads `#openShowPaper` checkbox.
- **Notes:** This is one of the largest render functions in the file (185 lines). Most of the listed outbound calls (deriveDisplayGradeClass, runHTFEngine, runTTEngine, rteDisplay, formatTsWithNY, toggleNoteScreenshots, patchOpen, toggleIntraSub, ssLazySection, openCloseModal, openTradeNoteModal, openEditOpenModal, openChecklistEdit, addSsToOpenTrade, shareOpenTrade, pullPricesFromIntra, deleteOpenTrade, openIntraForTrade) actually occur inside the nested `tradeCard` closure, either as direct JS calls or embedded in generated `onclick=` strings.

#### tradeCard(t)

- **File:** Trade_Journal/index.html (lines 13031-13176)
- **Module:** Open Trades / UI Rendering
- **Purpose:** Inner function of `renderOpen()` — builds the complete HTML markup for one open-trade card (pair header, checklist-engine intel panel, notes, price inputs, linked intraday sub-cards, screenshots, and action buttons).
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| t | Object | A single open trade record |

- **Returns:** `string` — the card's HTML.
- **Internal logic:**
  - Computes `gc` (grade class) via `deriveDisplayGradeClass(t)` (rendered as part of the card's header styling context, though not directly used as a visible pill in this specific card layout — used implicitly via other styling paths).
  - Builds `tagHtml` from `t.tags` (weekly/intraday/custom tag pill classes).
  - Determines `isWeekly` and picks border/header colors accordingly (indigo tones for weekly, gold tones otherwise).
  - Determines bias color/background/border from `t.biasSet` (BULLISH=bull colors, BEARISH=bear colors, else neutral/cream).
  - Runs the appropriate checklist engine based on `t.checklistModel` (`'omar'` default vs `'ttrades'`):
    - Omar: `runHTFEngine(_ans)` → extracts market-state label/colors, confidence (capitalized) with a color map (`high`/`medium`/`low`), and environment label/colors.
    - TTrades: `runTTEngine(_ans)` → extracts market-state label/colors, confidence (capitalized + "Confidence" suffix) with its own color map, and reuses market-state colors for the environment display (TTrades has no separate `envData`).
  - Finds `linkedIntra`: open intraday trades whose `weeklyLinkId` matches `t.id`.
  - Returns a large template literal `.otc` card containing:
    - Header: pair name with INTRA/SCALP/PAPER badges, date + formatted open time, tag pills, and the "intel" panel (model badge, Bias row, State row, Confidence row, Env row — each conditionally rendered).
    - Body: idea notes (rteDisplay), update notes, notes timeline (reversed, each with a lazy screenshot toggle via `toggleNoteScreenshots`), a 4-column price input grid (`patchOpen` wired via `onchange`), any linked intraday sub-cards (each with its own collapsible header via `toggleIntraSub`, notes, price fields, screenshot section via `ssLazySection`, and an action row with Close/±Note/Edit/Checklist/+Shot/Share/"↓ USE PRICES" (`pullPricesFromIntra`)/Delete buttons), the trade's own screenshot section, and the main action row (Close/Intraday-idea (only for non-intraday parents)/±Note/Edit/Checklist/+Shot/Share/Delete).
- **Calls:** deriveDisplayGradeClass, runHTFEngine, runTTEngine, filter, idEq, rteDisplay, formatTsWithNY, toggleNoteScreenshots, patchOpen, toggleIntraSub, ssLazySection, openCloseModal, openTradeNoteModal, openEditOpenModal, openChecklistEdit, addSsToOpenTrade, shareOpenTrade, pullPricesFromIntra, deleteOpenTrade, openIntraForTrade
- **Called by:** renderOpen
- **Side effects:** None directly (pure string builder); embeds many `onclick="..."` handlers that will later mutate state/DOM when clicked.
- **Notes:** Defined as a nested function inside `renderOpen`, so it is not globally callable — its only caller is the enclosing `renderOpen` (via `swingTrades.map(tradeCard)` / `standardTrades.map(tradeCard)`).

#### toggleIntraSub(id)

- **File:** Trade_Journal/index.html (lines 13190-13196)
- **Module:** Open Trades / UI Rendering
- **Purpose:** Expands/collapses a linked-intraday sub-card's body within an open trade card.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| id | string/number | Intraday trade id |

- **Returns:** void
- **Internal logic:**
  - Finds `#intra-body-{id}` and `#intra-tog-{id}` elements.
  - Returns if body missing.
  - Toggles the `open` CSS class on the body via `classList.toggle('open')`, capturing the resulting boolean state.
  - If the toggle-label element exists, updates its text to `'▲ COLLAPSE'` (if now open) or `'▼ EXPAND'` (if now closed).
- **Calls:** (none)
- **Called by:** renderOpen, tradeCard (inline `onclick="toggleIntraSub('...')"`)
- **Side effects:** DOM: toggles a class and updates label text.
- **Notes:** Pure UI toggle; no state persistence — expand/collapse resets on re-render.

### Module: Close Trade Modal (cm*) / EBP Integration

#### openCloseModal(id)

- **File:** Trade_Journal/index.html (lines 13202-13237)
- **Module:** Close Trade Modal
- **Purpose:** Opens and pre-populates the "Close Trade" modal for a given trade, preferring a linked intraday execution's actual entry/SL/close prices and direction over the parent idea's placeholder values.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| id | string/number | Trade id being closed |

- **Returns:** void
- **Internal logic:**
  - Finds trade `t` via `idEq`; returns if not found.
  - Sets `S.cmEditId = id` and `_pendingUploadTradeId = id` (module-level var used elsewhere for screenshot upload targeting).
  - Resets `S.cmData = {result:'', biasPlayed:'', tp1r:'N/A', tp15r:'N/A'}` and `S.cmSS = []`.
  - Sets the modal title to `'CLOSE TRADE — ' + t.pair`.
  - If `t` is not itself intraday, looks up an open linked intraday trade (`linkedIntra`) via `idEq(it.weeklyLinkId, t.id)`.
  - Chooses `srcTrade = linkedIntra || t` — prefers the actual intraday execution prices/direction when available.
  - Populates `#cmEntry`, `#cmClose`, `#cmSL` inputs from `srcTrade` (falling back to `t`'s own values, then empty string).
  - Sets `S.cmTradeType = srcTrade.tradeType || t.tradeType || 'BUY'` — the effective direction used later by `saveClosure`/`updateCmAutoResult`.
  - Clears the rich-text notes field via `rteSet('cmNotes','')`.
  - Clears the screenshot preview grid.
  - Clears any previously-selected result segment button styling (`sel-*` class removal) on `#cmResultBtns`.
  - Auto-computes `autoPlayed` = `'BEARISH'` if `SELL` else `'BULLISH'`, and displays it (with arrow + color) in `#cmBiasPlayedAuto`; stores it into `S.cmData.biasPlayed`.
  - Calls `populateCmAccountSelect(t)` to fill the account dropdown (only shown for intraday trades).
  - Opens the modal (`classList.add('open')`).
  - Schedules `updateCmAutoResult()` after a 50ms `setTimeout` (to let the DOM settle before computing the auto-result display).
- **Calls:** idEq, rteSet, populateCmAccountSelect, updateCmAutoResult
- **Called by:** renderOpen, tradeCard
- **Side effects:** Global state: `S.cmEditId`, `_pendingUploadTradeId`, `S.cmData`, `S.cmSS`, `S.cmTradeType`. DOM: multiple modal field values, modal `open` class.
- **Notes:** The "prefer linked intraday's prices" logic means the parent (daily/weekly) trade's close modal will reflect the actual execution, which is important because `saveClosure` later propagates the result/direction back to both.

#### populateCmAccountSelect(t)

- **File:** Trade_Journal/index.html (lines 13240-13254)
- **Module:** Close Trade Modal
- **Purpose:** Populates (or hides) the account-assignment dropdown in the close-trade modal — only intraday trades affect the P&L account tracker, so the field is hidden for daily/weekly ideas.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| t | Object | The trade being closed |

- **Returns:** void
- **Internal logic:**
  - Finds `#cmAccountSelect` and its closest `.field` wrapper (`container`); returns if either missing.
  - If `t.isIntraday` is falsy, hides the wrapper (`container.style.display='none'`) and returns.
  - Otherwise shows the wrapper.
  - Determines `isPaper = !!t.isPaper` and filters `S.pnlAccounts` to accounts whose `is_paper` matches.
  - Reads the trade's current account assignment from `S.tradeAccountMap[t.id]`.
  - Builds `<option>` list: a "— None —" default plus one option per matching account (labelled with name, Paper/live, and Prop/Personal kind), marking the currently-assigned one `selected`.
  - If no matching accounts exist, appends a disabled placeholder option noting none are set up.
- **Calls:** filter
- **Called by:** openCloseModal
- **Side effects:** DOM: `#cmAccountSelect` innerHTML and its wrapper's visibility; reads `S.pnlAccounts`, `S.tradeAccountMap`.
- **Notes:** Mirrors the equivalent logic later duplicated (with different element ids) in `openEditClosedModal` for the edit-closed-trade flow.

#### closeModalHide()

- **File:** Trade_Journal/index.html (lines 13256-13265)
- **Module:** Close Trade Modal
- **Purpose:** Closes the close-trade modal and resets the EBP "linked signal" UI section back to its default (No) state.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Removes the `open` class from `#closeModal`.
  - Resets all `input[name="cmSignalRadio"]` radios so only the `'no'` option is checked.
  - Hides `#cmSignalSection` (the EBP signal-lookup panel).
  - Clears `#cmSignalId` input value.
  - Hides and clears `#cmSignalResult`.
  - Clears `S._cmSignalData` (the fetched EBP signal payload, if any).
- **Calls:** remove (`classList.remove`)
- **Called by:** saveClosure
- **Side effects:** DOM: modal visibility class, radio states, EBP section visibility/content. Global state: clears `S._cmSignalData`.
- **Notes:** Also directly wired as the Cancel/close button's `onclick` in the modal HTML (not detected by static caller analysis since it's an inline attribute) — the only detected in-script caller is `saveClosure` after a successful save.

#### cmSignalToggle(val)

- **File:** Trade_Journal/index.html (lines 13267-13275)
- **Module:** Close Trade Modal / EBP Integration
- **Purpose:** Radio-button change handler for "Was this trade taken from an EBP signal?" — shows/hides the signal-ID lookup section.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| val | string | The selected radio value, `'yes'` or `'no'` |

- **Returns:** void
- **Internal logic:**
  - Sets `#cmSignalSection` display to `'block'` if `val==='yes'`, else `'none'`.
  - If `val==='no'`, also clears `#cmSignalId` value, hides and clears `#cmSignalResult`, and clears `S._cmSignalData`.
- **Calls:** (none)
- **Called by:** (none detected — verify: wired via inline `onchange="cmSignalToggle(this.value)"` on the `cmSignalRadio` radio inputs in the close-modal HTML)
- **Side effects:** DOM: `#cmSignalSection`, `#cmSignalId`, `#cmSignalResult`. Global state: `S._cmSignalData`.
- **Notes:** Entry point only reachable via inline radio `onchange`.

#### cmFetchSignal()

- **File:** Trade_Journal/index.html (lines 13277-13314)
- **Module:** Close Trade Modal / EBP Integration
- **Purpose:** Fetches an EBP (external signals) record by Signal ID from the user's configured EBP Cloudflare Worker, displaying its details in the close modal so the user can confirm the trade against a fired signal.
- **Parameters:** None
- **Returns:** `Promise<void>`
- **Internal logic:**
  - Reads `workerUrl`/`secret` from `localStorage` keys `ict_ebp_worker_url` / `ict_ebp_secret`.
  - Reads and normalizes (trim + uppercase) the Signal ID from `#cmSignalId`.
  - Grabs `#cmSignalResult` display element.
  - If worker URL or secret missing, shows a warning to configure EBP integration in Settings and returns.
  - If Signal ID is empty, shows a warning to enter one and returns.
  - Shows "Fetching…" while the request is in flight.
  - Sends `GET {workerUrl}/signals/{signalId}` with header `X-Journal-Secret: {secret}`.
  - Handles specific status codes: `401` → "Unauthorised" message, clears `S._cmSignalData`; `404` → "Signal not found"; any other non-OK → generic worker-error message with status code — all three early-return paths also clear/leave `S._cmSignalData` as null/unset.
  - On success, parses JSON into `sig`, stores it as `S._cmSignalData`.
  - Formats `sig.fired_at` into a UTC display string (`en-GB` locale, day/month/year/hour/minute) or `'—'` if absent.
  - Renders a rich result block: template-type pill, symbol + direction, HTF/LTF timeframes and HTF bias, session + price-at-signal, and fired timestamp.
  - Catches network errors, showing "Cannot reach EBP Worker" and nulling `S._cmSignalData`.
- **Calls:** fetch
- **Called by:** (none detected — verify: wired via inline `onclick="cmFetchSignal()"` on a "Fetch" button next to the Signal ID input in the close modal)
- **Side effects:** Network: GET request to the user's EBP Worker URL (`{CF-adjacent custom worker}/signals/{id}`). localStorage: reads `ict_ebp_worker_url`, `ict_ebp_secret`. DOM: `#cmSignalResult` innerHTML/display. Global state: `S._cmSignalData`.
- **Notes:** The EBP worker is a *different* endpoint from `CONFIG.CF_WORKER` (the P&L worker) — it's a user-configured URL stored in localStorage, meaning each user/device points at their own EBP worker instance. Secret is sent as a custom header, not a bearer token.

#### ebpToggleSecret(btn)

- **File:** Trade_Journal/index.html (lines 13316-13321)
- **Module:** EBP Integration / Settings
- **Purpose:** Toggles the visibility (show/hide) of the EBP secret input field between `password` and `text` types, updating the eye-icon button accordingly.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| btn | HTMLElement | The toggle button clicked (its text is updated to reflect state) |

- **Returns:** void
- **Internal logic:**
  - Finds `#ebpSecret` input.
  - Determines `show = inp.type === 'password'` (i.e., currently hidden, about to reveal).
  - Sets `inp.type` to `'text'` if revealing, else `'password'`.
  - Sets `btn.textContent` to `'🙈'` (hide icon) if revealing, else `'👁'` (show icon).
- **Calls:** (none)
- **Called by:** (none detected — verify: wired via inline `onclick="ebpToggleSecret(this)"` on the eye-icon button in Settings)
- **Side effects:** DOM: `#ebpSecret` input type, button text.
- **Notes:** Standard password-visibility toggle pattern.

#### ebpSaveSettings()

- **File:** Trade_Journal/index.html (lines 13323-13329)
- **Module:** EBP Integration / Settings
- **Purpose:** Saves the user-entered EBP Worker URL and secret from the Settings form into localStorage.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Reads and trims `#ebpWorkerUrl` and `#ebpSecret` values.
  - If `url` is non-empty, writes it to `localStorage['ict_ebp_worker_url']`.
  - If `sec` is non-empty, writes it to `localStorage['ict_ebp_secret']`.
  - Shows a success toast `'EBP settings saved ✓'`.
- **Calls:** showToast
- **Called by:** (none detected — verify: wired via inline `onclick="ebpSaveSettings()"` on a Save button in Settings)
- **Side effects:** localStorage: writes `ict_ebp_worker_url`, `ict_ebp_secret` (only if non-empty — existing stored values are preserved if fields are left blank).
- **Notes:** Does not clear existing values if the fields are empty — so a user can't blank out a previously-saved URL/secret via this function; they'd need to overwrite with new non-empty text.

#### ebpTestConnection(btn)

- **File:** Trade_Journal/index.html (lines 13331-13349)
- **Module:** EBP Integration / Settings
- **Purpose:** Tests connectivity/auth to the configured EBP Worker by requesting a known-nonexistent signal ID (`TEST`) and interpreting the response status.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| btn | HTMLElement | The "TEST CONNECTION" button (disabled/relabeled during the test) |

- **Returns:** `Promise<void>`
- **Internal logic:**
  - Reads `workerUrl`/`secret`, preferring localStorage values, falling back to the current (unsaved) form field values.
  - If either missing, shows a gold warning "Enter URL and secret first" and returns.
  - Sets button text to "Testing…" and disables it.
  - Sends `GET {workerUrl}/signals/TEST` with the `X-Journal-Secret` header.
  - Interprets result: `404` → "✓ Connected" (bull color) — a 404 for a nonexistent signal ID actually indicates the worker is reachable and auth succeeded; `401` → "✕ Wrong secret" (bear color); anything else → "✕ Unexpected response (status)" (bear color).
  - Catches network errors → "✕ Cannot reach Worker" (bear color).
  - Restores button text to "TEST CONNECTION" and re-enables it (in all cases, via code after the try/catch — not in a `finally`, but placed sequentially after, meaning it always runs since no path returns early after the try block).
- **Calls:** fetch
- **Called by:** (none detected — verify: wired via inline `onclick="ebpTestConnection(this)"` on the Test button in Settings)
- **Side effects:** Network: GET request to EBP worker's `/signals/TEST`. DOM: `#ebpTestResult` text/color, button state.
- **Notes:** Clever use of expected-404 as the "success" signal, since a real signal named "TEST" is not expected to exist; distinguishes "reachable but wrong secret" (401) from "reachable and authenticated" (404) from "unreachable" (network exception).

#### cmSeg(el, field, val, cls)

- **File:** Trade_Journal/index.html (lines 13351-13356)
- **Module:** Close Trade Modal
- **Purpose:** Generic segmented-button-group handler for the close modal — records a field's value into `S.cmData` and visually marks the clicked button as selected (removing selection styling from its siblings).
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| el | HTMLElement | The clicked segment button |
| field | string | Key in `S.cmData` to set |
| val | any | Value to assign |
| cls | string | CSS class to add to mark the button selected (e.g. `sel-win`) |

- **Returns:** void
- **Internal logic:**
  - Sets `S.cmData[field] = val`.
  - Within the closest `.seg-btns` container, strips any existing `sel-\w+` class from all sibling buttons via regex replace.
  - Adds `cls` to the clicked `el`.
- **Calls:** (none)
- **Called by:** (none detected — verify: wired via inline `onclick="cmSeg(this,'result','WIN','sel-win')"`-style attributes on each segmented button in the close modal, e.g. for Result [WIN/LOSS/BE/SKIP] and other segmented fields)
- **Side effects:** Global state: `S.cmData[field]`. DOM: class list changes on sibling buttons.
- **Notes:** Generic reusable pattern also mirrored by `ecSeg` for the edit-closed-trade modal.

#### cmClearSkip(el)

- **File:** Trade_Journal/index.html (lines 13358-13363)
- **Module:** Close Trade Modal
- **Purpose:** Clears the manually-selected "result" segment (e.g. undoes a SKIP selection) and re-triggers auto-result computation from prices.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| el | HTMLElement | The clicked "clear" control |

- **Returns:** void
- **Internal logic:**
  - Sets `S.cmData.result = ''`.
  - Strips `sel-\w+` classes from all buttons in the closest `.seg-btns` group.
  - Calls `updateCmAutoResult()` to recompute and display the auto-derived WIN/LOSS/BE result from entry/close/SL prices.
- **Calls:** updateCmAutoResult
- **Called by:** (none detected — verify: likely wired via inline `onclick="cmClearSkip(this)"` next to the SKIP button in the close modal)
- **Side effects:** Global state: `S.cmData.result`. DOM: button class states; triggers `#cmAutoResult` etc. update.
- **Notes:** Used to revert an explicit SKIP override back to price-derived auto-calculation.

#### updateCmAutoResult()

- **File:** Trade_Journal/index.html (lines 13365-13400)
- **Module:** Close Trade Modal
- **Purpose:** Live-updates the close modal's auto-computed result (WIN/LOSS/BREAK EVEN + R-multiple) and TP1R/TP1.5R hit indicators as the user types entry/close/SL prices.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Looks up the trade being closed (`S.cmEditId`) via `idEq`, if set.
  - Parses `#cmEntry`, `#cmClose`, `#cmSL` values as floats.
  - Grabs `#cmAutoResult`, `#cmTp1rAuto`, `#cmTp15rAuto` elements; returns if the main result element is missing.
  - If any of entry/close/SL is `NaN`, shows `'— Enter prices below'` (muted color) and resets the TP indicators to `'—'` (muted), then returns.
  - Determines direction via `S.cmTradeType` (or the found trade's `tradeType`, defaulting `'BUY'`) — `isSell` boolean.
  - Computes `profit` (sell: entry-close; buy: close-entry), `risk = |entry-sl|`, and `rVal = risk>0 ? profit/risk : null`.
  - Builds an R-string display (`+X.XXR` / `-X.XXR`) if `rVal` is not null.
  - Sets `#cmAutoResult` text/color: `'WIN · +X.XXR'` (bull) if profit>0; `'LOSS · X.XXR'` (bear) if profit<0; `'BREAK EVEN · 0R'` (gold) if exactly 0.
  - If `rVal` available, sets `#cmTp1rAuto` to `'YES ✓'`/`'NO'` (bull/bear) based on `rVal>=1.0`, and `#cmTp15rAuto` similarly for `rVal>=1.5`; if `rVal` is null, both show `'—'` (muted).
- **Calls:** idEq
- **Called by:** openCloseModal, cmClearSkip
- **Side effects:** DOM: `#cmAutoResult`, `#cmTp1rAuto`, `#cmTp15rAuto` text/color.
- **Notes:** Also wired as an inline `oninput`/`onchange` handler on the price fields in the close modal (not detected by static analysis) — this is why it needs to be called repeatedly as the user types, in addition to being called once on modal open (via a 50ms `setTimeout` in `openCloseModal`).

#### saveClosure()

- **File:** Trade_Journal/index.html (lines 13402-13540)
- **Module:** Close Trade Modal / Trade CRUD
- **Purpose:** The main "commit close" handler — finalizes a trade's close (result, prices, notes, screenshots, signal linkage, account assignment, hidden scores), propagates the close to any linked parent/child trades, optionally triggers an AI review, and navigates to the Closed Trades view.
- **Parameters:** None
- **Returns:** `Promise<void>`
- **Internal logic:**
  - Guard: if any screenshot in `S.cmSS` is still `_uploading`, shows a warning toast and aborts.
  - Finds the trade `t` via `S.cmEditId`/`idEq`; returns if not found.
  - Reads `entryVal`/`closeVal`/`slVal` from the modal inputs, falling back to the trade's existing values if parse fails/empty.
  - Uses `S.cmTradeType` (set in `openCloseModal`, accounting for a linked intraday's actual direction) as `effectiveTradeType`.
  - Auto-derives `S.cmData.biasPlayed` from `effectiveTradeType` (SELL→BEARISH, else BULLISH) — the executed direction is treated as the "bias played."
  - Determines `result`: if not manually set to `'SKIP'` and all three prices are present, computes WIN/LOSS/BE from profit sign; otherwise if no `result` was set at all, alerts the user to enter prices or mark SKIP, and aborts.
  - Defines local `_calcTpR(entry, close, sl, type)` helper (documented separately below) and uses it to compute `_rVal`, then derives `_tp1r`/`_tp15r` as `'YES'/'NO'/'N/A'` strings.
  - Mutates `t`: sets `status='closed'`, `result`, `tradeType`, `biasPlayed`, `biasMatch` (YES if `biasSet===biasPlayed`), `tp1r`, `tp15r`, `entryPrice`, `closePrice`, `slPrice`, `closeNotes` (from `rteGet('cmNotes')`, trimmed).
  - If the "linked to EBP signal" radio is `'yes'` and `S._cmSignalData` exists, copies signal fields (`signalId`, `signalTemplate`, `signalHtf`, `signalLtf`, `signalDirection`, `signalFiredAt`, `signalPrice`, `signalHtfBias`, `signalSession`) onto `t`, then fires a non-blocking async IIFE that PATCHes `{workerUrl}/signals/{signalId}/traded` on the EBP worker (using localStorage creds) to mark the signal as traded — errors here are silently swallowed (`/* non-blocking */`).
  - Sets `t.closeTime = new Date().toISOString()`.
  - Awaits `loadTradeScreenshots(t.id)` then appends `S.cmSS` (the newly captured close screenshots) onto `t.eodScreenshots`; sets `t._ssLoaded = true`.
  - Reads the selected account from `#cmAccountSelect` and fires `assignTradeAccount(t.id, accountId || null)` — explicitly non-blocking ("fire-and-forget").
  - If `t.isIntraday`, computes `t.intraScores = computeHiddenScores(t)`.
  - Calls `saveTrade(t)` to persist.
  - **Propagation logic** (mutually exclusive branches):
    - If `t.isIntraday && t.weeklyLinkId`: finds the still-open parent daily/weekly trade and, if found, closes it too — copying over result/type/bias/tp hits/prices (only overwriting price fields if a new value was actually entered)/close notes (only if parent doesn't already have some)/close time; saves the parent; shows a toast noting the parent was also closed.
    - Else if `!t.isIntraday`: finds any still-open linked intraday children and closes each of them (result, biasPlayed/Match, tp hits, closePrice if provided, closeTime, and recomputed `intraScores` for each since they are intraday), saving each; shows a toast noting how many were closed.
  - If the trade is a daily/weekly (`!t.isIntraday`) and a Gemini API key exists (`_geminiKey()`), schedules `triggerDailyAiReview(t.id)` after a 500ms delay (fire-and-forget AI review).
  - Calls `closeModalHide()`, resets `S.cmEditId = null` and `S.cmSS = []`.
  - Calls `updateOpenBadge()`, `updateIntradayBadge()`, `renderOpen()`, `renderDashboard()`, and finally `navTo('closed')` to switch views.
- **Calls:** showToast, idEq, _calcTpR, rteGet, fetch, loadTradeScreenshots, assignTradeAccount, computeHiddenScores, saveTrade, filter, _geminiKey, triggerDailyAiReview, closeModalHide, updateOpenBadge, updateIntradayBadge, renderOpen, renderDashboard, navTo
- **Called by:** (none detected — verify: wired via inline `onclick="saveClosure()"` on the "Save"/"Close Trade" confirm button inside the close-trade modal HTML)
- **Side effects:** Global state: mutates the closed trade and (conditionally) its parent/children in `S.trades`; clears `S.cmEditId`/`S.cmSS`. Supabase: persists via `saveTrade` for each modified trade (trade upserts). Network: fire-and-forget PATCH to EBP worker for signal-traded marking. localStorage: reads EBP creds. DOM: closes the modal, refreshes Open/Closed/Dashboard views, navigates to Closed tab.
- **Notes:** This is the central "close trade" transaction and one of the most complex functions in the chunk — it must keep parent daily/weekly trades and child intraday executions consistent (a 1:1 or 1:many relationship depending on direction of linkage). The EBP "mark as traded" PATCH and the AI review trigger are both explicitly non-blocking, so `saveClosure` itself doesn't wait on either external call to finish before proceeding to close the modal and navigate away.

#### _calcTpR(entry, close, sl, type)

- **File:** Trade_Journal/index.html (lines 13424-13430)
- **Module:** Close Trade Modal / Utilities
- **Purpose:** Local helper inside `saveClosure` that computes the R-multiple (profit ÷ risk) for a trade given final entry/close/SL prices and direction, used to auto-derive TP1R/TP1.5R hit flags at close time.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| entry | number | Entry price |
| close | number | Close price |
| sl | number | Stop-loss price |
| type | string | `'BUY'` or `'SELL'` |

- **Returns:** `number|null` — the R multiple, or `null` if any price is falsy or risk is zero.
- **Internal logic:**
  - Returns `null` if `entry`, `close`, or `sl` is falsy (0/undefined/null).
  - Computes `risk = |entry - sl|`; returns `null` if `risk === 0` (avoids division by zero).
  - Computes `profit` = `(entry - close)` if `type==='SELL'`, else `(close - entry)`.
  - Returns `profit / risk`.
- **Calls:** (none)
- **Called by:** saveClosure (as a local const arrow function, only within its own scope)
- **Side effects:** None — pure function.
- **Notes:** Functionally identical to the top-level `calcR(trade)` function documented below, except it takes raw scalar arguments rather than a trade object — this duplication exists because at the moment `saveClosure` computes this, the trade object's `entryPrice`/`closePrice`/`slPrice` fields haven't been assigned their final values yet (they're still local variables `entryVal`/`closeVal`/`slVal`).

### Module: Edit Open / Edit Closed Trade Modals

#### openEditOpenModal(id)

- **File:** Trade_Journal/index.html (lines 13544-13559)
- **Module:** Trade CRUD
- **Purpose:** Opens and pre-populates the "Edit Open Trade" modal with a trade's current pair, date, prices, and update notes.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| id | string/number | Trade id to edit |

- **Returns:** void
- **Internal logic:**
  - Finds trade `t` via `idEq`; returns if not found.
  - Sets `S.eoiEditId = id`, `_pendingUploadTradeId = id`, `S.eoiSS = []`.
  - Sets modal title to `'EDIT — ' + t.pair`.
  - Populates `#eoiPair`, `#eoiDate`, `#eoiEntry`, `#eoiSL`, `#eoiCurrent` inputs from the trade (defaulting empty for missing prices).
  - Sets the rich text field `#eoiNotes` via `rteSet` to `t.updateNotes || ''`.
  - Clears the screenshot preview grid.
  - Opens the modal.
- **Calls:** idEq, rteSet
- **Called by:** renderOpen, tradeCard
- **Side effects:** Global state: `S.eoiEditId`, `_pendingUploadTradeId`, `S.eoiSS`. DOM: modal field values, `open` class.
- **Notes:** Symmetric counterpart to `saveEditOpen`.

#### saveEditOpen()

- **File:** Trade_Journal/index.html (lines 13561-13582)
- **Module:** Trade CRUD
- **Purpose:** Persists edits made in the "Edit Open Trade" modal back onto the trade record, including any newly attached screenshots.
- **Parameters:** None
- **Returns:** `Promise<void>`
- **Internal logic:**
  - Finds trade `t` via `S.eoiEditId`/`idEq`; returns if not found.
  - Guard: if any `S.eoiSS` screenshot is still `_uploading`, warns and aborts.
  - Updates `t.pair` (trimmed, falls back to existing if empty), `t.date` (falls back to existing if empty).
  - Reads entry/SL/close values; sets each to `null` if the field was cleared, else parses as float (falling back to the existing value if parse fails).
  - Sets `t.updateNotes = rteGet('eoiNotes').trim()`.
  - If `S.eoiSS` has new screenshots, awaits `loadTradeScreenshots(t.id)` first (to avoid clobbering), appends them to `t.screenshots`, and marks `_ssLoaded = true`.
  - Calls `saveTrade(t)`.
  - Closes the modal, resets `S.eoiEditId`/`S.eoiSS`.
  - Calls `renderOpen()` to refresh the list.
- **Calls:** idEq, showToast, rteGet, loadTradeScreenshots, saveTrade, remove (`classList.remove`), renderOpen
- **Called by:** (none detected — verify: wired via inline `onclick="saveEditOpen()"` on the modal's Save button)
- **Side effects:** Global state: mutates the trade in `S.trades`; resets `S.eoiEditId`/`S.eoiSS`. Supabase: persists via `saveTrade`. DOM: closes modal, refreshes `#openContainer`.
- **Notes:** Uses `=== ''` checks (not falsy checks) to distinguish "explicitly cleared" from "invalid number" — an empty string clears the field to `null`, while a non-empty but unparsable string falls back to the previous value rather than becoming `NaN`.

#### openEditClosedModal(id)

- **File:** Trade_Journal/index.html (lines 13584-13615)
- **Module:** Trade CRUD
- **Purpose:** Opens and pre-populates the "Edit Closed Trade" modal (entry/close/SL prices, follow-up notes, and — for intraday trades — the account assignment dropdown).
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| id | string/number | Trade id to edit |

- **Returns:** void
- **Internal logic:**
  - Finds trade `t` via `idEq`; returns if not found.
  - Sets `S.ecEditId = id`, `_pendingUploadTradeId = id`.
  - Sets `S.ecData = {result: t.result, tp1r: t.tp1r || 'N/A', tp15r: t.tp15r || 'N/A'}` and `S.ecSS = []`.
  - Sets modal title, populates `#ecEntry`/`#ecClose`/`#ecSL` inputs, sets `#ecFollowup` rich text to `t.followupNotes || ''`, clears screenshot grid.
  - If `t.isIntraday` and the account field/select elements exist: shows the account field, filters `S.pnlAccounts` by paper/live matching `t.isPaper`, builds options (same pattern as `populateCmAccountSelect`) marking the current assignment (`S.tradeAccountMap[t.id]`) as selected, with a disabled placeholder if none exist.
  - Else (not intraday), hides the account field if present.
  - Opens the modal.
  - Schedules `updateEcAutoResult()` via a 50ms `setTimeout`.
- **Calls:** idEq, rteSet, filter, updateEcAutoResult
- **Called by:** renderClosed
- **Side effects:** Global state: `S.ecEditId`, `_pendingUploadTradeId`, `S.ecData`, `S.ecSS`. DOM: modal fields, account dropdown, `open` class.
- **Notes:** Duplicates the account-select-population logic seen in `populateCmAccountSelect` rather than reusing it (inline instead of calling that function) — a minor code-duplication note for future refactor.

#### ecSeg(el, field, val, cls)

- **File:** Trade_Journal/index.html (lines 13617-13622)
- **Module:** Trade CRUD
- **Purpose:** Segmented-button handler for the Edit Closed modal — same pattern as `cmSeg` but writes into `S.ecData` instead of `S.cmData`.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| el | HTMLElement | Clicked segment button |
| field | string | Key in `S.ecData` |
| val | any | Value to assign |
| cls | string | Selected-state CSS class |

- **Returns:** void
- **Internal logic:** Identical structure to `cmSeg`: sets `S.ecData[field]=val`, strips `sel-\w+` classes from sibling buttons in the closest `.seg-btns`, adds `cls` to `el`.
- **Calls:** (none)
- **Called by:** (none detected — verify: wired via inline `onclick="ecSeg(this,...)"` attributes in the Edit Closed modal)
- **Side effects:** Global state: `S.ecData[field]`. DOM: class list changes.
- **Notes:** Near-duplicate of `cmSeg`.

#### ecClearSkip(el)

- **File:** Trade_Journal/index.html (lines 13624-13628)
- **Module:** Trade CRUD
- **Purpose:** Clears the manually-set result segment in the Edit Closed modal (undo a SKIP-style override).
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| el | HTMLElement | The clicked clear control |

- **Returns:** void
- **Internal logic:** Sets `S.ecData.result = ''`; strips `sel-\w+` classes from sibling buttons in the closest `.seg-btns`. Unlike `cmClearSkip`, does **not** call `updateEcAutoResult()` afterward.
- **Calls:** (none)
- **Called by:** (none detected — verify: wired via inline `onclick="ecClearSkip(this)"`)
- **Side effects:** Global state: `S.ecData.result`. DOM: class list changes.
- **Notes:** Asymmetric vs. `cmClearSkip`, which does re-trigger the auto-result display — here the auto-result element's text is not refreshed by this action alone (it would only update on next price input or modal reopen), which may be a minor inconsistency/omission.

#### updateEcAutoResult()

- **File:** Trade_Journal/index.html (lines 13630-13648)
- **Module:** Trade CRUD
- **Purpose:** Live-updates the auto-computed WIN/LOSS/BREAK EVEN result display in the Edit Closed modal as entry/close/SL prices are edited.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Looks up the trade via `S.ecEditId`/`idEq`.
  - Parses `#ecEntry`, `#ecClose`, `#ecSL` as floats.
  - Grabs `#ecAutoResult`; returns if missing.
  - If entry or close is `NaN`, shows the trade's existing stored `result` (or `'—'`) in ink color and returns (note: SL being NaN doesn't block this branch the way it does in `updateCmAutoResult` — only entry/close matter for the initial guard).
  - Determines `isSell` from the trade's `tradeType`.
  - Computes `profit` and, if `sl` is a valid number, `risk = |entry-sl|`; computes an R-string (`toFixed(2)+'R'`) if risk>0, else empty string.
  - Sets `#ecAutoResult` text/color: WIN (bull) if profit>0 with optional `+R` suffix; LOSS (bear) if profit<0 with `R` suffix; BREAK EVEN (gold) with `0R` if exactly equal.
- **Calls:** idEq
- **Called by:** openEditClosedModal
- **Side effects:** DOM: `#ecAutoResult` text/color.
- **Notes:** Unlike `updateCmAutoResult`, this function does not compute/display separate TP1R/TP1.5R indicator elements — the Edit Closed modal apparently doesn't have those live-preview elements (TP hits are instead recalculated directly in `saveEditClosed` on save).

#### saveEditClosed()

- **File:** Trade_Journal/index.html (lines 13650-13692)
- **Module:** Trade CRUD
- **Purpose:** Persists edits made in the Edit Closed Trade modal — updated prices, recalculated result/TP-hits, follow-up notes/screenshots, bias-match flag, recomputed hidden scores (for intraday trades), and account reassignment.
- **Parameters:** None
- **Returns:** `Promise<void>`
- **Internal logic:**
  - Finds trade `t` via `S.ecEditId`/`idEq`; returns if not found.
  - Guard: aborts with a warning toast if any `S.ecSS` screenshot is still uploading.
  - If `S.ecData.result === 'SKIP'`, forces `t.result = 'SKIP'`.
  - Reads `entryVal`/`closeVal`/`slVal` from inputs, falling back to existing trade values on parse failure.
  - Assigns them onto `t.entryPrice`/`closePrice`/`slPrice`.
  - If `t.result !== 'SKIP'` and both entry/close are present, recomputes `t.result` from profit sign (WIN/LOSS/BE) — this recalculation happens regardless of whether prices actually changed, effectively re-deriving the result every save unless SKIP is explicitly set.
  - If entry/close/SL all present, recomputes `risk` and, if `>0`, recomputes `t.tp1r`/`t.tp15r` as YES/NO based on the R value vs 1.0/1.5 thresholds.
  - Sets `t.followupNotes = rteGet('ecFollowup').trim()`.
  - If `S.ecSS` has new screenshots, awaits `loadTradeScreenshots(t.id)`, appends to `t.followupScreenshots`, sets `_ssLoaded=true`.
  - Recomputes `t.biasMatch` as `'YES'`/`'NO'` based on whether `t.biasSet` and `t.biasPlayed` are both set and equal.
  - If `t.isIntraday`: recomputes `t.intraScores = computeHiddenScores(t)`, and if `#ecAccountSelect` exists, calls `assignTradeAccount(t.id, value || null)`.
  - Calls `saveTrade(t)`.
  - Closes the modal, resets `S.ecEditId`/`S.ecSS`.
  - Calls `renderClosed()` and `renderDashboard()`.
- **Calls:** idEq, showToast, rteGet, loadTradeScreenshots, computeHiddenScores, assignTradeAccount, saveTrade, remove (`classList.remove`), renderClosed, renderDashboard
- **Called by:** (none detected — verify: wired via inline `onclick="saveEditClosed()"` on the modal's Save button)
- **Side effects:** Global state: mutates the trade; resets `S.ecEditId`/`S.ecSS`. Supabase: persists via `saveTrade`; assigns account via `assignTradeAccount`. DOM: closes modal, refreshes Closed and Dashboard views.
- **Notes:** Because the modal has no `wasResultManuallySet` distinct flag separate from the `'SKIP'` sentinel, any edit to entry/close prices (even for an already-correct WIN/LOSS) causes the result to be silently recomputed from scratch — generally harmless since it should match, but means a manually-corrected result (other than SKIP) that contradicts the raw price math would be overwritten on next save.

### Module: Closed Trades / Trade History

#### toggleClosedChip(key, el)

- **File:** Trade_Journal/index.html (lines 13695-13738)
- **Module:** Closed Trades / UI Rendering
- **Purpose:** Manages the multi-select filter "chips" (All/Live/Paper/Daily/Intraday/Weekly) above the Closed Trades table, enforcing mutual-exclusion rules between them, then re-renders the table.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| key | string | The chip key clicked: `'all'`, `'weekly'`, `'live'`, `'paper'`, `'daily'`, or `'intraday'` |
| el | HTMLElement | The clicked chip element (unused directly in the logic — active-state sync is done by re-scanning all chips) |

- **Returns:** void
- **Internal logic:**
  - Copies `S.closedActiveChips` into `chips`.
  - If `key === 'all'`: resets `chips = ['all']` (clears everything else).
  - Else if `key === 'weekly'`: toggles weekly mode — if already active, switches to `['live']`; otherwise sets `chips = ['weekly']` exclusively (weekly is mutually exclusive with all other chips).
  - Else (a trade-type or paper chip): removes `'all'` and `'weekly'` from `chips`; if `key` is already present, removes it (and if that empties the array, falls back to `['live']` so at least one filter is always active); otherwise adds `key`.
  - Saves the result to `S.closedActiveChips`.
  - Re-syncs visual active state for every `.ct-type-chip` button by parsing its own `onclick` attribute string with a regex (`/toggleClosedChip\('(\w+)'/`) to recover its key, then toggling the `.active` class based on membership in `chips`.
  - Shows/hides the trade-filter vs weekly-filter panels and the trade-table vs weekly-table based on whether `'weekly'` is in `chips`.
  - Calls `renderClosed()`.
- **Calls:** filter, renderClosed
- **Called by:** (none detected — verify: wired via inline `onclick="toggleClosedChip('...', this)"` on each filter chip button)
- **Side effects:** Global state: `S.closedActiveChips`. DOM: chip active classes, panel/table visibility.
- **Notes:** The regex-based self-inspection of `onclick` attributes to resync chip active states is an unusual but functional pattern — it avoids needing a separate lookup table by reading the key back out of the DOM attribute string itself.

#### renderClosed()

- **File:** Trade_Journal/index.html (lines 13740-13879)
- **Module:** Closed Trades / UI Rendering
- **Purpose:** Renders the Closed Trades table — either the "Weekly" mode (closed Weekly Bias entries with their review stats) or the standard "Trade" mode (closed individual trades filtered by chips/search/result/grade/close-tag).
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Reads `S.closedActiveChips` (default `['live']`).
  - **Weekly branch** (if `chips` includes `'weekly'`):
    - Reads `#closedWeeklySearch` text; filters `S.weeklies` to `status==='closed'` and (if search present) matching pair, notes, or weekly-review lessons (worked/failed) case-insensitively.
    - If no results, clears `#closedWeeklyBody`, shows the empty message, and returns.
    - Otherwise builds a table row per weekly: date, pair, bias pill, actual environment, bias-accuracy result (colored), process-adherence score, trade count, win rate, net R (colored), a notes preview, and action buttons (View → `openWeeklyReview`, Delete → `deleteWeeklyBias`).
    - Returns early (weekly branch is fully separate from the trade branch below).
  - **Trade branch** (default):
    - Reads search text and the Result/Grade/CloseTag filter dropdown values.
    - Derives boolean intents from chips: `wantAll`, `wantLive`, `wantPaper`, `wantDaily`, `wantIntraday`.
    - Filters `S.trades` to `status==='closed'`, applying paper/live logic (unless `wantAll`) and daily/intraday type logic (only restrictive if one of those chips is active) → `closedAll`.
    - Rebuilds the `#filterCloseTag` `<option>` list dynamically from the distinct `closeTags` present across `closedAll` (preserving the current selection if still valid, else resetting to "All categories").
    - Further filters `closedAll` by search text (pair/ideaNotes/closeNotes/followupNotes) and by result/grade/close-tag dropdown values → `closed`.
    - If empty, clears `#closedBody`, shows empty message ("No closed trades match filters."), returns.
    - Otherwise builds one table row per trade: date, pair (+ scalp/paper badges), grade pill (`deriveDisplayGrade`/`deriveDisplayGradeClass`), result pill, R value (`calcR`, colored), entry/SL prices, TP1R/TP1.5R pills, bias pill, a notes/tags cell (with a gold star `★` if follow-up content exists), and action buttons (Share → `shareClosedTrade`, Edit → `openEditClosedModal`, Delete → `deleteTrade`). Each row's `onclick` opens `openTradeHistory`.
- **Calls:** filter, openWeeklyReview, deleteWeeklyBias, deriveDisplayGrade, deriveDisplayGradeClass, calcR, openTradeHistory, shareClosedTrade, openEditClosedModal, deleteTrade
- **Called by:** navTo, saveEditClosed, toggleClosedChip, deleteTrade, triggerDailyAiReview
- **Side effects:** DOM: rewrites `#closedWeeklyBody` or `#closedBody` (and `#closedEmpty` visibility/text), rebuilds `#filterCloseTag` options. Reads several filter-control DOM values.
- **Notes:** The two branches (weekly vs trade) return independently and never both execute in a single call — the function effectively serves two different table views depending on chip state, which is a somewhat unusual design (one function, two largely unrelated render paths) but keeps the single-page "Closed" nav destination unified.

#### deleteTrade(id)

- **File:** Trade_Journal/index.html (lines 13881-13895)
- **Module:** Trade CRUD
- **Purpose:** Permanently deletes a closed trade (and any children linked via `weeklyLinkId`) after confirmation, mirroring `deleteOpenTrade` but for the Closed Trades view.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| id | string/number | Trade id to delete |

- **Returns:** void
- **Internal logic:**
  - Shows `confirm('Delete this trade permanently?')`; aborts if declined.
  - Calls `deleteTradeSupa(id)`; on success (`.then`), filters `S.trades` to remove the trade and any children whose `weeklyLinkId` matches, then calls `renderClosed()` and `renderDashboard()`.
  - On failure (`.catch`), logs a warning but performs the identical local cleanup and re-renders anyway (same optimistic-cleanup pattern as `deleteOpenTrade`).
- **Calls:** deleteTradeSupa, filter, idEq, renderClosed, renderDashboard
- **Called by:** renderClosed
- **Side effects:** Supabase: DELETE on `trades`. Global state: removes from `S.trades`. DOM: re-renders Closed and Dashboard views.
- **Notes:** Structurally identical to `deleteOpenTrade`, differing only in which render functions it calls afterward (Closed+Dashboard vs Open+Intraday+Dashboard).

#### calcR(trade)

- **File:** Trade_Journal/index.html (lines 13897-13904)
- **Module:** Utilities
- **Purpose:** Computes the R-multiple (profit relative to risk) for a closed trade — the single canonical R calculation reused across nearly the entire analytics/dashboard/export layer of the app.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| trade | Object | A trade with `entryPrice`, `closePrice`, `slPrice`, `tradeType` |

- **Returns:** `number|null` — R multiple, or `null` if any price is missing/falsy or risk is zero.
- **Internal logic:**
  - Destructures `entryPrice→e`, `closePrice→c`, `slPrice→sl`, `tradeType` from `trade`.
  - Returns `null` if `e`, `c`, or `sl` is falsy.
  - Computes `risk = |e - sl|`; returns `null` if `risk === 0`.
  - Computes `profit = (tradeType==='SELL') ? (e-c) : (c-e)`.
  - Returns `profit / risk`.
- **Calls:** (none)
- **Called by:** computeSnapshotAggregates, buildAggArray, saveCumulativeStats, getDashboardTotals, computePerformanceStats, renderClosed, openTradeHistory, computeGradePerformance, _canonicalModelStats, renderAdditionalInsights, exportExcel, shareClosedTrade, _buildDailyPrompt, triggerWeeklyAiReview, finaliseArchive, computeOpportunityQualityAnalysis, computeAlignmentAnalysis, computeContextAnalysis, computeSetupAnalysis, computeExecutionAnalysis, computeSetupComponentAnalysis, computeCaptureRateAnalysis, computeRuleViolationAnalysis, computeNoTradeAnalysis, computeMonthlyInsights, renderExtraInsights
- **Side effects:** None — pure function.
- **Notes:** With 79 total call sites across the file (per the static analysis `totalCallSitesInFile`) and dozens of distinct callers, this is one of the most heavily reused utility functions in the entire codebase — effectively the app's single source of truth for R-multiple math. Note it is functionally identical to the locally-scoped `_calcTpR` inside `saveClosure`, just operating on a trade object instead of raw scalars.

#### openTradeHistory(id)

- **File:** Trade_Journal/index.html (lines 13910-14061)
- **Module:** Trade History / UI Rendering
- **Purpose:** Opens the detailed "Trade History" modal for a closed (or any) trade, showing the full plan/execution/review timeline: pre-market idea, HTF/checklist info, notes timeline, screenshots, linked intraday executions (each with their own post-trade review), post-trade notes, opportunity score panel, review notes, and AI review block.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| id | string/number | Trade id to view |

- **Returns:** `Promise<void>`
- **Internal logic:**
  - Finds trade `t` via `idEq`; returns if not found.
  - Finds all linked intraday executions (`intras`) via `idEq(it.weeklyLinkId, t.id)`.
  - Awaits loading screenshots for the trade and all its linked intras in parallel (`Promise.all`).
  - Sets module-level `_thId = id`, resets `_thNewSS = []`.
  - Sets `S.closeTagsEditId = id` and `S.closeTags = [...(t.closeTags||[])]` (working copy for tag editing).
  - Clears the note-input and screenshot-preview elements; sets the modal title to `pair · date`.
  - Defines four local rendering helpers (documented separately below): `infoGrid(items)`, `noteBlock(label, html, color)`, `ssBlock(list)`, `timelineHtml(notes)`.
  - Computes `r = calcR(t)` and its display string/color; computes grade class, result class, bias color/arrow; combines all screenshot arrays (`screenshots` + `eodScreenshots` + `followupScreenshots`) into `allSS`.
  - **Score panel:** if the trade is a closed intraday trade with `intraScores`, builds a detailed "OPPORTUNITY ANALYSIS" panel (grade, final score, three metric bars with colors via a locally-redefined `barColor`), plus a bullet-point "commentary" list generated from threshold checks on context/setup/exec scores, `intraAlignment`, and `biasMatch` (each producing a ✓/△/✕ styled line).
  - **Post-trade panel:** if intraday & closed, calls `renderIntraPostTradeReview(t)`.
  - Builds the full `#thBody` innerHTML combining: a top badge row (grade+score pill, result pill, R value, paper/scalp badges, checklist-model badge, bias pill, "Played" bias-match text, and a "View Checklist" link for non-intraday trades), the score panel, a "PLAN — PRE-MARKET IDEA" section (`infoGrid` of session/direction/entry/close/SL/TP/TP1R/TP1.5R, idea/update `noteBlock`s, notes timeline via `timelineHtml`, screenshots via `ssBlock`), then for each linked intraday execution: an "EXECUTION — INTRADAY SETUP" section with its own badge row, info grid, execution notes, notes timeline, screenshots, and post-trade review (or a "No intraday execution logged" message if none exist), then post-trade notes, the post-trade panel, any review notes timeline, review screenshots, and (for non-intraday closed trades) the AI review block via `renderTradeAiReviewBlock`.
  - Calls `renderTagsInWrap('closeTagWrap', S.closeTags, 'closed')` to render the close-tag chip editor.
  - Opens the `#tradeHistoryModal`.
- **Calls:** idEq, filter, loadTradeScreenshots, infoGrid, noteBlock, rteDisplay, ssBlock, openLb, timelineHtml, formatTsWithNY, calcR, deriveDisplayGradeClass, barColor, renderIntraPostTradeReview, deriveDisplayGrade, deriveDisplayScore, openChecklistView, renderTradeAiReviewBlock, renderTagsInWrap
- **Called by:** renderWeekly, renderClosed, thSaveNote
- **Side effects:** DOM: `#thBody` innerHTML, modal title, tag wrap, `open` class. Global state: `_thId`, `_thNewSS`, `S.closeTagsEditId`, `S.closeTags`. Triggers screenshot loading (Supabase reads via `loadTradeScreenshots`).
- **Notes:** One of the largest functions in the chunk (152 lines). Re-called by `thSaveNote` after adding a review note, effectively acting as its own refresh/re-render mechanism (re-opens itself with the same id to reflect the newly added note).

#### infoGrid(items)

- **File:** Trade_Journal/index.html (lines 13923-13932)
- **Module:** Trade History / UI Rendering
- **Purpose:** Local helper inside `openTradeHistory` that renders a 3-column label/value grid, skipping any item whose value is null/undefined/empty-string.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| items | Array<[string, any]> | Array of `[label, value]` tuples |

- **Returns:** `string` — HTML grid markup, or `''` if all items filtered out.
- **Internal logic:**
  - Filters `items` to those where the value (`v`) is not `null`/`undefined` and not `''`.
  - If nothing remains, returns `''`.
  - Otherwise returns a `grid-template-columns:repeat(3,1fr)` div containing one small card per remaining `[label, value]` pair (uppercase mono label + bold value).
- **Calls:** filter
- **Called by:** openTradeHistory
- **Side effects:** None — pure string builder.
- **Notes:** Defined as a nested function inside `openTradeHistory`; not globally accessible.

#### noteBlock(label, html, color)

- **File:** Trade_Journal/index.html (lines 13934-13940)
- **Module:** Trade History / UI Rendering
- **Purpose:** Local helper inside `openTradeHistory` that renders a labeled, color-accented rich-text note block (used for Idea/Update/Post-Trade/Execution notes), or nothing if the content is empty.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| label | string | Section label (e.g. "Idea", "Update") |
| html | string | Rich-text HTML content (possibly raw stored notes) |
| color | string | CSS color value for the label and left border accent |

- **Returns:** `string` — HTML block, or `''` if `html` is falsy.
- **Internal logic:** Returns `''` immediately if `html` is falsy; otherwise wraps `rteDisplay(html)` in a labeled div with the given accent color.
- **Calls:** rteDisplay
- **Called by:** openTradeHistory
- **Side effects:** None.
- **Notes:** Nested/local to `openTradeHistory`.

#### ssBlock(list)

- **File:** Trade_Journal/index.html (lines 13942-13945)
- **Module:** Trade History / UI Rendering
- **Purpose:** Local helper inside `openTradeHistory` that renders a screenshot thumbnail grid for an arbitrary screenshot array.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| list | Array<Object> | Screenshot objects with `dataUrl`/`_displayUrl`/`label` |

- **Returns:** `string` — HTML grid, or `''` if list is empty/falsy.
- **Internal logic:** Returns `''` if `!list || !list.length`; otherwise maps each screenshot to a clickable (`onclick="openLb(src)"`) thumbnail with a label overlay, wrapped in a `.ss-grid`.
- **Calls:** openLb (embedded in generated onclick string)
- **Called by:** openTradeHistory
- **Side effects:** None directly (string builder); generated onclick wires up the lightbox viewer.
- **Notes:** Nested/local to `openTradeHistory`.

#### timelineHtml(notes)

- **File:** Trade_Journal/index.html (lines 13947-13953)
- **Module:** Trade History / UI Rendering
- **Purpose:** Local helper inside `openTradeHistory` that renders a reverse-chronological list of timestamped notes (e.g. `tradeNotes`/`reviewNotes` timelines).
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| notes | Array<Object> | Array of `{at, text}` note entries |

- **Returns:** `string` — HTML, or `''` if `notes` is empty/falsy.
- **Internal logic:** Returns `''` if empty; otherwise reverses a copy of `notes` (newest first) and maps each to a styled block showing `formatTsWithNY(n.at)` as a timestamp and `rteDisplay(n.text)` as the body.
- **Calls:** formatTsWithNY, rteDisplay
- **Called by:** openTradeHistory
- **Side effects:** None.
- **Notes:** Nested/local to `openTradeHistory`; used both for the parent trade's notes timeline and (separately, per intra item) for each linked intraday execution's own timeline.

#### thSaveNote()

- **File:** Trade_Journal/index.html (lines 14063-14078)
- **Module:** Trade History
- **Purpose:** Saves a new "review note" (and/or attached screenshots) typed into the Trade History modal's note composer, appending it to the trade's `reviewNotes`/`reviewScreenshots` and refreshing the modal.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Finds the trade via module-level `_thId`/`idEq`; returns if not found.
  - Reads `#thNoteInput` innerHTML, trimmed, as `text`.
  - If there's no text and no pending screenshots (`_thNewSS.length`), alerts "Add a note or screenshot first." and returns.
  - Guard: if any pending screenshot is still `_uploading`, warns and aborts.
  - Ensures `t.reviewNotes` and `t.reviewScreenshots` arrays exist.
  - If `text` present, pushes `{at: new Date().toISOString(), text}` onto `t.reviewNotes`.
  - Pushes each pending screenshot in `_thNewSS` onto `t.reviewScreenshots`.
  - Calls `saveTrade(t)`.
  - Resets `_thNewSS = []`, clears the note-input and screenshot-preview DOM elements.
  - Re-invokes `openTradeHistory(_thId)` to refresh the modal with the newly added note visible.
- **Calls:** idEq, showToast, saveTrade, openTradeHistory
- **Called by:** (none detected — verify: wired via inline `onclick="thSaveNote()"` on the note composer's Save button in the Trade History modal)
- **Side effects:** Global state: mutates `t.reviewNotes`/`t.reviewScreenshots`; resets `_thNewSS`. Supabase: persists via `saveTrade`. DOM: clears input/preview, then fully re-renders the modal via `openTradeHistory`.
- **Notes:** The self-refresh-by-recursive-reopen pattern (calling `openTradeHistory` again) is a simple way to keep the modal in sync without a separate targeted DOM patch.

#### thAddScreenshots(e)

- **File:** Trade_Journal/index.html (lines 14080-14125)
- **Module:** Trade History / Screenshot Storage
- **Purpose:** File-input change handler for the Trade History modal's "add review screenshot" control — compresses, uploads, and previews each selected image with a per-file loading spinner.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| e | Event | The file input's `change` event |

- **Returns:** `Promise<void>`
- **Internal logic:**
  - Reads `files` from `e.target.files`; immediately clears the input value (`e.target.value=''`) so the same file can be re-selected later.
  - For each file (sequential `for...of` loop, each iteration awaited):
    - Generates a `placeholderId` via `crypto.randomUUID()`.
    - Appends a spinner `<div id="th-spin-{placeholderId}">⏳</div>` to `#thSsPreview` immediately (optimistic UI feedback before upload completes).
    - Tries: `compressImage(f)`, then `uploadScreenshotToStorage(compressed, tradeId, f.name)` — where `tradeId` is `_thId` if set, else a synthetic `'pending_' + placeholderId` (handles the edge case of adding a screenshot before a trade id context is fully established, though in this modal `_thId` should normally already be set).
    - On success, `storedUrl = result.path` (persisted), `displayUrl = result.signedUrl` (shown); on failure, falls back to base64 via `FileReader`, with a warning toast.
    - Builds the screenshot object `{id: placeholderId, name, dataUrl: storedUrl, _displayUrl, label:'Review Chart', at: <timestamp>}` and pushes it onto `_thNewSS` (module-level pending-screenshots array, later flushed by `thSaveNote`).
    - Replaces the spinner element with an actual `<img>` thumbnail (44x44, object-fit cover, clickable via `openLb`).
    - Catches errors: logs a warning and removes the spinner element (so a failed upload doesn't leave an orphaned spinner).
- **Calls:** compressImage, uploadScreenshotToStorage, showToast, openLb, remove (spinner element removal)
- **Called by:** (none detected — verify: wired via inline `onchange="thAddScreenshots(event)"` on the hidden file input in the Trade History modal)
- **Side effects:** Global state: pushes to module-level `_thNewSS`. Network: Supabase Storage upload per file. DOM: `#thSsPreview` children (spinners → images).
- **Notes:** Screenshots added here are *not* saved to the trade immediately — they sit in `_thNewSS` until the user clicks the note-composer's Save button, which calls `thSaveNote()` to actually persist them onto the trade's `reviewScreenshots`. Uploads still happen eagerly (at selection time), just the DB write of the trade record is deferred.

### Module: Dashboard — Process Improvement / Insights

#### computeProcessAverages()

- **File:** Trade_Journal/index.html (lines 14131-14139)
- **Module:** Dashboard / Insights Analytics
- **Purpose:** Computes the average Context/Setup/Execution scores across all closed, scored intraday trades (respecting the current live/paper/combined insights mode filter).
- **Parameters:** None
- **Returns:** `Object|null` — `{context, setup, execution, count}` averages, or `null` if no qualifying trades exist.
- **Internal logic:**
  - Reads `S.insightsMode` to determine `combined` (mode `'combined'`) and `paperOnly` (mode `'paper'`) flags.
  - Filters `S.trades` to intraday, closed, has `intraScores`, and matching the paper/live/combined mode (combined includes all; otherwise live-mode excludes paper trades and paper-mode excludes live trades) → `intra`.
  - If `intra.length === 0`, returns `null`.
  - Computes the mean of `contextScore`, `setupScore`, `execScore` across `intra` (defaulting missing fields to 0 in the sum).
  - Returns `{context, setup, execution, count: intra.length}`.
- **Calls:** filter
- **Called by:** computePerformanceLeak, renderProcessQuality, renderExecution, computeAllLeaks
- **Side effects:** None — pure read of `S.trades`/`S.insightsMode`.
- **Notes:** The `combined`/`paperOnly`/live-mode filter pattern (`S.insightsMode`) recurs throughout this and the following functions — it's the app's mechanism for letting the user toggle whether dashboard analytics include paper trades, live trades only, or both.

#### computeGradePerformance()

- **File:** Trade_Journal/index.html (lines 14141-14167)
- **Module:** Dashboard / Insights Analytics
- **Purpose:** Computes win-rate, R totals, and counts broken down by checklist-engine grade (A+/A/B/Invalid) for closed daily/weekly (non-intraday) trades.
- **Parameters:** None
- **Returns:** `Array<Object>` — one entry per grade `{grade, count, wins, losses, sumR, sumWinR, sumLossR, wr, avgR}`, always 4 entries (A+, A, B, Invalid) even if count is 0.
- **Internal logic:**
  - Applies the same `S.insightsMode` combined/paper/live filter as `computeProcessAverages`, but to non-intraday closed trades that have a `.grade` field → `swingClosed`.
  - For each of the four display grades (`'A+','A','B','Invalid'`):
    - Filters `swingClosed` to trades matching that grade, mapping the checklist engine's raw grades `'C'`/`'No Trade'`/`'Invalid'` all onto the display bucket `'Invalid'`.
    - Computes `count`, `wins` (`result==='WIN'`), `losses` (`result==='LOSS'`).
    - Computes R-multiples via `calcR` for all trades in the bucket (`rVals`), summing to `sumR`; separately computes `sumWinR`/`sumLossR` from only the WIN/LOSS subsets.
    - Computes win rate `wr = wins/count*100` and average R `avgR = sumR/count` (both 0 if `count===0`).
  - Returns the array of all four grade buckets.
- **Calls:** filter, calcR
- **Called by:** computePerformanceLeak, renderGradePerformance, computeAllLeaks
- **Side effects:** None — pure read.
- **Notes:** Grade bucket order is fixed (`A+, A, B, Invalid`); the mapping of legacy grade strings (`'C'`, `'No Trade'`) into `'Invalid'` suggests the checklist engine's grading vocabulary evolved over time and this function normalizes for backward compatibility with older stored trades.

#### _canonicalModelStats(snapMP)

- **File:** Trade_Journal/index.html (lines 14178-14263)
- **Module:** Dashboard / Insights Analytics
- **Purpose:** The single canonical source of model-accuracy statistics (Weekly / Omar / TTrades bias-prediction accuracy and average R), shared by both the dashboard's `renderModelAccuracy` and the deeper `computeModelPerformanceAnalysis` (Section 7 insights) so the two always report identical percentages. Merges live in-session stats with a historical archived snapshot (`snapMP`) if provided.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| snapMP | Object\|undefined | A historical "model performance" snapshot (e.g. `S.insightSnapshot?.modelPerf`) with prior `omar`/`tt`/`weekly` `{count, correct}` accumulators to merge in |

- **Returns:** `Object` — `{ omar: {count, correct, acc, avgR, sumR}, tt: {...}, weekly: {count, correct, acc, avgR} }`, where `acc` is `null` unless `count >= 3` (minimum sample size gate).
- **Internal logic:**
  - Applies the `S.insightsMode` combined/paper/live filter to non-intraday closed trades → `closed`.
  - **Weekly:** filters `S.weeklies` to `status==='closed' && weeklyReview` present; `wTotal` = count, `wCorrect` = those whose `weeklyReview.biasAccuracy.result === 'Correct'`.
  - **Omar:** filters `closed` to `checklistModel==='omar'` AND `biasMatch` explicitly `'YES'` or `'NO'` (per the "Denominator rule" comment — trades with empty/null `biasMatch` are excluded from both numerator and denominator since they have no recorded prediction to grade). `oTotal`/`oCorrect` from that set; also computes `omarSumR` from `calcR` over the same set.
  - **TTrades:** identical pattern, filtered to `checklistModel==='ttrades'`.
  - **Omar avg R (for Section 7):** computed separately across *all* Omar closed trades regardless of biasMatch (`omarAllRVals`), not just the YES/NO-matched subset — a broader sample than the accuracy calculation uses.
  - **TTrades avg R:** same broader-sample approach.
  - **Weekly avg R:** accumulates `ps.netR` (sum) and `ps.count` (trade count) from each closed weekly's stored `performanceStats`, weighted by trade count (`wSumR/wTradeCount`), per a code comment referencing "Fix 5 / AC-013".
  - **Snapshot merge:** if `snapMP` provided and its `omar`/`tt`/`weekly` sub-objects have `count > 0`, adds their `count`/`correct` into the running totals (extending the accuracy calculation with historical/archived data beyond what's in the live `S.trades`/`S.weeklies` arrays).
  - Returns the final merged stats object, with `acc` computed as a percentage only if the total count (live + historical) is at least 3, else `null`.
- **Calls:** filter, calcR, count (`.length` used generically — likely a static-analysis artifact rather than a real function call named "count")
- **Called by:** computeModelAccuracy, computeModelPerformanceAnalysis
- **Side effects:** None — pure read of `S.trades`, `S.weeklies`, `S.insightsMode`, and the passed-in snapshot.
- **Notes:** The extensive inline comments (AC-003/AC-006/Fix 5/AC-013) indicate this function was refactored specifically to fix a bug where the dashboard and Section 7 insights previously disagreed on model accuracy percentages — it is now the deliberate single source of truth. The `>=3` minimum-sample gate prevents small-sample noise from displaying as a misleadingly precise percentage.

#### computeModelAccuracy()

- **File:** Trade_Journal/index.html (lines 14265-14268)
- **Module:** Dashboard / Insights Analytics
- **Purpose:** Thin wrapper that extracts just the three accuracy percentages (weekly/omar/tt) from `_canonicalModelStats`, merging in the historical snapshot, for display on the main dashboard.
- **Parameters:** None
- **Returns:** `Object` — `{weekly, omar, tt}` accuracy percentages (each `number|null`).
- **Internal logic:** Calls `_canonicalModelStats(S.insightSnapshot?.modelPerf)`, then returns `{weekly: stats.weekly.acc, omar: stats.omar.acc, tt: stats.tt.acc}`.
- **Calls:** _canonicalModelStats
- **Called by:** renderModelAccuracy
- **Side effects:** None.
- **Notes:** Simple facade — all real logic lives in `_canonicalModelStats`.

#### computePerformanceLeak()

- **File:** Trade_Journal/index.html (lines 14270-14305)
- **Module:** Dashboard / Insights Analytics
- **Purpose:** Identifies the single most significant "process leak" (weakest link) in the user's trading process — the first rule that fires from a priority-ordered checklist of possible issues (execution, context, setup, grade distribution, alignment conflict) — for display as an actionable dashboard insight.
- **Parameters:** None
- **Returns:** `Object|null` — `{title, msg, score}` for the first matching leak rule, or `null` if none apply.
- **Internal logic:**
  - Computes `avg = computeProcessAverages()` and `gradePerf = computeGradePerformance()` (though `gradePerf` itself is computed but not directly referenced afterward except through `bGradeCount`/`bPct`, which are derived independently from raw intraday data rather than from `gradePerf` — `gradePerf` appears to be dead/unused local computation, possibly leftover from a refactor).
  - Filters `S.trades` for closed non-intraday (`closed`, unused beyond being computed) and closed intraday (`intra`).
  - Computes `conflictTrades` = intraday trades with `intraAlignment==='Conflict'`; `conflictPct` = their percentage of all closed intraday trades.
  - Computes `gradedIntra` = intraday trades with `intraScores`; `bGradeCount` = those graded `'B'` or `'Invalid'`; `bPct` = their percentage of `gradedIntra`.
  - Defines an ordered array `LEAK_RULES`, each with a `check()` predicate, a `title`, a `msg`, and a `score`:
    1. Execution Score — fires if `avg.execution < 65`.
    2. Context Quality — fires if `avg.context < 65`.
    3. Setup Quality — fires if `avg.setup < 65`.
    4. Too Many B/C/Invalid Trades — fires if `bPct > 40`.
    5. Alignment Quality — fires if `conflictPct > 20`.
  - Iterates the rules in order and returns the first whose `check()` returns true (with its title/msg/rounded score); returns `null` if none fire.
- **Calls:** computeProcessAverages, computeGradePerformance, filter
- **Called by:** renderPerformanceLeak
- **Side effects:** None — pure read.
- **Notes:** `closed` and `gradePerf` locals are computed but appear unused in the visible logic (dead code within the function) — `closed` is assigned but never referenced again, and `gradePerf` likewise. This may be a vestige of an earlier version of the rule set. The rule order matters: only the *first* triggering issue is surfaced, so if multiple problems exist simultaneously, lower-priority ones are hidden until the higher-priority one is resolved.

#### renderProcessQuality()

- **File:** Trade_Journal/index.html (lines 14307-14348)
- **Module:** Dashboard / Insights Analytics / UI Rendering
- **Purpose:** Renders the dashboard's "Process Quality" bar-chart panel (Context/Setup/Execution averages), merging live session data with any historical archived snapshot, and highlighting the weakest metric.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Grabs `#processQualityGrid`; returns if missing.
  - Computes `avg = computeProcessAverages()`.
  - If a historical snapshot `S.insightSnapshot?.processAverages` exists with `count > 0`, merges it with the live `avg` via a weighted-average recombination: `totalCount = liveCount + snapCount`; each metric becomes `(liveAvg*liveCount + snapSum)/totalCount` for context/setup/execution, using the snapshot's stored `contextSum`/`setupSum`/`execSum` (i.e., the snapshot stores raw sums, not averages, enabling correct re-weighting).
  - If no `avg` or `avg.count < 2`, shows a "Need at least 2 closed intraday trades..." placeholder message and returns.
  - Builds an `items` array for Context/Setup/Execution with their scores; finds the minimum score (`min`).
  - For each item: computes a capped percentage (`min(score,100)`), a color/status tier (bull/"Strong" ≥80, gold/"Developing" ≥60, bear/"Needs Work" below), and marks it with a `weakest` CSS class if it equals `min` and `min < 70` (only highlight the weak point if it's actually below a "needs attention" threshold, not just the smallest of three otherwise-fine numbers).
  - Renders a `.pq-item` block per metric (label, score, progress bar, status), joining into the grid.
- **Calls:** computeProcessAverages
- **Called by:** renderDashboard
- **Side effects:** DOM: `#processQualityGrid` innerHTML.
- **Notes:** The weighted-merge-with-snapshot logic mirrors the "archive" system pattern seen elsewhere in the app (data gets periodically archived/snapshotted, presumably by `runArchive`, and live analytics re-blend with those historical sums so long-term stats survive archival of old trade records).

#### renderGradePerformance()

- **File:** Trade_Journal/index.html (lines 14350-14377)
- **Module:** Dashboard / Insights Analytics / UI Rendering
- **Purpose:** Renders the dashboard's grade-performance breakdown list (count, win rate, average R per grade bucket) as horizontal bar rows, merging in any historical snapshot data.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Grabs `#gradePerformanceList`; returns if missing.
  - Computes `data = getMergedInsightData('gradePerformance', computeGradePerformance())` — delegates the live/snapshot merge to a shared helper (`getMergedInsightData`, defined elsewhere in the file) rather than doing manual weighted-merge math inline (unlike `renderProcessQuality`).
  - Computes `total` = sum of all bucket counts; if `0`, shows a "No closed trades yet." placeholder and returns.
  - Computes `maxCount` across buckets (for proportional bar widths).
  - Filters to buckets with `count > 0` OR grade `'A+'` (always shows the A+ row even if empty, presumably to always display the top-tier aspirational bucket).
  - For each remaining bucket: computes bar width percentage relative to `maxCount`, a grade-class string for the pill, a win-rate color tier (bull ≥60%, gold ≥40%, bear below), an avg-R color tier (bull ≥0.3, gold ≥0, bear below), and a bar fill color per grade (`A+`=bright green `#00c853`, `A`=bull, `B`=gold, else bear).
  - Renders a `.gp-row` per bucket: grade pill, count text, win-rate text, avg-R text, and a proportional bar.
- **Calls:** getMergedInsightData, computeGradePerformance, filter
- **Called by:** renderDashboard
- **Side effects:** DOM: `#gradePerformanceList` innerHTML.
- **Notes:** Uses a different merge strategy than its sibling `renderProcessQuality` (delegates to `getMergedInsightData` instead of inlining the weighted-average math) — worth noting as an inconsistency in approach between two visually-similar dashboard panels, though functionally this is likely just because grade-performance data (integer counts) merges more simply via addition than the continuous averages in process-quality.


---

## Trade_Journal — Functions (chunk 4 of 8, lines 14379-15945)

### Module: Dashboard Rendering / Insights

#### renderModelAccuracy()

- **File:** Trade_Journal/index.html (lines 14379-14408)
- **Module:** Dashboard Rendering / Insights
- **Purpose:** Renders the "Model Accuracy" mini-chart on the dashboard, showing prediction accuracy percentages for Weekly Bias, Daily Omar model, and TTrades model.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Looks up `#modelAccuracyList`; bails if not present.
  - Calls `computeModelAccuracy()` to get `{weekly, omar, tt}` accuracy values (each `null` if fewer than 3 closed samples).
  - Builds a 3-item array with label/note text ("Need 3+ closed …") for null values.
  - For each item computes a clamped percentage (max 100), a threshold-based color (`>=70` bull, `>=50` gold, else bear, or muted if null), a display string (`XX%` or `—`), and an HTML progress bar (8% width placeholder bar when null).
  - Joins rows into HTML and sets `list.innerHTML`.
- **Calls:** computeModelAccuracy
- **Called by:** renderDashboard
- **Side effects:** DOM mutation of `#modelAccuracyList`.
- **Notes:** Comment in code notes this uses the "canonical helper" so archived-snapshot merging (ticket AC-003) is already included via `computeModelAccuracy`.

#### renderOpportunityDistribution()

- **File:** Trade_Journal/index.html (lines 14410-14434)
- **Module:** Dashboard Rendering / Insights
- **Purpose:** Renders a bar breakdown of closed intraday trades by grade (A+, A, B, Invalid) on the dashboard.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Looks up `#opportunityDistList` and `#odTotalTrades`; bails if the list element is missing.
  - Reads `S.insightsMode` to determine combined/paper/live filtering (`combined`, `paper`, else live-only).
  - Filters `S.trades` for `isIntraday && status==='closed' && intraScores` matching the mode filter.
  - Computes total count and updates the total-trades label.
  - For each of the 4 grade buckets, counts matching trades, computes percentage of total and bar-width percentage relative to `maxCount` (largest bucket), assigns a grade-specific pill class/color, and builds a row of HTML.
  - Sets `list.innerHTML` to the joined rows.
- **Calls:** filter (Array.prototype.filter, used repeatedly)
- **Called by:** renderDashboard
- **Side effects:** DOM mutation of `#opportunityDistList` and `#odTotalTrades`.
- **Notes:** `maxCount` uses `Math.max(1, ...)` to avoid divide-by-zero when all buckets are empty.

#### renderPerformanceLeak()

- **File:** Trade_Journal/index.html (lines 14436-14448)
- **Module:** Dashboard Rendering / Insights
- **Purpose:** Renders the "Biggest Performance Leak" callout card on the dashboard, highlighting the weakest process metric.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Looks up `#performanceLeakWrap`; bails if missing.
  - Calls `computePerformanceLeak()`; if it returns falsy, renders a green "no leaks detected" success card.
  - Otherwise determines `isWarn` (score < 70) to choose border/text color (bear vs gold) and renders a card with title, message, and an optional numeric score badge.
- **Calls:** computePerformanceLeak
- **Called by:** renderDashboard
- **Side effects:** DOM mutation of `#performanceLeakWrap`.
- **Notes:** The leak object's shape (`title`, `msg`, optional `score`) is produced entirely by `computePerformanceLeak` (defined elsewhere in the file).

#### renderAdditionalInsights()

- **File:** Trade_Journal/index.html (lines 14450-14584)
- **Module:** Dashboard Rendering / Insights
- **Purpose:** Renders the "Additional Insights" grid on the dashboard: best session, best pair, current streak, bias adherence, and best weekly environment — each merging live trade data with archived insight snapshots.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Looks up `#additionalInsightsGrid`; bails if missing.
  - Derives `combined`/`paperOnly` filters from `S.insightsMode`; builds `closed` (non-intraday closed trades) and `intraClosed` (intraday closed trades) sets (intraClosed is computed but not directly used further in this function body shown).
  - Reads `S.insightSnapshot?.additionalInsights` (`snapAI`) for archived aggregates.
  - **Best session:** aggregates win/loss/sumR per session (`London`, `NY Open`, `NY Expansion`, `Asia`) from `closed` trades using `calcR`, then merges in `snapAI.bySession` archived counts (additive). Picks the session with highest win rate (tie-broken by avg R).
  - **Best pair:** same aggregation pattern keyed by `t.pair`, merged with `snapAI.byPair`; requires `count >= 2` to qualify; picks highest win rate.
  - **Streak:** sorts `closed` by `closeTime` ascending, walks backward from the most recent trade counting consecutive WIN/LOSS results into a signed streak counter (positive = win streak, negative = loss streak); stops at first BE or gap.
  - **Bias adherence:** splits `closed` into `biasMatch === 'YES'` vs `'NO'`, computes average R for each side via `calcR`; color-codes by the difference between matched and unmatched averages (bull if >0.2, bear if <-0.2, else gold).
  - **Weekly environment performance:** filters `S.weeklies` for closed weeklies with a `weeklyReview`; requires at least 2 to compute; buckets by `actualEnvironment`, sums `performanceStats.netR`, picks the environment with the highest average R (min 1 sample), and only displays if `count >= 2`.
  - Renders all five metrics into `grid.innerHTML`, including a proportional bar for the weekly-environment R (mapped from a [-2,+2] R range to 0-100%).
- **Calls:** filter, calcR
- **Called by:** renderDashboard
- **Side effects:** DOM mutation of `#additionalInsightsGrid`; reads `S.trades`, `S.weeklies`, `S.insightSnapshot`, `S.insightsMode`.
- **Notes:** Archive-merge behavior is intentionally inconsistent across metrics per inline comments: session/pair stats merge archived snapshot data (so archived trades still count), while streak and bias-adherence are explicitly "live-only" (no archive merge) since they represent current-state metrics that don't make sense to sum historically.

### Module: Journal Heatmap

#### jheatNormalizePair(raw)

- **File:** Trade_Journal/index.html (lines 14591-14599)
- **Module:** Journal Heatmap
- **Purpose:** Normalizes a free-text pair string into one of the 4 canonical tracked pairs (XAUUSD, EURUSD, GBPUSD, USDCHF), or `null` if unrecognized.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| raw | string | Raw pair string from a trade/weekly record (e.g. "XAU/USD", "gbpusd") |

- **Returns:** string (one of `'XAUUSD'`, `'EURUSD'`, `'GBPUSD'`, `'USDCHF'`) or `null`.
- **Internal logic:**
  - Returns `null` immediately if `raw` is falsy.
  - Uppercases and strips all non-alphabetic characters.
  - Checks for `XAU`/`GOLD` substring → XAUUSD; `EUR`+`USD` → EURUSD; `GBP`+`USD` → GBPUSD; `USD`+`CHF` → USDCHF; otherwise `null`.
- **Calls:** (none)
- **Called by:** jheatDailyPairSets, jheatWeeklyBiasSets, jheatWeeklyR
- **Side effects:** None (pure function).
- **Notes:** Order-independent substring matching (e.g. handles "USDCHF" or "CHFUSD" equally since it checks both substrings present).

#### jheatTier(count)

- **File:** Trade_Journal/index.html (lines 14600-14605)
- **Module:** Journal Heatmap
- **Purpose:** Maps a daily journaled-pair count (0-4) to a heatmap color tier class name.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| count | number | Number of the 4 tracked pairs journaled on a given day |

- **Returns:** string — one of `'dgreen'`, `'lgreen'`, `'orange'`, `'red'`.
- **Internal logic:** `count>=4` → dgreen; `count===3` → lgreen; `count===2` → orange; otherwise (0 or 1) → red.
- **Calls:** (none)
- **Called by:** renderJournalHeatmap
- **Side effects:** None (pure function).
- **Notes:** Used both for daily cells and (indirectly, via inline recomputation) year-view month cells, though the year view actually inlines its own percentage-based tier logic rather than calling this function.

#### jheatMondayOf(d)

- **File:** Trade_Journal/index.html (lines 14606-14612)
- **Module:** Journal Heatmap
- **Purpose:** Returns the Date of the Monday that starts the week containing date `d`.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| d | Date | Any date within the target week |

- **Returns:** Date (midnight, local time) of that week's Monday.
- **Internal logic:**
  - Constructs a new Date stripped to just year/month/day (no time component).
  - Computes `day = x.getDay()` (0=Sun..6=Sat); `diff = day===0 ? -6 : 1-day` shifts back to Monday (Sunday counts as end of previous week, going back 6 days).
  - Applies the offset via `setDate` and returns the mutated date.
- **Calls:** (none)
- **Called by:** jheatWeeklyBiasSets, renderJournalHeatmap
- **Side effects:** None (pure; constructs and returns a new Date each call).
- **Notes:** Treats weeks as Monday-start, consistent with FX trading week conventions.

#### jheatDateKey(d)

- **File:** Trade_Journal/index.html (lines 14613-14615)
- **Module:** Journal Heatmap
- **Purpose:** Formats a Date as a zero-padded `YYYY-MM-DD` string key (local time, not UTC).
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| d | Date | Date to format |

- **Returns:** string in `YYYY-MM-DD` format.
- **Internal logic:** Concatenates `getFullYear()`, zero-padded `getMonth()+1`, and zero-padded `getDate()`, joined by hyphens.
- **Calls:** (none)
- **Called by:** jheatWeeklyBiasSets, jheatWeekJournaledPairs, renderJournalHeatmap
- **Side effects:** None (pure function).
- **Notes:** Uses local-time components (not `toISOString`), which avoids UTC offset shifting the date.

#### jheatDailyPairSets()

- **File:** Trade_Journal/index.html (lines 14617-14627)
- **Module:** Journal Heatmap
- **Purpose:** Builds a map of `dateKey → Set<normalizedPair>` representing which of the 4 tracked pairs had a daily idea logged on each date, sourced from all trades (any status).
- **Parameters:** None
- **Returns:** Object — `{ [dateString]: Set<string> }`.
- **Internal logic:**
  - Iterates `S.trades`; skips entries without `t.date`.
  - Normalizes `t.pair` via `jheatNormalizePair`; skips unrecognized pairs.
  - Adds the normalized pair to the Set keyed by `t.date`, creating the Set lazily.
- **Calls:** jheatNormalizePair
- **Called by:** renderJournalHeatmap
- **Side effects:** Reads `S.trades`; no mutation.
- **Notes:** Keys are the trades' raw `t.date` strings, assumed already in `YYYY-MM-DD` form (matches `jheatDateKey` output format elsewhere for lookups to line up).

#### jheatWeeklyBiasSets()

- **File:** Trade_Journal/index.html (lines 14630-14641)
- **Module:** Journal Heatmap
- **Purpose:** Builds a map of `mondayKey → Set<normalizedPair>` representing which pairs had a weekly-bias entry logged for each trading week.
- **Parameters:** None
- **Returns:** Object — `{ [mondayDateString]: Set<string> }`.
- **Internal logic:**
  - Iterates `S.weeklies`; skips entries without `w.date`.
  - Normalizes `w.pair`; skips unrecognized.
  - Computes the Monday-of-week key by parsing `w.date` as local midnight (`+'T00:00:00'`), passing through `jheatMondayOf`, then `jheatDateKey`.
  - Adds the pair to the Set at that Monday key.
- **Calls:** jheatNormalizePair, jheatDateKey, jheatMondayOf
- **Called by:** renderJournalHeatmap
- **Side effects:** Reads `S.weeklies`; no mutation.
- **Notes:** Explicit `T00:00:00` suffix avoids the date string being parsed as UTC midnight (which could shift the day in negative-UTC-offset timezones).

#### jheatSetView(view)

- **File:** Trade_Journal/index.html (lines 14643-14646)
- **Module:** Journal Heatmap
- **Purpose:** Switches the heatmap's display granularity (week/month/year) and re-renders.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| view | string | One of `'week'`, `'month'`, `'year'` |

- **Returns:** void
- **Internal logic:** Sets `S.jheatView = view`, then calls `renderJournalHeatmap()`.
- **Calls:** renderJournalHeatmap
- **Called by:** (none detected via static call-graph — this is invoked via inline `onclick="jheatSetView('week'|'month'|'year')"` attributes on the heatmap's view-toggle buttons in the HTML, per the `#jheatViewToggle` element referenced in `renderJournalHeatmap`)
- **Side effects:** Mutates global `S.jheatView`; triggers a re-render (DOM mutation via `renderJournalHeatmap`).
- **Notes:** No inbound callers were found in the static analysis; this is an onclick-only entry point.

#### jheatNav(dir)

- **File:** Trade_Journal/index.html (lines 14647-14654)
- **Module:** Journal Heatmap
- **Purpose:** Navigates the heatmap's reference date forward/backward by one unit of the current view (week/month/year) and re-renders.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| dir | number | Direction multiplier, typically `1` or `-1` |

- **Returns:** void
- **Internal logic:**
  - Clones `S.jheatRefDate` into a new Date.
  - If `S.jheatView==='week'`, advances by `dir*7` days; if `'month'`, advances by `dir` months; else (year) advances by `dir` years.
  - Stores the result back to `S.jheatRefDate` and calls `renderJournalHeatmap()`.
- **Calls:** renderJournalHeatmap
- **Called by:** (none detected via static call-graph — invoked via inline `onclick="jheatNav(-1)"` / `onclick="jheatNav(1)"` prev/next buttons in the HTML around the heatmap widget)
- **Side effects:** Mutates global `S.jheatRefDate`; triggers re-render.
- **Notes:** No inbound callers found in static analysis; onclick-only entry point.

#### jheatWeeklyR(mondayKey, journaledPairs)

- **File:** Trade_Journal/index.html (lines 14659-14675)
- **Module:** Journal Heatmap
- **Purpose:** Computes the net R for a given trading week, restricted to only the pairs that were actually journaled (had a daily idea or weekly bias entry) that week.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| mondayKey | string | `YYYY-MM-DD` key of the week's Monday |
| journaledPairs | Set<string> | Normalized pairs journaled during that week |

- **Returns:** number (summed R) or `null` if `journaledPairs` is empty/falsy or no matching trades had a numeric R.
- **Internal logic:**
  - Returns `null` immediately if `journaledPairs` is empty.
  - Computes the week's Monday/Sunday date bounds from `mondayKey`.
  - Iterates `S.trades`; only considers `isIntraday && !isPaper && status==='closed'` trades with a `closeTime` falling within `[monday, sunday]`.
  - Normalizes each trade's pair and skips it unless it's in `journaledPairs`.
  - Parses `t.tp1r` as float; if valid, adds to `rSum` and marks `hasTrades = true`.
  - Returns `rSum` if any trade contributed, else `null`.
- **Calls:** jheatNormalizePair
- **Called by:** jheatRCell, renderJournalHeatmap
- **Side effects:** Reads `S.trades`; no mutation.
- **Notes:** Explicitly excludes paper trades (`!t.isPaper`) — only real intraday closed trades count toward the R figure. Uses `t.tp1r` as the realized R value (field name is slightly misleading — it's the actual R captured, not necessarily hit at the 1R target specifically, based on surrounding code conventions in the file).

#### jheatWeekJournaledPairs(mondayKey, dailySets, weeklySets)

- **File:** Trade_Journal/index.html (lines 14678-14690)
- **Module:** Journal Heatmap
- **Purpose:** Computes the union of all normalized pairs journaled (via weekly bias or daily idea) during the week starting at `mondayKey`.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| mondayKey | string | `YYYY-MM-DD` key of the week's Monday |
| dailySets | Object | Result of `jheatDailyPairSets()` |
| weeklySets | Object | Result of `jheatWeeklyBiasSets()` |

- **Returns:** Set<string> — union of journaled pairs for that week.
- **Internal logic:**
  - Starts a new empty Set `pairs`.
  - Adds all pairs from `weeklySets[mondayKey]` (weekly bias entries).
  - Loops `i=0..4` (Mon-Fri), computing each day's date and `jheatDateKey`, adding all pairs from `dailySets[key]`.
- **Calls:** jheatDateKey
- **Called by:** jheatRCell, renderJournalHeatmap
- **Side effects:** None (pure; reads passed-in maps).
- **Notes:** Only iterates 5 weekdays (Mon-Fri); weekends are not considered trading/journaling days.

#### jheatRCell(mondayKey, dailySets, weeklySets)

- **File:** Trade_Journal/index.html (lines 14692-14699)
- **Module:** Journal Heatmap
- **Purpose:** Builds the HTML for a single "R" summary cell shown in the heatmap grid for one week, showing the net journaled-pair R with color coding.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| mondayKey | string | `YYYY-MM-DD` key of the week's Monday |
| dailySets | Object | Result of `jheatDailyPairSets()` |
| weeklySets | Object | Result of `jheatWeeklyBiasSets()` |

- **Returns:** string (HTML fragment).
- **Internal logic:**
  - Computes `pairs = jheatWeekJournaledPairs(...)`, then `r = jheatWeeklyR(mondayKey, pairs)`.
  - If `r === null`, returns a muted "—" cell.
  - Otherwise colors green/red/muted based on sign, formats with `+`/no-sign and one decimal + "R" suffix.
- **Calls:** jheatWeekJournaledPairs, jheatWeeklyR
- **Called by:** renderJournalHeatmap
- **Side effects:** None (pure HTML-string builder).
- **Notes:** Note this function is itself unused directly inside `renderJournalHeatmap`'s week/month loops in a way distinct from calling `jheatWeeklyR`/`jheatWeekJournaledPairs` inline — per the JSON call graph, `renderJournalHeatmap` calls `jheatRCell` directly for the week and month views (see below).

#### renderJournalHeatmap()

- **File:** Trade_Journal/index.html (lines 14701-14857)
- **Module:** Journal Heatmap
- **Purpose:** Main renderer for the journaling heatmap widget on the dashboard; draws week, month, or year views showing how consistently the 4 tracked pairs were journaled (daily ideas + weekly bias) and the resulting R performance.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Toggles the active button state in `#jheatViewToggle` based on `S.jheatView`.
  - Precomputes `dailySets = jheatDailyPairSets()` and `weeklySets = jheatWeeklyBiasSets()`.
  - Looks up `#jheatGrid`, `#jheatLabel`, `#jheatTotal`.
  - **Week view:** Computes the Monday of `S.jheatRefDate`, builds 5 day cells (Mon-Fri) each showing count/4 pairs journaled and a color tier (via `jheatTier`), with a "Bias X/4" line on Monday's cell; appends an R column (via `jheatRCell`); sets the label to a date range and the total to `weekSum+biasCount` out of 24 (4 pairs × 5 days + 4 bias = 24 max).
  - **Month view:** Iterates week-by-week from the first Monday on/before the 1st of the month through the last week overlapping the month; for each week builds 5 day cells (blank for days outside the month), a "WEEKLY" total cell (`weekSum+weekBias`/24), and an R cell; accumulates `monthTotal`; sets label to month/year and total to ideas-logged count.
  - **Year view:** For each of 12 months, computes `possibleSlots`/`actualCount` by walking every day, counting 4 possible slots per weekday plus 4 more for Monday's weekly bias slot, and the actual counts from `dailySets`/`weeklySets`; derives a completion percentage and tier (inlined thresholds: ≥90 dgreen, ≥65 lgreen, ≥40 orange, else red — note this duplicates but does not directly call `jheatTier`, which uses count-based not percentage-based thresholds); separately computes monthly R by summing `jheatWeeklyR` over each week (via `jheatWeekJournaledPairs`) that starts within the month; renders a month cell with a diagonal SVG divider, month name, R value, and percentage.
  - Sets `gridEl.innerHTML`, `labelEl.textContent`, `totalEl.textContent` per view.
- **Calls:** jheatDailyPairSets, jheatWeeklyBiasSets, jheatMondayOf, jheatDateKey, jheatTier, jheatRCell, jheatWeekJournaledPairs, jheatWeeklyR
- **Called by:** jheatSetView, jheatNav, renderDashboard
- **Side effects:** DOM mutation of `#jheatGrid`, `#jheatLabel`, `#jheatTotal`, and toggle button classes in `#jheatViewToggle`.
- **Notes:** The `WKD_CELL` constant is always an empty string — dead placeholder for a since-removed weekend column, kept as a documented no-op (comment: "Weekend column dropped"). The year-view tier computation uses different thresholds than `jheatTier` since it's percentage-based rather than raw-count-based, and does not call `jheatTier` despite the naming overlap.

#### renderDashboard()

- **File:** Trade_Journal/index.html (lines 14859-14939)
- **Module:** Dashboard Rendering / Insights
- **Purpose:** Top-level renderer for the Dashboard/Home tab: draws the journaling heatmap, headline stats (win rate, bias accuracy, trade counts, net R), the R-distribution grid, all the insight sub-widgets, the "open trades" preview banner, and refreshes nav badges.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Calls `renderJournalHeatmap()` first.
  - Calls `getDashboardTotals()` to get all-time cumulative figures (so stats remain correct after archival removes old trades from `S.trades`).
  - Derives `open` trades: `status==='open'` non-intraday-linked trades (`!t.isIntraday || !t.weeklyLinkId`) filtered by `S.insightsMode` (combined/paper/live).
  - Computes win rate, bias accuracy percentage, net R display string/color, and injects into `#dashStats`.
  - Computes the win/loss/BE bucket counts (`wins2r`, `wins15r`, `wins1r`, `be`, `loss05`, `loss1`, `totalR`) from `totals` and injects into `#rGrid`.
  - Calls `renderProcessQuality()`, `renderGradePerformance()`, `renderModelAccuracy()`, `renderOpportunityDistribution()`, `renderPerformanceLeak()`, `renderAdditionalInsights()`.
  - Builds the `#homeOpenSection` "OPEN TRADES" preview: shows up to 2 open trades as clickable banners (`onclick="navTo('open')"`) with pair/date/grade/session, plus a "+N more" link if there are more than 2; clears the section if there are no open trades.
  - Calls `updateOpenBadge()`, `updateWeeklyBadge()`, `updateIntradayBadge()` to refresh nav badges.
  - Schedules `renderMiniCalendar()` via `setTimeout(..., 50)` (deferred so DOM layout settles first, per typical pattern in this codebase).
- **Calls:** renderJournalHeatmap, getDashboardTotals, filter, renderProcessQuality, renderGradePerformance, renderModelAccuracy, renderOpportunityDistribution, renderPerformanceLeak, renderAdditionalInsights, navTo, deriveDisplayGrade, updateOpenBadge, updateWeeklyBadge, updateIntradayBadge
- **Called by:** loadAllData, navTo, setInsightsMode, deleteOpenTrade, saveClosure, saveEditClosed, deleteTrade, runArchive
- **Side effects:** DOM mutation of `#dashStats`, `#rGrid`, `#homeOpenSection`; triggers many downstream renders and badge updates; reads `S.trades`, `S.insightsMode`.
- **Notes:** This is the central re-render hook called after nearly every state-changing operation in the app (trade save/delete/archive/close), making it one of the most frequently invoked functions in the whole file.

### Module: Mini Calendar

#### renderMiniCalendar()

- **File:** Trade_Journal/index.html (lines 14942-15074)
- **Module:** Mini Calendar
- **Purpose:** Renders the two-month trade calendar widget (with per-day win/loss/BE/open dot indicators) and a win-rate-by-weekday bar chart, shown on the dashboard.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Looks up `#miniCalendarWidget`; bails if missing.
  - Builds `tradesByDate` from `S.trades` (non-intraday only): counts of wins/losses/BE/open per date string.
  - Builds `dowStats` (Mon-Fri array) from closed non-intraday trades, incrementing win/loss/BE counts by day-of-week (Sunday and Saturday excluded via `idx===null||idx>4` guard).
  - Defines local helper `dotHtml(dateStr)` that renders colored dots (green=win, red=loss, gold=BE, blue-outlined=open) for a given date, up to the day's trade count.
  - Defines local helper `buildMonthHtml(mo, moYr)` that renders one month's calendar grid: leading blank cells to align the 1st with Monday-start weekdays, then one cell per day showing the day number, a background tint (today=inverted, win-only=bull-lt, loss-only=bear-lt, mixed=gold-lt) and the day's dot row via `dotHtml`.
  - Builds HTML for the current month and next month (`monthsHtml`), and a weekday win-rate bar chart (`dowHtml`) with bar height proportional to win rate (colored bull/gold/bear by threshold) and trade count label.
  - Builds a color-key legend and a "days remaining in year" header (accounting for leap years).
  - Assembles and sets `el.innerHTML`.
- **Calls:** dotHtml, buildMonthHtml
- **Called by:** (none detected via static call graph — invoked via `setTimeout(renderMiniCalendar, 50)` inside `renderDashboard`)
- **Side effects:** DOM mutation of `#miniCalendarWidget`; reads `S.trades`.
- **Notes:** `dotHtml` and `buildMonthHtml` are nested function declarations, scoped only within `renderMiniCalendar`'s call; they close over `tradesByDate`, `curMo`, `curD`, `yr`.

#### dotHtml(dateStr)

- **File:** Trade_Journal/index.html (lines 14973-14991)
- **Module:** Mini Calendar
- **Purpose:** Nested helper (inside `renderMiniCalendar`) that builds the small colored-dot row representing a day's trade outcomes.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| dateStr | string | `YYYY-MM-DD` key into the closed-over `tradesByDate` map |

- **Returns:** string (HTML fragment, or empty string if no trades that day).
- **Internal logic:**
  - Looks up `tradesByDate[dateStr]`; returns `''` if absent.
  - Pushes one 5px colored dot span per win (bull), loss (bear), BE (gold), and open (light blue with dark border).
  - Wraps all dots in a flex-wrap container if any exist, else returns `''`.
- **Calls:** (none)
- **Called by:** renderMiniCalendar, buildMonthHtml
- **Side effects:** None (pure string builder; reads closure variable `tradesByDate`).
- **Notes:** Defined as a nested function declaration inside `renderMiniCalendar`; not globally accessible.

#### buildMonthHtml(mo, moYr)

- **File:** Trade_Journal/index.html (lines 14993-15025)
- **Module:** Mini Calendar
- **Purpose:** Nested helper (inside `renderMiniCalendar`) that builds the HTML grid for one calendar month in the mini-calendar widget.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| mo | number | Zero-based month index (0-11) |
| moYr | number | Full year for that month |

- **Returns:** string (HTML fragment for the month block, including header and day grid).
- **Internal logic:**
  - Determines if `(mo, moYr)` is the current month (`isCurrentMonth`).
  - Computes `firstMon` — the Monday-aligned column offset for the 1st of the month (`(firstDow+6)%7` converts Sunday=0-based to Monday=0-based).
  - Emits blank leading cells for alignment, then one cell per day of the month: highlights today (inverted colors), else tints by trade outcome (win-only/loss-only/mixed) using `tradesByDate` lookup, dims past days' text color; embeds `dotHtml(dateStr)` per cell.
  - Wraps the day grid with a month/year header and weekday-letter row (`DAYS` = M T W T F S S).
- **Calls:** dotHtml
- **Called by:** renderMiniCalendar
- **Side effects:** None (pure string builder; reads closure variables `tradesByDate`, `curMo`, `curD`, `yr`).
- **Notes:** Nested function, only reachable from within `renderMiniCalendar`'s execution.

### Module: Screenshot Storage

#### compressImage(file, maxKB = 500)

- **File:** Trade_Journal/index.html (lines 15084-15127)
- **Module:** Screenshot Storage
- **Purpose:** Compresses an image File/Blob down to a target size ceiling by progressively lowering JPEG quality and, if still too large, scaling down pixel dimensions, using canvas re-encoding.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| file | File \| Blob | The source image to compress |
| maxKB | number (default 500) | Target maximum size in kilobytes |

- **Returns:** Promise<Blob> — the compressed image blob (or the original `file` on load/encode failure).
- **Internal logic:**
  - Computes `maxBytes = maxKB*1024`.
  - Loads `file` into an `Image` via an object URL.
  - On load: revokes the object URL, reads natural width/height, creates a canvas + 2D context.
  - Defines local `attempt(qIdx)`: draws the image onto the canvas at current `w`/`h` (with a white background fill first, to flatten transparency), encodes to JPEG at `qualities[qIdx]` (from `[0.85, 0.70, 0.55, 0.40]`, clamped to `0.40` if `qIdx` overflows).
  - In the `toBlob` callback: if `blob` is null, resolves with the original `file` (failure fallback); if the blob is within `maxBytes` OR all quality steps AND all 3 scale-passes are exhausted, resolves with that blob; else if more quality steps remain, recurses with `qIdx+1`; else (quality steps exhausted but scale passes remain) scales `w`/`h` down by 0.75× and restarts at `qIdx=0`.
  - On image load error: revokes the object URL and resolves with the original `file`.
- **Calls:** attempt (internal nested helper)
- **Called by:** addSsToOpenTrade, thAddScreenshots, readImg
- **Side effects:** Creates a temporary `<canvas>` element (not attached to DOM) and an object URL (revoked after use); no persistent DOM/global state changes.
- **Notes:** Quality ladder: 0.85 → 0.70 → 0.55 → 0.40, then up to 3 dimension-scaling passes at 0.75× each (so worst case ~0.42× original linear dimensions, ~0.18× area) before giving up and accepting whatever the last attempt produced. Silently falls back to the original uncompressed file on any image decode error, rather than throwing — callers should not assume the returned blob is always smaller than the input.

#### attempt(qIdx)

- **File:** Trade_Journal/index.html (lines 15099-15121)
- **Module:** Screenshot Storage
- **Purpose:** Nested recursive helper inside `compressImage` that performs one canvas-draw + JPEG-encode pass at a given quality index, recursing to lower quality or smaller dimensions as needed.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| qIdx | number | Index into the `qualities` array (0-3+) for this attempt |

- **Returns:** void (resolves the enclosing Promise via closure when a satisfactory blob is produced).
- **Internal logic:** See `compressImage` above — sets canvas dimensions, flattens transparency onto white, draws the image, encodes as JPEG at the given quality, and recurses/resolves based on size versus `maxBytes` and remaining quality/scale budget.
- **Calls:** (none directly — recurses into itself via closure)
- **Called by:** compressImage, computeRuleViolationAnalysis (per static analysis; note: `computeRuleViolationAnalysis` is defined elsewhere in the file and likely has its own separate locally-scoped `attempt` helper with the same name — the static analyzer may be conflating same-named nested functions across scopes)
- **Side effects:** Mutates the enclosing `canvas`'s width/height and draws to its 2D context (local, non-DOM-attached canvas).
- **Notes:** This is a nested/local function name (`attempt`) that likely appears more than once in the file under different enclosing functions; the "called by computeRuleViolationAnalysis" entry from the static analyzer should be read with that caveat — it may reference a different, identically-named nested helper rather than this exact one at lines 15099-15121.

#### uploadScreenshotToStorage(blob, tradeId, filename)

- **File:** Trade_Journal/index.html (lines 15136-15150)
- **Module:** Screenshot Storage
- **Purpose:** Uploads a compressed screenshot blob to the Supabase Storage `screenshots` bucket and generates a 7-day signed URL for immediate display.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| blob | Blob | Compressed image data (JPEG) |
| tradeId | string | ID of the trade/weekly this screenshot belongs to (or a `pending_<uuid>` placeholder) |
| filename | string | Original filename, used to build the storage path |

- **Returns:** Promise<{path, signedUrl} \| null> — object with the raw storage path and a signed URL on success, `null` on any failure or if no user is signed in.
- **Internal logic:**
  - Returns `null` immediately if `_currentUser` is not set.
  - Sanitizes `filename` (replacing non-alphanumeric/`._-` characters with `_`) and builds path `{userId}/{tradeId}/{timestamp}_{safeName}`.
  - Uploads via `_sb.storage.from('screenshots').upload(path, blob, {contentType:'image/jpeg', upsert:false})`; on error, logs a warning and returns `null`.
  - Requests a signed URL valid for 604800 seconds (7 days) via `createSignedUrl`; on error, logs and returns `null`.
  - Returns `{ path, signedUrl }`.
- **Calls:** (none beyond Supabase Storage SDK calls — `_sb.storage.from().upload()`, `.createSignedUrl()`)
- **Called by:** addSsToOpenTrade, thAddScreenshots, readImg
- **Side effects:** Supabase Storage write (upload to `screenshots` bucket); network call to Supabase.
- **Notes:** `upsert: false` means a path collision would fail the upload — but the timestamp+filename combination makes collisions extremely unlikely. The raw storage `path` (not the signed URL) is what callers persist to the database, since signed URLs expire after 7 days.

#### resolveStoragePath(path)

- **File:** Trade_Journal/index.html (lines 15154-15160)
- **Module:** Screenshot Storage
- **Purpose:** Generates a fresh 7-day signed URL for an existing Supabase Storage object path.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| path | string | Raw storage path (e.g. `"userId/tradeId/ts_file.jpg"`) |

- **Returns:** Promise<string \| null> — the signed URL, or `null` if `path`/`_currentUser` is missing or the request errors.
- **Internal logic:** Guards on falsy `path` or no `_currentUser`; calls `_sb.storage.from('screenshots').createSignedUrl(path, 604800)`; logs and returns `null` on error; otherwise returns `data.signedUrl` (or `null` if absent).
- **Calls:** (none beyond Supabase Storage SDK)
- **Called by:** resolveScreenshotForDisplay, _resolveDataUrls, downloadAllScreenshotBlobs
- **Side effects:** Network call to Supabase Storage (signed URL generation, no actual file transfer).
- **Notes:** Same 7-day expiry constant (604800s) as `uploadScreenshotToStorage`.

#### resolveScreenshotForDisplay(ss)

- **File:** Trade_Journal/index.html (lines 15169-15201)
- **Module:** Screenshot Storage
- **Purpose:** Resolves a screenshot record into something displayable in an `<img>` tag, using an IndexedDB blob cache to avoid re-downloading previously-viewed images, and transparently handling three legacy/format variants.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| ss | Object | A screenshot record with at least `{ dataUrl, _displayUrl? }` |

- **Returns:** Promise<Object> — the same `ss` (unchanged) for legacy formats, or a new object `{...ss, _displayUrl: <dataUrl>}` when resolved from a storage path.
- **Internal logic:**
  - Returns `ss` unchanged if it's falsy, has no `dataUrl`, if `dataUrl` already starts with `data:` (legacy base64 — used directly), if `ss._displayUrl` is already set (resolved earlier this session), or if `dataUrl` starts with `https://` (legacy pre-Phase1 signed URL, used as-is even though it may have expired).
  - Otherwise treats `dataUrl` as a raw storage path: checks `_ssDB.getBlob(storagePath)` (IndexedDB cache); if hit, returns `{...ss, _displayUrl: cached}` with zero network calls.
  - On cache miss: calls `resolveStoragePath` to get a signed URL, `fetch`es it, converts the response blob to a base64 data URL via `FileReader.readAsDataURL`, stores it in the IndexedDB cache via `_ssDB.setBlob(storagePath, dataUrl)`, and returns `{...ss, _displayUrl: dataUrl}`.
  - Any error (missing signed URL, failed fetch, exception) is caught, logged via `console.warn`, and the original `ss` is returned unchanged (display will show a broken image, but the app doesn't crash).
- **Calls:** getBlob (_ssDB.getBlob), resolveStoragePath, fetch, setBlob (_ssDB.setBlob)
- **Called by:** toggleWbScreenshots, toggleWbUpdateScreenshots, toggleNoteScreenshots, resolveTradeScreenshots, resolveWeeklyScreenshots
- **Side effects:** Reads/writes the `_ssDB` IndexedDB blob cache (keyed by storage path); may trigger a network fetch of the signed URL and the image bytes.
- **Notes:** Caching converts fetched blobs to base64 data URLs before storing (rather than storing raw Blobs), trading some storage overhead for simplicity when re-displaying via `<img src>`. The 3-way dispatch (base64 / storage-path / legacy-https) lets old data recorded before the storage-bucket migration keep working without a data-migration step.

#### resolveTradeScreenshots(t)

- **File:** Trade_Journal/index.html (lines 15205-15223)
- **Module:** Screenshot Storage
- **Purpose:** Resolves all screenshot arrays (main, EOD, follow-up, review, and trade-note screenshots) on a trade object in place, after loading from Supabase.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| t | Object | A trade record, potentially with `screenshots`, `eodScreenshots`, `followupScreenshots`, `reviewScreenshots`, `tradeNotes[].screenshots` arrays |

- **Returns:** Promise<Object> — the same trade object `t`, mutated in place, with each screenshot's array replaced by resolved entries.
- **Internal logic:**
  - For each of the 4 named screenshot-array fields, if present and non-empty, replaces it with `Promise.all(arr.map(resolveScreenshotForDisplay))`.
  - If `t.tradeNotes` exists, iterates each note and similarly resolves its `screenshots` array if present.
  - Returns `t`.
- **Calls:** resolveScreenshotForDisplay
- **Called by:** loadTradeScreenshots, loadTradeScreenshotsForOpen
- **Side effects:** Mutates the passed-in trade object `t`'s array fields in place; indirectly triggers IndexedDB reads/writes and possible network fetches via `resolveScreenshotForDisplay`.
- **Notes:** Runs each array's resolutions concurrently via `Promise.all`, but the 4 top-level arrays and the notes loop are processed sequentially (via `for...of` with `await`), not concurrently with each other.

#### resolveWeeklyScreenshots(w)

- **File:** Trade_Journal/index.html (lines 15226-15240)
- **Module:** Screenshot Storage
- **Purpose:** Resolves all screenshot arrays (main weekly screenshots and per-update screenshots) on a weekly-bias object in place.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| w | Object | A weekly-bias record, potentially with `screenshots` and `updates[].screenshots` |

- **Returns:** Promise<Object> — the same weekly object `w`, mutated in place.
- **Internal logic:**
  - If `w.screenshots` is non-empty, replaces it with resolved entries via `Promise.all`.
  - If `w.updates` exists, iterates each update and resolves its `screenshots` array if present.
  - Returns `w`.
- **Calls:** resolveScreenshotForDisplay
- **Called by:** (none detected — verify: likely called from a weekly-loading function elsewhere in the file, analogous to how `resolveTradeScreenshots` is called by `loadTradeScreenshots`/`loadTradeScreenshotsForOpen`; may simply not yet be wired up, or called from a chunk outside this file slice)
- **Side effects:** Mutates the passed-in weekly object `w`'s array fields in place; indirectly triggers IndexedDB reads/writes and possible network fetches.
- **Notes:** Structurally a direct analogue of `resolveTradeScreenshots` but for weekly-bias records instead of trades.

#### deleteScreenshotsFromStorage(urls)

- **File:** Trade_Journal/index.html (lines 15247-15272)
- **Module:** Screenshot Storage
- **Purpose:** Deletes a batch of screenshots from the Supabase Storage bucket, accepting a mix of raw storage paths, legacy signed URLs, or base64 data URIs (which are skipped since nothing needs deleting from storage for those).
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| urls | Array<string> | Screenshot `dataUrl` values to delete from storage |

- **Returns:** Promise<void>
- **Internal logic:**
  - Returns immediately if `urls` is empty/falsy.
  - Filters to non-empty strings, then maps each to a storage path: `data:` URIs map to `null` (nothing in storage, skip); `https://` URLs are parsed for the marker `/object/sign/screenshots/` or `/object/authenticated/screenshots/`, extracting the path after the marker and stripping any query string; anything else is assumed to already be a raw path and used as-is.
  - Filters out `null`s (from data URIs or unparseable URLs); if the resulting `paths` array is empty, returns early.
  - Calls `_sb.storage.from('screenshots').remove(paths)`; logs a warning on error (does not throw).
  - Evicts each deleted path from the `_ssDB` blob cache via `removeBlob`, individually catching (and swallowing) any per-path cache-eviction errors.
- **Calls:** filter, remove (_sb.storage...remove), removeBlob (_ssDB.removeBlob)
- **Called by:** deleteTradeSupa, deleteWeeklySupa, runArchiveDestructive
- **Side effects:** Supabase Storage delete (bulk remove); `_ssDB` IndexedDB cache eviction.
- **Notes:** Never throws even on storage errors — deletion failures are logged but not surfaced to the caller, so callers proceed with their own deletion flow regardless of whether the storage objects were actually removed (this could leave orphaned files in the bucket on error, but avoids blocking the primary delete operation on a secondary cleanup task).

### Module: Screenshot File Handling / UI

#### handleFileSelect(e, ctx)

- **File:** Trade_Journal/index.html (lines 15277-15280)
- **Module:** Screenshot File Handling / UI
- **Purpose:** Handles a file `<input>` `change` event, kicking off image processing for each selected file and resetting the input so the same file can be reselected later.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| e | Event | The file input `change` event |
| ctx | string | Context key identifying which screenshot slot this belongs to (e.g. `'idea'`, `'wb'`, `'intra'`) |

- **Returns:** void
- **Internal logic:** Converts `e.target.files` (a FileList) to an array and calls `readImg(f, ctx)` for each file; resets `e.target.value = ''` so re-selecting the same file re-triggers `change`.
- **Calls:** readImg
- **Called by:** (none detected via static call-graph — this is wired up via inline `onchange="handleFileSelect(event,'idea')"` etc. attributes on the various screenshot `<input type="file">` elements throughout the HTML)
- **Side effects:** Triggers async upload processing per file (via `readImg`); mutates the file input's value.
- **Notes:** The `ctx` string maps to specific screenshot arrays/grids inside `readImg`/`renderSsGrid`/`removeSS`/`setSsLabel` via a shared `ctxMap`/`map` lookup table (idea, cm, eoi, ec, tn, wb, wbn, intra).

#### _getUploadTradeId()

- **File:** Trade_Journal/index.html (lines 15282-15284)
- **Module:** Screenshot File Handling / UI
- **Purpose:** Returns the trade ID to associate uploaded screenshots with, falling back to a synthetic pending ID if no real trade exists yet.
- **Parameters:** None
- **Returns:** string — either the module-level `_pendingUploadTradeId`, or a newly generated `'pending_' + crypto.randomUUID()`.
- **Internal logic:** Simple `||` fallback expression.
- **Calls:** (none)
- **Called by:** readImg
- **Side effects:** None directly (reads global `_pendingUploadTradeId`; generates a random UUID when needed but does not persist it anywhere itself).
- **Notes:** Used when a screenshot is attached before the parent trade/weekly record has been saved (e.g. during the "new idea" form flow) — the storage path uses this placeholder ID until the real trade is created and (presumably, based on naming) later reconciled.

#### readImg(file, ctx)

- **File:** Trade_Journal/index.html (lines 15286-15345)
- **Module:** Screenshot File Handling / UI
- **Purpose:** Full pipeline for processing one selected screenshot file: shows an immediate uploading placeholder, compresses the image, uploads it to Supabase Storage, and falls back to embedding it as base64 if storage upload fails or errors.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| file | File | The selected image file |
| ctx | string | Context key (`'idea'`, `'cm'`, `'eoi'`, `'ec'`, `'tn'`, `'wb'`, `'wbn'`, `'intra'`) selecting which state array/grid to target |

- **Returns:** Promise<void>
- **Internal logic:**
  - Maps `ctx` to a human label (e.g. `'idea'` → `'Setup Chart'`) and to `[arrayName, gridElementId]` via lookup tables; returns early if `ctx` is unrecognized.
  - Immediately pushes a placeholder object (`{id, name, dataUrl:null, label, at, _uploading:true}`) onto `S[arr]` and calls `renderSsGrid` so the UI shows a spinner right away.
  - Tries: compress the image via `compressImage(file)`; get a trade ID via `_getUploadTradeId()`; upload via `uploadScreenshotToStorage(compressed, tradeId, file.name)`.
  - Finds the placeholder's current index in `S[arr]` by ID (re-lookup in case the array was mutated by user actions, e.g. deletion, during the async upload); if not found (user removed it while uploading), aborts silently.
  - On successful upload: replaces the placeholder entry with `{id, name, dataUrl: result.path, _displayUrl: result.signedUrl, label, at}` — the raw storage path is what gets persisted, the signed URL is for immediate rendering.
  - On upload failure (`result` is `null`): falls back to reading the file as a base64 data URL via `FileReader`, replaces the placeholder with a `dataUrl: base64` entry, and shows a warning toast ("Storage upload failed — saved locally as fallback").
  - On any thrown exception during the try block: catches it, logs a warning, and performs the same base64 fallback (without a toast in this branch).
  - Finally re-renders the grid via `renderSsGrid` regardless of outcome.
- **Calls:** renderSsGrid, compressImage, _getUploadTradeId, uploadScreenshotToStorage, showToast
- **Called by:** handleFileSelect
- **Side effects:** Mutates `S[arr]` (one of the screenshot state arrays, keyed by ctx); DOM mutation via `renderSsGrid` (targets `#ideaSsGrid`, `#cmSsGrid`, etc.); Supabase Storage upload; possible toast notification.
- **Notes:** The dual fallback (storage failure vs. thrown exception) both end up embedding base64 image data directly into the record — this keeps the screenshot usable even fully offline or when Supabase Storage is unreachable, at the cost of bloating the record size until it can later be re-uploaded (no evidence in this chunk of an automatic re-upload/backfill path).

#### renderSsGrid(gridId, arr, ctx)

- **File:** Trade_Journal/index.html (lines 15347-15372)
- **Module:** Screenshot File Handling / UI
- **Purpose:** Renders a grid of screenshot thumbnails (with upload-spinner state, timeframe-label dropdown or static label, delete button, and lightbox click handler) into a given container element.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| gridId | string | DOM element ID of the grid container |
| arr | Array<Object> | Screenshot records to render |
| ctx | string | Context key controlling which timeframe-label options to show and used in onclick handler args |

- **Returns:** void
- **Internal logic:**
  - Looks up the grid element by `gridId`; bails if missing.
  - For contexts in `['wb', 'wbn', 'intra', 'idea']`, screenshots get a `<select>` timeframe-label dropdown (`Weekly/Daily/4H/1H/15m/5m/Custom`) instead of a static label span.
  - For each screenshot: if `ss._uploading`, renders a spinner placeholder with a "CANCEL" button (calls `removeSS`); otherwise renders the thumbnail (`ss._displayUrl || ss.dataUrl`) with an `onclick="openLb(...)"` handler, the label/dropdown, and a "DELETE" button (calls `removeSS`).
  - Joins and sets `g.innerHTML`.
- **Calls:** removeSS, setSsLabel, openLb
- **Called by:** readImg, removeSS
- **Side effects:** DOM mutation of the element identified by `gridId`.
- **Notes:** Inline `onclick`/`onchange` handlers embed `i` (array index) and `ctx` directly into the generated HTML string, so `removeSS`/`setSsLabel`/`openLb` are invoked with string-interpolated arguments — indices must stay in sync with array order, which is why `renderSsGrid` is re-invoked after every mutation (add/remove/label-change).

#### setSsLabel(i, ctx, label)

- **File:** Trade_Journal/index.html (lines 15374-15380)
- **Module:** Screenshot File Handling / UI
- **Purpose:** Updates the timeframe label of a screenshot at a given index within its context-specific array.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| i | number | Index of the screenshot within its array |
| ctx | string | Context key mapping to a specific `S[arr]` array |
| label | string | New label value (e.g. `"4H Chart"`) |

- **Returns:** void
- **Internal logic:** Maps `ctx` to an array name via a lookup table; guards on the array or index not existing; sets `S[arr][i].label = label`.
- **Calls:** (none)
- **Called by:** renderSsGrid
- **Side effects:** Mutates `S[arr][i].label` in global state.
- **Notes:** Does not re-render the grid after changing the label (no visual feedback needed since it's a `<select>` already reflecting the chosen value); does not persist to Supabase directly — presumably persisted when the parent trade/weekly is saved.

#### removeSS(i, ctx)

- **File:** Trade_Journal/index.html (lines 15382-15397)
- **Module:** Screenshot File Handling / UI
- **Purpose:** Removes a screenshot at a given index from its context-specific in-memory array and re-renders the grid (used for both the "cancel upload" and "delete screenshot" buttons).
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| i | number | Index of the screenshot within its array |
| ctx | string | Context key mapping to `[arrayName, gridElementId]` |

- **Returns:** void
- **Internal logic:** Maps `ctx` to `[arr, grid]` via lookup table; returns early if unrecognized; splices out index `i` from `S[arr]`; calls `renderSsGrid(grid, S[arr], ctx)` to refresh the UI.
- **Calls:** renderSsGrid
- **Called by:** renderSsGrid
- **Side effects:** Mutates `S[arr]` (removes an element); DOM mutation via `renderSsGrid`.
- **Notes:** Does not call `deleteScreenshotsFromStorage` — this only removes the screenshot from the in-memory/pending array (used before the parent record is saved, or to cancel/undo locally); actual storage-bucket deletion for already-persisted screenshots is handled elsewhere (`deleteScreenshotsFromStorage`, invoked from trade/weekly deletion flows) when the whole record is deleted, or presumably by whatever save logic diffs the screenshot arrays before/after edit.

#### openLb(src)

- **File:** Trade_Journal/index.html (lines 15399-15400)
- **Module:** Screenshot File Handling / UI
- **Purpose:** Opens the image lightbox modal displaying the given image source.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| src | string | Image URL or data URI to display |

- **Returns:** void
- **Internal logic:** Sets `#lbImg`'s `src` attribute to `src`; adds the `'open'` class to `#lightbox`.
- **Calls:** (none)
- **Called by:** ssLazySection, toggleTradeScreenshots, toggleWbScreenshots, toggleWbUpdateScreenshots, toggleNoteScreenshots, openTradeHistory, ssBlock, thAddScreenshots, renderSsGrid
- **Side effects:** DOM mutation of `#lbImg` (src attribute) and `#lightbox` (class list).
- **Notes:** Widely used across many screenshot-display contexts throughout the app (trade cards, weekly bias, notes, trade history) as the single shared lightbox opener.

#### closeLightbox()

- **File:** Trade_Journal/index.html (line 15402)
- **Module:** Screenshot File Handling / UI
- **Purpose:** Closes the image lightbox modal.
- **Parameters:** None
- **Returns:** void
- **Internal logic:** Removes the `'open'` class from `#lightbox`.
- **Calls:** remove (classList.remove)
- **Called by:** (none detected via static call-graph — invoked via an inline `onclick="closeLightbox()"` on the lightbox's close button/overlay in the HTML)
- **Side effects:** DOM mutation of `#lightbox` (class list).
- **Notes:** One-line function; the counterpart to `openLb`.

### Module: Notes

#### renderNotes()

- **File:** Trade_Journal/index.html (lines 15405-15427)
- **Module:** Notes
- **Purpose:** Renders the list of freeform notes on the Notes tab, showing title, a stripped-HTML text preview (truncated to 120 chars), formatted date, and edit/delete controls.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Looks up `#notesContainer`; bails if missing.
  - If `S.notes` is empty, shows a placeholder "No notes yet…" message.
  - Otherwise maps each note to a card: formats `updatedAt`/`createdAt` as `DD Mon YYYY`; strips HTML tags from `body` and truncates to 120 characters for the preview, appending `…` if truncated; card is clickable (`onclick="openEditNoteModal(id)"`) with a delete button that stops propagation and calls `deleteNote(id)`.
  - Joins and sets `c.innerHTML`.
- **Calls:** openEditNoteModal, deleteNote
- **Called by:** loadAllData, navTo, saveNote, deleteNote
- **Side effects:** DOM mutation of `#notesContainer`.
- **Notes:** The HTML-stripping regex (`/<[^>]+>/g`) is a naive tag-stripper (does not decode entities like `&amp;`), used only for the preview text.

#### openNewNoteModal()

- **File:** Trade_Journal/index.html (lines 15429-15436)
- **Module:** Notes
- **Purpose:** Opens the note editor modal in "new note" mode with empty fields.
- **Parameters:** None
- **Returns:** void
- **Internal logic:** Clears `_editNoteId` to `null`; sets the modal title to "NEW NOTE"; clears the title input; clears the rich-text body via `rteSet('noteBody', '')`; adds the `'open'` class to `#noteModal`; after 100ms, focuses the title input.
- **Calls:** rteSet
- **Called by:** (none detected via static call-graph — invoked via an inline `onclick="openNewNoteModal()"` on the "+ NEW NOTE" button referenced in `renderNotes`'s empty-state hint text)
- **Side effects:** DOM mutation (`#noteModalTitle`, `#noteTitle`, note body rich-text editor, `#noteModal` class); mutates module-level `_editNoteId`.
- **Notes:** The 100ms focus delay allows the modal's CSS transition/display to complete before focusing, a common pattern used elsewhere in the file for modals.

#### openEditNoteModal(id)

- **File:** Trade_Journal/index.html (lines 15440-15449)
- **Module:** Notes
- **Purpose:** Opens the note editor modal pre-populated with an existing note's title and body for editing.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| id | string | ID of the note to edit |

- **Returns:** void
- **Internal logic:** Finds the note in `S.notes` via `idEq`; returns early if not found; sets `_editNoteId = id`; sets modal title to "EDIT NOTE"; populates the title input and rich-text body (`rteSet`); opens `#noteModal`; focuses the title input after 100ms.
- **Calls:** idEq, rteSet
- **Called by:** renderNotes
- **Side effects:** DOM mutation (`#noteModalTitle`, `#noteTitle`, rich-text editor, `#noteModal`); mutates module-level `_editNoteId`.
- **Notes:** Uses `idEq` rather than strict `===` for note ID lookup, consistent with the app's general handling of both legacy numeric IDs and UUID strings.

#### closeNoteModal()

- **File:** Trade_Journal/index.html (lines 15451-15454)
- **Module:** Notes
- **Purpose:** Closes the note editor modal and clears edit state.
- **Parameters:** None
- **Returns:** void
- **Internal logic:** Removes the `'open'` class from `#noteModal`; resets `_editNoteId = null`.
- **Calls:** remove (classList.remove)
- **Called by:** saveNote
- **Side effects:** DOM mutation (`#noteModal` class); mutates module-level `_editNoteId`.
- **Notes:** Also presumably invoked via an inline `onclick` on the modal's cancel/close button (not detected by static analysis since it only tracks JS-to-JS calls).

#### saveNote()

- **File:** Trade_Journal/index.html (lines 15456-15475)
- **Module:** Notes
- **Purpose:** Saves the note currently being edited (new or existing) from the modal form into `S.notes` and persists it to the database.
- **Parameters:** None
- **Returns:** Promise<void>
- **Internal logic:**
  - Reads and trims the title input value; reads the rich-text body via `rteGet('noteBody')`.
  - If both are empty, alerts "Add a title or content." and aborts.
  - If `_editNoteId` is set: finds the existing note via `idEq`, updates its `title`/`body`/`updatedAt`, and calls `saveNoteToDb(n)`.
  - Else: creates a new note object with a fresh `crypto.randomUUID()`, `createdAt`/`updatedAt` set to now, unshifts it onto the front of `S.notes`, and calls `saveNoteToDb(n)`.
  - Closes the modal (`closeNoteModal()`), re-renders the list (`renderNotes()`), and shows a "Note saved ✓" toast.
- **Calls:** rteGet, idEq, saveNoteToDb, closeNoteModal, renderNotes, showToast
- **Called by:** (none detected via static call-graph — invoked via an inline `onclick="saveNote()"` on the modal's Save button)
- **Side effects:** Mutates `S.notes` (update or unshift); Supabase write via `saveNoteToDb` (presumably an upsert into the `notes` table, defined elsewhere in the file); DOM mutation via `closeNoteModal`/`renderNotes`; toast notification.
- **Notes:** New notes are inserted at the front of the array (`unshift`) so they appear first in the rendered list without needing an explicit sort — implies `S.notes` is otherwise expected to remain in reverse-chronological order.

#### deleteNote(id)

- **File:** Trade_Journal/index.html (lines 15477-15482)
- **Module:** Notes
- **Purpose:** Deletes a note after user confirmation, both from local state and the database.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| id | string | ID of the note to delete |

- **Returns:** Promise<void>
- **Internal logic:** Shows a native `confirm('Delete this note?')` dialog; aborts if declined; filters the note out of `S.notes` (using strict `!==` comparison, not `idEq`); calls `deleteNoteFromDb(id)`; re-renders via `renderNotes()`.
- **Calls:** filter, deleteNoteFromDb, renderNotes
- **Called by:** renderNotes
- **Side effects:** Mutates `S.notes` (removes an element); Supabase delete via `deleteNoteFromDb` (table `notes`, defined elsewhere); DOM mutation via `renderNotes`; blocks on a native browser confirm dialog.
- **Notes:** Uses `n.id !== id` (strict inequality) rather than the `idEq` helper used elsewhere for ID comparison — a minor inconsistency; could behave differently than `idEq` if IDs are of mixed numeric/string type (e.g. `1 !== "1"` would fail to filter out a match), though notes IDs are always `crypto.randomUUID()` strings per `saveNote`, so this is unlikely to cause an actual bug in practice.

### Module: Excel Export

#### exportExcel()

- **File:** Trade_Journal/index.html (lines 15485-15531)
- **Module:** Excel Export
- **Purpose:** Exports all closed non-intraday trades to an `.xlsx` workbook with a Summary sheet (headline stats) and a Trade Log sheet (per-trade rows), using the SheetJS (`XLSX`) library.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Filters `S.trades` for `status==='closed' && !isIntraday`; alerts "No closed trades to export." and aborts if empty.
  - Builds column headers and, for each trade, a row array: date, pair, session, formatted display score (`deriveDisplayScore`), display grade (`deriveDisplayGrade`), bias-set, bias-played, bias-match, result, R (via `calcR`, formatted to 2 decimals), TP1R/TP1.5R flags, entry/close/SL prices, close notes (falling back to idea notes), follow-up notes.
  - Computes summary stats: win rate, bias accuracy percentage, total R (sum of all valid `calcR` values), TP1R/TP1.5R hit counts, open-trade count.
  - Builds a `Summary` sheet as an array-of-arrays (title, blank row, metric/value pairs) and a `Trade Log` sheet from headers+rows, both via `XLSX.utils.aoa_to_sheet`.
  - Appends both sheets to a new workbook (`XLSX.utils.book_new()`) and triggers a file download via `XLSX.writeFile(wb, 'ICT_Journal_<date>.xlsx')`.
- **Calls:** filter, calcR, deriveDisplayScore, deriveDisplayGrade
- **Called by:** (none detected via static call-graph — invoked via an inline `onclick="exportExcel()"` on an Export button in the Settings or Journal UI)
- **Side effects:** Triggers a browser file download (client-side, no network call); reads `S.trades`.
- **Notes:** Filename embeds today's date via `new Date().toISOString().split('T')[0]` (UTC date, not local) — could be off by one day near midnight in some timezones relative to what the user perceives as "today."

### Module: Intraday Link Modal

#### openIntraForTrade(tradeId)

- **File:** Trade_Journal/index.html (lines 15534-15572)
- **Module:** Intraday Link Modal
- **Purpose:** Opens the "Intraday Idea" linking modal for a given (non-intraday) trade, listing all matching open intraday ideas for the same pair so the user can link one and/or pull its prices onto the parent trade.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| tradeId | string | ID of the parent (weekly/daily-bias level) trade |

- **Returns:** void
- **Internal logic:**
  - Finds the trade via `idEq`; returns early if not found.
  - Sets `S.intraLinkTradeId = tradeId`; populates the modal title and context line (pair, date, session, grade via `deriveDisplayGrade`).
  - Filters `S.trades` for open intraday trades matching the same pair (case-insensitive, trimmed comparison).
  - If none found, shows a "No intraday ideas found for {pair}" placeholder.
  - Otherwise, for each matching intraday trade, renders a card showing pair/session/date, a "✓ LINKED" badge if `idEq(it.weeklyLinkId, tradeId)` already matches, a score pill (`tradeScorePill`), entry/SL/TP prices, a truncated idea-notes preview, and action buttons: "LINK + USE PRICES" (calls `linkAndPullIntra`, hidden if already linked) and "↓ USE PRICES ONLY" (calls `pullPricesFromIntra`, shown only if entry or SL price exists).
  - Opens `#intraLinkModal`.
- **Calls:** idEq, deriveDisplayGrade, filter, tradeScorePill, linkAndPullIntra, pullPricesFromIntra
- **Called by:** renderOpen, tradeCard
- **Side effects:** DOM mutation (`#intraLinkTitle`, `#intraLinkCtxText`, `#intraLinkExistingList`, `#intraLinkModal`); mutates global `S.intraLinkTradeId`.
- **Notes:** The generated HTML embeds `tradeId`/`it.id` directly into `onclick` attribute strings for `linkAndPullIntra`/`pullPricesFromIntra`, so those IDs must not contain characters that would break out of the single-quoted string context (acceptable given IDs are UUIDs or numeric).

#### linkAndPullIntra(tradeId, intraId)

- **File:** Trade_Journal/index.html (lines 15574-15580)
- **Module:** Intraday Link Modal
- **Purpose:** Links an intraday trade to a parent trade (setting its `weeklyLinkId`) and immediately pulls the intraday trade's prices onto the parent.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| tradeId | string | Parent trade ID |
| intraId | string | Intraday trade ID to link |

- **Returns:** void
- **Internal logic:** Finds the intraday trade via `idEq`; returns early if not found; sets `it.weeklyLinkId = tradeId`; calls `saveTrade(it)` to persist the link; calls `pullPricesFromIntra(tradeId, intraId)` to copy prices onto the parent.
- **Calls:** idEq, saveTrade, pullPricesFromIntra
- **Called by:** openIntraForTrade
- **Side effects:** Mutates the intraday trade object (`weeklyLinkId`); Supabase write via `saveTrade` (table `trades`); triggers further mutation/save via `pullPricesFromIntra`.
- **Notes:** None beyond the above.

#### pullPricesFromIntra(tradeId, intraId)

- **File:** Trade_Journal/index.html (lines 15582-15604)
- **Module:** Intraday Link Modal
- **Purpose:** Copies entry/SL/TP/lot-size prices from an intraday trade onto its linked parent trade, without necessarily changing the link itself.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| tradeId | string | Parent trade ID to update |
| intraId | string | Source intraday trade ID to copy prices from |

- **Returns:** void
- **Internal logic:**
  - Finds both the parent (`t`) and intraday (`it`) trades via `idEq`; returns early if either is missing.
  - For each of `entryPrice`, `slPrice`, `tpPrice`, `lotSize`: if the intraday value is non-null, copies it onto the parent and sets `updated = true`.
  - If any field was updated: calls `saveTrade(t)`, closes `#intraLinkModal`, re-renders via `renderOpen()`, and shows a "✓ Prices pulled from intraday idea" toast.
  - If nothing was updated (intraday trade had no prices set): shows a "No prices set on intraday idea yet" warning toast instead.
- **Calls:** idEq, saveTrade, remove (classList.remove on modal), renderOpen, showToast
- **Called by:** renderOpen, tradeCard, openIntraForTrade, linkAndPullIntra
- **Side effects:** Mutates the parent trade object's price fields; Supabase write via `saveTrade`; DOM mutation (`#intraLinkModal` class, plus whatever `renderOpen` redraws); toast notification.
- **Notes:** Uses `!= null` checks (loose), so `0` is treated as a valid price value (not skipped), but empty string and `undefined`/`null` are skipped.

#### goNewIntradayForTrade()

- **File:** Trade_Journal/index.html (lines 15606-15612)
- **Module:** Intraday Link Modal
- **Purpose:** Closes the intraday-link modal and navigates to the Intraday tab's "new entry" form, pre-linked to the current parent trade.
- **Parameters:** None
- **Returns:** void
- **Internal logic:** Reads `S.intraLinkTradeId` into `tradeId`; closes `#intraLinkModal`; stores `tradeId` into `S._pendingIntraLink` (to be picked up by the intraday form on load); sets `S.intradayView = 'form'`; navigates via `navTo('intraday')`.
- **Calls:** remove (classList.remove), navTo
- **Called by:** (none detected via static call-graph — invoked via an inline `onclick="goNewIntradayForTrade()"` button in the intraday-link modal, shown alongside/instead of the existing-ideas list in `openIntraForTrade`)
- **Side effects:** DOM mutation (`#intraLinkModal` class); mutates `S._pendingIntraLink`, `S.intradayView`; triggers navigation (and downstream rendering) via `navTo`.
- **Notes:** The "pending intra link" pattern lets the new intraday form (defined elsewhere) auto-associate the newly created trade with the parent without needing this function to pass data through `navTo`'s parameters.

### Module: Trade Note Modal

#### openTradeNoteModal(id)

- **File:** Trade_Journal/index.html (lines 15615-15625)
- **Module:** Trade Note Modal
- **Purpose:** Opens the modal for adding a freeform note (with optional screenshots) to a specific open trade.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| id | string | ID of the trade to attach the note to |

- **Returns:** void
- **Internal logic:** Finds the trade via `idEq`; returns early if not found; sets `S.tradeNoteEditId = id`; sets module-level `_pendingUploadTradeId = id` (so screenshot uploads within the modal associate with this trade); clears `S.tnSS` (trade-note screenshot staging array); sets modal title to "ADD NOTE — {pair}"; clears the rich-text note body (`rteSet`); clears the screenshot grid HTML; opens `#tradeNoteModal`.
- **Calls:** idEq, rteSet
- **Called by:** renderOpen, tradeCard
- **Side effects:** DOM mutation (`#tradeNoteTitle`, rich-text editor, `#tradeNoteSsGrid`, `#tradeNoteModal`); mutates `S.tradeNoteEditId`, `S.tnSS`, and module-level `_pendingUploadTradeId`.
- **Notes:** Setting `_pendingUploadTradeId` here is what makes `_getUploadTradeId()` (used by `readImg`) attach uploads to the correct real trade ID instead of falling back to a synthetic `pending_` placeholder.

#### saveTradeNote()

- **File:** Trade_Journal/index.html (lines 15627-15641)
- **Module:** Trade Note Modal
- **Purpose:** Saves the note (text + any attached screenshots) currently being composed in the trade-note modal onto the target trade's `tradeNotes` array.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Finds the trade via `idEq(t.id, S.tradeNoteEditId)`; returns early if not found.
  - Reads and trims the rich-text note body (`rteGet('tradeNoteText')`).
  - If both the text is empty and `S.tnSS` (staged screenshots) is empty, alerts "Add a note or screenshot." and aborts.
  - If any staged screenshot is still `_uploading`, shows a "Screenshot still uploading — please wait" warning toast and aborts (prevents saving a note referencing an incomplete/placeholder screenshot).
  - Initializes `t.tradeNotes` to `[]` if absent; pushes `{ text, screenshots: [...S.tnSS], at: new Date().toISOString() }`.
  - Calls `saveTrade(t)`; closes `#tradeNoteModal`; clears `S.tradeNoteEditId` and `S.tnSS`; re-renders via `renderOpen()`; shows a "Note added ✓" toast.
- **Calls:** idEq, rteGet, showToast, saveTrade, remove (classList.remove), renderOpen
- **Called by:** (none detected via static call-graph — invoked via an inline `onclick="saveTradeNote()"` on the modal's Save button)
- **Side effects:** Mutates the trade's `tradeNotes` array; Supabase write via `saveTrade`; DOM mutation (`#tradeNoteModal` class, plus `renderOpen`'s redraw); mutates `S.tradeNoteEditId`, `S.tnSS`; toast notifications.
- **Notes:** The uploading-guard check prevents a race condition where a note could be saved referencing a screenshot placeholder that later resolves to a different final object — forcing the user to wait for uploads to finish first.

### Module: Trade Score / Share

#### tradeScorePill(t, extraStyle)

- **File:** Trade_Journal/index.html (lines 15643-15671)
- **Module:** Trade Score / Share
- **Purpose:** Builds a small HTML "pill" badge summarizing a trade's grade/state, dispatching to the correct scoring engine based on whether the trade is a weekly/daily-bias entry (HTF or TTrades checklist model) or an intraday execution (derived score/grade).
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| t | Object | Trade record |
| extraStyle | string | Additional inline CSS to merge into the pill's `style` attribute |

- **Returns:** string — HTML `<span>` pill markup, or `''` if no applicable grade/result exists.
- **Internal logic:**
  - Determines `model = t.checklistModel || 'omar'`.
  - If non-intraday and model is `'omar'`: runs `runHTFEngine(t.checklistAnswers||{})`; if no result, returns `''`; otherwise derives a grade-class via `gradeClass(env.env)` and returns a pill showing `env.envLabel`, with a `title` tooltip showing the HTF meta label.
  - If non-intraday and model is `'ttrades'`: runs `runTTEngine(...)`; if no result, returns `''`; maps the engine's `state` (e.g. `bullish_expansion`, `range`) to a pill grade-class via an inline lookup table (defaulting to `'none'`); returns a pill showing the meta label.
  - Otherwise (intraday trades): uses `deriveDisplayGrade(t)` — returns `''` if `'N/A'` or falsy; gets grade-class via `deriveDisplayGradeClass(t)` and numeric score via `deriveDisplayScore(t)`; returns a pill showing the grade label plus `" — {score}/100"` if a score exists.
- **Calls:** runHTFEngine, gradeClass, runTTEngine, deriveDisplayGrade, deriveDisplayGradeClass, deriveDisplayScore
- **Called by:** openIntraForTrade (per static analysis; also referenced inline within its own generated markup and by other card-rendering functions elsewhere in the file, e.g. trade-card renderers, based on widespread `tradeScorePill(...)` usage patterns visible in this chunk)
- **Side effects:** None (pure function — builds and returns an HTML string; no DOM/network/state mutation).
- **Notes:** This is the single shared "grade badge" renderer used across weekly-bias, daily-bias (HTF/TTrades checklist models), and intraday trade views — the branching logic means the same function produces semantically different labels (environment label vs. TTrades state label vs. numeric-score grade) depending on trade type.

#### shareOpenTrade(id)

- **File:** Trade_Journal/index.html (lines 15673-15745)
- **Module:** Trade Score / Share
- **Purpose:** Builds a shareable plain-text summary (plus attached screenshot files where possible) of an open trade — including any linked open intraday executions — and invokes the Web Share API (falling back to clipboard copy).
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| id | string | ID of the (open, non-intraday) trade to share |

- **Returns:** Promise<void>
- **Internal logic:**
  - Finds the trade via `idEq`; returns early if not found.
  - Finds linked open intraday executions (`isIntraday && idEq(it.weeklyLinkId, t.id) && status==='open'`).
  - Loads screenshots for the trade and each linked intraday trade via `loadTradeScreenshots` (awaited in parallel via `Promise.all`).
  - Builds a text report: header line (pair, direction derived from `biasSet` — BULLISH→BUY, BEARISH→SELL, else `tradeType`, and date), bias/grade/played-vs-matched summary lines, parent price lines (only shown if there are no linked intraday trades — otherwise prices are assumed to live on the intraday sub-sections), idea/update notes (HTML-stripped via `stripHtml`), and up to the last 2 trade notes.
  - For each linked intraday trade, appends a labeled "INTRADAY EXECUTION" section with its own grade line, price fields, idea notes, and up to 2 notes.
  - Collects all screenshot arrays (parent + intraday `screenshots`/`eodScreenshots`) that are base64 data URLs (`.startsWith('data:')`) and converts them to `File` objects via `dataUrlToFile` for native sharing (signed-URL/storage-path screenshots are excluded from the share since they can't be embedded as files without an extra fetch).
  - Attempts `navigator.share({title, text, files})` if supported and `canShare` approves the files; on failure, retries `navigator.share({title, text})` without files; if `navigator.share` isn't available at all but `navigator.clipboard` is, copies the text and shows a "✓ Copied to clipboard" toast.
- **Calls:** idEq, filter, loadTradeScreenshots, deriveDisplayGrade, deriveDisplayScore, stripHtml, dataUrlToFile, showToast
- **Called by:** renderOpen, tradeCard
- **Side effects:** Network read via `loadTradeScreenshots` (Supabase/storage); invokes the OS-level Web Share sheet or writes to the system clipboard; toast notification on clipboard fallback.
- **Notes:** Only base64-embedded screenshots can be attached as shareable files — screenshots still referenced only by storage path/signed URL (not yet resolved to a data URL in memory) are silently excluded from the shared files, though their existence doesn't block the text-only share.

#### shareClosedTrade(id)

- **File:** Trade_Journal/index.html (lines 15747-15827)
- **Module:** Trade Score / Share
- **Purpose:** Builds a shareable plain-text summary (plus screenshot files where possible) of a closed trade — including its full plan, linked intraday executions with their post-trade review scores, and post-trade notes — and invokes the Web Share API (falling back to clipboard copy).
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| id | string | ID of the closed trade to share |

- **Returns:** Promise<void>
- **Internal logic:**
  - Finds the trade via `idEq`; returns early if not found.
  - Finds all linked intraday trades (`isIntraday && idEq(it.weeklyLinkId, t.id)`, any status — unlike `shareOpenTrade` which only includes open intraday trades).
  - Loads screenshots for the parent and each linked intraday trade in parallel.
  - Builds a result-header line (pair, date, grade, `Result: {t.result} {rStr}` where `rStr` comes from `calcR(t)`), bias/played lines, then a "📋 PLAN — PRE-MARKET IDEA" section with session/direction/entry/close/SL/TP/TP1R/TP1.5R fields and idea/update notes.
  - For each linked intraday trade: appends an "⚡ EXECUTION — INTRADAY SETUP" section with grade+decision line, price fields, execution notes; if the intraday trade is closed and has `intraScores`, appends a "📊 POST-TRADE REVIEW — HIDDEN ANALYTICS" block showing context/setup/exec sub-scores and the final score+grade+explanation.
  - Appends the parent's `closeNotes` as "POST-TRADE NOTES" if present.
  - Collects base64 screenshot files (parent + intraday `screenshots`/`eodScreenshots`) via `dataUrlToFile`, same pattern as `shareOpenTrade`.
  - Same Web Share API / clipboard fallback dispatch as `shareOpenTrade`.
- **Calls:** idEq, filter, loadTradeScreenshots, deriveDisplayGrade, deriveDisplayScore, calcR, stripHtml, dataUrlToFile, showToast
- **Called by:** renderClosed
- **Side effects:** Network read via `loadTradeScreenshots`; invokes Web Share API or clipboard write; toast notification on clipboard fallback.
- **Notes:** Exposes the "hidden analytics" (context/setup/exec sub-scores) in the shared text for closed intraday trades — this internal scoring breakdown is otherwise not shown prominently in the main UI (per the "HIDDEN ANALYTICS" label), making the share feature a way to surface that detail.

#### dataUrlToFile(dataUrl, filename)

- **File:** Trade_Journal/index.html (lines 15829-15838)
- **Module:** Trade Score / Share
- **Purpose:** Converts a base64 `data:` URL into a `File` object suitable for the Web Share API's `files` array.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| dataUrl | string | A `data:<mime>;base64,<data>` URI |
| filename | string | Desired filename for the resulting File |

- **Returns:** File — constructed from the decoded binary data.
- **Internal logic:** Splits the data URL on `,` to separate the header and base64 payload; extracts the MIME type via regex on the header (defaulting to `'image/png'` if unmatched); decodes the base64 payload with `atob`; converts the resulting binary string into a `Uint8Array` byte-by-byte; constructs and returns a `File` from that byte array with the given filename and MIME type.
- **Calls:** (none — uses only built-in `atob`, `Uint8Array`, `File`)
- **Called by:** shareOpenTrade, shareClosedTrade
- **Side effects:** None (pure transformation; no DOM/network/state mutation).
- **Notes:** The byte-copy loop (`while(n--) u8[n]=bstr.charCodeAt(n)`) is a standard/idiomatic base64-to-Uint8Array decode pattern.

#### stripHtml(html)

- **File:** Trade_Journal/index.html (lines 15840-15844)
- **Module:** Trade Score / Share
- **Purpose:** Converts a rich-text HTML string into plain text suitable for embedding in shared/exported text, converting `<br>` tags to newlines, stripping other tags, and decoding a small set of common HTML entities.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| html | string | Rich-text HTML content (e.g. from the app's RTE fields) |

- **Returns:** string — plain text, trimmed of leading/trailing whitespace; empty string if `html` is falsy.
- **Internal logic:** Chains `.replace()` calls: `<br>`/`<br/>` (case-insensitive, optional self-close) → `\n`; strips all remaining tags (`<[^>]+>` → `''`); decodes `&nbsp;` → space, `&amp;` → `&`, `&lt;` → `<`, `&gt;` → `>`; finally `.trim()`.
- **Calls:** (none)
- **Called by:** shareOpenTrade, shareClosedTrade
- **Side effects:** None (pure function).
- **Notes:** Only decodes 4 named entities (`nbsp`, `amp`, `lt`, `gt`) — other HTML entities (e.g. `&quot;`, numeric entities like `&#39;`) would pass through undecoded into the shared text. Entity decoding order matters: `&amp;` is decoded after `&lt;`/`&gt;` would need to be decoded from already-unescaped `&`, but here `&amp;`→`&` runs before `&lt;`→`<`/`&gt;`→`>`, which is the correct order to avoid double-unescaping (e.g. `&amp;lt;` correctly becomes `&lt;` then is not further collapsed to `<`, since it only chains once per replace call — actually since `.replace(/&amp;/g,'&')` runs first, `&amp;lt;` would become `&lt;`, and then the subsequent `.replace(/&lt;/g,'<')` call would incorrectly further decode it to `<`; this is a minor, unlikely-to-matter double-decode edge case for doubly-escaped input).

#### formatTsWithNY(iso)

- **File:** Trade_Journal/index.html (lines 15848-15853)
- **Module:** Trade Score / Share
- **Purpose:** Formats an ISO timestamp string as a local date/time plus the corresponding New York time, for display on notes/updates (e.g. `"08 Jul 17:07 / 07:37"`).
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| iso | string | ISO 8601 timestamp string |

- **Returns:** string — `"{local date/time} / {NY time}"`.
- **Internal logic:** Parses `iso` into a `Date`; formats the main part using `toLocaleDateString('en-GB', {day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit'})` (device's local timezone); formats the NY time using `toLocaleTimeString('en-US', {timeZone:'America/New_York', hour:'2-digit', minute:'2-digit', hour12:false})`; concatenates with `" / "`.
- **Calls:** (none — uses only built-in `Date`/`Intl` formatting)
- **Called by:** renderWeekly, renderOpen, tradeCard, openTradeHistory, timelineHtml
- **Side effects:** None (pure function).
- **Notes:** NY time is always shown in 24-hour format (`hour12:false`) regardless of the local-time format's default (which uses `en-GB` conventions, typically 24-hour as well, though `2-digit` hour without `hour12` explicitly set could still follow locale defaults — the NY side is explicit to guarantee a consistent, unambiguous 24-hour trading-session reference time).

### Module: Settings

#### populateSettingsPage()

- **File:** Trade_Journal/index.html (lines 15856-15906)
- **Module:** Settings
- **Purpose:** Populates the Settings tab: app version, Discord channel rows, user email/device ID, live Supabase connection status check, last-sync timestamp, screenshot cache info, archive info, Gemini API key status, and EBP (external signals) worker config fields.
- **Parameters:** None
- **Returns:** Promise<void>
- **Internal logic:**
  - Sets `#aboutVersion` to `APP_VERSION + ' · ' + APP_VERSION_DATE`.
  - Calls `DC.renderChannelRows()` (Discord channel config UI, defined elsewhere).
  - Sets `#settingsUserEmail` to `_currentUser?.email` and `#settingsDeviceId` to `DEVICE_ID`.
  - Sets `#settingsDbStatus` to "Checking…", then queries `_sb.from('sync_meta').select('last_modified,last_device').eq('user_id', _currentUser.id).maybeSingle()`.
  - On success: sets the status dot to "on" (green, 10x10px), status text to "Connected to Supabase", detail to the user's email; if `data.last_modified` exists, formats it and appends "(this device)" or "(other device)" depending on whether `data.last_device === DEVICE_ID`.
  - On error (thrown or Supabase error): sets the dot to "off", status to "Connection error", detail to the error message.
  - Calls `refreshSsCacheInfo()` and `populateArchiveInfo()` (screenshot cache stats and archive stats, defined elsewhere).
  - Populates the Gemini API key input from `localStorage.getItem('ict_gemini_key_'+_currentUser.id)` and calls `_updateGeminiKeyStatus()`.
  - Populates EBP worker URL/secret inputs from `localStorage.getItem('ict_ebp_worker_url'/'ict_ebp_secret')`.
- **Calls:** refreshSsCacheInfo, populateArchiveInfo, _updateGeminiKeyStatus
- **Called by:** navTo, settingsForceSync
- **Side effects:** DOM mutation across ~10 settings-page elements; Supabase read (`sync_meta` table, single row scoped to `user_id`); reads `localStorage` keys `ict_gemini_key_<userId>`, `ict_ebp_worker_url`, `ict_ebp_secret`.
- **Notes:** The "this device" vs "other device" indicator is derived by comparing the DB's `last_device` value against this browser's persisted `DEVICE_ID` (from `localStorage`'s `ict_device_id`, per global context), letting users tell whether their most recent sync came from this device or another one.

#### initPnlPage()

- **File:** Trade_Journal/index.html (lines 15908-15928)
- **Module:** Settings
- **Purpose:** Initializes the embedded P&L dashboard iframe page, wiring up the iframe `src`, topbar URL display, and open-in-new-tab buttons — or showing a fallback message if no P&L URL is configured.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Reads `CONFIG.PNL_URL`, stripping any trailing slash.
  - If no URL configured: hides the iframe (`#pnlFrame`), shows the fallback block (`#pnlFallback`), sets the topbar URL text to "Not configured", and clears the fallback link's and open button's onclick handlers.
  - Otherwise: ensures the URL ends with exactly one trailing slash (`fullUrl`); sets the iframe's `src` and makes it visible; sets the topbar text to the URL with the `https://` prefix stripped; wires both the "open" button and the fallback link to `window.open(fullUrl, '_blank')`.
- **Calls:** open (window.open)
- **Called by:** navTo
- **Side effects:** DOM mutation (`#pnlFrame` src/display, `#pnlTopbarUrl` text, `#pnlOpenBtn`/`#pnlFallbackLink` onclick handlers, `#pnlFallback` display); may open a new browser tab/window when the user later clicks the button (not immediately on call).
- **Notes:** `CONFIG.PNL_URL` is a separately configured external P&L-tracking site URL (not part of the Supabase/Cloudflare config mentioned in the global context) — embedded via iframe when set.

### Module: AI Review / Gemini

#### _geminiKey()

- **File:** Trade_Journal/index.html (lines 15934-15937)
- **Module:** AI Review / Gemini
- **Purpose:** Retrieves the current user's saved Gemini API key from `localStorage`.
- **Parameters:** None
- **Returns:** string \| null — the stored key, or `null` if no user is signed in or no key is saved.
- **Internal logic:** Returns `null` if `_currentUser` is falsy; otherwise returns `localStorage.getItem('ict_gemini_key_'+_currentUser.id) || null`.
- **Calls:** (none)
- **Called by:** saveWeeklyReview, saveClosure, _updateGeminiKeyStatus, callGeminiVision, renderTradeAiReviewBlock, renderWeeklyAiReviewBlock
- **Side effects:** Reads `localStorage` key `ict_gemini_key_<userId>`.
- **Notes:** The key is scoped per-user (keyed by `_currentUser.id`) so switching accounts on the same device doesn't leak one user's key to another; this is the single choke point every Gemini-calling function goes through to obtain the key, per its wide set of callers.

#### saveGeminiKey()

- **File:** Trade_Journal/index.html (lines 15939-15945)
- **Module:** AI Review / Gemini
- **Purpose:** Saves (or clears) the user's Gemini API key from the Settings-page input field into `localStorage`.
- **Parameters:** None
- **Returns:** void
- **Internal logic:** Returns early if no `_currentUser`; reads and trims `#geminiKeyInput`'s value; if non-empty, stores it via `localStorage.setItem('ict_gemini_key_'+_currentUser.id, val)`; if empty, removes the key via `localStorage.removeItem(...)`; calls `_updateGeminiKeyStatus()` to refresh the status label.
- **Calls:** _updateGeminiKeyStatus
- **Called by:** (none detected via static call-graph — invoked via an inline `onclick="saveGeminiKey()"` on the Settings page's "Save Key" button next to the Gemini API key input)
- **Side effects:** Writes or removes `localStorage` key `ict_gemini_key_<userId>`; DOM mutation via `_updateGeminiKeyStatus` (updates `#geminiKeyStatus` text/color).
- **Notes:** An empty/whitespace-only input clears the stored key rather than saving an empty string, which correctly makes `_geminiKey()` subsequently return `null` (falls through the `|| null` in `_geminiKey`, and also because `getItem` returns `null` for a removed key) rather than a falsy-but-present empty string.


---

## Trade_Journal — Functions (chunk 5 of 8, lines 15947-17891)

### Module: AI Review — Gemini Integration

#### _updateGeminiKeyStatus()

- **File:** Trade_Journal/index.html (lines 15947-15952)
- **Module:** AI Review — Gemini Integration
- **Purpose:** Updates the Settings-page status text to reflect whether a Gemini API key is currently configured for AI trade/weekly reviews.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Looks up `#geminiKeyStatus`; returns silently if the element isn't in the DOM (e.g. not on Settings page).
  - Calls `_geminiKey()` to check whether a key is stored.
  - Sets `textContent` to `'✓ Key saved'` or `'No key set'`.
  - Sets `style.color` to `var(--bull)` if a key exists, `var(--muted)` otherwise.
- **Calls:** _geminiKey
- **Called by:** populateSettingsPage, saveGeminiKey
- **Side effects:** DOM mutation on `#geminiKeyStatus` (textContent, color).
- **Notes:** Pure UI-sync helper; no-ops gracefully when the element is absent.

#### _aiScoreBar(score, max)

- **File:** Trade_Journal/index.html (lines 15954-15958)
- **Module:** AI Review — Gemini Integration
- **Purpose:** Builds a small inline HTML bar visualizing `score/max` as a percentage-filled bar, used next to AI review scores.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| score | number\|null\|'' | The score to visualize |
| max | number | The maximum possible score (denominator) |

- **Returns:** string (HTML) — empty string `''` if score is null/empty.
- **Internal logic:**
  - Guard: returns `''` if `score` is `null` or `''`.
  - Computes `pct = min(100, round(score/max*100))`.
  - Returns `<span class="ai-score-bar"><span class="ai-score-bar-fill" style="width:{pct}%"></span></span>`.
- **Calls:** (none)
- **Called by:** renderTradeAiReviewBlock, renderWeeklyAiReviewBlock
- **Side effects:** none (pure string builder).
- **Notes:** Fill percentage is capped at 100% even if `score > max`.

#### callGeminiVision(promptText, imageDataUrls)

- **File:** Trade_Journal/index.html (lines 15960-15994)
- **Module:** AI Review — Gemini Integration
- **Purpose:** Calls Google's Gemini `generateContent` API (model `gemini-2.0-flash-lite`) with a text prompt plus inline base64 images, retrying on HTTP 429 rate limits.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| promptText | string | The text prompt to send |
| imageDataUrls | string[] | Data URLs (or https URLs, which are skipped) of images to attach |

- **Returns:** Promise<string> — the model's text response (or `''` if missing); throws on unrecoverable error.
- **Internal logic:**
  - Reads the API key via `_geminiKey()`; throws `'No Gemini API key set'` if absent.
  - Builds a `parts` array starting with `{text: promptText}`.
  - For each `dataUrl`: skips falsy values and any starting with `'https://'` (can't be inlined); otherwise regex-parses `data:<mime>;base64,<data>` and pushes `{inline_data:{mime_type,data}}`.
  - Builds request body: `{contents:[{parts}], generationConfig:{temperature:0.3, maxOutputTokens:800}}`.
  - Retries up to 3 times with delays `[5000,15000,45000]` ms + random jitter (up to 1200ms) whenever the response status is 429.
  - On any other non-ok response, throws an `Error` containing the status and first 120 chars of the response body.
  - On success, parses JSON and returns `candidates[0].content.parts[0].text || ''`.
  - If all 3 attempts are rate-limited, throws the last recorded error.
- **Calls:** _geminiKey, fetch
- **Called by:** triggerDailyAiReview, triggerWeeklyAiReview
- **Side effects:** Network call to `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent`; `console.warn` on rate-limit retries.
- **Notes:** API key is passed as a URL query parameter. No retry logic for non-429 failures (immediate throw). Model name and generation config are hardcoded.

#### _parseDailyAiResponse(text)

- **File:** Trade_Journal/index.html (lines 15996-16019)
- **Module:** AI Review — Gemini Integration
- **Purpose:** Parses Gemini's raw text response for a daily/trade review into a structured scores/reasons object.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| text | string | Raw text returned by Gemini |

- **Returns:** object `{setupScore, setupReason, executionScore, executionReason, honestyScore, honestyReason, overallScore, worked, improve, lesson}`.
- **Internal logic:**
  - Local helper `get(key)`: regex-matches `"KEY:\s*([^\n]+)"` case-insensitively and returns the trimmed capture, or `null`.
  - Local helper `scoreAndReason(raw)` (see separate entry below): splits a `"N/M — reason"` line into `{score, reason}`.
  - Extracts SETUP, EXECUTION, HONESTY via `get()` + `scoreAndReason()`; OVERALL via `get()` parsed with `parseInt`.
  - Extracts WORKED, IMPROVE, LESSON as raw strings (default `''`).
- **Calls:** scoreAndReason, get (both locally-scoped helpers)
- **Called by:** triggerDailyAiReview
- **Side effects:** none (pure parser).
- **Notes:** Tolerant of missing fields (defaults to `null`/`''`); depends on Gemini following the exact response format dictated by `_buildDailyPrompt`.

#### scoreAndReason(raw)

- **File:** Trade_Journal/index.html (lines 16001-16005, duplicated identically at 16026-16030)
- **Module:** AI Review — Gemini Integration
- **Purpose:** Splits a `"N/M — reason"` formatted line into a numeric score and free-text reason, used by both AI response parsers.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| raw | string\|null | The raw `"n/m — reason"` line, or null |

- **Returns:** `{score: number|null, reason: string}`
- **Internal logic:**
  - If `raw` is falsy, returns `{score:null, reason:''}`.
  - Regex-matches `^(\d+)/\d+\s*[—–-]?\s*(.*)$`.
  - If matched, returns `{score: parseInt(group1), reason: group2.trim()}`.
  - Otherwise returns `{score:null, reason: raw}` (unparsed text is kept as the reason).
- **Calls:** (none)
- **Called by:** _parseDailyAiResponse, _parseWeeklyAiResponse
- **Side effects:** none.
- **Notes:** This is a `const` arrow function defined identically inside both `_parseDailyAiResponse` and `_parseWeeklyAiResponse` (local closures, not a shared top-level function) — the static analysis merged the two identical definitions into a single inventory entry. Documented once since the behavior is identical in both call sites.

#### _parseWeeklyAiResponse(text)

- **File:** Trade_Journal/index.html (lines 16021-16047)
- **Module:** AI Review — Gemini Integration
- **Purpose:** Parses Gemini's raw text response for a weekly bias review into a structured scores/reasons object across four dimensions.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| text | string | Raw text returned by Gemini |

- **Returns:** object `{biasScore,biasReason,accuracyScore,accuracyReason,consistencyScore,consistencyReason,lessonScore,lessonReason,overallScore,worked,improve,lesson,nextWeek}`.
- **Internal logic:**
  - Same local `get()`/`scoreAndReason()` helper pattern as `_parseDailyAiResponse`.
  - Extracts BIAS, ACCURACY, CONSISTENCY, LESSONS score/reason pairs; OVERALL as int.
  - Extracts WORKED, IMPROVE, LESSON, NEXT_WEEK as raw strings.
- **Calls:** scoreAndReason, get (locally-scoped helpers)
- **Called by:** triggerWeeklyAiReview
- **Side effects:** none.
- **Notes:** Mirrors `_parseDailyAiResponse` but for the weekly prompt's 4-dimension /10 scoring plus a /40 overall and an extra `NEXT_WEEK` field.

#### compressBase64Image(dataUrl, maxWidth = 1000)

- **File:** Trade_Journal/index.html (lines 16049-16063)
- **Module:** AI Review — Gemini Integration
- **Purpose:** Downscales and re-encodes an image data URL to JPEG at a reduced width to shrink payload size before sending to Gemini.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| dataUrl | string | Source image as a data URL |
| maxWidth | number (default 1000) | Maximum output width in pixels |

- **Returns:** Promise<string> — new (or, on error, original) data URL.
- **Internal logic:**
  - Creates an `Image`; on `load`, computes `scale = maxWidth/img.width` if wider than `maxWidth`, else `1` (never upscales).
  - Draws the scaled image onto an offscreen `<canvas>` and resolves with `canvas.toDataURL('image/jpeg', 0.75)`.
  - On `error`, resolves with the original `dataUrl` unchanged (fallback).
  - Sets `img.src = dataUrl` to trigger loading.
- **Calls:** (none — uses browser Image/Canvas APIs)
- **Called by:** _resolveDataUrls
- **Side effects:** Creates transient (non-appended) `Image`/`canvas` DOM elements.
- **Notes:** JPEG quality fixed at 0.75.

#### _resolveDataUrls(ssList)

- **File:** Trade_Journal/index.html (lines 16065-16090)
- **Module:** AI Review — Gemini Integration
- **Purpose:** Converts a list of screenshot records (legacy inline base64 or Supabase Storage paths) into ready-to-send, size-compressed base64 data URLs for the Gemini vision prompt.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| ssList | array\|undefined | Screenshot objects, each with a `.dataUrl` field |

- **Returns:** Promise<string[]> — resolved data URLs (broken items are silently skipped).
- **Internal logic:**
  - Iterates `ssList || []`, skipping falsy entries.
  - If `ss.dataUrl` starts with `'data:'` (legacy inline base64): compresses via `compressBase64Image` and pushes.
  - Else if `ss.dataUrl` is truthy (a storage path): resolves a signed URL via `resolveStoragePath`, fetches it, converts the response `Blob` to base64 via `FileReader.readAsDataURL` (wrapped in a Promise), then compresses and pushes.
  - Each iteration is wrapped in try/catch; failures are logged via `console.warn` and simply omitted (do not abort the batch).
- **Calls:** compressBase64Image, resolveStoragePath, fetch
- **Called by:** triggerDailyAiReview, triggerWeeklyAiReview
- **Side effects:** Network fetch of signed Supabase Storage URLs.
- **Notes:** Per-item failures are silent — a broken screenshot is simply omitted from the AI review's image set rather than failing the whole review.

#### _buildDailyPrompt(t, intra)

- **File:** Trade_Journal/index.html (lines 16092-16165)
- **Module:** AI Review — Gemini Integration
- **Purpose:** Constructs the full text prompt sent to Gemini for a trade/daily AI review — embedding the daily checklist, trade result, linked intraday execution (if any), and a strict response-format specification.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| t | object | The daily/swing trade being reviewed |
| intra | object\|null | The linked intraday execution trade, if one exists |

- **Returns:** string — multi-section prompt text.
- **Internal logic:**
  - Extracts checklist values via `extractWBValues(t.checklistAnswers||{})` (guarded on `extractWBValues` being defined).
  - Builds inline label maps for structure/location/dol/phase, and pulls irl/sweep label maps from the global `WB_DISPLAY`.
  - Computes R via `calcR(t)`, formatted as `"+X.XXR"`/`"—"`.
  - Builds `intraBlock`: a static "None — daily-only trade" message if no `intra`; otherwise formats alignment, lq/disp/mss/ret execution-sequence flags, result, R (via a second `calcR` call on `intra`), and HTML-stripped execution notes.
  - Assembles the full prompt: FRAMEWORK, TRADE summary, DAILY CHECKLIST (6 questions through label maps), DAILY ANALYSIS NOTES / CLOSE NOTES (HTML tags stripped via regex), INTRADAY EXECUTION block, a SCREENSHOTS note, and a SCORE THIS TRADE section that dictates the exact response format expected by `_parseDailyAiResponse` (SETUP/EXECUTION/HONESTY/OVERALL, then WORKED/IMPROVE/LESSON).
- **Calls:** extractWBValues, calcR
- **Called by:** triggerDailyAiReview
- **Side effects:** none (pure string builder).
- **Notes:** Notes fields are stripped of HTML via a naive `replace(/<[^>]+>/g,'')`. The prompt explicitly instructs the model not to reference the journal's own scores, aiming for an independent second opinion.

#### _buildWeeklyPrompt(w, dailySummaries)

- **File:** Trade_Journal/index.html (lines 16167-16248)
- **Module:** AI Review — Gemini Integration
- **Purpose:** Constructs the Gemini prompt for a weekly bias AI review, combining the weekly checklist, structured close-review answers, week performance stats, and per-daily-trade AI review summaries from that week.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| w | object | The weekly bias entry being reviewed |
| dailySummaries | array | `{date,result,rDisplay,setupScore,executionScore,honestyScore,overallScore,lesson}` entries for that week's already-reviewed daily trades |

- **Returns:** string — multi-section prompt text.
- **Internal logic:**
  - Extracts checklist values via `extractWBValues(w.wbChecklistAnswers||{})`.
  - Computes `result = runWBEngine(w.wbChecklistAnswers)` if answers exist (used for derived-bias/environment/confidence display), else `null`.
  - Builds label maps (structure/location/dol/phase inline; irl/sweep from `WB_DISPLAY`).
  - Reads `w.weeklyReview.performanceStats` for trade count/win-rate/net R/avg R.
  - Builds `dailyBlock`: one line per `dailySummaries` entry, or a static "No individual trade AI reviews available." message if empty.
  - Assembles the full prompt: FRAMEWORK, WEEKLY BIAS (pair/week/bias/derived bias & environment/checklist/notes), END OF WEEK CLOSE REVIEW (actual environment, dominant outcome, structure outcome, liquidity reached, phase evolved, opportunity quality), WEEK PERFORMANCE stats, DAILY TRADE REVIEWS THIS WEEK, WEEKLY LESSONS (worked/failed/surprised/focus), and a SCORE THIS WEEK section dictating the exact response format matching `_parseWeeklyAiResponse` (BIAS/ACCURACY/CONSISTENCY/LESSONS/OVERALL, then WORKED/IMPROVE/LESSON/NEXT_WEEK).
- **Calls:** extractWBValues, runWBEngine
- **Called by:** triggerWeeklyAiReview
- **Side effects:** none (pure string builder).
- **Notes:** Weekly notes are HTML-stripped. Mirrors the daily prompt's "don't reference the internal engine" instruction to keep the AI review independent of the app's own scoring/accuracy engine.

#### triggerDailyAiReview(tradeId)

- **File:** Trade_Journal/index.html (lines 16250-16277)
- **Module:** AI Review — Gemini Integration
- **Purpose:** Orchestrates a full daily/trade AI review cycle: loads screenshots, builds the prompt, calls Gemini, parses and stores the result on the trade, then persists and re-renders.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| tradeId | string\|number | The (daily/swing) trade to review |

- **Returns:** Promise<void>
- **Internal logic:**
  - Finds trade `t` in `S.trades` via `idEq`; returns early if not found, or if `t.isIntraday` (this function only reviews daily/swing entries).
  - Finds a linked intraday execution trade `intra` (`isIntraday && idEq(weeklyLinkId, t.id)`).
  - Ensures screenshots are loaded via `loadTradeScreenshots` for `t`, and for `intra` if present.
  - Builds `imageSets` from `t.screenshots`, `t.eodScreenshots`, and `intra.screenshots` (if `intra` exists); resolves to data URLs via `_resolveDataUrls`.
  - Builds the prompt via `_buildDailyPrompt(t, intra||null)`.
  - try: calls `callGeminiVision`; on success sets `t.aiReview = {..._parseDailyAiResponse(raw), generatedAt: nowISO, model:'gemini-2.0-flash-lite', error:null}`.
  - catch: sets `t.aiReview = {error: e.message, generatedAt: nowISO}` (logs `console.warn`).
  - Always calls `saveTrade(t)` then `renderClosed()`.
- **Calls:** idEq, loadTradeScreenshots, _resolveDataUrls, _buildDailyPrompt, callGeminiVision, _parseDailyAiResponse, saveTrade, renderClosed
- **Called by:** saveClosure, renderTradeAiReviewBlock (via inline `onclick="triggerDailyAiReview('...')"` retry/run-now buttons)
- **Side effects:** Mutates `t.aiReview` (persisted global state); Supabase write via `saveTrade`; DOM re-render via `renderClosed`.
- **Notes:** No-ops for intraday trades — daily review is swing-trade-only, with intraday detail folded in as context. Errors are captured onto the trade record rather than thrown.

#### triggerWeeklyAiReview(weeklyId)

- **File:** Trade_Journal/index.html (lines 16279-16323)
- **Module:** AI Review — Gemini Integration
- **Purpose:** Orchestrates the full weekly bias AI review cycle, aggregating that week's already-reviewed daily trades as context for the model.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| weeklyId | string\|number | The weekly bias entry to review |

- **Returns:** Promise<void>
- **Internal logic:**
  - Finds `w` in `S.weeklies` via `idEq`; returns early if not found or if `w.weeklyReview` doesn't exist yet (the manual close review must be completed first).
  - Gets that week's trades via `getWeekTrades(w.date)`, filtered to non-intraday, closed.
  - Builds `dailySummaries` from those trades that already have a successful (non-error) `aiReview`.
  - Collects all screenshots (`w.screenshots` + every `w.updates[].screenshots`) and resolves via `_resolveDataUrls`.
  - Builds the prompt via `_buildWeeklyPrompt(w, dailySummaries)`.
  - try: calls `callGeminiVision`; on success sets `w.weeklyReview.aiReview = {..._parseWeeklyAiResponse(raw), dailyCount, generatedAt, model:'gemini-2.0-flash-lite', error:null}`.
  - catch: sets `w.weeklyReview.aiReview = {error, generatedAt}`.
  - Calls `saveWeekly(w)`, `renderWeekly()`.
  - If the weekly-review edit modal is open for this same weekly (`S.wrEditId` matches via `idEq`), directly re-renders `#wrAiReviewContainer`'s innerHTML with `renderWeeklyAiReviewBlock(w)` for a live update without a full page nav.
- **Calls:** idEq, getWeekTrades, filter, calcR, _resolveDataUrls, _buildWeeklyPrompt, callGeminiVision, _parseWeeklyAiResponse, saveWeekly, renderWeekly, renderWeeklyAiReviewBlock
- **Called by:** saveWeeklyReview, renderWeeklyAiReviewBlock (via inline `onclick="triggerWeeklyAiReview('...')"` retry/run-now buttons)
- **Side effects:** Mutates `w.weeklyReview.aiReview`; Supabase write via `saveWeekly`; DOM re-render via `renderWeekly` and direct innerHTML update of `#wrAiReviewContainer`.
- **Notes:** Requires `w.weeklyReview` to already exist. `dailyCount` reflects how many trade-level AI reviews were successfully folded in as context.

#### renderTradeAiReviewBlock(t)

- **File:** Trade_Journal/index.html (lines 16325-16359)
- **Module:** AI Review — Gemini Integration
- **Purpose:** Renders the HTML block shown under a closed trade for its AI review — a "disabled" message if no Gemini key, a pending/error state with retry button, or the full scored breakdown.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| t | object | The trade whose AI review block is being rendered |

- **Returns:** string (HTML)
- **Internal logic:**
  - If `!_geminiKey()`: returns a disabled-state block linking to Settings (`onclick="navTo('settings')"`).
  - If `!t.aiReview`: returns a pending block with a spinner and "Run now" button (`onclick="triggerDailyAiReview(t.id)"`).
  - If `t.aiReview.error`: returns an "unavailable" block with truncated (60-char) error text and a "Retry" button.
  - Otherwise: renders the full block — header (model name, overall/30 score, click-to-toggle expand via `classList.toggle('open')` on the next sibling), three dimension rows (SETUP/EXECUTION/HONESTY) each with reason, score/10, and an `_aiScoreBar`; a feedback section (WORKED/IMPROVE/LESSON, conditionally shown); and a formatted `generatedAt` timestamp.
- **Calls:** _geminiKey, navTo (inline onclick), triggerDailyAiReview (inline onclick), _aiScoreBar
- **Called by:** openTradeHistory
- **Side effects:** none directly (pure string builder); returned HTML embeds onclick handlers.
- **Notes:** Expand/collapse is pure CSS class toggling, no JS state stored.

#### renderWeeklyAiReviewBlock(w)

- **File:** Trade_Journal/index.html (lines 16361-16394)
- **Module:** AI Review — Gemini Integration
- **Purpose:** Weekly-review counterpart of `renderTradeAiReviewBlock` — renders disabled/pending/error/full-scored HTML for a weekly bias entry's AI review, with 4 scored dimensions instead of 3.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| w | object | The weekly bias entry whose AI review block is being rendered |

- **Returns:** string (HTML)
- **Internal logic:**
  - If `!_geminiKey()`: disabled-state block (link to Settings).
  - `ai = w.weeklyReview?.aiReview`; if absent: pending block with "Run now" button (`onclick="triggerWeeklyAiReview(w.id)"`).
  - If `ai.error`: unavailable block with truncated error + "Retry" button.
  - Otherwise: full block — header shows model + "N daily review(s) used" and overall/40 score; four dimension rows (BIAS/ACCURACY/CONSISTENCY/LESSONS) each with reason/score/bar; feedback section (WORKED/IMPROVE/LESSON/NEXT_WEEK, conditionally shown); formatted `generatedAt` timestamp.
- **Calls:** _geminiKey, navTo (inline onclick), triggerWeeklyAiReview (inline onclick), _aiScoreBar
- **Called by:** openWeeklyReview, triggerWeeklyAiReview (direct call to refresh `#wrAiReviewContainer`)
- **Side effects:** none directly (pure string builder); embedded onclick handlers trigger navTo/triggerWeeklyAiReview.
- **Notes:** `dailyCount` label is pluralized based on `ai.dailyCount !== 1`.

### Module: Settings — Sync & Screenshot Cache

#### settingsForceSync(btn)

- **File:** Trade_Journal/index.html (lines 16400-16407)
- **Module:** Settings — Sync & Screenshot Cache
- **Purpose:** Settings-page "Force Sync" button handler — forces a full reload of all data from Supabase and refreshes the Settings display.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| btn | HTMLElement\|undefined | The clicked button, for loading-state UI |

- **Returns:** Promise<void>
- **Internal logic:**
  - If `btn` provided: sets text to `'Syncing…'` and disables it.
  - Awaits `loadAllData(true)` (forces a hard refresh bypassing cache).
  - If `btn` provided: restores text to `'⟳ FORCE SYNC'` and re-enables it.
  - Calls `populateSettingsPage()`.
- **Calls:** loadAllData, populateSettingsPage
- **Called by:** (none detected — verify: almost certainly wired via inline `onclick="settingsForceSync(this)"` on a Settings-page button, given the `btn` parameter pattern)
- **Side effects:** DOM mutation on `btn` (text, disabled); triggers full Supabase reload and downstream Settings page refresh.
- **Notes:** The `this`-passing pattern strongly implies an inline HTML `onclick` binding not visible to static call-graph analysis.

#### refreshSsCacheInfo()

- **File:** Trade_Journal/index.html (lines 16409-16434)
- **Module:** Settings — Sync & Screenshot Cache
- **Purpose:** Updates the Settings page's screenshot-cache status display — cached trade count, storage usage, and whether persistent-storage protection is granted.
- **Parameters:** None
- **Returns:** Promise<void>
- **Internal logic:**
  - Looks up `#ssCacheStatus`/`#ssCachePersistBadge`; returns if the status element is missing.
  - Runs in parallel: `_ssDB.count()`, `_ssDB.sizeInfo()`, and `navigator.storage.persisted()` if supported (else resolves `null`).
  - Sets status text to `"N trade(s) cached"` plus, if size info available, `" · X MB used / Y MB quota"`.
  - Sets badge text/colors: `true` → green "PROTECTED"; `false` → amber "NOT PROTECTED"; `null` → grey "Persist API not supported".
- **Calls:** _ssDB.count, _ssDB.sizeInfo (shown as "count", "sizeInfo")
- **Called by:** populateSettingsPage, clearSsCache
- **Side effects:** DOM mutation on `#ssCacheStatus`/`#ssCachePersistBadge`; reads IndexedDB (`_ssDB`) size/count and the Storage API persisted state.
- **Notes:** Uses optional chaining on `navigator.storage?.persisted` for browsers lacking the Storage API.

#### clearSsCache()

- **File:** Trade_Journal/index.html (lines 16436-16453)
- **Module:** Settings — Sync & Screenshot Cache
- **Purpose:** Clears the local IndexedDB screenshot cache (metadata + blobs) after user confirmation, resetting in-memory screenshot-loaded flags so screenshots re-fetch from Supabase on next view.
- **Parameters:** None
- **Returns:** Promise<void>
- **Internal logic:**
  - Shows a native `confirm()` warning about re-download/egress cost; returns early if declined.
  - Calls `_ssDB.clear()` and `_ssDB.clearBlobs()`.
  - For every trade in `S.trades`: resets `t._ssLoaded=false` and clears `t.screenshots`/`t.eodScreenshots`/`t.followupScreenshots` to `[]`.
  - For every weekly in `S.weeklies`: deletes the cached `_displayUrl` field from each screenshot in `w.screenshots` and in every update's screenshots.
  - Calls `refreshSsCacheInfo()`.
  - Shows a success toast.
- **Calls:** _ssDB.clear, _ssDB.clearBlobs (shown as "clear", "clearBlobs"), refreshSsCacheInfo, showToast
- **Called by:** (none detected — verify: likely wired via inline `onclick` on a Settings "Clear Cache" button)
- **Side effects:** Clears IndexedDB (`_ssDB` metadata + blob stores); mutates `S.trades[*]`/`S.weeklies[*]` screenshot state (global state); toast notification.
- **Notes:** Screenshots themselves remain intact in Supabase Storage — this only clears the local cache, at the cost of future re-download egress.

#### openDriveModal()

- **File:** Trade_Journal/index.html (lines 16455-16466)
- **Module:** Settings — Sync & Screenshot Cache
- **Purpose:** Opens the sync-status ("Drive") modal, populating it with the current user's email and database connection status.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Sets `#modalUserEmail` text to `_currentUser.email` if present.
  - Sets `#modalDbDot` class to `'drive-dot on'`/`'drive-dot off'` and `#modalDbStatus` text to `'Connected'`/`'Not synced'` based on `S.syncStatus === 'synced'`.
  - Copies `#perfSyncStatus`'s text into `#modalDbDetail`.
  - Adds `'open'` class to `#driveModal`.
- **Calls:** (none — direct DOM API calls only)
- **Called by:** (none detected — verify: likely wired via inline `onclick` on a sync-status indicator/button)
- **Side effects:** DOM mutations on `#modalUserEmail`, `#modalDbDot`, `#modalDbStatus`, `#modalDbDetail`, `#driveModal`.
- **Notes:** Purely reflective of existing state — makes no network calls itself.

### Module: Archive System — Utilities & Modal UI Helpers

#### getArchiveCutoffDate()

- **File:** Trade_Journal/index.html (lines 16481-16489)
- **Module:** Archive System — Utilities & Modal UI Helpers
- **Purpose:** Computes the cutoff date used by the archive system — the first day of the next calendar month (UTC) — so "archive everything before this date" covers all data through the end of the current month.
- **Parameters:** None
- **Returns:** string — ISO date `"YYYY-MM-01"` for the month following the current one.
- **Internal logic:**
  - Gets current UTC year `y` and 1-based month `m` (`getUTCMonth()+1`).
  - If `m > 11` (i.e. December), `nextMonth=1`, `nextYear=y+1`; else `nextMonth=m+1`, `nextYear=y`.
  - Returns `` `${nextYear}-${padded nextMonth}-01` ``.
- **Calls:** (none)
- **Called by:** populateArchiveInfo, runArchive
- **Side effects:** none (pure).
- **Notes:** Computed entirely in UTC to avoid timezone-dependent month boundaries.

#### _arcFmt(iso)

- **File:** Trade_Journal/index.html (lines 16491-16495)
- **Module:** Archive System — Utilities & Modal UI Helpers
- **Purpose:** Formats an ISO date/timestamp into a human-readable "DD Mon YYYY" string for the archive UI.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| iso | string\|null | ISO date/timestamp string |

- **Returns:** string — formatted date, or `'—'` if `iso` is falsy.
- **Internal logic:** guard for falsy `iso`; else `new Date(iso).toLocaleDateString('en-GB', {day:'2-digit', month:'short', year:'numeric'})`.
- **Calls:** (none)
- **Called by:** checkPriorIncompleteArchive, renderArchiveHistory, populateArchiveInfo, runArchive
- **Side effects:** none.
- **Notes:** `en-GB` locale yields e.g. "24 Aug 2026".

#### _arcSetStep(n, state)

- **File:** Trade_Journal/index.html (lines 16498-16508)
- **Module:** Archive System — Utilities & Modal UI Helpers
- **Purpose:** Updates one numbered step indicator (1-11) in the archive progress modal, setting its CSS state class and icon glyph.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| n | number | Step index (1-11) |
| state | string | `''` \| `'active'` \| `'done'` \| `'error'` |

- **Returns:** void
- **Internal logic:**
  - Looks up `#arcStep{n}`; returns if not found.
  - Sets `el.className = 'arc-step ' + state`.
  - Finds `.arc-step-icon` child; returns if absent.
  - Sets icon text: `'✓'` for done, `'●'` for active, `'✕'` for error (unchanged for other states).
- **Calls:** (none — direct DOM)
- **Called by:** runArchive
- **Side effects:** DOM mutation on `#arcStep{n}` className and its icon child's text.
- **Notes:** Invoked 25 times across the file (per step-transition), reflecting the 11-step progress UI being reset then advanced/completed/errored throughout `runArchive`.

#### _arcStatus(msg)

- **File:** Trade_Journal/index.html (lines 16510-16513)
- **Module:** Archive System — Utilities & Modal UI Helpers
- **Purpose:** Sets the free-text status line shown in the archive progress modal (e.g. "Downloading screenshots: 3 / 20").
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| msg | string | Status text to display |

- **Returns:** void
- **Internal logic:** looks up `#archiveStatusMsg`; if present sets `textContent = msg`.
- **Calls:** (none)
- **Called by:** runArchive
- **Side effects:** DOM mutation on `#archiveStatusMsg`.
- **Notes:** none.

#### _arcShowError(msg)

- **File:** Trade_Journal/index.html (lines 16515-16518)
- **Module:** Archive System — Utilities & Modal UI Helpers
- **Purpose:** Displays an error message in the archive modal's error banner.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| msg | string | Error text to display |

- **Returns:** void
- **Internal logic:** looks up `#archiveErrorMsg`; if present, sets `textContent=msg` and `style.display='block'`.
- **Calls:** (none)
- **Called by:** runArchive
- **Side effects:** DOM mutation on `#archiveErrorMsg` (text + visibility).
- **Notes:** none.

#### archiveModalClose()

- **File:** Trade_Journal/index.html (lines 16520-16522)
- **Module:** Archive System — Utilities & Modal UI Helpers
- **Purpose:** Closes (hides) the archive modal.
- **Parameters:** None
- **Returns:** void
- **Internal logic:** `document.getElementById('archiveModal').classList.remove('open')`.
- **Calls:** remove (classList.remove)
- **Called by:** archiveModalCancel
- **Side effects:** DOM mutation on `#archiveModal` (removes `'open'` class).
- **Notes:** No null-guard on the `getElementById` result — assumes the modal element is always present in the static HTML.

#### archiveModalCancel()

- **File:** Trade_Journal/index.html (lines 16524-16529)
- **Module:** Archive System — Utilities & Modal UI Helpers
- **Purpose:** Handles the user cancelling the archive flow — refuses cancellation once past the destructive point of no return, otherwise closes the modal and marks the flow cancelled.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Guard: returns immediately if `_arc.pastPointOfNoReturn` is true.
  - Sets `_arc.cancelled = true` (checked by `runArchive`'s step loop to abort early).
  - Calls `archiveModalClose()`.
  - Shows a `'warn'`-styled toast "Archive cancelled".
- **Calls:** archiveModalClose, showToast
- **Called by:** (none detected — verify: likely wired via inline `onclick` on the modal's Cancel button)
- **Side effects:** Mutates module-level `_arc.cancelled`; DOM (via `archiveModalClose`); toast notification.
- **Notes:** This is the safety valve letting a user abort before Step 7's point-of-no-return; after that, cancellation is blocked because destructive DB/storage operations are already underway or committed.

#### archiveConfirmCheckChanged()

- **File:** Trade_Journal/index.html (lines 16531-16541)
- **Module:** Archive System — Utilities & Modal UI Helpers
- **Purpose:** Enables/disables the "Proceed" button in the archive's post-download confirmation gate based on whether the confirmation checkbox is ticked.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Reads `checked` state of `#archiveConfirmCheck`.
  - Looks up `#archiveProceedBtn`; if present, sets `disabled=!checked` and toggles visual affordances (opacity, cursor, borderColor, background between `var(--bear)`/`var(--muted)`).
- **Calls:** (none — direct DOM)
- **Called by:** triggerZipDownload
- **Side effects:** DOM mutation on `#archiveProceedBtn` (disabled + inline styles).
- **Notes:** Also wired as the checkbox's `onchange` handler in the HTML (inline attribute) — an additional runtime caller not visible to static call-graph analysis.

#### archiveProceedAfterConfirm()

- **File:** Trade_Journal/index.html (lines 16543-16545)
- **Module:** Archive System — Utilities & Modal UI Helpers
- **Purpose:** Resolves the pending Promise that `triggerZipDownload` is awaiting, letting the archive flow proceed past the confirmation gate once the user clicks "Proceed".
- **Parameters:** None
- **Returns:** void
- **Internal logic:** if `_arc.proceedResolve` is set, calls it (resolving the awaited Promise) and clears it to `null`.
- **Calls:** (none)
- **Called by:** (none detected — verify: this is the click handler for the "Proceed" button in the confirmation gate, wired via inline `onclick="archiveProceedAfterConfirm()"`; the corresponding await point lives in `triggerZipDownload`)
- **Side effects:** Mutates module-level `_arc.proceedResolve`.
- **Notes:** Implements a manual resolve-callback pattern to pause an async function until a UI click occurs.

### Module: Archive System — Data Collection, Zip Building & Finalisation

#### _arcWriteLog(status, stats)

- **File:** Trade_Journal/index.html (lines 16548-16561)
- **Module:** Archive System — Data Collection, Zip Building & Finalisation
- **Purpose:** Inserts a new row into the `archive_log` Supabase table marking the start of an archive run, returning its id for later updates.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| status | string | e.g. `'in_progress'` |
| stats | object\|null | Optional stats payload |

- **Returns:** Promise<string\|null> — the new row's id, or `null` if not logged in or on error.
- **Internal logic:**
  - Guard: returns `null` if no `_currentUser`.
  - try: inserts `{user_id, started_at: nowISO, status, stats: stats||null}` into `archive_log`, selecting back `'id'` via `.single()`; throws if `error`.
  - Returns `data.id`.
  - catch: logs `console.warn` and returns `null` (non-fatal).
- **Calls:** (Supabase client calls; not individually named in outboundCalls)
- **Called by:** runArchive
- **Side effects:** Supabase INSERT into `archive_log`.
- **Notes:** Failure is deliberately non-fatal — `archive_log` is an audit trail, not a functional dependency of the destructive operations.

#### _arcUpdateLog(id, fields)

- **File:** Trade_Journal/index.html (lines 16563-16568)
- **Module:** Archive System — Data Collection, Zip Building & Finalisation
- **Purpose:** Updates an existing `archive_log` row with new fields — used to mark progress/completion/failure status and final stats.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| id | string\|null | archive_log row id |
| fields | object | Partial update, e.g. `{status, completed_at, stats}` |

- **Returns:** Promise<void>
- **Internal logic:**
  - Guard: no-ops if `id` or `_currentUser` missing.
  - try: `_sb.from('archive_log').update(fields).eq('id', id).eq('user_id', _currentUser.id)`.
  - catch: `console.warn` (non-fatal).
- **Calls:** (Supabase client calls)
- **Called by:** finaliseArchive, runArchive
- **Side effects:** Supabase UPDATE on `archive_log` (scoped to `id` + `user_id`).
- **Notes:** Non-fatal on failure, consistent with `_arcWriteLog`.

#### collectArchiveData(cutoff)

- **File:** Trade_Journal/index.html (lines 16571-16592)
- **Module:** Archive System — Data Collection, Zip Building & Finalisation
- **Purpose:** Fetches all trades and weeklies (of any status) dated before the cutoff from Supabase, for inclusion in the archive zip and subsequent deletion evaluation.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| cutoff | string | ISO date; rows with `date < cutoff` are fetched |

- **Returns:** Promise<{trades: object[], weeklies: object[]}>
- **Internal logic:**
  - Guard: returns `{trades:[],weeklies:[]}` if not logged in.
  - Fetches in parallel: all columns (`'*'`) from `trades` where `user_id` matches and `date < cutoff`, ordered ascending by date; identical query against `weeklies`.
  - Throws a descriptive error if either query errored.
  - Returns `{trades: tr.data||[], weeklies: wr.data||[]}`.
- **Calls:** (Supabase client calls)
- **Called by:** runArchive
- **Side effects:** Supabase SELECT reads on `trades` and `weeklies` (no writes).
- **Notes:** Intentionally fetches trades of ALL statuses before cutoff (not just closed) — comment in source notes open trades may still have screenshots needing cleanup, though `runArchive`'s own failsafe refuses to proceed at all if any trade is currently open.

#### collectAllScreenshotUrls(trades, weeklies)

- **File:** Trade_Journal/index.html (lines 16595-16625)
- **Module:** Archive System — Data Collection, Zip Building & Finalisation
- **Purpose:** Scans raw (DB-shaped, snake_case) trade and weekly rows and extracts every screenshot's Supabase Storage path (skipping legacy inline base64), tagged with an owning id, for batch download.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| trades | array | DB trade rows |
| weeklies | array | DB weekly rows |

- **Returns:** array of `{path, tradeId, filename}`.
- **Internal logic:**
  - Per trade: gathers screenshots from `t.screenshots`, `t.eod_screenshots`, `t.followup_screenshots`, `t.review_screenshots`, plus every `trade_notes[].screenshots` flattened.
  - For each screenshot whose `dataUrl` does NOT start with `'data:'` (a real storage path), pushes `{path: ss.dataUrl, tradeId: t.id, filename: ss.name||'screenshot.jpg'}`.
  - Per weekly: gathers `w.screenshots` plus every `w.updates[].screenshots` flattened; same filter; tags `tradeId` as `'weekly_' + w.id` (synthetic id distinguishing weekly-owned screenshots in the zip's folder structure).
- **Calls:** (none)
- **Called by:** runArchive
- **Side effects:** none (pure).
- **Notes:** Only storage-backed screenshots are collected here; legacy base64 screenshots are handled separately (embedded directly) in `buildArchiveZip`.

#### downloadAllScreenshotBlobs(urlEntries, onProgress)

- **File:** Trade_Journal/index.html (lines 16628-16648)
- **Module:** Archive System — Data Collection, Zip Building & Finalisation
- **Purpose:** Downloads the binary content for every screenshot storage path collected by `collectAllScreenshotUrls`, resolving each to a signed URL first, reporting progress via callback.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| urlEntries | array | `{path,tradeId,filename}` entries |
| onProgress | function(done,total)\|undefined | Progress callback invoked after each entry |

- **Returns:** Promise<Map<string, {blob, tradeId, filename}>> keyed by storage path.
- **Internal logic:**
  - For each entry (sequentially, via a `for...of` loop with `await`): resolves a signed URL via `resolveStoragePath`; if resolved, fetches it; if response ok, reads the `Blob` and stores `{blob, tradeId, filename}` keyed by the original path.
  - Catches and logs (`console.warn`) any per-entry failure without aborting the loop.
  - Increments `done` and calls `onProgress(done, total)` after every entry (success or failure).
- **Calls:** resolveStoragePath, fetch, set (Map.set)
- **Called by:** runArchive
- **Side effects:** Network fetch of each signed Supabase Storage URL.
- **Notes:** Downloads are sequential (not parallel) — likely deliberate to avoid overwhelming Supabase Storage/signed-URL rate limits and to allow accurate incremental progress reporting.

#### buildArchiveZip(trades, weeklies, blobMap)

- **File:** Trade_Journal/index.html (lines 16651-16692)
- **Module:** Archive System — Data Collection, Zip Building & Finalisation
- **Purpose:** Assembles a JSZip archive containing JSON dumps of the trades/weeklies rows plus every screenshot (both storage-backed, from `blobMap`, and legacy inline base64 extracted directly from the row data).
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| trades | array | DB trade rows |
| weeklies | array | DB weekly rows |
| blobMap | Map<path,{blob,tradeId,filename}> | Downloaded screenshot blobs from downloadAllScreenshotBlobs |

- **Returns:** Promise<JSZip> — the populated zip object (not yet serialized).
- **Internal logic:**
  - Creates `new JSZip()`.
  - Writes `data/trades.json` and `data/weeklies.json` as pretty-printed JSON dumps of the raw row arrays.
  - For every `[path, entry]` in `blobMap`: sanitizes `entry.filename` (strips non-alphanumeric/`._-` chars) and adds the blob at `screenshots/{tradeId}/{safeName}`.
  - Additionally, re-scans every trade's screenshot arrays (screenshots/eod/followup/review + flattened `trade_notes` screenshots) for entries whose `dataUrl` starts with `'data:'` (legacy inline base64, absent from `blobMap`) — extracts the base64 payload and file extension from the data URL header, sanitizes a filename, and adds it at `screenshots/{t.id}/{filename}` using JSZip's `{base64:true}` option (wrapped per-item in try/catch so one bad row doesn't abort the whole build).
- **Calls:** (none — JSZip library API calls only)
- **Called by:** runArchive
- **Side effects:** none external (in-memory zip construction only).
- **Notes:** This is the only place legacy base64 screenshots get included in the archive — they're never downloaded via `blobMap` since they're already inline in the DB row.

#### computeArchiveChecksum(zip)

- **File:** Trade_Journal/index.html (lines 16695-16706)
- **Module:** Archive System — Data Collection, Zip Building & Finalisation
- **Purpose:** Computes a lightweight size summary (file count and total byte size) of the built zip, shown to the user before they confirm proceeding with deletion.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| zip | JSZip | The built archive zip |

- **Returns:** Promise<{fileCount: number, totalBytes: number}>
- **Internal logic:**
  - Gets non-directory entries via `Object.values(zip.files).filter(f => !f.dir)`; `fileCount = files.length`.
  - For each file, awaits `f.async('arraybuffer')` and accumulates `byteLength` into `totalBytes`; wrapped per-file in try/catch so one unreadable entry doesn't abort the computation (silently skipped).
- **Calls:** filter
- **Called by:** runArchive
- **Side effects:** none (transiently reads zip contents into memory — CPU/memory cost proportional to archive size).
- **Notes:** Despite the name, this is not a cryptographic checksum/hash — it's a size/count summary for user-facing confidence, not integrity verification.

#### triggerZipDownload(zip, stats, cutoff)

- **File:** Trade_Journal/index.html (lines 16709-16743)
- **Module:** Archive System — Data Collection, Zip Building & Finalisation
- **Purpose:** Serializes the zip to a downloadable Blob, triggers a browser file download, then blocks (awaits) until the user has ticked a confirmation checkbox and clicked "Proceed".
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| zip | JSZip | The built archive zip |
| stats | object | `{fileCount, totalBytes, tradeCount, weeklyCount, screenshotCount, ...}` for display |
| cutoff | string | ISO cutoff date (present in signature but not read inside the function body) |

- **Returns:** Promise<void> — resolves once the user clicks Proceed.
- **Internal logic:**
  - Generates the zip Blob via `zip.generateAsync({type:'blob', compression:'DEFLATE', compressionOptions:{level:6}})`.
  - Creates an object URL, a temporary `<a download="trade_journal_archive_{YYYY-MM-DD}.zip">`, appends it, clicks it (triggering the browser's save), then removes it.
  - Schedules `URL.revokeObjectURL` after 60 seconds.
  - Shows the confirmation gate: sets `#archiveConfirmGate` `display:'block'`, resets `#archiveConfirmCheck` to unchecked, and populates `#archiveChecksumDisplay` with formatted MB size plus file/trade/weekly/screenshot counts.
  - Calls `archiveConfirmCheckChanged()` to sync the Proceed button's disabled state.
  - Awaits a `new Promise` whose `resolve` is stashed on `_arc.proceedResolve`; only resolved externally when the user clicks "Proceed" (`archiveProceedAfterConfirm`).
  - Once resolved, hides the confirmation gate.
- **Calls:** archiveConfirmCheckChanged
- **Called by:** runArchive
- **Side effects:** Creates and clicks a temporary anchor to trigger a file download; DOM mutations on `#archiveConfirmGate`, `#archiveConfirmCheck`, `#archiveChecksumDisplay`; sets `_arc.proceedResolve`.
- **Notes:** This is the user-facing safety gate immediately before destructive deletion — it physically blocks the flow until a human confirms via the manual promise-resolve pattern shared with `archiveProceedAfterConfirm`. The `cutoff` parameter appears unused in the function body.

#### runArchiveDestructive(trades, weeklies, blobMap)

- **File:** Trade_Journal/index.html (lines 16746-16779)
- **Module:** Archive System — Data Collection, Zip Building & Finalisation
- **Purpose:** Performs destructive cleanup — deletes screenshot files from Supabase Storage and the corresponding trades/weeklies rows from the database, plus clears local IndexedDB cache entries for those trades.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| trades | array | DB trade rows to delete |
| weeklies | array | DB weekly rows to delete |
| blobMap | Map | Supplies the set of storage paths known to exist |

- **Returns:** Promise<void>
- **Internal logic:**
  - Builds `storagePaths` from `blobMap.keys()`; if non-empty, calls `deleteScreenshotsFromStorage(storagePaths)`.
  - Extracts `tradeIds`/`weeklyIds` from the passed rows.
  - If `tradeIds` non-empty: deletes matching rows from `trades` (scoped to `id IN (...)` and `user_id`); throws a descriptive error on failure.
  - If `weeklyIds` non-empty: same delete against `weeklies`; throws on failure.
  - For each `tradeId`: attempts `_ssDB.remove(id)` wrapped in try/catch ("safe to ignore").
- **Calls:** deleteScreenshotsFromStorage, remove (Supabase `.delete()` builder / `_ssDB.remove`)
- **Called by:** (none detected — verify: not referenced by `runArchive` or anything else in this chunk; `runArchive` instead performs its own inline equivalent logic in Steps 8-9, with more thorough orphan-scanning and batching, rather than calling this function)
- **Side effects:** Supabase Storage file removals; Supabase DELETE on `trades` and `weeklies`; IndexedDB entry removal.
- **Notes:** Appears to be dead/superseded code — `runArchive`'s own Step 8/9 logic duplicates this behavior inline instead of calling it. Highly destructive and irreversible if invoked directly: permanently deletes DB rows and storage files with no confirmation gate of its own (relies on the caller having already gated via `triggerZipDownload`).

#### finaliseArchive(cutoff, logId, stats)

- **File:** Trade_Journal/index.html (lines 16782-16890)
- **Module:** Archive System — Data Collection, Zip Building & Finalisation
- **Purpose:** Final phase of the archive pipeline — computes and persists a new all-time cumulative-stats baseline folding in the just-archived trades, reloads the app's in-memory trade/weekly state from the DB (post-deletion), recomputes the insight snapshot from remaining live data, and marks the `archive_log` row completed.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| cutoff | string | ISO cutoff date for this archive run |
| logId | string\|null | archive_log row id to update |
| stats | object | Summary stats to persist onto the log row |

- **Returns:** Promise<void>
- **Internal logic:**
  - Guard: returns immediately if not logged in.
  - Sets `archivedThrough = nowISO` (the moment before which trades are considered folded into the baseline).
  - Reads all currently-closed, non-intraday trades from `S.trades` (still pre-refresh at this point — DB rows are already deleted, but `S.trades` hasn't been reloaded yet).
  - Gets `prevBase = S.cumulativeStats || _emptyCumulativeStats()`.
  - If `prevBase.archivedThrough` exists (a prior archive ran before), carries forward its 13 numeric fields as `priorArchived` (totalClosed, totalWins, totalLosses, totalBiasMatch, totalBiasTotal, sumR, wins2r, wins15r, wins1r, be, loss05, loss1, totalR); else starts all at 0.
  - Computes `liveSet` = `allClosed` trades whose `closeTime` is after the prior archive's cutoff (or all of them if no prior archive) — trades not already folded into a previous baseline.
  - From `liveSet` computes: wins/losses counts; bias-match/bias-total counts; an array of valid `calcR` values summed as `sumR`; and, restricted to WIN/LOSS trades, R-buckets: `wins2r` (R≥1.5), `wins15r` (1.0≤R<1.5), `wins1r` (0<R<1.0), `be` (−0.2<R<1), `loss05` (−0.5≤R<0), `loss1` (R<−0.5), and `totalR` (sum).
  - Builds `newBaseline` by adding each live-computed number onto the corresponding `priorArchived` field, plus stamps `archivedThrough` and `lastUpdatedAt`.
  - Upserts `newBaseline` into `cumulative_stats` (onConflict `user_id`) and assigns it to `S.cumulativeStats`.
  - Reloads `S.trades`/`S.weeklies` fresh from Supabase in parallel (post-deletion state): trades via a specific column list mapped through `dbToTrade`; weeklies via `select('*')` mapped through `dbToWeekly`; only overwrites on success.
  - Calls `saveInsightSnapshot()` to recompute derived analytics from the now-current live dataset.
  - Calls `_arcUpdateLog(logId, {completed_at: nowISO, status:'completed', stats})`.
- **Calls:** filter, _emptyCumulativeStats, calcR, saveInsightSnapshot, _arcUpdateLog
- **Called by:** runArchive
- **Side effects:** Supabase UPSERT into `cumulative_stats`; Supabase SELECT reloads of `trades`/`weeklies`; mutates `S.cumulativeStats`, `S.trades`, `S.weeklies` (global state); Supabase UPDATE (via `_arcUpdateLog`) on `archive_log`; indirectly writes `insight_snapshots` via `saveInsightSnapshot`.
- **Notes:** The two-baseline design (`priorArchived` + `liveSet`) prevents double-counting: trades already folded into a previous archive's baseline are excluded from `liveSet` by comparing `closeTime` against the prior `archivedThrough` timestamp, so re-running the archive never re-adds the same trades. This step is what guarantees all-time statistics survive after the underlying trade rows are permanently deleted.

### Module: Archive System — Settings Page Display

#### checkPriorIncompleteArchive()

- **File:** Trade_Journal/index.html (lines 16893-16907)
- **Module:** Archive System — Settings Page Display
- **Purpose:** On login/startup, checks whether a previous archive run was left in an `'in_progress'` state and warns the user via toast — signals a prior archive may have failed partway and its zip should be verified before re-running.
- **Parameters:** None
- **Returns:** Promise<void>
- **Internal logic:**
  - Guard: returns if not logged in.
  - try: queries `archive_log` for the most recent row with `status='in_progress'` for this user (order by `started_at` desc, limit 1, `maybeSingle`).
  - If found, shows a `'warn'` toast: "⚠ Prior archive incomplete ({date}) — check zip before re-running".
  - catch: silently ignored (non-critical startup check).
- **Calls:** showToast, _arcFmt
- **Called by:** (none detected — verify: likely invoked once during app initialization/login flow, e.g. by a login-success or `loadAllData` handler not included in this chunk)
- **Side effects:** Supabase SELECT read on `archive_log`; toast notification.
- **Notes:** Purely advisory — does not attempt to resume or auto-clean the incomplete archive.

#### getStorageQuota()

- **File:** Trade_Journal/index.html (lines 16910-16936)
- **Module:** Archive System — Settings Page Display
- **Purpose:** Estimates the current user's total Supabase Storage usage (MB) for the `screenshots` bucket by listing trade-id subfolders and summing file sizes, for the Settings/Archive storage-usage bar.
- **Parameters:** None
- **Returns:** Promise<{usedMB: number, totalMB: number, capped: boolean}>
- **Internal logic:**
  - Guard: if not logged in, returns `{usedMB:0, totalMB:1024, capped:false}`.
  - try: lists up to 200 entries under the user's storage prefix; filters to genuine subfolders (folder entries have no `.metadata`, distinguishing them from files).
  - Caps the number of subfolders scanned to 20 (`cap`); sets `capped=true` if there were more than 20.
  - For each of the (up to 20) scanned subfolders, lists up to 500 files and sums each `f.metadata.size` into `totalBytes`.
  - Whole listing logic wrapped in try/catch — errors leave `totalBytes` at whatever was accumulated (non-critical UI feature).
  - Converts to MB and returns `{usedMB, totalMB:1024, capped}`.
- **Calls:** (Supabase Storage `list` calls; JSON also shows `filter`)
- **Called by:** populateArchiveInfo
- **Side effects:** Multiple read-only Supabase Storage `list` calls against the `screenshots` bucket.
- **Notes:** An approximation, not an exact figure — only scans the first 20 subfolders (by whatever order Storage returns them); `capped:true` signals a heavy user's displayed usage may understate the true total. `totalMB` is hardcoded to 1024 (1 GB) regardless of actual plan/quota.

#### renderArchiveHistory()

- **File:** Trade_Journal/index.html (lines 16939-16971)
- **Module:** Archive System — Settings Page Display
- **Purpose:** Renders a small table on the Settings/Archive page showing the last 5 `archive_log` runs (date, trade/weekly counts, size, status).
- **Parameters:** None
- **Returns:** Promise<void>
- **Internal logic:**
  - Looks up `#archiveHistoryTable`; returns if missing or not logged in.
  - try: fetches the 5 most recent `archive_log` rows (`completed_at,started_at,status,stats`) ordered by `started_at` desc.
  - If no rows, shows "No archive runs yet."
  - Else maps each row into a grid row: formatted date (`_arcFmt`), trade/weekly count text from `stats`, size in MB from `stats.totalBytes`, and a colored status glyph (`✓` green for completed, `…` gold for in_progress, `✕` red otherwise).
  - Sets `innerHTML`.
  - catch: sets `el.textContent = '—'`.
- **Calls:** _arcFmt
- **Called by:** populateArchiveInfo
- **Side effects:** Supabase SELECT read on `archive_log`; DOM mutation on `#archiveHistoryTable`.
- **Notes:** Limited to the 5 most recent runs; no pagination.

#### dismissArchiveBanner()

- **File:** Trade_Journal/index.html (lines 16976-16980)
- **Module:** Archive System — Settings Page Display
- **Purpose:** Hides the quarterly-archive-reminder banner and remembers (for the current page session only) that it was dismissed.
- **Parameters:** None
- **Returns:** void
- **Internal logic:** sets module-level `_archiveBannerDismissed = true`; hides `#archiveReminderBanner` via `style.display='none'` if present.
- **Calls:** (none)
- **Called by:** (none detected — verify: wired via inline `onclick` on the banner's dismiss button)
- **Side effects:** Mutates module-level `_archiveBannerDismissed` (in-memory only, not persisted); DOM mutation on `#archiveReminderBanner`.
- **Notes:** Dismissal is session-only — the banner reappears on the next full page load if still within the due window.

#### showArchiveReminderBanner()

- **File:** Trade_Journal/index.html (lines 16982-17026)
- **Module:** Archive System — Settings Page Display
- **Purpose:** Computes whether a quarterly archive is currently "due" (based on the last completed `archive_log` date, or absence thereof) and shows/hides a reminder banner with dynamic due-date text.
- **Parameters:** None
- **Returns:** Promise<void>
- **Internal logic:**
  - Looks up `#archiveReminderBanner`/`#archiveReminderText`; returns if the banner is missing, already dismissed this session, or not logged in.
  - try: fetches the most recent completed `archive_log` row's `completed_at`.
  - If a prior completed archive exists: due date = 3 calendar months after that archive's month (first of that month, UTC). Else (never archived): due date = current month.
  - Computes the last calendar day of the due month.
  - Shows the banner only if today falls within the due month AND within the last 3 days of that month.
  - If due: sets banner text "Your quarterly archive is due by end of {Month Year}..." and unhides it; else hides it.
  - catch: silently ignored (non-critical).
- **Calls:** (none — pure Date arithmetic plus one Supabase read)
- **Called by:** populateArchiveInfo
- **Side effects:** Supabase SELECT read on `archive_log`; DOM mutation on `#archiveReminderBanner`/`#archiveReminderText`.
- **Notes:** The "due" window is intentionally narrow (last 3 days of the due month) — a late nudge, not a persistent nag; relies on `populateArchiveInfo` being called on each Settings visit to re-evaluate it, since dismissal is only session-scoped.

#### populateArchiveInfo()

- **File:** Trade_Journal/index.html (lines 17029-17117)
- **Module:** Archive System — Settings Page Display
- **Purpose:** Master renderer for the Settings/Archive page section — populates the cutoff-date preview, last-archive-run summary, enables/disables the "Run Archive" button (30-day cooldown + open-trades failsafe), renders the storage-quota bar, archive history table, and reminder banner.
- **Parameters:** None
- **Returns:** Promise<void>
- **Internal logic:**
  - Sets `#archiveCutoffDisplay` to "Will archive: all data before {formatted cutoff}" via `getArchiveCutoffDate()` + `_arcFmt`.
  - If logged in, queries the most recent completed `archive_log` row; sets `#archiveLastRunDisplay` to "Last archive: {date} · N trades" or "Never"/"—" on error; remembers `lastArchiveDate`.
  - Cooldown check: if `lastArchiveDate` exists and `daysSince < 30`, disables `#runArchiveBtn` (dims it) and shows a reason "Last archive was N days ago — available again in M days."; else re-enables and hides the reason.
  - Open-trades failsafe: separately queries a head-count of `status='open'` trades; if any exist, forcibly disables the run button and shows "Archive blocked — N trade(s) still open..." (advisory-only; errors here are non-blocking per an inline comment, since `runArchive` re-checks this itself as the authoritative gate).
  - Storage bar: asynchronously (non-blocking `.then()`) calls `getStorageQuota()` and updates `#archiveStorageBar` width/color (green/gold/red at 60%/80% usage thresholds) and `#archiveStorageText`, appending "(estimated)" if capped; on failure sets "Storage info unavailable".
  - Calls `renderArchiveHistory()` and `showArchiveReminderBanner()`.
- **Calls:** getArchiveCutoffDate, _arcFmt, getStorageQuota, renderArchiveHistory, showArchiveReminderBanner
- **Called by:** populateSettingsPage
- **Side effects:** DOM mutations on `#archiveCutoffDisplay`, `#archiveLastRunDisplay`, `#runArchiveBtn`, `#archiveRunReason`, `#archiveStorageBar`, `#archiveStorageText`; Supabase SELECT reads on `archive_log` (twice, including inside `renderArchiveHistory`) and a head-count read on `trades`; Storage bucket reads via `getStorageQuota`.
- **Notes:** The pre-computed JSON inventory lists `runArchive` as an outbound call of this function, but a direct read of the source (lines 17029-17117) shows no such call in the body — the only textual mention of "runArchive()" nearby is inside a code **comment** at line 17094 ("the hard check in runArchive() still protects the actual run"), which the static analyzer appears to have matched as a call. The real invocation of `runArchive` is via inline `onclick="runArchive()"` on the `#runArchiveBtn` button in the static HTML (around line 6504) — not from any JS function body, including this one. The 30-day cooldown and open-trades checks here are UI-level conveniences only; the true safety guarantee is enforced again inside `runArchive` itself, so failures in these checks can't compromise data integrity.

### Module: Archive System — Master Orchestrator

#### runArchive()

- **File:** Trade_Journal/index.html (lines 17120-17416)
- **Module:** Archive System — Master Orchestrator
- **Purpose:** Master 11-step orchestrator for the entire quarterly archive pipeline — verifies no trades are open, logs the run, fetches all data before the cutoff, collects and downloads screenshots, builds a zip, forces a download and waits for explicit user confirmation, then (only past that point) permanently deletes screenshots from storage and rows from the database, recomputes cumulative stats/insight snapshot, and refreshes the live UI. This is the primary destructive, user-facing action chain documented in this chunk.
- **Parameters:** None
- **Returns:** Promise<void>
- **Internal logic:**
  - Guard: if not logged in, toasts an error and returns.
  - Resets `_arc` state (`logId=null`, `cancelled=false`, `pastPointOfNoReturn=false`, `proceedResolve=null`).
  - Resets all 11 step indicators to `''`, clears status/error banners, hides summary and confirm gate, shows an enabled Cancel button, hides the Done button, shows the modal-close button.
  - Opens `#archiveModal`.
  - Computes `cutoff` via `getArchiveCutoffDate()`.
  - **try block (main flow):**
    - **Failsafe:** queries a head-count of `status='open'` trades; throws if the query itself errors; if `openCount > 0`, shows an error, relabels the Cancel button to "CLOSE", and returns (aborts before writing any log row) — this is the authoritative, non-bypassable safety check.
    - **Step 1:** writes the `archive_log` row (`status:'in_progress'`) via `_arcWriteLog`, storing the id on `_arc.logId`; marks step 1 done; throws sentinel `'CANCELLED'` if `_arc.cancelled` (this cancellation check repeats after every step).
    - **Step 2:** fetches trades & weeklies via `collectArchiveData(cutoff)`; marks step 2 done; cancellation check. If both come back empty, updates the log to `'failed'` (reason "No data to archive"), shows an error, relabels Cancel to "CLOSE", and returns.
    - **Step 3:** collects screenshot URL entries via `collectAllScreenshotUrls`; step 3 done; cancellation check.
    - **Step 4:** downloads all screenshot blobs via `downloadAllScreenshotBlobs`, with a progress callback updating the status text ("Downloading screenshots: X / Y"); step 4 done; cancellation check.
    - **Step 5:** builds the zip via `buildArchiveZip`; step 5 done; cancellation check.
    - **Step 6:** computes size stats via `computeArchiveChecksum`; assembles the final `stats` object (`tradeCount, weeklyCount, screenshotCount, fileCount, totalBytes, cutoff`); step 6 done; cancellation check.
    - **Step 7:** disables the Cancel button (can't cancel once download starts), calls `triggerZipDownload(zip, stats, cutoff)` (triggers browser download, awaits checkbox+Proceed confirmation). Once resolved: sets `_arc.pastPointOfNoReturn=true`, hides both Cancel and modal-Close buttons (irreversible from here), marks step 7 done.
    - **Step 8 (destructive — storage):** defines a nested helper `_extractStoragePath` (documented separately) to normalize dataUrls/`_displayUrl`s into bare storage paths; rebuilds the full delete-list by re-scanning every trade's and weekly's screenshot fields through it; additionally does a direct storage-bucket scan under the user's prefix (listing subfolders then files, up to 1000 each) to catch orphaned files with no DB pointer; deduplicates via `[...new Set(...)]`; batch-deletes in chunks of 100 (Supabase Storage's per-call limit) via repeated `.storage.from('screenshots').remove(batch)` calls, updating status text with progress after each batch — a failed batch only logs a warning and does not abort the loop (non-fatal); marks step 8 done.
    - **Step 9 (destructive — DB rows):** deletes all archived trade ids from `trades` and weekly ids from `weeklies` (both scoped to `user_id`), throwing a descriptive error if either delete fails; also removes each archived trade's IndexedDB cache entry (`_ssDB.remove`, non-fatal); marks step 9 done.
    - **Step 10:** calls `finaliseArchive(cutoff, _arc.logId, stats)` (computes the new cumulative-stats baseline, reloads `S.trades`/`S.weeklies`, recomputes the insight snapshot, marks the log completed); marks step 10 done.
    - **Step 11:** marks step 11 done (formality — the substantive work already happened in Step 10).
    - Refreshes live app state/UI: `touchSyncMeta()`, `saveLocalCache()`, `renderDashboard()`, `renderOpen()`, `updateOpenBadge()`, `updateWeeklyBadge()`, `updateIntradayBadge()`.
    - Displays a completion summary in `#archiveSummaryText` (counts, archive date, archived-through cutoff), shows the summary block, shows the Done button, hides Cancel.
    - Calls `populateArchiveInfo()` and shows a success toast.
  - **catch (e):**
    - If `e.message === 'CANCELLED'`, silently returns (user already saw the cancel toast).
    - Otherwise: finds whichever step is currently `'active'` and flips it to `'error'`.
    - If a log id exists, updates `archive_log` to `'failed'` with `completed_at` and `stats` merged with the error message.
    - Builds a context-aware error message: if past the point of no return, warns the archive is "partially completed" and to verify the zip before re-running (DB may be in an intermediate state); otherwise reassures "no data was deleted — safe to retry."
    - Shows the error, clears the status line, restores the Cancel button relabeled "CLOSE", shows the modal-close button, and shows an error toast.
- **Calls:** showToast, _arcSetStep, _arcStatus, getArchiveCutoffDate, _arcShowError, _arcWriteLog, collectArchiveData, _arcUpdateLog, _arcFmt, collectAllScreenshotUrls, downloadAllScreenshotBlobs, buildArchiveZip, computeArchiveChecksum, triggerZipDownload, _extractStoragePath, remove, finaliseArchive, touchSyncMeta, saveLocalCache, renderDashboard, renderOpen, updateOpenBadge, updateWeeklyBadge, updateIntradayBadge, populateArchiveInfo
- **Called by:** (none detected via actual JS function calls — the JSON lists `populateArchiveInfo` as an inbound caller, but this is a false positive: static analysis appears to have matched the text "runArchive()" inside a **code comment** within `populateArchiveInfo`, not a real call. The actual invocation is via inline `onclick="runArchive()"` on the `#runArchiveBtn` button in the static HTML, around line 6504.)
- **Side effects:** Extensive — DOM mutations across the 11-step modal UI (many element ids); Supabase reads (`archive_log`, `trades`, `weeklies`, storage listings); Supabase writes (`archive_log` insert/update, `trades` delete, `weeklies` delete, storage file removal, `cumulative_stats` upsert via `finaliseArchive`); IndexedDB removals (`_ssDB.remove`); global state mutations (`S.trades`, `S.weeklies`, `S.cumulativeStats` via `finaliseArchive`); `localStorage` write via `saveLocalCache`; triggers a browser file download.
- **Notes:** **This is the primary destructive user-facing action chain in the app.** Key safety mechanisms: (1) a hard failsafe refusing to run if ANY trade is open; (2) a mandatory local zip download plus a user-ticked confirmation checkbox before any deletion begins (`triggerZipDownload`'s gate); (3) a "point of no return" flag that, once set, permanently disables cancellation; (4) an `archive_log` audit-trail row updated at each terminal state (`in_progress` → `completed`/`failed`) so a crashed run can be detected later via `checkPriorIncompleteArchive`; (5) non-fatal treatment of storage-deletion and cache-cleanup errors so a partial failure there doesn't block DB-row cleanup, while DB row deletion failures ARE thrown as fatal (since leaving rows undeleted while the log suggests completion would corrupt the record). **Irreversibility:** once past Step 7 (zip downloaded and confirmed), deletion of Supabase Storage screenshots and DB rows for trades/weeklies dated before the cutoff is permanent — the only backup is the downloaded zip file. The 30-day cooldown and open-trade advisory checks shown on the Settings page (`populateArchiveInfo`) are UI conveniences; this function re-implements the open-trades check itself as the true gate.

#### _extractStoragePath(dataUrl)

- **File:** Trade_Journal/index.html (lines 17244-17255)
- **Module:** Archive System — Master Orchestrator
- **Purpose:** Normalizes a screenshot reference into a bare Supabase Storage path, handling three cases: legacy inline base64 (not storage-backed), a raw storage path, or a legacy persisted `https://` signed/authenticated URL.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| dataUrl | string\|null\|undefined | The screenshot's stored `dataUrl` (or `_displayUrl`) value |

- **Returns:** string\|null — the storage path, or `null` if empty, a `data:` URL, or an unrecognized `https://` URL shape.
- **Internal logic:**
  - If `dataUrl` is falsy or starts with `'data:'`, returns `null` (nothing to delete from storage for inline base64 images).
  - If it starts with `'https://'`: checks two known Supabase Storage URL marker substrings (`'/object/sign/screenshots/'` and `'/object/authenticated/screenshots/'`); if found, returns the substring after the marker up to (excluding) any `'?'` query string; if neither marker matches, returns `null`.
  - Otherwise, assumes the string is already a raw storage path and returns it unchanged.
- **Calls:** (none)
- **Called by:** runArchive (nested function defined and used entirely within `runArchive`'s Step 8 logic)
- **Side effects:** none (pure string function).
- **Notes:** This is a `function` declaration nested inside `runArchive`'s body (not a standalone top-level function) — guards against a historical bug where full signed/"authenticated" HTTPS URLs (rather than bare storage paths) were mistakenly persisted to the DB's `dataUrl`/`_displayUrl` fields, by re-deriving the underlying storage path so deletion still works correctly.

### Module: PWA Install

#### showInstallBanner()

- **File:** Trade_Journal/index.html (lines 17424-17429)
- **Module:** PWA Install
- **Purpose:** Renders the PWA "Install" prompt banner into the page (shown when the browser fires `beforeinstallprompt`).
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Looks up `#installBannerWrap`; returns if missing.
  - Sets its `innerHTML` to a banner with an icon, title/description text, an "INSTALL" button (`onclick="triggerInstall()"`), and a "LATER" button that removes its own closest `.install-banner` ancestor on click.
- **Calls:** triggerInstall, remove
- **Called by:** (none detected as a direct JS call — invoked from the anonymous `'beforeinstallprompt'` window event listener registered just above it: `window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); dip = e; showInstallBanner(); })`)
- **Side effects:** DOM mutation on `#installBannerWrap` (innerHTML).
- **Notes:** The `triggerInstall`/`remove` entries in outboundCalls come from the onclick attribute strings embedded in the returned HTML template literal (textually present in the function body), not from actual JS execution inside `showInstallBanner` itself — they only run later, when a user clicks the corresponding button.

#### triggerInstall()

- **File:** Trade_Journal/index.html (lines 17431-17437)
- **Module:** PWA Install
- **Purpose:** Invokes the browser's native "Add to Home Screen" install prompt using the previously captured `beforeinstallprompt` event, or falls back to instructing the user manually if unavailable.
- **Parameters:** None
- **Returns:** Promise<void>
- **Internal logic:**
  - If the module-level `dip` (deferred install prompt) variable is unset, shows a plain `alert()` telling the user to use the browser menu manually, then returns.
  - Otherwise calls `dip.prompt()`, awaits `dip.userChoice` (result unused beyond awaiting), clears `dip` to `null`, and empties `#installBannerWrap`'s `innerHTML` (removing the banner).
- **Calls:** (none — `dip.prompt()`/`userChoice` are native browser PWA APIs, not app functions)
- **Called by:** showInstallBanner (via its embedded `onclick="triggerInstall()"` button)
- **Side effects:** Triggers the native browser install-prompt UI; DOM mutation clearing `#installBannerWrap`.
- **Notes:** `dip` is a module-level variable set only by the `'beforeinstallprompt'` event handler; if the browser doesn't support the event (or the user already installed/dismissed), `dip` stays `null` and the manual-instruction fallback is used.

### Module: Deeper Insights — Analysis & Rendering

#### computeOpportunityQualityAnalysis()

- **File:** Trade_Journal/index.html (lines 17449-17474)
- **Module:** Deeper Insights — Analysis & Rendering
- **Purpose:** Buckets closed intraday trades by their setup "grade" (A+, A, B, Invalid, from `intraScores.grade`) and computes per-grade win rate, average R, and expectancy — answering "does entry-quality grade correlate with results?"
- **Parameters:** None
- **Returns:** array of 4 objects (one per grade, fixed order `['A+','A','B','Invalid']`), each `{grade, count, wr, avgR, expectancy, wins, losses, avgWin, avgLoss, sumR, sumWinR, sumLossR}` (the zero-count branch omits `avgWin`/`avgLoss`).
- **Internal logic:**
  - Reads `S.insightsMode` to determine the paper/live/combined filter mode.
  - Filters `S.trades` to `isIntraday && closed && has intraScores` plus the mode filter.
  - For each of the 4 fixed grades: filters to trades matching `intraScores.grade === g`.
  - If `count===0`, returns a zeroed placeholder record.
  - Else computes wins/losses, `wr = wins/count*100`; valid (non-null) `calcR()` values across the bucket for `avgR`; separately, valid `calcR()` values restricted to WIN-only/LOSS-only trades for `avgWin`/`avgLoss`; `expectancy = (winPct*avgWin)+(lossPct*avgLoss)`; also returns `sumR`/`sumWinR`/`sumLossR` totals (for later cross-period merging).
- **Calls:** filter, calcR
- **Called by:** renderOpportunityQuality
- **Side effects:** none (pure; reads `S.trades`/`S.insightsMode`).
- **Notes:** The 4 grade buckets are always shown, even at 0 trades. `expectancy` is computed from separately-averaged win/loss R (weighted by win/loss frequency) rather than a flat mean of all R values, so it can later be recombined with historical per-bucket sums via `getMergedInsightData` without recomputing from raw trades.

#### renderOpportunityQuality()

- **File:** Trade_Journal/index.html (lines 17476-17509)
- **Module:** Deeper Insights — Analysis & Rendering
- **Purpose:** Renders the "Opportunity Quality" insights table (grade vs win-rate/avgR/expectancy) on the Deeper Insights page, merging live computation with historical snapshot data, plus a small-sample-size warning.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Looks up `#insight-opp-quality`; returns if missing.
  - `data = getMergedInsightData('opportunityQuality', computeOpportunityQualityAnalysis())`.
  - If total count across buckets is 0, shows "No closed trades yet." and returns.
  - `sampleWarn = true` if any bucket has 1-4 trades (non-zero, under 5).
  - Builds an HTML table (Grade/Trades/Win Rate/Avg R/Expectancy), colored grade pill and expectancy cell (green `>0.2`, gold `>-0.1`, else red).
  - Appends a sample-size warning box if `sampleWarn`.
- **Calls:** getMergedInsightData, computeOpportunityQualityAnalysis
- **Called by:** renderDeeperInsights
- **Side effects:** DOM mutation on `#insight-opp-quality` (innerHTML).
- **Notes:** A `barPct` value is computed per row (for a potential bar visualization) but is not visibly wired to any element in the row markup — possibly vestigial or used by CSS not present in this chunk.

#### computeAlignmentAnalysis()

- **File:** Trade_Journal/index.html (lines 17512-17537)
- **Module:** Deeper Insights — Analysis & Rendering
- **Purpose:** Buckets closed intraday trades by daily-bias alignment classification (Strong/Moderate/Conflict) and computes win rate/avgR/expectancy per bucket — measuring whether alignment with the daily bias predicts outcomes.
- **Parameters:** None
- **Returns:** array of 3 objects (one per `['Strong','Moderate','Conflict']`), same stat shape as `computeOpportunityQualityAnalysis` but keyed by `alignment`.
- **Internal logic:** Same pattern as `computeOpportunityQualityAnalysis` — mode-filtered base set (`isIntraday && closed` + paper/live/combined filter, no `intraScores` requirement); bucket by `intraAlignment === g`; zero-count guard; else compute wins/losses/wr/avgR/winR/lossR/avgWin/avgLoss/expectancy/sums.
- **Calls:** filter, calcR
- **Called by:** renderAlignment
- **Side effects:** none (pure).
- **Notes:** Unlike `computeOpportunityQualityAnalysis`, doesn't require `t.intraScores` to be truthy — only a matching `intraAlignment` field.

#### renderAlignment()

- **File:** Trade_Journal/index.html (lines 17539-17583)
- **Module:** Deeper Insights — Analysis & Rendering
- **Purpose:** Renders the "Alignment Analysis" section as three colored cards (Strong/Moderate/Conflict) with count/win-rate/avgR/expectancy, a "hard kill" warning on the Conflict card, and an auto-generated Strong-vs-Moderate comparison insight.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Standard el-lookup/data-merge/empty-check (`#insight-alignment`, `getMergedInsightData('alignment', computeAlignmentAnalysis())`).
  - Builds 3 colored cards (green/Strong, gold/Moderate, red/Conflict) with count, win rate, avg R (bull/bear colored), expectancy; Conflict card adds a bold "⛔ HARD KILL — NO TRADE" line.
  - Auto-insight: if both Strong and Moderate have ≥2 trades and Strong's `avgR` exceeds Moderate's by >0.2R, appends a highlighted comparison box.
- **Calls:** getMergedInsightData, computeAlignmentAnalysis
- **Called by:** renderDeeperInsights
- **Side effects:** DOM mutation on `#insight-alignment` (innerHTML).
- **Notes:** The "HARD KILL" label reflects the app's rule that Conflict-alignment setups should never be traded — surfaced here visually rather than as neutral stats.

#### computeContextAnalysis()

- **File:** Trade_Journal/index.html (lines 17586-17619)
- **Module:** Deeper Insights — Analysis & Rendering
- **Purpose:** Buckets closed intraday trades (with `intraScores`) by HTF "context score" (bucketed 90-100/80-89/70-79/below-70) and computes win rate/avgR/expectancy per bucket — testing whether higher context scores correlate with better outcomes.
- **Parameters:** None
- **Returns:** array of 4 range-bucketed stat objects, keyed by `range`.
- **Internal logic:** Mode-filtered base set (`isIntraday && closed && intraScores` present); for each of the 4 fixed score ranges, filters trades where `intraScores.contextScore` (default 0) falls in `[min,max]`; same zero-guard/else stat computation pattern as prior compute* functions.
- **Calls:** filter, calcR
- **Called by:** renderContext
- **Side effects:** none (pure).
- **Notes:** Ranges are fixed thresholds, not adaptive to the data's actual distribution.

#### renderContext()

- **File:** Trade_Journal/index.html (lines 17621-17662)
- **Module:** Deeper Insights — Analysis & Rendering
- **Purpose:** Renders the "Context Score" breakdown table plus an auto-detected "breakeven threshold" — the lowest-scoring range at which expectancy is positive with ≥3 trades.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Standard el-lookup/merge/empty-check (`#insight-context`, `getMergedInsightData('context', computeContextAnalysis())`).
  - Builds a 5-column table (Context Score/Trades/Win Rate/Avg R/Expectancy) with expectancy-colored cells.
  - Auto-insight: iterates `data` from index `length-1` down to `0`; since `data`'s bucket order is `[90-100,80-89,70-79,Below70]`, this walks from the **lowest**-scoring range upward toward the highest, recording the first (i.e. lowest-quality) range with `expectancy>0 && count>=3` as `threshold`, then breaks.
  - If found, appends "Context scores in the {threshold} range or higher show positive expectancy."
- **Calls:** getMergedInsightData, computeContextAnalysis
- **Called by:** renderDeeperInsights
- **Side effects:** DOM mutation on `#insight-context` (innerHTML).
- **Notes:** The reverse-order scan reports the loosest (lowest) range that already clears breakeven — not necessarily the single highest-expectancy range.

#### computeSetupAnalysis()

- **File:** Trade_Journal/index.html (lines 17665-17698)
- **Module:** Deeper Insights — Analysis & Rendering
- **Purpose:** Same range-bucketing pattern as `computeContextAnalysis` but keyed on `intraScores.setupScore` — tests whether setup-quality score correlates with results.
- **Parameters:** None
- **Returns:** array of 4 range-bucketed stat objects.
- **Internal logic:** Identical structure to `computeContextAnalysis`, substituting `t.intraScores?.setupScore||0` as the bucketing value.
- **Calls:** filter, calcR
- **Called by:** renderSetup
- **Side effects:** none (pure).
- **Notes:** none additional beyond `computeContextAnalysis`.

#### renderSetup()

- **File:** Trade_Journal/index.html (lines 17700-17738)
- **Module:** Deeper Insights — Analysis & Rendering
- **Purpose:** Renders the "Setup Score" breakdown table with the same threshold-detection auto-insight pattern as `renderContext`, phrased as a "setup quality breakeven threshold."
- **Parameters:** None
- **Returns:** void
- **Internal logic:** Same as `renderContext`, sourced from `#insight-setup`/`computeSetupAnalysis()`; auto-insight message: "Your setup quality breakeven threshold appears to be {threshold}."
- **Calls:** getMergedInsightData, computeSetupAnalysis
- **Called by:** renderDeeperInsights
- **Side effects:** DOM mutation on `#insight-setup` (innerHTML).
- **Notes:** none additional.

#### computeExecutionAnalysis()

- **File:** Trade_Journal/index.html (lines 17741-17774)
- **Module:** Deeper Insights — Analysis & Rendering
- **Purpose:** Same range-bucketing pattern keyed on `intraScores.execScore` — tests whether execution-quality score correlates with results.
- **Parameters:** None
- **Returns:** array of 4 range-bucketed stat objects.
- **Internal logic:** Identical structure, substituting `t.intraScores?.execScore||0`.
- **Calls:** filter, calcR
- **Called by:** renderExecution
- **Side effects:** none (pure).
- **Notes:** none additional.

#### renderExecution()

- **File:** Trade_Journal/index.html (lines 17776-17813)
- **Module:** Deeper Insights — Analysis & Rendering
- **Purpose:** Renders the "Execution Score" breakdown table, plus a special auto-insight comparing average context/setup/execution scores to flag when execution is the *lowest* of the three (via `computeProcessAverages()`) and below 70 — suggesting execution technique isn't the main bottleneck.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Standard el-lookup/merge/empty-check (`#insight-execution`, `computeExecutionAnalysis()`).
  - Builds the same 4-range table.
  - Calls `computeProcessAverages()` for `{context, setup, execution}` averages; if the minimum of the three equals `avg.execution` AND `avg.execution<70`, appends a warning box.
- **Calls:** getMergedInsightData, computeExecutionAnalysis, computeProcessAverages
- **Called by:** renderDeeperInsights
- **Side effects:** DOM mutation on `#insight-execution` (innerHTML).
- **Notes:** The only one of the three score-based renderers (context/setup/execution) that cross-references the other two scores' averages for its auto-insight, rather than a self-contained threshold scan.

#### computeSetupComponentAnalysis()

- **File:** Trade_Journal/index.html (lines 17816-17847)
- **Module:** Deeper Insights — Analysis & Rendering
- **Purpose:** Buckets closed intraday trades by presence/absence of each individual execution-sequence component (liquidity taken, strong/weak displacement, MSS, retracement+confirmation) and computes win rate/avgR/expectancy for trades where that component was present — identifying which checklist components most correlate with good outcomes.
- **Parameters:** None
- **Returns:** array of 5 objects (`lq`, `disp` [Strong], `dispWeak` [Weak], `mss`, `ret`), each `{key, label, count, wr, avgR, expectancy, wins, losses, sumR, sumWinR, sumLossR}`.
- **Internal logic:**
  - Mode-filtered base set: `isIntraday && closed && intraExData` present, plus paper/live/combined filter.
  - Defines 5 named components with boolean predicates against `intraExData` fields: `lq` (`lq===true`), `disp` (`disp==='Strong'`), `dispWeak` (`disp==='Weak'`), `mss` (`mss===true`), `ret` (`ret===true`).
  - For each component, filters trades where the predicate is true; zero-guard else computes standard wins/losses/wr/avgR/winR/lossR/avgWin/avgLoss/expectancy/sums.
- **Calls:** filter, calcR
- **Called by:** renderComponents
- **Side effects:** none (pure).
- **Notes:** Unlike the range-bucketed analyses, these buckets are NOT mutually exclusive — a single trade can count toward multiple components simultaneously (e.g. both `lq` and `mss`), since each component is evaluated independently against the full filtered trade set rather than partitioning trades into disjoint groups.

#### renderComponents()

- **File:** Trade_Journal/index.html (lines 17849-17891)
- **Module:** Deeper Insights — Analysis & Rendering
- **Purpose:** Renders the "Setup Component Analysis" table (one row per execution-sequence component) showing trade count and associated win rate/avgR/expectancy, merging live data with a persisted historical component snapshot.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Looks up `#insight-components`; returns if missing.
  - Computes live `data` via `computeSetupComponentAnalysis()`.
  - Custom (bespoke, inline) merge: reads `S.insightSnapshot?.components`; if present, for each live bucket `d`, finds the matching historical bucket `h` by key and, if found, combines `count`/`wins`/`losses`/`sumR` by simple addition, recomputes `avgR = sumR/count` and `wr = wins/count*100`, and recomputes `expectancy` via `(wr/100*avgR) + ((1-wr/100) * impliedAvgLoss)` where `impliedAvgLoss = losses>0 ? (sumR - wins*avgR)/losses : 0`.
  - If total merged count is 0, shows "No closed intraday trades with component data." and returns.
  - Builds a table (Component/Present/Win Rate/Avg R/Expectancy) with expectancy-colored cells.
- **Calls:** computeSetupComponentAnalysis
- **Called by:** renderDeeperInsights
- **Side effects:** DOM mutation on `#insight-components` (innerHTML); reads `S.insightSnapshot`.
- **Notes:** Unlike the other five `render*` functions in this Deeper Insights section, this one does **not** delegate to the shared `getMergedInsightData` helper — it hand-rolls its own merge-with-history logic inline, which is worth flagging as an inconsistency/possible duplication in the codebase. The expectancy recombination formula is an approximation that reconstructs an implied average loss from the combined `sumR`/`avgR`/`wins`, since per-component `avgWin`/`avgLoss` aren't stored in the historical snapshot — only counts and `sumR`.


---

## Trade_Journal — Functions (chunk 6 of 8, lines 17894-19368)

### Module: Analytics / Insights — Deeper Insights Panel

This block implements Sections 7-12 (plus an "Extra Insights" section) of the
"Deeper Insights" analytics panel. Each section follows a `compute*()` /
`render*()` pair: the `compute*` function derives pure data from `S.trades`
(optionally merged with a historical `S.insightSnapshot` aggregate so archived
trades still count), and the `render*` function turns that data into HTML
written into a specific `#insight-*` container. `renderDeeperInsights()` is the
master orchestrator called on navigation into the Insights tab.

#### computeModelPerformanceAnalysis()

- **File:** Trade_Journal/index.html (lines 17894-17903)
- **Module:** Analytics / Insights
- **Purpose:** Computes per-model (Weekly Bias, Daily Omar, TTrades) prediction accuracy and average R, using the shared canonical helper so figures match the dashboard's Model Accuracy bar exactly.
- **Parameters:** None
- **Returns:** `Object` — `{ weekly: {count, acc, avgR}, omar: {count, acc, avgR}, tt: {count, acc, avgR} }`.
- **Internal logic:**
  - Calls `_canonicalModelStats(S.insightSnapshot?.modelPerf)`, which already folds in the historical snapshot merge.
  - Repackages the three sub-objects, defaulting `acc` to `0` if falsy (keeps `avgR` untouched, i.e. `avgR` can be `undefined`/`0` as computed upstream).
- **Calls:** `_canonicalModelStats`
- **Called by:** `renderModelPerf`
- **Side effects:** None (pure read of `S.insightSnapshot`).
- **Notes:** Comment explicitly states this exists so accuracy % is identical to the dashboard's Model Accuracy bar (AC-003/AC-006 — internal acceptance-criteria tags used throughout this section).

#### renderModelPerf()

- **File:** Trade_Journal/index.html (lines 17905-17948)
- **Module:** Analytics / Insights
- **Purpose:** Renders the 3-card Model Performance comparison (Weekly Bias vs Daily Omar vs TTrades) into the insights panel, including a "best model" auto-insight callout.
- **Parameters:** None
- **Returns:** `void`
- **Internal logic:**
  - Guards on `#insight-model-perf` missing.
  - Gets data via `computeModelPerformanceAnalysis()`; if total count across all three models is 0, shows a "No model performance data yet" placeholder and returns.
  - Builds a 3-column grid, one card per model, each colored by a fixed palette (Weekly Bias indigo, Omar gold, TTrades green).
  - Per card: colors accuracy green/gold/red thresholds (≥65% / ≥45% / below) and avg-R thresholds (≥0.3R / ≥0 / below) — but only applies color logic when `count >= 3`; otherwise both metrics render in muted gray with a "⚠️ Need 3+ for reliable comparison" caption.
  - Auto-insight: filters `[data.omar, data.tt]` to those with `count >= 3`; if ≥2 qualify, picks the highest-accuracy one via `reduce` and appends a callout sentence.
  - Writes final HTML to `el.innerHTML`.
- **Calls:** `computeModelPerformanceAnalysis`, `filter` (Array.prototype.filter on `[data.omar, data.tt]`)
- **Called by:** `renderDeeperInsights`
- **Side effects:** DOM — writes `#insight-model-perf` innerHTML.
- **Notes:** Bug: the "best model" label logic (`models === data.omar ? 'Omar' : 'TTrades'`) compares the *filtered array* `models` to the raw object `data.omar` — this reference comparison is always `false` (an array is never `===` to an object), so `bestLabel` is always `'TTrades'` regardless of which model actually won on `best.acc`. Only the numeric `best.acc` value is guaranteed correct; the printed model name can be wrong.

#### computeCaptureRateAnalysis()

- **File:** Trade_Journal/index.html (lines 17951-17961)
- **Module:** Analytics / Insights
- **Purpose:** Measures how many identified A+ grade intraday setups were actually taken vs. skipped ("A+ Capture Rate"), and estimates the R left on the table from missed ones.
- **Parameters:** None
- **Returns:** `Object` — `{ available, taken, captureRate, missed, avgR, missedR }`.
- **Internal logic:**
  - `all` = closed intraday trades graded `A+` (`t.intraScores?.grade === 'A+'`).
  - `available` = `all.length`; `taken` = subset where `result !== 'SKIP'`.
  - `captureRate` = `taken/available*100` (0 if none available).
  - `missed = available - taken`.
  - `avgR` = mean of `calcR(t)` over taken trades (non-null only).
  - `missedR` = `missed * avgR` — an *estimate* assuming missed trades would have performed at the same average R as the taken ones.
- **Calls:** `filter` (Array.prototype), `calcR`
- **Called by:** `renderCapture`, `computeAllLeaks`
- **Side effects:** None (pure read of `S.trades`).
- **Notes:** `missedR` is a projection, not measured data — it multiplies a count by an average, so it is only meaningful when `avgR` is based on a reasonable sample size.

#### renderCapture()

- **File:** Trade_Journal/index.html (lines 17963-18004)
- **Module:** Analytics / Insights
- **Purpose:** Renders the A+ Capture Rate donut chart and missed-opportunity summary, merging live data with the historical snapshot's capture-rate aggregate.
- **Parameters:** None
- **Returns:** `void`
- **Internal logic:**
  - Guards on `#insight-capture` missing.
  - Computes live `data` via `computeCaptureRateAnalysis()`.
  - If `S.insightSnapshot?.captureRate` exists, merges: sums `available`/`taken` across live+snapshot, reconstructs a weighted `sumR` (`live avgR*live taken` + snapshot's stored `sumR`) to get a correctly weighted merged `avgR`, then recomputes `missed`/`captureRate`/`missedR` from the merged totals.
  - If merged `available === 0`, shows a "No A+ opportunities identified yet" placeholder.
  - Renders a CSS conic-gradient donut (`pct` capped at 100) colored bull/gold/bear by 70%/40% thresholds, with capture count, missed count, and (if any missed) estimated missed R.
  - If `missed > 0 && missedR > 0.5`, appends a "💡 capturing X%..." advisory callout.
- **Calls:** `computeCaptureRateAnalysis`
- **Called by:** `renderDeeperInsights`
- **Side effects:** DOM — writes `#insight-capture` innerHTML.
- **Notes:** The snapshot-merge math is careful to avoid double counting — it reconstructs a "total R sum" from the live average (`avgR * taken`) rather than just averaging the two averages, which would be wrong when live/snapshot sample sizes differ.

#### computeRuleViolationAnalysis(month, year)

- **File:** Trade_Journal/index.html (lines 18007-18077)
- **Module:** Analytics / Insights
- **Purpose:** Detects three categories of process-rule violations among closed intraday trades — trading twice in a day, taking a trade despite an alignment "Conflict", and taking a trade despite the execution engine saying "WAIT" — and quantifies their R impact.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| month | number \| undefined | 1-based month to scope the analysis to (optional). |
| year | number \| undefined | Full year to scope the analysis to (optional). |

- **Returns:** `Array<{type, count, sumR, impact, desc}>` — one entry per violation category that has at least one occurrence.
- **Internal logic:**
  - Filters `S.trades` to closed intraday trades; if both `month` and `year` are given, further restricts to trades whose `t.date` falls in that calendar month (parsed as local midnight via `new Date(t.date+'T00:00:00')`). With no args, considers all-time closed intraday trades.
  - **Second Trade Attempt:** groups trades by `t.date`; for any date with >1 trade, every trade after the first counts as a violation; sums their `calcR` values.
  - **Conflict Trades:** trades where `intraAlignment === 'Conflict'`; sums R.
  - **Incomplete Setup:** trades where `intraDecision === 'WAIT'` (i.e. taken despite the engine recommending no trade); sums R.
  - Each violation category is only pushed to the result array if its count > 0.
  - `impact` is always set equal to `sumR` (comment notes this is intentional so the two fields stay consistent — AC-002).
- **Calls:** `filter`, `attempt` (not a real function call — static analysis false positive; `attempt`/`attempts` are only local variable/property names like `secondAttempts`, not calls), `calcR`
- **Called by:** `renderViolations`, `computeMonthlyInsights`
- **Side effects:** None (pure read of `S.trades`).
- **Notes:** `month`/`year` are optional — this function is reused both for the all-time Section 9 view (no args) and for the Section 12 Monthly Insights "most common violation" figure (scoped args). The `attempt` entry in outboundCalls (from the static analyzer) is spurious; there is no such function being invoked.

#### renderViolations()

- **File:** Trade_Journal/index.html (lines 18079-18120)
- **Module:** Analytics / Insights
- **Purpose:** Renders the all-time Rule Violation bar list (Section 9), merging live violation counts/impact with the historical snapshot's per-type aggregates.
- **Parameters:** None
- **Returns:** `void`
- **Internal logic:**
  - Guards on `#insight-violations` missing.
  - Computes live `data` via `computeRuleViolationAnalysis()` (no month/year → all-time).
  - If `S.insightSnapshot?.violations` exists, for each live violation type finds the matching snapshot entry by `type` and adds `count`/`sumR` together (both already represent "total R", not averages), setting `impact = sumR`.
  - If no violations at all, shows a "✅ No rule violations detected" placeholder.
  - Otherwise renders one row per violation type: a proportional bar (width relative to `maxCount` across all shown types), the R impact (colored bear/gold depending on sign), and a description line.
  - If total impact across all types is < -1R, appends a red "⚠️ Rule violations are costing approximately XR total" warning.
- **Calls:** `computeRuleViolationAnalysis`
- **Called by:** `renderDeeperInsights`
- **Side effects:** DOM — writes `#insight-violations` innerHTML.
- **Notes:** Bar width uses `d.bar-fill` always styled `background:var(--bear)` regardless of sign — only the numeric impact text is color-coded, the bar itself is always red-tinted.

#### computeNoTradeAnalysis()

- **File:** Trade_Journal/index.html (lines 18123-18153)
- **Module:** Analytics / Insights
- **Purpose:** Evaluates "patience" — of all skipped (non-intraday) trades, how many were justified by the Daily Bias engine actually recommending no trade — and estimates the R protected by correct skips.
- **Parameters:** None
- **Returns:** `Object` — `{ totalSkips, correctSkips, correctRate, avgLoss, protection }`.
- **Internal logic:**
  - `skipped` = closed, non-intraday trades with `result === 'SKIP'`.
  - `noTradeDecisions` = subset of `skipped` where either (a) any `checklistKills` flag is true, or (b) re-running the relevant Daily Bias engine on the trade's stored `checklistAnswers` yields a "no trade" state: for `checklistModel === 'ttrades'` this means `runTTEngine(ans).state === 'range'`; otherwise (`'omar'` default) `runHTFEngine(ans).state === 'neutral'`.
  - `correctSkips` = `noTradeDecisions.length`; `correctRate` = `correctSkips/totalSkips*100`.
  - Separately computes `avgLoss` = mean `calcR` over closed, non-intraday, `result==='LOSS'` trades.
  - `protection` = `correctSkips * abs(avgLoss)` — an estimate of R saved by correctly not trading.
- **Calls:** `filter`, `runTTEngine`, `runHTFEngine`, `calcR`
- **Called by:** `renderNoTrade`
- **Side effects:** None (pure read of `S.trades`).
- **Notes:** Comment explicitly documents that Intraday Execution Engine fields (`intraDecision`/`intraKill`) intentionally don't apply here, since this function only ever looks at non-intraday (Daily Bias layer) trades, where those fields are never populated.

#### renderNoTrade()

- **File:** Trade_Journal/index.html (lines 18155-18192)
- **Module:** Analytics / Insights
- **Purpose:** Renders the No-Trade / Patience analysis (Section 10): total skips, correct skips, and patience rate, plus an estimated-protection callout.
- **Parameters:** None
- **Returns:** `void`
- **Internal logic:**
  - Guards on `#insight-notrade` missing.
  - Computes live `data`; if `S.insightSnapshot?.noTrade` exists, adds the snapshot's `skipCount` into `totalSkips` — but explicitly leaves `correctSkips` unmerged, since the engine's re-evaluation logic cannot be re-run against archived-only aggregate data (comment: "cannot recompute for archived trades").
  - If merged `totalSkips === 0`, shows "No skipped trades yet" placeholder.
  - Renders a 3-tile row: Total Skips, Correct Skips (colored bull/gold by whether `correctRate >= 60`), Patience Rate %.
  - If `protection > 0.5`, appends a green "🛡️ Correct skips are protecting approximately XR" callout.
- **Calls:** `computeNoTradeAnalysis`
- **Called by:** `renderDeeperInsights`
- **Side effects:** DOM — writes `#insight-notrade` innerHTML.
- **Notes:** Because `correctSkips` is not merged with snapshot data while `totalSkips` is, the displayed `correctRate` (computed live, pre-merge) can understate the true historical patience rate once trades have been archived — this is a known, deliberate limitation per the inline comment.

#### computeAllLeaks()

- **File:** Trade_Journal/index.html (lines 18195-18243)
- **Module:** Analytics / Insights
- **Purpose:** Runs a fixed rule-set over several process metrics (execution, context, setup scores; B-grade frequency; A+ capture rate; alignment-conflict frequency) to identify and rank the biggest current performance leaks.
- **Parameters:** None
- **Returns:** `Array<{title, metric, impact, focus, priority}>` sorted ascending by `priority` (1=highest priority).
- **Internal logic:**
  - Gathers `avg` via `computeProcessAverages()`, `gradePerf` via `computeGradePerformance()` (both external to this chunk).
  - Computes intraday-specific stats: `conflictPct` (share of closed intraday trades with `intraAlignment==='Conflict'`), `bPct` (share of graded intraday trades graded `'B'` or `'Invalid'`), and `capture` via `computeCaptureRateAnalysis()`.
  - Defines 6 candidate "leak rules", each with a `check()` predicate, a `metric()` formatter, an `impact()` description, and a `focus` recommendation string:
    1. Execution Score < 65
    2. Context Quality < 65
    3. Setup Quality < 65
    4. B-grade trades > 40% of graded intraday trades
    5. A+ Capture Rate < 60% (only if any A+ setups exist)
    6. Alignment Violations: conflict-trade share > 10%
  - Filters to rules whose `check()` is true, maps to a display object, and assigns a `priority` (Execution=1, Context=2, Setup=3, everything else=4), then sorts ascending by priority.
- **Calls:** `computeProcessAverages`, `computeGradePerformance`, `filter`, `computeCaptureRateAnalysis`
- **Called by:** `renderLeaks`
- **Side effects:** None (pure read of `S.trades` plus the two external compute helpers).
- **Notes:** Ties among priority-4 rules (grade %, capture rate, alignment) are NOT broken further — `Array.prototype.sort` is stable in modern JS engines, so their relative order follows the `rules` array's declaration order (bPct check before capture-rate check before conflict check) when multiple 4-priority leaks are active simultaneously.

#### renderLeaks()

- **File:** Trade_Journal/index.html (lines 18245-18271)
- **Module:** Analytics / Insights
- **Purpose:** Renders the "Biggest Performance Leak" panel (Section 11) — the top 3 ranked leaks from `computeAllLeaks()`, or a success state if none are active.
- **Parameters:** None
- **Returns:** `void`
- **Internal logic:**
  - Guards on `#insight-leaks` missing.
  - If `computeAllLeaks()` returns an empty array, renders a green "✅ No significant performance leaks detected" card.
  - Otherwise takes `leaks.slice(0,3)` and renders a ranked list (`#1`, `#2`, `#3`) each showing title, metric, impact description, and a "🎯 focus" recommendation line.
- **Calls:** `computeAllLeaks`
- **Called by:** `renderDeeperInsights`
- **Side effects:** DOM — writes `#insight-leaks` innerHTML.
- **Notes:** The `isWarn` local variable (computed from the leak title containing "Score"/"Quality"/"Violations") is computed but never actually used in the rendered HTML — dead code left over from a prior styling variant.

#### computeMonthlyInsights(month, year)

- **File:** Trade_Journal/index.html (lines 18274-18372)
- **Module:** Analytics / Insights
- **Purpose:** For a given calendar month, finds the single strongest/weakest pattern across six dimensions (alignment, setup component, grade, rule violation, session, pair) to surface as "Monthly Insights" cards (Section 12).
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| month | number | 1-based month (1-12) to analyze. |
| year | number | Full year to analyze. |

- **Returns:** `Object | null` — `null` if there are no closed non-intraday trades that month; otherwise `{ trades, bestAlign, bestAlignR, worstComp, worstCompR, bestGrade, bestGradeR, topVio, bestSession, bestSessionR, bestPair, bestPairR }`.
- **Internal logic:**
  - `trades` = closed, non-intraday trades whose `t.date` falls in `month`/`year`. Returns `null` immediately if empty.
  - `intra` = closed intraday trades in the same month, sourced independently from `S.trades` (explicit code comment warns that filtering the already-non-intraday `trades` array here would always yield empty, since `trades` excludes `isIntraday`).
  - **Best alignment:** for each of `['Strong','Moderate','Conflict']`, requires ≥2 intraday trades with that `intraAlignment`; computes mean `calcR`; tracks the group with the highest average (`bestAlignR` starts at `-999`).
  - **Weakest component:** for each of `['lq','disp','mss','ret']` (Liquidity/Displacement/MSS/Return+Confirmation), requires ≥2 intraday trades with `intraExData[c] === true`; tracks the *lowest* average R (`worstCompR` starts at `999`).
  - **Best grade:** for each of `['A+','A','B','Invalid']`, requires ≥2 intraday trades with that `intraScores.grade`; tracks highest average R.
  - **Most common violation:** calls `computeRuleViolationAnalysis(month, year)` (month-scoped) and picks the entry with the highest `count` via `reduce`.
  - **Best session:** for each of `['London','NY Open','NY Expansion','Asia']`, requires ≥2 (non-intraday) `trades` with that `session`; tracks highest average R.
  - **Best pair:** for each unique pair present in `trades`, requires ≥2 trades; tracks highest average R.
  - All "requires ≥2" group thresholds intentionally skip statistically weak samples (comment implied by the later UI text "need at least 2 trades per group").
- **Calls:** `filter`, `calcR`, `computeRuleViolationAnalysis`
- **Called by:** `renderMonthlyInsights`
- **Side effects:** None (pure read of `S.trades`).
- **Notes:** Best-session/best-pair use the pre-filtered non-intraday `trades` array (Daily Bias trades), while best-alignment/best-component/best-grade use the independently-filtered `intra` array (Intraday Execution trades) — these represent two different trade populations within the same month, which is intentional given the app's Weekly→Daily→Intraday hierarchy.

#### _monthlyDataFromSnapshot(sm, month, year)

- **File:** Trade_Journal/index.html (lines 18376-18413)
- **Module:** Analytics / Insights
- **Purpose:** Reconstructs the same display-data shape as `computeMonthlyInsights` from a pre-aggregated snapshot object, for months whose trades have been archived out of live `S.trades`.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| sm | Object | A single month's snapshot aggregate (from `S.insightSnapshot.monthly[ym]`) — has `alignData`, `compData`, `gradeData`, `sessionData`, `pairData`, `swingCount`. |
| month | number | Unused inside the function body (see Notes). |
| year | number | Unused inside the function body (see Notes). |

- **Returns:** `Object` — same shape as `computeMonthlyInsights`'s return value, except `topVio` is always `null`.
- **Internal logic:**
  - Best alignment: iterates `sm.alignData` (array of `{alignment, count, sumR}`), skips entries with `count<2`, tracks the alignment with the highest `sumR/count` average.
  - Worst component: iterates the fixed `['lq','disp','mss','ret']` keys against `sm.compData` (object keyed by component), skips `count<2`, tracks lowest average.
  - Best grade: iterates `sm.gradeData` (array of `{grade,count,sumR}`), skips `count<2`, tracks highest average.
  - Best session / best pair: iterates `Object.entries(sm.sessionData||{})` / `Object.entries(sm.pairData||{})`, skips `count<2`, tracks highest average for each.
  - Returns `trades: sm.swingCount||0` (note: field name `trades` maps to `swingCount`, i.e. non-intraday "swing" trade count) alongside all the derived bests, with `topVio` hardcoded `null` since violation history isn't part of the snapshot's per-month structure available here.
- **Calls:** (none)
- **Called by:** `renderMonthlyInsights`
- **Side effects:** None (pure function over its `sm` argument).
- **Notes:** The `month` and `year` parameters are accepted but never referenced in the function body — dead parameters, likely kept only for call-site symmetry with `computeMonthlyInsights(month, year)`.

#### renderMonthlyInsights()

- **File:** Trade_Journal/index.html (lines 18415-18510)
- **Module:** Analytics / Insights
- **Purpose:** Renders the Section 12 Monthly Insights cards for whichever month is selected in the month dropdown, falling back to a reconstructed snapshot view if the live month has no data (i.e. it was archived).
- **Parameters:** None
- **Returns:** `void`
- **Internal logic:**
  - Guards on `#insight-monthly` missing.
  - Reads the selected value from `#insightMonthSelect`. If it contains a `-` (i.e. `"YYYY-MM"` format), splits into `year`/`month`; otherwise treats it as a bare month number and falls back to `S.insightMonth`/current month, and `S.insightYear`/current year.
  - Computes `data` via `computeMonthlyInsights(month, year)`.
  - If `data` is null/empty (`trades===0`), builds the `"YYYY-MM"` key and looks up `S.insightSnapshot?.monthly?.[ym]`; if that snapshot month has `swingCount>0`, reconstructs `data` via `_monthlyDataFromSnapshot`.
  - If still no data, shows a "No closed trades found for <Month> <Year>" placeholder (month name via `toLocaleString('default',{month:'long'})`).
  - Builds up to 6 `insights` entries conditionally, each only added if its metric is meaningfully positive/negative (e.g. `bestAlign` only added if `bestAlignR > 0`; `worstComp` only if `worstCompR < 0`; `bestGrade` only if `bestGradeR > 0.3`; `topVio` only if `count > 0`; `bestSession`/`bestPair` only if their R > 0):
    1. Strongest Edge (best alignment)
    2. Weakest Pattern (worst component, using a label map `{lq:'Liquidity Event', disp:'Displacement', mss:'MSS', ret:'Return + Confirmation'}`)
    3. Most Profitable Grade
    4. Most Common Rule Violation
    5. Best Session
    6. Best Performing Pair
  - If no insight card qualifies, shows "Not enough data for insights this month (need at least 2 trades per group)".
  - Otherwise renders a trade-count caption plus one card per insight, colored `mi-positive`/`mi-negative` based on whether the `result` string contains a `-` sign.
- **Calls:** `computeMonthlyInsights`, `_monthlyDataFromSnapshot`
- **Called by:** `renderDeeperInsights`
- **Side effects:** DOM — reads `#insightMonthSelect` value, writes `#insight-monthly` innerHTML. Reads (does not write) `S.insightMonth`/`S.insightYear`/`S.insightSnapshot`.
- **Notes:** The positive/negative CSS class is derived from whether the *formatted result string* contains a literal `-` character (e.g. `"-0.30R"`) rather than from the underlying numeric sign directly — works correctly here since all six `result` strings are built with explicit sign formatting, but it's a string-based heuristic rather than a numeric comparison.

#### populateMonthSelector()

- **File:** Trade_Journal/index.html (lines 18512-18548)
- **Module:** Analytics / Insights
- **Purpose:** Rebuilds the `<select>` dropdown used to choose which month's Monthly Insights (Section 12) to view, ensuring every month that has data (live or archived) is listed, plus all months of the current year.
- **Parameters:** None
- **Returns:** `void`
- **Internal logic:**
  - Guards on `#insightMonthSelect` missing.
  - Clears the select's HTML.
  - Builds `liveMonths`: a `Set` of `"YYYY-MM"` strings from every closed trade's `date` (via `substring(0,7)`).
  - Builds `snapMonths`: a `Set` of the keys of `S.insightSnapshot?.monthly`.
  - Unions both into `allMonths`, then force-adds all 12 months of the current calendar year (so the dropdown always offers the full current year even with no data yet).
  - Sorts the resulting `"YYYY-MM"` strings descending (`localeCompare`, reverse) and creates one `<option>` per month, with `textContent` as `"<Month name> <Year>"`; marks the current month/year option `selected`.
  - Sets `S.insightMonth = currentMonth` and `S.insightYear = currentYear` (global state write) and explicitly sets `sel.value` to the current-month key (belt-and-suspenders alongside the `opt.selected` flag).
- **Calls:** `filter`
- **Called by:** `renderDeeperInsights`
- **Side effects:** DOM — clears and repopulates `#insightMonthSelect` options. Global state — writes `S.insightMonth`, `S.insightYear`.
- **Notes:** Always resets the selector back to the *current* month every time it's called, even if the user had previously picked a different month — since `renderDeeperInsights()` calls this on every panel render, any user month selection is effectively reset each time the Insights tab is (re-)opened/refreshed.

#### renderExtraInsights()

- **File:** Trade_Journal/index.html (lines 18551-18720)
- **Module:** Analytics / Insights
- **Purpose:** Renders the "Extra Insights" block: time-of-day (session) performance, pair correlation tags, confidence-threshold performance, a rolling grade-trend indicator, tilt/consecutive-loss detection, and win-streak detection.
- **Parameters:** None
- **Returns:** `void`
- **Internal logic:**
  - Guards on `#insight-extra` missing; requires ≥5 closed non-intraday trades or shows a "Need at least 5 closed trades" placeholder.
  - **Time-of-Day Performance:** for each of `['London','NY Open','NY Expansion','Asia']`, computes win rate and avg R among closed trades in that session; shows `—` if none; colors win-rate by ≥50%/≥35%/below thresholds.
  - **Pair Correlation:** restricts to pairs with ≥3 closed trades; renders a chip per pair with win rate and avg R (colored ≥55%/≥40%/below); shows a "need 3+ trades" note if no pair qualifies.
  - **Confidence Threshold:** for each of `['high','medium','low']`, filters closed trades whose `runHTFEngine(t.checklistAnswers||{})` result has that `.confidence`, and computes win rate/avg R per bucket.
  - **Grade improvement trend:** sorts all graded intraday closed trades chronologically (`closeTime||date`), maps grade to a numeric score (`A+`=10, `A`=8, `B`=6, else=2); if ≥10 data points, compares the average of the most recent 20 vs. the previous 20 (falls back to using `avg20` itself if there's no earlier 20-window), showing an improving/declining/stable badge when the delta exceeds ±0.5.
  - **Tilt detection:** finds the longest consecutive `'LOSS'` streak (chronological non-intraday closed trades); if ≥2, collects the single trade immediately following every streak of ≥2 losses, maps each to +1/-1/0, and averages; if that post-streak average is negative (with ≥2 samples) shows a "⚠️ possible tilt" warning, or if clearly positive shows a "✅ resilient" note.
  - **Win-streak analysis:** finds the longest consecutive `'WIN'` streak; if ≥3, shows a "🔥 Best win streak" callout.
  - Assembles all sub-sections into one innerHTML write.
- **Calls:** `filter`, `calcR`, `runHTFEngine`
- **Called by:** `renderDeeperInsights`
- **Side effects:** DOM — writes `#insight-extra` innerHTML.
- **Notes:** The "after-streak" collection logic only ever captures the *single* trade immediately following a qualifying loss streak (the `if (i < results.length) afterStreak.push(...)` check is always true given the loop bounds, so effectively every streak-end contributes exactly one sample) — it does not look further ahead, so `avgAfter` reflects only the very next trade's outcome after each tilt-prone streak, not a longer recovery window. Confidence-threshold analysis re-runs `runHTFEngine` for every trade on every render (not memoized), which is the same engine used by the Daily Bias 'omar' checklist — trades using the `'ttrades'` model are not represented in this breakdown at all since only `runHTFEngine` (not `runTTEngine`) is invoked here.

#### renderDeeperInsights()

- **File:** Trade_Journal/index.html (lines 18723-18753)
- **Module:** Analytics / Insights
- **Purpose:** Master entry point for the Deeper Insights tab — populates the month selector, renders every insight section in order, and restores each section's expand/collapse UI state.
- **Parameters:** None
- **Returns:** `void`
- **Internal logic:**
  - Calls `populateMonthSelector()`.
  - Calls, in order: `renderOpportunityQuality`, `renderAlignment`, `renderContext`, `renderSetup`, `renderExecution`, `renderComponents` (Sections 1-6, defined elsewhere in the file), then `renderModelPerf`, `renderCapture`, `renderViolations`, `renderNoTrade`, `renderLeaks` (Sections 7-11), then `renderMonthlyInsights`, `renderExtraInsights` (Section 12 + Extra).
  - Restores collapsible section open/closed state: for section ids `[1..12, 'extra']`, looks up `#is-body-{id}` and `#is-tog-{id}`; if both exist, determines `isOpen` from `S.insightSections['is-'+id]` (defaulting to `true` only for section 11, the Leak panel, if the key is unset), then toggles the `open` CSS class on both the body and the toggle-chevron element.
- **Calls:** `populateMonthSelector`, `renderOpportunityQuality`, `renderAlignment`, `renderContext`, `renderSetup`, `renderExecution`, `renderComponents`, `renderModelPerf`, `renderCapture`, `renderViolations`, `renderNoTrade`, `renderLeaks`, `renderMonthlyInsights`, `renderExtraInsights`
- **Called by:** `navTo`
- **Side effects:** DOM — toggles `open` class on 13 pairs of `#is-body-*`/`#is-tog-*` elements; delegates all other DOM writes to the called render functions.
- **Notes:** Section 11 (Biggest Performance Leak) is the only section open by default when no prior toggle state exists in `S.insightSections` — every other section defaults to collapsed.

#### toggleInsightSection(id)

- **File:** Trade_Journal/index.html (lines 18756-18764)
- **Module:** Analytics / Insights
- **Purpose:** Toggles a single insight section's expand/collapse state and persists the new state into `S.insightSections`.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| id | number \| string | Section identifier, e.g. `1`-`12` or `'extra'`, matching the `#is-body-{id}`/`#is-tog-{id}` DOM id suffix. |

- **Returns:** `void`
- **Internal logic:**
  - Guards on either `#is-body-{id}` or `#is-tog-{id}` missing.
  - Calls `body.classList.toggle('open')` (which both flips and returns the new state) and applies the same boolean to the toggle chevron's class list.
  - Stores the resulting boolean into `S.insightSections['is-'+id]`.
- **Calls:** (none)
- **Called by:** (none detected via static analysis — verify: this is invoked only via inline `onclick="toggleInsightSection(...)"` attributes on the section header elements in the HTML, which the static call-graph does not track.)
- **Side effects:** DOM — toggles `open` class on `#is-body-{id}` and `#is-tog-{id}`. Global state — writes `S.insightSections['is-'+id]`.
- **Notes:** This is the only mutator that writes `S.insightSections`; `renderDeeperInsights` is the sole reader. Confirmed as an onclick-only entry point per the task's static-analysis caveat.

---

### Module: News Feed — Custom Assets & Instrument Registry

Defines the fixed base instrument list (EUR/USD, GBP/USD, USD/CHF, S&P 500)
plus a small (max 2) user-defined "custom asset" extension mechanism backed by
`localStorage`, and the derived lookup structures (`NEWS_INSTRUMENTS`,
`_NI_SYM_MAP`) that news providers/tagging code use throughout the News
module. `NEWS_INSTRUMENTS_BASE` and `CUSTOM_ASSET_SLOTS` are module-level
constants defined in this same block (lines 18782-18815), not separately
documented as functions.

#### _CustomAssets (IIFE)

- **File:** Trade_Journal/index.html (lines 18816-18852)
- **Module:** News Feed / Custom Assets
- **Purpose:** Self-contained module exposing get/save/build operations over the user's custom news instruments, persisted under the `localStorage` key `news_custom_instruments_v1`.
- **Parameters:** None (IIFE, invoked immediately; `build`'s parameters are documented separately below)
- **Returns:** `Object` — `{ get, save: _save, build }`, assigned to the const `_CustomAssets`.
- **Internal logic:**
  - Declares `KEY = 'news_custom_instruments_v1'` and private module state `_list = []`.
  - Defines nested `_load`, `_save`, `get`, `build` (each documented individually below).
  - Immediately calls `_load()` once at module-init time to hydrate `_list` from `localStorage`.
  - Returns the public `{ get, save: _save, build }` object.
- **Calls:** `_load`, `_save`, `get`, `build`, `filter` (inside `build`)
- **Called by:** (none — this is the module IIFE itself, invoked once at script load; its returned methods are called elsewhere, e.g. by `saveCustomAssets`/`removeCustomAsset`/`NewsView`/`NR`, all outside this chunk)
- **Side effects:** localStorage — reads `news_custom_instruments_v1` at init via `_load()`.
- **Notes:** `CUSTOM_ASSET_SLOTS = 2` caps the custom asset list to 2 entries app-wide; enforced inside `_save`.

#### _load()

- **File:** Trade_Journal/index.html (lines 18820-18827) — nested inside `_CustomAssets`
- **Module:** News Feed / Custom Assets
- **Purpose:** Loads the persisted custom-asset list from `localStorage` into the module-private `_list` variable.
- **Parameters:** None
- **Returns:** `Array` — the freshly loaded `_list` (also assigned to the enclosing closure variable).
- **Internal logic:**
  - Reads `localStorage.getItem(KEY)`; if present, `JSON.parse`s it into `_list`, else sets `_list = []`.
  - Guards against a parsed non-array value by resetting to `[]`.
  - Wrapped in try/catch: any parse error resets `_list = []`.
- **Calls:** (none)
- **Called by:** `_CustomAssets` (at module init)
- **Side effects:** localStorage read (`news_custom_instruments_v1`); mutates closure variable `_list`.
- **Notes:** Defensive against corrupted/foreign localStorage content — always falls back to an empty array rather than throwing.

#### _save(list)

- **File:** Trade_Journal/index.html (lines 18829-18832) — nested inside `_CustomAssets`
- **Module:** News Feed / Custom Assets
- **Purpose:** Persists a (possibly oversized) custom-asset list, truncated to the allowed slot count, into `localStorage` and updates in-memory state.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| list | Array\<Object\> | Candidate list of custom instrument objects to persist. |

- **Returns:** `void`
- **Internal logic:**
  - Sets `_list = list.slice(0, CUSTOM_ASSET_SLOTS)` (max 2 entries kept).
  - Writes `JSON.stringify(_list)` to `localStorage.setItem(KEY, ...)` inside a try/catch that silently swallows write errors (e.g. quota exceeded).
- **Calls:** (none)
- **Called by:** `_CustomAssets` (exposed publicly as `.save`)
- **Side effects:** localStorage write (`news_custom_instruments_v1`); mutates closure variable `_list`.
- **Notes:** Exposed on the public API under the name `save` (not `_save`) — i.e. external callers use `_CustomAssets.save(list)`.

#### build(label, keywordsCsv, currenciesCsv, slotIdx)

- **File:** Trade_Journal/index.html (lines 18837-18848) — nested inside `_CustomAssets`
- **Module:** News Feed / Custom Assets
- **Purpose:** Converts raw form input (label + comma-separated keyword/currency strings) into a normalized custom-instrument object compatible with the base instrument shape used by news matching and the FF-calendar currency filter.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| label | string | Display name entered by the user for the custom asset. |
| keywordsCsv | string | Comma-separated free-text keywords used for headline/description matching. |
| currenciesCsv | string | Comma-separated currency codes (e.g. "USD,JPY") used for FF-calendar filtering. |
| slotIdx | number | Slot index (0 or 1) — used to build a unique key and default label. |

- **Returns:** `Object` — `{ key: 'CUSTOM'+slotIdx, label, symbols: [], keywords, currencies, custom: true }`.
- **Internal logic:**
  - Splits `keywordsCsv` on `,`, trims and lowercases each, filters out empty strings.
  - Splits `currenciesCsv` on `,`, trims and uppercases each, filters out empty strings.
  - `label` defaults to `'Custom ' + (slotIdx+1)` if the trimmed input is empty.
  - `symbols` is always an empty array (custom assets are matched purely by keyword/currency, never by provider ticker symbol).
- **Calls:** `filter`
- **Called by:** `saveCustomAssets`, `_CustomAssets` (internal reference), `NewsView`, `NR` (all outside this chunk)
- **Side effects:** None (pure function).
- **Notes:** The `custom: true` flag is what lets `renderChips`/`NewsView` apply the distinct `news-chip-custom` CSS class and lets news matching treat it differently from the base 4 instruments where relevant.

#### getAllInstruments()

- **File:** Trade_Journal/index.html (lines 18855-18857)
- **Module:** News Feed / Custom Assets
- **Purpose:** Produces the combined, ordered list of all instruments (4 fixed base instruments + up to 2 custom ones) used everywhere the News module needs the full instrument set.
- **Parameters:** None
- **Returns:** `Array<Object>` — `[...NEWS_INSTRUMENTS_BASE, ..._CustomAssets.get()]`.
- **Internal logic:** Simple array spread/concat; base instruments always precede any custom ones.
- **Calls:** `get` (`_CustomAssets.get()`)
- **Called by:** `_refreshInstruments`
- **Side effects:** None (pure read).
- **Notes:** Only consumer is `_refreshInstruments`; other code reads the cached `NEWS_INSTRUMENTS` module-level variable instead of calling this directly each time.

#### _refreshInstruments()

- **File:** Trade_Journal/index.html (line 18861, single-line function body)
- **Module:** News Feed / Custom Assets
- **Purpose:** Recomputes and republishes the module-level `NEWS_INSTRUMENTS` array after custom assets change (add/remove), so all providers/tagging logic see the updated instrument set.
- **Parameters:** None
- **Returns:** `void`
- **Internal logic:** `NEWS_INSTRUMENTS = getAllInstruments();` — a single reassignment of the shared `let NEWS_INSTRUMENTS` variable.
- **Calls:** `getAllInstruments`
- **Called by:** `saveCustomAssets`, `removeCustomAsset`, `NewsView`, `NR` (all outside this chunk)
- **Side effects:** Global/module state — reassigns the shared `let NEWS_INSTRUMENTS`.
- **Notes:** Must be paired with a subsequent `_rebuildSymMap()` call by callers if the provider-symbol lookup table also needs to reflect the change (the two are not automatically chained inside this function).

#### _rebuildSymMap()

- **File:** Trade_Journal/index.html (lines 18865-18872)
- **Module:** News Feed / Custom Assets
- **Purpose:** Rebuilds the provider-ticker-symbol → instrument-key lookup table (`_NI_SYM_MAP`) used by all three news providers to tag incoming articles by instrument.
- **Parameters:** None
- **Returns:** `void`
- **Internal logic:**
  - Iterates `NEWS_INSTRUMENTS` (the current module-level list); for each instrument, maps every one of its `symbols` (uppercased) to the instrument's `key`, and also maps the instrument's own `key` to itself (so lookups by internal key also succeed, e.g. for custom assets which have no provider `symbols`).
  - Assigns the freshly built map to module-level `_NI_SYM_MAP` (replacing, not mutating in place, the old map).
- **Calls:** (none)
- **Called by:** `saveCustomAssets`, `removeCustomAsset`, `NewsView`, `NR` (all outside this chunk); also invoked once unconditionally right after its own definition (`_rebuildSymMap();` at line 18873, module init time).
- **Side effects:** Global/module state — reassigns shared `let _NI_SYM_MAP`.
- **Notes:** Must be re-run any time `NEWS_INSTRUMENTS` changes (i.e. after `_refreshInstruments()`), otherwise provider tagging will use a stale symbol map.

---

### Module: News Feed — Providers (Finnhub / Marketaux / Alpha Vantage)

Three structurally parallel provider modules, each an IIFE exposing
`{ id, fetch }`. Each defines its own private `_normalize`/`fetch` (and
provider-specific tagging helper), which is why the static call-graph in
`tj_chunk6.json` merges the three `_normalize` functions into a single node
and the three `fetch` functions into a single node (all sharing the same
identifier name across separate closures) — see the Notes on `_normalize` and
`fetch` below for how this manifests.

#### FinnhubProvider (IIFE)

- **File:** Trade_Journal/index.html (lines 18899-18951)
- **Module:** News Feed / Providers
- **Purpose:** News provider adapter for the Finnhub API (`GET /news?category=forex|general`); normalizes Finnhub's article shape into the app's common article model and tags each article by instrument.
- **Parameters:** None (IIFE)
- **Returns:** `Object` — `{ id: 'finnhub', fetch }`, assigned to const `FinnhubProvider`.
- **Internal logic:**
  - `BASE = 'https://finnhub.io/api/v1'`.
  - Defines nested `_tagInstruments`, `_normalize`, `fetch` (documented individually below).
  - Returns the public `{ id, fetch }` pair consumed by `NewsRepository._providers()`.
- **Calls:** `_tagInstruments`, `filter`, `_normalize`, `fetch`
- **Called by:** (none — module IIFE invoked once at script load; its `fetch` is invoked by `NewsRepository.refresh`/`_providers`)
- **Side effects:** None at definition time; its `fetch` performs network calls (see below).
- **Notes:** Comment block above (lines 18890-18898) documents the Finnhub API contract: free tier 60 req/min, no CORS restriction, fields `id, category, datetime (unix seconds), headline, image, related, source, summary, url`.

#### _tagInstruments(raw)

- **File:** Trade_Journal/index.html (lines 18902-18914) — nested inside `FinnhubProvider`
- **Module:** News Feed / Providers
- **Purpose:** Determines which instrument key(s) a raw Finnhub article relates to, preferring the API's own `related` ticker field and falling back to keyword scanning.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| raw | Object | Raw Finnhub article record (has `.related`, `.headline`, `.summary`). |

- **Returns:** `Array<string>` — instrument keys (e.g. `['EURUSD']`), deduplicated.
- **Internal logic:**
  - Primary: uppercases and splits `raw.related` (comma-separated), trims/filters empties, maps each symbol through `_NI_SYM_MAP`, filters out unmapped (`undefined`) results; if any survive, returns the deduplicated set immediately.
  - Fallback (only reached if `related` yielded nothing): lowercases `headline + ' ' + summary`, filters `NEWS_INSTRUMENTS` to those whose `.keywords` array has any substring match in that text, and returns their `.key`s.
- **Calls:** `filter`
- **Called by:** `_normalize` (Finnhub's), `FinnhubProvider`
- **Side effects:** None (pure read of module-level `_NI_SYM_MAP`/`NEWS_INSTRUMENTS`).
- **Notes:** Symbol-based tagging is strictly preferred over keyword tagging whenever it produces at least one hit — keyword scanning only runs when the `related` field is empty or maps to nothing known.

#### _normalize(raw)

- **File:** Trade_Journal/index.html (lines 18916-18928 — Finnhub's implementation; static analysis merges this with two sibling implementations, see Notes)
- **Module:** News Feed / Providers
- **Purpose:** Converts a raw provider-specific article record into the app's normalized article model (`{id, headline, source, url, publishedAt, thumbnail, description, instruments, provider}`). Implemented separately (with the same name) inside each of the three provider IIFEs.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| raw | Object | Raw article record from the provider's API response (shape differs per provider). |

- **Returns:** `Object` — the normalized article.
- **Internal logic (Finnhub variant, lines 18916-18928 — the one the JSON's line numbers refer to):**
  - `id`: `'fh__' + raw.id`.
  - `headline`: `raw.headline` trimmed.
  - `source`: `raw.source || 'Finnhub'`.
  - `url`: `raw.url || '#'`.
  - `publishedAt`: `new Date(raw.datetime * 1000)` — Finnhub returns unix **seconds**, converted to ms.
  - `thumbnail`: `raw.image || null`.
  - `description`: `raw.summary || null`.
  - `instruments`: `_tagInstruments(raw)`.
  - `provider`: `'finnhub'`.
- **Internal logic (Marketaux variant, lines 18975-18993 — separate closure, same function name):**
  - `id`: `'mx__' + raw.uuid`. `headline`: `raw.title` trimmed. `source`: `raw.source || 'Marketaux'`. `url`: `raw.url || '#'`.
  - `publishedAt`: `new Date(raw.published_at)` if present, else `new Date()` (current time fallback).
  - `thumbnail`: `raw.image_url || null`. `description`: `raw.description || null`.
  - `instruments`: `_tagFromEntities(raw.entities)`; if that yields nothing, falls back to a keyword scan of `title + description` against `NEWS_INSTRUMENTS`.
  - `provider`: `'marketaux'`.
- **Internal logic (Alpha Vantage variant, lines 19045-19063 — separate closure, same function name):**
  - `id`: `'av__' + encodeURIComponent(raw.url||raw.title||'').slice(0,80)` (URL-encoded and length-capped since AV articles have no native unique id).
  - `headline`: `raw.title` trimmed. `source`: `raw.source || 'Alpha Vantage'`. `url`: `raw.url || '#'`.
  - `publishedAt`: `_parseDate(raw.time_published)`.
  - `thumbnail`: `raw.banner_image || null`. `description`: `raw.summary || null`.
  - `instruments`: `_tagFromTickers(raw.ticker_sentiment)`; falls back to keyword scan of `title + summary` if empty.
  - `provider`: `'alphavantage'`.
- **Calls:** `_tagInstruments` (Finnhub variant only)
- **Called by:** `FinnhubProvider`, `MarketauxProvider`, `AlphaVantageProvider` (each calls its own private variant)
- **Side effects:** None (pure functions).
- **Notes:** The static analyzer's `tj_chunk6.json` records only one `_normalize` node (name-collision merge across the three separate closures) with `startLine`/`endLine` pointing at the Finnhub variant and `inboundCallers` listing all three provider IIFEs. All three variants share the same *purpose* and output shape but differ in field mapping and instrument-tagging strategy, as detailed above.

#### fetch(apiKey)

- **File:** Trade_Journal/index.html (lines 18930-18948 — Finnhub's implementation; static analysis merges this with two sibling implementations plus many unrelated same-named local functions elsewhere in the file, see Notes)
- **Module:** News Feed / Providers
- **Purpose:** Provider-specific async network call that fetches raw news articles from the provider's API using the given key, normalizes them, and returns the array. Each provider IIFE defines its own `fetch`.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| apiKey | string | User-supplied API key/token for this provider (empty/falsy disables the call). |

- **Returns:** `Promise<Array<Object>>` — normalized article array (empty array on missing key or any error).
- **Internal logic (Finnhub variant, lines 18930-18948 — the one the JSON's line numbers refer to):**
  - Guards on falsy `apiKey`: warns to console, returns `[]`.
  - Loops over `['forex','general']` categories sequentially (`for...of` with `await` inside, i.e. sequential not parallel per category): calls `window.fetch` against `${BASE}/news?category=${cat}&token=${encodeURIComponent(apiKey)}`.
  - Per category: if HTTP 429, warns and `continue`s (skips that category only); if `!r.ok`, logs an error and `continue`s; validates the JSON body is an array (else logs and `continue`s); maps through `_normalize` and filters out articles with empty `headline` or `url==='#'`; logs the per-category count; pushes into the accumulator `out`.
  - Wraps each category's fetch in its own try/catch so one category's network failure doesn't abort the other.
  - Returns the combined `out` array after both categories are attempted.
- **Internal logic (Marketaux variant, lines 18995-19009):**
  - Guards on falsy `apiKey`. Single `window.fetch` call to `${BASE}/news/all?symbols=${SYMBOLS}&language=en&filter_entities=true&limit=50&api_token=...`.
  - Handles 429 (returns `[]`), `!r.ok` (returns `[]`), and an in-body `json.error` field (Marketaux signals errors with HTTP 200 + an `error` field) — logs and returns `[]` in each case.
  - Maps `json.data||[]` through `_normalize`, filters invalid, logs count, returns.
  - Single try/catch around the whole call; logs and returns `[]` on exception.
- **Internal logic (Alpha Vantage variant, lines 19065-19083):**
  - Guards on falsy `apiKey`. Single `window.fetch` call to `${BASE}?function=NEWS_SENTIMENT&tickers=${encodeURIComponent(TICKERS)}&sort=LATEST&limit=50&apikey=...`.
  - Handles 429 and `!r.ok` by returning `[]`.
  - Detects Alpha Vantage's "soft" rate-limit pattern: a 200 response body containing `Information` or `Note` fields instead of `feed` — treated as no data (returns `[]`) rather than an error.
  - Maps `json.feed||[]` through `_normalize`, filters invalid, logs count, returns.
  - Single try/catch; logs and returns `[]` on exception.
- **Calls:** `filter`
- **Called by:** (per the JSON's merged node, an extremely long and largely irrelevant list caused by name-collision across the whole file — includes `cmFetchSignal`, `ebpTestConnection`, `saveClosure`, `resolveScreenshotForDisplay`, `callGeminiVision`, `_resolveDataUrls`, `downloadAllScreenshotBlobs`, `refresh`, `_fetch`, `_fetchChannel`, and the three provider IIFEs `FinnhubProvider`/`MarketauxProvider`/`AlphaVantageProvider`, plus `NewsRepository`/`NewsView`/`EC`. The functionally correct callers of *these three* `fetch` implementations are only `NewsRepository.refresh()` (via `_providers()`) and, indirectly, `NewsRepository._providers()`/`refresh()`.)
- **Side effects:** Network — GET requests to `finnhub.io`, `api.marketaux.com`, or `www.alphavantage.co` respectively (one call per provider variant, or 2 sequential calls for Finnhub's two categories). No DOM or Supabase access.
- **Notes:** This is the clearest example in this chunk of the static analyzer's name-collision limitation flagged in the task instructions: because a great many unrelated local functions throughout the 20k-line file are also literally named `fetch` (or alias `window.fetch` under a local `fetch` binding), the call graph treats them all as one node, producing a huge and mostly-spurious `inboundCallers` list. Only `NewsRepository.refresh()` genuinely calls these three provider `fetch` functions.

#### MarketauxProvider (IIFE)

- **File:** Trade_Journal/index.html (lines 18964-19012)
- **Module:** News Feed / Providers
- **Purpose:** News provider adapter for the Marketaux API (`GET /v1/news/all?symbols=...`); normalizes Marketaux's article shape and tags articles by instrument using entity data.
- **Parameters:** None (IIFE)
- **Returns:** `Object` — `{ id: 'marketaux', fetch }`.
- **Internal logic:**
  - `BASE = 'https://api.marketaux.com/v1'`; `SYMBOLS = 'EURUSD,GBPUSD,USDCHF,SPY,SPX'` (fixed query string, not derived from custom assets).
  - Defines nested `_tagFromEntities`, `_normalize`, `fetch` (the latter two documented under the shared entries above).
  - Returns `{ id, fetch }`.
- **Calls:** `_tagFromEntities`, `filter`, `_normalize`, `fetch`
- **Called by:** (none — module IIFE invoked once at script load)
- **Side effects:** None at definition time.
- **Notes:** Comment block (lines 18953-18963) documents the API contract: free tier 100 req/day, response fields `uuid, title, description, url, image_url, published_at, source, entities[{symbol,name,type,...}]`. Unlike Finnhub/Alpha Vantage, its `SYMBOLS` constant is hardcoded and does not automatically include user-added custom assets' symbols (custom assets have empty `symbols` arrays by design, so they rely entirely on keyword-fallback tagging for Marketaux/AlphaVantage results too).

#### _tagFromEntities(entities)

- **File:** Trade_Journal/index.html (lines 18968-18973) — nested inside `MarketauxProvider`
- **Module:** News Feed / Providers
- **Purpose:** Maps Marketaux's `entities` array (structured symbol mentions) to instrument keys via the symbol lookup table.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| entities | Array\<Object\> \| undefined | Marketaux `entities` field, each with a `.symbol`. |

- **Returns:** `Array<string>` — deduplicated instrument keys.
- **Internal logic:**
  - Guards on non-array input, returning `[]`.
  - Maps each entity's `.symbol` (uppercased, defaulting to `''`) through `_NI_SYM_MAP`, filters out unmapped results, dedupes via `Set`.
- **Calls:** `filter`
- **Called by:** `MarketauxProvider` (specifically its private `_normalize`)
- **Side effects:** None (pure).
- **Notes:** Mirrors `_tagFromTickers` (Alpha Vantage) and `_tagInstruments`'s primary branch (Finnhub) — three parallel "map provider's native entity/ticker field to our instrument keys" helpers, one per provider, each shaped to that provider's response schema.

#### AlphaVantageProvider (IIFE)

- **File:** Trade_Journal/index.html (lines 19025-19086)
- **Module:** News Feed / Providers
- **Purpose:** News provider adapter for the Alpha Vantage `NEWS_SENTIMENT` API; normalizes its feed/ticker-sentiment shape and tags articles by instrument.
- **Parameters:** None (IIFE)
- **Returns:** `Object` — `{ id: 'alphavantage', fetch }`.
- **Internal logic:**
  - `BASE = 'https://www.alphavantage.co/query'`; `TICKERS = 'FOREX:EURUSD,FOREX:GBPUSD,FOREX:USDCHF,SPY'` (fixed).
  - Defines nested `_parseDate`, `_tagFromTickers`, `_normalize`, `fetch` (the latter two documented under the shared entries above).
  - Returns `{ id, fetch }`.
- **Calls:** `_parseDate`, `_tagFromTickers`, `filter`, `_normalize`, `fetch`
- **Called by:** (none — module IIFE invoked once at script load)
- **Side effects:** None at definition time.
- **Notes:** Comment block (lines 19014-19024) documents the API contract: free tier only 25 req/day (the most restrictive of the three), response fields `feed[{title,url,time_published (format YYYYMMDDTHHmmss),source,summary,banner_image,ticker_sentiment[{ticker,...}]}]`.

#### _parseDate(s)

- **File:** Trade_Journal/index.html (lines 19029-19035) — nested inside `AlphaVantageProvider`
- **Module:** News Feed / Providers
- **Purpose:** Parses Alpha Vantage's compact `YYYYMMDDTHHmmss` timestamp format into a JS `Date`.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| s | string | Raw `time_published` string, e.g. `"20240115T153000"`. |

- **Returns:** `Date` — parsed UTC date, or the current date/time if input is missing/too short.
- **Internal logic:**
  - Guards: if `s` is falsy or shorter than 15 characters, returns `new Date()` (now) as a fallback.
  - Otherwise slices out year (0-4), month (4-6), day (6-8), hour (9-11), minute (11-13), second (13-15) and reassembles as an ISO-like string `YYYY-MM-DDTHH:mm:ssZ` (explicit `Z` suffix — treats the source as UTC), then constructs a `Date` from it.
- **Calls:** (none)
- **Called by:** `AlphaVantageProvider` (specifically its private `_normalize`)
- **Side effects:** None (pure).
- **Notes:** Character offset 8 (the literal `'T'` separator in the source string) is skipped over implicitly by slicing from index 9 for the hour — relies on the fixed-width `YYYYMMDDTHHmmss` format exactly.

#### _tagFromTickers(ts)

- **File:** Trade_Journal/index.html (lines 19037-19043) — nested inside `AlphaVantageProvider`
- **Module:** News Feed / Providers
- **Purpose:** Maps Alpha Vantage's `ticker_sentiment` array to instrument keys via the symbol lookup table, stripping the `FOREX:` prefix AV uses on forex tickers.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| ts | Array\<Object\> \| undefined | `raw.ticker_sentiment`, each entry with a `.ticker` (e.g. `"FOREX:EURUSD"` or `"SPY"`). |

- **Returns:** `Array<string>` — deduplicated instrument keys.
- **Internal logic:**
  - Guards on non-array input, returns `[]`.
  - Maps each `.ticker` (defaulting to `''`), strips a literal `'FOREX:'` prefix via `.replace('FOREX:','')`, uppercases, looks up in `_NI_SYM_MAP`, filters unmapped, dedupes via `Set`.
- **Calls:** `filter`
- **Called by:** `AlphaVantageProvider` (specifically its private `_normalize`)
- **Side effects:** None (pure).
- **Notes:** `.replace('FOREX:','')` only strips the first occurrence and only an exact-case match — safe here since AV always emits the prefix uppercase, but not a general-purpose stripper.

---

### Module: News Feed — Repository (data layer)

#### NewsRepository (IIFE)

- **File:** Trade_Journal/index.html (lines 19092-19251)
- **Module:** News Feed / Repository
- **Purpose:** Central data-layer module for the News feed: owns provider orchestration (fan-out fetch across active providers), deduplication, in-memory + `localStorage` caching, API-key persistence, and the article filter/search used by the UI controller.
- **Parameters:** None (IIFE)
- **Returns:** `Object` — `{ setKeys, getKeys, hasAnyKey, refresh, loadFromCache, filter, retagAll, getArticles, getLastFetched, getStatuses, getConstants }`, assigned to const `NewsRepository`.
- **Internal logic:**
  - Declares constants `PAGE_SIZE=20`, `CACHE_TTL=3min` (soft freshness), `CACHE_HARD=12min` (hard expiry), `REFRESH_MS=5min` (suggested auto-refresh interval for the controller), `TIMEOUT_MS=10000` (per-provider fetch timeout).
  - Declares private module state: `_articles=[]`, `_lastFetched=null`, `_statuses={}`, `_keys={finnhub:'',marketaux:'',alphavantage:''}`.
  - Defines all nested functions (documented individually below) and returns the public API object.
- **Calls:** `setKeys`, `getKeys`, `_loadKeys`, `hasAnyKey`, `_providers`, `filter`, `_dedupe`, `_saveCache`, `_readCache`, `refresh`, `fetch`, `loadFromCache`, `getArticles`, `getLastFetched`, `getStatuses`, `getConstants`, `retagAll`
- **Called by:** (none — module IIFE invoked once at script load; its returned methods are used by `NewsView`/`NR`/other code outside this chunk)
- **Side effects:** None at definition time; its methods perform localStorage and network I/O (see individual entries).
- **Notes:** Architecture comment (lines 18767-18776) documents the overall News module design: `NewsProvider` (interface: Finnhub/Marketaux) → `NewsRepository` (normalise→dedupe→cache) → `NewsView` (pure rendering) → `NR` (controller: state/filtering/pagination, defined later in the file, outside this chunk).

#### setKeys(k)

- **File:** Trade_Journal/index.html (lines 19105-19108) — nested inside `NewsRepository`
- **Module:** News Feed / Repository
- **Purpose:** Merges new API-key values into the repository's key store and persists them.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| k | Object | Partial `{finnhub?, marketaux?, alphavantage?}` key map to merge in. |

- **Returns:** `void`
- **Internal logic:** `Object.assign(_keys, k)`, then `localStorage.setItem('news_api_keys_v3', JSON.stringify(_keys))` wrapped in try/catch (swallows write errors).
- **Calls:** (none)
- **Called by:** `saveKeys`, `NewsRepository`, `NewsView`, `NR` (all except the IIFE self-reference are outside this chunk)
- **Side effects:** localStorage write (`news_api_keys_v3`); mutates module state `_keys`.
- **Notes:** Merge is shallow (`Object.assign`) — omitted keys in `k` are left untouched, so callers can update a single provider's key without clobbering the others.

#### getKeys()

- **File:** Trade_Journal/index.html (line 19109) — nested inside `NewsRepository`
- **Module:** News Feed / Repository
- **Purpose:** Returns a defensive shallow copy of the current API keys.
- **Parameters:** None
- **Returns:** `Object` — `{ ..._keys }`.
- **Internal logic:** Single-expression spread copy, preventing external mutation of the private `_keys` object.
- **Calls:** (none)
- **Called by:** `showKeyModal`, `NewsRepository`, `NewsView`, `NR` (outside this chunk)
- **Side effects:** None (read-only).
- **Notes:** None.

#### _loadKeys()

- **File:** Trade_Journal/index.html (lines 19110-19115) — nested inside `NewsRepository`
- **Module:** News Feed / Repository
- **Purpose:** Refreshes the in-memory `_keys` from `localStorage`, in case another tab/session updated them.
- **Parameters:** None
- **Returns:** `void`
- **Internal logic:** Reads `localStorage.getItem('news_api_keys_v3')`; if present, `JSON.parse`s and `Object.assign`s into `_keys`; wrapped in a try/catch that silently ignores parse errors (leaves `_keys` unchanged on failure).
- **Calls:** (none)
- **Called by:** `refresh`, `loadFromCache`, `NewsRepository`
- **Side effects:** Reads localStorage (`news_api_keys_v3`); mutates module state `_keys`.
- **Notes:** Called defensively at the start of both `refresh()` and `loadFromCache()` so the repository always acts on the latest persisted keys rather than a possibly-stale in-memory copy.

#### hasAnyKey()

- **File:** Trade_Journal/index.html (lines 19116-19118) — nested inside `NewsRepository`
- **Module:** News Feed / Repository
- **Purpose:** Reports whether at least one provider API key has been configured, used to decide whether to show the "add API key" prompt vs. attempt a fetch.
- **Parameters:** None
- **Returns:** `boolean`
- **Internal logic:** `Object.values(_keys).some(v => v && v.trim().length > 0)`.
- **Calls:** (none)
- **Called by:** `_esc` (per static analysis, likely a mis-attributed nested caller within `NewsView`'s render tree), `_renderPage`, `init`, `NewsRepository`, `NewsView`, `NR`
- **Side effects:** None (read-only).
- **Notes:** None.

#### _providers()

- **File:** Trade_Journal/index.html (lines 19121-19124) — nested inside `NewsRepository`
- **Module:** News Feed / Repository
- **Purpose:** Determines which provider adapters are currently usable (have a non-empty key configured).
- **Parameters:** None
- **Returns:** `Array<Object>` — subset of `[FinnhubProvider, MarketauxProvider, AlphaVantageProvider]` whose `id` has a corresponding non-blank entry in `_keys`.
- **Internal logic:** Builds the fixed 3-provider array, filters to those where `_keys[p.id]` is truthy and its trimmed length is > 0.
- **Calls:** `filter`
- **Called by:** `refresh`, `NewsRepository`
- **Side effects:** None (pure read of module state).
- **Notes:** Order is fixed (Finnhub, Marketaux, Alpha Vantage) regardless of which keys are set — only presence/absence of a key filters the list, order is never reshuffled.

#### _dedupe(arts)

- **File:** Trade_Journal/index.html (lines 19127-19136) — nested inside `NewsRepository`
- **Module:** News Feed / Repository
- **Purpose:** Removes duplicate articles across providers by exact URL match and by a normalized-headline fingerprint, so the same story reported by two providers only appears once.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| arts | Array\<Object\> | Combined normalized articles from all active providers. |

- **Returns:** `Array<Object>` — filtered, deduplicated article list (order-preserving, first occurrence wins).
- **Internal logic:**
  - Maintains two `Set`s: `urls` (exact URL strings) and `heads` (headline fingerprints).
  - For each article: if its `url` is already in `urls`, drops it; else adds it. Then computes `hk` = first 70 chars of the lowercased headline with all non-word characters stripped (`\W+` → `''`); if `hk` is already in `heads`, drops it; else adds it and keeps the article.
- **Calls:** `filter`
- **Called by:** `refresh`, `NewsRepository`
- **Side effects:** None (pure — builds new local Sets, doesn't mutate `arts`).
- **Notes:** The headline-fingerprint check runs even when the URL differs, catching cases where multiple providers syndicate the same story under different URLs; conversely, two different articles that happen to share their first-70-characters-stripped-of-punctuation would be incorrectly treated as duplicates (an accepted heuristic trade-off).

#### _saveCache()

- **File:** Trade_Journal/index.html (lines 19139-19148) — nested inside `NewsRepository`
- **Module:** News Feed / Repository
- **Purpose:** Persists the current in-memory article list (capped) and a timestamp to `localStorage` so the feed can render instantly on next load without a network round-trip.
- **Parameters:** None
- **Returns:** `void`
- **Internal logic:**
  - Writes `localStorage.setItem('news_cache_v3', JSON.stringify({ ts: Date.now(), articles: ... }))`.
  - Caps stored articles to the first 300 (`_articles.slice(0,300)`), and converts each article's `publishedAt` `Date` to an ISO string (since `Date` doesn't survive `JSON.stringify` as a `Date` — it's auto-stringified via `toISOString()`, but this explicit spread makes the conversion visible/intentional).
  - Wrapped in try/catch swallowing write errors (e.g. quota exceeded).
- **Calls:** (none)
- **Called by:** `refresh`, `_fetch`, `NewsRepository`, `NewsView`, `EC`
- **Side effects:** localStorage write (`news_cache_v3`).
- **Notes:** The 300-article cap bounds `localStorage` size even though `_articles` itself (in memory) may hold more after a large multi-provider fetch — a fetch fetching more than 300 total articles will have its excess silently dropped from the persisted cache (but retained in the live in-memory `_articles` for the current session).

#### _readCache()

- **File:** Trade_Journal/index.html (lines 19150-19158) — nested inside `NewsRepository`
- **Module:** News Feed / Repository
- **Purpose:** Reads and validates the persisted article cache, rehydrating `Date` fields, honoring a hard expiry so very stale caches are never returned.
- **Parameters:** None
- **Returns:** `Object | null` — `{ ts, articles }` (with `publishedAt` rehydrated to `Date` objects) or `null` if no cache exists, it's malformed, or older than `CACHE_HARD` (12 minutes).
- **Internal logic:**
  - Reads `localStorage.getItem('news_cache_v3')`; returns `null` if absent.
  - Parses JSON to `{ ts, articles }`; if `Date.now() - ts > CACHE_HARD`, returns `null` (treats it as unusably stale).
  - Otherwise maps `articles` back to `{ ...a, publishedAt: new Date(a.publishedAt) }` and returns `{ ts, articles }`.
  - Wrapped in try/catch returning `null` on any parse error.
- **Calls:** (none)
- **Called by:** `loadFromCache`, `NewsRepository`
- **Side effects:** localStorage read (`news_cache_v3`).
- **Notes:** This "hard" 12-minute cutoff is distinct from the 3-minute "soft" `CACHE_TTL` checked separately by `loadFromCache` — a cache between 3 and 12 minutes old is still *readable* here but `loadFromCache` will reject it as not fresh enough to skip a live refresh.

#### refresh(onProgress)

- **File:** Trade_Journal/index.html (lines 19161-19192) — nested inside `NewsRepository`
- **Module:** News Feed / Repository
- **Purpose:** Performs a live, parallel fetch across all currently-keyed providers, deduplicates and sorts the combined results, updates in-memory state, persists the cache, and reports per-provider progress as each settles.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| onProgress | (id: string, status: string) => void \| undefined | Optional callback invoked once per provider as soon as that provider's fetch settles, with its id and resulting status (`'ok'`/`'error'`). |

- **Returns:** `Promise<Array<Object>>` — the deduplicated, newest-first `_articles` array (also stored in module state).
- **Internal logic:**
  - Calls `_loadKeys()` to ensure the latest persisted keys are used.
  - Computes `providers = _providers()`; if empty, warns to console and resolves `[]` immediately (no state mutation, no cache write).
  - Initializes `_statuses` to `'loading'` for every active provider id.
  - Runs `Promise.all` over all active providers concurrently. For each provider: races `p.fetch(_keys[p.id])` against a `setTimeout`-based rejection after `TIMEOUT_MS` (10s) via `Promise.race`; on success sets that provider's status to `'ok'` if it returned any articles, else `'error'`, and pushes its articles into the shared `all` accumulator; on failure/timeout, catches the error, logs `[News:{id}] Error: {message}`, and sets status `'error'`. After each provider settles (success or failure), invokes `onProgress(p.id, status)` if supplied.
  - After all providers have settled: `_articles = _dedupe(all sorted by publishedAt descending)`; `_lastFetched = Date.now()`; calls `_saveCache()`; logs the total unique count; returns `_articles`.
- **Calls:** `_loadKeys`, `_providers`, `fetch`, `_dedupe`, `_saveCache`
- **Called by:** `saveKeys`, `init`, `_startTimer`, `NewsRepository`, `NewsView`, `NR` (all outside this chunk except the self-reference)
- **Side effects:** Network — parallel GET requests to whichever provider APIs have keys configured. Global/module state — mutates `_statuses`, `_articles`, `_lastFetched`. localStorage — write via `_saveCache()`. Invokes external `onProgress` callback if given.
- **Notes:** A provider that times out still counts as `'error'` and does not block the other providers' results from being included — `Promise.all` here waits for every provider's *settlement* (the inner try/catch always resolves, never rejects, so `Promise.all` itself never short-circuits on a single provider failure).

#### loadFromCache()

- **File:** Trade_Journal/index.html (lines 19194-19202) — nested inside `NewsRepository`
- **Module:** News Feed / Repository
- **Purpose:** Attempts to serve the feed instantly from a still-"soft-fresh" (<3 min old) local cache, avoiding a network round-trip on quick reloads/tab switches.
- **Parameters:** None
- **Returns:** `Array<Object> | null` — cached articles if fresh enough, else `null` (signaling the caller should call `refresh()` instead).
- **Internal logic:**
  - Calls `_loadKeys()`.
  - Calls `_readCache()`; if `null` (missing/hard-expired/corrupt), returns `null`.
  - If `Date.now() - cached.ts > CACHE_TTL` (i.e. older than 3 minutes), returns `null` even though the cache itself is still within its 12-minute hard-validity window.
  - Otherwise adopts `cached.articles`/`cached.ts` into module state (`_articles`, `_lastFetched`) and returns `_articles`.
- **Calls:** `_loadKeys`, `_readCache`
- **Called by:** `init`, `NewsRepository`, `NewsView`, `NR` (outside this chunk)
- **Side effects:** localStorage read (via `_readCache`); mutates module state `_articles`/`_lastFetched` only on the fresh-cache-hit path.
- **Notes:** Distinguishes "cache exists and is readable" (`_readCache`, 12-min ceiling) from "cache is fresh enough to use without refreshing" (`CACHE_TTL`, 3-min ceiling) — the caller (presumably `NR`/`init`, outside this chunk) is expected to trigger a background `refresh()` when this returns `null`.

#### filter({ instrumentKeys, searchQuery })

- **File:** Trade_Journal/index.html (lines 19205-19220) — nested inside `NewsRepository`
- **Module:** News Feed / Repository
- **Purpose:** Applies the currently active instrument-chip filter and free-text search query to the in-memory article list, without ever exposing or mutating the raw `_articles` array to callers.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| instrumentKeys | string \| Array\<string\> \| undefined | Active instrument filter key(s), e.g. `'EURUSD'`, `['EURUSD','GBPUSD']`, or `'ALL'`/empty for no instrument filtering. |
| searchQuery | string \| undefined | Free-text search string. |

- **Returns:** `Array<Object>` — the filtered article subset (new array; does not mutate `_articles`).
- **Internal logic:**
  - Starts `res = _articles`.
  - Normalizes `instrumentKeys` to an array (`keys`); if non-empty and does not include `'ALL'`, filters `res` to articles whose `.instruments` intersects `keys` (`some(k => keys.includes(k))`).
  - Trims/lowercases `searchQuery` into `q`; if non-empty, further filters `res` to articles whose `headline`, `description`, or `source` (all lowercased) includes `q` as a substring.
  - Returns `res`.
- **Calls:** (none)
- **Called by:** An extremely long list per the static analyzer (essentially every function in the entire file that itself calls a same-named local `filter` — this is another name-collision artifact, since `filter` is also the generic `Array.prototype.filter` method name used throughout the codebase and many unrelated local helper functions are also literally named `filter`). The functionally meaningful caller of *this* `NewsRepository.filter` is the News controller `NR` (defined later in the file, outside this chunk), which the UI calls whenever the user changes the instrument chip selection or types a search query.
- **Side effects:** None (pure read of module state `_articles`).
- **Notes:** Comment on this function (`// filtering (repository owns this — UI never touches raw array)`) states the design intent explicitly: the View/Controller layers must always go through this method rather than reading `_articles`/`getArticles()` and filtering client-side, keeping filtering logic centralized in one place.

#### getArticles()

- **File:** Trade_Journal/index.html (line 19222) — nested inside `NewsRepository`
- **Module:** News Feed / Repository
- **Purpose:** Exposes the current unfiltered article list to external callers.
- **Parameters:** None
- **Returns:** `Array<Object>` — the live `_articles` reference (not a copy).
- **Internal logic:** `return _articles;`
- **Calls:** (none)
- **Called by:** `_esc` (likely mis-attributed via nested render call chain), `_buildStatus`, `_renderPage`, `NewsRepository`, `NewsView`, `NR`
- **Side effects:** None (read-only), but returns the live array reference rather than a defensive copy — a caller that mutates the returned array would corrupt repository state.
- **Notes:** Unlike `getKeys()`/`getStatuses()`, this does NOT return a shallow copy — callers get the actual internal array reference.

#### getLastFetched()

- **File:** Trade_Journal/index.html (line 19223) — nested inside `NewsRepository`
- **Module:** News Feed / Repository
- **Purpose:** Exposes the timestamp of the last successful fetch/cache-load.
- **Parameters:** None
- **Returns:** `number | null` — epoch ms of the last fetch, or `null` if never fetched/loaded this session.
- **Internal logic:** `return _lastFetched;`
- **Calls:** (none)
- **Called by:** `_esc` (likely mis-attributed), `_buildStatus`, `init`, `NewsRepository`, `NewsView`, `NR`
- **Side effects:** None.
- **Notes:** None.

#### getStatuses()

- **File:** Trade_Journal/index.html (line 19224) — nested inside `NewsRepository`
- **Module:** News Feed / Repository
- **Purpose:** Exposes the per-provider fetch status map (`'loading'|'ok'|'error'`) for status-line/UI rendering.
- **Parameters:** None
- **Returns:** `Object` — shallow copy `{ ..._statuses }`.
- **Internal logic:** `return { ..._statuses };`
- **Calls:** (none)
- **Called by:** `_esc` (likely mis-attributed), `_buildStatus`, `NewsRepository`, `NewsView`, `NR`
- **Side effects:** None.
- **Notes:** Defensive copy, unlike `getArticles()`.

#### getConstants()

- **File:** Trade_Journal/index.html (line 19225) — nested inside `NewsRepository`
- **Module:** News Feed / Repository
- **Purpose:** Exposes the repository's tunable constants to the controller/view layer (e.g. for pagination and auto-refresh timers) without hardcoding them a second time elsewhere.
- **Parameters:** None
- **Returns:** `Object` — `{ PAGE_SIZE, REFRESH_MS, CACHE_TTL }`.
- **Internal logic:** `return { PAGE_SIZE, REFRESH_MS, CACHE_TTL };`
- **Calls:** (none)
- **Called by:** `_esc` (likely mis-attributed), `NewsRepository`, `NewsView`, `NR`
- **Side effects:** None.
- **Notes:** `TIMEOUT_MS` and `CACHE_HARD` are intentionally NOT exposed here — they're internal-only tuning knobs the caller doesn't need.

#### retagAll()

- **File:** Trade_Journal/index.html (lines 19229-19244) — nested inside `NewsRepository`
- **Module:** News Feed / Repository
- **Purpose:** Re-tags every already-cached article's `instruments` array against the *current* `NEWS_INSTRUMENTS` list, without re-fetching from any provider — used after the user adds/edits/removes a custom asset so existing articles immediately reflect the new instrument set.
- **Parameters:** None
- **Returns:** `void`
- **Internal logic:**
  - For each article in `_articles` (mutated in place):
    - `symTags`: keeps only the article's existing `instruments` entries that still correspond to a key present in the current `NEWS_INSTRUMENTS` (drops stale tags for instruments that were removed).
    - `kwTags`: independently recomputes keyword-based tags by scanning `headline + description` (lowercased) against every instrument's `.keywords`.
    - Sets `a.instruments = [...new Set([...symTags, ...kwTags])]` — the union, deduplicated.
  - After processing all articles, writes `{ ts: _lastFetched, articles: _articles }` to `localStorage.setItem('news_cache_v3', ...)`, wrapped in try/catch swallowing write errors.
- **Calls:** `filter`
- **Called by:** `saveCustomAssets`, `removeCustomAsset`, `NewsRepository`, `NewsView`, `NR` (outside this chunk except self-reference)
- **Side effects:** Mutates every element of module state `_articles` in place (their `.instruments` arrays are reassigned). localStorage write (`news_cache_v3`).
- **Notes:** Unlike `_saveCache()`, this write is NOT capped to 300 articles and does not explicitly convert `Date` objects to ISO strings before stringifying — however `JSON.stringify` calls `.toJSON()`/`.toISOString()` on `Date` instances automatically, so the persisted shape ends up equivalent; the difference is `retagAll`'s write persists the *entire* `_articles` array regardless of size, whereas `_saveCache` caps at 300.

---

### Module: News Feed — View (rendering layer, partial — continues beyond this chunk)

`NewsView` is a large IIFE (defined 19256 through line 19961, i.e. it continues
far beyond this chunk's end at line 19368) implementing the "pure rendering,
zero data access" layer of the News module per the architecture comment above
`NewsRepository`. Only its first eight nested functions fall inside this
chunk's assigned range; the remainder (`setRefreshState`, `setLoadMoreVisible`,
`openKeyModal`, etc.) are documented in a later chunk. `NewsView`'s public
return object (the API it exposes to the `NR` controller) is likewise defined
past line 19368 and is not visible in this chunk.

#### NewsView (IIFE)

- **File:** Trade_Journal/index.html (lines 19256-19961 — only lines 19256-19368 fall within this chunk; the remainder is covered elsewhere)
- **Module:** News Feed / View
- **Purpose:** Encapsulates all News-feed DOM rendering (chips, article cards, skeletons, state cards, status line, key-entry modal, custom-asset form, etc.) as pure functions that read only their arguments/DOM and never touch the repository's data directly.
- **Parameters:** None (IIFE)
- **Returns:** (not visible within this chunk — the closing `return {...}` occurs after line 19368)
- **Internal logic (within this chunk's visible portion):** Defines `_timeAgo`, `_esc`, `renderChips`, `renderSkeletons`, `renderStateCard`, `renderKeyPrompt`, `renderArticles`, `updateStatus` — each documented individually below.
- **Calls:** (very long list per JSON, spanning both the visible and not-yet-visible portions of the IIFE body — includes every nested function defined anywhere inside `NewsView`, e.g. `_timeAgo`, `_esc`, `renderChips`, `toggleFilter`, `openAssetForm`, `renderSkeletons`, `renderStateCard`, `renderKeyPrompt`, `showKeyModal`, `renderArticles`, `remove`, `updateStatus`, `setRefreshState`, `setLoadMoreVisible`, `setSearchClearVisible`, `openKeyModal`, `closeKeyModal`, `saveKeys`, `getConstants`, `_buildStatus`, `getArticles`, `filter`, `getLastFetched`, `getStatuses`, `_renderPage`, `hasAnyKey`, `setFilter`, `onSearch`, `clearSearch`, `loadMore`, `get`, `removeCustomAsset`, `closeAssetForm`, `saveCustomAssets`, `build`, `_refreshInstruments`, `_rebuildSymMap`, `refreshCustomAssets`, `retagAll`, `refresh`, `getKeys`, `setKeys`, `init`, `_startTimer`, `loadFromCache`, and several Discord/FF-calendar-adjacent helpers, per the JSON.)
- **Called by:** (none — module IIFE invoked once at script load)
- **Side effects:** None at definition time; its nested functions perform DOM writes only (no Supabase/localStorage/network access directly, consistent with the "pure rendering" design comment).
- **Notes:** This entry documents the module container only; each nested function's own behavior is documented under its own heading (either here, if visible by line 19368, or in a subsequent chunk covering lines beyond 19368).

#### _timeAgo(d)

- **File:** Trade_Journal/index.html (lines 19257-19263) — nested inside `NewsView`
- **Module:** News Feed / View
- **Purpose:** Formats a timestamp as a short relative "time ago" label for article cards (e.g. "just now", "42m ago", "3h ago", "2d ago").
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| d | Date \| string \| number | The article's `publishedAt` value (coerced via `new Date(d)`). |

- **Returns:** `string` — human-readable relative time label.
- **Internal logic:**
  - `m = floor((Date.now() - new Date(d)) / 60000)` (elapsed minutes).
  - `m < 1` → `'just now'`.
  - `m < 60` → `m + 'm ago'`.
  - Else `h = floor(m/60)`; `h < 24` → `h + 'h ago'`, else `floor(h/24) + 'd ago'`.
- **Calls:** (none)
- **Called by:** `_esc` (likely mis-attributed via static call-graph merge), `renderArticles`, `_renderMessages` (Discord feed, outside this chunk), `NewsView`
- **Side effects:** None (pure).
- **Notes:** Has no upper bound — an article many months old would still render as e.g. `"214d ago"` rather than switching to a calendar date format.

#### _esc(s)

- **File:** Trade_Journal/index.html (lines 19264-19267) — nested inside `NewsView`. **Note on the JSON's recorded range:** `tj_chunk6.json` lists this function's `endLine` as 19557 (294 lines) with a large `outboundCalls`/`inboundCallers` list including functions such as `_renderSidebar`, `_renderMessages`, `_renderChannelRows` that belong to the (separate, later) Discord-feed section of `NewsView`. This is a static-analysis artifact: a second, differently-scoped function is evidently also involved in that boundary computation. The actual `_esc` function visible in source at line 19264 is a tiny 4-line HTML-escaper, documented below as it actually reads.
- **Purpose:** Escapes the five HTML-significant characters in a string so it can be safely interpolated into `innerHTML` templates.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| s | string \| null \| undefined | Raw text to escape. |

- **Returns:** `string` — escaped text, or `''` if `s` was falsy.
- **Internal logic:** `(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')` — sequential global replacements (order matters: `&` must be escaped first so it doesn't double-escape the entities produced by the later replacements).
- **Calls:** (none, per actual source — the JSON's long outboundCalls list is the artifact described above)
- **Called by:** `renderChips`, `renderStateCard`, `renderArticles` (all in this chunk), plus (per JSON) `openKeyModal`, `_renderSidebar`, `_renderMessages`, `_renderChannelRows`, `NewsView` (these last four are outside this chunk, in the Discord-feed section).
- **Side effects:** None (pure).
- **Notes:** Does not escape single quotes (`'`) — safe in this codebase only because all interpolation sites use double-quoted HTML attributes; would not be fully attribute-safe if a template used single-quoted attributes.

#### renderChips(activeKeys)

- **File:** Trade_Journal/index.html (lines 19269-19290) — nested inside `NewsView`
- **Module:** News Feed / View
- **Purpose:** Renders the instrument filter chip bar ("All" + one chip per instrument + an "add asset" button) into `#newsChips`, marking the currently active chip(s).
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| activeKeys | string \| Array\<string\> | Currently active instrument filter key(s), or `'ALL'`. |

- **Returns:** `void`
- **Internal logic:**
  - Guards on `#newsChips` missing.
  - Normalizes `activeKeys` to an array `active`.
  - `isAll` = `active.includes('ALL') || active.length===0`.
  - Builds the "All" chip HTML with `onclick="NR.toggleFilter('ALL')"` and `active`/`aria-pressed` reflecting `isAll`.
  - Maps `NEWS_INSTRUMENTS` to one chip each, marking `active` when `!isAll && active.includes(i.key)`, adding an extra `news-chip-custom` class for custom assets, with `onclick="NR.toggleFilter('${i.key}')"`.
  - Appends a fixed "+ ADD ASSET" button with `onclick="NR.openAssetForm()"`.
  - Concatenates all three pieces into `wrap.innerHTML`.
- **Calls:** `toggleFilter` (embedded only as an `onclick="NR.toggleFilter(...)"` string, not a direct JS call from this function), `_esc`, `openAssetForm` (likewise only via `onclick="NR.openAssetForm()"` string)
- **Called by:** `_esc` (mis-attributed per JSON), `setFilter`, `saveCustomAssets`, `removeCustomAsset`, `init`, `NewsView`, `NR` (mostly outside this chunk)
- **Side effects:** DOM — writes `#newsChips` innerHTML, embedding `onclick` handlers that call into the `NR` controller (`NR.toggleFilter`, `NR.openAssetForm`) — global namespace dependency on `NR` being defined elsewhere in the file.
- **Notes:** The `toggleFilter`/`openAssetForm` "calls" recorded in the JSON's `outboundCalls` are not actual JS function invocations from within `renderChips` itself — they only appear as literal strings inside the generated `onclick` attributes, invoked later by the browser when a user clicks a chip. This matches the task's noted caveat about inline `onclick` attributes.

#### renderSkeletons(n)

- **File:** Trade_Journal/index.html (lines 19292-19311) — nested inside `NewsView`
- **Module:** News Feed / View
- **Purpose:** Renders `n` placeholder "loading skeleton" article cards into `#newsList` while a fetch is in progress.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| n | number | Number of skeleton cards to render. |

- **Returns:** `void`
- **Internal logic:**
  - Guards on `#newsList` missing.
  - Builds `n` copies (via `Array.from({length:n}).map(...)`) of a skeleton card markup (a placeholder thumbnail block plus several gray bars of varying widths simulating badge/title/description lines), each marked `pointer-events:none` and `aria-hidden="true"`.
  - Joins and wraps in a `<div class="news-list">...</div>`, writes to `wrap.innerHTML`.
- **Calls:** (none)
- **Called by:** `_esc` (mis-attributed per JSON), `NewsView`, `NR`
- **Side effects:** DOM — writes `#newsList` innerHTML (replacing whatever was there, e.g. previous articles or another state card).
- **Notes:** Purely presentational; no data dependency at all beyond the count `n`.

#### renderStateCard(icon, title, body, extra)

- **File:** Trade_Journal/index.html (lines 19313-19322) — nested inside `NewsView`
- **Module:** News Feed / View
- **Purpose:** Generic centered "state" card renderer (used for empty-state, error, and key-prompt messaging) into `#newsList`.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| icon | string | HTML/emoji/HTML-entity icon markup, inserted unescaped. |
| title | string | Card title text, HTML-escaped before insertion. |
| body | string | Card body text, HTML-escaped before insertion. |
| extra | string \| undefined | Optional pre-built trusted HTML (e.g. an action button), inserted unescaped; defaults to empty string if falsy. |

- **Returns:** `void`
- **Internal logic:**
  - Guards on `#newsList` missing.
  - Builds a `<div class="news-state-card" role="status">` with an icon div (raw `icon`), a title div (`_esc(title)`), a body div (`_esc(body)`), and `extra||''` appended raw.
  - Writes to `wrap.innerHTML`.
- **Calls:** `_esc`
- **Called by:** `_esc` (mis-attributed per JSON), `renderKeyPrompt`, `_renderPage`, `NewsView`, `NR`
- **Side effects:** DOM — writes `#newsList` innerHTML.
- **Notes:** `icon` and `extra` are intentionally NOT escaped (they're meant to carry markup — e.g. an HTML entity icon or a `<button>` element), while `title`/`body` are always escaped — callers must never pass untrusted/user-supplied text as `icon`/`extra`.

#### renderKeyPrompt()

- **File:** Trade_Journal/index.html (lines 19324-19333) — nested inside `NewsView`
- **Module:** News Feed / View
- **Purpose:** Renders the "API key required" empty-state card shown when no news provider key has been configured yet.
- **Parameters:** None
- **Returns:** `void`
- **Internal logic:** Calls `renderStateCard('&#128273;', 'API key required', 'This news feed uses financial news APIs for clean, ad-free structured data.', <button HTML>)`, where the `extra` button has `onclick="NR.showKeyModal()"`.
- **Calls:** `renderStateCard`, `showKeyModal` (only via the embedded `onclick="NR.showKeyModal()"` string, not a direct call)
- **Called by:** `_esc` (mis-attributed per JSON), `_renderPage`, `init`, `NewsView`, `NR`
- **Side effects:** DOM — delegates to `renderStateCard`'s `#newsList` write.
- **Notes:** The lock icon is passed as the raw HTML entity `&#128273;` rather than a literal emoji character.

#### renderArticles(articles)

- **File:** Trade_Journal/index.html (lines 19335-19363) — nested inside `NewsView`
- **Module:** News Feed / View
- **Purpose:** Renders the main list of news article cards (thumbnail, source badge, relative time, instrument tags, headline, description) into `#newsList`.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| articles | Array\<Object\> | Normalized, already-filtered/paginated article objects to render. |

- **Returns:** `void`
- **Internal logic:**
  - Guards on `#newsList` missing OR `articles.length` falsy (empty array) — in the empty case, silently returns without touching the DOM at all (does not clear or replace existing content; an empty-state message must be rendered separately by the caller via `renderStateCard`).
  - For each article: builds instrument tag pills by looking up each key in `a.instruments` against `NEWS_INSTRUMENTS` (skips unknown keys, rendering an empty string for them); builds a thumbnail `<img>` with a `loading="lazy"` attribute and an inline `onerror` handler that swaps in a placeholder emoji block and removes the broken `<img>` (falls back to the placeholder directly if `a.thumbnail` is falsy from the start).
  - Wraps each article in an `<a class="news-card" href="{url}" target="_blank" rel="noopener noreferrer" role="listitem">`, containing the thumbnail, a meta row (source badge, `_timeAgo(publishedAt)`, tags), the headline, and an optional description block.
  - Joins all article cards inside a `<div class="news-list" role="list">` wrapper and writes to `wrap.innerHTML`.
- **Calls:** `_esc`, `remove` (only as part of the generated `onerror="...this.remove()"` inline JS string — a DOM element method invoked later by the browser, not a call made by `renderArticles` itself), `_timeAgo`
- **Called by:** `_esc` (mis-attributed per JSON), `_renderPage`, `NewsView`, `NR`
- **Side effects:** DOM — writes `#newsList` innerHTML; embeds inline `onerror` handlers on `<img>` tags that self-heal broken thumbnails at render time in the browser.
- **Notes:** All external/user-influenced text (`url`, `headline`, `description`, `source`) is passed through `_esc`, including the `href` value — this both HTML-escapes it and means a URL containing e.g. `&` is rendered with `&amp;`, which is intentionally correct for HTML attribute contexts (the browser un-escapes it back to `&` when following the link).

#### updateStatus(html)

- **File:** Trade_Journal/index.html (lines 19365-19368) — nested inside `NewsView`
- **Module:** News Feed / View
- **Purpose:** Writes pre-built status-line HTML (e.g. "Updated 2m ago · 3 sources") into the news status text element.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| html | string | Trusted, pre-built HTML/text to display as the status line. |

- **Returns:** `void`
- **Internal logic:** Guards on `#newsStatusText` missing; if present, sets `el.innerHTML = html` directly.
- **Calls:** (none)
- **Called by:** `_esc` (mis-attributed per JSON), `_renderPage`, `init`, `NewsView`, `NR`
- **Side effects:** DOM — writes `#newsStatusText` innerHTML.
- **Notes:** Unlike `renderStateCard`/`renderArticles`, `html` is written completely unescaped/untrusted-as-is — callers are responsible for pre-escaping any dynamic text embedded in the string they pass in (the function itself performs no `_esc` call).


---

## Trade_Journal — Functions (chunk 7 of 8, lines 19370-20216)

This chunk covers the tail of the **NewsView** module (modal/state helpers), the entire **NR** ("News controller") module, the entire **EC** (Forex Factory economic-calendar) module, and the entire **DC** (Discord feed) module — the last four IIFE-scoped modules in the file, running from line 19370 to the closing `</script>` at line 20214.

**Methodology note (read before the entries below):** `tj_chunk7.json`'s `inboundCallers`/`outboundCalls` arrays are static-analysis output and are noisy in a systematic way for this chunk. Because `NewsView`, `NR`, `EC`, and `DC` are IIFEs whose closing `return { fnA, fnB, ... }` statement lists their own public methods by bare name, the analyzer appears to mis-attribute the *enclosing module itself* as a "caller" of every function it returns (e.g. every NewsView-owned function's `inboundCallers` ends with `NewsView, NR`; every EC-owned function's ends with `NewsView, EC`). Likewise a generic `_esc` shows up as a caller/callee on many unrelated entries — this is almost certainly cross-talk with the file's other, globally-used `_esc(...)` HTML-escape helper (there is *also* a second, local, shadowing `_esc` defined inside `DC` itself — see the DC module note). Below, each entry reproduces the JSON's raw list verbatim (as instructed) and then adds a "Verified" clause identifying the actual call site(s) confirmed by reading the code in this slice. Names such as `navTo` that plausibly live outside this chunk are left as-is (unverifiable from this slice alone).

**Inventory gaps found while reading the source** (flagging per task instructions — these are real functions in the source that do **not** appear as their own entries in `tj_chunk7.json`, apparently because their names collide with another same-named function elsewhere in the file and the extractor kept only one definition per name):
- `_saveCache(events)` — lines 19710-19719, inside `EC`. Real sibling of `_loadCache`; documented inline under `_fetch` below since that's its only caller.
- `EC`'s own `init()` method (lines 19906-19910, inside `EC`'s returned object) — distinct from `NR`'s `init()` (19646-19666), which *is* the JSON's "init" entry. Documented inline under the `EC` module entry.
- `EC`'s own no-op `setFilter() {}` stub (~line 19924) — distinct from `NR`'s real `setFilter(keys)`. Documented inline under the `EC` module entry.
- `DC`'s own `async function init()` (lines 20099-20109) — a genuine, distinct entry point (starts the initial channel fetch and a 2-minute auto-refresh timer). Not in the JSON at all. Documented inline under the `DC` module entry.
- `DC`'s local `_esc(s)` (line 19961) and `_timeAgo(ts)` (lines 19962-19966) — small helpers local to `DC`, shadowing the file's global `_esc`. Documented inline where used (`_renderSidebar`, `_renderMessages`).

All 56 functions listed in `tj_chunk7.json` are documented below with their own `###` entry, in the order given.

---

### Module: News View — Modal & Refresh State (tail of `NewsView` IIFE)

#### setRefreshState(loading)

- **File:** Trade_Journal/index.html (lines 19370-19377)
- **Module:** NewsView (News UI rendering helpers)
- **Purpose:** Switches the news page's refresh button between its idle "REFRESH" label and a spinning "FETCHING…" busy state.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| loading | boolean | true while a news fetch is in flight |

- **Returns:** void
- **Internal logic:**
  - Looks up `#newsRefreshBtn`; guard-returns if not present in the DOM.
  - Sets `btn.disabled = loading`.
  - Sets `btn.innerHTML` to a spinning glyph (`<span class="nspin">⟳</span> FETCHING…`) when `loading` is true, otherwise to `⟳ REFRESH`.
- **Calls:** (none)
- **Called by:** Per JSON: `_esc, NewsView, NR`. Verified: called from `NR.refresh()` (lines 19624 and 19631, once with `true` before the fetch and once with `false` after). `_esc`/`NewsView` in the JSON list are module-return-statement noise (see methodology note above).
- **Side effects:** Mutates DOM element `#newsRefreshBtn` (`disabled` attribute, `innerHTML`).
- **Notes:** Purely a view-state toggle; holds no module state of its own (reads button, doesn't track a flag).

#### setLoadMoreVisible(v)

- **File:** Trade_Journal/index.html (lines 19379-19382)
- **Module:** NewsView
- **Purpose:** Shows or hides the "load more articles" button under the news feed.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|

| v | boolean | true to show the button, false to hide |

- **Returns:** void
- **Internal logic:** Looks up `#newsLoadMore`; if found, sets `style.display` to `'block'` when `v` is truthy, else `'none'`.
- **Calls:** (none)
- **Called by:** Per JSON: `_esc, _renderPage, NewsView, NR`. Verified: called from `NR._renderPage()` (line 19511) with `filtered.length > slice.length`.
- **Side effects:** Mutates DOM element `#newsLoadMore` (`style.display`).
- **Notes:** None beyond the null-check guard.

#### setSearchClearVisible(v)

- **File:** Trade_Journal/index.html (lines 19384-19387)
- **Module:** NewsView
- **Purpose:** Shows or hides the "×" clear-button next to the news search box depending on whether there's search text.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| v | boolean | true when the search input is non-empty |

- **Returns:** void
- **Internal logic:** Looks up `#newsSearchClear`; if found, toggles its `visible` CSS class based on `v`.
- **Calls:** (none)
- **Called by:** Per JSON: `_esc, onSearch, NewsView, NR`. Verified: called from `NR.onSearch(val)` (line 19539) with `val.length > 0`.
- **Side effects:** Mutates DOM element `#newsSearchClear` (class list).
- **Notes:** Uses `classList.toggle(cls, v)` two-argument form, so it's an explicit set rather than a flip.

#### openKeyModal(keys)

- **File:** Trade_Journal/index.html (lines 19389-19443)
- **Module:** NewsView
- **Purpose:** Builds and injects a modal dialog into `document.body` prompting the user for their News API keys (Finnhub, Marketaux, Alpha Vantage), pre-filled with any existing values.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| keys | object `{finnhub?, marketaux?, alphavantage?}` | Current stored keys, used to pre-populate the inputs |

- **Returns:** void
- **Internal logic:**
  - Removes any pre-existing `#newsKeyModal` element first (idempotent re-open).
  - HTML-escapes each key value via `_esc(...)` before interpolating into `value="..."` attributes (XSS-safety for locally-stored strings).
  - Builds a fixed, centered overlay (`position:fixed;inset:0`) containing a card with three password-type inputs (`#nkFinnhub`, `#nkMarketaux`, `#nkAlphaVantage`), each with a link to the provider's site and a one-line description of its free tier.
  - Adds CANCEL and "SAVE & FETCH" buttons whose `onclick` attributes are the literal strings `NR.closeKeyModal()` and `NR.saveKeys()`.
  - Appends the modal to `document.body`.
- **Calls:** Per JSON: `remove, _esc, closeKeyModal, saveKeys`. Verified: `existing.remove()` and `_esc(...)` (×3) are real direct calls made by this function's own code. `closeKeyModal` and `saveKeys` are **not** actually invoked by this function's JS — they only appear as strings inside the `onclick="NR.closeKeyModal()"` / `onclick="NR.saveKeys()"` HTML attributes of the buttons it creates, fired later by the user's click, not during `openKeyModal`'s own execution. This is exactly the "call only via inline onclick" case the task asked to watch for, except here it's the source function's *own* template that embeds the call, rather than an external caller.
- **Called by:** Per JSON: `_esc, showKeyModal, NewsView, NR`. Verified: called from `NR.showKeyModal()` (line 19635) as `NewsView.openKeyModal(NewsRepository.getKeys())`.
- **Side effects:** Creates/replaces DOM element `#newsKeyModal` (appended to `document.body`); reads no localStorage itself (caller supplies `keys`).
- **Notes:** Keys are stored client-side only; the modal text explicitly says "Keys are stored on this device only." No validation is performed here — empty keys are just interpolated as empty strings.

#### closeKeyModal()

- **File:** Trade_Journal/index.html (lines 19445-19448)
- **Module:** NewsView
- **Purpose:** Removes the news API-key modal from the DOM if present.
- **Parameters:** None
- **Returns:** void
- **Internal logic:** Looks up `#newsKeyModal`; if found, calls `.remove()` on it.
- **Calls:** `remove` (real: `m.remove()`).
- **Called by:** Per JSON: `_esc, openKeyModal, saveKeys, NewsView, NR`. Verified: fired via the CANCEL button's `onclick="NR.closeKeyModal()"` (which itself calls `NewsView.closeKeyModal()`, see `NR.closeKeyModal` below) built inside `openKeyModal`, and directly from `NR.saveKeys()` (line 19642) after keys are saved.
- **Side effects:** Removes DOM element `#newsKeyModal`.
- **Notes:** Safe to call even if the modal isn't open (guarded by the `if (m)` check).

---

### Module: News Controller (`NR`)

#### NR

- **File:** Trade_Journal/index.html (lines 19463-19678)
- **Module:** NR (News controller, an IIFE assigned to `const NR`)
- **Purpose:** The stateful controller that mediates between `NewsRepository` (data/cache layer, defined earlier in the file), `NewsView` (render layer, just above), `EC` (economic calendar), and `DC` (Discord); owns UI state (current filter, search query, pagination, loading flag, poll timer) for the News page and exposes a public API consumed via `onclick="NR.xxx()"` attributes in the HTML.
- **Parameters:** None (IIFE, invoked immediately and assigned to `NR`)
- **Returns:** A public API object: `{ init, refresh, setFilter, toggleFilter, onSearch, clearSearch, loadMore, showKeyModal, closeKeyModal, saveKeys, openAssetForm, closeAssetForm, saveCustomAssets, removeCustomAsset }`.
- **Internal logic:**
  - Destructures `{ PAGE_SIZE, REFRESH_MS, CACHE_TTL }` from `NewsRepository.getConstants()` at module-init time (constants baked in once, not re-read).
  - Owns a single private state object `_st = { loading, filter: ['ALL'], query: '', page: 1, timer: null, ready: false }`, closed over by every inner function (no `S.*` mutation — this is module-local state, not global app state).
  - Defines all of the functions documented individually below, then returns the public subset.
- **Calls:** Per JSON, the union of everything its inner functions call (getConstants, _buildStatus, getArticles, filter, getLastFetched, getStatuses, _renderPage, hasAnyKey, renderKeyPrompt, renderStateCard, renderArticles, setLoadMoreVisible, updateStatus, setFilter, renderChips, toggleFilter, onSearch, setSearchClearVisible, clearSearch, loadMore, openAssetForm, get, removeCustomAsset, closeAssetForm, remove, saveCustomAssets, build, _refreshInstruments, _rebuildSymMap, refreshCustomAssets, retagAll, refresh, setRefreshState, renderSkeletons, showKeyModal, openKeyModal, getKeys, closeKeyModal, saveKeys, setKeys, init, _startTimer, loadFromCache).
- **Called by:** JSON shows no inbound callers for the IIFE itself (it's a top-level `const`, not invoked elsewhere by name) — expected, since `NR` is a module singleton referenced as `NR.method()` from HTML `onclick` attributes and from `init()`'s caller `navTo` (per the `init` entry below).
- **Side effects:** Declares `_st` (module-private, not global `S`); registers a `setInterval` timer (via `_startTimer`, stored in `_st.timer`).
- **Notes:** The comment directly above this module in the source (line 19461) states "All public methods are called directly from HTML onclick" — confirming the HTML wiring is the intended call path for the returned API, not JS-to-JS calls from other modules (aside from `EC`/`DC`, which `NR.init` drives directly).

#### _buildStatus()

- **File:** Trade_Journal/index.html (lines 19475-19489)
- **Module:** NR
- **Purpose:** Builds the small status-line string shown under the news header (e.g. "Updated 3m ago · 2 providers active · 14 articles").
- **Parameters:** None
- **Returns:** string — an HTML fragment (uses `&middot;` separators and a `<span>` for error styling), or `'—'` if nothing to report.
- **Internal logic:**
  - If `_st.loading` is true, short-circuits and returns a spinner + "Fetching news…" fragment.
  - Otherwise pulls `all = NewsRepository.getArticles()`, `filtered = NewsRepository.filter({instrumentKeys:_st.filter, searchQuery:_st.query})`, `lf = NewsRepository.getLastFetched()`, `statuses = NewsRepository.getStatuses()`.
  - Counts `ok`/`error` provider statuses via `Object.values(statuses).filter(...)`.
  - Assembles `parts[]`: "Updated Xm ago" (or "just now" if `<1` min) if `lf` is set; "N provider(s) active" if `ok>0`; a red-styled "N failed" span if `err>0`; "N article(s)" if `all.length>0`.
  - Joins parts with `' &middot;'` or returns `'—'` if `parts` is empty.
- **Calls:** `getArticles, filter, getLastFetched, getStatuses` (all on `NewsRepository`).
- **Called by:** Per JSON: `_esc, _renderPage, NewsView, NR`. Verified: called from `NR._renderPage()` (line 19512) and from `NR.refresh()`'s progress callback (line 19628, `() => NewsView.updateStatus(_buildStatus())`).
- **Side effects:** None (pure read + string build); no DOM writes itself (caller passes the string to `NewsView.updateStatus`).
- **Notes:** Time-ago math is simple `Math.floor((Date.now()-lf)/60000)` — minutes only, no hour/day granularity.

#### _renderPage()

- **File:** Trade_Journal/index.html (lines 19491-19513)
- **Module:** NR
- **Purpose:** Central re-render routine for the News page: decides which empty/loaded state to show and paints the current page of filtered articles.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Computes `all = NewsRepository.getArticles()`, `filtered = NewsRepository.filter({instrumentKeys:_st.filter, searchQuery:_st.query})`, `slice = filtered.slice(0, _st.page * PAGE_SIZE)`.
  - Branch 1 — no articles fetched at all and not loading: if no API key configured (`!NewsRepository.hasAnyKey()`) show the key prompt; else show a generic "No articles loaded / tap REFRESH" state card.
  - Branch 2 — articles exist but current filter/search yields none, and not loading: three sub-cases — a non-empty search query ("No results" card naming the query), a non-"ALL" instrument filter ("No articles for this instrument"), or otherwise a generic "No articles" card.
  - Branch 3 — otherwise: renders the `slice` via `NewsView.renderArticles(slice)`.
  - Always updates the load-more button visibility (`filtered.length > slice.length`) and the status line (`_buildStatus()`).
- **Calls:** `getArticles, filter, hasAnyKey, renderKeyPrompt, renderStateCard, renderArticles, setLoadMoreVisible, updateStatus, _buildStatus`.
- **Called by:** Per JSON: `_esc, setFilter, onSearch, loadMore, saveCustomAssets, removeCustomAsset, init, NewsView, NR`. Verified: all of the non-noise names are genuine — `setFilter`, `onSearch`, `loadMore`, `saveCustomAssets` (called twice), `removeCustomAsset`, and `init` all call `_renderPage()` directly in this chunk's source.
- **Side effects:** Drives DOM writes indirectly through `NewsView.*` (articles list container, load-more button, status line).
- **Notes:** This is the single "render everything" chokepoint for the News page — every state-mutating action (filter change, search, pagination, refresh, custom-asset edits) funnels back through it.

#### setFilter(keys)

- **File:** Trade_Journal/index.html (lines 19515-19522)
- **Module:** NR
- **Purpose:** Replaces the active instrument filter and re-renders the page and filter chips; also propagates the filter to the economic calendar module.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| keys | string \| string[] | One instrument key or an array of them; e.g. `'ALL'`, `['EUR','GBP']` |

- **Returns:** void
- **Internal logic:**
  - Normalizes `keys` to an array (wraps a bare string).
  - Falls back to `['ALL']` if the resulting array is empty.
  - Resets `_st.page = 1` (filter change restarts pagination).
  - Re-renders the filter chip bar (`NewsView.renderChips`), the page (`_renderPage`), and forwards the same filter to `EC.setFilter(_st.filter)`.
- **Calls:** Per JSON: `renderChips, _renderPage`. **Gap noted:** the source also calls `EC.setFilter(_st.filter)` at line 19521, which is missing from the JSON's outboundCalls — almost certainly because the callee name `setFilter` is identical to this function's own name and got filtered as a spurious self-reference.
- **Called by:** Per JSON: `_esc, toggleFilter, init, NewsView, NR, EC`. Verified: called from `NR.toggleFilter(key)` (line 19536) and from `NR.init()` (line 19649: `EC.setFilter(_st.filter)` — wait, that's `EC`'s no-op; the real `NR.init()` → `NR.setFilter`? Re-checking source: `init()` does not call `NR.setFilter` directly, only `EC.init()`/`EC.setFilter()`. So the real internal caller of **this** `setFilter` is `toggleFilter` only, plus the initial chip render path is via `NewsView.renderChips` in `init` calling `_st.filter` directly, not through this function). The `EC` entry in the JSON caller list is likely the reciprocal noise (EC's own no-op `setFilter` sharing the name).
- **Side effects:** Mutates module state `_st.filter`, `_st.page`; triggers DOM re-render via `NewsView.renderChips`/`_renderPage`; calls into the `EC` module.
- **Notes:** This is the only place `_st.filter` is assigned aside from direct field access in `init`'s setup — the effective "setter" for instrument filtering.

#### toggleFilter(key)

- **File:** Trade_Journal/index.html (lines 19524-19537)
- **Module:** NR
- **Purpose:** Toggles a single instrument key in/out of the active multi-select filter (chip click handler), with `'ALL'` acting as an exclusive reset option.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| key | string | Instrument key being toggled, e.g. `'ALL'`, `'EUR'`, `'CUSTOM0'` |

- **Returns:** void
- **Internal logic:**
  - If `key === 'ALL'`: sets `_st.filter = ['ALL']` unconditionally (selecting "All" clears every other selection).
  - Otherwise: starts from the current filter with `'ALL'` stripped out; if `key` is already present, removes it; otherwise appends it; if the result is empty, falls back to `['ALL']`.
  - Delegates the actual state write + re-render to `setFilter(_st.filter)`.
- **Calls:** `filter` (array `.filter()`), `setFilter`.
- **Called by:** Per JSON: `_esc, renderChips, NewsView, NR`. Verified: invoked via chip buttons rendered by `NewsView.renderChips` with an `onclick="NR.toggleFilter('...')"` attribute (external HTML wiring — `renderChips` itself lives in `NewsView`, outside this chunk, so this cross-module JSON attribution is plausible/real here, unlike the pure-noise cases).
- **Side effects:** Indirectly mutates `_st.filter` via `setFilter`.
- **Notes:** Multi-select toggle logic — clicking a second currency adds it alongside the first rather than replacing it, until nothing is left, at which point it reverts to `'ALL'`.

#### onSearch(val)

- **File:** Trade_Journal/index.html (line 19539)
- **Module:** NR
- **Purpose:** Handles input events from the news search box — updates the query, resets pagination, toggles the clear button, and re-renders.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| val | string | Current text of the search input |

- **Returns:** void
- **Internal logic:** One-liner: `_st.query = val; _st.page = 1; NewsView.setSearchClearVisible(val.length>0); _renderPage();`
- **Calls:** `setSearchClearVisible, _renderPage`.
- **Called by:** Per JSON: `_esc, clearSearch, NewsView, NR`. Verified: called from `NR.clearSearch()` (line 19540, with `''`) and wired as the search input's live `oninput`/`onkeyup` handler in the HTML (outside this chunk).
- **Side effects:** Mutates `_st.query`, `_st.page`.
- **Notes:** No debouncing — every keystroke triggers a full `_renderPage()`, which re-filters the entire article list client-side.

#### clearSearch()

- **File:** Trade_Journal/index.html (line 19540)
- **Module:** NR
- **Purpose:** Clears the search input field and resets the search-driven view state.
- **Parameters:** None
- **Returns:** void
- **Internal logic:** Looks up `#newsSearchInput`; if present, sets its `.value` to `''`; then calls `onSearch('')` to propagate the reset.
- **Calls:** `onSearch`.
- **Called by:** Per JSON: `_esc, NewsView, NR`. Verified: this is the target of the search box's "×" clear button, wired via `onclick="NR.clearSearch()"` in the HTML (outside this chunk); no other in-chunk caller found (the JSON entries here are the module-name noise pattern only).
- **Side effects:** Mutates DOM element `#newsSearchInput.value`; indirectly re-renders via `onSearch`.
- **Notes:** None.

#### loadMore()

- **File:** Trade_Journal/index.html (line 19541)
- **Module:** NR
- **Purpose:** Advances pagination by one page (increases the number of articles shown) when the "load more" button is clicked.
- **Parameters:** None
- **Returns:** void
- **Internal logic:** `_st.page += 1; _renderPage();`
- **Calls:** `_renderPage`.
- **Called by:** Per JSON: `_esc, NewsView, NR`. Verified: this is the target of the `#newsLoadMore` button, wired via `onclick="NR.loadMore()"` in the HTML (outside this chunk).
- **Side effects:** Mutates `_st.page`.
- **Notes:** No upper bound check on `page` — `_renderPage`'s slice naturally caps at `filtered.length`, so an extra click past the end is harmless (load-more button is hidden once `filtered.length <= slice.length`).

#### openAssetForm()

- **File:** Trade_Journal/index.html (lines 19544-19572)
- **Module:** NR
- **Purpose:** Renders and opens the "custom asset" configuration form (up to `CUSTOM_ASSET_SLOTS` user-defined instrument trackers with label/keywords/currencies).
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Looks up `#newsAssetForm` and `#newsAssetFormSlots`; guard-returns if either is missing.
  - Reads existing custom assets via `_CustomAssets.get()`.
  - For each of `CUSTOM_ASSET_SLOTS` slots, builds a labeled group of three inputs (Label, Keywords comma-separated, Currencies comma-separated), pre-filled from the existing asset at that index if present, plus a "✕ remove" button (`onclick="NR.removeCustomAsset(i)"`) shown only for populated slots.
  - Manually HTML-escapes quotes in interpolated values (`.replace(/"/g,'&quot;')`) rather than using a general escape helper.
  - Sets `slots.innerHTML` to the built markup and adds the `open` class to the form container (CSS-driven show/hide).
- **Calls:** Per JSON: `get, removeCustomAsset`. Verified: `_CustomAssets.get()` is a real direct call; `removeCustomAsset` is **not** called directly by this function's JS — it only appears inside the generated `onclick="NR.removeCustomAsset(${i})"` attribute string, fired later by a user click.
- **Called by:** Per JSON: `_esc, renderChips, removeCustomAsset, NewsView, NR`. Verified: called from `NR.removeCustomAsset(idx)` (line 19611, to redraw the form with an updated slot list) and from the "add/edit custom asset" UI trigger wired via HTML (outside this chunk, likely `onclick="NR.openAssetForm()"`).
- **Side effects:** Mutates DOM elements `#newsAssetFormSlots` (innerHTML) and `#newsAssetForm` (class list).
- **Notes:** Quote-escaping here is manual and narrower than the shared `_esc` helper (only escapes `"`, not `&`/`<`/`>`), a minor inconsistency worth flagging for anyone hardening this form against injected HTML in labels/keywords.

#### closeAssetForm()

- **File:** Trade_Journal/index.html (lines 19574-19576)
- **Module:** NR
- **Purpose:** Hides the custom-asset configuration form.
- **Parameters:** None
- **Returns:** void
- **Internal logic:** `document.getElementById('newsAssetForm')?.classList.remove('open');` — optional-chained so it's a no-op if the element doesn't exist.
- **Calls:** `remove` (`classList.remove`).
- **Called by:** Per JSON: `saveCustomAssets, NewsView, NR`. Verified: called from `NR.saveCustomAssets()` (line 19591) after the form is submitted; also plausibly wired to a "Cancel" button via HTML `onclick="NR.closeAssetForm()"` outside this chunk.
- **Side effects:** Mutates DOM element `#newsAssetForm` (class list).
- **Notes:** None.

#### saveCustomAssets()

- **File:** Trade_Journal/index.html (lines 19578-19597)
- **Module:** NR
- **Purpose:** Reads the custom-asset form inputs, persists the non-empty slots, and refreshes every dependent subsystem (instrument list, symbol map, EC's custom-asset awareness, chip bar, cached-article tagging).
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Loops `i` from 0 to `CUSTOM_ASSET_SLOTS-1`, reading `#caLabel{i}`, `#caKeywords{i}`, `#caCurrencies{i}` and trimming each.
  - Skips a slot entirely if all three fields are empty (`continue`).
  - Otherwise builds an asset object via `_CustomAssets.build(label, kw, ccy, i)` and pushes it to `list`.
  - Persists via `_CustomAssets.save(list)`.
  - Calls `_refreshInstruments()` and `_rebuildSymMap()` (instrument-registry rebuild, defined elsewhere in the file) and `EC.refreshCustomAssets()` (no-op stub in this chunk).
  - Closes the form (`closeAssetForm()`), re-renders the filter chips (`NewsView.renderChips(_st.filter)`) and the page (`_renderPage()`).
  - Calls `NewsRepository.retagAll()` to retroactively re-tag already-cached articles against the new custom keywords, then renders the page a second time to reflect the retag.
- **Calls:** Per JSON: `build, _refreshInstruments, _rebuildSymMap, refreshCustomAssets, closeAssetForm, renderChips, _renderPage, retagAll`. **Gap noted:** the direct call `_CustomAssets.save(list)` (line 19587) is missing from the JSON's outboundCalls list.
- **Called by:** Per JSON: `NewsView, NR`. Verified: this is the "Save" button's handler for the custom-asset form, wired via HTML `onclick="NR.saveCustomAssets()"` outside this chunk — no in-chunk JS caller found (the JSON entries are module-name noise).
- **Side effects:** Persists custom assets (via `_CustomAssets.save`, localStorage-backed elsewhere in the file); triggers instrument/symbol-map rebuilds; re-renders the asset form's dependents; re-tags cached articles.
- **Notes:** `_renderPage()` is intentionally called twice — once immediately after saving (with old article tags) and once after `retagAll()` completes (to reflect the new tags) — since `retagAll` appears to run synchronously here.

#### removeCustomAsset(idx)

- **File:** Trade_Journal/index.html (lines 19599-19614)
- **Module:** NR
- **Purpose:** Deletes one custom-asset slot by index, cleans it out of the active filter if selected, and refreshes the same dependent subsystems as `saveCustomAssets`.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| idx | number | Index of the custom asset to remove (matches its position in `_CustomAssets.get()`) |

- **Returns:** void
- **Internal logic:**
  - Copies the current custom-asset list, `.splice(idx, 1)`s the target out, and persists via `_CustomAssets.save(list)`.
  - Rebuilds instruments/symbol map (`_refreshInstruments`, `_rebuildSymMap`) and notifies `EC.refreshCustomAssets()`.
  - Computes `removedKey = 'CUSTOM' + idx` and strips it from `_st.filter`; if that empties the filter, resets to `['ALL']`.
  - Calls `NewsRepository.retagAll()` to un-tag articles that only matched the removed asset's keywords.
  - Re-opens the asset form (`openAssetForm()`) so it redraws with the updated (shifted) slot list, then re-renders chips and the page.
- **Calls:** Per JSON: `get, _refreshInstruments, _rebuildSymMap, refreshCustomAssets, filter, retagAll, openAssetForm, renderChips, _renderPage`. **Gap noted:** the direct call `_CustomAssets.save(list)` (line 19602) is missing from the JSON's outboundCalls, same pattern as `saveCustomAssets`.
- **Called by:** Per JSON: `_esc, openAssetForm, NewsView, NR`. Verified: invoked via the per-slot "✕" remove button generated inside `openAssetForm()`, wired as `onclick="NR.removeCustomAsset(${i})"`.
- **Side effects:** Persists the shrunk custom-asset list; mutates `_st.filter`; multiple DOM re-renders.
- **Notes:** Because indices shift after a splice, re-invoking `openAssetForm()` (rather than patching the DOM in place) is the simplest way to keep slot numbering and remove-button indices consistent.

#### showKeyModal()

- **File:** Trade_Journal/index.html (line 19635)
- **Module:** NR
- **Purpose:** Opens the API-key entry modal, pre-populated with whatever keys are currently stored.
- **Parameters:** None
- **Returns:** void
- **Internal logic:** `NewsView.openKeyModal(NewsRepository.getKeys());`
- **Calls:** `openKeyModal, getKeys`.
- **Called by:** Per JSON: `_esc, renderKeyPrompt, NewsView, NR`. Verified: `renderKeyPrompt` (in `NewsView`, outside this chunk) plausibly renders a "configure keys" call-to-action whose button is wired to `onclick="NR.showKeyModal()"`.
- **Side effects:** Indirectly creates the `#newsKeyModal` DOM element via `NewsView.openKeyModal`.
- **Notes:** None.

#### saveKeys()

- **File:** Trade_Journal/index.html (lines 19637-19644)
- **Module:** NR
- **Purpose:** Reads the three API-key inputs from the open modal, persists them, closes the modal, and triggers an immediate refresh.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Reads and trims `#nkFinnhub`, `#nkMarketaux`, `#nkAlphaVantage` values (defaulting to `''` if the element is missing).
  - Calls `NewsRepository.setKeys({ finnhub, marketaux, alphavantage })`.
  - Closes the modal (`NewsView.closeKeyModal()`).
  - Calls `refresh()` to immediately fetch news with the newly-saved keys.
- **Calls:** `setKeys, closeKeyModal, refresh`.
- **Called by:** Per JSON: `_esc, openKeyModal, NewsView, NR`. Verified: this is the "SAVE & FETCH" button's handler, wired via `onclick="NR.saveKeys()"` inside the modal markup built by `openKeyModal`.
- **Side effects:** Persists keys via `NewsRepository.setKeys` (localStorage-backed elsewhere in the file); closes modal DOM element; triggers a network fetch via `refresh()`.
- **Notes:** No validation that at least one key is non-empty before saving — `refresh()` itself guards on `NewsRepository.hasAnyKey()` and will just re-show the key prompt if all three are blank.

#### init()

- **File:** Trade_Journal/index.html (lines 19646-19666)
- **Module:** NR
- **Purpose:** One-time (idempotent-ish) bootstrap of the News page: wires up the filter chips, starts the `EC` and `DC` sub-modules, loads cached articles, and decides whether an immediate network refresh is needed.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Always renders the filter chips (`NewsView.renderChips(_st.filter)`) and starts `EC.init()`, `EC.setFilter(_st.filter)`, `DC.init()` — every call to `NR.init()` re-triggers these three regardless of `_st.ready`.
  - If `_st.ready` is already true (i.e. this isn't the first time the News page has been opened this session): just re-renders the page (`_renderPage()`) and restarts the poll timer (`_startTimer()`), then returns early — skips cache-loading and the key-prompt check.
  - Otherwise (first run): sets `_st.ready = true`; loads cached articles + keys via `NewsRepository.loadFromCache()`.
  - If no API key is configured, renders the key prompt and an explanatory status message, and returns (no refresh attempted).
  - If cache had data, renders the page immediately (so the user sees something before any network round-trip).
  - Computes cache age from `NewsRepository.getLastFetched()` (or `Infinity` if never fetched); if older than `CACHE_TTL`, kicks off `refresh()`.
  - Starts the polling timer (`_startTimer()`) unconditionally at the end (both on first run and, via the early-return branch above, on subsequent runs).
- **Calls:** Per JSON: `renderChips, setFilter, _renderPage, _startTimer, loadFromCache, hasAnyKey, renderKeyPrompt, updateStatus, getLastFetched, refresh`. **Gap noted:** the real calls `EC.init()`, `EC.setFilter(_st.filter)`, and `DC.init()` (lines 19648-19650) are not represented in the JSON outboundCalls — again the same-name collision (this function is itself named `init`, and `EC`/`DC` each have their own `init`, so self-referential-looking calls appear to have been filtered). These are the actual **bootstrap triggers for the EC and DC modules** and are important: opening the News page is what starts the economic-calendar fetch and the Discord channel fetch, not a top-level script call.
- **Called by:** Per JSON: `navTo, NewsView, NR`. Verified: `navTo` (page-router function, defined elsewhere in the file, not in this chunk) is the credible real caller — i.e., `NR.init()` runs when the user navigates to the News page/tab.
- **Side effects:** Mutates `_st.ready`; (re)creates the polling `setInterval` via `_startTimer`; indirectly triggers network fetches in `NewsRepository`, `EC`, and `DC`.
- **Notes:** This is the closest thing to an "entry point" in this chunk for the whole News/Calendar/Discord feature area — it isn't called at the very bottom of the script (unlike the bootstrap calls for other unrelated features at lines 20200-20213), but is instead invoked on-demand by the SPA's router (`navTo`) the first time the user visits the News page, and re-invoked (cheaply, via the `_st.ready` fast path) on every subsequent visit.

#### _startTimer()

- **File:** Trade_Journal/index.html (lines 19668-19671)
- **Module:** NR
- **Purpose:** (Re)starts the periodic auto-refresh timer for the News feed.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - If a timer handle already exists in `_st.timer`, clears it first (`clearInterval`) — prevents duplicate timers from stacking up across repeated `init()` calls.
  - Sets a new `setInterval` at `REFRESH_MS` cadence whose callback calls `refresh()` only if `S.currentPage === 'news'` (skips network work while the user is on a different page/tab).
- **Calls:** `refresh` (conditionally, inside the interval callback).
- **Called by:** Per JSON: `init, NewsView, NR`. Verified: called twice from `NR.init()` — once in the early-return "already ready" branch and once at the very end of the first-run branch.
- **Side effects:** Creates a `setInterval` timer, storing its handle in module state `_st.timer`; reads global `S.currentPage` on each tick.
- **Notes:** The `S.currentPage` guard means the timer keeps running (and ticking) even off the News page, but its callback is a no-op unless the user is actively viewing News — a cheap way to avoid a second timer-management layer for pause/resume.

---

### Module: FF Economic Calendar (`EC`)

#### EC

- **File:** Trade_Journal/index.html (lines 19689-19927)
- **Module:** EC (Forex Factory economic-calendar IIFE, assigned to `const EC`)
- **Purpose:** Fetches, caches, filters, and renders the Forex Factory "this week" economic calendar (rate-limited free JSON feed proxied through the Cloudflare Worker), with user-configurable impact/currency filters persisted to localStorage.
- **Parameters:** None (IIFE)
- **Returns:** Public API object: `{ init(), manualRefresh(), toggleImp(imp, el), toggleCcy(ccy, el), setFilter() {}, refreshCustomAssets() {} }`. Note `setFilter` and `refreshCustomAssets` are intentional no-op stubs kept only so `NR` can call `EC.setFilter(...)` / `EC.refreshCustomAssets()` uniformly without needing to know whether EC actually uses instrument filtering (it doesn't — the calendar is filtered by impact/currency, not by instrument).
- **Internal logic:**
  - Module constants: `CACHE_KEY = 'ec_ff_cache_v1'`, `PREFS_KEY = 'ec_ff_prefs_v1'`, `FF_URL = CONFIG.CF_WORKER ? CONFIG.CF_WORKER + '/ff-calendar' : null` (feature is disabled if the Worker isn't configured), `NY_TZ = 'America/New_York'`, `LOCAL_TZ` from `Intl.DateTimeFormat().resolvedOptions().timeZone`, `SHOW_LOCAL = LOCAL_TZ !== NY_TZ` (only shows a second local-time column if the viewer isn't already in NY time).
  - `LOWER_BETTER` is a `Set` of keyword substrings (unemployment, jobless, initial claims, continuing claims, cpi, ppi, inflation, deficit, trade deficit) used to decide whether a lower actual-vs-forecast reading should be colored "good" or "bad".
  - Module state: `_events = []` (parsed calendar rows) and `_prefs = { impacts:['High','Medium','Low'], ccys:['USD','EUR','GBP','CHF'] }` (default filter prefs before `_loadPrefs()` runs).
  - **Inventory gap:** the returned object's own `init()` method (lines 19906-19910: `_loadPrefs(); _renderFilters(); _fetch(false);`) is a distinct function from `NR`'s `init()` and is not separately represented in `tj_chunk7.json` (name collision). Likewise the no-op `setFilter() {}` (~line 19924) is distinct from `NR.setFilter(keys)`.
- **Calls:** Per JSON, the union: `_loadCache, _saveCache, _nyDateStr, _nyHour, _needsFetch, _loadPrefs, _savePrefs, _fmtTime, _fmtDay, _dayKey, _actualClass, _renderFilters, toggleImp, toggleCcy, _render, filter, _setStatus, _fetch, _renderNeedsConfig, fetch, init, manualRefresh, setFilter, refreshCustomAssets`.
- **Called by:** JSON shows no inbound callers for the IIFE itself (top-level `const`, referenced as `EC.method()` elsewhere) — its `init()` and `setFilter()` are driven directly from `NR.init()` / `NR.setFilter()` (see those entries above).
- **Side effects:** Declares module-private `_events`/`_prefs`; reads/writes localStorage keys `ec_ff_cache_v1` and `ec_ff_prefs_v1`; performs a `fetch()` network call to `CONFIG.CF_WORKER + '/ff-calendar'`.
- **Notes:** The large source comment directly above this module (lines 19682-19688) documents the rate-limiting rationale: the FF feed is "rate-limited to 2 fetches per 5 min," so the module deliberately fetches at most once per calendar day (after 5pm NY) plus on manual refresh, backed by the localStorage cache — opening/closing the app repeatedly does not re-fetch.

#### _loadCache()

- **File:** Trade_Journal/index.html (lines 19706-19709)
- **Module:** EC
- **Purpose:** Reads the cached calendar payload from localStorage.
- **Parameters:** None
- **Returns:** object `{events, fetchedAt, fetchedNyDate}` or `null` if absent/corrupt.
- **Internal logic:** `try { return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch(e) { return null; }` — any parse error (corrupted JSON) is swallowed and treated as "no cache."
- **Calls:** (none)
- **Called by:** Per JSON: `_fetch, NewsView, EC`. Verified: called from `EC._fetch(force)` (line 19867) as the first step of every fetch decision.
- **Side effects:** Reads localStorage key `ec_ff_cache_v1`.
- **Notes:** Defensive `try/catch` guards against manually-edited or corrupted localStorage content.

#### _nyDateStr(d)

- **File:** Trade_Journal/index.html (lines 19722-19724)
- **Module:** EC
- **Purpose:** Formats a JS `Date` as a `YYYY-MM-DD` calendar-date string in the America/New_York timezone.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| d | Date | Any JS Date instance (interpreted in NY local time) |

- **Returns:** string, e.g. `'2026-08-24'` (uses the `en-CA` locale specifically because it formats as ISO-order `YYYY-MM-DD`).
- **Internal logic:** `return d.toLocaleDateString('en-CA', { timeZone: NY_TZ });`
- **Calls:** (none)
- **Called by:** Per JSON: `_needsFetch, NewsView, EC`. Verified: called twice inside `_needsFetch(cache)` (for "now" and implicitly compared against `cache.fetchedNyDate`) and once inside `_saveCache` (see notes on that function under `_fetch`).
- **Side effects:** None (pure).
- **Notes:** Using `en-CA` for its `YYYY-MM-DD` output format is a common JS idiom exploited here deliberately.

#### _nyHour(d)

- **File:** Trade_Journal/index.html (lines 19726-19730)
- **Module:** EC
- **Purpose:** Extracts the current hour-of-day (0-23) in America/New_York time from a JS `Date`.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| d | Date | Any JS Date instance |

- **Returns:** number, 0-23.
- **Internal logic:** Formats `d` via `toLocaleTimeString('en-US', {timeZone: NY_TZ, hour:'numeric', hour12:false})` and `parseInt(...,10)`s the result.
- **Calls:** (none)
- **Called by:** Per JSON: `_needsFetch, _fetch, NewsView, EC`. Verified: used inside `_needsFetch` (to decide the 30-minute intraday refresh window) and inside `_fetch` (to pick the "next refresh" status message text).
- **Side effects:** None (pure).
- **Notes:** `hour12:false` combined with `hour:'numeric'` reliably yields `'0'`-`'23'` (not `'00'`-`'23'`), which `parseInt` handles fine either way.

#### _needsFetch(cache)

- **File:** Trade_Journal/index.html (lines 19733-19747)
- **Module:** EC
- **Purpose:** Decides whether the cached calendar data is stale enough to warrant a fresh network fetch.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| cache | object \| null | Result of `_loadCache()` |

- **Returns:** boolean — true if a fetch should happen.
- **Internal logic:**
  - Guard: if `cache`, `cache.events`, or `cache.fetchedNyDate` is missing, returns true immediately (no usable cache).
  - Computes `todayNy = _nyDateStr(now)` and `nyH = _nyHour(now)`.
  - If the cache's `fetchedNyDate` is an earlier calendar day than today (string comparison works because the format is `YYYY-MM-DD`), returns true (always refetch once per new NY calendar day).
  - Otherwise, during NY trading hours (`nyH >= 7 && nyH < 17`), computes the cache's age in ms (`now - new Date(cache.fetchedAt)`) and returns true if that age exceeds 30 minutes — keeps "actual" values reasonably fresh as data releases land during the day.
  - Outside that 7am-5pm NY window, returns false (uses the existing same-day cache freely, no matter how old within the day).
- **Calls:** `_nyDateStr, _nyHour`.
- **Called by:** Per JSON: `_fetch, NewsView, EC`. Verified: called once, as the first real decision point in `EC._fetch(force)`.
- **Side effects:** None (pure, aside from reading `Date.now()` implicitly via `new Date()`).
- **Notes:** The 30-minute intraday refresh window is a deliberate compromise to surface newly-released "actual" figures without exceeding the FF feed's stated rate limit (2 fetches/5min) — worst case here is one fetch every 30 minutes during the 10-hour trading window, comfortably under that limit.

#### _loadPrefs()

- **File:** Trade_Journal/index.html (lines 19750-19753)
- **Module:** EC
- **Purpose:** Loads the user's saved impact/currency filter preferences from localStorage into module state, if present.
- **Parameters:** None
- **Returns:** void
- **Internal logic:** `try { const p = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null'); if (p) _prefs = p; } catch(e) {}` — on any parse failure, silently keeps the default `_prefs`.
- **Calls:** (none)
- **Called by:** Per JSON: `NewsView, EC`. Verified: called once, from `EC`'s own `init()` method (line 19907; not separately represented in the JSON, see the `EC` module entry's gap note).
- **Side effects:** Overwrites module-private `_prefs`; reads localStorage key `ec_ff_prefs_v1`.
- **Notes:** A wholesale reassignment (`_prefs = p`), not a merge — if a previously-stored prefs blob is missing a key (e.g. from an older schema), that key would end up `undefined` rather than falling back to a per-field default. No such migration logic is present.

#### _savePrefs()

- **File:** Trade_Journal/index.html (lines 19754-19756)
- **Module:** EC
- **Purpose:** Persists the current impact/currency filter preferences to localStorage.
- **Parameters:** None
- **Returns:** void
- **Internal logic:** `try { localStorage.setItem(PREFS_KEY, JSON.stringify(_prefs)); } catch(e) {}`
- **Calls:** (none)
- **Called by:** Per JSON: `NewsView, EC, toggleImp, toggleCcy`. Verified: called from the returned object's `toggleImp(imp, el)` and `toggleCcy(ccy, el)` methods, each time a filter chip is clicked.
- **Side effects:** Writes localStorage key `ec_ff_prefs_v1`.
- **Notes:** Wrapped in try/catch to tolerate storage-quota or privacy-mode failures silently.

#### _fmtTime(iso, tz)

- **File:** Trade_Journal/index.html (lines 19759-19765)
- **Module:** EC
- **Purpose:** Formats an ISO datetime string as a 24-hour `HH:MM` time in a given timezone.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| iso | string | ISO-8601 datetime string (event's `date` field) |
| tz | string | IANA timezone name, e.g. `'America/New_York'` or the viewer's local zone |

- **Returns:** string, e.g. `'14:30'`, or `'—'` on error.
- **Internal logic:** `try { return new Date(iso).toLocaleTimeString('en-GB', {timeZone: tz, hour:'2-digit', minute:'2-digit', hour12:false}); } catch(e) { return '—'; }`
- **Calls:** (none)
- **Called by:** Per JSON: `_render, NewsView, EC`. Verified: called twice per row inside `_render()` — once for the NY time column, and once more for the local-time column when `SHOW_LOCAL` is true.
- **Side effects:** None (pure).
- **Notes:** `en-GB` locale is used purely to force 24-hour, colon-separated formatting regardless of the browser's actual locale.

#### _fmtDay(iso)

- **File:** Trade_Journal/index.html (lines 19766-19772)
- **Module:** EC
- **Purpose:** Formats an ISO datetime as a full day-separator label in NY time (e.g. "Mon, 24 Aug 2026").
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| iso | string | ISO-8601 datetime string |

- **Returns:** string, or the raw `iso` input on error (not `'—'`, unlike `_fmtTime`).
- **Internal logic:** `try { return new Date(iso).toLocaleDateString('en-GB', {timeZone: NY_TZ, weekday:'short', day:'2-digit', month:'short', year:'numeric'}); } catch(e) { return iso; }`
- **Calls:** (none)
- **Called by:** Per JSON: `_render, NewsView, EC`. Verified: called once per new calendar day encountered while iterating events in `_render()`, to render the `ec-day-sep` divider text.
- **Side effects:** None (pure).
- **Notes:** Always in NY time regardless of `SHOW_LOCAL` — day separators are anchored to the NY trading day, not the viewer's local day.

#### _dayKey(iso)

- **File:** Trade_Journal/index.html (lines 19773-19777)
- **Module:** EC
- **Purpose:** Produces a sortable/comparable `YYYY-MM-DD` key (in NY time) used to detect day boundaries while iterating the event list.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| iso | string | ISO-8601 datetime string |

- **Returns:** string, e.g. `'2026-08-24'`, or the raw `iso` on error.
- **Internal logic:** `try { return new Date(iso).toLocaleDateString('en-CA', { timeZone: NY_TZ }); } catch(e) { return iso; }`
- **Calls:** (none)
- **Called by:** Per JSON: `_render, NewsView, EC`. Verified: called once per event row inside `_render()`'s loop, compared against a running `lastDay` variable to decide whether to insert a new day-separator row.
- **Side effects:** None (pure).
- **Notes:** Functionally identical implementation to `_nyDateStr` (both `en-CA` + NY timezone) but kept as a separately-named function, presumably for semantic clarity (this one keys day-grouping logic specifically, while `_nyDateStr` is used for cache-freshness comparisons).

#### _actualClass(event)

- **File:** Trade_Journal/index.html (lines 19780-19791)
- **Module:** EC
- **Purpose:** Decides whether a released "actual" economic figure should be styled green ("good"), red ("bad"), or neutral, by comparing it against the forecast (or previous, if no forecast) value — accounting for indicators where a *lower* number is actually the favorable outcome.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| event | object `{actual, forecast, previous, title, ...}` | One calendar event row |

- **Returns:** string — one of `''` (no actual yet), `'neu'` (no reference value, or equal, or unparseable), `'good'`, or `'bad'`.
- **Internal logic:**
  - If `event.actual` is falsy/empty, returns `''` (nothing released yet — no styling).
  - Picks a reference value: `forecast` if present and non-empty, else `previous`. If neither exists, returns `'neu'`.
  - Strips all non-numeric characters except `-`/`.` from both `actual` and the reference string, then `parseFloat`s both.
  - If either parse produced `NaN`, or the two numbers are exactly equal, returns `'neu'`.
  - Lower-cases the event `title` and checks whether it contains any of the `LOWER_BETTER` keyword substrings (via `[...LOWER_BETTER].some(...)`).
  - Returns `'good'` if (for lower-is-better indicators) `actual < reference`, or (for higher-is-better indicators) `actual > reference`; otherwise `'bad'`.
- **Calls:** (none)
- **Called by:** Per JSON: `_render, NewsView, EC`. Verified: called once per row inside `_render()` to compute the CSS class applied to the "actual" value cell.
- **Side effects:** None (pure).
- **Notes:** The `LOWER_BETTER` keyword-matching is a heuristic (substring match on the event title), not tied to any official FF category/ID — indicators not in that list (e.g. GDP, retail sales, NFP) are treated as "higher is better" by default, which is broadly correct for growth/employment prints but would mis-color a genuinely lower-is-better indicator whose title doesn't match any listed keyword.

#### _renderFilters()

- **File:** Trade_Journal/index.html (lines 19794-19810)
- **Module:** EC
- **Purpose:** Renders the impact-level (High/Medium/Low) and currency (USD/EUR/GBP/CHF/JPY/AUD/CAD/NZD) filter chip rows for the calendar UI.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Looks up `#ecImpactFilters` and `#ecCcyFilters`; guard-returns if either is missing.
  - Builds impact chips for a fixed `['High','Medium','Low']` list, each with a colored emoji dot (🔴/🟠/⚪), marked `on` if currently in `_prefs.impacts`, wired to `onclick="EC.toggleImp('...',this)"`.
  - Builds currency chips for a fixed 8-currency list, marked `on` if in `_prefs.ccys`, wired to `onclick="EC.toggleCcy('...',this)"`.
  - Sets both containers' `innerHTML`.
- **Calls:** Per JSON: `toggleImp, toggleCcy`. Note: these are string references inside the generated `onclick` HTML attributes, not direct JS calls made by `_renderFilters` itself (same onclick-in-template pattern as `NR.openKeyModal`).
- **Called by:** Per JSON: `NewsView, EC`. Verified: called once, from `EC`'s own `init()` method (line 19908; not separately represented in the JSON inventory).
- **Side effects:** Mutates DOM elements `#ecImpactFilters` and `#ecCcyFilters` (innerHTML).
- **Notes:** The currency list here (8 majors) is fixed/hardcoded and independent of whatever instruments/custom assets exist in the News module — `EC` filters by raw currency code, not by the News page's instrument taxonomy.

#### _render()

- **File:** Trade_Journal/index.html (lines 19812-19856)
- **Module:** EC
- **Purpose:** Renders the full calendar table body (`#ecCalBody`) from the in-memory `_events` array, applying the current impact/currency filters and inserting day-separator rows.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Looks up `#ecCalBody`; guard-returns if missing.
  - Filters `_events` down to `rows` matching both `_prefs.impacts.includes(e.impact)` and `_prefs.ccys.includes(e.country)`.
  - If `rows` is empty, renders a "No events match current filters." message and returns early.
  - Otherwise builds a header row (`TIME (NY) / CCY / [dot] / EVENT / PREV / FCST / ACTUAL`).
  - Iterates `rows` in (already date-sorted) order, tracking `lastDay`; whenever `_dayKey(e.date)` changes, inserts a day-separator row via `_fmtDay(e.date)`.
  - For each event, computes `nyTime = _fmtTime(e.date, NY_TZ)`, and if `SHOW_LOCAL`, also `localTime = _fmtTime(e.date, LOCAL_TZ)` (rendered as a smaller sub-label next to the NY time).
  - Computes `aClass = _actualClass(e)` and renders the actual value with that CSS class, or a dimmed em-dash if no actual yet.
  - Builds one `.ec-row` div per event with impact-colored dot and impact-based row class (`imp-High`/`imp-Medium`/`imp-Low`), then joins everything and sets `body.innerHTML`.
- **Calls:** `filter, _dayKey, _fmtDay, _fmtTime, _actualClass`.
- **Called by:** Per JSON: `_fetch, NewsView, EC, toggleImp, toggleCcy`. Verified: called from `EC._fetch(force)` (both the cache-hit fast path and the end of the fetch/catch flow) and from the returned object's `toggleImp`/`toggleCcy` methods (every filter toggle re-renders).
- **Side effects:** Mutates DOM element `#ecCalBody` (innerHTML).
- **Notes:** Assumes `_events` is already date-sorted ascending (guaranteed by `_fetch`'s `data.sort(...)` step) — `_render` itself does no sorting, only day-grouping based on that assumed order.

#### _setStatus(msg)

- **File:** Trade_Journal/index.html (lines 19858-19863)
- **Module:** EC
- **Purpose:** Shows or hides the calendar's status bar with a given message.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| msg | string \| falsy | Status text to display; falsy hides the bar |

- **Returns:** void
- **Internal logic:** Looks up `#ecStatusBar`; guard-returns if missing. If `msg` is truthy, sets `el.textContent = msg` and `el.style.display = 'block'`; otherwise sets `el.style.display = 'none'`.
- **Calls:** (none)
- **Called by:** Per JSON: `_fetch, NewsView, EC`. Verified: called multiple times within `_fetch(force)` — cache-hit message, "fetching…" message, success message, and two different failure-path messages.
- **Side effects:** Mutates DOM element `#ecStatusBar` (text + visibility).
- **Notes:** Uses `textContent` (not `innerHTML`), so status messages are not HTML-interpreted even though some contain characters like `·` and `⚠` — safe against injection via, e.g., an error message containing user-influenced text.

#### _fetch(force)

- **File:** Trade_Journal/index.html (lines 19866-19903)
- **Module:** EC
- **Purpose:** The core fetch/cache orchestration for the FF calendar — decides between serving cached data and hitting the network, and handles both success and failure gracefully with cache fallback.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| force | boolean | true to bypass the freshness check and always hit the network (used by `manualRefresh`) |

- **Returns:** Promise\<void\> (async function; no meaningful resolved value).
- **Internal logic:**
  - Loads `cache = _loadCache()`.
  - **Cache-hit path:** if not `force` and `!_needsFetch(cache)`, sets `_events = cache.events || []`; builds a "next refresh" hint message depending on whether the current NY hour is before/after 5pm (`nyH < 17` → "auto-refresh after 5:00 PM NY" vs. "next auto-refresh tomorrow after 5:00 PM NY"); calls `_setStatus(...)` with the cache's `fetchedAt` timestamp plus that hint; calls `_render()`; returns early (no network call).
  - **Network path:** sets a "Fetching latest data from Forex Factory…" status. If `FF_URL` is falsy (Cloudflare Worker not configured), calls `_renderNeedsConfig('ecCalBody')` and returns (feature disabled, no crash).
  - Otherwise `await fetch(FF_URL, {cache:'no-store'})`; throws if `!r.ok`; parses JSON; sorts events ascending by `new Date(a.date) - new Date(b.date)` and assigns to `_events`.
  - **Local helper `_saveCache(events)` (lines 19710-19719, not its own JSON entry):** on success, `_fetch` calls `_saveCache(_events)`, which builds `{ events, fetchedAt: now.toISOString(), fetchedNyDate: _nyDateStr(now) }` and writes it to `localStorage[CACHE_KEY]` inside a try/catch (silently ignoring quota/storage errors).
  - Sets a success status message including the fetch time and next-refresh hint.
  - **Catch block:** if a fetch/parse error occurs, falls back to `cache.events` if any cache exists (setting a "⚠ Fetch failed (...) — showing cached data from ..." status); otherwise sets `_events = []` and a "⚠ Could not load calendar: ..." status.
  - Always calls `_render()` at the end (both success and failure paths, and even the config-missing early return skips it since that's a separate return).
- **Calls:** `_loadCache, _needsFetch, _nyHour, _setStatus, _render, _renderNeedsConfig, fetch, _saveCache`.
- **Called by:** Per JSON: `NewsView, EC, manualRefresh`. Verified: called from `EC`'s own `init()` method (as `_fetch(false)`, line 19909; not separately represented in the JSON) and from the returned `manualRefresh()` method (as `_fetch(true)`).
- **Side effects:** Network call (`fetch` to `CONFIG.CF_WORKER + '/ff-calendar'`); reads/writes localStorage key `ec_ff_cache_v1`; mutates module state `_events`; DOM writes via `_setStatus`/`_render`/`_renderNeedsConfig`.
- **Notes:** The `{cache:'no-store'}` fetch option ensures the browser's own HTTP cache is bypassed — freshness is entirely governed by this module's own localStorage-based cache logic (`_needsFetch`), not by browser caching. Graceful-degradation design: a network failure never wipes out previously-good data unless there truly is no cache at all.

#### manualRefresh()

- **File:** Trade_Journal/index.html (lines 19910-19911)
- **Module:** EC (method on the returned public API object)
- **Purpose:** Forces an immediate network refresh of the calendar, bypassing the freshness cache check.
- **Parameters:** None
- **Returns:** void (fires an async `_fetch`, does not await it itself)
- **Internal logic:** `{ _fetch(true); }`
- **Calls:** `_fetch`.
- **Called by:** Per JSON: `NewsView, EC`. Verified: no direct in-chunk JS caller found; this is exposed as `EC.manualRefresh` for a "refresh calendar" button elsewhere in the HTML (outside this chunk), analogous to `NR`'s own manual-refresh flow.
- **Side effects:** Same as `_fetch(true)` (network call, cache write, DOM re-render).
- **Notes:** Unlike `NR.refresh()`, this has no `_st.loading`-style re-entrancy guard — rapid repeated clicks could fire overlapping fetches (each independently would still just overwrite `_events`/cache with its own result, so it's not unsafe, just potentially wasteful).

#### toggleImp(imp, el)

- **File:** Trade_Journal/index.html (lines 19911-19917)
- **Module:** EC (method on the returned public API object)
- **Purpose:** Toggles a single impact level (`'High'`/`'Medium'`/`'Low'`) in/out of the active filter set when its chip is clicked.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| imp | string | Impact level being toggled, e.g. `'High'` |
| el | HTMLElement | The clicked chip element (`this` from the inline `onclick`) |

- **Returns:** void
- **Internal logic:**
  - Finds `imp`'s index in `_prefs.impacts`; if found, splices it out; otherwise pushes it in.
  - Toggles the `on` CSS class directly on the passed `el` (avoids a full `_renderFilters()` re-render just to flip one chip's styling).
  - Calls `_savePrefs()` then `_render()` to persist and re-render the filtered table.
- **Calls:** `_savePrefs, _render`.
- **Called by:** Per JSON: `_renderFilters, NewsView, EC`. Verified: called via the impact chip's `onclick="EC.toggleImp('...',this)"` attribute generated inside `_renderFilters()`.
- **Side effects:** Mutates `_prefs.impacts`; mutates the clicked chip's DOM class list; persists prefs to localStorage; re-renders `#ecCalBody`.
- **Notes:** Passing `el` directly (rather than re-querying the DOM) is a small optimization/simplification specific to this click-handler pattern.

#### toggleCcy(ccy, el)

- **File:** Trade_Journal/index.html (lines 19917-19923)
- **Module:** EC (method on the returned public API object)
- **Purpose:** Toggles a single currency code in/out of the active filter set when its chip is clicked.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| ccy | string | Currency code being toggled, e.g. `'USD'` |
| el | HTMLElement | The clicked chip element |

- **Returns:** void
- **Internal logic:** Identical pattern to `toggleImp` but operating on `_prefs.ccys` instead of `_prefs.impacts`.
- **Calls:** `_savePrefs, _render`.
- **Called by:** Per JSON: `_renderFilters, NewsView, EC`. Verified: called via the currency chip's `onclick="EC.toggleCcy('...',this)"` attribute generated inside `_renderFilters()`.
- **Side effects:** Mutates `_prefs.ccys`; mutates the clicked chip's DOM class list; persists prefs to localStorage; re-renders `#ecCalBody`.
- **Notes:** None beyond what's noted for `toggleImp`.

#### refreshCustomAssets()

- **File:** Trade_Journal/index.html (line 19924-19925, i.e. `refreshCustomAssets() {}`)
- **Module:** EC (method on the returned public API object)
- **Purpose:** Intentional no-op stub, present purely so `NR.saveCustomAssets()`/`NR.removeCustomAsset()` can call `EC.refreshCustomAssets()` unconditionally without needing to special-case whether the calendar module cares about custom assets.
- **Parameters:** None
- **Returns:** void (does nothing)
- **Internal logic:** Empty function body.
- **Calls:** (none)
- **Called by:** Per JSON: `saveCustomAssets, removeCustomAsset, NewsView, NR, EC`. Verified: called from `NR.saveCustomAssets()` (line 19590) and `NR.removeCustomAsset()` (line 19605).
- **Side effects:** None.
- **Notes:** The FF economic calendar has no concept of "instruments" (it's filtered by currency/impact only), so custom News-page assets are irrelevant to it — this stub exists solely to keep `NR`'s call sites uniform across `EC` and any future instrument-aware module.

---

### Module: Discord Feed (`DC`)

#### _loadChannels()

- **File:** Trade_Journal/index.html (lines 19945-19948)
- **Module:** DC (Discord feed IIFE, assigned to `const DC`)
- **Purpose:** Loads the user's configured Discord channel list from localStorage, falling back to an empty default list.
- **Parameters:** None
- **Returns:** array of `{id, label}` objects (or `DEFAULT_CHANNELS`, which is `[]`, if none saved/invalid).
- **Internal logic:** `try { const r = localStorage.getItem(STORAGE_KEY); if (r) { const p = JSON.parse(r); if (Array.isArray(p) && p.length) return p; } } catch(e) {}` then falls through to `return DEFAULT_CHANNELS;`.
- **Calls:** (none)
- **Called by:** Per JSON: `_renderChannelRows, NewsView`. Verified: called from `DC._renderChannelRows()` (line 20124, to populate the Settings-page channel-editing rows) and from `DC`'s own `init()` (line 20100; not itself a separate JSON entry — see the `DC` module gap note below).
- **Side effects:** Reads localStorage key `dc_channels_v1`.
- **Notes:** Validates the parsed value is a non-empty array before trusting it — guards against a corrupted or emptied-out localStorage entry silently falling back to the default rather than crashing.

#### setChannels(channels)

- **File:** Trade_Journal/index.html (lines 19949-19956)
- **Module:** DC
- **Purpose:** Replaces the active channel list in memory (not persisted here) and resets/re-renders the sidebar and message panel accordingly, optionally kicking off a fetch for the first channel.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| channels | array of `{id, label}` | New channel list to make active |

- **Returns:** void
- **Internal logic:**
  - Assigns `_channels = channels`.
  - Rebuilds `_state` as one fresh per-channel state object per channel: `{ messages:[], before:null, fetching:false, hasMore:false, status:null }`.
  - Resets `_activeIdx = 0`.
  - Re-renders the sidebar and the messages panel for index 0.
  - If the user is currently on the Discord page (`S.currentPage === 'discord'`), immediately fetches channel 0's messages.
- **Calls:** `_renderSidebar, _renderMessages, _fetchChannel`.
- **Called by:** Per JSON: `loadAllData, NewsView`. Verified: `loadAllData` (a broader app-bootstrap function defined elsewhere in the file, not in this chunk) plausibly calls `DC.setChannels(...)` after loading Discord channel config from Supabase (consistent with the file's global-context note that channels can be persisted server-side via `saveDiscordChannels`).
- **Side effects:** Mutates module state `_channels`, `_state`, `_activeIdx`; DOM re-renders via `_renderSidebar`/`_renderMessages`; possibly triggers a network fetch.
- **Notes:** Unlike `saveChannels()` (below), this function does **not** persist the new list to localStorage or Supabase itself — it only updates the in-memory/UI state, implying its caller is responsible for the source of truth (e.g. loading from Supabase on startup) while `saveChannels()` is the user-initiated "edit and save" path.

#### _saveChannels(c)

- **File:** Trade_Journal/index.html (line 19957)
- **Module:** DC
- **Purpose:** Persists the given channel list to localStorage.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| c | array of `{id, label}` | Channel list to persist |

- **Returns:** void
- **Internal logic:** `try { localStorage.setItem(STORAGE_KEY, JSON.stringify(c)); } catch(e) {}`
- **Calls:** (none)
- **Called by:** Per JSON: `saveChannels, NewsView`. Verified: called from `DC.saveChannels()` (line 20180) as part of persisting the Settings-page channel edits.
- **Side effects:** Writes localStorage key `dc_channels_v1`.
- **Notes:** Silently swallows storage errors, same pattern as every other localStorage writer in this file.

#### _loadActiveIdx()

- **File:** Trade_Journal/index.html (line 19958)
- **Module:** DC
- **Purpose:** Reads the last-active channel index from localStorage so the Discord page reopens on the previously-viewed channel.
- **Parameters:** None
- **Returns:** number (defaults to `0` on any parse failure or missing value).
- **Internal logic:** `try { return parseInt(localStorage.getItem(PREFS_KEY + '_idx') || '0', 10) || 0; } catch(e) { return 0; }`
- **Calls:** (none)
- **Called by:** Per JSON: `NewsView`. Verified: called from `DC`'s own `init()` (line 20102; not separately represented in the JSON — see gap note).
- **Side effects:** Reads localStorage key `dc_prefs_v1_idx`.
- **Notes:** The double-fallback (`|| '0'` then `|| 0`) guards both a missing key and a stored value that parses to `NaN` or `0`.

#### _saveActiveIdx(i)

- **File:** Trade_Journal/index.html (line 19959)
- **Module:** DC
- **Purpose:** Persists the currently-active channel index to localStorage.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| i | number | Index of the channel to remember as "active" |

- **Returns:** void
- **Internal logic:** `try { localStorage.setItem(PREFS_KEY + '_idx', String(i)); } catch(e) {}`
- **Calls:** (none)
- **Called by:** Per JSON: `selectChannel, NewsView`. Verified: called from `DC.selectChannel(idx)` (line 20093) whenever the user picks a different channel in the sidebar.
- **Side effects:** Writes localStorage key `dc_prefs_v1_idx`.
- **Notes:** Uses the same `PREFS_KEY` base as `_loadActiveIdx`, suffixed with `_idx` (so `dc_prefs_v1` itself, without suffix, is reserved/unused-in-this-chunk — presumably for future non-index prefs).

#### _dateLabel(ts)

- **File:** Trade_Journal/index.html (lines 19967-19975)
- **Module:** DC
- **Purpose:** Produces a human day-separator label ("Today", "Yesterday", or a full weekday date) for grouping Discord messages by day in the chat panel.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| ts | string \| number | Message timestamp (parseable by `new Date(...)`) |

- **Returns:** string, one of `'Today'`, `'Yesterday'`, or a formatted date like `'Monday, 24 Aug 2026'`.
- **Internal logic:**
  - Builds `today` (midnight of the current date) and `msgDay` (midnight of the message's date) via `setHours(0,0,0,0)`.
  - Computes `diff = Math.round((today - msgDay) / 86400000)` (whole days between them).
  - Returns `'Today'` if `diff === 0`, `'Yesterday'` if `diff === 1`, otherwise a full `en-GB` weekday/day/month/year string.
- **Calls:** (none)
- **Called by:** Per JSON: `_renderMessages`. Verified: called once per message inside `_renderMessages(idx)`'s loop, compared against a running `lastDay` label to decide whether to insert a `dc-date-sep` divider.
- **Side effeffects:** None (pure).
- **Notes:** Uses local (browser) time, not a fixed timezone (unlike the EC calendar's NY-anchored day logic) — day boundaries here follow the viewer's own clock/timezone.

#### _renderSidebar()

- **File:** Trade_Journal/index.html (lines 19978-19989)
- **Module:** DC
- **Purpose:** Renders the Discord channel list in the left sidebar, highlighting the active channel and showing a status dot per channel.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Looks up `#dcSidebarList`; guard-returns if missing.
  - Maps each channel `ch` at index `i` to a row: dot class is `'ok'`/`'err'`/`''` based on that channel's `_state[i].status` (or `''` if no state yet); row gets the `active` class if `i === _activeIdx`; row is wired to `onclick="DC.selectChannel(${i})"`.
  - Channel name is `_esc(ch.label || ch.id)` prefixed with `# ` — note this uses **DC's own local `_esc(s)`** (line 19961: `(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')`), which shadows the file's other, presumably-similar global `_esc` helper used by `NewsView`/`NR`.
  - Joins all rows and sets `list.innerHTML`.
- **Calls:** Per JSON: `selectChannel, _esc`. Note: `selectChannel` appears only inside the generated `onclick="DC.selectChannel(${i})"` attribute string, not as a direct call from this function's own executing code.
- **Called by:** Per JSON: `setChannels, _fetchChannel, selectChannel, saveChannels, NewsView`. Verified: called from `setChannels` (line 19953), `_fetchChannel` (lines 20067 and 20085, before and after a fetch, to update the status dot), `selectChannel` (line 20094), and `saveChannels` (line 20185) — all in this chunk.
- **Side effects:** Mutates DOM element `#dcSidebarList` (innerHTML).
- **Notes:** The status dot reflects each channel's last fetch outcome (`ok`/`err`/neutral), giving an at-a-glance health indicator per channel without needing to switch to it.

#### _renderMessages(idx)

- **File:** Trade_Journal/index.html (lines 19992-20054)
- **Module:** DC
- **Purpose:** Renders the chronological chat panel for a given channel index — messages, avatars, image attachments, embeds, and date separators — and auto-scrolls to the newest message.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| idx | number | Channel index to render |

- **Returns:** void
- **Internal logic:**
  - Guard: if `idx !== _activeIdx`, returns immediately — stale/late-arriving renders for a channel the user has since navigated away from are silently dropped (avoids flicker/races from concurrent fetches).
  - Looks up `#dcMessagesPanel` (guard-returns if missing), `#dcLoadMoreBtn`, `#dcActiveLabel`.
  - Sets the header label to `# ` + the channel's label/id (escaped via DC's local `_esc`).
  - If there's no state or no messages yet, renders an empty-state message (distinguishing a fetch error `st.status === 'err'` from a genuinely-empty channel) and hides the load-more button.
  - Otherwise reverses `st.messages` (stored newest-first from the API, per Discord convention) into chronological (oldest-first) order for display.
  - Iterates messages, inserting a `dc-date-sep` divider (via `_dateLabel`) whenever the day changes.
  - For each message: builds an avatar `<img>` (with an `onerror` handler that hides a broken image) or a placeholder circle with the first letter of the display name/username if no avatar URL; builds inline `<img>` tags for any attachment whose `content_type` starts with `image/`; builds embed blocks for any embed with a `title` or `description` (description truncated to 300 chars with an ellipsis); formats the message time as 24-hour `HH:MM` plus a relative "X ago" via `_timeAgo` (DC's own local helper at line 19962, not a separate JSON entry); assembles the full message row HTML.
  - Sets `panel.innerHTML` to the joined message HTML; shows/hides the load-more button based on `st.hasMore`; scrolls the panel to the bottom (`panel.scrollTop = panel.scrollHeight`) to reveal the newest message.
- **Calls:** `_esc, _dateLabel, filter, _timeAgo` (`filter` here is the attachments/embeds `Array.prototype.filter` calls, not a module method).
- **Called by:** Per JSON: `setChannels, _fetchChannel, selectChannel, saveChannels, NewsView`. Verified: called from `setChannels` (line 19954), `_fetchChannel` (line 20086, in the `finally` block after every fetch attempt), `selectChannel` (line 20095), and `saveChannels` (line 20186) — all in this chunk.
- **Side effects:** Mutates DOM elements `#dcMessagesPanel` (innerHTML, `scrollTop`), `#dcLoadMoreBtn` (display), `#dcActiveLabel` (textContent).
- **Notes:** All user-controlled text (author names, message content, embed title/description) is passed through `_esc(...)` before interpolation — deliberate XSS hardening given this content originates from an external Discord channel proxied through the Worker. The avatar `onerror="this.style.display='none'"` handler is itself embedded as a literal string inside the template, escaping the single quotes with `\'` so it survives the outer template-literal/backtick context.

#### _fetchChannel(idx, before = null)

- **File:** Trade_Journal/index.html (lines 20057-20088)
- **Module:** DC
- **Purpose:** Fetches a page of messages for one channel from the Cloudflare Worker's Discord proxy, either the most recent page or an older page (pagination via Discord's `before` message-ID cursor).
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| idx | number | Index of the channel to fetch |
| before | string \| null | Discord message ID to page backward from; `null` fetches the newest page |

- **Returns:** Promise\<void\> (async function).
- **Internal logic:**
  - Guards: returns immediately if `_state[idx]` doesn't exist, if the channel doesn't exist, or if that channel is already `fetching` (prevents overlapping requests per channel).
  - If `CF_WORKER` isn't configured, calls `_renderNeedsConfig('dcMessagesPanel')` and returns (feature disabled gracefully).
  - Sets `st.fetching = true` and re-renders the sidebar (to reflect the fetching state, though the sidebar rendering shown doesn't appear to have a distinct "fetching" dot style beyond ok/err/neutral).
  - Builds the URL: `${CF_WORKER}/discord-messages?channel=${ch.id}&limit=${PAGE_SIZE}`, appending `&before=${before}` if paginating.
  - `await fetch(url)`; on non-ok response, attempts to parse a JSON error body (`{error}`) and throws that message, or falls back to `'HTTP ' + status`.
  - Parses the message array; if `before` was set (a "load more" page), appends the new messages to the existing list (`[...st.messages, ...msgs]`); otherwise replaces `st.messages` entirely (fresh/refresh fetch).
  - Sets `st.hasMore = msgs.length === PAGE_SIZE` (heuristic: a full page suggests more may exist) and, if any messages came back, sets `st.before` to the last message's `id` (cursor for the next "load more").
  - Sets `st.status = 'ok'` on success.
  - On error, logs to console and sets `st.status = 'err'`.
  - `finally`: always clears `st.fetching = false` and re-renders both the sidebar and the messages panel for `idx`.
- **Calls:** `_renderNeedsConfig, _renderSidebar, fetch, _renderMessages`.
- **Called by:** Per JSON: `setChannels, selectChannel, refreshActive, loadMoreActive, saveChannels, NewsView`. Verified: called from `setChannels` (line 19955, conditionally on current page), `selectChannel` (line 20096, conditionally if no messages cached yet), `refreshActive` (line 20115), `loadMoreActive` (line 20118), `saveChannels` (line 20187), and `DC`'s own `init()` (line 20106; that call isn't itself a separate JSON entry).
- **Side effects:** Network call to `CONFIG.CF_WORKER + '/discord-messages?channel=...&limit=...[&before=...]'`; mutates per-channel state fields `messages`, `hasMore`, `before`, `status`, `fetching`; DOM re-renders via `_renderSidebar`/`_renderMessages`.
- **Notes:** The Discord bot token itself is never exposed to the browser — this function only ever talks to the Cloudflare Worker's `/discord-messages` endpoint, consistent with the file's global-context note that the Discord token is a server-side Worker secret. The per-channel `fetching` guard makes this function safe to call redundantly (e.g. from both `selectChannel` and an in-flight timer tick) without triggering duplicate concurrent requests for the same channel.

#### selectChannel(idx)

- **File:** Trade_Journal/index.html (lines 20091-20097)
- **Module:** DC
- **Purpose:** Switches the active Discord channel (sidebar click handler), persisting the choice and lazily fetching messages if not already cached.
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| idx | number | Index of the channel to select |

- **Returns:** void
- **Internal logic:**
  - Sets `_activeIdx = idx` and persists it via `_saveActiveIdx(idx)`.
  - Re-renders the sidebar (to move the "active" highlight) and the messages panel for the new index.
  - If that channel's state has no messages yet (`!_state[idx]?.messages.length`), triggers `_fetchChannel(idx)` to load them.
- **Calls:** `_saveActiveIdx, _renderSidebar, _renderMessages, _fetchChannel`.
- **Called by:** Per JSON: `_renderSidebar` only. Verified: this is exactly right — it's wired as `onclick="DC.selectChannel(${i})"` on each sidebar row generated by `_renderSidebar()` (a string-embedded call, same pattern noted throughout).
- **Side effects:** Mutates `_activeIdx`; persists to localStorage (`dc_prefs_v1_idx`); DOM re-renders; possibly triggers a network fetch.
- **Notes:** The "only fetch if empty" check means revisiting a previously-loaded channel is instant (no re-fetch) — the auto-refresh timer (in `init()`) and `refreshActive()` are the mechanisms for getting fresh data on an already-visited channel.

#### refreshActive()

- **File:** Trade_Journal/index.html (lines 20111-20116)
- **Module:** DC
- **Purpose:** Forces a full reload (not incremental) of the currently-active channel's messages, e.g. for a manual "refresh" button.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Guard-returns if `_state[_activeIdx]` doesn't exist.
  - Clears that channel's `messages` array and `before` cursor (discarding pagination state).
  - Calls `_fetchChannel(_activeIdx)` (with no `before`, i.e. fetches the newest page fresh).
- **Calls:** `_fetchChannel`.
- **Called by:** Per JSON: none listed (`"inboundCallers": []`). Verified: no in-chunk call site found either; this is exposed in `DC`'s returned public API (line 20191: `refreshActive`) and is presumably wired to a "refresh" button in the Discord page's HTML (outside this chunk) via `onclick="DC.refreshActive()"`.
- **Side effects:** Mutates the active channel's `messages`/`before` state; triggers a network fetch and DOM re-renders (via `_fetchChannel`).
- **Notes:** Because it clears `messages` before fetching, the message panel will briefly show an empty state until the fetch resolves (no "loading" spinner state is set here beyond the generic `fetching` flag used for the sidebar dot).

#### loadMoreActive()

- **File:** Trade_Journal/index.html (line 20118)
- **Module:** DC
- **Purpose:** Loads the next (older) page of messages for the currently-active channel, using its stored pagination cursor.
- **Parameters:** None
- **Returns:** void
- **Internal logic:** `_fetchChannel(_activeIdx, _state[_activeIdx]?.before);` — a one-liner passing the active channel's saved `before` cursor.
- **Calls:** `_fetchChannel`.
- **Called by:** Per JSON: none listed (`"inboundCallers": []`). Verified: no in-chunk call site found; exposed via `DC`'s public API and presumably wired to a "load more" button in the Discord page HTML (outside this chunk) — note the returned API object also separately exposes a near-duplicate arrow function `loadMore: (i) => _fetchChannel(i, _state[i]?.before)` (line 20192) that takes an explicit channel index rather than assuming `_activeIdx`, suggesting `loadMoreActive` may be legacy/redundant with the newer parametrized `loadMore`.
- **Side effects:** Same as `_fetchChannel` for the active channel (network call, state mutation, re-renders).
- **Notes:** If `_state[_activeIdx]` is undefined, `?.before` evaluates to `undefined`, which `_fetchChannel` treats identically to `null` (fetches the newest page) — not a hard failure, just a slightly different pagination outcome.

#### _renderChannelRows()

- **File:** Trade_Journal/index.html (lines 20121-20134)
- **Module:** DC
- **Purpose:** Renders the editable channel-ID/label row list shown in the app's Settings page for configuring which Discord channels to track.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Looks up `#dcChannelRows`; guard-returns if missing.
  - Loads the currently-saved channel list via `_loadChannels()` (not the in-memory `_channels`, but freshly re-read from localStorage — ensures the Settings form reflects the last-saved state even if `_channels` has diverged, e.g. after a failed save).
  - For each saved channel `ch` at index `i`, builds a row with two text inputs (`#dcRowId{i}` for the channel ID, `#dcRowLabel{i}` for the display label, both pre-filled and HTML-escaped) and a "✕" remove button wired to `onclick="DC.removeChannelRow(${i})"`.
  - Joins and sets `el.innerHTML`.
- **Calls:** Per JSON: `_loadChannels, _esc, removeChannelRow`. Note: `removeChannelRow` appears only inside the generated `onclick` attribute string.
- **Called by:** Per JSON: none listed (`"inboundCallers": []`). Verified: no in-chunk call site found; this is exposed via `DC`'s public API as `renderChannelRows: _renderChannelRows` (line 20196), presumably invoked when the Settings/Discord-config panel is opened (wiring likely lives outside this chunk, e.g. in a settings-panel-open handler or `navTo`).
- **Side effects:** Mutates DOM element `#dcChannelRows` (innerHTML).
- **Notes:** Uses DC's local `_esc` for escaping `ch.id`/`ch.label` values into the input `value` attributes.

#### addChannelRow()

- **File:** Trade_Journal/index.html (lines 20136-20152)
- **Module:** DC
- **Purpose:** Appends one new blank channel-ID/label row to the Settings-page channel editor, up to a maximum of 5 channels.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Looks up `#dcChannelRows`; guard-returns if missing.
  - Counts existing rows via `querySelectorAll('div')`; if already at 5, shows a warning toast ("Maximum 5 channels") and returns without adding a row.
  - Otherwise builds a new empty row (blank ID/label inputs, indexed at the current row count) with the same structure as `_renderChannelRows`'s per-row markup, and appends it directly to the container via `appendChild` (rather than re-rendering the whole list).
- **Calls:** `showToast, removeChannelRow` (the latter only inside the generated `onclick` string).
- **Called by:** Per JSON: none listed (`"inboundCallers": []`). Verified: no in-chunk call site found; exposed via `DC`'s public API (line 20194) for an "Add channel" button in the Settings UI, outside this chunk.
- **Side effects:** Mutates DOM element `#dcChannelRows` (appends a child `<div>`); may call `showToast` to display a warning notification.
- **Notes:** The 5-channel cap here is enforced purely client-side in the UI; nothing in this chunk enforces it at the storage layer (though `saveChannels()` also doesn't independently cap it — see that entry).

#### removeChannelRow(i)

- **File:** Trade_Journal/index.html (lines 20154-20167)
- **Module:** DC
- **Purpose:** Removes one row from the Settings-page channel editor and renumbers the remaining rows' element IDs/handlers so they stay contiguous (`0..n-1`).
- **Parameters:**

| Name | Type (inferred) | Description |
|---|---|---|
| i | number | Index of the row to remove |

- **Returns:** void
- **Internal logic:**
  - Looks up `#dcChannelRows`; guard-returns if missing.
  - Snapshots all current row `<div>`s into an array; removes the one at index `i` if it exists (`.remove()`).
  - Re-walks the remaining rows in DOM order, and for each at new position `ni`, renames its ID input (`[id^="dcRowId"]`) to `dcRowId{ni}`, its label input (`[id^="dcRowLabel"]`) to `dcRowLabel{ni}`, and rewrites its remove button's `onclick` attribute to `DC.removeChannelRow(${ni})` — keeping all IDs and handlers consistent after a mid-list deletion.
- **Calls:** `remove`.
- **Called by:** Per JSON: `_renderChannelRows, addChannelRow`. Verified: reachable from the `onclick="DC.removeChannelRow(${i})"` attributes generated by both `_renderChannelRows()` and `addChannelRow()` — consistent with the JSON, understood as "these two functions generate the HTML that ends up calling this," not direct JS calls.
- **Side effects:** Mutates DOM element `#dcChannelRows` (removes a child, renumbers remaining children's `id` attributes and `onclick` handlers).
- **Notes:** This renumbering-by-DOM-attribute-surgery approach (rather than a full re-render from a JS array) is a bit fragile — it relies on attribute selectors (`[id^="dcRowId"]`) matching exactly one input per row and on `querySelector('button')` finding exactly one button per row; it would misbehave if a row's markup structure changed to include more than one button.

#### saveChannels()

- **File:** Trade_Journal/index.html (lines 20169-20189)
- **Module:** DC
- **Purpose:** Reads all channel rows from the Settings-page editor, validates and persists them (both locally and to Supabase), and immediately switches the live Discord feed to the new channel list.
- **Parameters:** None
- **Returns:** void
- **Internal logic:**
  - Looks up `#dcChannelRows`; guard-returns if missing.
  - Counts current rows; for each index `i`, reads and trims `#dcRowId{i}` and `#dcRowLabel{i}`; only includes the row if the ID is non-empty **and** matches `/^\d+$/` (Discord snowflake IDs are numeric strings) — pushes `{id, label: label || id}` (falls back to using the ID as the label if none given).
  - If no valid rows resulted, shows a warning toast ("Add at least one valid channel ID") and returns without saving anything.
  - Persists locally via `_saveChannels(saved)` and remotely via `saveDiscordChannels(saved)` (a Supabase-persistence function defined elsewhere in the file) — the comment explicitly marks the remote call as "fire and forget."
  - Updates in-memory `_channels = saved`, rebuilds `_state` fresh for each channel, resets `_activeIdx = 0`.
  - Re-renders the sidebar and messages panel for channel 0, and immediately fetches channel 0's messages.
  - Shows a success toast reporting how many channels were saved.
- **Calls:** `showToast, _saveChannels, saveDiscordChannels, _renderSidebar, _renderMessages, _fetchChannel`.
- **Called by:** Per JSON: none listed (`"inboundCallers": []`). Verified: no in-chunk call site found; exposed via `DC`'s public API (line 20194) for a "Save" button in the Discord Settings UI, outside this chunk.
- **Side effects:** Persists to localStorage (`dc_channels_v1`) and to Supabase (via `saveDiscordChannels`, fire-and-forget — no error handling shown here for that call); resets and re-fetches the entire in-memory Discord feed state; shows toast notifications.
- **Notes:** Validation is deliberately strict on the ID field (`/^\d+$/`) to prevent obviously-malformed channel IDs from being sent to the Worker's Discord proxy, but performs no validation/dedup on the label field or on duplicate IDs across rows. The `saveDiscordChannels(saved)` call is not awaited and has no `.catch(...)` visible here, so a failure to persist to Supabase would be silent from this function's perspective (the local save and UI reset happen regardless of remote success).

---

### Bootstrap / Entry-Point Calls at the Bottom of the Script (lines 20199-20214)

The script's final lines (outside any function, executed immediately on page load) are:

```
document.getElementById('ideaDate').value = new Date().toISOString().split('T')[0];
document.getElementById('intraDate').value = new Date().toISOString().split('T')[0];
setTimeout(() => { renderTagsInWrap('intraTagWrap', S.intraTags, 'intra'); }, 100);
renderDashboard();
renderOpen();
updateOpenBadge();
updateWeeklyBadge();
updateIntradayBadge();
refreshIntraWeeklyDropdown();
renderNotes();
setTimeout(renderMiniCalendar, 300);
if (!S.insightSections) S.insightSections = {};
```

**None of these bootstrap calls target a function documented in this chunk.** `renderDashboard`, `renderOpen`, `updateOpenBadge`, `updateWeeklyBadge`, `updateIntradayBadge`, `refreshIntraWeeklyDropdown`, `renderNotes`, `renderTagsInWrap`, and `renderMiniCalendar` all belong to earlier chunks of the file (the core Weekly Bias / Daily Bias / Intraday / Notes trading-journal UI), not to `NR`/`EC`/`DC`. Notably, **none of `NR.init()`, `EC.init()`, or `DC.init()` are called here** — the News/Calendar/Discord feature area is *not* eagerly initialized at page load; it is lazily started the first time the user navigates to the News page, via `NR.init()` being invoked from `navTo` (per the `init()` entry above), which in turn cascades into `EC.init()` and `DC.init()`. This is the correct entry point to document for this chunk's functions, even though it isn't literally at the bottom of the script.


---

## 13. Profit_Tracker — Function Reference (68 functions)

## Profit_Tracker (PnL Tracker) — Function Reference

> All 68 functions in `Profit_Tracker/index.html`'s single `<script>` block (lines 771-2546), documented in full. Grouped into modules. Cross-references (`Calls` / `Called by`) verified against a static call-graph extraction of the whole file, then checked against the actual source read in full.

Shared globals referenced throughout: `sb` (Supabase client, `CONFIG.SUPA_URL`/`CONFIG.SUPA_KEY`), `currentUser`, `accounts[]`, `activeAccountId`, `journalTradesCache[]` (raw trades pulled from the shared Journal database on Sync), `activeTradesCache{}` (id → trade, always current for the active account), `brokerProfiles[]`, `assetSpecsCache{}` (symbol → spec row), `assetSpecsLookupInFlight` (Set, de-dupes concurrent AI lookups), `fxRates{}` (ccy → USD rate, refreshed each Sync), `IC_MARKETS_PRESET`, `METAL_OZ_PER_LOT`, `STANDARD_FX_LOT`, `ISO_CCY` (hardcoded reference constants, not DB rows).

---

### Module: Auth

#### doLogin()
- **File:** Profit_Tracker/index.html (lines 817-828)
- **Module:** Auth
- **Purpose:** Signs the user in with email/password and transitions from the login screen to the main app.
- **Parameters:** None (reads `#loginEmail`/`#loginPassword` input values directly)
- **Returns:** `Promise<void>`
- **Internal logic:**
  - Reads and trims email, reads password, clears any previous error message.
  - Calls `sb.auth.signInWithPassword({email, password})`.
  - On error, writes `error.message` into `#loginMsg` and stops.
  - On success, sets `currentUser`, hides `#loginScreen`, shows `#app`, awaits `loadAccounts()`.
- **Calls:** loadAccounts
- **Called by:** (none detected — wired via `onclick="doLogin()"` on the Sign In button)
- **Side effects:** Supabase Auth call; DOM show/hide of `#loginScreen`/`#app`; sets global `currentUser`.
- **Notes:** No client-side validation of email format; relies entirely on Supabase Auth's own error messages.

#### doLogout()
- **File:** Profit_Tracker/index.html (lines 830-835)
- **Module:** Auth
- **Purpose:** Signs the user out and returns to the login screen.
- **Parameters:** None
- **Returns:** `Promise<void>`
- **Internal logic:** `sb.auth.signOut()`, clears `currentUser`, hides `#app`, shows `#loginScreen` (`display:flex`).
- **Calls:** (none)
- **Called by:** (none detected — wired via `onclick="doLogout()"` on the drawer's "Sign out" link)
- **Side effects:** Supabase Auth call; DOM show/hide; clears `currentUser`. Does **not** clear `accounts`/`journalTradesCache`/`assetSpecsCache` in memory — a subsequent login by a different browser session would rely on a full page reload to avoid stale state (this app has no `location.reload()` here, unlike the Journal's `doLogout`).
- **Notes:** Potential state-leak edge case: if the app were used as a persistent SPA across multiple different user logins without a reload, in-memory caches from the previous user could briefly display before `loadAccounts()` repopulates them on next login.

#### checkExistingSession()
- **File:** Profit_Tracker/index.html (lines 837-845)
- **Module:** Auth
- **Purpose:** Restores an existing Supabase session on page load (so the user doesn't have to log in again every visit).
- **Parameters:** None
- **Returns:** `Promise<void>`
- **Internal logic:** Calls `sb.auth.getSession()`; if a session exists, sets `currentUser`, hides login screen, shows app, awaits `loadAccounts()`.
- **Calls:** loadAccounts
- **Called by:** (none detected via static analysis — but it is the file's bootstrap entry point: called unconditionally as the very last line of the script, line 2545: `checkExistingSession();`)
- **Side effects:** Same as doLogin's post-auth side effects.
- **Notes:** **This is the app's entry point / bootstrap call.** Unlike the Journal (which also subscribes to `onAuthStateChange`), PnL Tracker only checks the session once on load — it will not automatically react to a sign-out that happens in another tab.

---

### Module: Accounts (load, render drawer, switch)

#### loadAccounts()
- **File:** Profit_Tracker/index.html (lines 850-862)
- **Module:** Accounts
- **Purpose:** Loads all of the current user's PnL-tracker accounts plus their supporting caches (asset specs, broker profiles), then renders the sidebar and the active account's dashboard.
- **Parameters:** None
- **Returns:** `Promise<void>`
- **Internal logic:**
  - `sb.from('accounts').select('*').order('created_at', {ascending:true})`; on error, logs and returns.
  - Sets `accounts = data || []`.
  - If no `activeAccountId` yet and accounts exist, defaults to the first account.
  - Awaits `loadAssetSpecsCache()` then `loadBrokerProfiles()` (sequential, not parallel).
  - Sets the drawer's user-email label.
  - Calls `renderDrawer()` then `renderActiveAccount()`.
- **Calls:** loadAssetSpecsCache, loadBrokerProfiles, renderDrawer, renderActiveAccount
- **Called by:** doLogin, checkExistingSession
- **Side effects:** Supabase read (`accounts`); DOM render (drawer + dashboard); mutates globals `accounts`, `activeAccountId`, `brokerProfiles`, `assetSpecsCache`.
- **Notes:** No error surfaced to the user if the accounts fetch fails (console.error only) — the app would silently show an empty drawer.

#### loadBrokerProfiles()
- **File:** Profit_Tracker/index.html (lines 864-873)
- **Module:** Accounts
- **Purpose:** Loads the user's saved broker/prop-firm profiles into memory.
- **Parameters:** None
- **Returns:** `Promise<void>`
- **Internal logic:** `sb.from('broker_profiles').select('*').eq('user_id', currentUser.id).order('created_at', {ascending:true})`; on any thrown error (e.g. table doesn't exist yet in a fresh install) logs a warning and sets `brokerProfiles = []` rather than failing the whole load.
- **Calls:** (none)
- **Called by:** loadAccounts
- **Side effects:** Supabase read (`broker_profiles`); mutates global `brokerProfiles`.
- **Notes:** Explicitly defensive against the table not existing yet — a nice property for a fresh Supabase project that hasn't run every migration; the app degrades gracefully rather than crashing.

#### loadAssetSpecsCache()
- **File:** Profit_Tracker/index.html (lines 875-884)
- **Module:** Accounts
- **Purpose:** Preloads all of the user's cached asset contract specs so P&L math doesn't need a per-symbol round trip during rendering.
- **Parameters:** None
- **Returns:** `Promise<void>`
- **Internal logic:** Selects a fixed column list from `asset_specs` filtered by `user_id`; populates `assetSpecsCache[row.symbol] = row` for each row. Same defensive try/catch-and-warn pattern as `loadBrokerProfiles`.
- **Calls:** (none)
- **Called by:** loadAccounts
- **Side effects:** Supabase read (`asset_specs`); mutates global `assetSpecsCache`.
- **Notes:** None.

#### renderDrawer()
- **File:** Profit_Tracker/index.html (lines 886-910)
- **Module:** Accounts / UI Rendering
- **Purpose:** Renders the left navigation drawer's account list (avatar, name, sub-label, paper/status chips, options button).
- **Parameters:** None
- **Returns:** `void`
- **Internal logic:**
  - If no accounts, shows an empty-state `<li>`.
  - Otherwise cycles through a fixed 6-color pastel palette by index, builds two-letter initials from the account name, a status chip (breached/passed/active), an optional "Paper" chip, and a subtitle (`Prop — {account_type}` or `{broker_name|'Personal'}`).
  - Each row's `onclick` calls `switchAccount(id)`; the trailing options button `onclick` (with `event.stopPropagation()`) calls `openAccountOptions(id)`.
- **Calls:** switchAccount, openAccountOptions *(both only as generated `onclick=` attribute strings inside the HTML template, not directly invoked)*
- **Called by:** loadAccounts, switchAccount, acctOptSetStatus, acctOptDelete, confirmSaveAccount
- **Side effects:** DOM mutation of `#drawerList`.
- **Notes:** "Calls" here are indirect (string-templated `onclick` handlers), which is why the static call graph flags them as outbound calls of `renderDrawer` even though they only fire on a later user click, not during the render itself.

#### toggleDrawerSection(section)
- **File:** Profit_Tracker/index.html (lines 912-918)
- **Module:** Accounts / UI Rendering
- **Purpose:** Expands/collapses a named drawer section (currently only "Accounts") and rotates its chevron icon.
- **Parameters:**

| Name | Type | Description |
|---|---|---|
| section | string | Section key, e.g. `'accounts'` — capitalized internally to build element ids `sectionAccounts`/`chevAccounts` |

- **Returns:** `void`
- **Internal logic:** Looks up `#section{Capitalized}` and `#chev{Capitalized}`; no-ops if either is missing; toggles `.collapsed` on the body and `.open` on the chevron.
- **Calls:** (none)
- **Called by:** (none detected — wired via `onclick="toggleDrawerSection('accounts')"` in the drawer's section header)
- **Side effects:** DOM class toggles.
- **Notes:** Generic enough to support more collapsible sections in future without new JS.

#### switchAccount(id)
- **File:** Profit_Tracker/index.html (lines 920-925)
- **Module:** Accounts
- **Purpose:** Changes which account is "active" (shown on the dashboard) and closes the drawer.
- **Parameters:**

| Name | Type | Description |
|---|---|---|
| id | string (uuid) | Account id to activate |

- **Returns:** `void`
- **Internal logic:** Sets `activeAccountId = id`; re-renders the drawer (to update the `.active` highlight) and the dashboard; closes the drawer overlay.
- **Calls:** renderDrawer, renderActiveAccount, toggleDrawer
- **Called by:** renderDrawer *(via generated onclick string)*
- **Side effects:** Mutates global `activeAccountId`; DOM re-render; drawer close.
- **Notes:** None.

#### openAccountOptions(id)
- **File:** Profit_Tracker/index.html (lines 929-937)
- **Module:** Accounts
- **Purpose:** Opens the "Account Options" modal (mark active/passed/breached, delete) for a specific account.
- **Parameters:**

| Name | Type | Description |
|---|---|---|
| id | string (uuid) | Account id |

- **Returns:** `void`
- **Internal logic:** Looks up the account by id (no-ops if not found); sets module-level `_acctOptId = id`; populates the modal title/subtitle; opens the modal (`.open` class).
- **Calls:** (none)
- **Called by:** renderDrawer *(via generated onclick string)*
- **Side effects:** Mutates `_acctOptId`; DOM text + class mutation.
- **Notes:** `_acctOptId` is the only way the modal's action buttons (`acctOptSetStatus`/`acctOptDelete`) know which account to act on — a simple single-slot "currently editing" pattern used throughout this file (mirrors `_editingProfileId` for profiles).

#### closeAccountOptions()
- **File:** Profit_Tracker/index.html (lines 939-942)
- **Module:** Accounts
- **Purpose:** Closes the Account Options modal and clears the pending-action id.
- **Parameters:** None
- **Returns:** `void`
- **Internal logic:** Clears `_acctOptId`; removes `.open` from the modal.
- **Calls:** (none)
- **Called by:** acctOptSetStatus, acctOptDelete
- **Side effects:** DOM class mutation; clears `_acctOptId`.
- **Notes:** None.

#### acctOptSetStatus(status)
- **File:** Profit_Tracker/index.html (lines 984-993)
- **Module:** Accounts / Trade CRUD (account lifecycle)
- **Purpose:** Updates an account's status (active/passed/breached) from the Options modal.
- **Parameters:**

| Name | Type | Description |
|---|---|---|
| status | string | `'active'` \| `'passed'` \| `'breached'` |

- **Returns:** `Promise<void>`
- **Internal logic:** No-ops if `_acctOptId` unset. Updates the `accounts` row's `status` column in Supabase; on error, `alert()`s and stops. On success, patches the in-memory `accounts` array entry too, closes the modal, re-renders drawer + active account.
- **Calls:** closeAccountOptions, renderDrawer, renderActiveAccount
- **Called by:** (none detected — wired via inline `onclick="acctOptSetStatus('active'|'passed'|'breached')"` on the three status buttons)
- **Side effects:** Supabase write (`accounts.status`); DOM re-render; mutates `accounts[]` in place.
- **Notes:** Uses a blocking `alert()` for the error path rather than a toast — the only error-surfacing mechanism in this whole app is `alert()`/inline message text; there's no toast system here (unlike the Journal's `showToast`).

#### acctOptDelete()
- **File:** Profit_Tracker/index.html (lines 995-1015)
- **Module:** Accounts
- **Purpose:** Deletes an account (with confirmation), including its trade-assignment rows, but explicitly does NOT touch the underlying Journal trades.
- **Parameters:** None
- **Returns:** `Promise<void>`
- **Internal logic:**
  - No-ops if `_acctOptId` unset or account not found.
  - `confirm()`s with explicit copy clarifying "Your actual trades in the Journal are NOT affected."
  - Deletes all `trade_account_map` rows for this `account_id` first (FK dependency), THEN deletes the `accounts` row.
  - On the accounts-delete error, alerts and stops (leaving the trade_account_map rows already deleted — **not transactional**, a partial-failure edge case).
  - On success, filters the account out of the in-memory `accounts` array; if it was the active account, falls back to the first remaining account (or `null`).
  - Closes modal, re-renders drawer + active account.
- **Calls:** closeAccountOptions, renderDrawer, renderActiveAccount
- **Called by:** (none detected — wired via `onclick="acctOptDelete()"`)
- **Side effects:** Two Supabase deletes (`trade_account_map`, `accounts`); DOM re-render; mutates `accounts[]`, possibly `activeAccountId`.
- **Notes:** The two-delete sequence is not wrapped in a transaction/RPC — if the second delete fails, the trade_account_map rows are already gone but the account remains, silently orphaning any future re-assignment expectations. Low-risk in practice (delete failures are rare) but worth flagging for a from-scratch reimplementation that wants stronger guarantees (e.g. a Postgres function with `ON DELETE CASCADE` would remove this whole two-step dance — see §5 SQL, which already defines `trade_account_map.account_id` with `on delete cascade`, making this manual pre-delete redundant given that schema).

#### getActiveAccount()
- **File:** Profit_Tracker/index.html (line 1017)
- **Module:** Accounts / Utilities
- **Purpose:** Returns the currently active account object.
- **Parameters:** None
- **Returns:** `Object|undefined` — `accounts.find(a => a.id === activeAccountId)`.
- **Internal logic:** Single-expression array find.
- **Calls:** (none)
- **Called by:** openTradePopup, renderActiveAccount, exportToCsv, navigateToDashboard, setTheme
- **Side effects:** None — pure.
- **Notes:** Widely used lookup helper; no caching (recomputed every call, cheap given account counts are small).

---

### Module: Trade Detail Popup

#### openTradePopup(tradeId)
- **File:** Profit_Tracker/index.html (lines 945-979)
- **Module:** UI Rendering / Trade Detail
- **Purpose:** Opens the bottom-sheet trade detail popup for a single trade row clicked in the trades table, showing entry/close/SL/TP/pips/gross/commission/net.
- **Parameters:**

| Name | Type | Description |
|---|---|---|
| tradeId | string (uuid) | The `trades.id` to display |

- **Returns:** `void`
- **Internal logic:**
  - Looks up the trade in `activeTradesCache` first, falling back to `journalTradesCache`; warns and returns if not found.
  - Computes side (`normalizeDirection`), P&L (`calcPnl`), per-lot commission (`resolveCommission`) × lot size, gross = net + commission (unless `noLotSize`/`pending`), pips (`calcPips`).
  - Populates ~10 DOM fields (pair, side pill + class, entry/close/SL/TP/pips, gross/commission/net figures with pos/neg coloring).
  - Opens the popup scrim (`.open` class).
- **Calls:** getActiveAccount, normalizeDirection, calcPnl, resolveCommission, calcPips
- **Called by:** renderActiveAccount *(via generated onclick string on each table row)*
- **Side effects:** DOM mutation (~10 elements); no network/storage.
- **Notes:** If `lot_size` is missing, `gross`/`pnlCell`-style guards elsewhere show "—"/warning text instead of `$0`, avoiding a misleading zero.

#### closeTradePopup()
- **File:** Profit_Tracker/index.html (line 980)
- **Module:** UI Rendering / Trade Detail
- **Purpose:** Closes the trade detail popup.
- **Parameters:** None
- **Returns:** `void`
- **Internal logic:** Removes `.open` from the popup scrim.
- **Calls:** (none)
- **Called by:** (none detected — wired via `onclick="closeTradePopup()"` on the scrim background and the ✕ button)
- **Side effects:** DOM class mutation.
- **Notes:** None.

---

### Module: P&L Calculation Engine

This is the analytical core of PnL Tracker — a layered fallback system for computing P&L/pips/commission across arbitrary instruments without a fixed symbol whitelist.

#### pipSize(pair)
- **File:** Profit_Tracker/index.html (lines 1189-1197)
- **Module:** P&L Calc
- **Purpose:** Returns the "pip" unit size for a symbol, used as a last-resort default when no profile/spec override exists.
- **Parameters:**

| Name | Type | Description |
|---|---|---|
| pair | string | Instrument symbol, e.g. `'EURUSD'`, `'XAUUSD'` |

- **Returns:** `number` — `0.0001` default; `0.01` for JPY pairs or XAG/XPD; `0.1` for XAU; `0.01` for XPT.
- **Internal logic:** Strips non-letters, uppercases, then a chain of `endsWith('JPY')`/`startsWith('JPY'|'XAU'|'XAG'|'XPT'|'XPD')` checks in a specific priority order.
- **Calls:** (none)
- **Called by:** calcPips
- **Side effects:** None — pure.
- **Notes:** This is the fallback pip size; `resolveContractSpec()` (which consults the linked broker profile first) is what's actually used in most real calc paths — `pipSize()` itself is only reached via `calcPips`'s `spec.pipSize ?? pipSize(t.pair)` fallback when no profile-derived pip size exists.

#### calcPips(t, acct)
- **File:** Profit_Tracker/index.html (lines 1199-1207)
- **Module:** P&L Calc
- **Purpose:** Computes the pip move of a closed trade, direction-adjusted.
- **Parameters:**

| Name | Type | Description |
|---|---|---|
| t | Object | Trade row (`entry_price`, `close_price`, `pair`, `trade_type`) |
| acct | Object | Account row (used to resolve the linked broker profile) |

- **Returns:** `number|null` — `null` if entry/close price missing; else pip move rounded to 1 decimal.
- **Internal logic:** Resolves the account's linked profile (if any) → `resolveContractSpec(pair, profile)` → pip size from spec or `pipSize()` fallback. Direction multiplier: `-1` for sell, `+1` for buy. `((close - entry) * dir) / pipSize`, rounded.
- **Calls:** resolveContractSpec, pipSize, normalizeDirection
- **Called by:** openTradePopup, renderActiveAccount, buildCalDayMap
- **Side effects:** None — pure (reads `brokerProfiles` global indirectly via `resolveContractSpec` callers, but takes profile as derived locally).
- **Notes:** None.

#### normalizeDirection(tradeType)
- **File:** Profit_Tracker/index.html (lines 1209-1214)
- **Module:** P&L Calc / Utilities
- **Purpose:** Normalizes a variety of possible trade-direction strings/codes down to `'buy'`/`'sell'`.
- **Parameters:**

| Name | Type | Description |
|---|---|---|
| tradeType | string\|null | Raw `trade_type` value from the Journal's `trades` table |

- **Returns:** `'buy'|'sell'` — defaults to `'buy'` if `tradeType` is falsy or doesn't match a sell pattern.
- **Internal logic:** Lowercases the string; returns `'sell'` if it contains `'short'`, contains `'sell'`, or equals exactly `'s'`; else `'buy'`.
- **Calls:** (none)
- **Called by:** openTradePopup, renderActiveAccount, calcPips, calcPnl, calcR, exportToCsv
- **Side effects:** None — pure.
- **Notes:** Tolerant of the Journal's own `trade_type` values (e.g. `'BUY'`/`'SELL'` seen in `tradeToDb`) as well as looser conventions — a defensive adapter since PnL Tracker consumes a table it doesn't own.

#### classifySymbol(pair)
- **File:** Profit_Tracker/index.html (lines 1224-1253)
- **Module:** P&L Calc
- **Purpose:** Classifies a symbol into one of a small number of calculation strategies without needing a fixed pair whitelist, using a rules-based decomposition of the ticker string.
- **Parameters:**

| Name | Type | Description |
|---|---|---|
| pair | string | Instrument symbol |

- **Returns:** `Object` — `{kind: 'direct_usd'|'usd_base'|'cross_pair'|'needs_lookup'|'unknown', contractSize?, quoteCcy?}`.
- **Internal logic:**
  - `'unknown'` if no pair given.
  - Strips non-letters, uppercases.
  - Metal/commodity ending in `USD` (variable-length prefix, e.g. `XAUUSD`) → `direct_usd` with the metal's standard oz-per-lot contract size.
  - Standard 6-char pairs: quote=`USD` → `direct_usd` (contract size = metal-oz-per-lot if base is a metal code, else standard FX lot); base=`USD` → `usd_base`; both base and quote are recognized ISO currency codes (neither USD) → `cross_pair` (needs an FX conversion rate).
  - Anything else → `needs_lookup` (AI/asset_specs path).
- **Calls:** (none)
- **Called by:** syncFromJournal
- **Side effects:** None — pure.
- **Notes:** Used only to decide which currencies need a Frankfurter rate fetch during Sync — the actual per-trade P&L math re-derives its own classification via `resolveContractSpec`/`calcPnl` rather than reusing this function's result, which is a minor duplication of logic (two independent symbol-classification code paths that must be kept in sync manually).

#### resolveCommission(t, acct)
- **File:** Profit_Tracker/index.html (lines 1261-1291)
- **Module:** P&L Calc
- **Purpose:** Resolves the effective commission-per-lot for a trade using a 4-level priority chain (documented in the code's own header comment).
- **Parameters:**

| Name | Type | Description |
|---|---|---|
| t | Object | Trade row (`pair`) |
| acct | Object | Account row |

- **Returns:** `number` — commission per lot in USD; `0` if `acct` is falsy.
- **Internal logic (priority order, first match wins):**
  1. `asset_specs` cache entry's `commission_per_lot`, if set (symbol-specific override).
  2. If the account has a linked `broker_profile`: the profile's per-asset-class commission field (`commission_forex/_metals/_indices/_commodities`), where the asset class comes from the spec's `asset_class` tag or `_inferAssetClass(t.pair)` — crypto falls back to the forex rate.
  3. The profile's flat `commission_per_lot` (if the class-specific one was null).
  4. The account's own legacy flat `commission_per_lot` field.
- **Calls:** _inferAssetClass
- **Called by:** openTradePopup, calcPnl
- **Side effects:** None — pure (reads `assetSpecsCache` global).
- **Notes:** This priority chain is one of the more subtle pieces of business logic in the app — a from-scratch reimplementation must preserve the exact order, since silently swapping priority 2 and 3 would change historical P&L figures for existing users.

#### _inferAssetClass(pair)
- **File:** Profit_Tracker/index.html (lines 1294-1303)
- **Module:** P&L Calc
- **Purpose:** Best-effort guess at a symbol's asset class when its `asset_specs` row doesn't have one set explicitly yet.
- **Parameters:**

| Name | Type | Description |
|---|---|---|
| pair | string | Instrument symbol |

- **Returns:** `'metal'|'forex'|'other'`.
- **Internal logic:** Strips non-alphanumerics, uppercases. Metal prefix check (XAU/XAG/XPT/XPD) → `'metal'`. 6-char pair with both halves valid ISO currencies → `'forex'`. 6-char ending USD with valid base ISO code → `'forex'`. 6-char starting USD → `'forex'`. Else `'other'` (indices/commodities should get an explicit `asset_class` set by the user or AI lookup instead of relying on this heuristic).
- **Calls:** (none)
- **Called by:** resolveCommission
- **Side effects:** None — pure.
- **Notes:** Deliberately conservative — anything not clearly forex/metal falls to `'other'` rather than guessing index/commodity, since misclassifying those would silently apply the wrong commission rate.

#### resolveContractSpec(pair, profile)
- **File:** Profit_Tracker/index.html (lines 1307-1362)
- **Module:** P&L Calc
- **Purpose:** Resolves the full contract specification (kind, contract size, pip size, point value, quote currency) for a symbol, letting a linked broker profile's custom values override the hardcoded defaults.
- **Parameters:**

| Name | Type | Description |
|---|---|---|
| pair | string | Instrument symbol |
| profile | Object\|null\|undefined | Linked broker/prop profile, or none |

- **Returns:** `Object|null` — `null` if no pair given; else `{kind, contractSize, pipSize?, pointValueUsd?, quoteCcy?}` where `kind` ∈ `direct_usd`\|`usd_base`\|`cross_pair`\|`needs_lookup`.
- **Internal logic:** Priority-ordered `if` chain: XAU-containing → direct_usd using profile's `lot_size_xau`/`pip_size_xau`/`point_value_metals_xau_usd` or hardcoded fallback; XAG-containing → similar with hardcoded `0.001` pip size (note: does NOT read a `pip_size_xag` profile field, unlike XAU — profile only exposes `pip_size_xau`, so XAG's pip size is **not user-configurable** in this version); other metal-code prefix → generic metal fallback; 6-char ending USD → `direct_usd` using profile forex fields (JPY-aware pip size); 6-char starting USD → `usd_base`; 6-char cross pair (both ISO, neither USD) → `cross_pair`; else `needs_lookup`.
- **Calls:** (none)
- **Called by:** calcPips, calcPnl
- **Side effects:** None — pure.
- **Notes:** The XAG pip-size gap (hardcoded `0.001`, no profile override) is a real asymmetry versus XAU's fully profile-driven pip size — worth fixing in a reimplementation by adding a `pip_size_xag` column/field if silver-pair pip precision needs to be user-tunable.

#### withComm(rawPnl, extra)
- **File:** Profit_Tracker/index.html (lines 1377-1378)
- **Module:** P&L Calc
- **Purpose:** Tiny helper closure inside `calcPnl` that subtracts the pre-computed commission and merges in extra result flags.
- **Parameters:**

| Name | Type | Description |
|---|---|---|
| rawPnl | number | Gross P&L before commission |
| extra | Object (optional) | Extra fields to merge into the result (e.g. none currently passed) |

- **Returns:** `{pnl: number, aiSourced: false, ...extra}`.
- **Internal logic:** Single object literal: `{pnl: rawPnl - commissionDeduct, aiSourced: false, ...extra}` — closes over `commissionDeduct` from the enclosing `calcPnl` call.
- **Calls:** (none)
- **Called by:** calcPnl (internal, called 3 times within the same function body — not a globally reusable helper, a local closure)
- **Side effects:** None — pure.
- **Notes:** Defined fresh on every `calcPnl()` call (a new closure each time) — a micro-inefficiency, not a bug; negligible given calc volume.

#### calcPnl(t, acct)
- **File:** Profit_Tracker/index.html (lines 1366-1422)
- **Module:** P&L Calc
- **Purpose:** The central P&L computation for one trade — the single most important function in this app.
- **Parameters:**

| Name | Type | Description |
|---|---|---|
| t | Object | Trade row |
| acct | Object | Account row |

- **Returns:** `Object` — `{pnl: number, aiSourced: boolean, noLotSize?: true, pending?: true, pendingMsg?: string}`.
- **Internal logic:**
  - `lot_size == null` → `{pnl:0, aiSourced:false, noLotSize:true}` (explicit flag rather than a silently-wrong `$0`).
  - Missing entry/close price → `{pnl:0, aiSourced:false}`.
  - Resolves direction, linked profile, `resolveContractSpec`, and commission (`resolveCommission` × lot size).
  - `direct_usd` with a profile `pointValueUsd` set → pip-based calc: `(close-entry)/pipSize * lotSize * pointValueUsd * dir`.
  - `direct_usd` without a point value → price-difference calc: `(close-entry) * lotSize * contractSize * dir`.
  - `usd_base` → same price-difference calc, then divided by `close_price` to convert into USD (since the quote currency IS the base currency's counter... — i.e. pair quoted as USD/XXX).
  - `cross_pair` → price-difference calc in the quote currency, then multiplied by the cached `fxRates[quoteCcy]` (USD per unit of quote currency); if that rate isn't cached yet, returns `{pnl:0, aiSourced:false, pending:true, pendingMsg:"Awaiting {ccy}/USD rate — run Sync"}` rather than guessing.
  - `needs_lookup` → checks `assetSpecsCache`; if absent, kicks off `ensureAssetSpecLookup(pair)` (fire-and-forget) and returns a `pending` placeholder; if present, uses the spec's `point_value_usd` (pip-based) or `contract_size` (price-difference, converted via `close_price` if `quote_currency !== 'USD'`) — if neither is set, returns `{pnl:0, aiSourced:true}`.
- **Calls:** normalizeDirection, resolveContractSpec, resolveCommission, withComm, ensureAssetSpecLookup
- **Called by:** openTradePopup, renderActiveAccount, exportToCsv
- **Side effects:** May trigger `ensureAssetSpecLookup` (Supabase read + possible Gemini Worker call + Supabase write) as a side effect of an otherwise "compute" function — a notable exception to the rest of the function being pure.
- **Notes:** The `pending`/`aiSourced` flags exist specifically so the UI can show a spinner (⏳) or a cloud icon (☁️) rather than a misleadingly confident `$0`/final-looking number while data is incomplete.

#### ensureAssetSpecLookup(symbol)
- **File:** Profit_Tracker/index.html (lines 1426-1467)
- **Module:** P&L Calc / AI Integration
- **Purpose:** Fetches (or re-fetches from cache) a contract spec for a symbol the app doesn't recognize, via the Cloudflare Worker's Gemini proxy, and persists it so future calcs don't re-ask the AI.
- **Parameters:**

| Name | Type | Description |
|---|---|---|
| symbol | string | Unrecognized instrument symbol |

- **Returns:** `Promise<void>` (mutates `assetSpecsCache` and triggers a re-render as its real "return value")
- **Internal logic:**
  - No-ops if already cached or already in-flight (`assetSpecsLookupInFlight` Set de-dupe).
  - Marks in-flight; checks Supabase `asset_specs` for an existing row first (`maybeSingle`) — if found, caches it and re-renders, done.
  - If `CONFIG.CF_WORKER` isn't configured, logs a warning and returns (graceful degradation, no user-facing error).
  - Otherwise `POST {CF_WORKER}/` with `{mode:'asset_spec', symbol}` (see §4.3 for the Worker-side prompt).
  - Builds a row from the response (`contract_size`, `quote_currency`, `point_value_usd`, `source:'ai_lookup'`, `source_confidence`, `notes`, `fetched_at`), upserts it (`onConflict:'user_id,symbol'`), caches the saved (or fallback local) row.
  - `finally` block always clears the in-flight flag and re-renders, even on error — on a caught exception, caches a placeholder row (`source_confidence:'low'`, `notes:'Lookup failed'`) so the UI doesn't retry indefinitely on every render.
- **Calls:** renderActiveAccount
- **Called by:** calcPnl
- **Side effects:** Supabase read + upsert (`asset_specs`); network call to the Cloudflare Worker (which itself calls Gemini); mutates `assetSpecsCache`, `assetSpecsLookupInFlight`; triggers a dashboard re-render.
- **Notes:** The failure-caching behavior (caching a "Lookup failed" placeholder) is a deliberate circuit-breaker — without it, every render of an unresolved symbol would re-trigger a fresh AI call.

---

### Module: PnL Calendar

#### calSetView(v)
- **File:** Profit_Tracker/index.html (lines 1477-1480)
- **Module:** PnL Calendar
- **Purpose:** Switches the calendar's zoom level.
- **Parameters:**

| Name | Type | Description |
|---|---|---|
| v | string | `'week'` \| `'month'` \| `'year'` |

- **Returns:** `void`
- **Internal logic:** Sets module-level `calView = v`; re-renders.
- **Calls:** renderCalendar
- **Called by:** (none detected — wired via `onclick="calSetView('week'|'month'|'year')"` on the view toggle buttons)
- **Side effects:** Mutates `calView`; DOM re-render.
- **Notes:** None.

#### calNav(dir)
- **File:** Profit_Tracker/index.html (lines 1481-1488)
- **Module:** PnL Calendar
- **Purpose:** Moves the calendar's reference date forward/back by one unit of the current view (week/month/year).
- **Parameters:**

| Name | Type | Description |
|---|---|---|
| dir | number | `-1` (back) or `+1` (forward) |

- **Returns:** `void`
- **Internal logic:** Clones `calRefDate`; adjusts by 7 days / 1 month / 1 year depending on `calView`; re-renders.
- **Calls:** renderCalendar
- **Called by:** (none detected — wired via `onclick="calNav(-1|1)"` on the ‹/› arrows)
- **Side effects:** Mutates `calRefDate`; DOM re-render.
- **Notes:** None.

#### calDateKey(d)
- **File:** Profit_Tracker/index.html (lines 1490-1492)
- **Module:** PnL Calendar / Utilities
- **Purpose:** Formats a `Date` into a stable `YYYY-M-D`-ish local-date string key (note: month/day are NOT zero-padded to 2 digits beyond the `padStart(2,'0')` call — actually they ARE zero-padded; re-check: `String(d.getMonth()+1).padStart(2,'0')`) for use as a lookup key.
- **Parameters:**

| Name | Type | Description |
|---|---|---|
| d | Date | Date to key |

- **Returns:** `string` — `"{year}-{month:2digit}-{day:2digit}"`.
- **Internal logic:** Template string using local (not UTC) `getFullYear`/`getMonth`/`getDate`.
- **Calls:** (none)
- **Called by:** buildCalDayMap, calCellHtml, weekColHtml, renderCalendar
- **Side effects:** None — pure.
- **Notes:** Uses local time zone consistently (not UTC) — matters for users near a day boundary; consistent with how `t.close_time` is later parsed with `new Date(...)` (also local-zone display).

#### calcR(t)
- **File:** Profit_Tracker/index.html (lines 1496-1503)
- **Module:** PnL Calendar / P&L Calc
- **Purpose:** Computes the R-multiple (risk-adjusted return) of a trade, based on distance to stop-loss.
- **Parameters:**

| Name | Type | Description |
|---|---|---|
| t | Object | Trade row (`entry_price`, `close_price`, `sl_price`, `trade_type`) |

- **Returns:** `number|null` — `null` if any of entry/close/SL price is missing, or if risk (entry-SL distance) is exactly zero; else profit-in-price-terms ÷ risk-in-price-terms, rounded to 2 decimals.
- **Internal logic:** `risk = |entry - sl|`; `profit = (close - entry) * dir` where `dir` from `normalizeDirection`; `R = profit / risk`.
- **Calls:** normalizeDirection
- **Called by:** buildCalDayMap
- **Side effects:** None — pure.
- **Notes:** This is a duplicate/independent implementation of R-multiple calc from the Journal's own `calcR` (different codebase, same formula) — since PnL Tracker only reads `trades` rows the Journal wrote, it must derive R itself rather than reading a stored value (the `trades` table has no R column).

#### buildCalDayMap(tradeResults)
- **File:** Profit_Tracker/index.html (lines 1505-1520)
- **Module:** PnL Calendar
- **Purpose:** Aggregates a list of `{t, result}` pairs into a per-day map of P&L/pips/R/trade-count/win-count, keyed by close date.
- **Parameters:**

| Name | Type | Description |
|---|---|---|
| tradeResults | Array<{t, result}> | Trade + its pre-computed `calcPnl()` result |

- **Returns:** `Object` — `{[dateKey]: {totalPnl, totalPips, totalR, rCount, tradeCount, wins}}`.
- **Internal logic:** Skips trades with no `close_time` or `pending`/`noLotSize` results. For each remaining trade: buckets by `calDateKey(closeTime)`, accumulates P&L, pips (via `calcPips` — ⚠️ this call references the enclosing scope's `acct` variable, which is not a parameter of `buildCalDayMap` itself — see note), R (via `calcR`, only counted into the average when non-null), trade count, win count.
- **Calls:** calDateKey, calcPips, calcR
- **Called by:** renderCalendar
- **Side effects:** None — pure (aside from the scoping caveat below).
- **Notes:** ⚠️ **Likely latent bug spotted while reading the source:** `calcPips(t, acct)` is called inside `buildCalDayMap`, but `acct` is not a parameter or local variable of this function — it must be resolving to some outer-scope variable at call time (there is no top-level `let acct` visible in this file; if none is in scope when this runs, `acct` would be `undefined`, making `calcPips` fall back to its own internal profile-less defaults rather than the active account's real contract spec). This should be corrected to `buildCalDayMap(tradeResults, acct)` and threaded through from `renderCalendar()`'s caller in a faithful reimplementation, or explicitly confirmed as intentional if some global happens to shadow it in the shipped app.

#### calCellHtml(dayMap, dateObj, inMonth)
- **File:** Profit_Tracker/index.html (lines 1522-1546)
- **Module:** PnL Calendar / UI Rendering
- **Purpose:** Renders one calendar-grid day cell's HTML (date, P&L, pips/R, ordinal suffix, diagonal divider graphic).
- **Parameters:**

| Name | Type | Description |
|---|---|---|
| dayMap | Object | Output of `buildCalDayMap` |
| dateObj | Date | The date this cell represents |
| inMonth | boolean | Whether this date belongs to the currently-viewed month (false = render an empty placeholder cell for padding days) |

- **Returns:** `string` (HTML)
- **Internal logic:** Returns an empty cell div if `!inMonth`. Otherwise looks up the day's data by `calDateKey`; if none, renders just the date number with an ordinal suffix (st/nd/rd/th, computed inline). If data exists, colors the cell pos/neg, shows `$` amount top-left and pips/R bottom-right, plus a faint diagonal SVG divider line.
- **Calls:** calDateKey
- **Called by:** renderCalendar
- **Side effects:** None — pure (string builder).
- **Notes:** None.

#### weekColHtml(dayMap, weekDays)
- **File:** Profit_Tracker/index.html (lines 1548-1561)
- **Module:** PnL Calendar / UI Rendering
- **Purpose:** Renders the trailing "Weekly" summary column shown at the end of each week row in month view.
- **Parameters:**

| Name | Type | Description |
|---|---|---|
| dayMap | Object | Output of `buildCalDayMap` |
| weekDays | Date[] | The (5, Mon-Fri) dates in this row |

- **Returns:** `string` (HTML)
- **Internal logic:** Sums P&L and counts trading days across `weekDays` present in `dayMap`; colors pos/neg only if `days>0`.
- **Calls:** calDateKey
- **Called by:** renderCalendar
- **Side effects:** None — pure.
- **Notes:** None.

#### renderCalendar()
- **File:** Profit_Tracker/index.html (lines 1563-1662)
- **Module:** PnL Calendar
- **Purpose:** Master renderer for the PnL Calendar panel — draws week, month, or year view depending on `calView`.
- **Parameters:** None
- **Returns:** `void`
- **Internal logic:**
  - Updates the view-toggle buttons' active styling.
  - Builds `dayMap` from module-level `_calTradeResults` (set by `renderActiveAccount` on each account switch/sync).
  - **Week view:** finds Monday of the current week, renders 5 day-of-week cells, computes week totals, sets the label to a date range.
  - **Month view:** computes the full Monday-aligned grid (including padding days from adjacent months via `inMonth` flag), builds a 5-col + 1 weekly-summary-col row per week until the month is fully covered, accumulates month totals.
  - **Year view:** builds a 4×3 grid of month cells, each independently summing daily P&L/pips/day-count within that month.
  - Sets `#calGrid` innerHTML, `#calLabel` text, `#calStats` text + color.
- **Calls:** buildCalDayMap, calDateKey, calCellHtml, weekColHtml
- **Called by:** renderActiveAccount, calSetView, calNav
- **Side effects:** DOM mutation (`#calGrid`, `#calLabel`, `#calStats`, button active states).
- **Notes:** Rebuilds `dayMap` from scratch on every render (no memoization) — acceptable given realistic trade-count/day volumes for a single trading account.

---

### Module: Equity Curve / Export

#### renderEquityCurve(tradeResults, startBalance, currentBalOverride)
- **File:** Profit_Tracker/index.html (lines 1666-1785)
- **Module:** UI Rendering / Charts
- **Purpose:** Draws the dashboard's equity-curve line chart via Chart.js, optionally showing a dashed "pre-app history" segment when the account was created mid-evaluation.
- **Parameters:**

| Name | Type | Description |
|---|---|---|
| tradeResults | Array<{t, result}> | Closed trades with computed P&L, for this account |
| startBalance | number | Account's `starting_balance` |
| currentBalOverride | number\|null | Account's `current_balance_override`, if the user entered a later starting point |

- **Returns:** `void`
- **Internal logic:**
  - Bails if the canvas or the global `Chart` (Chart.js, loaded via a `<script>` tag at the very end of the file) isn't available.
  - Reads CSS custom properties (`--muted`, `--border`, `--pos`, `--neg`) from computed style so the chart matches the active theme.
  - Builds a running-balance point series from `tradeResults` sorted-order P&L, starting from `currentBalOverride ?? startBalance`.
  - Line color: green if final balance ≥ start, else red.
  - Destroys any previous `Chart` instance before creating a new one (`_equityChart.destroy()`) — required by Chart.js to avoid canvas reuse errors.
  - When `currentBalOverride` is set, renders TWO datasets: a dashed grey "Pre-app history" segment (`[startBalance → currentBalOverride]`) plus a solid "Synced trades" segment continuing from there; otherwise a single solid dataset from `startBalance`.
  - Configures tooltip to format as currency, y-axis ticks as `$`-prefixed.
- **Calls:** (none)
- **Called by:** renderActiveAccount, setTheme
- **Side effects:** DOM mutation via Chart.js canvas rendering; mutates/replaces module-level `_equityChart`.
- **Notes:** Re-called on every theme switch (`setTheme`) specifically to re-read the CSS custom properties and recolor the chart — Chart.js doesn't auto-pick-up CSS variable changes.

#### exportToCsv()
- **File:** Profit_Tracker/index.html (lines 1788-1819)
- **Module:** Export
- **Purpose:** Exports the active account's trades to a downloadable CSV file.
- **Parameters:** None
- **Returns:** `void`
- **Internal logic:**
  - No-ops if no active account.
  - Builds a header row, then one row per trade in `journalTradesCache` (⚠️ note: NOT filtered to only the active account's assigned trades — see caveat below), computing gross/commission/net per row via `calcPnl`, skipping rows with `noLotSize`/`pending`.
  - Joins into a quoted CSV string, creates a `Blob`, triggers a download via a temporary `<a download>` element, then revokes the object URL.
- **Calls:** getActiveAccount, calcPnl, normalizeDirection
- **Called by:** (none detected — wired via `onclick="exportToCsv()"` on the "⬇ Export CSV" button)
- **Side effects:** Client-side file download (Blob/ObjectURL); no network/storage writes.
- **Notes:** ⚠️ **Likely bug:** iterates `journalTradesCache` (ALL trades fetched from the Journal across every account) rather than the trades actually assigned to the currently active account (which `renderActiveAccount` computes via `trade_account_map` lookups into `tradeIds`) — this means "Export CSV" may include trades belonging to *other* accounts if the user has more than one, unless every trade in `journalTradesCache` happens to belong to the account being viewed (e.g. a single-account user). A faithful reimplementation should filter by the same `tradeIds` set `renderActiveAccount` uses. There's also a dead line: `const mapIds = Object.entries(journalTradesCache.length ? {} : {});` — computed but never used, apparently leftover from a previous (correct?) filtering approach that was never finished/removed.

#### syncFromJournal()
- **File:** Profit_Tracker/index.html (lines 1821-1851)
- **Module:** Sync
- **Purpose:** Pulls the latest closed intraday trades from the shared Supabase `trades` table (written by the Journal app) and refreshes any FX rates needed for cross-pair P&L.
- **Parameters:** None
- **Returns:** `Promise<void>`
- **Internal logic:**
  - Disables and relabels the Sync button ("Syncing…").
  - `sb.from('trades').select('id,pair,trade_type,entry_price,close_price,sl_price,tp_price,lot_size,status,open_time,close_time').eq('status','closed').eq('is_intraday', true)` — **note:** this query has **no `user_id` filter** in the select chain shown; it relies entirely on Supabase RLS to scope results to the calling user. (Consistent with this app's general pattern of trusting RLS rather than always double-filtering client-side — unlike the Journal, which does add `.eq('user_id', ...)` defensively on almost every query even though RLS should already enforce it.)
  - Populates `journalTradesCache`.
  - Scans all fetched trades for any that classify as `cross_pair` (via `classifySymbol`), collects their distinct quote currencies, and if any exist, awaits `fetchFxRates([...quoteCcysNeeded])` before finishing.
  - Updates the `#syncNote` label with a count + timestamp, or an error message.
  - `finally` re-enables the button; always calls `renderActiveAccount()` at the end regardless of success/failure.
- **Calls:** classifySymbol, fetchFxRates, renderActiveAccount
- **Called by:** (none detected — wired via `onclick="syncFromJournal()"` on the topbar Sync button)
- **Side effects:** Supabase read (`trades`); network call to Frankfurter (via `fetchFxRates`, conditionally); mutates `journalTradesCache`, `fxRates`; DOM re-render.
- **Notes:** This is the app's **only** read of the Journal's `trades` table, and it is entirely manual (button-triggered) — PnL Tracker never auto-syncs on load or on an interval; a user must click "Sync" after logging in to see recent trades.

#### fetchFxRates(ccys)
- **File:** Profit_Tracker/index.html (lines 1856-1875)
- **Module:** Sync / P&L Calc
- **Purpose:** Fetches USD conversion rates for a list of currency codes from the free Frankfurter.app ECB-rates API, for cross-pair P&L conversion.
- **Parameters:**

| Name | Type | Description |
|---|---|---|
| ccys | string[] | 3-letter currency codes needed, e.g. `['JPY','CHF']` |

- **Returns:** `Promise<void>` (mutates the global `fxRates` cache)
- **Internal logic:**
  - `GET https://api.frankfurter.app/latest?from=USD&to={comma-joined ccys}` — a single batched request for all needed currencies at once.
  - Response gives USD-per-unit-of-target-currency in `json.rates` (i.e. `rates.JPY` = how many JPY equal 1 USD); since the app wants ccy→USD (not USD→ccy), it stores the **inverse**: `fxRates[ccy] = 1 / usdPerCcy`.
  - Explicitly also sets `fxRates['USD'] = 1`.
  - On any fetch/parse failure, only `console.warn`s — cross-pair trades simply stay in their `pending` state (⏳ icon) until the next successful Sync.
- **Calls:** (none)
- **Called by:** syncFromJournal
- **Side effects:** Network call (Frankfurter API, no key needed); mutates global `fxRates`.
- **Notes:** Rates are ECB daily rates (Frankfurter's data source), not real-time — acceptable for journal-style historical P&L reporting, not suitable for live trading decisions.

---

### Module: Add Account Modal

#### openAddAccountModal()
- **File:** Profit_Tracker/index.html (lines 1880-1883)
- **Module:** Add Account
- **Purpose:** Opens the "Add Account" modal in a freshly reset state.
- **Parameters:** None
- **Returns:** `void`
- **Internal logic:** Adds `.open` to the scrim; calls `resetAddAccountForm()`.
- **Calls:** resetAddAccountForm
- **Called by:** (none detected — wired via `onclick="openAddAccountModal()"` on the drawer "+ Add Account" row and the floating action button)
- **Side effects:** DOM class mutation; form reset.
- **Notes:** None.

#### closeAddAccountModal()
- **File:** Profit_Tracker/index.html (line 1884)
- **Module:** Add Account
- **Purpose:** Closes the Add Account modal.
- **Parameters:** None
- **Returns:** `void`
- **Internal logic:** Removes `.open` from the scrim.
- **Calls:** (none)
- **Called by:** populateFProfileDropdown *(only in the "create one first" link's onclick string, not called directly during normal population)*, confirmSaveAccount
- **Side effects:** DOM class mutation.
- **Notes:** None.

#### resetAddAccountForm()
- **File:** Profit_Tracker/index.html (lines 1886-1896)
- **Module:** Add Account
- **Purpose:** Clears all Add Account form fields and resets toggle state to defaults (prop / live).
- **Parameters:** None
- **Returns:** `void`
- **Internal logic:** Clears 6 named input fields; clears the profile-select message; resets the Save button label/enabled state; calls `setAccountKind('prop')` and `setAccountPaper(false)`.
- **Calls:** setAccountKind, setAccountPaper
- **Called by:** openAddAccountModal
- **Side effects:** DOM value/class/text mutation.
- **Notes:** None.

#### setAccountPaper(isPaper)
- **File:** Profit_Tracker/index.html (lines 1898-1903)
- **Module:** Add Account
- **Purpose:** Toggles the Live/Paper segmented button and refreshes the profile dropdown (profiles aren't filtered by paper status, but the dropdown re-populates defensively on every toggle).
- **Parameters:**

| Name | Type | Description |
|---|---|---|
| isPaper | boolean | New paper-trading flag |

- **Returns:** `void`
- **Internal logic:** Sets module-level `addAccountPaper`; toggles `.sel` class on the two buttons; calls `populateFProfileDropdown()`.
- **Calls:** populateFProfileDropdown
- **Called by:** resetAddAccountForm
- **Side effects:** Mutates `addAccountPaper`; DOM class mutation.
- **Notes:** None.

#### setAccountKind(kind)
- **File:** Profit_Tracker/index.html (lines 1905-1914)
- **Module:** Add Account
- **Purpose:** Toggles the Prop Firm/Personal segmented button, shows/hides the kind-specific fields, and refreshes the profile dropdown filter.
- **Parameters:**

| Name | Type | Description |
|---|---|---|
| kind | string | `'prop'` \| `'personal'` |

- **Returns:** `void`
- **Internal logic:** Sets module-level `addAccountKind`; toggles `.sel` on the two buttons; shows `#propFields`/`#personalFields` accordingly; shows `#fCurrBalField` (mid-evaluation current balance) only for `'prop'`; calls `populateFProfileDropdown()`.
- **Calls:** populateFProfileDropdown
- **Called by:** resetAddAccountForm
- **Side effects:** Mutates `addAccountKind`; DOM show/hide.
- **Notes:** None.

#### populateFProfileDropdown()
- **File:** Profit_Tracker/index.html (lines 1917-1943)
- **Module:** Add Account
- **Purpose:** Fills the "Profile" `<select>` in the Add Account modal with profiles matching the currently selected account kind, and blocks saving if none exist yet.
- **Parameters:** None
- **Returns:** `void`
- **Internal logic:** Filters `brokerProfiles` by `profile_type === (addAccountKind==='prop'?'prop':'broker')`; builds `<option>`s; if none match, shows a red "no profiles yet" message with a link that closes this modal and opens the New Profile modal instead (`closeAddAccountModal(); openNewProfileModal(typeFilter)`), and disables the Save button; else clears the message and enables Save.
- **Calls:** closeAddAccountModal, openNewProfileModal *(both only inside a generated onclick string, not invoked during normal population)*
- **Called by:** setAccountPaper, setAccountKind
- **Side effects:** DOM mutation (`<select>` options, message text, Save button disabled state).
- **Notes:** Profiles are a **hard requirement** to create an account — the UI actively prevents saving an account with no linked profile, forcing the "Broker/Firm Profile" flow to be completed first.

#### confirmSaveAccount()
- **File:** Profit_Tracker/index.html (lines 1945-1991)
- **Module:** Add Account / Trade CRUD
- **Purpose:** Validates and saves a new account row to Supabase.
- **Parameters:** None
- **Returns:** `Promise<void>`
- **Internal logic:**
  - Reads name/starting-balance/profile-id; `alert()`s and returns early if any required field is missing (name, starting balance, profile).
  - Reads optional current-balance override.
  - Sets Save button to a loading state.
  - Builds the insert payload (see `accounts` schema, §5.11): `user_id, name, account_kind, is_paper, starting_balance, current_balance_override` (only set if prop AND different from starting balance), `currency:'USD'`, `status:'active'`, `broker_profile_id`, `user_confirmed_at`, plus `firm_name`/`account_type` (prop) or `broker_name` (personal).
  - `sb.from('accounts').insert(payload).select().single()`; on error, alerts and stops (leaving the modal open).
  - On success: pushes the new row into `accounts`, makes it the active account, closes the modal, re-renders drawer + dashboard.
- **Calls:** closeAddAccountModal, renderDrawer, renderActiveAccount
- **Called by:** (none detected — wired via `onclick="confirmSaveAccount()"` on the modal's Save button)
- **Side effects:** Supabase insert (`accounts`); DOM mutation; mutates `accounts[]`, `activeAccountId`.
- **Notes:** `current_balance_override` is only persisted when it differs from `starting_balance` — if the user enters the same value in both fields, the override is correctly treated as "not actually mid-evaluation" and stored as `null`.

---

### Module: Navigation / Theme

#### toggleDrawer(open)
- **File:** Profit_Tracker/index.html (lines 1996-1999)
- **Module:** Navigation
- **Purpose:** Opens/closes the side drawer and its background scrim.
- **Parameters:**

| Name | Type | Description |
|---|---|---|
| open | boolean | Target open state |

- **Returns:** `void`
- **Internal logic:** Toggles `.open` class on `#drawer` and `#scrim` to the given boolean (not a flip — an explicit target state).
- **Calls:** (none)
- **Called by:** switchAccount, navigateToSettings
- **Side effects:** DOM class mutation.
- **Notes:** Also wired directly via `onclick="toggleDrawer(true)"` (hamburger button) and `onclick="toggleDrawer(false)"` (scrim background click) in the HTML, in addition to its two in-code callers.

#### navigateToSettings()
- **File:** Profit_Tracker/index.html (lines 2003-2014)
- **Module:** Navigation
- **Purpose:** Switches from the Dashboard view to the Settings view (single-page app, no router/URL change).
- **Parameters:** None
- **Returns:** `void`
- **Internal logic:** Hides dashboard, shows settings page; hides the FAB and Sync button (irrelevant on Settings); swaps the topbar's menu button for a back button; sets the topbar title to "Settings"; closes the drawer; calls `renderSettingsPage()`.
- **Calls:** toggleDrawer, renderSettingsPage
- **Called by:** (none detected — wired via `onclick="navigateToSettings()"` on the drawer's Settings row)
- **Side effects:** DOM show/hide/text mutation across ~7 elements.
- **Notes:** None.

#### navigateToDashboard()
- **File:** Profit_Tracker/index.html (lines 2016-2029)
- **Module:** Navigation
- **Purpose:** Switches from Settings back to the Dashboard view.
- **Parameters:** None
- **Returns:** `void`
- **Internal logic:** Reverses `navigateToSettings`'s DOM changes; restores the "PnL Tracker" topbar brand HTML including the `#activeAccountLabel` span, then re-populates that label from the current active account (since resetting `innerHTML` wipes the span's previous text content).
- **Calls:** getActiveAccount
- **Called by:** (none detected — wired via `onclick="navigateToDashboard()"` on the topbar Back button)
- **Side effects:** DOM show/hide/text mutation.
- **Notes:** None.

#### setTheme(theme)
- **File:** Profit_Tracker/index.html (lines 2031-2040)
- **Module:** Navigation / Theming
- **Purpose:** Switches the app's visual theme and persists the choice.
- **Parameters:**

| Name | Type | Description |
|---|---|---|
| theme | string | `'light'` \| `'dark'` \| `'black'` \| `'journal'` |

- **Returns:** `void`
- **Internal logic:** Sets `document.body[data-theme]`; persists to `localStorage['pnl_theme']`; updates the active theme-pill button; if the equity chart has data, re-renders it (`renderEquityCurve`) so its CSS-variable-derived colors update immediately rather than waiting for the next natural re-render.
- **Calls:** getActiveAccount, renderEquityCurve
- **Called by:** (none detected — wired via `onclick="setTheme('light'|'dark'|'black'|'journal')"` on the 4 theme pills)
- **Side effects:** DOM attribute/class mutation; `localStorage` write; possible chart re-render.
- **Notes:** Four themes are supported (`light`/`dark`/`black`=OLED/`journal`=warm paper-like palette) — more than the Journal app itself appears to expose (⚠️ not verified against the Journal's own theme list in this document; cross-check against the Journal's Settings page function docs if reconciling theme parity matters for a rebrand).

#### (IIFE) restoreTheme
- **File:** Profit_Tracker/index.html (lines 2042-2049)
- **Module:** Navigation / Theming
- **Purpose:** Applies a previously saved theme choice immediately on script load, before the user interacts with anything.
- **Parameters:** None (immediately-invoked, no arguments)
- **Returns:** n/a — IIFE, return value discarded
- **Internal logic:** Reads `localStorage['pnl_theme']`; if it's one of the 4 valid values, sets `document.body[data-theme]` immediately. Does NOT update the theme-pill active states here (comment notes this happens later once Settings renders and calls `setTheme`/`renderSettingsPage`).
- **Calls:** (none)
- **Called by:** (self-invoking — runs once at parse time, not called by name elsewhere)
- **Side effects:** DOM attribute mutation; reads `localStorage`.
- **Notes:** This — not `checkExistingSession()` — is actually the very *first* piece of app logic to run after the `CONFIG`/globals are defined, since it's an IIFE executed at parse time rather than deferred to a later call.

---

### Module: Settings Page — Profiles, Links, Asset Specs

#### renderSettingsPage()
- **File:** Profit_Tracker/index.html (lines 2054-2061)
- **Module:** Settings
- **Purpose:** Master renderer for the Settings page — refreshes theme pills plus all three settings sections.
- **Parameters:** None
- **Returns:** `void`
- **Internal logic:** Re-applies the `.active` class to the theme pill matching the current `data-theme`; calls `renderProfilesList()`, `renderAcctProfileLinks()`, `renderAssetSpecsList()`.
- **Calls:** renderProfilesList, renderAcctProfileLinks, renderAssetSpecsList
- **Called by:** navigateToSettings
- **Side effects:** DOM mutation (delegated to the three sub-renderers).
- **Notes:** None.

#### renderProfilesList()
- **File:** Profit_Tracker/index.html (lines 2064-2134)
- **Module:** Settings / Broker Profiles
- **Purpose:** Renders every saved broker/prop profile as an editable card with per-asset-class commission/lot/pip/point-value inputs, plus which accounts are linked to it.
- **Parameters:** None
- **Returns:** `void`
- **Internal logic:**
  - Empty state if no profiles.
  - Per profile: finds linked account names (`accounts.filter(a => a.broker_profile_id === p.id)`), builds a "Prop Firm"/"Broker" type label, conditionally includes a Prop Rules block (profit target/drawdown/daily loss/drawdown-type/reset-hour inputs) only for `profile_type==='prop'`, then always includes 4 asset-class blocks (Forex/Metals/Indices/Commodities) via a shared local `classHtml()` template builder, each pre-filled with the profile's stored values or the field's hardcoded placeholder default.
  - Each card's Save button calls `saveProfileEdit(p.id)`, delete button calls `deleteProfile(p.id)`.
- **Calls:** saveProfileEdit, deleteProfile *(both only inside generated onclick strings)*
- **Called by:** renderSettingsPage, saveProfileEdit, deleteProfile, saveProfile, linkAccountProfile
- **Side effects:** DOM mutation (`#profilesList`).
- **Notes:** Rebuilds the entire list's HTML from scratch on every call (including after every single-field edit save) — simple but means any in-progress edits in *other* profile cards on screen are also wiped and reset to their last-saved values whenever any one card is saved. Acceptable given profiles are edited one at a time via explicit Save clicks, not live-typed.

#### saveProfileEdit(profileId)
- **File:** Profit_Tracker/index.html (lines 2136-2182)
- **Module:** Settings / Broker Profiles
- **Purpose:** Persists edits made to an existing profile card's ~20 input fields back to Supabase.
- **Parameters:**

| Name | Type | Description |
|---|---|---|
| profileId | string (uuid) | The `broker_profiles.id` being edited |

- **Returns:** `Promise<void>`
- **Internal logic:** No-ops if profile not found. Sets that card's Save button to a loading glyph. Uses two tiny local helpers `g(id)` (raw value) and `pf(id)` (parsed float or `null`) to read every field by its `{prefix}_{profileId}` id convention, building the full update payload (prop rules + all 4 asset classes' commission/lot/pip/point-value fields). `sb.from('broker_profiles').update(payload).eq('id', profileId)`; on error alerts and stops; on success, `Object.assign(p, payload)` (patches the in-memory object in place), re-renders the dashboard (commission changes affect P&L) and the profiles list.
- **Calls:** g, pf, renderActiveAccount, renderProfilesList
- **Called by:** renderProfilesList *(via generated onclick string)*
- **Side effects:** Supabase update (`broker_profiles`); DOM mutation; mutates the profile object in `brokerProfiles[]` in place.
- **Notes:** None.

#### g(id)
- **File:** Profit_Tracker/index.html (line 2143, inside `saveProfileEdit`; a second, separately-scoped copy also exists inside `saveAssetSpec` at line 2521 — the static extractor collapsed these into one JSON entry since they share a name, but they are two distinct closures over different DOM ids)
- **Module:** Utilities (local helper)
- **Purpose:** Reads a form field's raw string value by element id, defaulting to `''` if the element doesn't exist.
- **Parameters:**

| Name | Type | Description |
|---|---|---|
| id | string | DOM element id |

- **Returns:** `string`
- **Internal logic:** `document.getElementById(id)?.value ?? ''`.
- **Calls:** (none)
- **Called by:** saveProfileEdit (own copy), saveAssetSpec (own copy), pf (both copies, as their shared implementation pattern)
- **Side effects:** None — pure DOM read.
- **Notes:** Not a single shared global function — each of `saveProfileEdit` and `saveAssetSpec` defines its OWN local `g`/`pf` pair with identical logic (simple copy-paste duplication rather than a shared utility). A from-scratch reimplementation could hoist this to one true shared helper.

#### deleteProfile(profileId)
- **File:** Profit_Tracker/index.html (lines 2184-2196)
- **Module:** Settings / Broker Profiles
- **Purpose:** Deletes a broker profile after confirming, unlinking any accounts that referenced it first.
- **Parameters:**

| Name | Type | Description |
|---|---|---|
| profileId | string (uuid) | Profile to delete |

- **Returns:** `Promise<void>`
- **Internal logic:** `confirm()`s with a warning that linked accounts will be unlinked. For each linked account, sequentially awaits an update setting `broker_profile_id = null` (both in Supabase and in-memory) — a loop of sequential awaits, not `Promise.all`. Then deletes the profile row. Filters it out of `brokerProfiles[]`. Re-renders profiles list + account links.
- **Calls:** renderProfilesList, renderAcctProfileLinks
- **Called by:** renderProfilesList *(via generated onclick string)*
- **Side effects:** Multiple Supabase updates (`accounts.broker_profile_id`) + one delete (`broker_profiles`); DOM mutation; mutates `accounts[]`/`brokerProfiles[]` in place.
- **Notes:** The schema's recommended FK (`accounts.broker_profile_id references broker_profiles(id) on delete set null`, §5.15) would make this manual unlink loop unnecessary at the database level — the app does it defensively in application code instead (belt-and-braces, or the FK constraint may not actually exist in the live schema; ⚠️ cannot be confirmed from source whether the live DB has `on delete set null` or `restrict`/`no action`, which would make this manual step load-bearing rather than redundant).

#### openNewProfileModal(type)
- **File:** Profit_Tracker/index.html (lines 2198-2229)
- **Module:** Settings / Broker Profiles
- **Purpose:** Opens the New Profile modal in "Step 1" (name + AI fetch) state, fully reset.
- **Parameters:**

| Name | Type | Description |
|---|---|---|
| type | string | `'prop'` \| `'broker'` |

- **Returns:** `void`
- **Internal logic:** Sets `_editingProfileId = null`, `_editingProfileType = type`; sets modal title/subtitle text per type; clears ~20 input fields by id; resets the drawdown-type select to `'static'`, reset-hour to `'22'`, spread-type to blank; hides Step 2 and the Save button; shows/hides the Prop Rules block based on type; clears AI notes and confidence badges.
- **Calls:** (none)
- **Called by:** populateFProfileDropdown *(via generated onclick string in the "create one first" link)*
- **Side effects:** DOM value/class/text/visibility mutation; mutates `_editingProfileId`/`_editingProfileType`.
- **Notes:** Despite `_editingProfileId` being set to `null` here, this variable is never actually read anywhere else in the file (⚠️ `_editingProfileId` appears write-only — `saveProfile()` always does an `insert`, never checks `_editingProfileId` to decide between insert/update — meaning **the New Profile modal has no edit mode**, only a create mode, despite the variable's naming implying an edit-vs-create distinction was originally planned).

#### closeProfileModal()
- **File:** Profit_Tracker/index.html (lines 2230-2231)
- **Module:** Settings / Broker Profiles
- **Purpose:** Closes the New/Edit Profile modal.
- **Parameters:** None
- **Returns:** `void`
- **Internal logic:** Removes `.open` from the modal scrim.
- **Calls:** (none)
- **Called by:** saveProfile *(on success)*; also wired directly via `onclick="closeProfileModal()"` on the modal's Cancel button
- **Side effects:** DOM class mutation.
- **Notes:** None.

#### fetchProfileRules()
- **File:** Profit_Tracker/index.html (lines 2234-2348)
- **Module:** Settings / Broker Profiles / AI Integration
- **Purpose:** Calls the Cloudflare Worker's Gemini proxy to auto-fill the New Profile modal's ~20 fields from a firm/broker name, then reveals the review step.
- **Parameters:** None (reads `#pmFirmName` input directly)
- **Returns:** `Promise<void>`
- **Internal logic:**
  - Requires a non-empty firm name, else shows an inline error and stops.
  - Sets the Fetch button to a loading state.
  - Bails gracefully with an inline message if `CONFIG.CF_WORKER` isn't set.
  - `POST {CF_WORKER}/` with `{mode:'profile_rules', firmName, accountType:'', brokerContext: _editingProfileType}` (see §4.3 for the Worker-side prompt/response shape).
  - If the response has an `error` field, shows it and stops.
  - Populates prop-rule fields (only if `_editingProfileType==='prop'` and `json.prop_rules` present).
  - Populates all 4 asset-class field groups from `json.asset_classes`, each with a confidence badge built by the local `confBadge()` helper (color-coded high/low confidence + optional note text).
  - Shows overall AI notes if present.
  - Reveals Step 2 (review) and the Save button; sets a status message (different wording for low- vs normal-confidence results).
  - `finally` always restores the Fetch button's label/enabled state.
- **Calls:** confBadge
- **Called by:** (none detected — wired via `onclick="fetchProfileRules()"` on the "Fetch with AI" button)
- **Side effects:** Network call to the Cloudflare Worker (which calls Gemini); DOM mutation across ~20 fields + status text.
- **Notes:** This is a **preview-only** fetch — nothing is written to Supabase until the user reviews and clicks "Confirm & Save" (`saveProfile()`), which is a deliberate two-step "AI suggests, human confirms" UX pattern repeated from the asset-spec flow.

#### confBadge(notes, confidence)
- **File:** Profit_Tracker/index.html (lines 2283-2286)
- **Module:** Settings / UI Rendering (local helper)
- **Purpose:** Builds a small colored "(high/low confidence · note)" badge span for a fetched AI field.
- **Parameters:**

| Name | Type | Description |
|---|---|---|
| notes | string\|null | Optional AI-provided note for this specific asset class |
| confidence | string | `'high'` \| `'low'` (or falsy, in which case an empty string is returned) |

- **Returns:** `string` (HTML) or `''`.
- **Internal logic:** Green text for `'high'`, red for anything else; appends `· {notes}` if notes were provided.
- **Calls:** (none)
- **Called by:** fetchProfileRules
- **Side effects:** None — pure.
- **Notes:** Local helper defined inside `fetchProfileRules`, not reusable elsewhere.

#### _buildProfilePayload()
- **File:** Profit_Tracker/index.html (lines 2351-2384)
- **Module:** Settings / Broker Profiles
- **Purpose:** Reads all ~20 New Profile modal fields into a single Supabase-ready insert payload.
- **Parameters:** None
- **Returns:** `Object` — full `broker_profiles` row shape (see §5.13 schema).
- **Internal logic:** Straight-line field-by-field `parseFloat`/`parseInt` reads with `|| null`/`|| <default>` fallbacks matching each field's schema default (e.g. `lot_size_forex: ... || 100000`).
- **Calls:** (none)
- **Called by:** saveProfile
- **Side effeffects:** None — pure DOM read, no mutation.
- **Notes:** Does not include `id`/`created_at` (server-assigned) — only the user/AI-editable columns.

#### saveProfile()
- **File:** Profit_Tracker/index.html (lines 2386-2401)
- **Module:** Settings / Broker Profiles
- **Purpose:** Inserts the New Profile modal's data as a new `broker_profiles` row.
- **Parameters:** None
- **Returns:** `Promise<void>`
- **Internal logic:** Requires a non-empty name (`alert()` + return otherwise). Sets Save button to loading state. Builds the payload via `_buildProfilePayload()`, inserts it, restores the button, alerts on error and stops. On success, pushes into `brokerProfiles[]`, closes the modal, re-renders the profiles list and account links.
- **Calls:** _buildProfilePayload, closeProfileModal, renderProfilesList, renderAcctProfileLinks
- **Called by:** (none detected — wired via `onclick="saveProfile()"` on the modal's "Confirm & Save" button)
- **Side effects:** Supabase insert (`broker_profiles`); DOM mutation; mutates `brokerProfiles[]`.
- **Notes:** As noted under `openNewProfileModal`, this function always inserts — there is no corresponding "update an existing profile's identity fields via this modal" path; only the always-visible profile cards (`saveProfileEdit`) support editing after creation.

#### renderAcctProfileLinks()
- **File:** Profit_Tracker/index.html (lines 2405-2419)
- **Module:** Settings / Broker Profiles
- **Purpose:** Renders one row per account with a dropdown to (re)link it to a broker/prop profile.
- **Parameters:** None
- **Returns:** `void`
- **Internal logic:** Empty-state if no accounts. Per account, builds a `<select>` with a "— None —" option plus every profile labeled with its type, pre-selecting the account's current `broker_profile_id`; `onchange` calls `linkAccountProfile(account.id, this.value)`.
- **Calls:** linkAccountProfile *(only inside a generated onchange string)*
- **Called by:** renderSettingsPage, deleteProfile, saveProfile
- **Side effects:** DOM mutation (`#acctProfileLinks`).
- **Notes:** None.

#### linkAccountProfile(accountId, profileId)
- **File:** Profit_Tracker/index.html (lines 2421-2429)
- **Module:** Settings / Broker Profiles
- **Purpose:** Updates which profile an account is linked to.
- **Parameters:**

| Name | Type | Description |
|---|---|---|
| accountId | string (uuid) | Account being edited |
| profileId | string \| '' | New profile id, or empty string to unlink |

- **Returns:** `Promise<void>`
- **Internal logic:** Converts `''` to `null`. `sb.from('accounts').update({broker_profile_id: val}).eq('id', accountId)`; alerts on error. On success, patches the in-memory account object; re-renders profiles list (to update "linked accounts" text) and the active account dashboard (commission/rules may have changed).
- **Calls:** renderProfilesList, renderActiveAccount
- **Called by:** renderAcctProfileLinks *(via generated onchange string)*
- **Side effects:** Supabase update (`accounts.broker_profile_id`); DOM re-render; mutates the account object in place.
- **Notes:** None.

#### renderAssetSpecsList()
- **File:** Profit_Tracker/index.html (lines 2432-2506)
- **Module:** Settings / Asset Specs
- **Purpose:** Renders every cached asset spec as an editable card (class, contract size, pip size, point value, quote currency, commission override, notes).
- **Parameters:** None
- **Returns:** `void`
- **Internal logic:** Empty state if `assetSpecsCache` is empty ("auto-populate when you sync trades..."). Per spec: computes a confidence label (`'Edited'` if `source==='user_edit'`, else `'High/Low confidence'` from `source_confidence`), builds a local `sf()` helper for consistent labeled-field markup, renders 6 editable fields plus an optional AI-note callout, and a Save button calling `saveAssetSpec(symbol)`; delete (✕) button calls `deleteAssetSpec(symbol)`.
- **Calls:** deleteAssetSpec, saveAssetSpec *(both only inside generated onclick strings)*
- **Called by:** renderSettingsPage, deleteAssetSpec
- **Side effects:** DOM mutation (`#assetSpecsList`).
- **Notes:** None.

#### deleteAssetSpec(symbol)
- **File:** Profit_Tracker/index.html (lines 2508-2514)
- **Module:** Settings / Asset Specs
- **Purpose:** Deletes a cached asset spec, allowing it to be re-looked-up by AI on next sync.
- **Parameters:**

| Name | Type | Description |
|---|---|---|
| symbol | string | Instrument symbol |

- **Returns:** `Promise<void>`
- **Internal logic:** `confirm()`s with a note that it'll be re-looked-up automatically. Deletes the `asset_specs` row (scoped by `user_id` + `symbol`). Removes it from `assetSpecsCache`. Re-renders the specs list and the active account (P&L for that symbol reverts to "needs lookup" until next sync).
- **Calls:** renderAssetSpecsList, renderActiveAccount
- **Called by:** renderAssetSpecsList *(via generated onclick string)*
- **Side effects:** Supabase delete (`asset_specs`); DOM re-render; mutates `assetSpecsCache`.
- **Notes:** None.

#### saveAssetSpec(symbol)
- **File:** Profit_Tracker/index.html (lines 2517-2543)
- **Module:** Settings / Asset Specs
- **Purpose:** Persists a manually-edited asset spec card, marking it as a user-confirmed (high confidence) override.
- **Parameters:**

| Name | Type | Description |
|---|---|---|
| symbol | string | Instrument symbol being edited |

- **Returns:** `Promise<void>`
- **Internal logic:** Looks up the card's Save button (⚠️ via a selector `'.spec-card .spec-actions .btn[onclick=...]'` that references a `.spec-actions` class which does **not appear in the actual rendered markup** in `renderAssetSpecsList` — the button lives directly under `.spec-save-row`, not `.spec-actions` — so this `querySelector` likely always returns `null` and the loading-state toggle on the button silently never applies; a cosmetic-only bug, not a functional one, since the save itself proceeds regardless). Uses local `g`/`pf` helpers to read the 6 editable fields, builds a row tagged `source:'user_edit'`, `source_confidence:'high'`, `fetched_at: now`. Upserts to `asset_specs` (`onConflict:'user_id,symbol'`). Merges the result into `assetSpecsCache[symbol]`. Re-renders the active account (P&L recalculates with the new spec).
- **Calls:** g, pf
- **Called by:** renderAssetSpecsList *(via generated onclick string)*
- **Side effects:** Supabase upsert (`asset_specs`); mutates `assetSpecsCache`; DOM re-render (via `renderActiveAccount`).
- **Notes:** See the `.spec-actions` selector-mismatch note above — flagged as a minor, non-blocking cosmetic bug (loading spinner never shows on Save).

#### pf(id)
- **File:** Profit_Tracker/index.html (line 2521, inside `saveAssetSpec`; a second, separately-scoped copy also exists inside `saveProfileEdit` at line 2143 with an identical body)
- **Module:** Utilities (local helper)
- **Purpose:** Reads a form field and parses it as a float, or `null` if empty/invalid.
- **Parameters:**

| Name | Type | Description |
|---|---|---|
| id | string | DOM element id |

- **Returns:** `number|null`
- **Internal logic:** `parseFloat(g(id))`; returns `null` if the result is `NaN`.
- **Calls:** g
- **Called by:** saveProfileEdit (own copy), saveAssetSpec (own copy)
- **Side effects:** None — pure DOM read.
- **Notes:** Duplicated across two closures, same as `g` — see that entry's note.

---

### Bootstrap / entry points (recap)

1. **IIFE `restoreTheme`** (line 2042) — runs first, at parse time, applies any saved theme before anything else happens.
2. **`checkExistingSession()`** (line 2545, the last line of the script) — the actual app bootstrap: restores a logged-in session if one exists and triggers the full `loadAccounts()` chain; otherwise the login screen (already visible by default in the HTML's initial `display` state) is left showing.
3. A third `<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js">` tag loads AFTER the inline script — meaning `Chart` is not guaranteed to be defined the instant the inline script runs, which is exactly why `renderEquityCurve()` explicitly guards with `typeof Chart === 'undefined'` rather than assuming it's ready.


