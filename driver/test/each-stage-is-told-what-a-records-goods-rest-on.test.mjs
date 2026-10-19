// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// EACH STAGE IS TOLD WHAT A RECORD'S GOODS REST ON.
//
// Placement, the reading step, the write-up and the review read one sign for several facts: a line or a record "has
// no goods on file". The run's own record kept them apart and the stages did not (ruled 2026-10-18). Now the band
// shape's goods cell says, for a line the goods test could not place, whether its goods were cut by the register,
// held with their completeness not established, listed as none on the register's record, or lost to a failed fetch,
// and its machine copy carries the state as `goods_evidence`. The lookup gives each record `goods_from`, the
// evidence its goods rest on. The record tool says a fetch failed only where the register's call ledger records
// the failure, and where the register's search answer listed goods for a record it holds no official record of, it
// serves those statements with their source and completeness. The write-up's list says each record's goods source.
// Every mark, owner, record id and goods line is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
import { buildBandShape } from "../band-shape.mjs";
import { STAGES } from "../stages.mjs";
import { goodsFromLabel } from "../goods-evidence.mjs";

const MCP = join(dirname(fileURLToPath(import.meta.url)), "..", "engine", "mcp");
const at = (n, text) => (text + " and other goods".repeat(40)).slice(0, n);
const signa = (text, flag) => ({ nice_class: 9, goods_services_text: text, goods_services_language: "en", ...(flag === undefined ? {} : { goods_services_text_truncated: flag }) });
const row = (id, owner, classifications = null) => ({ record_id: `/mark/us/${id}`, mark_text: "QZORVAK", owner_name: owner, classes: ["9"],
  status: "registered", jurisdictions: ["US"], ...(classifications ? { raw: { classifications } } : {}) });
const BAND = [
  row("e1", "Alpha Ltd"),                                                  // a held official record with goods
  row("e2", "Beta GmbH"),                                                  // a held official record listing none
  row("e3", "Gamma SA", [signa("Laser printers", false)]),                 // a search answer's whole statement
  row("e4", "Delta AG", [signa(at(280, "Laser printers"), true)]),         // cut by the register
  row("e5", "Eta Kft", [signa(at(280, "Laser printers"), false)]),         // at the default answer's cut, unflagged
  row("e6", "Theta Oy"),                                                   // nothing held, a fetch failed
  row("e7", "Iota Oy"),                                                    // nothing held
  row("e8", "Kappa Ltd", [signa("Laser printers", true)]),                 // a search answer, and a fetch that failed
  row("e9", "Lambda AG"),                                                  // a held official record the register flags as cut
  row("e10", "Mu SA"),                                                     // a held official record whose goods field is missing
];
const PREFIX = "clearance-qz-test-";

function seedRun(t) {
  const runDir = mkdtempSync(join(tmpdir(), "goods-rest-on-"));
  t.after(() => rmSync(runDir, { recursive: true, force: true }));
  mkdirSync(driverDir(runDir), { recursive: true });
  writeFileSync(join(runDir, "status.json"), JSON.stringify({ slug: "qz", codename: "test" }));
  writeFileSync(join(runDir, "register-named-band.json"), JSON.stringify({ enumerated: BAND, crowds: [] }));
  writeFileSync(driverDir(runDir, "band-shape.json"), JSON.stringify({ groups: { goods_test: { source: "product_words", words: ["joysticks"] } } }));
  const body = (target, b) => JSON.stringify({ ts: "2026-10-18T00:00:00Z", provider: "x", sessionKey: `${PREFIX}register-unit-primary`, target, body: b });
  writeFileSync(driverDir(runDir, "register-record-bodies.jsonl"), [
    body("/mark/us/e1", { statusText: "Registered", goodsServices: [{ classes: [9], language: "en", description: "joysticks" }] }),
    body("/mark/us/e2", { statusText: "Registered", _raw: { classifications: [] } }),
    body("/mark/us/e9", { statusText: "Registered", _raw: { classifications: [signa(at(280, "Laser printers"), true)] } }),
    body("/mark/us/e10", { statusText: "Registered" }),
  ].join("\n") + "\n");
  const calls = join(runDir, "register-calls.jsonl");
  writeFileSync(calls, [
    { ts: "2026-10-18T00:00:00Z", sessionKey: `${PREFIX}screen-gate-refetch`, tool: "record_fetch", target: "/mark/us/e6", ok: false, http_status: 503 },
    { ts: "2026-10-18T00:00:00Z", sessionKey: `${PREFIX}screen-gate-refetch`, tool: "record_fetch", target: "/mark/us/e8", ok: false, http_status: 404 },
    { ts: "2026-10-18T00:00:00Z", sessionKey: "clearance-other-run-screen-gate-refetch", tool: "record_fetch", target: "/mark/us/e7", ok: false, http_status: 404 },
  ].map((r) => JSON.stringify(r)).join("\n") + "\n");
  return { runDir, env: { CLEAROTRON_BAND_RUN_DIR: runDir, CLEAROTRON_REGISTER_CALL_LOG: calls } };
}

