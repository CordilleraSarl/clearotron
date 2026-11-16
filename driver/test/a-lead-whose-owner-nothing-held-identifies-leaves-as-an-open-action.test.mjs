// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A LEAD WHOSE OWNER NOTHING HELD IDENTIFIES LEAVES AS AN OPEN ACTION, NEVER AS A RATED FINDING.
//
// The framework rates a legal read, and a legal read needs a party. So a lead that meets the inclusion rule but whose
// proprietor no source the run holds identifies, in the role that matters, carries no band. It leaves three ways at
// once:
//   - one run-level identification action, with no ordinals;
//   - an open coverage row of its area that names it;
//   - a declination of its page as `owner-unidentified`, which keeps the page, its source and its ground.
// Before, the writer was told to set the owner to "Unverified" and rate it, and an unknown owner read as a low risk.
// These cases pin what the writer's instructions rely on in the tools: the token exists and is never refused, the
// action is valid and conditions the run, the report's reference check accepts the action only when the coverage row
// names the lead, and the audit workbook does not list the open lead as set aside. Every mark is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { acceptDeclinationCall, DECLINATION_REASONS, DECLINATION_REASON_TOKENS } from "../declination-call.mjs";
import { recordDeclinations, readDeclinations } from "../declination-tool.mjs";
import { validateAction, deriveActionConditions } from "../findings-model.mjs";
import { referenceChecks, pageNameLines } from "../predelivery-lint.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DRIVER = join(HERE, "..");
const SCOPE = { marks: ["QZORVAK"], classes: [9] };
const PAGE = { kind: "page", page: "store.example/app/77/Qzorvex_Quest", url: "https://store.example/app/77/Qzorvex_Quest/" };
const IDENTICAL = { uri: "/mark/eu/q7", mark: "Qzorvak", owner: "", classes: [9], status: "REGISTERED" };
const GROUND = "The store page shows the title and a brand line only; it names no developer or publisher behind the title.";
const LEAD = "Qzorvex Quest";   // a near spelling: a name containing the searched mark is exempt from the check by design

test("the reason exists, cites its rule, and is not a claim about relevance", () => {
  assert.ok(DECLINATION_REASON_TOKENS.includes("owner-unidentified"));
  const r = DECLINATION_REASONS["owner-unidentified"];
  assert.equal(r.discretionary, false, "a relevance refusal could then fire on a lead whose owner is merely unknown");
  assert.match(r.rules, /synthesis-rules\.md/);
  assert.match(r.gloss, /no band/);
  assert.match(r.gloss, /open identification action/);
  assert.match(r.gloss, /a name\s+alone does not/, "the gloss loses the distinction between a name and an identified party");
});

test("it is accepted on a page, and on an identical live in-class record, where every relevance reason is refused", () => {
  const onPage = acceptDeclinationCall({ rows: [PAGE], scope: SCOPE }, { declinations: [{ row_index: 0, reason: "owner-unidentified", grounds: GROUND }] });
  assert.deepEqual([onPage.accepted.length, onPage.refused.length], [1, 0], onPage.refused[0]?.why);
  const onRecord = acceptDeclinationCall({ rows: [IDENTICAL], scope: SCOPE }, { declinations: [{ row_index: 0, reason: "owner-unidentified", grounds: GROUND }] });
  assert.deepEqual([onRecord.accepted.length, onRecord.refused.length], [1, 0], onRecord.refused[0]?.why);
  const asRoom = acceptDeclinationCall({ rows: [IDENTICAL], scope: SCOPE }, { declinations: [{ row_index: 0, reason: "not-worth-the-line", grounds: GROUND }] });
  assert.equal(asRoom.accepted.length, 0, "guard: a relevance reason is refused on this record");
});

test("the writer's instructions name the tool's token, and no longer set an unknown owner to \"Unverified\"", () => {
  const dispatch = readFileSync(join(DRIVER, "stages.mjs"), "utf8");
  const manual = readFileSync(join(DRIVER, "skills", "clearance-search", "synthesis-rules.md"), "utf8");
  for (const [name, text] of [["the writer's dispatch", dispatch], ["synthesis-rules.md", manual]]) {
    assert.match(text, /owner-unidentified/, `${name} does not name the declination the tool accepts`);
    assert.doesNotMatch(text, /set \\?`owner\.name\\?` to "Unverified"/, `${name} still rates an unknown owner as "Unverified"`);
  }
  const reviewer = readFileSync(join(DRIVER, "skills", "narrative-refutation", "SKILL.md"), "utf8");
  assert.match(reviewer, /_records\//, "the reviewer cannot trace a proprietor to the fetched register record");
});

test("the action the writer types is valid with no ordinals, and conditions the run", () => {
  const action = { id: 1, kind: "senior-clearance", ordinals: [],
    text: `Identify who stands behind ${LEAD}, and for what goods, before relying on this clearance.`,
    condition: `No source this search holds identifies who stands behind ${LEAD}.` };
  assert.doesNotThrow(() => validateAction(action, 0, new Set(), new Set()));
  const c = deriveActionConditions([action], []);
  assert.equal(c.conditionActions.length, 1, "a run-level identification action did not condition the run");
});

test("the report's reference check accepts the action only when the open coverage row names the lead", () => {
  const actionsText = `<li>Identify who stands behind ${LEAD}, and for what goods, before relying on this clearance.</li>`;
  const fullSurface = `<p>The search found no conflict on the registers.</p>${actionsText}`;
  const check = (coverage) => referenceChecks({ actionsText, fullSurface, searchedNames: ["QZORVAK"], surface: "report", structural: true,
    introducedIn: pageNameLines({ coverage }).join("\n") });
  const integrity = (checks) => checks.find((x) => x.id === "reference-integrity");
  const named = integrity(check([{ area: "common-law / app stores", state: "open", note: `${LEAD}: the store page names no developer or publisher` }]));
  assert.equal(named.pass, true, JSON.stringify(named));
  const unnamed = integrity(check([{ area: "common-law / app stores", state: "open", note: "one title's owner is not identified" }]));
  assert.equal(unnamed.pass, false, "guard: the check no longer reads names in the action list, so the coverage row proves nothing");
  assert.ok(unnamed.orphans.some((o) => LEAD.includes(o) || o.includes("Qzorvex")), JSON.stringify(unnamed.orphans));
  assert.equal(unnamed.structural, true);
});

test("the audit workbook does not list the open lead as set aside, and lists every other declination as before", async () => {
  const runDir = mkdtempSync(join(tmpdir(), "owner-unidentified-"));
  try {
    const OTHER = { kind: "page", page: "store.example/publisher/elsewhere", url: "https://store.example/publisher/elsewhere" };
    recordDeclinations({ runDir, rows: [PAGE, OTHER], scope: {} }, { declinations: [
      { row_index: 0, reason: "owner-unidentified", grounds: GROUND },
      { row_index: 1, reason: "off-field-not-major", grounds: "A publisher page with no title under the name, outside the client's field." },
    ] });
    assert.equal(readDeclinations(runDir).byPage.get(PAGE.page)?.reason, "owner-unidentified",
      "guard: the run's record does not keep the page, so leaving it off the sheet proves nothing");
    const { setAsideRows } = await import("../publish/index.mjs");
    assert.deepEqual(setAsideRows(runDir).map((r) => r.area), [`Set aside: ${OTHER.url}`]);
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});
