// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE RESOLVED MCP SURFACE OF EVERY TOOL GROUP, PINNED BYTE-FOR-BYTE BEFORE THE REGISTRY COLLAPSE.
//
// The collapse ahead of this file gives `blind-frame` and `skeptic` ONE registry that the grant DERIVES
// from, replacing five hand-kept declarations. A re-plumb is exactly where a grant alteration hides, and
// "I only moved the lookup" is a claim about the WHOLE map. This makes it checkable instead of
// believable: every group's representative stage, walked through the shipped resolution, recorded as the
// exact strings the engine is handed.
//
// ── WHY THE EXISTING PINS ARE NOT THIS ─────────────────────────────────────────────────────────────
//
// Three tables already pin parts of the recording grant, and all three would stay green through a
// re-plumb that changed the argv:
//   · `engine.gather.test.mjs` O1 — `granted == RECORDING_TOOLS[stage]`, but it SORTS both sides. Token
//     ORDER in the `--allowedTools` string is pinned by nothing today, and order is bytes.
//   · `server-tools-granted-or-stated.test.mjs` — the mcp half of the grant, sorted, per stage. Same gap,
//     and it reads no config at all.
//   · `tool-free-argv-baseline.test.mjs` — whether the three flags are PRESENT. Not what is in them: the
//     `--mcp-config` JSON is a server key, a script path and an env block, none of which it looks at.
// So the union of the shipped guards answers "which tools, as a set" and never "which bytes". This file
// is the bytes.
//
// ── THE FOUR NORMALISATIONS, AND WHO OWNS WHAT THEY HIDE ───────────────────────────────────────────
//
// Four values in the config are properties of the BOX, not of the wiring, and pinning them verbatim would
// make this file fail on a different machine rather than on a changed grant:
//   `<NODE>`      process.execPath
//   `<MCP>`       this checkout's driver/engine/mcp
//   `<BRIDGE>`    the oauth bridge entry point (CLEAROTRON_OAUTH_BRIDGE overrides it)
//   `<CALL_LOG>`  ledgerPath("call") — resolved by EXISTENCE over a six-step ladder, so it depends on
//                 which files are in the running user's home. Its content is owned by
//                 register-ledger-rename.test.mjs ("unconditional — the old line forwarded nothing on
//                 every real box"); this file pins only that it is the resolver's answer and sits at that
//                 position in the block.
// THE PLACEHOLDERS ARE IN THE PINNED STRINGS, which is what makes a redaction that silently matches
// nothing fail rather than pass: a substitution that does not fire leaves an absolute path in the
// measured string where the pin holds a placeholder. A redaction with a blind spot the size of whatever
// it subtracted is the failure this shape avoids.
//
// `CLEAROTRON_REGISTER_RECORD_LOG` is NOT normalised: it derives from the run dir this walk passes in, so it
// stays verbatim and stays pinned.
//
// THE REGISTER PROVIDER IS HELD FIXED at corsearch, and it is SET BEFORE THE MODULE LOADS. This is a
// differential on the WIRING, and the provider decides both the register server's script and its tool list
// (clarivate serves no `register_expand_phoneme`) — measured, not assumed. `scripts/test-run.mjs` defaults
// the provider (`if (!process.env.CLEAROTRON_DATABASE)`) but does not override an explicit one, so
// without this
// `CLEAROTRON_DATABASE=clarivate npm test` would redden a row about a provider swap in a file about a
// lookup move.
//
// HENCE THE DYNAMIC IMPORT. `driver.config.mjs` captures `REGISTER_PROVIDER` in a module-level const at
// import time, and a static `import` is evaluated before any statement in this file — so assigning the env
// var at the top of the body sets it AFTER the value it is meant to decide has already been frozen. Found
// by running this file with the var unset: it threw the config's own refusal, which is the correct
// behaviour of the code and a broken test. The suite's other provider-dependent check spawns a child
// process for the same reason (engine.gather.test.mjs, the per-provider tool-count sweep).
//
// CAPTURED FROM 1aaa46ba, the commit before the collapse, by running this walk against the shipped
// resolution. Committed BEFORE the collapse and green on unchanged code: that ordering is the whole
// point — a baseline written after the change records the change.
import { test } from "node:test";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ledgerPath } from "../../providers/_shared/ledger-path.mjs";

