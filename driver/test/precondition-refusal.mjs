// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// precondition-refusal.mjs — a test whose precondition is absent REFUSES and names it.
//
// ── WHY, IN THE COST IT ALREADY CHARGED ─────────────────────────────────────
//
// `scripts/test-run.mjs` supplies environment these integration tests need. Run bare with `node --test`
// they do not refuse — they FAIL, with:
//
//     exactly one VELTRIPHEN ran (got )
//     0 !== 1
//
// Nothing there names a missing precondition. It reads as "the runner did not run a job", which is a
// defect report about the product. Two rows of a four-row table then said "the box is broken"; the box
// was fine, the conclusion was filed, a correct ruling was nearly discarded on the strength of it, and a
// fleet notice had to be withdrawn after three lanes were told main was red. All of it because two tests
// failed instead of refusing.
//
// The repository already owns the right shape, in the wrapper these very tests run through: refuse, name
// what is missing, name the command. Its own comment gives the reason —
//
//   "...calls the branch clean — and it is, but roughly 190 tests never executed, and a real regression
//    inside any of them is invisible by exactly that arithmetic."
//
// ── WHY A THROW AND NOT A SKIP ───────────────────────────────────────────────────────────────────
//
// A skip is the honest answer when a precondition CANNOT be met on this box — no git checkout, no
// gitleaks binary. This one can always be met: it is one command away, and the command is in the
// message. A skip would leave the file quietly not running for somebody who believes they ran it, which
// is the same absence-as-pass one level up. A throw stops the file and says what to type.

const REQUIRED = Object.freeze([
  ["CLEAROTRON_DATABASE", "the register the driver resolves against — unset, the driver refuses by name "
    + "and the stage never dispatches, which looks exactly like a product failure"],
  ["CLEAROTRON_NO_ENV_FILE", "keeps the run off any ~/.env on the box, so the test measures the tree "
    + "rather than whoever's shell started it"],
]);

/**
 * Refuse, by name, when this file was not started through the suite runner.
 *
 * @param {string} what the test file's subject, so the refusal says which file stopped and why
 */
export function requiresTheSuiteRunner(what) {
  const missing = REQUIRED.filter(([k]) => String(process.env[k] ?? "").trim() === "");
  if (missing.length === 0) return;
  throw new Error(
    `REFUSING TO RUN — ${what} needs environment this invocation did not supply, so it would fail as a `
    + "wrong answer about the product rather than as an absent precondition (tracker issue 2030).\n\n"
    + missing.map(([k, why]) => `  missing  ${k}\n           ${why}`).join("\n")
    + "\n\n  Run it through the suite runner, which supplies them:\n"
    + "      node scripts/test-run.mjs node --test <this file>\n"
    + "  or the npm script that wraps it. A bare `node --test` is not this suite's entry point.");
}

// ---------------------------------------------------------------------------------------------
// THE SECOND MECHANISM, and the one that covers the class rather than two named variables.
//
// The guard above enumerates env names by hand, which means it only ever knows the preconditions
// somebody remembered to add to it. Measured on the specimen: when the register
// provider is unset, the runner does NOT fail silently — it refuses BY NAME and writes that refusal
// into a queue-level packet:
//
//     intake-<base>.prerun-failed.pending   { kind: "pre-run-failed", reason: "…", … }
//     reason: "[register-provider] CLEAROTRON_DATABASE is not set, and there is NO default. …"
//
// The product was honest. The TEST discarded it: it asserted a downstream count
// ("exactly one VELTRIPHEN ran (got )") and never read the packet sitting beside the queue. That is
// the actual defect class — not "tests that read env", which is why grepping test files for the env
// names returns ZERO for both specimens. They never mention the variable; the code under test does.
//
// So: read the product's own refusal back out and refuse with IT. This needs no list to maintain and
// covers every precondition the runner refuses by name, including ones added after this was written.
//
// OPT-IN, per call site, deliberately. A test that is ABOUT the pre-run failure path wants those
// packets to exist, and a blanket check would break it. Call this from a test that expects runs to
// happen, immediately after the run and BEFORE the assertions about what ran.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Refuse when the runner never got started, using the runner's OWN stated reason.
 *
 * @param {string} outboxDir  the run's `prelim-outbox` directory
 * @param {string} what       what is refusing, for the message
 */
export function refuseOnPreRunFailure(outboxDir, what) {
  let entries;
  try { entries = readdirSync(outboxDir); }
  catch { return; }   // no outbox at all — nothing was claimed to have happened here
  // NOT `.endsWith(".failed.pending")`: the separator before "failed" is a HYPHEN in this packet name
  // ("prerun-failed"), so the dotted form silently misses every one of them. runner.dedup.test.mjs
  // already carries an assertion in the dotted form, which is why it stayed green past these packets.
  const failed = entries.filter((f) => f.startsWith("intake-") && f.endsWith("prerun-failed.pending"));
  if (failed.length === 0) return;

  const reasons = [...new Set(failed.map((f) => {
    try { return String(JSON.parse(readFileSync(join(outboxDir, f), "utf8")).reason ?? "").trim(); }
    catch { return ""; }
  }).filter(Boolean))];

  throw new Error(
    `REFUSING TO READ THIS AS A RESULT — ${what}: the runner refused before any run started, so every `
    + "assertion below would measure an absent precondition and report it as a product defect "
    + "(tracker issue 2030).\n\n"
    + `  ${failed.length} job(s) parked pre-run, with the runner's own reason:\n`
    + (reasons.length
      ? reasons.map((r) => `      ${r}`).join("\n")
      : "      (the packets carry no reason — that is itself a finding: the refusal was written "
        + "without saying what it refused on)")
    + "\n\n  If this is an absent precondition rather than a defect, the suite runner supplies it:\n"
    + "      node scripts/test-run.mjs node --test <this file>");
}
