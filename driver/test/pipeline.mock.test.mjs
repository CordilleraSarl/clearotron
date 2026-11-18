// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the whole mock clearance pipeline, intake to delivery packet: the screen gate, customer profiles, receipts and the repairs at the verdict gate
// Offline driver dry-run against a mock engine (no billable calls). The shared harness is pipeline-mock-harness.mjs.
import { ARCHIVED, JOB, PROFILES_SEED, findFile, runPipeline, stageOrder, studioRootOf } from "./pipeline-mock-harness.mjs";
import { test } from "node:test";
import { driverSource } from "./driver-source.mjs";
import { refusalsFor } from "../synthesis-record.mjs";
import assert from "node:assert/strict";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { acceptRegisterDigest, emptyFacts } from "../register-digest-record.mjs";   // conversion 11 — the refusal that removed the live unnamed-drop shape

// ── screen-gate REPAIR-OR-DISCLOSE, NEVER BLOCK e2e (2026-06-18) ──────────────────────────────────────
// The gate no longer hard-halts. An in-scope-live goods drop that was never record_fetched triggers a
// DRIVER code-fetch of THAT URI (deterministic, no model-compliance dependency); the digest re-decides on
// the now-fetched goods; whatever STILL can't be retrieved is DISCLOSED + clamps the verdict + DELIVERS.
// (live, 2026-06-17: 3 in-scope marks were genuinely never fetched, the generic re-digest
// re-ran byte-identical, and the old gate hard-halted a production run twice. A report must always ship.)

test("screen-gate REPAIRS: an in-scope-live goods drop without a record_fetch → DRIVER targeted code-fetch + re-decide on real goods → run PROCEEDS clean", async () => {
  // The first register-digest drops a live, in-scope (Class 42) mark off-field on a name-inferred goods guess
  // WITHOUT record_fetching it — a Finding-1 violation (its URI is in no ledger/_records). The driver fetches
  // THAT URI in code, then the digest re-decides on the REAL goods (the corrected drop:off-field-confirmed
  // row); the gate clears and the run delivers.
  const fetched = [];
  const recordFetcher = async (uri) => { fetched.push(uri); return { ok: false, cause: "mock no-op (re-decide path)" }; };
  const { res, events } = await runPipeline(
    { MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_SCREEN_DROP: "1" }, {}, { recordFetcher });
  assert.equal(res.ok, true, JSON.stringify(res));
  // the violation was detected and the DRIVER code-fetch chosen (not an immediate hard-halt), targeting the URI
  assert.ok(events.some((e) => e.event === "screen-gate-violation" && e.action === "driver-refetch"
    && e.uris.includes("/mark/cn/88001-42")), "first violation → driver-refetch logged for the flagged URI");
  assert.ok(fetched.includes("/mark/cn/88001-42"), "the driver fetched the EXACT flagged URI (targeted, not a generic re-digest)");
  // spec-66: the re-decide queues for the settlement flush (durable receipt) instead of firing its own
  // pass; the mechanism discloses TRANSIENTLY (at gate time the drop is still unexamined) and the
  // post-flush recheck heals it — sidecar cleared, clamp lifted. A healed gap must not keep clamping.
  assert.ok(events.some((e) => e.event === "digest-queued" && e.trigger === "screen-gate"), "screen-gate minted a durable digest receipt");
  assert.ok(events.some((e) => e.event === "stage" && e.stage === "register-digest" && e.trigger === "settlement-flush"),
    "the settlement flush carried the re-decide");
  assert.ok(events.some((e) => e.event === "screen-gate-clean" && e.recovered === true), "post-flush gate clean (recovered)");
  assert.ok(!existsSync(driverDir(res.runDir, "screen-gate-unresolved.json")), "sidecar cleared once the flush healed the gap");
  assert.ok(!events.some((e) => String(e.action || "").startsWith("hard-halt")), "no hard-halt ever");
  assert.ok(existsSync(join(res.runDir, ".delivered")) || ARCHIVED.test(res.runDir), "run delivered, not killed");
});

test("screen-gate DISCLOSE-AND-CONTINUE (owner decision 2026-07-22): an in-scope drop whose record is UNRETRIEVABLE ships as an unexamined disclosure + CONDITIONAL — never a dead run", async () => {
  // MOCK_SCREEN_DROP=persist — the digest re-emits the SAME surface drop after the re-fetch (the model won't
  // self-correct) AND the driver code-fetch fails (record 404 / provider error). The gate can neither verify
  // nor repair the drop. Owner decision 2026-07-22 (reversing doc-41 fix-or-fail, which killed an ION run
  // over provider 404s that morning): the mark is marked UNEXAMINED — couldn't fetch — NOT failed. The run
  // continues, the report carries a per-mark coverage row, and the coverage floor clamps CLEAR→CONDITIONAL
  // so nobody relies on that mark as clean.
  const fetched = [];
  const recordFetcher = async (uri) => { fetched.push(uri); return { ok: false, cause: "record 404 (mock — unretrievable)" }; };
  const { res, events } = await runPipeline(
    { MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_SCREEN_DROP: "persist" }, {}, { recordFetcher });

  // the run DELIVERS — disclose-and-continue, never a dead run
  assert.equal(res.ok, true, `an unretrievable in-scope drop must no longer kill the run: ${JSON.stringify(res)}`);
  assert.ok(!existsSync(join(res.runDir, ".failed")), "no .failed sentinel");
  assert.ok(existsSync(join(res.runDir, ".delivered")) || ARCHIVED.test(res.runDir), "delivered");

  // the driver STILL attempts the TARGETED code-fetch FIRST (repair before disclosing)
  assert.ok(fetched.includes("/mark/cn/88001-42"), "driver code-fetched the flagged URI before disclosing");
  assert.ok(events.some((e) => e.event === "screen-gate-violation" && e.action === "driver-refetch"), "driver-refetch attempted first");

  // the irreducible gap is disclosed (action disclose-clamp), naming the unverifiable URI + cause
  const unresolved = events.find((e) => e.event === "screen-gate-unresolved" && e.action === "disclose-clamp");
  assert.ok(unresolved && unresolved.uris.includes("/mark/cn/88001-42"), "screen-gate-unresolved → disclose-clamp for the URI");
  assert.ok(unresolved.failures.some((f) => f.uri === "/mark/cn/88001-42" && /404/.test(f.cause)), "the fetch failure cause rides the event");
  assert.ok(!events.some((e) => e.event === "screen-gate-unresolved" && e.action === "fail-loud"), "the fail-loud arm is gone");

  // the durable sidecar carries the disclosure (a crash before delivery must not lose it)
  const sidecar = JSON.parse(readFileSync(driverDir(res.runDir, "screen-gate-unresolved.json"), "utf8"));
  assert.equal(sidecar.unresolved.length, 1);
  assert.equal(sidecar.unresolved[0].mark, "KINETIC");
  assert.equal(sidecar.unresolved[0].uri, "/mark/cn/88001-42");
  assert.match(sidecar.unresolved[0].cause, /404/);

  // the coverage floor clamped CLEAR→CONDITIONAL off the disclosure, naming the mark
  assert.equal(res.verdict, "CONDITIONAL", "verdict clamped — the unexamined mark cannot ship as clean");
  assert.ok(events.some((e) => e.event === "coverage-floor-clamp" && e.screenGate === 1), "screenGate floor arm fired");
  const verdictSidecar = JSON.parse(readFileSync(driverDir(res.runDir, "verdict.json"), "utf8"));
  assert.ok(verdictSidecar.reasons.some((r) => r.includes("KINETIC")), "the clamp reason names the mark");
  // …IN THE RUN RECORD ONLY (ruled 2026-09-18: cut the clause). The condition's clause is stored as null, so
  // the client's "conditional on:" list does not carry it, and the delivery check does not report it as a
  // clause that failed to compose. Nothing is written in its place; the coverage row below still names the mark.
  const { clientConditions, unrenderableConditions } = await import("../terminal-clamp.mjs");
  const at = verdictSidecar.reasons.findIndex((r) => /record_fetched/.test(r));
  assert.ok(at >= 0, "the run record keeps the screen-gate reason");
  assert.equal(verdictSidecar.clauses[at], null, "its client clause is stored as null — the run record's alone");
  assert.ok(!clientConditions(verdictSidecar).some((c) => /record_fetched|dropped on goods/.test(c)), "no client condition carries it");
  assert.deepEqual(unrenderableConditions(verdictSidecar).filter((r) => /record_fetched/.test(r)), [], "and it is not reported as a failed clause");

  // the reader-visible disclosure: one coverage-limited row naming the mark, never a silent pass
  const findings = JSON.parse(readFileSync(join(res.runDir, "findings.json"), "utf8"));
  const row = (findings.coverage ?? []).find((c) => String(c.area).includes("KINETIC"));
  assert.ok(row, "unexamined-drop coverage row injected");
  assert.equal(row.state, "coverage-limited", "coverage-limited (a disclosed limit — the clamp came from the floor, not this row)");
  assert.match(row.note, /could not be retrieved/);
  assert.match(row.note, /verify this record before relying/);
});

