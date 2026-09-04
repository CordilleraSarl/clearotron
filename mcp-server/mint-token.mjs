// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// mint-token.mjs — the ONE issuance path for scoped inner tokens (INSTALL.md §8).
//
//   node mcp-server/mint-token.mjs --scope ops  --sub connector-intake --ttl-days 30 --verbs start_run,feed_context
//   node mcp-server/mint-token.mjs --scope user --run <runId> [--sub client-acme] [--ttl-days 30]
//   node mcp-server/mint-token.mjs --scope account --sub lawyer@acme.example [--accounts acme] [--ttl-days 90]
//
// Prints the token ONCE to stdout (nothing is stored — possession is the credential); a summary of
// what was minted goes to stderr, INCLUDING the token's `jti` — record it: writing that jti into the
// denylist file (TRADEMARK_MCP_TOKEN_DENYLIST, one per line) revokes the token immediately (item 4).
// Requires TRADEMARK_MCP_TOKEN_SECRET in the env (fail-closed). Secret rotation is a two-secret
// window via TRADEMARK_MCP_TOKEN_SECRET_PREVIOUS (item 5). Conventions: ops tokens for automation
// principals should be SHORT-lived (days) and VERB-SCOPED to the least privilege they need — an
// intake connector never needs stop_run.

import { fileURLToPath } from "node:url";
import { mintToken, verifyToken, TOOL_SCOPES } from "../shared/scope.mjs";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";   // — one entry-point test, all spellings

function fail(msg, code = 1) { process.stderr.write(`mint-token: ${msg}\n`); process.exit(code); }

const USAGE = `usage: node mint-token.mjs --scope ops|user|account [options]
  --scope ops        an automation/operator principal (write verbs allowed)
    --sub <name>       REQUIRED for ops: the principal name (rides into the audit log)
    --verbs a,b        least-privilege write-verb allowlist (recommended; omit = full ops)
    --accounts a,b     GRANTS cap: the account keys (profileKeys) this token may see/start (omit = all)
    --ttl-days <n>     default 30
  --scope user       a run-bound report-link token (read-only client layer)
    --run <runId>      REQUIRED: the one run the token may read
    --sub <name>       optional principal label
    --ttl-days <n>     default 30
  --scope account    an API KEY for a client agent that cannot do the browser sign-in
    --sub <email>      REQUIRED: the identity, as it appears in the grants file — the key's accounts
                       are read from that file on every request, so removing the row revokes the reach
    --accounts a,b     optional CAP (an intersection on top of the grant; never widens it)
    --ttl-days <n>     default 90
`;

/**
 * Mint one token and compose the operator-facing summary — F44.
 *
 * EXTRACTED SO THERE STAYS EXACTLY ONE ISSUANCE PATH. `clearotron key issue` is a first-class verb now,
 * because the only way to issue a key for another person was this script run by hand, and this script
 * does not load the product's configuration: it refused a CONFIGURED install by name and made the
 * operator lift a signing secret out of an env file onto their command line, and into their shell
 * history. That is fixed at the verb, which loads configuration like every other verb — and the verb
 * calls THIS, rather than minting a second time in its own words. Two functions deciding what a valid
 * token is would be two answers, and the one that is wrong would be the one nobody read.
 *
 * PURE of process state apart from the secret the signer reads: it takes options and returns text.
 * Refusals are thrown, so the caller decides how to say them — a CLI verb and a script have different
 * voices and the same rules.
 */
