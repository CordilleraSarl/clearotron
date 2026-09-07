// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — A PARTIAL PAYLOAD MUST NOT DELETE WHAT IT OMITS, ACROSS THE WHOLE POPULATION.
//
// ── THE CLASS, AND WHY A PER-STAGE GUARD CANNOT HOLD IT ─────────────────────────────────────────────
//
// A typed transport that writes its artifact WHOLESALE, and whose schema makes a content field
// OPTIONAL, will accept a call carrying only part of the document and silently drop the rest. Two
// transports have already been fixed for exactly this, each after it cost something:
//
//   record_synthesis         fixed after R2 lost fifteen findings of nineteen
//   record_register_digest   fixed four hours later, when the same shape was found on the two keys
//                            that had no natural join key and had taken the cheap branch
//
// Both fixes are correct and both are per-stage. Neither says anything about the other thirteen. This
// file is the population-level question, and its whole value is that a NEW transport joins it on the
// commit that adds it rather than on the incident that finds it.
//
// ── THE POPULATION IS DERIVED, NEVER GREPPED ────────────────────────────────────────────────────────
//
// `grep -rhoE '"record_[a-z_]+"' driver/*.mjs` returns sixteen names and is wrong in both directions:
// `record_fetch` and `record_list` are provider-metering KINDS (provider-usage.mjs:46), not tools, and
// it MISSES `record_declination`, which is declared outside the globbed directory. A numerator over an
// unknown population. The real population is RECORDING_STAGES' tools plus the four typed record tools
// served outside that category, and the arm below asserts it against what the servers actually serve.
//
// ── `required` IS ENFORCED AT THE WIRE SINCE — AND ONLY `required` ───────────────
//
// `serve()` used to hand the call straight to the tool, so a schema's `required` array was a STATEMENT
// OF INTENT and the acceptor was the only thing standing between a partial call and the artifact. It
// now checks the declared required fields first and refuses by name (stdio-server.mjs:157).
//
// BOTH DROPS ARE STILL PLANTED, and the reason is narrower than it was. The seam checks PRESENCE of
// required fields and NOTHING ELSE — types, enums, every shape constraint and every cross-field rule
// remain the acceptor's alone. So the acceptor is still the only thing standing between a MALFORMED
// call and the artifact, and an acceptor that would take a call missing a promised field is still a
// defect worth recording even though the seam now refuses it first.
//
// That is why this file plants BOTH directions. Dropping an OPTIONAL field asks whether the transport
// deletes what a partial omits. Dropping a REQUIRED one asks whether the acceptor enforces what the
// schema promises — and the first transport it was asked of said no: `record_blind_frame` declares
// `fields` required and accepts a call without it.
//
// ── THE SCHEMAS ARE ASKED FOR, NOT SCANNED ──────────────────────────────────────────────────────────
//
// The sibling guards read tool schemas out of the server SOURCE with a regex, because importing a
// server module runs `serve()` and starts it. That is a real constraint and this file answers it
// differently: these ARE MCP servers, so it spawns one and asks `tools/list`. What comes back is the
// resolved schema the seat itself is handed — spreads evaluated, enums expanded, immune to how the
// source happens to be formatted. Everything that could silently match nothing THROWS instead.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { RECORDING_TOOLS } from "../engine/mcp/gather-config.mjs";
import { acceptReportOverview } from "../report-overview-record.mjs";
import { acceptPrelimVariants } from "../prelim-variants-record.mjs";
import { acceptBlindFrame } from "../blind-frame-record.mjs";
import { acceptSkeptic } from "../skeptic-record.mjs";
import { acceptKnockoutAssess, recordKnockoutAssess } from "../knockout-assess-record.mjs";
import { acceptKnockoutFrame, recordKnockoutFrame, knockoutFrameFiles } from "../knockout-frame-record.mjs";
import { mkdtempSync, readFileSync as readFile } from "node:fs";
import { tmpdir } from "node:os";

const DRIVER = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = JSON.parse(readFileSync(join(DRIVER, "partial-payload-baseline.json"), "utf8"));

// The servers that carry a RETURN PATH. `band`, `fetch` and the register family are excluded by a
// stated rule: they hand the seat data, they do not receive the seat's artifact. `search_run_artifacts`
// is excluded on the same rule — it is a scoped READ served on a recording key.
const SERVERS = Object.freeze(["recording", "coverage", "dispositions", "unit-note", "declination"]);
const IS_RETURN_PATH = (name) => name.startsWith("record_");

