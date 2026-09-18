// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// a-register-manual-states-what-its-provider-declares.test.mjs — the part of a register manual that can
// be checked against the provider's own declarations.
//
// The manuals under `driver/skills/clearance-register/providers/` are loaded into the assessing model's
// context during a run. What they assert is what a plan may reason from, so a sentence that drifts from
// the code changes what the engine does, and until this file nothing could go red on it: the provenance
// scrub reads method words, the suite census reads test files, and the provider suites never load a
// manual. Measured 2026-09-18: a rewrite that dropped the result ceiling from the section that explains
// it reached an integration branch with every one of those green.
//
// ── WHAT IS CHECKED, AND WHAT IS NOT ────────────────────────────────────────────────────────────────
//
// Two things, both mechanical:
//
//   1. A LIMIT A MANUAL DOCUMENTS STAYS IN THE SECTION THAT DOCUMENTS IT, at the value the provider
//      declares. Anywhere-in-the-file is not enough, and that was measured rather than assumed: the
//      rewrite above kept "30 000" in the tool table while the section on completeness lost it, so a
//      whole-file search stayed green on exactly the commit it exists for.
//   2. A MODE WRITTEN THE WAY A CALL WRITES IT — `match_mode: "…"`, `match: "…"`, `predicate: "…"`, or a
//      row of a table keyed by `match_mode` — is one the provider's tool accepts. The model copies those
//      forms into its calls, so one the tool rejects is an instruction that cannot be followed.
//
// What is NOT checked is whether a sentence is TRUE: that one search mode contains another, that an OR
// stack answers the sum of its legs. Those are readings, and an arm that pretended otherwise would pass
// them. A manual edit is an engine-behaviour change and is read as one; this file only makes the
// mechanical part of that read automatic.
//
// Operators (`OR`, `ADJ`, `CONTAINS` …) are not checked either, and for a stated reason: no provider
// declares its operators as data, only in comments, so there is nothing for a manual to be checked
// against. Mode names are declared, in each tool's input schema.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MANUALS = join(ROOT, "driver", "skills", "clearance-register", "providers");
const PROVIDERS = ["clarivate", "corsearch", "euipo", "free-tier", "signa", "uspto-local"];

const manual = (p) => readFileSync(join(MANUALS, `${p}.md`), "utf8");
const capabilities = async (p) => (await import(pathToFileURL(join(ROOT, "providers", p, "src", "capabilities.js")).href)).CAPABILITIES;

