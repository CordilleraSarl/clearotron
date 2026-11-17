// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A PARTY THE DELIVERED PAGE SHOWS IS INTRODUCED TO ITS READER, EVEN WHERE report.md DOES NOT NAME IT.
//
// The reference checks read report.md for an action that names a party nothing introduces. The delivered page draws two
// more sections from the record that report.md does not carry: the coverage rows the run left open, under "What was
// searched", and the web and marketplace names under "Also considered". Measured in testing, 2026-11-12: an action named
// a marketplace item that the page's open coverage row and its names list both showed, and both checks named it as
// unintroduced; the email's flag told its reader to look in the report for what the report showed.
//
// Now both checks read those lines as the page draws them (predelivery-lint.mjs pageNameLines): a row that is not clean,
// and a name inside the list's display cap, introduce a party. A clean row and a follow-up row the page hides as a
// repeat, neither of which the reader sees, and a name past the cap do not; a party named only after the dash of a hidden
// follow-up row is still flagged. The lint applies the page's rules rather than importing the renderer, so the last arm
// renders a page and holds the two to each other. A run handing the lint no record and no audit is judged as before.
// Every mark, owner and seller is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
process.env.CLEAROTRON_MCP_URL ||= "https://mcp.test/mcp";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runLint, pageNameLines, PAGE_WEB_NAMES_SHOWN } from "../predelivery-lint.mjs";
import { parseReport } from "../publish/parse.mjs";
import { renderHtml } from "../publish/render.mjs";
import { emailConditionsOfReport } from "../publish/email-conditions.mjs";

const FINDINGS = [{ ordinal: 1, mark: "SOLVIRA", owner: { name: "Ostrava Kites" }, disposition: "adversarial" }];
const ACTION = "- Establish who owns the rights behind Tarnwick Labs before adoption.";
const reportMd = `---
title: SOLVERA
overall_caption: One conflict needs an answer.
---

# Actions

### Only you can close these

${ACTION}

# Marks

## SOLVIRA — Ostrava Kites
- ord: 1
`;
const record = (coverage) => JSON.stringify({ findings: FINDINGS, coverage });
const OPEN_ROW = { area: "Marketplace / Tarnwick Labs controller grips", state: "open",
  note: "A marketplace listing names Tarnwick Labs as the seller. Its legal owner remains unverified." };
const auditWith = (titles) => titles.map((t, i) => `## ${t}\n- source_layer: common-law\n- url: https://shop.example/item/${i + 1}\n- type: marketplace\n`).join("\n");

const lint = ({ findingsRaw, auditMd } = {}) => runLint({
  reportMd, searchedNames: ["SOLVERA"], headerName: "SOLVERA", ratedNames: ["SOLVERA"], findings: FINDINGS,
  verdictDoc: { verdict: "CONDITIONAL" }, emailConditions: emailConditionsOfReport(reportMd, "CONDITIONAL"),
  actionsExpected: true, findingsRaw, auditMd,
});
const on = (l, id) => l.checks.find((c) => c.id === id);
const REPORT = "reference-integrity", EMAIL = "reference-integrity:email";

test("control: with no record and no audit the party is named on both surfaces, as before", () => {
  const l = lint();
  assert.deepEqual(on(l, REPORT)?.orphans, ["Tarnwick Labs"], "premise: the check must fire, or the cases below prove nothing");
  assert.equal(on(l, REPORT)?.structural, true, "a code-built action list keeps its structural flag");
  assert.deepEqual(on(l, EMAIL)?.orphans, ["Tarnwick Labs"]);
});

test("an open coverage row the page draws introduces the party on both surfaces", () => {
  const l = lint({ findingsRaw: record([OPEN_ROW]) });
  assert.equal(on(l, REPORT)?.pass, true, "the page's open row names the party, and the report check still named it");
  assert.equal(on(l, EMAIL)?.pass, true, "the email's reader reaches that page, and the email check still named it");
});

test("a clean coverage row, which the page does not draw, introduces nothing", () => {
  const l = lint({ findingsRaw: record([{ ...OPEN_ROW, state: "confirmed-clean" }]) });
  assert.deepEqual(on(l, REPORT)?.orphans, ["Tarnwick Labs"]);
  assert.deepEqual(on(l, EMAIL)?.orphans, ["Tarnwick Labs"]);
});