async function session(requests, env) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(MCP, "band-server.mjs")], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ...env } });
    const responses = {}; let buf = "";
    const want = new Set(requests.filter((r) => r.id != null).map((r) => r.id));
    const done = () => { try { child.kill("SIGKILL"); } catch { /* gone */ } resolve(responses); };
    const timer = setTimeout(done, 8000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d) => {
      buf += d.toString(); let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line) continue;
        try { const m = JSON.parse(line); if (m.id != null) { responses[m.id] = m; want.delete(m.id); } } catch { /* not json */ }
      }
      if (want.size === 0) { clearTimeout(timer); done(); }
    });
    child.on("error", reject);
    for (const r of requests) child.stdin.write(JSON.stringify(r) + "\n");
  });
}
const INIT = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } };
const tool = (id, name, args) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
const textOf = (r) => r?.result?.content?.[0]?.text ?? "";

test("the shape's goods cell says why the goods test could not place a line, and its machine copy carries the state", () => {
  const states = { e3: "complete", e4: "cut", e5: "unknown", e2: "absent", e6: "unavailable", e7: "not-held" };
  const goods = { of: () => null, held: () => false, hits: () => null, matched: () => null };
  const { shape, md } = buildBandShape({ enumerated: BAND.filter((r) => states[r.record_id.split("/").pop()]), crowds: [] },
    { targets: ["Qzorvak"], inScopeClasses: ["9"], goods, goodsTest: { source: "product_words", words: ["joysticks"] }, goodsWordCount: 1,
      evidenceOf: (r) => ({ state: states[r.record_id.split("/").pop()] }) });
  const lines = ["a", "b", "c", "d", "rest", "no_goods"].flatMap((g) => shape.groups[g].list);
  assert.deepEqual(Object.fromEntries(lines.map((l) => [l.record_id.split("/").pop(), l.goods_evidence])), states, "the machine copy carries each line's state");
  const cellOf = (id) => md.split("\n").find((l) => l.includes(`/mark/us/${id} |`))?.split("|").map((c) => c.trim())[6];
  assert.deepEqual(Object.fromEntries(Object.keys(states).map((id) => [id, cellOf(id)])), {
    e3: "on file, not readable", e4: "cut by the register, no goods word found", e5: "goods held; completeness not established",
    e2: "the register's record lists no goods", e6: "fetch failed, no goods on file", e7: "no goods on file",
  });
});

test("the lookup gives each record what its goods rest on, from the evidence the record holds", async (t) => {
  const { env } = seedRun(t);
  const r = await session([INIT, tool(2, "band_lookup", { text: "QZORVAK", limit: 20 })], env);
  const records = JSON.parse(textOf(r[2])).records;
  assert.deepEqual(Object.fromEntries(records.map((x) => [x.record_id.split("/").pop(), x.goods_from])), {
    e1: "official record", e2: "official record, no goods listed", e3: "search answer", e4: "search answer, cut by the register",
    e5: "search answer, completeness not established", e6: "fetch failed", e7: "nothing held", e8: "search answer, cut by the register",
    e9: "official record, cut by the register", e10: "official record, completeness not established",
  }, "a failed fetch beside a search answer's goods: the goods the record holds are its evidence, not the call that failed; a missing goods field is not a record listing none");
});

