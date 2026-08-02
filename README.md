![Recoil](icons/og-image.png)

# Recoil

Your Whoop history, read properly. Phone-first.

Whoop shows you today. Recoil shows you every day you have ever recorded: what
your numbers actually look like over years, which habits move your recovery,
and every record you have set. You run it yourself, on your own Whoop account,
under your own developer keys. Nothing is sent anywhere except to Whoop.

Reads the Whoop API v2 directly. There is no mock data anywhere in this repo, and
if Whoop refuses a request the app shows what Whoop actually said rather than
inventing numbers.

**Not affiliated with, endorsed by, or connected to Whoop, Inc.** Whoop is their
trademark. This is an independent personal project that reads their public API
with your own credentials.

## Screens

- **Today** — recovery as one number, plus sleep, strain, HRV, resting HR, blood O₂ and respiratory rate, each against your own 30-day normal. Every number opens its own history.
- **Patterns** — does a late night cost you, how much sleep you personally need, which workouts wreck you, and whether your week has a shape. Every finding carries its sample size.
- **Activities** — a year of training as a heat grid, then every sport with its sessions inside it. Any session opens in full: when, how long, strain, calories, heart rate.
- **Records** — bests, worsts and streaks across your whole history. Every one opens the day it happened.
- **Settings** — light or dark, what data is held, rebuild, disconnect, and CSV export.

## Run your own

You need a free Whoop developer account. The whole thing takes about ten
minutes, and it stays yours: your keys, your deployment, your data.

### 1. Get the code

```bash
git clone https://github.com/YOUR-USERNAME/recoil.git
```

There is no `npm install`. No dependencies, no build step.

### 2. Make a Whoop app

