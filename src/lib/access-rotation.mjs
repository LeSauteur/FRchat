import {
  deriveKey,
  newKdf,
  encryptedObject,
  decryptBytes,
  decodeJson,
  encryptBytes,
  sha256,
  encodeJson,
} from "./crypto.mjs";
/** Build a fresh epoch from the live snapshot. Never overwrite live posts with seed data. */
export async function rotateAccess({
  remote,
  oldKey,
  accounts,
  revokedId,
  readBytes,
}) {
  if (
    !/^user[1-5]$/.test(revokedId) ||
    !remote.manifest.accounts.some((a) => a.id === revokedId)
  )
    throw new Error("Выберите действующий пользовательский доступ user1–user5");
  const epoch = crypto.randomUUID().replaceAll("-", ""),
    code = Array.from(crypto.getRandomValues(new Uint8Array(32)), (n) =>
      n.toString(16).padStart(2, "0"),
    ).join(""),
    kdf = newKdf(),
    key = await deriveKey(code, kdf),
    objects = new Map(),
    posts = structuredClone(remote.snapshot.posts);
  async function store(value, id, objectKey = key) {
    const o = await encryptedObject(value, objectKey, epoch, id);
    objects.set(o.ref.path, o.bytes);
    return o.ref;
  }
  for (const post of posts)
    for (const file of post.attachments ?? []) {
      const bytes = await readBytes(file.ref);
      if ((await sha256(bytes)) !== file.ref.sha256)
        throw new Error("Повреждено вложение");
      const plain = await decryptBytes(
        bytes,
        oldKey,
        remote.manifest.key_epoch,
        file.ref.object_id,
      );
      if ((await sha256(plain)) !== file.sha256)
        throw new Error("Повреждено вложение");
      const objectId = `file:${crypto.randomUUID()}`,
        cipher = await encryptBytes(plain, key, epoch, objectId),
        hash = await sha256(cipher);
      file.ref = {
        path: `objects/${hash}.bin`,
        sha256: hash,
        object_id: objectId,
      };
      objects.set(file.ref.path, cipher);
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
    ...remote.manifest,
    key_epoch: epoch,
    kdf,
    accounts: [],
    updated_at: new Date().toISOString(),
    index: await store(
      {
        ...remote.index,
        count: posts.length,
        months,
        generated_at: new Date().toISOString(),
      },
      "index",
    ),
  };
  for (const a of remote.manifest.accounts.filter((a) => a.id !== revokedId)) {
    const record = accounts.find((r) => r.id === a.id);
    if (!record?.password)
      throw new Error(
        "Нет локального пароля для сохранения остальных доступов",
      );
    const accessKey = await deriveKey(record.password, a.kdf),
      oldBytes = await readBytes(a.credential);
    if ((await sha256(oldBytes)) !== a.credential.sha256)
      throw new Error("Повреждён доступ");
    const payload = decodeJson(
      await decryptBytes(
        oldBytes,
        accessKey,
        remote.manifest.key_epoch,
        a.credential.object_id,
      ),
    );
    if (payload.id !== a.id || payload.schema !== "frchat-access/1")
      throw new Error("Неверный локальный пароль");
    manifest.accounts.push({
      ...a,
      credential: await store(
        { ...payload, data_code: code },
        a.credential.object_id,
        accessKey,
      ),
    });
  }
  objects.set("manifest.json", encodeJson(manifest));
  return { manifest, objects, code, key };
}
