import source from "../data/instruction.json" with { type: "json" };
import { matchesQuery } from "./search.mjs";

/** Already public material only; never merged into the encrypted working snapshot. @type {import('../instruction/types').InstructionData} */
export const instruction = source;
export const INSTRUCTION_ROUTE = "/documents/instruction/";
export const instructionDate = instruction.version_date
  .split("-")
  .reverse()
  .join(".");
export function instructionHref(slug, query = "") {
  const filtered =
    ["groups", "offices", "important-contacts"].includes(slug) && query.trim();
  return (
    "#" +
    INSTRUCTION_ROUTE +
    encodeURIComponent(slug) +
    (filtered ? "?q=" + encodeURIComponent(query.trim()) : "")
  );
}
export function instructionSlug(path) {
  if (!path.startsWith(INSTRUCTION_ROUTE)) return null;
  try {
    return decodeURIComponent(path.slice(INSTRUCTION_ROUTE.length));
  } catch {
    return "";
  }
}
export function instructionArticles(query = "", category = "") {
  return instruction.articles.filter(
    (article) =>
      (!category || article.category_id === category) &&
      matchesQuery(
        {
          title: article.title,
          body: article.text,
          source: "Инструкция франшизы",
        },
        query,
      ),
  );
}
export function instructionSearchArticles(query, filters = {}) {
  if (filters.favorites || filters.important || filters.reminders) return [];
  return instructionArticles(query, filters.categories?.[0] ?? "").filter(
    (article) => !filters.files || article.slug === "documents",
  );
}
/** Resolve approved public links without leaking FRchat state to external URLs. */
export function instructionLink(value) {
  if (typeof value !== "string") return null;
  if (value.startsWith("#")) {
    const [slug, query = ""] = value.slice(1).split("?");
    if (slug === "home") return "#/documents";
    return instruction.articles.some((article) => article.slug === slug)
      ? instructionHref(slug) + (query ? "?" + query : "")
      : null;
  }
  if (value.startsWith("documents/")) {
    const name = value.slice("documents/".length);
    return instruction.files.some((file) => file.name === name)
      ? "./instruction-files/" + name
      : null;
  }
  if (value === "contacts.html") return instruction.source_url + value;
  if (!/^(https:|tel:)/.test(value)) return null;
  try {
    const url = new URL(value, instruction.source_url);
    if (url.username || url.password) return null;
    if (url.protocol === "https:") return url.href;
    if (url.protocol === "tel:" && /^tel:\+?\d{7,15}$/.test(value))
      return value;
  } catch {
    /* Invalid source links are rendered as plain text. */
  }
  return null;
}
export function instructionNodeText(node) {
  return typeof node === "string"
    ? node
    : node.children.map(instructionNodeText).join("");
}
export function instructionCopyText(nodes, id) {
  for (const node of nodes) {
    if (typeof node === "string") continue;
    if (node.attrs.id === id) return instructionNodeText(node).trim();
    const found = instructionCopyText(node.children, id);
    if (found) return found;
  }
  return "";
}
export function instructionMatches(value, query, literal = false) {
  const normalize = (text) =>
    String(text).toLocaleLowerCase("ru").replaceAll("ё", "е");
  if (
    literal
      ? normalize(query)
          .trim()
          .split(/\s+/)
          .every((word) => normalize(value).includes(word))
      : matchesQuery({ body: value }, query)
  )
    return true;
  const digits = String(query).replace(/\D/g, "");
  return (
    /^[+\d\s()-]+$/.test(String(query)) &&
    digits.length >= 4 &&
    String(value).replace(/\D/g, "").includes(digits)
  );
}