pinEnv(process.env, "CLEAROTRON_DATABASE", "corsearch");   // see header: held, and set before the graph loads
const { buildGatherMcpConfig, allowedToolsFor, toolGroupsForStage, LOCAL_SERVER_SCRIPTS, seatWritesForGroups } =
  await import("../engine/mcp/gather-config.mjs");
// The stage registry, for the DERIVED write-witness at the foot of this file — see its own comment for
// why that fixture is derived rather than named.
const { STAGES } = await import("../stages.mjs");

const HERE = dirname(fileURLToPath(import.meta.url));
const MCP_DIR = join(HERE, "..", "engine", "mcp");
const BRIDGE = process.env.CLEAROTRON_OAUTH_BRIDGE
  || join(HERE, "..", "..", "providers", "oauth-mcp-bridge", "bridge.mjs");

// Longest first: `<MCP>` is a prefix of nothing here, but a future value that nests inside another would
// otherwise be half-replaced and the mismatch would read as a grant change.
const SUBSTITUTIONS = [
  [BRIDGE, "<BRIDGE>"],
  [MCP_DIR, "<MCP>"],
  [ledgerPath("call"), "<CALL_LOG>"],
  [process.execPath, "<NODE>"],
];

function normalise(s) {
  let out = s;
  for (const [from, to] of SUBSTITUTIONS) out = out.split(from).join(to);
  return out;
}

// The gateway's own resolution — `const groups = toolGroupsForStage(name)` and the `if (groups.length)`
// under it, in gateway.mjs — reproduced call for call, the `if` included, because that `if` is what
// decides whether a stage is handed any of this at all.
function surfaceFor(stage) {
  const groups = toolGroupsForStage(stage);
  const cfg = groups.length ? buildGatherMcpConfig(groups, { sessionKey: "SK", agent: "AG", runDir: "/RUN" }) : null;
  return {
    groups,
    allowedTools: groups.length ? normalise(allowedToolsFor(groups)) : null,
    mcpConfig: cfg ? normalise(JSON.stringify(cfg)) : null,
  };
}

const ENV = '"env":{"CLEAROTRON_GATHER_SESSION_KEY":"SK","CLEAROTRON_GATHER_AGENT":"AG","CLEAROTRON_BAND_RUN_DIR":"/RUN"'
  + ',"CLEAROTRON_REGISTER_CALL_LOG":"<CALL_LOG>","CLEAROTRON_REGISTER_RECORD_LOG":"/RUN/_driver/register-record-bodies.jsonl"}';
const local = (key, script) => `"${key}":{"command":"<NODE>","args":["<MCP>/${script}"],${ENV}}`;
const bridge = (key) => `"${key}":{"command":"<NODE>","args":["<BRIDGE>","--server","${key}"],"connectionTimeoutMs":60000`
  + ',"env":{"CLEAROTRON_BAND_RUN_DIR":"/RUN","CLEAROTRON_GATHER_SESSION_KEY":"SK","CLEAROTRON_GATHER_AGENT":"AG"}}';

