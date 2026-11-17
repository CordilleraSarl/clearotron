// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// no-network.mjs — preloaded into every process a snapshot scenario starts, so a scenario cannot reach a
// register, a search service or a model. A connection to anywhere but this machine is refused and written
// to BEHAVIOUR_SNAPSHOT_NET_LOG, and the scenario's record carries the attempt as a difference to read.
import net from "node:net";
import { appendFileSync } from "node:fs";

const LOOPBACK = /^(localhost|127\.|::1$|::ffff:127\.)/;
const original = net.Socket.prototype.connect;
net.Socket.prototype.connect = function connect(...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const host = typeof first === "object" && first !== null ? (first.path ? "localhost" : first.host ?? "localhost") : (typeof args[1] === "string" ? args[1] : "localhost");
  if (LOOPBACK.test(String(host))) return original.apply(this, args);
  try { if (process.env.BEHAVIOUR_SNAPSHOT_NET_LOG) appendFileSync(process.env.BEHAVIOUR_SNAPSHOT_NET_LOG, `${host}\n`); } catch { /* the refusal below still stands */ }
  process.nextTick(() => this.destroy(new Error(`behaviour snapshot: no network, refused ${host}`)));
  return this;
};
