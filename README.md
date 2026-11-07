# VoidRecll - Dynamic Word Cards

A flashcard app with spaced repetition. It learns 16 words at a time from any word
set, then schedules each word so it comes back just before you would forget it.

> **Working on this project?** [`AGENTS.md`](AGENTS.md) is the handoff document:
> what the project is, where it is deployed, how to deploy it, and the gotchas
> that have bitten before. Read that first.

---

## Quick Start

```bash
./start.sh
```

Or serve the folder with any static server:

```bash
python3 -m http.server 8000
```

Then open **http://localhost:8000**

> The app fetches its word sets over HTTP, so it must be served - opening
> `index.html` directly from the filesystem will not work.

---

## How It Works

1. **Home page** - Shows all available word sets (from `content/manifest.json`)
2. **Pick a set** - Click any card to load that word set
3. **Learn or Review** - Two modes:
   - **Learn** shows words you have never studied, plus any word you marked "Again"
   - **Review** shows the words whose schedule says they are due
4. **Reveal and grade** - Click a card to see the meaning, then grade how well you
   recalled it: **Again**, **Hard**, **Good** or **Easy**
5. **The app reschedules** - Each grade pushes that word's next review further out

### The grading buttons

| Grade | What it means | Next review |
|-------|---------------|-------------|
| **Again** | You forgot it | 10 minutes later, and it stays in the Learn queue until you get it right |
| **Hard** | You got there, but it was a struggle | A small step forward (about 1.2x the current interval), and your ease factor drops |
| **Good** | You recalled it | 1 day, then 3 days, then `interval x ease factor` |
| **Easy** | Instant recall | A large step forward (about `interval x ease factor x 1.3`), and your ease factor rises |

This is an SM-2 style scheduler. Each word keeps its own ease factor (1.3 - 3.0),
which is how the app learns which words need more or less time.

---

## Features

- **Spaced repetition** with per-word scheduling (SM-2 style, ease factor 1.3 - 3.0)
- **Learn / Review modes** so new words and due words never compete
- **Four-way grading** (Again / Hard / Good / Easy), with `1` `2` `3` `4` shortcuts
- **Progress stats**: day streak, reviews today, accuracy, and how the words are
  split between new / learning / familiar / mature
- **Per-word reset** - the `↺` button on a card, or the list inside the stats panel
- **Export / import** your progress as a JSON file, so you can move between devices
- **A Ko-Fi support button** on the home screen, if you want to say thanks
- Keyboard navigation (arrows to move between cards, Enter/Space to reveal, Escape to close)
- Learnt words are tracked per set in the browser and every grade can be undone
- Responsive (4 → 3 → 2 → 1 columns)
- Expandable - add a JSON file plus a manifest entry

---

## Adding New Word Sets

Word sets live in the `content/` folder. Two things are needed for a set to show up:

1. **The data file** - `content/your-new-set.json`
2. **A manifest entry** - add it to `content/manifest.json`

```
content/
├── manifest.json        (the list of available sets)
├── words.json           (mindful words)
├── computer-words.json  (tech terms)
└── your-new-set.json    (your custom words)
```

> The folder is called `content/` rather than `data/` on purpose. On the LXC host
> that serves this app, `data/` is reserved for an app's writable state and is
> excluded when deploying — so a `data/` folder here would be silently dropped.

Each data file is an array of objects:

```json
[
  { "word": "Word", "meaning": "Definition here" },
  { "word": "Another", "meaning": "Another definition" }
]
```

Each manifest entry looks like this:

```json
{
  "sets": [
    {
      "file": "your-new-set.json",
      "displayName": "Your Set Name",
      "description": "Shown on the home screen",
      "icon": "📚"
    }
  ]
}
```

`displayName`, `description` and `icon` are optional - sensible defaults are used
when they are left out. **A JSON file that is not listed in `manifest.json` will
not appear on the home screen.**

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `↑` `↓` `←` `→` | Move between cards |
| `Enter` / `Space` | Reveal the focused card |
| `1` | Grade as **Again** |
| `2` | Grade as **Hard** |
| `3` | Grade as **Good** |
| `4` | Grade as **Easy** |
| `Esc` | Close the open card |

---

## Deploying

The app is a static site with no runtime dependencies. It can be hosted anywhere
that serves static files (GitHub Pages, Netlify, Vercel, Cloudflare Pages).

