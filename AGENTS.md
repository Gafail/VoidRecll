# VoidRecll — AI Handoff

> A spaced-repetition flashcard app for word sets. Static site, no backend, no
> database — every word's schedule lives in the browser's localStorage.

**Status:** LAN-only, live at **http://192.168.100.198/**
**Repository:** https://github.com/Gafail/VoidRecll
**Brand identity:** *VoidRecll* — calm, unhurried, a little spare. Mint-and-teal
palette on a soft gradient; rounded cards, generous whitespace, no shouty colour.

---

## Start here

This file is the entry point for any new session. Everything you need to pick
the work up is here or in the files it points to.

The project folder may have been renamed to `voidrecll`. **Nothing in the code
depends on the folder's name** — every script resolves paths relative to its own
location, so a moved folder keeps working. If you find a path that breaks, it is
a bug: fix it to be relative.

| Where | What |
|---|---|
| This file | AI handoff — status, architecture, deploy, gotchas |
| [`README.md`](README.md) | For humans: how the app works, how to add word sets, the support button |
| [`REVIEW.md`](REVIEW.md) | The original review, the P0–P2 fixes, and what is still open |
| [`deploy/README.md`](deploy/README.md) | The LXC host in detail: deploy, check, gotchas |

---

## Architecture

- **Frontend:** vanilla HTML / CSS / JavaScript. No framework, no bundler, no
  build step for the app itself — `index.html`, `css/style.css`, `js/app.js`.
- **Backend:** none. The app is a static site; there is no API and no server-side
  logic. `deploy/server.js` is a ~150-line static file server that exists only
  because the LXC host runs every app as a Node process behind nginx.
- **Persistence:** `localStorage` only. Keys are `voidrecll_srs_<setFile>`,
  `voidrecll_learned_<setFile>` and `voidrecll_stats`. A user's progress is
  per-device and per-browser; **Export** writes a JSON backup.
- **Scheduling:** an SM-2 style scheduler. Each word carries an ease factor
  (1.3–3.0), interval, repetitions, lapses and a due timestamp. Grading is
  Again / Hard / Good / Easy.
- **Deploy pipeline:** `npm run build` → `dist/` → tar → `appctl deploy` on the
  LXC box → systemd restarts the service. One command: `./deploy/deploy-lxc.sh`.
- **Tests:** 150 checks across three suites, run against the **real** app in a
  jsdom harness pointed at a live local server — not a mock.

---

## File map

```
index.html              both views: home (#homeView) and study (#gameView)
js/app.js               the entire app: config, scheduler, UI, export/import
css/style.css           all styling, incl. the dark-mode and reduced-motion blocks
sw.js                   service worker (precache + stale-while-revalidate)
manifest.webmanifest    PWA manifest - name, icons, standalone display
content/                the word sets (see the gotcha about `data/` below)
  manifest.json         the list of available sets
  words.json            25 calm, reflective words
  computer-words.json   30 tech terms
  multiplication.json   144 times-table facts
assets/                 favicon.svg, PWA icons (192/512 + maskable), og-image.png
deploy/
  server.js             static file server for the LXC host
  deploy-lxc.sh         one-command deploy to the box
  README.md             the LXC runbook
tools/
  build.js              copies the 16 site files into dist/
  make-icons.py         regenerates assets/ (needs PIL)
  screenshot.py         captures the running app with real Firefox (Marionette)
tests/                  the check suites - see below
docs/                   screenshots used in the README
start.sh                local server launcher for the desktop
```

### The test suites

| File | Covers |
|---|---|
| `tests/p0-regression.test.js` | Every P0 bug fix: keyboard nav, session-aware refresh, DOM removal of learnt cards, Fisher–Yates, ARIA structure, storage guards, the toast crash, README claims |
| `tests/p1-features.test.js` | The scheduler, Learn/Review modes, the grading bar, Undo, stats and streaks, per-word reset, export/import, legacy migration |
| `tests/p2-app-shell.test.js` | Icons, SEO/OG tags, the manifest, the service worker, the build, dark mode, reduced motion, focus rings, live regions, the Ko-fi button |
| `tests/helpers.js` | Shared harness: `boot()`, state readers, interactions |
| `tests/run-all.js` | Runs all three and prints a combined summary |
| `tests/run-server.js` | Static server on :8477 that the suites fetch from |

