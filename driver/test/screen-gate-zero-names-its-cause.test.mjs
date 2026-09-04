// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — main went red for one commit on an assertion whose own text says the observed state is a
// pipeline defect. The discrimination, from the CI output alone:
//
//   queued : ["escalation=…","envelope=…"]      noops: []      flushes: [["escalation","envelope"]]
//
// The FLUSH carried two triggers. The flush event is written by the pipeline from its own in-memory
// queue, not from the test's read of run.jsonl — so a test-side read race would still have shown a
// three-trigger flush. It showed two. The queue genuinely lacked screen-gate, `noops: []` rules out
// mint-then-deduplicate, and the mint (9662) precedes the settlement flush (9726), which rules out a
// late mint. The mechanism did not fire. The assertion was RIGHT.
//
// It did not fire because `if (violations.length)` had no else that could speak: `checkScreenGate` reads
// `existsSync(findings) ? readFileSync(...) : ""`, and an empty string yields no violations. A missing
// findings file and a genuinely clean run left byte-identical records — which is why three failure
// reports over a month produced no diagnosis.
//
// These tests pin the zero naming its own cause. THEY DO NOT LOOSEN ANYTHING: the funnel test still
// demands all three mints, and the gate still behaves exactly as it did.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { screenGateZeroCause, findScreenGateViolations } from "../screen-gate.mjs";

// A real drop row, shaped to the parser: under a "negative results" heading, 4 columns, a goods/field
// result, and a record URI in Notes. Verified against findScreenGateViolations itself below, so the
// fixture cannot quietly stop being a drop row and take these assertions with it.
const DROP_ROW = `## Negative results

| Mark | Owner | Result | Notes |
| --- | --- | --- | --- |
| ACME | Acme Co | goods drop | out of field, see /mark/ch/57860 |
`;

// An in-scope goods drop that names NO record — a violation only when the unnamed arm is enforcing.
const UNNAMED_ROW = DROP_ROW.replace("out of field, see /mark/ch/57860", "out of field, no record named");

test("#1215 the fixture really is a drop row — otherwise every test below proves nothing", () => {
  assert.equal(findScreenGateViolations(DROP_ROW, new Set()).length, 1, "fixture stopped parsing as a drop row");
  assert.equal(findScreenGateViolations(DROP_ROW, new Set(["/mark/ch/57860"])).length, 0, "fixture's URI stopped matching the fetched set");
});

test("#1215 FINDINGS-ABSENT is not a clean run — the suspected cause, and it had no voice", () => {
  const c = screenGateZeroCause({ findingsPresent: false });
  assert.equal(c.cause, "findings-absent");
  assert.equal(c.dropRows, null, "claimed a drop-row count for a file it never read");
});

test("#1215 FINDINGS-EMPTY is its own cause, not folded into absent or clean", () => {
  for (const body of ["", "   ", "\n\n", "  \n \t "]) {
    const c = screenGateZeroCause({ findingsPresent: true, findingsContent: body });
    assert.equal(c.cause, "findings-empty", `whitespace body ${JSON.stringify(body)} misfiled`);
    assert.equal(c.dropRows, null);
  }
});

test("#1215 NO-DROP-ROWS is genuinely clean and says so", () => {
  const c = screenGateZeroCause({ findingsPresent: true, findingsContent: "## Findings\n\nnothing dropped on goods.\n" });
  assert.equal(c.cause, "no-drop-rows");
  assert.equal(c.dropRows, 0);
});

test("#1215 ALL-FETCHED is the other clean one — rows existed and every record was fetched", () => {
  const c = screenGateZeroCause({ findingsPresent: true, findingsContent: DROP_ROW });
  assert.equal(c.cause, "all-fetched");
  assert.equal(c.dropRows, 1, "the row count that distinguishes this from no-drop-rows");
});

test("#1215 THE DISCRIMINATION ITSELF: the two defects and the three clean states are five distinct records", () => {
  // The entire point. Before this, all five wrote `{event:"screen-gate-clean"}` and nothing else.
  const causes = [
    screenGateZeroCause({ findingsPresent: false }),
    screenGateZeroCause({ findingsPresent: true, findingsContent: "" }),
    screenGateZeroCause({ findingsPresent: true, findingsContent: "## Findings\n\nclean\n" }),
    screenGateZeroCause({ findingsPresent: true, findingsContent: DROP_ROW }),
    screenGateZeroCause({ findingsPresent: true, findingsContent: UNNAMED_ROW }),
  ].map((c) => c.cause);
  assert.deepEqual(causes,
    ["findings-absent", "findings-empty", "no-drop-rows", "all-fetched", "unnamed-drops-unarmed"]);
  assert.equal(new Set(causes).size, 5, "two states that need opposite responses share a record");
});

