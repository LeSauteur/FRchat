import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { deriveKey, decryptBytes, decodeJson } from "../src/lib/crypto.mjs";
import { importSeed } from "../src/lib/model.mjs";
const folder = ".local/before-admin-access",
  manifest = JSON.parse(await readFile(`${folder}/manifest.json`, "utf8")),
  key = await deriveKey(
    (await readFile(`${folder}/access-code.txt`, "utf8")).trim(),
    manifest.kdf,
  );
const read = async (ref) =>
  decodeJson(
    await decryptBytes(
      new Uint8Array(await readFile(`${folder}/${ref.path}`)),
      key,
      manifest.key_epoch,
      ref.object_id,
    ),
  );
const index = await read(manifest.index),
  before = (await Promise.all(index.months.map(read))).flatMap((m) => m.posts),
  after = importSeed(
    JSON.parse(await readFile("samples/seed/frchat-seed.json", "utf8")),
  ).posts;
const fields = (p) => ({
  id: p.id,
  category_id: p.category_id,
  dates: p.dates,
  pinned: p.pinned,
  expires_at: p.expires_at ?? null,
});
const ids = after
  .filter(
    (p) =>
      JSON.stringify(fields(p)) !==
      JSON.stringify(fields(before.find((b) => b.id === p.id))),
  )
  .map((p) => p.id);
for (const [name, posts] of [
  ["before", before],
  ["after", after],
])
  await writeFile(
    `.local/seed-${name}-review.json`,
    JSON.stringify(
      posts.filter((p) => ids.includes(p.id)).map(fields),
      null,
      2,
    ) + "\n",
  );
let diff;
try {
  diff = execFileSync(
    "git",
    [
      "diff",
      "--no-index",
      "--no-color",
      "--",
      ".local/seed-before-review.json",
      ".local/seed-after-review.json",
    ],
    { encoding: "utf8" },
  );
} catch (e) {
  if (e.status !== 1) throw e;
  diff = e.stdout;
}
await writeFile(".local/seed-review.diff", diff);
console.log(
  `Diff данных до/после: .local/seed-review.diff; изменено ${ids.length} карточек. Исходные правила находятся в samples/seed/build_seed.py.`,
);
