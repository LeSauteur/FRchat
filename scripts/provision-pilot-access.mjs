import {
  readFile,
  writeFile,
  mkdir,
  readdir,
  copyFile,
  unlink,
} from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { importSeed } from "../src/lib/model.mjs";
import {
  deriveKey,
  newKdf,
  decodeJson,
  decryptBytes,
  encryptedObject,
  encryptBytes,
  sha256,
} from "../src/lib/crypto.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const local = resolve(root, ".local"),
  folder = resolve(root, "public/pilot-data");
await mkdir(local, { recursive: true });
const previous = JSON.parse(
  await readFile(resolve(folder, "manifest.json"), "utf8"),
);
if (previous.schema !== "frchat-manifest/1")
  throw new Error(
    "Доступы уже подготовлены. Повторная генерация без процедуры ротации запрещена.",
  );
const oldCode = (
  await readFile(resolve(local, "pilot-access-code.txt"), "utf8")
).trim();
const oldKey = await deriveKey(oldCode, previous.kdf);
async function read(ref) {
  const bytes = new Uint8Array(await readFile(resolve(folder, ref.path)));
  if ((await sha256(bytes)) !== ref.sha256)
    throw new Error("Повреждён исходный объект");
  return decryptBytes(bytes, oldKey, previous.key_epoch, ref.object_id);
}
const index = decodeJson(await read(previous.index));
const posts = [];
for (const month of index.months)
  posts.push(...decodeJson(await read(month)).posts);
if (posts.length !== index.count) throw new Error("Неполный исходный набор");
// Apply the reviewed seed corrections while preserving real files and stable IDs.
const reviewed = importSeed(
  JSON.parse(
    await readFile(resolve(root, "samples/seed/frchat-seed.json"), "utf8"),
  ),
);
if (
  posts.length !== reviewed.posts.length ||
  posts.some((p) => !reviewed.posts.some((s) => s.id === p.id))
)
  throw new Error(
    "Рабочий набор отличается от seed. Нужна отдельная миграция без потери новых публикаций.",
  );
for (let i = 0; i < posts.length; i++) {
  const corrected = reviewed.posts.find((p) => p.id === posts[i].id);
  posts[i] = { ...corrected, attachments: posts[i].attachments };
}
const accounts = [
  { id: "admin", label: "Руководство", role: "admin" },
  ...Array.from({ length: 5 }, (_, i) => ({
    id: `user${i + 1}`,
    label: `Участник ${i + 1}`,
    role: "reader",
  })),
].map((a) => ({
  ...a,
  password: randomBytes(a.role === "admin" ? 24 : 12).toString("base64url"),
  issued_to: "",
}));
const code = randomBytes(24).toString("base64url"),
  kdf = newKdf(),
  key = await deriveKey(code, kdf),
  epoch = randomBytes(16).toString("hex");
const objects = new Map();
async function store(value, objectId, objectKey = key) {
  const result = await encryptedObject(value, objectKey, epoch, objectId);
  objects.set(result.ref.path, result.bytes);
  return result.ref;
}
for (const post of posts)
  for (const file of post.attachments ?? []) {
    const plain = await read(file.ref);
    if ((await sha256(plain)) !== file.sha256)
      throw new Error("Повреждено вложение");
    const objectId = `file:${randomBytes(16).toString("hex")}`;
    const encrypted = await encryptBytes(plain, key, epoch, objectId),
      hash = await sha256(encrypted);
    file.ref = {
      path: `objects/${hash}.bin`,
      sha256: hash,
      object_id: objectId,
    };
    objects.set(file.ref.path, encrypted);
  }
const months = [];
for (const [month, entries] of Map.groupBy(posts, (p) =>
  p.created_at.slice(0, 7),
))
  months.push({
    month,
    ...(await store({ schema_version: 1, posts: entries }, `month:${month}`)),
  });
const manifest = {
  schema: "frchat-manifest/2",
  key_epoch: epoch,
  kdf,
  index: await store(
    {
      ...index,
      categories: reviewed.categories,
      months,
      generated_at: new Date().toISOString(),
    },
    "index",
  ),
  accounts: [],
  updated_at: new Date().toISOString(),
};
for (const account of accounts) {
  const accountKdf = newKdf(),
    accountKey = await deriveKey(account.password, accountKdf);
  const credential = await store(
    {
      schema: "frchat-access/1",
      id: account.id,
      role: account.role,
      data_code: code,
    },
    `access:${account.id}`,
    accountKey,
  );
  manifest.accounts.push({
    id: account.id,
    label: account.label,
    kdf: accountKdf,
    credential,
  });
}
// Save a recoverable local backup before replacing the bootstrap snapshot or key.
const backup = resolve(local, "before-admin-access");
await mkdir(resolve(backup, "objects"), { recursive: true });
await copyFile(
  resolve(folder, "manifest.json"),
  resolve(backup, "manifest.json"),
);
for (const file of await readdir(resolve(folder, "objects")))
  await copyFile(
    resolve(folder, "objects", file),
    resolve(backup, "objects", file),
  );
await writeFile(resolve(backup, "access-code.txt"), oldCode + "\n", {
  mode: 0o600,
  flag: "wx",
});
await writeFile(
  resolve(local, "pilot-accounts.json"),
  JSON.stringify({ created_at: new Date().toISOString(), accounts }, null, 2),
  { mode: 0o600, flag: "wx" },
);
await writeFile(
  resolve(local, "PILOT_PASSWORDS.md"),
  [
    "# Временные доступы FRchat",
    "",
    "Адрес: https://lesauteur.github.io/FRchat/",
    "",
    "Передавайте каждому участнику только его строку. Не отправляйте весь файл в общий чат.",
    "",
    "| Логин | Пароль | Роль | Кому выдан |",
    "| --- | --- | --- | --- |",
    ...accounts.map(
      (a) =>
        `| ${a.id} | ${a.password} | ${a.role === "admin" ? "Руководство — редактор" : "Только чтение"} | |`,
    ),
    "",
    "Только Алексей: после входа admin откройте #/setup и подключите fine-grained GitHub-токен только для LeSauteur/FRchat-data, Contents: Read and write. Он хранится в репозитории данных зашифрованным ключом от длинного пароля admin. Руководителю нужен только пароль.",
    "",
    "Файл содержит секреты. Не добавлять в Git и не публиковать.",
    "",
  ].join("\n"),
  { mode: 0o600, flag: "wx" },
);
for (const [path, bytes] of objects)
  await writeFile(resolve(folder, path), bytes);
await writeFile(resolve(folder, "manifest.json"), JSON.stringify(manifest));
await writeFile(resolve(local, "pilot-access-code.txt"), code + "\n", {
  mode: 0o600,
});
for (const file of await readdir(resolve(folder, "objects")))
  if (/^[a-f0-9]{64}\.bin$/.test(file) && !objects.has(`objects/${file}`))
    await unlink(resolve(folder, "objects", file));
console.log(
  `Сохранено ${posts.length} публикаций; создано ${accounts.length} отдельных доступов. Пароли только в .local/PILOT_PASSWORDS.md; прежний ключ заменён.`,
);
