// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE PLUGIN FOLDER IS WHAT CLAUDE'S PLUGIN DIRECTORY INSTALLS, AND IT STANDS ON ITS OWN.
//
// The whole repository was the plugin: thousands of files, a lockfile, and a server that started from a
// clone with its dependencies installed. The directory installs one folder and nothing else, so the
// plugin is now `plugin/`. These arms hold it to what the directory's checks block on, and to the rules
// it ships under: it starts the server from npm at one exact stable version, its manifest says that
// version, it reads no credential from anyone's environment, and its copies are the tree's own files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { pluginCopies, PLUGIN_DIR, CONNECTOR_SKILLS } from "../../scripts/mint-plugin-folder.mjs";

const ROOT = join(import.meta.dirname, "..", "..");
const DIR = join(ROOT, PLUGIN_DIR);
const walk = (d) => readdirSync(d).flatMap((n) => {
  const p = join(d, n);
  return lstatSync(p).isDirectory() ? walk(p) : [p];
});
const files = walk(DIR);

test("the folder carries nothing the directory blocks or holds: no link, no lockfile, few and small files", () => {
  for (const f of files) assert.equal(lstatSync(f).isSymbolicLink(), false, `a symbolic link: ${f}`);
  assert.ok(files.length <= 512, `${files.length} files; the directory holds a plugin over 512 for a reviewer`);
  for (const f of files) assert.ok(statSync(f).size <= 256 * 1024, `over 256 KiB: ${f}`);
  assert.ok(!files.some((f) => /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml)$/.test(f)), "a lockfile");
  assert.ok(files.some((f) => f.endsWith(join(PLUGIN_DIR, "LICENSE"))), "no licence");
  const words = readFileSync(join(DIR, "README.md"), "utf8").split(/\s+/).filter(Boolean).length;
  assert.ok(words >= 40, `the README has ${words} words; the directory blocks one under 40`);
});

test("the server starts from npm at one exact stable version, and the manifest says that version", () => {
  const mcp = JSON.parse(readFileSync(join(DIR, ".mcp.json"), "utf8"));
  const servers = Object.values(mcp.mcpServers ?? {});
  assert.equal(servers.length, 1);
  const [server] = servers;
  assert.equal(server.command, "npx");
  const pins = server.args.filter((a) => /^clearotron@/.test(a));
  assert.equal(pins.length, 1, "the pin is not in exactly one place, so one rewrite cannot move it");
  const version = pins[0].slice("clearotron@".length);
  assert.match(version, /^\d+\.\d+\.\d+$/, `not an exact stable version: ${pins[0]}`);
  assert.equal(server.args.at(-1), "mcp");
  assert.equal(server.env, undefined, "the plugin hands the server an environment; a value it needs goes through userConfig");
  const manifest = JSON.parse(readFileSync(join(DIR, ".claude-plugin", "plugin.json"), "utf8"));
  assert.equal(manifest.version, version, "the manifest's version does not follow the version the server is started from");
  assert.equal(manifest.name, "clearotron");
  assert.equal(manifest.license, "AGPL-3.0-only");
});

test("its skills and licence are the tree's own files, byte for byte", () => {
  for (const { path, text } of pluginCopies(ROOT)) assert.equal(readFileSync(join(ROOT, path), "utf8"), text, `${path} has drifted`);
  for (const s of CONNECTOR_SKILLS) assert.ok(files.some((f) => f.endsWith(join(PLUGIN_DIR, "skills", s, "SKILL.md"))), `${s} is missing`);
});
