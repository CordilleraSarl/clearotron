// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A KNOCKOUT RATING'S REPAIR SENDS ONLY WHAT CHANGED. The recorder has always merged a correction onto the written record field
// by field and validated the assembled record, but the rating dispatch and the tool told the model that a name it sent replaced
// that name's whole record. So a turn told one sentence was wrong re-sent every field of the name (measured 2026-11-06: two
// repairs, 44 KB re-sent, 124 s). The contract now says what the recorder does: the first call is complete, a correction sends
// the name and the fields it changed, a field sent replaces that whole field, and a refused first call writes nothing to repair.
// Names are invented.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
import { recordKnockoutAssess, knockoutAssessChunkFile } from "../knockout-assess-record.mjs";
import { KO_STAGES, koPaths } from "../stages-knockout.mjs";

const DRIVER = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPAIR = "On the first call, send the complete assessment. Once the tool has confirmed a written record for this chunk, correct a name by sending its exact name and only the fields you changed. Omitted names and omitted fields within a name keep their recorded values. A field you send replaces that whole field: send a changed list or object complete, including unchanged entries. Update the chunk summary when the correction changes it. If the tool has written no record, send the complete corrected assessment.";
const WHOLE_NAME = /send (that|a corrected) mark (whole|complete)|replaces that mark's whole record/;

const TEMP = [];
after(() => { for (const d of TEMP) rmSync(d, { recursive: true, force: true }); });
const OWN = "/mark/us/invented-own";
const run = () => {
  const d = mkdtempSync(join(tmpdir(), "ko-repair-")); TEMP.push(d); mkdirSync(driverDir(d), { recursive: true });
  writeFileSync(driverDir(d, "register-records.json"), JSON.stringify({ marks: [
    { name: "LANTERNWICK", records: [{ recordId: OWN }] }, { name: "ODRAVEL", records: [] },
  ] }));
  // Each name holds a research payload, so the stage's own check reads the records rather than stopping at the payloads.
  mkdirSync(join(d, "research"), { recursive: true });
  for (const n of ["lanternwick", "odravel"]) writeFileSync(join(d, "research", `${n}.md`), "An invented page: https://shop.example.test/own");
  return d;
};
const mark = (name, extra = {}) => ({ name, rating: "High", bullets: [`An invented bullet for ${name}.`], basis: `An invented basis for ${name}.`,
  factors: ["An invented factor.", "Another invented factor."], counterFactors: ["An invented counter."], mitigation: "", contextFraming: "An invented use.",
  assessment: `An invented opening read for ${name}.`, findings: [], ...extra });
const first = (marks) => ({ framework: { source: "risk-framework-triage.md", ladder: ["High", "Low"] },
  batch: { productContext: "An invented batch.", standardCaveats: ["Triage only."] }, chunkSummary: "An invented summary.", marks });
const send = (dir, call) => recordKnockoutAssess(dir, call, { boundOrdinal: 0 });
const stored = (dir) => JSON.parse(readFileSync(knockoutAssessChunkFile(dir, 0), "utf8"));
const finding = (net) => ({ ordinal: 1, name: "An invented conflict", owner: "Invented Ltd", band: "High", net, type: "Active Business",
  evidence: ["https://shop.example.test/own"], basis: "An invented basis.", weighedFilings: [OWN] });

test("the rating dispatch carries the repair paragraph once, word for word, and no longer asks for a whole name", () => {
  for (const chunkNo of [0, 1]) {
    const runDir = mkdtempSync(join(tmpdir(), "ko-repair-msg-")); TEMP.push(runDir);
    const text = String(KO_STAGES["knockout-assess"].message({ K: koPaths(runDir), chunkNo, chunkMarks: [{ name: "QUILLBRAE" }], chunkTotal: 2,
      probeNote: "", framework: { bands: [{ label: "High" }, { label: "Manageable" }] }, frameworkPath: null }));
    assert.equal(text.split(REPAIR).length - 1, 1, `chunk ${chunkNo + 1}: the repair paragraph is not in the dispatch once, word for word`);
    assert.doesNotMatch(text, WHOLE_NAME, `chunk ${chunkNo + 1}: the dispatch still asks for a whole name`);
  }
});