/** Ask a server for its real tools/list. Resolves on the response; a timeout FAILS rather than returning []. */
function toolsOf(server) {
  const script = join(DRIVER, "engine", "mcp", `${server}-server.mjs`);
  return new Promise((resolve, reject) => {
    const p = spawn("node", [script], {
      stdio: ["pipe", "pipe", "ignore"],
      // A run dir that does not exist, deliberately: tools/list must not need one, and a handler that
      // reached for a run here would be reaching at load time.
      env: { ...process.env, CLEAROTRON_BAND_RUN_DIR: join(DRIVER, "..", ".no-such-run") },
    });
    let buf = "";
    const timer = setTimeout(() => { p.kill(); reject(new Error(`${server}-server.mjs did not answer tools/list — could not look`)); }, 20000);
    p.on("error", (e) => { clearTimeout(timer); reject(e); });
    p.stdout.on("data", (d) => {
      buf += d;
      for (const line of buf.split("\n")) {
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m?.id !== 2) continue;
        clearTimeout(timer); p.kill();
        const tools = m.result?.tools;
        if (!Array.isArray(tools) || tools.length === 0)
          return reject(new Error(`${server}-server.mjs served no tools — a scan that finds nothing is not a pass`));
        return resolve(tools);
      }
    });
    const send = (o) => p.stdin.write(JSON.stringify(o) + "\n");
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "census", version: "0" } } });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  });
}

/** Every return-path tool the servers actually serve, name -> resolved inputSchema. */
async function servedTransports() {
  const out = new Map();
  for (const s of SERVERS)
    for (const t of await toolsOf(s))
      if (IS_RETURN_PATH(t.name)) out.set(t.name, t.inputSchema ?? {});
  return out;
}

/** Top-level properties the schema PROMISES. Nothing enforces them before the acceptor. */
function requiredFields(schema) {
  return [...(schema?.required ?? [])];
}

/** Top-level properties a call may omit — the ones a partial can drop. */
function optionalFields(schema) {
  const required = new Set(schema?.required ?? []);
  return Object.keys(schema?.properties ?? {}).filter((k) => !required.has(k));
}

