/**
 * Shared helpers for the Mindful Words check suites.
 *
 * The suites boot the real app (the real js/app.js) inside a DOM harness and
 * point its fetch at a live local server, so the checks exercise the app
 * rather than a mock of it.
 */

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const DAY_MS = 24 * 60 * 60 * 1000;

const results = { bugs: [], gaps: [] };

function bug(name, pass, detail = "") {
  results.bugs.push({ name, pass, detail });
  console.log(`[${pass ? "OK  " : "BUG "}] ${name}${detail ? "  -> " + detail : ""}`);
}

function gap(name, present, detail = "") {
  results.gaps.push({ name, present, detail });
  console.log(`[${present ? "HAVE" : "MISS"}] ${name}${detail ? "  -> " + detail : ""}`);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Boots the app in a DOM harness.
 *
 * The <script> tag is stripped first: jsdom would fetch and execute app.js on
 * its own, and the manual eval below would then create a SECOND instance with
 * its own state. One instance only, like a real browser.
 */
async function boot(url) {
  const html = fs
    .readFileSync(path.join(ROOT, "index.html"), "utf8")
    .replace(/<script[^>]*src=["'][^"']*app\.js["'][^>]*><\/script>/i, "");

  const dom = new JSDOM(html, {
    url,
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
  });

  const w = dom.window;
  w.fetch = (input, init) => fetch(new URL(input, w.location.href).href, init);
  w.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
  w.confirm = () => true;

  // jsdom reports listener exceptions here rather than propagating them.
  w.__errors = [];
  w.addEventListener("error", (e) => w.__errors.push(e.error || e.message));

  w.eval(fs.readFileSync(path.join(ROOT, "js/app.js"), "utf8"));
  await wait(1400);
  return w;
}

// --- app state readers ----------------------------------------------------
const cardWords = (doc) =>
  Array.from(doc.querySelectorAll(".card .word-text")).map((e) => e.textContent);

const srsOf = (w, file = "words.json") =>
  JSON.parse(w.localStorage.getItem(`mindful_srs_${file}`) || "{}");

const learnedOf = (w, file = "words.json") =>
  JSON.parse(w.localStorage.getItem(`mindful_learned_${file}`) || "[]");

const statsOf = (w) => JSON.parse(w.localStorage.getItem("mindful_stats") || "{}");

const errText = (w) => w.__errors.map((e) => (e && e.stack) || String(e)).join("\n");

// --- interactions ---------------------------------------------------------
/** Reveals a card and grades it. Returns the word that was graded. */
async function grade(w, doc, gradeId, cardIndex = 0) {
  const card = doc.querySelectorAll(".card")[cardIndex];
  if (!card) throw new Error(`no card at index ${cardIndex}`);
  const word = card.querySelector(".word-text").textContent;
  card.querySelector(".card-toggle").click();
  await wait(80);
  card.querySelector(`.grade-btn[data-grade="${gradeId}"]`).click();
  await wait(450);
  return word;
}

async function ensureInLearn(w, doc) {
  const isLearn = doc.getElementById("learnModeBtn").classList.contains("mode-btn-active");
  if (!isLearn) {
    doc.getElementById("learnModeBtn").click();
    await wait(1200);
  }
}

/**
 * Puts a word into the review queue and shows it, so the same word can be
 * graded repeatedly (Learn mode only ever shows words that are still new).
 */
async function ensureInReview(w, doc, word) {
  const srs = srsOf(w);
  if (!srs[word]) {
    srs[word] = {
      ef: 2.5,
      interval: 1,
      reps: 0,
      lapses: 0,
      due: Date.now() - 1000,
      last: 0,
      lapsed: false,
    };
  }
  srs[word].due = Date.now() - 1000;
  srs[word].lapsed = false;
  w.localStorage.setItem("mindful_srs_words.json", JSON.stringify(srs));

  const isReview = doc.getElementById("reviewModeBtn").classList.contains("mode-btn-active");
  if (!isReview) {
    doc.getElementById("reviewModeBtn").click();
    await wait(1200);
  } else {
    doc.getElementById("refreshBtn").click();
    await wait(900);
  }
  const idx = cardWords(doc).indexOf(word);
  if (idx < 0) throw new Error(`word "${word}" was not on screen in review mode`);
  return idx;
}

// --- misc -----------------------------------------------------------------
function cssEscape(value) {
  return String(value).replace(/["\\]/g, "\\$&");
}

function blobText(w, blob) {
  return new Promise((resolve, reject) => {
    if (typeof blob.text === "function") {
      blob.text().then(resolve, reject);
      return;
    }
    const reader = new w.FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsText(blob);
  });
}

function readPngSize(file) {
  const buf = fs.readFileSync(file);
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

module.exports = {
  ROOT,
  DAY_MS,
  results,
  bug,
  gap,
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
  readPngSize,
};
