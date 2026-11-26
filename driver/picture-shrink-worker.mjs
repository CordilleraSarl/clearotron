// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// picture-shrink-worker.mjs — brings one web picture down to its box, off the main thread (web-pictures.mjs).
//
// Decoding holds the thread that does it. Run here, it leaves the picture step's own clock free to end the step at its
// limit: the step stops this worker there, and a picture still being shrunk is recorded as not shrunk in time.
import { parentPort } from "node:worker_threads";
import { thumbnailOf, declaredSize } from "./picture-thumbnail.mjs";
import { imageTypeOf } from "./mark-logos.mjs";

parentPort.on("message", ({ id, bytes }) => {
  const t0 = performance.now();
  const picture = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const served = declaredSize(picture, imageTypeOf(picture)?.type);
  const t = thumbnailOf(picture);
  const ms = Math.round(performance.now() - t0);
  if (t.refused) { parentPort.postMessage({ id, ms, served, refused: t.refused }); return; }
  const out = new Uint8Array(t.bytes);
  parentPort.postMessage({ id, ms, served, contentType: t.contentType, width: t.width, height: t.height, kept: t.kept, bytes: out }, [out.buffer]);
});