// ── THE PLANTED TRANSPORTS ──────────────────────────────────────────────────────────────────────────
//
// Each fixture is asserted VALID before anything is dropped from it. That is the anti-vacuity half: if
// an acceptor tightens and the fixture stops validating, this file reds loudly instead of quietly
// planting an invalid payload and reading the refusal as the property holding.
const PLANTED = Object.freeze({
  record_report_overview: {
    // `refuses` — this transport reads no prior state, so the only safe answer available to it is to
    // refuse. A transport that MERGES (register-digest, synthesis) cannot be pinned by a pure accept()
    // call at all: proving its promise needs two record*() calls against a run dir and an assertion
    // that the omitted key comes back with the STORED value. No planted transport merges today; the
    // field exists so that the first one to be added cannot be forced into the wrong assertion.
    expect: "refuses",
    accept: (p) => acceptReportOverview(p, { identity: null }),
    full: {
      overall_caption: "The mark is clear to proceed in the classes searched, subject to the conditions below.",
      actions: [
        { text: "Searched the EU register for identical and near-identical marks in classes 9 and 42.", source_link: "https://example.org/a" },
        { text: "Swept marketplace listings for unregistered use of the dominant element across four platforms." },
      ],
      methodology: "Register search across EUIPO and national registers, plus a common-law sweep of marketplace and web sources.",
      handling_note: "This is a preliminary clearance and not a legal opinion.",
    },
  },
  record_prelim_variants: {
    expect: "refuses",
    accept: acceptPrelimVariants,
    full: {
      mark: "PROJECT NOVAPULSE",
      dominant_element: "NOVAPULSE",
      elements: [{ value: "NOVAPULSE", kind: "distinctive" }, { value: "PROJECT", kind: "common" }],
      variants: [
        { value: "NOVAPULSE", category: "core", rationale: "the mark itself" },
        { value: "NOVAPULZE", category: "phonetic", rationale: "sound-alike" },
      ],
      incumbent_classes: ["9"],
      watchlist_owners: ["BigCo Interactive"],
      search_floor: ["primary-sweep"],
      scope_ledger: [
        { layer: "variant", item: "phonetic-family", status: "applied", reason: "sound-alike neighbours are in scope", reopen_trigger: "" },
        { layer: "jurisdiction", item: "EU", status: "applied", reason: "instructed territory", reopen_trigger: "" },
        { layer: "jurisdiction", item: "CN", status: "dropped", reason: "not instructed, no signalled market", reopen_trigger: "a CN filing surfaces" },
        { layer: "field", item: "game software", status: "applied", reason: "goods-overlap", reopen_trigger: "" },
        { layer: "source", item: "developer ecosystems", status: "dropped", reason: "off-channel for this product", reopen_trigger: "a developer-channel listing surfaces" },
      ],
    },
  },
  record_blind_frame: {
    expect: "refuses",
    accept: acceptBlindFrame,
    full: {
      dominant_element: "VELTRIN",
      variants: [
        { value: "VELTRI", direction: "drop", rationale: "the element without its terminal N" },
        { value: "VELTRYN", direction: "phonetic", rationale: "same sound, Latin-script respelling" },
      ],
      fields: [{ goods: "diagnostic software", on_field: true, rationale: "the actual product" }],
      sources: [{ channel: "hospital procurement portals", rationale: "where a buyer meets the mark" }],
      ranking_basis: "goods-overlap",
    },
  },
  // The positive control. Both of skeptic's declared fields are REQUIRED, so it has no partial to
  // plant — and a census where every planted row has an optional field would never show what the safe
  // shape looks like.
  record_skeptic: {
    expect: "refuses",
    accept: acceptSkeptic,
    full: {
      flags: [
        "primary-sweep worker: the phonetic fringe row cites a record the findings never joined",
        "incumbent-class: the crowd table's density note contradicts the digest's clean claim",
      ],
      escalations: [{ axis: "primary-sweep", reason: "a deferred row with real outstanding work a warm re-run closes" }],
    },
  },
  // ── THE FIRST MERGING TRANSPORT IN THIS CENSUS ────────────────────────────
  //
  // Every row above declares `expect: "refuses"` — its transport writes its artifact wholesale, so the
  // only safe answer to a partial is to turn it away. This one MERGES: a second call folds into the
  // stored record under a rule stated per key, so omitting a key is legitimate and the omitted value is
  // supposed to survive.
  //
  // The arm below used to assert `expect === "refuses"` for every planted row, and its own message named
  // the shape a merging transport needs instead — "planted through record*() twice against a run dir,
  // asserting the omitted key comes back stored." That is what the merge arm does. Adding the row with a
  // baseline entry instead would have recorded this transport as unexamined, which is the weaker claim
  // and the false one: the preservation is testable, so it is tested.
  record_knockout_assess: {
    expect: "merges",
    // Chunk 0 because the FIRST chunk is the branch that carries `batch` and `framework` — the two keys
    // whose survival across a second call is the whole question. A continuation chunk never sends them.
    accept: (params) => acceptKnockoutAssess(params, { boundOrdinal: 0 }),
    record: (runDir, params) => recordKnockoutAssess(runDir, params, { boundOrdinal: 0 }),
    full: {
      schema_version: 1,
      framework: { source: "risk-framework-triage.md", ladder: ["High", "Medium", "Low"] },
      batch: {
        productContext: "A three-name knockout batch for a beverages launch.",
        standardCaveats: "Triage only; not a clearance opinion.",
      },
      chunkSummary: "NOVAPULSE sits in a crowded beverage field. VELTRIN is clearer. Both need a full search before use.",
      marks: [{
        ref: "m1", name: "NOVAPULSE", classesSearched: [32], beltAndBraces: [33],
        contextFraming: "a drink name", rating: "High", ratingQualifier: null,
        classesDriving: [32], bullets: ["A live EU registration covers identical goods."],
        purpleNotes: [], registerEstimate: "several", parodyNote: "", crowdedField: true,
        findings: [{ ordinal: 1, name: "NOVAPULSE", owner: "BigCo", band: "High", net: "blocking",
                     type: "Active Business", evidence: ["EU 0180"], basis: "identical mark, identical goods" }],
        negatives: [{ term: "NOVAPULSE", source: "EUIPO", note: "no later filings" }],
        degraded: false,
        basis: "An identical live registration in the instructed class.",
        factors: ["Identical mark", "Identical goods", "Live and enforceable"],
        counterFactors: ["The owner's portfolio is small"],
        mitigation: "A coexistence approach could be explored.",
        assessment: "NOVAPULSE faces an identical live registration in its core class, which is the highest-blocking shape a triage can return.",
      }],
    },
  },

  // ── THE SECOND MERGING TRANSPORT, AND THE LANE'S LAST ( item C) ──────────────
  //
  // The frame stage hands back BOTH of its artifacts in one call — the plan and the scope note — so a
  // partial here can delete a whole document rather than a field, which is why it is planted rather
  // than named in the baseline.
  //
  // Its merge granularity is INSIDE `marks`, by mark name, and the acceptor validates the MERGED result
  // rather than the patch. That is what makes every top-level key droppable on a second call: the
  // stored value stands, so silence about a key is silence and not an instruction to clear it. The arm
  // below drops each in turn and reads the artifact back off disk.
  record_knockout_frame: {
    expect: "merges",
    accept: (params) => acceptKnockoutFrame(params),
    record: (runDir, params) => recordKnockoutFrame(runDir, params),
    full: {
      schema: 1,
      scope_note: "A knockout triage of two names for a beverages launch, swept in class 32 with class 33 "
        + "as belt and braces. Triage only: this is not a clearance opinion and no full search has run.",
      batch: {
        productContext: "A two-name knockout batch for a beverages launch.",
        umbrellaBrandNote: "Both names would sit under an existing house brand.",
        executionOrder: ["NOVAPULSE", "VELTRIN"],
      },
      marks: [
        {
          ref: "m1", name: "NOVAPULSE", classes: [32], beltAndBraces: [33],
          classesPlain: "soft drinks and mineral waters, with beers and spirits swept as a precaution",
          contextFraming: "a drink name for the core product line",
          priorKnowledge: "The requester believes it is coined.",
          priority: 1,
        },
        {
          ref: "m2", name: "VELTRIN", classes: [32], beltAndBraces: [33],
          classesPlain: "soft drinks and mineral waters, with beers and spirits swept as a precaution",
          contextFraming: "a sub-brand for a limited edition",
          priorKnowledge: "",
          priority: 2,
        },
      ],
    },
  },
});

