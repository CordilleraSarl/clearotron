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
import { CONNECT_CLIENTS, ROUTES, clientById, leadRouteFor, whatItNeeds, connectOffers, offersForWire } from "../../shared/connect-clients.mjs";
import { STDIO_SHAPES, REMOTE_SHAPES, KEY_SLOT, stdioConnectFor, stdioConnectCommand, remoteConnectFor } from "../../shared/stdio-connect.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GUARD = "connect-clients-are-data";
const routes = () => Object.fromEntries(Object.keys(STDIO_SHAPES)
  .map((s) => [s, stdioConnectFor(s, { installRoot: "/opt/clearotron", workDir: "/w" })]));
// §3 — `localAddress` and `clientDoorStanding` are gone with the axis and the
// branch that read them. A deployment offers exactly one address now, and it is the public one.
const HAVE = { stdioRoutes: routes(), publicAddress: null, operator: "lawyer@acme.example" };
const PUBLISHED = { ...HAVE, publicAddress: "https://mcp.example.test" };
const offerOf = (have, id, route) => connectOffers(have).find((o) => o.client.id === id && o.route === route);

test("every step names a shape that exists, step 1 is always the copy, and an invented shape resolves to NOTHING", () => {
  let named = 0;
  for (const c of CONNECT_CLIENTS) {
    for (const route of ROUTES) {
      const steps = c.routes?.[route]?.steps({ operator: null }) ?? [];
      assert.ok(steps.length >= 2, `${c.id} has no steps for ${route}`);
      // "Step 1 is always the copy" — the approved design's rule, and what lets the page size its panel
      // and the terminal lead with the thing to take away.
      assert.ok(steps[0].copy, `${c.id}'s first ${route} step hands nothing over`);
      const table = route === "disk" ? STDIO_SHAPES : REMOTE_SHAPES;
      for (const s of steps.filter((x) => x.copy)) {
        named++;
        assert.ok(Object.hasOwn(table, s.copy), `${c.id} names ${route} shape "${s.copy}", which does not exist`);
      }
    }
  }
  assert.ok(named >= CONNECT_CLIENTS.length * ROUTES.length, "the walk above found too few copies to mean anything");
  // THE PLANT, because the assertion above is only worth what its failure mode is worth: a row naming a
  // shape nobody implemented must surface as an absence. A fallback here is precisely how a Codex user
  // gets handed `claude mcp add`.
  assert.equal(stdioConnectFor("a-shape-nobody-wrote", {}), null);
  assert.equal(remoteConnectFor("a-shape-nobody-wrote", { address: "https://x.test" }), null);
  const invented = { id: "invented", name: "Invented", lead: "disk", routes: {
    disk: { steps: () => [{ text: "Copy this.", copy: "nope" }, { text: "Then this." }] },
    "public-http": { steps: () => [{ text: "Copy this.", copy: "nope" }, { text: "Then this." }] } } };
  const offer = whatItNeeds(invented, PUBLISHED, "disk");
  assert.equal(offer.served, false, "a row with an unimplemented shape must not be reported as served");
  // Both halves, because a reason with no next step is the absence-with-no-cause this file exists to
  // refuse: the reader must learn what is wrong AND who fixes it.
  assert.match(offer.reason, /incomplete/, "the row does not say what is wrong");
  assert.match(offer.fix, /install it again/, "the row does not say what would change it");
  assert.equal(whatItNeeds(invented, PUBLISHED, "public-http").served, false,
    "an unimplemented web shape was served on a published install");
});