test("a name the page lists introduces the party; one past the list's display cap does not", () => {
  const listed = lint({ auditMd: auditWith(["Tarnwick Labs grip set"]) });
  assert.equal(on(listed, REPORT)?.pass, true);
  assert.equal(on(listed, EMAIL)?.pass, true);
  const fillers = ["Bramblecote", "Corriveau", "Dunmarrow", "Elsworthy", "Fenchurch", "Glenquay", "Harrowgate", "Inchbury"];
  const pastCap = lint({ auditMd: auditWith([...fillers.map((f) => `${f} pads`), "Tarnwick Labs grip set"]) });
  assert.equal(pageNameLines({ webNames: [...fillers, "Tarnwick Labs"].map((title) => ({ title })) }).length, fillers.length,
    "premise: the page shows exactly as many names as the fillers, so the ninth is not drawn");
  assert.deepEqual(on(pastCap, REPORT)?.orphans, ["Tarnwick Labs"]);
});

// A follow-up row the page hides because another open row restates its directive. The party is named only after the
// dash, which the page never draws.
const RESTATING_ROW = { area: "Quorrel storefront listing", state: "open", note: "Its seller remains unverified." };
const hiddenFollowUp = (tail) => ({ area: "Follow-up / quorrel storefront", state: "open",
  note: `quorrel storefront \u2014 not completed this run \u2014 ${tail}` });

test("a party named only after the dash of a follow-up row the page hides is still named", () => {
  const hidden = lint({ findingsRaw: record([RESTATING_ROW, hiddenFollowUp("the listing names Tarnwick Labs as seller")]) });
  assert.deepEqual(on(hidden, REPORT)?.orphans, ["Tarnwick Labs"], "the page hides that row, so it introduces nobody");
  assert.deepEqual(on(hidden, EMAIL)?.orphans, ["Tarnwick Labs"]);
  // The same row with nothing restating it is drawn, so the party it names is introduced.
  const drawn = lint({ findingsRaw: record([hiddenFollowUp("the listing names Tarnwick Labs as seller")]) });
  assert.equal(on(drawn, REPORT)?.pass, true, "a follow-up row nothing restates is on the page");
});

test("the lint's lines are the page's: every drawn row and listed name is on the rendered page, and nothing else", () => {
  const dir = mkdtempSync(join(tmpdir(), "clearotron-pagelines-"));
  const path = join(dir, "f.report.md");
  writeFileSync(path, "# Clearance read\n\n## Overall\n\nMEDIUM\n\n## What we found\n\nNothing notable.\n");
  let parsed;
  try { parsed = parseReport(path); } finally { rmSync(dir, { recursive: true, force: true }); }
  const states = ["open", "coverage-limited", "not-searched", "note", "confirmed-clean"];
  const coverage = [
    ...states.map((state, i) => ({ area: `Marketplace / Quorrel${i} listing`, state, note: `Seller Vantrell${i} is named.` })),
    // a follow-up row another open row restates, which the page hides, and one nothing restates, which it draws
    { area: "Corvantis storefront listing", state: "open", note: "Its seller remains unverified." },
    { area: "Follow-up / corvantis storefront", state: "open", note: "corvantis storefront \u2014 not completed this run \u2014 Hidwellan named" },
    { area: "Follow-up / ostrelmoor kiosk", state: "open", note: "ostrelmoor kiosk \u2014 not completed this run \u2014 Drawnbury named" },
  ];
  const names = Array.from({ length: PAGE_WEB_NAMES_SHOWN + 2 }, (_, i) => ({ title: `Brisandor${i} kit`, url: `https://shop.example/${i}` }));
  const html = renderHtml(parsed, [], coverage, { runId: "pagelines", searchDepth: { cleared: { register: [], web: names, groups: {} }, counts: {} } });
  const lines = pageNameLines({ coverage, webNames: names }).join("\n");
  for (let i = 0; i < states.length; i++) {
    assert.equal(html.includes(`Quorrel${i}`), lines.includes(`Quorrel${i}`), `a ${states[i]} row: the page and the lint disagree on whether it is shown`);
  }
  for (let i = 0; i < names.length; i++) {
    assert.equal(html.includes(`Brisandor${i}`), lines.includes(`Brisandor${i}`), `name ${i + 1}: the page and the lint disagree on whether it is listed`);
  }
  assert.ok(lines.includes("Quorrel0") && !lines.includes("Quorrel4"), "premise: an open row is drawn and a clean one is not");
  assert.ok(lines.includes("Brisandor0") && !lines.includes(`Brisandor${PAGE_WEB_NAMES_SHOWN}`), "premise: the cap cuts the list");
  for (const word of ["Hidwellan", "Drawnbury"]) {
    assert.equal(html.includes(word), lines.includes(word), `the follow-up row naming ${word}: the page and the lint disagree on whether it is shown`);
  }
  assert.ok(!lines.includes("Hidwellan") && lines.includes("Drawnbury"), "premise: one follow-up row is hidden and one is drawn");
});