// ── CONVERSION 11 MADE THE UNNAMED DROP UNREACHABLE ON A LIVE RUN ──────────────────────────────────
//
// These two arms used to drive observe and enforce mode end to end through MOCK_SCREEN_DROP=unnamed —
// a goods-drop row naming no record, the ION/copper-foundry shape. That row cannot be produced any
// more: every `negative_rows` entry resolves a uri against the band or the call refuses
// `registerdigest_uri_missing`, so a typed digest CANNOT emit one. That is the conversion closing the
// hole on purpose — an unnamed bulk row is fourteen dismissals wearing one rationale — and it is why
// these are re-aimed rather than deleted.
//
// WHAT STILL PROTECTS THE ION INCIDENT, since none of it may be lost with the driving path:
//   · the refusal itself, pinned below — if it were ever relaxed, the live shape returns and these
//     arms should come back with it. Without this pin the unreachability is an accident.
//   · the mode filter's STRUCTURE, pinned below: one filter, one helper, both call sites. The ION bug
//     was precisely that the post-repair re-check called the raw helper, so observe mode held at the
//     first gate and not the second.
//   · detection of both unnamed classes, in screen-gate.test.mjs, driven over prose documents — which
//     is also the reachable population now: an ARCHIVED run written under the old dictation, whose
//     document the validator still parses.
//   · the disclose-clamp consequence, end to end, in the DISCLOSE-AND-CONTINUE arm above — it drives
//     the same unresolved path with a named-but-unretrievable record.
test("screen-gate: a typed digest CANNOT emit an unnamed goods-drop, and the run delivers", async () => {
  const recordFetcher = async () => ({ ok: false, cause: "mock no-op (re-decide path)" });
  const { res, events } = await runPipeline(
    { MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_SCREEN_DROP: "unnamed" }, {}, { recordFetcher });

  // The shape never arises, so the observe-mode ledger has nothing to log. Asserted as an ABSENCE with
  // its reason stated, never left implicit: a missing event and a rule that stopped running look the
  // same from here, and the refusal arm below is what tells them apart.
  assert.equal(events.find((e) => e.event === "screen-gate-unnamed-observed"), undefined,
    "no unnamed row can reach the gate on a typed run — the transport refuses it at the call");
  assert.equal(res.ok, true, `the run still delivers: ${JSON.stringify(res)}`);
  assert.notEqual(res.failedStage, "screen-gate");
});

test("screen-gate: the transport REFUSES an unnamed drop row by name — the reason the arms above changed", () => {
  // The pin that makes the unreachability deliberate instead of incidental. Driven, not asserted from
  // the schema: a row with a drop_reason and a ground but no uri.
  const v = acceptRegisterDigest(
    { findings_rows: [], incumbent_rows: [], negative_rows: [{ drop_reason: "bulk slice — off-field", ground: "off-field" }] },
    emptyFacts());
  assert.equal(v.ok, false);
  assert.match(v.reason, /registerdigest_uri_missing:negative_rows/,
    "a drop row that names no record is refused AT THE CALL — this is what removed the live unnamed shape");
});

