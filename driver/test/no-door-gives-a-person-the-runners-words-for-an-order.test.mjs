// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// NO DOOR GIVES A PERSON THE RUNNER'S WORDS FOR AN ORDER.
//
// Every person using Clearotron is told of an order in product terms, whatever their role and whichever door they ask
// at (design, 2026-11-27): never a queue's name, a file's path, an override flag, a network error code or a check's own
// message. The runner keeps those in the queue's record for diagnosis. Here each refused order's record holds all five,
// and every door that answers by reference is asked about it:
//   - the portal's /portal/api/orders/<reference>, by a company's person and by someone who sees everything;
//   - the command line's `--status <reference>`, and its answer to a reused id.
// The orders come in three ways: placed from the portal by a company's person, forwarded by email, and placed by staff
// for someone else. Each door's whole answer is read, every field, not only the sentence.
// Every name is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { makePortalService } from "../portal-service.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "enqueue.mjs");

// What the runner may write in a refusal's record. A door that passes any of it on fails here.
const RECORDED = "/srv/invented/work/workspace-intake-agent/studio/queue/ORDER.failed: re-submit with --dup-override; "
  + "receiver said ETIMEDOUT; runCaps.dailyRuns must be at most 2";
const INTERNAL = /\/srv\/invented|workspace-intake-agent|studio\/queue|--dup-override|dupOverride|ETIMEDOUT|runCaps|dailyRuns|notify:/;

const ORIGINS = {
  "from-portal": { clientPrincipal: true, forwarder: "portal", forwarderEmail: "orders@alpha.example" },
  "by-email": { forwarder: "jordan", forwarderEmail: "jordan@outside.example", msgId: "<m1@outside.example>" },
  "for-someone-else": { forwarder: "staff", forwarderEmail: "orders@alpha.example" },
};

function queueOfRefusals() {
  const qdir = join(mkdtempSync(join(tmpdir(), "runners-words-")), "queue");
  mkdirSync(qdir, { recursive: true });
  for (const [origin, fields] of Object.entries(ORIGINS)) {
    const id = `refused-${origin}`;
    writeFileSync(join(qdir, `${id}.failed`), JSON.stringify({ id, profileKey: "demo-brand-owner", markName: "VELLOQUIN", ...fields }));
    writeFileSync(join(qdir, `${id}.failed.reason`), `${RECORDED}\nnotify: sent\n`);
    writeFileSync(join(qdir, `${id}.failed.kind`), "run-cap\n");
  }
  return qdir;
}

const COMPANY = { email: "orders@alpha.example" };
const EVERYTHING = { email: "staff@example-firm.com" };
const GRANTS = {
  tenants: { celta: { accounts: ["demo-brand-owner"], users: { [COMPANY.email]: ["demo-brand-owner"] } } },
  people: { [EVERYTHING.email]: { run: true, manage: true, everything: true }, [COMPANY.email]: { run: true } },
};

test("the portal tells each person the kind of refusal and nothing the runner wrote, for every way an order came in", async () => {
  const qdir = queueOfRefusals();
  const svc = makePortalService({ secret: "s".repeat(32), grants: GRANTS, audit: () => {}, queueDirs: () => [qdir] });
  for (const origin of Object.keys(ORIGINS)) {
    for (const [who, person, query] of [["a company's person", COMPANY, { account: "demo-brand-owner" }], ["someone who sees everything", EVERYTHING, {}]]) {
      const r = await svc.route("GET", `/portal/api/orders/refused-${origin}`, person, {}, query);
      assert.deepEqual([r.status, r.json.state, r.json.reasonKind, r.json.reason], [200, "refused", "run-cap", null], `${origin}, ${who}`);
      assert.doesNotMatch(JSON.stringify(r.json), INTERNAL, `${origin}, ${who}: ${JSON.stringify(r.json)}`);
    }
  }
});

test("the command line prints the kind of refusal and nothing the runner wrote, for every way an order came in", () => {
  const qdir = queueOfRefusals();
  for (const origin of Object.keys(ORIGINS)) {
    const r = spawnSync(process.execPath, [CLI, "--status", `refused-${origin}`, "--queue-dir", qdir], { encoding: "utf8", env: { ...process.env } });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.deepEqual([out.state, out.reasonKind, out.reason], ["refused", "run-cap", null], origin);
    assert.doesNotMatch(r.stdout + r.stderr, INTERNAL, `${origin}: ${r.stdout}${r.stderr}`);
  }
});

test("an id used again at the command line is answered with that order, without its record or the queue's folder", () => {
  const qdir = queueOfRefusals();
  const r = spawnSync(process.execPath, [CLI, "--queue-dir", qdir, "--mark", "VELLOQUIN", "--classes", "9", "--forwarder", "jordan",
    "--id", "refused-by-email"], { encoding: "utf8", env: { ...process.env } });
  assert.equal(r.status, 3, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepEqual([out.ok, out.existing.state, out.existing.reasonKind, out.existing.reason], [false, "refused", "run-cap", null]);
  assert.doesNotMatch(r.stdout + r.stderr, INTERNAL, r.stdout + r.stderr);
  assert.ok(!(r.stdout + r.stderr).includes(qdir), "the queue's folder is not printed");
});
