(function () {
  "use strict";

  // ===========================================================================
  // Configuration
  // ===========================================================================
  const CONFIG = {
    wordCount: 16,
    dataFolder: "./data/",
    manifestFile: "manifest.json",
    toastDuration: 5000,
    matureIntervalDays: 21,

    // Ko-Fi support button, shown on the home screen.
    // https://ko-fi.com/button - the code is the part after ko-fi.com/
    koFi: {
      label: "Support me on Ko-fi",
      color: "#72a4f2",
      code: "R5E3224KOP",
      scriptUrl: "https://storage.ko-fi.com/cdn/widget/Widget_2.js",
    },
  };

  const DAY_MS = 24 * 60 * 60 * 1000;
  const AGAIN_DELAY_DAYS = 10 / 1440; // 10 minutes
  const MIN_EASE = 1.3;
  const MAX_EASE = 3.0;

  const GRADES = [
    { id: "again", label: "Again", hint: "Forgot it" },
    { id: "hard", label: "Hard", hint: "Struggled" },
    { id: "good", label: "Good", hint: "Got it" },
    { id: "easy", label: "Easy", hint: "Instant" },
  ];
  const GRADE_BY_KEY = { "1": "again", "2": "hard", "3": "good", "4": "easy" };

  // ===========================================================================
  // Element references
  // ===========================================================================
  let gridElement = null;
  let homeView, gameView, wordSetGrid, setTitle, backBtn, refreshBtn, unlearnBtn;
  let progressText, progressFill, progressBar, toastContainer;
  let learnModeBtn, reviewModeBtn, dueCount, statsBtn, exportBtn, importBtn, importFile;
  let statsModal, statsModalBody, statsModalClose;

  // ===========================================================================
  // State
  // ===========================================================================
  let currentSet = null;
  let currentSetMeta = null;
  let totalWordCount = 0;
  let mode = "learn";

  // Session state. Tracks which words have already been shown so that the
  // refresh button produces a genuinely different batch instead of re-drawing
  // from the same pool.
  let sessionSet = null;
  let sessionSeen = new Set();
  let displayedWords = [];
  let cardIdSeq = 0;
  // Bumped every time the grid is re-rendered, so a pending Undo can tell
  // whether the grid it belonged to still exists.
  let renderGeneration = 0;

  // ===========================================================================
  // Storage helpers
  // ===========================================================================
  function storageGet(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (e) {
      // Private browsing modes and exceeded quotas throw on write.
      console.warn("⚠️ Could not save progress:", e.message);
      return false;
    }
  }

  function storageRemove(key) {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      console.warn("⚠️ Could not clear progress:", e.message);
    }
  }

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed === null || parsed === undefined ? fallback : parsed;
    } catch {
      return fallback;
    }
  }

  const srsKey = (setFile) => `mindful_srs_${setFile}`;
  const learnedKey = (setFile) => `mindful_learned_${setFile}`;
  const legacyLearnedKey = (setFile) => `learned_${setFile}`;
  const STATS_KEY = "mindful_stats";

  // ===========================================================================
  // Learned words (kept for backwards compatibility with older progress data)
  // ===========================================================================
  function getLearnedWords(setFile) {
    return readJson(learnedKey(setFile), []);
  }

  function setLearnedWords(setFile, learned) {
    storageSet(learnedKey(setFile), JSON.stringify(learned));
  }

  // Older versions of the app stored progress under `learned_<setFile>` with
  // no scheduling data. Move it into the new format once, so existing
  // progress is not lost. The legacy key is removed afterwards so that a
  // later "reset set" cannot resurrect it.
  function migrateLegacyProgress(setFile) {
    const legacy = readJson(legacyLearnedKey(setFile), null);
    if (!Array.isArray(legacy) || legacy.length === 0) return;

    const srs = getSrs(setFile);
    let changed = false;

    legacy.forEach((word) => {
      if (!srs[word]) {
        srs[word] = {
          ef: 2.5,
          interval: 1,
          reps: 1,
          lapses: 0,
          due: Date.now(),
          last: Date.now(),
          lapsed: false,
        };
        changed = true;
      }
    });

    if (changed) setSrs(setFile, srs);

    const learned = getLearnedWords(setFile);
    const merged = Array.from(new Set([...learned, ...legacy]));
    if (merged.length !== learned.length) setLearnedWords(setFile, merged);

    storageRemove(legacyLearnedKey(setFile));
  }

  // ===========================================================================
  // Scheduling data (SM-2 style)
  // ===========================================================================
  function getSrs(setFile) {
    const data = readJson(srsKey(setFile), {});
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  }

  function setSrs(setFile, srs) {
    storageSet(srsKey(setFile), JSON.stringify(srs));
  }

  function clampEase(ef) {
    return Math.min(MAX_EASE, Math.max(MIN_EASE, ef));
  }

  /**
   * Applies a grade to a word's schedule and returns the new record.
   *
   * - Again: the word is forgotten. It comes back in 10 minutes and stays in
   *   the learning pool until it is graded Good or Easy.
   * - Hard: a smaller step than Good, and it lowers the ease factor.
   * - Good: the standard SM-2 step (1 day, then 3 days, then interval * ease).
   * - Easy: a larger step and it raises the ease factor.
   */
  function schedule(previous, grade) {
    const now = Date.now();
    const rec = {
      ef: 2.5,
      interval: 0,
      reps: 0,
      lapses: 0,
      due: 0,
      last: 0,
      lapsed: false,
      ...(previous || {}),
    };

    if (grade === "again") {
      rec.lapses += 1;
      rec.reps = 0;
      rec.ef = clampEase(rec.ef - 0.2);
      rec.interval = AGAIN_DELAY_DAYS;
      rec.lapsed = true;
    } else if (grade === "hard") {
      rec.reps += 1;
      rec.ef = clampEase(rec.ef - 0.15);
      rec.interval = Math.max(1, rec.interval * 1.2);
      rec.lapsed = false;
    } else if (grade === "good") {
      rec.reps += 1;
      rec.interval = rec.reps === 1 ? 1 : rec.reps === 2 ? 3 : rec.interval * rec.ef;
      rec.lapsed = false;
    } else {
      // easy
      rec.reps += 1;
      rec.ef = clampEase(rec.ef + 0.15);
      rec.interval = Math.max(4, rec.interval * rec.ef * 1.3);
      rec.lapsed = false;
    }

    rec.last = now;
    rec.due = now + rec.interval * DAY_MS;
    return rec;
  }

  function formatInterval(days) {
    if (days < 1) {
      const minutes = Math.max(1, Math.round(days * 1440));
      return minutes <= 1 ? "in a moment" : `in ${minutes} min`;
    }
    if (days < 2) return "in 1 day";
    if (days < 30) return `in ${Math.round(days)} days`;
    if (days < 365) return `in ${(days / 30).toFixed(1)} months`;
    return `in ${(days / 365).toFixed(1)} years`;
  }

  // ===========================================================================
  // Stats
  // ===========================================================================
  function dayKey(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function dayStart(key) {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d).getTime();
  }

  function getStats() {
    const stats = readJson(STATS_KEY, null);
    if (!stats || typeof stats !== "object") {
      return { version: 1, sets: {} };
    }
    if (!stats.sets || typeof stats.sets !== "object") stats.sets = {};
    return stats;
  }

  function setStats(stats) {
    storageSet(STATS_KEY, JSON.stringify(stats));
  }

  function getSetStats(setFile) {
    const stats = getStats();
    if (!stats.sets[setFile]) {
      stats.sets[setFile] = { reviews: 0, correct: 0, history: {} };
    }
    const s = stats.sets[setFile];
    if (!s.history || typeof s.history !== "object") s.history = {};
    return s;
  }

  function recordReview(setFile, grade) {
    const stats = getStats();
    if (!stats.sets[setFile]) {
      stats.sets[setFile] = { reviews: 0, correct: 0, history: {} };
    }
    const s = stats.sets[setFile];
    if (!s.history || typeof s.history !== "object") s.history = {};

    const today = dayKey(Date.now());
    if (!s.history[today]) s.history[today] = { reviews: 0, correct: 0 };

    s.reviews += 1;
    s.history[today].reviews += 1;

    if (grade !== "again") {
      s.correct += 1;
      s.history[today].correct += 1;
    }

    setStats(stats);
  }

  function computeStreak(history) {
    if (!history) return 0;
    const days = Object.keys(history)
      .filter((d) => history[d] && history[d].reviews > 0)
      .sort()
      .reverse();
    if (days.length === 0) return 0;

    const today = dayKey(Date.now());
    const yesterday = dayKey(Date.now() - DAY_MS);

    let cursor = days.includes(today) ? today : days.includes(yesterday) ? yesterday : null;
    if (!cursor) return 0;

    let streak = 0;
    while (days.includes(cursor)) {
      streak += 1;
      cursor = dayKey(dayStart(cursor) - DAY_MS);
    }
    return streak;
  }

  // ===========================================================================
  // Pools
  // ===========================================================================
  function isDue(rec, now) {
    return !!rec && rec.due <= now;
  }

  /**
   * Builds the pool of words for the active mode.
   *
   * - Learn: words never studied, plus words that were graded "Again" and so
   *   still need to be learned.
   * - Review: words that have a schedule and are due now.
   */
  function buildPool(allWords, setFile, activeMode) {
    const srs = getSrs(setFile);
    const now = Date.now();

    if (activeMode === "review") {
      return allWords.filter((w) => isDue(srs[w.word], now));
    }
    return allWords.filter((w) => !srs[w.word] || srs[w.word].lapsed);
  }

  function countDue(setFile, allWords) {
    const srs = getSrs(setFile);
    const now = Date.now();
    return allWords.filter((w) => isDue(srs[w.word], now)).length;
  }

  function countNew(setFile, allWords) {
    const srs = getSrs(setFile);
    return allWords.filter((w) => !srs[w.word] || srs[w.word].lapsed).length;
  }

  // ===========================================================================
  // Progress
  // ===========================================================================
  function updateProgress() {
    if (!currentSet) return;
    const learned = getLearnedWords(currentSet).length;
    const total = totalWordCount;
    const percent = total > 0 ? (learned / total) * 100 : 0;
    if (progressText) progressText.textContent = `${learned} of ${total} learned`;
    if (progressFill) progressFill.style.width = `${percent}%`;
    if (progressBar) progressBar.setAttribute("aria-valuenow", String(Math.round(percent)));
    updateDueCount();
  }

  function updateDueCount() {
    if (!dueCount || !currentSet || !currentSetMeta) return;
    const due = countDue(currentSet, currentSetMeta.words || []);
    dueCount.textContent = String(due);
    dueCount.classList.toggle("due-badge-active", due > 0);
  }

  // ===========================================================================
  // Toasts
  // ===========================================================================
  function showToast(message, actionLabel, onAction, tone) {
    if (!toastContainer) return;
    const toast = document.createElement("div");
    toast.className = `toast toast-success${tone ? ` toast-${tone}` : ""}`;

    const msg = document.createElement("span");
    msg.className = "toast-message";
    msg.textContent = message;

    toast.appendChild(msg);

    // Declared out here so the click handler below can compare against it -
    // inside the block it would be out of scope and throw.
    let actionBtn = null;

    if (actionLabel && onAction) {
      actionBtn = document.createElement("button");
      actionBtn.className = "toast-action";
      actionBtn.textContent = actionLabel;
      actionBtn.addEventListener("click", () => {
        onAction();
        hideToast(toast);
      });
      toast.appendChild(actionBtn);
    }

    toastContainer.appendChild(toast);

    const hideTimeout = setTimeout(() => hideToast(toast), CONFIG.toastDuration);

    toast.addEventListener("click", (e) => {
      if (actionBtn && e.target === actionBtn) return;
      clearTimeout(hideTimeout);
      hideToast(toast);
    });
  }

  function hideToast(toast) {
    if (!toast || !toast.parentNode) return;
    toast.classList.add("toast-hiding");
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 300);
  }

  // ===========================================================================
  // Init
  // ===========================================================================
  function init() {
    console.log("🎨 Mindful Words initializing...");

    homeView = document.getElementById("homeView");
    gameView = document.getElementById("gameView");
    wordSetGrid = document.getElementById("wordSetGrid");
    setTitle = document.getElementById("setTitle");
    backBtn = document.getElementById("backBtn");
    refreshBtn = document.getElementById("refreshBtn");
    unlearnBtn = document.getElementById("unlearnBtn");
    progressText = document.getElementById("progressText");
    progressFill = document.getElementById("progressFill");
    progressBar = document.querySelector(".progress-bar");
    toastContainer = document.getElementById("toastContainer");
    gridElement = document.getElementById("wordGrid");
    learnModeBtn = document.getElementById("learnModeBtn");
    reviewModeBtn = document.getElementById("reviewModeBtn");
    dueCount = document.getElementById("dueCount");
    statsBtn = document.getElementById("statsBtn");
    exportBtn = document.getElementById("exportBtn");
    importBtn = document.getElementById("importBtn");
    importFile = document.getElementById("importFile");
    statsModal = document.getElementById("statsModal");
    statsModalBody = document.getElementById("statsModalBody");
    statsModalClose = document.getElementById("statsModalClose");

    const urlParams = new URLSearchParams(window.location.search);
    const setParam = urlParams.get("set");
    const modeParam = urlParams.get("mode");
    if (modeParam === "review" || modeParam === "learn") mode = modeParam;

    if (setParam) {
      currentSet = setParam;
      migrateLegacyProgress(setParam);
      showGameView();
      applyMode(mode);
      loadWords(setParam);
    } else {
      showHomeView();
    }

    backBtn.addEventListener("click", () => {
      window.location.href = "index.html";
    });

    refreshBtn.addEventListener("click", () => {
      if (currentSet) {
        loadWords(currentSet);
      }
    });

    unlearnBtn.addEventListener("click", () => {
      if (!currentSet) return;
      const ok = confirm(
        "Reset all progress for this set?\n\nThis clears the schedule for every word and starts you from scratch."
      );
      if (!ok) return;
      resetSet(currentSet);
      loadWords(currentSet, { resetSession: true });
      showToast("🔄 Progress reset for this set", null, null);
    });

    learnModeBtn.addEventListener("click", () => switchMode("learn"));
    reviewModeBtn.addEventListener("click", () => switchMode("review"));

    statsBtn.addEventListener("click", () => openStats());
    statsModalClose.addEventListener("click", () => closeStats());
    statsModal.addEventListener("click", (e) => {
      if (e.target === statsModal) closeStats();
    });

    exportBtn.addEventListener("click", () => exportProgress());
    importBtn.addEventListener("click", () => importFile.click());
    importFile.addEventListener("change", (e) => handleImportFile(e));

    window.addEventListener("resize", () => {
      closeAllCards();
    });

    // Arrow keys move between cards, Enter/Space flips the focused card,
    // Escape closes the open card, 1-4 grade a revealed card.
    document.addEventListener("keydown", handleKeyboardNavigation);

    registerServiceWorker();
  }

  // Registers the service worker that makes the app work offline. Only
  // allowed on secure origins (https) and localhost.
  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;

    const host = window.location.hostname;
    const secure =
      window.location.protocol === "https:" || host === "localhost" || host === "127.0.0.1";
    if (!secure) return;

    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch((err) => {
        console.warn("⚠️ Service worker registration failed:", err.message);
      });
    });
  }

  // ===========================================================================
  // Views
  // ===========================================================================
  async function showHomeView() {
    homeView.style.display = "block";
    gameView.style.display = "none";
    loadKoFiWidget();
    await loadWordSets();
  }

  // ===========================================================================
  // Ko-Fi support widget
  //
  // Loaded on the home screen only, so it does not get in the way while
  // studying. The widget script comes from Ko-Fi's CDN, so it needs a network
  // connection - offline, the button simply does not appear.
  //
  // The widget's own draw() calls document.writeln(). Browsers ignore
  // document.write() from a script that loads after the page has finished
  // parsing, which is exactly what happens here, so the markup is taken from
  // the widget's getHTML() and inserted into the DOM instead.
  // ===========================================================================
  function loadKoFiWidget() {
    const { label, color, code, scriptUrl } = CONFIG.koFi;
    if (!code || !scriptUrl) return;
    // the widget is only ever added once, however the home view is reached
    if (document.getElementById("kofiWidget")) return;
    if (document.querySelector(`script[src="${scriptUrl}"]`)) return;

    const script = document.createElement("script");
    script.type = "text/javascript";
    script.src = scriptUrl;
    script.async = true;

    script.addEventListener("load", () => {
      const widget = window.kofiwidget2;
      if (!widget || typeof widget.getHTML !== "function") {
        console.warn("⚠️ The Ko-Fi widget loaded but did not initialise.");
        return;
      }

      widget.init(label, color, code);

      const holder = document.createElement("div");
      holder.id = "kofiWidget";
      holder.className = "kofi-holder";
      holder.innerHTML = widget.getHTML();
      homeView.appendChild(holder);
    });

    script.addEventListener("error", () => {
      console.warn("⚠️ The Ko-Fi widget could not be loaded.");
    });

    document.head.appendChild(script);
  }

  function showGameView() {
    homeView.style.display = "none";
    gameView.style.display = "block";
  }

  function applyMode(activeMode) {
    mode = activeMode;
    const isLearn = mode === "learn";
    if (learnModeBtn) {
      learnModeBtn.classList.toggle("mode-btn-active", isLearn);
      learnModeBtn.setAttribute("aria-selected", isLearn ? "true" : "false");
    }
    if (reviewModeBtn) {
      reviewModeBtn.classList.toggle("mode-btn-active", !isLearn);
      reviewModeBtn.setAttribute("aria-selected", !isLearn ? "true" : "false");
    }
    if (refreshBtn) {
      refreshBtn.textContent = isLearn ? "🔄 More Words" : "🔄 More Due";
    }
  }

  function switchMode(nextMode) {
    if (nextMode === mode) return;
    applyMode(nextMode);

    // Switching mode means a different pool, so start the session over.
    sessionSeen = new Set();
    displayedWords = [];

    // Keep the mode in the URL so it can be shared or bookmarked.
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("mode", mode);
      window.history.replaceState({}, "", url);
    } catch (e) {
      // Some sandboxed/file contexts refuse history writes; the mode still
      // works in the session, it just will not be in the URL.
      console.warn("⚠️ Could not update the URL:", e.message);
    }

    if (currentSet) loadWords(currentSet, { resetSession: true });
  }

  // ===========================================================================
  // Home screen
  // ===========================================================================
  async function loadWordSets() {
    console.log("📂 Loading word sets from manifest...");

    try {
      const response = await fetch(CONFIG.dataFolder + CONFIG.manifestFile);
      if (!response.ok) {
        throw new Error("Could not load manifest");
      }
      const manifest = await response.json();
      const sets = manifest.sets || [];

      const validSets = [];
      for (const setMeta of sets) {
        try {
          const res = await fetch(CONFIG.dataFolder + setMeta.file);
          if (res.ok) {
            const words = await res.json();
            if (Array.isArray(words) && words.length > 0) {
              validSets.push({
                file: setMeta.file,
                displayName: setMeta.displayName || formatSetName(setMeta.file),
                description: setMeta.description || "",
                icon: setMeta.icon || "📚",
                words,
                wordCount: words.length,
              });
            }
          }
        } catch (e) {
          console.log(`Skipping ${setMeta.file}: ${e.message}`);
        }
      }

      console.log(`✅ Found ${validSets.length} word set(s)`);
      renderWordSets(validSets);

    } catch (error) {
      console.error("❌ Failed to load manifest:", error);
      wordSetGrid.innerHTML = `
        <div class="error-card" style="grid-column: 1/-1; text-align: center; padding: 40px;">
          <p class="error">Could not load word sets. Make sure manifest.json exists in the data folder.</p>
        </div>`;
    }
  }

  function renderWordSets(sets) {
    wordSetGrid.innerHTML = "";

    sets.forEach((set) => {
      const card = document.createElement("div");
      card.className = "set-card";

      const learned = getLearnedWords(set.file).length;
      const progress = set.wordCount > 0 ? Math.round((learned / set.wordCount) * 100) : 0;
      const due = countDue(set.file, set.words);
      const fresh = countNew(set.file, set.words);

      const details = [];
      details.push(`${set.wordCount} words`);
      if (learned > 0) details.push(`${progress}% done`);
      if (due > 0) details.push(`${due} due`);

      card.innerHTML = `
        <div class="set-icon">${set.icon}</div>
        <div class="set-name">${escapeHtml(set.displayName)}</div>
        ${set.description ? `<div class="set-desc">${escapeHtml(set.description)}</div>` : ""}
        <div class="set-count">${details.join(" · ")}</div>
        ${due > 0 ? `<div class="set-badge">${due} due</div>` : ""}
        ${due === 0 && fresh === 0 ? `<div class="set-badge set-badge-done">All learned</div>` : ""}
      `;

      card.addEventListener("click", () => {
        window.location.href = `index.html?set=${encodeURIComponent(set.file)}`;
      });

      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          card.click();
        }
      });
      card.setAttribute("tabindex", "0");
      card.setAttribute("role", "button");

      wordSetGrid.appendChild(card);
    });
  }

  function formatSetName(filename) {
    return filename
      .replace(".json", "")
      .replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  // ===========================================================================
  // Loading words
  // ===========================================================================
  async function loadWords(setFile, options = {}) {
    console.log(`📂 Loading words from: ${setFile}`);

    const opts = options || {};
    if (opts.resetSession || sessionSet !== setFile) {
      sessionSet = setFile;
      sessionSeen = new Set();
      displayedWords = [];
    }

    migrateLegacyProgress(setFile);

    try {
      const manifestRes = await fetch(CONFIG.dataFolder + CONFIG.manifestFile);
      if (manifestRes.ok) {
        const manifest = await manifestRes.json();
        currentSetMeta = (manifest.sets || []).find((s) => s.file === setFile);
      }
    } catch {
      currentSetMeta = null;
    }

    setTitle.textContent = currentSetMeta?.displayName || formatSetName(setFile);

    try {
      const response = await fetch(CONFIG.dataFolder + setFile);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const allWords = await response.json();

      if (!Array.isArray(allWords) || allWords.length === 0) {
        throw new Error("No words found in file");
      }

      totalWordCount = allWords.length;
      if (currentSetMeta) currentSetMeta.words = allWords;

      const pool = buildPool(allWords, setFile, mode);

      updateProgress();

      if (pool.length === 0) {
        displayedWords = [];
        renderGeneration++;
        gridElement.innerHTML = renderEmptyState(allWords, setFile);
        bindEmptyState(setFile);
        return;
      }

      const randomWords = pickBatch(pool, CONFIG.wordCount);
      displayedWords = randomWords.map((w) => w.word);

      console.log(`✅ Loaded ${randomWords.length} ${mode} words`);

      gridElement.innerHTML = "";
      renderGeneration++;
      createCards(randomWords);

    } catch (error) {
      console.error("❌ Failed to load words:", error);
      renderGeneration++;
      gridElement.innerHTML = `
        <div class="card error-card" style="grid-column: 1/-1;">
          <div class="word-text">⚠️</div>
          <div class="meaning-text" style="opacity:1; visibility:visible; max-height:none; transform:none;">
            <strong>Failed to load words</strong><br>
            ${escapeHtml(error.message)}<br><br>
            <a href="index.html" style="color: #666;">← Go back to home</a>
          </div>
        </div>
      `;
    }
  }

  function renderEmptyState(allWords, setFile) {
    const due = countDue(setFile, allWords);
    const fresh = countNew(setFile, allWords);
    const srs = getSrs(setFile);

    let nextDue = Infinity;
    Object.values(srs).forEach((rec) => {
      if (rec && rec.due > Date.now() && rec.due < nextDue) nextDue = rec.due;
    });

    if (mode === "learn") {
      if (fresh === 0) {
        return `
          <div class="card empty-card" style="grid-column: 1/-1;">
            <div class="word-text">🎓</div>
            <div class="meaning-text" style="opacity:1; visibility:visible; max-height:none; transform:none;">
              <strong>You've learned every word in this set</strong><br><br>
              ${
                due > 0
                  ? `${due} word${due === 1 ? " is" : "s are"} due for review right now.`
                  : "Nothing is due for review yet - come back when the schedule says so."
              }
              <br><br>
              <button id="emptyAction" class="learnt-btn" style="display:inline-block; margin-top: 12px;">
                ${due > 0 ? "Review due words" : "Show all words"}
              </button>
            </div>
          </div>`;
      }
      return `
        <div class="card empty-card" style="grid-column: 1/-1;">
          <div class="word-text">✨</div>
          <div class="meaning-text" style="opacity:1; visibility:visible; max-height:none; transform:none;">
            <strong>No new words right now</strong><br><br>
            Switch to Review to practise what is due.
            <br><br>
            <button id="emptyAction" class="learnt-btn" style="display:inline-block; margin-top: 12px;">Go to Review</button>
          </div>
        </div>`;
    }

    // review mode, nothing due
    const when = Number.isFinite(nextDue)
      ? `The next word is due ${formatInterval((nextDue - Date.now()) / DAY_MS)}.`
      : "";

    return `
      <div class="card empty-card" style="grid-column: 1/-1;">
        <div class="word-text">☕</div>
        <div class="meaning-text" style="opacity:1; visibility:visible; max-height:none; transform:none;">
          <strong>Nothing due for review</strong><br><br>
          ${when}
          <br><br>
          <button id="emptyAction" class="learnt-btn" style="display:inline-block; margin-top: 12px;">Learn new words</button>
        </div>
      </div>`;
  }

  function bindEmptyState(setFile) {
    const action = document.getElementById("emptyAction");
    if (!action) return;

    action.addEventListener("click", () => {
      const due = countDue(setFile, currentSetMeta?.words || []);
      const target = mode === "learn" ? (due > 0 ? "review" : "learn") : "learn";
      if (mode === "learn" && due === 0) {
        // Nothing due and nothing new: show every word that has a schedule.
        const srs = getSrs(setFile);
        const all = (currentSetMeta?.words || []).filter((w) => srs[w.word]);
        gridElement.innerHTML = "";
        renderGeneration++;
        displayedWords = [];
        createCards(all.slice(0, CONFIG.wordCount));
        return;
      }
      switchMode(target);
    });
  }

  /**
   * Picks the batch of words to show in the grid.
   *
   * 1. Never repeats the words that are currently on screen.
   * 2. Within those, prefers words not yet seen this session.
   * 3. Falls back to the full pool once the whole set has been cycled through.
   */
  function pickBatch(pool, count) {
    const onScreen = new Set(displayedWords);
    let candidates = pool.filter((w) => !onScreen.has(w.word));
    if (candidates.length === 0) {
      candidates = pool.slice();
    }

    let fresh = candidates.filter((w) => !sessionSeen.has(w.word));
    if (fresh.length === 0) {
      fresh = candidates;
    }

    const batch = getRandomWords(fresh, count);
    batch.forEach((w) => sessionSeen.add(w.word));
    return batch;
  }

  // Fisher-Yates: a uniform shuffle. (Array#sort with a random comparator is not.)
  function getRandomWords(words, count) {
    const shuffled = [...words];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled.slice(0, Math.min(count, words.length));
  }

  // ===========================================================================
  // Cards
  // ===========================================================================
  function createCards(words) {
    const accentColors = [
      "#b8d4c8", "#c4b8d9", "#a8c5d4", "#d4a5a5",
      "#f0c9a6", "#e8a5a5", "#c4b8d9", "#a8c5d4",
    ];

    console.log(`🎴 Creating ${words.length} flashcard(s)...`);

    words.forEach((wordData, index) => {
      const card = document.createElement("div");
      card.className = "card";

      const accentColor = accentColors[index % accentColors.length];
      const meaningId = `meaning-${++cardIdSeq}`;
      const srs = getSrs(currentSet);
      const record = srs[wordData.word];
      const isScheduled = !!record;

      // The word is its own button so that the reveal control and the
      // grading controls are siblings rather than nested interactive
      // elements. The meaning starts aria-hidden so screen readers don't
      // announce the answer before the card is flipped.
      const gradeButtons = GRADES.map(
        (g) => `<button type="button" class="grade-btn grade-${g.id}" data-grade="${g.id}" title="${escapeHtml(g.hint)}">${g.label}</button>`
      ).join("");

      card.innerHTML = `
        <button type="button" class="card-toggle" aria-expanded="false" aria-controls="${meaningId}">
          <span class="word-text">${escapeHtml(wordData.word)}</span>
        </button>
        <div class="meaning-text" id="${meaningId}" aria-hidden="true">${escapeHtml(wordData.meaning)}</div>
        <div class="grade-bar" role="group" aria-label="Grade this card">
          ${gradeButtons}
        </div>
        ${
          isScheduled
            ? `<button type="button" class="reset-word-btn" title="Reset this word's schedule" aria-label="Reset ${escapeHtml(wordData.word)}">↺</button>`
            : ""
        }
      `;

      card.style.borderColor = accentColor;

      const toggleBtn = card.querySelector(".card-toggle");

      toggleBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleFlashcard(card);
      });

      card.querySelectorAll(".grade-btn").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          handleGrade(card, wordData.word, btn.dataset.grade);
        });
      });

      const resetBtn = card.querySelector(".reset-word-btn");
      if (resetBtn) {
        resetBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          resetWord(wordData.word);
          card.remove();
          updateProgress();
          showToast(`↺ "${wordData.word}" reset to new`, null, null);
        });
      }

      card.addEventListener("click", (e) => {
        if (e.target.closest(".grade-btn") || e.target.closest(".reset-word-btn")) return;
        if (e.target.closest(".card-toggle")) return;
        toggleFlashcard(card);
      });

      card.addEventListener("touchend", (e) => {
        if (e.target.closest(".grade-btn") || e.target.closest(".reset-word-btn")) return;
        if (e.target.closest(".card-toggle")) return;
        e.preventDefault();
        toggleFlashcard(card);
      });

      gridElement.appendChild(card);
    });
  }

  // ===========================================================================
  // Grading
  // ===========================================================================
  function handleGrade(card, word, grade) {
    const setFile = currentSet;
    if (!setFile) return;

    const srs = getSrs(setFile);
    const previous = srs[word] ? { ...srs[word] } : null;
    const previousLearned = getLearnedWords(setFile).includes(word);

    const updated = schedule(previous, grade);
    srs[word] = updated;
    setSrs(setFile, srs);

    // "Learned" tracks words answered correctly at least once, and forgotten
    // again when they are graded "Again".
    const learned = getLearnedWords(setFile);
    const shouldBeLearned = grade !== "again";
    if (shouldBeLearned && !learned.includes(word)) {
      learned.push(word);
      setLearnedWords(setFile, learned);
    } else if (!shouldBeLearned && learned.includes(word)) {
      const index = learned.indexOf(word);
      learned.splice(index, 1);
      setLearnedWords(setFile, learned);
    }

    recordReview(setFile, grade);

    // Remember where the card sat so Undo can put it back in the right slot.
    const parent = card.parentNode;
    const siblings = parent ? Array.from(parent.querySelectorAll(".card")) : [];
    const position = siblings.indexOf(card);
    const generation = renderGeneration;

    card.classList.add("removed");
    setCardState(card, false);

    setTimeout(() => {
      if (card.parentNode) card.parentNode.removeChild(card);

      // Learning the last card on screen would otherwise leave a blank grid.
      if (!gridElement.querySelector(".card") && renderGeneration === generation) {
        loadWords(currentSet);
      }
    }, 300);
    updateProgress();

    const label = GRADES.find((g) => g.id === grade)?.label || grade;
    showToast(
      `${label} · next review ${formatInterval(updated.interval)}`,
      "Undo",
      () => {
        const current = getSrs(setFile);
        if (previous) {
          current[word] = previous;
        } else {
          delete current[word];
        }
        setSrs(setFile, current);

        const nowLearned = getLearnedWords(setFile);
        if (previousLearned && !nowLearned.includes(word)) {
          nowLearned.push(word);
          setLearnedWords(setFile, nowLearned);
        } else if (!previousLearned && nowLearned.includes(word)) {
          const index = nowLearned.indexOf(word);
          nowLearned.splice(index, 1);
          setLearnedWords(setFile, nowLearned);
        }

        updateProgress();

        if (renderGeneration !== generation) {
          // The grid was re-rendered while the toast was up, so reload rather
          // than trying to splice the old card back in.
          loadWords(currentSet);
        } else if (parent) {
          const currentCards = Array.from(parent.querySelectorAll(".card"));
          const reference = currentCards[Math.min(position, currentCards.length)] || null;
          parent.insertBefore(card, reference);
          requestAnimationFrame(() => {
            card.classList.remove("removed");
          });
        }
        showToast(`"${word}" ungraded`, null, null);
      }
    );
  }

  function resetWord(word) {
    if (!currentSet) return;
    const srs = getSrs(currentSet);
    delete srs[word];
    setSrs(currentSet, srs);

    const learned = getLearnedWords(currentSet);
    const index = learned.indexOf(word);
    if (index > -1) {
      learned.splice(index, 1);
      setLearnedWords(currentSet, learned);
    }
  }

  function resetSet(setFile) {
    storageRemove(srsKey(setFile));
    storageRemove(learnedKey(setFile));
    storageRemove(legacyLearnedKey(setFile));
  }

  // ===========================================================================
  // Stats panel
  // ===========================================================================
  function openStats() {
    if (!statsModal || !currentSet) return;
    statsModalBody.innerHTML = renderStatsPanel(currentSet, currentSetMeta?.words || []);
    statsModal.removeAttribute("hidden");
    statsModal.setAttribute("aria-hidden", "false");
    bindStatsPanel(currentSet);
  }

  function closeStats() {
    if (!statsModal) return;
    statsModal.setAttribute("hidden", "");
    statsModal.setAttribute("aria-hidden", "true");
  }

  function renderStatsPanel(setFile, allWords) {
    const setStats = getSetStats(setFile);
    const srs = getSrs(setFile);
    const today = dayKey(Date.now());
    const todayStats = setStats.history[today] || { reviews: 0, correct: 0 };
    const streak = computeStreak(setStats.history);

    const accuracy = setStats.reviews > 0 ? Math.round((setStats.correct / setStats.reviews) * 100) : 0;

    let newCount = 0;
    let learning = 0;
    let young = 0;
    let mature = 0;

    allWords.forEach((w) => {
      const rec = srs[w.word];
      if (!rec) {
        newCount += 1;
      } else if (rec.lapsed || rec.interval < 1) {
        learning += 1;
      } else if (rec.interval >= CONFIG.matureIntervalDays) {
        mature += 1;
      } else {
        young += 1;
      }
    });

    const scheduled = Object.entries(srs)
      .filter(([, rec]) => rec && rec.last > 0)
      .sort((a, b) => a[1].due - b[1].due);

    const wordRows = scheduled
      .map(([word, rec]) => {
        const due = rec.due <= Date.now();
        const when = due
          ? '<span class="due-now">due now</span>'
          : escapeHtml(formatInterval((rec.due - Date.now()) / DAY_MS));
        return `
          <li class="stat-word${due ? " stat-word-due" : ""}">
            <span class="stat-word-name">${escapeHtml(word)}</span>
            <span class="stat-word-due">${when}</span>
            <button type="button" class="stat-word-reset" data-word="${escapeHtml(word)}" aria-label="Reset ${escapeHtml(word)}">↺</button>
          </li>`;
      })
      .join("");

    return `
      <div class="stat-grid">
        <div class="stat-tile">
          <div class="stat-value">${streak}</div>
          <div class="stat-label">day streak</div>
        </div>
        <div class="stat-tile">
          <div class="stat-value">${todayStats.reviews}</div>
          <div class="stat-label">reviewed today</div>
        </div>
        <div class="stat-tile">
          <div class="stat-value">${accuracy}%</div>
          <div class="stat-label">accuracy</div>
        </div>
        <div class="stat-tile">
          <div class="stat-value">${setStats.reviews}</div>
          <div class="stat-label">total reviews</div>
        </div>
      </div>

      <h3 class="stat-heading">Where the words are</h3>
      <div class="stat-bars">
        <div class="stat-bar-row"><span class="stat-bar-label">New</span><span class="stat-bar-count">${newCount}</span></div>
        <div class="stat-bar-row"><span class="stat-bar-label">Learning</span><span class="stat-bar-count">${learning}</span></div>
        <div class="stat-bar-row"><span class="stat-bar-label">Familiar</span><span class="stat-bar-count">${young}</span></div>
        <div class="stat-bar-row"><span class="stat-bar-label">Mature</span><span class="stat-bar-count">${mature}</span></div>
      </div>

      <h3 class="stat-heading">Scheduled words</h3>
      ${
        scheduled.length === 0
          ? `<p class="stat-empty">No words have been graded yet.</p>`
          : `<ul class="stat-words">${wordRows}</ul>`
      }

      <div class="stat-actions">
        <button type="button" id="statResetAll" class="tool-btn tool-btn-danger">Reset this set</button>
      </div>
    `;
  }

  function bindStatsPanel(setFile) {
    statsModalBody.querySelectorAll(".stat-word-reset").forEach((btn) => {
      btn.addEventListener("click", () => {
        const word = btn.dataset.word;
        resetWord(word);
        updateProgress();
        statsModalBody.innerHTML = renderStatsPanel(setFile, currentSetMeta?.words || []);
        bindStatsPanel(setFile);
        showToast(`↺ "${word}" reset to new`, null, null);
      });
    });

    const resetAll = statsModalBody.querySelector("#statResetAll");
    if (resetAll) {
      resetAll.addEventListener("click", () => {
        if (!confirm("Reset all progress for this set?")) return;
        resetSet(setFile);
        updateProgress();
        statsModalBody.innerHTML = renderStatsPanel(setFile, currentSetMeta?.words || []);
        bindStatsPanel(setFile);
        loadWords(setFile, { resetSession: true });
        showToast("🔄 Progress reset for this set", null, null);
      });
    }
  }

  // ===========================================================================
  // Export / import
  // ===========================================================================
  function buildExportPayload() {
    const stats = getStats();
    const sets = {};

    // Collect every set the app knows about: the manifest plus anything that
    // already has progress stored.
    const known = new Set();
    if (currentSetMeta) known.add(currentSetMeta.file);
    Object.keys(stats.sets || {}).forEach((f) => known.add(f));
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith("mindful_srs_")) known.add(key.slice("mindful_srs_".length));
        if (key && key.startsWith("mindful_learned_")) known.add(key.slice("mindful_learned_".length));
      }
    } catch {
      // storage may be unavailable; the manifest entries still cover the rest
    }

    known.forEach((file) => {
      const srs = getSrs(file);
      const learned = getLearnedWords(file);
      if (Object.keys(srs).length === 0 && learned.length === 0) return;
      sets[file] = { srs, learned };
    });

    return {
      app: "mindful-words",
      version: 1,
      exportedAt: new Date().toISOString(),
      sets,
      stats,
    };
  }

  function exportProgress() {
    const payload = buildExportPayload();
    const json = JSON.stringify(payload, null, 2);
    const filename = `mindful-words-progress-${new Date().toISOString().slice(0, 10)}.json`;

    try {
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast("⬇ Progress exported", null, null);
    } catch (e) {
      console.warn("⚠️ Download failed, falling back to clipboard:", e);
      copyToClipboard(json).then((ok) => {
        showToast(ok ? "📋 Progress copied to clipboard" : "❌ Export failed", null, null);
      });
    }
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(
        () => true,
        () => legacyCopy(text)
      );
    }
    return Promise.resolve(legacyCopy(text));
  }

  function legacyCopy(text) {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(area);
      return ok;
    } catch {
      return false;
    }
  }

  function handleImportFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        applyImport(data);
      } catch (err) {
        console.error("❌ Import failed:", err);
        showToast("❌ That file could not be read", null, null);
      } finally {
        e.target.value = "";
      }
    };
    reader.onerror = () => {
      showToast("❌ That file could not be read", null, null);
      e.target.value = "";
    };
    reader.readAsText(file);
  }

  function applyImport(data) {
    if (!data || typeof data !== "object" || !data.sets || typeof data.sets !== "object") {
      showToast("❌ That file is not a Mindful Words backup", null, null);
      return;
    }

    const setNames = Object.keys(data.sets);
    if (setNames.length === 0) {
      showToast("❌ That backup contains no progress", null, null);
      return;
    }

    const ok = confirm(
      `Import progress for ${setNames.length} set${setNames.length === 1 ? "" : "s"}?\n\n` +
        "This replaces the current schedule for those sets."
    );
    if (!ok) return;

    setNames.forEach((file) => {
      const incoming = data.sets[file] || {};
      const srs = incoming.srs && typeof incoming.srs === "object" ? incoming.srs : {};
      const learned = Array.isArray(incoming.learned) ? incoming.learned : [];
      if (Object.keys(srs).length > 0) setSrs(file, srs);
      if (learned.length > 0) setLearnedWords(file, learned);
    });

    if (data.stats && typeof data.stats === "object") {
      setStats(data.stats);
    }

    updateProgress();
    if (currentSet) loadWords(currentSet, { resetSession: true });
    showToast(`⬆ Imported ${setNames.length} set${setNames.length === 1 ? "" : "s"}`, null, null);
  }

  // ===========================================================================
  // Card state
  // ===========================================================================
  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  // Applies the open/closed state to a card and keeps the ARIA attributes in
  // sync with it.
  function setCardState(card, isActive) {
    if (!card) return;
    card.classList.toggle("active", isActive);

    const toggleBtn = card.querySelector(".card-toggle");
    const meaning = card.querySelector(".meaning-text");
    if (toggleBtn) toggleBtn.setAttribute("aria-expanded", isActive ? "true" : "false");
    if (meaning) meaning.setAttribute("aria-hidden", isActive ? "false" : "true");
  }

  function toggleFlashcard(card) {
    if (!card) return;

    const isActive = !card.classList.contains("active");
    setCardState(card, isActive);

    if (isActive) {
      closeOtherCards(card);
    }
  }

  function closeCard(card) {
    setCardState(card, false);
  }

  function closeOtherCards(exceptCard) {
    const allCards = document.querySelectorAll(".card");
    allCards.forEach((otherCard) => {
      if (otherCard !== exceptCard && otherCard.classList.contains("active")) {
        closeCard(otherCard);
      }
    });
  }

  function closeAllCards() {
    document.querySelectorAll(".card").forEach((card) => {
      closeCard(card);
    });
  }

  function focusCard(card) {
    if (!card) return;
    const toggleBtn = card.querySelector(".card-toggle");
    if (toggleBtn) toggleBtn.focus();
    else card.focus();
  }

  function handleKeyboardNavigation(e) {
    const tag = e.target && e.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

    // 1-4 grade the open card.
    if (GRADE_BY_KEY[e.key] && document.querySelector(".card.active")) {
      const card = document.querySelector(".card.active");
      e.preventDefault();
      handleGrade(card, card.querySelector(".word-text").textContent, GRADE_BY_KEY[e.key]);
      return;
    }

    const allCards = Array.from(document.querySelectorAll(".card"));
    if (allCards.length === 0) return;

    // Work from the focused element rather than the event target, so the
    // navigation behaves the same however the key event was delivered.
    const activeEl = document.activeElement || e.target;
    const fromActive = activeEl && activeEl.closest ? activeEl.closest(".card") : null;
    const fromTarget = e.target && e.target.closest ? e.target.closest(".card") : null;
    const currentCard = fromActive || fromTarget;

    const buttonTarget = activeEl && activeEl.closest ? activeEl.closest("button") : null;
    const onButton = buttonTarget || (e.target && e.target.closest ? e.target.closest("button") : null);

    const currentIndex = currentCard ? allCards.indexOf(currentCard) : -1;

    switch (e.key) {
      case "Enter":
      case " ":
        // A focused button is activated natively by the browser, so don't
        // also flip the card here.
        if (onButton) return;
        e.preventDefault();
        toggleFlashcard(currentCard || allCards[0]);
        break;

      case "ArrowDown":
      case "ArrowRight":
        e.preventDefault();
        if (currentIndex < 0) focusCard(allCards[0]);
        else if (currentIndex < allCards.length - 1) focusCard(allCards[currentIndex + 1]);
        break;

      case "ArrowUp":
      case "ArrowLeft":
        e.preventDefault();
        if (currentIndex < 0) focusCard(allCards[0]);
        else if (currentIndex > 0) focusCard(allCards[currentIndex - 1]);
        break;

      case "Escape":
        e.preventDefault();
        closeAllCards();
        break;
    }
  }

  // ===========================================================================
  // Bootstrap
  // ===========================================================================
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
