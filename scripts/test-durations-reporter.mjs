// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// test-durations-reporter.mjs — a `node --test` reporter that writes how long each test FILE took, one JSON line per
// file: `{"file":"driver/test/x.test.mjs","ms":1234}`, the path relative to the repository root.
//
// WHY A REPORTER. `node --test` runs a shard's files in parallel and its TAP names no file, so a file's cost cannot be
// read back from the suite's log. Every top-level test it reports does carry its file, so this sums their durations per
// file. That leaves out the time a file spends importing before its first test, the same few hundred milliseconds for
// most files, so the sums rank files as a shard pays for them. `scripts/test-run.mjs` adds it when `CT_DURATIONS_DIR` is
// set, beside the TAP stream, and CI keeps what it writes with each shard's log.
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export default async function* durations(source) {
  const perFile = new Map();
  for await (const { type, data } of source) {
    if ((type !== "test:pass" && type !== "test:fail") || data?.nesting !== 0 || !data.file) continue;
    const file = relative(ROOT, data.file).split(sep).join("/");
    perFile.set(file, (perFile.get(file) ?? 0) + (data.details?.duration_ms ?? 0));
  }
  for (const [file, ms] of perFile) yield `${JSON.stringify({ file, ms: Math.round(ms) })}\n`;
}
