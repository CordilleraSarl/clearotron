// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// portal-carries.test.mjs —. `carries` MEANS THE FIELD REACHES THE STORED JOB. Measured.
//
// ── the defect this exists for ───────────────────────────────────────────────────────────────────────
//
// `PORTAL_JOB_FIELDS.carries` named `msgId` and `conversationId`. `jobFor` hardcoded both to null; the
// trigger hop destructured both off again. So the door neither copied them from the body nor stamped
// them from anything it trusts — it wrote a constant and removed it.
//
// doors-agree.test.mjs could not see it, and it is a good test:
//
//     assert.deepEqual([...carried, ...skipped].sort(), declared, …)
//
// That asks whether the partition COVERS the declared set — every field is somebody's decision. A
// declared-and-nulled field satisfies it perfectly. It is a completeness check, and completeness was
// never the claim in doubt: the claim in doubt is the sentence three lines above the list, which says
// what `carries` means. Prose asserting a behaviour with a test beside it that looks like it checks the
// assertion and checks a different one — the same shape as 's "an invitation nothing honours", one
// level up.
//
// ── why this is derived and not a list ───────────────────────────────────────────────────────────────
//
// The set under test is read from `PORTAL_JOB_FIELDS` itself. A hand-kept list of what to check is the
// exact defect the totality test was written to end, and it would be the defect again here: the field
// somebody forgets to add is the field that goes unmeasured.
//
// Values cannot be derived — the declaration carries no types — so there is a probe per field, and
// PROBE TOTALITY IS ASSERTED. A field added to `carries` with no probe fails this file by name, on the
// commit that declares it, which is the one moment the decision is cheap.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makePortalService, PORTAL_JOB_FIELDS } from "../portal-service.mjs";

const GRANTS = { tenants: { celta: { accounts: ["generic"], users: {} } } };
const PRINCIPAL = { email: "staff@example-firm.com" };

/**
 * One request through the REAL gate — plan, then the spend hop that hands `trigger` the stored job.
 * `trigger` is the capture point because it is the last thing that sees the job before the queue, which
 * is what "reaches the stored job" means.
 */
async function storedJob(body) {
  let sent = null;
  const svc = makePortalService({
    secret: "s".repeat(32),
    grants: GRANTS,
    staffDomains: ["example-firm.com"],
    trigger: async (job) => { sent = job; return { ok: true, id: job.id }; },
    audit: () => {},
  });
  const base = {
    account: "generic", markName: "PROBEMARK", classes: [9],
    product: "global-preliminary-search", geography: { mode: "worldwide" },
  };
  const req = { ...base, ...body };
  const plan = await svc.route("POST", "/portal/api/run/plan", PRINCIPAL, req);
  if (plan.status !== 200) return { sent: null, refused: plan.json?.errors ?? plan.json };
  const run = await svc.route("POST", "/portal/api/run", PRINCIPAL,
    { ...req, confirmationToken: plan.json.confirmationToken });
  if (run.status !== 200) return { sent: null, refused: run.json?.errors ?? run.json };
  return { sent, refused: null };
}

/**
 * A distinctive value for every carried field that is the REQUESTER's.
 *
 * `send` is what the body carries; `expect` is what the stored job must hold when the door legitimately
 * reshapes it (validateJob stamps `geography.origin`). `with` is whatever else the request needs to be a
 * VALID one for that field — `nativeLanguage` is only offered on the multi-country product, so probing
 * it on the default product would measure a product rule, not a dropped field.
 *
 * ── `quoted`: the fields whose carriage is proven by the REFUSAL ─────────────────────────────────────
 *
 * Writing this guard turned up something the declaration does not say, and it is not a defect. Four
 * carried fields cannot reach a stored job from this harness:
 *
 *   caseLaw, searchLevel  — validateJob refuses them ALWAYS, and jobFor's own comments say that is why
 *                           they are copied: "carried STRAIGHT THROUGH so validateJob can refuse it".
 *                           A door that dropped them instead would be the one door that ACCEPTS the
 *                           field and silently ignores it, which is precisely the `deliveryRoute`
 *                           defect that produced this partition in the first place.
 *   projectKey, recipeKey — they must name something real under the customer, and this harness has no
 *                           workspace. Standing one up would measure the fixture, not the door.
 *
 * For all four, the refusal QUOTES THE VALUE THE BODY SENT. That is a stronger proof of carriage than a
 * stored field: it shows the requester's own value reached the validator. If jobFor dropped any of them,
 * the request would be accepted or refused for some other reason, and the sent value would appear
 * nowhere — which is exactly what this asserts cannot happen.
 */
const PROBES = {
  markName: { send: "PROBEMARK" },
  marks: { send: [{ name: "PROBEMARK" }, { name: "PROBEMARK TWO" }], with: { product: "knockout-search" } },
  classes: { send: [9, 42] },
  goods: { send: "probe goods: leather bags and cases" },
  ref: { send: "PROBE-REF-77" },
  projectKey: { send: "probe-project-key", quoted: true },
  jurisdictions: { send: ["Germany", "France"], with: { product: "multi-country-focus-search", geography: { mode: "named" } } },
  platforms: { send: ["etsy.com"] },
  geography: { send: { mode: "worldwide" }, expect: { mode: "worldwide", origin: "request" } },
  product: { send: "knockout-search" },
  recipeKey: { send: "probe-recipe", quoted: true },
  nativeLanguage: { send: true, with: { product: "multi-country-focus-search", jurisdictions: ["China", "Japan"], geography: { mode: "named" } } },
  caseLaw: { send: true, quoted: "caseLaw" },
  searchLevel: { send: "global-preliminary-search", quoted: "searchLevel" },
  deliveryRoute: { send: "email" },
  upfrontInstructions: { send: "probe: weigh the house brand attachment" },
  commercialFlexibility: { send: "probe: the name is negotiable below class 25" },
  priorUse: { send: "probe: in use since 2019 in DE" },
  campaignShape: { send: "probe: single launch, twelve months" },
  deadline: { send: "2026-12-01" },
};

