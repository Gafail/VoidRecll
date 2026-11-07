/**
 * P0 regression suite.
 *
 * Re-verifies every bug fixed in the P0 pass, so a later change cannot
 * silently undo them: the dead keyboard handler, the repeated-word refresh,
 * learnt cards left in the DOM, the biased shuffle, the invalid ARIA, the
 * unrevealed answer leaking to assistive tech, the unguarded storage writes,
 * the toast crash, and the README claims.
 */

const fs = require("fs");
const path = require("path");
const {
  ROOT,
  bug,
  gap,
  wait,
  boot,
  cardWords,
  errText,
} = require("./helpers");

const suite = (async () => {
  const appSrc = fs.readFileSync(path.join(ROOT, "js/app.js"), "utf8");
  const css = fs.readFileSync(path.join(ROOT, "css/style.css"), "utf8");
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");

  // ============ P0-1  KEYBOARD NAVIGATION ============
  bug("P0-1 handleKeyboardNavigation is bound to a keydown listener",
    /addEventListener\(\s*["']keydown["']\s*,\s*handleKeyboardNavigation\s*\)/.test(appSrc),
    "function was defined but never registered");

  const g = await boot("http://localhost:8477/index.html?set=words.json");
  const gdoc = g.document;
  const toggles = Array.from(gdoc.querySelectorAll(".card-toggle"));
  bug("P0-1 game view renders 16 flashcards", cardWords(gdoc).length === 16, `${cardWords(gdoc).length} cards`);

  toggles[0].focus();
  gdoc.dispatchEvent(new g.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
  await wait(120);
  bug("P0-1 ArrowDown moves focus to the next card", gdoc.activeElement === toggles[1],
    `focus landed on: ${gdoc.activeElement?.querySelector?.(".word-text")?.textContent}`);

  gdoc.dispatchEvent(new g.KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }));
  await wait(120);
  bug("P0-1 ArrowUp moves focus to the previous card", gdoc.activeElement === toggles[0],
    `focus landed on: ${gdoc.activeElement?.querySelector?.(".word-text")?.textContent}`);

  gdoc.dispatchEvent(new g.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
  await wait(120);
  bug("P0-1 ArrowRight moves focus forward", gdoc.activeElement === toggles[1]);

  gdoc.dispatchEvent(new g.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }));
  await wait(120);
  bug("P0-1 ArrowLeft moves focus back", gdoc.activeElement === toggles[0]);

  // Enter/Space on a focused button is activated natively by the browser, so
  // the document handler must not also flip the card (that would be a double
  // toggle).
  toggles[2].focus();
  gdoc.dispatchEvent(new g.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  await wait(120);
  bug("P0-1 Enter on a focused card is not double-handled by JS",
    gdoc.querySelectorAll(".card.active").length === 0,
    `active cards after Enter on button: ${gdoc.querySelectorAll(".card.active").length} (native activation handles it)`);

  // simulate the browser: keydown + native click
  toggles[2].dispatchEvent(new g.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  toggles[2].click();
  await wait(120);
  bug("P0-1 Enter on a focused card flips it exactly once",
    gdoc.querySelectorAll(".card.active").length === 1,
    `active cards: ${gdoc.querySelectorAll(".card.active").length}`);

  gdoc.dispatchEvent(new g.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  await wait(120);
  bug("P0-1 Escape closes the open card", gdoc.querySelectorAll(".card.active").length === 0,
    `active cards after Escape: ${gdoc.querySelectorAll(".card.active").length}`);

  // ============ P0-2  SESSION-AWARE REFRESH ============
  const g2 = await boot("http://localhost:8477/index.html?set=words.json");
  const g2doc = g2.document;
  const batches = [cardWords(g2doc)];
  for (let i = 0; i < 5; i++) {
    g2doc.getElementById("refreshBtn").click();
    await wait(600);
    batches.push(cardWords(g2doc));
  }
  let worstConsecutive = 0;
  for (let i = 1; i < batches.length; i++) {
    const ov = batches[i].filter((w) => batches[i - 1].includes(w)).length;
    worstConsecutive = Math.max(worstConsecutive, ov);
  }
  bug("P0-2 refresh never repeats the currently visible batch", worstConsecutive === 0,
    `batch sizes ${batches.map((b) => b.length).join(",")}, max consecutive overlap: ${worstConsecutive}`);

  const g3 = await boot("http://localhost:8477/index.html?set=multiplication.json");
  const g3doc = g3.document;
  const seen = new Set(cardWords(g3doc));
  for (let i = 0; i < 7; i++) {
    g3doc.getElementById("refreshBtn").click();
    await wait(600);
    cardWords(g3doc).forEach((w) => seen.add(w));
  }
  bug("P0-2 unseen words are preferred until the set cycles", seen.size === 128,
    `8 batches x 16 = 128 draws produced ${seen.size} distinct words (144 available)`);

  // ============ P0-3  LEARNT CARD REMOVED FROM DOM ============
  const g4 = await boot("http://localhost:8477/index.html?set=words.json");
  const g4doc = g4.document;
  const before = cardWords(g4doc);
  const victim = before[0];
  const victimCard = Array.from(g4doc.querySelectorAll(".card")).find(
    (c) => c.querySelector(".word-text").textContent === victim
  );
  victimCard.querySelector('.grade-btn[data-grade="good"]').click();
  await wait(500);
  const afterWords = cardWords(g4doc);
  bug("P0-3 learnt card is removed from the DOM", !afterWords.includes(victim) && afterWords.length === 15,
    `DOM holds ${afterWords.length} cards, victim "${victim}" still present: ${afterWords.includes(victim)}`);

  const undoBtn = g4doc.querySelector(".toast-action");
  undoBtn.click();
  await wait(250);
  const restored = cardWords(g4doc);
  bug("P0-3 Undo restores the card at its original position",
    restored.length === 16 && restored[0] === victim,
    `restored ${restored.length} cards, first = "${restored[0]}" (expected "${victim}")`);

  // ============ P0-4  UNBIASED SHUFFLE ============
  bug("P0-4 shuffle uses Fisher-Yates, not sort-with-random",
    !/sort\(\(\)\s*=>\s*Math\.random\(\)\s*-\s*0\.5\)/.test(appSrc),
    "sort(() => Math.random()-0.5) is a known biased shuffle");

  const g5 = await boot("http://localhost:8477/index.html?set=words.json");
  const g5doc = g5.document;
  const counts = {};
  for (let i = 0; i < 60; i++) {
    const first = cardWords(g5doc)[0];
    counts[first] = (counts[first] || 0) + 1;
    g5doc.getElementById("refreshBtn").click();
    await wait(80);
  }
  const maxCount = Math.max(...Object.values(counts));
  bug("P0-4 shuffle distribution is uniform (no bias)", maxCount < 12,
    `over 60 draws the most frequent first word appeared ${maxCount} times across ${Object.keys(counts).length} distinct words`);

  // ============ P0-5  ARIA ============
  const roleButtonsWithNestedButtons = Array.from(gdoc.querySelectorAll('[role="button"]')).filter(
    (el) => el.querySelector("button")
  );
  bug("P0-5 no nested interactive control inside role=button", roleButtonsWithNestedButtons.length === 0,
    `${roleButtonsWithNestedButtons.length} offending elements`);

  const collapsedMeaning = g4doc.querySelector(".meaning-text");
  bug("P0-5 collapsed meaning is hidden from the accessibility tree",
    collapsedMeaning.getAttribute("aria-hidden") === "true",
    `aria-hidden = "${collapsedMeaning.getAttribute("aria-hidden")}"`);

  const firstToggle = g4doc.querySelector(".card-toggle");
  firstToggle.click();
  await wait(120);
  const openMeaning = g4doc.querySelector(".card.active .meaning-text");
  bug("P0-5 revealed meaning is exposed to the accessibility tree",
    openMeaning && openMeaning.getAttribute("aria-hidden") === "false" &&
    firstToggle.getAttribute("aria-expanded") === "true",
    `aria-hidden="${openMeaning?.getAttribute("aria-hidden")}" aria-expanded="${firstToggle.getAttribute("aria-expanded")}"`);

  bug("P0-5 collapsed meaning uses visibility:hidden in CSS",
    /\.meaning-text\s*\{[^}]*visibility:\s*hidden/.test(css),
    "opacity:0 alone leaves the answer in the a11y tree");

  // ============ P0-6  STORAGE GUARDS (behavioural) ============
  const g6 = await boot("http://localhost:8477/index.html?set=words.json");
  const g6doc = g6.document;
  g6.window.localStorage.setItem = () => {
    throw new Error("QuotaExceededError");
  };
  g6doc.querySelector(".card .grade-btn").click();
  await wait(500);
  bug("P0-6 a failing localStorage write does not break the grading flow",
    g6.__errors.length === 0 && g6doc.querySelectorAll(".card").length === 15,
    `errors: ${g6.__errors.length}, cards left: ${g6doc.querySelectorAll(".card").length}`);

  // ============ P0-7  README ============
  bug("P0-7 README no longer says 15 words", !/15 words/.test(readme), "CONFIG.wordCount is 16");
  bug("P0-7 README no longer claims auto-detection",
    !/automatically detect|auto-detect|auto-detects/i.test(readme),
    "sets are manifest-driven; adding a JSON file alone does nothing");
  bug("P0-7 README describes the manifest step",
    /manifest\.json/.test(readme) && /will\s+not\s+appear/i.test(readme),
    "README should tell the reader to add a manifest entry");
  bug("P0-7 README column claim matches the CSS", !/4\s*→\s*2\s*→\s*1/.test(readme),
    "CSS goes 4 -> 3 -> 2 -> 1");
  bug("P0-7 README documents the spaced repetition schedule",
    /spaced repetition/i.test(readme) && /Again/.test(readme) && /Good/.test(readme),
    "README should explain the grading buttons");
  bug("P0-7 README documents export and import",
    /export/i.test(readme) && /import/i.test(readme));
  bug("P0-7 README documents the keyboard shortcuts",
    /keyboard shortcuts/i.test(readme));

  // ============ REGRESSION ============
  const home = await boot("http://localhost:8477/index.html");
  const hdoc = home.document;
  bug("regression: home view still renders 3 set cards", hdoc.querySelectorAll(".set-card").length === 3,
    `rendered ${hdoc.querySelectorAll(".set-card").length}`);
  bug("regression: no uncaught errors on the home view", home.__errors.length === 0, errText(home).slice(0, 200));

  g2doc.querySelector(".card-toggle").click();
  await wait(120);
  bug("regression: clicking a card still reveals its meaning", g2doc.querySelectorAll(".card.active").length === 1,
    `active cards: ${g2doc.querySelectorAll(".card.active").length}`);

  const bad = await boot("http://localhost:8477/index.html?set=../../etc/passwd");
  await wait(700);
  bug("regression: invalid ?set= is still rejected cleanly",
    /Failed to load words/.test(bad.document.getElementById("wordGrid").textContent));

  bug("regression: progress indicator still populated",
    gdoc.getElementById("progressText").textContent !== "0 of 0",
    `progressText = "${gdoc.getElementById("progressText").textContent}"`);

  // clicking a toast must not throw (actionBtn used to be out of scope)
  const g7 = await boot("http://localhost:8477/index.html?set=words.json");
  const g7doc = g7.document;
  g7doc.querySelector('.card .grade-btn[data-grade="good"]').click();
  await wait(250);
  g7doc.querySelector(".toast").click();
  await wait(250);
  bug("regression: dismissing a toast by clicking it throws nothing", g7.__errors.length === 0,
    errText(g7).slice(0, 200));

  // full learning flow, end to end, through to the 'all learned' screen
  const g8 = await boot("http://localhost:8477/index.html?set=words.json");
  const g8doc = g8.document;
  let guard = 0;
  while (!/learned every word/i.test(g8doc.getElementById("wordGrid").textContent) && guard++ < 12) {
    const buttons = Array.from(g8doc.querySelectorAll('.grade-btn[data-grade="good"]'));
    if (!buttons.length) break;
    buttons.forEach((b) => b.click());
    await wait(700);
  }
  bug("regression: learning every word reaches the 'all learned' screen",
    /learned every word/i.test(g8doc.getElementById("wordGrid").textContent),
    `grid text: "${g8doc.getElementById("wordGrid").textContent.trim().slice(0, 70)}"`);
  bug("regression: no uncaught errors during the full learning flow", g8.__errors.length === 0,
    errText(g8).slice(0, 300));

  // ============ TRACKED GAPS ============
  gap("dark mode (prefers-color-scheme)", /prefers-color-scheme/.test(css));
  gap("reduced motion (prefers-reduced-motion)", /prefers-reduced-motion/.test(css));
  gap("favicon / app icon", /favicon|rel="icon"/.test(hdoc.documentElement.innerHTML));
  gap("meta description (SEO)", !!hdoc.querySelector('meta[name="description"]'));
  gap("Open Graph / social share tags", !!hdoc.querySelector('meta[property="og:title"]'));
  gap("theme-color meta", !!hdoc.querySelector('meta[name="theme-color"]'));
  gap("PWA manifest (installable)", !!hdoc.querySelector('link[rel="manifest"]'));
  gap("service worker (offline use)", /serviceWorker/.test(appSrc));
})();

module.exports = suite;