export function mintFromOptions({ scope, sub = null, runId = null, ttlDays, verbs = null, accounts = null } = {}) {
  if (!process.env.TRADEMARK_MCP_TOKEN_SECRET)
    throw new Error("TRADEMARK_MCP_TOKEN_SECRET is unset — refusing (fail-closed)");
  if (scope !== "ops" && scope !== "user" && scope !== "account")
    throw new Error(`--scope must be ops|user|account (got "${scope ?? ""}")`);
  // ── PER-SCOPE REQUIREMENTS, AND THE REASON THEY LIVE HERE NOW ───────────────────────────────────
  //
  // These three were inside the script's entry block, and the extraction that made this function the
  // one issuance path DROPPED THEM — an ops token could be minted with no principal, so the audit log
  // could not say who was acting. Caught by mcp-server/test/ops-token.test.mjs on the first honest run.
  // They belong here rather than at either caller for exactly the reason the extraction existed: a rule
  // enforced by one of two callers is a rule the other one does not have.
  if (scope === "ops" && !sub) throw new Error("--sub is required for an ops token — the audit log must name the principal");
  if (scope === "user" && !runId) throw new Error("--run is required for a user token (it is bound to exactly one run)");
  if (scope === "account" && !sub) throw new Error("--sub is required for an account key — it names the grants-file identity the key reads its accounts from");
  if (!Number.isFinite(ttlDays) || ttlDays <= 0) throw new Error("--ttl-days must be a positive number");

  const token = mintToken({ scope, runId, sub, verbs, accounts, ttlSec: ttlDays * 24 * 3600 });
  const t = verifyToken(token);   // self-check + canonical echo of what was actually minted
  // The echo is scope-aware because the same empty field means opposite things per scope: no verbs on an
  // OPS token is FULL write authority, while the other scopes do not take verbs at all — and no accounts
  // on an ACCOUNT key means "whatever the grants file says", not "every account". An operator reading
  // "verbs=(full ops)" off a client's API key would reasonably think they had just handed over the estate.
  const verbsEcho = t.verbs ? t.verbs.join(",")
    : scope === "ops" ? "(full ops)"
      : scope === "account" ? "(n/a — the fixed account tool set)"
        : "(n/a — read-only, one run)";
  const acctEcho = t.accounts ? t.accounts.join(",") : scope === "account" ? "(whatever the grants file grants this identity)" : "(all)";
  const notes = [
    `minted: scope=${t.scope} sub=${t.sub ?? "-"} run=${t.runId ?? "-"} verbs=${verbsEcho} accounts=${acctEcho} expires=${new Date(t.exp * 1000).toISOString()} jti=${t.jti}`,
    `revoke: add "${t.jti}" as a line in the TRADEMARK_MCP_TOKEN_DENYLIST file`,
  ];
  if (scope === "account")
    notes.push(`revoke (second lever): remove "${t.sub}" from the grants file — an account key reads its accounts there on every request, so the row IS the reach`);
  if (scope === "ops" && !verbs) {
    const writable = Object.keys(TOOL_SCOPES).filter((k) => TOOL_SCOPES[k].write);
    notes.push(`note: FULL ops authority (${writable.join(", ")}) — consider --verbs for automation principals`);
  }
  return { token, claims: t, notes };
}

if (isEntrypoint(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) { process.stdout.write(USAGE); process.exit(0); }
  const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const scope = flag("--scope");
  const sub = flag("--sub") ?? null;
  const runId = flag("--run") ?? null;
  const ttlDays = Number(flag("--ttl-days") ?? (scope === "account" ? 90 : 30));
  const verbs = flag("--verbs") ? flag("--verbs").split(",").map((s) => s.trim()).filter(Boolean) : null;
  const accounts = flag("--accounts") ? flag("--accounts").split(",").map((s) => s.trim()).filter(Boolean) : null;

  // ONE ISSUANCE PATH: this script and `clearotron key issue` both call the function above. Its refusals
  // are thrown so each caller says them in its own voice; here that voice is `fail`.
  let minted;
  try { minted = mintFromOptions({ scope, sub, runId, ttlDays, verbs, accounts }); }
  catch (e) { if (/--scope must be/.test(e.message)) process.stderr.write(USAGE); fail(e.message); }
  for (const line of minted.notes) process.stderr.write(line + "\n");
  const token = minted.token;
  process.stdout.write(token + "\n");
}