// ONE REPRESENTATIVE STAGE PER GROUP, and the two shared structures the collapse edits are in here for
// the same reason: `resolveGroup` is one switch and `LOCAL` is one object, so a change meant for the two
// recording keys reaches every group that reads them.
const PINNED = Object.freeze({
  // — THIS ROW MOVED, and it is the first row in this table to move by SUBTRACTION from a shared
  // key. The disposition transport rode `perplexity`, which four stages hold; it is its own key now,
  // held by this lane alone. What changed here is a RENAME —
  // `mcp__perplexity__record_dispositions` → `mcp__dispositions__record_dispositions` — plus a second
  // server in the config. The token's POSITION is unchanged, which is the part only this file can see:
  // it is still last, because `dispositions` is second in the group list and `allowedToolsFor` walks
  // groups in order.
  "common-law": {
    groups: ["perplexity", "dispositions"],
    allowedTools: "Read Write Edit mcp__perplexity__perplexity_research mcp__dispositions__record_dispositions",
    mcpConfig: `{"mcpServers":{${local("perplexity", "perplexity-server.mjs")},${local("dispositions", "dispositions-server.mjs")}}}`,
  },
  // register — the dynamic key, mounted from REGISTER_SERVERS at the held provider.
  //
  // — ONE token longer and one server longer, everything before it byte-identical,
  // which is what this file exists to show. AND `Read Write Edit` STILL LEADS, which is the whole design
  // decision made visible: this stage's audit note becomes the driver's, but the stage keeps a legitimate
  // seat write — the lane-off band, ordered by hand for a matter with no Nice classes, which compiles no
  // register plan at all. That is why the transport is on its OWN key and not in the RECORDING category,
  // where every row declares `seatWrites: false`. A future edit that drops `Read Write Edit` from this row
  // is not tidying a pin; it is breaking class-less matters, and this paragraph is the record of it.
  "register-unit:phonetic": {
    groups: ["register", "unit-note"],
    allowedTools: "Read Write Edit mcp__register__register_search mcp__register__register_record_fetch"
      + " mcp__register__register_image_fetch mcp__register__register_expand_phoneme"
      + " mcp__register__register_batch_screen mcp__register__register_enumerate"
      + " mcp__register__register_execute_plan mcp__register__register_propose_supplemental"
      + " mcp__unit-note__record_unit_note",
    mcpConfig: `{"mcpServers":{${local("register", "corsearch-server.mjs")},${local("unit-note", "unit-note-server.mjs")}}}`,
  },
  // THREE groups on one stage — the only row that pins server ORDER inside the config across more than
  // two, and the coverage key's separation from `band` (a record tool riding the shared key would be
  // granted to four judgment stages).
  //
  // ── CONVERSION 11 MOVED THIS ROW, AND THE MOVE IS A DECLARED ARGV CHANGE ───────────────────────────
  //
  // `Write Edit` are GONE from the head and `mcp__recording-register-digest__record_register_digest` is
  // on the tail: the seat hands back rows and prose and the driver renders register-findings.md. That is
  // a real change to the bytes the engine is handed for this stage, on a stage no live run has exercised
  // under the new surface, so it ships `status:merged-awaiting-e2e` — the same treatment 's rename
  // took and for the same reason.
  //
  // WHAT DID NOT MOVE IS THE POINT OF THE ROW: `Read` still leads, the three band tools are byte-
  // identical and in the same order, and `mcp__coverage__record_coverage` is still its own key beside
  // the new one. Two typed transports on one stage, not one merged key — the obligation ledger and the
  // findings document are different statements, and merging them would put a second writer into the
  // ledger took a writer out of.
  "register-digest": {
    groups: ["band", "coverage", "recording-register-digest"],
    allowedTools: "Read mcp__band__band_lookup mcp__band__band_record mcp__band__band_shape"
      + " mcp__coverage__record_coverage"
      + " mcp__recording-register-digest__record_register_digest",
    mcpConfig: `{"mcpServers":{${local("band", "band-server.mjs")},${local("coverage", "coverage-server.mjs")},${local("recording-register-digest", "recording-server.mjs")}}}`,
  },
  "placement-inquiry": {
    groups: ["band"],
    allowedTools: "Read Write Edit mcp__band__band_lookup mcp__band__band_record mcp__band__band_shape",
    mcpConfig: `{"mcpServers":{${local("band", "band-server.mjs")}}}`,
  },
  // — one token and one server longer, everything before it byte-identical, which is what this
  // file exists to show. `Read Write Edit` still leads: synthesis holds a typed-transport key WITHOUT
  // joining the RECORDING category, so `seatWrites` never enters the calculation and the stage keeps the
  // trio it needs to author findings.json. That is the `coverage`/register-digest shape, not a recording
  // conversion — the RECORDING rows in this file are untouched by, and that is the assertion.
  //
  // — AND ONE TOKEN SHORTER. `mcp__perplexity__record_dispositions` is gone from this row: it was
  // never ordered by any synthesis dictation and reached this stage only because the tool sat on the
  // shared `perplexity` entry. The stage keeps `declination`, which its doctrine DOES name — the two
  // together are the point, a seat holding the record tool its own lane orders and not the one it does
  // not. Everything before the removed token is byte-identical, which is what this file exists to show.
  //
  // — AND THE TRIO IS GONE FROM THIS ROW. The paragraph above says `Read Write Edit`
  // still leads because synthesis "holds a typed-transport key WITHOUT joining the RECORDING category,
  // so `seatWrites` never enters the calculation and the stage keeps the trio it needs to author
  // findings.json". It joins the category now: it authors neither of its artifacts, the driver renders
  // both off `record_synthesis`, and a seat that cannot write must not be handed Write and Edit. Every
  // retrieval token before the change is byte-identical, which is what this file exists to show.
  //
  // THIS ROW DEPENDS ON THE mixed-group `seatWritesForGroups` FIX and reds without it. That predicate
  // answers "does this seat write" from the GROUP list and counts any non-recording group as a writer,
  // so a stage holding retrieval AND recording keeps the trio — which is the defect, not the design.
  // Landing on the reviewer half; the value pinned here is the post-fix one.
  "synthesis": {
    groups: ["perplexity", "band", "declination", "recording-synthesis"],
    allowedTools: "Read mcp__perplexity__perplexity_research"
      + " mcp__band__band_lookup mcp__band__band_record mcp__band__band_shape"
      + " mcp__declination__record_declination"
      + " mcp__recording-synthesis__record_synthesis",
    mcpConfig: `{"mcpServers":{${local("perplexity", "perplexity-server.mjs")},${local("band", "band-server.mjs")},${local("declination", "declination-server.mjs")},${local("recording-synthesis", "recording-server.mjs")}}}`,
  },
  // — A ROW THAT DID NOT EXIST UNTIL THE CHANGE THAT NEEDED IT. narrative-refutation is the
  // second stage the disposition split takes a grant from, and nothing in this table witnessed it: the
  // stage holds `perplexity` + `band`, both already "represented" by other rows, so the one-row-per-
  // group rule read it as covered while its argv silently carried a writer into the common-law ledger.
  // A grant that changes with no pinned row is exactly the byte this file was built to catch, so the
  // row is added in the commit that changes it rather than after. It is now the WITNESS that the split
  // subtracted and did not merely rename: this stage holds `perplexity` and NO disposition tool.
  //
  // CONVERSION 9 MOVED IT, and this row is the clearest statement in the tree of what a conversion buys:
  // `Write` and `Edit` are GONE from a stage that keeps every retrieval tool it had. The reviewer no
  // longer authors senior-eye-review.md — it hands back a typed record and the driver renders it — so the
  // hand-write pair is not merely discouraged, it is absent from the argv.
  //
  // It is also the row that proves the seat-writes predicate was fixed. Until it was, this stage declared
  // `seatWrites: false` on its recording row and still resolved to `Read Write Edit …`, because a single
  // retrieval group voted "writer" over the whole list. The bytes below are what that fix is worth.
  "narrative-refutation": {
    groups: ["perplexity", "band", "recording-narrative-refutation"],
    allowedTools: "Read mcp__perplexity__perplexity_research"
      + " mcp__band__band_lookup mcp__band__band_record mcp__band__band_shape"
      + " mcp__recording-narrative-refutation__record_narrative_refutation",
    mcpConfig: `{"mcpServers":{${local("perplexity", "perplexity-server.mjs")},${local("band", "band-server.mjs")},`
      + `${local("recording-narrative-refutation", "recording-server.mjs")}}}`,
  },
  // caselaw — the WILDCARD grants and the smaller bridge env. The recording groups' `bridges: []` is the
  // promise that this shape never reaches them; this row is what that promise is measured against.
  "case-law": {
    groups: ["caselaw"],
    allowedTools: "Read Write Edit mcp__courtlistener__* mcp__legaldatahunter__* WebFetch",
    mcpConfig: `{"mcpServers":{${bridge("courtlistener")},${bridge("legaldatahunter")}}}`,
  },
  // ── THE TWO STAGES THE COLLAPSE IS ABOUT ────────────────────────────────────────────────────────
  // — THIS ROW MOVED, deliberately, and it is the only one that may. The seat lost `Write` and `Edit`
  // when the driver became the artifact's writer; every other row in this table is the proof that a change
  // to `allowedToolsFor`'s shared seeding reached this stage and no other.
  "blind-frame": {
    groups: ["recording-blind-frame"],
    allowedTools: "Read mcp__recording-blind-frame__record_blind_frame",
    mcpConfig: `{"mcpServers":{${local("recording-blind-frame", "recording-server.mjs")}}}`,
  },
  // Token order is load-bearing here: `record_skeptic` then `search_run_artifacts`, the order the key's
  // tools list is written in. O1 sorts, so a flip is invisible to it and visible here.
  "skeptic": {
    groups: ["recording-skeptic"],
    allowedTools: "Read mcp__recording-skeptic__record_skeptic mcp__recording-skeptic__search_run_artifacts",
    mcpConfig: `{"mcpServers":{${local("recording-skeptic", "recording-server.mjs")}}}`,
  },
  // CONVERSION 2 — THIS ROW MOVED, and it is the second row in this table ever to. It was the
  // tool-free control (`groups: []`, `null` twice, asserting the catch-all could not hand a stage a group
  // by accident); matter-frame is now a recording stage, so the control has to move with it.
  //
  // Token order is load-bearing here for the same reason it is on skeptic: `record_matter_frame` then
  // `search_run_artifacts`, the order the key's tools list is written in. O1 sorts before comparing and
  // cannot see a flip; this row can.
  "matter-frame": {
    groups: ["recording-matter-frame"],
    allowedTools: "Read mcp__recording-matter-frame__record_matter_frame mcp__recording-matter-frame__search_run_artifacts",
    mcpConfig: `{"mcpServers":{${local("recording-matter-frame", "recording-server.mjs")}}}`,
  },
  // Conversion 5 — the first FAN-OUT recording row. Pinned under the BARE stage name, which is what
  // `surfaceFor` walks; the dispatched name carries the axis and resolves to the same key by declaration.
  "report-card": {
    groups: ["recording-report-card"],
    allowedTools: "Read mcp__recording-report-card__record_report_card",
    mcpConfig: `{"mcpServers":{${local("recording-report-card", "recording-server.mjs")}}}`,
  },
  // Conversion 4 — the first recording row whose artifact a CLIENT reads. `Read` and one record tool.
  "report-overview": {
    groups: ["recording-report-overview"],
    allowedTools: "Read mcp__recording-report-overview__record_report_overview",
    mcpConfig: `{"mcpServers":{${local("recording-report-overview", "recording-server.mjs")}}}`,
  },
  // THE TOOL-FREE CONTROL, RE-HOMED FOR THE LAST TIME. It has now moved twice — matter-frame → 
  // report-overview → notify — because each host converted in turn, and a control that relocates every
  // conversion is one conversion away from being dropped instead of moved. `notify` is OWNER-HELD and
  // outside the conversion programme entirely, so it cannot convert out from under this row. The
  // property is unchanged and is not about any particular stage: the catch-all in `toolGroupsForStage`
  // must return NOTHING for a stage it does not name, rather than minting a group by accident.
  notify: { groups: [], allowedTools: null, mcpConfig: null },
});

