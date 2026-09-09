// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// `clearotron start` moves a door off a port nobody chose rather than refusing, and it may only do that
// when nothing outside this deployment resolves to the old number. The evidence it reads is a Cloudflare Access
// team or a door's own OIDC issuer.
//
// THE FAILURE THIS EXISTS TO CATCH IS AN OMISSION, and an omission is invisible to a test that repeats
// the list. The client door reads `CLIENT_MCP_OIDC_ISSUER || TRADEMARK_MCP_OIDC_ISSUER`, and its
// fail-closed admits a start on the client spelling with no Access team set at all. That name was
// missing from the launcher's list, so a deployment fronting only its client door with its own provider
// read as unfronted, and the door was movable — behind a proxy still addressed to the old number. Up,
// and unreachable, which looks like success.
//
// So the list is held to the doors THEMSELVES: the entrypoints the launcher spawns are read out of the
// launcher, and every team-or-issuer name any of them reads must appear in the one owned list.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FRONTING_VARIABLES, frontingVariablesSet } from "../../shared/install-auth.mjs";

const ROOT = join(dirname(dirname(fileURLToPath(import.meta.url))), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

// The processes the launcher spawns, taken from the launcher rather than written down here — a door
// added tomorrow arrives in this set on its own.
const spawnedEntrypoints = () => [...read(join("bin", "start.mjs")).matchAll(/\bstart\("[^"]*", "([^"]+\.mjs)"/g)]
  .map((m) => m[1]);

// What a module reads as evidence that something is in front of it. The ASSIGNMENT, not the refusal:
// a refusal line names the audience too, and the audience is not fronting evidence.
const frontingNamesRead = (source) => [...source.matchAll(/process\.env\.(CF_ACCESS_TEAM|[A-Z0-9_]+_OIDC_ISSUER)\b/g)]
  .map((m) => m[1]);

test("the launcher spawns the three doors this rule is about, and the worker", () => {
  const spawned = spawnedEntrypoints();
  // A hand-written population that silently empties is the way this whole file goes blind.
  assert.ok(spawned.length >= 4, `read ${spawned.length} spawned entrypoints out of bin/start.mjs — the regex has stopped matching`);
  for (const rel of ["driver/portal-service.mjs", "mcp-server/http-server.mjs", "mcp-server/http-server-client.mjs", "driver/runner.mjs"]) {
    assert.ok(spawned.includes(rel), `${rel} is no longer spawned by bin/start.mjs, or is spawned by another spelling this cannot see`);
  }
});

test("every door names its own fronting evidence directly, where this can read it", () => {
  // THE SILENT-PASS MODE OF THE ARM BELOW. If a door ever reaches its team or issuer through a helper
  // instead of `process.env`, the extractor returns nothing for it, the union shrinks, and the equality
  // still holds — a smaller list agreeing with a smaller reading. Each door is asserted non-empty here
  // so that refactor reds this file instead of quietly disarming it.
  for (const rel of ["driver/portal-service.mjs", "mcp-server/http-server.mjs", "mcp-server/http-server-client.mjs"]) {
    const names = frontingNamesRead(read(rel));
    assert.ok(names.length > 0, `${rel} reads no team or issuer through process.env — this arm can no longer see what fronts it`);
  }
});

test("the owned list is exactly what the doors read", () => {
  const union = new Set(spawnedEntrypoints().flatMap((rel) => frontingNamesRead(read(rel))));
  assert.deepEqual([...union].sort(), [...FRONTING_VARIABLES].sort(),
    "a door reads a fronting value the launcher's list does not, or the list names one no door reads");
});

test("an audience alone is not evidence of a proxy", () => {
  // Deliberate, and the reason is that an audience is not an alternative: every face refuses to start on
  // an audience with neither a team nor an issuer, so it can never be the only thing in front of a door.
  // Naming it here would refuse to move a port on a local install that had merely inherited the value.
  for (const k of ["CLEAROTRON_OIDC_AUDIENCE", "CLEAROTRON_CLIENT_OIDC_AUDIENCE"]) {
    assert.ok(!FRONTING_VARIABLES.includes(k), `${k} is an audience, not a proxy`);
  }
  assert.deepEqual(frontingVariablesSet({ CLEAROTRON_CLIENT_OIDC_AUDIENCE: "aud" }), []);
});

test("the client door's own issuer fronts it with no Access team set", () => {
  // The state the launcher used to read as unfronted. Both spellings count, and either one alone is
  // enough — the client door starts on `CLEAROTRON_CLIENT_OIDC_AUDIENCE` plus this and nothing else.
  assert.deepEqual(frontingVariablesSet({ CLIENT_MCP_OIDC_ISSUER: "https://idp.example/" }), ["CLIENT_MCP_OIDC_ISSUER"]);
  assert.deepEqual(frontingVariablesSet({ TRADEMARK_MCP_OIDC_ISSUER: "https://idp.example/" }), ["TRADEMARK_MCP_OIDC_ISSUER"]);
});

test("a blank setting is not a setting", () => {
  // `.trim()` and not truthiness: an env file line written as `CF_ACCESS_TEAM=` yields "", and reading
  // that as fronted would refuse every move on an install that had merely left the key in place.
  assert.deepEqual(frontingVariablesSet({ CF_ACCESS_TEAM: "   " }), []);
  assert.deepEqual(frontingVariablesSet({ CF_ACCESS_TEAM: " team " }), ["CF_ACCESS_TEAM"]);
});

test("the launcher does not carry a second copy of the list", () => {
  // A copy of a rule drifts from it, and this one drifted before it was owned anywhere.
  const launcher = read(join("bin", "start.mjs"));
  assert.ok(launcher.includes("frontingVariablesSet(process.env)"),
    "bin/start.mjs no longer reads the owned list");
  assert.ok(!/\["CF_ACCESS_TEAM",\s*"PORTAL_OIDC_ISSUER"/.test(launcher),
    "bin/start.mjs has grown its own fronting list again");
});
