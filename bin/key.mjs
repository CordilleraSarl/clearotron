#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// key.mjs — issue a key for a person, as a verb that loads configuration like every other verb.
//
// ── WHAT THIS REPLACES, AND WHY IT IS A VERB RATHER THAN A DOCUMENTED COMMAND ───────────────────────
//
// The only way to issue a key for a colleague or a client was to run `mcp-server/mint-token.mjs` by
// hand. That script never loaded the product's configuration, so on a fully configured install it
// refused by name:
//
//     mint-token: TRADEMARK_MCP_TOKEN_SECRET is unset — refusing (fail-closed)
//
// The secret was set, in both env files. Failing closed on a MISSING secret is right; failing closed on
// a configured install because the only issuance path cannot read the configuration is not. The
// documented way round it was worse than the refusal — lifting the signing secret out of an env file
// with `grep | cut` and putting it on the command line, which is to say into shell history, which this
// product warns about elsewhere in its own words.
//
// So issuance is a verb. `shared/env-local.mjs` is imported FIRST, exactly as the other entry points do
// it, and the operator never sees the secret at all.
//
// ── ONE ISSUANCE PATH, STILL ───────────────────────────────────────────────────────────────────────
//
// The minting itself is `mintFromOptions` in mcp-server/mint-token.mjs — that script remains the
// implementation and this is the interface, which is the whole shape the finding asked for. This file
// composes options and prints; it does not decide what a valid token is. Two places answering that
// question would be two answers, and the wrong one would be the one nobody read.
import "../shared/env-local.mjs";   // side effect: apply the install's .env — FIRST, before anything reads process.env
import { invocationPrefix } from "../shared/invocation.mjs";
import { existsSync, readFileSync } from "node:fs";
import { defaultGrantsPath } from "./start.mjs";
import { mintFromOptions } from "../mcp-server/mint-token.mjs";

const argv = process.argv.slice(2);
const p = invocationPrefix();
const die = (msg, code = 1) => { console.error(`key: ${msg}`); process.exit(code); };

const USAGE = `usage: ${p}clearotron key issue <email> [options]

  issue <email>        issue an ACCOUNT key for a person — the identity their assistant presents.
                       What they may see is decided by the grants file, not by this key, so the
                       key does not widen anyone's reach: enrol them with \`${p}clearotron grant\` first.

    --accounts a,b     cap the key to these account keys as well (omit = whatever their grant allows)
    --ttl-days <n>     how long it is valid (default 90)

The token is printed ONCE on stdout and stored nowhere — possession is the credential. Everything
else goes to stderr, including the jti that revokes it.`;

if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
  console.log(USAGE);
  process.exit(argv.length === 0 ? 1 : 0);
}

const [cmd, ...rest] = argv;
if (cmd !== "issue") die(`no such command "${cmd}". The one command is \`issue\`.\n\n${USAGE}`);

const flag = (n) => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : undefined; };
const positional = rest.filter((a, i) => !a.startsWith("--") && !(i > 0 && rest[i - 1].startsWith("--")));
const email = positional[0];

// NAMED REFUSALS, because this is the first day-one command that hands something to another person and
// a silent default here would issue a key to the wrong identity.
if (!email) die(`who is the key for? Give the person's email.\n\n${USAGE}`);
if (!email.includes("@")) die(`"${email}" is not an email address — the subject of an account key is the identity their assistant presents, and the grants file is keyed on it.`);

const ttlDays = Number(flag("--ttl-days") ?? 90);
const accounts = flag("--accounts") ? flag("--accounts").split(",").map((s) => s.trim()).filter(Boolean) : null;

let minted;
try {
  minted = mintFromOptions({ scope: "account", sub: email, ttlDays, accounts });
} catch (e) {
  // THE FAIL-CLOSED REFUSAL, RE-AIMED. Reaching it here means the configuration genuinely does not
  // carry a signing secret — not that this command could not read it, which was the defect. So the
  // remedy names the command that writes one rather than telling the reader to go and find the value.
  if (/TRADEMARK_MCP_TOKEN_SECRET/.test(e.message))
    die(`this install has no token signing secret, so no key can be issued.\n`
      + `  \`${p}clearotron start\` writes one on first run; \`${p}clearotron doctor\` reports whether it is set.\n`
      + `  Do NOT set it by hand on the command line — it would sign every key this install ever issues, and it would be in your shell history.`);
  die(e.message);
}

for (const line of minted.notes) console.error(line);

// — bb8's F13. A KEY FOR AN IDENTITY ON NO LIST IS A KEY THAT 403s. This command
// minted rc 0 for any address, printed the token once — it cannot be shown again — and the operator
// handed it to a client whose first request was refused, with nothing on either side saying why.
//
// A WARNING, NOT A REFUSAL. The key and the grant are two separate acts and issuing first is a
// legitimate order; refusing here would break it. What was missing is that nothing said the key was
// inert. STDERR, so the token stays alone on stdout and `key issue ... > token.txt` keeps working —
// that split is deliberate and this must not undo it.
try {
  const rosterPath = defaultGrantsPath();
  if (!existsSync(rosterPath)) {
    console.error(`\nNOTE: no guest list at ${rosterPath} yet, so nothing grants ${email} anything and this key will be refused at the door. \`clearotron start\` writes the list; then: clearotron grant add ${email} --tenant <name> --accounts <brand-owner-key>`);
  } else {
    const roster = JSON.parse(readFileSync(rosterPath, "utf8"));
    const tenants = roster?.tenants && typeof roster.tenants === "object" ? roster.tenants : {};
    const listed = Object.values(tenants).some((t) => t?.users && Object.prototype.hasOwnProperty.call(t.users, email));
    if (!listed)
      console.error(`\nNOTE: ${email} is on no tenant in ${rosterPath}, so this key resolves to no accounts and the door will refuse it. Grant them access with: clearotron grant add ${email} --tenant <name> --accounts <brand-owner-key>`);
  }
} catch (e) {
  // A ROSTER THIS COMMAND CANNOT READ IS NOT A ROSTER SAYING THE SUBJECT IS ABSENT. Said as what it is,
  // and it never blocks the mint — the key is already made by this point and the token must still reach
  // the operator, or it is lost for good.
  console.error(`\nNOTE: the guest list could not be read (${e.message}), so whether ${email} is on it is unknown — check before handing this key over.`);
}

console.error(`\nGive this to ${email} once. It is not stored and cannot be shown again.`);
console.log(minted.token);
