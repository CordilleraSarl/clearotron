// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// WHICH ASSISTANT, AND WHAT THAT ONE NEEDS — the whole connect decision, as data.
//
// ── THE OWNER'S QUESTION, AND WHY THIS FILE IS A TABLE ───────────────────────────────────────────
//
//, after he walked his own install and could not connect anything: *"i dont
// understand, i can access the UI at 127.0.0.1 but i cant access the MCP server? … i didnt need to mint
// a key for the UI or open a tunnel i just ran clearotron start?"* And then: *"AND it might not just be
// cowork, it might be chatgpt or perplexity. or [another agent platform]. COME ON MAN. this shouldn't
// be so hard."* (One platform he named is not named back: this product does not require it, and a
// product that lists an integrator by name starts describing itself in terms of what it happens to run.
// Any agent of that shape is served by the "Another agent" row, which is what that row is for.)
//
// He is right that it should not be hard, and his second message is what makes it easy. The thing that
// varies is NOT the reader's network. It is WHAT EACH CLIENT CAN ACCEPT — a property of the client,
// which we know and the reader should never have to work out:
//
//   accepts "stdio"  the client can spawn a local process. It needs a command and NOTHING else: no key,
//                    no address, no port, no tunnel. This is the whole answer and readers do not
//                    believe it, having just been told about tunnels — so the copy says it plainly.
//   accepts "http"   the client speaks to an address and proves itself with a key. That address is
//                    ALWAYS the publicly reachable one — see below.
//   accepts "either" we do not know what the reader's agent can do, so we say both and let them pick.
//
// ── THE `runsOn` AXIS IS DELETED, AND WAS A LIVE FALSE OFFER ( §3, §9) ─────────
//
// It used to sit beside `accepts` and answer "which address is enough": `readers-machine` got loopback,
// `vendor-cloud` got the public one. The distinction does not exist. From the vendor's own help centre:
//
//   "Claude connects to your remote MCP server from Anthropic's cloud infrastructure, rather than from
//    your local device. This is true across every Claude client, including claude.ai, Claude Desktop,
//    Cowork, and the mobile apps." … "Your MCP server must be reachable over the public internet from
//    Anthropic's IP ranges."
//
// Cowork RUNS on the reader's machine and CONNECTS from the vendor's cloud; the axis conflated the two
// and classified it `readers-machine`, so `clearotron connect --client cowork` printed a loopback
// address that Cowork rejects — today, in the shipped product. HTTPS only; plain HTTP is refused too.
//
// So the axis is gone rather than corrected. Correcting it would leave a field that is now fully
// determined by `accepts` — a second name for one fact, and an invitation to branch on it again.
//
// So the tunnel is not a mode anybody chooses. It is what every `accepts: "http"` row requires, and
// picking Claude Code never mentions it.
//
// ── WHY THIS TABLE REPLACED THE BROWSER'S OWN ───────────────────────────────
//
// There were TWO tables. This one, and `portal-ui/src/contract/assistants.ts`, which carried its own
// axis — `door: browser|key|either` × `reach: remote|local` — and its own offered/withheld derivation.
// Two tables partitioning the same clients on different axes do not merely risk drifting; they had
// already drifted before either was finished. The page said Codex needs a key address. This table says
// Codex needs no key at all. On a local install the page's answer resolved to `null`, so the page named
// a one-line command in its own instructions and then rendered no command — which is tracker issue
// 1976's defect, sitting inside the page written to answer it.
//
// So the browser no longer derives any of this. It is handed resolved rows and renders them. That is not
// a preference for server-side logic: the install's own filesystem path is not a browser fact, and any
// derivation that needs it must happen where it is known. `assistantsFor`, `addressFor` and the `reach`
// axis are DELETED rather than kept in step, because a second author kept in step by hand is the thing
// that broke.
//
// ── DATA, NOT BRANCHES ───────────────────────────────────────────────────────────────────────────
//
// "The list of clients is data, not code branches — adding one is a row." A single `if (id === 'codex')`
// anywhere downstream is the seed of the same drift: the branch and the row disagree, both still render,
// and the reader follows whichever one is wrong. `driver/test/connect-clients-are-data.test.mjs` refuses
// a client name in a conditional on every surface that renders these rows.

