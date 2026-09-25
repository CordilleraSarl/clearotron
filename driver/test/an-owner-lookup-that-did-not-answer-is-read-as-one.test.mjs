// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// AN OWNER LOOKUP THAT DID NOT ANSWER IS READ AS ONE.
//
// A knockout looks up what the owner of a promoted filing trades in, and hands the reading seat one line
// per owner: the answer's file where the lookup answered, and a line of its own where it did not. That
// line said "THE SEARCH RETURNED NOTHING", which reads as a search that ran and found nothing, and the
// seat wrote it into the read that way. It fires on a provider outage, an executor error, an empty
// answer, and on every owner when no research key is set: a lookup that did not answer, which is a
// different fact from one that found nothing. The line now says so.
//
// The report's source line for such a row is unchanged: it prints the lane's literal for a lookup with
// no answer, as ruled 2026-09-07. The marks and owners are invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runOwnerChecks, composeOwnerQuery, NO_RESULT } from "../owner-use-check.mjs";
import { ownerCheckLines } from "../stages-knockout.mjs";

const OWNERS = [
  { mark: "VELTRIS", owner: "Quarvintex AG", recordIds: ["/mark/eu/1"], classes: [9] },      // answers
  { mark: "VELTRIS", owner: "Zorbquell, Inc.", recordIds: ["/mark/eu/2"], classes: [9] },    // the service is down
  { mark: "VELTRIS", owner: "Brimholt Oy", recordIds: ["/mark/eu/3"], classes: [9] },        // an empty answer
];
const exec = async (query) => {
  const o = OWNERS.find((r) => composeOwnerQuery(r) === query);
  if (o === OWNERS[1]) return { ok: false, cause: "HTTP 503: the research service is down" };
  if (o === OWNERS[2]) return { ok: true, text: "" };
  return { ok: true, text: "Quarvintex AG sells industrial sensors. https://example.test/quarvintex" };
};

test("a lookup that did not answer is named as one to the reading seat, never as one that found nothing", async () => {
  const d = mkdtempSync(join(tmpdir(), "owner-unanswered-"));
  try {
    mkdirSync(join(d, "research"));
    mkdirSync(join(d, "_driver"));
    const rows = await runOwnerChecks({ owners: OWNERS, exec, runDir: d });
    assert.deepEqual(rows.map((r) => r.ok), [true, false, false], "guard: one answered, two did not");
    const K = { runDir: d, ownerChecks: join(d, "_driver", "owner-checks.json") };
    writeFileSync(K.ownerChecks, JSON.stringify({ schema: 1, checks: rows }));
    const lines = ownerCheckLines(K);
    assert.equal(lines.length, 3, "one line per owner, answered or not");
    assert.ok(lines[0].endsWith(join(d, "research", rows[0].payloadFile)), "the answered lookup points at its file");
    for (const i of [1, 2]) {
      assert.match(lines[i], /THE SEARCH DID NOT ANSWER\. Say so in the read; do not infer the trade from the name\./);
      assert.doesNotMatch(lines[i], /RETURNED NOTHING/, "a non-answer is not a search that found nothing");
    }
    // the report's source line for these rows is the ruled literal, unchanged
    assert.deepEqual(rows.slice(1).map((r) => r.source), [NO_RESULT, NO_RESULT]);
  } finally { rmSync(d, { recursive: true, force: true }); }
});
