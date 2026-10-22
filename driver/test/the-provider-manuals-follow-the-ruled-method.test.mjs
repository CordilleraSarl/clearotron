// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE PROVIDER MANUALS FOLLOW THE RULED SCRIPTS, CLASS PIN, GOODS STEP AND CLOSEABILITY.
//
// The provider manuals the register sweep reads still taught the older method: a script question for every variant
// rather than one per market the frame names, an identity leg run without the class filter, a narrowing list with no
// goods step, a goods field called unwired that the adapter sends, a watchlist sweep, price words, and a gap no search
// on that register can close called closeable and sent to the skeptic to escalate. This holds the ruled lines and
// that the old ones are gone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "clearance-register", "providers");
const flat = (rel) => readFileSync(join(DIR, rel), "utf8").replace(/\s+/g, " ");

test("Clarivate asks one script question per named market, keeps the class pin, and narrows a crowd by the unit manual's steps", () => {
  const clarivate = flat("clarivate.md");
  assert.ok(clarivate.includes("- **No cross-language single query** — ask one script question per market the frame names, by its "
    + "romanised form (below); where that romanised form is a Latin question the plan already asks, do not ask it again."));
  assert.ok(clarivate.includes("Leave it off: dead identical records then come back in the named band with their status, and no separate "
    + "identity leg is run."));
  assert.ok(clarivate.includes("Narrow a crowd by the steps in `unit.md` (*Read the identical mark first*). Never by \"take the first N\"."));
  for (const gone of ["run the variant manifest per script", "run the identity leg", "identical-match is class-agnostic",
    "Narrow by: office set", "not wired yet", "unbilled", "escalate and disclose"])
    assert.ok(!clarivate.includes(gone), `the Clarivate manual still says "${gone}"`);
});

test("Corsearch runs no watchlist sweep, and EUIPO names its coverage, not the trade of a tier", () => {
  assert.ok(!flat("corsearch.md").includes("Watchlist-driven proactive sweeps"), "the Corsearch manual still runs a watchlist sweep");
  const euipo = flat("euipo.md");
  assert.ok(euipo.includes("That is this register's coverage, not a fault to work around."));
  assert.ok(!euipo.includes("the deliberate trade of running the free tier"), "the EUIPO manual still calls its coverage the trade of a tier");
});

const NEVER_CLOSED = "disclose it; no search on this register can close it, so it is not escalated, and it is never clean.";

test("a gap no search on the register can close is disclosed, never escalated and never clean", () => {
  const clarivate = flat("clarivate.md"), signa = flat("signa.md"), uspto = flat("uspto-local.md");
  assert.ok(clarivate.includes("Each of these, when it blocks a dictated slice, is a **`deferred` coverage row** — " + NEVER_CLOSED));
  assert.ok(signa.includes("give that slice a `deferred` coverage-form row (the register sweep **cannot reach** it on Signa) — "
    + NEVER_CLOSED + " This follows the keystone doctrine in `../SKILL.md` → *Coverage ledger*: a could-not-reach gap is "
    + "**`deferred`**, open and disclosed, never `coverage-limited`"));
  assert.ok(uspto.includes("give that slice a `deferred` coverage-form row so the digest and synthesis surface it — " + NEVER_CLOSED));
  for (const [name, text] of [["Signa", signa], ["USPTO", uspto]])
    for (const gone of ["closeable", "skeptic can escalate", "escalate + disclose"])
      assert.ok(!text.includes(gone), `the ${name} manual still says "${gone}"`);
});

test("Corsearch asks one script question per market the frame names", () => {
  const corsearch = flat("corsearch.md");
  assert.ok(corsearch.includes("Skill handles this by generating transliteration variants in `clearance-variants`, with one script question "
    + "per market the frame names."));
  assert.ok(!corsearch.includes("querying each separately"), "the Corsearch manual still queries every variant separately");
});
