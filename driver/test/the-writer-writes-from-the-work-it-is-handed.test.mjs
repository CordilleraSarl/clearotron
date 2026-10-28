// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE WRITER WRITES FROM THE WORK IT IS HANDED (ruled 2026-10-27).
//
// On a test run of a crowded matter the writer's second try made 1,095 record reads and 117 web research calls and
// recorded nothing before its time ran out: it read the band's shape first, part by part, then each position's records,
// then the owners. Its message told it to: the band contract it shared with the steps before it begins "call
// `band_shape` FIRST", and each tool reply ended by telling it to call again for the next page. Now the writer starts
// from the retained entries, the recorded decisions and the evidence the run holds; it uses the band tools when an
// assessment needs evidence it was not handed; and an answer the run already holds can be a finding's check. Its duties
// stay: the triggers for the use, enforcement and owner checks are unchanged, and it still reads the band when it needs
// to, on the same band-scaled time limit. Placement and the reading step are told what they were told before.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STAGES, paths, BAND_READING_STAGES, BAND_READING_CONTRACT, BAND_READING_CONTRACT_AFTER_PLACEMENT,
  BAND_READING_CONTRACT_FOR_THE_WRITER, BAND_READING_STANDARDS, WRITER_STARTS_FROM_THE_WORK, WRITER_RECORDS_AS_IT_GOES,
  USE_CHECK_ANSWERS_HELD } from "../stages.mjs";

const RULED = [
  "Start from the retained entries, the recorded decisions, and the evidence this run already holds. Use completed work in your judgment and write what the findings mean together for this client. Complete the legal and practical assessment that remains yours under the framework.",
  "Reopen a settled decision only for identified contrary evidence or an identified error in its reasoning. Complete an outstanding required question from the evidence already held; read or search further only where that evidence does not answer it. Do not repeat the investigation because a new stage or attempt has started.",
  "Assess each retained position on its relevant evidence. A list of its constituent records does not require you to open every record. Open an additional record when a difference in its goods, status, priority, territory, identity, or other material evidence could change the assessment and the supplied evidence does not resolve it. Missing or incomplete evidence does not establish an exclusion or a clean result.",
];
const BAND_USE = "Use the band tools (`band_shape`, `band_lookup`, `band_record`) when a specific assessment needs evidence beyond the material handed to you. The available groups and pages are ways to find that evidence, not a list you must read to completion.";
const ANSWERS_HELD = "Apply the existing triggers for actual-use, enforcement, and owner checks after the relevant legal assessment. First use a suitable answer already held by this run, including an earlier stage or attempt, where it answers the same owner, mark, goods, territory, and material time question. A source requirement is not a requirement for a new call. One answer may support several findings only where it answers each finding's question. Ask only what remains unanswered and record the result against every finding it supports.";
const SET_ASIDE = "- QZORVAK — Beta GmbH (/mark/eu/b1): set aside on its goods: registered for industrial pumps";

function messageOf(t, stage, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), "writer-handed-work-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return String(STAGES[stage].message({ paths: paths(dir), axes: ["primary-sweep"], registerOnly: true, job: {}, ...extra }));
}

test("the writer is told to start from the work it is handed, in the ruled words, after the decisions it inherits", (t) => {
  assert.equal(WRITER_STARTS_FROM_THE_WORK, RULED.join("\n"));
  const text = messageOf(t, "synthesis", { placementSetAsides: [SET_ASIDE] });
  const at = text.indexOf(RULED[0]);
  assert.ok(at > 0, "the writer is not told where it starts");
  assert.ok(text.includes(RULED.join("\n")), "the three ruled paragraphs are not served whole and in order");
  assert.ok(text.indexOf(SET_ASIDE) < at, "the writer is told to start from recorded decisions it has not yet been shown");
  for (const stage of ["placement-inquiry", "register-digest", "narrative-refutation"])
    assert.ok(!messageOf(t, stage).includes(RULED[0]), `${stage} was handed the writer's instruction`);
});

