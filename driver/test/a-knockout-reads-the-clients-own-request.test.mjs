// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A KNOCKOUT READS THE CLIENT'S OWN REQUEST, AND THE FILINGS' GOODS.
//
// The message as it came is saved at intake, and neither the frame nor the rating was told it was there, so the structured
// brief was all they had. These hold what each stage is now told, when it is told it, and the row that keeps one requested
// item's written forms together for the register search. Every mark is invented.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { KO_STAGES, koPaths } from "../stages-knockout.mjs";
import { validators as koValidators, alternativesDefect } from "../verify-knockout.mjs";
import { acceptKnockoutFrame } from "../knockout-frame-record.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMP = [];
const tempRun = () => { const d = mkdtempSync(join(tmpdir(), "knockout-request-")); TEMP.push(d); return d; };
after(() => { for (const d of TEMP) rmSync(d, { recursive: true, force: true }); });

const FRAMEWORK = { bands: [{ label: "High" }, { label: "Low" }] };
const frameMessage = (run, job = {}) => KO_STAGES["knockout-frame"].message({ K: koPaths(run), job, profile: { industry: "invented industry" } });
const assessMessage = (run, job = {}) => KO_STAGES["knockout-assess"].message({ K: koPaths(run), job, chunkNo: 0, chunkTotal: 1,
  chunkMarks: [{ name: "LANTERNWICK" }], framework: FRAMEWORK, frameworkPath: null, probeNote: null, frameworkMethod: null });
const S1 = (path) => `The VERBATIM inbound request is archived at ${path}. Read it before you frame: it leads on the goods, services and intended use, and the customer's profile only fills what it leaves open.`;
const S1_BRIEF = (path) => `The archived original request is not available here. Read the available brief at ${path} before you frame. Use its stated scope and keep inferred uses explicit; the customer's profile fills gaps.`;
const S4 = (path) => `THE CLIENT'S OWN REQUEST, VERBATIM: ${path}. Read it before you rate. Its stated goods, services, and intended use lead over the plan; the customer's profile fills gaps. Keep a guessed use as a possibility. Do not use that guess to narrow the instructed scope or lower a rating.`;
const S4_BRIEF = (path) => `AVAILABLE BRIEF: ${path}. The original request is not held here. Read the brief before you rate, keep its stated scope, and distinguish supplied facts from inferred uses. Do not lower a rating on a guessed use.`;

test("the frame and the rating are told where the request is, and are told nothing of a file that is not there", () => {
  const run = tempRun();
  for (const words of ["inbound request", "original request", "AVAILABLE BRIEF", "CLIENT'S OWN REQUEST"]) {
    assert.ok(!frameMessage(run).includes(words) && !assessMessage(run).includes(words), `a message named a request that is not on file: ${words}`);
  }
  const brief = join(run, "confirmation-brief.md"), raw = join(run, "inbound-request.txt");
  writeFileSync(brief, "An invented brief.\n");
  assert.ok(frameMessage(run).includes(S1_BRIEF(brief)), "with only a brief on file, the frame reads the brief under its own label");
  assert.ok(assessMessage(run).includes(S4_BRIEF(brief)));
  assert.ok(!frameMessage(run).includes("VERBATIM") && !assessMessage(run).includes("VERBATIM"), "a brief was called the verbatim request");
  writeFileSync(raw, "An invented message about LANTERNWICK.\n");
  assert.ok(frameMessage(run).includes(S1(raw)), "the message as it came leads over the brief");
  assert.ok(assessMessage(run).includes(S4(raw)));
  assert.ok(!frameMessage(run).includes(brief) && !assessMessage(run).includes(brief), "the brief was named beside the message");
});

