// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// Run as `npx clearotron@beta install`, setup ended with
//
//     A different `clearotron` is earlier on your PATH (<npm's cache>/_npx/<id>/node_modules/.bin/clearotron), so
//     the commands above name this install's own at ~/.local/bin/clearotron rather than trusting the bare name.
//
// npx puts the bin folder of the copy it fetched first on the PATH of the process it starts, and the install
// moved out of the cache runs as that process's child with the same PATH. No shell the reader types in has
// that folder on its PATH, so the warning was false, and the commands above it named a full path where the
// bare `clearotron` worked. These tests hand `invocationForm` the PATH npm builds for its child, in npm's
// order: the fetched copy's bin folder, a `node_modules/.bin` for every folder above the one the reader
// stood in, npm's node-gyp-bin folder, then the reader's own PATH.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { invocationForm } from "../../shared/invocation.mjs";
import { installShim } from "../../shared/verb-shim.mjs";

const NO_SHIM_ON_WINDOWS = process.platform === "win32"
  && "the POSIX shim: installShim refuses Windows before writing anything, and npm's global layout is another shape there";

const NPX_BIN = "/srv/npm-cache/_npx/5f0c2a9e1d7b3c4a/node_modules/.bin";
const NPM_PREFIX = ["/srv/stood-here/node_modules/.bin", "/srv/node_modules/.bin", "/node_modules/.bin",
  "/usr/lib/node_modules/npm/node_modules/@npmcli/run-script/lib/node-gyp-bin"];
const fetched = join(NPX_BIN, "clearotron");

/** A home where setup has finished: the install moved under ~/.local, and its shim in ~/.local/bin. */
function finishedHome() {
  const home = mkdtempSync(join(tmpdir(), "npx-shadow-home-"));
  const installDir = join(home, ".local", "lib", "node_modules", "clearotron");
  const r = installShim({ env: { HOME: home }, installDir, nodePath: process.execPath });
  assert.equal(r.ok, true, `the fixture could not write a shim: ${r.reason} ${r.detail}`);
  return { home, installDir, dir: r.dir };
}

test("the copy npx fetched is not a clearotron earlier on the reader's PATH", { skip: NO_SHIM_ON_WINDOWS }, () => {
  const { home, installDir, dir } = finishedHome();
  const env = { HOME: home, PATH: [NPX_BIN, ...NPM_PREFIX, dir, "/usr/bin"].join(delimiter) };
  const form = invocationForm(env, { exists: (p) => p === fetched }, installDir);
  assert.equal(form.shadowedBy, null, `npx's own folder was reported as shadowing the shim: ${form.shadowedBy}`);
  assert.equal(form.form, "bare", "the reader's shell finds this install's shim first, so the bare name is the command");
  assert.equal(form.prefix, "");
});

test("a clearotron the reader's own PATH finds first is still reported, under npx", { skip: NO_SHIM_ON_WINDOWS }, () => {
  const { home, installDir, dir } = finishedHome();
  const other = join("/opt/other-tool/bin", "clearotron");
  const env = { HOME: home, PATH: [NPX_BIN, ...NPM_PREFIX, "/opt/other-tool/bin", dir, "/usr/bin"].join(delimiter) };
  const form = invocationForm(env, { exists: (p) => p === fetched || p === other }, installDir);
  assert.equal(form.form, "shim-path");
  assert.equal(form.shadowedBy, other, "a real clearotron ahead of the shim must still demote the bare name");
});

test("npm's global executable is not shadowed by the copy npx fetched either", { skip: NO_SHIM_ON_WINDOWS }, () => {
  // The install's other route to the bare name: npm's own executable at <prefix>/bin, with no shim written.
  const prefix = mkdtempSync(join(tmpdir(), "npx-shadow-prefix-"));
  const installDir = join(prefix, "lib", "node_modules", "clearotron");
  const exe = join(prefix, "bin", "clearotron");
  const env = { HOME: mkdtempSync(join(tmpdir(), "npx-shadow-empty-home-")),
    PATH: [NPX_BIN, ...NPM_PREFIX, join(prefix, "bin"), "/usr/bin"].join(delimiter) };
  const form = invocationForm(env, { exists: (p) => p === fetched || p === exe }, installDir);
  assert.equal(form.via, "global");
  assert.equal(form.shadowedBy, null, `npx's own folder was reported as shadowing npm's executable: ${form.shadowedBy}`);
  assert.equal(form.form, "bare");
});