/** The two kinds of planted transport, split by the answer each gives a partial. */
const plantedWhere = (kind) => Object.entries(PLANTED).filter(([, spec]) => spec.expect === kind);

test("the population is derived, and it is what the servers actually serve", async () => {
  const served = await servedTransports();
  assert.ok(served.size > 0, "no return-path transport was served at all — could not look");

  // The other derivation, from the grant table rather than from the servers. The two must agree.
  const granted = new Set(
    Object.values(RECORDING_TOOLS).flat()
      .map((t) => t.split("__").pop())
      .filter(IS_RETURN_PATH),
  );
  const OUTSIDE = ["record_coverage", "record_dispositions", "record_unit_note", "record_declination"];
  for (const t of OUTSIDE) granted.add(t);

  assert.deepEqual([...served.keys()].sort(), [...granted].sort(),
    "the served return-path tools and the granted ones disagree — one of the two derivations is stale, and a census over the wrong population proves nothing");
});

test("every transport is accounted for: planted, or named in the baseline with its reason", async () => {
  const served = await servedTransports();
  const planted = new Set(Object.keys(PLANTED));
  const unpinned = new Set(BASELINE.unpinned.map((r) => r.tool));
  const open = new Set(BASELINE.known_open.map((r) => r.tool));

  for (const tool of served.keys())
    assert.ok(planted.has(tool) || unpinned.has(tool) || open.has(tool),
      `${tool} is served and appears nowhere — a new transport joins this census on the commit that adds it, not on the incident that finds it`);

  for (const tool of [...planted, ...unpinned, ...open])
    assert.ok(served.has(tool), `${tool} is named here but no server serves it — the row is stale`);

  for (const tool of planted)
    assert.ok(!unpinned.has(tool),
      `${tool} is planted AND listed as unpinned — the baseline can only shrink, so remove its row in this commit`);
});

