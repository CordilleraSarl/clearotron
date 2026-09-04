// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// publish/publish-inputs.mjs — WHICH RUN-SIDE STORES publishReport READS, AND WHAT AN ABSENT ONE MEANS.
//
// — the class this repo names as its most expensive and enforced nowhere: an absence taking the
// success path. publish/index.mjs read findings.json as `if (existsSync(fjPath)) { … }` with NO else
// arm, so a run whose findings.json was never written arrived at evaluateClientGate with findings=[],
// coverage=[] and findingsError=null — byte-for-byte the shape of a search that ran and found nothing.
// The report was built from nothing and nothing anywhere recorded it. The two empties have to stop
// being the same artifact, and the only way that survives the next store being added is a CLOSED table
// plus a helper that refuses to read anything the table does not name.
//
// THREE STATES, NEVER TWO. `read` (present and parsed), `damaged` (present, unreadable or unparseable)
// and `absent` (not there) are three different facts about a delivery input. Collapsing `absent` into
// the same empty as `read` is the defect; collapsing it into `damaged` would be a lie in the other
// direction (a run that never wrote the file is not a run whose file rotted). It is the three-state
// contract the publication gate held before it was retired into tests at — pass, fail, and COULD
// NOT RUN, never folded into two — carried to the seam where a run becomes a client artifact.
//
// Modelled on mcp-server/lib/coverage.mjs:65-75 (assertValidatorCoverage): a closed partition asserted
// at LOAD, so a new store cannot be added without consciously choosing its gating. The failure that
// mechanism exists to prevent is 's — a hand-copied mirror that silently stopped covering an
// artifact and still answered "complete: yes" about a file it never checked.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// THE CLOSED TABLE. Keys are run-dir-relative store paths exactly as publishReport joins them; values
// are the gating. `required` means an absent one is recorded as a gate reason (the report is being
// built without an input it was supposed to have); `optional` means absent is legitimate and is
// RECORDED but does not close.
//
// EVERY STORE IS `optional` TODAY, AND THAT IS A DELIBERATE RULING, NOT AN OVERSIGHT — see the
// required/optional note below. The closing arm in evaluateClientGate consequently cannot fire on any
// live path: it is a tripwire for the first store ruled `required`, not a check that does work today.
// What DOES work today is the recording half, which fires on every absent store, optional included.
//
// ON findings.json SPECIFICALLY. It is the run's per-finding machine contract and the most consumed
// artifact there is, so `required` is the intuitive call. It is the wrong one HERE, and the reason is
// already written down one layer out: mcp-server/lib/coverage.mjs:38-41 marks the same artifact
// `optional` "only because archived pre-Phase-1 runs predate the file and must not retro-read as
// incomplete". Publish faces that verbatim and worse — report-registry.mjs:41-58 republishRun ALWAYS
// passes findingsJson, and pool-admin's rerenderAll re-publishes EVERY run in the pool, so "the caller
// named a path that is not there" cannot tell a live run from an archived republish. Marking it
// required would stamp clientGate.released:false onto archived client work on the next re-render. The
// blast radius is not measurable from a dev box (no pool here, and the production pool is real client
// matter that must not be touched to answer a design question), so this takes the option that does not
// rewrite the status of delivered work and records the absence instead.
export const PUBLISH_INPUTS = {
  // The per-finding machine contract driving the data-driven report + workbook. See the note above.
  "findings.json": "optional",
  // WP-receipts W2 — the fetch-receipt index. Legacy runs have none and render byte-identically.
  "_driver/receipts.json": "optional",
  // WP-receipts W3/W4 — senior-right rows; absent on legacy runs ⇒ no code-added open items.
  "_driver/senior-rights.json": "optional",
  // D1 — the code-carried verdict + clamp reasons. Absent on every pre-A2 archived run.
  "_driver/verdict.json": "optional",
  // doc 50 — the frozen band vocabulary. Present on band-doctrine runs only, by design.
  "_driver/framework.json": "optional",
  // T6 (D4) — the frozen register plan; the render falls back to the coverage prose without it.
  "_driver/register-plan.json": "optional",
  // The instructed scope, read only as the register plan's fallback for the searched-jurisdiction set.
  "_driver/instructed-scope.json": "optional",
  // T7 (E5) — the grounded case-law profiles. A run with no case-law layer legitimately has none.
  "case-law-findings.md": "optional",
  // T7 (E6) — Corsearch enforcement telemetry; presentation-only, absent ⇒ no lines.
  "_driver/enforcer-signals.json": "optional",
  // The predelivery lint sink — failing ids for the gate + the record-fetch failure list.
  "_driver/predelivery-lint.json": "optional",
  // D1 — load-bearing escalations that did not complete.
  "_driver/escalation-state.json": "optional",
  // The reasoning-integrity receipts that ride the audit workbook.
  "_driver/reasoning-integrity.json": "optional",
  // A1 — the corrective pass's stale-findings attestation.
  "_driver/corrections-state.json": "optional",
  // The run's own status: markName for the pool copy, and the machine-ledger note for the workbook.
  "status.json": "optional",
  // The FROZEN product shape (level/recipe/attribution). Every run older than the level registry lacks it.
  "_driver/search-policy.json": "optional",
  // The common-law grid, for the URL-join that rescues an anchor term. Absent ⇒ token-join only.
  "common-law-grid.json": "optional",
  // spec 62 — the frozen project/profile stamp carried into the pool.
  "_driver/profile.json": "optional",
};

