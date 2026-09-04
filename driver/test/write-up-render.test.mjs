// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// §8 — the short entry and the grouped row, and the constraints each was ruled under.
import test from "node:test";
import assert from "node:assert/strict";
import { shortEntryBody, buildGradedEntriesSection, groupEntries, memberLine, territoriesOf, SHORT_ENTRY_HEADING }
  from "../write-up-render.mjs";
import { composeCard } from "../card-frame.mjs";

const f = (ordinal, mark, owner, jx = [], classes = ["25"], net = "same class, different trade channel") => ({
  ordinal, mark, net, disposition: "coexistence-partner", source: { source_type: "register" },
  owner: { name: owner, registrations: jx.map((j) => ({ jurisdiction: j, classes })) },
});

test("#1503 a short entry is recognisable as INTENDED, never as a truncated full card", () => {
  const body = shortEntryBody(f(12, "ACME", "Acme Holdings", ["FR"]));
  assert.match(body, /^###\s+in short/im, "no own heading — a reader cannot tell this form from a card that failed");
  assert.doesNotMatch(body, /^###\s+full detail/im, "a short entry must not carry the full-detail heading");
  // It is a BODY, not a composed card: assembly owns the frame for both forms, so they cannot drift.
  assert.doesNotMatch(body, /^## /m, "the body composed its own head — assembly would give the file two");
  assert.doesNotMatch(body, /^- ord:/m, "the body composed its own meta lines");
  // and the shared composer still frames it, ordinal binding intact
  const md = composeCard(f(12, "ACME", "Acme Holdings", ["FR"]), body,
    { group: "Coexistence partner", netLine: "- net: x" });
  assert.match(md, /^## Acme Holdings — ACME, FR$/m);
  assert.match(md, /^- ord: 12$/m, "the ordinal binding is the existing one and must survive");
});

test("#1503 NO NEW AUTHORED PROSE — the sentence is the typed net, with the archived fallback", () => {
  const md = shortEntryBody(f(12, "ACME", "Acme Holdings", ["FR"], ["25"], "coexisting since 2011"));
  assert.match(md, /Coexisting since 2011/, "the entry did not print the typed net");
  const archived = { ordinal: 9, mark: "OLD", owner: { name: "O", registrations: [] },
    legal_position: "an archived record predating the net" };
  assert.match(shortEntryBody(archived), /An archived record predating the net/,
    "a record with no `net` printed nothing — `legal_position` is the stated fallback, and a form that "
    + "re-authors the sentence pays a dispatch and saves nothing");
});

test("#1503 multi-country groups by TERRITORY, and a mark in three appears under all three", () => {
  const rows = [f(12, "ACME", "Acme Holdings", ["FR", "DE"]), f(19, "ACME2", "Someone Else", ["FR"]),
    f(23, "BOREAL", "Boreal SA", ["DE"])];
  const { groups } = groupEntries(rows);
  const byLabel = Object.fromEntries(groups.map((g) => [g.label, g.findings.map((x) => x.ordinal)]));
  assert.deepEqual(byLabel.FR?.sort(), [12, 19], "the FR group is wrong — a reader asking what is in their "
    + "way in France must see every mark registered there");
  assert.deepEqual(byLabel.DE?.sort(), [12, 23]);
});

test("#1503 a finding with NO jurisdiction is never put in an `unknown` group", () => {
  const rows = [f(12, "ACME", "Acme Holdings", ["FR"]), f(19, "ACME2", "Someone Else", ["FR"]),
    f(31, "VENTURI (venturi.io)", "Venturi Labs", [])];        // common-law: no registration, no jurisdiction
  const { groups, singles } = groupEntries(rows);
  for (const g of groups) {
    assert.doesNotMatch(String(g.label), /^unknown$/i, "a group headed `unknown` shipped — §8 rules it unacceptable");
    assert.ok(!g.findings.some((x) => x.ordinal === 31), "the jurisdiction-less finding was placed in a group");
  }
  assert.ok(singles.some((x) => x.ordinal === 31), "it must fall to a short entry instead");
  assert.deepEqual(territoriesOf(rows[2]), [], "the fixture stopped being jurisdiction-less");
});

test("#1503 minimum group size is TWO — a single-member group renders as a short entry", () => {
  const { groups, singles } = groupEntries([f(12, "ACME", "A", ["FR"]), f(23, "BOREAL", "B", ["DE"])]);
  assert.deepEqual(groups, [], "two territories with one mark each produced a group — §8 sets the minimum at two");
  assert.deepEqual(singles.map((x) => x.ordinal).sort(), [12, 23]);
});

test("#1503 WORLDWIDE groups by the right — one row, territories listed, not one row per country", () => {
  const rows = [...Array(18)].map((_, i) => f(100 + i, "ACME", "Acme Holdings", [`T${i}`]));
  const md = buildGradedEntriesSection(rows, { byRight: true });
  assert.match(md, /held in 18 territories/, "the worldwide read is one row naming the count, not 18 rows");
  assert.match(md, /18 registrations/,
    "a by-right group counted MARKS. It is one mark held 18 times; calling that 18 marks is the "
    + "fragmentation this grouping exists to avoid, restated as a number.");
  // and the same rows keyed per country fragment into nothing, which is why worldwide keys differently
  assert.deepEqual(groupEntries(rows).groups, [], "per-country grouping should fragment these to singles");
});

test("#1503 a by-right label unions EVERY member's territories, never just the first placed", () => {
  const rows = [f(12, "ACME", "Acme Holdings", ["FR"]), f(13, "ACME", "Acme Holdings", ["DE"]),
    f(14, "ACME", "Acme Holdings", ["ES"])];
  const [g] = groupEntries(rows, { byRight: true }).groups;
  assert.match(g.label, /held in DE, ES, FR/,
    `the label reads "${g.label}" — labelling from the first member placed names one territory and drops `
    + "the rest, which is the whole read this grouping gives");
});

test("#1503 ZERO IS NOT ABSENCE — an empty section says so rather than going silent", () => {
  assert.match(buildGradedEntriesSection([]), /^# Also on the register\n\nNone\./,
    "an empty grouping rendered nothing, so a reader cannot tell it from a grouping that never ran");
});

test("#1503 the member line is the grammar the reasoned-negatives section already ships", () => {
  assert.equal(memberLine(f(12, "ACME", "Acme Holdings", ["FR"], ["25"], "why it is here")),
    "- **#12 ACME** — Acme Holdings · class 25 · *why it is here*");
});
