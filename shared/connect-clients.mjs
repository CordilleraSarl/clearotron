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
// be so hard."*
//
// He is right that it should not be hard. The reader knows two things for certain: which app they use,
// and whether Clearotron is on the machine that app runs on. Everything else — a command or a settings
// block, an address, a key — follows from those two answers, so the product works it out and the reader
// is only ever asked the two questions.
//
// ── TWO ROUTES, AND EVERY APP TAKES BOTH ─────────────────────────────────────────────────────────────
//
//   disk          Clearotron is installed on the machine the app runs on. The app starts the server
//                 itself from the copy already there: no key, no address, no network.
//   public-http   Clearotron is running elsewhere. The app reaches its public address with a key minted
//                 for the person pressing. That address is ALWAYS the publicly reachable one — see
//                 below for why no loopback address is ever a true answer.
//
// This table used to give each row ONE of those, as an `accepts` axis, and it was wrong in both
// directions: Claude Code and Codex were offered only on this computer although both connect to a remote
// address with a key, and ChatGPT only remotely although its desktop app reads the same settings file as
// Codex. The owner met the result as a hosted install that "could never work from his laptop". So every
// row now carries both routes' steps, drawn from the approved design, and the page asks where
// Clearotron is running instead of guessing.
//
// ── DATA, NOT BRANCHES ───────────────────────────────────────────────────────────────────────────
//
// "The list of clients is data, not code branches — adding one is a row." A single `if (id === 'codex')`
// anywhere downstream is the seed of drift: the branch and the row disagree, both still render, and the
// reader follows whichever one is wrong. `driver/test/connect-clients-are-data.test.mjs` refuses a client
// name in a conditional on every surface that renders these rows.
//
// A STEP NAMES ITS COPY BY SHAPE, and never spells it. The strings a reader pastes are composed in
// `shared/stdio-connect.mjs`, once, and a row says which one its first step hands over. That keeps each
// command to one author (`driver/test/the-connect-route-has-one-author.test.mjs`) and lets two rows that
// take the same file — ChatGPT's desktop app and Codex both read `~/.codex/config.toml` — hand over the
// same bytes by construction rather than by care.
//
// STEP TEXT CARRIES TWO MARKS and nothing else: `**…**` for the name of a control the reader looks for,
// and a backtick pair for a literal they type or read back. The page draws them; the terminal prints the
// literal and drops the emphasis. Anything richer would be markup in data, which a surface then has to
// trust.
//
// ── THESE SENTENCES ARE READ BY A LAWYER, NOT AN ENGINEER ────────────────────────────────────────
//
// The owner quoted two earlier refusals back as fails: "this installation is not running yet, so there
// is nothing for an assistant to connect to" ("very confusing") and "connects from its vendor's servers,
// so it cannot reach a machine that is not published to the internet … under a name that resolves".
// Every refusal here says the fact as WHAT HAPPENS NEXT and WHO DOES IT.
//
// NO REFUSAL MAY SAY "address" OR "key". A refusal renders where an arriving reader can see it, and
// `scripts/ai-page-render-check.mjs` refuses six words on every line of the arriving page. The steps may
// use them: they appear only after the reader has picked an app, which is the moment those words start
// meaning something to them.
//
// ── THE LAUNCH ROUTE ( settled 8; owner: "fastest possible way to reach 'chat about my report'") ──
//
// A row MAY carry `launch: { url, verifiedOn, by }` — a page a press can open so the reader lands in
// their assistant with the connector in front of them. NO ROW CARRIES ONE TODAY, and that is a statement
// rather than an omission: which vendors allow it is a fact somebody has to DRIVE, and a URL written here
// from memory would be a button that looks like it works and does not. `connect-clients-are-data`
// REFUSES a launch URL that carries no date and no name.

import { KEY_SLOT, STDIO_SERVER_NAME, remoteConnectFor } from "./stdio-connect.mjs";

/** The two places Clearotron can be, relative to the reader's app. The page asks; the terminal flags. */
export const ROUTES = Object.freeze(["disk", "public-http"]);

/** The terminal's spelling of the same question: `--where here|elsewhere`, from the reader's side. */
export const WHERE_FLAG = Object.freeze({ here: "disk", elsewhere: "public-http" });

