// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// `test-full --shard i/n` deals the suite's files to the required jobs by measured duration, so the jobs finish
// together. A slice by index left the longest shard about twice the shortest. What must not move with the deal is the
// one property the shards are trusted for: every file runs in exactly one shard, whatever the table says or omits.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { shardByDuration, untimedCount, readDurations, plan, shardableFiles } from "../../scripts/test-full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const files = (n) => Array.from({ length: n }, (_, k) => `driver/test/f${String(k).padStart(3, "0")}.test.mjs`);

/** Every shard of `list` under `ms`, for n shards. */
const deal = (list, n, ms) => Array.from({ length: n }, (_, k) => shardByDuration(list, k + 1, n, ms));

test("every file lands in exactly one shard, for any count and any table, untimed files included", () => {
  const list = files(53);
  const tables = [{}, Object.fromEntries(list.map((f, k) => [f, (k * 37) % 11])),
    Object.fromEntries(list.slice(0, 20).map((f, k) => [f, k + 0.5]))];
  for (const ms of tables) {
    for (let n = 1; n <= 6; n++) {
      const shards = deal(list, n, ms);
      const all = shards.flat();
      assert.equal(all.length, list.length, `n=${n}: a file ran twice or not at all`);
      assert.deepEqual([...all].sort(), [...list].sort(), `n=${n}: the shards are not the whole list`);
    }
  }
});

test("the deal balances what the table measured, and a shard runs its files in the list's own order", () => {
  // One long file and many short ones: by index, the long one's shard also takes its share of the short ones.
  const list = files(12);
  const ms = Object.fromEntries(list.map((f, k) => [f, k === 0 ? 60 : 10]));
  const shards = deal(list, 4, ms);
  const loads = shards.map((s) => s.reduce((a, f) => a + ms[f], 0));
  assert.deepEqual(loads, [60, 40, 40, 30]);
  assert.deepEqual(shards[0], [list[0]], "the longest file's shard took more");
  for (const s of shards) assert.deepEqual(s, list.filter((f) => s.includes(f)), "a shard's files are not in list order");
});

test("a file the table does not name is dealt at the median, and counted", () => {
  const list = files(5);
  const ms = { [list[0]]: 1, [list[1]]: 2, [list[2]]: 9 };
  assert.equal(untimedCount(list, ms), 2);
  assert.equal(untimedCount(list, {}), 5);
  assert.deepEqual(deal(list, 2, {}).flat().sort(), [...list].sort(), "with no table at all, a file was lost");
});

test("the committed table was measured, and names every file the shards deal but those added since", () => {
  const { measured, ms } = readDurations(ROOT);
  assert.match(String(measured), /^\d{4}-\d{2}-\d{2}$/, "the table carries no measurement date");
  const dealt = shardableFiles(plan(ROOT).corpora, ROOT);
  const untimed = untimedCount(dealt, ms);
  // A table goes stale as files are added, and that costs balance, not coverage. A table naming almost nothing is not
  // stale, though: it is not the table, and the deal would be a guess.
  assert.ok(untimed < dealt.length / 10, `${untimed} of ${dealt.length} files have no recorded duration; rebuild it with scripts/measure-test-durations.mjs --run <id> --write`);
});

test("a shard's log says how many files had no recorded duration", () => {
  const r = spawnSync(process.execPath, ["scripts/test-full.mjs", "--shard", "1/4", "--list"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /names \d+ of the \d+ file\(s\); \d+ have no recorded duration and were dealt at the median/);
});
