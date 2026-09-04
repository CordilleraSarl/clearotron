// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// lib/instructions.mjs — the connector's own usage guidance, served to the connecting assistant.
//
// THE PROBLEM THIS SOLVES. skills/clearotron-client/SKILL.md (packs/client/SKILL.md until) is a
// well-written brief for a client's assistant: start
// with `brief`, translate internal codes into plain language, keep the report's own verdict language and
// finding hierarchy, drill through to the cited source when challenged, never present a preliminary
// screening as legal advice. Until now it was a file in a repo. A client who connects Claude or ChatGPT to
// the endpoint never saw it, so none of it reached the assistant actually talking to them — the only steer
// that travelled was the `_note` riding on tool output.
//
// MCP has a field for exactly this: `instructions` on the initialize result, which the client surfaces to
// its model on connect. Verified present in the SDK we ship (@modelcontextprotocol/sdk 1.29.0 —
// `ServerOptions.instructions`, and `instructions` on InitializeResult in the protocol types).
//
// A NOTE ON A COMMENT YOU WILL FIND NEARBY. server.mjs says some clients "do not forward MCP
// server-level instructions", which is true and was correctly verified — but it is a statement about ONE
// client's runtime, and not about the connectors customers actually use. It is not a reason to skip this
// for Claude/ChatGPT connectors. BRIEFING_NOTE stays exactly as it is: it is the belt-and-braces
// layer that works on every client including ones that ignore instructions, and this is the braces.
//
// SCOPE OF THE GUARANTEE — read this before treating it as a control. Instructions are guidance to a
// model, NOT a security boundary. They make the OUTPUT good; they do nothing about ACCESS. What a client
// may reach is decided by authorize() and the clientSafe gate, and the client cut of any artifact text by
// lib/scrub.mjs. Never move a rule out of those and into here on the grounds that "the skill says not to".

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// — THE PACK TEXT MOVED TO skills/, AND WHY IT MOVED RATHER THAN BEING COPIED.
//
// A Claude Code plugin installs skills from a `skills/` directory, so the launch needed these three
// files in two places at once. Copying them with a byte-identity guard was ruled first and refused by
// its own fork condition: a Claude Code skill is DISCOVERED through YAML frontmatter carrying `name`
// and `description`, and the packs carried none, so the two copies could never be byte-identical and
// the guard could only ever have been a weaker approximation of one. One file, read from one place.
//
// THE FRONTMATTER IS STRIPPED BEFORE SERVING. It addresses the plugin host, not the connecting
// assistant; served verbatim it would open every client briefing with three lines of packaging
// metadata. `stripFrontmatter` below is asserted, not assumed — a leak here is invisible until
// somebody reads a transcript.
const SKILLS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "skills");
const SKILL_DIR = Object.freeze({ client: "clearotron-client", account: "clearotron-account", ops: "clearotron-ops" });

/** Drop a leading `---\n…\n---` block. Exported so its behaviour is testable rather than inferred. */
export function stripFrontmatter(text) {
  const s = String(text ?? "");
  if (!s.startsWith("---\n")) return s;
  const end = s.indexOf("\n---", 4);
  if (end === -1) return s;                    // unterminated: not frontmatter, leave it alone
  return s.slice(s.indexOf("\n", end + 1) + 1).replace(/^\n+/, "");
}

// Cached per process: the pack is a versioned build artifact, not per-request state.
const cache = new Map();
function pack(audience) {
  if (cache.has(audience)) return cache.get(audience);
  let text = null;
  const dir = SKILL_DIR[audience];
  try { text = dir ? (stripFrontmatter(readFileSync(join(SKILLS, dir, "SKILL.md"), "utf8")).trim() || null) : null; }
  catch { text = null; }   // a missing pack must never stop the server answering — guidance is not auth
  cache.set(audience, text);
  return text;
}

/**
 * instructionsFor(scope) → the SKILL.md text this principal's assistant should be briefed with, or
 * undefined (the SDK then omits the field entirely).
 *
 * The two client principals get DIFFERENT packs, because they are connected to different things:
 *   • `user` — a report link, pinned to one finished search. The CLIENT pack: "you are connected,
 *     read-only, to one search", three tools, anything else is out of scope.
 *   • `account` — a signed-in client (or an API key), holding their whole account. The ACCOUNT pack:
 *     seven tools, including commissioning new searches. Handing this principal the client pack briefs
 *     the assistant that starting a search is "outside this connector by design" — which is the exact
 *     opposite of true, and would make the assistant refuse the thing the client is paying for.
 * `ops` NOW GETS THE OPS PACK, and the reasoning that used to exclude it is worth keeping because it was
 * correct for the deployment it described. It read: "their assistants are ours, they reach the full
 * engineering tool set neither pack describes". That premise held while ops meant OUR agents, briefed
 * separately by the Claude Code plugin which installs the same packs as files.
 *
 * Owner ruling (2026-08-27, ruling 7): on a SELF-HOSTED install the customer IS ops. The person who owns
 * the box connects over this same connector and is briefed with nothing, while
 * `skills/clearotron-ops/SKILL.md` sits shipped and undelivered — SKILL_DIR has mapped it the whole
 * time. So the premise is false for that deployment, and the exclusion went with it.
 *
 * A pack is GUIDANCE, NEVER AUTH. Serving it widens what an assistant is told, never what a principal
 * may do — the verb set and the account scope are decided in shared/scope.mjs and are untouched by this.
 * An ops assistant that is briefed is no more privileged than one that is not; it is merely less likely
 * to invent a method internal, which is the failure this pack exists to prevent.
 */
export function instructionsFor(scope) {
  const kind = scope?.kind;
  if (kind === "user") return pack("client") ?? undefined;
  if (kind === "account") return pack("account") ?? pack("client") ?? undefined;
  if (kind === "ops") return pack("ops") ?? undefined;
  return undefined;
}

// _resetCache was DELETED 2026-08-03: its `// tests only` comment named a consumer that never existed
// (no test referenced it), which is a comment manufacturing a justification for dead code.
