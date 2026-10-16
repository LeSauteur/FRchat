import {
  base64,
  encodeJson,
  decodeJson,
  encryptBytes,
  decryptBytes,
} from "./crypto.mjs";
import { readLocal, writeLocal } from "./storage.mjs";
export async function saveDraft(draft, identity, key, epoch) {
  const bytes = await encryptBytes(
    encodeJson(draft),
    key,
    epoch,
    `draft:${identity.id}`,
  );
  return writeLocal(`frchat.draft.v1.${identity.id}`, base64(bytes));
}
export async function loadDraft(identity, key, epoch) {
  try {
    const text = readLocal(`frchat.draft.v1.${identity.id}`);
    // Drafts can contain several pasted messages, unlike small KDF/header encodings.
    if (!text || text.length > 3_000_000) return null;
    const bytes = Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
    return decodeJson(
      await decryptBytes(bytes, key, epoch, `draft:${identity.id}`),
    );
  } catch {
    return null;
  }
}
export const clearDraft = (id) => writeLocal(`frchat.draft.v1.${id}`, null);
