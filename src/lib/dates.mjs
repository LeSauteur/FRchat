import { isReference } from "./reference.mjs";
export const DAY = 86_400_000;
export const MOSCOW = "Europe/Moscow";
/** @param {Date|string|number} input */
export function dayKey(input = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MOSCOW,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(input));
  const fields = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}
export const dayStart = (key) => Date.parse(`${key}T00:00:00+03:00`);
export const addDays = (key, count) => dayKey(dayStart(key) + count * DAY);
export const weekday = (key) =>
  ((new Date(dayStart(key) + 3 * 3_600_000).getUTCDay() + 6) % 7) + 1;
export function dateEnd(date) {
  if (date.end) return Date.parse(date.end);
  if (date.allDay) return dayStart(addDays(dayKey(date.start), 1));
  if (date.time_unspecified) return dayStart(addDays(dayKey(date.start), 1));
  return (
    Date.parse(date.start) + (date.kind === "deadline" ? 0 : 2 * 3_600_000)
  );
}
export function expandDate(date, from, to) {
  const lower = Date.parse(from),
    upper = Date.parse(to);
  if (!date.recurrence)
    return dateEnd(date) >= lower && Date.parse(date.start) < upper
      ? [{ ...date, occurrence_date: dayKey(date.start), cancelled: false }]
      : [];
  const rule = date.recurrence;
  const anchor = dayKey(date.start);
  const origin = dayStart(anchor);
  const time = date.start.slice(11, 19);
  const duration = dateEnd(date) - Date.parse(date.start);
  let key = dayKey(Math.max(origin, lower - Math.max(duration, DAY)));
  const until = rule.until
    ? rule.until.length === 10
      ? dayStart(addDays(rule.until, 1))
      : Date.parse(rule.until)
    : Infinity;
  const items = [];
  // Windows are deliberately bounded; an open weekly series is never expanded forever.
  if (upper - lower > 370 * DAY)
    throw new Error("Слишком большой диапазон календаря");
  for (
    let guard = 0;
    guard < 740 && dayStart(key) < Math.min(upper, until);
    guard++, key = addDays(key, 1)
  ) {
    const week = Math.floor(
      (dayStart(key) - origin + (weekday(anchor) - 1) * DAY) / (7 * DAY),
    );
    if (
      !(rule.weekdays ?? [weekday(anchor)]).includes(weekday(key)) ||
      week % (rule.interval ?? 1)
    )
      continue;
    const start = `${key}T${time}+03:00`;
    const exception = rule.exceptions?.find((e) => e.occurrence_date === key);
    const shiftedStart = exception?.start ?? exception?.new_start ?? start;
    const endMs = exception?.end
      ? Date.parse(exception.end)
      : Date.parse(shiftedStart) + duration;
    items.push({
      ...date,
      start: shiftedStart,
      end:
        date.end || exception?.end
          ? new Date(endMs + 3 * 3_600_000).toISOString().replace("Z", "+03:00")
          : undefined,
      recurrence: undefined,
      occurrence_date: key,
      cancelled: exception?.state === "cancelled",
      meeting_url: rule.occurrence_links?.find((l) => l.occurrence_date === key)
        ?.url,
    });
  }
  return items.filter(
    (item) => Date.parse(item.start) < upper && dateEnd(item) >= lower,
  );
}
export function occurrences(post, from, to) {
  return post.dates
    .flatMap((d) =>
      expandDate(d, from, to).map((date) => ({
        ...date,
        post_id: post.id,
        cancelled:
          date.cancelled || ["cancelled", "postponed"].includes(post.state),
      })),
    )
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}
export function postStatus(post, now = new Date()) {
  const at = +new Date(now);
  if (post.state === "deleted")
    return { id: "deleted", label: "Удалено", archive: true };
  if (isReference(post))
    return { id: "reference", label: "Справочник", archive: false };
  if (post.state === "closed")
    return { id: "closed", label: "Завершено", archive: true };
  if (post.state === "cancelled")
    return { id: "cancelled", label: "Отменено", archive: true };
  if (post.state === "postponed")
    return {
      id: "postponed",
      label: "Перенесено · дата уточняется",
      archive: false,
    };
  const activeSeries = post.dates.some(
    (d) => d.recurrence && !d.recurrence.until,
  );
  const dates = occurrences(
    post,
    new Date(at - 8 * DAY).toISOString(),
    new Date(at + 32 * DAY).toISOString(),
  ).filter((d) => !d.cancelled);
  const deadlines = dates.filter((d) => d.kind === "deadline");
  const overdue = deadlines.some(
    (d) => dateEnd(d) <= at && dateEnd(d) + DAY > at,
  );
  const running = dates.some(
    (d) => d.kind === "event" && !d.time_unspecified && Date.parse(d.start) <= at && dateEnd(d) > at,
  );
  const bounds = post.dates
    .filter((d) => !d.recurrence)
    .map((d) => dateEnd(d) + (d.kind === "deadline" ? DAY : 0));
  for (const d of post.dates.filter((d) => d.recurrence?.until)) {
    const end =
      d.recurrence.until.length === 10
        ? dayStart(addDays(d.recurrence.until, 1))
        : Date.parse(d.recurrence.until);
    const recent = expandDate(
      d,
      new Date(
        Math.max(
          Date.parse(d.start),
          end - Math.min(360, 7 * (d.recurrence.interval ?? 1) + 8) * DAY,
        ),
      ).toISOString(),
      new Date(end).toISOString(),
    ).filter((entry) => !entry.cancelled);
    const last = recent.at(-1);
    bounds.push(
      (last ? dateEnd(last) : end) + (d.kind === "deadline" ? DAY : 0),
    );
  }
  const archive =
    !activeSeries &&
    (post.expires_at
      ? Date.parse(post.expires_at) <= at
      : bounds.length > 0 && Math.max(...bounds) <= at);
  if (archive) return { id: "past", label: "В архиве", archive: true };
  if (overdue) return { id: "overdue", label: "Срок истёк", archive: false };
  if (running) return { id: "ongoing", label: "Идёт сейчас", archive: false };
  const future =
    activeSeries ||
    dates.some((d) => Date.parse(d.start) > at || ((d.kind === "deadline" || d.time_unspecified) && dateEnd(d) > at)) ||
    post.dates.some((d) => !d.recurrence && Date.parse(d.start) > at);
  return {
    id: future ? "upcoming" : "active",
    label: future ? "Предстоит" : "Актуально",
    archive: false,
  };
}
export function isHot(post, now = new Date()) {
  if (isReference(post) || post.category_id === "reminders") return false;
  const at = +new Date(now);
  const status = postStatus(post, now);
  if (status.archive || ["cancelled", "postponed"].includes(post.state))
    return false;
  return occurrences(
    post,
    new Date(at - DAY).toISOString(),
    new Date(at + 2 * DAY).toISOString(),
  ).some(
    (d) =>
      !d.cancelled &&
      (d.kind === "deadline"
        ? dateEnd(d) > at - DAY && dateEnd(d) < at + 2 * DAY
        : dayKey(d.start) <= addDays(dayKey(now), 1) && dateEnd(d) > at),
  );
}
export const formatDate = (value, withTime = true) =>
  new Intl.DateTimeFormat("ru-RU", {
    timeZone: MOSCOW,
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(new Date(value));
export function dateLabel(date) {
  if (date.time_unspecified) {
    const last = date.end
      ? formatDate(
          new Date(Date.parse(date.end) - (date.allDay ? DAY : 0)),
          false,
        )
      : "";
    return `${formatDate(date.start, false)}${last && dayKey(date.end) !== dayKey(date.start) ? ` — ${last}` : ""} · время уточняется`;
  }
  if (date.allDay) {
    if (
      date.end &&
      dayStart(dayKey(date.end)) - dayStart(dayKey(date.start)) > DAY
    )
      return `${formatDate(date.start, false)} — ${formatDate(new Date(Date.parse(date.end) - DAY), false)}`;
    return `${formatDate(date.start, false)}${date.kind === "deadline" ? " · до конца дня" : " · весь день"}`;
  }
  return (
    formatDate(date.start) +
    (date.end && dayKey(date.end) === dayKey(date.start)
      ? `–${new Intl.DateTimeFormat("ru-RU", { timeZone: MOSCOW, hour: "2-digit", minute: "2-digit" }).format(new Date(date.end))}`
      : "")
  );
}
