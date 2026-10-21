import test from "node:test";
import assert from "node:assert/strict";
import { filterPosts } from "../src/lib/filters.mjs";
import {
  matchesQuery,
  groupSearchResults,
  comparePublicationTime,
} from "../src/lib/search.mjs";
const post = {
  id: "report",
  category_id: "reporting",
  title: "Ежемесячные отчёты",
  body: "Отчёты принимаются только на почту: qa@example.org. Файл приложите одним письмом.",
  source: "Учебный отдел",
  state: "active",
  priority: "normal",
  pinned: false,
  created_at: "2026-10-01T10:00:00+03:00",
  updated_at: "2026-10-01T10:00:00+03:00",
  dates: [],
  reminded_at: [],
  attachments: [],
  expected_attachments: [],
};
test("common search matches separate Russian words and inflections, without requiring the exact phrase", () => {
  assert.equal(matchesQuery(post, "почта для отчетов"), true);
  assert.equal(matchesQuery(post, "ОТЧЁТОВ почта"), true);
  assert.equal(matchesQuery(post, "почта неизвестное"), false);
  assert.equal(matchesQuery(post, "qa@example.org"), true);
  assert.equal(
    matchesQuery(
      {
        ...post,
        links: [
          { label: "Образец расчёта", url: "https://example.org/template" },
        ],
      },
      "образец расчета",
    ),
    true,
  );
});
test("global results group active, archived and reference entries; deleted entries stay out", () => {
  const archive = { ...post, id: "archive", state: "closed" },
    reference = {
      ...post,
      id: "reference",
      type: "reference",
      category_id: "reference-details",
    },
    deleted = { ...post, id: "deleted", state: "deleted" };
  const found = filterPosts(
    [post, archive, reference, deleted],
    { q: "почта для отчётов" },
    new Date("2026-10-21T12:00:00+03:00"),
    "all",
  );
  assert.equal(found.length, 3);
  assert.deepEqual(
    groupSearchResults(found).map((g) => [g.id, g.posts.map((p) => p.id)]),
    [
      ["active", ["report"]],
      ["archive", ["archive"]],
      ["reference", ["reference"]],
    ],
  );
});
test("publication/reminder order ignores maintenance edits and pinned state", () => {
  const older = {
      ...post,
      id: "older",
      pinned: true,
      updated_at: "2026-12-30T10:00:00+03:00",
    },
    newer = { ...post, id: "newer", created_at: "2026-10-20T10:00:00+03:00" },
    reminded = {
      ...post,
      id: "reminded",
      reminded_at: [{ at: "2026-10-21T09:00:00+03:00" }],
    };
  assert.deepEqual(
    [older, newer, reminded].sort(comparePublicationTime).map((p) => p.id),
    ["reminded", "newer", "older"],
  );
  assert.deepEqual(
    filterPosts([older, newer, reminded]).map((p) => p.id),
    ["reminded", "newer", "older"],
  );
});
