// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// THE ROUTE THAT WORKS WITH NO ADDRESS AT ALL, composed once.
//
// ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────────────────────────
//
//. The owner installed the product fresh and hit a wall: *"i, right now, have NO
// IDEA how to connect it to claude and NO IDEA how to get any information for this. so a new user will
// hit a wall immediately."*
//
// He was right, and the reason is narrow. Every connect surface in the portal is built around the
// CLIENT CONNECTOR ADDRESS, and its stated discipline — correct for a hosted deployment — is that a
// null address renders nothing: unset must look unset. A local install has no such address and never
// will, so those surfaces render an empty page of headings. Meanwhile the route that DOES work sits on
// the reader's own disk: `mcp-server/CONNECT.md` documents a one-line stdio registration that touches
// no network, needs no address and no auth, because the assistant spawns the server locally.
//
// Nothing in the portal named it. Measured on the tree: `git ls-files portal-ui/src | xargs grep -l
// 'claude mcp add|server.mjs'` returned NOTHING.
//
// ── WHY IT IS ONE COMPOSER AND NOT THREE STRINGS ─────────────────────────────────────────────────
//
// Three surfaces state this route: the Use-your-AI page, `clearotron start`'s closing block, and the
// report's Ask-AI control. A line of instruction with more than one author is this codebase's most
// productive defect — the copies drift, every one still renders, and the contradiction only shows up as
// a reader following an instruction that does not work. So the command is composed HERE, and the two
// client-side surfaces are HANDED the string rather than building it: the browser cannot know the
// install's own path anyway, which turns "must not drift" into "cannot".
//
// The guard is `driver/test/the-connect-route-has-one-author.test.mjs`.

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { stableInstallRoot } from "./permanent-install.mjs";

/** The install root — the directory holding `mcp-server/`, resolved from this module rather than cwd. */
export const INSTALL_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

/** The name the server registers under. One spelling, because `claude mcp remove` needs the same one. */
export const STDIO_SERVER_NAME = "trademark-artifacts";

/**
 * The one-line registration for an assistant that spawns the server locally. PURE.
 *
 * `workDir` is the reader's workspace root — where runs are read from. It is passed rather than read so
 * a caller that knows the configured value uses it and a caller that does not says so, instead of this
 * module inventing a plausible path. A null workDir yields the command WITHOUT the `-e`, which is
 * correct: the server falls back to its own default rather than being handed a directory nobody chose.
 *
 * @param {{ installRoot?: string, workDir?: string|null }} [opts]
 * @returns {string} the exact command to run
 */
export function stdioConnectCommand({ installRoot = stableInstallRoot({ installRoot: INSTALL_ROOT }), workDir = null, reportsDir = null, platform = process.platform } = {}) {
  return STDIO_SHAPES["claude-cli"].render({ server: join(installRoot, "mcp-server", "server.mjs"), workDir, reportsDir, platform });
}

/**
 * What a surface needs to offer the route: the command, and the one sentence that says what it is.
 *
 * The sentence is here rather than at each surface for the same reason the command is — three
 * descriptions of one thing drift into three different promises about what it does.
 */
export function stdioConnectOffer(opts = {}) {
  return {
    command: stdioConnectCommand(opts),
    name: STDIO_SERVER_NAME,
    // Deliberately states the two facts a reader needs to judge it: no network, and it only works from a
    // machine with this install on its disk. Both are why it is offered to staff and not to a client.
    note: "Runs the connector from this install's own disk — no address, no sign-in, no network. "
      + "Only works on a machine that has this install: run it where you installed Clearotron.",
    verify: `claude mcp list   →   ${STDIO_SERVER_NAME}: … ✓ Connected`,
  };
}

