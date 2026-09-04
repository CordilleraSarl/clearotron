// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The client list is DATA. Adding an assistant is a row, and no surface may branch on one by name.
//
//. The design says it in terms — "the list of clients is data, not code branches" —
// and the reason is on the same issue: there were TWO client tables, the browser's and this one, on
// different axes, and they had already drifted before either shipped. The page said Codex needs a key
// address; the table says Codex needs no key at all. A single `if (id === "codex")` downstream
// recreates that by hand, and both the branch and the row keep rendering while the reader follows
// whichever is wrong.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { grepTrackedFiles, skipReason } from "../../shared/tracked-files.mjs";
import { CONNECT_CLIENTS, clientById, whatItNeeds, connectOffers } from "../../shared/connect-clients.mjs";
import { STDIO_SHAPES, stdioConnectFor, stdioConnectCommand } from "../../shared/stdio-connect.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GUARD = "connect-clients-are-data";
const routes = () => Object.fromEntries(Object.keys(STDIO_SHAPES)
  .map((s) => [s, stdioConnectFor(s, { installRoot: "/opt/clearotron", workDir: "/w" })]));
// §3 — `localAddress` and `clientDoorStanding` are gone with the axis and the
// branch that read them. A deployment offers exactly one address now, and it is the public one.
const HAVE = { stdioRoutes: routes(), publicAddress: null, operator: "lawyer@acme.example" };
const PUBLISHED = { ...HAVE, publicAddress: "https://mcp.example.test" };

test("every row names a shape that exists, and an invented one resolves to NOTHING rather than a fallback", () => {
  for (const c of CONNECT_CLIENTS) {
    if (c.accepts === "http") continue;                       // an http row reads no stdio shape
    assert.ok(c.stdioShape, `${c.id} names no stdio shape`);
    assert.ok(Object.hasOwn(STDIO_SHAPES, c.stdioShape), `${c.id} names shape "${c.stdioShape}", which does not exist`);
  }
  // THE PLANT, because the assertion above is only worth what its failure mode is worth: a row naming a
  // shape nobody implemented must surface as an absence. A fallback here is precisely how a Codex user
  // gets handed `claude mcp add`.
  assert.equal(stdioConnectFor("a-shape-nobody-wrote", {}), null);
  const invented = { id: "invented", name: "Invented", accepts: "stdio", stdioShape: "nope", steps: () => [] };
  const offer = whatItNeeds(invented, HAVE);
  assert.equal(offer.served, false, "a row with an unimplemented shape must not be reported as served");
  // — the wording moved into the reader's vocabulary ("this copy of the
  // software is incomplete"), so this matches the FACT the row must state rather than the old phrase.
  // Both halves, because a reason with no next step is the absence-with-no-cause this file exists to
  // refuse: the reader must learn what is wrong AND who fixes it.
  assert.match(offer.reason, /incomplete/, "the row does not say what is wrong");
  assert.match(offer.fix, /install it again/, "the row does not say what would change it");
});

