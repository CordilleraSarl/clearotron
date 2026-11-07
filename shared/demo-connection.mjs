// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// demo-connection.mjs — a connection a demo printed stays with that demo.
//
// The connect line names the demo's workspace and CLEAROTRON_DEMO=1, and nothing else. The assistant starts the
// server with that line, long after the demo's supervisor, so this server is nobody's child: left alone it would read
// the machine's settings file and fall back to the real install's queue, stores and access log. So the rest of the
// layout is pinned here to the demo's own folder, exactly as `clearotron start --demo` pins it for the doors (childEnv
// in bin/start.mjs), and the settings file is not read. A demo that has been removed has nothing to serve, so the
// server refuses, and the real install on this machine is never offered in its place.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Applies the pins to `env`, or returns the sentence to refuse with when the demo is gone. `null` once bound.
 * Run before the server loads: its modules read these settings as they load.
 */
export function bindDemoConnection(env = process.env, exists = existsSync) {
  const work = String(env.CLEAROTRON_WORK_DIR ?? "").trim();
  if (!work || !exists(work)) {
    return `the demo this connection belongs to is gone${work ? ` (${work})` : ""}. Remove this connection, or start a new demo and use the line it prints.`;
  }
  const base = dirname(work);
  Object.assign(env, {
    CLEAROTRON_NO_ENV_FILE: "1",
    CLEAROTRON_REPORTS_DIR: String(env.CLEAROTRON_REPORTS_DIR ?? "").trim() || join(base, "pool"),
    CLEAROTRON_QUEUE_DIR: join(base, "queue"),
    CLEAROTRON_OUTBOX_DIR: join(base, "outbox"),
    CLEAROTRON_RUN_LOCK_DIR: join(base, "locks"),
    CLEAROTRON_ACCESS_FILE: join(base, "grants.json"),
    CLEAROTRON_RECIPES_DIR: join(base, "config", "recipes"),
    RECIPE_REPO_ROOT: join(base, "config"),
    CLEAROTRON_CUSTOMERS_DIR: join(base, "config", "profiles"),
    CLEAROTRON_INSTRUCTIONS_DIR: "",
    PROFILE_REPO_ROOT: join(base, "config"),
    PROFILE_AUDIT: "",
    RECIPE_AUDIT: "",
    CLEAROTRON_FEEDBACK_DIR: "",
    TRADEMARK_MCP_AUDIT_LOG: join(base, "telemetry", "trademark-mcp-access.jsonl"),
  });
  return null;
}
