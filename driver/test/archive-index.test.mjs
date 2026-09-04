// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// archive-index.test.mjs — curated visibility on the staff index: regenIndex reads <pool>/archive-tags.json
// and splits runs into the visible table (top) vs a count-only collapsible "Archive" fold (bottom). Absent
// tags ⇒ flat table (unchanged behaviour). The archived run's NAME must not leak above the <details>.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { regenIndex } from "../publish/index.mjs";

function meta(o) {
  return { matter: "TMP", title: "DEMO", client: "Acme", overall: "MEDIUM", badge: "l3", customerKey: "acme", ...o };
}
function poolWith(metas) {
  const pool = mkdtempSync(join(tmpdir(), "arch-idx-"));
  for (const m of metas) {
    const run = join(pool, m.runId); mkdirSync(run);
    writeFileSync(join(run, "meta.json"), JSON.stringify(m));
  }
  return pool;
}
const A = meta({ runId: "tmp1-a-2026-06-15-ashen-bastion", date: "2026-06-15", codename: "ashen-bastion", title: "AURA" });
const B = meta({ runId: "tmp2-b-2026-06-14-teal-vault", date: "2026-06-14", codename: "teal-vault", title: "MYRKOS" });
const C = meta({ runId: "tmp3-c-2026-06-08-teal-spire", date: "2026-06-08", codename: "teal-spire", title: "NOVAPULSE" });

test("no archive-tags.json ⇒ all runs in the flat table, no Archive fold", () => {
  const pool = poolWith([A, B, C]);
  regenIndex(pool);
  const idx = readFileSync(join(pool, "index.html"), "utf8");
  assert.doesNotMatch(idx, /class="archive-roll"/);
  for (const m of [A, B, C]) assert.match(idx, new RegExp(m.codename));
  assert.match(idx, /3 report\(s\) · access-controlled/);
});