// Hints more than one row uses. One spelling each, so two apps cannot describe one fact two ways.
const KEY_HINT = "The key is made for you when you press, and is not shown again.";
const CHECK_HINT = `To check: \`claude mcp list\` shows \`${STDIO_SERVER_NAME} ✓ Connected\`.`;
const BRIEF = "ask it to brief you on your clearances.";

// THE SIGN-IN, NAMING THE ACCOUNT TO USE — one spelling for every row whose door signs its reader in. The
// address is emphasised because it is what the reader picks in the browser's sign-in window, the way a
// control's name is what they look for in a dialog. With no address known it names the kind of account.
const signInAs = (operator) =>
  `Sign in when the browser opens — use ${operator ? `**${operator}**` : "your work email"}.`;

// THE LAST STEP IS A QUESTION THAT PROVES THE CONNECTION. It reaches the connector's run-listing tool, so a
// reply listing clearances is the connection working, seen from the reader's own assistant.
const TRY_IT = "Try it: in your assistant, ask **“Show my recent Clearotron clearances.”** "
  + "A reply listing them confirms the connection.";

// ── WHICH DOOR THIS DEPLOYMENT HAS, AND WHY EVERY HOSTED ROW ASKS ───────────────────────────────────
//
// The hosted steps were fixed text. Claude's said: paste the address and a freshly minted key, set
// Authentication to None, add an `Authorization: Bearer` header, and ignore the authentication warning
// Claude shows. They were driven, once, against a door that took a key.
//
// Every hosted deployment we run sits behind an identity provider, and those doors answer an
// unauthenticated request with a sign-in challenge and never honour a key. So on production those steps
// could not work: the key was minted for nothing, and "ignore the warning" told the reader to ignore the
// one correct signal on the screen — the assistant had detected the sign-in challenge and said so. The
// page's own ChatGPT row said the opposite on the same page, which is how the owner met it.
//
// So the steps follow WHAT THE DOOR ANSWERS. `door` is one reading, taken once by the caller from the
// challenge the portal already probes for `doctor` and the reachability check, and handed to every row:
//
//   "sign-in"  the door answers a Bearer/OAuth challenge — address only, sign in when the browser opens
//   "key"      the door takes an access key — the key steps
//   null       it could not be read, and the page says so and shows both rather than guessing
//
// NEITHER ROUTE IS DELETED. A bare self-hosted install with no provider in front is the key door, and it
// is the only route that works there. A hosted deployment may run a key door too, as a separate host
// (`keyAddress`), for assistants that cannot follow a browser sign-in: see `keySteps` below.
export const DOOR_KINDS = Object.freeze(["sign-in", "key"]);
// NO HINT UNDER THE SIGN-IN DOOR'S FIRST STEP. There was one — "No key: this connector signs you in
// through your browser, and the sign-in is the authentication your assistant is asking about." — and the
// approved design (2026-09-16) removes it rather than rewording it: the sign-in step says the same thing
// where the reader does it, and a sentence under step one said it twice.
//
// THE UNKNOWN DOOR IS THE PAGE'S SENTENCE, NOT A STEP HINT. A hint once said "both ways are shown" while
// one set was drawn — a promise the page could not keep — in the words that screen is not allowed to show
// a reader. The panel states it once, above both lists, and the lists make it true.

/**
 * Every app we can speak to, and the steps for each route. Adding one is a row.
 *
 * `routes[route]` is `{ steps(ctx) }`: the reader's steps, in order, as `{ text, copy?, hint? }`. Step 1
 * is always the copy — the one thing the reader takes away — and `copy` names a shape in
 * `shared/stdio-connect.mjs` (a stdio shape on disk, a remote shape on the web). `ctx` carries what the
 * deployment resolved that a sentence may name: today, the operator's sign-in identity.
 *
 * `lead` is the route a caller gets when it names none — the terminal's `--client` without `--where`.
 * It is the route each row was served on before both existed, so a scripted invocation keeps doing what
 * it did. `aliases` are ids a row answered to before rows merged, each with the route it meant; old
 * scripts and old muscle memory keep working, and nothing else reads them.
 */
