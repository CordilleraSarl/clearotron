// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// key-socket.mjs — the local key door, on a unix socket, beside the TCP door that takes a proxy identity
// (tracker issue 174).
//
// ── THE PROBLEM, AND WHY THE OBVIOUS FIX IS NOT ONE ─────────────────────────────────────────────────
//
// This interface serves two populations that authenticate differently: people arriving through a tunnel,
// who prove themselves with a proxy JWT, and programs on the same machine holding a scoped access key,
// which can never produce a JWT. The handler refuses to do both — `tokenOnly` and `verify` are mutually
// exclusive by construction — so a deployment needing both has had to run the process twice. On the
// production install that cost an outage: the shared instance was switched to the proxy mode so the
// desktop path would work, which silently took the portal's trigger with it, and both sides logged a
// true sentence that was not the one the operator needed.
//
// "ONLY ACCEPT A KEY FROM LOOPBACK" DOES NOT WORK HERE, and this is the whole design. The tunnel daemon
// runs ON the box and connects to the listener over loopback, so a request forwarded from the internet
// and a request from the local portal have the SAME peer address. A peer-IP check would accept a stolen
// key replayed through the tunnel, and it would look correct in every test written on a box with no
// tunnel — green, and wrong exactly where it matters.
//
// ── THE DISCRIMINATOR IS THE TRANSPORT ──────────────────────────────────────────────────────────────
//
// A tunnel forwards to a TCP port. It cannot reach a unix socket. So the key door is a SECOND listener
// on a socket, and the TCP door keeps the proxy rule unchanged and never learns about keys.
//
// REFUSAL BY CONSTRUCTION, NOT BY A CHECK. The two handlers are separate objects: the TCP one is built
// with `verify` and `tokenOnly:false`, this one with `verify:null` and `tokenOnly:true`. "A key
// presented on the TCP port is refused" is therefore not a branch anybody can delete — there is no code
// path on that handler that reads a key at all, and the existing mutual-exclusion guard keeps it that
// way. Filesystem permissions then state which local accounts may present a key, which is a stronger
// claim than any header check and one an operator can read with `ls -l`.
import { createServer } from "node:http";
import { connect } from "node:net";
import { chmodSync, statSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";

/** The socket's mode: owner and group read/write, nobody else. The group is the door's own egid. */
export const KEY_SOCKET_MODE = 0o660;

/**
 * The refusals that bind on the key door WHATEVER transport it listens on.
 *
 * WHY THIS FUNCTION EXISTS RATHER THAN REUSING THE TOKEN-MODE BLOCK. Those refusals live inside
 * `if (TOKEN_ONLY)` in http-server.mjs, and this door opens on a process that is typically NOT in token
 * mode — it is in proxy mode for its TCP half. Without this, adding a key door to a proxy-mode process
 * would skip every one of them, and the grants-file refusal is the one that matters: a missing grants
 * file with `firmStaff` ever flipped back on is silent read-all across every customer.
 *
 * TWO OF THE FOUR TOKEN-MODE REFUSALS DELIBERATELY DO NOT APPEAR HERE, and saying which and why is the
 * point — a fence that disappears without a sentence is how the next one goes:
 *
 *   · the loopback-only refusal guards a key riding plaintext to ANOTHER MACHINE. A unix socket has no
 *     host and no wire; it is a filesystem object and cannot be addressed off the box at all. The hazard
 *     it names does not exist here, and filesystem mode replaces it.
 *   · the allowed-hosts refusal arms DNS-rebinding protection, which is an attack on a browser resolving
 *     a HOSTNAME. A socket has no hostname and no DNS. Same reasoning.
 *
 * Both still bind on the TCP token door, untouched.
 *
 * @returns {string|null} the refusal sentence, or null when the door may open.
 */
export function keyDoorRefusal({ authDisabled, accessFile }) {
  if (authDisabled) {
    return "TRADEMARK_MCP_KEY_SOCKET is set and TRADEMARK_MCP_AUTH_DISABLED=1 — one demands a valid access "
      + "key on every request, the other authenticates nobody. Unset the bypass. Refusing to open the key door.";
  }
  if (!accessFile) {
    return "TRADEMARK_MCP_KEY_SOCKET is set but CLEAROTRON_ACCESS_FILE is unset — refusing to open the key "
      + "door. Point it at a grants file, even one containing only {\"tenants\":{}}.";
  }
  return null;
}

/**
 * Is a socket at this path being served by a LIVE process, or is it a leftover?
 *
 * A unix socket is a file: it survives a crash, and `listen` on an existing path fails with EADDRINUSE
 * whether or not anybody is behind it. Unlinking unconditionally is the obvious move and it is the
 * dangerous one — it silently steals the path from a healthy sibling process, and the symptom is a portal
 * whose calls stop arriving at a door that is still running.
 *
 * So: try to connect. A refused connection means nothing is listening and the file is stale. A successful
 * one means somebody is there, and this process must refuse rather than take the path.
 */
export function probeSocket(path, { timeoutMs = 500 } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    let c;
    try { c = connect(path); } catch { return finish("stale"); }
    const t = setTimeout(() => { try { c.destroy(); } catch { /* closing */ } finish("live"); }, timeoutMs);
    c.on("connect", () => { clearTimeout(t); try { c.destroy(); } catch { /* closing */ } finish("live"); });
    c.on("error", (e) => {
      clearTimeout(t);
      // ENOENT: no such file. ECONNREFUSED: the file is there and nothing is behind it.
      finish(e?.code === "ENOENT" ? "absent" : e?.code === "ECONNREFUSED" ? "stale" : "unknown");
    });
  });
}

/**
 * Open the key door. Resolves to `{ mode, path }` once listening.
 *
 * `listenOrDie` is deliberately not used: its subject is port conflicts and the explicit-port policy, and
 * a socket path has neither. Its refusals would read as nonsense here ("set TRADEMARK_MCP_HTTP_PORT") and
 * borrowing them would mean an operator being told to fix a variable this door does not read.
 *
 * THE MODE IS SET AFTER LISTEN, not before, because `listen` creates the file itself and the process
 * umask decides what it starts as. A door that assumed its umask would be world-writable on a box whose
 * umask was 0, which is the kind of thing nobody notices until it is the finding.
 */
export async function openKeyDoor({ handler, path, log = () => {}, chmod = chmodSync, stat = statSync, unlink = unlinkSync, probe = probeSocket, listen = null }) {
  const state = await probe(path);
  if (state === "live") {
    throw new Error(`a process is already serving the key socket at ${path} — refusing to take the path from it. `
      + "Stop that process, or point TRADEMARK_MCP_KEY_SOCKET somewhere else.");
  }
  if (state === "stale") { try { unlink(path); } catch { /* it may have gone between the probe and here */ } }

  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    (listen ?? ((p, cb) => server.listen(p, cb)))(path, resolve);
  });
  chmod(path, KEY_SOCKET_MODE);
  const mode = stat(path).mode & 0o777;
  log(`key door listening on ${path} (mode ${mode.toString(8)}, dir ${dirname(path)}) — access key required, no auth proxy, unreachable from any network`);
  return { server, path, mode };
}
