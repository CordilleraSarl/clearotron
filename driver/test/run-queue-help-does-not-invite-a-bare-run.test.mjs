// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// `clearotron run-queue --help` told its reader to run it with no arguments, and a bare `run-queue` drains the queue:
// real register calls and hours of model time. The owner ruled the sentence dropped for `run-queue` with nothing in its
// place. The verbs that share the dispatcher's help keep it word for word; `run` keeps it because its bare form prints a
// usage line. Driven through the dispatcher in a temporary home; `--help` returns before anything is started.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const INVITE = "Run it with no arguments to see what it requires.";

function help(verb) {
  const home = mkdtempSync(join(tmpdir(), "help-"));
  try {
    const r = spawnSync(process.execPath, [join(ROOT, "bin", "clearotron.mjs"), verb, "--help"],
      { cwd: home, encoding: "utf8", env: { ...process.env, HOME: home }, timeout: 30_000 });
    assert.equal(r.status, 0, `${verb} --help exited ${r.status}: ${r.stderr}`);
    return r.stdout;
  } finally { rmSync(home, { recursive: true, force: true }); }
}

test("run-queue's help no longer invites a bare run, and still says it spends", () => {
  const out = help("run-queue");
  assert.ok(!out.includes(INVITE), `run-queue --help still invites a bare run:\n${out}`);
  assert.match(out, /which has no --help of\n  its own\.\n/, "the pass-through line no longer ends at \"its own.\"");
  assert.match(out, /THIS SPENDS: hours of model time and real register calls\./);
});

test("the verbs that share the dispatcher's help keep it word for word, run's spend line included", () => {
  for (const verb of ["run", "cancel", "brandowner", "framework", "project", "mcp"]) {
    const out = help(verb);
    assert.ok(out.includes(`its own. ${INVITE}`), `${verb} --help lost its line:\n${out}`);
  }
  assert.match(help("run"), /THIS SPENDS: hours of model time and real register calls\./);
});