export const CONNECT_CLIENTS = Object.freeze([
  {
    id: "claude", name: "Claude", lead: "public-http",
    // ONE ROW, BECAUSE IT IS ONE APP ("you know its just ONE APP on a laptop which has cowork and code in
    // it and claude is what its called and there is no such thing as desktop"). `cowork` and
    // `claude-desktop` were rows once; they answer here now, each on the route it used to mean.
    aliases: { cowork: "public-http", "claude-desktop": "disk" },
    routes: {
      disk: {
        steps: () => [
          { text: "Copy this.", copy: "desktop-json" },
          { text: "In the Claude desktop app, open **Settings → Developer → Edit Config** and paste it in.",
            hint: `Other servers already there? Add just the \`${STDIO_SERVER_NAME}\` entry inside \`mcpServers\`.` },
          { text: `Restart the Claude app. \`${STDIO_SERVER_NAME}\` appears in its tools.`,
            hint: "Desktop app only — Claude on the web or your phone can’t reach this machine." },
        ],
      },
      "public-http": {
        // DRIVEN, NOT RECALLED: the owner connected on 2026-09-04 by pasting the address, setting
        // Authentication to None, and adding an `Authorization: Bearer <key>` request header.
        verifiedOn: "2026-09-04", by: "owner",
        steps: ({ door, operator }) => (door === "key" ? [
          // THE KEY DOOR, the driven steps with the address and the key as two presses, each at the step
          // that uses it — so the key is minted when the reader reaches the header it goes in.
          //
          // NO STEP MENTIONS AN AUTHENTICATION WARNING. The last step used to add "If Claude shows an
          // authentication warning, ignore it." Nothing here records that warning's text, so the step
          // told a reader to ignore a message it could not quote, and on a door behind an identity
          // provider that warning IS the sign-in. The approved design (2026-09-16) drops the sentence
          // rather than rewording it.
          { text: "Copy the address.", copy: "address" },
          { text: "In Claude, open **Settings → Connectors → Add custom connector**." },
          { text: "Paste the address." },
          { text: "Set **Authentication** to **None**." },
          { text: "Add a request header: **Authorization** = `Bearer`, then the key.", copy: "key", hint: KEY_HINT },
          { text: "Press **Add**." },
        ] : [
          // THE SIGN-IN DOOR. No key is minted and no header is set: the sign-in in step four is the whole
          // of the authentication, and step five is how the reader sees it worked.
          { text: "Copy the address.", copy: "address" },
          { text: "In Claude, open **Settings → Connectors → Add custom connector**." },
          { text: "Paste the address and press **Add**." },
          { text: signInAs(operator) },
          { text: TRY_IT },
        ]),
      },
    },
  },
  {
    id: "claude-code", name: "Claude Code", lead: "disk",
    routes: {
      disk: {
        steps: () => [
          { text: "Copy this.", copy: "claude-cli" },
          { text: "Paste it into a terminal on this computer and press Enter." },
          { text: `Start Claude Code and ${BRIEF}`, hint: CHECK_HINT },
        ],
      },
      // From the vendor's documentation, 2026-09-11; not yet driven against a hosted install.
      "public-http": {
        steps: ({ door }) => (door === "key" ? [
          { text: "Copy this command.", copy: "claude-cli-http", hint: KEY_HINT },
          { text: "Paste it into a terminal and press Enter." },
          { text: `Start Claude Code and ${BRIEF}`, hint: CHECK_HINT },
        ] : [
          // The command carries no header, because a door that signs its reader in never honours one.
          { text: "Copy this command.", copy: "claude-cli-http-signin" },
          { text: "Paste it into a terminal and press Enter." },
          { text: "Sign in when the browser opens." },
          { text: `Start Claude Code and ${BRIEF}`, hint: CHECK_HINT },
        ]),
      },
    },
  },
  {
    id: "chatgpt", name: "ChatGPT", lead: "public-http",
    routes: {
      // The ChatGPT desktop app reads Codex's settings file (the vendor's documentation, 2026-09-11), so
      // it takes Codex's shape and the same bytes. ChatGPT on the web cannot start a local server.
      disk: {
        steps: () => [
          { text: "Copy this.", copy: "codex-toml" },
          { text: "Open `~/.codex/config.toml` and paste it at the end.",
            hint: "The ChatGPT desktop app reads the same settings file as Codex." },
          { text: "Restart the ChatGPT app.",
            hint: "Desktop app only — ChatGPT on the web or your phone can’t reach this machine." },
        ],
      },
      // The address and no key: ChatGPT signs its reader in through the browser. The Developer-mode path
      // is the one the vendor documents today; the older "Connectors → Advanced" path was stale.
      "public-http": {
        steps: ({ operator, door }) => (door === "key" ? [
          // A DOOR THAT TAKES ONLY A KEY MAKES "sign in" WRONG HERE TOO, which is the same defect as
          // Claude's pointed the other way — a self-hosted reader told to sign in to something that
          // never asks them to.
          { text: "Copy your address and key.", copy: "address-and-key", hint: KEY_HINT },
          { text: "In ChatGPT on the web, turn on **Settings → Security and login → Developer mode**.",
            hint: "Needs a Plus, Pro, Business, Enterprise or Edu plan. On a company plan, your admin may have to allow it." },
          { text: "Add a custom connector and paste the address." },
          { text: "Give the key as the connector's bearer token — the second line." },
        ] : [
          { text: "Copy the address.", copy: "address", hint: undefined },
          { text: "In ChatGPT on the web, turn on **Settings → Security and login → Developer mode**.",
            hint: "Needs a Plus, Pro, Business, Enterprise or Edu plan. On a company plan, your admin may have to allow it." },
          { text: "Add a custom connector and paste the address." },
          { text: signInAs(operator) },
        ]),
      },
    },
  },
  {
    id: "codex", name: "Codex", lead: "disk",
    routes: {
      // A SETTINGS BLOCK, NOT A COMMAND. This row once said "Paste it into a terminal on this machine and
      // run it" over a TOML block whose home is a file — an instruction that ends in a shell error.
      disk: {
        steps: () => [
          { text: "Copy this.", copy: "codex-toml" },
          { text: "Open `~/.codex/config.toml` and paste it at the end." },
          { text: `Restart Codex and ${BRIEF}`,
            hint: "Codex in the terminal, your code editor and the ChatGPT desktop app all read this file." },
        ],
      },
      // The key goes in the shell profile and the file names the variable, because Codex does not forward
      // the environment and a key written into a settings file outlives the moment it was needed.
      "public-http": {
        steps: ({ door }) => (door === "key" ? [
          { text: "Copy this.", copy: "codex-toml-http" },
          { text: "Open `~/.codex/config.toml` and paste it at the end." },
          { text: "Copy your key and add the line to your shell profile.", copy: "codex-key-line",
            hint: "Codex reads the key from there, so it never sits in the settings file." },
          { text: `Restart Codex and ${BRIEF}` },
        ] : [
          { text: "Copy this.", copy: "codex-toml-http-signin" },
          { text: "Open `~/.codex/config.toml` and paste it at the end." },
          // ITS OWN STEP, not a hint on the one before it. The sign-in IS the connection here, and a
          // reader skimming numbered steps does not read the small print under one of them.
          { text: "Sign in when the browser opens." },
          { text: `Restart Codex and ${BRIEF}` },
        ]),
      },
    },
  },
  {
    // ANYTHING ELSE. We do not know what the app is, so the steps name what any of them takes. The sub
    // line names two it covers, because a reader scanning for their app's name should find somewhere to
    // land; Perplexity had a row of its own with steps nobody had driven, and is folded in here.
    id: "other", name: "Another AI app", sub: "Perplexity, OpenClaw and others", lead: "disk",
    aliases: { perplexity: "public-http" },
    routes: {
      disk: {
        steps: () => [
          { text: "Copy this.", copy: "generic-json" },
          { text: "Paste it wherever your app adds an MCP server." },
          { text: "Restart the app if it asks you to." },
        ],
      },
      "public-http": {
        steps: ({ door }) => (door === "key" ? [
          { text: "Copy your address and key.", copy: "address-and-key", hint: KEY_HINT },
          { text: "Paste the address and the key wherever your app adds a custom MCP server.",
            hint: "It may call them “server URL” and “bearer token”." },
        ] : [
          { text: "Copy the address.", copy: "address" },
          { text: "Paste it wherever your app adds a custom MCP server, and sign in when the browser opens.",
            hint: "It may call the address the “server URL”. There is no token to give it." },
        ]),
      },
    },
  },
]);

