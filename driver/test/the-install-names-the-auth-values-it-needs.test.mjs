// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// tracker issue 133 — a documented install left two of four units dead and said nothing about why.
//
// With auth enabled the portal refuses without `CLEAROTRON_OIDC_AUDIENCE` plus `CF_ACCESS_TEAM` or
// `PORTAL_OIDC_ISSUER`, and the ops face refuses without `CLEAROTRON_OIDC_AUDIENCE` plus
// `CF_ACCESS_TEAM` or `TRADEMARK_MCP_OIDC_ISSUER`. Fail-closed is correct and is not what changed. The
// defect was that `render-units --apply` enumerated nine values and NO auth variable was among them,
// while `PORTAL_OIDC_ISSUER` appeared in no document at all.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { portalAuthMode, faceAuthMode, authGaps, describeAuthGaps } from "../../shared/install-auth.mjs";
import { valuesRefusedOver } from "../systemd/install-census.mjs";

const ROOT = join(dirname(dirname(fileURLToPath(import.meta.url))), "..");
const RENDER = join(ROOT, "driver", "systemd", "render-units.mjs");
const missingNames = (env) => authGaps(env).gaps.flatMap((g) => [...g.missingAll, ...(g.oneOfUnmet ? g.oneOf : [])]);

test("133 an UNSET auth mode is the fail-closed one, on both faces", () => {
  // THE INVERSION THAT WOULD MAKE THIS WHOLE MODULE USELESS. Reading unset as "local" would report a
  // clean install on precisely the box the issue was filed about — a hosted operator who set no mode.
  assert.equal(portalAuthMode({}), "auth-proxy");
  assert.equal(faceAuthMode({}), "auth-proxy");
});

test("133 the documented hosted install is told every value its two dead units need", () => {
  const named = missingNames({});
  for (const k of ["CLEAROTRON_OIDC_AUDIENCE", "CF_ACCESS_TEAM", "PORTAL_OIDC_ISSUER", "TRADEMARK_MCP_OIDC_ISSUER"]) {
    assert.ok(named.includes(k), `${k} is not named, and a unit refuses to start without it`);
  }
});

test("133 one of two alternatives satisfied is not a gap", () => {
  // A flat required-list gets this wrong and reports PORTAL_OIDC_ISSUER missing on a correctly
  // configured Cloudflare install — advice to set a variable that would do nothing.
  const cf = { CLEAROTRON_OIDC_AUDIENCE: "aud", CF_ACCESS_TEAM: "firm", MCP_ALLOWED_EMAIL_DOMAINS: "x.com",
    CLEAROTRON_ACCESS_FILE: "/g.json" };
  assert.deepEqual(authGaps(cf).gaps, [], `a fully configured install was told to set: ${missingNames(cf).join(", ")}`);
  const issuer = { CLEAROTRON_OIDC_AUDIENCE: "aud", PORTAL_OIDC_ISSUER: "https://i", TRADEMARK_MCP_OIDC_ISSUER: "https://i",
    MCP_ALLOWED_EMAIL_DOMAINS: "x.com", CLEAROTRON_ACCESS_FILE: "/g.json" };
  assert.deepEqual(authGaps(issuer).gaps, [], "the issuer route is a supported alternative and was reported as a gap");
});

test("133 the local/token route — the first-install shape — is reported clean", () => {
  const local = { PORTAL_AUTH_MODE: "local", PORTAL_LOCAL_USER: "ops@example-firm.com",
    TRADEMARK_MCP_AUTH_MODE: "token", TRADEMARK_MCP_ALLOWED_HOSTS: "127.0.0.1:18790",
    CLEAROTRON_ACCESS_FILE: "/g.json" };
  assert.equal(portalAuthMode(local), "local");
  assert.equal(faceAuthMode(local), "token");
  assert.deepEqual(authGaps(local).gaps, [], `told to set: ${missingNames(local).join(", ")}`);
});

test("133 the two faces have INDEPENDENT modes, and the gaps are attributed per unit", () => {
  // Found by this arm failing: setting the portal to local does NOT move the ops face, which keeps its
  // own default of auth-proxy and still needs a Cloudflare team or an issuer. The first version of this
  // arm flattened the gaps across units and read that correct answer as a defect — an operator sees the
  // same thing, which is why every line `--apply` prints leads with the unit it is about.
  const per = (unit) => authGaps({ PORTAL_AUTH_MODE: "local" }).gaps
    .filter((g) => g.unit === unit).flatMap((g) => [...g.missingAll, ...(g.oneOfUnmet ? g.oneOf : [])]);
  const portal = per("clearotron-portal.service");
  assert.ok(!portal.includes("CF_ACCESS_TEAM"), "a LOCAL portal was told to set a Cloudflare team");
  assert.ok(portal.includes("PORTAL_LOCAL_USER"), "a local portal names no user and was not told so");
  assert.ok(per("clearotron-mcp-face.service").includes("CF_ACCESS_TEAM"),
    "the ops face still runs auth-proxy here, and was not told what it needs");
});