1. Go to [developer.whoop.com](https://developer.whoop.com) and sign in with your normal Whoop account.
2. Open the dashboard and create a team if you do not have one. Whoop requires apps to belong to a team.
3. Create a new app. Name it whatever you like.
4. Set the **redirect URI** to `https://your-site.example.com/callback`, swapping in the domain you are going to deploy to. It must match exactly, including `https` and no trailing slash. If you are only running locally, use `http://localhost:8888/callback`.
5. Tick every scope this app reads: `read:recovery`, `read:cycles`, `read:sleep`, `read:workout`, `read:profile`, `read:body_measurement`.
6. **Tick `offline` as well.** Without it Whoop issues no refresh token and your session dies after an hour.
7. Save. Whoop shows you a **client ID** and a **client secret**. The secret is shown once, so copy it now.

New apps are limited to ten members until Whoop approves them by hand. For
running this on your own account that limit is irrelevant.

### 3. Give it the keys

Copy the template and fill in the two values:

```bash
cp .env.example .env
```

`.env` is gitignored. The client secret never reaches the browser, only the
three functions in `netlify/functions/` read it.

### 4. Run it

Locally, with the [Netlify CLI](https://docs.netlify.com/cli/get-started/):

```bash
npx netlify dev
```

That serves the site and the functions together on `http://localhost:8888`, and
picks up `.env` on its own.

To deploy, point Netlify at your fork and set `WHOOP_CLIENT_ID` and
`WHOOP_CLIENT_SECRET` under Site configuration → Environment variables. The
redirect URI is worked out from the deploy, so there is nothing else to
configure. Any host that runs static files plus serverless functions works;
`netlify.toml` is the only hosting-specific file.

Two last things before you share a link: put your real domain into the three
`og:` tags at the top of `index.html`, or link previews render blank, and rerun
`python3 scripts/make-icons.py` if you change the mark or the colour.

## How it behaves

| Concern | Approach |
|---|---|
| Navigation | Real history entries, no visible URL. Browser back, forward and the phone's edge-swipe all move inside the app; the address bar never changes. Going deeper slides in from the right |
| Refresh | Pull down anywhere. The strip says Pull, Release, Checking Whoop, then what it found. There is no spinner in this app |
| Time window | One button on the metric screen. Tapping it walks W → M → 6M → 1Y → All |
| Charts | No container, no tooltips. Drag across a chart to read a day in the line above it; tap one to open that day; pinch to zoom the long ranges |
| Keyboard | `1`–`5` jump between screens, `←`/`→` walk days (or periods on a metric), `Esc` goes back |
| Colour | The brand green is the mark, the wordmark dot and the primary button. Never a chart, never a number. Charts are black, grey and the three status colours |

## How the data works

| Concern | Approach |
|---|---|
| Endpoints | `v2/cycle`, `v2/recovery`, `v2/activity/sleep`, `v2/activity/workout`, joined into one row per day |
| Page size | 25, the Whoop maximum. The browser walks `next_token` until the collection is exhausted |
| Function timeout | `whoop.js` batches pages inside a 6s budget and hands back a resume token, so a full backfill never hits Netlify's 10s ceiling |
| Storage | Raw records cached in `localStorage`. First run pulls everything; later runs ask only for days not already held, with 5 days of overlap so rescored nights get corrected |
| Session | The `offline` scope gets a refresh token, exchanged server-side and rotated on every use |
| Timezones | Dates come from each record's own `timezone_offset`, never the viewer's clock |
| Where it goes | Nowhere. No analytics, no third-party requests, no server of ours. Your records live in your browser and your tokens in your `localStorage` |

## Develop

```bash
npm test
```

83 tests covering the record mapping, the statistics, and the API proxy. No
dependencies, no build step. `index.html` loads ES modules from `src/` directly.

Two generator scripts, both needing Python:

```bash
python3 scripts/make-icons.py
python3 scripts/make-fonts.py
```

The first regenerates every icon and the share image from `brand/mark.svg`. Then
bump the `?v=` on the icon URLs in `index.html` and `site.webmanifest`, or phones
and WhatsApp will keep showing the old one. The second rebuilds the two web
fonts from their upstream sources. Neither output should ever be hand-edited.

They need `pillow` and `fonttools`:

```bash
pip install pillow "fonttools[woff]" brotli
```

## Layout

Root holds only what has to live there. Everything else is in a folder named
after what it is.

```
index.html                shell and every screen's markup
site.webmanifest          home-screen name, colours and icons
netlify.toml              hosting config: headers, redirects, functions
.env.example              the two variables you need, no values

brand/                    source artwork
  mark.svg .ai .eps       the leaping figure

icons/                    everything scripts/make-icons.py generates
  favicon.svg             transparent, dark-mode aware
  favicon-32/512.png      browser and general fallbacks
  apple-touch-icon.png    iOS home screen
  icon-192/512.png        Android and installability
  icon-512-maskable.png   for platforms that crop to a circle
  og-image.png            1200x630 link preview

fonts/                    Inter Tight and JetBrains Mono, with their licences

src/data/                 talks to Whoop and does the maths. Never touches the screen
  normalize.js            API records -> one row per day
  stats.js                baselines, correlations, records, bucketing
  sync.js                 tokens, cache, the paged pull

src/ui/                   everything you can see
  app.js                  Today, the day screens, wiring and boot
  router.js               history without a visible URL
  pull.js                 pull to refresh, in words
  settings.js             theme, the data facts, CSV export
  screens-metric.js       one metric over time, and one metric on one day
  analysis.js             Patterns, Activities, one session, Records
  charts.js               SVG time charts, scrubbing and pinch-zoom
  charts-compare.js       bars, deltas, scatter, ledger
  connect.js              the OAuth flow and its error copy
  metrics.js              what each number is and how it is written
  styles.css              tokens, shell, spacing scale, light and dark
  charts.css              charts and the screens built out of them

netlify/functions/        the back end
  whoop.js                paged v2 proxy
  oauth-exchange.js       code -> token
  oauth-refresh.js        refresh token -> new token
  config.js               hands the client id and redirect URI to the browser

scripts/make-icons.py     regenerates everything in icons/ from brand/mark.svg
scripts/make-fonts.py     rebuilds fonts/ from the upstream Google Fonts sources
tests/                    node --test
docs/                     notes
```

## Licence

Code is [MIT](LICENSE). Do what you like with it.

Two things are not covered by that. The mark in `brand/` is original artwork,
kept for attribution rather than reuse: fork the app, but draw your own logo.
The fonts in `fonts/` are Inter Tight and JetBrains Mono, both SIL Open Font
License 1.1, with their licence texts sitting next to them.
