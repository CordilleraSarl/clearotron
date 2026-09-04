// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — the §B2 scoping gate resolves the subject the way the RUN resolves it.
//
// The defect: creating a knockout through the portal with a project selected — where the project carries
// the classes — was refused at the door with "missing classes AND goods description (either one
// suffices)". The requester was being asked to restate classes the selected project already owns, and the
// refusal was not a true statement about the run.
//
// FIRST QUESTION, WHICH DECIDES THE SHAPE OF THE FIX: do classes actually inherit at run time? They do,
// and this file pins the two places that prove it, because if they ever stop the gate's new leniency
// becomes a silent mis-scope rather than a correction:
//
//   · stages.mjs applies `profile.defaultClasses` when "the request names none" — and its own comment
//     says that predicate MIRRORS this gate's, which is how the two drifted apart in the first place.
//   · effective-scope.mjs resolves request → saved search → project → account, and stamps which layer won.
//
// So the door was the only layer that had never heard of the ladder. Shape 1 in the issue: teach the gate,
// do not move the problem to the cockpit.
//
// Its own file because profiles.mjs freezes PROFILE_DIR from CLEAROTRON_CUSTOMERS_DIR at module load, so the
// env has to be set before enqueue-schema.mjs is imported — the same reason
// enqueue-schema-archived-project.test.mjs is separate. Synthetic customers and projects only; no real
// client name appears here.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

const dir = mkdtempSync(join(tmpdir(), "enqueue-classes-"));
writeFileSync(join(dir, "generic.json"), JSON.stringify({ name: "House default", platforms: ["amazon.com"] }));
// A customer WITH default classes, and one WITHOUT — the two sides of the gate.
writeFileSync(join(dir, "classy.json"), JSON.stringify({
  name: "Classy Instruments", matchDomains: ["classy.example"], platforms: ["alibaba.com"], defaultClasses: [9, 42],
}));
writeFileSync(join(dir, "bare.json"), JSON.stringify({
  name: "Bare Holdings", matchDomains: ["bare.example"], platforms: ["alibaba.com"],
}));
mkdirSync(join(dir, "projects", "bare"), { recursive: true });
mkdirSync(join(dir, "projects", "classy"), { recursive: true });
// The issue's exact scenario: the CUSTOMER names no classes, the PROJECT does.
writeFileSync(join(dir, "projects", "bare", "wearables.json"), JSON.stringify({
  projectName: "Wearables launch", defaultClasses: [14, 25],
}));
writeFileSync(join(dir, "projects", "bare", "no-classes.json"), JSON.stringify({ projectName: "Unscoped engagement" }));
// A project that OVERRIDES its customer's classes — replace semantics, pinned so the gate reports the
// layer that actually wins rather than the first one it finds.
writeFileSync(join(dir, "projects", "classy", "narrowed.json"), JSON.stringify({
  projectName: "Narrowed engagement", defaultClasses: [42],
}));
pinEnv(process.env, "CLEAROTRON_CUSTOMERS_DIR", dir);

const HERE = dirname(fileURLToPath(import.meta.url));
// No classes, no marks[].classes, no goods, no use — the shape the portal sent.
const UNSCOPED = { id: "msg-1", msgId: "<msg-1@x>", forwarder: "staff-a", ref: "TMP9001", markName: "QUEUE PROBE", product: "knockout-search" };

let validateJob;
before(async () => { ({ validateJob } = await import("../enqueue-schema.mjs")); });

// ── the premise: classes really do inherit downstream ─────────────────────────────────────────────────
test("#707 the premise — the run itself inherits classes, so the door refusing them was wrong", () => {
  // Read rather than restated. If either of these stops being true, the gate below is admitting jobs the
  // engine will run unscoped, and this test is where that gets caught.
  const stages = readFileSync(join(HERE, "..", "stages.mjs"), "utf8");
  assert.match(stages, /Customer-default classes \(the request names none — apply these\)/,
    "stages.mjs must still apply profile.defaultClasses when the request names none");
  const scope = readFileSync(join(HERE, "..", "effective-scope.mjs"), "utf8");
  assert.match(scope, /nonEmpty\(profile\?\.defaultClasses\)\) \{ classes = profile\.defaultClasses/,
    "effective-scope.mjs must still carry the account/project rung of the class ladder");
});

// ── the gate, admitting what the run can scope ────────────────────────────────────────────────────────
test("#707 a knockout under a project that carries the classes is ADMITTED", () => {
  const v = validateJob({ ...UNSCOPED, profileKey: "bare", projectKey: "wearables" });
  assert.equal(v.ok, true, `the issue's exact request must run; errors were: ${JSON.stringify(v.errors)}`);
  assert.equal(v.classify, "run");
  assert.ok(!v.errors.some((e) => /missing classes AND goods/.test(e)), "the §B2 refusal must be gone");
});