test("⭐ GRANT PRESERVATION: every group's resolved surface is byte-identical to the pre-collapse pin", () => {
  const measured = {};
  for (const stage of Object.keys(PINNED)) measured[stage] = surfaceFor(stage);
  assert.deepEqual(measured, { ...PINNED },
    "a resolved MCP surface moved. If this is a re-plumb it changed behaviour it did not declare; if it is "
    + "a deliberate grant change, move the row and say so in the PR body");
});

test("the two shared DERIVED structures keep their shape — order and multiplicity included", () => {
  // `recording-server.mjs` appears TWICE, and that is the evidence both recording keys resolve to the one
  // server module while holding different tool lists. A collapse that spread derived entries into `LOCAL`
  // could dedupe it, reorder it, or drop one — none of which its only consumer would notice, because that
  // consumer set-izes this array — `const granted = new Set([...LOCAL_SERVER_SCRIPTS` in
  // server-tools-granted-or-stated.test.mjs. Pinned here so the derivation cannot change shape unobserved.
  // TWELVE times now, one per recording key. This comment read EIGHT and called that "the last of the
  // mechanical scope", then TEN, then ELEVEN; the count is a consequence of the category's size and never
  // a statement about how many conversions remain — which is exactly the reading that made "the whole
  // category" wrong twice. Conversion 11 (register-digest, the findings document) added the eleventh, and
  // knockout-assess adds the twelfth — the first from outside the clearance lane, so
  // the count is no longer even a statement about one stage table. THIRTEEN now: item C converts
  // knockout-frame, the second key from that lane and the last stage on it, so both knockout entries sit
  // here for the same reason every clearance one does — one server module, one key per stage, different
  // tool lists. The lane being finished changes nothing about this pin; a future lane adds more.
  // The multiplicity IS the property: one server module mounted under N per-stage keys, each holding a
  // different tool list. Every future conversion adds one more entry here, and that is the deliberate act.
  assert.deepEqual([...LOCAL_SERVER_SCRIPTS], [
    "perplexity-server.mjs",
    "band-server.mjs",
    "coverage-server.mjs",
    // — the second non-recording typed transport, beside `coverage`. It is ONE entry, not one per
    // stage, because exactly one stage holds it; the recording-server repetitions below are unchanged.
    "declination-server.mjs",
    // — the THIRD non-recording typed transport, and the first that arrived by moving a tool off
    // a shared key rather than by adding a new one. One entry: exactly one lane holds it.
    "dispositions-server.mjs",
    // — the FOURTH non-recording typed transport, and the first of them that MOVES
    // AN ARTIFACT rather than adding a side-channel. The other three sit beside a deliverable the seat keeps
    // authoring; this one makes register-units/<axis>.md the driver's. It is here rather than in the
    // recording repetitions below because the stage keeps a seat write of its own, which every RECORDING row
    // forbids by declaration. One entry: exactly one stage holds it, per axis or not.
    "unit-note-server.mjs",
    "recording-server.mjs",
    "recording-server.mjs",
    "recording-server.mjs",
    "recording-server.mjs",
    "recording-server.mjs",
    "recording-server.mjs",
    "recording-server.mjs",
    "recording-server.mjs",
    "recording-server.mjs",
    "recording-server.mjs",
    "recording-server.mjs",
    "recording-server.mjs",
    "recording-server.mjs",
  ], "LOCAL's derived script list changed shape — a key was added, removed, reordered or deduped");
});

