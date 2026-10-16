import { encryptBytes, decryptBytes } from "./crypto.mjs";
const database = () => new Promise((resolve, reject) => {
  const request = indexedDB.open("frchat-private.v1", 1);
  request.onupgradeneeded = () => request.result.createObjectStore("draft-files");
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(new Error("Storage unavailable"));
});
async function record(action, id, value) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("draft-files", action === "get" ? "readonly" : "readwrite"), store = tx.objectStore("draft-files");
    const result = action === "get" ? store.get(id) : action === "put" ? store.put(value,id) : store.delete(id);
    let output;
    result.onsuccess = () => { output = result.result; };
    tx.oncomplete = () => { db.close(); resolve(output); };
    tx.onerror = () => { db.close(); reject(new Error("Storage unavailable")); };
    tx.onabort = tx.onerror;
  });
}
export async function persistDraftFile(file, account, key, epoch) {
  const ciphertext = await encryptBytes(file.bytes,key,epoch,`draft-file:${account}:${file.id}`);
  await record("put",`${account}:${file.id}`,ciphertext);
}
export async function restoreDraftFiles(files, account, key, epoch) {
  const result = [];
  for (const file of files ?? []) {
    const ciphertext = await record("get",`${account}:${file.id}`);
    if (!ciphertext) throw new Error("Файл не сохранился на устройстве. Прикрепите его ещё раз.");
    result.push({ ...file, bytes:await decryptBytes(new Uint8Array(ciphertext),key,epoch,`draft-file:${account}:${file.id}`) });
  }
  return result;
}
export async function removeDraftFiles(files, account) {
  for (const file of files) try { await record("delete",`${account}:${file.id}`); } catch {}
}
