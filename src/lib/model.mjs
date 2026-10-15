const isoDate = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?\+03:00$/;
const states = new Set(["active", "cancelled", "postponed", "closed"]);
export function importSeed(seed) {
  if (
    seed?.schema !== "frchat-seed/1" ||
    !Array.isArray(seed.posts) ||
    !Array.isArray(seed.categories)
  )
    throw new Error("Неподдерживаемый seed");
  const ids = new Set();
  const categories = new Set(seed.categories.map((c) => c.id));
  const posts = seed.posts.map((raw) => {
    if (
      !raw.id ||
      ids.has(raw.id) ||
      !categories.has(raw.category_id) ||
      !states.has(raw.state) ||
      typeof raw.title !== "string" ||
      typeof raw.body !== "string"
    )
      throw new Error("Некорректная публикация");
    ids.add(raw.id);
    for (const date of raw.dates ?? []) {
      if (
        !["event", "deadline"].includes(date.kind) ||
        !isoDate.test(date.start) ||
        !Number.isFinite(Date.parse(date.start)) ||
        (date.end &&
          (!isoDate.test(date.end) ||
            Date.parse(date.end) <= Date.parse(date.start)))
      )
        throw new Error("Некорректная дата");
      if (
        date.recurrence &&
        (date.recurrence.frequency !== "weekly" ||
          !date.recurrence.weekdays?.every(
            (d) => Number.isInteger(d) && d >= 1 && d <= 7,
          ))
      )
        throw new Error("Неподдерживаемый повтор");
    }
    const {
      review_notes: _notes,
      origin_message_ids: _origins,
      ...post
    } = structuredClone(raw);
    post.dates = post.dates ?? [];
    post.attachments = post.attachments ?? [];
    post.history = post.history ?? [];
    post.links = (post.links ?? []).filter((l) => safeUrl(l.url));
    post.expected_attachments = (post.expected_attachments ?? []).map((a) => ({
      label: a.label,
    }));
    if (post.state === "closed")
      post.closed_at =
        post.closed_at ??
        post.history.filter((h) => h.type === "closed").at(-1)?.at ??
        post.updated_at;
    return post;
  });
  for (const p of posts)
    if ((p.related ?? []).some((id) => !ids.has(id)))
      throw new Error("Связанный пост не найден");
  return {
    schema_version: 1,
    generated_at: seed.generated_at,
    period: seed.period,
    categories: structuredClone(seed.categories),
    birthdays: structuredClone(seed.birthdays ?? []),
    posts,
  };
}
export function safeUrl(value) {
  try {
    const u = new URL(value);
    return ["http:", "https:", "tel:", "mailto:"].includes(u.protocol)
      ? u.href
      : null;
  } catch {
    return null;
  }
}
export function validateSnapshot(value) {
  if (
    value?.schema_version !== 1 ||
    !Array.isArray(value.posts) ||
    !Array.isArray(value.categories) ||
    !value.posts.every(
      (p) => p.id && states.has(p.state) && Array.isArray(p.dates),
    )
  )
    throw new Error("Данные не поддерживаются этой версией");
  return value;
}