test("133 an empty value is not a set value", () => {
  // `.env.deployment.example` ships rows EMPTY. A presence check that reads `CF_ACCESS_TEAM=` as
  // configured would clear the gap on the very file the finding came from.
  assert.ok(missingNames({ CLEAROTRON_OIDC_AUDIENCE: "", CF_ACCESS_TEAM: "   " }).includes("CLEAROTRON_OIDC_AUDIENCE"));
});

test("133 THE LADDER HERE STILL MATCHES THE MODULES IT IS COPIED FROM", () => {
  // A copy of a rule drifts from it. `valuesRefusedOver` reads the real refusal lines out of each
  // module, so a ladder that changes without this file reds here rather than in a reader's install.
  const refusedBy = (rel) => new Set(valuesRefusedOver(readFileSync(join(ROOT, rel), "utf8")));
  const portal = refusedBy("driver/portal-service.mjs");
  const face = refusedBy("mcp-server/http-server.mjs");
  assert.ok(portal.size > 3 && face.size > 3, "the refusal scan found almost nothing, so it is not looking");
  for (const k of ["CLEAROTRON_OIDC_AUDIENCE", "CF_ACCESS_TEAM", "PORTAL_OIDC_ISSUER", "PORTAL_LOCAL_USER", "CLEAROTRON_ACCESS_FILE"]) {
    assert.ok(portal.has(k), `${k} is claimed for the portal here and no longer appears in its refusals`);
  }
  for (const k of ["CLEAROTRON_OIDC_AUDIENCE", "CF_ACCESS_TEAM", "TRADEMARK_MCP_OIDC_ISSUER", "TRADEMARK_MCP_ALLOWED_HOSTS", "CLEAROTRON_ACCESS_FILE"]) {
    assert.ok(face.has(k), `${k} is claimed for the ops face here and no longer appears in its refusals`);
  }
});

test("133 --apply names the auth gaps, driven through the real CLI", () => {
  const dir = mkdtempSync(join(tmpdir(), "ct133-"));
  try {
    const env = join(dir, "env");
    const grants = join(dir, "grants.json");
    writeFileSync(grants, JSON.stringify({ tenants: {} }));
    writeFileSync(env, `CLEAROTRON_CHECKOUT_DIR=/opt/clearotron\nCLEAROTRON_ACCESS_FILE=${grants}\n`);
    const out = execFileSync(process.execPath, [RENDER, "--apply", "--dest", join(dir, "dest"), "--env", env],
      { encoding: "utf8", timeout: 120_000, env: { ...process.env, PORTAL_AUTH_MODE: "", CF_ACCESS_TEAM: "", CLEAROTRON_OIDC_AUDIENCE: "" } });
    assert.match(out, /AUTH VALUES THIS INSTALL HAS NOT GOT/,
      "the install placed the units and said nothing about the values two of them refuse to start without");
    assert.match(out, /CLEAROTRON_OIDC_AUDIENCE/);
    assert.match(out, /PORTAL_OIDC_ISSUER/, "the variable that appears in no document is still not named");
    assert.match(out, /TRADEMARK_MCP_OIDC_ISSUER/);
    assert.match(out, /PORTAL_AUTH_MODE=local/, "the reader is not offered the route that works without a provider");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("133 INSTALL.md's isolation boundary names the ports", () => {
  // §8 claimed "the environment is the whole isolation boundary — four variables draw it" and the
  // PORTS were not on the list. A second instance with all four set still crash-loops on the shared
  // door port, and the symptom is a unit failing at boot rather than a port already in use.
  const install = readFileSync(join(ROOT, "INSTALL.md"), "utf8");
  const i = install.indexOf("Two instances on one machine");
  assert.ok(i > 0, "the isolation-boundary section is gone or renamed");
  // TO THE SECTION'S OWN CLOSING SENTENCE, not a character count — a fixed window silently stopped
  // short of the list it was written to check, and reported the ports missing when they were there.
  const end = install.indexOf("Nothing else separates them.", i);
  assert.ok(end > i, "the section's closing sentence is gone, so this arm cannot bound what it reads");
  const section = install.slice(i, end);
  for (const k of ["PORTAL_SERVICE_PORT", "TRADEMARK_MCP_HTTP_PORT", "CLIENT_MCP_HTTP_PORT"]) {
    assert.ok(section.includes(k), `${k} is not in the isolation boundary, so a second instance still collides on it`);
  }
  assert.doesNotMatch(section, /four variables draw it/,
    "the section still says four variables draw the boundary while listing more than four");
});