test("an unknown group still fails LOUDLY — the catch-all the collapse must not swallow", () => {
  // Nothing in the suite covered this before (grep: zero hits for the message). `resolveGroup`'s default
  // throw is what stops a typo'd or retired group name resolving to "no tools" — which is
  // indistinguishable from a stage that is meant to have none, and is precisely how register-digest's
  // prompt came to order live register checks it held no tools for.
  assert.throws(() => allowedToolsFor(["recording-nope"]), /unknown tool group "recording-nope"/,
    "an unknown group resolved silently instead of throwing");
  assert.throws(() => buildGatherMcpConfig(["recording-nope"], {}), /unknown tool group/,
    "…and the config builder must refuse it too, not return an empty config");
});

test("NEGATIVE CONTROL: the comparison rejects a changed grant, a changed order and a changed config", () => {
  // Without this every assertion above is satisfied by a comparison that cannot fail. Each planted case
  // is driven through the SAME predicate the pin uses.
  const eq = (a, b) => { try { assert.deepEqual(a, b); return true; } catch { return false; } };
  const row = PINNED["skeptic"];

  assert.ok(eq(row, { ...row }), "the predicate does not accept an identical row — it is measuring nothing");
  assert.ok(!eq({ ...row, allowedTools: `${row.allowedTools} Bash` }, row),
    "an EXTRA granted tool passed the comparison");
  assert.ok(!eq({ ...row, allowedTools: row.allowedTools.replace(" mcp__recording-skeptic__search_run_artifacts", "") }, row),
    "a REMOVED granted tool passed the comparison");
  assert.ok(!eq({ ...row, allowedTools: "Read Write Edit mcp__recording-skeptic__search_run_artifacts mcp__recording-skeptic__record_skeptic" }, row),
    "a REORDERED allowlist passed the comparison — this is the gap O1's sort leaves, and the reason this file compares strings");
  assert.ok(!eq({ ...row, mcpConfig: row.mcpConfig.replace("recording-server.mjs", "band-server.mjs") }, row),
    "a swapped server SCRIPT passed the comparison");
  assert.ok(!eq({ ...row, groups: ["recording-blind-frame"] }, row),
    "the wrong stage's group passed the comparison");
});