test("#707 admitting it is not the same as doing it quietly — the run says which layer scoped it", () => {
  // D4.1: never silently run a different search than the one that was asked for. The requester typed no
  // classes, so the fact that some other layer supplied them is a thing they are entitled to see. A gate
  // that just stopped refusing would trade a visible wrong answer for an invisible one.
  const v = validateJob({ ...UNSCOPED, profileKey: "bare", projectKey: "wearables" });
  const w = v.warnings.join(" | ");
  assert.match(w, /no classes or goods in the request/, "the absence is recorded, not swallowed");
  assert.match(w, /14, 25/, "…with the classes the run will actually use");
  assert.match(w, /this project/, "…and the LAYER they came from, the way geography records its origin");
});

test("#707 the customer profile is a rung too, and it names itself as the account's", () => {
  const v = validateJob({ ...UNSCOPED, profileKey: "classy" });
  assert.equal(v.ok, true, `a customer default is as good a scope as a project's; errors: ${JSON.stringify(v.errors)}`);
  const w = v.warnings.join(" | ");
  assert.match(w, /9, 42/);
  assert.match(w, /the account's default classes/, "an account default must not claim to be a project's");
});

test("#707 the project WINS over its customer — the warning must name the layer that decides the search", () => {
  // classes REPLACE across the overlay (profiles.mjs: only platforms union). A warning that reported the
  // customer's 9, 42 here would be telling the requester the run searches classes it will not search.
  const v = validateJob({ ...UNSCOPED, profileKey: "classy", projectKey: "narrowed" });
  assert.equal(v.ok, true);
  const w = v.warnings.join(" | ");
  assert.match(w, /class(es)? 42\b/, "the project's narrowed list is what runs");
  assert.ok(!/\b9, 42\b/.test(w), "the customer's wider list must not be reported as the scope");
  assert.match(w, /this project/);
});

// ── the gate, still refusing what nothing can scope ───────────────────────────────────────────────────
test("#707 a genuinely unscopable request is still refused — and now says what it consulted", () => {
  const v = validateJob({ ...UNSCOPED, profileKey: "bare", projectKey: "no-classes" });
  assert.equal(v.ok, false, "no classes anywhere, no goods: the subject cannot be scoped");
  assert.equal(v.classify, "clarify", "the fix is a question back to the requester, not a rejection");
  const e = v.errors.join(" | ");
  assert.match(e, /missing classes AND goods description \(either one suffices\)/, "the original sentence stays");
  assert.match(e, /"bare"/, "…and it now names the customer profile it looked in");
  assert.match(e, /"no-classes"/, "…and the project, so the requester knows where to put them");
});

test("#707 a customer with no defaults at all is refused, naming the profile", () => {
  const v = validateJob({ ...UNSCOPED, profileKey: "bare" });
  assert.equal(v.ok, false);
  assert.match(v.errors.join(" | "), /consulted the customer profile "bare"/);
});

// ── the paths that must not have changed ──────────────────────────────────────────────────────────────
test("#707 a request that states its own classes is untouched — no profile is even loaded", () => {
  const v = validateJob({ ...UNSCOPED, classes: [30] });
  assert.equal(v.ok, true);
  assert.ok(!v.warnings.some((x) => /no classes or goods in the request/.test(x)),
    "a request that named its own classes must not be told they came from somewhere else");
});

test("#707 goods still suffice on their own, with no classes anywhere", () => {
  const v = validateJob({ ...UNSCOPED, profileKey: "bare", projectKey: "no-classes", goods: "handheld diagnostic instruments" });
  assert.equal(v.ok, true, "§B2 is classes OR goods, and that is unchanged");
});

test("#707 marks[].classes still count as the request's own", () => {
  const v = validateJob({ ...UNSCOPED, marks: [{ name: "QUEUE PROBE", classes: [9] }] });
  assert.equal(v.ok, true);
  assert.ok(!v.warnings.some((x) => /no classes or goods in the request/.test(x)));
});

test("#707 the gate holds at CLAIM as well as at intake — same ladder both times", () => {
  // validateJob runs twice (runner.mjs re-validates on pickup). A gate that inherited at intake and not at
  // claim would park an admitted job as .failed on the runner's own second look.
  const v = validateJob({ ...UNSCOPED, profileKey: "bare", projectKey: "wearables" }, { atClaim: true });
  assert.equal(v.ok, true, `an admitted job must survive its own re-validation; errors: ${JSON.stringify(v.errors)}`);
});
