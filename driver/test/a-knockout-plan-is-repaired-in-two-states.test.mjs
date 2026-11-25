// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A KNOCKOUT PLAN IS REPAIRED IN TWO STATES, THROUGH THE TOOL THE MODEL CALLS (design, 2026-11-24).
//
// The repair rule says: until the tool confirms it saved the plan, send the complete corrected plan; after that, send only
// the changed batch fields and complete changed name rows. The tool's schema required the note, the batch and the names,
// and four of the batch's fields, and the gate in front of the recorder checked every call against it, so the second
// half of the rule was refused before the recorder saw it. The model is handed the schema once, at the start of its
// session, so the gate cannot tell a first call from a repair: the recorder holds both states. A model's calls below go
// through one served session, as they would in a run, and every save is read back off disk.
//
// A replay hands back an answer the recorder accepted before, and says so itself; nothing a model sends can. Every name
// here is invented.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { acceptKnockoutFrame, recordKnockoutFrame, knockoutFrameFiles, knockoutFrameCallPaths } from "../knockout-frame-record.mjs";
import { koChunks } from "../stages-knockout.mjs";

const SERVER = join(dirname(fileURLToPath(import.meta.url)), "..", "engine", "mcp", "recording-server.mjs");
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function run() {
  const dir = mkdtempSync(join(tmpdir(), "ko-two-states-"));
  dirs.push(dir);
  mkdirSync(join(dir, "_driver"), { recursive: true });
  writeFileSync(join(dir, "inbound-request.txt"), "Three names for our new sweet range, please.");
  return dir;
}

/** One served session: every call goes through the gate and the handler in the same process, in order. */
function session(runDir) {
  const p = spawn("node", [SERVER], { stdio: ["pipe", "pipe", "ignore"], env: { ...process.env, CLEAROTRON_BAND_RUN_DIR: runDir } });
  const waiting = new Map();
  let buf = "", id = 1;
  p.stdout.setEncoding("utf8");
  p.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      let m; try { m = JSON.parse(line); } catch { continue; }
      waiting.get(m?.id)?.(m); waiting.delete(m?.id);
    }
  });
  const ask = (method, params) => new Promise((resolve, reject) => {
    const n = ++id;
    const timer = setTimeout(() => reject(new Error(`${method} did not answer — could not look`)), 20000);
    waiting.set(n, (m) => { clearTimeout(timer); resolve(m); });
    p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: n, method, params }) + "\n");
  });
  const ready = ask("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "arm", version: "0" } });
  return {
    call: async (args) => {
      await ready;
      const m = await ask("tools/call", { name: "record_knockout_frame", arguments: args });
      const text = m.result?.content?.[0]?.text ?? "";
      let body = null; try { body = JSON.parse(text); } catch { /* the gate answers in a sentence, not JSON */ }
      return { written: Boolean(body?.written), text: body?.refused ?? text };
    },
    close: () => p.kill(),
  };
}

const ROW = (name, over = {}) => ({ name, classes: [30], classesPlain: "sweets and confectionery (30)",
  contextFraming: `The name of one sweet in the range: ${name}.`, places: ["web", "shop.example.com"], ...over });
const NAMES = ["Tallowmere", "Tallowmere Gold", "Brindlecove"];
const PLAN = {
  scope_note: "Three invented names, screened for a sweet range in class 30.",
  batch: { productContext: "A new range of sweets.", inUseAs: "a sweet or a sweet shop", useKind: "sweet",
    families: [["Tallowmere", "Tallowmere Gold"], ["Brindlecove"]] },
  marks: NAMES.map((n) => ROW(n)),
};
const saved = (dir) => {
  const f = knockoutFrameFiles(dir), c = knockoutFrameCallPaths(dir);
  return { plan: existsSync(f.plan) ? readFileSync(f.plan, "utf8") : null, note: existsSync(f.frame) ? readFileSync(f.frame, "utf8") : null,
    accepted: existsSync(c.accepted) ? readFileSync(c.accepted, "utf8") : null };
};

test("one session: a partial first call is refused by the recorder, then the whole plan, one batch field and one row each save", async (t) => {
  const dir = run();
  const s = session(dir);
  t.after(() => s.close());

  // BEFORE THE FIRST SAVE: a batch field alone reaches the recorder, which asks for the rest of the plan by name.
  const partial = await s.call({ batch: { useKind: "sweet" } });
  assert.doesNotMatch(partial.text, /missing_required/, "the gate refused the call, so the recorder never saw it");
  for (const token of ["knockoutframe_note_missing", "knockoutframe_context_missing", "knockoutframe_in_use_as_missing", "knockoutframe_marks_missing"])
    assert.ok(partial.text.includes(token), `a first call without the whole plan is not asked for it: ${token} is missing`);
  assert.deepEqual(saved(dir), { plan: null, note: null, accepted: null }, "a refused first call saved something");

  const whole = await s.call(PLAN);
  assert.ok(whole.written, whole.text);
  const first = saved(dir);
  assert.ok(first.plan && first.accepted, "the whole plan was not saved");
  const plan1 = JSON.parse(first.plan);
  assert.deepEqual(plan1.batch.families, PLAN.batch.families);

  // AFTER IT: one batch field alone. Everything it does not name stands.
  const field = await s.call({ batch: { productContext: "A new range of boiled sweets." } });
  assert.ok(field.written, field.text);
  const plan2 = JSON.parse(saved(dir).plan);
  assert.equal(plan2.batch.productContext, "A new range of boiled sweets.");
  assert.deepEqual({ ...plan2.batch, productContext: null }, { ...plan1.batch, productContext: null }, "a batch field the call did not send moved");
  assert.deepEqual(plan2.marks, plan1.marks, "a batch-only call changed the names");
  assert.equal(saved(dir).note, PLAN.scope_note, "a batch-only call changed the scope note");

  // One complete row. The rows it omits are kept as they were.
  const row = await s.call({ marks: [ROW("Tallowmere Gold", { contextFraming: "The gold-wrapped sweet in the range." })] });
  assert.ok(row.written, row.text);
  const plan3 = JSON.parse(saved(dir).plan);
  assert.deepEqual(plan3.marks.map((m) => m.name), NAMES, "a name the row call omitted was dropped or reordered");
  assert.equal(plan3.marks[1].contextFraming, "The gold-wrapped sweet in the range.");
  assert.deepEqual([plan3.marks[0], plan3.marks[2]], [plan2.marks[0], plan2.marks[2]], "a row the call omitted moved");
  assert.deepEqual(plan3.batch, plan2.batch, "a row call moved the batch");
});

