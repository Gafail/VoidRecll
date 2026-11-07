#!/usr/bin/env node
/**
 * Runs every VoidRecll check suite and prints a combined summary.
 *
 *   node tests/run-all.js
 *
 * The suites boot the real app against a local server, so start one first:
 *
 *   python3 -m http.server 8477
 *
 * (tests/run-server.js does that for you.)
 */

const { results } = require("./helpers");

const SUITES = [
  ["P0 regression", "./p0-regression.test.js"],
  ["P1 features", "./p1-features.test.js"],
  ["P2 app shell", "./p2-app-shell.test.js"],
];

(async () => {
  const started = Date.now();

  for (const [name, file] of SUITES) {
    console.log(`\n========== ${name} ==========`);
    try {
      await require(file);
    } catch (err) {
      console.log(`[BUG ] ${name} suite crashed: ${err.message}`);
      results.bugs.push({ name: `${name} suite crashed`, pass: false, detail: err.message });
    }
  }

  const failed = results.bugs.filter((b) => !b.pass);
  const missing = results.gaps.filter((g) => !g.present);

  console.log("\n================================================");
  console.log(`CHECKS : ${results.bugs.length - failed.length}/${results.bugs.length} passed`);
  console.log(`GAPS   : ${results.gaps.length - missing.length}/${results.gaps.length} present`);
  console.log(`TIME   : ${((Date.now() - started) / 1000).toFixed(1)}s`);

  if (failed.length) {
    console.log("\nFAILURES:");
    failed.forEach((f) => console.log(`  BUG  ${f.name}${f.detail ? `  (${f.detail})` : ""}`));
  }
  if (missing.length) {
    console.log("\nSTILL OPEN:");
    missing.forEach((g) => console.log(`  MISS ${g.name}${g.detail ? `  (${g.detail})` : ""}`));
  }

  console.log("");
  process.exit(failed.length ? 1 : 0);
})();
