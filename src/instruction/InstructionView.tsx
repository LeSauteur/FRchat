import React, { useEffect, useState } from "react";
import type { InstructionArticle, InstructionNode } from "./types";
import {
  instruction,
  instructionDate,
  instructionHref,
  instructionLink,
  instructionNodeText,
  instructionCopyText,
  instructionMatches,
} from "../lib/instruction.mjs";
import "./instruction.css";

export function InstructionCard({
  article,
  query = "",
}: {
  article: InstructionArticle;
  query?: string;
}) {
  return (
    <a
      className="document-card instruction-card"
      href={instructionHref(article.slug, query)}
    >
      <div className="document-card-top">
        <span className="document-type">ИНСТРУКЦИЯ ФРАНШИЗЫ</span>
        <span className="document-state">Версия от {instructionDate}</span>
      </div>
      <h3>{article.title}</h3>
      <p>{article.description}</p>
      <span className="document-open">Открыть материал</span>
    </a>
  );
}

export function InstructionShortcuts() {
  return (
    <nav
      className="instruction-shortcuts"
      aria-label="Быстрый доступ к инструкции"
    >
      {[
        [
          "registration",
          "Регистрация сотрудника",
          "Документы, сроки и проверка СБ",
        ],
        [
          "important-contacts",
          "Контакты компании",
          "К кому обратиться с вопросом",
        ],
        ["groups", "Группы MAX", "43 рабочих чата и рассылки"],
        ["offices", "Офисы сети", "68 действующих офисов"],
      ].map(([slug, title, description]) => (
        <a key={slug} href={instructionHref(slug)}>
          <strong>{title}</strong>
          <span>{description}</span>
        </a>
      ))}
    </nav>
  );
}

export function InstructionFiles({ query = "" }: { query?: string }) {
  const found = instruction.files.filter((file) =>
    instructionMatches(`${file.title} ${file.description} ${file.name}`, query),
  );
  return (
    <div className="instruction-files">
      {found.map((file) => (
        <a
          className="instruction-file"
          key={file.name}
          href={`./instruction-files/${file.name}`}
          download={file.name}
        >
          <span className="instruction-file-type">
            {file.name.endsWith(".docx") ? "DOCX" : "DOC"}
          </span>
          <strong>{file.title}</strong>
          <span>{file.description}</span>
          <span className="instruction-file-action">
            Скачать · {Math.ceil(file.size / 1024)} КБ
          </span>
        </a>
      ))}
    </div>
  );
}

function Checklist({ node }: { node: Exclude<InstructionNode, string> }) {
  const labels = node.children.filter(
    (child): child is Exclude<InstructionNode, string> =>
      typeof child !== "string" && child.tag === "label",
  );
  const [checked, setChecked] = useState<string[]>([]);
  return (
    <fieldset className="instruction-checklist">
      <legend>Комплект для Domianix 3 и TopnLab</legend>
      {labels.map((label, index) => (
        <label key={index}>
          <input
            type="checkbox"
            checked={checked.includes(String(index))}
            onChange={(event) =>
              setChecked((previous) =>
                event.target.checked
                  ? [...previous, String(index)]
                  : previous.filter((value) => value !== String(index)),
              )
            }
          />
          {instructionNodeText(label).trim()}
        </label>
      ))}
      <p role="status">
        Готово {checked.length} из {labels.length}
      </p>
      <button type="button" onClick={() => setChecked([])}>
        Сбросить отметки
      </button>
    </fieldset>
  );
}

const bodyTags = new Set([
  "p",
  "div",
  "span",
  "h2",
  "h3",
  "h4",
  "strong",
  "b",
  "em",
  "ul",
  "ol",
  "li",
  "a",
  "br",
  "details",
  "summary",
  "pre",
]);
const bodyClasses: Record<string, string> = {
  "contact-list": "instruction-contact",
  "important-note": "instruction-note",
  "payment-info": "instruction-payment",
  deadline: "instruction-deadline",
  template: "instruction-template",
  eyebrow: "eyebrow",
  lead: "instruction-lead",
  "card-number": "instruction-card-number",
  phone: "instruction-phone",
};

function ArticleBody({
  article,
  copy,
}: {
  article: InstructionArticle;
  copy: (text: string) => Promise<void>;
}) {
  function render(node: InstructionNode, key: number): React.ReactNode {
    if (typeof node === "string") return node;
    if (node.tag === "fieldset") return <Checklist key={key} node={node} />;
    if (node.tag === "button") {
      const text = instructionCopyText(
        article.body,
        node.attrs["data-copy"] ?? "",
      );
      return text ? (
        <button type="button" key={key} onClick={() => void copy(text)}>
          {node.children.map(render)}
        </button>
      ) : null;
    }
    if (!bodyTags.has(node.tag)) return null;
    const children = node.children.map(render);
    const className =
      (node.attrs.class ?? "")
        .split(" ")
        .map((value) => bodyClasses[value] ?? "")
        .filter(Boolean)
        .join(" ") || undefined;
    if (node.tag === "a") {
      const href = instructionLink(node.attrs.href);
      return href ? (
        <a
          key={key}
          href={href}
          className={className}
          {...(href.startsWith("https:")
            ? { target: "_blank", rel: "noopener noreferrer" }
            : {})}
          {...(href.startsWith("./instruction-files/")
            ? { download: true }
            : {})}
        >
          {children}
        </a>
      ) : (
        <span key={key}>{children}</span>
      );
    }
    const tag = node.tag === "h3" ? "h2" : node.tag === "h4" ? "h3" : node.tag;
    return React.createElement(
      tag,
      { key, className },
      ...(tag === "br" ? [] : children),
    );
  }
  return <div className="instruction-body">{article.body.map(render)}</div>;
}