test("screen-gate: one mode filter, one helper, BOTH gate checks — the ION property, pinned at the source", () => {
  // ION died because observe mode was applied to the FIRST checkScreenGate() and the post-repair
  // re-check called the helper raw. The cure was structural — every gate read goes through
  // `enforcedViolations`, which owns the filter — so this asserts the structure rather than a run,
  // WITH a control that fails if it is reading the wrong text.
  const SRC = driverSource("pipeline.mjs");
  const from = SRC.indexOf("const checkScreenGate = ()");
  // ANCHORED ON THE PROSE, NOT THE SPEC NUMBER. The end marker used to read "// spec-66: AFTER any
  // settlement/late flush"; the cut strips a spec reference out of a comment and left "//: AFTER any
  // settlement…", so indexOf returned -1. That is not an error — a negative `to` makes the slice run
  // backwards and return nothing, and every assertion below would then be reading an empty string. The
  // isolation control caught it, which is what it is for; the refusals now name which marker went.
  const to = SRC.indexOf("AFTER any settlement/late flush lands a digest", from);
  assert.notEqual(from, -1, "pipeline.mjs no longer declares checkScreenGate — the block has no start");
  assert.notEqual(to, -1, "the settlement/late-flush marker that bounds the screen-gate block is gone");
  assert.ok(from > 0 && to > from && to - from < 8000,
    `the screen-gate block was not isolated (${to - from} chars) — every arm here would pass or fail on the wrong text`);
  const block = SRC.slice(from, to);
  assert.match(block, /const enforcedViolations = \(\) => \{[\s\S]{0,200}?unnamedArmed \? v : v\.filter\(\(x\) => x\.uri\)/,
    "the mode filter lives in ONE wrapper, so it cannot be applied at one call site and not the other");
  // and the raw helper is reached only by the OBSERVATION site, which is not a gate.
  //
  // COMMENTS ARE STRIPPED BEFORE COUNTING, and the first cut of this arm was not: the paragraph above
  // the filter QUOTES `checkScreenGate()` raw while explaining the ION bug, so the count read 3 and the
  // arm failed on prose. A count over a corpus that includes its own commentary measures the commentary.
  const code = block.split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");
  const rawUses = [...code.matchAll(/checkScreenGate\(\)/g)].length;
  assert.equal(rawUses, 2, `expected exactly two raw uses in CODE — the observation ledger and the one `
    + `inside enforcedViolations; found ${rawUses}, so a third gate read may be bypassing the mode filter`);
});

// ── WS-B per-customer profiles e2e ───────────────────────────────────────────────────────────────────

test("WS-B sidecar: every run freezes _driver/profile.json (generic for example.com — neutral floor 4, dense batch 4)", async () => {
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced" });
  assert.equal(res.ok, true, JSON.stringify(res));
  const sidecar = JSON.parse(readFileSync(driverDir(res.runDir, "profile.json"), "utf8"));
  assert.equal(sidecar.profileKey, "generic");
  assert.equal(sidecar.minCellsPerVariant, 4);   // neutral generic: 3 cross-vertical platforms + web
  assert.equal(sidecar.batchSize, 4);            // dense budget (16) / floor 4
  assert.equal(sidecar.platforms.length, 3);
  assert.ok(events.some((e) => e.event === "profile" && e.key === "generic"), "profile freeze logged");
});

test("spec 62 sidecar: a project-bearing job freezes the PROJECT's marketplaces + floor (the grid dictation reads the overlay, not the customer)", async () => {
  // customer demo-brand-owner (6 gaming storefronts, its own framework) + the seeded japan-and-korea-app-launch overlay
  // (9 marketplaces) — see the CLEAROTRON_CUSTOMERS_DIR seed at the top of this file.
  const { res, root, events } = await runPipeline(
    { MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced" },
    { profileKey: "demo-brand-owner", projectKey: "japan-and-korea-app-launch" },
  );
  assert.equal(res.ok, true, JSON.stringify(res));
  const sidecar = JSON.parse(readFileSync(driverDir(res.runDir, "profile.json"), "utf8"));
  assert.equal(sidecar.profileKey, "demo-brand-owner", "profileKey stays the CUSTOMER");
  assert.equal(sidecar.projectKey, "japan-and-korea-app-launch");
  assert.equal(sidecar.projectName, "Japan and Korea app launch");
  // platforms UNION (2026-07-18): the customer's marketplaces are CLIENT-MANDATED and a project adds
  // to them rather than replacing them. Asserted as the SET relation against this harness's seeded
  // config (CLEAROTRON_CUSTOMERS_DIR), not a magic count — the count depends on how much the seeded
  // overlay overlaps its customer, and hardcoding it hid that the env var was being ignored.
  const seededCustomer = JSON.parse(readFileSync(join(PROFILES_SEED, "demo-brand-owner.json"), "utf8")).platforms;
  const seededProject = JSON.parse(readFileSync(join(PROFILES_SEED, "projects", "demo-brand-owner", "japan-and-korea-app-launch.json"), "utf8")).platforms;
  for (const p of seededCustomer) assert.ok(sidecar.platforms.includes(p), `client-mandated ${p} survives the project overlay`);
  for (const p of seededProject) assert.ok(sidecar.platforms.includes(p), `project-added ${p} is searched`);
  assert.equal(sidecar.platforms.length, new Set([...seededCustomer, ...seededProject]).size, "the UNION, deduped — never one list replacing the other");
  assert.equal(sidecar.minCellsPerVariant, sidecar.platforms.length + 1, "floor derived from the RESOLVED union (+ web)");
  assert.equal(sidecar.origins.platforms, "customer+project");
  assert.equal(sidecar.frameworkPath, "skills/clearance-search/risk-framework-demo.md", "the customer's framework still rates the matter");
  assert.ok(events.some((e) => e.event === "profile" && e.key === "demo-brand-owner" && e.project === "japan-and-korea-app-launch"), "the project is logged on the freeze event");

  // END-TO-END report surface: the injectFrontMatter(run_under_project/origins_json) → parseReport →
  // scopeSection/footer seam (the one path the hand-built render.test.mjs front-matter never exercises).
  const { config: poolCfg } = await import("../driver.config.mjs");
  const { dirname: pdir, basename: pbase } = await import("node:path");
  const internal = readFileSync(join(poolCfg.poolRoot, `${pbase(pdir(res.runDir))}-${pbase(res.runDir)}`, "report.html"), "utf8");
  assert.match(internal, /Run under project:\s*<span class="mono">Japan and Korea app launch \(Demo Brand Owner\)<\/span>/, "the internal report footer discloses the project");
  // THE ORIGIN TABLE IS OFF THE PAGE (the 2026-09-16 report redesign). It rendered inside the scope
  // fold, which the redesign deletes, and it was the one block in there labelled "(internal)" — the
  // same class as the reviewer notes that were ruled off the delivered page. It was never on export,
  // and its own comment always said it stays in the run's artifacts and the workbook.
  //
  // WHAT THIS ARM NOW DRIVES IS THE ROUND-TRIP, which is what it was really guarding: the front matter
  // still carries origins_json, so a reader who wants to know which layer set a knob can still find out
  // — from the record, not from a table on a client's report. Both halves, because asserting only the
  // absence would pass just as well if the run had stopped recording it.
  assert.doesNotMatch(internal, /Configuration provenance \(internal\)/, "the internal block is not drawn on the report");
  const reportMd = readFileSync(join(res.runDir, "report.md"), "utf8");
  const originsLine = /^origins_json:\s*(.+)$/m.exec(reportMd);
  assert.ok(originsLine, "the run no longer records which layer set each knob — the record lost it, not just the page");
  const originRows = JSON.parse(originsLine[1].trim().replace(/^['"]|['"]$/g, ""));
  assert.ok(Array.isArray(originRows) && originRows.length, "origins_json is present but empty");
  assert.ok(originRows.every((r) => r.field && r.origin), "every recorded row says which setting and which layer set it");
  // ONE report (spec 2026-07-30 §5): no client twin is ever written — the portal/client-access serve
  // the same report.html through readReport's serve-time preparation.
  assert.equal(findFile(root, "report.client.html"), null, "no report.client.html twin is published");
});

test("WS-B sidecar is authoritative on resume: a planted sidecar wins (write-if-absent) and logs profile-mismatch", async () => {
  const { res: r1 } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_FAIL_STAGE: "joint synthesis narrative", CLEAROTRON_RECOVERY_MAX: "1" });
  assert.equal(r1.ok, false);
  // simulate "profiles/ changed between run and resume": the sidecar carries a different key (same
  // floor/platforms so the validators behave identically — this pins WHICH source wins, not the floor)
  const sidecarPath = driverDir(r1.runDir, "profile.json");
  const planted = { ...JSON.parse(readFileSync(sidecarPath, "utf8")), profileKey: "custom-anchor" };
  const { writeFileSync: wf } = await import("node:fs");
  wf(sidecarPath, JSON.stringify(planted, null, 2));
  delete process.env.MOCK_FAIL_STAGE;
  const codename = r1.runDir.split(/[\\/]/).pop().split("-").slice(3).join("-");
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const r2 = await pipeline(JOB, { codename });
  assert.equal(r2.ok, true, JSON.stringify(r2));
  const events = readFileSync(driverDir(r2.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.ok(events.some((e) => e.event === "profile-mismatch" && e.sidecar === "custom-anchor" && e.resolved === "generic"),
    "resume reads the FROZEN sidecar and logs the divergence from the current profiles/");
  assert.equal(events.filter((e) => e.event === "profile").length, 1, "write-if-absent: the freeze happened exactly once");
  // r2 delivered → the run dir was archived; the sidecar rode along, still the planted one
  assert.equal(JSON.parse(readFileSync(driverDir(r2.runDir, "profile.json"), "utf8")).profileKey, "custom-anchor",
    "sidecar never overwritten");
});

test("WS-B corrupt sidecar: resume fails LOUDLY and never silently re-derives the frozen profile", async () => {
  const { res: r1 } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_FAIL_STAGE: "joint synthesis narrative", CLEAROTRON_RECOVERY_MAX: "1" });
  assert.equal(r1.ok, false);
  const sidecarPath = driverDir(r1.runDir, "profile.json");
  const { writeFileSync: wf } = await import("node:fs");
  wf(sidecarPath, "{corrupt");
  delete process.env.MOCK_FAIL_STAGE;
  const codename = r1.runDir.split(/[\\/]/).pop().split("-").slice(3).join("-");
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  await assert.rejects(() => pipeline(JOB, { codename }), /profile\.json is corrupt/);
  assert.equal(readFileSync(sidecarPath, "utf8"), "{corrupt", "the corrupt sidecar is evidence — never overwritten");
});

test("WS-B: a resume that finds stage work but no frozen profile is refused, never run profile-free or retro-minted", async () => {
  // A run froze its profile before its first stage, and a run from an earlier build is no longer resumed, so a run
  // with stage work and no profile has lost the record its work was done under. Running it profile-free read a missing
  // record as a deliberate order with no account; minting one now would claim the work was done under it. Refused.
  const { res: r1 } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_FAIL_STAGE: "joint synthesis narrative", CLEAROTRON_RECOVERY_MAX: "1" });
  assert.equal(r1.ok, false);
  const { rmSync } = await import("node:fs");
  rmSync(driverDir(r1.runDir, "profile.json"));
  delete process.env.MOCK_FAIL_STAGE;
  const codename = r1.runDir.split(/[\\/]/).pop().split("-").slice(3).join("-");
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  let r2;
  try { r2 = await pipeline(JOB, { codename }); } catch (e) { r2 = { ok: false, threw: String(e?.message ?? e) }; }
  assert.notEqual(r2.ok, true, JSON.stringify(r2));
  assert.ok(!existsSync(driverDir(r1.runDir, "profile.json")), "no profile minted under work already done");
  const said = [JSON.stringify(r2), readFileSync(join(r1.runDir, "status.json"), "utf8")].join("\n");
  assert.match(said, /holds stage work/, "the refusal says why");
});

// ── Hotfix 2026-07-06: a legacy slug store must never brick the matter ────────────────────────────────
test("a prior run's plan store is IGNORED — every run mints fresh, so a fixed defect cannot ride along", async () => {
  // The Drivers Haven 2026-07-18 failure, pinned. A stale plan for the same matter used to be
  // REUSED or append-only EXTENDED, and `extendRegisterPlan` never removed an entry. So the run
  // compiled a clean form band, then dispatched the previous run's poisoned OR-stack anyway
  // (`source:"extended", added:11`) and died on the identical gate, five identical diacritic terms,
  // identical 424 hits. Any defect that ever reached a plan was immortal for that matter — which
  // meant a shipped fix could never be verified on the matters we re-run to verify fixes.
  //
  // The store is seeded here with entries a fresh compile would NEVER produce. None may appear.
  const seed = (root) => {
    // One binding for the fixture's customer slug, and the reason is not tidiness: written inline beside
    // `job_key`, the secret scanner reads a keyword next to a high-entropy literal and calls it a
    // credential. The inline gitleaks:allow held only while the file was short enough for the scanner's
    // window to keep the comment and the match together; adding tests moved that boundary and the
    // suppression stopped being seen. Naming the value once puts the literal nowhere near the keyword.
    const fixtureSlug = "tmp9077-novapulse";
    const plansDir = join(root, "workspace-intake-agent", "studio", "clearance-search", fixtureSlug, "_plans");
    mkdirSync(plansDir, { recursive: true });
    writeFileSync(join(plansDir, "register-plan.v1.json"), JSON.stringify({
      schema_version: 1, plan_version: 1,
      derived_from: { job_key: fixtureSlug, variants_fingerprint: "fnv1a:legacy:0", skill_version: "pre-split" },
      nice_classes: ["9", "41"], regions: [],
      entries: [{ qid: "primary-sweep:exact:poisoned+form", axis: "primary-sweep", predicate: "exact",
        terms: ["novapulsè", "novapulsé", "novapulsê", ...Array.from({ length: 674 }, (_, i) => `LEGACY${i}`)],
        expected_kind: "enumerate", nice_classes: ["9"], regions: [] }],
    }, null, 2) + "\n");
  };
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced" }, { ref: "TMP9077", id: "plan-store-ignored-job" }, { seed });
  assert.equal(res.ok, true, JSON.stringify(res));

  const planEvt = events.find((e) => e.event === "register-plan");
  assert.equal(planEvt?.source, "minted", "a fresh run MINTS — it never reuses or extends a prior run's plan");

  // the decisive assertion: not one stale term reaches the dispatched plan
  const plan = JSON.parse(readFileSync(driverDir(res.runDir, "register-plan.json"), "utf8"));
  const allTerms = plan.entries.flatMap((e) => e.terms ?? [e.term]).filter(Boolean);
  assert.ok(!allTerms.some((t) => String(t).startsWith("LEGACY")), "no seeded legacy term survives into the run's plan");
  assert.ok(!allTerms.some((t) => /[^\x00-\x7F]/.test(String(t)) && String(t).startsWith("novapuls")),
    "no seeded diacritic duplicate survives — the exact Drivers Haven shape");
  assert.ok(!plan.entries.some((e) => e.qid.includes("poisoned")), "the seeded qid is absent entirely");
  assert.ok(!events.some((e) => e.event === "failed"), "the run completed");
});

// ── WP-receipts W3/W4: the senior-right closure ("verify the right that matters") ─────────────────────
test("senior-right closure: the SENIOR leg of a multi-leg family gets the ONE redirect fetch — verified, no open item", async () => {
  // The VENZY shape: the finding's fetched basis is the junior US 2020 leg; the family also holds a
  // senior TR 2009 live registration (screen-dated on the register index, never fetched by any stage).
  // The closure ranks in code, fetches EXACTLY the senior leg once, and the card carries no open item.
  const fetched = [];
  // the fetcher writes where the DRIVER told it to (`recordLog`, this run's `_driver/`), which is
  // what the real plugin chokepoint does now. Pinning a path here would test a wiring nothing uses.
  const recordFetcher = async (uri, { sessionKey, recordLog }) => {
    fetched.push(uri);
    mkdirSync(dirname(recordLog), { recursive: true });
    writeFileSync(recordLog, JSON.stringify({ ts: "2026-07-06T00:00:00Z", sessionKey, target: uri,
      body: { applicationDate: "2009-10-14", registrationDate: "2011-11-30", statusText: "Valid", jurisdiction: "TR", classList: ["9"] } }) + "\n");
    return { ok: true };
  };
  const { res, root, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
    MOCK_MULTI_LEG: "1" }, {}, { recordFetcher });
  assert.equal(res.ok, true, JSON.stringify(res));
  // THE REDIRECT IS THE GUARANTEE, AND ITS PRIMACY IS WHAT SAYS SO. This read `deepEqual(fetched,
  // ["/mark/tr/2009-53984"])` — one fetch, the senior leg. The closure now also pulls the records the
  // FINDINGS cite (ruled 2026-09-26: a register that publishes no record page prints no address in the
  // report, so the findings are the second source), and this fixture's finding cites both legs, so the
  // junior one arrives too. The count moved; the guarantee did not.
  //
  // So the assertion moved to the thing the arm is FOR: the senior leg is fetched, and it is fetched
  // FIRST, because the ranking happens in code before any citation is followed. Relaxing this to "at
  // least one fetch" would have kept it green and stopped protecting the redirect, which is the only
  // reason the arm exists.
  assert.equal(fetched[0], "/mark/tr/2009-53984", "the senior leg is not the FIRST fetch — the closure ranked after following a citation, or not at all");

  // AND THE REST IS THE CITATION CLOSURE, NOTHING ELSE. The junior leg is read off the delivered findings
  // rather than written here, so this cannot pass against a hard-coded address and fails if the fixture's
  // citation moves. Every fetch is accounted for: one redirect, then each cited record once.
  const { findingUris } = await import("../record-carry.mjs");
  const delivered = JSON.parse(readFileSync(join(res.runDir, "findings.json"), "utf8"));
  const cited = [...findingUris(delivered.findings ?? []).keys()];
  assert.ok(cited.includes("/mark/tr/2009-53984") && cited.length === 2,
    `guard: this fixture's finding should cite both legs, and cites ${JSON.stringify(cited)}`);
  assert.deepEqual([...fetched].sort(), [...new Set(cited)].sort(), "a record was fetched that nothing cited, or a cited record was fetched twice");
  const sr = JSON.parse(readFileSync(driverDir(res.runDir, "senior-rights.json"), "utf8"));
  assert.equal(sr.rows.length, 1);
  assert.equal(sr.rows[0].seniorUri, "/mark/tr/2009-53984");
  assert.equal(sr.rows[0].verified, true);
  assert.ok(events.some((e) => e.event === "senior-rights" && e.verified === 1 && e.open === 0));
  // poolRoot is frozen at the process's FIRST driver.config import — resolve it via the cached module
  const { config: poolCfg } = await import("../driver.config.mjs");
  const { dirname: pdir, basename: pbase } = await import("node:path");
  const html = readFileSync(join(poolCfg.poolRoot, `${pbase(pdir(res.runDir))}-${pbase(res.runDir)}`, "report.html"), "utf8");
  assert.doesNotMatch(html, /Open item:/, "a verified senior right carries no open item");
});

