// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// The real setup wizard in a terminal of its own (Python's `pty`, since Node has none), in a home of its own, on a
// PATH holding only stand-ins and the system's tools. Ctrl-C is the byte a terminal sends.
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ENGINE_BINARIES } from "../../driver.config.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ONBOARD = join(HERE, "..", "..", "..", "bin", "onboard.mjs");
const MOCK = join(HERE, "..", "mock-claude.mjs");
export const CLAUDE = ENGINE_BINARIES["anthropic-agent"];
export const NO_TERMINAL = (process.platform === "win32" && "a terminal is driven through Python's pty, which Windows lacks")
  || (spawnSync("python3", ["--version"]).status !== 0 && "python3 is not on this machine, and it drives the terminal");

// The terminal: spawn the command on a pty, wait for each pattern in what it printed since the last one, send
// the answer, and print everything it wrote, colour codes taken out, then its exit code.
const DRIVE = String.raw`
import fcntl, json, os, pty, re, select, struct, sys, termios, time
cmd, steps, env = (json.loads(a) for a in sys.argv[1:4])
pid, fd = pty.fork()
if pid == 0:
    os.execve(cmd[0], cmd, env)
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 120, 0, 0))
ANSI = re.compile(r'\x1b\[[0-9;?]*[A-Za-z]')
buf, seen, alive = b'', 0, True
def text(): return ANSI.sub('', buf.decode('utf-8', 'replace'))
def pump(t):
    global buf
    if not select.select([fd], [], [], t)[0]: return True
    try: d = os.read(fd, 65536)
    except OSError: return False
    buf += d
    return bool(d)
for pat, send in steps:
    end, m = time.time() + 90, None
    while alive and time.time() < end:
        m = re.compile(pat).search(text(), seen)
        if m: break
        alive = pump(0.2)
    if not m:
        os.kill(pid, 9); os.waitpid(pid, 0)
        sys.stdout.write(text() + '\n__TIMEOUT__ waiting for %r\n' % pat); sys.exit(3)
    seen = m.end(); time.sleep(0.3); os.write(fd, send.encode())
end = time.time() + 90
while alive and time.time() < end: alive = pump(0.2)
st = os.waitpid(pid, 0)[1]
sys.stdout.write(text() + '\n__EXIT__ %d\n' % os.waitstatus_to_exitcode(st))
`;
export const MENU = "1-\\d+ \\[\\d+\\] $";        // a numbered question, as `choose` asks it
export const ANY = "\\[[^\\]]*\\] $";             // whatever question comes next
export const CTRL_C = "\u0003";

/**
 * A machine of its own: a home, an empty engines folder, and a PATH of stand-ins. `claude: true` puts a
 * stand-in Claude program on PATH; otherwise a stand-in `npm` installs one into the engines folder the way
 * npm lays a package out, so setup finds the copy it installed.
 */
export function machine({ claude = false } = {}) {
  const home = mkdtempSync(join(tmpdir(), "setup-cancel-"));
  const engines = join(home, "engines");
  const bin = join(home, "programs");
  mkdirSync(engines);
  mkdirSync(bin);
  symlinkSync(process.execPath, join(bin, "node"));
  const program = `#!/bin/sh\nexec "${process.execPath}" "${MOCK}" "$@"\n`;
  if (claude) {
    writeFileSync(join(bin, CLAUDE.fallback), program);
    chmodSync(join(bin, CLAUDE.fallback), 0o755);
  } else {
    const pkg = JSON.stringify({ name: CLAUDE.package, version: CLAUDE.floor, bin: { [CLAUDE.fallback]: "cli.js" } });
    writeFileSync(join(bin, "npm"), [
      "#!/bin/sh",
      'prefix=""; while [ $# -gt 0 ]; do [ "$1" = "--prefix" ] && prefix="$2"; shift; done',
      `d="$prefix/node_modules/${CLAUDE.package}"; mkdir -p "$d"`,
      `printf '%s' '${pkg}' > "$d/package.json"`,
      `cat > "$d/cli.js" <<'PROGRAM'\n${program}PROGRAM`,
      'chmod 755 "$d/cli.js"',
    ].join("\n") + "\n");
    chmodSync(join(bin, "npm"), 0o755);
  }
  return {
    home, engines,
    setup: (steps, extra = {}) => {
      const env = { HOME: home, USERPROFILE: home, PATH: `${bin}:/usr/bin:/bin`, TERM: "xterm",
        CLEAROTRON_ENGINES_DIR: engines, ...extra };
      const r = spawnSync("python3", ["-I", "-c", DRIVE, JSON.stringify([process.execPath, ONBOARD]),
        JSON.stringify(steps), JSON.stringify(env)], { encoding: "utf8", timeout: 300000 });
      if (r.error || r.status !== 0) throw new Error(`the terminal did not come back (status=${r.status} error=${r.error?.message}):\n${r.stdout}${r.stderr}`);
      return r.stdout;
    },
    done: () => rmSync(home, { recursive: true, force: true }),
  };
}
