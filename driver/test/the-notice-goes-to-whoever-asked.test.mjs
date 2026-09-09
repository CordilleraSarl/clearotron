// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The completion notice goes to whoever ASKED (tracker issue 289, part b).
//
// THE DEFECT. `whatsappTo` was `AGENT_WHATSAPP[agentId]` — a map keyed by AGENT ID. Every user of a
// deployment shares one agent, so on every run the operator was paged for work somebody else ordered and
// the person who ordered it was told nothing. Observed on a delivered run: started by one account, and
// the attestation reads "WhatsApp notification delivered to" the account owner.
//
// OWNER RULING, 2026-09-07: route to the requester where a number is held for them, and keep the
// operator's number as a copy the operator can switch off. Both halves, independently.
//
// ENV IS SET BEFORE THE FIRST IMPORT, deliberately. Both rosters are read once at module load — the same
// discipline the agent roster has always had — so a test that imported first and set the environment
// afterwards would measure the defaults and pass on any implementation.
import { test } from "node:test";
import assert from "node:assert/strict";

const REQUESTER = "+41000000111";
const OPERATOR = "+41000000999";

process.env.CLEAROTRON_AGENT_WHATSAPP = JSON.stringify({ clawdi: OPERATOR });
process.env.CLEAROTRON_REQUESTER_WHATSAPP = JSON.stringify({
  "lisa@tenant.example": REQUESTER,
  "jordan": "+41000000222",
});
delete process.env.CLEAROTRON_WHATSAPP_OPERATOR_COPY;

const { whatsappRouting } = await import("../stages.mjs");

const job = (over = {}) => ({ forwarder: "somebody", forwarderEmail: "lisa@tenant.example", ...over });

// ── the requester is the recipient ───────────────────────────────────────────────────────────────────

test("289b: the notice is addressed to the requester, not to whoever runs the agent", () => {
  const r = whatsappRouting(job(), "clawdi");
  assert.equal(r.whatsappTo, REQUESTER, "the person who asked");
  assert.notEqual(r.whatsappTo, OPERATOR, "and specifically NOT the operator, which is what shipped");
  assert.equal(r.whatsappToReason, null, "no reason is stated when there is a recipient");
});

test("289b: the requester resolves by email, and by handle when no email is held", () => {
  assert.equal(whatsappRouting(job(), "clawdi").whatsappTo, REQUESTER, "email wins where both could match");
  assert.equal(whatsappRouting(job({ forwarderEmail: null, forwarder: "jordan" }), "clawdi").whatsappTo,
    "+41000000222", "a job with only a handle still reaches its requester");
  assert.equal(whatsappRouting(job({ forwarderEmail: "LISA@TENANT.EXAMPLE" }), "clawdi").whatsappTo, REQUESTER,
    "an address is matched case-insensitively — a roster is typed by a person");
});

// ── acceptance 6: absence is STATED, never filled in ─────────────────────────────────────────────────
//
// This is the arm that matters most. Silently falling back to the operator is precisely the behaviour
// being replaced, and it is invisible: the notice arrives, somebody reads it, and nothing anywhere says
// it went to the wrong person.
test("289b: with no number held, the packet SAYS SO and does not quietly use the operator", () => {
  const r = whatsappRouting(job({ forwarderEmail: "nobody@tenant.example", forwarder: "nobody" }), "clawdi");
  assert.equal(r.whatsappTo, null, "no recipient is invented");
  assert.notEqual(r.whatsappTo, OPERATOR, "and the operator is NOT substituted in — the old behaviour");
  assert.match(r.whatsappToReason, /no chat number is held/, "the gap is stated");
  assert.match(r.whatsappToReason, /nobody@tenant\.example/, "and it names who could not be reached");
});

// ── acceptance 5: the operator's copy is separate and switchable ─────────────────────────────────────

test("289b: the operator keeps a copy, and it is a DIFFERENT field from the requester's", () => {
  const r = whatsappRouting(job(), "clawdi");
  assert.equal(r.whatsappCcOperator, OPERATOR, "the operator still gets their copy by default");
  assert.equal(r.whatsappTo, REQUESTER);
  assert.notEqual(r.whatsappCcOperator, r.whatsappTo, "two recipients, two fields — not one field fought over");
});

test("289b: the operator can drop their copy WITHOUT dropping the requester's notice", async () => {
  process.env.CLEAROTRON_WHATSAPP_OPERATOR_COPY = "0";
  const fresh = await import(`../stages.mjs?operator-copy-off=${Date.now()}`);
  const r = fresh.whatsappRouting(job(), "clawdi");
  assert.equal(r.whatsappCcOperator, null, "the operator is out of everyone else's runs");
  assert.equal(r.whatsappTo, REQUESTER, "and the person who asked is still told — the half that must survive");
  delete process.env.CLEAROTRON_WHATSAPP_OPERATOR_COPY;
});

// A deployment that configured nothing must not route a client's notice at an invented number. The agent
// roster carries a demo fallback for offline tests; doing the same for REQUESTERS would mean a real
// completion notice addressed to a fixture.
test("289b: an unconfigured requester roster is EMPTY, never a demo one", async () => {
  const saved = process.env.CLEAROTRON_REQUESTER_WHATSAPP;
  delete process.env.CLEAROTRON_REQUESTER_WHATSAPP;
  const fresh = await import(`../stages.mjs?no-roster=${Date.now()}`);
  assert.deepEqual(fresh.REQUESTER_WHATSAPP, {}, "no invented numbers");
  const r = fresh.whatsappRouting(job(), "clawdi");
  assert.equal(r.whatsappTo, null);
  assert.match(r.whatsappToReason, /no chat number is held/, "and it says why rather than going quiet");
  process.env.CLEAROTRON_REQUESTER_WHATSAPP = saved;
});

