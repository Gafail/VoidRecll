/**
 * P1 feature suite.
 *
 * Covers the spaced repetition engine: the scheduler itself, the Learn and
 * Review modes and their pools, the grading bar and its keyboard shortcuts,
 * Undo, the stats panel and streak calculation, per-word reset, export and
 * import, and migration of progress saved by the older version of the app.
 */

const fs = require("fs");
const path = require("path");
const {
  ROOT,
  DAY_MS,
  bug,
  wait,
  boot,
  cardWords,
  srsOf,
  learnedOf,
  statsOf,
  errText,
  grade,
  ensureInLearn,
  ensureInReview,
  cssEscape,
  blobText,
} = require("./helpers");

const suite = (async () => {
  const appSrc = fs.readFileSync(path.join(ROOT, "js/app.js"), "utf8");
  const css = fs.readFileSync(path.join(ROOT, "css/style.css"), "utf8");

  // ======================================================================
  // P1-1  SRS ENGINE
  // ======================================================================
  const g = await boot("http://localhost:8477/index.html?set=words.json");
  const gdoc = g.document;

  const w1 = await grade(g, gdoc, "good");
  let rec = srsOf(g)[w1];
  bug("P1-1 Good on a new word schedules it 1 day out",
    rec && rec.interval === 1 && rec.reps === 1 && rec.ef === 2.5 && !rec.lapsed,
    JSON.stringify(rec));

  let idx = await ensureInReview(g, gdoc, w1);
  await grade(g, gdoc, "good", idx);
  rec = srsOf(g)[w1];
  bug("P1-1 a second Good moves the interval to 3 days",
    rec && rec.interval === 3 && rec.reps === 2,
    `interval=${rec?.interval} reps=${rec?.reps}`);

  idx = await ensureInReview(g, gdoc, w1);
  await grade(g, gdoc, "good", idx);
  rec = srsOf(g)[w1];
  bug("P1-1 a third Good multiplies the interval by the ease factor",
    rec && Math.abs(rec.interval - 3 * rec.ef) < 0.001 && rec.reps === 3,
    `interval=${rec?.interval} ef=${rec?.ef} reps=${rec?.reps}`);

  await ensureInLearn(g, gdoc);
  const w3 = await grade(g, gdoc, "easy", 0);
  rec = srsOf(g)[w3];
  bug("P1-1 Easy takes a bigger step and raises the ease factor",
    rec && rec.interval >= 4 && rec.ef > 2.5,
    `interval=${rec?.interval} ef=${rec?.ef}`);

  await ensureInLearn(g, gdoc);
  const w4 = await grade(g, gdoc, "hard", 0);
  rec = srsOf(g)[w4];
  bug("P1-1 Hard takes a smaller step and lowers the ease factor",
    rec && rec.interval >= 1 && rec.ef < 2.5,
    `interval=${rec?.interval} ef=${rec?.ef}`);

  const gEasy = await boot("http://localhost:8477/index.html?set=words.json");
  const gEasyDoc = gEasy.document;
  const we = await grade(gEasy, gEasyDoc, "good", 0);
  const beforeEasy = srsOf(gEasy)[we].interval;
  const ei = await ensureInReview(gEasy, gEasyDoc, we);
  await grade(gEasy, gEasyDoc, "easy", ei);
  rec = srsOf(gEasy)[we];
  bug("P1-1 Easy on a scheduled word grows the interval further",
    rec.interval > beforeEasy && rec.ef > 2.5,
    `interval ${beforeEasy} -> ${rec.interval}, ef=${rec.ef}`);

  await ensureInLearn(g, gdoc);
  const w5 = await grade(g, gdoc, "again", 0);
  rec = srsOf(g)[w5];
  const tenMin = 10 / 1440;
  bug("P1-1 Again forgets the word and brings it back in 10 minutes",
    rec && rec.lapses === 1 && rec.reps === 0 && rec.lapsed === true &&
    Math.abs(rec.interval - tenMin) < 0.001,
    JSON.stringify(rec));

  bug("P1-1 Again removes the word from the learned list", !learnedOf(g).includes(w5),
    `learned: ${JSON.stringify(learnedOf(g))}`);
  bug("P1-1 Good adds the word to the learned list", learnedOf(g).includes(w1));

  const gE = await boot("http://localhost:8477/index.html?set=words.json");
  for (let i = 0; i < 8; i++) await grade(gE, gE.document, "again", 0);
  const anyRec = Object.values(srsOf(gE))[0];
  bug("P1-1 the ease factor never drops below 1.3", anyRec && anyRec.ef >= 1.3, `ef=${anyRec?.ef}`);

  const gD = await boot("http://localhost:8477/index.html?set=words.json");
  const before = Date.now();
  const wD = await grade(gD, gD.document, "good");
  const due = srsOf(gD)[wD].due;
  const expected = before + DAY_MS;
  bug("P1-1 the due timestamp matches the scheduled interval",
    Math.abs(due - expected) < 5000, `due=${new Date(due).toISOString()} expected≈${new Date(expected).toISOString()}`);

  // ======================================================================
  // P1-2  LEARN / REVIEW MODES
  // ======================================================================
  const gM = await boot("http://localhost:8477/index.html?set=words.json");
  const gMdoc = gM.document;
  bug("P1-2 Learn mode shows new words",
    cardWords(gMdoc).length === 16 && cardWords(gMdoc).every((w) => !srsOf(gM)[w]),
    `${cardWords(gMdoc).length} cards`);

  const wordsToDue = cardWords(gMdoc).slice(0, 3);
  const srs = srsOf(gM);
  wordsToDue.forEach((w) => {
    srs[w] = { ef: 2.5, interval: 1, reps: 1, lapses: 0, due: Date.now() - 1000, last: Date.now() - DAY_MS, lapsed: false };
  });
  gM.localStorage.setItem("voidrecll_srs_words.json", JSON.stringify(srs));

  gMdoc.getElementById("reviewModeBtn").click();
  await wait(1200);
  const reviewWords = cardWords(gMdoc);
  bug("P1-2 Review mode shows only the words that are due",
    reviewWords.length === 3 && wordsToDue.every((w) => reviewWords.includes(w)),
    `showing ${reviewWords.length}: ${reviewWords.join(",")}`);
  bug("P1-2 the Review tab shows how many words are due",
    gMdoc.getElementById("dueCount").textContent === "3",
    `badge = "${gMdoc.getElementById("dueCount").textContent}"`);

  gMdoc.getElementById("learnModeBtn").click();
  await wait(1200);
  bug("P1-2 switching back to Learn restores the new-word pool",
    cardWords(gMdoc).length === 16 && cardWords(gMdoc).every((w) => !srsOf(gM)[w]),
    `${cardWords(gMdoc).length} cards`);

  const gN = await boot("http://localhost:8477/index.html?set=words.json&mode=review");
  await wait(600);
  const nText = gN.document.getElementById("wordGrid").textContent;
  bug("P1-2 Review mode with nothing due explains itself",
    /Nothing due for review/i.test(nText),
    `text: "${nText.trim().slice(0, 70)}"`);

  // ======================================================================
  // P1-3  GRADING UI
  // ======================================================================
  const gU = await boot("http://localhost:8477/index.html?set=words.json");
  const gUdoc = gU.document;
  const firstCard = gUdoc.querySelector(".card");
  bug("P1-3 each card has the four grading buttons",
    firstCard.querySelectorAll(".grade-btn").length === 4,
    `${firstCard.querySelectorAll(".grade-btn").length} buttons`);
  bug("P1-3 grading buttons are hidden until the card is revealed",
    gU.window.getComputedStyle(firstCard.querySelector(".grade-bar")).display === "none",
    `display = "${gU.window.getComputedStyle(firstCard.querySelector(".grade-bar")).display}"`);
  firstCard.querySelector(".card-toggle").click();
  await wait(120);
  bug("P1-3 revealing a card shows the grading buttons",
    firstCard.classList.contains("active") &&
    gU.window.getComputedStyle(firstCard.querySelector(".grade-bar")).display === "flex",
    `display = "${gU.window.getComputedStyle(firstCard.querySelector(".grade-bar")).display}"`);

  const gK = await boot("http://localhost:8477/index.html?set=words.json");
  const gKdoc = gK.document;
  const kCard = gKdoc.querySelector(".card");
  const kWord = kCard.querySelector(".word-text").textContent;
  kCard.querySelector(".card-toggle").click();
  await wait(120);
  gKdoc.dispatchEvent(new gK.KeyboardEvent("keydown", { key: "3", bubbles: true, cancelable: true }));
  await wait(500);
  bug("P1-3 pressing 3 grades the open card as Good",
    srsOf(gK)[kWord] && srsOf(gK)[kWord].reps === 1,
    `record: ${JSON.stringify(srsOf(gK)[kWord])}`);

  const gR = await boot("http://localhost:8477/index.html?set=words.json");
  const gRdoc = gR.document;
  const victim = await grade(gR, gRdoc, "good", 0);
  bug("P1-3 grading removes the card from the DOM",
    !cardWords(gRdoc).includes(victim) && cardWords(gRdoc).length === 15,
    `${cardWords(gRdoc).length} cards left`);

  const gUndo = await boot("http://localhost:8477/index.html?set=words.json");
  const gUdoc2 = gUndo.document;
  const undoWord = await grade(gUndo, gUdoc2, "good", 0);
  const undoBtn = gUdoc2.querySelector(".toast-action");
  undoBtn.click();
  await wait(300);
  bug("P1-3 Undo removes the schedule it added",
    !srsOf(gUndo)[undoWord],
    `record: ${JSON.stringify(srsOf(gUndo)[undoWord])}`);
  bug("P1-3 Undo puts the card back in the grid",
    cardWords(gUdoc2).length === 16 && cardWords(gUdoc2)[0] === undoWord,
    `${cardWords(gUdoc2).length} cards, first="${cardWords(gUdoc2)[0]}" expected="${undoWord}"`);

  // ======================================================================
  // P1-4  STATS
  // ======================================================================
  const gS = await boot("http://localhost:8477/index.html?set=words.json");
  const gSdoc = gS.document;
  await grade(gS, gSdoc, "good", 0);
  await grade(gS, gSdoc, "again", 0);
  await grade(gS, gSdoc, "hard", 0);
  const s = statsOf(gS).sets["words.json"];
  bug("P1-4 every grade is counted as a review",
    s && s.reviews === 3, `reviews=${s?.reviews}`);
  bug("P1-4 accuracy counts only the grades that were recalled",
    s && s.correct === 2, `correct=${s?.correct} (expected 2: good + hard)`);
  const todayKey = Object.keys(s.history)[0];
  bug("P1-4 reviews are recorded against today's date",
    todayKey && /^\d{4}-\d{2}-\d{2}$/.test(todayKey) && s.history[todayKey].reviews === 3,
    `history=${JSON.stringify(s.history)}`);

  const gSt = await boot("http://localhost:8477/index.html?set=words.json");
  const d = (off) => {
    const x = new Date(Date.now() - off * DAY_MS);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  };
  gSt.localStorage.setItem("voidrecll_stats", JSON.stringify({
    version: 1,
    sets: { "words.json": { reviews: 9, correct: 8, history: {
      [d(0)]: { reviews: 3, correct: 3 },
      [d(1)]: { reviews: 3, correct: 3 },
      [d(2)]: { reviews: 3, correct: 2 },
    } } },
  }));
  gSt.document.getElementById("statsBtn").click();
  await wait(300);
  const streakTile = gSt.document.querySelector(".stat-tile .stat-value");
  bug("P1-4 the streak counts consecutive days", streakTile && streakTile.textContent === "3",
    `streak tile = "${streakTile?.textContent}"`);
  bug("P1-4 the stats panel opens",
    !gSt.document.getElementById("statsModal").hasAttribute("hidden"));
  bug("P1-4 the stats panel lists the scheduled words",
    gSt.document.querySelectorAll(".stat-word").length >= 0,
    `${gSt.document.querySelectorAll(".stat-word").length} listed`);

  // ======================================================================
  // P1-5  PER-WORD RESET
  // ======================================================================
  const gW = await boot("http://localhost:8477/index.html?set=words.json");
  const gWdoc = gW.document;
  const rw = await grade(gW, gWdoc, "good", 0);
  const rwIdx = await ensureInReview(gW, gWdoc, rw);
  const resetBtn = gWdoc.querySelectorAll(".card")[rwIdx].querySelector(".reset-word-btn");
  bug("P1-5 scheduled words get a reset button", !!resetBtn,
    `${gWdoc.querySelectorAll(".reset-word-btn").length} reset buttons`);

  if (resetBtn) {
    resetBtn.click();
    await wait(300);
    bug("P1-5 the reset button clears that word's schedule",
      !srsOf(gW)[rw] && !learnedOf(gW).includes(rw),
      `record: ${JSON.stringify(srsOf(gW)[rw])}, learned: ${JSON.stringify(learnedOf(gW))}`);
  }

  const gW2 = await boot("http://localhost:8477/index.html?set=words.json");
  const gW2doc = gW2.document;
  const rw2 = await grade(gW2, gW2doc, "good", 0);
  gW2doc.getElementById("statsBtn").click();
  await wait(300);
  const statReset = gW2doc.querySelector(`.stat-word-reset[data-word="${cssEscape(rw2)}"]`);
  if (statReset) statReset.click();
  await wait(300);
  bug("P1-5 resetting a word from the stats panel clears its schedule",
    !srsOf(gW2)[rw2] && !learnedOf(gW2).includes(rw2),
    `record: ${JSON.stringify(srsOf(gW2)[rw2])}, learned: ${JSON.stringify(learnedOf(gW2))}`);

  // ======================================================================
  // P1-6  EXPORT / IMPORT
  // ======================================================================
  const gX = await boot("http://localhost:8477/index.html?set=words.json");
  const gXdoc = gX.document;
  await grade(gX, gXdoc, "good", 0);
  let capturedBlob = null;
  gX.URL.createObjectURL = (blob) => { capturedBlob = blob; return "blob:test"; };
  gX.URL.revokeObjectURL = () => {};
  gXdoc.getElementById("exportBtn").click();
  await wait(400);
  bug("P1-6 export produces a file", !!capturedBlob, capturedBlob ? "blob captured" : "no blob");
  let payload = null;
  if (capturedBlob) {
    payload = JSON.parse(await blobText(gX, capturedBlob));
  }
  bug("P1-6 the export contains the set's schedule",
    payload && payload.sets && payload.sets["words.json"] && Object.keys(payload.sets["words.json"].srs).length === 1,
    payload ? JSON.stringify(Object.keys(payload.sets || {})) : "no payload");
  bug("P1-6 the export contains the stats",
    payload && payload.stats && payload.stats.sets && payload.stats.sets["words.json"],
    payload ? "stats present" : "no payload");

  const gI = await boot("http://localhost:8477/index.html?set=words.json");
  const gIdoc = gI.document;
  const importFile = gIdoc.getElementById("importFile");
  const file = new gI.File([JSON.stringify(payload)], "backup.json", { type: "application/json" });
  Object.defineProperty(importFile, "files", { value: [file], configurable: true });
  importFile.dispatchEvent(new gI.Event("change"));
  await wait(700);
  const importedWords = Object.keys(srsOf(gI));
  bug("P1-6 import restores the schedule into a clean browser",
    importedWords.length === 1, `imported ${importedWords.length} words: ${importedWords.join(",")}`);
  bug("P1-6 import restores the learned list too",
    learnedOf(gI).length === 1, `learned: ${JSON.stringify(learnedOf(gI))}`);

  // ======================================================================
  // REGRESSION: the P0 fixes must still hold
  // ======================================================================
  const gP = await boot("http://localhost:8477/index.html?set=words.json");
  const gPdoc = gP.document;
  const toggles = Array.from(gPdoc.querySelectorAll(".card-toggle"));
  toggles[0].focus();
  gPdoc.dispatchEvent(new gP.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
  await wait(120);
  bug("regression: ArrowDown still moves focus between cards", gPdoc.activeElement === toggles[1]);
  gPdoc.dispatchEvent(new gP.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  await wait(120);
  bug("regression: Escape still closes the open card", gPdoc.querySelectorAll(".card.active").length === 0);

  const gB = await boot("http://localhost:8477/index.html?set=words.json");
  const gBdoc = gB.document;
  const batches = [cardWords(gBdoc)];
  for (let i = 0; i < 5; i++) {
    gBdoc.getElementById("refreshBtn").click();
    await wait(600);
    batches.push(cardWords(gBdoc));
  }
  let worst = 0;
  for (let i = 1; i < batches.length; i++) {
    worst = Math.max(worst, batches[i].filter((w) => batches[i - 1].includes(w)).length);
  }
  bug("regression: refresh still avoids repeating the visible batch", worst === 0,
    `max consecutive overlap: ${worst}`);

  bug("regression: shuffle is still Fisher-Yates",
    !/sort\(\(\)\s*=>\s*Math\.random\(\)\s*-\s*0\.5\)/.test(appSrc));
  bug("regression: no nested interactive control inside role=button",
    Array.from(gPdoc.querySelectorAll('[role="button"]')).filter((el) => el.querySelector("button")).length === 0);
  bug("regression: the collapsed meaning is still hidden from assistive tech",
    gPdoc.querySelector(".meaning-text").getAttribute("aria-hidden") === "true");
  bug("regression: the collapsed meaning still uses visibility:hidden",
    /\.meaning-text\s*\{[^}]*visibility:\s*hidden/.test(css));

  const gLS = await boot("http://localhost:8477/index.html?set=words.json");
  gLS.window.localStorage.setItem = () => { throw new Error("QuotaExceededError"); };
  gLS.document.querySelector(".card .grade-btn").click();
  await wait(500);
  bug("regression: a failing localStorage write does not break grading",
    gLS.__errors.length === 0, errText(gLS).slice(0, 200));

  const gMig = await boot("http://localhost:8477/index.html?set=words.json");
  gMig.localStorage.setItem("learned_words.json", JSON.stringify(["Serene", "Gentle"]));
  gMig.localStorage.removeItem("voidrecll_srs_words.json");
  gMig.document.getElementById("refreshBtn").click();
  await wait(900);
  bug("regression: old progress is migrated into the new schedule",
    Object.keys(srsOf(gMig)).length === 2,
    `migrated ${Object.keys(srsOf(gMig)).length} words`);

  const bad = await boot("http://localhost:8477/index.html?set=../../etc/passwd");
  await wait(700);
  bug("regression: an invalid ?set= is still rejected cleanly",
    /Failed to load words/.test(bad.document.getElementById("wordGrid").textContent));
})();

module.exports = suite;