test("senior-right closure: an UNREACHABLE senior right → plain-English open item on the card; run still delivers (open-item policy)", async () => {
  const recordFetcher = async () => ({ ok: false, cause: "register gateway unreachable (mock)" });
  const { res, root, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
    MOCK_MULTI_LEG: "1" }, {}, { recordFetcher });
  assert.equal(res.ok, true, "the open-item policy never withholds the report");
  const sr = JSON.parse(readFileSync(driverDir(res.runDir, "senior-rights.json"), "utf8"));
  assert.equal(sr.rows[0].verified, false);
  assert.match(sr.rows[0].fetchFailureCause, /register gateway unreachable/);
  const { config: poolCfg } = await import("../driver.config.mjs");
  const { dirname: pdir, basename: pbase } = await import("node:path");
  const html = readFileSync(join(poolCfg.poolRoot, `${pbase(pdir(res.runDir))}-${pbase(res.runDir)}`, "report.html"), "utf8");
  assert.match(html, /Open item:.*could not pull the official record for the oldest registration in this family/,
    "the qualification is stated plainly, where the finding lives");
  assert.match(html, /verified this conflict from a later registration of the same mark by the same owner/);
  assert.ok(events.some((e) => e.event === "predelivery-lint-failed" && e.failures.includes("senior-right-coverage")),
    "the review-bar/audit receipt names the same fact");
});