test("a planted transport refuses a partial, or preserves what the partial omits", async () => {
  const served = await servedTransports();
  const open = new Map(BASELINE.known_open.map((r) => [r.tool, new Set(r.fields)]));

  const refusing = plantedWhere("refuses");
  assert.ok(refusing.length > 0,
    "no planted transport declares expect:'refuses' — this arm would walk nothing, and a census that "
    + "examines zero transports reports exactly like one that found no defect");

  for (const [tool, spec] of refusing) {
    const schema = served.get(tool);
    assert.ok(schema, `${tool} was planted but is not served — could not look`);
    assert.ok(Object.keys(schema.properties ?? {}).length > 0,
      `${tool} served a schema declaring no properties — every drop below would be a drop of nothing`);
    assert.equal(spec.expect, "refuses",
      `${tool} declares expect:'${spec.expect}', and this arm can only assert the 'refuses' shape. `
      + `A merging transport must be planted through record*() twice against a run dir, asserting the omitted key comes back stored.`);

    // ANTI-VACUITY: the fixture must be a payload the shipped acceptor accepts, before anything is
    // dropped from it. A fixture that no longer validates would make every drop below "refused".
    const base = spec.accept(spec.full);
    assert.equal(base.ok, true, `${tool}'s full fixture no longer validates (${base.reason}) — this arm is planting nothing`);

    const optional = optionalFields(schema);
    for (const field of optional) {
      assert.ok(field in spec.full,
        `${tool} declares an optional field '${field}' the fixture does not carry — the drop below would test nothing`);
      const partial = { ...spec.full };
      delete partial[field];
      const v = spec.accept(partial);

      // ONE assertion, and it runs on EVERY field — never a branch that returns early.
      //
      // The first version of this arm asserted refusal in one branch and reproduction in the other,
      // and CI's assert-census failed it: every optional field on every planted transport is
      // currently a known-open hole, so the branch that catches a NEW one had never executed. A guard
      // whose detecting half is dead reads exactly like a guard that found nothing. Computing the
      // expected verdict and asserting it once keeps every field on a live assertion.
      const isKnownHole = Boolean(open.get(tool)?.has(field));
      assert.equal(v.ok, isKnownHole, isKnownHole
        ? `${tool}.${field} is recorded as a known-open hole and no longer reproduces — delete its row from partial-payload-baseline.json in the commit that fixed it`
        : `${tool} ACCEPTED a call omitting '${field}' and writes its artifact wholesale, so the value is gone and nothing fires. `
          + `Either refuse the partial, or merge it under a rule stated per key — mergeDigestPatch is the model. `
          + `If this is deliberate and safe, it needs a row in partial-payload-baseline.json saying why.`);
    }
  }
});

// ── THE MERGING HALF OF THE CENSUS ─────────────────────────────────────────────
//
// A wholesale-writing transport is safe when it REFUSES a partial. A merging one is safe when the value
// a partial omits is still there afterwards, which can only be shown by writing twice and reading back —
// the shape the arm above names in its own failure message.
//
// DRIVEN THROUGH `record*()` AGAINST A REAL RUN DIR, not through the acceptor. The acceptor validates one
// payload; the preservation lives in the merge that happens BEFORE it, against what the previous call
// stored. An arm that called `accept` twice would never touch the code it claims to be about.
test("a merging transport PRESERVES what a second call omits — written twice, read back from disk", async () => {
  const served = await servedTransports();
  const merging = plantedWhere("merges");
  assert.ok(merging.length > 0,
    "no planted transport declares expect:'merges' — this arm walks nothing. A merging transport that "
    + "stops being planted here loses the only check that its omitted keys survive");

  for (const [tool, spec] of merging) {
    const schema = served.get(tool);
    assert.ok(schema, `${tool} was planted but is not served — could not look`);

    // ANTI-VACUITY, same as the refusing arm: a fixture the acceptor no longer takes would make every
    // assertion below read as "preserved" for the wrong reason — nothing would ever be written at all.
    const base = spec.accept(spec.full);
    assert.equal(base.ok, true, `${tool}'s full fixture no longer validates (${base.reason}) — this arm is planting nothing`);

    const runDir = mkdtempSync(join(tmpdir(), "merge-plant-"));
    const first = spec.record(runDir, spec.full);
    assert.ok(first.written, `${tool} refused its own FULL fixture through record() (${first.refused}) — nothing is stored to merge into`);

    const optional = optionalFields(schema);
    assert.ok(optional.length > 0, `${tool} declares no optional field — there is nothing a second call could omit`);

    for (const field of optional) {
      assert.ok(field in spec.full,
        `${tool} declares an optional field '${field}' the fixture does not carry — the drop below would test nothing`);
      const partial = { ...spec.full };
      delete partial[field];

      const again = spec.record(runDir, partial);
      assert.ok(again.written,
        `${tool} REFUSED a second call omitting '${field}' (${again.refused}). A merging transport must accept a `
        + "partial — refusing one is the wholesale contract, and then this transport belongs in the refusing arm");

      const stored = JSON.parse(readFile(again.written, "utf8"));
      assert.deepEqual(stored[field], spec.full[field],
        `${tool} accepted a second call omitting '${field}' and the stored artifact no longer carries the value the `
        + "FIRST call supplied. That is the deletion this whole file exists to catch: the omission read as an "
        + "instruction to clear the key rather than as silence about it");
    }
  }
});

