import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import {
  deriveKey,
  decryptBytes,
  decodeJson,
  sha256,
} from "../src/lib/crypto.mjs";
import { importSeed } from "../src/lib/model.mjs";
import { isReference } from "../src/lib/reference.mjs";
import { occurrences, postStatus, dayStart, DAY } from "../src/lib/dates.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  await readFile(resolve(root, "public/pilot-data/manifest.json"), "utf8"),
);
const code = (
  await readFile(resolve(root, ".local/pilot-access-code.txt"), "utf8")
).trim();
const key = await deriveKey(code, manifest.kdf);
async function read(ref) {
  const bytes = new Uint8Array(
    await readFile(resolve(root, "public/pilot-data", ref.path)),
  );
  assert.equal(await sha256(bytes), ref.sha256);
  return decodeJson(
    await decryptBytes(bytes, key, manifest.key_epoch, ref.object_id),
  );
}
const index = await read(manifest.index);
const posts = (await Promise.all(index.months.map(read))).flatMap(
  (m) => m.posts,
);
const seed = importSeed(
  JSON.parse(
    await readFile(resolve(root, "samples/seed/frchat-seed.json"), "utf8"),
  ),
);
assert.equal(posts.filter((p) => !isReference(p)).length, 46);
assert.equal(posts.length, index.count);
assert.deepEqual(
  posts.map((p) => p.id).sort(),
  seed.posts.map((p) => p.id).sort(),
);
for (const post of posts) {
  assert.equal("review_notes" in post, false);
  assert.equal("origin_message_ids" in post, false);
  assert.equal(post.body, seed.posts.find((p) => p.id === post.id).body);
  assert.deepEqual(post.dates, seed.posts.find((p) => p.id === post.id).dates);
}
const entries = posts
  .filter((p) => !isReference(p))
  .flatMap((p) =>
    occurrences(p, "2026-09-15T00:00:00+03:00", "2026-11-01T00:00:00+03:00"),
  );
const occurrenceLinks = entries.filter((d) => d.meeting_url).length;
assert.equal(occurrenceLinks, 4);
assert.ok(entries.filter((d) => d.kind === "event").length > 25);
assert.ok(entries.filter((d) => d.kind === "deadline").length > 10);
const statusCounts = {};
for (const post of posts) {
  const status = postStatus(post, new Date());
  statusCounts[status.id] = (statusCounts[status.id] ?? 0) + 1;
}
const report = {
  posts: posts.length,
  months: index.months.length,
  calendar_occurrences: entries.length,
  weekly_meeting_links: occurrenceLinks,
  status_at_verification: statusCounts,
  seed_notes_stripped: true,
  generated_at: new Date().toISOString(),
};
await mkdir(resolve(root, ".local"), { recursive: true });
await writeFile(
  resolve(root, ".local/pilot-verification.json"),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