/** A step's text for a surface that draws no emphasis: the terminal. The literals keep their marks. */
export const plainStep = (text) => String(text ?? "").replace(/\*\*/g, "");

/**
 * The offers as they go ON THE WIRE, composed once for every caller that puts them there.
 *
 * There were two hand-written copies of this mapping: the portal route's, and the browser check's stub
 * of the portal route. They agreed until the day the shape changed, and then the check went red about
 * the page rather than about itself. A stub that restates a wire is a second author for one shape. This
 * is the shape; both callers ask.
 *
 * A copy goes out as what the page needs to hand it over and nothing more: a block's text, or a secret's
 * button label and the template the minted key is put into. The stdio route object stays server-side —
 * the page has no use for where a block goes, because the step text already says.
 */
export const offersForWire = (offers) =>
  offers.map(({ client, steps, ...rest }) => ({
    id: client.id,
    name: client.name,
    ...(client.sub ? { sub: client.sub } : {}),
    steps: stepsForWire(steps),
    ...rest,
    // THE ALTERNATIVE TRAVELS, AND SO DOES THE FACT THAT THE DOOR IS UNKNOWN. `...rest` carried neither:
    // `altSteps` needs the same copy-shape mapping the primary set gets, and `door` was dropped on the
    // floor, so the page had nothing to branch on and drew one set of steps as though the door had been
    // read. Both are stated after the spread so a row cannot pass its own raw shape through.
    ...(Array.isArray(rest.altSteps) ? { altSteps: stepsForWire(rest.altSteps) } : {}),
    ...(Array.isArray(rest.keySteps) ? { keySteps: stepsForWire(rest.keySteps) } : {}),
    ...(Object.hasOwn(rest, "door") ? { door: rest.door ?? null } : {}),
  }));

