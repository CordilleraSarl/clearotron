// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A STABLE CUT MOVES THE PLUGIN'S PIN AND ITS MANIFEST'S VERSION TOGETHER, AND A BETA MOVES NEITHER.
//
// The plugin folder starts the server from npm at the one `"clearotron@X.Y.Z"` argument in its
// `.mcp.json`, and its manifest says the same number. These arms hold the version cut to moving both, by
// the pin's prefix and never its position, to changing nothing else in either file, and to refusing a
// file that does not carry exactly one of what it moves.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pluginAtVersion, isStableVersion, PLUGIN_SERVER, PLUGIN_MANIFEST } from "../../scripts/release-version.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const files = () => ({
  server: readFileSync(join(ROOT, PLUGIN_SERVER), "utf8"),
  manifest: readFileSync(join(ROOT, PLUGIN_MANIFEST), "utf8"),
});
const lines = (t) => t.split("\n");

test("the folder's own files move to a stable, the pin and the manifest's version and nothing else", () => {
  const before = files();
  const after = pluginAtVersion(before, "9.8.7");
  assert.equal(after.refused, undefined, after.refused);
  const server = JSON.parse(after.server);
  const [entry] = Object.values(server.mcpServers);
  assert.equal(entry.args.filter((a) => a.startsWith("clearotron@")).join(), "clearotron@9.8.7");
  assert.equal(JSON.parse(after.manifest).version, "9.8.7");
  for (const [was, now] of [[before.server, after.server], [before.manifest, after.manifest]]) {
    const changed = lines(was).filter((l, i) => l !== lines(now)[i]);
    assert.equal(changed.length, 1, `more than the one line moved:\n${changed.join("\n")}`);
    assert.equal(lines(was).length, lines(now).length);
  }
  assert.equal(entry.args[0], "${CLAUDE_PLUGIN_ROOT}/scripts/npx.mjs", "the launcher argument moved with the pin");
});

test("the pin is found by its prefix, wherever it sits in the arguments", () => {
  const { manifest } = files();
  const server = JSON.stringify({ mcpServers: { x: { command: "node", args: ["a", "b", "c", "clearotron@1.0.0", "mcp"] } } }, null, 2) + "\n";
  assert.equal(JSON.parse(pluginAtVersion({ server, manifest }, "1.0.1").server).mcpServers.x.args[3], "clearotron@1.0.1");
});

test("a file without exactly one of what the cut moves refuses it", () => {
  const { server, manifest } = files();
  const twoPins = server.replace(/"mcp"/, '"clearotron@0.0.1"');
  assert.match(pluginAtVersion({ server: twoPins, manifest }, "1.0.0").refused, /carries 2 "clearotron@" arguments/);
  assert.match(pluginAtVersion({ server: server.replace(/clearotron@/, "other@"), manifest }, "1.0.0").refused, /carries 0 "clearotron@"/);
  assert.match(pluginAtVersion({ server: "", manifest }, "1.0.0").refused, /carries 0/, "a missing file is a refusal, never a skip");
  assert.match(pluginAtVersion({ server, manifest: manifest.replace(/^ {2}"version": "[^"]*",\n/m, "") }, "1.0.0").refused, /carries 0 top-level versions/);
});

test("only a stable moves the folder: between stables it names the last one", () => {
  for (const v of ["0.4.1", "1.0.0", "10.20.30"]) assert.equal(isStableVersion(v), true, v);
  for (const v of ["0.4.2-beta.0", "1.0.0-rc.1", "v1.0.0", "1.0"]) assert.equal(isStableVersion(v), false, v);
});
