// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// portal-routes/connect.mjs — connecting a reader's own AI assistant: whether the connector's door answers and whether the
// reader has connected, a key minted for the caller, and the connection help page.
//
// One of the portal service's route groups, moved out of its dispatcher unchanged; makePortalService says how it asks them.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { connectOffers, offersForWire } from "../../shared/connect-clients.mjs";
import { doorKind } from "../../shared/mcp-challenge.mjs";
import { mintToken } from "../../shared/scope.mjs";
import { STDIO_SHAPES, stdioConnectFor, stdioConnectOffer } from "../../shared/stdio-connect.mjs";
import { isWsl, wslTarget } from "../../shared/wsl.mjs";
import { isDemo } from "../demo-posture.mjs";
import { claudeNamer } from "../engine/probe.mjs";
import { assertPrincipal, seesEverything } from "../portal-access.mjs";

export async function connectRoutes({ demo, audit, auditLog, INSTALL_ROOT, connectCaches }, { method, parts, identity, principal, body }) {
  // ── ONE READING OF THE CONNECTOR'S OWN DOOR, CACHED ────────────────────────────────────────────────
  //
  // The same unauthenticated probe `doctor` makes, asked here so the connector steps follow what the door
  // actually answers. Bounded three ways, because this sits on a page load: a short timeout, a one-minute
  // cache, and a failure that answers `null` rather than throwing — a page that cannot read its door says
  // so, which is the honest half of this change.
  //
  // Both caches live on the service (`connectCaches`, made once in makePortalService), not here: this
  // function runs once per request, and a cache declared in it starts empty on every one.
  // ── WHETHER A READER HAS AN ASSISTANT ON THIS INSTALLATION ────────────────────────────────────────
  //
  // The only evidence either process holds is the connector's own access log: enrolment says a person MAY
  // connect, never that they did. `readConnections` is the connector's reader, imported rather than
  // rebuilt here — the path this log lives at is the connector's fact, and a portal deriving it from its
  // own environment is how a live key's record nearly got struck on a split install.
  //
  // TWO INSTALLATION SHAPES, AND THE SPLIT IS THE ONE THE ROUTE ALREADY MAKES. A hosted install has a
  // published client door and many signed-in people, so the question is answered per person: is this
  // email in the log. A local install has no client door, one reader, and a connector that cannot know
  // who it is serving — so the local route's own record answers for the only person who could be asking.
  // Reading a local record as an answer on a HOSTED install would mark every reader connected the moment
  // one member of staff ran the server by hand, which is why it is gated on there being no client door.
  //
  // Returns null, never false, when there was nothing to read. See the route for why that matters.
  //
  // CACHED FOR A MINUTE, the same as the door probe above and for the same reason: this is a page load,
  // not a check. It runs on every report a reader opens, and reading the tail of a log each time to
  // answer a question whose answer changes once, ever, would be paid on the client-facing screen.
  // KEYED ON THE FILES IT READ, not on time alone. The log's location is configuration and does not move
  // under a running service — but a cache that ignored it would answer about the wrong file for a minute
  // after it did, and it is what makes this cache testable at the route rather than only at the helper.
  const CONNECTIONS_TTL_MS = 60_000;

  async function readerHasConnectedAi(principal) {
    const email = String(principal?.email ?? "").trim().toLowerCase();
    let seen = null;
    // Imported here rather than at the top, the way every other reach into mcp-server/lib from this file
    // is: the driver does not depend on the connector, and the import-cycle walk is what keeps it so.
    let audit = null;
    try { audit = await import("../../mcp-server/lib/audit.mjs"); }
    catch { return null; }                                            // best-effort: never fail a page load
    const key = audit.auditPaths().join("\u0000");
    const cached = connectCaches.connections;
    if (cached.seen && cached.key === key && Date.now() - cached.at < CONNECTIONS_TTL_MS) {
      seen = cached.seen;
    } else {
      try { seen = audit.readConnections(); } catch { return null; }
      connectCaches.connections = { at: Date.now(), key, seen };
    }
    if (!seen.available) return null;
    if (email && seen.emails.has(email)) return true;
    if (!process.env.CLEAROTRON_CLIENT_MCP_URL && seen.local) return true;
    return false;
  }

  const DOOR_KIND_TTL_MS = 60_000;
  async function connectorDoorKind(url) {
    if (!url) return null;
    const now = Date.now();
    const cached = connectCaches.door;
    if (cached.url === url && now - cached.at < DOOR_KIND_TTL_MS) return cached.kind;
    let probe = null;
    try {
      const res = await fetch(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(2000) });
      let body = null;
      if (res.status === 401) { try { body = (await res.text()).slice(0, 400); } catch { body = null; } }
      probe = { ok: res.status < 500, status: res.status, error: null, challenge: res.headers.get("www-authenticate"), body };
    } catch (e) { probe = { ok: false, status: null, error: String(e?.cause?.code ?? e?.name ?? e?.message ?? e) }; }
    const kind = doorKind(probe);
    connectCaches.door = { at: now, url, kind };
    return kind;
  }

  if (parts[1] === "api" && parts[2] === "mcp-access" && method === "GET") {
    assertPrincipal(principal, { door: true });   // throws PortalDeny(403) for an unmapped identity
    const url = process.env.CLEAROTRON_CLIENT_MCP_URL || null;
    const keyUrl = process.env.CLEAROTRON_AGENT_MCP_URL || null;
    // ── THE ROUTE THAT NEEDS NO ADDRESS ──────────────────────────────────
    //
    // Both addresses above are null on a local install and always will be: there is no hosted door
    // to point at. The surfaces built on them then render nothing — correctly, by their own rule —
    // and the owner met that as a wall on his own first install, with the one route that DOES work
    // sitting unmentioned on his disk.
    //
    // STAFF ONLY, and that boundary is honest rather than a guess about deployment shape. The
    // command is a true fact about THIS INSTALL'S OWN DISK, useful to anyone with a shell on the
    // box and useless to a hosted client who has no checkout. On a local install the reader IS the
    // operator, which is why the split that already exists does the work an "is this deployment
    // local" inference would have done badly. Agreed before building, because it
    // changes what a signed-in staff user is shown.
    //
    // COMPOSED IN ONE PLACE and handed over as a string. The browser cannot know this install's
    // path, so the three surfaces stating this route cannot drift apart even if someone tries.
    //
    // AND IT NAMES THE DISTRIBUTION, like every other surface that states this route. Without the
    // target this one composer answers as it does for an install that is not under WSL at all, so on
    // a WSL box this field alone carried the inside-WSL line while the rows beside it led with the
    // Windows-side one. Nothing draws this field today; it is on the wire, and a field that answers
    // differently from the rows is a trap for whoever draws it next.
    const stdio = seesEverything(principal)
      ? stdioConnectOffer({ workDir: process.env.CLEAROTRON_WORK_DIR || null, reportsDir: process.env.CLEAROTRON_REPORTS_DIR || null, wsl: wslTarget(), demo: isDemo(process.env) })
      : null;

    // ── THE PAGE IS HANDED ANSWERS, NOT FACTS TO REASON FROM ─────────────
    //
    // The browser used to hold its own client table on its own axis — `door` × `reach` — and derive
    // offered-versus-withheld from `url`, `keyUrl` and `enabled`. Two tables partitioning the same
    // clients on different axes did not merely risk drifting; they had already drifted. The page
    // said Codex needs a key address, which is `null` on a local install, so it named a one-line
    // command in its own instructions and then rendered no command. That is this issue's defect,
    // living inside the page written to answer it.
    //
    // So the resolution happens HERE, once, through `shared/connect-clients.mjs`, and the page
    // renders what it is handed. This is not a preference for server-side logic: the install's own
    // filesystem path is not a browser fact, and any derivation needing it must happen where it is
    // known. `assistantsFor` and `addressFor` are DELETED rather than kept in step, because a
    // second author kept in step by hand is exactly what broke.
    //
    // STAFF-ONLY STDIO SURVIVES THE MOVE. The command is a true fact about this install's own disk
    // — useful to anyone with a shell on the box, useless to a hosted client who has no checkout —
    // so a client is handed no stdio routes at all and the rows that need one resolve to a stated
    // absence rather than to a command they cannot run.
    const offers = connectOffers({
      stdioRoutes: stdio
        ? Object.fromEntries(Object.keys(STDIO_SHAPES).map((shape) =>
            [shape, stdioConnectFor(shape, { workDir: process.env.CLEAROTRON_WORK_DIR || null, reportsDir: process.env.CLEAROTRON_REPORTS_DIR || null, wsl: wslTarget(), demo: isDemo(process.env) })]))
        : {},
      wsl: isWsl(),
      nameClaude: claudeNamer(),
      demo: isDemo(process.env),
      // ONE ADDRESS, and it is the publicly reachable one ( §5). The
      // `localAddress` and `clientDoorStanding` inputs are gone with the axis that read them: no
      // surface serves a loopback address to anybody, and the door's running-or-not stopped being
      // a question the moment it auto-started with the product.
      publicAddress: url,
      // THE KEY DOOR'S OWN HOST, when one is deployed. Beside a sign-in door its steps ride along for
      // the page to fold away; they are never resolved against `url`, which refuses a key.
      keyAddress: keyUrl,
      operator: principal.email ?? null,
      // WHAT THE DOOR ANSWERS, read from the door rather than assumed by the row. The steps used to
      // be fixed: Claude's said to paste a key and set authentication to None, which is right for a
      // self-hosted door and cannot work on any deployment behind an identity provider — the key is
      // minted for nothing and the warning the reader is told to ignore IS the sign-in. Cached
      // because this is a page load, not a check: one reading serves every reader for a minute, and
      // a door that could not be read leaves this null so the page says so instead of guessing.
      door: await connectorDoorKind(url),
    });
    return { status: 200, json: {
      url,                                   // null ⇒ the UI keeps its honest empty state
      keyUrl,                                // the API-key door; null until it is deployed
      email: principal.email ?? null,        // the identity to sign in with — what they already use
      enabled: !!url,
      stdio,                                 // the local route, or null for a client
      // ── HAS THIS READER ALREADY CONNECTED AN ASSISTANT? ──────────────────────────────────────
      //
      // Folded into this route rather than given its own, because the Ask-AI control on a report
      // already loads it and a second request per report open buys nothing.
      //
      // `null` IS A THIRD STATE AND THE SCREEN HAS TO DRAW IT. True, false and "no log to read" are
      // different facts: an installation whose access log has not been written yet, or cannot be
      // read, has not told us this reader never connected — it has told us nothing. The control
      // treats null the way it treats false, because offering the menu to somebody with no
      // assistant reproduces the defect this is fixing, and because the panel carries its own way
      // past ("Already connected? Ask anyway"). What it must not do is claim the measurement.
      aiConnected: await readerHasConnectedAi(principal),
      // Every client, already resolved: served or not, with what it needs or why it cannot be.
      //
      // ── `steps` COMES BACK, on the owner's 2026-09-03 ruling ─────────
      //
      // It was dropped here deliberately under his 2026-08-31 cut, which said the page shows no
      // recipes and the per-assistant blocks "become the one italic link at the bottom". His
      // re-inspection reverses that for one specific thing: *"The page must lead each vendor with
      // the path that vendor's UI user actually takes; a CLI command is at most a collapsed
      // 'advanced' detail."*
      //
      // The two rulings are consistent once you separate what was actually objected to. "Settings →
      // Connectors → Add custom connector" is not a recipe in the sense the cut banned — it is the
      // reader's OWN vocabulary, three taps in an app they already have open. The technical thing,
      // the part irrelevant to a reader connecting from Cowork, is the command, and that is what moves behind
      // a fold. So the steps travel and the command demotes.
      //
      // They are resolved HERE and not composed in the browser, for the reason this route already
      // exists: the step that names an address must name the address this deployment actually
      // resolved, and a page that built its own would drift from it.
      offers: offersForWire(offers),
    } };
  }

  // /portal/api/connect-key — mint THIS caller's own access, for the clipboard, never for the page.
  //
  // ── THE OWNER'S RULING, 2026-08-31 ───────────────────────────────────────────────────────────
  //
  // *"The page never shows a key, in any state."* Three reasons he gave, and the second is the one
  // that shapes this endpoint: *"A rendered key outlives the moment. It's in the DOM, in the
  // screenshot someone takes, in the browser cache, on a screen left open. A key that's never text
  // on a page has none of that."*
  //
  // So the key still reaches the browser — a clipboard write needs it — and never becomes text. The
  // page holds it in a local variable for the length of one press.
  //
  // ── MINTED PER CALLER, AND `sub` NEVER COMES FROM THE REQUEST ────────────────────────────────
  //
  // The rule this replaces existed because a key shown on a shared page made one person's
  // credential everyone's. Moving it to the clipboard does NOT answer that on its own: anybody who
  // loads the page can still press the button. What answers it is that each press mints a key for
  // THE CALLER, from the authenticated principal and never from anything the request said — so a
  // colleague pressing it gets their own credential, attributable in the audit log and revocable by
  // name, rather than a copy of somebody else's.
  //
  // ENROLMENT IS CHECKED FIRST, for the same reason `clearotron connect` checks it: a key issued to
  // an identity the guest list has never heard of authenticates and is then refused on every
  // request, which is a credential that opens nothing and a reader who believes they are finished.
  if (parts[1] === "api" && parts[2] === "connect-key" && method === "POST") {
    assertPrincipal(principal, { door: true });
    const url = process.env.CLEAROTRON_CLIENT_MCP_URL || null;
    if (!url) return { status: 409, json: { error: "no_connector" } };
    const identity = principal.email ?? null;
    if (!identity) return { status: 403, json: { error: "no_identity" } };
    // Enrolled means a principal exists: the door check above has already refused an address with no
    // access anywhere. Asking for a company list here instead read a person whose only reach is their
    // organisation's Generic as not enrolled.
    let key;
    try { key = mintToken({ scope: "account", sub: identity, ttlSec: 90 * 24 * 3600 }); }
    catch { return { status: 503, json: { error: "cannot_issue" } }; }
    auditLog(`connect-key issued for=${identity}`);   // WHO, never WHAT — the token itself is never logged
    return {
      status: 200,
      json: { address: url, key },
      // NEVER CACHED, by any hop. A credential sitting in a proxy or a disk cache is the "outlives
      // the moment" failure the ruling is about, arriving by a route the page cannot see.
      headers: { "cache-control": "no-store, no-cache, must-revalidate, private", "pragma": "no-cache" },
    };
  }

  // /portal/connect-help — the by-hand setup instructions, for the one link the page carries.
  //
  // ── WHY THIS ROUTE EXISTS AT ALL ─────────────────────────────────────
  //
  // The owner's cut ends the Use-your-AI page with *"Not connecting? [Set it up by hand](…)"* and
  // left the target open. There was no document route on this portal, so the link had nowhere to
  // go — and a link to nowhere is the same defect class as a button that cannot work. The
  // instructions already exist and carry exactly the recipes the cut removed from the page, so this
  // serves them rather than inventing a fourth description of how to connect.
  //
  // THE SIX BANNED WORDS DO NOT APPLY HERE, deliberately. "No connector, no key, no address" is a
  // rule about the PAGE, whose reader is choosing an assistant and nothing else. This is the escape
  // hatch for the reader who wants the mechanism, and withholding the vocabulary from them would
  // make the page's simplicity a lie rather than a kindness.
  //
  // READ-ONLY, DOOR-CHECKED, AND SERVED AS ESCAPED TEXT. It runs nothing and loads nothing, so it
  // gets `docCsp()` rather than the report policy, which permits inline script for frozen artefacts
  // that need it. Before this shipped the document named the private repository in an illustrative
  // path six times; nothing that reaches a client may carry that, so the placeholder now names the
  // install. Anything added to that file is published by this route — check it before you add it.
  if (parts[1] === "connect-help" && method === "GET") {
    assertPrincipal(principal, { door: true });
    let md;
    try { md = readFileSync(join(INSTALL_ROOT, "mcp-server", "CONNECT.md"), "utf8"); }
    catch { return { status: 404, json: { error: "not_found" } }; }
    return { status: 200, doc: md };
  }

  return undefined;
}