/** Digit groups folded, so "30 000", "30,000" and "30 000" all read as 30000. */
const ungroup = (s) => s.replace(/(\d)[\s  ,’'](?=\d{3}(?!\d))/g, "$1");

/** The body of the `## ` section whose heading matches, up to the next heading of the same level. */
function section(doc, heading) {
  const lines = doc.split("\n");
  const at = lines.findIndex((l) => /^## /.test(l) && heading.test(l));
  if (at === -1) return null;
  const end = lines.findIndex((l, i) => i > at && /^## /.test(l));
  return lines.slice(at, end === -1 ? undefined : end).join("\n");
}

/** Whether `text` states `n` as a whole number, not as part of a longer one or a decimal. */
const states = (text, n) => new RegExp(`(?<![\\d.])${n}(?![\\d])`).test(ungroup(text));

// ── 1. THE LIMITS EACH MANUAL DOCUMENTS ─────────────────────────────────────────────────────────────
//
// Each row is a limit a manual documents today, and the section it documents it in. The list is pinned
// rather than derived because deriving it from the manual is circular — a value dropped from the manual
// would drop out of the list, and the arm would pass the very edit it exists for.
//
// A declared limit a manual does NOT document is not added here by adding it to the manual: that is a
// change to what the engine reads, and it is the owner's before it lands. Measured 2026-09-18, not
// documented: corsearch `maxOrWidth` (80) and euipo `maxOrWidth` (50).
const DOCUMENTED = [
  { provider: "clarivate", key: "resultCeiling", section: /^## Completeness, crowds and the ceiling/ },
  { provider: "clarivate", key: "maxOrWidth", section: /^## Operator vocabulary/ },
  { provider: "corsearch", key: "resultCeiling", section: /^## Pagination/ },
  { provider: "free-tier", key: "maxOrWidth", section: /^## Every capability is the WEAKER source's/ },
  { provider: "uspto-local", key: "maxOrWidth", section: /^## OR-stack width/ },
];

for (const row of DOCUMENTED) {
  test(`${row.provider}'s manual states its declared ${row.key} where it explains it`, async () => {
    const declared = (await capabilities(row.provider))[row.key];
    assert.equal(typeof declared, "number",
      `${row.provider} no longer declares a numeric ${row.key}; this row checks nothing until it is updated`);
    const body = section(manual(row.provider), row.section);
    assert.ok(body, `${row.provider}.md has no section matching ${row.section} — the limit's explanation moved or went`);
    assert.ok(states(body, declared),
      `${row.provider}.md's section ${row.section} no longer states ${row.key} = ${declared}, the value `
      + `providers/${row.provider}/src/capabilities.js declares. The model plans from this sentence.`);
  });
}

test("planted: a declaration that moves without its sentence is caught", () => {
  // The other direction: the code changes the limit and the manual keeps the old one.
  for (const { provider, section: heading } of DOCUMENTED) {
    const body = section(manual(provider), heading);
    assert.ok(!states(body, 7777), `${provider}'s section states 7777, so a moved declaration would not be seen`);
  }
});

test("planted: the ceiling dropped from its section, kept in the tool table, is caught", () => {
  // The shape measured on 2026-09-18: the number survives elsewhere in the file.
  const doc = manual("clarivate");
  const body = section(doc, DOCUMENTED[0].section);
  const planted = doc.replace(body, ungroup(body).replace(/\b30000\b/g, "the ceiling"));
  assert.notEqual(planted, doc, "the plant changed nothing, so it proves nothing");
  assert.ok(states(planted, 30000), "the plant must keep the value somewhere else in the file, or it is not the measured shape");
  assert.ok(!states(section(planted, DOCUMENTED[0].section), 30000), "the section-scoped check passed a section that no longer states the ceiling");
});

// ── 2. MODES WRITTEN AS A CALL WRITES THEM ──────────────────────────────────────────────────────────

/** Every value a tool's input schema accepts for `match_mode`, `match` and `predicate`, per argument. */
function acceptedModes(provider) {
  const src = readFileSync(join(ROOT, "driver", "engine", "mcp", `${provider}-server.mjs`), "utf8");
  const accepted = {};
  for (const m of src.matchAll(/\b(match_mode|match|predicate): \{ type: "string", enum: \[([^\]]*)\]/g)) {
    accepted[m[1]] ??= new Set();
    for (const v of JSON.parse(`[${m[2]}]`)) accepted[m[1]].add(v);
  }
  return accepted;
}

/** The modes a manual writes in call form, as `[argument, value]`. */
function modesWritten(doc) {
  const out = [...doc.matchAll(/(?<![A-Za-z_])(match_mode|match|predicate): "([A-Za-z_]+)"/g)].map((m) => [m[1], m[2]]);
  // A table KEYED by `match_mode` — its first column — lists modes as things to call with. A table
  // that merely has a `match_mode` column is not keyed by it and may list one as unavailable.
  const lines = doc.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^\|\s*`match_mode`\s*\|/.test(lines[i])) continue;
    for (let j = i + 2; j < lines.length && lines[j].startsWith("|"); j += 1) {
      const key = lines[j].split("|")[1].trim().match(/^`([A-Za-z_]+)`$/);
      if (key) out.push(["match_mode", key[1]]);
    }
  }
  return out;
}

for (const provider of PROVIDERS) {
  test(`${provider}'s manual writes no mode its tool would refuse`, () => {
    const accepted = acceptedModes(provider);
    const refused = modesWritten(manual(provider)).filter(([arg, v]) => !accepted[arg]?.has(v));
    assert.deepEqual(refused.map(([a, v]) => `${a}: "${v}"`), [],
      `${provider}.md writes a mode that driver/engine/mcp/${provider}-server.mjs does not accept. A `
      + "model that copies it into a call gets a refusal, or a different search than the manual describes.");
  });
}

test("the tool schemas were read, so an empty refusal list means something", () => {
  for (const provider of ["clarivate", "corsearch", "euipo", "free-tier", "signa"]) {
    const accepted = acceptedModes(provider);
    assert.ok(Object.values(accepted).some((s) => s.size > 0), `no mode enum read from ${provider}-server.mjs — the check above could not look`);
  }
  assert.ok(modesWritten(manual("clarivate")).length >= 6, "clarivate's mode table was not read — the check above could not look");
});

test("planted: a mode the tool does not accept, written into a manual, is caught", () => {
  const accepted = acceptedModes("clarivate");
  const planted = `${manual("clarivate")}\nUse \`match_mode: "fuzzy"\` for typos.\n`;
  const refused = modesWritten(planted).filter(([arg, v]) => !accepted[arg]?.has(v));
  assert.deepEqual(refused, [["match_mode", "fuzzy"]]);
  const table = manual("clarivate").replace(/^\| `phonetic` \|/m, "| `soundex` |");
  assert.notEqual(table, manual("clarivate"), "the table plant changed nothing, so it proves nothing");
  assert.deepEqual(modesWritten(table).filter(([arg, v]) => !accepted[arg]?.has(v)), [["match_mode", "soundex"]]);
});