// ── Repair-first A4: single-artifact findings re-emit at quarantineSynth ──────────────────────────────
test("repair-first A4: one malformed finding object is REFUSED AT THE CALL and restated — the run delivers", async () => {
  // MOCK_BAD_FINDING plants an invented key in finding #1 (finding_key_unknown).
  //
  // RE-AIMED, NOT RELAXED. This asserted a driver-orchestrated repair: the bad
  // object reached disk, a validator named it, and the driver re-dispatched synthesis with a composer
  // that NAMED the object — `finding-reemit`. The writer's conversion moves the catch EARLIER: the
  // record is validated at the call, so the malformed object is refused before anything is written and
  // the seat restates in the same turn. No file to repair, no re-dispatch, and therefore no
  // `finding-reemit` event — the route this arm was watching is superseded, not broken.
  //
  // What has NOT changed is everything the arm is actually FOR, and all of it is still asserted below:
  // the run delivers, no quarantine terminal, and the file that lands is strict-clean. What replaces
  // the event is the refusal log — the run's own record that the defect happened and was corrected,
  // which is what stops "no defect occurred" and "a defect occurred and was fixed" looking identical.
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_BAD_FINDING: "1" });
  assert.equal(res.ok, true, JSON.stringify(res));
  const refusals = refusalsFor(res.runDir);
  assert.ok(refusals.some((r) => /finding_key_unknown/.test(r.reason)),
    `the defect was refused at the call, naming the parser's own token — refusals were ${JSON.stringify(refusals)}`);
  assert.ok(!events.some((e) => e.event === "quarantine"), "no quarantine terminal — nothing invalid ever reached disk");
  const findings = JSON.parse(readFileSync(join(res.runDir, "findings.json"), "utf8"));
  assert.ok(!("invented_key_from_mock" in findings.findings[0]), "the delivered file is strict-clean");
});