// The other half of the partition, and the half without which this check could only run one way. These
// are run-side inputs publishReport genuinely reads, but NOT through readStore — they are not one
// name-keyed file, so a helper that joins a base to a filename cannot express them. They are declared
// here so the source scan in publish-input-coverage.test.mjs has a home for every read it finds, rather
// than a hole that a future store could hide in.
export const NOT_READ_BY_NAME = {
  "_records/": "a DIRECTORY of fetched register records, read through registry-fidelity.mjs readRecordArtifacts(runDir); an empty map is the documented back-compat no-op, not an absence to gate on",
  "token-ledger": "the per-recipe token rollup, read through tokens.mjs rollupTokens(runDir) which walks the run's own telemetry; absent ⇒ the meta simply omits the tokens field",
};

// Neither of these is a run-side store, and both have been miscounted as one ('s own issue body
// lists audit.md among the stores publishReport reads). They are FUNCTION ARGUMENTS — publishReport is
// handed the two contract markdown paths by its caller and reads them from wherever it is told, so an
// absent one is the caller's error and already throws. Declared so the source scan can tell "argument"
// from "undeclared store" instead of demanding a gating for something that has none.
export const CALLER_SUPPLIED = {
  "report.md": "the reportMd ARGUMENT — read unconditionally at index.mjs:653; an unreadable one throws, which is correct (there is no report to publish)",
  "audit.md": "the auditMd ARGUMENT — existence-gated at index.mjs:942-943; a run with no audit markdown legitimately publishes without a workbook",
};

/**
 * Load-time gate, on the assertValidatorCoverage model (mcp-server/lib/coverage.mjs:64-73).
 *
 * Asserts the table is a well-formed closed partition: every gating is one of the two words, no store
 * is declared in more than one table, and no declaration is blank. It deliberately does NOT scan
 * publish/index.mjs's source — reading a 1472-line sibling on every import to answer a question that
 * only changes when someone edits the file is the wrong place for it; the dead-key/undeclared-store
 * half runs in publish-input-coverage.test.mjs against the real source, on the
 * dependency-repair.test.mjs:76-95 precedent.
 *
 * `tables` is injectable so the gate can be exercised against a partition nobody shipped, which is
 * otherwise unreachable from a test.
 */
export function assertPublishInputCoverage(
  inputs = PUBLISH_INPUTS, notByName = NOT_READ_BY_NAME, callerSupplied = CALLER_SUPPLIED,
) {
  const bad = Object.entries(inputs).filter(([, v]) => v !== "required" && v !== "optional");
  if (bad.length)
    throw new Error(`publish/publish-inputs.mjs: ${bad.map(([k, v]) => `${k}="${v}"`).join(", ")} — gating must be "required" or "optional". A store with no ruling is a store whose absence nobody decided about, which is the defect this table exists to make unrepresentable.`);
  const blank = [...Object.entries(notByName), ...Object.entries(callerSupplied)]
    .filter(([, v]) => typeof v !== "string" || !v.trim());
  if (blank.length)
    throw new Error(`publish/publish-inputs.mjs: ${blank.map(([k]) => k).join(", ")} declared out with no reason — the reason IS the declaration; without it the exclusion cannot be reviewed`);
  const names = [...Object.keys(inputs), ...Object.keys(notByName), ...Object.keys(callerSupplied)];
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  if (dupes.length)
    throw new Error(`publish/publish-inputs.mjs: ${[...new Set(dupes)].join(", ")} declared in more than one table — the partition must be closed AND disjoint, else the gating that applies depends on lookup order`);
}
assertPublishInputCoverage();

/**
 * Read one declared run-side store. THREE states, never two.
 *
 * Returns `{ name, path, state, raw, value, error }`:
 *   state 'read'    — the file is there; `raw` is its text and `value` its JSON.parse (null for .md)
 *   state 'damaged' — the file is there and could not be read or parsed; `error` says which
 *   state 'absent'  — the file is not there. NOT an empty read, and never again indistinguishable from one.
 *
 * `raw` is handed back on BOTH read and damaged because the callers that matter (findings.json's
 * strict→lenient cascade) parse the text themselves with a schema-aware parser, and a JSON.parse
 * verdict is not theirs to inherit.
 *
 * THE ANTI-ROT PROPERTY IS THE THROW, and it is at call time rather than in a CI scan on purpose: it
 * holds in production, not only when the suite runs. A store this table does not name cannot be read
 * through this helper at all, so adding one forces the gating decision instead of defaulting it.
 */
export function readStore(base, name, { path: override = null } = {}) {
  if (!(name in PUBLISH_INPUTS))
    throw new Error(`readStore("${name}") — publish/publish-inputs.mjs does not declare that store. Add it to PUBLISH_INPUTS with a gating ("required" or "optional") and a reason, or to NOT_READ_BY_NAME/CALLER_SUPPLIED if it is not a name-keyed run-side file. A store read without a declared gating is an absence nobody ruled on.`);
  const path = override ?? join(base, ...name.split("/"));
  if (!existsSync(path)) return { name, path, state: "absent", raw: null, value: null, error: null };
  let raw;
  try { raw = readFileSync(path, "utf8"); }
  catch (e) { return { name, path, state: "damaged", raw: null, value: null, error: String(e?.message ?? e) }; }
  if (!name.endsWith(".json")) return { name, path, state: "read", raw, value: null, error: null };
  try { return { name, path, state: "read", raw, value: JSON.parse(raw), error: null }; }
  catch (e) { return { name, path, state: "damaged", raw, value: null, error: String(e?.message ?? e) }; }
}

// The subset of an absent-store list that CLOSES the gate. Exported so evaluateClientGate and its
// declared mirror (assembleReleaseInputs) cannot drift on the question of what "required" means —
// the divergence between those two is exactly what was.
export const requiredAbsent = (names = []) =>
  (Array.isArray(names) ? names : []).filter((n) => PUBLISH_INPUTS[n] === "required");
