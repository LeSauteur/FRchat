import test from "node:test";
import assert from "node:assert/strict";
import {
  similarPosts,
  categoryTemplateWords,
  prepareDuplicateUpdate,
  seriesPreview,
} from "../src/lib/duplicates.mjs";
import { occurrences } from "../src/lib/dates.mjs";
const post = (id, body, day = "2026-10-20") => ({
  id,
  type: "post",
  category_id: "developers",
  title: body.split("\n")[0],
  body,
  created_at: "2026-09-01T10:00:00+03:00",
  updated_at: "2026-09-01T10:00:00+03:00",
  state: "active",
  dates: day
    ? [{ id: `date-${id}`, kind: "event", start: `${day}T11:00:00+03:00` }]
    : [],
  links: [],
  attachments: [{ id: "old-file" }],
  history: [],
  reminded_at: [],
});
const options = {
  id: "update-1",
  at: "2026-10-21T11:00:00+03:00",
  by: "Тестовый отдел",
};
test("dates gate exact and template matches before text scoring; same-day time changes remain reviewable", () => {
  const old = post(
    "old",
    "Брокер-тур учебного квартала. Послушаем презентацию и узнаем акции.",
  );
  assert.deepEqual(
    similarPosts(post("new", old.body, "2026-10-21"), [old]),
    [],
  );
  assert.equal(similarPosts(post("new", old.body), [old])[0].kind, "duplicate");
  const changed = post("changed", old.body);
  changed.dates[0].start = "2026-10-20T12:00:00+03:00";
  assert.equal(similarPosts(changed, [old])[0].additions.dates.length, 1);
});
test("words used by more than 30 percent of category posts do not contribute to similarity", () => {
  const text = "Послушаем презентацию. Строго пишем в мессенджере. ";
  const corpus = ["альфа", "бета", "гамма", "дельта"].map((name, i) =>
    post(String(i), text + name, null),
  );
  const templates = categoryTemplateWords(corpus, "developers");
  assert.ok(templates.has("послушаем") && templates.has("строго"));
  assert.equal(templates.has("альфа"), false);
  assert.deepEqual(
    similarPosts(post("new", text + "эпсилон", null), corpus),
    [],
  );
  assert.equal(
    similarPosts(post("repeat", corpus[0].body, null), corpus)[0].post.id,
    "0",
  );
  assert.equal(
    categoryTemplateWords(
      [
        ...corpus,
        ...Array.from({ length: 20 }, (_, i) => ({
          ...post("other" + i, "альфа"),
          category_id: "company",
        })),
      ],
      "developers",
    ).has("альфа"),
    false,
  );
});
test("reporting periods stay distinct even when bank-statement ranges share a date", () => {
  const old = {
    ...post(
      "august",
      "Принимаем отчёты за август 2026. Комплект одним письмом.",
    ),
    category_id: "reporting",
  };
  const fresh = {
    ...post(
      "september",
      "Принимаем отчёты за сентябрь 2026. Комплект одним письмом.",
    ),
    category_id: "reporting",
  };
  assert.deepEqual(similarPosts(fresh, [old]), []);
});
test("new links require update; preparing it preserves identity, attachments and previous text without mutating input", () => {
  const old = post(
    "old",
    "Брокер-тур учебного квартала. Запись по ссылке https://example.org/old",
  );
  old.links = [{ type: "chat", url: "https://example.org/old" }];
  const fresh = post(
    "fresh",
    "Брокер-тур учебного квартала. Запись по ссылке https://example.org/new",
  );
  fresh.links = [{ type: "chat", url: "https://example.org/new" }];
  const match = similarPosts(fresh, [old])[0],
    before = structuredClone(old);
  assert.deepEqual(match.additions.links, ["https://example.org/new"]);
  const merged = prepareDuplicateUpdate(fresh, match, options);
  assert.equal(merged.id, old.id);
  assert.equal(merged.created_at, old.created_at);
  assert.equal(merged.body, fresh.body);
  assert.deepEqual(merged.attachments, old.attachments);
  assert.equal(merged.history[0].previous_body, old.body);
  assert.deepEqual(old, before);
});
export function makeSeries() {
  return {
    ...post(
      "weekly",
      "Еженедельное собрание офисов. Каждый вторник онлайн.",
      "2026-09-29",
    ),
    category_id: "reminders",
    dates: [
      {
        id: "weekly-date",
        kind: "event",
        start: "2026-09-29T11:00:00+03:00",
        recurrence: {
          frequency: "weekly",
          weekdays: [2],
          occurrence_links: [
            { occurrence_date: "2026-09-29", url: "https://example.org/sep29" },
          ],
        },
      },
    ],
  };
}
test("other configured series match their stable heading and actual scheduled day", () => {
  const series = makeSeries();
  series.title = "Разбор сделок";
  series.body = "Разбор сделок каждую неделю.";
  const incoming = {
    ...post("fresh", "Разбор сделок 27 октября", "2026-10-27"),
    category_id: "reminders",
  };
  assert.equal(similarPosts(incoming, [series])[0].kind, "series");
  incoming.title = "Встреча партнёров";
  assert.deepEqual(similarPosts(incoming, [series]), []);
});
test("a series matches the requested occurrence and updates only its link/time; neighboring weeks retain their own links", () => {
  const series = makeSeries(),
    before = structuredClone(series);
  const incoming = {
    ...post(
      "fresh",
      "Еженедельное собрание офисов 27 октября. Подключение https://example.org/oct27",
      "2026-10-27",
    ),
    category_id: "reminders",
    links: [{ type: "meeting", url: "https://example.org/oct27" }],
  };
  incoming.dates[0].start = "2026-10-27T11:30:00+03:00";
  const match = similarPosts(incoming, [series])[0];
  assert.equal(match.kind, "series");
  assert.equal(match.occurrence_date, "2026-10-27");
  const merged = prepareDuplicateUpdate(incoming, match, options);
  assert.equal(merged.dates[0].start, series.dates[0].start);
  assert.deepEqual(merged.reminded_at, []);
  assert.equal(merged.body, series.body);
  const dates = occurrences(merged, "2026-09-28", "2026-11-05");
  assert.equal(
    dates.find((d) => d.occurrence_date === "2026-09-29").meeting_url,
    "https://example.org/sep29",
  );
  assert.equal(
    dates.find((d) => d.occurrence_date === "2026-10-27").meeting_url,
    "https://example.org/oct27",
  );
  assert.equal(
    dates.find((d) => d.occurrence_date === "2026-10-27").start,
    "2026-10-27T11:30:00+03:00",
  );
  assert.equal(
    dates.find((d) => d.occurrence_date === "2026-11-03").meeting_url,
    undefined,
  );
  assert.equal(
    dates.find((d) => d.occurrence_date === "2026-11-03").start,
    "2026-11-03T11:00:00+03:00",
  );
  assert.equal(
    seriesPreview(merged, match).dates[0].start,
    "2026-10-27T11:30:00+03:00",
  );
  assert.ok(merged.history[0].text.includes(incoming.body));
  assert.deepEqual(series, before);
  assert.deepEqual(
    similarPosts(
      {
        ...incoming,
        dates: [{ ...incoming.dates[0], start: "2026-10-28T11:00:00+03:00" }],
      },
      [series],
    ),
    [],
  );
  const ended = makeSeries();
  ended.dates[0].recurrence.until = "2026-10-20";
  assert.deepEqual(similarPosts(incoming, [ended]), []);
});