test("the writer uses the band tools when an assessment needs them; it is no longer told to read the band first", (t) => {
  const text = messageOf(t, "synthesis");
  assert.ok(text.includes(`THE REGISTER BAND: ${BAND_USE} ${BAND_READING_STANDARDS}`));
  assert.equal(BAND_READING_CONTRACT_FOR_THE_WRITER, `THE REGISTER BAND: ${BAND_USE} ${BAND_READING_STANDARDS}`);
  for (const order of ["call `band_shape` FIRST", "each naming the next call", "Then pull exactly the records"])
    assert.ok(!text.includes(order), `the writer is still told: ${order}`);
});

test("the reading standards the writer keeps are the contract's own words, and the other steps keep their contracts", (t) => {
  assert.ok(BAND_READING_STANDARDS.startsWith("A crowd descriptor is an open slice for judgment to act on"));
  assert.ok(BAND_READING_STANDARDS.endsWith("Do NOT slice band or shape files with shell tools: the band tools are the reading layer, and they keep the reading on the record."));
  assert.ok(BAND_READING_CONTRACT.endsWith(BAND_READING_STANDARDS) && BAND_READING_CONTRACT_AFTER_PLACEMENT.endsWith(BAND_READING_STANDARDS));
  assert.ok(messageOf(t, "placement-inquiry").includes(BAND_READING_CONTRACT), "placement's contract changed");
  assert.ok(messageOf(t, "register-digest").includes(BAND_READING_CONTRACT_AFTER_PLACEMENT), "the reading step's contract changed");
});

test("the writer still reads the band, so its time limit still scales with the band", () => {
  // band-size.mjs scales a stage's limit by the band only for the stages in this set, and the set is found by the
  // contract's name in a stage's message. A writer dropped from it would lose its band-scaled limit in silence.
  assert.ok(BAND_READING_STAGES.has("synthesis"));
  assert.ok(String(STAGES.synthesis.message).includes("BAND_READING_CONTRACT_FOR_THE_WRITER"));
});

test("an answer the run already holds can be a finding's check, in the message and in Step 3.5 alike", (t) => {
  assert.equal(USE_CHECK_ANSWERS_HELD, ANSWERS_HELD);
  const text = messageOf(t, "synthesis");
  const block = text.split("\n").find((l) => l.startsWith("USE-CHECK (enforced):"));
  assert.ok(block, "the writer has no use-check block");
  assert.ok(block.includes(`over this mark or a similar one). ${ANSWERS_HELD} After a completed search, use is`), "the ruled paragraph does not open the block's rules");
  assert.ok(block.includes("run ONE scoped `perplexity_research` query (owner + mark + the goods/field) unless an answer this run already holds answers that question, and END"));
  // The triggers do not move: a finding banded medium risk or higher is checked, and a claim of absent use is searched.
  assert.ok(block.includes("run the scoped use check (phase2-execution.md Step 3.5) on EVERY finding banded"));
  assert.ok(block.includes("NEVER assert a use-negative you did not search"));

  const manual = readFileSync(new URL("../skills/clearance-search/phase2-execution.md", import.meta.url), "utf8");
  const step = manual.slice(manual.indexOf("## Step 3.5"), manual.indexOf("## Step 3.6"));
  assert.ok(step.includes(`\n\n${ANSWERS_HELD}\n\n`), "Step 3.5 does not carry the ruled paragraph as its own");
  assert.ok(!step.includes("Before synthesis,"), "Step 3.5 still runs the check before the assessment it depends on");
  assert.ok(step.includes("it must actually run the scoped query (owner + mark + goods/field), unless an answer this run already holds answers that question, and cite the result"));
});

test("no band tool tells a reader to keep paging; each says the next page is there", () => {
  const server = readFileSync(new URL("../engine/mcp/band-server.mjs", import.meta.url), "utf8");
  const code = server.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  for (const order of [/call band_shape again/, /call band_record again/, /call again with offset/, /read page by page/, /Read this FIRST/, /each naming the next call/])
    assert.doesNotMatch(code, order);
  for (const said of ['part ${part + 1} is available with {"part": ${part + 1}}]', "the next lines of group ${g} are available with offset:",
    "the next page is available with offset:", "the rest are available with offset:", 'part ${part + 1} is available with {"record_id": "${uri}", "part": ${part + 1}}]',
    "a capped answer names the offset where the next page starts", "A large shape is served in parts, and the end of each part names the next one."])
    assert.ok(code.includes(said), `missing: ${said}`);
});

