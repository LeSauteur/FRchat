import {
  DAY,
  dateEnd,
  dateLabel,
  nextPostDate,
  occurrences,
  postStatus,
} from "./dates.mjs";
import { isReference } from "./reference.mjs";
/** Actual occurrences retain the stable date id and occurrence day for series. */
export function reminderDates(post, now = new Date()) {
  const at = +new Date(now);
  const all = [
    ...post.dates.filter((d) => !d.recurrence),
    ...occurrences(
      post,
      new Date(at).toISOString(),
      new Date(at + 32 * DAY).toISOString(),
    ),
  ];
  return [
    ...new Map(
      all
        .filter((d) => d.kind === "deadline" && !d.cancelled && dateEnd(d) > at)
        .map((d) => [`${d.id}:${d.start}`, d]),
    ).values(),
  ].sort((a, b) => dateEnd(a) - dateEnd(b));
}
export const reminderChoiceKey = (d) => `${d.id}:${d.start}`;
export function canRemind(post, now = new Date()) {
  return (
    post.state === "active" &&
    !isReference(post) &&
    !postStatus(post, now).archive &&
    (!post.dates.some((d) => d.kind === "deadline") ||
      reminderDates(post, now).length > 0)
  );
}
export function recentReminder(post, now = new Date()) {
  const latest = [...(post.reminded_at ?? [])].sort(
    (a, b) => Date.parse(b.at) - Date.parse(a.at),
  )[0];
  const elapsed = +new Date(now) - Date.parse(latest?.at);
  if (!latest || elapsed < 0 || elapsed >= 12 * 3_600_000) return null;
  return {
    hours: Math.floor(elapsed / 3_600_000),
    text:
      elapsed < 3_600_000
        ? "Уже напоминали меньше часа назад. Напомнить ещё раз?"
        : `Уже напоминали ${Math.floor(elapsed / 3_600_000)} ч назад. Напомнить ещё раз?`,
  };
}
export function prepareReminder(post, { id, at, by, choiceKey }) {
  if (!canRemind(post, at))
    throw Object.assign(
      new Error(
        "Событие завершено или все сроки уже прошли. Напоминание не отправлено.",
      ),
      { kind: "validation" },
    );
  const choices = reminderDates(post, at);
  const chosen = choices.find((d) => reminderChoiceKey(d) === choiceKey);
  if (choices.length && !chosen)
    throw Object.assign(new Error("Выберите действующий срок ещё раз."), {
      kind: "validation",
    });
  const event = !choices.length ? nextPostDate(post, "event", at) : undefined;
  const target = chosen ?? event;
  const reminder = {
    id,
    at,
    by,
    ...(target
      ? {
          date_id: target.id,
          date_kind: target.kind,
          date_label:
            target.label || (target.kind === "deadline" ? "Срок" : "Событие"),
          date_start: target.start,
          date_end: target.end,
          date_all_day: target.allDay,
          date_time_unspecified: target.time_unspecified,
          occurrence_date: target.occurrence_date,
        }
      : {}),
  };
  return {
    ...structuredClone(post),
    reminded_at: [...post.reminded_at, reminder],
    history: [
      ...post.history,
      {
        id,
        at,
        by,
        type: "reminded",
        text: reminderDescription(reminder),
      },
    ],
  };
}
export function reminderDescription(reminder) {
  return reminder.date_start
    ? `Напоминание: ${reminder.date_label || "Событие"} — ${dateLabel({ kind: reminder.date_kind, start: reminder.date_start, end: reminder.date_end, allDay: reminder.date_all_day, time_unspecified: reminder.date_time_unspecified })}`
    : "Напоминание о публикации";
}
export function freshReminder(post, now = new Date()) {
  if (!canRemind(post, now)) return null;
  return (
    [...post.reminded_at]
      .filter(
        (r) =>
          +new Date(now) >= Date.parse(r.at) &&
          +new Date(now) - Date.parse(r.at) < DAY,
      )
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0] ?? null
  );
}
export function reminderAnnouncement(post, reminder, base) {
  return [
    post.title,
    reminderDescription(reminder),
    new URL(`#/post/${encodeURIComponent(post.id)}`, base).href,
  ].join("\n");
}
export function editCount(post) {
  return post.history.filter((h) => !["created", "reminded"].includes(h.type))
    .length;
}
