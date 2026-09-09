// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A company created after the engine door started can start a search.
//
// THE DEFECT THIS EXISTS FOR, and why the existing arm did not catch it. The portal's own credential is
// re-minted per call, so the grant wall stopped refusing a company created after boot — and the arm that
// certifies that injects its own mint and never crosses a process boundary. It was green over a live
// defect one step further in: the engine door reads the roster from a module cache filled when THAT
// process started, and refused the same company with "names no known customer" while its file sat on
// disk and the person had already been told they could search under it.
//
// So this drives the door's own validator across the boundary that matters — roster read, company
// written, request made — rather than the credential in front of it.
//
// THE CONTROL IS NOT OPTIONAL. Building this by hand, four successive versions "reproduced" the defect
// and every one of them was a malformed job: a missing id, then a missing reply path, then a missing
// forwarder, then missing classes. Each refusal read exactly like the one being hunted. A company that
// WAS in the roster at boot must pass the identical request, or the arm is measuring its own fixture.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A complete, valid request. Every field here earned its place by being the reason a draft failed. */
const jobFor = (profileKey) => ({
  id: "arm-0001",
  msgId: "arm@local",
  forwarder: "portal",
  forwarderEmail: "requester@example.com",
  marks: [{ name: "ACME" }],
  profileKey,
  jurisdictions: ["US"],
  classes: [9],
});

test("A COMPANY CREATED AFTER THE DOOR BOOTED CAN START A SEARCH", async () => {
  const store = mkdtempSync(join(tmpdir(), "door-after-boot-"));
  writeFileSync(join(store, "generic.json"),
    JSON.stringify({ name: "Generic default", platforms: ["amazon.com"] }));

  // Env BEFORE the first import: these modules capture it at import time, and setting it afterwards
  // reads as a store that was never configured.
  process.env.CLEAROTRON_CUSTOMERS_DIR = store;
  const { loadProfiles } = await import("../profiles.mjs");
  const { validateJob } = await import("../enqueue-schema.mjs");

  // 1. the door boots and fills its roster cache, as the engine's own server does at startup
  const atBoot = [...loadProfiles({ force: true }).keys()];
  assert.deepEqual(atBoot, ["generic"], "the roster this process saw when it started");

  // 2. somebody creates a company through the portal, after that
  writeFileSync(join(store, "acme.json"), JSON.stringify({
    name: "Acme Ltd", platforms: ["amazon.com"],
    frameworkPath: "skills/prelim-search/risk-framework.md",
  }));

  // THE CONTROL, FIRST. A company that was in the roster at boot must pass the identical request. If it
  // does not, the assertion below is about the shape of this fixture and not about the roster at all.
  const control = validateJob(jobFor("generic"));
  assert.equal(control.ok, true,
    `the control request is well formed — it is not: ${JSON.stringify(control.errors)}`);

  // 3. they press Start on the company they just made
  const v = validateJob(jobFor("acme"));
  assert.equal(v.ok, true,
    `a company created after boot is refused by the door: ${JSON.stringify(v.errors)}`);
});

test("A KEY THAT IS ON NO DISK ANYWHERE IS STILL REFUSED, and names the roster", async () => {
  // The other direction, and the one a re-read could break. Making the door look again must not make it
  // accept anything — an unknown key is still unknown after the second look, and the refusal still names
  // what this process can see, because the commonest real cause is the wrong store rather than the wrong
  // company.
  const store = mkdtempSync(join(tmpdir(), "door-unknown-key-"));
  writeFileSync(join(store, "generic.json"),
    JSON.stringify({ name: "Generic default", platforms: ["amazon.com"] }));
  process.env.CLEAROTRON_CUSTOMERS_DIR = store;
  const { loadProfiles } = await import("../profiles.mjs");
  const { validateJob } = await import("../enqueue-schema.mjs");
  loadProfiles({ force: true });

  const v = validateJob(jobFor("no-such-company"));
  assert.equal(v.ok, false, "a company nobody created is refused");
  assert.match(String(v.errors?.join(" ")), /no-such-company/, "the refusal names the key");
  assert.match(String(v.errors?.join(" ")), /generic/, "and the roster this process can see");
});
