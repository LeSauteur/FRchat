import { execFileSync } from "node:child_process";
import { writeFile, rm, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
export const DATA = "/repos/LeSauteur/FRchat-data";
// Use gh's configured credential store. Never export its broad token into the application.
export async function ghData(method, path, payload) {
  const args = ["api", path, "--method", method];
  let file;
  if (payload !== undefined) {
    await mkdir(".local", { recursive: true });
    file = resolve(".local", `gh-input-${crypto.randomUUID()}.json`);
    await writeFile(file, JSON.stringify(payload), { mode: 0o600 });
    args.push("--input", file);
  }
  try {
    return JSON.parse(
      execFileSync("gh", args, {
        encoding: "utf8",
        maxBuffer: 100 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
  } catch (e) {
    throw new Error(
      `gh api ${method} ${path}: ${e.stderr?.toString().slice(0, 600) || e.message}`,
    );
  } finally {
    if (file) await rm(file, { force: true });
  }
}
export async function atomicDataWrite(objects, message, head, treeSha) {
  const tree = [];
  for (const [path, bytes] of objects) {
    const blob = await ghData("POST", `${DATA}/git/blobs`, {
      content: Buffer.from(bytes).toString("base64"),
      encoding: "base64",
    });
    tree.push({ path, mode: "100644", type: "blob", sha: blob.sha });
  }
  const nextTree = await ghData("POST", `${DATA}/git/trees`, {
    ...(treeSha ? { base_tree: treeSha } : {}),
    tree,
  });
  const commit = await ghData("POST", `${DATA}/git/commits`, {
    message,
    tree: nextTree.sha,
    parents: head ? [head] : [],
  });
  await ghData("PATCH", `${DATA}/git/refs/heads/main`, {
    sha: commit.sha,
    force: false,
  });
  return commit.sha;
}
