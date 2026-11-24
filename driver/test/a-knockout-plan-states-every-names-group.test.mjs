// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A KNOCKOUT PLAN STATES EVERY NAME'S GROUP, AND A REFUSED FIRST SAVE IS REPAIRED WHOLE (design, 2026-11-24).
//
// A plan that left the families out was accepted, and the scheduler then rated every name alone: six variations of one name
// could lose their shared reading with no refusal (reproduced offline, 2026-11-24). A fresh plan is now refused until it
// says where every name sits, singletons included; a held answer from before keeps what it framed. The repair rule was
// "send only what you are correcting", which after a refused first call lost every other name, because nothing was saved
// to merge onto. Every name here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FAMILIES_RULE, FRAME_REPAIR_RULE, validators } from "../verify-knockout.mjs";
import { acceptKnockoutFrame, recordKnockoutFrame } from "../knockout-frame-record.mjs";
import { koChunks, KO_STAGES } from "../stages-knockout.mjs";

const DRIVER = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The tool as the recording server serves it. */
function toolOf(name) {
  const runDir = mkdtempSync(join(tmpdir(), "frame-tool-"));
  return new Promise((resolve, reject) => {
    const p = spawn("node", [join(DRIVER, "engine", "mcp", "recording-server.mjs")], { stdio: ["pipe", "pipe", "ignore"],
      env: { ...process.env, CLEAROTRON_BAND_RUN_DIR: runDir } });
    let buf = "";
    const done = (fn, v) => { clearTimeout(timer); p.kill(); rmSync(runDir, { recursive: true, force: true }); fn(v); };
    const timer = setTimeout(() => done(reject, new Error("tools/list did not answer")), 20000);
    p.on("error", (e) => done(reject, e));
    p.stdout.setEncoding("utf8");
    p.stdout.on("data", (d) => {
      buf += d;
      for (const line of buf.split("\n")) {
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m?.id === 2) return done(resolve, (m.result?.tools ?? []).find((t) => t?.name === name) ?? null);
      }
    });
    const send = (o) => p.stdin.write(JSON.stringify(o) + "\n");
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "arm", version: "0" } } });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  });
}

const SIX = ["Tallowmere", "Tallowmere Gold", "Tallowmere Kids", "Tallowmeer", "Tallowmeres", "Tallo Mere"];
const NAMES = [...SIX.slice(0, 3), "Brindlecove", ...SIX.slice(3), "Ostrevane"];
const ROW = (name) => ({ name, classes: [30], classesPlain: "confectionery (30)", contextFraming: "a sweet",
  places: ["web", "shop.example.test"] });
const BATCH = { productContext: "An invented confectionery range.", inUseAs: "a sweet or a snack line", useKind: "sweet range" };
const CALL = (families, marks = NAMES.map(ROW)) => ({ scope_note: "Eight invented names, screened.",
  batch: { ...BATCH, ...(families === undefined ? {} : { families }) }, marks });
const GROUPINGS = {
  "six, one and one": [SIX, ["Brindlecove"], ["Ostrevane"]],
  "eight groups of one": NAMES.map((n) => [n]),
};

test("a fresh plan with six variations and two unrelated names, or with eight groups of one, is accepted as sent", () => {
  for (const [label, families] of Object.entries(GROUPINGS)) {
    const r = acceptKnockoutFrame(CALL(families));
    assert.equal(r.ok, true, `${label}: ${r.reason}`);
    assert.deepEqual(r.model.batch.families, families, `${label}: the plan carries the groups the call sent`);
  }
});

test("a fresh plan with no groups is asked to complete them, in the one definition", () => {
  for (const missing of [undefined, null]) {
    const r = acceptKnockoutFrame(CALL(missing));
    assert.equal(r.ok, false, "a plan with no groups was accepted, and every name would have been rated alone");
    assert.equal(r.reason, `knockoutframe_families: batch.families is required to complete the plan. ${FAMILIES_RULE}`);
  }
  // A SAVED PLAN STAYS READABLE (design, 2026-11-24): the record refuses a fresh call without groups, and the stage's check
  // still reads a plan written before, which the scheduler rates one name at a time as it always did.
  const saved = JSON.stringify({ schema: 1, batch: BATCH, marks: NAMES.map((n) => ({ ...ROW(n), spellings: [n] })) });
  assert.doesNotMatch(validators.knockoutPlan("/nowhere/knockout-plan.json", saved).reason ?? "", /families/,
    "the stage's check refuses a saved plan for the groups a fresh call must now carry");
});

test("a saved answer keeps reading without groups, a fresh call shaped like one does not, and a broken grouping is still named", () => {
  const held = { scope_note: "One invented name, screened.", batch: { productContext: "An invented range.", inUseAs: "a sweet" },
    marks: [{ ...ROW("Brindlecove"), useKind: "sweet", spellings: ["Brindlecove", "Brindle Cove"] }] };
  assert.equal(acceptKnockoutFrame(held, { saved: true }).ok, true, "a saved answer framed before the field was required is refused");
  const fresh = acceptKnockoutFrame(held).reason ?? "";
  assert.match(fresh, /knockoutframe_families: batch\.families is required/, "a fresh call shaped like a saved answer skips the groups");
  assert.match(fresh, /knockoutframe_use_kind: batch\.useKind is required/, "a fresh call shaped like a saved answer skips the order's use phrase");
  const twice = acceptKnockoutFrame(CALL([SIX, ["Brindlecove", "Tallowmere"], ["Ostrevane"]]));
  assert.match(twice.reason ?? "", /places a name in more than one family: "Tallowmere"/);
  assert.ok(twice.reason.endsWith(FAMILIES_RULE), "the defect closes on the one definition");
});

