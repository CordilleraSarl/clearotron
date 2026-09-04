// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// surface-prose-names-what-renders.test.mjs —. Comments and operator messages that ENUMERATE the
// pool site's surfaces must name the ones that render, and nothing else.
//
// WHY THIS IS A TEST AND NOT TWO CORRECTED SENTENCES. 's third criterion is explicit: "a comment
// that must be remembered is not a guard." Both defects it names were written true and went stale
// underneath their authors — retired the Quality hub and its Feedback console, and nothing failed.
// `pool-admin`'s regen message went on announcing three pages, two of which did not exist and none of
// which that command writes; it read as evidence a Feedback page was live and cost a reader a real
// detour, which is how the issue came to be filed. Correcting the words fixes today and leaves the
// mechanism that produced them intact.
//
// THE SURFACE LIST IS DERIVED, NEVER RESTATED. Every arm below takes the truth from `siteNav`'s own
// output — the renderer, driven over a pool holding BOTH the live pages and the retired ones — so the
// expectation moves the day `MAIN` moves. A test that hardcoded "Clearance reports · Run status ·
// Profiles" would be the same stale sentence one directory further away.
//
// The RENDERED nav is already guarded, in both directions, by site-nav.test.mjs ("Quality and Feedback
// are NOT nav entries"). This file guards the PROSE ABOUT it, which is the gap found: the nav was
// right and every sentence describing it was wrong.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { siteNav } from "../../shared/site-nav.mjs";
import { regenSurfaces } from "../publish/index.mjs";

const ROOT = resolve(fileURLToPath(import.meta.url), "../../..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

// The retired pages are PRESENT ON DISK here on purpose: `siteNav` existence-gates its links, so a pool
// without them would render the right nav for the wrong reason and this file would pass on a renderer
// that had quietly re-adopted them.
const RETIRED_FILES = ["quality.html", "feedback.html", "triage.html"];
function poolWithEverything() {
  const p = mkdtempSync(join(tmpdir(), "surfaces-"));
  for (const f of ["index.html", "status.html", "profiles.html", ...RETIRED_FILES]) {
    const fp = join(p, f);
    mkdirSync(join(fp, ".."), { recursive: true });
    writeFileSync(fp, "x");
  }
  return p;
}

/** The labels the nav actually renders, in order. */
function renderedSurfaces() {
  const nav = siteNav(poolWithEverything(), "index");
  return [...nav.matchAll(/<a href="[^"]*\.html"[^>]*>([^<]+)<\/a>/g)].map((m) => m[1]);
}

test("#1450 premise: the renderer is the source of truth, and it still renders a real list", () => {
  const live = renderedSurfaces();
  // Non-vacuity for every arm below. If this parse ever returns [] — a markup change, a renamed class —
  // the set comparisons would trivially "pass" against prose that named nothing.
  assert.ok(live.length >= 3, `the nav must render at least the three live surfaces, got ${live.length}: ${live.join(" · ")}`);
  for (const gone of ["Quality", "Feedback"]) {
    assert.ok(!live.includes(gone),
      `${gone} renders again — the quality subsystem came back (#265). This file's expectations follow the `
      + `renderer, so update the two prose sites below rather than this assertion.`);
  }
});

test("#1450 anon-overlay's header names the surfaces that render, and no others", () => {
  const src = read("shared/anon-overlay.mjs");
  // The parenthesised list in the module header — the sentence that said "Archive · Run status ·
  // Quality · Feedback · Profiles" while two of the five had not rendered for months.
  const m = src.slice(0, 1200).match(/\(([^()]*·[^()]*)\)/);
  assert.ok(m, "the header must still carry a '·'-separated surface list — if it was reworded, re-point this arm at it");
  const named = m[1].split("·").map((x) => x.trim()).filter(Boolean);
  assert.ok(named.length >= 3, `parsed ${named.length} surface name(s) from the header — an empty parse must fail, not pass`);

  const live = renderedSurfaces();
  assert.deepEqual([...named].sort(), [...live].sort(),
    `the header enumerates ${named.join(" · ")} but the nav renders ${live.join(" · ")}. `
    + "A comment that lists surfaces is a claim about what exists; make it name exactly what renders.");
});

test("#1450 no prose in these two files presents a RETIRED surface as a current one", () => {
  // Both files may still NAME Quality and Feedback — the correction explains what went and why, and a
  // record of a retirement is worth more than silence. What they may not do is list them among what the
  // product has. Each mention must sit in the same sentence as its retirement.
  for (const rel of ["shared/anon-overlay.mjs", "driver/publish/pool-admin.mjs"]) {
    const lines = read(rel).split("\n");
    for (const [i, line] of lines.entries()) {
      if (!/\bQuality\b|\bFeedback\b/.test(line)) continue;
      const window = lines.slice(Math.max(0, i - 3), i + 4).join(" ");
      assert.match(window, /retire|#265|#1450|had not rendered|do not exist|went with/i,
        `${rel}:${i + 1} names a retired surface without saying it is retired:\n    ${line.trim()}`);
    }
  }
});

test("#1450 pool-admin's regen message names only what that command writes", () => {
  const src = read("driver/publish/pool-admin.mjs");
  const m = src.match(/console\.log\(`re-rendered index\.html[^`]*`\)/);
  assert.ok(m, "the regen confirmation must still be a single template literal — re-point this arm if it moved");
  const msg = m[0];

  // THE MESSAGE IS BOUND TO THE SEAM, not to today's wording. `regen` calls regenIndex (which writes
  // index.html) and regenSurfaces (which writes nothing). The day regenSurfaces gains a writer, this
  // arm reds and asks for the message to grow with it — which is the failure #1450 is made of, caught
  // from the other direction.
  const seamIsEmpty = /\{\s*\}\s*$/.test(regenSurfaces.toString().trim());
  assert.equal(seamIsEmpty, true,
    "regenSurfaces now has a body: it writes something, so pool-admin's regen message must say what — "
    + "and this assertion should be updated to describe the new contract rather than deleted");

  for (const page of ["status", "quality", "feedback"]) {
    assert.ok(!new RegExp(page, "i").test(msg),
      `the regen message names "${page}" while regenSurfaces writes nothing: ${msg}`);
  }
  assert.match(msg, /index\.html/, "and it must still name the one page regenIndex does write");
});