function SearchField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="catalog-search">
      {label}
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}

function EmptyDirectory({ onReset }: { onReset: () => void }) {
  return (
    <div className="catalog-empty">
      <h2>Ничего не найдено</h2>
      <p>Попробуйте другое слово или сбросьте поиск и фильтры.</p>
      <button type="button" onClick={onReset}>
        Сбросить поиск
      </button>
    </div>
  );
}

// Keep a directory's filters in its URL without adding a history entry for
// every keystroke or remounting the focused input. Back/reload restore them.
function useDirectoryUrl(slug: string, query: string, category = "") {
  useEffect(() => {
    const path = `/documents/instruction/${slug}`;
    if (location.hash.slice(1).split("?")[0] !== path) return;
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (category && category !== "Все" && category !== "all")
      params.set("category", category);
    const hash = `#${path}${params.size ? "?" + params.toString() : ""}`;
    if (location.hash !== hash) history.replaceState(history.state, "", hash);
  }, [slug, query, category]);
}

function Groups({
  initialCategory,
  initialQuery,
}: {
  initialCategory: string;
  initialQuery: string;
}) {
  const categories = [
    "Все",
    ...new Set(instruction.groups.map((group) => group.category)),
  ];
  const [category, setCategory] = useState(
    categories.includes(initialCategory) ? initialCategory : "Все",
  );
  const [query, setQuery] = useState(initialQuery);
  useDirectoryUrl("groups", query, category);
  const found = instruction.groups.filter(
    (group) =>
      (category === "Все" || group.category === category) &&
      instructionMatches(`${group.name} ${group.category}`, query),
  );
  return (
    <>
      <SearchField
        label="Найти группу MAX"
        value={query}
        onChange={setQuery}
        placeholder="ЖК, застройщик или город"
      />
      <div
        className="instruction-filters"
        role="group"
        aria-label="Категории групп MAX"
      >
        {categories.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={category === value}
            onClick={() => setCategory(value)}
          >
            {value}
          </button>
        ))}
      </div>
      <p className="muted" role="status">
        Показано {found.length} из {instruction.groups.length} групп
      </p>
      <div className="instruction-directory">
        {found.map((group) => (
          <a
            className="instruction-group"
            key={group.url}
            href={group.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span>{group.category}</span>
            <strong>{group.name}</strong>
            <span className="instruction-open">Открыть в MAX</span>
          </a>
        ))}
      </div>
      {!found.length && (
        <EmptyDirectory
          onReset={() => {
            setQuery("");
            setCategory("Все");
          }}
        />
      )}
    </>
  );
}

