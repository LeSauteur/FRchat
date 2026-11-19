import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// This is a reviewed public-content allowlist, not a secrecy or login check.
// The importer deliberately cannot regenerate the approval automatically.
export async function checkInstructionPublication(
  folder = root,
  { includeDist = false } = {},
) {
  const approval = JSON.parse(
    await readFile(
      resolve(folder, "scripts/instruction-publication.json"),
      "utf8",
    ),
  );
  assert.equal(approval.classification, "already-public");
  assert.equal(approval.source_url, "https://lesauteur.github.io/Instrukciya/");
  const bundleBytes = await readFile(
    resolve(folder, "src/data/instruction.json"),
  );
  assert.equal(
    sha256(bundleBytes),
    approval.bundle_sha256,
    "Instruction changed: review its public contents and approval before publishing",
  );
  const bundle = JSON.parse(bundleBytes);
  assert.equal(bundle.source_revision, approval.source_revision);
  assert.equal(bundle.source_url, approval.source_url);
  for (const [key, count] of Object.entries(approval.counts))
    assert.equal(bundle[key].length, count, key);
  const expected = approval.files.map((file) => file.name).sort();
  assert.deepEqual(bundle.files.map((file) => file.name).sort(), expected);
  for (const base of includeDist ? ["public", "dist"] : ["public"]) {
    const directory = resolve(folder, base, "instruction-files");
    const entries = await readdir(directory, { withFileTypes: true });
    assert.ok(
      entries.every((entry) => entry.isFile()),
      "Only reviewed form files are allowed",
    );
    assert.deepEqual(
      entries.map((entry) => entry.name).sort(),
      expected,
      `Unreviewed instruction files in ${base}`,
    );
    for (const file of approval.files) {
      assert.equal(
        sha256(await readFile(resolve(directory, file.name))),
        file.sha256,
        `Unreviewed form contents: ${base}/${file.name}`,
      );
      assert.equal(
        bundle.files.find((item) => item.name === file.name).sha256,
        file.sha256,
      );
    }
  }
  return approval;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await checkInstructionPublication(root, {
    includeDist: process.argv.includes("--dist"),
  });
  console.log(
    "Публичная инструкция: точный разрешённый снимок и три бланка проверены. Пароль их не скрывает.",
  );
}