/**
 * Every client we can speak to, and what it can accept. Adding one is a row.
 *
 * `steps` is a function of what the deployment resolved, not a fixed list, because the instruction for
 * a browser-door assistant names an email and the instruction for a stdio assistant names a command.
 * Interpolating them here keeps the recipe and the address that recipe refers to in one place.
 */
/* ── item 5 — THESE SENTENCES ARE READ BY A LAWYER, NOT AN ENGINEER ─────────
   The owner quoted two of them back as fails: "this installation is not running yet, so there is
   nothing for an assistant to connect to" ("very confusing") and "connects from its vendor's servers,
   so it cannot reach a machine that is not published to the internet … under a name that resolves"
   ("who cares about vendors servers etc if you are a UI user … resolves, vendors severs, wtf?").

   Every one of them now says the same fact as WHAT HAPPENS NEXT and WHO DOES IT. No vendor's servers,
   no name resolution, no processes, no checkouts — the four things a reader cannot act on.

   AND NONE OF THEM MAY SAY "address" OR "key". These rows render on the ARRIVING page, before any
   press, and `scripts/ai-page-render-check.mjs` refuses six words on every line an arriving reader
   sees. That constraint is why the old sentence reached for "a name that resolves" instead of the
   obvious word, and it is worth knowing before rewriting one of these: the plain word is "on the web".

   WHICH of these states should exist at all is a different question and not this issue's — it is open
   with the owner as  Q1, and his Settled 4 may delete the
   local one entirely. Wording them honestly costs nothing if it does. */
/* ── THE LAUNCH ROUTE ( settled 8; owner: "fastest possible way to reach 'chat about
   my report'") ────────────────────────────────────────────────────────────────────────────────────────

   A row MAY carry `launch: { url, verifiedOn, by }` — a page a press can open so the reader lands in
   their assistant with the connector in front of them, instead of being told where to click.

   NO ROW CARRIES ONE TODAY, and that is a statement rather than an omission. The ruling is "where a
   vendor allows launching directly, launch; otherwise the shortest possible paste", and which vendors
   allow it is a fact about their product that somebody has to DRIVE before we can claim it. A URL
   written here from memory would be a button that looks like it works and does not — the exact class
   this file exists to prevent, and the one the owner has already met twice.

   So the mechanism is built and the data is empty. Populating it is one row plus the evidence:
   `verifiedOn` is the date it was driven and `by` is who drove it, and `connect-clients-are-data`
   REFUSES a launch URL that carries neither. Nobody has to touch the page.  */
