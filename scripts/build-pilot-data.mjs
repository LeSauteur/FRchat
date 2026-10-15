import { readFile, writeFile, mkdir, readdir, unlink } from "node:fs/promises";
import { resolve, dirname, sep, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { importSeed } from "../src/lib/model.mjs";
import {
  newKdf,
  deriveKey,
  encryptedObject,
  encryptBytes,
  sha256,
} from "../src/lib/crypto.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const local = resolve(root, ".local");
const data = importSeed(
  JSON.parse(
    await readFile(resolve(root, "samples/seed/frchat-seed.json"), "utf8"),
  ),
);
await mkdir(local, { recursive: true });
const codePath = resolve(local, "pilot-access-code.txt");
let code;
try {
  code = (await readFile(codePath, "utf8")).trim();
} catch {
  code = randomBytes(24).toString("base64url");
  await writeFile(codePath, code + "\n", { mode: 0o600, flag: "wx" });
}
if (code.length < 20) throw new Error("Код доступа слишком короткий");
const kdf = newKdf();
const epoch = randomBytes(16).toString("hex");
const key = await deriveKey(code, kdf);
const output = new Map();
async function store(value, id) {
  const object = await encryptedObject(value, key, epoch, id);
  output.set(object.ref.path, object.bytes);
  return object.ref;
}
// Files are attached explicitly by post id; no guessing from sensitive filenames.
let mapping = [];
try {
  mapping = JSON.parse(
    await readFile(
      resolve(root, "samples/seed/files/attachments.json"),
      "utf8",
    ),
  );
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
for (const entry of mapping) {
  const post = data.posts.find((p) => p.id === entry.post_id);
  if (!post || typeof entry.file !== "string")
    throw new Error("Некорректная привязка вложения");
  const fileRoot = resolve(root, "samples/seed/files");
  const path = resolve(fileRoot, entry.file);
  if (!path.startsWith(fileRoot + sep))
    throw new Error("Файл вне папки вложений");
  const bytes = new Uint8Array(await readFile(path));
  if (bytes.length > 25 * 1024 * 1024)
    throw new Error("Вложение больше 25 MiB");
  const objectId = `file:${randomBytes(16).toString("hex")}`;
  const encrypted = await encryptBytes(bytes, key, epoch, objectId);
  const hash = await sha256(encrypted);
  const ref = {
    path: `objects/${hash}.bin`,
    sha256: hash,
    object_id: objectId,
  };
  output.set(ref.path, encrypted);
  const types = {
    ".xlsx":
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xls": "application/vnd.ms-excel",
    ".pdf": "application/pdf",
    ".docx":
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
  };
  post.attachments.push({
    id: randomBytes(12).toString("hex"),
    name: basename(path),
    mime: types[extname(path).toLowerCase()] ?? "application/octet-stream",
    size: bytes.length,
    sha256: await sha256(bytes),
    uploaded_at: new Date().toISOString(),
    ref,
    permanent_template: Boolean(entry.permanent_template),
  });
  if (entry.expected_label)
    post.expected_attachments = post.expected_attachments.filter(
      (a) => a.label !== entry.expected_label,
    );
}
const groups = Map.groupBy(data.posts, (p) => p.created_at.slice(0, 7));
const months = [];
for (const [month, posts] of groups)
  months.push({
    month,
    ...(await store({ schema_version: 1, posts }, `month:${month}`)),
  });
const { posts: _posts, ...settings } = data;
const index = await store(
  { ...settings, count: data.posts.length, months },
  "index",
);
const manifest = { schema: "frchat-manifest/1", key_epoch: epoch, kdf, index };
output.set("manifest.json", new TextEncoder().encode(JSON.stringify(manifest)));
for (const target of [
  resolve(local, "pilot-data"),
  resolve(root, "public/pilot-data"),
]) {
  if (!target.startsWith(root + sep))
    throw new Error("Выход за пределы проекта");
  await mkdir(resolve(target, "objects"), { recursive: true });
  for (const [path, bytes] of output)
    await writeFile(resolve(target, path), bytes);
  for (const name of await readdir(resolve(target, "objects")))
    if (!output.has(`objects/${name}`) && /^[a-f0-9]{64}\.bin$/.test(name))
      await unlink(resolve(target, "objects", name));
}
await writeFile(
  resolve(local, "pilot-build-report.json"),
  JSON.stringify(
    {
      posts: data.posts.length,
      months: months.length,
      expected_files: data.posts.reduce(
        (n, p) => n + p.expected_attachments.length,
        0,
      ),
      attached_files: mapping.length,
      built_at: new Date().toISOString(),
    },
    null,
    2,
  ),
);
console.log(
  `Подготовлено ${data.posts.length} публикаций, ${months.length} месячных блоков. Только шифротекст: public/pilot-data/. Код: .local/pilot-access-code.txt (не выводится).`,
);
