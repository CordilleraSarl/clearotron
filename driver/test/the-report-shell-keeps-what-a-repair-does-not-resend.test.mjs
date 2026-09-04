// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — THE CLIENT'S SHELL KEEPS WHAT A REPAIR DID NOT RE-SEND.
//
// ── THE DEFECT, MEASURED BEFORE IT WAS FIXED ────────────────────────────────────────────────────────
//
// `recordReportOverview` wrote the shell from the RECEIVED call alone. Only `overall_caption` is
// required, so a repair rung asking the seat to correct the shell — and a seat sending only what it
// corrected — produced a client-facing overview with the Actions list and the methodology GONE:
//
//     FULL                     ACCEPTED  rendered=683B  actions=3  methodology=true
//     PARTIAL (caption only)   ACCEPTED  rendered=149B  actions=0  methodology=false
//
// There IS an anti-vacuity floor, `BODY_FLOOR_CHARS = 120`, and it does not catch this: a caption alone
// renders 149 and clears it. Nothing fired. `report-overview.md` is the head of `report.md`
// (`pipeline.mjs` `assembleReportMd`), which renders to the HTML the client reads — so this shrank a
// section of the single deliverable.
//
// ── PRESERVE, NOT REFUSE, AND THAT IS A PRODUCT DECISION ────────────────────────────────────────────
//
// Requiring the fields instead would turn a legitimate omission into a REFUSAL on the stage producing
// the client's own document. Nothing here can tell a first call from a repair, so a partial is
// indistinguishable from a first call — and a product refusal is never a pass, however correct the
// reason. Preserving is the answer that cannot fail closed.
//
// ── THE TWO BEHAVIOURS DO NOT CONFLICT, and the split is the design ─────────────────────────────────
//
//   OMITTED key   → PRESERVE. The seat said nothing about it; the stored value stands.
//   MISPLACED key → REFUSE, BY PATH, before the merge. The seat said something and put it somewhere the
//                   tool does not declare, so it is told where — in the turn where restating is free.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  recordReportOverview, lastAcceptedOverview, mergeOverviewCall, refuseUndeclared,
  reportOverviewCallPaths, PROSE_FILE,
} from "../report-overview-record.mjs";

const DRIVER = join(dirname(fileURLToPath(import.meta.url)), "..");
const runDir = () => mkdtempSync(join(tmpdir(), "overview-preserve-"));

/** A complete shell, as a first call sends one. */
const FULL = Object.freeze({
  overall_caption: "The mark is clear to proceed in the classes searched, subject to the conditions below.",
  actions: [
    { text: "Searched the EU register for identical and near-identical marks in classes 9 and 42." },
    { text: "Swept marketplace listings for unregistered use across four platforms." },
    { text: "Checked the applicant's own prior rights and confirmed no conflicting earlier filing." },
  ],
  methodology: "Register search across EUIPO and national registers, plus a common-law sweep.",
  handling_note: "This is a preliminary clearance and not a legal opinion.",
});

