/**
 * Renders static snapshots of the app for visual checks and documentation.
 *
 *   node tests/snapshot.js
 *
 * Writes HTML snapshots into .preview/ (gitignored). Open one in a browser, or
 * feed it to headless Firefox to produce a PNG.
 *
 *   firefox --headless --profile .preview/profile --window-size 1280,1050 \
 *           --screenshot docs/screenshot-flashcards.png .preview/game.html
 */

const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, ".preview");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot(url) {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8")
    .replace(/<script[^>]*src=["'][^"']*app\.js["'][^>]*><\/script>/i, "");
  const dom = new JSDOM(html, {
    url, runScripts: "dangerously", resources: "usable", pretendToBeVisual: true,
  });
  const w = dom.window;
  w.fetch = (i, init) => fetch(new URL(i, w.location.href).href, init);
  w.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
  w.confirm = () => true;
  w.eval(fs.readFileSync(path.join(ROOT, "js/app.js"), "utf8"));
  await wait(1400);
  return w;
}

/**
 * Builds a snapshot of the app. `dark` unwraps the prefers-color-scheme
 * block so the dark palette can be rendered without a browser that reports a
 * dark system theme.
 */
function save(w, name, dark) {
  let html = w.document.documentElement.outerHTML;
  let css = fs.readFileSync(path.join(ROOT, "css/style.css"), "utf8");

  if (dark) {
    const m = /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{([\s\S]*?)\n\}\n/.exec(css);
    if (m) {
      css = css.replace(m[0], `${m[1]}\n`);
      css += "\n/* forced dark */\n" + m[1] + "\n";
    }
  }

  html = html.replace("</head>", `<style>${css}</style></head>`);
  fs.writeFileSync(path.join(OUT, `${name}.html`), html);
  console.log("wrote", path.relative(ROOT, path.join(OUT, `${name}.html`)), dark ? "(dark)" : "");
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const game = await boot("http://localhost:8477/index.html?set=words.json");
  const doc = game.document;
  doc.querySelectorAll(".card")[0].querySelector(".card-toggle").click();
  await wait(200);
  save(game, "game-light", false);
  save(game, "game-dark", true);

  const home = await boot("http://localhost:8477/index.html");
  save(home, "home-light", false);
  save(home, "home-dark", true);
})();
