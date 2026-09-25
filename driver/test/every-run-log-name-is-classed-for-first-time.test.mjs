// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// EVERY NAME THE RUN LOG CAN CARRY IS CLASSED FOR "FIRST TIME". The harness reads a run's record by name:
// an event or a dispatch reason it has not classed is read as neither a failure nor a pass. A reader that
// matched names by pattern read "first time: yes" on a run whose engine had re-issued its own meaning
// searches, because no pattern matched that event. So the population is read here from the product's own
// source, every event name and every dispatch reason it writes, a helper's and a ternary's included, and
// each must be counted or named as not counted. A name added later fails here until someone classes it.
//
// A VALUE THAT IS NOT A LITERAL IS NAMED, NOT SKIPPED. A template, an identifier or an expression can
// produce a name no literal shows, so each such site is listed below with the names it can produce, and a
// site not listed fails.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { trackedFiles } from "../../shared/tracked-files.mjs";
import {
  classOfEvent, classOfTrigger, COUNTED_EVENTS, NOT_COUNTED_EVENTS, RETIRED_EVENTS, COUNTED_TRIGGERS,
  NOT_COUNTED_TRIGGERS, TRIGGER_FAMILIES,
} from "../../scripts/e2e-first-time.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GUARD = "every run-log name is classed for first time";
const ROOTS = ["driver/", "shared/", "mcp-server/", "providers/_shared/"];
const inScope = (rel) => ROOTS.some((r) => rel.startsWith(r)) && !/(^|\/)(test|node_modules)\//.test(rel);

// Event values that are not a quoted literal, with the names each produces.
const EVENT_SITES = {
  '`family-${body?.action === "ungroup" ? "ungroup" : "group"}`': ["family-group", "family-ungroup"],
  'typeof rec.event === "string" ? rec.event : "other"': ["other"],   // the portal's audit view
};
// Trigger values that are not a quoted literal. A pass-through carries a name some literal already wrote.
const TRIGGER_SITES = {
  "`recall-reconcile-${trigger}`": ["recall-reconcile-fresh"],   // the recall-reconcile family
  "`${trigger}-retry`": ["settlement-flush-retry", "late-flush-retry"],   // the -retry family
  'opts.trigger ?? "fresh"': [],
  'opts.dispatchTrigger ?? "fresh"': [],
  "opts.dispatchTrigger ?? null": [],
  "i.trigger": [],   // a flush message section's composer name
  "t.trigger ?? null": [],   // a reader
  "e.trigger ?? null": [],   // a reader
  "e.trigger": [],   // a reader
  'ev?.trigger ?? (ev?.event === "skip" ? "skip" : null)': [],   // a reader
  "String(trigger)": [],   // a queued digest receipt's name
  "caseLaw.trigger": [],   // the case-law doctrine's trigger word, never a dispatch reason
  "m ? m[0].toLowerCase() : null": [],   // the same word, read from the matter
  "reason": [],   // an output snapshot's reason
};

// An expression read to its end: a comma, semicolon or closing bracket at depth 0, or the line's end.
// Quote-aware, and a template's `${…}` is read through.
function readExpr(s) {
  let depth = 0, q = null, i = 0;
  const holes = [];
  for (; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === "\\") { i++; continue; }
      if (q === "`" && ch === "$" && s[i + 1] === "{") { holes.push(depth); depth++; q = null; i++; continue; }
      if (ch === q) q = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { q = ch; continue; }
    if ("([{".includes(ch)) { depth++; continue; }
    if (")]}".includes(ch)) {
      if (depth === 0) break;
      depth--;
      if (holes.length && holes[holes.length - 1] === depth) { holes.pop(); q = "`"; }
      continue;
    }
    if ((ch === "," || ch === ";") && depth === 0) break;
  }
  return s.slice(0, i).trim();
}