test("a repair that re-sends only the caption keeps the Actions list and the methodology", () => {
  const d = runDir();

  const first = recordReportOverview(d, FULL);
  assert.equal(first.refused, null, `the full fixture no longer validates (${first.refused}) — this arm is planting nothing`);
  assert.equal(first.actions, 3);
  assert.equal(first.methodology, true);

  // THE DEFECT'S OWN SHAPE: the rung asks for a correction, the seat sends the corrected half.
  //
  // THE CAPTION IS DELIBERATELY LONG ENOUGH TO CLEAR THE 120-CHARACTER FLOOR ON ITS OWN. A shorter one
  // makes this arm fail against the unfixed code for the WRONG REASON — refused by the floor rather
  // than accepted and truncated — and an arm that fails for the wrong reason is not evidence about the
  // defect. 149 characters is what the original measurement used, and clearing the floor is precisely
  // why the floor did not catch the real thing.
  const CORRECTED_CAPTION =
    "The mark is clear to proceed in the classes searched, subject to the conditions below, "
    + "as corrected on review of the reviewer's flags.";
  assert.ok(CORRECTED_CAPTION.length > 120,
    `this arm needs a caption that clears the floor unaided (got ${CORRECTED_CAPTION.length}) or it proves the floor, not the merge`);
  const repaired = recordReportOverview(d, { overall_caption: CORRECTED_CAPTION });
  assert.equal(repaired.refused, null, `the repair call was refused (${repaired.refused}) — preserving must not fail closed`);
  assert.equal(repaired.actions, 3,
    "the Actions list did not survive a caption-only repair — this is the defect, and the client loses the account of what was checked");
  assert.equal(repaired.methodology, true, "the methodology did not survive a caption-only repair");

  // Not "it did not crash" — the rendered file carries the CORRECTION and the PRESERVED content both.
  const body = readFileSync(join(d, PROSE_FILE), "utf8");
  assert.match(body, /as corrected on review of the reviewer/, "the correction did not reach the rendered shell");
  assert.match(body, /Swept marketplace listings/, "a preserved Actions bullet did not reach the rendered shell");
});

test("a LEGITIMATE field in the WRONG object is refused BY PATH, not accepted and dropped", () => {
  const d = runDir();
  assert.equal(recordReportOverview(d, FULL).refused, null);

  // `handling_note` is a real field of this tool — at the TOP level. Inside an action it is nothing.
  // This is 's measured shape: the synthesis seat sent a real `corrections` marker
  // into `narrative`, a typed object that does not declare it, and the call was accepted while the
  // value reached no delivered artifact. A top-level-only unknown-key check passes on exactly that.
  const misplaced = { ...FULL, actions: [{ text: "A real bullet.", handling_note: "legitimate field, wrong object" }] };
  const v = recordReportOverview(d, misplaced);
  assert.ok(v.refused, "a legitimate field in the wrong typed object was ACCEPTED — the value is dropped and nothing fires");
  assert.match(v.refused, /reportoverview_undeclared_field:actions\.handling_note/,
    `the refusal must name the PATH so the seat learns where the value belongs; got: ${v.refused}`);
});

test("a refused call does not become the base a later repair builds on", () => {
  const d = runDir();
  recordReportOverview(d, FULL);
  const before = lastAcceptedOverview(d);
  assert.equal(before.actions.length, 3, "the base was not stored after a passing call — every arm below is vacuous");

  // Two refusals of different kinds; neither may touch the stored base.
  // The plant is a key in a DECLARED SUB-OBJECT, which is the shape the refusal is for. A top-level
  // extra is deliberately NOT refused — see the envelope arm below.
  const undeclared = recordReportOverview(d, { ...FULL, actions: [{ text: "A bullet.", handling_note: "wrong object" }] });
  assert.ok(undeclared.refused, "the undeclared-key plant was accepted");
  const invalid = recordReportOverview(d, { overall_caption: "" });
  assert.ok(invalid.refused, "the empty-caption plant was accepted");

  const after = lastAcceptedOverview(d);
  assert.deepEqual(after, before,
    "a REFUSED call changed the stored base. One bad turn would then poison every turn after it, because "
    + "the next repair merges onto whatever is stored — the base must be written only after the values pass.");
});