// ── Repair-first A5: the degenerate-reviewer repair at the verdict gate ────────────────────────────────
test("repair-first A5: a BLOCKING with ZERO cited defects is refused AT THE CALL — the seat corrects in-turn and delivers", async () => {
  // ✕ THE MECHANISM MOVED IN CONVERSION 9, AND THE OUTCOME DID NOT. Recorded rather than deleted,
  // because the two doctrines are a pair and a reader who finds only one concludes the code drifted.
  //
  // BEFORE: the seat wrote a BLOCKING citing nothing (the copper-spire degenerate shape), the artifact
  // reached the GATE, the gate named it `reviewer-degenerate`, and one forced re-ask of the WHOLE STAGE
  // healed it to a reasoned CONDITIONAL.
  //
  // NOW: `record_narrative_refutation` refuses an empty `flags` array on a BLOCKING in the turn it is
  // typed. The seat is told what is wrong immediately and answers with a second call — the repair moved
  // from the gate to the call and got cheaper by one whole stage dispatch. The tool's own description
  // says this in as many words: refused here "rather than at the gate, where its only repair is one
  // forced re-ask of this whole stage".
  //
  // THE CLIENT OUTCOME IS UNCHANGED, which is why this is a re-aim and not a withdrawal: a degenerate
  // refusal still becomes a delivered, reasoned CONDITIONAL. The assertions on that are untouched below.
  const { res, events } = await runPipeline({ MOCK_VERDICT: "BLOCKING", MOCK_SKEPTIC: "no flags surfaced", MOCK_DEGENERATE_HEALS: "1" });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.verdict, "CONDITIONAL", "the corrected reviewer's reasoned verdict is the delivered one");

  // TWO CALLS, ONE TURN — the refusal and the correction. This is what "repaired at the call" looks like
  // in the record, and counting them is what distinguishes it from a seat that simply answered once.
  // The recheck after the correction is a second turn that saves through the same tool, meets the same refusal and
  // corrects the same way, so the calls are counted per turn: the first review's are the ones before its verdict.
  const reviewed = Date.parse(events.find((e) => e.event === "verdict")?.ts ?? "");
  const all = readFileSync(driverDir(res.runDir, "tool-calls.jsonl"), "utf8")
    .split("\n").filter(Boolean).map((l) => JSON.parse(l))
    .filter((r) => r.tool === "record_narrative_refutation" && r.event === "settled");
  assert.ok(Number.isFinite(reviewed) && all.every((r) => Number.isFinite(Date.parse(r.ts ?? ""))), "every call and the verdict carry a time");
  const settled = all.filter((r) => Date.parse(r.ts) <= reviewed);
  assert.equal(all.length - settled.length, 2, "the recheck's turn is the same two calls: refused, then corrected");
  assert.equal(settled.length, 2,
    `expected two record_narrative_refutation calls — the refused degenerate one and the correction — `
    + `got ${settled.length}. One call means the tool accepted a BLOCKING citing nothing, which is the `
    + "shape it exists to refuse; more than two means the seat is not correcting on the first refusal");

  // AND THE GATE'S REPAIR IS PRE-EMPTED, NOT MERELY UNUSED. Asserting its absence is the half that keeps
  // this honest: if any of these fire again, a degenerate artifact reached the gate, which means the call
  // stopped refusing and the cheap repair silently reverted to the expensive one.
  for (const dead of ["reviewer-degenerate", "verdict-3", "repair-attempted"]) {
    const hit = events.find((e) => e.event === dead && /degener/.test(JSON.stringify(e)));
    assert.equal(hit, undefined,
      `${dead} fired for a degenerate review. The call refuses that shape now, so nothing degenerate can `
      + "reach the gate — this event firing means the refusal stopped working");
  }

  const sidecar = JSON.parse(readFileSync(driverDir(res.runDir, "verdict.json"), "utf8"));
  assert.equal(sidecar.verdict, "CONDITIONAL", "the single label authority reflects the corrected verdict");
});

test("repair-first A5: a REASONED BLOCKING (cited defects) is never re-asked — its grounds are printed, not re-rolled", async () => {
  // THE SUBJECT OF THIS ARM IS UNCHANGED BY T3a. A reviewer who refuses to sign AND says why has given a
  // human answer, and the degenerate re-ask — which exists to repair a refusal that names nothing — must
  // never fire on it. Re-rolling a reasoned refusal is overruling the reviewer, which no repair may do.
  //
  // What T3a changes is only what happens NEXT. The old doctrine ended the run here and filed the grounds
  // in a failure record nobody outside this box reads; the ruling of 2026-08-26 delivers the report with
  // those same grounds printed at the top of its body. The reviewer is heard either way — the difference
  // is whether the client receives anything.
  const { res, events } = await runPipeline({ MOCK_VERDICT: "BLOCKING", MOCK_SKEPTIC: "no flags surfaced",
    MOCK_VERDICT_DEFECTS: "- overclaimed CLEAR on the narrative §2 (file-anchored defect)", MOCK_DEGENERATE_HEALS: "1" });
  assert.ok(!events.some((e) => e.event === "reviewer-degenerate"),
    "a reasoned refusal is never treated as machinery — this is the assertion this arm exists for");
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.ok(!existsSync(join(res.runDir, ".failed")), "a reasoned BLOCKING no longer ends the run");

  // AND THE REVIEWER'S OWN GROUND REACHES THE RUN RECORD, NEVER THE CLIENT PAGE. Delivering while dropping
  // the cited defect would satisfy every assertion above, so the text itself is asserted in the record the
  // reviewing lawyer reads. Owner ruling 2026-09-24: reviewer notes never reach the client page.
  const record = readFileSync(driverDir(res.runDir, "reviewer-open-questions.md"), "utf8");
  assert.match(record, /^###\s+Reviewer's open questions/m, "the section is recorded");
  assert.match(record, /overclaimed CLEAR on the narrative/,
    "the reviewer's cited defect must be the thing the lawyer reads — a record without the ground it was "
    + "raised on is a heading, not a hand-off");
  const report = readFileSync(res.runDir + "/report.md", "utf8");
  assert.doesNotMatch(report, /Reviewer's open questions|overclaimed CLEAR on the narrative/,
    "a reviewer's note reached the client page");
});

test("T3a: persistent BLOCKING after corrective + re-check → the run DELIVERS, with the open points recorded off the client page", async () => {
  // Ruling 2026-08-26, verbatim: "Deliver always, with open points printed. The refusal on a
  // blocking review goes." This REVERSES spec-49 T3, whose flip to fail-on-BLOCKING is itself recorded in
  // itself an owner-approved decision. Both are his; this is the standing one. This arm is the
  // inversion of the one that stood here, kept at the same name-adjacent place on purpose: the two
  // doctrines are a pair and a reader who finds only one will conclude the code drifted from its contract.
  //
  // COPPER-SPIRE IS STILL ANSWERED, AND THAT IS WHAT THE SECTION ASSERTION IS FOR. Its failure was a
  // BLOCKING verdict reaching delivery and then CONTRADICTING its own client summary — a report reading
  // finished while the reviewer refused. "Never ships" and "never ships LOOKING FINISHED" were one
  // requirement in the old doctrine; they are two, and only the second was load-bearing.
  // THE BLOCKING CITES A DEFECT, and after conversion 9 that is the only kind a seat can produce:
  // `record_narrative_refutation` refuses a BLOCKING with an empty `flags` array in the turn it is
  // typed. This scenario used to drive a FLAGLESS blocking, which is now unproducible from a seat —
  // nothing about T3a depended on it, and the ruling under test is "a persistent BLOCKING delivers with
  // its open points printed", which a cited one exercises better than a bare one.
  const { res, events } = await runPipeline({ MOCK_VERDICT: "BLOCKING", MOCK_SKEPTIC: "no flags surfaced",
    MOCK_VERDICT_DEFECTS: "- the summary says the phonetic axis ran; the receipt shows it never did" });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.ok(existsSync(join(res.runDir, ".delivered")), "the run delivers — that is the whole ruling");
  assert.ok(!existsSync(join(res.runDir, ".failed")), "and no failure record is written");
  assert.ok(stageOrder(events).includes("report-overview"), "the delivery phase now starts on a BLOCKING run");
  assert.ok(events.some((e) => e.event === "verdict-blocking-delivered"), "the delivery is recorded by its own event");
  assert.ok(!events.some((e) => e.event === "verdict-blocking-terminal"), "and the terminal is gone, not merely unreached");

  // THE LABEL STAYS HONEST. Delivering is not signing: the sidecar — "the single label authority" — must
  // still say BLOCKING, or the report ships looking reviewed.
  const sidecar = JSON.parse(readFileSync(driverDir(res.runDir, "verdict.json"), "utf8"));
  assert.equal(sidecar.verdict, "BLOCKING", "the verdict is delivered WITH, never softened by delivering");

  // THE RECORD IS THE POINT, AND THE CLIENT PAGE CARRIES NOTHING ADDED. Owner ruling 2026-09-24: a report
  // the reviewer still refuses ships with its rating and nothing added, and reviewer notes never reach the
  // client page. The refusal stays honest where the reviewing lawyer reads it: the sidecar above still says
  // BLOCKING, and the run record says so in words a reading lawyer acts on.
  const record = readFileSync(driverDir(res.runDir, "reviewer-open-questions.md"), "utf8");
  assert.match(record, /^###\s+Reviewer's open questions/m, "the open points are recorded for the reviewing lawyer");
  assert.match(record, /did not sign this report off/,
    "and the record says so in words a reading lawyer acts on, not by a heading alone");
  const report = readFileSync(res.runDir + "/report.md", "utf8");
  assert.doesNotMatch(report, /Reviewer's open questions|did not sign this report off/,
    "the refusal reached the client page as added text");
  // …AND THE EMAIL CARRIES NONE OF IT EITHER, on any run (owner ruling 2026-10-01). The 2026-09-24 ruling
  // took the section off the report page and left it on the cover, gated on whether the run's forwarder was
  // the client; measured over the thirty days to 2026-10-01, the report carried neither since that ruling
  // and the email carried both. So the section now reaches no surface that is sent, and the record above is
  // the whole of where it lives.
  const email = readFileSync(join(res.runDir, "email-body.md"), "utf8");
  // The control first: the cover DID compose, so the two absences are about the section and not about an
  // empty file. It carries the risk label a cover always carries.
  assert.match(email, /Overall risk/i, "the cover composed nothing, so the absences below prove nothing");
  assert.doesNotMatch(email, /did not sign this report off/, "the refusal is on the cover again");
  assert.doesNotMatch(email, /Reviewer's open questions/, "the section heading is on the cover again");
  assert.doesNotMatch(email, /the summary says the phonetic axis ran; the receipt shows it never did/,
    "the reviewer's cited defect is on the cover again — it belongs to the record alone");


  // The corrective ladder is still the fix arm and still runs FIRST: original + blocking re-synth.
  assert.ok(stageOrder(events).filter((s) => s.startsWith("synthesis")).length >= 2,
    "delivering at the bound must not skip the repair that tries to avoid reaching it");
});

// ── spec 64: the disposition is DERIVED from the typed actions register ────────────────────────
test("spec 64: a condition-kind action ships CONDITIONAL even off a CLEAR review — the copper-causeway/ashen-gantry fix", async () => {
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_ACTIONS: "condition" });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.verdict, "CONDITIONAL", "the opinion's own named consent gates CLEAR");
  assert.ok(existsSync(join(res.runDir, ".delivered")), "delivered — the clamp never withholds");
  assert.ok(events.some((e) => e.event === "coverage-floor-clamp" && e.legalActions === 1), "the legalActions arm clamped");
  const sidecar = JSON.parse(readFileSync(driverDir(res.runDir, "verdict.json"), "utf8"));
  assert.equal(sidecar.verdict, "CONDITIONAL");
  assert.equal(sidecar.kinds.legalActions, true);
  assert.ok(sidecar.reasons.includes("Obtain consent from Mystery Owner LLC before filing in the US."),
    "the reason IS the action's own client-plain text");
  assert.match(sidecar.statement, /^High — conditional on: Obtain consent from Mystery Owner LLC/,
    "THE one risk statement carries band + stance in one sentence");
  assert.equal(sidecar.stance, "conditional", "PR-3: the structured stance rides the sidecar — no consumer regexes the wording");
});

