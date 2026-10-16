import { MOSCOW, dateEnd, dayKey } from "./dates.mjs";
export function fullDate(date) {
  const day = new Intl.DateTimeFormat("ru-RU", {
    timeZone: MOSCOW,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(date.start));
  if (date.kind === "deadline" && date.allDay) return `${day}, до конца дня`;
  if (date.time_unspecified) return `${day}, время уточняется`;
  if (date.allDay) return `${day}, весь день`;
  const time = new Intl.DateTimeFormat("ru-RU", {
    timeZone: MOSCOW,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date.start));
  return `${day}, ${time}`;
}
export function humanError(error, saved = true) {
  if ([401, 403, 404].includes(error?.status) || error?.kind === "unavailable")
    return (
      "Публикация временно недоступна, напишите Алексею." +
      (saved ? " Ваш текст сохранён." : "")
    );
  if (error?.name === "PostConflict")
    return "Эту публикацию уже успели изменить. Ваш текст сохранён. Выберите, какой текст оставить.";
  const draft = saved
    ? "Текст сохранён"
    : "Текст остаётся в этой вкладке — не закрывайте её";
  if (
    (typeof navigator !== "undefined" && !navigator.onLine) ||
    error?.kind === "network"
  )
    return `Нет интернета. ${draft} — нажмите «Повторить», когда появится связь.`;
  if (
    /Ключ доступа изменён|Нужен действующий вход/iu.test(error?.message ?? "")
  )
    return "Доступ обновлён. Выйдите и войдите с тем же паролем. Ваш текст сохранён.";
  return `Не получилось отправить публикацию. ${draft}. Нажмите «Повторить». Если не помогает, напишите Алексею.`;
}
export function announcement(post, base) {
  const event = post.dates.find((d) => d.kind === "event" && !d.recurrence);
  const deadline = post.dates.find(
    (d) => d.kind === "deadline" && dateEnd(d) >= Date.now(),
  );
  return [
    post.title,
    event ? `Событие: ${fullDate(event)}` : "",
    deadline ? `${deadline.label || "Срок"}: ${fullDate(deadline)}` : "",
    new URL(`#/post/${encodeURIComponent(post.id)}`, base).href,
  ]
    .filter(Boolean)
    .join("\n");
}
export const shortDay = (value) =>
  new Intl.DateTimeFormat("ru-RU", {
    timeZone: MOSCOW,
    day: "numeric",
    month: "long",
  }).format(new Date(value));