test("#1215 UNNAMED-DROPS-UNARMED is not 'nothing was dropped' — and it is the DEFAULT mode", () => {
  // The caller arms the unnamed class only when CLEAROTRON_SCREEN_GATE_UNNAMED === "enforce", so OFF is the
  // ordinary path. Folding this into no-drop-rows would print "the digest dropped nothing on goods" on
  // the commonest configuration while it had in fact dropped a row nobody counted — the same disease this
  // whole function exists to cure, one taxonomy level in.
  const c = screenGateZeroCause({ findingsPresent: true, findingsContent: UNNAMED_ROW, unnamedArmed: false });
  assert.equal(c.cause, "unnamed-drops-unarmed");
  assert.notEqual(c.cause, "no-drop-rows", "a dropped row was labelled as nothing dropped");
  assert.equal(c.dropRows, 0, "0 under the caller's filter — that part is honest");
  assert.equal(c.dropRowsUnfiltered, 1, "and the unfiltered count is what makes the label truthful");
  // Arming it moves the row into the counted population and the cause changes with it.
  const armed = screenGateZeroCause({ findingsPresent: true, findingsContent: UNNAMED_ROW, unnamedArmed: true });
  assert.equal(armed.cause, "all-fetched");
  assert.equal(armed.dropRows, 1);
});

test("#1215 findingsBytes is BYTES — the field name has to survive a non-ASCII mark", () => {
  // Marks carry non-ASCII and String.length counts UTF-16 units. A reader comparing this field to `wc -c`
  // on the same file must get the same number, on exactly the corpus this engine exists for.
  const utf8 = DROP_ROW.replace("ACME", "CAFÉ ÜNÏCØDE 商標");
  const c = screenGateZeroCause({ findingsPresent: true, findingsContent: utf8 });
  assert.equal(c.findingsBytes, Buffer.byteLength(utf8, "utf8"));
  assert.notEqual(c.findingsBytes, utf8.length, "the fixture must actually diverge, or this proves nothing");
});

test("#1215 unnamedArmed mirrors the caller's own filter, so the count means one thing", () => {
  // An unnamed drop row (no record URI) is a violation only when the unnamed arm is enforcing —
  // `enforcedViolations` filters exactly this way, and a count computed the other way would describe a
  // different population than the gate acted on.
  const unnamed = `## Negative results

| Mark | Owner | Result | Notes |
| --- | --- | --- | --- |
| ACME | Acme Co | goods drop | dismissed on field, no record named |
`;
  assert.equal(screenGateZeroCause({ findingsPresent: true, findingsContent: unnamed, unnamedArmed: true }).dropRows, 1);
  assert.equal(screenGateZeroCause({ findingsPresent: true, findingsContent: unnamed, unnamedArmed: false }).dropRows, 0);
  // ...and the filter must never make the LABEL untrue: the unfiltered count is carried on both paths.
  for (const armed of [true, false]) {
    const c = screenGateZeroCause({ findingsPresent: true, findingsContent: unnamed, unnamedArmed: armed });
    assert.equal(c.dropRowsUnfiltered, 1, "the filter hid a row from the count AND from the record");
    assert.notEqual(c.cause, "no-drop-rows", "a filtered-out row must never read as nothing dropped");
  }
});

test("#1215 SHAPE FUZZ: no argument, null, and a null body all degrade rather than throw", () => {
  // This runs on the CLEAN path of a live run. A throw here would convert a healthy run into a crash —
  // strictly worse than the silence it replaces.
  assert.equal(screenGateZeroCause().cause, "findings-absent");
  assert.equal(screenGateZeroCause({}).cause, "findings-absent");
  assert.equal(screenGateZeroCause({ findingsPresent: true, findingsContent: null }).cause, "findings-empty");
  assert.equal(screenGateZeroCause({ findingsPresent: true, findingsContent: undefined }).cause, "findings-empty");
});

