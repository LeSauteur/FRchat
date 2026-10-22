import test from "node:test";
import assert from "node:assert/strict";
import {
  canRemind,
  reminderDates,
  reminderChoiceKey,
  prepareReminder,
  reminderDescription,
  reminderAnnouncement,
  recentReminder,
  freshReminder,
  editCount,
} from "../src/lib/reminders.mjs";
import { prepareDuplicateUpdate } from "../src/lib/duplicates.mjs";
import { GitDataWriter } from "../src/lib/writer.mjs";
import { createAdminFixture } from "../scripts/admin-fixture.mjs";
const now = "2026-10-22T12:00:00+03:00";
const post = {
  id: "qa-reminder",
  type: "post",
  category_id: "company",
  title: "Учебные подарки",
  body: "Исходный текст",
  source: "Тестовый отдел",
  author: { id: "admin", display_name: "Руководство" },
  priority: "normal",
  pinned: false,
  state: "active",
  created_at: "2026-10-15T12:00:00+03:00",
  updated_at: "2026-10-15T12:00:00+03:00",
  history: [],
  reminded_at: [],
  links: [],
  attachments: [],
  expected_attachments: [],
  related: [],
  dates: [
    {
      id: "request",
      kind: "deadline",
      label: "Подать заявку",
      start: "2026-11-01T18:00:00+03:00",
    },
    {
      id: "payment",
      kind: "deadline",
      label: "Оплатить",
      start: "2026-11-10T00:00:00+03:00",
      allDay: true,
    },
  ],
};
const options = {
  id: "r1",
  at: now,
  by: "Руководство",
  choiceKey: reminderChoiceKey(post.dates[1]),
};
test("reminder records selected deadline snapshot without changing content, dates or creation time", () => {
  const before = structuredClone(post),
    changed = prepareReminder(post, options),
    r = changed.reminded_at[0];
  assert.deepEqual(post, before);
  assert.equal(changed.body, post.body);
  assert.deepEqual(changed.dates, post.dates);
  assert.equal(changed.created_at, post.created_at);
  assert.equal(r.date_id, "payment");
  assert.equal(r.date_label, "Оплатить");
  assert.equal(r.date_all_day, true);
  assert.equal(r.by, "Руководство");
  assert.match(reminderDescription(r), /Оплатить.*10 нояб.*до конца дня/);
  assert.equal(editCount(changed), 0);
  const edited = {
    ...changed,
    history: [...changed.history, { id: "e", type: "edited", at: now }],
  };
  assert.equal(editCount(edited), 1);
  const announcement = reminderAnnouncement(
    changed,
    r,
    "https://example.org/FRchat/",
  );
  assert.match(announcement, /Оплатить/);
  assert.doesNotMatch(announcement, /Подать заявку/);
  assert.equal(
    new URL(announcement.split("\n").at(-1)).hash,
    "#/post/qa-reminder",
  );
});
test("past deadlines are not selectable; expired, archived and reference cards cannot be revived", () => {
  const after = "2026-11-01T18:00:00+03:00";
  assert.deepEqual(
    reminderDates(post, after).map((d) => d.id),
    ["payment"],
  );
  assert.throws(
    () =>
      prepareReminder(post, {
        ...options,
        at: after,
        choiceKey: reminderChoiceKey(post.dates[0]),
      }),
    /Выберите действующий/,
  );
  for (const p of [
    { ...post, state: "deleted" },
    { ...post, state: "closed" },
    { ...post, state: "cancelled" },
    { ...post, state: "postponed" },
    { ...post, type: "reference" },
  ])
    assert.equal(canRemind(p, now), false);
  assert.equal(canRemind(post, "2026-11-11T12:00:00+03:00"), false);
});
test("no deadline: nearest event supplies the label, and dateless posts need no choice", () => {
  const p = {
    ...post,
    dates: [
      {
        id: "event",
        kind: "event",
        label: "Брокер-тур",
        start: "2026-10-27T12:00:00+03:00",
      },
    ],
  };
  assert.equal(reminderDates(p, now).length, 0);
  const changed = prepareReminder(p, { ...options, choiceKey: "" });
  assert.match(reminderDescription(changed.reminded_at[0]), /Брокер-тур/);
  const plain = prepareReminder(
    { ...post, dates: [] },
    { ...options, choiceKey: "" },
  );
  assert.equal(
    reminderDescription(plain.reminded_at[0]),
    "Напоминание о публикации",
  );
});
test("12-hour warning concerns the whole post; fresh marking ends at 24h", () => {
  const changed = prepareReminder(post, options);
  assert.equal(recentReminder(changed, now).hours, 0);
  assert.equal(recentReminder(changed, "2026-10-22T23:59:59+03:00").hours, 11);
  assert.equal(recentReminder(changed, "2026-10-23T00:00:00+03:00"), null);
  assert.ok(freshReminder(changed, "2026-10-23T11:59:59+03:00"));
  assert.equal(freshReminder(changed, "2026-10-23T12:00:00+03:00"), null);
  assert.equal(freshReminder({ ...post, updated_at: now }, now), null);
});
test("duplicate append keeps both texts, existing identity and attachments", () => {
  const incoming = {
    ...post,
    id: "new",
    body: "Дополнение с новой ссылкой",
    links: [{ type: "other", url: "https://example.org/new" }],
  };
  const result = prepareDuplicateUpdate(
    incoming,
    { kind: "duplicate", post },
    { id: "edit", at: now, by: "Руководство", mode: "append" },
  );
  assert.equal(result.body, post.body + "\n\n" + incoming.body);
  assert.equal(result.id, post.id);
  assert.equal(result.title, post.title);
  assert.deepEqual(result.reminded_at, []);
  assert.equal(result.history[0].previous_body, post.body);
});
test("atomic reminder retry is idempotent and advances updated_at for every reader", async () => {
  const fixture = await createAdminFixture({ additionalPosts: [post] });
  const writer = new GitDataWriter({
    request: fixture.backend.request,
    key: fixture.key,
    epoch: fixture.manifest.key_epoch,
    identity: fixture.identity,
  });
  const changed = prepareReminder(post, options);
  fixture.backend.loseResponse = true;
  await writer.savePost({
    post: changed,
    basePost: post,
    operationId: options.id,
  });
  const result = await writer.savePost({
    post: changed,
    basePost: post,
    operationId: options.id,
  });
  const saved = result.snapshot.posts.find((p) => p.id === post.id);
  assert.equal(saved.reminded_at.length, 1);
  assert.equal(saved.history.filter((h) => h.type === "reminded").length, 1);
  assert.notEqual(saved.updated_at, post.updated_at);
  assert.equal(editCount(saved), 0);
});