test("the record tool says a fetch failed only where the ledger records it, and serves a search answer's goods with their source", async (t) => {
  const { env } = seedRun(t);
  const r = await session([INIT, tool(2, "band_record", { record_id: "/mark/us/e6" }), tool(3, "band_record", { record_id: "/mark/us/e7" }),
    tool(4, "band_record", { record_id: "/mark/us/e4" }), tool(5, "band_record", { record_id: "/mark/us/e8" })], env);
  assert.match(textOf(r[2]), /^No official record is on file for "\/mark\/us\/e6": a fetch of it failed this run\. /);
  assert.match(textOf(r[3]), /^No official record fetched for "\/mark\/us\/e7" this run\. /, "another run's failed fetch is not this run's");
  const cut = textOf(r[4]).split("\n");
  assert.equal(cut[0], `No official record is on file for "/mark/us/e4". The register's search answer listed these goods. Their source and completeness are shown with each statement.`);
  assert.deepEqual(JSON.parse(cut[1]), { class: "9", text: at(280, "Laser printers"), goods_from: "search answer, cut by the register" });
  assert.match(cut[2], /This tool is read-only — it never fetches; a record you need but do not have is an honest gap to state, not a reason to guess\.$/);
  assert.equal(textOf(r[5]).split("\n")[0], `No official record is on file for "/mark/us/e8": a fetch of it failed this run. The register's search answer listed these goods. Their source and completeness are shown with each statement.`);
  assert.equal(r[4].result.isError, true, "it is still the miss of an official record");
  const list = (await session([INIT, { jsonrpc: "2.0", id: 2, method: "tools/list" }], env))[2].result.tools;
  assert.ok(list.find((x) => x.name === "band_record").description.includes("Read-only: it never fetches. An unfetched record returns an honest miss listing what is on file, with the goods the register's search answer listed for it where it listed any; a record that IS on file but cannot be opened says so — both are gaps to state, never records without documents."));
});

test("the write-up's list says what each record's goods rest on", () => {
  const base = { paths: { findings: "/run/findings.json" }, job: {}, customerUnknown: false, profile: null, intakeAsks: [], enforcerSignals: null,
    framework: null, jxAim: null, registerOnly: false, crowdContext: null, dispatchBlocks: {} };
  const surface = [{ kind: "record", uri: "/mark/eu/a1", mark: "QZORVAK", owner: "Alpha Ltd", tier: "sheet-2", goods_from: goodsFromLabel({ source: "record-body", state: "complete" }) },
    { kind: "record", uri: "/mark/eu/a2", mark: "Plimbo", owner: "Beta GmbH", tier: "sheet-2", goods_from: goodsFromLabel({ source: "search-row", state: "cut" }) },
    { kind: "record", uri: "/mark/eu/a3", mark: "Drellux", owner: "Gamma SA", tier: "sheet-2" }];
  const text = String(STAGES.synthesis.message({ ...base, findingsSurface: surface }));
  assert.ok(text.includes("  0. QZORVAK — Alpha Ltd [sheet-2] /mark/eu/a1 — goods: official record\n"));
  assert.ok(text.includes("  1. Plimbo — Beta GmbH [sheet-2] /mark/eu/a2 — goods: search answer, cut by the register\n"));
  assert.ok(text.includes("  2. Drellux — Gamma SA [sheet-2] /mark/eu/a3\n"), "a row with no recorded evidence keeps its line as it was");
});

test("a cite without its leading slash reads on the record tool's miss as it does on a hit: its failed fetch and its search answer's goods", async (t) => {
  const { env } = seedRun(t);
  const r = await session([INIT, tool(2, "band_record", { record_id: "mark/us/e8" })], env);
  assert.equal(textOf(r[2]).split("\n")[0], `No official record is on file for "mark/us/e8": a fetch of it failed this run. The register's search answer listed these goods. Their source and completeness are shown with each statement.`);
});