test("an invalid edit after a save is refused, and the accepted plan, its note and its record stay byte for byte", async (t) => {
  const dir = run();
  const s = session(dir);
  t.after(() => s.close());
  assert.ok((await s.call(PLAN)).written, "the whole plan was refused, so no edit below is measured");
  const before = saved(dir);
  for (const [label, edit, token] of [
    ["a row with one place", { marks: [ROW("Brindlecove", { places: ["web"] })] }, "knockoutframe_places:Brindlecove"],
    ["groups that leave a name out", { batch: { families: [["Tallowmere", "Tallowmere Gold"]] } }, "leaves out: \"Brindlecove\""],
    ["a row with no context", { marks: [ROW("Tallowmere", { contextFraming: "" })] }, "knockoutframe_context_framing:Tallowmere"],
  ]) {
    const r = await s.call(edit);
    assert.ok(r.text.includes(token), `${label}: not refused by name — ${r.text.slice(0, 300)}`);
    assert.deepEqual(saved(dir), before, `${label}: a refused edit changed what was accepted`);
  }
});

test("every field the old schema required is still refused by the recorder when a first call leaves it out", () => {
  const without = (path) => {
    const call = structuredClone(PLAN);
    const [a, b] = path.split(".");
    if (b) delete call[a][b]; else delete call[a];
    return acceptKnockoutFrame(call);
  };
  for (const [path, token] of [["scope_note", "knockoutframe_note_missing"], ["batch", "knockoutframe_context_missing"], ["marks", "knockoutframe_marks_missing"],
    ["batch.productContext", "knockoutframe_context_missing"], ["batch.inUseAs", "knockoutframe_in_use_as_missing"],
    ["batch.useKind", "knockoutframe_use_kind: batch.useKind"], ["batch.families", "knockoutframe_families: batch.families is required"]]) {
    const v = without(path);
    assert.equal(v.ok, false, `a first call without ${path} is saved`);
    assert.ok(v.reason.includes(token), `a first call without ${path} is not refused for it: ${v.reason.slice(0, 300)}`);
  }
  assert.equal(acceptKnockoutFrame(PLAN).ok, true, "the control: the whole plan is refused, so the arms above measure the fixture");
});

test("a saved answer without groups replays one name at a time; the same answer sent by a model is refused", async (t) => {
  // An answer accepted before groups were asked for, in the search-term format the driver builds: a use phrase on the
  // batch and no spellings.
  const { families: _none, ...batch } = PLAN.batch;
  const answer = { ...PLAN, batch };
  const replay = run();
  const out = recordKnockoutFrame(replay, answer, { saved: true });
  assert.ok(out.written, out.refused ?? out.write_failed);
  const plan = JSON.parse(readFileSync(out.written, "utf8"));
  assert.equal(plan.batch.families, undefined, "the replay wrote groups the saved answer never had");
  assert.deepEqual(koChunks(plan.marks, plan.batch.families).map((c) => c.map((m) => m.name)), NAMES.map((n) => [n]),
    "a saved answer without groups is not rated one name at a time, as it ran");

  // An answer from before the search terms were built: a use and spellings on every name.
  const older = { scope_note: PLAN.scope_note, batch: { productContext: batch.productContext, inUseAs: batch.inUseAs },
    marks: NAMES.map((n) => ROW(n, { useKind: "sweet", spellings: [n, `${n}s`] })) };
  const held = recordKnockoutFrame(run(), older, { saved: true });
  assert.ok(held.written, held.refused ?? held.write_failed);
  assert.deepEqual(JSON.parse(readFileSync(held.written, "utf8")).marks.map((m) => m.spellings), older.marks.map((m) => m.spellings),
    "a saved answer's own spellings were rebuilt");

  // The tool a model calls never says saved, so either shape is a fresh call there.
  const fresh = run();
  const s = session(fresh);
  t.after(() => s.close());
  const sent = await s.call(answer);
  assert.match(sent.text, /knockoutframe_families: batch\.families is required/, "a model's call without groups was saved");
  const shaped = await s.call(older);
  assert.match(shaped.text, /knockoutframe_use_kind: batch\.useKind is required/, "a model's call shaped like an old answer skipped the order's use phrase");
  assert.match(shaped.text, /knockoutframe_families: batch\.families is required/, "a model's call shaped like an old answer skipped the groups");
  assert.equal(saved(fresh).plan, null, "a model's call was saved as if it were a replay");
});
