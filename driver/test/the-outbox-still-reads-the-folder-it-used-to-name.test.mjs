// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// The delivery outbox was renamed with the `clearance` identifier. A deployment that never pinned
// CLEAROTRON_OUTBOX_DIR has `<runId>.pending` markers sitting under the OLD name, and each marker is a
// report a client is owed: an outbox nobody reads is indistinguishable from an empty one, and the run
// that wrote the marker has already recorded the report as delivered-pending. So the writer uses the new
// name and the reader takes both.
//
// THE DEFECT THIS FILE EXISTS FOR. `legacyOutboxDir` holds the old spelling — that is its entire job —
// and the follow-up that renamed the directory's 85 occurrences rewrote that literal along with them.
// Both accessors then answered the SAME path, so the drain read the new directory twice and the old one
// never, while every marker it could see was listed twice.
//
// NOTHING CAUGHT IT, and the reason is worth stating: every existing outbox test pins
// CLEAROTRON_OUTBOX_DIR, which makes `legacyOutboxDir` null by design. The compatibility path had no
// arm at all. This file drives the UNPINNED case, which is the only case the accessor is for.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";

const ROOT = mkdtempSync(join(tmpdir(), "outbox-legacy-"));
process.env.CLEAROTRON_WORK_DIR = join(ROOT, "workspace");
delete process.env.CLEAROTRON_OUTBOX_DIR;

const { config } = await import("../driver.config.mjs");
const { markersForAgent } = await import("../outbox-backoff.mjs");

test("the accessor that reads the old outbox names the OLD directory", () => {
  assert.equal(basename(config.outboxDir), "clearance-outbox", "the writer's directory is the new name");
  assert.equal(basename(config.legacyOutboxDir), "prelim-outbox", "and the reader's fallback is the old one");
  assert.notEqual(config.outboxDir, config.legacyOutboxDir,
    "two accessors answering one path is the whole defect: the old directory is then never read");
});

test("a marker left in the old directory is still found, and neither is listed twice", () => {
  mkdirSync(config.outboxDir, { recursive: true });
  mkdirSync(config.legacyOutboxDir, { recursive: true });
  writeFileSync(join(config.outboxDir, "new-run.pending"), JSON.stringify({ agent: "alpha", kind: "delivered" }));
  writeFileSync(join(config.legacyOutboxDir, "old-run.pending"), JSON.stringify({ agent: "alpha", kind: "delivered" }));

  const found = markersForAgent("alpha");
  assert.deepEqual(found.map((m) => m.file).sort(), ["new-run.pending", "old-run.pending"],
    "the report waiting under the old name is still owed, and still found");
  assert.equal(new Set(found.map((m) => m.path)).size, found.length, "no marker is handed out twice");
  assert.equal(markersForAgent("beta").length, 0, "another agent's outbox is not this agent's work");
});

test("the same filename in both directories is two markers, not one — a dedupe would hide one", () => {
  // Two real directories can hold the same name; only the PATH tells them apart, and an ack removes the
  // file that actually exists. This is why the drain guards on the directory rather than deduping files.
  writeFileSync(join(config.outboxDir, "same.pending"), JSON.stringify({ agent: "gamma", kind: "delivered" }));
  writeFileSync(join(config.legacyOutboxDir, "same.pending"), JSON.stringify({ agent: "gamma", kind: "delivered" }));
  const found = markersForAgent("gamma");
  assert.equal(found.length, 2);
  assert.equal(new Set(found.map((m) => m.path)).size, 2, "each is addressed by the path it was found at");
});

test("an operator who named the directory has no old default in play", () => {
  process.env.CLEAROTRON_OUTBOX_DIR = join(ROOT, "pinned");
  try {
    assert.equal(config.legacyOutboxDir, null, "null when the variable IS set — the classification this getter carries");
  } finally {
    delete process.env.CLEAROTRON_OUTBOX_DIR;
  }
});
