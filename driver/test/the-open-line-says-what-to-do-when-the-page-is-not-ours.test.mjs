// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE OPEN LINE SAYS WHAT TO DO WHEN THE PAGE IS NOT OURS.
//
// On WSL a Windows-side listener can hold a port that WSL reports as free, so the doors bind cleanly and
// the browser opens somebody else's page — measured 2026-09-11 with a VS Code Remote-SSH forward, which
// showed another instance's sign-in refusal. Nothing on the screen said "this is not us", and `--port`,
// which already moves all three doors, was never mentioned at the moment the address was handed over.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { foreignPageHint } = await import("../../bin/start.mjs");

test("the hint names the command being run, with --port", () => {
  for (const verb of ["demo", "start"]) {
    const text = foreignPageHint(verb).join(" ");
    assert.match(text, /not this install's sign-in/);
    assert.match(text, new RegExp(`clearotron ${verb} --port 28802`), `the ${verb} hint does not name the ${verb} command`);
  }
});

test("every Open line in start is followed by the hint, whichever way it was started", () => {
  const src = readFileSync(join(ROOT, "bin", "start.mjs"), "utf8").split("\n");
  // A FLOOR, so a renamed Open line cannot turn this into a loop over nothing.
  const opens = src.map((l, i) => (/say\(`  Open[: ] .*\$\{envs\.url\}`\)/.test(l) ? i : -1)).filter((i) => i >= 0);
  assert.equal(opens.length, 2, `expected the foreground and background Open lines, found ${opens.length}`);
  for (const i of opens)
    assert.match(src[i + 1], /foreignPageHint\(DEMO \? "demo" : "start"\)/, `the Open line at ${i + 1} is not followed by the hint`);
});

test("a sign-in refusal says which instance it is, so a person can tell it is not their own", async () => {
  // The page the forwarded port showed. It named no instance, so it read as the local demo refusing.
  const { denialPage } = await import("../portal-service.mjs");
  const { ORGANISATION_NAME } = await import("../../shared/brand.mjs");
  const saved = { issuer: process.env.PORTAL_OIDC_ISSUER, team: process.env.CF_ACCESS_TEAM };
  try {
    process.env.PORTAL_OIDC_ISSUER = "https://sso.example-firm.com/realms/staff";
    delete process.env.CF_ACCESS_TEAM;
    const page = denialPage(401, "missing auth-proxy JWT");
    if (ORGANISATION_NAME) assert.ok(page.includes(ORGANISATION_NAME), "the configured organisation is not named");
    else assert.match(page, /signs people in through sso\.example-firm\.com/, "the instance is not named");
    // No port advice: the people who normally see this page are a hosted instance's clients.
    assert.doesNotMatch(page, /--port/, "a hosted client was told to move a port they do not have");
    assert.doesNotMatch(page, /on your own computer/, "a hosted client was addressed as somebody running their own install");
    // A team name alone names the same service the verifier derives from it.
    delete process.env.PORTAL_OIDC_ISSUER;
    process.env.CF_ACCESS_TEAM = "examplefirm";
    if (!ORGANISATION_NAME) assert.match(denialPage(401, "x"), /signs people in through examplefirm\.cloudflareaccess\.com/);
    // THE CONTROL: nothing configured, nothing claimed.
    delete process.env.CF_ACCESS_TEAM;
    if (!ORGANISATION_NAME) assert.doesNotMatch(denialPage(401, "x"), /signs people in through/);
  } finally {
    for (const [k, v] of [["PORTAL_OIDC_ISSUER", saved.issuer], ["CF_ACCESS_TEAM", saved.team]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});

test("the WSL section of the install guide names the case and the answer", () => {
  const guide = readFileSync(join(ROOT, "INSTALL.md"), "utf8");
  assert.match(guide, /Windows side can hold a port that WSL reports as free/);
  assert.match(guide, /Remote-SSH port forwarding/);
  assert.match(guide, /`--port 28802`/);
});
