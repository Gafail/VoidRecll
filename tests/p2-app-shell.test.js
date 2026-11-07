/**
 * P2 app-shell suite.
 *
 * Covers the app shell: icons and the favicon, SEO and social preview tags,
 * the web app manifest, the service worker, dark mode, reduced motion, focus
 * visibility, the manifest description on the home cards, and live regions.
 */

const fs = require("fs");
const path = require("path");
const {
  ROOT,
  bug,
  gap,
  wait,
  boot,
  readPngSize,
} = require("./helpers");

const suite = (async () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const css = fs.readFileSync(path.join(ROOT, "css/style.css"), "utf8");
  const appSrc = fs.readFileSync(path.join(ROOT, "js/app.js"), "utf8");
  const swSrc = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.webmanifest"), "utf8"));

  const home = await boot("http://localhost:8477/index.html");
  const hdoc = home.document;

  // ================= P2-1  FAVICON + ICONS =================
  const iconLinks = Array.from(hdoc.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]'));
  bug("P2-1 the page declares an icon", iconLinks.length > 0, `${iconLinks.length} icon links`);
  bug("P2-1 the favicon file exists on disk",
    fs.existsSync(path.join(ROOT, "assets/favicon.svg")), "assets/favicon.svg");
  bug("P2-1 the apple-touch-icon file exists on disk",
    fs.existsSync(path.join(ROOT, "assets/apple-touch-icon.png")), "assets/apple-touch-icon.png");

  const referenced = iconLinks.map((l) => l.getAttribute("href")).filter(Boolean);
  const missing = referenced.filter((href) => !fs.existsSync(path.join(ROOT, href)));
  bug("P2-1 every referenced icon exists", missing.length === 0, `missing: ${missing.join(", ")}`);

  // ================= P2-2  META / SOCIAL TAGS =================
  bug("P2-2 meta description is present",
    !!hdoc.querySelector('meta[name="description"]') &&
    hdoc.querySelector('meta[name="description"]').content.length > 40,
    hdoc.querySelector('meta[name="description"]')?.content?.slice(0, 50));
  bug("P2-2 theme-color is present",
    !!hdoc.querySelector('meta[name="theme-color"]'),
    hdoc.querySelector('meta[name="theme-color"]')?.content);
  bug("P2-2 color-scheme advertises light and dark",
    hdoc.querySelector('meta[name="color-scheme"]')?.content === "light dark",
    hdoc.querySelector('meta[name="color-scheme"]')?.content);

  const ogTags = ["og:type", "og:title", "og:description", "og:image"];
  const missingOg = ogTags.filter((t) => !hdoc.querySelector(`meta[property="${t}"]`));
  bug("P2-2 Open Graph tags are present", missingOg.length === 0, `missing: ${missingOg.join(", ")}`);
  bug("P2-2 Twitter card tags are present",
    !!hdoc.querySelector('meta[name="twitter:card"]') && !!hdoc.querySelector('meta[name="twitter:image"]'));
  bug("P2-2 the og:image file exists on disk",
    fs.existsSync(path.join(ROOT, "assets/og-image.png")), "assets/og-image.png");

  const ogSize = readPngSize(path.join(ROOT, "assets/og-image.png"));
  bug("P2-2 the og:image is 1200x630", ogSize && ogSize.width === 1200 && ogSize.height === 630,
    ogSize ? `${ogSize.width}x${ogSize.height}` : "unreadable");

  bug("P2-2 the page title describes the app",
    /spaced repetition/i.test(hdoc.title), hdoc.title);

  // ================= P2-3  PWA MANIFEST =================
  const manifestLink = hdoc.querySelector('link[rel="manifest"]');
  bug("P2-3 the page links a web app manifest", !!manifestLink, manifestLink?.getAttribute("href"));
  bug("P2-3 the manifest file is linked and exists",
    manifestLink && fs.existsSync(path.join(ROOT, manifestLink.getAttribute("href"))));

  ["name", "short_name", "start_url", "display", "theme_color", "background_color", "icons"].forEach((k) => {
    bug(`P2-3 the manifest has "${k}"`, manifest[k] !== undefined, String(manifest[k]));
  });
  bug("P2-3 the manifest display mode is standalone", manifest.display === "standalone", manifest.display);
  bug("P2-3 the manifest has 192 and 512 icons",
    manifest.icons.some((i) => i.sizes === "192x192") && manifest.icons.some((i) => i.sizes === "512x512"));
  bug("P2-3 the manifest has a maskable icon",
    manifest.icons.some((i) => (i.purpose || "").includes("maskable")));
  const missingIcons = manifest.icons.filter((i) => !fs.existsSync(path.join(ROOT, i.src)));
  bug("P2-3 every manifest icon exists on disk", missingIcons.length === 0,
    `missing: ${missingIcons.map((i) => i.src).join(", ")}`);

  const iconSizes = {};
  manifest.icons.filter((i) => i.src.endsWith(".png")).forEach((i) => {
    iconSizes[i.sizes] = readPngSize(path.join(ROOT, i.src));
  });
  const badIcon = Object.entries(iconSizes).find(([s, real]) => {
    const [w, h] = s.split("x").map(Number);
    return !real || real.width !== w || real.height !== h;
  });
  bug("P2-3 the icon PNGs are the size the manifest claims", !badIcon,
    badIcon ? `${badIcon[0]} -> ${badIcon[1]?.width}x${badIcon[1]?.height}` : JSON.stringify(iconSizes));

  // ================= P2-4  SERVICE WORKER =================
  bug("P2-4 the app registers a service worker", /serviceWorker\.register/.test(appSrc));
  bug("P2-4 the registration is guarded to secure origins",
    /location\.protocol === "https:"|"localhost"/.test(appSrc),
    "service workers do not work on plain http for non-localhost hosts");
  bug("P2-4 the service worker precaches the app shell",
    /addAll\(SHELL\)/.test(swSrc) && /SHELL\s*=\s*\[/.test(swSrc));
  bug("P2-4 the service worker clears old caches on activate", /caches\.delete/.test(swSrc));
  bug("P2-4 the service worker handles fetch", /addEventListener\("fetch"/.test(swSrc));
  const swMissing = ["index.html", "css/style.css", "js/app.js", "manifest.webmanifest"]
    .filter((f) => !swSrc.includes(f));
  bug("P2-4 the precache list covers the core app files", swMissing.length === 0,
    `missing: ${swMissing.join(", ")}`);
  const swDataMissing = ["data/manifest.json", "data/words.json"].filter((f) => !swSrc.includes(f));
  bug("P2-4 the precache list covers the word data", swDataMissing.length === 0,
    `missing: ${swDataMissing.join(", ")}`);

  // every file the worker precaches must actually exist, or the install step
  // rejects and the app never goes offline
  const shellList = /const SHELL\s*=\s*\[([\s\S]*?)\];/.exec(swSrc);
  const shellFiles = shellList
    ? shellList[1].match(/"([^"]+)"/g).map((s) => s.replace(/"/g, "")).filter((f) => f !== "./")
    : [];
  const shellMissing = shellFiles
    .filter((f) => !fs.existsSync(path.join(ROOT, f)))
    .filter((f) => f !== "" && f !== "./");
  bug("P2-4 every precached file exists on disk", shellMissing.length === 0,
    `missing: ${shellMissing.join(", ")}`);
  bug("P2-4 the precache list is not empty", shellFiles.length > 5,
    `${shellFiles.length} files precached`);

  // ================= P2-4b  BUILD OUTPUT =================
  const buildSrc = fs.readFileSync(path.join(ROOT, "tools/build.js"), "utf8");
  const buildList = /const FILES\s*=\s*\[([\s\S]*?)\];/.exec(buildSrc);
  const buildFiles = buildList
    ? buildList[1].match(/"([^"]+)"/g).map((s) => s.replace(/"/g, ""))
    : [];
  const buildMissing = buildFiles.filter((f) => !fs.existsSync(path.join(ROOT, f)));
  bug("P2-4b every file in the build list exists", buildMissing.length === 0,
    `missing: ${buildMissing.join(", ")}`);
  const notInBuild = ["index.html", "js/app.js", "css/style.css", "sw.js", "manifest.webmanifest"]
    .filter((f) => !buildFiles.includes(f));
  bug("P2-4b the build list includes the core app files", notInBuild.length === 0,
    `missing: ${notInBuild.join(", ")}`);
  bug("P2-4b the build excludes the tests and tooling",
    !buildFiles.some((f) => f.startsWith("tests/") || f.startsWith("tools/") || f.startsWith("docs/")),
    "the deployed site should not ship the test harness");
  bug("P2-4b node_modules and dist are gitignored",
    /node_modules\//.test(fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8")) &&
    /dist\//.test(fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8")));

  // ================= P2-5  DARK MODE =================
  const darkBlock = /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{([\s\S]*?)\n\}/.exec(css);
  bug("P2-5 a dark mode block exists", !!darkBlock);
  if (darkBlock) {
    const block = darkBlock[1];
    ["--bg-start", "--card-bg", "--text-primary", "--accent-primary"].forEach((v) => {
      bug(`P2-5 dark mode overrides ${v}`, block.includes(`${v}:`), "not overridden");
    });
  }
  bug("P2-5 the toast background is theme-aware",
    /\.toast\s*\{[^}]*background:\s*var\(--toast-bg\)/.test(css),
    "toast used a hard-coded colour that breaks in dark mode");

  // ================= P2-6  REDUCED MOTION =================
  bug("P2-6 a prefers-reduced-motion block exists",
    /@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(css));
  bug("P2-6 reduced motion disables transitions",
    /transition-duration:\s*0\.01ms\s*!important/.test(css));

  // ================= P2-7  FOCUS VISIBLE =================
  bug("P2-7 a global :focus-visible style exists", /:focus-visible\s*\{/.test(css));
  bug("P2-7 the card toggle has a visible focus ring", /\.card-toggle:focus-visible/.test(css));

  // ================= P2-8  SET DESCRIPTION =================
  const descEl = hdoc.querySelector(".set-card .set-desc");
  bug("P2-8 the home cards show the manifest description",
    !!descEl && descEl.textContent.includes("Calming, reflective vocabulary"),
    descEl ? `"${descEl.textContent}"` : "no .set-desc element");
  const allDescs = Array.from(hdoc.querySelectorAll(".set-card .set-desc")).map((d) => d.textContent);
  bug("P2-8 every set that has a description shows it",
    allDescs.length === 3, `${allDescs.length} descriptions: ${allDescs.join(" | ")}`);

  // ================= P2-9  ANNOUNCEMENTS =================
  bug("P2-9 the progress text is a live region",
    hdoc.getElementById("progressText")?.getAttribute("aria-live") === "polite");
  bug("P2-9 the toast container is a live region",
    hdoc.getElementById("toastContainer")?.getAttribute("aria-live") === "polite");

  const g = await boot("http://localhost:8477/index.html?set=words.json");
  const gdoc = g.document;
  const bar = gdoc.querySelector(".progress-bar");
  bug("P2-9 the progress bar is a progressbar role", bar?.getAttribute("role") === "progressbar");
  bug("P2-9 the progress bar reports its value",
    bar?.getAttribute("aria-valuenow") === "0", `aria-valuenow = "${bar?.getAttribute("aria-valuenow")}"`);

  // ================= P2-10  KO-FI SUPPORT BUTTON =================
  const KO_FI_SCRIPT = "https://storage.ko-fi.com/cdn/widget/Widget_2.js";
  const koFiScripts = hdoc.querySelectorAll(`script[src="${KO_FI_SCRIPT}"]`);
  bug("P2-10 the home view loads the Ko-Fi widget script", koFiScripts.length === 1,
    `${koFiScripts.length} script tag(s)`);
  bug("P2-10 the Ko-Fi widget is initialised with the right label, colour and code",
    home.__koFi?.label === "Support me on Ko-fi" &&
    home.__koFi?.color === "#72a4f2" &&
    home.__koFi?.code === "R5E3224KOP",
    JSON.stringify(home.__koFi));

  // The button has to be in the DOM, not just configured. The widget's own
  // draw() uses document.writeln(), which browsers ignore for a script that
  // loads after the page is parsed - so the app must use getHTML() instead.
  const kofiButton = hdoc.querySelector("#kofiWidget .kofi-button");
  bug("P2-10 the Ko-Fi button is rendered on the page", !!kofiButton,
    kofiButton ? "found" : "no .kofi-button in the DOM");
  bug("P2-10 the Ko-Fi button links to the right page",
    kofiButton?.getAttribute("href") === "https://ko-fi.com/R5E3224KOP",
    kofiButton?.getAttribute("href"));
  bug("P2-10 the Ko-Fi button shows the right label",
    (kofiButton?.textContent || "").trim() === "Support me on Ko-fi",
    `"${(kofiButton?.textContent || "").trim()}"`);
  bug("P2-10 the Ko-Fi button uses the right colour",
    (kofiButton?.getAttribute("style") || "").includes("#72a4f2"),
    kofiButton?.getAttribute("style"));
  bug("P2-10 the app builds the button from getHTML(), not draw()",
    home.__koFi?.usedGetHTML === true && home.__koFi?.usedDraw === false,
    `getHTML: ${home.__koFi?.usedGetHTML}, draw: ${home.__koFi?.usedDraw}`);
  bug("P2-10 the widget sits inside the home view, so it leaves with it",
    !!hdoc.querySelector("#homeView #kofiWidget"),
    "the holder should be a child of #homeView");

  // the widget belongs on the home page only - it must not follow the user
  // into a study session
  const gameKoFi = gdoc.querySelectorAll(`script[src="${KO_FI_SCRIPT}"]`);
  bug("P2-10 the study view does not load the Ko-Fi widget",
    gameKoFi.length === 0 && g.__koFi === undefined && !gdoc.querySelector("#kofiWidget"),
    `${gameKoFi.length} script tag(s), __koFi = ${JSON.stringify(g.__koFi)}`);

  // the widget script is added by JS, not hard-coded into the page, so that it
  // can be scoped to the home view
  bug("P2-10 the widget is not hard-coded into index.html",
    !html.includes("ko-fi.com"), "index.html should not contain a Ko-Fi script tag");

  // the loader is guarded against adding the same script twice
  const dup = await boot("http://localhost:8477/index.html", {
    preScriptSrc: KO_FI_SCRIPT,
  });
  bug("P2-10 the Ko-Fi widget is not loaded a second time",
    dup.__koFi === undefined &&
    dup.document.querySelectorAll(`script[src="${KO_FI_SCRIPT}"]`).length === 1 &&
    !dup.document.querySelector("#kofiWidget"),
    `__koFi = ${JSON.stringify(dup.__koFi)}, ` +
    `${dup.document.querySelectorAll(`script[src="${KO_FI_SCRIPT}"]`).length} script tag(s)`);

  // ================= REGRESSION =================
  bug("regression: no uncaught errors on the home view", home.__errors.length === 0,
    home.__errors.map(String).join(" | "));
  bug("regression: the game view still renders cards",
    gdoc.querySelectorAll(".card").length === 16, `${gdoc.querySelectorAll(".card").length} cards`);

  // ================= STILL-OPEN GAPS =================
  gap("type-the-answer mode for multiplication", false, "listed as P3");
  gap("custom set builder in the UI", false, "listed as P3");
  gap("text-to-speech pronunciation", false, "listed as P3");
  gap("browse-all / search / favourites", false, "listed as P3");
  gap("a 404 page", false, "not tracked before");
})();

module.exports = suite;
