#!/usr/bin/env node
/**
 * Builds a clean, deployable copy of the site into dist/.
 *
 * The app is static - there is no bundler - but the repository also holds
 * tests, tooling and documentation that should not be published. This copies
 * only what the browser actually needs.
 *
 *   node tools/build.js
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "dist");

const FILES = [
  "index.html",
  "manifest.webmanifest",
  "sw.js",
  "css/style.css",
  "js/app.js",
  "data/manifest.json",
  "data/words.json",
  "data/computer-words.json",
  "data/multiplication.json",
  "assets/favicon.svg",
  "assets/icon-192.png",
  "assets/icon-512.png",
  "assets/icon-maskable-192.png",
  "assets/icon-maskable-512.png",
  "assets/apple-touch-icon.png",
  "assets/og-image.png",
];

fs.rmSync(OUT, { recursive: true, force: true });

let copied = 0;
for (const rel of FILES) {
  const from = path.join(ROOT, rel);
  if (!fs.existsSync(from)) {
    console.warn(`⚠️  missing, skipped: ${rel}`);
    continue;
  }
  const to = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  copied += 1;
}

console.log(`✅ Built ${copied}/${FILES.length} files into ${path.relative(ROOT, OUT)}/`);
console.log("   Deploy this directory - it contains no tests, tooling or docs.");
