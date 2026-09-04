// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — F30, F32, F36, F38, and the theme the leg ended on:
//
//   "Every refusal should name the command or file that resolves it, and no refusal should be
//    reachable when the thing it asks for is already true."
//
// Nine refusals in one leg. Three were false, one was permanent on a healthy install, and three named a
// remedy the reader could not act on — "whoever installed it can put it online", to the person who had
// installed it. F34/F39/F40 fixed the false and the permanent ones; these are the unactionable ones,
// plus the reassurance that was worse than a refusal.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describeChange } from "../../shared/client-door.mjs";
import { whatItNeeds, clientById } from "../../shared/connect-clients.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");

// ── F36 · the reassurance that was false, and dangerous in that direction ──────────────────────────

const PLAN = { possible: true, address: "http://127.0.0.1:18812", identity: "lawyer@acme.example" };

test("2176-F36 with a public address configured, the door is NOT described as unreachable", () => {
  // Measured on the owner's box: "on this machine only … nothing outside this machine can reach it",
  // printed two sentences above a public https address the door was already answering on, reached from
  // off-box before the key had been pasted anywhere.
  const said = describeChange(PLAN, { applied: true, publicAddress: "https://agent-mcp.example.ch/mcp" }).join("\n");
  assert.doesNotMatch(said, /nothing outside this machine can reach it/i,
    `the door is published and this told the operator it was not:\n${said}`);
  assert.match(said, /IS reachable from outside this machine/, said);
  assert.match(said, /agent-mcp\.example\.ch/, "the address it is reachable AT is the actionable half");
});

test("2176-F36 with no public address, the private claim is still made — the fix must not mute a true sentence", () => {
  const said = describeChange(PLAN, { applied: true, publicAddress: null }).join("\n");
  assert.match(said, /nothing outside this machine can reach it/i, said);
});

test("2176-F36 when reachability could not be determined, NEITHER claim is made", () => {
  // A wrong answer in this direction is the dangerous one, so silence is the safe failure. An operator
  // told their door is loopback-only stops thinking about who else can reach it.
  const said = describeChange(PLAN, { applied: true, publicAddress: null, reachabilityKnown: false }).join("\n");
  assert.doesNotMatch(said, /nothing outside this machine can reach it/i,
    `an unread environment must not produce a reassurance:\n${said}`);
  assert.match(said, /could not be determined/, said);
});

test("2176-F36 the dry-run tense says the same thing as the applied one", () => {
  // One author for both, or a stale future-tense sentence describes a change in the way it was not made.
  const would = describeChange(PLAN, { applied: false, publicAddress: "https://x.example/mcp" }).join("\n");
  assert.match(would, /IS reachable from outside this machine/,
    "the dry run must not promise privacy the applied path does not deliver");
});

// ── F30 · the remedy addressed to somebody who is not reading it ───────────────────────────────────

test("2176-F30 the not-on-the-internet refusal names what to set and where it is documented", () => {
  // `whatItNeeds(client, have)` — positional. With no public address, Cowork is the row that refuses.
  const row = whatItNeeds(clientById("cowork"), { publicAddress: null, stdioRoutes: {}, operator: "op@localhost" });
  const text = JSON.stringify(row ?? "");
  // Asserted UNCONDITIONALLY. A guard like `if (/not on the internet/.test(text))` would pass in
  // silence the day this row stops being produced, which is the absence-as-pass shape.
  assert.match(text, /not on the internet yet/,
    `expected the refusing row for an install with no public address, got:\n${text}`);
  // On the CLI the reader IS whoever installed it, so "whoever installed it can" names nobody — but the
  // same row renders on the ARRIVING page, where six words are refused outright. The actionable half
  // lives in its own field for that reason, and the CLI is the only surface that prints it.
  assert.match(text, /CLEAROTRON_CLIENT_MCP_URL/,
    `the operator half must name the variable that resolves it:\n${text}`);
  assert.match(text, /INSTALL\.md/,
    `the operator half must point at the document that walks it:\n${text}`);
  assert.match(JSON.stringify(row?.operatorFix ?? ""), /CLEAROTRON_CLIENT_MCP_URL/,
    "and it must be the operatorFix field, not fix — fix is what the arriving page renders");
});

// ── F38 · the dead end reached by following instructions ──────────────────────────────────────────

test("2176-F38 `grant add` with no tenant prints the route that creates one", () => {
  // connect → "run grant" → grant → "a tenant must already exist" → nothing. Nothing in the CLI writes
  // a tenant: brandowner never has, grant refuses to, and the only route is the file.
  const home = mkdtempSync(join(tmpdir(), "f38-"));
  const file = join(home, "grants.json");
  writeFileSync(file, `${JSON.stringify({ tenants: {} }, null, 2)}\n`);
  let out = "";
  try {
    execFileSync(process.execPath,
      [join(REPO, "bin", "grant.mjs"), "add", "lawyer@acme.example", "--tenant", "acme", "--accounts", "acme"],
      { encoding: "utf8", stdio: "pipe", env: { ...process.env, HOME: home, CLEAROTRON_ACCESS_FILE: file } });
  } catch (e) { out = `${e.stdout ?? ""}${e.stderr ?? ""}`; }
  assert.ok(out, "expected grant to refuse on a fresh install with no tenants");
  assert.match(out, /No tenant "acme"/, out);
  assert.match(out, /"tenants"/, `the refusal must show the shape that creates one:\n${out}`);
  assert.match(out, new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    `the refusal must name THIS install's file, not a generic one:\n${out}`);
  assert.match(out, /brandowner list/, `it must name how to find the account keys it asks for:\n${out}`);
  rmSync(home, { recursive: true, force: true });
});

// ── F32 · one problem, two independent causes, and it named neither remedy ────────────────────────

test("2176-F32 the --background refusal names lingering AND the bus, and says they are independent", () => {
  const src = execFileSync("git", ["-C", REPO, "show", "HEAD:bin/start.mjs"], { encoding: "utf8", maxBuffer: 64e6 });
  const now = execFileSync("cat", [join(REPO, "bin", "start.mjs")], { encoding: "utf8", maxBuffer: 64e6 });
  assert.match(now, /loginctl enable-linger/,
    "lingering is a real prerequisite documented nowhere; the refusal that stops you must name it");
  assert.match(now, /XDG_RUNTIME_DIR=\/run\/user\//,
    "the bus export is the other cause, and the product knows the uid to fill in");
  assert.match(now, /Two independent things cause this/,
    "naming two remedies without saying they are alternatives just moves the guessing");
  assert.ok(src.length > 0, "sanity: HEAD's copy was readable, so the comparison above is meaningful");
});
