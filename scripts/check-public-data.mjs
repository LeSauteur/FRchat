import { readFile, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { sha256, unbase64, MIN_ITERATIONS } from "../src/lib/crypto.mjs";
import { validateManifest } from "../src/lib/storage.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const folder = resolve(root, "public/pilot-data");
const manifest = validateManifest(
  JSON.parse(await readFile(resolve(folder, "manifest.json"), "utf8")),
);
assert.equal(manifest.kdf.name, "PBKDF2");
assert.equal(manifest.kdf.hash, "SHA-256");
assert.ok(
  manifest.kdf.iterations >= MIN_ITERATIONS &&
    manifest.kdf.iterations <= 2_000_000,
);
assert.ok(unbase64(manifest.kdf.salt).length >= 16);
const files = await readdir(resolve(folder, "objects"), {
  withFileTypes: true,
});
assert.ok(
  files.some((file) => `objects/${file.name}` === manifest.index.path),
  "Нет зашифрованного индекса",
);
const ivs = new Set();
for (const file of files) {
  assert.ok(
    file.isFile() && /^[a-f0-9]{64}\.bin$/.test(file.name),
    "Недопустимый файл в публичных данных",
  );
  const bytes = new Uint8Array(
    await readFile(resolve(folder, "objects", file.name)),
  );
  assert.equal(await sha256(bytes), file.name.slice(0, -4));
  assert.equal(new TextDecoder().decode(bytes.subarray(0, 4)), "FRC1");
  const headerSize = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(4);
  assert.ok(
    headerSize > 0 &&
      headerSize <= 16384 &&
      bytes.length >= 8 + headerSize + 16,
  );
  const header = JSON.parse(
    new TextDecoder().decode(bytes.subarray(8, 8 + headerSize)),
  );
  assert.equal(header.schema, "frchat-object/1");
  assert.equal(header.epoch, manifest.key_epoch);
  assert.equal(unbase64(header.iv).length, 12);
  assert.ok(!ivs.has(header.iv), "Повтор IV в опубликованном наборе");
  ivs.add(header.iv);
}
console.log(
  `Публичные данные: ${files.length} зашифрованных объектов; хэши, контейнеры и IV проверены.`,
);