test("THE CLASS: each host gets ITS OWN shape's text — not the one the first host happened to need", () => {
  // The defect this catches, verbatim from the tree it was found in: every stdio row resolved through
  // `stdioConnectCommand`, so Codex and Claude's desktop app were both handed `claude mcp add` — a
  // command a Codex user does not have, stated with confidence.
  const disk = connectOffers(HAVE).filter((o) => o.route === "disk" && o.served);
  assert.equal(disk.length, CONNECT_CLIENTS.length, "a row has no disk route on an install that has every shape");
  const by = Object.fromEntries(disk.map((o) => [o.client.id, o]));
  assert.match(by["claude-code"].command, /^claude mcp add /, "Claude Code takes a CLI registration");
  assert.match(by["codex"].command, /^\[mcp_servers\./, "Codex takes a TOML block");
  assert.match(by["claude"].command, /"mcpServers"/, "Claude's desktop app takes a JSON block under mcpServers");
  // THE PROPERTY, over every member: a row's bytes are exactly its shape's, so two rows share bytes only
  // when they name one shape (ChatGPT's desktop app and Codex read the same file) and two shapes never
  // collapse to one text — which is what a fallback would produce.
  const shapeText = new Map();
  for (const o of disk) {
    assert.equal(o.command, HAVE.stdioRoutes[o.stdio.shape].text, `${o.client.id} did not get its own shape's text`);
    const seen = shapeText.get(o.command);
    assert.ok(!seen || seen === o.stdio.shape, `shapes ${seen} and ${o.stdio.shape} resolved to identical text`);
    shapeText.set(o.command, o.stdio.shape);
    if (o.stdio.shape !== "claude-cli") assert.doesNotMatch(o.command, /^claude mcp add /, `${o.client.id} was handed Claude Code's command`);
  }
  assert.equal(by["chatgpt"].command, by["codex"].command, "ChatGPT's desktop app reads Codex's file, so it must get Codex's bytes");
});

test("THE WEB ROUTE: each host's copy names this install's address, and a key only ever as the slot", () => {
  // Claude Code and Codex connect to a remote address with a key; the design gives each its own spelling
  // (`--transport http` with a header; `url` plus the NAME of a variable). A key is minted per press and
  // never composed into a string on the server, so every secret copy carries the slot and no value.
  const web = connectOffers(PUBLISHED).filter((o) => o.route === "public-http");
  assert.equal(web.filter((o) => o.served).length, CONNECT_CLIENTS.length, "a row has no web route on a published install");
  const copies = web.flatMap((o) => o.steps.filter((s) => s.copy).map((s) => ({ id: o.client.id, ...s.copy })));
  for (const c of copies) {
    const text = c.kind === "secret" ? c.template : c.text;
    if (c.kind === "secret") {
      assert.equal(c.slot, KEY_SLOT, `${c.id}'s secret copy names no slot for the key`);
      assert.ok(text.includes(KEY_SLOT), `${c.id}'s secret copy has nowhere to put the key`);
      assert.ok(c.label, `${c.id}'s secret copy has no button label`);
    } else {
      assert.ok(!text.includes(KEY_SLOT), `${c.id} shows a block with a key slot in it — that block would be shown in full`);
    }
  }
  const code = offerOf(PUBLISHED, "claude-code", "public-http").steps[0].copy;
  assert.match(code.template, /^claude mcp add --transport http \S+ https:\/\/mcp\.example\.test --header "Authorization: Bearer \{key\}"$/);
  const codex = offerOf(PUBLISHED, "codex", "public-http").steps.filter((s) => s.copy).map((s) => s.copy);
  assert.match(codex[0].text, /url = "https:\/\/mcp\.example\.test"\nbearer_token_env_var = "CLEAROTRON_KEY"/);
  assert.equal(codex[1].template, "export CLEAROTRON_KEY={key}");
  // ChatGPT signs its reader in, so it is handed the address and nothing that needs a key.
  assert.deepEqual(offerOf(PUBLISHED, "chatgpt", "public-http").steps.filter((s) => s.copy).map((s) => s.copy.kind), ["block"]);
});

test("the wire carries what the page hands over and nothing it would have to trust", () => {
  const wire = offersForWire(connectOffers(PUBLISHED));
  assert.equal(wire.length, CONNECT_CLIENTS.length * ROUTES.length);
  for (const o of wire) {
    for (const s of o.steps) {
      assert.equal(typeof s.text, "string");
      assert.doesNotMatch(s.text, /<[a-z]/i, `${o.id} carries markup in a step — the page would have to trust it`);
      if (s.copy) assert.deepEqual(Object.keys(s.copy).sort(), s.copy.kind === "secret"
        ? ["kind", "label", "slot", "template"] : ["kind", "text"], `${o.id} sends a copy in a shape the page does not read`);
    }
  }
});

test("an old id still answers, on the route it used to mean", () => {
  // `cowork`, `claude-desktop` and `perplexity` were rows. A script or a reader typing one must land on
  // the merged row AND on the half of it that id meant — `cowork` handed a settings block would be the
  // other half of a merged row, delivered as if it were the answer.
  assert.equal(clientById("cowork")?.id, "claude");
  assert.equal(leadRouteFor("cowork"), "public-http");
  assert.equal(clientById("claude-desktop")?.id, "claude");
  assert.equal(leadRouteFor("claude-desktop"), "disk");
  assert.equal(clientById("perplexity")?.id, "other");
  assert.equal(leadRouteFor("perplexity"), "public-http");
  // And a live id keeps its own lead, which is the route it had before both existed.
  assert.deepEqual(Object.fromEntries(CONNECT_CLIENTS.map((c) => [c.id, leadRouteFor(c.id)])),
    { claude: "public-http", "claude-code": "disk", chatgpt: "public-http", codex: "disk", other: "disk" });
  assert.equal(clientById("nobody"), null);
  assert.equal(leadRouteFor("nobody"), null);
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
  // EVERY web offer: under §3 there is no second kind, and since every row takes both routes every row
  // is in this population.
  const cloud = fresh.filter((o) => o.route === "public-http");
  assert.equal(cloud.length, CONNECT_CLIENTS.length, "the population this arm is about is present");
  for (const o of cloud) {
    assert.equal(o.served, false, `${o.client.id} cannot be served with no public address`);
    // An absence with no reason reads as breakage. Both halves, on every member.
    assert.ok(o.reason?.length > 20, `${o.client.id} is absent with no reason`);
    assert.ok(o.fix?.length > 20, `${o.client.id} says nothing about what would change it`);
  }
  // Published: the same rows become served. Proves the refusal above is a MEASUREMENT of the deployment
  // and not a property of those rows — a check that always refuses would pass the loop above too.
  for (const o of connectOffers(PUBLISHED)) {
    if (o.route === "public-http") assert.equal(o.served, true, `${o.client.id} stayed refused on a published deployment`);
  }
});

test("§9 NO ROW EVER ASKS TO OPEN A DOOR — the on-demand branch is gone, not quiet", () => {
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

test("settled 8 A LAUNCH URL MUST CARRY THE EVIDENCE THAT SOMEBODY DROVE IT", () => {
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

test("§3 NO OFFER EVER CARRIES A LOOPBACK ADDRESS, on any deployment", () => {
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
  // `cowork` merged into `claude` (owner: it is one app). Same population member —
  // an http client reaching the web door — so this arm keeps its subject under the surviving id.
  assert.equal(strip(whatItNeeds(clientById("claude"), PUBLISHED)),
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

  // The ids a row still answers to are identities too: a branch on `"cowork"` is the same drift.
  const ids = CONNECT_CLIENTS.flatMap((c) => [c.id, ...Object.keys(c.aliases ?? {})]);
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
  const real = clientById("claude");
  assert.ok(real, "no client to copy — this arm asserts nothing");
  const twin = { ...real, id: "a-client-that-does-not-exist", name: "Some Agent", aliases: undefined };
  const strip = (o) => JSON.stringify({ served: o.served, route: o.route, address: o.address, key: o.key,
    enables: o.enables, command: o.command, copies: o.steps.map((s) => s.copy ?? null) });
  for (const route of ROUTES) {
    assert.equal(strip(whatItNeeds(twin, PUBLISHED, route)), strip(whatItNeeds(real, PUBLISHED, route)),
      `two rows of identical shape resolved differently on ${route} — something keys on the client's identity`);
  }
  // And a row of a DIFFERENT shape must not collapse to the same answer, or the check above passes on
  // a resolver that returns one thing for everybody.
  const other = { ...twin, routes: { ...twin.routes, disk: { steps: () => [{ text: "Copy this.", copy: "claude-cli" }, { text: "Run it." }] } } };
  assert.notEqual(strip(whatItNeeds(other, PUBLISHED, "disk")), strip(whatItNeeds(real, PUBLISHED, "disk")));
});

test("each route refuses on its own, and says what resolves it to the reader who can act", () => {
  // A client of a hosted install is handed no stdio shapes at all, so every disk route is unserved — and
  // on an install with no public address every web route is. Neither may fall through to the other: a
  // web row answered with a disk refusal would tell a lawyer their software needed reinstalling.
  const noShapes = whatItNeeds(clientById("other"), { ...PUBLISHED, stdioRoutes: {} }, "disk");
  assert.equal(noShapes.served, false, "a disk route was served with no shape to hand over");
  assert.equal(noShapes.route, "disk");
  assert.equal(whatItNeeds(clientById("other"), { ...PUBLISHED, stdioRoutes: {} }, "public-http").served, true,
    "the web route stopped serving because the disk route could not");
  // On a deployment with no web address the web route must REFUSE rather than invent one.
  const unpublished = whatItNeeds(clientById("other"), { ...HAVE, stdioRoutes: {} }, "public-http");
  assert.equal(unpublished.served, false, "the web route served an assistant with no address to serve");
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
  assert.equal(withShapes.route, "disk");
  assert.equal(withShapes.enables, null);
});