test("the writer records its findings and exclusions as it completes them, told so right after where it starts", (t) => {
  const SAVED = "Record completed findings (`record_synthesis`) and exclusions (`record_declination`) as you complete them, individually or in small groups; do not wait for the whole report. On a resumed attempt, continue from this run's accepted work and complete what remains. Revise accepted work only for identified contrary evidence, a reasoning error, or an applicable change in the instructions. Finish the overall conclusions against the complete set before declaring the assessment complete.";
  assert.equal(WRITER_RECORDS_AS_IT_GOES, SAVED);
  assert.ok(messageOf(t, "synthesis").includes(`${RULED.join("\n")}\n${SAVED}`), "the writer is not told to record as it goes, straight after where it starts");
  for (const stage of ["placement-inquiry", "register-digest", "narrative-refutation"])
    assert.ok(!messageOf(t, stage).includes(SAVED), `${stage} was told to record the writer's findings`);
});

test("the size rule's orders to read reach placement alone; each list keeps its count, what it holds and its first page", async () => {
  const { buildBandShape, deriveRegisterPositions, renderBandShapeMd, withoutPlacementOrders, READ_THEM_ALL, READ_EVERY_LINE, READ_THE_LIVE_ONES_FIRST } = await import("../band-shape.mjs");
  const { setAsideKeysOf } = await import("../placement-form.mjs");
  const { goodsWordCounter, goodsWordsMatched } = await import("../record-goods.mjs");
  const rec = (id, mark, owner) => ({ record_id: `/mark/eu/${id}`, mark_text: mark, owner_name: owner, classes: ["9"], status: "registered", jurisdictions: ["EU"] });
  const band = [rec("b1", "QZORVAK", "Beta GmbH"), rec("b2", "Qzorvak", "Gamma SA")];
  const positions = deriveRegisterPositions(band);
  const goods = { of: () => [{ classes: ["9"], text: "industrial pumps" }], hits: goodsWordCounter(["joystick"]), matched: goodsWordsMatched(["joystick"]) };
  const { shape } = buildBandShape({ enumerated: band }, { targets: ["Qzorvak"], inScopeClasses: ["9"], positions, goods, keysOf: setAsideKeysOf(positions.positions) });
  const placement = renderBandShapeMd(shape);
  assert.ok(placement.includes(READ_THEM_ALL), "guard: the fixture's list is short enough to be read whole");
  const served = withoutPlacementOrders(placement);
  for (const order of [READ_THEM_ALL, READ_EVERY_LINE, READ_THE_LIVE_ONES_FIRST]) assert.ok(!served.includes(order), `another stage is still told: ${order}`);
  assert.equal(served.split("\n").length, placement.split("\n").length, "a line moved, so the reading audit's line numbers no longer hold");
  // The orders as a crowded list and an unreadable one print them: the count, what the list holds and its first page stay.
  const counted = "1,200 records in 640 lines from 600 owners.";
  const a = `${counted} These are the identical and near-identical marks live in the ordered classes for the client's goods`;
  assert.equal(withoutPlacementOrders(`${a}${READ_EVERY_LINE} The first 100 lines are below.`), `${a}. The first 100 lines are below.`);
  assert.equal(withoutPlacementOrders(`**Goods the test could not read: ${counted}** ${READ_THE_LIVE_ONES_FIRST} A floor here is placed.`),
    `**Goods the test could not read: ${counted}** A floor here is placed.`);
  const server = readFileSync(new URL("../engine/mcp/band-server.mjs", import.meta.url), "utf8");
  assert.ok(server.includes('GROUP_PAGES ? "Read each group by the size sentence at its head; the next part continues the groups." : "The next part continues the groups."'),
    "a part of the shape still tells a stage other than placement how to read its groups");
});