// ── A TWO-ARTIFACT TRANSPORT NEEDS ITS OWN REPAIR-TURN ARM ─────────────────────────────────────────
//
// The generic merge arm above reads ONE artifact — `written` — and asserts the omitted key came back off
// it. `record_knockout_frame` writes TWO from one call: the plan, and the scope note as its own document.
// `scope_note` is never in the plan by design, so the generic arm cannot see it, and once the schema
// declares it required the generic arm stops dropping it at all. Both are correct and both leave the
// client-facing question unasked: does a repair turn that corrects ONE MARK still leave the scope note
// and the untouched mark standing?
//
// It is asked here because the answer was NO when this transport was written, and nothing caught it. Its
// `lastAcceptedFrame` called the shared reader without the injected `readFileSync` that six sibling
// transports pass, so the lookup threw into a catch and returned null — "nothing stored yet". Every
// repair merged onto an empty base and was refused for a field the seat had already sent. The tool's own
// description invites exactly this call: "A repair turn may send only what it is correcting."
test("1997C: a knockout-frame repair turn correcting ONE mark keeps the note, the batch and the other mark", () => {
  const full = PLANTED.record_knockout_frame.full;
  const runDir = mkdtempSync(join(tmpdir(), "frame-repair-"));

  const first = recordKnockoutFrame(runDir, full);
  assert.ok(first.written, `the full fixture was refused (${first.refused}) — this arm is planting nothing`);
  const files = knockoutFrameFiles(runDir);
  const noteAfterFirst = readFile(files.frame, "utf8");
  assert.equal(noteAfterFirst, full.scope_note, "the note is written VERBATIM — no heading, no trailing newline");

  // THE REPAIR: one corrected mark, and nothing else. No scope_note, no batch, no second mark.
  const repair = { marks: [{ ...full.marks[0], contextFraming: "a drink name for the flagship line" }] };
  const again = recordKnockoutFrame(runDir, repair);
  assert.ok(again.written,
    `the repair turn was REFUSED (${again.refused}). A seat correcting one mark is doing what this tool's `
    + "description tells it to do; a refusal here exhausts the corrective ladder and the stage fails with "
    + "no report");

  // The client-facing document is untouched — not regenerated, not blanked, not re-composed.
  assert.equal(readFile(files.frame, "utf8"), full.scope_note,
    "the repair turn omitted scope_note and the scope note document changed. It is the surface an audit "
    + "reads to see which search ran, and silence about it is silence, not an instruction to clear it");

  const plan = JSON.parse(readFile(files.plan, "utf8"));
  assert.deepEqual(plan.batch, full.batch,
    "the repair turn omitted batch and the stored batch moved — productContext, the umbrella note and the "
    + "execution order all survive a call that did not speak about them");

  const byName = new Map(plan.marks.map((m) => [m.name, m]));
  assert.equal(plan.marks.length, full.marks.length,
    "the repair carried one mark and the plan now holds a different number — the mark it did not send was "
    + "dropped, which is the whole deletion class this file exists to catch");
  assert.deepEqual(byName.get(full.marks[1].name), full.marks[1],
    "the mark the repair did not mention was rewritten or lost");
  assert.equal(byName.get(full.marks[0].name).contextFraming, "a drink name for the flagship line",
    "the correction did not land — the repair turn wrote nothing");
});

test("the known-open rows name fields the schema actually declares as optional", async () => {
  const served = await servedTransports();
  for (const row of BASELINE.known_open) {
    const optional = new Set(optionalFields(served.get(row.tool)));
    assert.ok(optional.size > 0, `${row.tool} declares no optional field — its known-open row describes a shape that no longer exists`);
    for (const f of row.fields)
      assert.ok(optional.has(f),
        `${row.tool}.${f} is recorded as a known-open hole but the schema no longer declares it optional — the row is stale`);
  }
});

