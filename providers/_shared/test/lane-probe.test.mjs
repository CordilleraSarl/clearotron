// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — a key that is SET and a key that WORKS are different facts, and the box could
// state only the first. These arms exist because the instrument they test is the kind that ships green
// and means nothing: every one of them runs on an INJECTED transport, so the probe is exercised here
// rather than only against a live account.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeLaneProbe, probeSpend, DEFAULT_CONTROLS, loadProviderCapabilities } from "../lane-probe.mjs";

const CHEAP = { countProbe: "cheap" };
const probe = (countHits, capabilities = CHEAP) => makeLaneProbe({ countHits, capabilities });
const healthy = async (q) => ({ ok: true, total: q.name === DEFAULT_CONTROLS.positive.mark ? 136 : 0 });

test("a lane that retrieves is PROVEN, and the proof names the number it retrieved", async () => {
  const r = await probe(healthy)({}, {});
  assert.equal(r.state, "proven");
  assert.equal(r.positive.total, 136);
  assert.equal(r.negative.total, 0);
  assert.equal(r.caveat, null, `an unremarkable pair produced a caveat: ${r.caveat}`);
  assert.match(r.reason, /136/, "the proof must carry the count — 'proven' with no number is a claim, not evidence");
});

// ── THE ARM THIS ISSUE WAS OPENED FOR ────────────────────────────────────────────────────────────
test("a lane where EVERYTHING returns zero is FAILED, not silently fine", async () => {
  // 87 counts came back `total: 0, ok: true` and cost about an hour of a round. Those zeros were
  // correct — the corpus marks were invented — but a dead credential produces the identical artifact.
  // The control mark is what tells them apart, and this is the arm that proves it does.
  const r = await probe(async () => ({ ok: true, total: 0 }))({}, {});
  assert.equal(r.state, "failed",
    "a lane returning ok:true total:0 for a mark registered in every major jurisdiction was reported as "
    + "anything other than failed. That reading is the whole defect: it is indistinguishable from a "
    + "synthetic corpus, and on a real matter it is a report that says the register is clear.");
  assert.match(r.reason, /returned 0 records/);
});

test("a dead credential fails with THE PROVIDER'S OWN REASON, not a generic one", async () => {
  const r = await probe(async () => ({ ok: false, total: null, reason: "401 Unauthorized" }))({}, {});
  assert.equal(r.state, "failed");
  assert.match(r.reason, /401 Unauthorized/,
    "the provider said why and the probe replaced it with its own words — an operator then has to "
    + "reproduce the call by hand to learn what this already knew");
});

// ── THE COULD-NOT-LOOK DISTINCTION, one subsystem over from tracker issues 1864 and 1874 ─────────
test("a provider that CANNOT be counted is `cannot-prove`, never `failed`", async () => {
  const r = await probe(healthy, { countProbe: "none" })({}, {});
  assert.equal(r.state, "cannot-prove",
    "a provider whose declared capability makes this proof impossible was reported as FAILED. Nothing "
    + "was asked and refused; the check could not run. Reporting that as a failure sends an operator "
    + "to rotate a credential that is fine.");
  assert.equal(r.spend.calls, 0, "an impossible proof must not spend anything attempting it");
});

test("the NEGATIVE control alone proves nothing — a dead lane satisfies it", async () => {
  // THE ASYMMETRY, AND IT IS THE DESIGN. A dead credential returns zero for BOTH controls, so a probe
  // keyed on `the invented mark returned 0` would call a dead lane healthy. Only the positive control
  // can catch it, which is why it is evaluated first and why a failure there stops the pair.
  const r = await probe(async () => ({ ok: true, total: 0 }))({}, {});
  assert.equal(r.state, "failed");
  assert.equal(r.negative, null,
    "the negative control was run after the positive one had already failed — it cannot change the "
    + "verdict, and running it spends a metered call to learn nothing");
});

