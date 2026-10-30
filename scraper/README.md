# StockPilot market sync

`scraper.py` keeps the Supabase market data fresh. Every run:

1. Fetches **NIFTY 50**, **SENSEX** and **BANK NIFTY** from Yahoo Finance and
   upserts the snapshot into `public.market_indices`.
2. Fetches the live NSE issue list plus each issue's subscription book, then
   **inserts** issues that are missing from `public.ipos` and **updates** the
   rows already there (subscription, dates, status, price band, issue size,
   GMP). NSE blocks most datacenter IPs, so IPOWatch's public pages are read as
   a fallback and as a supplement: they cover BSE SME issues and publish the
   grey-market premium that NSE does not.
3. Fetches a live NSE/BSE price for every distinct `portfolio.symbol` and
   updates `portfolio.current_price` for all holders of that symbol.
4. Calls the `analyze-holding` Edge Function for any holding whose price moved
   by at least `AI_TRIGGER_PCT` since the last sync (or that has never been
   analysed), so Gemini can refresh the verdict.
5. Calls the `analyze-ipo` Edge Function for every IPO it inserted in this run,
   so a fresh issue is graded (1-10 score, APPLY/WATCH/AVOID verdict and a
   one-line underwriting note) seconds after it appears instead of sitting at
   `0.0` / `WATCH`.

It only writes market data. It creates IPO rows that are missing but never
deletes anything, and it never touches users or holdings.

## Before the first run

### 1. Apply the migrations

In the Supabase SQL editor, run these in order if you have not already:

```
supabase/migrations/20261029160000_suspended_access_and_ai_source.sql
supabase/migrations/20261029190000_market_indices.sql
```

The first adds `portfolio.ai_source`; the second creates `market_indices`.

### 2. Redeploy `analyze-holding` and deploy `analyze-ipo`

