# Mindful Words — Project Review

**Date:** 2026-11-07
**Scope:** Full source review of `index.html`, `css/style.css`, `js/app.js`, `data/*`, `README.md`, `start.sh`, plus runtime verification in a DOM harness and headless-Firefox screenshots.

**Verdict:** The core idea is solid and the app is deployable as-is — it is a pure static site with no build step. What was missing was (1) a small set of real bugs, (2) the entire *memory* half of a memory-cards app, and (3) app-shell polish that makes a deployed URL feel like a finished product.

> **Status: the P0 and P1 fixes are now applied.** The full check suite is
> **83 checks across two suites, 0 failures** — one suite re-verifies every P0
> fix, the other covers the P1 features (scheduler, modes, grading, stats,
> reset, export/import) plus regression checks. Parts 2's remaining content
> items and Part 3 remain open.

---

## Part 1 — Real bugs ✅ all fixed

| # | Issue | Where | Status |
|---|-------|-------|--------|
| 1 | **Keyboard navigation was dead code.** `handleKeyboardNavigation` was defined but never registered with any `addEventListener`. Arrow keys / Enter / Space did nothing, despite the README advertising the feature. | `js/app.js` | ✅ Fixed — now bound in `init()` |
| 2 | **"New Words" re-showed the same words.** Refresh redrew from the whole unlearned pool with no session memory; a refresh repeated **12 of 16** words from the previous batch. | `js/app.js` | ✅ Fixed — new `pickBatch()` |
| 3 | **Learnt cards stayed in the DOM**, hidden with `display:none`, so `querySelectorAll(".card")` kept counting them and keyboard nav could focus invisible cards. | `js/app.js` | ✅ Fixed — now removed from the DOM |
| 4 | **Biased shuffle** — `sort(() => Math.random() - 0.5)` is not a uniform shuffle. | `js/app.js` | ✅ Fixed — Fisher–Yates |
| 5 | **README contradicted the code** in three places (details below). | `README.md` | ✅ Fixed |
| 6 | **Invalid ARIA + answer leak.** A `role="button"` card contained a real `<button>`. Separately, `.meaning-text` was hidden with `opacity:0`, which leaves it in the accessibility tree — screen readers announced the definition *before* the card was flipped. | `css/style.css`, `js/app.js` | ✅ Fixed — word is now its own button; meaning uses `visibility:hidden` + `aria-hidden` |
| 7 | **`localStorage.setItem` was unguarded.** The write paths threw in private-browsing modes, so "Learnt It" broke. | `js/app.js` | ✅ Fixed — writes are wrapped |
| 8 | **`start.sh` was not executable.** | `start.sh` | ✅ Fixed — `chmod +x` |

### Two extra bugs found while fixing the above

- **`actionBtn` was block-scoped inside `showToast`** (`const` inside an `if` block), so the toast's own click handler threw `ReferenceError: actionBtn is not defined` whenever anyone clicked a toast to dismiss it. Fixed by hoisting the declaration.
- **The grid went blank after learning the last card on screen.** The grid only refilled on a manual "New Words" click. The grid now reloads itself when it empties.

### How the fixes work

- **Keyboard nav** (`handleKeyboardNavigation`) now resolves the focused card from `document.activeElement` rather than the event target, so it behaves the same however the key event is delivered. Arrow keys move between cards, Enter/Space flips the focused card, Escape closes it. Enter/Space on a focused button is deliberately left to the browser's native activation so the card is never double-toggled.
- **Session-aware batching** (`pickBatch`) works in three steps: never repeat the words currently on screen; within those, prefer words not yet seen this session; fall back to the full pool once the whole set has been cycled. With the 25-word set this gives batches of 16 → 9 → 16 → 9 with **zero** overlap between consecutive batches; with the 144-word multiplication set, 8 consecutive batches produced **128 distinct words**.
- **ARIA**: the word is now a real `<button class="card-toggle">` with `aria-expanded`/`aria-controls`, and the meaning is a sibling `<div class="meaning-text">` carrying `aria-hidden`. The card is a plain container, so there are no nested interactive elements. The collapsed meaning is `visibility:hidden` so it is out of the accessibility tree, and `aria-hidden` is kept in sync by JS.

### README corrections applied

- **"15 words" → 16** (matches `CONFIG.wordCount`).
- **"Automatically detect any new JSON files" → removed.** Sets are manifest-driven, so the README now shows the required `data/manifest.json` entry and states plainly that a JSON file not listed there will not appear.
- **"Responsive (4 → 2 → 1 columns)" → "4 → 3 → 2 → 1"** (matches the CSS breakpoints).
- Added a note that the app must be served over HTTP (it fetches its word sets), and a short **Deploying** section.

---

## Part 2 — What was missing to make it a *memory* app ✅ all implemented

This was the biggest gap, and it was a design gap rather than a bug. Before this pass the app had no memory algorithm at all: "Learnt It" dropped a word into a one-way, permanent bin that was only reversible by wiping the entire set ("Unlearn All") or by hitting **Undo within 5 seconds**. A real memory tool needs:

1. **Spaced repetition.** ✅ Now implemented. Each word carries its own schedule — ease factor (1.3 – 3.0), interval, repetitions, lapses and a due timestamp. Grading is Again / Hard / Good / Easy, and words return *before* you would have forgotten them. The scheduler is SM-2 style with a 10-minute relearn step for "Again":
   | Grade | Effect |
   |-------|--------|
   | Again | back in 10 minutes, stays in the Learn queue, ease −0.20, lapse counted |
   | Hard | interval × 1.2 (min 1 day), ease −0.15 |
   | Good | 1 day → 3 days → interval × ease |
   | Easy | max(4 days, interval × ease × 1.3), ease +0.15 |