test("a negative control that MATCHES is a caveat beside the proof, never instead of it", async () => {
  const r = await probe(async (q) => ({ ok: true, total: q.name === DEFAULT_CONTROLS.positive.mark ? 136 : 9 }))({}, {});
  assert.equal(r.state, "proven", "retrieval was demonstrated and a misbehaving negative control cannot unprove it");
  assert.match(r.caveat ?? "", /not a registrable form/,
    "a lane returning hits for an invented mark is matching something other than its query, and a "
    + "reader who is told only `proven` will read the next zero as `none`");
});

test("the spend is DERIVED from the capability, because one of these is billable and one is not", async () => {
  assert.equal(probeSpend({ countProbe: "cheap" }).metered, true,
    "under `cheap` the count IS an ordinary search — a paired control is two metered calls");
  assert.equal(probeSpend({ countProbe: "endpoint" }).metered, false);
  assert.equal(probeSpend({ countProbe: "none" }).calls, 0);
});

test("the transport is injected — a prober that could only be armed live refuses to be built", async () => {
  // The seam is the reason every arm above can run in CI at all. Without it this file could contain
  // one test: "it works against a live account", which is the instrument this issue complains about.
  assert.throws(() => makeLaneProbe({ capabilities: CHEAP }), /countHits dependency is required/);
});

test("the probe passes the query shape every adapter answers, INCLUDING regions", async () => {
  // One adapter refuses a worldwide count outright — a disclosed capability gap, not a number. A probe
  // that left `regions` off would read that refusal as a dead credential and send an operator to
  // rotate a key that is fine.
  const seen = [];
  await makeLaneProbe({ countHits: async (q) => { seen.push(q); return { ok: true, total: 1 }; }, capabilities: CHEAP })({}, {});
  assert.ok(seen.length >= 1);
  for (const q of seen) {
    assert.ok(Array.isArray(q.regions) && q.regions.length > 0, `the probe sent no regions: ${JSON.stringify(q)}`);
    assert.ok(typeof q.name === "string" && q.name.length > 0, "the mark must ride as `name`");
    assert.ok("matchMode" in q && "classes" in q, "the adapter contract's other two fields must be present");
  }
});

test("each control mark carries WHY it was chosen", () => {
  // A control that stops returning hits turns this probe into a permanent false alarm. Whoever re-picks
  // it needs the reason, and a reason that lives only in a commit message is not there when they look.
  for (const k of ["positive", "negative"]) {
    assert.ok(DEFAULT_CONTROLS[k].why.length > 40, `${k} control has no stated reason`);
  }
});

test("the capability is read from the PROVIDER'S declaration, not from the adapter", async () => {
  // The driver's adapter object carries `capabilities: null` on every provider. A caller reading it
  // gets the default and prints the wrong cost — measured: `uspto-local`, a LOCAL index, announced as
  // "BILLABLE — the count rides a real search here".
  const seen = [];
  const cap = await loadProviderCapabilities("/repo", "someprovider", (u) => { seen.push(u); return Promise.resolve({ CAPABILITIES: { countProbe: "endpoint" } }); });
  assert.equal(cap.countProbe, "endpoint");
  assert.match(seen[0], /providers\/someprovider\/src\/capabilities\.js$/,
    "the loader must read the provider's own declaration file");
});

test("an UNREADABLE capability is cost-UNKNOWN, never cost-cheap", async () => {
  // Defaulting an unknown capability to `cheap` is how a free lane gets announced as billable, and how
  // a billable one could get announced as free — the direction that actually costs money.
  const cap = await loadProviderCapabilities("/repo", "missing", () => Promise.reject(new Error("no such module")));
  assert.equal(cap, null, "an unreadable declaration must be null, not an empty object that reads as a default");
  const s = probeSpend(cap);
  assert.equal(s.metered, null, "unknown cost must be UNKNOWN — a boolean here is a claim nobody checked");
  assert.match(s.note, /UNKNOWN/);
});