`analyze-holding` accepts the **service role key** as a system caller (it still
accepts a member's JWT and enforces ownership for those calls). Without this
deploy, step 4 will return `401`. `analyze-ipo` must be deployed as well, or
step 5 logs a `404` and the new issues keep their default score:

```bash
supabase functions deploy analyze-holding
supabase functions deploy analyze-ipo
```

`GEMINI_API_KEY` should already be set under **Edge Functions → Secrets**. When
it is missing, system calls return `skipped` and existing verdicts and IPO
scores are kept. `--skip-ai` turns both AI steps off for a run.

### 3. Environment

Create `scraper/.env` locally (never commit it) or use your host's variables:

```env
SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR-SERVICE-ROLE-KEY

# Optional tuning
AI_TRIGGER_PCT=1.5
AI_MAX_ANALYSES=20
AI_DELAY_SECONDS=1.0
REQUEST_TIMEOUT=20

# Optional GMP feed (see "Grey-market premium" below)
# IPO_GMP_API_URL=
# IPO_GMP_API_KEY=
```

`SUPABASE_SERVICE_ROLE_KEY` bypasses Row Level Security. Treat it like a
database password: host secret only, never a `VITE_` variable, never in Git.

## Run it locally

```bash
cd scraper
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt

python scraper.py --dry-run        # fetch + log, writes nothing, calls no AI
python scraper.py                  # real sync
```

Useful flags: `--dry-run`, `--skip-ai`, `--skip-ipos`, `--skip-indices`,
`--rescore-ipos`, `--verbose`.

`--rescore-ipos` is a one-off backfill for rows that were inserted before
`analyze-ipo` existed: it scores the issues still sitting at `0.0` / `WATCH`,
up to `AI_MAX_ANALYSES` per run, so a populated table catches up without
reinserting anything:

```bash
python scraper.py --rescore-ipos --skip-indices --skip-ipos
```

Expected tail of a healthy run:

```
14:15:02 INFO    NIFTY 50 22,866.20 (+0.74%)
14:15:02 WARNING NSE returned 0 usable issues - using the IPOWatch fallback (10 issues).
14:15:03 INFO    IPOWatch upcoming list: 10 open/upcoming issues (8 SME, 2 mainboard).
14:15:03 INFO    IPOWatch matched GMP for 10/10 issues and subscription for 5/10.
14:15:03 INFO    Inserted IPO Maxwell Engineering (SME, Open, closes 2026-11-03).
14:15:04 INFO    IPO sync via IPOWATCH: 8 inserted, 2 updated, 0 skipped.
14:15:05 INFO    RELIANCE -> ₹1,173.90 (+1.38%) across 2 holding(s)
14:15:06 INFO    AI refresh: 3 of 5 moved 1.50% or more; analysing 3.
14:15:09 INFO    RELIANCE re-analysed: BUY (gemini) after +1.38%
14:15:10 INFO    Done in 8.4s | indices 3 | IPOs 10 written / 0 skipped | portfolio 5 rows, 4 symbols, 0 unquoted | AI 3
```

## Scheduling

### Option A — GitHub Actions (included)

`.github/workflows/market-sync.yml` runs every 15 minutes and can also be
started manually from the **Actions** tab.

1. Push the repository to GitHub.
2. **Settings → Secrets and variables → Actions**:
   - Secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
   - Optional secret: `IPO_GMP_API_KEY`
   - Optional variable: `IPO_GMP_API_URL`
3. Open **Actions → StockPilot market sync → Run workflow** once. Scheduled
   workflows only start on the default branch.
4. Confirm a green run and check `market_indices` / `portfolio.current_price`.

**Cost reality check:** scheduled workflows are free on public repositories.
On a private repository they consume your plan's Actions minutes; the Free plan
includes 2,000 minutes/month, and a 15-minute cadence is 96 runs/day, so a run
longer than roughly 40 seconds exceeds that allowance. GitHub can also delay
scheduled runs at peak times. For a private repo that must run every 15 minutes
24/7, use option B.

### Option B — always-free VM (recommended for a private repo)

Oracle Cloud's Always Free tier gives a permanently free small VM. Install
Python, clone the repo (or copy `scraper/`), create the venv and `scraper/.env`,
then run it from cron:

```cron
*/15 * * * * cd /opt/stockpilot && /usr/bin/flock -n /tmp/stockpilot.lock .venv/bin/python scraper/scraper.py >> /var/log/stockpilot-sync.log 2>&1
```

`flock` prevents a slow run from overlapping the next one. `chmod 600
scraper/.env` so only the service account can read the key.

Other hosts: Railway and Render are usage-based/paid for reliable cron jobs;
PythonAnywhere's free tier only allows one scheduled task per day, so it cannot
meet a 15-minute cadence.

## Grey-market premium (GMP)

NSE, BSE and Yahoo do **not** publish IPO grey-market premium, so the script
reads it from IPOWatch's public GMP page by default:

- IPOWatch GMP is applied to the issues on that page, including NSE-sourced
  rows that NSE itself could not price. `gmp_pct` is always recomputed as
  `gmp / price_band_high * 100`.
- `IPO_GMP_API_URL` is still supported and takes priority over the scrape, for
  teams that pay for a licensed feed. It must return a JSON array (or an object
  with `data`, `ipos`, `results` or `items`) of objects containing a
  company/name or symbol plus a `gmp` field. Common aliases (`companyName`,
  `company_name`, `ipoName`, `gmp`, `gmpValue`, `greyMarketPremium`, `price`,
  `issuePrice`, ...) are recognised.
- If both sources are unavailable, the stored `ipos.gmp` is left untouched.
- GMP is unofficial, unregulated data. Keep a source note in the UI.

To refresh GMP manually, update `ipos.gmp` in SQL and set `gmp_pct` to
`gmp / price_band_high * 100`.

## How the AI refresh decides

For every holding, `change_pct` is the move between the price stored by the
previous run and the new price.

- `|change_pct| >= AI_TRIGGER_PCT` → analyse.
- `last_analyzed_at` is null → analyse once.
- Otherwise the row is left alone, so a quiet market costs zero Gemini calls.

The highest movers are analysed first, capped at `AI_MAX_ANALYSES` per run with
`AI_DELAY_SECONDS` between calls to stay inside Gemini's rate limits. Failed
calls keep the previous verdict (the function never writes a placeholder when
the scraper calls it).

## Data source notes

- **Yahoo Finance** (`query1.finance.yahoo.com/v8/finance/chart`) is unofficial
  and can rate-limit. Symbols are tried as `SYMBOL.NS` then `SYMBOL.BO`; rows
  with no INR quote are skipped and their old price is kept.
- **NSE India** endpoints (`/api/all-upcoming-issues`, `/api/ipo-detail`) need a
  browser-like UA and a primed cookie; the script warms the session first and
  retries on 401/403. Aggressive schedules or shared CI IPs can still be
  blocked — that now triggers the IPOWatch path instead of an empty run.
- **IPOWatch** (`ipowatch.in/upcoming-ipo-list`, `.../ipo-grey-market-premium-latest-ipo-gmp`,
  `.../ipo-subscription-status-today`) is scraped with the standard library's
  `html.parser`; no extra dependency. Column headers are matched by name, so a
  cosmetic redesign keeps working. The page lists one rolling calendar with no
  year, so the scraper assumes the current year and skips windows that have
  already closed (`ipos` history is never rewritten).
- Portfolio symbols are whatever was stored from **Add stock** (the first word
  of the name, upper-cased). A wrong symbol simply stays unquoted; fix the row's
  `symbol` in Supabase to the NSE ticker (`RELIANCE`, `TCS`, ...).
- `market_indices` feeds the dashboard's NIFTY 50 / SENSEX / BANK NIFTY cards
  (React Query, five-minute refresh).

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `Missing required environment variables` | Secret/`.env` not loaded in the runner. |
| `market_indices write failed` | `20261029190000_market_indices.sql` not applied. |
| `AI call ... 401` | `analyze-holding` not redeployed with the service-role path. |
| `IPO AI call ... 404` | `analyze-ipo` is not deployed yet. |
| `IPO AI call ... skipped` | `GEMINI_API_KEY` is not set; the IPO keeps `0.0` / `WATCH`. |
| `AI call ... skipped: GEMINI_API_KEY is not set` | Add the key in Edge Function secrets. |
| `ipos` table stays empty | Check the log for `IPOWatch upcoming list: 0` — the site changed its markup, or the run used `--skip-ipos`. Otherwise the row is being inserted; refresh the table. |
| Most live IPOs missing | NSE's list only covers NSE issues; the IPOWatch supplement fills BSE SME. If `IPOWatch added 0` appears, the site was unreachable from the runner. |
| Duplicate IPO rows | Rows already in the table are matched by normalised company name. Two genuinely different companies with the same normalised name need a manual `company_name` tweak. |
| Empty portfolio sync | No rows, or every `symbol` is blank. |
| 429 from Yahoo | Lower the number of distinct symbols or run less often. |

## Security

- The service role key is read from the environment and is only used over
  HTTPS. It is never logged and never sent to the browser.
- The Edge Function compares the bearer token to its own
  `SUPABASE_SERVICE_ROLE_KEY` in constant time before allowing a system call; a
  normal member token still only reaches their own holdings.
- Rotate the key in Supabase if a runner or `.env` is ever exposed, then update
  the GitHub secret.
