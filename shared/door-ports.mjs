// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// door-ports.mjs — the three doors' ports, as this install's environment sets them.
//
// The start command (`bin/start.mjs`, which re-exports this) starts the doors on these ports, and the server install
// (`driver/systemd/render-units.mjs`) writes them into the units' environment. The install took them from the start
// command, which put a command in the install's import path: the start command reaches the install's unit writer,
// and the two closed a loop. Here, both read one function from a module that reaches neither.
import { clientDoorPort } from "./client-door.mjs";

/** The portal's, the engine door's and the client door's ports: each variable when set, else its default. Throws on a value that is not a port. PURE. */
export function resolvePorts(env = {}) {
  const one = (name, dflt) => {
    const raw = String(env[name] ?? "").trim();
    if (!raw) return dflt;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`${name}="${raw}" is not a port number (1–65535).`);
    return n;
  };
  // F26 — the client door is started on BOTH paths now, so its port is resolved
  // here with the other two rather than only where the units are written. 18811 is the door's own
  // default and shared/client-door.mjs states it; the literal is not repeated, it is imported.
  return { portal: one("PORTAL_SERVICE_PORT", 18802), mcp: one("TRADEMARK_MCP_HTTP_PORT", 18790),
    client: one("CLIENT_MCP_HTTP_PORT", clientDoorPort({})) };
}