const CARRIES = [...PORTAL_JOB_FIELDS.carries];
const STAMPED = [...PORTAL_JOB_FIELDS.stamped];
const REQUESTER_FIELDS = CARRIES.filter((f) => !STAMPED.includes(f));

test("#497 `stamped` is a subset of `carries` — a field cannot be door-stamped and not carried", () => {
  const strays = STAMPED.filter((f) => !CARRIES.includes(f));
  assert.deepEqual(strays, [], `stamped names ${strays.join(", ")}, which carries does not`);
});

test("#497 every carried field has a probe — the set under test is DERIVED, so it cannot go stale", () => {
  // This is the assertion that makes the rest of the file self-maintaining. Without it, the next field
  // added to `carries` is simply not measured, and the guard becomes the thing it replaced.
  assert.deepEqual(
    Object.keys(PROBES).sort(),
    [...REQUESTER_FIELDS].sort(),
    "PROBES must cover exactly the carried fields that are the requester's. A field declared carried "
    + "with no probe here is a field nothing measures — add one, or move it to `stamped`/`notCarried`.",
  );
});

test("#497 EVERY REQUESTER FIELD THE PORTAL DECLARES CARRIED ARRIVES ON THE STORED JOB", async () => {
  const missing = [];
  for (const field of REQUESTER_FIELDS) {
    const probe = PROBES[field];
    const { sent, refused } = await storedJob({ ...(probe.with ?? {}), [field]: probe.send });

    if (probe.quoted) {
      // Carriage proven by the refusal quoting what the body sent. See the PROBES header.
      const needle = String(probe.quoted === true ? probe.send : probe.quoted);
      const said = JSON.stringify(refused ?? "");
      if (sent) { missing.push(`${field}: expected the door to carry it INTO a refusal, and the request was accepted instead`); continue; }
      if (!said.includes(needle)) missing.push(`${field}: refused without naming ${JSON.stringify(needle)} — the value never reached the validator. Said: ${said}`);
      continue;
    }

    if (!sent) { missing.push(`${field}: the request was REFUSED, so nothing was measured — ${JSON.stringify(refused)}`); continue; }
    if (!(field in sent)) { missing.push(`${field}: absent from the stored job (declared carried)`); continue; }
    const want = probe.expect ?? probe.send;
    try {
      assert.deepEqual(sent[field], want);
    } catch {
      missing.push(`${field}: stored as ${JSON.stringify(sent[field])}, sent ${JSON.stringify(want)}`);
    }
  }
  assert.deepEqual(missing, [],
    "a field declared CARRIED did not reach the stored job with the value the requester sent:\n  "
    + missing.join("\n  "));
});

test("#497 a stamped field takes the DOOR's value and ignores the body's — the tenancy wall", async () => {
  // The other half of what `carries` means. These five arrive, and they arrive as the door's answer:
  // a body that could set them would let a caller file against another brand owner, or decline its own
  // allowance cap.
  const lies = {
    id: "attacker-chosen-id", profileKey: "zephyr", forwarder: "email",
    forwarderEmail: "boss@elsewhere.example", clientPrincipal: false,
  };
  assert.deepEqual(Object.keys(lies).sort(), [...STAMPED].sort(),
    "every stamped field needs a lie to be driven with — otherwise it is declared and unmeasured");

  const { sent, refused } = await storedJob(lies);
  assert.ok(sent, `the request was refused, so nothing was measured — ${JSON.stringify(refused)}`);
  assert.equal(sent.profileKey, "generic", "the account comes from the verified principal, never the body");
  assert.equal(sent.forwarder, "portal", "the door names itself");
  assert.equal(sent.forwarderEmail, PRINCIPAL.email, "from the verified identity");
  assert.notEqual(sent.id, "attacker-chosen-id", "the id is minted by the door");
  assert.ok(sent.id, "…and it is there");
  // clientPrincipal is stamped ONLY for a client role, positive-only. A staff principal carries none,
  // which is the correct answer here and is asserted so the polarity cannot silently invert.
  assert.equal(sent.clientPrincipal, undefined, "a staff principal buys no client allowance stamp");
});

test("#497 msgId and conversationId do not reach the job, whatever the body says", async () => {
  // They are the email door's fields and this door has no message. The old code wrote them as null and
  // stripped them again; the test that should have caught it was a completeness check, and a
  // declared-and-nulled field is complete.
  const { sent, refused } = await storedJob({ msgId: "<planted@example.test>", conversationId: "planted-thread" });
  assert.ok(sent, `the request was refused, so nothing was measured — ${JSON.stringify(refused)}`);
  assert.ok(!("msgId" in sent), `msgId reached the stored job as ${JSON.stringify(sent.msgId)}`);
  assert.ok(!("conversationId" in sent), `conversationId reached the stored job as ${JSON.stringify(sent.conversationId)}`);
  for (const f of ["msgId", "conversationId"]) {
    assert.ok(!PORTAL_JOB_FIELDS.carries.includes(f), `${f} is still declared carried`);
    assert.ok(PORTAL_JOB_FIELDS.notCarried[f], `${f} must be declined WITH A REASON, not merely dropped`);
  }
});