// ── ONE ROUTE, THREE SHAPES ─────────────────────────────────────────────────
//
// `stdioConnectCommand` composes CLAUDE CODE's registration, and for a while that was the only stdio
// client any surface offered. Offering the same string to Codex and Claude Desktop is a false offer of
// the exact kind this issue is about: `claude` is not a command a Codex user has, and the reader's tool
// answers "command not found" to an instruction the product handed them with confidence.
//
// They are genuinely three shapes, and `mcp-server/CONNECT.md` already documents all three — a CLI
// registration, a JSON block under `mcpServers`, and a TOML block under `[mcp_servers]`. What they are
// not is three ROUTES: CONNECT.md states the contract in one line — *"run `node
// mcp-server/server.mjs`, over stdio, with `CLEAROTRON_WORK_DIR` in its environment"* — and each shape
// is that contract spelled the way one host reads configuration.
//
// So the three facts are resolved ONCE and rendered three ways. A row names its shape; nothing switches
// on a client's name. Adding a host is a renderer plus a row, and it cannot invent a different route.

/**
 * The settings the server is started with: the workspace it reads runs from, and the folder its reports are
 * published to. Handed over rather than left to the server's own defaults, so it reads what the services
 * read: a demo's own base, not the real install's workspace. Only what is set is written.
 */
function envOf({ workDir = null, reportsDir = null } = {}) {
  return { ...(workDir ? { CLEAROTRON_WORK_DIR: workDir } : {}), ...(reportsDir ? { CLEAROTRON_REPORTS_DIR: reportsDir } : {}) };
}
const envFlags = (o) => Object.entries(envOf(o)).map(([k, v]) => ` -e ${k}=${v}`).join("");
const envBlock = (o) => (Object.keys(envOf(o)).length ? { env: envOf(o) } : {});

/**
 * The argument that ends Claude Code's own options. Windows PowerShell 5.1 drops a bare `--` before it
 * reaches a native program, so the line failed with "missing required argument"; quoted, every shell passes
 * it through (bash, zsh, PowerShell and cmd alike), so a Windows install is handed the quoted form.
 */
const separator = (platform = process.platform) => (platform === "win32" ? '"--"' : "--");

/** How each host takes the same three facts. A row of CONNECT_CLIENTS names one of these by key. */
export const STDIO_SHAPES = Object.freeze({
  "claude-cli": {
    kind: "command",
    where: null,
    render: ({ server, workDir, reportsDir, platform }) =>
      `claude mcp add ${STDIO_SERVER_NAME} --scope user${envFlags({ workDir, reportsDir })} ${separator(platform)} node ${server}`,
    after: null,
  },
  "desktop-json": {
    kind: "config",
    where: "Settings → Developer → Edit Config",
    render: ({ server, workDir, reportsDir }) => JSON.stringify({
      mcpServers: {
        [STDIO_SERVER_NAME]: {
          command: "node",
          args: [server],
          ...envBlock({ workDir, reportsDir }),
        },
      },
    }, null, 2),
    after: "Restart Claude Desktop.",
  },
  // CONNECT.md's "Any other MCP host": the contract itself, in the shape most hosts read. Offered when
  // we do not know what the reader's agent is — it states the three facts and lets them place it.
  "generic-json": {
    kind: "config",
    where: "your agent's MCP server configuration",
    render: ({ server, workDir, reportsDir }) => JSON.stringify({
      command: "node",
      args: [server],
      ...envBlock({ workDir, reportsDir }),
    }, null, 2),
    after: null,
  },
  "codex-toml": {
    kind: "config",
    where: "~/.codex/config.toml",
    // Written out rather than produced by a TOML library: this is four lines with no user-supplied
    // strings in key positions, and adding a dependency to emit them would be the larger risk.
    //
    // `env` and not `env_vars`, deliberately, and CONNECT.md explains why the distinction matters:
    // Codex does not forward the shell environment, and a credential would have to be forwarded BY NAME
    // rather than written into a file. This server takes no credential — the work directory is a path,
    // not a secret — so `env` is correct here and would not be for a server that wanted a key.
    render: ({ server, workDir, reportsDir }) => [
      `[mcp_servers.${STDIO_SERVER_NAME}]`,
      `command = "node"`,
      `args = ["${server}"]`,
      ...(Object.keys(envOf({ workDir, reportsDir })).length
        ? [`env = { ${Object.entries(envOf({ workDir, reportsDir })).map(([k, v]) => `${k} = "${v}"`).join(", ")} }`] : []),
    ].join("\n"),
    after: null,
  },
});