test("#1215 NO SECOND PARSER: the row count comes from findScreenGateViolations itself", () => {
  // A hand-rolled counter beside the real parser is how the two drift and the diagnostic starts lying
  // about the thing it exists to explain. Same population, both paths, proven on the same input.
  const viaParser = findScreenGateViolations(DROP_ROW, new Set()).filter((v) => v.uri).length;
  assert.equal(screenGateZeroCause({ findingsPresent: true, findingsContent: DROP_ROW }).dropRows, viaParser);
});

test("#1215 the pipeline's clean branch actually carries the cause", () => {
  // The helper being right is worth nothing if the gate still logs a bare event. This pins the wiring.
  const src = readFileSync(new URL("../pipeline.mjs", import.meta.url), "utf8");
  const at = src.indexOf('event: "screen-gate-clean",\n');
  assert.ok(at > 0, 'the gate\'s clean log moved — this assertion is measuring nothing');
  assert.match(src.slice(at, at + 400), /screenGateZeroCause\(\{/,
    "the gate logs a clean gate without saying why it was clean — that is #1215");
});

test("#1215 the cause REACHES THE CI LOG — a discriminator that stops at run.jsonl has not been produced", () => {
  // The funnel file's own header states the constraint this test exists for: the discriminator for this
  // failure "exists on disk in the mock run's run.jsonl at the moment of failure, and CI keeps no
  // artifact of it." So the cause landing in run.jsonl is NOT enough — on the three red CI runs that
  // motivated it would have been invisible. It has to travel in the assertion message.
  const src = readFileSync(new URL("./digest-funnel.pipeline.test.mjs", import.meta.url), "utf8");
  const at = src.indexOf("const digestPicture =");
  assert.ok(at > 0, "digestPicture was renamed or removed — this assertion is measuring nothing");
  const body = src.slice(at, src.indexOf("\n};", at));
  assert.match(body, /screen-gate-clean/,
    "the assertion message no longer reads the clean-gate event, so a CI red says nothing about the cause");
  assert.match(body, /gate0/, "the rendered failure message lost its cause line");
  for (const field of ["cause", "findingsBytes", "dropRows", "dropRowsUnfiltered"]) {
    assert.ok(body.includes(field), `the failure message dropped ${field} — the reader loses that column`);
  }
  // THREE sites write `screen-gate-clean` and only mine is a zero; the other two are `recovered` arms
  // carrying no cause. Rendering those as `undefined(...)` would put noise in the one line that exists to
  // end this confusion, so the message must branch on `recovered`.
  assert.match(body, /recovered/,
    "the cause line does not branch on the recovered arms — a healed gate renders as undefined(...)");
});

test("#1215 there are exactly THREE screen-gate-clean writers and only ONE of them is a zero", () => {
  // If a fourth appears without a cause, the gate0 line silently starts reporting `undefined` again and
  // the recovered branch above stops covering the population. This is the tripwire for that.
  const src = readFileSync(new URL("../pipeline.mjs", import.meta.url), "utf8");
  const sites = [...src.matchAll(/event: "screen-gate-clean"/g)];
  assert.equal(sites.length, 3, "a screen-gate-clean writer was added or removed — re-check the gate0 rendering");
  const zero = sites.filter((m) => !/^,\s*recovered/.test(src.slice(m.index + 'event: "screen-gate-clean"'.length, m.index + 60)));
  assert.equal(zero.length, 1, "exactly one writer is the zero branch that carries a cause");
});

test("#1215 the gate's BEHAVIOUR is unchanged — this is instrumentation, not a loosened guard", () => {
  // The forbidden outcome on this issue is making the funnel assertion pass by weakening it. Nothing
  // here touches when the gate mints, discloses or clamps: the helper is only ever called on the branch
  // that already decided there were no violations.
  const src = readFileSync(new URL("../pipeline.mjs", import.meta.url), "utf8");
  const calls = [...src.matchAll(/screenGateZeroCause\(/g)];
  assert.equal(calls.length, 1, "the cause helper reached a second site — it belongs only on the clean branch");
  const before = src.slice(0, calls[0].index);
  assert.match(before.slice(-600), /event: "screen-gate-clean"/,
    "the helper is no longer inside the clean-gate log — it must never gate behaviour");
});
