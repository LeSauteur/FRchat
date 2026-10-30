import { readFile, writeFile } from "node:fs/promises";
import { deriveKey, decodeJson } from "../src/lib/crypto.mjs";
import { GitDataWriter } from "../src/lib/writer.mjs";
import { rotateAccess } from "../src/lib/access-rotation.mjs";
import { ghData, DATA, atomicDataWrite } from "./gh-data.mjs";
const args = process.argv.slice(2),
  ids = args.filter((a) => a !== "--apply"),
  id = ids[0];
if (ids.length !== 1 || !/^[a-z0-9-]{1,40}$/.test(id) || id === "admin")
  throw new Error(
    "Использование: npm run access:revoke -- <логин участника> [--apply]. Доступ admin отзывать нельзя.",
  );
const records = JSON.parse(
  await readFile(".local/pilot-accounts.json", "utf8"),
);
const rawManifest = await fetch(
  `https://raw.githubusercontent.com/LeSauteur/FRchat-data/main/manifest.json?v=${Date.now()}`,
);
if (!rawManifest.ok) throw new Error("Основной источник недоступен");
const manifest = await rawManifest.json();
const key = await deriveKey(
  (await readFile(".local/pilot-access-code.txt", "utf8")).trim(),
  manifest.kdf,
);
const writer = new GitDataWriter({
    request: ghData,
    key,
    epoch: manifest.key_epoch,
    identity: { id: "admin", role: "admin", label: "Алексей" },
  }),
  remote = await writer.readSnapshot();
if (!remote.manifest.accounts.some((a) => a.id === id))
  throw new Error("Этот доступ уже отозван");
console.log(
  `Будет отозван ${id}; ${remote.snapshot.posts.length} рабочих карточек и все вложения будут перешифрованы. Пароли остальных участников и подключение публикации сохранятся.`,
);
if (!process.argv.includes("--apply")) {
  console.log("Проверка без изменений. Для отзыва добавьте --apply.");
  process.exit(0);
}
async function readBytes(ref) {
  const sha = remote.paths.get(ref.path);
  if (!sha) throw new Error("Неполное хранилище");
  const blob = await ghData("GET", `${DATA}/git/blobs/${sha}`);
  return new Uint8Array(Buffer.from(blob.content, "base64"));
}
const next = await rotateAccess({
  remote,
  oldKey: key,
  accounts: records.accounts,
  revokedId: id,
  readBytes,
});
// Keep a recovery packet locally before the single atomic ref update. No force; abort if another admin writes.
const recovery = {
  at: new Date().toISOString(),
  old_epoch: manifest.key_epoch,
  new_epoch: next.manifest.key_epoch,
  new_data_code: next.code,
  revoked: id,
  parent: remote.head,
};
await writeFile(
  ".local/access-rotation-recovery.json",
  JSON.stringify(recovery, null, 2),
  { mode: 0o600 },
);
await atomicDataWrite(
  next.objects,
  "FRchat: revoke one pilot access and rotate encryption",
  remote.head,
  remote.treeSha,
);
records.accounts.find((a) => a.id === id).revoked_at = new Date().toISOString();
await writeFile(
  ".local/pilot-accounts.json",
  JSON.stringify(records, null, 2),
  { mode: 0o600 },
);
await writeFile(".local/pilot-access-code.txt", next.code + "\n", {
  mode: 0o600,
});
const markdown = await readFile(".local/PILOT_PASSWORDS.md", "utf8");
await writeFile(
  ".local/PILOT_PASSWORDS.md",
  markdown +
    `\nДоступ **${id} отозван** ${new Date().toISOString()}. Остальные пароли и поля «Кому выдан» сохранены.\n`,
  { mode: 0o600 },
);
console.log(
  `Доступ ${id} отозван. Остальным нужно войти повторно с прежним паролем. Ранее скачанные данные удалить с чужого устройства невозможно.`,
);