`tests/helpers.js` boots the real `js/app.js` inside jsdom, strips the
`<script>` tag first so the app is not instantiated twice, and stubs the Ko-fi
CDN so the suite does not depend on a third party being reachable.

---

## How to deploy

**To the LXC box (the live site):**

```bash
./deploy/deploy-lxc.sh
```

That builds, ships, deploys and verifies. By hand:

```bash
npm run build
tar -C dist -czf - . | ssh -i <key> root@192.168.100.198 'tar -xzf - -C /root/staging/voidrecll'
ssh -i <key> root@192.168.100.198 'appctl deploy voidrecll /root/staging/voidrecll'
```

The SSH key lives **outside** this repo at
`~/Desktop/TheVoidCo/ops/keys/thevoidco-lxc-id_ed25519` (mode 0600). The
deploy script finds it there; override with `VOIDRECLL_SSH_KEY=...`.

**To GitHub (the backup):**

```bash
git add -A && git commit -m "..." && git push origin main
```

**Locally:**

```bash
npm install          # only for the test suites (jsdom)
npm run test:server  # terminal 1 - serves on :8477
npm test             # terminal 2 - 150 checks
npm run build
```

---

## How to debug

| Symptom | Where to look |
|---|---|
| Site is blank / no word sets | `content/` missing from `/srv/apps/voidrecll/current` — see the `data/` gotcha below |
| `http://192.168.100.198/` shows the base landing page | nginx `server_name` lost the IP — re-add it (see below) |
| Service will not start | `ssh … 'journalctl -u webapp@voidrecll -f'` and `appctl status voidrecll` |
| 404s on assets | the deploy shipped the source tree instead of `dist/` — deploy `dist/` |
| Service worker not registering | plain http on a LAN IP is not a secure origin; expected, not a bug |
| A word's schedule looks wrong | `CONFIG` at the top of `js/app.js`; the scheduler constants sit just below it |
| Tests fail with a fetch error | the test server on :8477 is not running (`npm run test:server`) |

---

## Known gotchas

- **`content/`, not `data/`.** The word sets live in `content/` on purpose. On
  the LXC host, `data/` means an app's *writable* state and `appctl deploy`
  excludes it — a `data/` folder in the source tree gets silently dropped on
  every deploy, leaving the site with no word sets and no obvious error. Do not
  rename it back.
- **`appctl create` rewrites the nginx block.** It drops two additions that
  must be re-applied afterwards:
  - `server_name voidrecll.local 192.168.100.198;` — without the IP the site
    only answers to the `.local` name and the IP falls through to the base page.
  - `gzip_types ...` — nginx gzips only `text/html` by default.
- **The Ko-fi widget's `draw()` does nothing in a modern browser.** It calls
  `document.writeln()`, and browsers ignore `document.write()` from a script
  that loads after parsing. The app uses the widget's `getHTML()` and inserts
  it itself. The test stub deliberately calls `document.writeln()` too, so the
  suite fails if anyone reverts to `draw()`.
- **jsdom honours `document.writeln()` but real browsers do not.** This bit
  once — jsdom showed a button that would never appear in a browser.
- **Firefox's `--screenshot` captures at the load event**, before the app's
  async fetch has rendered the cards. Use `tools/screenshot.py`, which waits.
- **The service worker needs https.** Over the LAN's plain http the app runs
  without offline support and without the install prompt. Handled in the app.
- **`localStorage` keys were renamed** when the project was renamed. Progress
  saved under the old `mindful_*` keys is not carried over.

---

## Brand identity

- **Name:** VoidRecll (styled exactly so, capital V and R, double-l).
- **Tagline:** *Learn · Review · Remember.*
- **Palette:** soft mint-to-sky gradient background (`#e8f4f0` → `#d4e5ed`),
  teal accent (`#5a9a8a`), ink text (`#2d3e50`), white cards, plus pastel
  per-set accents (pink, peach, mint, lavender, sky, rose). Full set of CSS
  custom properties at the top of `css/style.css`.
- **Tone:** calm and unhurried. No urgency language, no streak shaming. The
  Ko-fi button says "Support me on Ko-fi".