2. **Two distinct modes.** ✅ **Learn** shows words you have never studied (plus anything you marked "Again"); **Review** shows only the words whose schedule says they are due. The Review tab carries a live due-count badge.
3. **Per-word reset.** ✅ The `↺` button on any scheduled card, plus a per-word list inside the stats panel. "Reset Set" wipes a whole set.
4. **Stats.** ✅ Day streak, reviews today, accuracy, total reviews, and a split of the set into new / learning / familiar / mature — plus the scheduled-word list with each word's next due date.
5. **Export / import progress.** ✅ Export writes a dated JSON file (schedule, learned lists and stats for every set). Import reads that file back and replaces the schedule for the sets it contains.

**Also added:** a per-grade **Undo** that restores both the card and its previous schedule, **keyboard shortcuts** `1`–`4` for grading, a **due badge on the home screen** per set, and **automatic migration** of progress saved by the older version of the app.

### Remaining content-level gaps

- **Custom sets in the UI.** The "expandable — just add JSON files" promise currently means *edit a file and redeploy*. A "New Set" button that stores a set locally and accepts a pasted/dropped JSON file would make the promise true for an end user rather than only for the author.
- **The multiplication set wants its own mode.** `1 × 2` → `2` is a flashcard when it should be a type-the-answer drill with input checking. Also, random sampling of 16 facts out of 144 is pedagogically odd — sequential progression per table (1×1…1×12, then 2×1…) is what people actually want.
- **Audio.** These are vocabulary sets. `SpeechSynthesis` is free and would make "Mindful Words" and "Computer Terms" far more useful.
- **No browse-all / search / favourites.** You can only ever see a random 16.

---

## Part 3 — App-shell gaps for a deployed URL

- **No favicon or app icon** → 404 in the console, generic browser tab.
- **No `<meta name="description">`, no Open Graph tags, no `theme-color`** → link previews on social platforms will be blank, and there is no mobile browser chrome theming.
- **Not installable.** No `manifest.webmanifest` and no service worker → no home-screen install, no offline use. For a flashcard app you want to study on the bus, offline matters.
- **No dark mode** (`prefers-color-scheme`) and **no `prefers-reduced-motion`** fallback, despite the app being animation-heavy.
- **No `:focus-visible` styling** — only `:focus`, which suppresses the native ring on mouse clicks.
- **No 404 page.**
- **Not a git repository.** No version history, no rollback, and no CI-based deploy. This is the highest-leverage "missing piece" for an app you are about to publish and iterate on.
- **Routing uses full page reloads** (`window.location.href = "index.html"`). This breaks if the site is hosted on a sub-path without a trailing slash, and it discards the query string. A hash router or `history.pushState` fixes both.

---

## Part 4 — Recommended order of work

**P0 — before the first deploy ✅ DONE**
1. ✅ Register the keyboard handler.
2. ✅ Make refresh draw from a session queue so batches do not repeat.
3. ✅ Remove learnt cards from the DOM instead of hiding them.
4. ✅ Replace the shuffle with Fisher–Yates.
5. ✅ Fix the ARIA nesting and hide the collapsed meaning from the accessibility tree.
6. ✅ Correct the README (16 words, manifest-driven not auto-detected, 4→3→2→1).
7. ✅ Guard the `localStorage` writes.
8. ✅ `chmod +x start.sh`.

**P1 — what turns it into a memory tool ✅ DONE**
9. ✅ Spaced repetition (SM-2) with Again/Hard/Good/Easy grading.
10. ✅ Separate "Learn" vs "Review" modes.
11. ✅ Per-word reset + stats/streak.
12. ✅ Export/import progress.

**P2 — app shell (next)**
13. `git init` + first commit.
14. Favicon, meta/OG tags, `theme-color`.
15. PWA manifest + service worker for offline.
16. Dark mode, `prefers-reduced-motion`, `:focus-visible`.
17. Render the manifest `description` on the home cards (the data is already there, it is just never shown).

**P3 — content**
18. Custom set builder in the UI.
19. Type-the-answer mode for multiplication.
20. Text-to-speech pronunciation.

---

## Appendix — Verification notes

- **Runtime checks** are run against the real app in a jsdom DOM harness (the app's own `js/app.js` is loaded and executed, with `fetch` pointed at a live local server), not by reading source alone. There are two suites:
  - **P0 regression suite — 35 checks, 0 failures.** Re-verifies every P0 fix (keyboard navigation, session-aware refresh, DOM removal of learnt cards, Fisher–Yates, ARIA structure, the answer-leak fix, guarded storage, the toast crash fix, the README claims) plus end-to-end regressions.
  - **P1 suite — 48 checks, 0 failures.** Covers the scheduler (interval progression, ease-factor floor and ceiling, due timestamps), the two modes and their pools, the grading bar and its keyboard shortcuts, Undo, the stats panel and streak calculation, per-word reset, export and import, and migration of progress from the old app version.
- **Screenshots** in `docs/` were produced by rendering the app's live DOM in headless Firefox.
- **Data integrity:** all three word sets are valid — `words.json` (25 entries), `computer-words.json` (30), `multiplication.json` (144). No missing `word`/`meaning` fields, no duplicate words, no orphaned JSON files outside the manifest.
- **What already works well:** the core flashcard mechanic (click to reveal), the grid layout and pastel accent rotation, the localStorage progress model, the undo toast, the congratulations state, and the error states (a missing manifest renders a clear message rather than a blank page).
