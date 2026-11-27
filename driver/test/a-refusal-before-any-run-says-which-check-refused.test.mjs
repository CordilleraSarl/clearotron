// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A REFUSAL BEFORE ANY RUN SAYS WHICH CHECK REFUSED IT.
//
// A worker that refuses an order at the claim writes the reason as the operator's text. The person who placed the order
// is owed an answer they can act on, and that text is not it: it names settings, profiles and other orders. So the runner
// records which check refused, in `.failed.kind` beside the reason, and the receipt carries that kind:
//   - every kind the runner writes is one the receipt knows;
//   - the receipt reads the kind back; an order refused before kinds were written, or one with a kind it does not know,
//     is `other`; a same-matter park is `duplicate`;
//   - the portal gives a company the kind and never the reason as written; someone who sees everything gets both.
// Every name is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { orderReceipt, REFUSAL_KINDS } from "../order-receipt.mjs";
import { makePortalService } from "../portal-service.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ACCOUNT = { account: "demo-brand-owner", organisation: null };
const job = (id) => JSON.stringify({ id, profileKey: "demo-brand-owner", markName: "KIND PROBE", forwarder: "jordan" });

function queue(orders) {
  const qdir = join(mkdtempSync(join(tmpdir(), "refusal-kind-")), "queue");
  mkdirSync(qdir, { recursive: true });
  for (const [id, files] of Object.entries(orders)) for (const [suffix, text] of Object.entries(files)) writeFileSync(join(qdir, `${id}${suffix}`), text ?? job(id));
  return qdir;
}

test("every kind the runner records at a refusal is one the receipt knows", () => {
  const src = readFileSync(join(HERE, "..", "runner.mjs"), "utf8");
  const calls = [...src.matchAll(/await failAtIntake\(([\s\S]*?)\);/g)].map((m) => m[1]);
  assert.ok(calls.length >= 6, `the refusal sites were not found (${calls.length})`);
  const kinds = calls.map((c) => /,\s*"([a-z-]+)"\s*$/.exec(c.trim())?.[1] ?? "other");
  for (const k of kinds) assert.ok(REFUSAL_KINDS.includes(k), `the runner records "${k}", which the receipt does not know`);
  assert.deepEqual([...new Set(kinds)].sort(), ["details", "other", "policy", "run-cap", "setup"],
    "a refusal site gained or lost its kind: the receipt and the screen's words follow this list");
});

test("the receipt reads the kind back, and anything it cannot read is other", () => {
  const qdir = queue({
    "kind-cap": { ".failed": null, ".failed.reason": "account run cap reached\nnotify: sent\n", ".failed.kind": "run-cap\n" },
    "kind-none": { ".failed": null, ".failed.reason": "refused before kinds were written\n" },
    "kind-odd": { ".failed": null, ".failed.reason": "x\n", ".failed.kind": "a-kind-from-later\n" },
    "kind-dup": { ".duplicate": null, ".duplicate.reason": "the same matter as an earlier order\nsecond line\n" },
  });
  const kindOf = (id) => orderReceipt({ queueDirs: [qdir], reference: id, scope: ACCOUNT }).receipt?.reasonKind;
  assert.equal(kindOf("kind-cap"), "run-cap");
  assert.equal(kindOf("kind-none"), "other");
  assert.equal(kindOf("kind-odd"), "other");
  assert.equal(kindOf("kind-dup"), "duplicate");
});

test("the portal gives a company the kind and never the reason as written; staff read both", async () => {
  const qdir = queue({ "portal-cap": { ".failed": null, ".failed.reason": "account demo-brand-owner: run cap 3 of 3 this month\nnotify: sent\n", ".failed.kind": "run-cap\n" } });
  const CLIENT = { email: "orders@alpha.example" }, STAFF = { email: "staff@firm.example" };
  const grants = {
    tenants: { celta: { accounts: ["demo-brand-owner"], users: { [CLIENT.email]: ["demo-brand-owner"] } } },
    people: { [STAFF.email]: { run: true, manage: true, everything: true }, [CLIENT.email]: { run: true } },
  };
  const svc = makePortalService({ secret: "s".repeat(32), grants, audit: () => {}, queueDirs: () => [qdir] });
  const own = await svc.route("GET", "/portal/api/orders/portal-cap", CLIENT, {}, { account: "demo-brand-owner" });
  assert.deepEqual([own.status, own.json.state, own.json.reasonKind, own.json.reason], [200, "refused", "run-cap", null]);
  assert.doesNotMatch(JSON.stringify(own.json), /run cap 3 of 3|notify/, "nothing of the operator's text reaches the company");
  const staff = await svc.route("GET", "/portal/api/orders/portal-cap", STAFF, {}, {});
  assert.equal(staff.json.reasonKind, "run-cap");
  assert.match(staff.json.reason, /run cap 3 of 3/);
});
