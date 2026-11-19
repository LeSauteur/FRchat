import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  instruction,
  instructionArticles,
  instructionSearchArticles,
  instructionHref,
  instructionSlug,
  instructionLink,
  instructionCopyText,
  instructionMatches,
} from "../src/lib/instruction.mjs";

test("approved guide includes all twelve sections and the three current public catalogs", () => {
  assert.equal(
    instruction.source_url,
    "https://lesauteur.github.io/Instrukciya/",
  );
  assert.match(instruction.source_revision, /^[a-f0-9]{40}$/);
  assert.equal(instruction.version_date, "2026-11-18");
  assert.equal(instruction.articles.length, 12);
  assert.equal(
    new Set(instruction.articles.map((article) => article.slug)).size,
    12,
  );
  assert.equal(instruction.groups.length, 43);
  assert.equal(instruction.offices.length, 68);
  assert.equal(instruction.contacts.length, 19);
  assert.doesNotMatch(
    JSON.stringify(instruction),
    /Арлашин|Деменков|Потапова|Баев|Князев|Котовская|whatsapp|wa\.me/i,
  );
});

test("catalog and global search find exact business terms, contact names, groups and office addresses", () => {
  for (const [query, slug] of [
    ["Лилекина", "important-contacts"],
    ["2202 2080", "registration"],
    ["450", "registration"],
    ["Иловайский", "groups"],
    ["Маяковского", "offices"],
    ["agent-offer.docx", "documents"],
    ["2,5%", "hr-department"],
  ]) {
    assert.ok(
      instructionArticles(query).some((article) => article.slug === slug),
      query,
    );
  }
  assert.ok(
    instructionArticles("", "reference-offices").every(
      (article) => article.slug === "offices",
    ),
  );
  assert.equal(instructionArticles("synthetic-monthly-report.csv").length, 0);
  assert.ok(instructionMatches("Плешаков Тимур Фото- и видеосъёмка", "съемка"));
  assert.ok(instructionMatches("+79287741010", "928 774"));
  assert.ok(instructionMatches("г. Шахты, ул. Маяковского", "Шахты", true));
  assert.equal(instructionMatches("Каменск-Шахтинский", "Шахты", true), false);
  assert.equal(
    instructionMatches("+79287741010", "неттакогоимени 7741"),
    false,
  );
});

test("public guide navigation stays inside the existing document routes and rejects dangerous links", () => {
  assert.equal(
    instructionSlug("/documents/instruction/registration"),
    "registration",
  );
  assert.equal(instructionSlug("/post/registration"), null);
  assert.equal(
    instructionHref("important-contacts", "Лилекина"),
    "#/documents/instruction/important-contacts?q=" +
      encodeURIComponent("Лилекина"),
  );
  assert.equal(
    instructionHref("registration", "450"),
    "#/documents/instruction/registration",
  );
  assert.equal(instructionSlug("/documents/instruction/%XX"), "");
  assert.equal(
    instructionLink("#registration"),
    instructionHref("registration"),
  );
  assert.equal(instructionLink("#home"), "#/documents");
  assert.equal(
    instructionLink("#groups?category=Новостройки"),
    instructionHref("groups") + "?category=Новостройки",
  );
  assert.equal(
    instructionLink("documents/agent-offer.docx"),
    "./instruction-files/agent-offer.docx",
  );
  assert.equal(
    instructionLink("contacts.html"),
    "https://lesauteur.github.io/Instrukciya/contacts.html",
  );
  for (const link of [
    "javascript:alert(1)",
    "data:text/html,x",
    "//example.org/",
    "http://example.org/",
    "https://user:password@example.org/",
    "documents/../../private",
    "#not-a-guide",
  ])
    assert.equal(instructionLink(link), null, link);
});

test("global search does not add built-in articles to favorite, important or reminder-only results", () => {
  for (const filter of ["favorites", "important", "reminders"]) {
    assert.equal(
      instructionSearchArticles("регистрация", { [filter]: true }).length,
      0,
    );
  }
  assert.deepEqual(
    instructionSearchArticles("анкета", { files: true }).map(
      (article) => article.slug,
    ),
    ["documents"],
  );
});

test("registration retains the complete checklist, deadlines and exact copyable template and account", () => {
  const article = instruction.articles.find(
    (article) => article.slug === "registration",
  );
  for (const text of [
    "до 16:00",
    "16:00–18:00",
    "ИНН",
    "СНИЛС",
    "Анкета с двух сторон",
    "Чек оплаты",
    "450",
    "в один день",
  ])
    assert.ok(article.text.includes(text), text);
  assert.equal(
    instructionCopyText(article.body, "sb-card"),
    "2202 2080 2009 3028",
  );
  const template = instructionCopyText(article.body, "registration-template");
  assert.match(template, /ФИО \(полностью\)/);
  assert.match(template, /Стажёр или агент с опытом \(45%\)/);
  assert.ok(
    instruction.contacts.some(
      (contact) =>
        contact.name === "Поползина Екатерина" &&
        contact.phones.includes("+79287741010"),
    ),
  );
});

test("downloaded form binaries are unchanged from the approved instruction", async () => {
  for (const file of instruction.files) {
    const bytes = await readFile(
      new URL("../public/instruction-files/" + file.name, import.meta.url),
    );
    assert.equal(bytes.length, file.size);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256);
    assert.equal(
      bytes.subarray(0, 2).toString("hex"),
      file.name.endsWith(".docx") ? "504b" : "d0cf",
    );
  }
});

test("imported bodies contain no executable elements, styles, event attributes or arbitrary image requests", () => {
  const visit = (node) => {
    if (typeof node === "string") return;
    assert.ok(
      !["script", "style", "iframe", "img", "object", "embed", "form"].includes(
        node.tag,
      ),
    );
    for (const name of Object.keys(node.attrs))
      assert.ok(
        ["class", "id", "href", "data-copy", "type"].includes(name),
        name,
      );
    node.children.forEach(visit);
  };
  for (const article of instruction.articles) article.body.forEach(visit);
});
