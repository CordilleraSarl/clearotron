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
export function keyDoorRefusal({ authDisabled, accessFile, authMode = "" }) {
  // THE COMBINATION THAT MAKES BOTH DOORS KEY DOORS, and the one this whole issue exists to prevent.
  //
  // The mutual exclusion in makeHttpHandler is between `verify` and `tokenOnly` on ONE handler. It says
  // nothing about two handlers in one process — and the TCP handler is built with `tokenOnly: TOKEN_ONLY`,
  // which is `TRADEMARK_MCP_AUTH_MODE === "token"`. So with the mode set to token AND a socket configured,
  // BOTH listeners accept a key, the TCP one is reachable through the tunnel, and the posture line below
  // would announce that a key is "accepted HERE and nowhere else" while that is false.
  //
  // The loopback refusal in token mode does not save it: the tunnel daemon runs on this box and connects
  // over loopback, which is the exact reason this door is a socket rather than a loopback port.
  //
  // AND IT IS THE LIKELY CONFIGURATION, not a contrived one. The deployment this issue was raised from is
  // in token mode today, because somebody switched it to make one path work. An operator adding the socket
  // is far more likely to leave the mode alone than to change it, so this refusal is the one that will
  // actually fire. Found in review, not by me.
  if (String(authMode).trim().toLowerCase() === "token") {
    return "TRADEMARK_MCP_KEY_SOCKET is set and TRADEMARK_MCP_AUTH_MODE=token — that mode makes the NETWORK "
      + "door take a key too, and a tunnel can reach it. The socket exists so a key has one door: unset the "
      + "mode (the network door then takes a proxy identity) or unset the socket. Refusing to open both.";
  }
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
  // ── THE DIRECTORY, NOT JUST THE SOCKET (found in review) ───────────────────────────────────────────
  //
  // 0660 on the socket says who may CONNECT to it. It says nothing about who may REPLACE it: unlinking a
  // file is governed by write permission on the containing directory. So a socket in a world-writable
  // directory without the sticky bit can be removed by any local account, which then binds its own
  // listener on the path — and the portal presents its ops key to that listener. The mode on the socket
  // does not prevent one line of it.
  //
  // The stale-socket handling below makes that reachable rather than theoretical: an impostor who binds
  // first simply reads as "live", this process refuses by design, and the impostor is left holding the
  // path with the door it replaced never having started.
  //
  // WORLD-WRITABLE WITHOUT STICKY IS REFUSED. Group-writable is NOT: the socket is already group-
  // readable, so the group is the trust boundary an operator has chosen for this door, and a service
  // directory owned by the service group at 0770 is the ordinary correct shape. The sticky bit is
  // honoured because that is exactly what it means — /tmp is world-writable and safe for this precisely
  // because of it.
  const dir = dirname(path);
  const dmode = stat(dir).mode & 0o7777;
  if ((dmode & 0o002) && !(dmode & 0o1000)) {
    throw new Error(`the directory holding the key socket is world-writable without the sticky bit (${dir}, mode ${dmode.toString(8)}) `
      + "— any local account could remove this socket and bind its own listener in its place, and callers would present their key to it. "
      + "Tighten the directory, or set the sticky bit.");
  }

  const state = await probe(path);
  if (state === "live") {
    throw new Error(`a process is already serving the key socket at ${path} — refusing to take the path from it. `
      + "Stop that process, or point TRADEMARK_MCP_KEY_SOCKET somewhere else.");
  }
  if (state === "stale") { try { unlink(path); } catch { /* it may have gone between the probe and here */ } }
  // THE FOURTH STATE, which was handled by accident (found in review). A socket owned by another account
  // whose mode this process cannot reach answers EACCES — neither ENOENT nor ECONNREFUSED — and fell
  // through to `listen`, which then failed with a bare EADDRINUSE and no sentence. That is precisely the
  // case the probe exists for: something is at this path and this process cannot tell what.
  if (state === "unknown") {
    throw new Error(`something is at the key socket path and this process cannot determine what (${path}) `
      + "— most often a socket owned by another account. Refusing to unlink a path this process cannot inspect. "
      + "Check its owner and mode, or point TRADEMARK_MCP_KEY_SOCKET somewhere this service owns.");
  }

  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    (listen ?? ((p, cb) => server.listen(p, cb)))(path, resolve);
  });
  chmod(path, KEY_SOCKET_MODE);
  const mode = stat(path).mode & 0o777;
  log(`key door listening on ${path} (mode ${mode.toString(8)}, dir ${dir} mode ${dmode.toString(8)}) — access key required, no auth proxy, unreachable from any network`);
  return { server, path, mode };
}