/**
 * One route's steps, in the shape the browser reads. The alternative sets get the same mapping.
 * A block's `label` rides only on a bare value, and it says the button is all the page draws.
 */
const stepsForWire = (steps) =>
  (Array.isArray(steps) ? steps : []).map((s) => ({
    text: s.text,
    ...(s.hint ? { hint: s.hint } : {}),
    ...(s.copy ? { copy: s.copy.kind === "secret"
      ? { kind: "secret", label: s.copy.label, template: s.copy.template, slot: s.copy.slot }
      : { kind: "block", text: s.copy.text, ...(s.copy.label ? { label: s.copy.label } : {}) } } : {}),
  }));

const ALIAS_ROUTE = new Map(CONNECT_CLIENTS.flatMap((c) =>
  Object.entries(c.aliases ?? {}).map(([alias, route]) => [alias, { client: c, route }])));

/** The client by id — or by an id it answered to before rows merged — or null. */
export const clientById = (id) => {
  const key = String(id ?? "").trim();
  return CONNECT_CLIENTS.find((c) => c.id === key) ?? ALIAS_ROUTE.get(key)?.client ?? null;
};

/**
 * The route a caller gets for this id when it names none: an alias's own route, else the row's `lead`.
 * An alias says which route it meant — `cowork` was the web, `claude-desktop` the disk — and answering
 * `--client cowork` with a settings block would be handing that reader the other half of a merged row.
 */
export const leadRouteFor = (id) => {
  const key = String(id ?? "").trim();
  return ALIAS_ROUTE.get(key)?.route ?? CONNECT_CLIENTS.find((c) => c.id === key)?.lead ?? null;
};

/**
 * What THIS client needs from THIS deployment on ONE route. PURE — the caller supplies what the
 * deployment has.
 *
 *   served: true    ready now — every copy the steps name resolved against this deployment.
 *   served: false   cannot be served here, with the reason and what would change it.
 *
 * `served: false` always carries `reason` and `fix`. An absence with no reason reads as breakage.
 *
 * @param {object} client a row of CONNECT_CLIENTS
 * @param {{ stdioRoutes?: object, publicAddress?: string|null, keyAddress?: string|null, operator?: string|null, door?: "sign-in"|"key"|null }} have
 * @param {"disk"|"public-http"} [route] defaults to the row's `lead`
 */
