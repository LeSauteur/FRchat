import { readLocal, writeLocal } from "./storage.mjs";
export const FAVORITES_KEY = "frchat.favorites.v1";
// Keep IDs only: removed posts leave a bookmark, never a plaintext copy of a message.
export function parseFavorites(raw) {
  try {
    const value = JSON.parse(raw ?? "[]");
    return Array.isArray(value)
      ? [
          ...new Set(
            value.filter((id) => typeof id === "string" && id.length > 0),
          ),
        ]
      : [];
  } catch {
    return [];
  }
}
export const loadFavorites = () => parseFavorites(readLocal(FAVORITES_KEY));
export const saveFavorites = (ids) =>
  writeLocal(FAVORITES_KEY, JSON.stringify(ids));
