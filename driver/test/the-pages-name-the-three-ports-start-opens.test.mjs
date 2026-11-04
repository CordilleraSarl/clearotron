// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE PAGES NAME THE THREE PORTS START OPENS, AND WHAT `--port` DOES TO THEM.
//
// `clearotron start` opens three doors, and the install guide named two (measured on a beta, 2026-11-04).
// Its advice for a second instance set two variables and left the client door on the first instance's
// port; its port section said the doors "move separately" while `--port` moves all three; and it said a
// port in use is always refused, when a port nobody set moves to the next free one. The README never said
// that the demo opens three ports, or what `--port` does to them.
//
// EVERY NUMBER IS READ FROM THE RESOLVERS `start` USES: the three defaults, the arithmetic `--port`
// applies, and the demo's own base. A page that quotes a number those do not give goes red here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePorts, portsForFlag, demoPortDefaults } from "../../bin/start.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const flat = (s) => s.replace(/\s+/g, " ");
const VARS = { portal: "PORTAL_SERVICE_PORT", mcp: "TRADEMARK_MCP_HTTP_PORT", client: "CLIENT_MCP_HTTP_PORT" };

function startSection() {
  const text = read("INSTALL.md");
  const from = text.indexOf("## 6. ");
  assert.notEqual(from, -1, "INSTALL.md has no §6");
  return text.slice(from, text.indexOf("\n## ", from + 1));
}

test("start's section names each door's default port beside its variable", () => {
  const defaults = resolvePorts({});
  assert.deepEqual(Object.keys(defaults).sort(), Object.keys(VARS).sort(), "start resolves a door this arm has no variable for");
  const section = flat(startSection());
  for (const [door, name] of Object.entries(VARS)) {
    assert.ok(section.includes(name), `§6 does not name ${name}`);
    assert.ok(section.includes(String(defaults[door])), `§6 does not give ${name}'s default, ${defaults[door]}`);
  }
  assert.doesNotMatch(section, /They move separately/, "§6 says the doors move separately; --port moves all three");
  assert.doesNotMatch(section, /refuses rather than quietly moving|it will not quietly pick another/,
    "§6 says a port in use is always refused; a port nobody set moves to the next free one");
});

test("the second-instance advice sets all three doors, to the numbers --port would give them", () => {
  const section = startSection();
  const m = /^PORTAL_SERVICE_PORT=(\d+) TRADEMARK_MCP_HTTP_PORT=(\d+) CLIENT_MCP_HTTP_PORT=(\d+) clearotron start$/m.exec(section);
  assert.ok(m, "§6's second-instance command does not set all three ports");
  const moved = portsForFlag(m[1], resolvePorts({}), {});
  assert.deepEqual([moved.portal, moved.mcp, moved.client].map(String), m.slice(1, 4),
    "the three variables are not the numbers `--port` gives the same portal port");
  assert.ok(flat(section).includes(`\`clearotron start --port ${m[1]}\` opens the same three: ${moved.portal}, ${moved.mcp} and ${moved.client}.`),
    "§6 does not say --port opens the same three");
  assert.match(flat(section), /`clearotron start --port <n>` puts the portal on n, and the engine door and the client door on n\+1 and n\+2/);
});

test("the README and bin/README name the demo's three ports, and what --port does to them", () => {
  const demo = demoPortDefaults(resolvePorts({}), {});
  const at = [demo.portal, demo.mcp, demo.client];
  const moved = portsForFlag("1000", resolvePorts({}), {});
  assert.deepEqual([moved.mcp - 1000, moved.client - 1000], [1, 2], "--port no longer opens n, n+1 and n+2");
  assert.ok(flat(read("README.md")).includes(`The demo opens three ports, ${at[0]}, ${at[1]} and ${at[2]}; \`npx clearotron demo --port <n>\` opens n, n+1 and n+2 instead.`),
    "the README does not name the demo's three ports and what --port does");
  assert.ok(flat(read("bin/README.md")).includes(`\`127.0.0.1:${at[0]}\`, with its engine door and client door on ${at[1]} and ${at[2]}`),
    "bin/README.md does not name the demo's three ports");
});