// ── THE SAME SERVER, REACHED OVER THE WEB ──────────────────────────────────────────────────────────
//
// An install running elsewhere is reached at its public address with a key, and three hosts take that in
// three spellings: Claude Code registers it with `--transport http` and a header, Codex reads a `url` and
// the NAME of a variable holding the key, and everything else takes the two lines as they are. They are
// composed here for the reason the stdio shapes are: a surface that spelled `claude mcp add` for itself
// would be a second author of it, and the browser does not know the address anyway.
//
// A KEY IS NEVER IN THESE STRINGS. It is minted when a person presses, for that person, and the page
// holds it only for the length of the press. So a shape that needs one carries KEY_SLOT where the key
// goes, and the only thing a surface does with the string is put the key it was just handed there.

/** Where a minted key goes in a composed string. Nothing else in a copy looks like it. */
export const KEY_SLOT = "{key}";

/** The variable Codex reads the key from, so it never sits in the settings file itself. */
export const KEY_ENV_VAR = "CLEAROTRON_KEY";

/** How each host takes the public address. A step of CONNECT_CLIENTS names one of these by key. */
export const REMOTE_SHAPES = Object.freeze({
  "address-and-key": {
    label: "Copy address and key",
    render: ({ address }) => `${address}\n${KEY_SLOT}`,
  },
  // A host that signs its reader in through the browser needs the address and nothing else.
  "address": {
    label: null,
    render: ({ address }) => address,
  },
  "claude-cli-http": {
    label: "Copy command",
    render: ({ address }) =>
      `claude mcp add --transport http ${STDIO_SERVER_NAME} ${address} --header "Authorization: Bearer ${KEY_SLOT}"`,
  },
  "codex-toml-http": {
    label: null,
    render: ({ address }) => [
      `[mcp_servers.${STDIO_SERVER_NAME}]`,
      `url = "${address}"`,
      `bearer_token_env_var = "${KEY_ENV_VAR}"`,
    ].join("\n"),
  },
  "codex-key-line": {
    label: "Copy key line",
    render: () => `export ${KEY_ENV_VAR}=${KEY_SLOT}`,
  },
});

/**
 * One remote copy, resolved against this install's public address. PURE.
 *
 * `secret` is read off the composed string rather than declared beside it, so a shape cannot say it
 * needs no key while carrying the slot, or the reverse. Null for an unknown shape or for an install with
 * no public address: there is nothing true to hand over in either case.
 */
export function remoteConnectFor(shape, { address = null } = {}) {
  const spec = Object.hasOwn(REMOTE_SHAPES, String(shape ?? "")) ? REMOTE_SHAPES[shape] : null;
  if (!spec || !address) return null;
  const text = spec.render({ address });
  const secret = text.includes(KEY_SLOT);
  return { shape, secret, label: secret ? spec.label : null, text, name: STDIO_SERVER_NAME };
}

/**
 * The stdio route for ONE host, in that host's own shape. PURE.
 *
 * Returns null for an unknown shape rather than falling back to the Claude one — a fallback here is how
 * a Codex user gets handed `claude mcp add`, which is the defect this function exists to remove. An
 * absence is a finding: a row naming a shape nobody implemented should surface as missing, and the
 * table's own arm refuses such a row outright.
 */
export function stdioConnectFor(shape, { installRoot = stableInstallRoot({ installRoot: INSTALL_ROOT }), workDir = null, reportsDir = null, platform = process.platform } = {}) {
  const spec = Object.hasOwn(STDIO_SHAPES, String(shape ?? "")) ? STDIO_SHAPES[shape] : null;
  if (!spec) return null;
  const server = join(installRoot, "mcp-server", "server.mjs");
  return {
    shape, kind: spec.kind, where: spec.where, after: spec.after,
    text: spec.render({ server, workDir, reportsDir, platform }),
    name: STDIO_SERVER_NAME,
  };
}
