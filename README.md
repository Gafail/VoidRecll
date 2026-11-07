# Mindful Words - Dynamic Word Cards

A flashcard app with spaced repetition. It learns 16 words at a time from any word
set, then schedules each word so it comes back just before you would forget it.

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

1. **Home page** - Shows all available word sets (from `data/manifest.json`)
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
- Keyboard navigation (arrows to move between cards, Enter/Space to reveal, Escape to close)
- Learnt words are tracked per set in the browser and every grade can be undone
- Responsive (4 → 3 → 2 → 1 columns)
- Expandable - add a JSON file plus a manifest entry

---

## Adding New Word Sets

Word sets live in the `data/` folder. Two things are needed for a set to show up:

1. **The data file** - `data/your-new-set.json`
2. **A manifest entry** - add it to `data/manifest.json`

```
data/
├── manifest.json        (the list of available sets)
├── words.json           (mindful words)
├── computer-words.json  (tech terms)
└── your-new-set.json    (your custom words)
```

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

The app is a static site - no build step and no dependencies. It can be hosted
anywhere that serves static files (GitHub Pages, Netlify, Vercel, Cloudflare
Pages). Upload the whole folder and make sure `index.html` sits at the root of
the deployed site.

---

## Notes

- Progress is stored in the browser's `localStorage`, so it is per-device and
  per-browser. Clearing site data resets it - use **Export** to back it up.
- Progress from the older version of the app is migrated automatically on first
  load, so you do not lose anything.
- The app works offline once loaded, but it is not yet installable as a PWA.
