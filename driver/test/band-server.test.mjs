// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// PR-8 (Thread D2) — the band MCP server: read-only lookups over the frozen band + shape + _records/,
// with EVERY call appended to _driver/reading-log.jsonl (the reading audit). $0/offline: the server
// serves driver artifacts and never dials a vendor. Fixtures SYNTHETIC (shape-copied only).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { buildBandShape } from "../band-shape.mjs";
import { foldsCase } from "./platform-caps.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MCP = join(HERE, "..", "engine", "mcp");

async function mcpSession(requests, env = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(MCP, "band-server.mjs")], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ...env } });
    const responses = {}; let buf = "", stderr = "";
    const wantIds = new Set(requests.filter((r) => r.id != null).map((r) => r.id));
    const done = () => { try { child.kill("SIGKILL"); } catch { /* gone */ } resolve({ responses, stderr }); };
    const timer = setTimeout(done, 8000);
    child.stdout.on("data", (d) => {
      buf += d.toString(); let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line) continue;
        try { const m = JSON.parse(line); if (m.id != null) { responses[m.id] = m; wantIds.delete(m.id); } } catch { /* non-json */ }
      }
      if (wantIds.size === 0) { clearTimeout(timer); done(); }
    });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("error", reject);
    for (const r of requests) child.stdin.write(JSON.stringify(r) + "\n");
  });
}
const INIT = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } };
const call = (id, name, args = {}) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
const textOf = (r, id) => r.responses[id]?.result?.content?.[0]?.text ?? "";
const isErr = (r, id) => r.responses[id]?.result?.isError === true;

