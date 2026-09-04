// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Pure tests for the §B2-aligned intake classification (validateJob) and the refless slug (deriveSlug).
// The contract under guard (change-spec v3 §B2): the ONLY content blockers are mark-identity-unresolvable
// and classes+goods BOTH absent (either one suffices). A missing TMP reference NEVER blocks — warning +
// noref slug. Hard "reject" is reserved for jobs we can't run or even reply to (id / msgId / forwarder).
import { test } from "node:test";
import { pinEnvAll } from "../../shared/env-aliases.mjs";   // — a spread carries EVERY spelling, so an override must clear every spelling
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { validateJob } from "../enqueue-schema.mjs";
import { deriveSlug } from "../phase0.mjs";

const FULL = {
  id: "msg-1", msgId: "<msg-1@x>", forwarder: "staff-a",
  ref: "TMP9001", markName: "QUEUE PROBE", classes: [9],
};

// validateJob NORMALIZES IN PLACE, so handing it the shared FULL const stamps that const for every test
// after this one — the geography stamp inherited by a `{ ...FULL }` two hundred lines below reads as a
// door decision nobody made. Copied at every call site here for that reason; the mutation itself is
// asserted where it belongs, on objects a test owns.
test("full job → ok, classify run, no warnings", () => {
  const v = validateJob({ ...FULL });
  assert.deepEqual([v.ok, v.classify, v.errors.length, v.warnings.length], [true, "run", 0, 0]);
});

test("refless job → ok:true with a proceed-with-default warning (§B2: ref never blocks)", () => {
  const { ref, ...job } = FULL;
  const v = validateJob(job);
  assert.equal(v.ok, true);
  assert.equal(v.classify, "run");
  // — the owner's wording. "a refless slug" named an internal artefact at a reader
  // who has no idea a slug exists; the warning is the driver's and the UI shows it verbatim, so the
  // string changed HERE rather than being translated at one of the two surfaces that print it.
  assert.match(v.warnings.join(" "), /proceeding with no reference/);
  assert.doesNotMatch(v.warnings.join(" "), /refless slug/, "the internal word is gone from what a reader sees");
});

test("markless job → clarify (subject unresolvable)", () => {
  const { markName, ...job } = FULL;
  const v = validateJob(job);
  assert.equal(v.classify, "clarify");
  assert.match(v.errors.join(" "), /missing mark name/);
});

test("§B2 either-suffices: goods-only runs; classes-only runs; both absent → clarify", () => {
  const { classes, ...noClasses } = FULL;
  assert.equal(validateJob({ ...noClasses, goods: "energy drinks" }).classify, "run", "goods alone suffices");
  assert.equal(validateJob({ ...noClasses, use: "beverage brand for sports drinks" }).classify, "run", "use text counts as goods");
  assert.equal(validateJob({ ...FULL }).classify, "run", "classes alone suffices");
  const v = validateJob(noClasses);
  assert.equal(v.classify, "clarify");
  assert.match(v.errors.join(" "), /classes AND goods/);
});

test("marks[] alone satisfies mark + classes", () => {
  const { markName, classes, ...job } = FULL;
  job.marks = [{ ref: "TMP9001", name: "QUEUE PROBE", classes: [9] }];
  assert.equal(validateJob(job).classify, "run");
});

test("a NAMELESS marks[] entry is not a search subject → clarify (review-confirmed edge)", () => {
  const { markName, classes, ...job } = FULL;
  job.marks = [{ ref: "TMP9001", classes: [9] }];   // ref+classes but no name
  const v = validateJob(job);
  assert.equal(v.classify, "clarify");
  assert.match(v.errors.join(" "), /missing mark name/);
  job.marks = [{ ref: "TMP9001", name: "", classes: [9] }];  // empty-string name is equally nameless
  assert.equal(validateJob(job).classify, "clarify");
});

test("D2 intake binding: unresolved applicant (customerUnknown) is NEVER blocking — runs on defaults with a warning", () => {
  const v = validateJob({ ...FULL, customerUnknown: true });
  assert.equal(v.classify, "run", "a missing applicant must not block — a clearance can always run without one");
  assert.equal(v.ok, true);
  assert.match(v.warnings.join(" "), /unresolved applicant|own filing, disregard/);
  assert.equal(v.errors.length, 0);
});

test("D2: customerUnknown runs the same with OR without instructions (applicant is non-blocking)", () => {
  assert.equal(validateJob({ ...FULL, customerUnknown: true, upfrontInstructions: "Standard EU+US search." }).classify, "run");
  assert.equal(validateJob({ ...FULL, customerUnknown: true, deliverableSpec: "summary email, no table" }).classify, "run");
  // WITH instructions there is no "proceeding on defaults" warning; bare-defaults customerUnknown carries it
  assert.equal(validateJob({ ...FULL, customerUnknown: true, upfrontInstructions: "x" }).warnings.join(" ").includes("proceeding on defaults"), false);
  // a resolved applicant (customerUnknown false/absent) is unaffected
  assert.equal(validateJob({ ...FULL, customerUnknown: false }).classify, "run");
  assert.equal(validateJob({ ...FULL }).classify, "run");
  // a non-boolean customerUnknown is treated as unset (warning), never a clarify
  assert.equal(validateJob({ ...FULL, customerUnknown: "maybe" }).classify, "run");
});

