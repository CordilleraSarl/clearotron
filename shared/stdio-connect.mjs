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
export function stdioConnectCommand({ installRoot = INSTALL_ROOT, workDir = null } = {}) {
  const server = join(installRoot, "mcp-server", "server.mjs");
  const env = workDir ? ` -e CLEAROTRON_WORK_DIR=${workDir}` : "";
  return `claude mcp add ${STDIO_SERVER_NAME}${env} -- node ${server}`;
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

/** How each host takes the same three facts. A row of CONNECT_CLIENTS names one of these by key. */
export const STDIO_SHAPES = Object.freeze({
  "claude-cli": {
    kind: "command",
    where: null,
    render: ({ server, workDir }) =>
      `claude mcp add ${STDIO_SERVER_NAME}${workDir ? ` -e CLEAROTRON_WORK_DIR=${workDir}` : ""} -- node ${server}`,
    after: null,
  },
  "desktop-json": {
    kind: "config",
    where: "Settings → Developer → Edit Config",
    render: ({ server, workDir }) => JSON.stringify({
      mcpServers: {
        [STDIO_SERVER_NAME]: {
          command: "node",
          args: [server],
          ...(workDir ? { env: { CLEAROTRON_WORK_DIR: workDir } } : {}),
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
    render: ({ server, workDir }) => JSON.stringify({
      command: "node",
      args: [server],
      ...(workDir ? { env: { CLEAROTRON_WORK_DIR: workDir } } : {}),
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
    render: ({ server, workDir }) => [
      `[mcp_servers.${STDIO_SERVER_NAME}]`,
      `command = "node"`,
      `args = ["${server}"]`,
      ...(workDir ? [`env = { CLEAROTRON_WORK_DIR = "${workDir}" }`] : []),
    ].join("\n"),
    after: null,
  },
});

/**
 * The stdio route for ONE host, in that host's own shape. PURE.
 *
 * Returns null for an unknown shape rather than falling back to the Claude one — a fallback here is how
 * a Codex user gets handed `claude mcp add`, which is the defect this function exists to remove. An
 * absence is a finding: a row naming a shape nobody implemented should surface as missing, and the
 * table's own arm refuses such a row outright.
 */
export function stdioConnectFor(shape, { installRoot = INSTALL_ROOT, workDir = null } = {}) {
  const spec = Object.hasOwn(STDIO_SHAPES, String(shape ?? "")) ? STDIO_SHAPES[shape] : null;
  if (!spec) return null;
  const server = join(installRoot, "mcp-server", "server.mjs");
  return {
    shape, kind: spec.kind, where: spec.where, after: spec.after,
    text: spec.render({ server, workDir }),
    name: STDIO_SERVER_NAME,
  };
}