/**
 * The first step of every "on this computer" route when the install runs under WSL.
 *
 * IT USED TO SEND THE READER AWAY, and for a person whose product runs in WSL the assistant on Windows
 * is the normal one — so "an assistant on Windows cannot start it from there" left them with no working
 * row at all. The row starts the server INSIDE the distribution through `wsl.exe`, which is what an
 * assistant on the Windows side needs.
 *
 * AND IT SAYS SO, because the sentence that replaced it promised more than the command can do. It read
 * "paste it where your assistant lives, on Windows or in the WSL terminal, whichever it is" — an
 * invitation to paste it inside WSL, where it does not work. Somebody took the invitation from Claude
 * Code inside a distribution and got CONNECTION_CLOSED (measured 2026-09-16 on 0.3.2-beta.1).
 *
 * There is exactly ONE launcher per host shape today, and under WSL it is the Windows-side one, so this
 * step names the side it is for rather than offering both. Building the second launcher — the plain
 * `node` line for an assistant running inside the distribution — is its own piece of work; until it
 * exists, saying which side this one is for is the whole of what can honestly be said.
 */
export const WSL_STEP = "This install runs inside WSL, and the command below starts the server in there for you. "
  + "It is for an assistant running on the Windows side — Claude Desktop, or Claude Code in PowerShell. "
  + "An assistant running inside this WSL terminal cannot use it: start the server from the WSL terminal "
  + "yourself instead.";