test("a required field is enforced by the ACCEPTOR, because nothing before it enforces one", async () => {
  // THE ACCEPTOR IS STILL ASKED DIRECTLY, and that is deliberate. Since the seam
  // refuses a missing required field before the handler (stdio-server.mjs:157), so this arm could no
  // longer be driven through `serve()` at all — the call would never arrive. It calls the acceptor
  // directly for exactly that reason: the seam protects the acceptor, it does not repair it, and a
  // second line of defence that has quietly stopped holding is worth knowing about. This arm is what
  // turns "safe — every content field is required" from a reading of the schema into a measurement.
  const served = await servedTransports();
  const known = new Map(
    (BASELINE.required_not_enforced ?? []).map((r) => [r.tool, new Set(r.fields)]),
  );

  for (const [tool, spec] of Object.entries(PLANTED)) {
    const required = requiredFields(served.get(tool));
    assert.ok(required.length > 0, `${tool} declares no required field — this arm would plant nothing`);

    for (const field of required) {
      assert.ok(field in spec.full,
        `${tool} declares '${field}' required and the fixture does not carry it — the fixture is not a full payload`);
      const partial = { ...spec.full };
      delete partial[field];
      const v = spec.accept(partial);

      // Same shape as the optional arm above, and for the same reason: one assertion, executed for
      // every required field, with the message chosen rather than the assertion skipped.
      const isKnownUnenforced = Boolean(known.get(tool)?.has(field));
      assert.equal(v.ok, isKnownUnenforced, isKnownUnenforced
        ? `${tool}.${field} is recorded as a promised-but-unenforced field and now IS enforced — delete its row from partial-payload-baseline.json in the commit that fixed it`
        : `${tool} declares '${field}' REQUIRED in the schema the seat is handed, and the acceptor took a call without it. `
          + `Nothing between the seat and the acceptor validates a schema, so this field is promised and not enforced anywhere.`);
    }
  }
});

// ── EVERY RETURN-PATH TRANSPORT DECLARES SOMETHING, OR SAYS WHY IT DECLARES NOTHING ────────────────
//
//. Three of the seventeen served return-path transports declare no top-level
// `required[]` at all. The issue's direction was to give each the declaration its acceptor already
// enforces — the stricter side of a schema/acceptor disagreement, never the reverse.
//
// READING THE ACCEPTORS SAYS THAT CANNOT BE DONE FOR THESE THREE, and the reason is the same in all
// three: `required[]` constrains the call as RECEIVED, while each acceptor validates a call MERGED onto
// what the run already accepted, or judged against facts the run supplies. Those are different objects.
// Declaring the acceptor's demands here would refuse the corrective calls the driver's own dispatch text
// instructs the seat to make.
//
// So this is the issue's second branch, taken deliberately: a stated row rather than a declaration. The
// row is not an excuse note — it names the mechanism, and the arms below fail if the mechanism goes away.
const DECLARES_NONE_BY_DESIGN = Object.freeze({
  record_synthesis:
    "A call omitting `findings` or `narrative` IS the patch path, not an incomplete call — "
    + "synthesis-record.mjs:525 detects a partial by that absence and merges it onto the last accepted "
    + "call before acceptSynthesis judges it. Declaring either required would refuse every corrective "
    + "repair-composers.mjs tells the seat to send.",
  record_register_digest:
    "Two mechanisms, either one sufficient. A patch merges onto the last accepted model "
    + "(register-digest-record.mjs:592) and carries only what it corrects. And a run whose band holds no "
    + "records legitimately sends no rows: registerdigest_nothing_judged "
    + "(register-digest-record.mjs:565) fires on the band's contents, not on the call's shape, so "
    + "whether a row is owed is a fact about the run that `required[]` cannot express.",
  record_unit_note:
    "The one field its acceptor demands, `axis`, is never the caller's to send: the driver binds it per "
    + "seat and unit-note-server.mjs injects it, so the seat is told to omit it. Every other field merges "
    + "onto the axis's last accepted note (register-unit-record.mjs:233). Measured: acceptUnitNote "
    + "accepts a call carrying nothing but the bound axis.",
});