test("spec 64: advisory-only actions (client-fact) stay CLEAR — an unanswered client question never blocks", async () => {
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_ACTIONS: "advisory" });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.verdict, "CLEAR");
  assert.ok(!events.some((e) => e.event === "coverage-floor-clamp"), "no clamp fired");
  const sidecar = JSON.parse(readFileSync(driverDir(res.runDir, "verdict.json"), "utf8"));
  assert.equal(sidecar.kinds.legalActions, undefined);
  assert.equal(sidecar.statement, "High — clear to proceed: no conditions beyond ordinary filing.",
    "severity and disposition read as ONE labelled sentence, never two bare words");
});

test("spec 64: an already-CONDITIONAL run RECORDS its condition actions — never again kinds:{} reasons:[]", async () => {
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CONDITIONAL", MOCK_SKEPTIC: "no flags surfaced", MOCK_ACTIONS: "condition" });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.verdict, "CONDITIONAL");
  assert.ok(events.some((e) => e.event === "verdict-conditions-recorded"), "conditions appended on the CONDITIONAL entry path");
  const sidecar = JSON.parse(readFileSync(driverDir(res.runDir, "verdict.json"), "utf8"));
  assert.equal(sidecar.kinds.legalActions, true);
  assert.ok(sidecar.reasons.length >= 1, "reasons carry the conditions");
  assert.match(sidecar.statement, /^High — conditional on: /);
});

test("spec 64: a v4 emission omitting actions[] gets ONE warm re-demand, healed in place — the run delivers", async () => {
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_ACTIONS: "absent" });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.ok(events.some((e) => e.event === "stage" && e.stage === "synthesis" && e.trigger === "actions-missing"),
    "the actions-missing re-demand fired");
  assert.ok(!events.some((e) => e.event === "findings-actions-absent"), "the re-demand healed the register");
  const findings = JSON.parse(readFileSync(join(res.runDir, "findings.json"), "utf8"));
  assert.ok(Array.isArray(findings.actions), "the healed file carries the register");
});

test("hard stage failure → .failed sentinel, pipeline returns ok:false, and the failure notice rides the delivery lane (spec-49 T5)", async () => {
  const { res } = await runPipeline({ MOCK_FAIL_STAGE: "matter-frame", MOCK_VERDICT: "CLEAR" });
  assert.equal(res.ok, false);
  assert.equal(res.failedStage, "matter-frame");
  assert.ok(existsSync(join(res.runDir, ".failed")));
  // spec-49 T5 (J5), handoff form: the CODE-authored failure packet is written and the outbox marker
  // is the pending signal (the level-triggered *.pending watch keeps the notice alive until the settle).
  // This used to add that sendPending had no failure-side clear, so the handoff path never set it. Both
  // halves are now wrong: the clear is mark_sent, which settles a failure packet on the same evidence a
  // delivery needs, and the flag is set on BOTH paths so a failed run is owed whichever wrote the packet.
  // The sentence outlived its code and read as current — it is kept here, corrected, rather than deleted,
  // because the next reader meets a run that DOES set the flag twenty lines below it.
  const packetPath = driverDir(res.runDir, "failure.json");
  assert.ok(existsSync(packetPath), "the failure packet is written");
  const packet = JSON.parse(readFileSync(packetPath, "utf8"));
  assert.equal(packet.kind, "run-failed");
  assert.equal(packet.failed, true);
  assert.equal(packet.failedStage, "matter-frame");
  assert.match(packet.subject, /run FAILED, nothing delivered/);
  assert.match(packet.emailBodyHtml, /FAILED at stage <b>matter-frame<\/b>/);
  assert.ok(packet.text && packet.whatsappText, "short relay text + full notice both ride the packet");
  const status = JSON.parse(readFileSync(join(res.runDir, "status.json"), "utf8"));
  assert.equal(status.state, "failed");
  const { config: obCfg } = await import("../driver.config.mjs");
  const markers = (await import("node:fs")).readdirSync(obCfg.outboxDir).filter((n) => n.endsWith(".pending"));
  assert.ok(markers.length > 0, "the outbox wake marker rides the failure (completion-watch lane)");
});