// The tool's own words and requirements reach the model beside the dispatch's, so they are read as the model receives them.
function servedTools() {
  return new Promise((resolve, reject) => {
    const p = spawn("node", [join(DRIVER, "engine", "mcp", "recording-server.mjs")], { stdio: ["pipe", "pipe", "ignore"],
      env: { ...process.env, CLEAROTRON_BAND_RUN_DIR: join(DRIVER, "..", ".no-such-run") } });
    let buf = "";
    const timer = setTimeout(() => { p.kill(); reject(new Error("recording-server.mjs did not answer tools/list — could not look")); }, 20000);
    p.on("error", (e) => { clearTimeout(timer); reject(e); });
    p.stdout.setEncoding("utf8");
    p.stdout.on("data", (d) => {
      buf += d;
      for (const line of buf.split("\n")) {
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m?.id !== 2) continue;
        clearTimeout(timer); p.kill();
        return resolve(m.result?.tools ?? []);
      }
    });
    const send = (o) => p.stdin.write(JSON.stringify(o) + "\n");
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "ko-repair-words", version: "0" } } });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  });
}

test("the rating tool asks a call for its marks and a mark for its name, and says a correction sends only what changed", async () => {
  const tool = (await servedTools()).find((t) => t.name === "record_knockout_assess");
  assert.ok(tool, "record_knockout_assess was not served — that is a finding, not a pass");
  const schema = tool.inputSchema ?? {};
  assert.deepEqual(schema.required, ["marks"], "a correction that leaves the chunk summary as it was is refused at the tool");
  assert.deepEqual(schema.properties?.marks?.items?.required, ["name"], "a correction must still send every field of a name");
  assert.ok(String(tool.description).includes(REPAIR), "the tool does not carry the repair paragraph word for word");
  assert.doesNotMatch(String(tool.description), WHOLE_NAME, "the tool still asks for a whole name");
  assert.doesNotMatch(String(schema.properties?.marks?.description), /no omission/, "the marks list still forbids leaving a name out");
  assert.match(String(schema.properties?.marks?.items?.properties?.mitigation?.description), /SEND THE KEY on the first call/);
});

// The calls a seat makes, through the server it is handed, in order: the actual tool boundary, not the recorder alone.
function callThroughServer(runDir, calls) {
  return new Promise((resolve, reject) => {
    const p = spawn("node", [join(DRIVER, "engine", "mcp", "recording-server.mjs")], { stdio: ["pipe", "pipe", "ignore"],
      env: { ...process.env, CLEAROTRON_BAND_RUN_DIR: runDir, CLEAROTRON_RECORD_AXIS: "0" } });
    let buf = "";
    const answers = new Map();
    const timer = setTimeout(() => { p.kill(); reject(new Error("recording-server.mjs did not answer every tools/call — could not look")); }, 30000);
    p.on("error", (e) => { clearTimeout(timer); reject(e); });
    p.stdout.setEncoding("utf8");
    p.stdout.on("data", (d) => {
      buf += d;
      const lines = buf.split("\n"); buf = lines.pop();
      for (const line of lines) {
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (typeof m?.id !== "number" || m.id < 10) continue;
        const text = (m.result?.content ?? []).map((c) => c.text ?? "").join("");
        answers.set(m.id, (() => { try { return JSON.parse(text); } catch { return { raw: text, error: m.error }; } })());
        const next = m.id - 10 + 1;
        if (next < calls.length) send({ jsonrpc: "2.0", id: 10 + next, method: "tools/call", params: { name: "record_knockout_assess", arguments: calls[next] } });
        else { clearTimeout(timer); p.kill(); resolve(calls.map((_, i) => answers.get(10 + i))); }
      }
    });
    const send = (o) => p.stdin.write(JSON.stringify(o) + "\n");
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "ko-repair-calls", version: "0" } } });
    send({ jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "record_knockout_assess", arguments: calls[0] } });
  });
}

