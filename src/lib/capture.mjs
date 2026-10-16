import { addDays, dayKey, weekday } from "./dates.mjs";
import { safeUrl } from "./model.mjs";
/** @type {[string, RegExp][]} */
export const CATEGORY_RULES = [
  [
    "reminders",
    /комисси[яию].{0,20}этик|еженедельн.{0,25}собрани|кажд.{0,10}вторник.{0,25}собрани/iu,
  ],
  ["reporting", /отч[её]т|ежемесячн|квартальн.{0,15}сдать/iu],
  ["money", /роялти|мотиваци|акты|касс[аеу]/iu],
  [
    "office-requests",
    /списк[иов]|таблиц.{0,20}сотрудник|реферал|запрос.{0,20}офис/iu,
  ],
  ["council", /совет собственник|голосован/iu],
  ["developers", /брокер.{0,3}тур|застройщик|презентаци.{0,30}жк|ипотек/iu],
  ["education", /обучени|вебинар|курс|тренинг/iu],
  ["meetings", /собрани|форум|конгресс|совещани/iu],
  ["it", /domianix|crm|top.?lab|техподдерж|личный кабинет/iu],
  ["security", /мошенни|безопасност|служб.{0,5}сб/iu],
  ["partners", /партн[её]р|страхов|банк|авито/iu],
];
export function cleanMaxText(input) {
  const lines = String(input ?? "")
    .replace(/\r/g, "")
    .split("\n");
  const removed = [];
  let source = "",
    forwarded = false;
  while (lines.length && !lines[0].trim()) lines.shift();
  if (/^переслано(?:\s+от)?\s*:?/iu.test(lines[0] ?? "")) {
    forwarded = true;
    source = lines
      .shift()
      .replace(/^переслано(?:\s+от)?\s*:?\s*/iu, "")
      .trim();
    removed.push("Служебная отметка пересылки");
    if (
      !source &&
      /^[\p{L}][\p{L} .-]{1,65}$/u.test(lines[0]?.trim() ?? "") &&
      lines[0].trim().split(/\s/).length <= 3
    )
      source = lines.shift().trim();
  }
  let hadReaction = false;
  const content = lines.filter((line) => {
    if (
      /^(?:[\p{Extended_Pictographic}\uFE0F\u200D]+\s*\d+\s*)+$/u.test(
        line.trim(),
      )
    ) {
      removed.push("Счётчик реакций");
      hadReaction = true;
      return false;
    }
    return true;
  });
  while (content.length && !content.at(-1).trim()) content.pop();
  if (
    (forwarded || hadReaction) &&
    /^\d{1,2}:\d{2}$/.test(content.at(-1)?.trim() ?? "") &&
    content.length > 1
  ) {
    content.pop();
    removed.push("Служебное время MAX");
  }
  return {
    text: content
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
    source,
    removed,
  };
}
const months = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];
const monthPattern = months.join("|");
const weekNames = [
  "понедельник",
  "вторник",
  "сред[ау]",
  "четверг",
  "пятниц[ау]",
  "суббот[ау]",
  "воскресенье",
];
const deadlineWords =
  /(?:^|\s|[,;:])(?:до\s|срок|не позднее|закрыва[юе]т?\s*списк|крайний)/iu;
