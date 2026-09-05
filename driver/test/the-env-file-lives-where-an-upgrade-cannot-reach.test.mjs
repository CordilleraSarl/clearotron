// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// tracker issue 159, ruled on tracker issue 140 — `.env` moves to `~/.config/clearotron/`.
//
// WHAT THE MOVE FIXES, AND WHAT IT WOULD BREAK IF ONLY HALF OF IT LANDED. The wizard used to write the
// operator's configuration — credentials included — into the package root, which on a global install is
// a directory npm owns, so `npm install -g clearotron` replaced the tree and deleted it. Measured on the
// published artifact: ten variables gone, every command still exiting 0.
//
// The flip alone would do the same thing from the other side. An install configured before the move has
// its file at the old path; a resolver that names only the new one finds nothing, applies nothing, and
// the engine runs as if the operator had never configured it — silent, and indistinguishable from a
// fresh machine. So the old location is READ while nothing writes to it, and the operator is told once.
//
// Every arm here drives `loadEnvLocal` against a real temporary tree. None reads the source.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { ENV_LOCAL_LOCATION, LEGACY_ENV_LOCAL_LOCATION, envLocalPath, loadEnvLocal } from "../../shared/env-local.mjs";

/** A tree with a package root and a home, and neither file in it yet. */
function box() {
  const root = mkdtempSync(join(tmpdir(), "env-local-"));
  const repoRoot = join(root, "node_modules", "clearotron");
  const home = join(root, "home");
  mkdirSync(repoRoot, { recursive: true });
  mkdirSync(home, { recursive: true });
  return { root, repoRoot, home };
}
const write = (p, text) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); };

// EVERY DRIVE BELOW PASSES `home`. Without it the loader resolves under the home directory of whoever
// is running the suite, so an arm about the file in force would be reading the developer's own
// `~/.config/clearotron/.env` — green or red by the box rather than by the code. The first draft of
// this file did exactly that, and two of its arms passed for that reason.

test("159 the file in force is the one an upgrade cannot reach", () => {
  assert.equal(ENV_LOCAL_LOCATION, "xdg-config",
    "the ruling on tracker issue 140 put .env under ~/.config/clearotron/");
  const { repoRoot, home } = box();
  const p = envLocalPath({ repoRoot, home });
  assert.equal(p, join(home, ".config", "clearotron", ".env"));
  // And it is NOT under the package root, which is the whole point: that directory belongs to npm.
  assert.ok(!p.startsWith(repoRoot), "the resolved path is still inside the tree npm replaces");
});

test("159 an install configured before the move keeps working, and is told where to put the file", () => {
  const { repoRoot, home } = box();
  write(envLocalPath({ repoRoot, home, location: LEGACY_ENV_LOCAL_LOCATION }), "PERPLEXITY_API_KEY=from-the-old-place\n");
  const notes = [];
  const env = {};
  const res = loadEnvLocal({ env, repoRoot, home, note: (l) => notes.push(l), location: ENV_LOCAL_LOCATION });

  assert.equal(res.reason, "read", "the configuration at the old path was not read at all");
  assert.deepEqual(res.applied, ["PERPLEXITY_API_KEY"]);
  assert.equal(env.PERPLEXITY_API_KEY, "from-the-old-place");

  const said = notes.join("");
  assert.match(said, /used to live/, "nothing told the operator their file is in the old place");
  assert.ok(said.includes(join(home, ".config", "clearotron", ".env")) || said.includes(".config"),
    "the note does not name where to move it to");
  // The note names a SECRET's file, never its contents. This loader is where the credentials are.
  assert.ok(!said.includes("from-the-old-place"), "a value from .env reached a log line");
});

test("159 once the file is in its new home the old one is left alone", () => {
  const { repoRoot, home } = box();
  write(envLocalPath({ repoRoot, home, location: LEGACY_ENV_LOCAL_LOCATION }), "SERPAPI_API_KEY=stale\n");
  write(envLocalPath({ repoRoot, home }), "SERPAPI_API_KEY=current\n");
  const notes = [];
  const env = {};
  const res = loadEnvLocal({ env, repoRoot, home, note: (l) => notes.push(l), location: ENV_LOCAL_LOCATION });

  assert.equal(env.SERPAPI_API_KEY, "current", "the old file won over the one in force");
  assert.equal(res.path, envLocalPath({ repoRoot, home }));
  assert.ok(!notes.join("").includes("used to live"),
    "the move note fired on an install that has already moved — it would never stop");
});

test("159 a machine with neither file is an absence, not a migration", () => {
  const { repoRoot, home } = box();
  const notes = [];
  const res = loadEnvLocal({ env: {}, repoRoot, home, note: (l) => notes.push(l), location: ENV_LOCAL_LOCATION });
  assert.equal(res.reason, "absent");
  assert.deepEqual(notes, [], "a fresh machine was told something about a file nobody has");
});