test("through the server the seat is handed, a complete first call and a one-field correction are both written", async () => {
  const dir = run();
  const [one, two] = await callThroughServer(dir, [first([mark("LANTERNWICK"), mark("ODRAVEL")]), { marks: [{ name: "ODRAVEL", basis: "A basis corrected through the tool." }] }]);
  assert.ok(one?.written, `the first call was not written: ${JSON.stringify(one)}`);
  assert.ok(two?.written, `the correction was not written: ${JSON.stringify(two)}`);
  const od = stored(dir).marks.find((m) => m.name === "ODRAVEL");
  assert.equal(od.basis, "A basis corrected through the tool.");
  assert.deepEqual(od.factors, mark("ODRAVEL").factors, "the correction lost a field it did not send");
});

test("a correction keeps every name and every field it does not send", () => {
  const dir = run();
  assert.ok(send(dir, first([mark("LANTERNWICK"), mark("ODRAVEL")])).written, "premise: the first call is written");
  const r = send(dir, { marks: [{ name: "LANTERNWICK", basis: "A corrected basis." }] });
  assert.equal(r.refused, null, r.refused);
  assert.ok(r.written, "a correction of one field was not written");
  const doc = stored(dir);
  const [lw, od] = ["LANTERNWICK", "ODRAVEL"].map((n) => doc.marks.find((m) => m.name === n));
  assert.equal(lw.basis, "A corrected basis.");
  assert.deepEqual({ ...lw, basis: undefined }, { ...mark("LANTERNWICK"), basis: undefined, ...pick(lw, ["degraded", "ref"]) }, "a field the correction did not send changed");
  assert.deepEqual(od, { ...mark("ODRAVEL"), ...pick(od, ["degraded", "ref"]) }, "a name the correction did not send changed");
  assert.equal(doc.chunkSummary, "An invented summary.", "the chunk summary was lost to a correction that did not send it");
  assert.equal(doc.batch?.productContext, "An invented batch.", "the batch was lost to a correction that did not send it");
});
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));

test("a field sent replaces that whole field: a changed list is taken as sent, entries left out included", () => {
  const dir = run();
  send(dir, first([mark("LANTERNWICK", { factors: ["One factor.", "Two factor.", "Three factor."] }), mark("ODRAVEL")]));
  const r = send(dir, { marks: [{ name: "LANTERNWICK", factors: ["One factor.", "A new second factor."] }] });
  assert.ok(r.written, r.refused);
  assert.deepEqual(stored(dir).marks.find((m) => m.name === "LANTERNWICK").factors, ["One factor.", "A new second factor."],
    "a list sent in a correction was merged with the recorded one instead of replacing it");
});

test("after still_refused, the name and its corrected findings answer it", () => {
  const dir = run();
  const chained = send(dir, first([mark("LANTERNWICK", { findings: [finding("An invented conflict in DE; listed since 2019 → likely to block.")] }), mark("ODRAVEL")]));
  assert.ok(chained.written, `premise: the record is written: ${chained.refused}`);
  assert.match(String(chained.still_refused), /knockout_finding_net_chained/, "premise: the stage would still refuse the chained conclusion");
  const repaired = send(dir, { marks: [{ name: "LANTERNWICK", findings: [finding("An invented conflict is likely to block the name in DE.")] }] });
  assert.ok(repaired.written, repaired.refused);
  assert.doesNotMatch(String(repaired.still_refused ?? ""), /knockout_finding_net_chained/, "the repair did not answer it");
  const lw = stored(dir).marks.find((m) => m.name === "LANTERNWICK");
  assert.equal(lw.findings[0].net, "An invented conflict is likely to block the name in DE.");
  assert.equal(lw.basis, "An invented basis for LANTERNWICK.", "the repair lost the name's other fields");
});

test("a first call that leaves fields out writes nothing, so a second partial call has no record to repair", () => {
  const dir = run();
  const partial = send(dir, { chunkSummary: "An invented summary.", batch: { productContext: "An invented batch." }, marks: [{ name: "LANTERNWICK", basis: "A basis alone." }] });
  assert.equal(partial.written, null, "a partial first call was written");
  assert.ok(partial.refused, "a partial first call was not refused");
  assert.equal(existsSync(knockoutAssessChunkFile(dir, 0)), false, "a refused first call left a chunk behind");
  const again = send(dir, { marks: [{ name: "LANTERNWICK", rating: "High" }] });
  assert.equal(again.written, null, "a second partial call was merged onto a refused one");
  assert.ok(again.refused);
});
