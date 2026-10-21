import { addDays, dayKey, expandDate, dayStart } from "./dates.mjs";
import { normalize } from "./search.mjs";

const words = (value) =>
  new Set(normalize(value).match(/[а-яa-z0-9]{3,}/gu) ?? []);
const textOf = (post) => `${post.title ?? ""}\n${post.body ?? ""}`;
const normalizedBody = (post) =>
  normalize(post.body ?? "")
    .replace(/https?:\/\/[^\s<>]+/gu, "")
    .replace(/[^а-яa-z0-9]+/gu, " ")
    .trim();
const finiteDay = (value) =>
  Number.isFinite(Date.parse(value)) ? dayKey(value) : null;
export function publicationDays(post) {
  const days = new Set();
  for (const date of post.dates ?? []) {
    if (date.recurrence) continue;
    const start = finiteDay(date.start),
      end =
        date.end && Date.parse(date.end) > Date.parse(date.start)
          ? dayKey(Date.parse(date.end) - 1)
          : start;
    if (!start) continue;
    for (
      let day = start, n = 0;
      day <= end && n < 370;
      day = addDays(day, 1), n++
    )
      days.add(day);
  }
  return days;
}
export function categoryTemplateWords(posts, category) {
  const corpus = posts.filter(
    (p) => p.state !== "deleted" && p.category_id === category,
  );
  const counts = new Map();
  for (const post of corpus)
    for (const word of words(textOf(post)))
      counts.set(word, (counts.get(word) ?? 0) + 1);
  return new Set(
    [...counts]
      .filter(([, count]) => count > corpus.length * 0.3)
      .map(([word]) => word),
  );
}
function reportPeriod(post) {
  if (post.category_id !== "reporting") return null;
  return (
    normalize(textOf(post)).match(
      /за\s+((?:[ivx]+|[1-4])\s+квартал(?:\s+20\d{2})?|(?:январь|февраль|март|апрель|май|июнь|июль|август|сентябрь|октябрь|ноябрь|декабрь)(?:\s+20\d{2})?)/u,
    )?.[1] ?? null
  );
}
function seriesIdentity(post) {
  const text = normalize(textOf(post));
  if (/комисси[яию].{0,30}этик/u.test(text)) return "ethics";
  if (
    /еженедельн.{0,30}собрани|собрани[ея].{0,20}офис|общее\s+собрание\s+домиан/u.test(
      text,
    )
  )
    return "office-meeting";
  return null;
}
function sameSeriesHeading(incoming, target) {
  const calendarWords =
    /^(?:январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр|понедельник|вторник|сред[ау]|четверг|пятниц|суббот|воскресень|еженедельн|кажд)/u;
  const heading = (post) =>
    new Set(
      [...words(post.title)].filter(
        (word) => !/^\d+$/u.test(word) && !calendarWords.test(word),
      ),
    );
  const a = heading(incoming),
    b = heading(target);
  const common = [...a].filter((word) => b.has(word)).length;
  return common >= 2 && common / Math.max(a.size, b.size) >= 0.8;
}
function similarity(incoming, target, template) {
  if (
    normalizedBody(incoming) &&
    normalizedBody(incoming) === normalizedBody(target)
  )
    return 1;
  const a = new Set(
    [...words(textOf(incoming))].filter((w) => !template.has(w)),
  );
  const b = new Set([...words(textOf(target))].filter((w) => !template.has(w)));
  const common = [...a].filter((w) => b.has(w)).length;
  return common >= 2 ? common / (new Set([...a, ...b]).size || 1) : 0;
}
const urls = (post) =>
  new Set([
    ...(post.links ?? []).map((l) => l.url),
    ...(post.body?.match(/https?:\/\/[^\s<>«»"]+/gu) ?? []).map((url) =>
      url.replace(/[.,;)]+$/u, ""),
    ),
    ...(post.dates ?? []).flatMap((d) =>
      (d.recurrence?.occurrence_links ?? []).map((l) => l.url),
    ),
  ]);
const dateKey = (d) =>
  [
    d.kind,
    d.start,
    d.end ?? "",
    Boolean(d.allDay),
    Boolean(d.time_unspecified),
  ].join("|");
export function duplicateAdditions(incoming, target) {
  const oldUrls = urls(target),
    oldDates = new Set((target.dates ?? []).map(dateKey));
  return {
    links: [...urls(incoming)].filter((url) => !oldUrls.has(url)),
    dates: (incoming.dates ?? []).filter((d) => !oldDates.has(dateKey(d))),
  };
}
export function seriesPreview(post, selection) {
  if (!selection) return post;
  const date = post.dates.find((d) => d.id === selection.date_id);
  const day = selection.occurrence_date;
  if (!date) return post;
  const occurrence = expandDate(
    date,
    new Date(dayStart(day)).toISOString(),
    new Date(dayStart(addDays(day, 1))).toISOString(),
  ).find((d) => d.occurrence_date === day);
  return occurrence
    ? {
        ...post,
        dates: [occurrence],
        links: [
          ...post.links,
          ...(occurrence.meeting_url
            ? [
                {
                  type: "meeting",
                  url: occurrence.meeting_url,
                  label: "Подключиться к этой встрече",
                },
              ]
            : []),
        ],
      }
    : post;
}
/** Dates gate ordinary duplicates. Series are matched against an actual occurrence,
 * never against the anchor date and never offered as a reminder of another week. */
export function similarPosts(incoming, posts) {
  if (!incoming?.body?.trim()) return [];
  const corpus = posts.filter(
    (p) => p.state !== "deleted" && p.id !== incoming.id,
  );
  const templates = new Map();
  const template = (category) => {
    if (!templates.has(category))
      templates.set(category, categoryTemplateWords(corpus, category));
    return templates.get(category);
  };
  const days = publicationDays(incoming),
    results = [];
  for (const post of corpus) {
    if ((post.type ?? "post") !== (incoming.type ?? "post")) continue;
    const recurring = (post.dates ?? []).filter((d) => d.recurrence);
    if (recurring.length) {
      if (post.state !== "active") continue;
      const a = seriesIdentity(incoming),
        b = seriesIdentity(post);
      const score =
        (a && a === b) || (!a && !b && sameSeriesHeading(incoming, post))
          ? 1
          : similarity(incoming, post, template(post.category_id));
      if (a || b ? a !== b : score < 0.55) continue;
      for (const date of recurring)
        for (const day of days) {
          const selected = (incoming.dates ?? []).find(
            (d) =>
              !d.recurrence &&
              d.kind === date.kind &&
              finiteDay(d.start) === day,
          );
          if (!selected) continue;
          const occurrence = expandDate(
            date,
            new Date(dayStart(day)).toISOString(),
            new Date(dayStart(addDays(day, 1))).toISOString(),
          ).find((d) => !d.cancelled && dayKey(d.start) === day);
          if (!occurrence) continue;
          results.push({
            post,
            score,
            kind: "series",
            occurrence_date: occurrence.occurrence_date,
            date_id: date.id,
            incoming_date_id: selected.id,
            additions: duplicateAdditions(incoming, post),
          });
        }
      continue;
    }
    if (post.category_id !== incoming.category_id) continue;
    const otherDays = publicationDays(post);
    if (
      days.size &&
      otherDays.size &&
      ![...days].some((day) => otherDays.has(day))
    )
      continue;
    const period = reportPeriod(incoming),
      otherPeriod = reportPeriod(post);
    if (period && otherPeriod && period !== otherPeriod) continue;
    const score = similarity(incoming, post, template(post.category_id));
    if (score >= 0.55)
      results.push({
        post,
        score,
        kind: "duplicate",
        additions: duplicateAdditions(incoming, post),
      });
  }
  return results
    .sort(
      (a, b) =>
        (b.kind === "series") - (a.kind === "series") || b.score - a.score,
    )
    .slice(0, 3);
}

/** Prepare an update for the ordinary review/publish flow. No network write. */
export function prepareDuplicateUpdate(incoming, match, { id, at, by }) {
  const target = match.post;
  if (match.kind === "series") {
    const changed = structuredClone(target);
    const date = changed.dates.find((d) => d.id === match.date_id);
    const selected = incoming.dates.find(
      (d) => d.id === match.incoming_date_id,
    );
    if (!date?.recurrence || !selected)
      throw new Error("Выберите дату собрания ещё раз.");
    const meetingLinks = (incoming.links ?? []).filter(
      (l) =>
        l.type === "meeting" ||
        (incoming.links.length === 1 && l.type === "other"),
    );
    if (meetingLinks.length > 1)
      throw new Error("Оставьте одну ссылку на подключение к выбранной дате.");
    if (meetingLinks.length) {
      date.recurrence.occurrence_links = [
        ...(date.recurrence.occurrence_links ?? []).filter(
          (l) => l.occurrence_date !== match.occurrence_date,
        ),
        {
          occurrence_date: match.occurrence_date,
          url: meetingLinks[0].url,
          type: "meeting",
        },
      ].sort((a, b) => a.occurrence_date.localeCompare(b.occurrence_date));
    }
    const current = expandDate(
      date,
      new Date(dayStart(dayKey(selected.start))).toISOString(),
      new Date(dayStart(addDays(dayKey(selected.start), 1))).toISOString(),
    ).find((d) => d.occurrence_date === match.occurrence_date);
    if (
      current &&
      (current.start !== selected.start ||
        (selected.end && selected.end !== current.end)) &&
      !selected.time_unspecified
    ) {
      const exceptions = date.recurrence.exceptions ?? [];
      const prior =
        exceptions.find((e) => e.occurrence_date === match.occurrence_date) ??
        {};
      date.recurrence.exceptions = [
        ...exceptions.filter(
          (e) => e.occurrence_date !== match.occurrence_date,
        ),
        {
          ...prior,
          occurrence_date: match.occurrence_date,
          start: selected.start,
          ...(selected.end ? { end: selected.end } : {}),
        },
      ];
    }
    changed.history.push({
      id,
      at,
      by,
      type: "edited",
      text: `Обновлена дата серии ${match.occurrence_date}. Новое сообщение:\n${incoming.body}`,
      added_body: incoming.body,
    });
    return changed;
  }
  return {
    ...structuredClone(target),
    title: incoming.title,
    body: incoming.body,
    source: incoming.source || target.source,
    dates: [
      ...new Map(
        [...(target.dates ?? []), ...(incoming.dates ?? [])].map((d) => [
          dateKey(d),
          structuredClone(d),
        ]),
      ).values(),
    ],
    links: [
      ...new Map(
        [...(target.links ?? []), ...(incoming.links ?? [])].map((l) => [
          l.url,
          structuredClone(l),
        ]),
      ).values(),
    ],
    history: [
      ...target.history,
      {
        id,
        at,
        by,
        type: "edited",
        text: "Публикация дополнена новым сообщением",
        previous_body: target.body,
      },
    ],
  };
}