// Whether a position on a line sits inside a string: a message that quotes `event:` writes no event.
function insideString(line, at) {
  let q = null;
  for (let i = 0; i < at; i++) {
    const ch = line[i];
    if (q) { if (ch === "\\") i++; else if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'" || ch === "`") q = ch;
  }
  return q !== null;
}

/** Every value given to `key:` (or assigned to `key =`) on a code line: literal names, and the other sites as written. */
function valuesOf(key, src) {
  const names = new Set();
  const sites = [];
  for (const line of src.split("\n")) {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
    const re = new RegExp(`\\b${key}\\s*(?::|=(?!=))\\s*`, "g");
    let m;
    while ((m = re.exec(line))) {
      if (insideString(line, m.index)) continue;
      const expr = readExpr(line.slice(m.index + m[0].length));
      const lit = /^(["'])((?:(?!\1)[^\\]|\\.)*)\1$/.exec(expr);
      if (lit) { names.add(lit[2]); continue; }
      const tern = /^[^?]+\?\s*(["'])([^"'\n]*)\1\s*:\s*(["'])([^"'\n]*)\3$/.exec(expr);
      if (tern) { names.add(tern[2]); names.add(tern[4]); continue; }
      if (expr === "" || /^(null|undefined|true|false)$/.test(expr) || /^(async\b|function\b|\([^)]*\)\s*=>|[\w$]+\s*=>)/.test(expr)) continue;
      sites.push(expr);
    }
  }
  return { names, sites };
}

function population() {
  const all = trackedFiles(GUARD, { root: REPO, pathspec: ["*.mjs", "*.js"] });
  if (all === null) return null;
  const files = all.filter(inScope);
  const events = new Set(), triggers = new Set(), eventSites = new Map(), triggerSites = new Map();
  for (const rel of files) {
    let src;
    try { src = readFileSync(join(REPO, rel), "utf8"); } catch { continue; }
    const ev = valuesOf("event", src), tr = valuesOf("trigger", src);
    for (const n of ev.names) events.add(n);
    for (const n of tr.names) triggers.add(n);
    for (const s of ev.sites) eventSites.set(s, rel);
    for (const s of tr.sites) triggerSites.set(s, rel);
  }
  return { files, events, triggers, eventSites, triggerSites };
}

test("the reader finds what it must: a literal, a ternary whose condition is quoted, a template and a variable", () => {
  const src = [
    'runLog(dir, { event: "a-literal", n: 1 });',
    'const row = { event: cond === "x" ? "picked-one" : "picked-two" };',
    "// runLog(dir, { event: \"in-a-comment\" });",
    "audit({ event: `built-${kind}` });",
    "const trigger = pass === \"late\" ? \"late-flush\" : \"settlement-flush\";",
    "log({ event: someName });",
    "note(`no {event:\\\"quote\\\"} row, and trigger: ${x} in a message`);",
  ].join("\n");
  const ev = valuesOf("event", src);
  assert.deepEqual([...ev.names].sort(), ["a-literal", "picked-one", "picked-two"]);
  assert.deepEqual(ev.sites, ["`built-${kind}`", "someName"]);
  assert.deepEqual([...valuesOf("trigger", src).names].sort(), ["late-flush", "settlement-flush"]);
});

test("every event name and dispatch reason the product writes is classed, and every class names something written", (t) => {
  const pop = population();
  // null means NO CHECKOUT to read the corpus from: skipped loudly, never passed on an empty list.
  if (pop === null) return t.skip("no tracked corpus in this tree — the census could not look");
  // THE FLOOR. A reader that read nothing would report every name classed.
  assert.ok(pop.files.length > 300, `the census read ${pop.files.length} source files — too few to be the product`);
  assert.ok(pop.events.size > 300, `the census found ${pop.events.size} event names — too few to be the run log's`);
  for (const n of ["connotation-reissue", "commonlaw-carry", "depth-ladder", "coverage-absence-rendered", "repair-attempted", "form-repair"])
    assert.ok(pop.events.has(n), `the census missed "${n}", which the product writes — through a helper, a ternary or another module`);
  for (const n of ["verdict-recheck", "envelope", "settlement-flush", "late-flush"])
    assert.ok(pop.triggers.has(n), `the census missed the dispatch reason "${n}"`);

  const unlistedEvents = [...pop.eventSites].filter(([s]) => !Object.hasOwn(EVENT_SITES, s)).map(([s, f]) => `${f}: event ${s}`);
  const unlistedTriggers = [...pop.triggerSites].filter(([s]) => !Object.hasOwn(TRIGGER_SITES, s)).map(([s, f]) => `${f}: trigger ${s}`);
  assert.deepEqual([...unlistedEvents, ...unlistedTriggers], [],
    "a name is built by a value that is not a literal; list the site with the names it can produce");
  for (const s of Object.keys(EVENT_SITES)) assert.ok(pop.eventSites.has(s), `listed event site ${s} is no longer in the source — an entry that accounts for nothing hides the next one`);
  for (const s of Object.keys(TRIGGER_SITES)) assert.ok(pop.triggerSites.has(s), `listed trigger site ${s} is no longer in the source`);

  const events = new Set([...pop.events, ...Object.values(EVENT_SITES).flat()]);
  const triggers = new Set([...pop.triggers, ...Object.values(TRIGGER_SITES).flat()]);
  const unclassed = [...[...events].filter((n) => classOfEvent(n) === null).map((n) => `event "${n}"`),
    ...[...triggers].filter((n) => classOfTrigger(n) === null).map((n) => `dispatch reason "${n}"`)];
  assert.deepEqual(unclassed, [], "the product writes a name the first-time reader has not classed: count it, or name why it does not count, in scripts/e2e-first-time.mjs");

  const classedEvents = [...Object.keys(COUNTED_EVENTS), ...Object.values(NOT_COUNTED_EVENTS).flat()];
  const stale = [...classedEvents.filter((n) => !events.has(n) && !RETIRED_EVENTS.includes(n)).map((n) => `event "${n}"`),
    ...[...Object.keys(COUNTED_TRIGGERS), ...Object.values(NOT_COUNTED_TRIGGERS).flat()].filter((n) => !triggers.has(n)).map((n) => `dispatch reason "${n}"`)];
  assert.deepEqual(stale, [], "a class names something the product no longer writes: remove it, or list it as retired");
  const twice = classedEvents.filter((n, i) => classedEvents.indexOf(n) !== i);
  assert.deepEqual(twice, [], "a name is classed twice");
  for (const [re] of TRIGGER_FAMILIES) assert.ok([...triggers].some((n) => re.test(n)), `the dispatch family ${re} matches nothing the product builds`);
});
