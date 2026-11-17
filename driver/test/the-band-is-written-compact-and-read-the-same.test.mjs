// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE BAND IS WRITTEN COMPACT, AND READ THE SAME.
//
// The merged band is written without indentation: indented, it was an eighth whitespace, and a band-reading stage's
// time limit is derived from its size. Every reader parses it but one, the form-gap check, which also searches the
// band's text for each near-form term. This pins both: the file parses to the same band, and the form-gap check
// answers the same from either layout, for terms dispatched, terms not, a wildcard family, and a multi-word form.
// Invented records only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { namedBandText, mechanicalFormGapDirectives } from "../pipeline.mjs";
import { paths } from "../run-record.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";

const band = {
  enumerated: [
    { record_id: "/mark/us/90000001", mark_text: "VELMORA", classes: [30], _qid: "primary-sweep:exact:velmora",
      _query: "exact name:`VELMORA`(VELLMORA,VELMORRA) [cl 30]", _qids: ["primary-sweep:exact:velmora"], _queries: [],
      raw: { classifications: [{ nice_class: 30, goods_services_text: "Coffee; tea.", goods_services_text_truncated: false }] } },
    { record_id: "/mark/eu/222", mark_text: "VELMORA QUEST", classes: [30, 43], _qid: "primary-sweep:wild:velm",
      _query: "wildcard `V?LM*R?` [cl 30]", _qids: ["primary-sweep:wild:velm"], _queries: [] },
  ],
  crowds: [{ qid: "primary-sweep:contains:vel", query: "contains name:`VELMOR` [cl 30]", total_hits: 900, fetched: 25,
    sample: [{ record_id: "/mark/us/3", mark_text: "VELMORE", raw: { office_code: "US" } }], reason: "crowd" }],
};

const forms = { elements: [
  { element: "VELMORA", band: { exactQueries: ["VELLMORA", "VELMORRA", "VELMOORA", "VEIMORA", "VELMORA QUEST"], wildcardPatterns: ["V?LM*R?"] } },
  { element: "TESSARIN", band: { exactQueries: ["TESARIN", "TESSARYN"], wildcardPatterns: ["T?SS?R?N"] } },
] };

function runWith(text) {
  const runDir = mkdtempSync(join(tmpdir(), "band-layout-"));
  mkdirSync(driverDir(runDir), { recursive: true });
  const P = paths(runDir);
  writeFileSync(P.registerNamedBand, text);
  writeFileSync(P.formNeighbourhood, JSON.stringify(forms, null, 2));
  try { return mechanicalFormGapDirectives({ paths: P, registerPlan: { entries: [] } }); }
  finally { rmSync(runDir, { recursive: true, force: true }); }
}

test("the band is written without indentation and parses to the same band", () => {
  const text = namedBandText(band);
  assert.ok(text.endsWith("\n"));
  assert.ok(!/\n\s/.test(text), "no line of indentation");
  assert.deepEqual(JSON.parse(text), band);
  assert.ok(Buffer.byteLength(text) < Buffer.byteLength(JSON.stringify(band, null, 2) + "\n"));
});

test("the form-gap check answers the same from the compact and the indented band", () => {
  const compact = runWith(namedBandText(band));
  const indented = runWith(JSON.stringify(band, null, 2) + "\n");
  assert.deepEqual(compact, indented);
  // The case is not empty: some forms were found in the band, and the rest are directives in both layouts.
  const items = compact.map((d) => d.item);
  assert.ok(items.length > 0, "some near-forms were never dispatched");
  for (const found of ["VELLMORA", "VELMORRA", "VELMORA QUEST"]) assert.ok(!items.includes(found), `${found} is in the band in either layout`);
  assert.ok(items.includes("VELMOORA"), "an undispatched form is a directive in either layout");
});