- **Word sets:** "Mindful Words" (calm, reflective vocabulary), "Computer
  Terms", "Multiplication". The first is a *word set* — its name is unrelated to
  the old app name and was deliberately kept.

---

## Live operations state

- **Deployed:** the tree at `/srv/apps/voidrecll/current` is rsynced, not a git
  checkout, so it has no commit of its own. To check it against the repo:

  ```bash
  ssh -i <key> root@192.168.100.198 'cd /srv/apps/voidrecll/current && find . -type f | sort | xargs md5sum' > /tmp/deployed.md5
  (cd dist && find . -type f | sort | xargs md5sum) > /tmp/built.md5
  diff /tmp/deployed.md5 /tmp/built.md5     # no output = the box matches the build
  ```

  Run `npm run build` first, otherwise `dist/` may be stale.
- **Host:** `VoidRecll` at `192.168.100.198`, Proxmox LXC, Ubuntu 26.04 LTS.
- **Service:** `webapp@voidrecll.service`, app slot `voidrecll`, port 8080 on
  `127.0.0.1`, nginx 1.28.3 on port 80 in front.
- **Versions on the box:** Node v24.22.2, nginx 1.28.3.
- **Measured footprint:** ~237 MB idle, ~349 MB peak under a 50-connection
  flood, 4,312 req/s, 0.26 ms CPU per request. The site is 208 KB on disk.
  The app needs well under 1 GB / 1 core; the rest is the base OS.
- **Host reference:** `~/Desktop/Local-LXC-Host.md` (outside this repo) — the
  operational reference for the box, including the `appctl` CLI and the
  systemd template.
- **GitHub:** https://github.com/Gafail/VoidRecll (public, `main`).

---

## Renaming the project folder

The folder was renamed from `Memory Cards Website` to `voidrecll`. Nothing in
the code depends on the folder's name — every script resolves paths relative to
its own location — so a move is safe. It was verified by running the build and
the full check suite from a copy at the new path.

If you move it again:

```bash
mv "/home/gafail/Desktop/Memory Cards Website" ~/Desktop/voidrecll
cd ~/Desktop/voidrecll
git status          # should be clean - git travels with the folder
npm run build       # must still say 17/17 files
npm run test:server # terminal 1
npm test            # terminal 2 - 150 checks
```

The one thing that *does* live outside the repo is the SSH key to the LXC box,
at `~/Desktop/TheVoidCo/ops/keys/thevoidco-lxc-id_ed25519`. The deploy script
looks for it there and can be pointed elsewhere with `VOIDRECLL_SSH_KEY`.

A running AI session is keyed to the folder's path, so it will not survive the
move — start a fresh one in the new folder and it will read this file.

---

## Decisions already made

These were settled deliberately. Do not quietly reverse them.

| Decision | Why |
|---|---|
| The name is **VoidRecll**, with the double-l | Chosen over "VoidRecall" on purpose. It matches the sibling projects' `Void*` naming (`VoidFlippr`, `VoidWalkr`) |
| The word set stays called **"Mindful Words"** | It is one of the three sets the app ships — a themed vocabulary set, not the app's name |
| `localStorage` keys are `voidrecll_*` | Renamed with the project. Progress under the old `mindful_*` keys was deliberately **not** carried over |
| The word sets live in **`content/`** | `data/` collides with the host's convention for writable state and would be silently dropped on deploy |
| The Ko-fi button is **home page only** | It should not follow the user into a study session. It lives inside `#homeView` |
| The widget is built from **`getHTML()`** | `draw()` uses `document.write()`, which browsers ignore for a script loaded after parsing |
| **No CI on GitHub** | Deliberately skipped. GitHub is the backup, not a build server. A workflow file also needs the `workflow` OAuth scope, which this token does not carry |
| **GitHub is the backup, not the host** | The site is served by the LXC box on the LAN. No domain yet, and nothing is exposed publicly |
| The app keeps the house **Node + nginx** model | Measured as heavier than serving the files from nginx directly, but it keeps `appctl status`, `appctl logs` and the landing page working as the host documents |

---

## Still open

Listed as P3 in [`REVIEW.md`](REVIEW.md) and tracked by the test suite as
"still open" gaps:

- Custom set builder in the UI
- Type-the-answer mode for the multiplication set
- Text-to-speech pronunciation
- Browse-all / search / favourites
- A 404 page
