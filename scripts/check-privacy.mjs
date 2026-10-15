import { readdir, readFile } from "node:fs/promises";
import { resolve, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export async function filesIn(path) {
  const result = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.isSymbolicLink())
      throw new Error("Символические ссылки в артефакте запрещены");
    const full = resolve(path, entry.name);
    result.push(...(entry.isDirectory() ? await filesIn(full) : [full]));
  }
  return result;
}
const files = await filesIn(resolve(root, "dist"));
let needles = [];
try {
  const seed = JSON.parse(
    await readFile(resolve(root, "samples/seed/frchat-seed.json"), "utf8"),
  );
  needles = seed.posts
    .flatMap((p) => [p.title, p.body.slice(0, 100), p.source])
    .filter((s) => s.length > 16);
  needles.push(...seed.birthdays.map((b) => b.name));
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
for (const path of files) {
  const name = relative(root, path);
  if (/(?:samples|\.local|frchat-seed|SEED_REVIEW|\.map$)/i.test(name))
    throw new Error("Приватный файл в сборке");
  const text = (await readFile(path)).toString("utf8");
  if (
    needles.some((value) => text.includes(value)) ||
    /github_pat_[A-Za-z0-9_]{20,}|ghp_[A-Za-z0-9]{20,}/.test(text)
  )
    throw new Error(`Открытые персональные данные или секрет в ${name}`);
}
console.log(
  `Проверка приватности: ${files.length} файлов, открытых данных seed и токенов нет.`,
);