function Offices({
  initialQuery,
  initialCategory,
}: {
  initialQuery: string;
  initialCategory: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [category, setCategory] = useState(
    ["network", "orlov"].includes(initialCategory) ? initialCategory : "all",
  );
  useDirectoryUrl("offices", query, category);
  const found = instruction.offices.filter(
    (office) =>
      (category === "all" || office.group === category) &&
      instructionMatches(
        `${office.name} ${office.address} ${office.owner} ${office.phone}`,
        query,
        true,
      ),
  );
  return (
    <>
      <SearchField
        label="Найти офис"
        value={query}
        onChange={setQuery}
        placeholder="Название, адрес, собственник или телефон"
      />
      <div
        className="instruction-filters"
        role="group"
        aria-label="Группы офисов"
      >
        {[
          ["all", "Все офисы"],
          ["network", "Франшизные офисы"],
          ["orlov", "Офисы Павла Орлова"],
        ].map(([value, name]) => (
          <button
            key={value}
            type="button"
            aria-pressed={category === value}
            onClick={() => setCategory(value)}
          >
            {name}
          </button>
        ))}
      </div>
      <p className="muted" role="status">
        Показано {found.length} из {instruction.offices.length} офисов
      </p>
      <div className="instruction-directory">
        {found.map((office) => {
          const digits = office.phone.replace(/\D/g, "");
          const phone = digits.startsWith("8") ? "7" + digits.slice(1) : digits;
          return (
            <article className="instruction-person" key={office.id}>
              <span className="instruction-department">
                {office.group === "orlov"
                  ? "Офис Павла Орлова"
                  : "Франшизный офис"}
              </span>
              <h2>{office.name}</h2>
              <p>{office.address}</p>
              <p>{office.owner}</p>
              {phone && (
                <a className="instruction-phone" href={`tel:+${phone}`}>
                  {office.phone}
                </a>
              )}
              {office.address &&
                !/без офиса|без адреса/i.test(office.address) && (
                  <a
                    className="instruction-map"
                    href={`https://yandex.ru/maps/?text=${encodeURIComponent(office.address)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Найти на карте
                  </a>
                )}
            </article>
          );
        })}
      </div>
      {!found.length && (
        <EmptyDirectory
          onReset={() => {
            setQuery("");
            setCategory("all");
          }}
        />
      )}
      <p className="muted instruction-directory-source">
        Адреса сверены с{" "}
        <a
          href="https://lesauteur.github.io/officeip/"
          target="_blank"
          rel="noopener noreferrer"
        >
          офисным справочником
        </a>
        . Об исправлении данных сообщите{" "}
        <a href="tel:+79612929866">Алексею Егупову</a>.
      </p>
    </>
  );
}

function Contacts({ initialQuery }: { initialQuery: string }) {
  const [query, setQuery] = useState(initialQuery);
  useDirectoryUrl("important-contacts", query);
  const found = instruction.contacts.filter((contact) =>
    instructionMatches(
      `${contact.name} ${contact.department} ${contact.role} ${contact.phones.join(" ")}`,
      query,
    ),
  );
  const phoneLabel = (phone: string) =>
    phone.replace(/^(\+7)(\d{3})(\d{3})(\d{2})(\d{2})$/, "$1 $2 $3-$4-$5");
  return (
    <>
      <SearchField
        label="Найти контакт"
        value={query}
        onChange={setQuery}
        placeholder="Имя, отдел, вопрос или телефон"
      />
      <p className="muted" role="status">
        Контактов: {found.length}
      </p>
      <div className="instruction-directory">
        {found.map((contact) => (
          <article className="instruction-person" key={contact.name}>
            <span className="instruction-department">{contact.department}</span>
            <h2>{contact.name}</h2>
            <p>{contact.role}</p>
            <div className="instruction-phones">
              {contact.phones.map((phone) => (
                <a
                  className="instruction-phone"
                  key={phone}
                  href={`tel:${phone}`}
                >
                  {phoneLabel(phone)}
                </a>
              ))}
            </div>
          </article>
        ))}
      </div>
      {!found.length && <EmptyDirectory onReset={() => setQuery("")} />}
      <p className="instruction-directory-source">
        <a
          href="https://lesauteur.github.io/Instrukciya/contacts.html"
          target="_blank"
          rel="noopener noreferrer"
        >
          Отдельная страница контактов для отправки агентам
        </a>
      </p>
    </>
  );
}

export function InstructionView({
  slug,
  copy,
  initialCategory = "",
  initialQuery = "",
}: {
  slug: string;
  copy: (text: string) => Promise<void>;
  initialCategory?: string;
  initialQuery?: string;
}) {
  const article = instruction.articles.find((item) => item.slug === slug);
  if (!article)
    return (
      <section className="catalog-empty">
        <h1>Раздел инструкции не найден</h1>
        <p>
          <a href="#/documents">Открыть документы</a>
        </p>
      </section>
    );
  const index = instruction.articles.indexOf(article);
  const previous = instruction.articles[index - 1],
    next = instruction.articles[index + 1];
  return (
    <article className="instruction-view">
      <nav className="instruction-breadcrumb" aria-label="Путь к документу">
        <a href="#/documents">Документы</a>
        <span>/</span>
        <span>Инструкция франшизы</span>
      </nav>
      <header className="catalog-heading">
        <span className="eyebrow">ИНСТРУКЦИЯ ФРАНШИЗЫ</span>
        <h1>{article.title}</h1>
        <p>{article.description}</p>
        <span className="instruction-version">Версия от {instructionDate}</span>
      </header>
      {slug === "groups" ? (
        <Groups initialCategory={initialCategory} initialQuery={initialQuery} />
      ) : slug === "offices" ? (
        <Offices
          initialQuery={initialQuery}
          initialCategory={initialCategory}
        />
      ) : slug === "important-contacts" ? (
        <Contacts initialQuery={initialQuery} />
      ) : slug === "documents" ? (
        <>
          <InstructionFiles />
          <p className="instruction-directory-source">
            Ставка в оффере агентов — 2,5% с оборота сделки агента. Рабочий
            мессенджер — MAX.
          </p>
          <p>
            <a href={instructionHref("registration")}>
              Правила регистрации сотрудников
            </a>
          </p>
        </>
      ) : (
        <ArticleBody article={article} copy={copy} />
      )}
      <nav
        className="instruction-pagination"
        aria-label="Другие разделы инструкции"
      >
        {previous && (
          <a href={instructionHref(previous.slug)}>
            <small>Предыдущий раздел</small>
            <strong>{previous.title}</strong>
          </a>
        )}
        {next && (
          <a href={instructionHref(next.slug)}>
            <small>Следующий раздел</small>
            <strong>{next.title}</strong>
          </a>
        )}
      </nav>
      <p className="instruction-source">
        Источник:{" "}
        <a
          href={instruction.source_url + "#" + slug}
          target="_blank"
          rel="noopener noreferrer"
        >
          инструкция франшизных офисов
        </a>
        .
      </p>
    </article>
  );
}