test("every grouping rates each of the eight names exactly once", () => {
  const marks = NAMES.map(ROW);
  for (const [label, families] of Object.entries({ ...GROUPINGS, "none, as a held plan reads": null })) {
    const chunks = koChunks(marks, families);
    assert.deepEqual(chunks.flat().map((m) => m.name).sort(), [...NAMES].sort(), `${label}: a name was lost or rated twice`);
  }
  assert.deepEqual(koChunks(marks, GROUPINGS["six, one and one"]).map((c) => c.length), [6, 1, 1]);
  assert.deepEqual(koChunks(marks, GROUPINGS["eight groups of one"]).map((c) => c.length), [1, 1, 1, 1, 1, 1, 1, 1]);
});

test("a refused first save is repaired by the whole plan, and after a save one changed row is enough", () => {
  const dir = mkdtempSync(join(tmpdir(), "ko-families-"));
  writeFileSync(join(dir, "instructed-scope.json"), JSON.stringify({ marks: NAMES }));
  writeFileSync(join(dir, "inbound-request.txt"), "Eight names for our new sweet range, please.");
  const families = GROUPINGS["six, one and one"];
  const broken = CALL(families, NAMES.map((n) => (n === "Ostrevane" ? { ...ROW(n), contextFraming: "" } : ROW(n))));
  assert.ok(recordKnockoutFrame(dir, broken).refused, "premise: the first call is refused");
  // The fragment a "send only what you are correcting" rule invites: nothing was saved, so it stands alone and is refused.
  const fragment = recordKnockoutFrame(dir, { marks: [ROW("Ostrevane")] });
  assert.ok(fragment.refused, "a fragment after a refused first call was accepted as the whole plan");
  const whole = recordKnockoutFrame(dir, CALL(families));
  assert.ok(whole.written, whole.refused ?? whole.write_failed);
  const edit = recordKnockoutFrame(dir, { marks: [{ ...ROW("Ostrevane"), contextFraming: "a seasonal sweet" }] });
  assert.ok(edit.written, edit.refused ?? edit.write_failed);
  const plan = JSON.parse(readFileSync(edit.written, "utf8"));
  assert.deepEqual(plan.marks.map((m) => m.name).sort(), [...NAMES].sort(), "a one-row edit after a save lost a name");
  assert.equal(plan.marks.find((m) => m.name === "Ostrevane").contextFraming, "a seasonal sweet");
  assert.deepEqual(plan.batch.families, families, "a one-row edit after a save lost the groups");
  assert.equal(validators.knockoutPlan(edit.written, readFileSync(edit.written, "utf8")).ok, true);
});

test("the groups and the repair rule each have one definition, said the same way wherever the intake reads them", async () => {
  const manual = readFileSync(join(DRIVER, "skills", "knockout-frame", "SKILL.md"), "utf8");
  assert.ok(manual.includes(FAMILIES_RULE), "the manual does not state the groups in the one definition");
  assert.match(manual, /"families": \[\[/, "the manual's example plan shows no groups");
  const K = { instructedScope: "/r/_driver/instructed-scope.json", runDir: "/r", plan: "/r/knockout-plan.json" };
  const message = KO_STAGES["knockout-frame"].message({ K, job: { marks: NAMES } });
  assert.ok(message.includes(FAMILIES_RULE), "the dispatch does not state the groups in the one definition");
  assert.ok(message.includes(FRAME_REPAIR_RULE), "the dispatch does not state the repair rule in the one definition");
  assert.doesNotMatch(message, /SEND ONLY WHAT YOU ARE CORRECTING/, "the old repair rule, which lost names after a refused first call, is still sent");
  const tool = await toolOf("record_knockout_frame");
  assert.ok(tool.description.includes(FRAME_REPAIR_RULE), "the tool's description does not state the repair rule in the one definition");
  assert.doesNotMatch(tool.description, /key by key/, "the tool still says a sent row is merged key by key; it replaces the row whole");
  assert.equal(tool.inputSchema.properties.batch.properties.families.description, FAMILIES_RULE);
  assert.equal(tool.inputSchema.properties.batch.required, undefined, "the gate refuses a repair that sends one batch field alone");
  const refusal = acceptKnockoutFrame({ ...CALL(undefined), scope_note: "" }).reason;
  assert.ok(refusal.includes(FRAME_REPAIR_RULE), "a refusal of several defects does not state the repair rule");
  assert.doesNotMatch(refusal, /key by key/, "the refusal still says a sent row is merged key by key; it replaces the row whole");
});