// FIX: a COLLAPSED core search must FAIL, not ship CONDITIONAL. The primary-sweep band carries a dangerous
// slice that enumerated 212 hits but extracted ZERO records (the band is otherwise non-empty, mirroring the
// ~220-record real failure). The content fail-gate must hard-fail the run — no publish, no CONDITIONAL.
test("collapsed core search → run FAILS (no publish), never a CONDITIONAL deliverable", async () => {
  const { res } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_BAND_COLLAPSED: "primary-sweep" });
  assert.equal(res.ok, false, "a collapsed slice must FAIL the run");
  assert.match(res.failedStage ?? "", /register-unit|fan-in/, "failed at the register-unit gate or its fan-in backstop");
  assert.ok(existsSync(join(res.runDir, ".failed")), ".failed sentinel written");
  assert.ok(!existsSync(join(res.runDir, ".delivered")), "never delivered");
  const status = JSON.parse(readFileSync(join(res.runDir, "status.json"), "utf8"));
  assert.equal(status.state, "failed", "status records the failure, not a delivered CONDITIONAL");
});

test("delivered run → status.json delivered, STATUS.md rollup, .delivered records the pending send", async () => {
  const { res } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced" });
  assert.equal(res.ok, true);
  // status.json rode into the archive with the delivered state
  const s = JSON.parse(readFileSync(join(res.runDir, "status.json"), "utf8"));
  assert.equal(s.state, "delivered");
  assert.equal(s.review?.signoff, "CLEAR");
  assert.equal(s.verdict, undefined);
  // THE RUN'S OWN URL IS THE PORTAL ROUTE. This asserted `/report\.html$` — the
  // pool's directory layout, which is where the documents sit on disk and is not an application route.
  // The link shipped on every delivered report and, on production, opened the portal's own
  // `{"error":"not_found"}` for the run's OWN owner.
  assert.match(s.url, /\/portal\/report\/[^/]+\/$/, "the address a recipient can actually open");
  // STATUS.md (at the stable studio root) shows the delivered run
  const md = readFileSync(join(studioRootOf(res.runDir), "STATUS.md"), "utf8");
  assert.match(md, /TMP-2201 NOVAPULSE — delivered \(High\)/);
  // the delivery sentinel marks the run ready for intake-agent's comms watch to send (handoff mode)
  const delivered = JSON.parse(readFileSync(join(res.runDir, ".delivered"), "utf8"));
  assert.equal(delivered.sendPending, true, "sendPending marker set for intake-agent's comms watch");
  // ONE report: the two-bit delivery is deleted — status/sentinel/packet carry NO readiness fields
  assert.equal(s.delivery, undefined, "no delivery{} second bit on status.json");
  assert.ok(!("clientReady" in delivered), "no clientReady on the .delivered sentinel");
  const packetOpen = JSON.parse(readFileSync(driverDir(res.runDir, "delivery.json"), "utf8"));
  assert.ok(!("clientReady" in packetOpen) && !("defects" in packetOpen), "the packet carries no readiness bits");
  assert.match(packetOpen.whatsappText, /^✅/, "the plain completion ping");
  // charter P1 §3 — ONE canonical runId form: the delivery packet (and therefore the outbox marker it
  // names) carries the dated `<slug>-<date>-<codename>` — the SAME id status.json carries, so the
  // pipeline's marker and the rescan's re-drop can never be two different names for one delivery.
  assert.equal(packetOpen.runId, `${s.slug}-${s.date}-${s.codename}`, "packet runId = the dated canonical id");
  assert.equal(packetOpen.runId, s.runId, "and identical to status.runId — one form across every consumer");
  const { config: obCfg2 } = await import("../driver.config.mjs");
  assert.ok(existsSync(join(obCfg2.outboxDir, `${packetOpen.runId}.pending`)), "the wake marker is named by the canonical id");
  // charter P1 §4 — lifecycle honesty: the terminal delivered state ADVANCES the stepper to its final
  // step (handoff mode runs no notify stages, so without this the run froze at 7/9 forever).
  assert.equal(s.stepN, s.stepTotal, `a delivered run never reads mid-flight (got ${s.stepN}/${s.stepTotal})`);
  assert.equal(s.stepN, 9, "the clearance display sequence ends at 9/9");
  assert.ok(!readFileSync(join(res.runDir, "email-body.md"), "utf8").includes("Not client-ready"),
    "no defects block on the cover note");
});

// The selector/record disagreement FAULTS instead of riding along as a recorded row.
//
// It cannot fire on any path the engine has today (both sides of `agrees` come from the one
// deriveGridSpec call above it), so there is no live run to assert against — the behaviour under test is
// that the throw EXISTS and sits AFTER the record is durable. Asserted against the module's own source,
// on the dependency-repair.test.mjs precedent (its 15a and 15b tests), because the failure being guarded is a future edit
// quietly demoting it back to a recorded row, not a particular run.
test("selector/record disagreement FAULTS, and the record is written BEFORE the throw", async () => {
  const src = driverSource("pipeline.mjs");
  // ANCHORED ON THE PROSE, NOT THE ISSUE NUMBER. The heading carried a bare issue reference and the cut
  // strips those out of comments, so the old anchor stopped existing. This arm's vacuity control caught
  // it — an uncontrolled slice on a missing anchor is not an error, it is a window from the end of the
  // file that the assertions below would have read as the record block.
  const start = src.indexOf("RECORD THE CHOICE, HERE, where both paths converge");
  assert.notEqual(start, -1, "the record block's heading is gone from pipeline.mjs — if this fails the assertions below are vacuous");
  const end = src.indexOf("const gather =", start);
  assert.ok(end > start, "…and delimitable");
  const block = src.slice(start, end);

  const writeAt = block.indexOf("atomicWrite(P.commonLawPath");
  const noteAt = block.indexOf("note(`common-law path:");
  const throwAt = block.search(/throw new StageFailure\(/);
  assert.ok(writeAt > 0, "the record is still written");
  assert.ok(throwAt > 0, "a disagreement must FAULT — a record nobody can trust must not ride along as a row");
  assert.ok(throwAt > writeAt && throwAt > noteAt,
    "ORDER: the throw must follow atomicWrite and note, or the run dies with no forensic file — the exact failure the record exists to prevent");
  assert.match(block, /failClass: "deterministic"/, "a re-sample re-derives the identical divergence; the retry ladder has nothing to offer it");
});