```bash
npm run build     # writes a clean copy of the site into dist/
```

Deploy the contents of `dist/` - it holds only what the browser needs, without
the tests, tooling or docs. Make sure `index.html` sits at the root of the
deployed site.

> The service worker needs a secure origin, so use **https** (or `localhost`).
> On plain http over a public host the app still works, but it will not go
> offline.

---

## Live Deployment

The app is running on a dedicated LXC container on the LAN:

> **http://192.168.100.198/**

It is LAN-only for now - there is no domain, and no public exposure. The
container follows the house model described in `~/Desktop/Local-LXC-Host.md`:
one app slot (`voidrecll`) behind nginx, with a systemd instance from the
`webapp@.service` template.

Deploy a change with:

```bash
./deploy/deploy-lxc.sh
```

The full runbook, including the gotchas, is in [`deploy/README.md`](deploy/README.md).

> Two things to know about the LAN URL: the service worker needs a secure
> origin, so over plain http the app runs **without** offline support and
> without the install prompt, and the word sets live in `content/` rather than
> `data/` so that the host's deploy tooling cannot silently drop them.

---

## The Support Button

The home screen carries a small **"Support me on Ko-fi"** button that links to the
Ko-fi page for this project. It is a third-party widget, so it is loaded from
Ko-fi's CDN and needs a network connection - offline, the button simply does not
appear.

Two details are worth knowing if you change it:

- **It only appears on the home screen.** The study view is left alone, so the
  button never gets in the way while you are revising. The app adds the widget
  to the home view when that view is shown.
- **The markup comes from `getHTML()`, not `draw()`.** Ko-fi's own `draw()` calls
  `document.writeln()`, and browsers ignore `document.write()` from a script that
  loads after the page has been parsed - which is exactly what happens when the
  widget is added with JavaScript. The app therefore asks the widget for its
  HTML and inserts it into the page itself.

The settings live in one place, at the top of `js/app.js`:

```js
koFi: {
  label: "Support me on Ko-fi",
  color: "#72a4f2",
  code: "R5E3224KOP",            // the part after ko-fi.com/
  scriptUrl: "https://storage.ko-fi.com/cdn/widget/Widget_2.js",
},
```

Change `code` to point the button at a different Ko-fi page, or set `code` to an
empty string to switch the button off entirely.

---

## Development

```bash
npm install       # only needed for the test suites (jsdom)

npm run test:server   # terminal 1 - serves the app on :8477
npm test              # terminal 2 - runs all three check suites
npm run build         # writes the deployable copy into dist/
npm run icons         # regenerates assets/ from tools/make-icons.py
npm run screenshot    # captures the app with a real browser into docs/
```

The check suites live in `tests/`. They boot the **real** app in a DOM harness
and point its `fetch` at a live local server, so they exercise the app itself
rather than a mock of it:

| Suite | Covers |
|-------|--------|
| `tests/p0-regression.test.js` | Every bug fixed in the original pass - the dead keyboard handler, repeated-word refresh, learnt cards left in the DOM, the biased shuffle, invalid ARIA, the answer leaking to screen readers, unguarded storage writes, the toast crash |
| `tests/p1-features.test.js` | The scheduler, Learn/Review modes, the grading bar, Undo, stats and streaks, per-word reset, export/import, and migration of old progress |
| `tests/p2-app-shell.test.js` | Icons, SEO and social tags, the web app manifest, the service worker, dark mode, reduced motion, focus rings, live regions, and the Ko-fi support button |

`tools/screenshot.py` drives Firefox over its built-in Marionette socket to
capture the running app. It waits for the page to settle first, which matters
here: the word sets are fetched asynchronously, so a screenshot taken at the
load event (what Firefox's own `--screenshot` flag does) catches the page
before the cards exist.

```bash
python3 tools/screenshot.py http://localhost:8477/index.html \
    --out docs/screenshot-home.png --delay 4
```

---

## Notes

- Progress is stored in the browser's `localStorage`, so it is per-device and
  per-browser. Clearing site data resets it - use **Export** to back it up.
- Progress from the older version of the app is migrated automatically on first
  load, so you do not lose anything.
- The app is installable as a PWA and keeps working offline once loaded.
- The app follows your system's dark-mode and reduced-motion settings.