export function whatItNeeds(client, have = {}, route = client?.lead) {
  if (!client) return null;
  const author = client.routes?.[route];
  if (!author) return null;
  const { stdioRoutes = {}, publicAddress = null, keyAddress = null, operator = null, door = null } = have;

  // EACH COPY RESOLVES TO ITS OWN SHAPE, never to another's. Handing a Codex user `claude mcp add` is a
  // command their machine does not have, delivered with confidence — so a shape this deployment cannot
  // produce is an unserved route, not a fallback to one it can.
  //
  // AND AT THE ADDRESS OF THE DOOR THE STEPS ARE FOR. The key door beside a sign-in door is its own host,
  // so its steps resolve there and never at the host that refuses a key.
  const resolveAt = (address) => route === "disk"
    ? (shape) => {
        const r = Object.hasOwn(stdioRoutes, shape ?? "") ? stdioRoutes[shape] : null;
        return r ? { kind: "block", text: r.text, stdio: r } : null;
      }
    : (shape) => {
        const r = remoteConnectFor(shape, { address });
        if (!r) return null;
        return r.secret
          ? { kind: "secret", label: r.label, template: r.text, slot: KEY_SLOT }
          : { kind: "block", text: r.text, ...(r.label ? { label: r.label } : {}) };
      };
  const resolve = resolveAt(publicAddress);

  // WHAT THE DOOR ANSWERS, handed to every row rather than decided per row: one reading, so two apps
  // on one page cannot describe one deployment two ways — which is the defect this carries.
  const asked = author.steps({ operator, door: route === "public-http" ? door : null });
  const steps = asked.map((s) => (s.copy ? { ...s, copy: resolve(s.copy) } : { ...s }));
  const resolved = steps.every((s, i) => !asked[i].copy || s.copy);

  // ── WHEN THE DOOR COULD NOT BE READ, BOTH WAYS ARE ACTUALLY SHOWN ────────────────────────────────
  //
  // `doorKind` returns null for "not known" and its own contract says the caller offers both rather than
  // guessing. The steps above already carry the sentence that says so — and it reads "both ways are
  // shown" while one set was rendered. A page that promises the reader the alternative and then does not
  // draw it is worse than one that never mentioned it: the reader goes looking for what they were told
  // is there.
  //
  // So the OTHER door's steps are composed here and ride beside them. The sign-in set leads, because
  // that is what every hosted connector answers and what the hint tells the reader to try first; the key
  // set is the alternative rather than a second equal choice. Composed by asking the same author with
  // the other answer, never by a second copy of the steps — one table, one author, as everything else in
  // this file.
  const altAsked = route === "public-http" && door === null
    ? author.steps({ operator, door: "key" })
    : null;
  const altSteps = altAsked
    ? altAsked.map((s) => (s.copy ? { ...s, copy: resolve(s.copy) } : { ...s }))
    : null;
  // A step whose copy this deployment cannot produce is not offered at all — the same rule the primary
  // set follows two lines up. Half an alternative is a reader following steps that stop.
  const altResolved = !altAsked || altSteps.every((s, i) => !altAsked[i].copy || s.copy);
  const alt = altResolved && altSteps?.length ? { door: null, altSteps } : { ...(route === "public-http" ? { door } : {}) };

  // ── A SIGN-IN DOOR WITH A KEY DOOR BESIDE IT: THE KEY STEPS RIDE ALONG, FOR A FOLD ───────────────
  //
  // Some assistants cannot follow a browser sign-in — a fixed "API key" box, a headless agent — and a
  // hosted deployment can run a second door for them, on its own host, that takes a key. The page offers
  // those steps closed, under a heading, beneath the sign-in steps.
  //
  // ONLY WHERE THAT DOOR EXISTS. The sign-in door never honours a key, so key steps pointed at it are
  // instructions that cannot work and a credential minted for nothing — the defect reading `door` ended.
  // No key door, no fold. Composed the way the unknown door's alternative is — the same author asked for
  // the other answer — and resolved at the key door's address. `door` stays "sign-in", because it was
  // read, and `altSteps` keeps meaning "we could not tell".
  const keyAsked = route === "public-http" && door === "sign-in" && keyAddress
    ? author.steps({ operator, door: "key" })
    : null;
  const keySteps = keyAsked
    ? keyAsked.map((s) => (s.copy ? { ...s, copy: resolveAt(keyAddress)(s.copy) } : { ...s }))
    : null;
  const keyResolved = !keyAsked || keySteps.every((s, i) => !keyAsked[i].copy || s.copy);
  const folded = keyResolved && keySteps?.length ? { keySteps } : {};
  const evidence ={ ...(author.verifiedOn ? { verifiedOn: author.verifiedOn } : {}), ...(author.by ? { by: author.by } : {}) };

  if (route === "disk") {
    if (!resolved) {
      return { client, served: false, route, steps: [], launch: null, enables: null, command: null, address: null, key: null,
        reason: "this copy of the software is incomplete, so there is nothing to hand your assistant",
        fix: "whoever installed it will need to install it again" };
    }
    // ON WSL, "THIS COMPUTER" IS THE LINUX INSIDE WINDOWS. The line names WSL paths, so it runs in the WSL
    // terminal where Clearotron is installed. Pasted into PowerShell it fails, and an assistant running on
    // Windows itself could not start a program at a Linux path anyway.
    if (have.wsl) steps.unshift({ text: WSL_STEP });
    const first = steps.find((s) => s.copy)?.copy;
    // `command` and `stdio` ride for the terminal, which prints a disk offer's copy by its shape.
    return { client, served: true, route, steps, launch: client.launch ?? null, enables: null, ...evidence,
      command: first?.text ?? null, stdio: first?.stdio ?? null, address: null, key: null,
      note: "Nothing to sign up for and nothing to open up — this assistant runs the software itself, from the copy already on this machine." };
  }

  // ── THE WEB ROUTE ─────────────────────────────────────────────────────────────────────────────────
  //
  // ONE ADDRESS, and it is the publicly reachable one. There used to be a loopback offer for apps that
  // run on the reader's machine, and it is refuted at source, by the vendor: "Claude connects to your
  // remote MCP server from Anthropic's cloud infrastructure, rather than from your local device. This is
  // true across every Claude client, including claude.ai, Claude Desktop, Cowork, and the mobile apps."
  // An app on this machine that wants no network takes the disk route; nothing is served loopback.
  if (!resolved || !publicAddress) {
    // THE ONE HONEST UNAVAILABLE. "Not available" is true in exactly one case — this deployment has no
    // public web address — and it is never bare: it names who resolves it. `fix` renders where a client
    // reads it, so it names the actor and no banned word; `operatorFix` is the terminal's, read by the
    // person who IS that actor, and carries the variable and the document they need.
    return { client, served: false, route, steps: [], launch: null, enables: null, command: null, address: null, key: null,
      reason: `${client.name} reaches this service over the internet, and this installation is not on the internet yet`,
      fix: "whoever installed it can put it online — it takes about a minute and needs no account",
      operatorFix: "put it online and set CLEAROTRON_CLIENT_MCP_URL to the public URL of this install — INSTALL.md §7 walks the tunnel" };
  }
  return { client, served: true, route, steps, ...alt, ...folded, launch: client.launch ?? null, enables: null, ...evidence,
    command: null, stdio: null, address: publicAddress, key: "issued",
    note: "This assistant connects through its maker's service, so it reaches this installation at its web address rather than from your machine." };
}

/** Every client on every route, resolved against one deployment. The page and the verb both render this. */
export const connectOffers = (have = {}) =>
  CONNECT_CLIENTS.flatMap((c) => ROUTES.map((route) => whatItNeeds(c, have, route)));
