import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { checkInstructionPublication } from "../scripts/check-instruction-publication.mjs";

test("reviewed public snapshot is pinned; modified catalogs and unreviewed forms block publication", async () => {
  const folder = await mkdtemp(resolve(tmpdir(), "frchat-publication-"));
  try {
    for (const name of ["scripts", "src/data", "public/instruction-files"])
      await mkdir(resolve(folder, name), { recursive: true });
    for (const name of [
      "scripts/instruction-publication.json",
      "src/data/instruction.json",
      "public/instruction-files",
    ])
      await cp(new URL("../" + name, import.meta.url), resolve(folder, name), {
        recursive: true,
      });
    await checkInstructionPublication(folder);
    const bundlePath = resolve(folder, "src/data/instruction.json");
    const original = await readFile(bundlePath);
    const bundle = JSON.parse(original);
    bundle.offices[0].private_note = "synthetic internal-only note";
    await writeFile(bundlePath, JSON.stringify(bundle));
    await assert.rejects(
      checkInstructionPublication(folder),
      /Instruction changed/,
    );
    await writeFile(bundlePath, original);
    await writeFile(
      resolve(folder, "public/instruction-files/unreviewed.txt"),
      "synthetic file",
    );
    await assert.rejects(
      checkInstructionPublication(folder),
      /Unreviewed instruction files/,
    );
    await rm(resolve(folder, "public/instruction-files/unreviewed.txt"));
    await writeFile(
      resolve(folder, "public/instruction-files/agent-offer.docx"),
      "synthetic modified form",
    );
    await assert.rejects(
      checkInstructionPublication(folder),
      /Unreviewed form contents/,
    );
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