test("D: regenIndex writes the shared chrome stylesheet at <pool>/assets/chrome.css (what the internal reports <link>)", () => {
  const pool = poolWith([A]);
  regenIndex(pool);
  const chrome = join(pool, "assets", "chrome.css");
  assert.ok(existsSync(chrome), "assets/chrome.css is written on regen");
  const css = readFileSync(chrome, "utf8");
  assert.match(css, /\.sitenav\{[^}]*position:sticky/, "carries the nav CSS");
  assert.match(css, /\.fab-stack\{[^}]*position:fixed/, "carries the floating-fab CSS");
  assert.match(css, /\.theme-toggle\{/, "carries the toggle CSS");
});

test("tagged runs collapse into a count-only Archive fold; names hidden until expanded", () => {
  const pool = poolWith([A, B, C]);
  writeFileSync(join(pool, "archive-tags.json"), JSON.stringify({ archived: [C.runId, B.runId] }));
  regenIndex(pool);
  const idx = readFileSync(join(pool, "index.html"), "utf8");

  // the fold exists with the right count
  assert.match(idx, /class="archive-roll"/);
  assert.match(idx, /<span class="arch-h">Older \/ retired runs<\/span><span class="arch-n">2 run\(s\)<\/span>/);
  // header line reflects the split
  assert.match(idx, /1 shown · 2 retired · 3 report\(s\) total/);

  // split the document at the <details> — archived codenames must NOT appear before it (only behind the fold)
  const head = idx.slice(0, idx.indexOf('<details class="archive-roll"'));
  assert.match(head, /ashen-bastion/, "the visible run leads the table");
  assert.doesNotMatch(head, /teal-vault/, "archived name must not leak above the fold");
  assert.doesNotMatch(head, /teal-spire/, "archived name must not leak above the fold");
  // but they ARE present (inside the fold)
  assert.match(idx, /teal-vault/);
  assert.match(idx, /teal-spire/);
});

test("one report: no version pills anywhere; staff nav links each client view; customer index links report.html with no staff chrome", () => {
  const pool = poolWith([A, B, meta({ runId: "tmp4-d-2026-06-07-x", date: "2026-06-07", codename: "x", customerKey: "aurora" })]);
  regenIndex(pool);
  const staff = readFileSync(join(pool, "index.html"), "utf8");
  // ONE report (spec 2026-07-30 §5): the "Review & iteration / Clean final" version pills — the split
  // printed on the page — are retired on BOTH indexes.
  assert.doesNotMatch(staff, /vbadge/);
  assert.doesNotMatch(staff, /Review &amp; iteration version/);
  // the floating site nav: Clearance reports active + each client view linked
  assert.match(staff, /<nav class="sitenav">/);
  assert.match(staff, /<a href="index.html" class="active">Clearance reports<\/a>/);
  assert.match(staff, /class="cli"[^>]*href="customer\/acme\/"/);        // demo-anon adds data-anon-href before href
  assert.match(staff, /class="cli"[^>]*href="customer\/aurora\/"/);

  // customer index — no pill, NO staff nav, and it links THE report (report.html, the one document)
  const acme = readFileSync(join(pool, "customer", "acme", "index.html"), "utf8");
  assert.doesNotMatch(acme, /vbadge/);
  assert.doesNotMatch(acme, /client-facing|client-safe/, "no split language on the page");
  assert.doesNotMatch(acme, /<nav class="sitenav">/);
  assert.match(acme, /href="\.\.\/\.\.\/tmp1-a-2026-06-15-ashen-bastion\/report\.html"/, "the customer index links report.html");
  assert.doesNotMatch(acme, /report\.client\.html/, "the retired client export is never linked");
});

test("#265: no Quality or Feedback nav entry, even with the retired pages left on disk", () => {
  const pool = poolWith([A]);
  regenIndex(pool);
  let staff = readFileSync(join(pool, "index.html"), "utf8");
  assert.doesNotMatch(staff, /href="quality\.html"/);
  assert.doesNotMatch(staff, /href="triage\.html"/);
  assert.doesNotMatch(staff, /Engine quality|open Quality/, "the index quality strip went with the hub");
  // A pre- deploy leaves both pages in the pool. Existence must NOT resurrect a link to either.
  writeFileSync(join(pool, "quality.html"), "<html></html>");
  writeFileSync(join(pool, "triage.html"), "<html></html>");
  regenIndex(pool);
  staff = readFileSync(join(pool, "index.html"), "utf8");
  assert.doesNotMatch(staff, /href="quality\.html"/, "a stale page on disk must not resurrect the nav entry");
  assert.doesNotMatch(staff, /href="triage\.html"/);
});

test("garbled archive-tags.json degrades to all-visible (no throw)", () => {
  const pool = poolWith([A, B]);
  writeFileSync(join(pool, "archive-tags.json"), "{ not json");
  regenIndex(pool);
  const idx = readFileSync(join(pool, "index.html"), "utf8");
  assert.doesNotMatch(idx, /class="archive-roll"/);
  assert.match(idx, /ashen-bastion/);
  assert.match(idx, /teal-vault/);
});

test("client filter: a dropdown per distinct client + every row tagged data-client; single-client pools omit it", () => {
  const A2 = meta({ runId: "t-au-2026-06-15-a", date: "2026-06-15", codename: "a", customerKey: "aurora", client: "Aurora Interactive" });
  const B2 = meta({ runId: "t-zep-2026-06-14-b", date: "2026-06-14", codename: "b", customerKey: "zephyr", client: "Zephyr Beverages" });
  const idx = (() => { const p = poolWith([A2, B2]); regenIndex(p); return readFileSync(join(p, "index.html"), "utf8"); })();
  assert.match(idx, /id="clientFilter"/);                          // the filter control renders
  assert.match(idx, /<option value="aurora"[^>]*>Aurora Interactive<\/option>/);
  assert.match(idx, /<option value="zephyr"[^>]*>Zephyr Beverages<\/option>/);
  assert.match(idx, /<option value="aurora" data-anon="client" data-anon-key="aurora">/);  // demo overlay aliases the label
  assert.ok(idx.indexOf('value="aurora"') < idx.indexOf('value="zephyr"'), "options sorted by label");
  assert.match(idx, /<tr data-client="aurora">/);                  // rows carry the client key for filtering
  assert.match(idx, /querySelectorAll\("tr\[data-client\]"\)/);    // the inline filter script is present

  // one client ⇒ nothing to filter ⇒ no control (but the pager + script still ship — see the pager test)
  const single = (() => { const p = poolWith([A]); regenIndex(p); return readFileSync(join(p, "index.html"), "utf8"); })();
  assert.doesNotMatch(single, /id="clientFilter"/);
});

test("pager: emitted unconditionally (staff, single-client, customer index); one combined filter+page script; fcount is gone", () => {
  const A2 = meta({ runId: "t-au-2026-06-15-a", date: "2026-06-15", codename: "a", customerKey: "aurora", client: "Aurora Interactive" });
  const B2 = meta({ runId: "t-zep-2026-06-14-b", date: "2026-06-14", codename: "b", customerKey: "zephyr", client: "Zephyr Beverages" });
  const pool = poolWith([A2, B2]);
  regenIndex(pool);
  const idx = readFileSync(join(pool, "index.html"), "utf8");
  // pager chrome ships hidden (no-JS degrades to the flat table), 20/page, reset-to-page-1 on filter change,
  // fold rows partitioned out of the page window, and the merged single counter replaces fcount
  assert.match(idx, /id="pager" hidden/);
  assert.match(idx, /id="pgPrev"/); assert.match(idx, /id="pgNext"/); assert.match(idx, /id="pcount"/);
  assert.match(idx, /var PER=20/);
  assert.match(idx, /page=1;apply\(\)/);
  assert.match(idx, /closest\("details\.archive-roll"\)/);
  assert.doesNotMatch(idx, /id="fcount"/);

  // single-client pool: no filter control, but the pager + script still present
  const single = (() => { const p = poolWith([A]); regenIndex(p); return readFileSync(join(p, "index.html"), "utf8"); })();
  assert.match(single, /id="pager" hidden/);
  assert.match(single, /querySelectorAll\("tr\[data-client\]"\)/);

  // customer index: pager yes (customer/generic holds >20 runs live), staff filter never
  const au = readFileSync(join(pool, "customer", "aurora", "index.html"), "utf8");
  assert.match(au, /id="pager" hidden/);
  assert.doesNotMatch(au, /id="clientFilter"/);
});

test("report search: a hidden search box + query-aware pager on staff AND per-customer indexes (scales to many reports)", () => {
  const A2 = meta({ runId: "t-au-2026-06-15-a", date: "2026-06-15", codename: "a", customerKey: "aurora", client: "Aurora Interactive" });
  const pool = poolWith([A2]);
  regenIndex(pool);
  const staff = readFileSync(join(pool, "index.html"), "utf8");
  const cust = readFileSync(join(pool, "customer", "aurora", "index.html"), "utf8");
  for (const html of [staff, cust]) {
    assert.match(html, /id="repSearchBar" hidden/);                            // ships hidden ⇒ no-JS shows the full table
    assert.match(html, /<input id="repSearch" type="search"/);                 // the search control
    assert.match(html, /indexOf\(query\)/);                                    // pager script filters rows by the query
    assert.match(html, /querySelectorAll\("tr\[data-client\]"\)\.length>8/);   // revealed only when there are enough rows
  }
});

test("meta without customerKey → data-client=\"generic\" on the STAFF index, but NO client-facing page (leak-#9)", () => {
  const legacy = meta({ runId: "tmp9-l-2026-06-01-old-run", date: "2026-06-01", codename: "old-run", customerKey: undefined });
  const pool = poolWith([legacy, A]);   // JSON.stringify drops the undefined customerKey
  regenIndex(pool);
  const idx = readFileSync(join(pool, "index.html"), "utf8");
  assert.match(idx, /<tr data-client="generic">/);        // staff index still lists it (staff surface, all runs)
  assert.doesNotMatch(idx, /<tr data-client="">/);
  // LEAK-#9 fail-closed: the shared client-facing customer/generic/index.html (co-mixing) is no longer written,
  // and the nav's Clients dropdown does not link a now-absent generic page.
  assert.equal(existsSync(join(pool, "customer", "generic", "index.html")), false, "no client-facing generic page");
  assert.doesNotMatch(idx, /href="customer\/generic\//);
});

test("same-day runs order by issuedAt (newest first), beating the matter tiebreaker; the Run column shows the Zurich time", () => {
  // AAA would win the alphabetical tiebreak — issuedAt must beat it
  const early = meta({ runId: "t-e-2026-06-15-early-bird", date: "2026-06-15", codename: "early-bird", matter: "AAA", issuedAt: "2026-06-15T08:00:00.000Z" });
  const late = meta({ runId: "t-l-2026-06-15-late-owl", date: "2026-06-15", codename: "late-owl", matter: "TMPZ", issuedAt: "2026-06-15T14:32:00.000Z" });
  const older = meta({ runId: "t-o-2026-06-14-old-day", date: "2026-06-14", codename: "old-day", matter: "AAB" });
  const pool = poolWith([early, late, older]);
  regenIndex(pool);
  const idx = readFileSync(join(pool, "index.html"), "utf8");
  assert.ok(idx.indexOf("late-owl") < idx.indexOf("early-bird"), "newest same-day run leads regardless of matter");
  assert.ok(idx.indexOf("early-bird") < idx.indexOf("old-day"), "date stays the primary key");
  // 14:32Z on 2026-06-15 is 16:32 CEST — shown in the staff Run column next to the date
  assert.match(idx, /2026-06-15 · 16:32 · <code>late-owl<\/code>/);
  // a run whose issuedAt falls on a DIFFERENT Zurich date than meta.date suppresses the misleading time
  const drift = meta({ runId: "t-d-2026-06-13-drift-run", date: "2026-06-13", codename: "drift-run", issuedAt: "2026-06-14T10:00:00.000Z" });
  const pool2 = poolWith([drift]);
  regenIndex(pool2);
  const idx2 = readFileSync(join(pool2, "index.html"), "utf8");
  assert.match(idx2, /2026-06-13 · <code>drift-run<\/code>/);
});

test("theme gating: staff index full (auto-dark @media + init + nav toggle); customer index explicit-light (init + toggle, NO @media)", () => {
  const au = meta({ runId: "t-au-2026-06-15-a", date: "2026-06-15", codename: "a", customerKey: "aurora", client: "Aurora Interactive" });
  const pool = poolWith([au]);
  regenIndex(pool);

  // STAFF: dark block with the OS auto-dark branch, the pre-paint init in <head>, the toggle via the nav
  const staff = readFileSync(join(pool, "index.html"), "utf8");
  assert.match(staff, /prefers-color-scheme/, "staff index auto-darks for first-time OS-dark visitors");
  assert.match(staff, /:root\[data-theme="dark"\]/);
  assert.match(staff, /localStorage\.getItem\('cordillera-theme'\)/, "pre-paint theme init present");
  assert.ok(staff.indexOf("cordillera-theme") < staff.indexOf("</head>"), "init lives in <head> (before first paint)");
  assert.match(staff, /class="theme-toggle"/);

  // CUSTOMER: toggle + explicit choice ONLY — dark block present but NO @media auto-dark anywhere
  const cust = readFileSync(join(pool, "customer", "aurora", "index.html"), "utf8");
  assert.doesNotMatch(cust, /prefers-color-scheme/, "client page must never auto-dark (explicit-light decision)");
  assert.match(cust, /:root\[data-theme="dark"\]/, "explicit dark block so the toggle works");
  assert.match(cust, /localStorage\.getItem\('cordillera-theme'\)/);
  assert.ok(cust.indexOf("cordillera-theme") < cust.indexOf("</head>"), "init lives in <head>");
  assert.match(cust, /class="theme-toggle"/, "standalone toggle (the client index has no nav)");
  assert.doesNotMatch(cust, /<nav class="sitenav">/);
  assert.doesNotMatch(cust, /#3b4fd6|#11132a|#f5f6f9|#1a1a2e/i, "no blue-skin hex sneaks in via the dark block");
});

test("staff nav Clients dropdown speaks the display label (the runs' client string), not the raw key", () => {
  const au = meta({ runId: "t-au-2026-06-15-a", date: "2026-06-15", codename: "a", customerKey: "aurora", client: "Aurora Interactive" });
  const pool = poolWith([au]);
  regenIndex(pool);
  const staff = readFileSync(join(pool, "index.html"), "utf8");
  assert.match(staff, /href="customer\/aurora\/"><span data-anon="client"[^>]*>Aurora Interactive<\/span><\/a>/);
});

test("customer index Run cell is date-only — no internal codename, no time", () => {
  const withTime = meta({ runId: "t-au-2026-06-15-secret-name", date: "2026-06-15", codename: "secret-name", customerKey: "aurora", client: "Aurora Interactive", issuedAt: "2026-06-15T14:32:00.000Z" });
  const pool = poolWith([withTime]);
  regenIndex(pool);
  const au = readFileSync(join(pool, "customer", "aurora", "index.html"), "utf8");
  assert.match(au, /<td>2026-06-15<\/td>/);
  assert.doesNotMatch(au, /<code>secret-name<\/code>/, "run codenames are internal — never on a client-facing cell");
  assert.doesNotMatch(au, /16:32/);
  // the staff index keeps codename + time
  const staff = readFileSync(join(pool, "index.html"), "utf8");
  assert.match(staff, /<code>secret-name<\/code>/);
});

// ---- spec 64: the index row carries the stance clause beside the (labelled) band pill -------------
test("spec 64: a meta.json with `statement` renders the stance clause; legacy metas render byte-identically", () => {
  const withStmt = meta({ runId: "tmp9-s-2026-07-11-copper-causeway", date: "2026-07-11", codename: "copper-causeway", title: "LUMENGARDE",
    overall: "High", badge: "l4", statement: "High — conditional on: Obtain consent before filing." });
  const pool = poolWith([withStmt, A]);
  regenIndex(pool);
  const idx = readFileSync(join(pool, "index.html"), "utf8");
  assert.match(idx, /<span class="stmt" title="High — conditional on: Obtain consent before filing\.">conditional on: Obtain consent before filing\.<\/span>/,
    "the clause after the tier word renders beside the pill (full statement in title=)");
  // the legacy row (A) keeps the bare pill cell with no stmt span
  const rowA = idx.split("\n").filter((l) => l.includes("ashen-bastion") || l.includes("b-l3")).join("\n");
  assert.doesNotMatch(rowA, /class="stmt"/);
});