export const CONNECT_CLIENTS = Object.freeze([
  // ── Runs on the reader's own machine and can spawn a process: needs NOTHING but a command. ──────
  {
    id: "claude-code", name: "Claude Code", accepts: "stdio", stdioShape: "claude-cli",
    steps: ({ command }) => [
      "Paste it into a terminal on this machine and run it",
      "Then ask it to brief you on this service — it reads its own instructions",
      ...(command ? [] : ["(this copy of the software is incomplete — whoever installed it will need to install it again)"]),
    ],
  },
  {
    id: "codex", name: "Codex CLI", accepts: "stdio", stdioShape: "codex-toml",
    steps: () => [
      "Paste it into a terminal on this machine and run it",
      "Then ask it to brief you on this service — it reads its own instructions",
    ],
  },
  {
    // NOT A SEPARATE PRODUCT (tracker issue 147; owner: "there is no such thing as desktop"). This is
    // Claude reached the way that runs on the reader's own machine, so it carries Claude's name and says
    // which way it is in the sub-label. The `desktop-json` stdio shape is unchanged — what moved is what
    // a reader is told this is, not how it connects.
    id: "claude-desktop", name: "Claude", sub: "app, on this computer", accepts: "stdio", stdioShape: "desktop-json",
    steps: () => [
      "Paste it into Claude Desktop's own settings file — Advanced, under these steps, names the file",
      "Restart Claude Desktop, and this service appears in its tools",
    ],
  },

  // ── Speaks HTTP. Connects from the vendor's own servers. ────────────────────────────────────────
  //
  // ONE ROW, BECAUSE IT IS ONE APP (tracker issue 147, owner ruling in session: "you know its just ONE
  // APP on a laptop which has cowork and code in it and claude is what its called"). `cowork` was a
  // separate row here and is merged in; the sub-label carries where it is met, which is a fact about the
  // reader's screen rather than about our software.
  //
  // THE STEPS BELOW WERE DRIVEN, NOT RECALLED, and the merge is what settles which of two contradictory
  // sequences survives. This row previously said "Connect, then sign in when the browser opens" — nobody
  // ever drove that. The cowork row said something different and somebody had: the owner connected on
  // 2026-09-04 by pasting the address, setting Authentication to None, and adding an
  // `Authorization: Bearer <key>` request header. Both rows described the same app reaching the same
  // door — `accepts: "http"`, one `public-http` offer, same address, same press — so they were never two
  // routes to keep apart. They were one app described twice, and only one description was observed.
  //
  // The earlier defect in the same class, kept here because it is the reason the rule exists: the row
  // used to end "Choose API key, and paste the second line we copied", and there is no API key control
  // in that dialog. A client following it went looking for a box that is not the way in, on the page
  // whose entire job is to get them connected.
  //
  // The warning travels with the steps and is not optional: Claude tags the server "Always required ·
  // Detected" because it probes and infers OAuth. `None` is still correct despite the orange box, and a
  // reader who is not told that will assume they have done it wrong.
  {
    id: "claude", name: "Claude", sub: "app, web, and Cowork", accepts: "http",
    verifiedOn: "2026-09-04", by: "owner",
    steps: ({ address }) => [
      "Settings → Connectors → Add custom connector",
      `Paste ${address ?? "the first of the two lines we copied"}`,
      "Set Authentication to None",
      "Add a request header: Authorization = Bearer, then the second line we copied",
      "Add. If it warns that authentication is required, that is its own guess — None is correct here",
    ],
  },
  {
    id: "chatgpt", name: "ChatGPT", accepts: "http",
    steps: ({ address, operator }) => [
      "Settings → Connectors → Advanced → Developer mode",
      `Add MCP server, paste ${address ?? "the first of the two lines we copied"}`,
      `Sign in when the browser opens (${operator} email)`,
    ],
  },
  {
    // UNDRIVEN, AND WORDED LIKE IT (tracker issue 148; the owner drives this vendor himself this
    // week and the dated stamp appears then). The old second step named "API Key" as the control to
    // choose — the same assertion-from-no-observation that made the cowork row send clients hunting
    // for a box that is not the way in. Two lines and a place to put each is what we actually know.
    id: "perplexity", name: "Perplexity", accepts: "http",
    steps: ({ address }) => [
      "Settings → Connectors → Add connector, choose a custom MCP server",
      `Paste ${address ?? "the first line we copied"} as the server address`,
      "Give it the second line we copied as the credential, wherever it asks for one",
    ],
  },

  // ── Anything else. We do not know what it can do, so we do not pretend to. ──────────────────────
  {
    id: "other", name: "Another agent", accepts: "either", stdioShape: "generic-json",
    steps: () => [
      "If your agent can run a local command, paste what we copied and run it — it needs nothing else",
      "If it can only reach a web link, use Advanced under these steps, which carries both lines it wants",
    ],
  },
]);

/**
 * The offers as they go ON THE WIRE, composed once for every caller that puts them there.
 *
 * ── WHY THIS IS A FUNCTION ────────────────────────────────────────────────
 *
 * There were two hand-written copies of this mapping: the portal route's, and the browser check's stub
 * of the portal route. They agreed until the day the shape changed, and then the check went red about
 * the page rather than about itself — the stub was still dropping a field the route had started to
 * send, so the real page rendered nothing and the arm reported that as the page's fault.
 *
 * A stub that restates a wire is a second author for one shape. This is the shape; both callers ask.
 */
// `sub`, `verifiedOn` and `by` ride only where the ROW carries them, and absent means absent rather than
// null (tracker issue 147). Two of the three are load-bearing on the page:
//
//   • `sub` is how one app can appear once per route without two rows claiming to be two products —
//     "Claude · app, web, and Cowork" and "Claude · app, on this computer" are one product met two ways.
//   • `verifiedOn`/`by` are what let the page show "✓ Checked <date>" on a row somebody actually drove
//     and NO stamp on one nobody did. A stamp defaulted onto an undriven row would be the file's own
//     defect class — asserting vendor behaviour from no observation — dressed up as evidence.
//
// So a row without them sends no key at all, and the page has nothing to render rather than something
// empty to render badly.
export const offersForWire = (offers) =>
  offers.map(({ client, steps, ...rest }) => ({
    id: client.id,
    name: client.name,
    ...(client.sub ? { sub: client.sub } : {}),
    ...(client.verifiedOn ? { verifiedOn: client.verifiedOn } : {}),
    ...(client.by ? { by: client.by } : {}),
    steps: Array.isArray(steps) ? steps : [],
    ...rest,
  }));

