import { readFile, writeFile, readdir, unlink } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import {
  deriveKey,
  decodeJson,
  decryptBytes,
  encryptedObject,
  encodeJson,
  sha256,
} from "../src/lib/crypto.mjs";
import { importSeed } from "../src/lib/model.mjs";
import { canonical, moscowStamp } from "../src/lib/writer.mjs";
import { ghData, DATA, atomicDataWrite } from "./gh-data.mjs";
const folder = "public/pilot-data",
  local = ".local",
  manifest = JSON.parse(await readFile(`${folder}/manifest.json`, "utf8"));
const repo = await ghData("GET", DATA);
if (repo.private || repo.size > 0)
  throw new Error(
    "Подготовка разрешена только для ещё пустого публичного хранилища. Рабочие данные не перезаписываются.",
  );
const key = await deriveKey(
  (await readFile(`${local}/pilot-access-code.txt`, "utf8")).trim(),
  manifest.kdf,
);
async function read(
  ref,
  objectKey = key,
  root = folder,
  epoch = manifest.key_epoch,
) {
  const bytes = new Uint8Array(await readFile(`${root}/${ref.path}`));
  if ((await sha256(bytes)) !== ref.sha256) throw new Error("Повреждён объект");
  return decodeJson(await decryptBytes(bytes, objectKey, epoch, ref.object_id));
}
const index = await read(manifest.index),
  posts = (await Promise.all(index.months.map((m) => read(m)))).flatMap(
    (m) => m.posts,
  );
const seed = importSeed(
  JSON.parse(await readFile("samples/seed/frchat-seed.json", "utf8")),
);
if (
  posts.length !== 46 ||
  seed.posts.some((p) => !posts.some((s) => s.id === p.id))
)
  throw new Error("Рабочий набор отличается от пилота");
const old = JSON.parse(
    await readFile(`${local}/before-admin-access/manifest.json`, "utf8"),
  ),
  oldKey = await deriveKey(
    (
      await readFile(`${local}/before-admin-access/access-code.txt`, "utf8")
    ).trim(),
    old.kdf,
  ),
  oldRead = (r) =>
    read(r, oldKey, `${local}/before-admin-access`, old.key_epoch),
  oldIndex = await oldRead(old.index),
  oldPosts = (await Promise.all(oldIndex.months.map(oldRead))).flatMap(
    (m) => m.posts,
  );
const at = moscowStamp(),
  objects = new Map(),
  changed = [];
async function store(value, id, objectKey = key) {
  const result = await encryptedObject(
    value,
    objectKey,
    manifest.key_epoch,
    id,
  );
  objects.set(result.ref.path, result.bytes);
  return result.ref;
}
for (let i = 0; i < posts.length; i++) {
  const reviewed = seed.posts.find((p) => p.id === posts[i].id),
    before = oldPosts.find((p) => p.id === posts[i].id),
    fields = (p) => ({
      category_id: p.category_id,
      title: p.title,
      body: p.body,
      dates: p.dates,
      pinned: p.pinned,
      expires_at: p.expires_at,
    });
  if (canonical(fields(before)) !== canonical(fields(reviewed))) {
    posts[i] = {
      ...reviewed,
      attachments: posts[i].attachments,
      updated_at: at,
      history: [
        ...reviewed.history,
        {
          id: crypto.randomUUID(),
          at,
          type: "data_review",
          text: "Уточнены даты и раздел по исходному сообщению",
          by: "Алексей",
        },
      ],
    };
    changed.push(posts[i].id);
  }
}
const months = [];
for (const [month, entries] of Map.groupBy(posts, (p) =>
  p.created_at.slice(0, 7),
))
  months.push({
    month,
    ...(await store({ schema_version: 1, posts: entries }, `month:${month}`)),
  });
manifest.index = await store(
  { ...index, categories: seed.categories, months, generated_at: at },
  "index",
);
manifest.updated_at = at;
const records = JSON.parse(
    await readFile(`${local}/pilot-accounts.json`, "utf8"),
  ),
  account = records.accounts.find((a) => a.id === "admin"),
  publicAccount = manifest.accounts.find((a) => a.id === "admin");
// Increase only the administrator password; the five reader passwords stay unchanged.
if (!records.long_admin_password) {
  account.password = randomBytes(24).toString("base64url");
  records.long_admin_password = true;
  publicAccount.credential = await store(
    {
      schema: "frchat-access/1",
      id: "admin",
      role: "admin",
      data_code: (
        await readFile(`${local}/pilot-access-code.txt`, "utf8")
      ).trim(),
    },
    "access:admin",
    await deriveKey(account.password, publicAccount.kdf),
  );
}
const used = new Set([
  manifest.index.path,
  ...months.map((m) => m.path),
  ...manifest.accounts.map((a) => a.credential.path),
  ...posts.flatMap((p) => p.attachments.map((f) => f.ref.path)),
]);
for (const path of used)
  if (!objects.has(path))
    objects.set(path, new Uint8Array(await readFile(`${folder}/${path}`)));
objects.set("manifest.json", encodeJson(manifest));
for (const [path, bytes] of objects)
  await writeFile(`${folder}/${path}`, bytes);
for (const f of await readdir(`${folder}/objects`))
  if (!used.has(`objects/${f}`)) await unlink(`${folder}/objects/${f}`);
await writeFile(
  `${local}/pilot-accounts.json`,
  JSON.stringify(records, null, 2),
  { mode: 0o600 },
);
let passwords = await readFile(`${local}/PILOT_PASSWORDS.md`, "utf8");
passwords = passwords.replace(
  /^\| admin \|[^\n]+/m,
  `| admin | ${account.password} | Руководство — редактор | |`,
);
passwords +=
  "\nНастройка только для Алексея: https://lesauteur.github.io/FRchat/#/setup (вход admin). Токен сохраняется зашифрованным в хранилище данных; руководителю нужен только пароль admin. Не передавайте этот файл целиком.\n";
await writeFile(`${local}/PILOT_PASSWORDS.md`, passwords, { mode: 0o600 });
// GitHub requires an initial branch for Git Data API; initialize with metadata only.
const init = await ghData("PUT", `${DATA}/contents/.gitkeep`, {
  message: "Initialize encrypted application data store",
  content: Buffer.from("FRchat encrypted data\n").toString("base64"),
});
const initial = await ghData("GET", `${DATA}/git/commits/${init.commit.sha}`);
const head = await atomicDataWrite(
  objects,
  "FRchat: initialize encrypted pilot and individual access",
  init.commit.sha,
  initial.tree.sha,
);
const raw = await fetch(
  `https://raw.githubusercontent.com/LeSauteur/FRchat-data/${head}/manifest.json`,
  { redirect: "error" },
);
if (!raw.ok) throw new Error(`Anonymous raw check failed ${raw.status}`);
const checked = await raw.json();
if (checked.index.sha256 !== manifest.index.sha256)
  throw new Error("Неверный публичный снимок");
console.log(
  JSON.stringify({
    public: true,
    anonymous_raw: true,
    posts: posts.length,
    corrected: changed,
    accounts: manifest.accounts.length,
    admin_password_bits: 192,
    head,
  }),
);
