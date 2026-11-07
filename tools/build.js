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
  "content/manifest.json",
  "content/words.json",
  "content/computer-words.json",
  "content/multiplication.json",
  "assets/favicon.svg",
  "assets/icon-192.png",
  "assets/icon-512.png",
  "assets/icon-maskable-192.png",
  "assets/icon-maskable-512.png",
  "assets/apple-touch-icon.png",
  "assets/og-image.png",
  // Not for the browser - the LXC host runs this to serve the files above.
  "deploy/server.js",
];

// Files that land somewhere other than their source path in the build.
// The server has to sit at the root of the build, because it serves the
// directory it lives in.
const RENAMED = {
  "deploy/server.js": "server.js",
};

fs.rmSync(OUT, { recursive: true, force: true });

let copied = 0;
for (const rel of FILES) {
  const from = path.join(ROOT, rel);
  if (!fs.existsSync(from)) {
    console.warn(`⚠️  missing, skipped: ${rel}`);
    continue;
  }
  const to = path.join(OUT, RENAMED[rel] || rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  copied += 1;
}

console.log(`✅ Built ${copied}/${FILES.length} files into ${path.relative(ROOT, OUT)}/`);
console.log("   Deploy this directory - it contains no tests, tooling or docs.");
console.log("   It also carries deploy/server.js, which the LXC host runs to serve the site.");