/** The client by id, or null. */
export const clientById = (id) => CONNECT_CLIENTS.find((c) => c.id === String(id ?? "").trim()) ?? null;

/**
 * What THIS client needs from THIS deployment. PURE — the caller supplies what the deployment has.
 *
 * THREE SHAPES, and the middle one is the owner's ruling (2026-08-31, "On demand is fine"):
 *
 *   served: true                      ready now — a command, or an address and a key.
 *   served: true,  enables: {...}     ready as soon as the reader says so. The connector door is not
 *                                     standing and turning it on is a real change to who can reach this
 *                                     install, so the row carries WHAT WOULD BE TURNED ON in words, and
 *                                     the caller states it before doing it. Never silently.
 *   served: false                     cannot be served here, with the reason and what would change it.
 *
 * `served: false` always carries `reason` and `fix`. An absence with no reason reads as breakage — the
 * defect `` closed on the knockout's Export menu, and the
 * defect this page had for every self-hosted reader.
 *
 * @param {object} client a row of CONNECT_CLIENTS
 * @param {{ stdioCommand?: string|null, publicAddress?: string|null, operator?: string|null }} have
 */
export function whatItNeeds(client, have = {}) {
  if (!client) return null;
  const {
    stdioRoutes = {}, publicAddress = null, operator = null,
  } = have;
  // THE ROUTE FOR THIS HOST'S OWN SHAPE, never a fallback to another host's. Handing a Codex user
  // `claude mcp add` is a command their machine does not have, delivered with confidence — the same
  // false-offer class as pointing Cowork at the door that refuses its key.
  const route = Object.hasOwn(stdioRoutes, client.stdioShape ?? "") ? stdioRoutes[client.stdioShape] : null;

  const withSteps = (offer) => ({
    ...offer,
    // The launch page, when this vendor has a driven one. Null everywhere today — see the note above
    // the table. Carried only on an offer that is actually served: opening a vendor's connector screen
    // for a deployment that has nothing to connect to is a worse answer than the refusal.
    launch: offer.served ? (client.launch ?? null) : null,
    steps: client.steps({ command: offer.command ?? null, address: offer.address ?? null, operator: operator ?? "your" }),
  });

  // ── stdio: the route that needs nothing, and the reason this issue has a happy answer at all. ───
  const stdioOffer = () => route
    ? withSteps({ client, served: true, route: "disk", command: route.text, stdio: route, address: null, key: null, enables: null,
        note: "Nothing to sign up for and nothing to open up — this assistant runs the software itself, from the copy already on this machine." })
    : withSteps({ client, served: false, enables: null,
        reason: "this copy of the software is incomplete, so there is nothing to hand your assistant",
        fix: "whoever installed it will need to install it again" });

  if (client.accepts === "stdio") return stdioOffer();

  // ── THE WEB DOOR — for every assistant that is not spawning the software itself ─────────────────
  //
  // ── THIS USED TO BE TWO BRANCHES AND THE FIRST ONE WAS A FALSE OFFER ( §3) ────
  //
  // There was a `localOffer()` here for assistants classified `runsOn: "readers-machine"` — Cowork and
  // "Another agent" — which served them a LOOPBACK address with the note "nothing to publish, nothing
  // to open up". It is refuted at source, by the vendor:
  //
  //   "Claude connects to your remote MCP server from Anthropic's cloud infrastructure, rather than
  //    from your local device. This is true across every Claude client, including claude.ai, Claude
  //    Desktop, Cowork, and the mobile apps." … "Your MCP server must be reachable over the public
  //    internet from Anthropic's IP ranges."
  //
  // Cowork RUNS on the reader's machine and CONNECTS from the vendor's cloud, and the axis conflated
  // those. `clearotron connect --client cowork` therefore printed an address Cowork rejects — a live
  // wrong answer, of exactly the class this file's own comments exist to prevent, and the reason the
  // owner's testing kept failing. HTTPS only; HTTP is refused as well.
  //
  // So there is ONE address now, the publicly reachable one, and no surface serves loopback to anybody.
  // Two rows in the whole model: an assistant that can launch a local process needs a command and
  // nothing else, and everything else — wherever it appears to run — needs the public address and a key.
  const webOffer = () => publicAddress
    ? withSteps({ client, served: true, route: "public-http", address: publicAddress, key: "issued",
        command: null, enables: null,
        note: "This assistant connects through its maker's service, so it reaches this installation at its web address rather than from your machine." })
    // ── THE ONE HONEST UNAVAILABLE ( §5) ────────────────────────────────────────
    // "Not available" is honest in exactly one case: this deployment has no public web address. It has
    // nothing to do with who is reading, and it is never bare — the copy names who enables it. The
    // state it replaces ("this service is not set up to take assistants yet") described the client door
    // not running, which under settled point 2 cannot happen: the door auto-starts with the product and
    // the key is the gate.
    // NOT "address", and not "key" either. These rows render on the ARRIVING page, before any press,
    // where `scripts/ai-page-render-check.mjs` refuses six words on every line a reader sees. The plain
    // word for a reader is "the internet", and it happens to be the truer one: what is missing is not a
    // string somebody forgot to type, it is that nothing outside this machine can reach the service.
    : withSteps({ client, served: false, enables: null,
        reason: `${client.name} reaches this service over the internet, and this installation is not on the internet yet`,
        // ── NAME THE ACTOR *AND* WHAT RESOLVES IT ( — F30) ─────────────────
        //
        // "whoever installed it can put it online" is written for a client looking at somebody else's
        // deployment. The person reading this in a terminal IS whoever installed it, and the sentence
        // named no command, no file and no document — while INSTALL.md §7 covers exactly this.
        // `connect` cannot do it itself either: the address comes from the installer's question or from
        // CLEAROTRON_CLIENT_MCP_URL, and neither was named.
        //
        // KEEPING THE ACTOR IS NOT A REGRESSION, and dropping it was a near-miss caught in review. This
        // row renders on TWO surfaces with two audiences: a terminal, where the reader is the operator
        // and "whoever installed it" names them uselessly, and the portal's own page, where a CLIENT
        // reads it and genuinely cannot do this themselves. For that reader, WHO resolves it is part of
        // what resolves it. So the sentence carries both — the actor, and the thing to set — which is
        // what the theme asked for and what neither wording alone delivered.
        fix: "whoever installed it can put it online — it takes about a minute and needs no account",
        // THE OPERATOR'S HALF, WHICH THE ARRIVING PAGE MUST NEVER RENDER ( — F30).
        //
        // Two audiences, two incompatible constraints, and one string cannot serve both. `fix` is read
        // by a lawyer on the arriving page, where `scripts/ai-page-render-check.mjs` refuses six words —
        // MCP, connector, token, scope, address, key — so it cannot name the variable OR the thing the
        // variable sets. The operator reading this in a terminal needs exactly those.
        //
        // I learned that by breaking it: F30's first fix put the variable name and "public address" into
        // `fix`, and the browser check caught both words on the page a client sees. The comment above
        // this table warns about it in as many words, and I had read it. So the row carries BOTH
        // registers as separate fields and each surface takes the one its reader can act on — which is
        // this file's own rule, data rather than a branch downstream.
        operatorFix: "put it online and set CLEAROTRON_CLIENT_MCP_URL to the public URL of this install — INSTALL.md §7 walks the tunnel" });

  if (client.accepts === "either") {
    // Both routes, because we do not know which one this agent can walk. The stdio answer LEADS: it is
    // the one that needs nothing, and an agent that can take it must not be sent to mint a key. Settled
    // point 6 makes that the rule for the whole page and not just this row.
    const stdio = stdioOffer();
    if (stdio.served) {
      // `stdio` CARRIES THROUGH. Without it the caller cannot tell a command from a config block, and
      // renders "run this once" over four lines of JSON — an instruction that reads as a shell command
      // and is not one. The shape is part of the answer, not decoration on it.
      return withSteps({ client, served: true, route: "either", command: stdio.command, stdio: stdio.stdio,
        address: null, key: null, enables: null,
        note: "Two ways in. Most agents take the configuration above and need nothing else. "
          + "If yours can only reach a web link, connect it that way instead." });
    }
    return webOffer();
  }

  // Everything else, wherever it appears to run.
  return webOffer();
}

/** Every client, resolved against one deployment. The page and the verb both render this. */
export const connectOffers = (have = {}) => CONNECT_CLIENTS.map((c) => whatItNeeds(c, have));
