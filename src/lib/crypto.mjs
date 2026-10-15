const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
export const MIN_ITERATIONS = 600_000;

export function base64(bytes) {
  let text = "";
  for (let i = 0; i < bytes.length; i += 8192)
    text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
}
export function unbase64(text) {
  if (typeof text !== "string" || text.length > 16384)
    throw new Error("Некорректный контейнер");
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}
export function newKdf() {
  return {
    name: "PBKDF2",
    hash: "SHA-256",
    iterations: MIN_ITERATIONS,
    salt: base64(crypto.getRandomValues(new Uint8Array(16))),
  };
}
export async function deriveKey(code, kdf) {
  if (
    !code ||
    kdf?.name !== "PBKDF2" ||
    kdf.hash !== "SHA-256" ||
    !Number.isInteger(kdf.iterations) ||
    kdf.iterations < MIN_ITERATIONS ||
    kdf.iterations > 2_000_000
  )
    throw new Error("Неподдерживаемые параметры доступа");
  const salt = unbase64(kdf.salt);
  if (salt.length < 16 || salt.length > 64)
    throw new Error("Некорректная соль");
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(code),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: kdf.hash, salt, iterations: kdf.iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
export async function sha256(bytes) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
}
export async function encryptBytes(bytes, key, epoch, objectId) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const header = encoder.encode(
    JSON.stringify({
      schema: "frchat-object/1",
      epoch,
      objectId,
      iv: base64(iv),
    }),
  );
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: header, tagLength: 128 },
      key,
      bytes,
    ),
  );
  const result = new Uint8Array(8 + header.length + encrypted.length);
  result.set(encoder.encode("FRC1"));
  new DataView(result.buffer).setUint32(4, header.length);
  result.set(header, 8);
  result.set(encrypted, 8 + header.length);
  return result;
}
export async function decryptBytes(bytes, key, epoch, objectId) {
  if (bytes.length < 24 || decoder.decode(bytes.subarray(0, 4)) !== "FRC1")
    throw new Error("Некорректный контейнер");
  const size = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(4);
  if (size < 1 || size > 16384 || 8 + size + 16 > bytes.length)
    throw new Error("Некорректный заголовок");
  const rawHeader = bytes.subarray(8, 8 + size);
  const header = JSON.parse(decoder.decode(rawHeader));
  if (
    header.schema !== "frchat-object/1" ||
    header.epoch !== epoch ||
    header.objectId !== objectId
  )
    throw new Error("Неверная версия объекта");
  const iv = unbase64(header.iv);
  if (iv.length !== 12) throw new Error("Некорректный IV");
  return new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: rawHeader, tagLength: 128 },
      key,
      bytes.subarray(8 + size),
    ),
  );
}
export const encodeJson = (value) => encoder.encode(JSON.stringify(value));
export const decodeJson = (bytes) => JSON.parse(decoder.decode(bytes));
export async function encryptedObject(value, key, epoch, objectId) {
  const bytes = await encryptBytes(encodeJson(value), key, epoch, objectId);
  const hash = await sha256(bytes);
  return {
    ref: { path: `objects/${hash}.bin`, sha256: hash, object_id: objectId },
    bytes,
  };
}
