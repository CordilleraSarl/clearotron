#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Count LIVE queue entries in one or more queue dirs, and print the count on stdout. Nothing else.
//
// Exists so a shell guard can ask the driver what "live" means instead of restating the pattern in grep
//. The test deploy guard counted `.json|.processing` and not `.postponed`, so it skipped correctly
// twice while R1 was executing, then deployed ten seconds after the run PARKED and restarted the services
// under it — the run resumed 110 seconds later on a different commit, and every wall-clock number and
// stage outcome for it is now attributable to two builds with nothing in the record saying so.
//
//   node scripts/queue-inflight.mjs <dir> [<dir>…]     → prints an integer, exit 0
//   node scripts/queue-inflight.mjs --names <dir>       → prints one live marker per line
//
// An unreadable or absent dir contributes 0 and is NOT an error: a queue that does not exist yet holds no
// runs. A dir that exists and cannot be read exits 2 — that is a permissions fault, and a guard that reads
// it as "nothing in flight" would deploy over a live run, which is the whole failure being fixed.
import { readdirSync, existsSync } from "node:fs";
import { isLiveQueueMarker } from "../driver/queue-markers.mjs";

const args = process.argv.slice(2);
const wantNames = args.includes("--names");
const dirs = args.filter((a) => a !== "--names");
if (!dirs.length) { console.error("usage: queue-inflight.mjs [--names] <queue-dir> [<queue-dir>…]"); process.exit(2); }

const live = [];
for (const d of dirs) {
  if (!existsSync(d)) continue;                       // no queue yet — no runs
  let names;
  try { names = readdirSync(d); }
  catch (e) { console.error(`queue-inflight: ${d} exists but could not be read (${e.code ?? e.message}) — refusing to report zero`); process.exit(2); }
  for (const n of names) if (isLiveQueueMarker(n)) live.push(n);
}
console.log(wantNames ? live.join("\n") : String(live.length));
