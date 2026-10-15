import test from "node:test";
import assert from "node:assert/strict";
import {
  FAVORITES_KEY,
  parseFavorites,
  loadFavorites,
  saveFavorites,
} from "../src/lib/favorites.mjs";
import { filterPosts } from "../src/lib/filters.mjs";
import { importSeed } from "../src/lib/model.mjs";
import { postStatus, isHot } from "../src/lib/dates.mjs";
import { REFERENCE_CATEGORIES } from "../src/lib/reference.mjs";
const post = {
  id: "old",
  category_id: "test",
  title: "Инструкция по отчёту",
  body: "Реквизиты",
  source: "Тест",
  priority: "normal",
  state: "active",
  created_at: "2020-01-01T12:00:00+03:00",
  updated_at: "2020-01-01T12:00:00+03:00",
  dates: [{ kind: "event", start: "2020-01-01T12:00:00+03:00" }],
  expires_at: "2020-01-02T12:00:00+03:00",
};
test("favorites accept only unique IDs, survive reload, and tolerate blocked storage", () => {
  assert.deepEqual(parseFavorites('["one","one",null,3,"", "two"]'), [
    "one",
    "two",
  ]);
  for (const raw of ["bad", "{}", "null"])
    assert.deepEqual(parseFavorites(raw), []);
  const values = new Map();
  try {
    globalThis.localStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    };
    assert.equal(saveFavorites(["one", "removed"]), true);
    assert.deepEqual(loadFavorites(), ["one", "removed"]);
    assert.equal(values.get(FAVORITES_KEY), '["one","removed"]');
    globalThis.localStorage = {
      getItem() {
        throw new Error("denied");
      },
      setItem() {
        throw new Error("denied");
      },
    };
    assert.deepEqual(loadFavorites(), []);
    assert.equal(saveFavorites(["one"]), false);
  } finally {
    delete globalThis.localStorage;
  }
});
test("favorites retain archived and deleted posts and combine with common search", () => {
  const deleted = { ...post, id: "deleted", state: "deleted" };
  const all = [post, deleted];
  const ids = ["old", "deleted", "removed"];
  assert.equal(filterPosts(all, {}, new Date(), "favorites", ids).length, 2);
  assert.equal(
    filterPosts(all, { q: "ОТЧЕТ", favorites: true }, new Date(), "all", [
      "old",
    ]).length,
    1,
  );
  assert.equal(
    filterPosts(all, { favorites: true }, new Date(), "all", []).length,
    0,
  );
  assert.equal(filterPosts(all, {}, new Date(), "all").length, 1);
  assert.equal(postStatus(deleted).id, "deleted");
});
test("reference entries ignore expired dates, stay outside feed/archive, and share search", () => {
  const reference = {
    ...post,
    type: "reference",
    category_id: "reference-contacts",
  };
  assert.equal(REFERENCE_CATEGORIES.length, 5);
  assert.equal(postStatus(reference).id, "reference");
  assert.equal(postStatus(reference).archive, false);
  assert.equal(isHot(reference), false);
  for (const section of ["active", "archive"])
    assert.equal(filterPosts([reference], {}, new Date(), section).length, 0);
  assert.equal(filterPosts([reference, post], { q: "РЕКВИЗИТЫ" }).length, 2);
  assert.equal(
    filterPosts(
      [reference, post],
      { categories: ["reference-contacts"] },
      new Date(),
      "reference",
    ).length,
    1,
  );
});
test("seed imports references with their own categories and rejects invalid categories or duplicate IDs", () => {
  const seed = {
    schema: "frchat-seed/1",
    categories: [{ id: "test" }],
    posts: [],
    references: [{ ...post, category_id: "reference-contacts" }],
  };
  const data = importSeed(seed);
  assert.equal(data.posts[0].type, "reference");
  assert.equal(data.posts[0].related.length, 0);
  assert.throws(() => importSeed({ ...seed, references: [post] }));
  assert.throws(() => importSeed({ ...seed, posts: [post] }));
});