/** Pure, so a plant can drive it: transports promising nothing with no stated reason. */
const undeclaredWithoutAReason = (served, exempt) =>
  [...served].filter(([name, schema]) => requiredFields(schema).length === 0 && !(name in exempt)).map(([n]) => n);

/** Pure: stated rows that no longer describe the served population. */
const rowsThatNoLongerHold = (served, exempt) =>
  Object.keys(exempt).flatMap((name) => {
    if (!served.has(name)) return [`${name} — stated here and not served at all`];
    if (requiredFields(served.get(name)).length > 0)
      return [`${name} — now declares ${requiredFields(served.get(name)).join(", ")}, so this row is stale`];
    return [];
  });

test("2027 every served return-path transport declares a required field, or states why it declares none", async () => {
  const served = await servedTransports();
  assert.ok(served.size > 0, "no return-path transports were served — a census over nothing is not a pass");
  const bare = undeclaredWithoutAReason(served, DECLARES_NONE_BY_DESIGN);
  assert.deepEqual(bare, [],
    `these return-path transports promise nothing and say nothing about why:\n  ${bare.join("\n  ")}\n`
    + "Give each the fields its acceptor refuses a call without, or add a row to DECLARES_NONE_BY_DESIGN "
    + "naming the mechanism that makes a declaration impossible. An empty required[] with no reason "
    + "reads as a transport with nothing to promise.");
});

test("2027 a NEW transport declaring nothing reds — the plant, because the real population is all-clean", async () => {
  // Every real transport passes the arm above, which is exactly the condition under which a census
  // stops proving anything. This drives the detecting branch with a member that does not exist yet.
  const served = await servedTransports();
  const planted = new Map([...served, ["record_a_brand_new_thing", { type: "object", properties: {} }]]);
  assert.deepEqual(undeclaredWithoutAReason(planted, DECLARES_NONE_BY_DESIGN), ["record_a_brand_new_thing"],
    "a new transport arriving with an empty required[] was not caught — the census is decorative");
  // And it passes once a declaration arrives, so the fix for the red is the real one.
  const fixed = new Map([...served, ["record_a_brand_new_thing", { type: "object", required: ["subject"] }]]);
  assert.deepEqual(undeclaredWithoutAReason(fixed, DECLARES_NONE_BY_DESIGN), [],
    "declaring a required field did not clear the red, so the guard names a fix that does not work");
});

test("2027 a stated row that stops being true is itself a red — the table cannot become a hiding place", async () => {
  const served = await servedTransports();
  assert.deepEqual(rowsThatNoLongerHold(served, DECLARES_NONE_BY_DESIGN), [],
    "a row in DECLARES_NONE_BY_DESIGN no longer describes what is served");
  // Both directions planted: a row for a transport nobody serves, and a row for one that has since
  // gained a declaration. Without these the table would quietly outlive its reasons.
  assert.deepEqual(rowsThatNoLongerHold(served, { ...DECLARES_NONE_BY_DESIGN, record_gone: "x" }),
    ["record_gone — stated here and not served at all"]);
  const withDecl = new Map([...served, ["record_synthesis", { type: "object", required: ["findings"] }]]);
  assert.deepEqual(rowsThatNoLongerHold(withDecl, DECLARES_NONE_BY_DESIGN),
    ["record_synthesis — now declares findings, so this row is stale"]);
});

test("2027 the three stated rows are the WHOLE of the undeclared population — no fourth hides behind them", async () => {
  const served = await servedTransports();
  const bare = [...served].filter(([, s]) => requiredFields(s).length === 0).map(([n]) => n).sort();
  assert.deepEqual(bare, Object.keys(DECLARES_NONE_BY_DESIGN).sort(),
    "the set of transports declaring nothing is not the set this table explains");
  // A FLOOR, not an equality. Pinning the exact count would red this arm on any commit that adds a
  // transport — work with nothing to do with 2027, whose only correct response is to bump a literal.
  // What is deliberate here is the table's CONTENTS, and the assertion above already pins those: a new
  // transport declaring nothing is caught by the first arm, and one that declares something should red
  // nothing. The floor keeps the population from silently collapsing, which is the failure a count was
  // reaching for.
  assert.ok(served.size >= Object.keys(DECLARES_NONE_BY_DESIGN).length,
    `the served return-path population collapsed to ${served.size} — fewer transports than rows explaining them`);
});
