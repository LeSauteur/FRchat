import { isReference } from "./reference.mjs";
import { postStatus } from "./dates.mjs";
export const normalize = (text) =>
  String(text ?? "")
    .toLocaleLowerCase("ru")
    .replaceAll("ё", "е");
const stopWords = new Set([
  "а",
  "без",
  "в",
  "во",
  "для",
  "до",
  "за",
  "и",
  "из",
  "к",
  "ко",
  "на",
  "не",
  "о",
  "об",
  "от",
  "по",
  "при",
  "про",
  "с",
  "со",
  "у",
]);
// Light word normalization, not semantic guessing: «отчётов» matches «отчёты»,
// «почта» matches «почту». All meaningful query terms must still be present.
function stem(word) {
  if (!/^[а-я]+$/u.test(word) || word.length < 4) return word;
  const shortened = word.replace(
    /(?:иями|ями|ами|ого|ему|ому|ыми|ими|иях|ах|ях|ов|ев|ам|ям|ом|ем|ых|их|ий|ый|ой|ая|яя|ое|ее|ые|ие|ую|юю|а|я|ы|и|ь|у|ю|е|о)$/u,
    "",
  );
  return shortened.length >= 3 ? shortened : word;
}
export function searchTerms(value) {
  return (normalize(value).match(/[а-яa-z0-9@._]+/gu) ?? [])
    .filter((w) => !stopWords.has(w))
    .map(stem);
}
export function matchesQuery(post, query) {
  const raw = [
    post.title,
    post.body,
    post.source,
    ...(post.links ?? []).flatMap((l) => [l.label, l.url]),
    ...(post.attachments ?? []).map((f) => f.name),
    ...(post.expected_attachments ?? []).map((f) => f.label),
  ].join(" ");
  const terms = searchTerms(raw),
    normalized = normalize(raw),
    queryTerms = searchTerms(query);
  return queryTerms.every(
    (term) =>
      terms.some((word) => word.includes(term)) || normalized.includes(term),
  );
}
export function publicationTime(post) {
  const stamps = [
    post.created_at,
    ...(post.reminded_at ?? []).map((r) => (typeof r === "string" ? r : r.at)),
  ]
    .map(Date.parse)
    .filter(Number.isFinite);
  return stamps.length ? Math.max(...stamps) : 0;
}
export function comparePublicationTime(a, b) {
  return (
    publicationTime(b) - publicationTime(a) ||
    Date.parse(b.created_at) - Date.parse(a.created_at) ||
    a.id.localeCompare(b.id)
  );
}
export function groupSearchResults(posts, now = new Date()) {
  return [
    {
      id: "active",
      label: "Актуальное",
      posts: posts.filter(
        (p) => !isReference(p) && !postStatus(p, now).archive,
      ),
    },
    {
      id: "archive",
      label: "Архив",
      posts: posts.filter((p) => !isReference(p) && postStatus(p, now).archive),
    },
    { id: "reference", label: "Справочник", posts: posts.filter(isReference) },
  ].map((g) => ({ ...g, posts: [...g.posts].sort(comparePublicationTime) }));
}