test("D4.1 profileKey: a known customer ACCOUNT runs; a typo/unknown key clarifies; omitted is fine (⇒ generic)", () => {
  assert.equal(validateJob({ ...FULL, profileKey: "aurora" }).classify, "run", "a real customer key resolves");
  assert.equal(validateJob({ ...FULL, profileKey: "zephyr" }).classify, "run");
  const v = validateJob({ ...FULL, profileKey: "zeffyr" });   // misspelling the intake AI should not produce
  assert.equal(v.classify, "clarify");
  assert.match(v.errors.join(" "), /names no known customer/);
  assert.equal(validateJob({ ...FULL }).classify, "run", "no profileKey ⇒ generic, never blocks");
});

test("D4.1: the refusal NAMES the roster it checked, so a wrong profiles directory is visible from the message", () => {
  // THE INCIDENT THIS PINS (2026-07-22). The portal's trigger door was running without
  // CLEAROTRON_CUSTOMERS_DIR, so loadProfiles silently fell back to the bundled demo roster and refused a
  // real customer. The message said "names no known customer" — which points at the customer, and the
  // customer was fine. Reading the roster back distinguishes the two cases at a glance: your customers
  // listed means the key is wrong, four demo ones means the DIRECTORY is wrong.
  const v = validateJob({ ...FULL, profileKey: "sim-praxis" });
  assert.equal(v.classify, "clarify");
  const msg = v.errors.join(" ");
  assert.match(msg, /the roster this process can see is \[/);
  assert.match(msg, /aurora/, "the roster is enumerated, not merely alluded to");
  assert.match(msg, /CLEAROTRON_CUSTOMERS_DIR/, "and the variable to check is named");
});

test("spec 62 projectKey: a known project under its customer runs; unknown/unscoped/wrong-customer clarifies; omitted runs on the customer profile", () => {
  // the shipped aurora/console-ecosystem overlay resolves under its customer
  assert.equal(validateJob({ ...FULL, profileKey: "aurora", projectKey: "console-ecosystem" }).classify, "run", "a real project under its customer resolves");
  // absent ⇒ runs on the customer profile, no project warning ("nothing in between")
  const none = validateJob({ ...FULL, profileKey: "aurora" });
  assert.equal(none.classify, "run");
  assert.ok(!none.warnings.some((w) => /project/i.test(w)), "absent projectKey adds no warning");
  // a valid-but-unknown project under a real customer ⇒ clarify (never a silent drop to the customer on a paid run)
  const bad = validateJob({ ...FULL, profileKey: "aurora", projectKey: "no-such-project" });
  assert.equal(bad.classify, "clarify");
  assert.match(bad.errors.join(" "), /no known project under this customer/);
  // a projectKey with no named customer (⇒ generic) ⇒ clarify (a project needs a customer to scope it)
  assert.equal(validateJob({ ...FULL, projectKey: "console-ecosystem" }).classify, "clarify");
  // the console-ecosystem project belongs to aurora, not zephyr ⇒ clarify under the wrong customer
  assert.equal(validateJob({ ...FULL, profileKey: "zephyr", projectKey: "console-ecosystem" }).classify, "clarify");
});

test("missing id / forwarder / non-object → reject; reject outranks clarify", () => {
  for (const drop of ["id", "forwarder"]) {
    const job = { ...FULL };
    delete job[drop];
    assert.equal(validateJob(job).classify, "reject", drop);
  }
  assert.equal(validateJob(null).classify, "reject");
  assert.equal(validateJob("nope").classify, "reject");
  assert.equal(validateJob({ id: "x" }).classify, "reject", "no msgId/forwarder AND no mark → still reject");
});

// Hotfix 2026-07-06 (The Quiet Trail, WhatsApp intake): missing msgId rejects ONLY when no reply
// path exists at all — with forwarderEmail/forwarder present, delivery composes fresh ( ladder).
test("missing msgId: runs with a warning when a reply path exists; rejects only with NO reply path", () => {
  const noMsg = { ...FULL };
  delete noMsg.msgId;
  const r = validateJob(noMsg);
  assert.equal(r.classify, "run", "forwarderEmail present ⇒ the fresh-compose reply lane exists");
  assert.ok(r.warnings.some((w) => /no msgId/.test(w)), JSON.stringify(r.warnings));
  const noPath = { ...FULL };
  delete noPath.msgId; delete noPath.forwarder; delete noPath.forwarderEmail;
  assert.equal(validateJob(noPath).classify, "reject", "no msgId AND no forwarder/email ⇒ genuinely unanswerable");
});

test("deriveSlug: refed jobs are byte-identical to before", () => {
  assert.equal(deriveSlug(FULL), "tmp9001-queue-probe");
  assert.equal(deriveSlug({ tmp: "8552", markName: "Satin & Steel" }), "tmp8552-satin-steel");
});

test("deriveSlug: refless = noref<6-hex>-<mark>, deterministic per id, distinct across ids", () => {
  const a1 = deriveSlug({ id: "msg-a", markName: "MATCHDAY" });
  const a2 = deriveSlug({ id: "msg-a", markName: "MATCHDAY" });
  const b = deriveSlug({ id: "msg-b", markName: "MATCHDAY" });
  assert.match(a1, /^noref[0-9a-f]{6}-matchday$/);
  assert.equal(a1, a2, "stable across webhook re-delivery / resume (same id → same slug)");
  assert.notEqual(a1, b, "same mark, different request → different slug (no collision)");
});

// Repair-first phase 3 — the teal-causeway msgId defect: a 32-hex sanitized hash is not a Graph id.
test("msgId: a 32-hex sanitized hash warns loudly (reply-to-thread will fail) but never blocks the run", () => {
  const base = { id: "x", forwarder: "requester", markName: "M", classes: [9] };
  const hashed = validateJob({ ...base, msgId: "AC4353CE369A086BAD4E598FE31EA16A" });
  assert.equal(hashed.ok, true);
  assert.equal(hashed.classify, "run");
  assert.ok(hashed.warnings.some((w) => /32-hex sanitized hash/.test(w)), JSON.stringify(hashed.warnings));
  const graphId = validateJob({ ...base, msgId: "AAMkAGI2TAAA=" });
  assert.ok(!graphId.warnings.some((w) => /32-hex/.test(w)), "a real Graph id never warns");
});

// ---- search-depth spine: the two selectors + route + lineage ---------------------------------------

test("spine: an unknown product CLARIFIES (never silently runs a different-priced product)", () => {
  const v = validateJob({ ...FULL, product: "knock" });
  assert.equal(v.ok, false);
  assert.equal(v.classify, "clarify");
  assert.match(v.errors.join(" "), /names no search we offer/);
  assert.equal(validateJob({ ...FULL, product: "global-preliminary-search" }).ok, true, "a known level validates");
  assert.equal(validateJob({ ...FULL, product: "knockout-search" }).ok, true, "level KNOWLEDGE is schema's job; availability is the runner gate's");
});

test("spine: both selectors set CLARIFIES; a malformed recipeKey CLARIFIES; an unknown recipe CLARIFIES", () => {
  const both = validateJob({ ...FULL, product: "global-preliminary-search", recipeKey: "quick" });
  assert.equal(both.classify, "clarify");
  assert.match(both.errors.join(" "), /name ONE selector/);
  const malformed = validateJob({ ...FULL, recipeKey: "Not A Slug" });
  assert.equal(malformed.classify, "clarify");
  assert.match(malformed.errors.join(" "), /not a recipe slug/);
  const ghost = validateJob({ ...FULL, recipeKey: "no-such-recipe" });
  assert.equal(ghost.classify, "clarify");
  assert.match(ghost.errors.join(" "), /names no saved search/);
});

test("the name limit is the OFFERING's, on every product, and it REFUSES rather than truncating", () => {
  const marks = (n) => Array.from({ length: n }, (_, i) => ({ name: `MARK-${i}` }));
  assert.equal(validateJob({ ...FULL, product: "knockout-search", marks: marks(8) }).ok, true);
  const over = validateJob({ ...FULL, product: "knockout-search", marks: marks(9) });
  assert.equal(over.classify, "clarify");
  assert.match(over.errors.join(" "), /9 names exceeds the 8-name limit/);
  // A CLEARANCE IS BUDGETED TOO. It always said one name and was never enforced, so a three-name
  // clearance was accepted here and ran one with the other two silently dropped.
  const clearance = validateJob({ ...FULL, product: "global-preliminary-search", marks: marks(3) });
  assert.equal(clearance.classify, "clarify");
  assert.match(clearance.errors.join(" "), /order a Knockout search to screen them together/, "the way through is named");
  assert.equal(validateJob({ ...FULL, marks: marks(21) }).ok, true,
    "no explicit product ⇒ no schema-side budget (the runner re-budgets on the RESOLVED product)");
});

test("spine: batch marks sharing a research key clarify at intake (kebab collision would share ONE payload)", () => {
  const collide = validateJob({ ...FULL, product: "knockout-search", marks: [{ name: "MOTO X" }, { name: "MOTO-X" }] });
  assert.equal(collide.classify, "clarify");
  assert.match(collide.errors.join(" "), /spacing\/punctuation\/case/);
  const dup = validateJob({ ...FULL, product: "knockout-search", marks: [{ name: "ALPHA" }, { name: "ALPHA" }] });
  assert.equal(dup.classify, "clarify", "exact duplicates clarify too");
  assert.equal(validateJob({ ...FULL, product: "knockout-search", marks: [{ name: "ALPHA" }, { name: "BETA" }] }).ok, true);
});

test("spine: deliveryRoute is a closed enum; a malformed parentRunId warns (treated as unset), never blocks", () => {
  assert.equal(validateJob({ ...FULL, deliveryRoute: "portal" }).ok, true);
  assert.equal(validateJob({ ...FULL, deliveryRoute: "email" }).ok, true);
  const bad = validateJob({ ...FULL, deliveryRoute: "carrier-pigeon" });
  assert.equal(bad.classify, "clarify");
  assert.match(bad.errors.join(" "), /must be "email" or "portal"/);
  const lineage = validateJob({ ...FULL, parentRunId: "nova-2026-07-17-cedar-x" });
  assert.equal(lineage.ok, true);
  const weirdJob = { ...FULL, parentRunId: "../escape" };
  const weird = validateJob(weirdJob);
  assert.equal(weird.ok, true, "lineage is optional garnish — never blocks");
  assert.match(weird.warnings.join(" "), /does not look like a runId/);
  assert.ok(!("parentRunId" in weirdJob), "'treating as unset' must MEAN unset — the malformed value is deleted (review 2026-07-17)");
});

test("spine: a path-shaped id REJECTS at the shared validator (all doors inherit the queue-filename hardening)", () => {
  for (const id of ["../escaped-job", "a/b", "..", ".hidden"]) {
    const v = validateJob({ ...FULL, id });
    assert.equal(v.classify, "reject", `id ${id}`);
    assert.match(v.errors.join(" "), /bare filename slug/);
  }
  assert.equal(validateJob({ ...FULL, id: "AAMkAGI2-example.msg@id_x".replace("_", "-") }).ok, true, "legacy sanitized ids still pass");
});

// ── per-run scope (jurisdictions / platforms / classes) ────────────────────────────────────────────────
// Scope says WHERE the machinery points. All of it CLARIFIES rather than warns, because each of these can
// be wrong in a way that yields a confident report about the wrong thing without announcing itself.

test("scope: jurisdictions ride the job, and a bare string becomes an array at the door", () => {
  assert.equal(validateJob({ ...FULL, jurisdictions: ["US", "EU"] }).classify, "run");
  // stages.mjs accepts a bare string; jx-lanes.mjs tests Array.isArray and silently falls back to the
  // profile's defaults for anything else. A string-valued job would frame on one territory and deepen on
  // another set, and nothing would say so. One shape at the door is what stops that.
  const job = { ...FULL, jurisdictions: "US" };
  assert.equal(validateJob(job).classify, "run");
  assert.deepEqual(job.jurisdictions, ["US"]);
});

test("scope: jurisdictions dedupe case-insensitively, first spelling wins, and the mutation is real", () => {
  const job = { ...FULL, jurisdictions: ["US", "us", "  EU  ", "eu"] };
  const v = validateJob(job);
  assert.equal(v.classify, "run");
  assert.deepEqual(job.jurisdictions, ["US", "EU"], "trimmed, deduped, and normalized IN PLACE for every consumer");
  assert.match(v.warnings.join(" "), /more than once/);
});

test("scope: a malformed or oversized jurisdictions list clarifies — it never silently searches the wrong place", () => {
  const many = validateJob({ ...FULL, jurisdictions: Array.from({ length: 21 }, (_, i) => `J${i}`) });
  assert.equal(many.classify, "clarify");
  assert.match(many.errors.join(" "), /max 20 per search/);
  for (const bad of [[""], ["X"], ["  "], [null], ["x".repeat(41)]]) {
    const v = validateJob({ ...FULL, jurisdictions: bad });
    assert.equal(v.classify, "clarify", `jurisdictions ${JSON.stringify(bad)}`);
    assert.match(v.errors.join(" "), /2–40 characters/);
  }
  assert.equal(validateJob({ ...FULL, jurisdictions: { us: true } }).classify, "clarify", "an object is not a territory list");
  // The cap counts what would be SEARCHED, so it runs after the worldwide token is partitioned out: 20
  // real territories plus a "Worldwide" the door is about to discard was refused as 21 — a number the
  // requester cannot reconcile with the list they sent (review 2026-07-27).
  const capped = { ...FULL, jurisdictions: [...Array.from({ length: 20 }, (_, i) => `J${i}`), "Worldwide"] };
  const ok = validateJob(capped);
  assert.equal(ok.classify, "run", JSON.stringify(ok.errors));
  assert.equal(capped.jurisdictions.length, 20, "the token is discarded, not counted");
  const over = validateJob({ ...FULL, jurisdictions: [...Array.from({ length: 21 }, (_, i) => `J${i}`), "Worldwide"] });
  assert.equal(over.classify, "clarify");
  assert.match(over.errors.join(" "), /names 21 territories \(max 20 per search\)/, "the count names the real territories only");
});

test("scope: jurisdictions stay prose-tolerant — codes and names both run", () => {
  // Every consumer either uppercases (jx-lanes) or renders as prose (matter-frame); none needs ISO codes,
  // so requiring them here would refuse requests the engine runs perfectly well.
  assert.equal(validateJob({ ...FULL, jurisdictions: ["United Kingdom", "European Union"] }).classify, "run");
});

test("scope: the worldwide tokens are a MODE, never a list entry — recorded at the door, in every spelling", () => {
  // The bogus-territory framing this closes: a literal "Worldwide" reached scopeTerritories as a
  // territory NAMED "WORLDWIDE" (register-plan already read the token as "no region restriction"), which
  // framed as scope, routed no deepening lane, and counted as one territory against the deep-dive rule.
  //
  // Coming off the list is only half of it. It used to leave NOTHING — a job byte-identical to one that
  // never mentioned geography, which then fell through to the account's default territories. The token
  // now becomes the geography MODE, which is where "everywhere" survives as an instruction.
  for (const token of ["Worldwide", "worldwide", "GLOBAL", "global", "all", "  All  "]) {
    const job = { ...FULL, jurisdictions: [token] };
    const v = validateJob(job);
    assert.equal(v.classify, "run", `${token} is a runnable request, not a clarify`);
    assert.ok(!("jurisdictions" in job), `${token} must leave NO territory restriction behind`);
    assert.deepEqual(job.geography, { mode: "worldwide", origin: "request" }, `${token} is recorded as a worldwide request`);
    assert.match(v.warnings.join(" "), /worldwide is not a list entry/);
    assert.match(v.warnings.join(" "), /no territory restriction/);
  }
});

// ── the geography stamp ─────────────────────────────────────────────────────────────────────────────
// THE distinction this door could not make: "search everywhere" and "I said nothing about where" were
// the same bytes on the wire, and they resolve to different searches. Everything below is that one fact.

test("geography: asking for worldwide and saying nothing are DIFFERENT stored requests", () => {
  const everywhere = { ...FULL, jurisdictions: ["Worldwide"] };
  const silent = { ...FULL };
  assert.equal(validateJob(everywhere).classify, "run");
  assert.equal(validateJob(silent).classify, "run");
  // Same jurisdictions field — absent on both. The mode is the only thing that tells them apart, which
  // is exactly why it had to exist.
  assert.ok(!("jurisdictions" in everywhere) && !("jurisdictions" in silent));
  assert.notEqual(everywhere.geography.mode, silent.geography.mode);
  assert.equal(everywhere.geography.mode, "worldwide");
  assert.equal(silent.geography.mode, "account-default");
});

test("geography: naming territories stamps `named`, and the origin says the requester supplied them", () => {
  const job = { ...FULL, jurisdictions: ["France", "Germany"] };
  assert.equal(validateJob(job).classify, "run");
  assert.deepEqual(job.geography, { mode: "named", origin: "request" });
  // A region is a named geography like any other — the tier is a question for the rules, not the stamp
  const region = { ...FULL, jurisdictions: ["European Union"] };
  validateJob(region);
  assert.equal(region.geography.mode, "named");
});

test("geography: a named territory beside a worldwide token is NAMED — the token was the noise", () => {
  const job = { ...FULL, jurisdictions: ["Worldwide", "France"] };
  const v = validateJob(job);
  assert.equal(v.classify, "run");
  assert.deepEqual(job.jurisdictions, ["France"]);
  assert.equal(job.geography.mode, "named", "the request restricts to France; it is not a worldwide search");
});

test("geography: AN ABSENT STAMP MEANS 'this job predates the field' — and is never filled in at claim", () => {
  // THE backwards-compatibility rule, and the one that must not rot. A job queued or archived before the
  // stamp existed has no record of what its requester asked for about geography. That fact is
  // unrecoverable, so the claim path must not manufacture it: stamping an old job "account-default"
  // would be a positive statement nobody made, and would read forever after as if the requester had
  // chosen it. `atClaim` is the discriminator — a door reads a request, the runner reads a stored file.
  const old = { ...FULL };                       // no geography, no jurisdictions: an archived shape
  const v = validateJob(old, { atClaim: true });
  assert.equal(v.classify, "run", "an old job still runs — this is not a rejection");
  assert.ok(!("geography" in old), "the claim path invented no geography for a job that recorded none");
  // the same job at a DOOR is a live request, and is stamped
  const fresh = { ...FULL };
  validateJob(fresh);
  assert.equal(fresh.geography.mode, "account-default");
  // an old job that DID name territories keeps them, still unstamped — its territories were never in doubt
  const oldNamed = { ...FULL, jurisdictions: ["France"] };
  validateJob(oldNamed, { atClaim: true });
  assert.deepEqual(oldNamed.jurisdictions, ["France"], "normalization still runs at claim");
  assert.ok(!("geography" in oldNamed));
});

test("geography: a stamp a door states explicitly is believed, and checked", () => {
  const named = { ...FULL, jurisdictions: ["France"], geography: { mode: "named", origin: "saved-search" } };
  assert.equal(validateJob(named).classify, "run");
  assert.deepEqual(named.geography, { mode: "named", origin: "saved-search" }, "an origin a door knows is not overwritten");
  // origin defaults per mode when a door states only the mode
  const bare = { ...FULL, geography: { mode: "worldwide" } };
  validateJob(bare);
  assert.deepEqual(bare.geography, { mode: "worldwide", origin: "request" });
  for (const bad of [{ mode: "everywhere" }, { mode: null }, {}, { mode: "named", origin: "the-vibes" }]) {
    const v = validateJob({ ...FULL, jurisdictions: ["France"], geography: bad });
    assert.equal(v.classify, "clarify", `geography ${JSON.stringify(bad)} must not pass`);
  }
  for (const bad of ["worldwide", ["worldwide"], 7]) {
    const v = validateJob({ ...FULL, geography: bad });
    assert.equal(v.classify, "clarify", `geography ${JSON.stringify(bad)} is not an object`);
    assert.match(v.errors.join(" "), /must be an object/);
  }
});

test("geography: worldwide AND named territories is a contradiction the door refuses to resolve silently", () => {
  // A worldwide search accepts no narrowing at all. Picking one side quietly is the failure the stamp
  // exists to end, so a door that sends both is told, rather than having one of its two answers dropped.
  const v = validateJob({ ...FULL, jurisdictions: ["France"], geography: { mode: "worldwide" } });
  assert.equal(v.classify, "clarify");
  assert.match(v.errors.join(" "), /worldwide search is not narrowed/);
  assert.match(v.errors.join(" "), /"France"/, "the message names what it found");
  // and the mirror: claiming named territories while sending none
  const none = validateJob({ ...FULL, geography: { mode: "named" } });
  assert.equal(none.classify, "clarify");
  assert.match(none.errors.join(" "), /no territories in jurisdictions/);
});

test("scope: named territories WIN over a worldwide token, and the requester is told which", () => {
  const job = { ...FULL, jurisdictions: ["Worldwide", "France"] };
  const v = validateJob(job);
  assert.equal(v.classify, "run");
  assert.deepEqual(job.jurisdictions, ["France"], "the named territory is the instruction; the token is noise");
  // Echoed JSON-stringified, the rule the entry errors above already follow: a clarify rides reason files,
  // outbox packets and log lines, and a newline-bearing territory must not forge a row in any of them.
  assert.match(v.warnings.join(" "), /the named territories win \(searching "France"\)/);
  // prose-tolerance survives: the surviving entries are NOT canonicalized to codes here
  const two = { ...FULL, jurisdictions: ["United States", "global", "Japan"] };
  validateJob(two);
  assert.deepEqual(two.jurisdictions, ["United States", "Japan"]);
  // and the dedupe still runs first — one token twice is still just a cleared token
  const dupes = { ...FULL, jurisdictions: ["Worldwide", "worldwide"] };
  const dv = validateJob(dupes);
  assert.ok(!("jurisdictions" in dupes));
  assert.match(dv.warnings.join(" "), /more than once/);
});

test("scope: per-run platforms are ADDITIVE and carry the profile's own domain rules", () => {
  assert.equal(validateJob({ ...FULL, platforms: ["gnc.com", "iherb.com"] }).classify, "run");
  const web = validateJob({ ...FULL, platforms: ["web"] });
  assert.equal(web.classify, "clarify");
  assert.match(web.errors.join(" "), /general-web cell is implicit/, "the same message a profile load gives — one rule, one wording");
  assert.equal(validateJob({ ...FULL, platforms: ["not a domain"] }).classify, "clarify");
  assert.equal(validateJob({ ...FULL, platforms: ["gnc.com", "GNC.com"] }).classify, "clarify", "duplicates inflate the grid floor");
  const many = validateJob({ ...FULL, platforms: Array.from({ length: 11 }, (_, i) => `s${i}.example.com`) });
  assert.equal(many.classify, "clarify");
  assert.match(many.errors.join(" "), /max 10 per search/);
  assert.equal(validateJob({ ...FULL, platforms: "gnc.com" }).classify, "clarify", "a bare string is not a platform list");
});

test("scope: Nice classes are range-checked HERE — the browser was the only thing checking them", () => {
  // compose.ts was the single 1–45 check anywhere in the stack; the server did map(Number).filter(isFinite),
  // so 0, 99 and -3 all reached the engine. A wrong class searches the wrong register quietly.
  for (const bad of [0, 46, 99, -3, 9.5]) {
    const v = validateJob({ ...FULL, classes: [9, bad] });
    assert.equal(v.classify, "clarify", `class ${bad}`);
    assert.match(v.errors.join(" "), /whole numbers 1–45/);
  }
  assert.equal(validateJob({ ...FULL, classes: [1, 34, 35, 45] }).classify, "run", "the whole legitimate range runs");
  assert.equal(validateJob({ ...FULL, classes: "9,41" }).classify, "clarify", "a string is not a class list");
});

test("scope: a batch cannot smuggle a bad class past the top-level check", () => {
  const { classes, ...job } = FULL;
  const v = validateJob({ ...job, product: "knockout-search", marks: [{ name: "ALPHA", classes: [9] }, { name: "BETA", classes: [46] }] });
  assert.equal(v.classify, "clarify");
  assert.match(v.errors.join(" "), /BETA.*whole numbers 1–45/s);
});

test("scope: an unreadable deadline warns and is ACTUALLY unset; a bare date reads as end of that day", () => {
  // Nothing downstream validated this: a malformed value flowed into the envelope arithmetic and came out
  // as a confidently wrong turnaround. Handled like parentRunId — never blocks, says so, and really unsets.
  const badJob = { ...FULL, deadline: "next tuesday" };
  const bad = validateJob(badJob);
  assert.equal(bad.ok, true, "a date typo must not stop a runnable search");
  assert.match(bad.warnings.join(" "), /not a date we can read/);
  assert.ok(!("deadline" in badJob), "'treating as unset' must MEAN unset");
  const dateOnly = { ...FULL, deadline: "2026-06-20" };
  assert.equal(validateJob(dateOnly).ok, true);
  assert.equal(dateOnly.deadline, "2026-06-20T23:59:59.000Z", "a bare calendar date is the END of that day, not its first second");
  const iso = { ...FULL, deadline: "2026-06-20T17:00:00Z" };
  assert.equal(validateJob(iso).ok, true);
  assert.equal(iso.deadline, "2026-06-20T17:00:00Z", "a well-formed stamp is left exactly as given");
});

test("scope: a quick screen takes territories but not marketplaces — the half it cannot act on clarifies", () => {
  // TERRITORIES: accepted since 2026-07-20. The old refusal mistook a DEFAULT for a property of the
  // product — scope and depth are two axes of one scale, so "global" is the widest setting of a knob and
  // not a fact about Depth 1. The sweep prompt renders the named territories (knockout-units.test.mjs).
  const jx = validateJob({ ...FULL, product: "knockout-search", jurisdictions: ["US"] });
  assert.equal(jx.classify, "run");
  assert.deepEqual(jx.errors, []);
  // MARKETPLACES: still refused, and the asymmetry is real. A knockout has no marketplace grid for a
  // store to be added to — its sweep is one broad question per mark — so a named platform would be
  // recorded in the sidecar and swept by nothing. That is the silent no-op deliveryRoute:"portal" forbids.
  const plat = validateJob({ ...FULL, product: "knockout-search", platforms: ["gnc.com"] });
  assert.equal(plat.classify, "clarify");
  assert.match(plat.errors.join(" "), /no marketplace grid/);
  // and the same request against the machinery that can act on it runs
  assert.equal(validateJob({ ...FULL, product: "multi-country-focus-search", jurisdictions: ["US", "FR"], platforms: ["gnc.com"] }).classify, "run");
  assert.equal(validateJob({ ...FULL, product: "knockout-search" }).classify, "run", "a plain quick screen is untouched");
});

// ── the other half of D4.1: a customer named in prose with no account key ────────────────────────────
//
// resolveProfile is asymmetric. A WRONG key throws loudly — it refuses to fall back to generic because
// that "would drop the customer's platforms, self-exclusion seed and the framework that RATES the matter".
// A MISSING key returns generic in silence. Both produce the same wrong deliverable; only one says so.
//
// It has already happened: a paid Zephyr Beverages clearance was rated on the house default scale because the
// request named the customer in prose and left the account field empty. A person noticed hours later.

test("A NAMED ACCOUNT WITH NO KEY CLARIFIES — the rating scale is not a thing to guess at", () => {
  const v = validateJob({ ...FULL, customer: "Petcary" });
  assert.equal(v.classify, "clarify");
  assert.match(v.errors[0], /names an account we hold/);
  assert.match(v.errors[0], /GENERIC DEFAULT scale/, "says what would otherwise happen (term ruled, tracker issue 1990)");
  assert.match(v.errors[0], /profileKey:"petcary"/, "and exactly how to fix it");
});

test("…and it is not fooled by case, spacing or a longer legal name", () => {
  for (const customer of ["petcary", "Petcary ", "  PETCARY", "Petcary Ltd", "Petcary Holdings Ltd"])
    assert.equal(validateJob({ ...FULL, customer }).classify, "clarify", `${JSON.stringify(customer)} still names our account`);
});

test("A THIRD-PARTY SEARCH RUNS UNTOUCHED — this is the false positive that would have cost us daily work", () => {
  // The whole reason the check keys on the ROSTER rather than on "customer present, key absent". A firm
  // asking us to clear a mark for their own client sends exactly that shape, and the applicant deliberately
  // never selects a profile — a third-party search must never inherit a customer's exclusions.
  for (const customer of ["Acme Industrial", "Nordvale Foods", "Zed", "Petcarysson"])
    assert.equal(validateJob({ ...FULL, customer }).classify, "run", `${customer} is nobody we hold — it runs`);
});

test("an explicit key always wins — including one that disagrees with the prose", () => {
  // Intake's judgment is the source of truth (D4.1). If it stamped a key, this check has nothing to add:
  // the key is validated on its own terms two blocks up.
  assert.equal(validateJob({ ...FULL, customer: "Petcary", profileKey: "petcary" }).classify, "run");
  assert.equal(validateJob({ ...FULL, customer: "Petcary", profileKey: "zephyr" }).classify, "run",
    "a deliberate cross-binding is intake's call, not this gate's");
});

test("no customer named ⇒ nothing to be ambiguous about", () => {
  for (const customer of [undefined, null, "", "   "])
    assert.equal(validateJob({ ...FULL, customer }).classify, "run", `${JSON.stringify(customer)} runs`);
});

test("it is NOT an authorisation check — nothing here asks who the requester is", () => {
  // Stated as a test because the framing matters and was corrected once already. The question is which
  // rulebook to rate under, not whether the sender is entitled to act for the customer. Same forwarder,
  // same domain, same everything: only the named customer decides the outcome.
  const same = { forwarder: "anyone", forwarderDomain: "wherever.example" };
  assert.equal(validateJob({ ...FULL, ...same, customer: "Acme Industrial" }).classify, "run");
  assert.equal(validateJob({ ...FULL, ...same, customer: "Petcary" }).classify, "clarify");
});

test("a roster it cannot read never blocks intake — fail-open, like the key check above it", () => {
  // Run in a CLEAN PROCESS, with the bad directory set before anything loads. loadProfiles memoises, so
  // pointing the env var at a broken path mid-test reaches a cache, not the filesystem, and would certify
  // a fail-open that had never been exercised. (That is how this test first passed while proving nothing —
  // it did not; it failed, which is what sent me to look.)
  const script = `
    const { validateJob } = await import(${JSON.stringify(new URL("../enqueue-schema.mjs", import.meta.url).href)});
    const v = validateJob({ id:"m1", msgId:"<m1@x>", forwarder:"sam", markName:"PROBE", classes:[9], customer:"Petcary" });
    console.log(v.classify);
  `;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    env: pinEnvAll({ ...process.env }, { CLEAROTRON_CUSTOMERS_DIR: "/nonexistent/profiles/dir" }),
  });
  assert.equal(r.status, 0, `child exited ${r.status}: ${r.stderr?.slice(0, 300)}`);
  assert.equal(r.stdout.trim(), "run", "infrastructure trouble is not the requester's problem");
});

test("`generic` is never the account it points at", () => {
  // The house profile is not a customer, and "House default" must never be offered as the key to set.
  const v = validateJob({ ...FULL, customer: "House default" });
  assert.equal(v.classify, "run", "the house profile is not an account anyone is bound to");
});

test("A NAME THAT CONTAINS OURS ALSO CLARIFIES — stated, because it is a real consequence", () => {
  // "Petcary Labs" may well be an unrelated company. It still clarifies, because word-boundary containment
  // is what applicantMatchesProfile does, and it is the same comparison the own-rights guard already uses
  // to decide whether an applicant IS the profile's customer. Consistency with that beats a cleverer
  // matcher here: the outcome is a question, not a refusal, and the answer takes one word from a person.
  // If this ever becomes noisy in practice, the fix is a narrower matcher — not silently rating the run on
  // the wrong scale, which is where this started.
  assert.equal(validateJob({ ...FULL, customer: "Petcary Labs" }).classify, "clarify");
  assert.equal(validateJob({ ...FULL, customer: "Petcarysson" }).classify, "run",
    "…but containment is word-boundary, so a name that merely starts with the same letters runs");
});
