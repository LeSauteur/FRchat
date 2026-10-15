import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const paths = execFileSync("git", ["ls-files", "-z"], { cwd: root })
  .toString("utf8")
  .split("\0")
  .filter(Boolean);
const forbidden =
  /^(?:samples|\.local|node_modules|dist|tools|docs\/mockup)\/|^docs\/(?:PROMPT|ANALYSIS|ADDENDUM-0[12]|REVIEW-01)\.md$|(?:^|\/)(?:\.env(?:\..*)?|.*\.local)$/;
let needles = [];
try {
  const seed = JSON.parse(
    await readFile(resolve(root, "samples/seed/frchat-seed.json"), "utf8"),
  );
  needles = [...seed.posts, ...(seed.references ?? [])]
    .flatMap((post) => [post.title, post.body.slice(0, 100), post.source])
    .filter((value) => value.length > 16);
  needles.push(...(seed.birthdays ?? []).map((b) => b.name));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
try {
  needles.push(
    (
      await readFile(resolve(root, ".local/pilot-access-code.txt"), "utf8")
    ).trim(),
  );
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
for (const path of paths) {
  if (forbidden.test(path))
    throw new Error(`Приватный материал в Git: ${path}`);
  const bytes = execFileSync("git", ["show", `:${path}`], {
    cwd: root,
    maxBuffer: 32 * 1024 * 1024,
  });
  const text = bytes.toString("utf8");
  if (
    needles.some((value) => value && text.includes(value)) ||
    /(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]{20,}/.test(text)
  )
    throw new Error(`Открытые данные или секрет в Git: ${path}`);
}
console.log(
  `Проверка Git: ${paths.length} файлов, приватных исходников и известных секретов нет.`,
);