// ── the fixture run dir (synthetic, real-artifact SHAPE only) ────────────────────────────────────────
function seedRun() {
  const runDir = mkdtempSync(join(tmpdir(), "band-server-"));
  mkdirSync(driverDir(runDir), { recursive: true });
  mkdirSync(join(runDir, "_records"), { recursive: true });
  const band = {
    enumerated: [
      { record_id: "/mark/us/90000001", mark_text: "NOVA PULSE", classes: [32], status: "Registered", owner_name: "Synth Beverages",
        _query: "exact nova pulse [cl 32]", screen: { registry: "USPTO", live_status: "live", applicationDate: "2019-04-01" },
        score: 98.7, highlight: "<b>NOVA</b>", raw: { vendor: "noise blob" } },
      { record_id: "/mark/eu/222", mark_text: "NOVA PULSSE", classes: [32], status: "Registered", owner_name: "Beta GmbH", _query: "fuzzy nova [cl 32]", _qid: "primary-sweep:fuzzy:nova" },
      { record_id: "/mark/us/333", mark_text: "ZORVAPLUS", classes: [9], status: "Expired", owner_name: "Zorva Holdings", _query: "contains zorva [cl 9]" },
    ],
    crowds: [{ query: "contains NOVA [cl 32]", total_hits: 895, fetched: 100, sample: [], reason: "total_hits 895 exceeds the enumerate ceiling 600" }],
  };
  writeFileSync(join(runDir, "register-named-band.json"), JSON.stringify(band, null, 2));
  const { shape, md } = buildBandShape(band, { targets: ["NOVA PULSE"], inScopeClasses: ["32"] });
  writeFileSync(driverDir(runDir, "band-shape.json"), JSON.stringify(shape, null, 2));
  writeFileSync(join(runDir, "band-shape.md"), md);
  writeFileSync(join(runDir, "_records", "us-90000001.json"), JSON.stringify({ record_id: "/mark/us/90000001", status: "Valid", officialGazette: "synthetic" }, null, 2));
  return runDir;
}
const ENV = (runDir) => ({ CLEAROTRON_BAND_RUN_DIR: runDir, CLEAROTRON_GATHER_SESSION_KEY: "prelim-x-y-register-digest", CLEAROTRON_GATHER_AGENT: "clawdi" });
const readLog = (runDir) => existsSync(driverDir(runDir, "reading-log.jsonl"))
  ? readFileSync(driverDir(runDir, "reading-log.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];

test("band_shape: serves the md whole (default) and the json on request; both logged", async () => {
  const runDir = seedRun();
  const r = await mcpSession([INIT, call(2, "band_shape"), call(3, "band_shape", { format: "json" })], ENV(runDir));
  assert.match(textOf(r, 2), /# Band shape/);
  assert.match(textOf(r, 2), /## Floors/);
  const shape = JSON.parse(textOf(r, 3));
  assert.equal(shape.totals.records, 3);
  const log = readLog(runDir);
  assert.equal(log.filter((l) => l.tool === "band_shape").length, 2, "EVERY lookup lands in the reading log");
  assert.equal(log[0].session, "prelim-x-y-register-digest", "attribution rides the log");
  assert.equal(log[0].agent, "clawdi");
});

test("band_lookup: filters AND together; vendor noise stripped, screen kept whole; crowds ride along", async () => {
  const runDir = seedRun();
  const r = await mcpSession([
    INIT,
    call(2, "band_lookup", { owner: "synth" }),
    call(3, "band_lookup", { tier: "near-identical" }),
    call(4, "band_lookup", { text: "nova", live_only: true }),
    call(5, "band_lookup", { nice_class: "9" }),
  ], ENV(runDir));
  const byOwner = JSON.parse(textOf(r, 2));
  assert.equal(byOwner.matched, 1);
  assert.equal(byOwner.records[0].record_id, "/mark/us/90000001");
  assert.equal(byOwner.records[0].score, undefined, "provider score never served");
  assert.equal(byOwner.records[0].raw, undefined, "raw blob never served");
  assert.equal(byOwner.records[0].highlight, undefined);
  assert.equal(byOwner.records[0].screen.registry, "USPTO", "screen stays WHOLE — screening facts are decision content");
  const byTier = JSON.parse(textOf(r, 3));
  assert.deepEqual(byTier.records.map((x) => x.record_id), ["/mark/eu/222"], "tier classifies against the shape's frozen targets");
  const nova = JSON.parse(textOf(r, 4));
  assert.equal(nova.matched, 2);
  assert.equal(nova.matching_crowds.length, 1, "the un-enumerated NOVA crowd rides along");
  assert.match(nova.crowd_note, /never treat this result as their clean/);
  const cl9 = JSON.parse(textOf(r, 5));
  assert.deepEqual(cl9.records.map((x) => x.record_id), ["/mark/us/333"]);
  const log = readLog(runDir);
  assert.equal(log.filter((l) => l.tool === "band_lookup").length, 4);
  assert.equal(log.find((l) => l.args?.owner === "synth").matched, 1, "the log records what each lookup matched");
});

test("band_record: serves the fetched official record; an unfetched uri is an honest logged MISS", async () => {
  const runDir = seedRun();
  const r = await mcpSession([INIT, call(2, "band_record", { record_id: "/mark/us/90000001" }), call(3, "band_record", { record_id: "/mark/de/999" })], ENV(runDir));
  assert.equal(JSON.parse(textOf(r, 2)).status, "Valid", "the OFFICIAL record reaches judgment — _records/ finally has a reader");
  assert.equal(isErr(r, 3), true);
  assert.match(textOf(r, 3), /No official record fetched .* this run/);
  assert.match(textOf(r, 3), /read-only — it never fetches/);
  assert.match(textOf(r, 3), /us-90000001\.json/, "the miss lists what IS on file");
  const log = readLog(runDir);
  assert.deepEqual(log.map((l) => l.ok), [true, false], "hit and miss BOTH audited");
});

test("band_record A3: an UPPERCASE model-cited uri serves the lowercase-archived record (reader-side fold)", async () => {
  // The store is lowercase by construction (us-90000001.json); the uri below is what a narrative that
  // wrote "/mark/US/90000001" hands the tool. Before the A3 fold this was a false MISS — a record on
  // file the whole run, reported as a coverage gap. The writer (registry-fidelity.mjs) and reader
  // expressions look identical apart from the reader's .toLowerCase(); this test exists so a future
  // "cleanup" that re-converges them fails here instead of shipping.
  const runDir = seedRun();
  const r = await mcpSession([INIT,
    call(2, "band_record", { record_id: "/mark/US/90000001" }),
    call(3, "band_record", { record_id: "/Mark/Us/90000001" }),
  ], ENV(runDir));
  assert.equal(isErr(r, 2), false, "an uppercase cite of an archived record is a HIT, never a miss");
  assert.equal(JSON.parse(textOf(r, 2)).status, "Valid");
  assert.equal(isErr(r, 3), false, "mixed case (incl. the /mark/ prefix) folds too");
  assert.equal(JSON.parse(textOf(r, 3)).status, "Valid");
  const log = readLog(runDir);
  assert.deepEqual(log.map((l) => l.ok), [true, true], "both reads audited as hits");
});

// ──: the digest opens the documents it used to defer on ─────────────────────────────────────────
// A record_id is not typed, it is QUOTED — from the band prose, a findings table, a provider page. The
// squashed filename only ever matched one exact string, so every other form of the same reference read
// back as "no record fetched" while the document sat in _records/. Each form below is one document.

test("band_record: the cite resolves in every form the digest actually writes it", async () => {
  const runDir = seedRun();                                  // holds _records/us-90000001.json
  const r = await mcpSession([INIT,
    call(2, "band_record", { record_id: "https://tm.corsearch.com/mark/us/90000001" }),   // a provider URL
    call(3, "band_record", { record_id: "`/mark/us/90000001`." }),                        // markdown + punctuation
    call(4, "band_record", { record_id: "mark/US/90000001" }),                            // the leading slash dropped
  ], ENV(runDir));
  for (const id of [2, 3, 4]) {
    assert.equal(isErr(r, id), false, `cite form ${id} opens the document`);
    assert.equal(JSON.parse(textOf(r, id)).status, "Valid");
  }
  const log = readLog(runDir);
  assert.deepEqual(log.map((l) => l.ok), [true, true, true], "all three audited as hits");
  assert.deepEqual(log.map((l) => l.via), ["canonical", "canonical", "canonical"],
    "the audit says the ladder resolved them — an `exact` hit is the model quoting the store's own key");
});

// The store keys on the registration-INSTANCE uri the fetch logged (/mark/ch/57860/2014) while judgment
// cites the record (/mark/ch/57860) — the same granularity split screen-gate.mjs:99 fixed for its own
// membership test after the DELPHINOL false hard-halt, never fixed here.
test("band_record: a cite at record granularity opens the registration-instance document", async () => {
  const runDir = seedRun();
  writeFileSync(join(runDir, "_records", "ch-57860-2014.json"),
    JSON.stringify({ _uri: "/mark/ch/57860/2014", status: "Registered", goods: "class 5 pharmaceutical preparations" }, null, 2) + "\n");
  const r = await mcpSession([INIT,
    call(2, "band_record", { record_id: "/mark/ch/57860" }),        // the record
    call(3, "band_record", { record_id: "/mark/ch/57860/2014" }),   // the instance, as the store keys it
  ], ENV(runDir));
  assert.equal(isErr(r, 2), false, "the record-granularity cite opens the instance document");
  assert.match(JSON.parse(textOf(r, 2)).goods, /pharmaceutical/);
  assert.equal(isErr(r, 3), false, "and the exact instance cite still resolves as it always did");
  const log = readLog(runDir);
  assert.equal(log[0].via, "instance");
  assert.equal(log[0].resolved, "/mark/ch/57860/2014", "the audit records WHICH document the cite resolved to");
  assert.equal(log[1].via, undefined, "an exact hit carries no resolution note");
});

test("band_record: one cite over two instance documents is an ANSWERED ambiguity, never a silent pick", async () => {
  const runDir = seedRun();
  for (const yr of ["2014", "2019"])
    writeFileSync(join(runDir, "_records", `ch-57860-${yr}.json`), JSON.stringify({ _uri: `/mark/ch/57860/${yr}` }, null, 2) + "\n");
  const r = await mcpSession([INIT, call(2, "band_record", { record_id: "/mark/ch/57860" })], ENV(runDir));
  assert.equal(isErr(r, 2), true);
  assert.match(textOf(r, 2), /\/mark\/ch\/57860\/2014/);
  assert.match(textOf(r, 2), /\/mark\/ch\/57860\/2019/, "BOTH documents are named, so the next call can be exact");
  assert.match(textOf(r, 2), /ambiguity, NOT an absence/, "the model is told the documents exist — never a gap to state");
  assert.equal(readLog(runDir)[0].reason, "ambiguous");
});

// The filename squash conflates "-" and "/", so a filename-prefix match ALONE would serve
// /mark/cn/37554073-42 to a cite of /mark/cn/37554073 — a wrong document, worse than the miss it
// replaces. The instance expansion is confirmed against the artifact's own `_uri`, so it does not.
test("band_record: a hyphenated record id is not an instance of a shorter one", async () => {
  const runDir = seedRun();
  writeFileSync(join(runDir, "_records", "cn-37554073-42.json"),
    JSON.stringify({ _uri: "/mark/cn/37554073-42", mark_text: "NOT THE ONE" }, null, 2) + "\n");
  const r = await mcpSession([INIT, call(2, "band_record", { record_id: "/mark/cn/37554073" })], ENV(runDir));
  assert.equal(isErr(r, 2), true, "a different record is a MISS, never a served near-match");
  assert.equal(readLog(runDir)[0].reason, "not-fetched");
});

// The writer (registry-fidelity.mjs writeRecordArtifacts) keeps the store's case; this reader folds. The
// asymmetry is deliberate (the A3 note) — so the reader resolves through the DIRECTORY rather than by
// assuming the writer's fold. Defense-in-depth: today's keys reach the writer already lower-cased.
//
// — THE BEHAVIOUR AND THE MECHANISM ARE ASSERTED SEPARATELY, and this is the whole point of the
// test. The behaviour ("an archive written in another case is still opened") holds on every platform.
// The MECHANISM that delivers it does not: on a case-SENSITIVE volume the exact-case open misses and
// resolveRecordFile's directory ladder recovers it, logging `via: "exact-case"`; on a FOLDING volume
// (macOS's default, and ext4 mounted `-O casefold`) the kernel resolves the name itself, the ladder is
// never reached, and the read logs as a plain `exact` hit with no `via` at all.
//
// Asserting `via === "exact-case"` unconditionally is asserting the LINUX MECHANISM, and that is the
// assertion macOS CI failed — with the document opened correctly and its content served. It was never
// evidence of a portability defect: nothing in this layer depends on two differently-cased paths being
// distinct. The writer squashes with /[^a-z0-9]+/gi and the reader lowercases first, so two uris that
// differ only in case collide into one filename on BOTH platforms — a folding volume adds no ambiguity
// the reader did not already have. Case-sensitivity is what the ladder COMPENSATES for, never what it
// depends on.
//
// So: the behaviour is required everywhere, and the ladder is required exactly where the platform
// makes the ladder necessary. A folding machine still has to prove the row reached the reading audit —
// dropping the log assertion entirely would leave the fold untested rather than tested differently.
test("band_record: an archive written in another case is still opened", async () => {
  const runDir = seedRun();
  const records = join(runDir, "_records");
  rmSync(join(records, "us-90000001.json"));
  writeFileSync(join(records, "US-90000001.json"), JSON.stringify({ status: "Valid" }, null, 2) + "\n");
  const r = await mcpSession([INIT, call(2, "band_record", { record_id: "/mark/us/90000001" })], ENV(runDir));

  // The behaviour — identical on every platform, and the reason the test exists.
  assert.equal(isErr(r, 2), false);
  assert.equal(JSON.parse(textOf(r, 2)).status, "Valid");
  const row = readLog(runDir)[0];
  assert.equal(row.ok, true, "the read reached the reading audit as a success, however it resolved");

  // The mechanism — only where the platform leaves the ladder anything to do.
  if (foldsCase(records)) {
    assert.equal(row.via, undefined,
      "this volume folds case on lookup, so the kernel resolved the name and the ladder was never " +
      "reached — an `exact` hit logs no `via`. Nothing here is a defect: the case-folding ladder is " +
      "what a case-SENSITIVE volume needs, and this one is not.");
  } else {
    assert.equal(row.via, "exact-case",
      "case-sensitive volume: the exact-case open missed and resolveRecordFile's directory ladder " +
      "recovered the record — the asymmetry the A3 note pins");
  }
});

// ZERO SEMANTICS — an absence read as a pass is this codebase's recurring defect class. A document that
// genuinely cannot be opened must stay a DEFERRAL the run can see: the tool errors AND the reading audit
// carries the row with the reason. The unreadable case is the one that used to escape — the throw
// reached the model as an isError and left no row at all, so the log under-counted what went unread.
test("band_record: a document that genuinely cannot be opened stays a recorded deferral", async () => {
  const runDir = seedRun();
  const onFile = join(runDir, "_records", "us-90000001.json");
  rmSync(onFile);
  mkdirSync(onFile);                                        // on file, unopenable (EISDIR) — no uid dependence
  const r = await mcpSession([INIT,
    call(2, "band_record", { record_id: "/mark/de/999" }),          // never fetched: a dead link / no fetch
    call(3, "band_record", { record_id: "/mark/us/90000001" }),     // on file, cannot be read
    call(4, "band_record", { record_id: "the SIRENA cluster" }),    // names no record at all
    call(5, "band_record", { record_id: "" }),
  ], ENV(runDir));
  for (const id of [2, 3, 4, 5]) assert.equal(isErr(r, id), true, `call ${id} errors — never an empty success`);
  assert.match(textOf(r, 2), /No official record fetched .* this run/);
  assert.match(textOf(r, 3), /IS on file for this run but could not be read/);
  assert.match(textOf(r, 3), /not a record without one/, "an unopened document is never a record that had none");
  assert.match(textOf(r, 4), /did not parse as a record reference/);
  assert.match(textOf(r, 4), /never read it as a clean/);
  const log = readLog(runDir);
  assert.deepEqual(log.map((l) => l.ok), [false, false, false, false], "EVERY failure is audited");
  assert.deepEqual(log.map((l) => l.reason), ["not-fetched", "unreadable", "unparsable-uri", "no-record-id"],
    "…with the cause named, so a real unopenable document is countable and never reads as a case bug");
});

test("band_lookup caps returned rows but reports the full match count", async () => {
  const runDir = seedRun();
  // widen the band: 30 same-owner records
  const band = JSON.parse(readFileSync(join(runDir, "register-named-band.json"), "utf8"));
  for (let i = 0; i < 30; i++) band.enumerated.push({ record_id: `/mark/us/x${i}`, mark_text: `SYNTH ${i}`, classes: [32], status: "Registered", owner_name: "Bulk Owner", _query: "bulk" });
  writeFileSync(join(runDir, "register-named-band.json"), JSON.stringify(band));
  const r = await mcpSession([INIT, call(2, "band_lookup", { owner: "bulk owner", limit: 5 })], ENV(runDir));
  const out = JSON.parse(textOf(r, 2));
  assert.equal(out.matched, 30);
  assert.equal(out.returned, 5);
  assert.match(out.note, /narrow the filters/);
});

test("guards: missing band and unknown tier fail clean; a missing shape file names the driver defect", async () => {
  const empty = mkdtempSync(join(tmpdir(), "band-server-empty-"));
  const r = await mcpSession([INIT, call(2, "band_lookup", { owner: "x" }), call(3, "band_shape")], ENV(empty));
  assert.equal(isErr(r, 2), true);
  assert.match(textOf(r, 2), /register-named-band\.json not found/);
  assert.equal(isErr(r, 3), true);
  assert.match(textOf(r, 3), /driver defect/, "the model is told to REPORT the gap, never to slice the raw band instead");
  const runDir = seedRun();
  const r2 = await mcpSession([INIT, call(2, "band_lookup", { tier: "sorta-close" })], ENV(runDir));
  assert.equal(isErr(r2, 2), true);
  assert.match(textOf(r2, 2), /tier must be one of/);
});

test("band_lookup: qid filter is an EXACT join to the plan-execution ledger", async () => {
  const runDir = seedRun();
  const r = await mcpSession([INIT,
    call(2, "band_lookup", { qid: "primary-sweep:fuzzy:nova" }),
    call(3, "band_lookup", { qid: "primary-sweep:fuzzy:nov" }),       // prefix ≠ exact — no match
  ], ENV(runDir));
  const hit = JSON.parse(textOf(r, 2));
  assert.equal(hit.matched, 1);
  assert.equal(hit.records[0].record_id, "/mark/eu/222");
  assert.equal(hit.records[0]._qid, "primary-sweep:fuzzy:nova", "provenance is served, never stripped");
  assert.equal(JSON.parse(textOf(r, 3)).matched, 0, "qid joins exactly — a substring is not the entry");
});

// P2-B — Round-2 probe 7, on the real 2026-07-29 numbers. The owner slice enumerated six records that
// an earlier axis had already surfaced; the merge keeps ONE row per record and now stamps BOTH qids,
// so the exact-qid lookup that answered 0 (→ the run's "the owner-by-owner screen produced no
// records" self-diagnosis, → a printed negative over a screen it had disowned) answers 6.
test("band_lookup: the qid join matches EVERY slice that surfaced a record, not just the first", async () => {
  const runDir = seedRun();
  const OWNER_QID = "incumbent-class:default:tiki+owner-candlewick-farms-incorporated";
  const band = JSON.parse(readFileSync(join(runDir, "register-named-band.json"), "utf8"));
  // the merged shape mergeNamedBands now writes: first-seen `_qid` intact, the union in `_qids`.
  band.enumerated = band.enumerated.map((rec, i) => (i === 0
    ? { ...rec, _qid: "primary-sweep:exact:tiki", _qids: ["primary-sweep:exact:tiki", OWNER_QID],
        _query: "exact TIKI [cl 5,32]", _queries: ["exact TIKI [cl 5,32]", "exact TIKI owner:Candlewick Farms Incorporated [cl 5,32]"] }
    : rec));
  writeFileSync(join(runDir, "register-named-band.json"), JSON.stringify(band, null, 2));
  const r = await mcpSession([INIT,
    call(2, "band_lookup", { qid: OWNER_QID }),
    call(3, "band_lookup", { qid: "primary-sweep:exact:tiki" }),
    call(4, "band_lookup", { qid: "incumbent-class:default:tiki+owner-someone-else" }),
    call(5, "band_lookup", { query: "owner:Candlewick Farms Incorporated" }),
  ], ENV(runDir));
  assert.equal(JSON.parse(textOf(r, 2)).matched, 1, "the owner slice's own qid now finds the record it surfaced");
  assert.equal(JSON.parse(textOf(r, 3)).matched, 1, "the first-seen qid still finds it — no existing reader moves");
  assert.equal(JSON.parse(textOf(r, 4)).matched, 0, "membership, not looseness: a qid that surfaced nothing still matches nothing");
  assert.equal(JSON.parse(textOf(r, 5)).matched, 1, "the `query` filter reads the union of slice strings too");
});

// The union is SERVED only where it says something the first-seen stamp does not. band_lookup drops
// trailing records to fit the transport cap, so bytes per record are throughput: measured on a real
// 2,596-record band, serving both arrays unconditionally cost ~10% of a limit:100 lookup's rows.
test("band_lookup: a single-slice record serialises exactly as before; a multi-slice one carries its union", async () => {
  const runDir = seedRun();
  const OWNER_QID = "incumbent-class:default:tiki+owner-candlewick-farms-incorporated";
  const band = JSON.parse(readFileSync(join(runDir, "register-named-band.json"), "utf8"));
  band.enumerated = band.enumerated.map((rec, i) => ({
    ...rec,
    _qid: "primary-sweep:exact:tiki", _query: "exact TIKI [cl 32]",
    _qids: i === 0 ? ["primary-sweep:exact:tiki", OWNER_QID] : ["primary-sweep:exact:tiki"],
    _queries: i === 0 ? ["exact TIKI [cl 32]", "exact TIKI owner:Candlewick [cl 32]"] : ["exact TIKI [cl 32]"],
  }));
  writeFileSync(join(runDir, "register-named-band.json"), JSON.stringify(band, null, 2));
  const r = await mcpSession([INIT, call(2, "band_lookup", { limit: 100 })], ENV(runDir));
  const out = JSON.parse(textOf(r, 2));
  const multi = out.records.find((x) => x.record_id === band.enumerated[0].record_id);
  const single = out.records.find((x) => x.record_id === band.enumerated[1].record_id);
  assert.deepEqual(multi._qids, ["primary-sweep:exact:tiki", OWNER_QID], "where the union answers 'which slice found this', it ships");
  assert.equal(single._qids, undefined, "and where it only repeats `_qid`, it costs nothing");
  assert.equal(single._queries, undefined);
  assert.equal(single._qid, "primary-sweep:exact:tiki", "the first-seen stamp is always served");
});

// ── bounded serving: the transport cap is MAX_MCP_OUTPUT_TOKENS (~25k tokens), NOT the 256KB Read cap ──
// Floors are unconditional, so a crowded-dominant-element band (TIKI-class) pushes the md past the MCP
// cap and the tool call would ERROR in the engine. band_shape therefore serves parts, split at line
// boundaries, with an explicit part-N/M continuation contract; concatenating the parts restores the
// artifact byte-for-byte, so the floors stay complete across parts.
function seedCrowdedRun(floorCount = 2500) {
  const runDir = mkdtempSync(join(tmpdir(), "band-server-crowded-"));
  mkdirSync(driverDir(runDir), { recursive: true });
  const enumerated = [];
  for (let i = 0; i < floorCount; i++) {
    enumerated.push({
      record_id: `/mark/us/8${String(i).padStart(7, "0")}`, mark_text: i % 2 ? "NOVA PULSE" : "NOVA PULSSE",
      classes: [32], status: "Registered", owner_name: `Holder ${i % 400} Beverages GmbH & Co. KG`,
      _query: "exact nova pulse [cl 32]", screen: { registry: "USPTO", live_status: "live", applicationDate: "2021-01-01" },
    });
  }
  const band = { enumerated, crowds: [] };
  writeFileSync(join(runDir, "register-named-band.json"), JSON.stringify(band, null, 2));
  const { shape, md } = buildBandShape(band, { targets: ["NOVA PULSE"], inScopeClasses: ["32"] });
  assert.equal(shape.floors.in_class_identical_or_near.length, floorCount, "every floor listed — the amplifier this test exercises");
  writeFileSync(driverDir(runDir, "band-shape.json"), JSON.stringify(shape, null, 2));
  writeFileSync(join(runDir, "band-shape.md"), md);
  return { runDir, md };
}

test("band_shape: a floors-heavy shape serves in parts, each under the MCP token cap, concatenation byte-identical", async () => {
  const { runDir, md } = seedCrowdedRun();
  assert.ok(md.length > 140_000, `fixture is genuinely over one MCP response (${md.length} bytes)`);

  // First call announces the parts contract.
  const first = await mcpSession([INIT, call(2, "band_shape")], ENV(runDir));
  const t1 = textOf(first, 2);
  const m = t1.match(/^\[band_shape part 1\/(\d+)/);
  assert.ok(m, "an over-size shape announces part 1/M");
  const total = Number(m[1]);
  assert.ok(total >= 2, `served in ${total} parts`);
  assert.match(t1, new RegExp(`\\{"part": 2\\}`), "the continuation names the NEXT call — an honest contract, not a silent truncation");

  // Fetch every part; each response must fit the MCP transport cap: MAX_MCP_OUTPUT_TOKENS defaults to
  // 25,000 tokens and this tabular md measures ~3.7 chars/token, so the 70,000-char part budget is
  // ~19k tokens — pinned here with banner overhead included. (The old 256KB bound was the WRONG cap.)
  const rest = await mcpSession([INIT, ...Array.from({ length: total }, (_, i) => call(2 + i, "band_shape", { part: i + 1 }))], ENV(runDir));
  const parts = Array.from({ length: total }, (_, i) => textOf(rest, 2 + i));
  for (const p of parts) assert.ok(p.length <= 70_600, `every served part stays under the token-cap budget (${p.length} chars)`);

  // Strip the banner (first + last line) from each part; the concatenation is the artifact, byte-for-byte —
  // the floors stay COMPLETE across parts because the split never cuts a line.
  const body = (p) => p.split("\n").slice(1, -1).join("\n");
  assert.equal(parts.map(body).join("\n"), md, "concatenated parts === band-shape.md (nothing lost, nothing invented)");
  assert.match(parts[total - 1], /the shape is complete once parts 1\.\.\d+ are all read/);

  const log = readLog(runDir);
  const shapeCalls = log.filter((l) => l.tool === "band_shape");
  assert.ok(shapeCalls.every((l) => l.args.parts === total), "the reading audit records the part contract");
  assert.equal(shapeCalls[shapeCalls.length - 1].total_bytes, md.length, "and the artifact's full size");
});

test("band_shape: an out-of-range part clamps instead of erroring (the model can always finish the read)", async () => {
  const { runDir } = seedCrowdedRun(1200);
  const r = await mcpSession([INIT, call(2, "band_shape", { part: 99 })], ENV(runDir));
  assert.match(textOf(r, 2), /the shape is complete once parts/, "part 99 clamps to the last part");
});

// ── PR-11: the OTHER two tools honour the same transport cap ─────────────────────────────────────────
// band_shape shipped bounded (PR-8); band_lookup and band_record did not. A lookup of 100 fat records
// or one pathological official record could exceed the engine's per-tool-output token cap and ERROR the
// call — killing the reading path exactly where the record volume is highest.

test("band_lookup: an over-cap result trims RECORDS but never the match count or the crowd disclosure", async () => {
  const runDir = seedRun();
  // A tight cap stands in for the engine's token bound (same code path, no 100-record fixture needed).
  const r = await mcpSession([INIT, call(2, "band_lookup", { text: "nova", limit: 100 })],
    { ...ENV(runDir), CLEAROTRON_BAND_RESPONSE_CHARS: "4096" });
  const t = textOf(r, 2);
  assert.ok(t.length <= 4096 + 200, `the response fits the cap (${t.length} chars)`);
  const doc = JSON.parse(t);
  assert.ok(doc.matched >= doc.records.length, "the FULL match count survives the trim — the count is the honest part");
  if (doc.records.length < doc.matched) {
    assert.match(doc.byte_cap_note, /withheld to fit one tool response/, "and the response says so, with how to get the rest");
  }
  const log = readLog(runDir);
  assert.equal(log.at(-1).tool, "band_lookup");
  assert.equal(log.at(-1).matched, doc.matched, "the reading audit records the full match count, not the trimmed one");
});

test("band_record: an oversize official record serves in PARTS (a record is a document — never trimmed)", async () => {
  const runDir = seedRun();
  const uri = "/mark/us/90000001";
  const fat = { record_id: uri, mark_text: "NOVA PULSE", goods: Array.from({ length: 400 }, (_, i) => `class 32 wording line ${i} — beverages, syrups and preparations`) };
  writeFileSync(join(runDir, "_records", "us-90000001.json"), JSON.stringify(fat, null, 2) + "\n");
  const whole = readFileSync(join(runDir, "_records", "us-90000001.json"), "utf8");

  const first = await mcpSession([INIT, call(2, "band_record", { record_id: uri })],
    { ...ENV(runDir), CLEAROTRON_BAND_RESPONSE_CHARS: "4096" });
  const m = textOf(first, 2).match(/^\[band_record part 1\/(\d+)/);
  assert.ok(m, "an over-size record announces part 1/M rather than erroring or truncating");
  const total = Number(m[1]);
  const rest = await mcpSession([INIT, ...Array.from({ length: total }, (_, i) => call(2 + i, "band_record", { record_id: uri, part: i + 1 }))],
    { ...ENV(runDir), CLEAROTRON_BAND_RESPONSE_CHARS: "4096" });
  const parts = Array.from({ length: total }, (_, i) => textOf(rest, 2 + i));
  const body = (p) => p.split("\n").slice(1, -1).join("\n");
  assert.equal(parts.map(body).join("\n"), whole, "concatenated parts === the record on disk, byte-for-byte");
  assert.match(parts[total - 1], /the record is complete once parts 1\.\.\d+ are all read/);
});

test("band_record: a record that fits is served verbatim — no banner, byte-identical (the common case)", async () => {
  const runDir = seedRun();
  const r = await mcpSession([INIT, call(2, "band_record", { record_id: "/mark/us/90000001" })], ENV(runDir));
  const t = textOf(r, 2);
  assert.ok(!t.startsWith("[band_record part"), "no parts banner on a normal record");
  assert.equal(t, readFileSync(join(runDir, "_records", "us-90000001.json"), "utf8"));
});

// ── — band_lookup's crowd rider must carry a refusal AS a refusal ─────────────────────────────
// This is the fourth projection in the executor → judgment chain and the one judgment actually calls.
// Its own `crowd_note` says "weigh the descriptor, never treat this result as their clean" — and a
// descriptor reading `total_hits:0, fetched:0` IS a clean to whoever reads it. The executor writes that
// 0 as a placeholder beside an `error` stamp; this projection used to carry the 0 and drop the stamp.
function seedRefusedRun() {
  const runDir = mkdtempSync(join(tmpdir(), "band-server-refused-"));
  mkdirSync(driverDir(runDir), { recursive: true });
  mkdirSync(join(runDir, "_records"), { recursive: true });
  const band = {
    enumerated: [],
    crowds: [
      // never answered — the provider errored on it
      { query: "exact ZEPHYR [cl 9]", total_hits: 0, fetched: 0, sample: [], error: true,
        reason: "provider error during enumeration (page 0): register_search HTTP 504" },
      // never runnable — the provider cannot express it
      { query: "exact ZEPHYR cyrillic [cl 9]", total_hits: 0, fetched: 0, sample: [], error: true, deferred: true,
        reason: "capability-gap: term is not in Latin script" },
      // THE CONTROL: a sanctioned count-only crowd, which must still ship its real count
      { query: "contains ZEPHYR [cl 9]", total_hits: 895, fetched: 100, sample: [],
        reason: "total_hits 895 exceeds the enumerate ceiling 600" },
    ],
  };
  writeFileSync(join(runDir, "register-named-band.json"), JSON.stringify(band, null, 2));
  const { shape, md } = buildBandShape(band, { targets: ["ZEPHYR"], inScopeClasses: ["9"] });
  writeFileSync(driverDir(runDir, "band-shape.json"), JSON.stringify(shape, null, 2));
  writeFileSync(join(runDir, "band-shape.md"), md);
  return runDir;
}

test("#1424 band_lookup ships a refused slice as a refusal, never as a count of zero", async () => {
  const runDir = seedRefusedRun();
  const r = await mcpSession([INIT, call(2, "band_lookup", { text: "ZEPHYR" })], ENV(runDir));
  const body = JSON.parse(textOf(r, 2));
  rmSync(runDir, { recursive: true, force: true });

  const crowds = body.matching_crowds ?? [];
  assert.equal(crowds.length, 3, "all three matching slices must ride along");

  const refused = crowds.filter((c) => c.answered === false);
  assert.equal(refused.length, 2, "the two never-answered slices did not arrive as refusals");
  assert.deepEqual(refused.map((c) => c.refusal).sort(), ["capability-gap", "provider-error"]);
  for (const c of refused) {
    // The precise failure: a refusal must not carry a count at all. Shipping `total_hits: 0` is what
    // let a slice nobody searched read as a slice searched and found empty.
    assert.equal("total_hits" in c, false, `a refused slice still ships a count: ${JSON.stringify(c)}`);
    assert.equal("fetched" in c, false);
    assert.match(c.note, /NO COUNT WAS TAKEN/);
  }
  // THE CONTROL — the sanctioned crowd is unchanged and still carries its real numbers.
  const counted = crowds.find((c) => c.answered !== false);
  assert.equal(counted.total_hits, 895);
  assert.equal(counted.fetched, 100);
  assert.equal("refusal" in counted, false, "a plan-dictated crowd was relabelled a refusal");

  // The note has to say it too — the rider is only honest if the sentence beside it is.
  assert.match(body.crowd_note, /NEVER ANSWERED/);
  assert.match(body.crowd_note, /unsearched rather than empty/);
});

// ── — and an UNKNOWN size is not a refusal and not a zero ──────────────────────────────────────
test("#1615 band_lookup ships an unsized slice as unknown, never as a count", async () => {
  const runDir = mkdtempSync(join(tmpdir(), "band-server-unsized-"));
  mkdirSync(driverDir(runDir), { recursive: true });
  mkdirSync(join(runDir, "_records"), { recursive: true });
  const band = {
    enumerated: [],
    crowds: [
      // the register RAN this and would not state a total — fetched is real, the total is not
      { query: "exact ZEPHYR [cl 9]", total_hits: null, fetched: 3, sample: [],
        reason: "the register would only approximate the total, so no count was taken" },
      // THE CONTROL: a genuine counted zero, which must still ship as 0
      { query: "exact NOTHINGHERE [cl 9]", total_hits: 0, fetched: 0, sample: [], reason: "count-only descriptor" },
    ],
  };
  writeFileSync(join(runDir, "register-named-band.json"), JSON.stringify(band, null, 2));
  const { shape, md } = buildBandShape(band, { targets: ["ZEPHYR"], inScopeClasses: ["9"] });
  writeFileSync(driverDir(runDir, "band-shape.json"), JSON.stringify(shape, null, 2));
  writeFileSync(join(runDir, "band-shape.md"), md);

  const r = await mcpSession([INIT, call(2, "band_lookup", { text: "ZEPHYR" })], ENV(runDir));
  const unsized = JSON.parse(textOf(r, 2)).matching_crowds?.[0];

  const r2 = await mcpSession([INIT, call(3, "band_lookup", { text: "NOTHINGHERE" })], ENV(runDir));
  const body2 = JSON.parse(textOf(r2, 3));
  rmSync(runDir, { recursive: true, force: true });

  assert.equal(unsized.size, "unknown", "the unsized slice did not arrive as unknown");
  // A bare `total_hits: null` reads as zero or as a missing key about as often as it reads as
  // unknown, so the key is absent and the absence is named instead.
  assert.equal("total_hits" in unsized, false, `an unsized slice still ships a count: ${JSON.stringify(unsized)}`);
  assert.equal(unsized.fetched, 3, "what WAS fetched is real and must survive");
  assert.match(unsized.note, /SIZE IS UNKNOWN/);
  assert.equal("refusal" in unsized, false, "an unsized slice was relabelled a refusal — it ran, it just was not sized");

  // THE CONTROL — a counted zero still ships as a count of zero, because that is true about it.
  const counted = body2.matching_crowds?.[0];
  assert.equal(counted.total_hits, 0);
  assert.equal("size" in counted, false, "a genuine counted zero was relabelled unknown");
});

// ── — A RECORD THIS RUN ALREADY FETCHED IS NOT A MISS ────────────────────────────

test("⭐ PLANT tracker issue 2053: band_record serves from the run's LEDGER when the pile has not caught up", () => {
  // THE DEFECT, on a delivered round. `_records/` is not where a fetch lands — it is where the
  // end-of-run union puts what was fetched. So all run long this tool answered from a directory the
  // fetches do not write to, and reported the gap as a fact about the RUN:
  //
  //     "No official record fetched for <uri> this run."
  //
  // The seat asked for the single most obstructive right on the file FOUR times over three hours and
  // was refused every time — seventeen minutes after that record had been fetched and written to the
  // ledger. It reasoned without it and the finding survived only because the band line happened to
  // carry enough. Nothing surfaced the refusal; it sat in the reading audit, read by nothing.
  const runDir = seedRun();
  const uri = "/mark/eu/222";                      // in the band, deliberately NOT in _records/
  writeFileSync(driverDir(runDir, "register-record-bodies.jsonl"),
    JSON.stringify({ ts: "2026-08-29T20:48:43.839Z", provider: "clarivate", target: uri,
      body: { record_id: uri, status: "Registered", officialGazette: "eu-222" } }) + "\n");

  return mcpSession([INIT, call(2, "band_record", { record_id: uri })], ENV(runDir)).then((r) => {
    const text = JSON.stringify(r);
    assert.equal(/No official record fetched/.test(text), false,
      "the tool reported that nothing was fetched for a record this run HAD fetched — the false sentence "
      + "tracker issue 2053 is about, and the seat has no way to tell it from a real absence");
    assert.match(text, /officialGazette/, "the ledger held the body and it was not served");
    const log = readLog(runDir);
    const row = log.filter((l) => l.tool === "band_record").pop();
    assert.equal(row.ok, true, "a served record was logged as a failure");
    assert.equal(row.via, "ledger",
      "the reading audit does not say the record came from the ledger. Where it was served FROM is the "
      + "whole finding — a run whose records are only reachable that way is one the pile is failing.");
  });
});

test("⭐ PLANT tracker issue 2053: a record in NEITHER place is still a genuine miss, and still says so", () => {
  // The other half. Widening the lookup must not swallow the real deferral — a dead document that was
  // never fetched has to keep reading as one, or this tool stops being able to report a true absence.
  const runDir = seedRun();
  return mcpSession([INIT, call(2, "band_record", { record_id: "/mark/us/333" })], ENV(runDir)).then((r) => {
    assert.match(JSON.stringify(r), /No official record fetched/,
      "a record absent from BOTH the pile and the ledger stopped reporting as a miss — the deferral this "
      + "tool owes for real failures went quiet");
    const row = readLog(runDir).filter((l) => l.tool === "band_record").pop();
    assert.equal(row.ok, false);
  });
});
