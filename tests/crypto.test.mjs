import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveKey,
  newKdf,
  encryptBytes,
  decryptBytes,
  encryptedObject,
  sha256,
} from "../src/lib/crypto.mjs";
import { validateManifest, validateRef } from "../src/lib/storage.mjs";
test("binary round trip; fresh IVs; tamper, wrong key and wrong object rejected", async () => {
  const kdf = newKdf(),
    key = await deriveKey("synthetic-test-secret", kdf),
    epoch = "test-epoch";
  const bytes = new Uint8Array([0, 255, 127, 80, 0, 13, 10]);
  const first = await encryptBytes(bytes, key, epoch, "file:one");
  const second = await encryptBytes(bytes, key, epoch, "file:one");
  assert.notDeepEqual(first, second);
  assert.deepEqual(await decryptBytes(first, key, epoch, "file:one"), bytes);
  await assert.rejects(decryptBytes(first, key, epoch, "file:other"));
  const wrongKey = await deriveKey("another-test-secret", kdf);
  await assert.rejects(decryptBytes(first, wrongKey, epoch, "file:one"));
  first[first.length - 1] ^= 1;
  await assert.rejects(decryptBytes(first, key, epoch, "file:one"));
});
test("minimum KDF cost enforced; object path derives from ciphertext, unsafe refs rejected", async () => {
  const kdf = newKdf();
  await assert.rejects(deriveKey("test", { ...kdf, iterations: 599_999 }));
  const key = await deriveKey("synthetic-test-secret", kdf);
  const object = await encryptedObject(
    { example: true },
    key,
    "epoch",
    "index",
  );
  assert.equal(object.ref.path, `objects/${await sha256(object.bytes)}.bin`);
  assert.doesNotThrow(() => validateRef(object.ref));
  assert.throws(() =>
    validateRef({ ...object.ref, path: "../../samples/seed/frchat-seed.json" }),
  );
  assert.throws(() => validateManifest({ schema: "other" }));
});
