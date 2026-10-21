import {
  addDays,
  dayKey,
  dayStart,
  occurrences,
  postStatus,
  weekday,
} from "./dates.mjs";
import { isReference } from "./reference.mjs";
import { normalize, matchesQuery, comparePublicationTime } from "./search.mjs";
export { normalize } from "./search.mjs";
export function periodBounds(period, now = new Date(), from = "", to = "") {
  const today = dayKey(now);
  if (period === "today") return [today, addDays(today, 1)];
  if (period === "tomorrow") return [addDays(today, 1), addDays(today, 2)];
  if (period === "week" || period === "next-week") {
    const start = addDays(
      today,
      1 - weekday(today) + (period === "next-week" ? 7 : 0),
    );
    return [start, addDays(start, 7)];
  }
  if (period === "month") {
    const start = today.slice(0, 7) + "-01";
    return [
      start,
      dayKey(
        new Date(Date.parse(start + "T12:00:00+03:00")).setUTCMonth(
          Number(start.slice(5, 7)),
        ),
      ).slice(0, 7) + "-01",
    ];
  }
  if (
    period === "custom" &&
    /^\d{4}-\d{2}-\d{2}$/.test(from) &&
    /^\d{4}-\d{2}-\d{2}$/.test(to)
  )
    return [from, addDays(to, 1)];
  return null;
}
export function filterPosts(
  posts,
  filters = {},
  now = new Date(),
  section = "all",
  favoriteIds = [],
) {
  const query = normalize(filters.q).trim();
  const categories = filters.categories ?? [];
  const range = periodBounds(filters.period, now, filters.from, filters.to);
  return posts
    .filter((post) => {
      const status = postStatus(post, now);
      if (
        section === "calendar" &&
        post.category_id === "reminders" &&
        !filters.reminders &&
        !categories.includes("reminders") &&
        !query
      )
        return false;
      if (
        (filters.favorites || section === "favorites") &&
        !favoriteIds.includes(post.id)
      )
        return false;
      if (
        post.state === "deleted" &&
        !(filters.favorites || section === "favorites")
      )
        return false;
      if (
        section === "reference" &&
        (!isReference(post) || post.state === "deleted")
      )
        return false;
      if ((section === "active" || section === "archive") && isReference(post))
        return false;
      if (
        (section === "active" && status.archive) ||
        (section === "archive" && !status.archive)
      )
        return false;
      if (categories.length && !categories.includes(post.category_id))
        return false;
      if (filters.important && post.priority === "normal") return false;
      if (
        filters.files &&
        !(post.attachments?.length || post.expected_attachments?.length)
      )
        return false;
      if (
        filters.status &&
        filters.status !== "all" &&
        status.id !== filters.status
      )
        return false;
      if (query && !matchesQuery(post, query)) return false;
      if (range) {
        const [start, end] = range.map(dayStart);
        if (filters.dateKind === "publication")
          return (
            Date.parse(post.created_at) >= start &&
            Date.parse(post.created_at) < end
          );
        return occurrences(
          post,
          new Date(start).toISOString(),
          new Date(end).toISOString(),
        ).some(
          (d) =>
            !filters.dateKind ||
            filters.dateKind === "all" ||
            d.kind === filters.dateKind,
        );
      }
      return true;
    })
    .sort(comparePublicationTime);
}