test("the walk resolves through the SHIPPED map — a broken walk cannot fake the rows above", () => {
  // Every row would also be produced by a `toolGroupsForStage` that returned [] for everything, if the
  // pins were all `null`. They are not, and this states why: the walk is shown to return a group and a
  // grant for a stage that has one, and to return nothing for one that does not.
  assert.ok(toolGroupsForStage("skeptic").length > 0, "the map returned no group for a recording stage — the walk is dead");
  // The tool-free half of the walk follows the pin above to `notify` — owner-held, so it stops moving.
  assert.deepEqual(toolGroupsForStage("notify"), [], "the map handed a group to a tool-free stage");
  assert.ok(toolGroupsForStage("matter-frame").length > 0, "…and it returns one for the stage that just converted");
  // — `Read` alone now, for BOTH recording stages: their artifacts are the driver's, so the seat holds
  // no writer. The second half is the witness that the seeding still works where a seat DOES author a
  // file — without it this assertion would pass on a builder that dropped Write everywhere.
  //
  // THE WITNESS IS DERIVED NOW, AND THAT IS THE THIRD TIME IT MOVED. It was synthesis; tracker issue
  // 1893 moved it to register-digest when synthesis converted; conversion 11 converted register-digest.
  // Naming a stage here means the arm breaks on the conversion AFTER the one that re-points it, and each
  // time it fails as "a stage lost its write tools" — which reads as a regression in the builder rather
  // than as a fixture that has gone stale. Two conversions running, that is a false alarm about the one
  // thing this pair exists to detect.
  //
  // So the witness is any stage the SHIPPED map says still writes — `seatWritesForGroups` is the
  // predicate the builder itself seeds on, so this asks the same question the code answers. The arm
  // above it refuses an empty set by name: if every stage ever converts, this pair must be retired
  // deliberately, never left passing on a builder that dropped Write everywhere. That absence is the
  // exact failure the second half exists to catch, and a vacuous pass IS that absence.
  const WRITING_STAGE = Object.keys(STAGES).find((st) => {
    const g = toolGroupsForStage(st);
    return g.length > 0 && seatWritesForGroups(g);
  }) ?? null;
  assert.ok(WRITING_STAGE,
    "no stage in the registry still authors its own file, so the second half of this pair has nothing to "
    + "witness. Do NOT delete it: retire the pair deliberately, or the first half passes on a builder "
    + "that dropped Write everywhere.");
  assert.match(allowedToolsFor(toolGroupsForStage("skeptic")), /^Read mcp__recording-skeptic__/,
    "the allowlist is not the shipped builder's output");
  assert.match(allowedToolsFor(toolGroupsForStage(WRITING_STAGE)), /^Read Write Edit mcp__/,
    `${WRITING_STAGE} DOES author its own file and lost the write tools — the seeding change was not per-stage`);
});