test("the rating is told the filings carry goods, what they rest on, and where the whole wording is", () => {
  const run = tempRun();
  const K = koPaths(run);
  assert.ok(!assessMessage(run).includes("Read the held filings"), "premise: no filings on file, no filings line");
  mkdirSync(dirname(K.registerRecords), { recursive: true });
  writeFileSync(K.registerRecords, JSON.stringify({ marks: [] }));
  const message = assessMessage(run);
  for (const words of ["Read the held filings and weigh them for the names you are rating, against the client's requested goods.",
    "`goods` is a short view, `goodsState` records completeness, and `goodsFrom` records its source.",
    `If wording needed for your judgment is shortened or uncertain, read \`fullRecord\` where it is held (its path is under ${run}).`,
    "Missing or incomplete wording does not establish that the goods are unrelated.",
    "how its goods meet the goods the client asked about, whether it bears on the rating, and why"]) assert.ok(message.includes(words), words);
});

test("the manuals carry the same words as the messages", () => {
  const frame = readFileSync(join(HERE, "..", "skills", "knockout-frame", "SKILL.md"), "utf8");
  const assess = readFileSync(join(HERE, "..", "skills", "knockout-assess", "SKILL.md"), "utf8").replace(/\s+/g, " ");
  assert.ok(frame.includes('Where the request does not state what a name is for, say so here and write what you infer as a possibility ("possibly a game title"), never as what the client intends.'));
  assert.ok(frame.includes('2f. **`alternatives` — where the request gives one item in more than one spelling or word order ("LAKE MOON / MOON LAKE"), list each form as written.**'));
  assert.ok(frame.includes('"alternatives": ['), "the output contract does not carry the key");
  assert.ok(assess.includes("how its goods meet the goods the client asked about, whether it bears on the rating, and why."));
  assert.ok(assess.includes("Use the missing-goods note only when no wording is held; open a shortened held record before concluding that wording is missing."));
  assert.ok(assess.includes('"Goods wording is not held for this filing, so its relevance to the requested goods remains unresolved."'));
  assert.ok(!assess.includes("Pull Acme Mapping's full goods list"), "the note that assumed the goods were never seen is still taught");
});

const NAME = "LAKE MOON / MOON LAKE";
const frameCall = (alternatives) => ({ schema: 1, scope_note: "An invented note.", batch: { productContext: "An invented batch.", inUseAs: "a title", executionOrder: [NAME] },
  marks: [{ name: NAME, classesPlain: "software (9)", contextFraming: "An invented use.", useKind: "title", places: ["web", "fandom.com"], spellings: [NAME, "LAKEMOON"], ...(alternatives === undefined ? {} : { alternatives }) }] });

test("a row's alternatives are checked for shape only: which forms the request gives is the frame's reading of it", () => {
  for (const a of [undefined, null, [], ["LAKE MOON", "MOON LAKE"], ["LAKE/MOON"], ["LAKE, MOON"], ["LUNAR LAKE"]]) assert.equal(alternativesDefect(NAME, a), null, JSON.stringify(a));
  for (const a of ["LAKE MOON", [""], ["  "], [7]]) assert.match(alternativesDefect(NAME, a), /a list of the written forms of this one item/);
  assert.equal(acceptKnockoutFrame(frameCall(["LAKE MOON", "MOON LAKE"])).ok, true);
  assert.equal(acceptKnockoutFrame(frameCall(["LAKE/MOON"])).ok, true, "a form holding a slash was refused for its punctuation");
  assert.equal(acceptKnockoutFrame(frameCall(undefined)).ok, true, "a row with one form was refused");
  assert.match(acceptKnockoutFrame(frameCall("LAKE MOON")).reason, /knockoutframe_alternatives/);

  const run = tempRun();
  const plan = join(run, "knockout-plan.json");
  writeFileSync(join(run, "inbound-request.txt"), "Please look at LAKE MOON.\n");
  const reason = (a) => koValidators.knockoutPlan(plan, JSON.stringify(frameCall(a))).reason ?? "";
  // A word the request does not hold is not a reason to refuse here: that is a reading, and the manual's rule governs it.
  for (const a of [undefined, ["LAKE MOON", "MOON LAKE"], ["LUNAR LAKE"]]) assert.doesNotMatch(reason(a), /alternative/, JSON.stringify(a));
  assert.match(reason(["  "]), /a list of the written forms of this one item/);
});