// ── EVERY COMPLETION PACKET, NOT THE ONE I HAPPENED TO EDIT ──────────────────────────────────────────
//
// The fix above landed on ONE of the two call sites. `driver/pipeline.mjs` routed through
// `whatsappRouting` and `driver/pipeline-knockout.mjs` kept `AGENT_WHATSAPP[agent]`, so every knockout
// completion still paged the operator and could not say "no number is held" — proved on a delivered
// knockout round, where the recipient came back as the operator fixture with no `whatsappToReason`.
//
// THE ARM ABOVE COULD NOT HAVE CAUGHT IT, and that is the lesson worth writing down rather than the
// defect. Those arms drive `whatsappRouting` itself: they prove the function routes correctly, which was
// never in doubt. What was wrong was who CALLS it. A test set derived from the files a change touches is
// keyed on the change; a property about every delivery packet in the tree has to be keyed on the tree.
//
// So this enumerates every `emailBodyHtml` site — the field that makes an object a send packet — and
// rules on all of them. A new one fails here until somebody classifies it.
import { readFileSync } from "node:fs";
import { trackedFiles, skipReason } from "../../shared/tracked-files.mjs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GUARD = "321-send-packets-are-classified";

// file:line → why it is or is not routed. The COMPLETION notices must route; the rest must not.
const RULED = {
  "driver/pipeline.mjs": "the clearance completion packet — routed; and buildFailurePacket, which is a "
    + "failure notice and deliberately keeps the operator: a stage failure is an operational page, not "
    + "an answer the requester ordered",
  "driver/pipeline-knockout.mjs": "the knockout completion packet — routed; its failure packet keeps the "
    + "operator for the same reason",
  "driver/publish/knockout.mjs": "prose about the courier contract, not a packet",
  "mcp-server/server.mjs": "a tool description naming the field, not a packet",
};

function packetFiles() {
  // ENUMERATED, NOT GLOBBED. The first draft passed git pathspecs (`mcp-server/**/*.mjs`) and silently
  // missed `mcp-server/server.mjs`, because that glob wants an intermediate directory. A scan that
  // quietly covers less is exactly what this arm exists to catch, so the filtering happens here where it
  // can be read.
  // THROUGH THE HELPER, NOT `git ls-files` DIRECTLY. A tree outside a checkout answers an empty list to
  // a bare `ls-files`, and an empty corpus here reads as "no file builds a send packet, so none is
  // unruled" — a guard that passes loudest exactly where it can see nothing. `trackedFiles` returns
  // null for that case and says so, which is a stated skip rather than a silent pass.
  const tracked = trackedFiles(GUARD, { root: ROOT });
  if (tracked === null) return null;
  const files = tracked.filter((f) => f.endsWith(".mjs") && !f.includes("/test/")
    && (f.startsWith("driver/") || f.startsWith("mcp-server/")));
  return files.filter((f) => /emailBodyHtml/.test(readFileSync(join(ROOT, f), "utf8")));
}

test("321: every file that builds a send packet has been ruled on", (ctx) => {
  const listed = packetFiles();
  if (listed === null) return ctx.skip(skipReason(GUARD));
  const found = listed.sort();
  assert.ok(found.length >= 4,
    `only ${found.length} files carry emailBodyHtml — the scan is measuring less than when this was `
    + "classified, so it is now blind to packets it used to see");
  const unruled = found.filter((f) => !(f in RULED));
  assert.deepEqual(unruled, [],
    `these files build a send packet and nobody ruled whether it routes to the requester: ${unruled.join(", ")}. `
    + "If it is a COMPLETION notice it must spread whatsappRouting(job, agent); if it is a failure or "
    + "operational notice it keeps the operator. Say which, here.");
});

test("321: both completion packets route through whatsappRouting, and neither picks the agent directly", () => {
  for (const f of ["driver/pipeline.mjs", "driver/pipeline-knockout.mjs"]) {
    const src = readFileSync(join(ROOT, f), "utf8");
    assert.match(src, /\.\.\.whatsappRouting\(job, agent\)/,
      `${f} no longer spreads whatsappRouting into its completion packet — the notice goes to whoever `
      + "runs the agent again, which is the operator on every run because every user shares one agent id");
    // The failure packet in each file may still read AGENT_WHATSAPP; a completion packet may not. The
    // discriminator is the send-packet object itself, so this reads the line rather than the file.
    const lines = src.split("\n");
    const emailAt = lines.findIndex((l) => /^\s*emailBodyHtml:/.test(l) && !/clientRun/.test(l));
    assert.ok(emailAt > 0, `${f}: no completion packet found to check`);
    const window = lines.slice(emailAt, emailAt + 14).filter((l) => !/^\s*\/\//.test(l)).join("\n");
    assert.ok(!/AGENT_WHATSAPP\[/.test(window),
      `${f}'s completion packet picks AGENT_WHATSAPP directly — that is the defect, one call site over`);
  }
});
