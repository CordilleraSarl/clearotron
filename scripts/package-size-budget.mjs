#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// package-size-budget.mjs — THE TARBALL CANNOT GROW WITHOUT SOMEBODY DECIDING THAT IT SHOULD.
//
// The package is large by design: most of it is bundled demo evidence, and that was ruled to be right.
// What was missing is not a smaller package, it is a MEASUREMENT — nothing recorded the size, so it
// could double across a few betas and no one would find out from the repository. A number nobody
// records is a number nobody can notice changing.
//
// WHAT THIS IS NOT. It is not a size limit chosen by taste, and it does not argue about what ships.
// It compares against a RECORDED baseline and allows a margin; anything inside the margin passes
// silently, anything past it fails and prints the ten largest paths so the growth has a name before
// anyone debates it.
//
// WHY A COMMITTED BASELINE RATHER THAN A LIVE LOOKUP of the last published version. A gate must give
// the same answer on every machine, including one with no network, and it must not start failing
// because a registry is slow or a version was unpublished. The baseline is minted into this repository
// the same way the suite census is, so the comparison is deterministic, reviewable in the diff that
// changes it, and honest about being a decision somebody made rather than a fact fetched at runtime.
//
// Usage:
//   node scripts/package-size-budget.mjs            measure and report against the baseline
//   node scripts/package-size-budget.mjs --check    …and exit non-zero when it is past the margin
//   node scripts/package-size-budget.mjs --apply    re-record the baseline as it is now

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BASELINE = join(ROOT, "package-size-baseline.json");

// THE MARGIN, and why it is one number rather than per-field taste. A change that adds a demo run
// moves every field at once, so a single proportion catches the shape of growth that matters and
// leaves ordinary churn alone. 10% is roughly one more bundled run on today's package — big enough
// that nobody trips it by editing source, small enough that a doubling cannot arrive unannounced.
export const MARGIN = 0.10;

/** What `npm pack` says this tree would publish. */
export function measure({ root = ROOT } = {}) {
  const out = execFileSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024,
  });
  const p = JSON.parse(out)[0];
  return {
    size: p.size,
    unpackedSize: p.unpackedSize,
    entryCount: p.entryCount,
    files: (p.files ?? []).map((f) => ({ path: f.path, size: f.size })),
  };
}

const mb = (n) => `${(n / 1_000_000).toFixed(1)} MB`;
const pct = (now, was) => `${now >= was ? "+" : ""}${(((now - was) / was) * 100).toFixed(1)}%`;

/** The ten largest paths, so growth has a name rather than a number. */
export function largest(files, n = 10) {
  return [...files].sort((a, b) => b.size - a.size).slice(0, n);
}

/**
 * Compare a measurement against a baseline. Returns `{ over: [...], rows: [...] }` — `over` names the
 * fields past the margin and is empty when nothing is.
 */
export function compare(now, was, { margin = MARGIN } = {}) {
  const rows = [];
  const over = [];
  for (const [field, label] of [["size", "packed"], ["unpackedSize", "unpacked"], ["entryCount", "entries"]]) {
    const limit = Math.floor(was[field] * (1 + margin));
    const breached = now[field] > limit;
    if (breached) over.push(field);
    rows.push({ field, label, now: now[field], was: was[field], limit, breached });
  }
  return { over, rows };
}

if (isEntrypoint(import.meta.url)) {
  const apply = process.argv.includes("--apply");
  const check = process.argv.includes("--check");
  const now = measure();

  if (apply) {
    writeFileSync(BASELINE, `${JSON.stringify({
      note: "What `npm pack` produced when this was recorded. The budget allows a margin over these; see scripts/package-size-budget.mjs.",
      margin: MARGIN,
      size: now.size, unpackedSize: now.unpackedSize, entryCount: now.entryCount,
    }, null, 2)}\n`);
    console.log(`recorded: ${mb(now.size)} packed, ${mb(now.unpackedSize)} unpacked, ${now.entryCount} entries`);
    process.exit(0);
  }

  if (!existsSync(BASELINE)) {
    console.error("package-size-budget: no baseline recorded. `node scripts/package-size-budget.mjs --apply` writes one.");
    process.exit(check ? 1 : 0);
  }
  const was = JSON.parse(readFileSync(BASELINE, "utf8"));
  const { over, rows } = compare(now, was, { margin: was.margin ?? MARGIN });

  for (const r of rows) {
    const shown = r.field === "entryCount" ? `${r.now} against ${r.was}` : `${mb(r.now)} against ${mb(r.was)}`;
    console.log(`  ${r.label.padEnd(9)} ${shown} (${pct(r.now, r.was)}${r.breached ? " — PAST THE MARGIN" : ""})`);
  }

  if (!over.length) {
    console.log(`package-size-budget: inside the ${Math.round((was.margin ?? MARGIN) * 100)}% margin.`);
    process.exit(0);
  }

  console.error(`\npackage-size-budget: ${over.join(" and ")} past the ${Math.round((was.margin ?? MARGIN) * 100)}% margin.`);
  console.error("The ten largest paths in what would be published:\n");
  for (const f of largest(now.files)) console.error(`  ${mb(f.size).padStart(8)}  ${f.path}`);
  console.error("\nIf the growth is intended, re-record the baseline in the same commit that causes it:");
  console.error("  node scripts/package-size-budget.mjs --apply");
  process.exit(check ? 1 : 0);
}
