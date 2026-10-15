import { deriveKey, decryptBytes, decodeJson, sha256 } from "./crypto.mjs";
import { validateSnapshot } from "./model.mjs";
export function validateManifest(value) {
  if (
    value?.schema !== "frchat-manifest/1" ||
    !/^[a-f0-9]{32}$/.test(value.key_epoch) ||
    !value.index ||
    !value.kdf
  )
    throw new Error("Формат хранилища не поддерживается");
  validateRef(value.index);
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
export async function loadManifest(sources, base) {
  for (const source of sources) {
    try {
      const url = new URL("manifest.json", new URL(source, base));
      const manifest = validateManifest(decodeJson(await fetchBytes(url)));
      return { manifest, source };
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
export async function unlockSnapshot(manifest, code, sources, base) {
  const key = await deriveKey(code, manifest.kdf);
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
  return { snapshot: validateSnapshot({ ...index, posts }), key };
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
