// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — A CANCELLED TERMINAL NAMES WHY, AT EVERY SITE THAT WRITES ONE.
//
// The issue reported ONE site: `mcp-server/lib/ops.mjs` set `s.reason = null`. Counted at HEAD there were
// FOUR modules writing a cancelled terminal, and every one of them nulled the reason. Fixing the reported
// line would have left three, and the measurement that raised this (five of five cancelled runs on the
// test box reading `reason: null`) would have barely moved — the MCP path is only one way a run stops.
//
// So the assertion here is not "ops.mjs is fixed". It is that NO site writes this terminal without saying
// why, derived from the tree rather than from a list, so a fifth site cannot arrive quietly the way the
// other three did.
//
// WHY A SOURCE SCAN AND NOT ONLY A BEHAVIOURAL ARM. `runner.cancel.test.mjs` drives a real run to a real
// stop and asserts the artifact — that is the proof the field is genuinely written. But it exercises ONE
// of the four paths. A run cancelled mid-clearance, mid-knockout, or from a park reaches a different
// module, and no offline suite drives all four. The scan covers the population; the behavioural arm
// covers the mechanism. Neither alone is the guard.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { trackedFiles, skipReason } from "../../shared/tracked-files.mjs";
import { stopReason, isStopReason, STOP_REASON_PREFIX } from "../../shared/stop-reason.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const NO_CORPUS = skipReason("a-stopped-run-says-why-it-stopped (#1090)");

/** Every non-test module that writes a cancelled terminal, with the lines that do it. */
function cancelSites() {
  const tracked = trackedFiles("a-stopped-run-says-why-it-stopped", { root: ROOT, pathspec: ["*.mjs"] });
  if (!tracked) return null;
  // — THE CORPUS IS ASSERTED BEFORE IT IS WALKED. `trackedFiles` returns null off a checkout, which
  // is handled above, but it can also return an EMPTY list — and an empty corpus produces an empty
  // offender list, which is indistinguishable from "every site states its reason". The scan finding
  // nothing to read is a broken scan, not a clean tree.
  assert.ok(tracked.length > 0,
    "the tracked-file scan returned no .mjs files at all — an empty corpus makes the offender list below "
    + "empty for the wrong reason");
  const out = [];
  for (const f of tracked) {
    if (/(^|\/)tests?\//.test(f) || f.startsWith("node_modules/")) continue;
    let src; try { src = readFileSync(join(ROOT, f), "utf8"); } catch { continue; }
    src.split("\n").forEach((ln, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(ln)) return;                       // prose about a terminal is not one
      if (/state\s*[:=]\s*"cancelled"/.test(ln)) out.push({ file: f, line: i + 1, text: ln.trim() });
    });
  }
  return out;
}

test("#1090 every site that writes a CANCELLED terminal states why — none of them nulls the reason", (ctx) => {
  const sites = cancelSites();
  if (!sites) return ctx.skip(NO_CORPUS);
  assert.ok(sites.length >= 4,
    `found ${sites.length} cancel site(s) — four were measured at the time this was written, so a smaller `
    + "number means the scan stopped seeing them, not that they were removed");

  // A site is an offender if the SAME statement sets reason to null. Read across the statement rather
  // than the line: three of the four wrap, and a line-local rule would have called them all clean.
  const offenders = [];
  for (const s of sites) {
    const src = readFileSync(join(ROOT, s.file), "utf8").split("\n");
    const window = src.slice(Math.max(0, s.line - 3), s.line + 3).join(" ");
    if (/reason\s*[:=]\s*null/.test(window)) offenders.push(`${s.file}:${s.line}  ${s.text.slice(0, 88)}`);
  }
  assert.deepEqual(offenders, [],
    `${offenders.length} site(s) write a cancelled terminal with a null reason:\n  ${offenders.join("\n  ")}\n\n`
    + `A reader holding status.json alone — which is what the portal and every metrics reader hold — cannot `
    + `tell a deliberate stop from a crash. Build the value with stopReason() from shared/stop-reason.mjs, `
    + `passing only what the site actually knows.`);
});

test("#1090 the builder and the reader agree, and the reader rejects what is not a stop", () => {
  // ONE PREFIX, TWO USERS. A writer that composes the string and a reader that matches it by hand are two
  // copies of one rule, and they drift. This pins that they are the same rule.
  assert.ok(isStopReason(stopReason()), "the reader does not recognise the builder's own output");
  assert.ok(isStopReason(stopReason({ stage: "assess", via: "mcp/stop_run", by: "someone" })));
  assert.ok(stopReason().startsWith(STOP_REASON_PREFIX));
  // And the negative side, which is the half that makes the field readable at all.
  for (const notAStop of [null, undefined, "", "engine returned no artifact", "timed out after 600s"])
    assert.equal(isStopReason(notAStop), false, `a non-stop reason read as a stop: ${JSON.stringify(notAStop)}`);
});

test("#1090 the builder states only what it was given — it never invents a door or an actor", () => {
  // The four sites know different things: the MCP path knows who asked and through which door, the
  // pipeline paths know the interrupted stage, the runner's parked path knows neither. A builder that
  // padded the missing parts would make a status.json claim provenance nobody recorded, which is the
  // defect class this issue belongs to one level up.
  const bare = stopReason();
  assert.equal(bare, STOP_REASON_PREFIX, `an empty call invented detail: ${JSON.stringify(bare)}`);
  // Matched on the TAIL after the prefix, never on the whole string: the prefix itself contains "by"
  // ("stopped by request"), so a naive /by / matches every value the builder ever returns and the arm
  // passes on nothing. Caught by this test failing on its own first run.
  const tail = (v) => v.slice(STOP_REASON_PREFIX.length);
  assert.doesNotMatch(tail(stopReason({ stage: "parked" })), /\bvia\b|\bby\b/,
    "a stage-only stop named a door or an actor it was not given");
  assert.match(stopReason({ by: "someone" }), /by someone/);
  // Blank-but-present values are the same as absent — an empty string must not render "via ".
  assert.equal(stopReason({ via: "   ", by: "" }), STOP_REASON_PREFIX);
});