test("an omitted key is 'unchanged'; a deliberately EMPTY one is 'there is none'", () => {
  // The distinction the merge turns on. Collapsing them makes a preserve-merge silently become a
  // replace-merge for any seat that sends an empty value, and vice versa.
  const stored = { overall_caption: "old", actions: [{ text: "kept" }], methodology: "m", handling_note: "h" };

  const omitted = mergeOverviewCall(stored, { overall_caption: "new" });
  assert.deepEqual(omitted.actions, stored.actions, "an OMITTED list must be kept");
  assert.equal(omitted.methodology, "m", "an OMITTED string must be kept");

  const emptied = mergeOverviewCall(stored, { overall_caption: "new", actions: [], methodology: "" });
  assert.deepEqual(emptied.actions, [], "a deliberately EMPTY list must be honoured, not overwritten by the stored one");
  assert.equal(emptied.methodology, "", "a deliberately EMPTY string must be honoured");

  // And with no base at all, a first call is itself.
  assert.deepEqual(mergeOverviewCall(null, { overall_caption: "first" }).overall_caption, "first");
});

test("the shape the acceptor polices is the shape the server actually serves", async () => {
  // ANTI-VACUITY, and the reason this arm exists: `DECLARED` is stated in the module because the server
  // cannot be imported without starting it. A hand-stated shape drifts, and a drifted one refuses a
  // field the seat is entitled to send — which is worse than the hole it replaced.
  const script = join(DRIVER, "engine", "mcp", "recording-server.mjs");
  const tools = await new Promise((resolve, reject) => {
    const p = spawn("node", [script], { stdio: ["pipe", "pipe", "ignore"], env: { ...process.env, CLEAROTRON_BAND_RUN_DIR: join(DRIVER, "..", ".no-such-run") } });
    let buf = "";
    const timer = setTimeout(() => { p.kill(); reject(new Error("recording-server did not answer tools/list — could not look")); }, 20000);
    p.on("error", (e) => { clearTimeout(timer); reject(e); });
    p.stdout.on("data", (d) => {
      buf += d;
      for (const line of buf.split("\n")) {
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m?.id !== 2) continue;
        clearTimeout(timer); p.kill();
        return Array.isArray(m.result?.tools) && m.result.tools.length
          ? resolve(m.result.tools)
          : reject(new Error("recording-server served no tools — a scan that finds nothing is not a pass"));
      }
    });
    const send = (o) => p.stdin.write(JSON.stringify(o) + "\n");
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "overview-shape", version: "0" } } });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  });

  const tool = tools.find((t) => t.name === "record_report_overview");
  assert.ok(tool, "record_report_overview is not served — the acceptor is policing a shape nobody offers");
  const top = Object.keys(tool.inputSchema?.properties ?? {});
  assert.ok(top.length > 0, "the served schema declares no property — this comparison would be vacuous");

  for (const field of top)
    assert.equal(refuseUndeclared({ [field]: field === "actions" ? [] : "x" }), null,
      `the server declares '${field}' and the acceptor refuses it — a drifted shape refuses a field the seat is entitled to send`);

  const actionProps = Object.keys(tool.inputSchema?.properties?.actions?.items?.properties ?? {});
  assert.ok(actionProps.length > 0, "the served action row declares no property — this comparison would be vacuous");
  for (const field of actionProps)
    assert.equal(refuseUndeclared({ actions: [{ [field]: "x" }] }), null,
      `the server declares 'actions[].${field}' and the acceptor refuses it`);
});

test("an unknown TOP-LEVEL key is TOLERATED — refusing one killed a stage for a field nobody reads", () => {
  // THE REGRESSION THIS ARM EXISTS FOR. The first cut refused any undeclared key at any depth. Real
  // traffic carries envelope fields the tool schema does not declare — `schema_version` among them —
  // and the acceptors ignore them because they write their own. Strict, that inert extra became FATAL:
  // the whole stage refused, the run dead. CI caught it across 63 arms; these arms did not, because
  // they only checked that every DECLARED field is accepted, never that an undeclared one survives.
  //
  // A product refusal is never a pass, however correct the reason.
  const d = runDir();
  const v = recordReportOverview(d, { ...FULL, schema_version: 5 });
  assert.equal(v.refused, null, `an inert top-level envelope key was refused (${v.refused}) — that kills a stage for a field nobody reads`);
  assert.ok(v.written, "…and the artifact was still written");
});
