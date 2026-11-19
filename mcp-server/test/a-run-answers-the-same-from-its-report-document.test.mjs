// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A RUN ANSWERS THE SAME FROM ITS REPORT DOCUMENT. Publishing writes the run's report as one document, and the
// connector's readers of the parsed audit.md, the report's cards and front matter, and a Knockout's findings record
// take them from it where the run has one. A run published before the document existed has none and is read from its
// files. Both must give the same answer, so each demo is published and asked twice: with its document, and with the
// document set aside.
//
// SAFETY GUARD: the workspace and the pool are pinned before anything is imported, because the driver config freezes
// its roots at import.
import { mkdtempSync as __mkdtemp } from "node:fs";
import { tmpdir as __tmpdir } from "node:os";
import { join as __join } from "node:path";
import { pinEnv } from "../../shared/env-aliases.mjs";
pinEnv(process.env, "CLEAROTRON_WORK_DIR", __mkdtemp(__join(__tmpdir(), "connector-document-ws-")));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", __mkdtemp(__join(__tmpdir(), "connector-document-pool-")));
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { publishSource, demoChildren } = await import("../../driver/demo-container.mjs");
const { republishRun } = await import("../../driver/publish/report-registry.mjs");
const { paths } = await import("../../driver/run-record.mjs");
const { loadFindings, loadCards } = await import("../lib/findings.mjs");
const { searchLog } = await import("../lib/evidence.mjs");
const { knockoutDoc } = await import("../lib/knockout.mjs");

const copy = publishSource(join(ROOT, "demo"), { repoRoot: ROOT });

/** Each reader's answer for one run: the parsed audit.md, the cards, the search log and a Knockout's findings record. */
const answers = (runDir) => {
  const P = paths(runDir);
  return JSON.stringify({ findings: loadFindings(P), cards: loadCards(P), searches: searchLog({ P, runDir }), knockout: knockoutDoc({ runDir }) });
};

test("each demo's connector readers answer the same from its document as from its files", async () => {
  const names = demoChildren(copy);
  assert.equal(names.length, 4);
  for (const name of names) {
    const meta = JSON.parse(readFileSync(join(copy, name, "meta.json"), "utf8"));
    const runDir = join(copy, name, "run");
    await republishRun({ runId: meta.runId, meta, pool: process.env.CLEAROTRON_REPORTS_DIR, poolUrl: "", runDir });
    const document = paths(runDir).reportDocument;
    assert.ok(existsSync(document), `${name}: premise, publishing wrote the document`);
    const fromDocument = answers(runDir);
    renameSync(document, `${document}.aside`);
    const fromFiles = answers(runDir);
    renameSync(`${document}.aside`, document);
    assert.ok(fromFiles.length > 500, `${name}: premise, the readers found the run`);
    assert.equal(fromDocument, fromFiles, `${name}: the connector answers differently from the document`);
  }
});
