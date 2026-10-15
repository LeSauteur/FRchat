import test from "node:test";
import assert from "node:assert/strict";
import {
  postStatus,
  dayKey,
  dateEnd,
  occurrences,
  DAY,
} from "../src/lib/dates.mjs";
import { filterPosts, periodBounds } from "../src/lib/filters.mjs";
import { importSeed, safeUrl } from "../src/lib/model.mjs";
const base = {
  id: "synthetic",
  category_id: "test",
  title: "Учебный отчёт",
  body: "Текст",
  state: "active",
  priority: "normal",
  dates: [],
  links: [],
  history: [],
  attachments: [],
  expected_attachments: [],
  reminded_at: [],
  related: [],
  created_at: "2026-09-15T12:00:00+03:00",
  updated_at: "2026-09-15T12:00:00+03:00",
};
test("Moscow day is independent of device timezone", () => {
  assert.equal(dayKey("2026-10-14T21:01:00Z"), "2026-10-15");
  assert.equal(dayKey("2026-10-14T20:59:00Z"), "2026-10-14");
});
test("deadline grace lasts exactly 24 hours; closed archives immediately", () => {
  const post = {
    ...base,
    dates: [
      { id: "due", kind: "deadline", start: "2026-10-05T15:00:00+03:00" },
    ],
  };
  assert.equal(postStatus(post, "2026-10-05T15:00:00+03:00").id, "overdue");
  assert.equal(postStatus(post, "2026-10-06T14:59:59+03:00").archive, false);
  assert.equal(postStatus(post, "2026-10-06T15:00:00+03:00").archive, true);
  assert.equal(
    postStatus({ ...post, state: "closed" }, "2026-10-01T00:00:00+03:00")
      .archive,
    true,
  );
});
test("event lasts two hours by default; final future session holds post active", () => {
  const dates = [
    { id: "one", kind: "event", start: "2026-10-08T11:00:00+03:00" },
    { id: "two", kind: "event", start: "2026-10-08T14:00:00+03:00" },
  ];
  assert.equal(dateEnd(dates[0]) - Date.parse(dates[0].start), 7_200_000);
  assert.equal(
    postStatus({ ...base, dates }, "2026-10-08T13:30:00+03:00").archive,
    false,
  );
  assert.equal(
    postStatus({ ...base, dates }, "2026-10-08T16:00:00+03:00").archive,
    true,
  );
});
test("all-day deadline is end of Moscow day, with grace afterward", () => {
  const post = {
    ...base,
    dates: [
      {
        id: "due",
        kind: "deadline",
        allDay: true,
        start: "2026-10-02T00:00:00+03:00",
      },
    ],
  };
  assert.equal(postStatus(post, "2026-10-02T23:59:59+03:00").id, "upcoming");
  assert.equal(postStatus(post, "2026-10-03T00:00:00+03:00").id, "overdue");
});
test("weekly sessions use per-occurrence links and cancellation; no link leaks into next week", () => {
  const post = {
    ...base,
    dates: [
      {
        id: "weekly",
        kind: "event",
        start: "2026-09-22T11:00:00+03:00",
        recurrence: {
          frequency: "weekly",
          weekdays: [2],
          occurrence_links: [
            { occurrence_date: "2026-09-29", url: "https://example.org/one" },
          ],
          exceptions: [{ occurrence_date: "2026-10-06", state: "cancelled" }],
        },
      },
    ],
  };
  const list = occurrences(
    post,
    "2026-09-22T00:00:00+03:00",
    "2026-10-14T00:00:00+03:00",
  );
  assert.equal(list.length, 4);
  assert.equal(list[1].meeting_url, "https://example.org/one");
  assert.equal(list[2].cancelled, true);
  assert.equal(list[3].meeting_url, undefined);
  assert.equal(list[0].end, undefined);
  assert.equal(postStatus(post, "2027-01-01T00:00:00+03:00").archive, false);
});
test("search folds case and ё; filters combine categories and publication range", () => {
  const post = { ...base, source: "Отдел" };
  assert.equal(
    filterPosts([post], { q: "ОТЧЕТ", categories: ["test"] }).length,
    1,
  );
  assert.equal(filterPosts([post], { categories: ["other"] }).length, 0);
  assert.deepEqual(
    periodBounds("week", new Date("2026-10-15T01:00:00+03:00")),
    ["2026-10-12", "2026-10-19"],
  );
  assert.deepEqual(
    periodBounds("month", new Date("2026-12-15T01:00:00+03:00")),
    ["2026-12-01", "2027-01-01"],
  );
});
test("import strips admin notes, deduces closed_at and preserves authored dates", () => {
  const post = {
    ...base,
    source: "Отдел",
    state: "closed",
    review_notes: ["private"],
    origin_message_ids: [3],
    history: [{ id: "h", type: "closed", at: "2026-10-05T15:00:00+03:00" }],
  };
  const result = importSeed({
    schema: "frchat-seed/1",
    categories: [{ id: "test" }],
    posts: [post],
  }).posts[0];
  assert.equal(result.closed_at, "2026-10-05T15:00:00+03:00");
  assert.equal("review_notes" in result, false);
  assert.equal("origin_message_ids" in result, false);
  assert.throws(() => importSeed({ schema: "bad" }));
  assert.equal(safeUrl("javascript:alert(1)"), null);
});
