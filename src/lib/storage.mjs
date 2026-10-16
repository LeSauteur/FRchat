import { deriveKey, decryptBytes, decodeJson, sha256 } from "./crypto.mjs";
import { validateSnapshot } from "./model.mjs";
export function validateManifest(value) {
  if (
    !["frchat-manifest/1", "frchat-manifest/2"].includes(value?.schema) ||
    !/^[a-f0-9]{32}$/.test(value.key_epoch) ||
    !value.index ||
    !value.kdf
  )
    throw new Error("Формат хранилища не поддерживается");
  validateRef(value.index);
  if (value.schema === "frchat-manifest/2") {
    if (
      !Array.isArray(value.accounts) ||
      !value.accounts.length ||
      value.accounts.length > 100 ||
      new Set(value.accounts.map((a) => a.id)).size !== value.accounts.length
    )
      throw new Error("Некорректный список доступов");
    for (const account of value.accounts) {
      if (
        !/^[a-z0-9-]{1,40}$/.test(account.id) ||
        typeof account.label !== "string" ||
        !account.kdf
      )
        throw new Error("Некорректный доступ");
      validateRef(account.credential);
    }
  }
  return value;
}
export function validateRef(ref) {
  if (
    !ref ||
    !/^[a-f0-9]{64}$/.test(ref.sha256) ||
    ref.path !== `objects/${ref.sha256}.bin` ||
    typeof ref.object_id !== "string"
  )
    throw new Error("Некорректная ссылка на объект");
}
async function fetchBytes(url) {
  const response = await fetch(url, {
    cache: "no-cache",
    credentials: "omit",
    referrerPolicy: "no-referrer",
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`Источник недоступен (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}
export async function loadManifest(sources, base, { fresh = false } = {}) {
  for (const source of sources) {
    try {
      let resolved = source;
      const original = new URL(source, base);
      // raw's branch URL can lag behind a successful write. Discover the public ref once,
      // then read the entire immutable snapshot by commit, without any reader token.
      if (
        original.href ===
        "https://raw.githubusercontent.com/LeSauteur/FRchat-data/main/"
      ) {
        let cached = null;
        try {
          cached = JSON.parse(readLocal("frchat.data-head.v1", "null"));
        } catch {}
        let head =
          !fresh &&
          cached?.at > Date.now() - 60_000 &&
          /^[a-f0-9]{40}$/.test(cached?.sha)
            ? cached.sha
            : "";
        if (!head) {
          try {
            const response = await fetch(
              `https://api.github.com/repos/LeSauteur/FRchat-data/git/ref/heads/main?v=${Date.now()}`,
              {
                credentials: "omit",
                redirect: "error",
                referrerPolicy: "no-referrer",
                cache: "no-cache",
                signal: AbortSignal.timeout(12000),
              },
            );
            if (!response.ok) throw new Error("Public ref unavailable");
            head = (await response.json()).object?.sha;
            if (!/^[a-f0-9]{40}$/.test(head))
              throw new Error("Invalid public ref");
            writeLocal(
              "frchat.data-head.v1",
              JSON.stringify({ sha: head, at: Date.now() }),
            );
          } catch {
            head = "";
          }
        }
        if (head)
          resolved = `https://raw.githubusercontent.com/LeSauteur/FRchat-data/${head}/`;
      }
      const url = new URL("manifest.json", new URL(resolved, base));
      const manifest = validateManifest(decodeJson(await fetchBytes(url)));
      return { manifest, source: resolved };
    } catch {
      /* Try the next configured source without sending any key. */
    }
  }
  throw new Error(
    "Не удалось загрузить данные. Проверьте соединение или откройте ссылку в обычном браузере.",
  );
}
export async function loadObject(ref, manifest, key, sources, base) {
  validateRef(ref);
  for (const source of sources) {
    try {
      const bytes = await fetchBytes(new URL(ref.path, new URL(source, base)));
      if ((await sha256(bytes)) !== ref.sha256)
        throw new Error("Контрольная сумма не совпала");
      return await decryptBytes(bytes, key, manifest.key_epoch, ref.object_id);
    } catch {
      /* Other sources must serve the exact same immutable ciphertext. */
    }
  }
  throw new Error(
    "Код не подошёл или данные не удалось прочитать. Проверьте код и соединение.",
  );
}
export async function loadSnapshotWithKey(manifest, key, sources, base) {
  const index = decodeJson(
    await loadObject(manifest.index, manifest, key, sources, base),
  );
  if (
    index.schema_version !== 1 ||
    !Array.isArray(index.months) ||
    index.months.length > 240
  )
    throw new Error("Некорректный индекс");
  const posts = [];
  // One key derivation per unlock. Key remains in memory for all cards/files.
  for (const ref of index.months)
    posts.push(
      ...decodeJson(await loadObject(ref, manifest, key, sources, base)).posts,
    );
  if (
    posts.length !== index.count ||
    new Set(posts.map((p) => p.id)).size !== posts.length
  )
    throw new Error("Хранилище неполное");
  return validateSnapshot({ ...index, posts });
}
export async function unlockSnapshot(
  manifest,
  password,
  sources,
  base,
  accountId = "",
) {
  let code = password,
    accessKey = null;
  let access = null;
  let identity = { id: "legacy", label: "Участник пилота", role: "reader" };
  if (manifest.schema === "frchat-manifest/2") {
    const account = manifest.accounts.find((a) => a.id === accountId);
    if (!account) throw new Error("Выберите свой логин и введите пароль.");
    try {
      accessKey = await deriveKey(password, account.kdf);
      const credential = decodeJson(
        await loadObject(
          account.credential,
          manifest,
          accessKey,
          sources,
          base,
        ),
      );
      if (
        credential.schema !== "frchat-access/1" ||
        credential.id !== accountId ||
        !["reader", "admin"].includes(credential.role) ||
        typeof credential.data_code !== "string" ||
        credential.data_code.length < 20
      )
        throw new Error("Неверный доступ");
      code = credential.data_code;
      access = credential;
      identity = { id: accountId, label: account.label, role: credential.role };
    } catch {
      throw new Error(
        "Пароль не подошёл или источник данных недоступен. Проверьте логин, пароль и соединение.",
      );
    }
  }
  const key = await deriveKey(code, manifest.kdf);
  const snapshot = await loadSnapshotWithKey(manifest, key, sources, base);
  return { snapshot, key, accessKey, identity, access };
}
/** @param {string} key @param {string|null} fallback */
export function readLocal(key, fallback = null) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
export function writeLocal(key, value) {
  try {
    value === null
      ? localStorage.removeItem(key)
      : localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