function validDay(year, month, day) {
  const key = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const date = new Date(key + "T12:00:00+03:00");
  return Number.isFinite(+date) && dayKey(date) === key ? key : null;
}
/** @param {string} text @param {Date|string} publishedAt */
export function suggestDates(text, publishedAt = new Date()) {
  const today = dayKey(publishedAt),
    thisYear = +today.slice(0, 4),
    anchors = [],
    warnings = [],
    dates = [];
  const ranges = [];
  const complex = new RegExp(
    `(?:с\\s+\\d{1,2}(?:\\s+(?:${monthPattern}))?\\s+по\\s+\\d{1,2}\\s+(?:${monthPattern})|\\d{1,2}\\s*,\\s*\\d{1,2}(?:\\s*,\\s*\\d{1,2})*\\s*(?:и\\s*\\d{1,2})?\\s+(?:${monthPattern}))`,
    "giu",
  );
  for (const match of text.matchAll(complex))
    ranges.push([match.index, match.index + match[0].length]);
  if (ranges.length)
    warnings.push(
      "Диапазон или несколько дней: внесите даты вручную. Ориентировочное окно не означает непрерывное событие.",
    );
  const inRange = (i) => ranges.some(([a, b]) => i >= a && i < b);
  const anchor = (index, length, day, month, explicitYear) => {
    if (inRange(index)) return;
    let key = validDay(+(explicitYear ?? thisYear), +month, +day);
    if (!explicitYear && key && key < today)
      key = validDay(thisYear + 1, +month, +day);
    if (key) anchors.push({ index, end: index + length, key });
    else warnings.push("Найдена невозможная дата. Проверьте число и месяц.");
  };
  for (const m of text.matchAll(
    /(?<!\d)([0-2]?\d|3[01])\.(0?[1-9]|1[0-2])(?:\.(20\d{2}))?(?!\d)/gu,
  )) {
    // A dotted time next to a relative/named date must not become a calendar date.
    const line = text.slice(
      text.lastIndexOf("\n", m.index) + 1,
      text.indexOf("\n", m.index) < 0
        ? text.length
        : text.indexOf("\n", m.index),
    );
    if (
      !m[3] &&
      /(?:сегодня|завтра|января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)/iu.test(
        line,
      ) &&
      /(?:до|в|с)\s*$/iu.test(text.slice(Math.max(0, m.index - 5), m.index))
    )
      continue;
    anchor(m.index, m[0].length, m[1], m[2], m[3]);
  }
  for (const m of text.matchAll(
    new RegExp(
      `(?<!\\d)([0-2]?\\d|3[01])\\s+(${monthPattern})(?:\\s+(20\\d{2}))?`,
      "giu",
    ),
  ))
    anchor(
      m.index,
      m[0].length,
      m[1],
      months.indexOf(m[2].toLocaleLowerCase("ru")) + 1,
      m[3],
    );
  for (const m of text.matchAll(
    /(?<![а-я])(сегодня(?:шнего дня)?|завтра)(?![а-я])/giu,
  ))
    if (!inRange(m.index))
      anchors.push({
        index: m.index,
        end: m.index + m[0].length,
        key: m[1].toLocaleLowerCase("ru").startsWith("завтра")
          ? addDays(today, 1)
          : today,
      });
  for (const m of text.matchAll(
    new RegExp(
      `(?:в\\s+эту?\\s+|в\\s+этот\\s+)(${weekNames.join("|")})`,
      "giu",
    ),
  )) {
    const target =
      weekNames.findIndex((w) => new RegExp(`^${w}$`, "iu").test(m[1])) + 1;
    anchors.push({
      index: m.index,
      end: m.index + m[0].length,
      key: addDays(today, (target - weekday(today) + 7) % 7),
    });
  }
  anchors.sort((a, b) => a.index - b.index);
  const seen = new Set();
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i],
      end = anchors[i + 1]?.index ?? text.length;
    const start = Math.max(
      anchors[i - 1]?.end ?? 0,
      text.lastIndexOf("\n", a.index) + 1,
    );
    const section = text.slice(start, end);
    const before = text.slice(start, a.index);
    const kind =
      deadlineWords.test(before) ||
      deadlineWords.test(text.slice(a.end, Math.min(end, a.end + 35)))
        ? "deadline"
        : "event";
    const times = [
      ...section.matchAll(/(?<!\d)([01]?\d|2[0-3])[:.]([0-5]\d)(?!\d)/gu),
    ].filter(
      (m) =>
        !anchors.some(
          (x) => start + m.index >= x.index && start + m.index < x.end,
        ),
    );
    const weekdayPart = text
      .slice(a.end, Math.min(end, a.end + 30))
      .replace(/[_*()]/g, "");
    const stated = weekNames.findIndex((w) =>
      new RegExp(`^\\s*${w}(?![а-я])`, "iu").test(weekdayPart),
    );
    if (stated >= 0 && stated + 1 !== weekday(a.key))
      warnings.push(
        `День недели не совпадает с датой ${a.key}. Сверьте исходный текст.`,
      );
    const candidates = times.length ? times : [null];
    for (let j = 0; j < candidates.length; j++) {
      const time = candidates[j],
        hhmm = time ? `${time[1].padStart(2, "0")}:${time[2]}` : "00:00";
      const date = {
        id: crypto.randomUUID(),
        kind,
        start: `${a.key}T${hhmm}:00+03:00`,
        label: "",
      };
      if (!time) {
        if (kind === "deadline") date.allDay = true;
        else date.time_unspecified = true;
      }
      if (time && kind === "event" && candidates[j + 1]) {
        const following = candidates[j + 1],
          between = section.slice(time.index + time[0].length, following.index);
        if (/^\s*[-–—]\s*$/.test(between)) {
          const endTime = `${following[1].padStart(2, "0")}:${following[2]}`;
          if (endTime > hhmm) date.end = `${a.key}T${endTime}:00+03:00`;
          j++;
        }
      }
      const fingerprint = `${date.kind}:${date.start}:${date.end ?? ""}`;
      if (!seen.has(fingerprint)) {
        dates.push(date);
        seen.add(fingerprint);
      }
    }
  }
  return { dates: dates.slice(0, 40), warnings: [...new Set(warnings)] };
}
/** @param {string[]} fragments @param {Date|string} publishedAt @returns {any} */
export function captureText(fragments, publishedAt = new Date()) {
  const cleaned = fragments.map(cleanMaxText),
    body = cleaned
      .map((p) => p.text)
      .filter(Boolean)
      .join("\n\n");
  const lines = body
    .split("\n")
    .map((l) =>
      l.replace(/^[\p{Extended_Pictographic}\uFE0F\u200D\s]+/gu, "").trim(),
    )
    .filter(
      (l) =>
        l &&
        !/^(?:коллеги[,! ]*|(?:всем )?доброе?\s+(?:утро|день|вечер)[,! ]*)$/iu.test(
          l,
        ),
    );
  const category =
    CATEGORY_RULES.find(([, rule]) => rule.test(body))?.[0] ?? "company";
  const links = [...new Set(body.match(/https?:\/\/[^\s<>«»"]+/gu) ?? [])]
    .map((value) => safeUrl(value.replace(/[.,;)]+$/g, "")))
    .filter(Boolean)
    .map((url) => ({
      url,
      label: "",
      type: /ktalk|zoom|telemost/iu.test(url)
        ? "meeting"
        : /forms|disk\.yandex/iu.test(url)
          ? "form"
          : /max\.ru|t\.me/iu.test(url)
            ? "chat"
            : "other",
    }));
  return {
    body,
    title: (lines[0] ?? "Новая публикация").slice(0, 150),
    category_id: category,
    source: cleaned.find((p) => p.source)?.source ?? "",
    links,
    ...suggestDates(body, publishedAt),
    removed: cleaned.flatMap((p) => p.removed),
  };
}
export function similarPosts(text, posts) {
  const words = (value) =>
    new Set(
      String(value)
        .toLocaleLowerCase("ru")
        .replaceAll("ё", "е")
        .match(/[а-яa-z0-9]{4,}/gu) ?? [],
    );
  const query = words(text);
  if (query.size < 3) return [];
  return posts
    .filter((p) => p.state !== "deleted")
    .map((post) => {
      const other = words(post.title + " " + post.body),
        common = [...query].filter((w) => other.has(w)).length;
      return {
        post,
        score: common / Math.min(query.size, Math.max(1, other.size)),
      };
    })
    .filter((p) => p.score >= 0.55)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}
