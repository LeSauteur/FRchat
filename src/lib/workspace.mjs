import { REFERENCE_CATEGORIES, isReference } from "./reference.mjs";
import { matchesQuery } from "./search.mjs";
import { DAY, dateEnd, occurrences, postStatus } from "./dates.mjs";
export const SETTINGS_ID = "frchat-workspace-settings";
export const isWorkspaceSettings = (p) => p.id === SETTINGS_ID;
export const DEFAULT_DOCUMENT_CATEGORIES = [
  ...REFERENCE_CATEGORIES,
  { id: "document-contracts", name: "Договоры и бланки" },
  { id: "document-templates", name: "Шаблоны отчётов" },
  { id: "document-brand", name: "Бренд и логотипы" },
];
export const DEFAULT_TOOLS = [
  {
    id: "seven-days",
    title: "7 дней",
    description: "Рабочие задачи и чек-листы на каждый день недели.",
    url: "https://lesauteur.github.io/domian-7-days/",
    enabled: true,
  },
];
export function toolUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password
      ? u.href
      : null;
  } catch {
    return null;
  }
}
export function validateWorkspace(value) {
  if (
    value?.version !== 1 ||
    !Array.isArray(value.document_categories) ||
    !Array.isArray(value.tools) ||
    value.document_categories.length > 60 ||
    !value.document_categories.length ||
    value.tools.length > 60
  )
    throw new Error("Проверьте категории и инструменты.");
  const ids = new Set();
  for (const c of value.document_categories) {
    if (
      !/^[a-z0-9-]{1,80}$/.test(c.id) ||
      ids.has(c.id) ||
      typeof c.name !== "string" ||
      !c.name.trim() ||
      c.name.length > 100
    )
      throw new Error("У каждой категории должно быть своё название.");
    ids.add(c.id);
  }
  ids.clear();
  for (const t of value.tools) {
    if (
      !/^[a-z0-9-]{1,80}$/.test(t.id) ||
      ids.has(t.id) ||
      typeof t.title !== "string" ||
      !t.title.trim() ||
      t.title.length > 120 ||
      typeof t.description !== "string" ||
      t.description.length > 500 ||
      !toolUrl(t.url) ||
      typeof t.enabled !== "boolean"
    )
      throw new Error(
        "Проверьте название и безопасную ссылку инструмента (https).",
      );
    ids.add(t.id);
  }
  return value;
}
export function workspaceSettings(snapshot) {
  const stored = snapshot.posts.find(isWorkspaceSettings)?.workspace;
  if (stored) return validateWorkspace(stored);
  return {
    version: 1,
    document_categories: structuredClone(DEFAULT_DOCUMENT_CATEGORIES),
    tools: structuredClone(DEFAULT_TOOLS),
  };
}
export function documentCategories(snapshot) {
  const saved = workspaceSettings(snapshot).document_categories;
  // Keep every legacy category address and label available, even after it is retired.
  return [
    ...saved,
    ...DEFAULT_DOCUMENT_CATEGORIES.filter(
      (c) => !saved.some((s) => s.id === c.id),
    ),
  ].map((c) => ({ ...c, emoji: "", retention_days: null }));
}
/** @returns {import('../types').Post[]} */
export function documents(snapshot, query = "", category = "") {
  return snapshot.posts
    .filter(
      (p) =>
        isReference(p) &&
        !isWorkspaceSettings(p) &&
        p.state !== "deleted" &&
        (!category || p.category_id === category) &&
        matchesQuery(p, query),
    )
    .sort((a, b) => a.title.localeCompare(b.title, "ru"));
}
export function validateDocument(meta) {
  if (
    !meta ||
    typeof meta.description !== "string" ||
    !meta.description.trim() ||
    meta.description.length > 2000 ||
    typeof meta.owner !== "string" ||
    !meta.owner.trim() ||
    meta.owner.length > 160 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(meta.reviewed_on) ||
    new Date(`${meta.reviewed_on}T12:00:00Z`).toISOString().slice(0, 10) !==
      meta.reviewed_on ||
    !["current", "outdated"].includes(meta.status) ||
    typeof meta.version !== "string" ||
    meta.version.length > 80
  )
    throw new Error(
      "Укажите описание, ответственного и верную дату актуальности.",
    );
  return meta;
}
export function upcomingActions(posts, now = new Date(), kind = "all") {
  const at = +now;
  return posts
    .filter(
      (p) =>
        !isReference(p) && p.state === "active" && !postStatus(p, now).archive,
    )
    .flatMap((p) =>
      occurrences(
        p,
        new Date(at - DAY).toISOString(),
        new Date(at + 30 * DAY).toISOString(),
      )
        .filter(
          (d) =>
            !d.cancelled &&
            dateEnd(d) > at - (d.kind === "deadline" ? DAY : 0) &&
            (kind === "all" || d.kind === kind),
        )
        .map((d) => ({ post: p, date: d })),
    )
    .sort((a, b) => dateEnd(a.date) - dateEnd(b.date));
}
/** @returns {import('../types').Post} */
export function contentPost(identity, id, at) {
  return {
    id,
    type: "reference",
    category_id: "reference-instructions",
    title: "",
    body: "",
    source: identity.label,
    priority: "normal",
    pinned: false,
    author: { id: identity.id, display_name: identity.label },
    created_at: at,
    updated_at: at,
    state: "active",
    dates: [],
    links: [],
    attachments: [],
    expected_attachments: [],
    history: [],
    reminded_at: [],
    related: [],
  };
}
