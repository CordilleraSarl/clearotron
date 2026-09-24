// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE WORKER HOLDS NO SIGNING KEY, ON EITHER WAY AN INSTALL RUNS.
//
// The worker drains the queue and starts the AI program for every stage. It mints no key and checks none:
// every caller of `mintToken` is the portal, the supervisor, `connect` or the mint command. Yet it held
// the key that signs every access token, twice over. In the foreground, `start` put the key in the block it
// shares with every child and then set the key on itself, which every child inherits. Under systemd, the
// worker's unit loads the whole settings file. These arms hold both closed, and hold the doors and the
// portal, which do need the key, to keeping it and the one a rotation replaces.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { childEnv, childProcessEnv, SIGNING_KEY_NAMES } from "../../bin/start.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PATHS = { pool: "/p", workspace: "/w", queue: "/q", outbox: "/o", locks: "/l", grants: "/g", recipes: "/r", configStore: "/c" };
const envs = () => childEnv({ ports: { portal: 18802, mcp: 18790, client: 18811 }, paths: PATHS, user: "op@localhost",
  portalSecret: "ps", tokenSecret: "the-signing-key", opsToken: "ot" });

test("the signing keys are the current one and the one a rotation replaces", () => {
  assert.deepEqual([...SIGNING_KEY_NAMES], ["TRADEMARK_MCP_TOKEN_SECRET", "TRADEMARK_MCP_TOKEN_SECRET_PREVIOUS"]);
});

test("foreground: the worker's block carries no signing key, and the doors' and the portal's still do", () => {
  const e = envs();
  for (const k of SIGNING_KEY_NAMES) assert.equal(e.worker[k], undefined, `the worker's block carries ${k}`);
  for (const child of ["mcp", "client", "portal"])
    assert.equal(e[child].TRADEMARK_MCP_TOKEN_SECRET, "the-signing-key", `the ${child} lost the key it checks keys with`);
  assert.equal(e.worker.CLEAROTRON_QUEUE_DIR, "/q", "the worker still gets the install's paths");
});

test("foreground: a child inherits the supervisor's signing keys only when its own block carries the key", () => {
  const supervisor = { PATH: "/usr/bin", TRADEMARK_MCP_TOKEN_SECRET: "the-signing-key", TRADEMARK_MCP_TOKEN_SECRET_PREVIOUS: "the-old-key", OTHER: "kept" };
  const e = envs();
  const worker = childProcessEnv(supervisor, e.worker);
  for (const k of SIGNING_KEY_NAMES) assert.equal(worker[k], undefined, `the worker inherited ${k} from the supervisor`);
  assert.equal(worker.OTHER, "kept", "everything else is inherited as before");
  const door = childProcessEnv(supervisor, e.mcp);
  assert.equal(door.TRADEMARK_MCP_TOKEN_SECRET, "the-signing-key");
  assert.equal(door.TRADEMARK_MCP_TOKEN_SECRET_PREVIOUS, "the-old-key", "a door mid-rotation must still check keys signed before it");
});

test("the supervisor starts every child through childProcessEnv, never through a bare spread", () => {
  const src = readFileSync(join(ROOT, "bin", "start.mjs"), "utf8");
  assert.match(src, /env: childProcessEnv\(process\.env, env\)/, "the spawn no longer goes through the one rule");
  assert.doesNotMatch(src, /spawn\(process\.execPath[\s\S]{0,1600}?env: \{ \.\.\.process\.env, \.\.\.env \}/,
    "a child is started with the supervisor's whole environment again");
});

test("systemd: the worker's unit unsets both keys after loading the settings file, and no other unit does", () => {
  const dir = join(ROOT, "driver", "systemd");
  const units = readdirSync(dir).filter((f) => f.endsWith(".service"));
  assert.ok(units.length >= 4, `only ${units.length} units found`);
  for (const f of units) {
    const lines = readFileSync(join(dir, f), "utf8").split("\n");
    const unset = lines.filter((l) => l.startsWith("UnsetEnvironment="));
    if (f === "clearotron-worker.service") {
      assert.equal(unset.length, 1, "the worker's unit must carry exactly one UnsetEnvironment= line");
      assert.deepEqual(unset[0].slice("UnsetEnvironment=".length).trim().split(/\s+/), [...SIGNING_KEY_NAMES]);
      assert.ok(lines.some((l) => l.startsWith("EnvironmentFile=")), "the worker's unit no longer loads the settings file");
    } else {
      assert.deepEqual(unset, [], `${f} unsets a variable; the doors and the portal need the key`);
    }
  }
});

test("systemd: the line survives the renderer that installs the unit", async () => {
  // `clearotron start --background` and the hosted install both place units through `renderUnit`, which
  // fills the `${…}` placeholders and leaves every other line as written. So the installed unit carries the
  // line the tracked one does; this renders the tracked file the way they do and reads the line back.
  const { renderUnit, placeholdersIn } = await import("../systemd/render-units.mjs");
  const text = readFileSync(join(ROOT, "driver", "systemd", "clearotron-worker.service"), "utf8");
  // The worker unit carries no render placeholder today (its `${CLEAROTRON_CHECKOUT_DIR}` is systemd's own
  // expansion, read from the settings file), so it is installed byte for byte; any it gains later is filled here.
  const values = Object.fromEntries(placeholdersIn(text).map((n) => [n, `/value-of-${n}`]));
  const rendered = renderUnit(text, values);
  if (!Object.keys(values).length) assert.equal(rendered, text, "a unit with no placeholder is not installed as written");
  const unset = rendered.split("\n").filter((l) => l.startsWith("UnsetEnvironment="));
  assert.deepEqual(unset, [`UnsetEnvironment=${SIGNING_KEY_NAMES.join(" ")}`]);
});
