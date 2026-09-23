// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// The shipped services may not gain privileges.
//
// The four units a hosted install runs carried no systemd restriction at all, so the services, and every
// program the engine starts under them, ran with the account's full reach. They now carry the five
// directives a user unit applies on a machine that refuses unprivileged user namespaces. Measured
// 2026-09-23 with all five set: the running worker reads NoNewPrivs 1 and Seccomp 2, a knockout on each
// engine is delivered, and a report folder made inside a set-group-ID pool still inherits the bit.
//
// The namespace directives measured there are held out on purpose: PrivateTmp, ProtectSystem and
// ProtectHome are skipped on such a machine without an error, so a unit carrying them reads as protected
// by something that is not in force.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SERVICES = ["worker", "portal", "mcp-face", "client-mcp"];
const FIVE = { NoNewPrivileges: "yes", RestrictSUIDSGID: "yes", LockPersonality: "yes", RestrictRealtime: "yes", SystemCallArchitectures: "native" };
const SKIPPED_IN_SILENCE = ["PrivateTmp", "ProtectSystem", "ProtectHome"];

/** The directives in a unit's [Service] section, comments left out, as name → every value given. */
function serviceSection(text) {
  const out = new Map();
  let inService = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("[")) { inService = line === "[Service]"; continue; }
    if (!inService || !line || line.startsWith("#") || line.startsWith(";")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const name = line.slice(0, eq).trim();
    out.set(name, [...(out.get(name) ?? []), line.slice(eq + 1).trim()]);
  }
  return out;
}

const unit = (name) => serviceSection(readFileSync(join(ROOT, "driver", "systemd", `clearotron-${name}.service`), "utf8"));

test("the section reader sees a directive, ignores a commented one, and reads only [Service]", () => {
  const s = serviceSection("[Unit]\nNoNewPrivileges=no\n[Service]\n# PrivateTmp=yes\nNoNewPrivileges=yes\n[Install]\nWantedBy=default.target\n");
  assert.deepEqual([...s.entries()], [["NoNewPrivileges", ["yes"]]]);
});

test("each shipped service carries the five restrictions, once each, in its [Service] section", () => {
  for (const name of SERVICES) {
    const s = unit(name);
    assert.ok(s.has("ExecStart"), `clearotron-${name}.service: no [Service] section was read`);
    for (const [directive, value] of Object.entries(FIVE)) {
      assert.deepEqual(s.get(directive), [value], `clearotron-${name}.service: ${directive} is ${JSON.stringify(s.get(directive) ?? "absent")}, not ${value} once`);
    }
  }
});

test("no shipped service carries a namespace directive that a user unit here skips without an error", () => {
  for (const name of SERVICES) {
    const s = unit(name);
    for (const directive of SKIPPED_IN_SILENCE) {
      assert.ok(!s.has(directive), `clearotron-${name}.service sets ${directive}, which reads as protection and is not in force on such a machine`);
    }
  }
});