test("THE CLASS: each host gets ITS OWN shape's text — not the one the first host happened to need", () => {
  // The defect this catches, verbatim from the tree it was found in: all three stdio rows resolved
  // through `stdioConnectCommand`, so Codex and Claude Desktop were both handed `claude mcp add` — a
  // command a Codex user does not have, stated with confidence. `mcp-server/CONNECT.md` documents three
  // genuinely different shapes and this asserts each row lands on its own.
  const by = Object.fromEntries(connectOffers(HAVE).filter((o) => o.stdio).map((o) => [o.client.id, o]));
  assert.match(by["claude-code"].command, /^claude mcp add /, "Claude Code takes a CLI registration");
  assert.match(by["codex"].command, /^\[mcp_servers\./, "Codex takes a TOML block");
  assert.match(by["claude-desktop"].command, /"mcpServers"/, "Claude Desktop takes a JSON block under mcpServers");
  // A DIFFERENT MEMBER of the class, because "each gets its own" is a claim about all of them: no two
  // hosts may resolve to the same bytes, which is what a fallback would produce.
  const texts = Object.values(by).map((o) => o.command);
  assert.equal(new Set(texts).size, texts.length, "two hosts resolved to identical text — something is falling back");
  for (const [id, o] of Object.entries(by)) {
    if (id === "claude-code") continue;
    assert.doesNotMatch(o.command, /^claude mcp add /, `${id} was handed Claude Code's command`);
  }
});

test("a command and a config block are distinguishable, because they are not the same instruction", () => {
  // Rendering "run this once" over four lines of TOML is an instruction that reads as a shell command
  // and is not one. Every stdio offer must say which it is.
  for (const o of connectOffers(HAVE)) {
    if (!o.stdio) continue;
    assert.ok(["command", "config"].includes(o.stdio.kind), `${o.client.id} has no kind`);
    if (o.stdio.kind === "config") assert.ok(o.stdio.where, `${o.client.id} is a config block that never says WHERE it goes`);
  }
});

test("ONE AUTHOR: the pre-existing composer and the claude-cli shape are byte-identical", () => {
  // `stdioConnectCommand` is what `bin/start.mjs` and the portal already call.
  // Adding shapes beside it would be a second author of the same line unless they agree exactly.
  const opts = { installRoot: "/opt/clearotron", workDir: "/w" };
  assert.equal(stdioConnectFor("claude-cli", opts).text, stdioConnectCommand(opts));
});

test("THE THREE OUTCOMES, and a client we cannot serve says why AND what would change it", () => {
  const fresh = connectOffers(HAVE);
  // EVERY http row, not the ones that used to be labelled cloud: under §3 there is
  // no second kind. Cowork is in this population now, and it is the row the old axis got wrong.
  const cloud = fresh.filter((o) => o.client.accepts === "http");
  assert.ok(cloud.length >= 3, "the population this arm is about is present");
  for (const o of cloud) {
    assert.equal(o.served, false, `${o.client.id} cannot be served with no public address`);
    // An absence with no reason reads as breakage. Both halves, on every member.
    assert.ok(o.reason?.length > 20, `${o.client.id} is absent with no reason`);
    assert.ok(o.fix?.length > 20, `${o.client.id} says nothing about what would change it`);
  }
  // Published: the same rows become served. Proves the refusal above is a MEASUREMENT of the deployment
  // and not a property of those rows — a check that always refuses would pass the loop above too.
  for (const o of connectOffers(PUBLISHED)) {
    if (o.client.accepts === "http") assert.equal(o.served, true, `${o.client.id} stayed refused on a published deployment`);
  }
});

test("2148 §9 NO ROW EVER ASKS TO OPEN A DOOR — the on-demand branch is gone, not quiet", () => {
  // ── THIS ARM RAN THE OTHER WAY UNTIL THE RULING ─────────────────────────────────────────────────
  // It used to REQUIRE at least one row carrying `enables: { door: "client", setting:
  // "CLIENT_MCP_ACCOUNT_ACCESS" }` — the on-demand consent branch, which existed because the client
  // door was not installed and a reader picking Cowork turned it on. Settled point 2 supersedes that:
  // the door auto-starts with the product and the per-account key is the gate. So there is nothing left
  // for a page to authorise, and the assertion is reversed rather than removed — 1976's reasoning is
  // still on that thread, and an arm that merely stopped checking would let it be rebuilt.
  for (const have of [HAVE, PUBLISHED]) {
    for (const o of connectOffers(have)) {
      assert.equal(o.enables, null, `${o.client.id} still asks to open a door the installer now places`);
    }
  }
  // ANTI-VACUITY: the loop above passes on an empty offering too.
  assert.ok(connectOffers(PUBLISHED).length >= 6, "the offering emptied — the loop above asserts nothing");
});

test("2148 settled 8 A LAUNCH URL MUST CARRY THE EVIDENCE THAT SOMEBODY DROVE IT", () => {
  // The mechanism is built and the table is empty, deliberately. A URL written from memory is a button
  // that looks like it works and does not — which is the failure the owner has met twice on this page.
  // So a row may name a launch page only WITH the date it was driven and who drove it.
  for (const c of CONNECT_CLIENTS) {
    if (!c.launch) continue;
    assert.ok(/^https:\/\//.test(c.launch.url ?? ""), `${c.id} names a launch page that is not an https address`);
    assert.match(String(c.launch.verifiedOn ?? ""), /^\d{4}-\d{2}-\d{2}$/,
      `${c.id} claims a launch page with no date it was driven — a URL nobody opened is a guess`);
    assert.ok(String(c.launch.by ?? "").length > 2, `${c.id} claims a launch page with nobody's name against it`);
  }
  // It reaches an offer only when that offer is SERVED: opening a vendor's connector screen for a
  // deployment with nothing to connect to is worse than the refusal it would replace.
  for (const o of connectOffers(HAVE)) {
    if (!o.served) assert.equal(o.launch, null, `${o.client.id} offered a launch page while refusing`);
  }
  // ANTI-VACUITY, and the honest record: the loop above asserts nothing while the table is empty, so
  // say out loud that it is empty. The day a row gains one, this line is what has to change with it.
  assert.equal(CONNECT_CLIENTS.filter((c) => c.launch).length, 0,
    "a row gained a launch page — good, now update this count and say who drove it");
});

test("2148 §3 NO OFFER EVER CARRIES A LOOPBACK ADDRESS, on any deployment", () => {
  // The defect this replaces was live in the shipped product: Cowork was classified
  // `runsOn: "readers-machine"`, took a loopback address, and `connect --client cowork` printed one it
  // rejects. A remote connector is reached from the VENDOR'S CLOUD even when the app runs on the
  // reader's own machine, so no address that only resolves on this box is ever a true answer.
  for (const have of [HAVE, PUBLISHED]) {
    for (const o of connectOffers(have)) {
      assert.doesNotMatch(String(o.address ?? ""), /127\.0\.0\.1|localhost|0\.0\.0\.0/,
        `${o.client.id} was offered an address only this machine can reach`);
    }
  }
  // And the row that was wrong resolves exactly like the row that was right — same shape, same answer.
  const strip = (o) => JSON.stringify({ served: o.served, route: o.route, address: o.address, key: o.key });
  assert.equal(strip(whatItNeeds(clientById("cowork"), PUBLISHED)),
    strip(whatItNeeds(clientById("claude"), PUBLISHED)),
    "Cowork and Claude resolved differently — the deleted axis is back in some form");
});

test("picking the vaguest option does not authorise a posture change", () => {
  // "Another agent" is a reader who has not told us what their agent can do — not a reader asking for
  // the client door. Carrying an enable here made the vaguest choice the one that changed who can reach
  // the install, which is the opposite of on-demand.
  const other = whatItNeeds(clientById("other"), HAVE);
  assert.equal(other.served, true);
  assert.equal(other.enables, null, "choosing 'Another agent' must not enable the client door");
});

test("NO SURFACE BRANCHES ON A CLIENT'S NAME — and the surfaces are derived, not listed here", () => {
  // DERIVED FROM IMPORTS. A hand-kept list of files to check fails open: the surface added next month
  // is not on it, and the guard reports green over the one place nobody guarded.
  // THROUGH THE HELPER, not a raw `git grep`. It is what turns a missing checkout into a stated skip
  // rather than a wall of meaningless failures, and it says in its own output how many files it saw —
  // which is the difference between "nothing matched" and "nothing was looked at".
  //
  // `--cached` reads the INDEX, so a surface added in this very commit is visible once staged, and an
  // UNSTAGED new file is invisible. That is the trap this repository keeps paying for: a corpus guard
  // walking tracked files reports green over the one file nobody has added yet. The anti-vacuity assert
  // below is what turns that invisibility into a failure instead of a pass.
  const found = grepTrackedFiles(GUARD, { root: ROOT,
    args: ["-l", "--cached", "connect-clients.mjs", "--", "*.mjs", "*.ts", "*.tsx"] });
  if (!found) { assert.ok(skipReason(GUARD), "no corpus and no stated reason"); return; }
  const importers = found
    .filter((f) => f && !f.includes("/test/") && !f.endsWith(".test.mjs") && f !== "shared/connect-clients.mjs");
  assert.ok(importers.length >= 1,
    "no surface imports the table — this guard is asserting nothing. If you have just added one, stage it: "
    + "a corpus guard walking the index cannot see an unstaged file.");

  const ids = CONNECT_CLIENTS.map((c) => c.id);
  // COLLECTED AND ASSERTED, never `assert.fail` inside the loop. A fail-in-the-loop only executes when
  // there IS a violation, so on a clean tree the assertion never runs at all — and an arm whose
  // assertion never runs is indistinguishable from an arm that stopped asserting. ``'s
  // unexecuted-assert census caught exactly that here. This form runs on every pass and reports the
  // whole set rather than the first offender, which is also what a reader fixing them wants.
  const offenders = [];
  for (const rel of importers) {
    const src = readFileSync(join(ROOT, rel), "utf8");
    src.split("\n").forEach((line, n) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;                 // prose may name a client freely
      for (const id of ids) {
        if (new RegExp(`["'\`]${id}["'\`]`).test(line)) offenders.push(`${rel}:${n + 1}  ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(offenders, [],
    "a surface names a client in code. Adding an assistant is a row in CONNECT_CLIENTS — a branch here "
    + "drifts from it silently, and both the branch and the row keep rendering while the reader follows "
    + "whichever one is wrong.");
});


test("THE CLASS, DRIVEN: resolution follows the ROW'S SHAPE, not the client's identity", () => {
  // The end-to-end drive proved the door for ONE client. The claim underneath it is that any row of the
  // same shape gets the same answer — which is a claim about the mechanism, not about the two names that
  // happen to be in the table today. So it is checked against a row that does not exist: same shape,
  // different identity. If resolution ever keys on WHO rather than WHAT, this fails and the
  // no-branching-on-a-name guard above would not have caught it, because a table lookup is not a branch.
  const real = CONNECT_CLIENTS.find((c) => c.accepts === "http");
  assert.ok(real, "no http client — this arm asserts nothing");
  const twin = { id: "a-client-that-does-not-exist", name: "Some Agent", accepts: real.accepts,
    stdioShape: real.stdioShape, steps: () => [] };
  const strip = (o) => JSON.stringify({ served: o.served, route: o.route, address: o.address, key: o.key, enables: o.enables });
  assert.equal(strip(whatItNeeds(twin, PUBLISHED)), strip(whatItNeeds(real, PUBLISHED)),
    "two rows of identical shape resolved differently — something keys on the client's identity");
  // And a row of a DIFFERENT shape must not collapse to the same answer, or the check above passes on
  // a resolver that returns one thing for everybody. The contrast is now `accepts`, because that is the
  // only axis left: §3 deleted `runsOn`, which used to carry it.
  const local = { ...twin, accepts: "stdio", stdioShape: "claude-cli" };
  assert.notEqual(strip(whatItNeeds(local, PUBLISHED)), strip(whatItNeeds(real, PUBLISHED)));
});

test("the 'either' fallback EXECUTES — a branch nobody has driven asserts nothing", () => {
  // `other` names a shape that always renders, so the address-route fallback below it had never run: an
  // if/else arm written out of the author's doubt rather than the product's behaviour. Driven with no
  // shapes at all it must fall through to the web route — which is now the PUBLIC one and carries no
  // enable, because the door is already there and the key is the gate ( §9).
  const noShapes = whatItNeeds(clientById("other"), { ...PUBLISHED, stdioRoutes: {} });
  assert.equal(noShapes.route, "public-http", "the fallback did not run");
  assert.equal(noShapes.command, null);
  assert.equal(noShapes.enables, null, "the fallback still asks to open a door the installer places");
  // On a deployment with no web address that same fallback must REFUSE rather than invent one.
  const unpublished = whatItNeeds(clientById("other"), { ...HAVE, stdioRoutes: {} });
  assert.equal(unpublished.served, false, "the fallback served an assistant with no address to serve");
  // TWO AUDIENCES, TWO FIELDS, and the split is the finding's real resolution. `fix` is read by a
  // lawyer on the ARRIVING page, where ai-page-render-check refuses six words outright — so it names
  // the actor and nothing that would trip them. `operatorFix` is read in a terminal by the person who
  // IS that actor, and carries the variable and the document they need.
  assert.match(unpublished.fix, /whoever installed it/,
    "a client reading this on the portal cannot act alone, so who resolves it is part of what resolves it");
  for (const banned of [/\bMCP\b/i, /\baddress\b/i, /\bkey\b/i, /\btoken\b/i, /\bscope\b/i, /\bconnector\b/i])
    assert.doesNotMatch(unpublished.fix, banned,
      `the page-facing half must not carry a word the arriving-page check refuses: ${banned}`);
  assert.match(unpublished.operatorFix, /CLEAROTRON_CLIENT_MCP_URL/,
    "the operator's half must name the variable that resolves it — they cannot act on 'whoever installed it'");
  assert.match(unpublished.operatorFix, /INSTALL\.md/,
    "and the document that walks it, since this verb cannot do it itself");
  // And the normal case still leads with the route that needs nothing, and authorises nothing.
  const withShapes = whatItNeeds(clientById("other"), PUBLISHED);
  assert.equal(withShapes.route, "either");
  assert.equal(withShapes.enables, null);
});
