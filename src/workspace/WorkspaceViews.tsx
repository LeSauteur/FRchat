import React, { useState } from "react";
import type { Post, Snapshot, FileEntry } from "../types";
import { dateLabel, deadlineStatus, isHot, postStatus } from "../lib/dates.mjs";
import {
  documentCategories,
  documents,
  upcomingActions,
  workspaceSettings,
} from "../lib/workspace.mjs";

export function NewsLinks({ path }: { path: string }) {
  return (
    <nav className="workspace-subnav" aria-label="Новости и сохранённое">
      {[
        ["/feed", "Сводка и новости"],
        ["/favorites", "Избранное"],
        ["/archive", "Архив"],
      ].map(([url, label]) => (
        <a
          key={url}
          href={"#" + url}
          aria-current={path === url ? "page" : undefined}
        >
          {label}
        </a>
      ))}
    </nav>
  );
}
function ActionList({
  snapshot,
  now,
  kind,
  limit = 3,
}: {
  snapshot: Snapshot;
  now: Date;
  kind: string;
  limit?: number;
}) {
  const actions = upcomingActions(snapshot.posts, now, kind).slice(0, limit);
  return actions.length ? (
    <div className="action-list">
      {actions.map(({ post, date }: any) => (
        <a
          key={`${post.id}:${date.id}:${date.start}`}
          href={`#/post/${encodeURIComponent(post.id)}`}
          className={
            "action-item " +
            (date.kind === "deadline"
              ? "action-" + deadlineStatus(date, now).id
              : "")
          }
        >
          <span className="action-kicker">
            {date.kind === "deadline" ? "Срок" : "Событие"} · {dateLabel(date)}
          </span>
          <strong>{date.label || post.title}</strong>
          {date.label && <small>{post.title}</small>}
          {date.kind === "deadline" && (
            <small>{deadlineStatus(date, now).label}</small>
          )}
        </a>
      ))}
    </div>
  ) : (
    <p className="muted">
      {kind === "deadline" ? "Ближайших сроков нет." : "Ближайших событий нет."}
    </p>
  );
}
export function Upcoming({ snapshot, now }: { snapshot: Snapshot; now: Date }) {
  return (
    <section className="workspace-upcoming">
      <div className="section-heading">
        <h2>Ближайшие действия</h2>
        <span className="muted">Время московское</span>
      </div>
      <div className="summary-grid">
        <section className="summary-panel">
          <h3>Что нужно сделать</h3>
          <ActionList snapshot={snapshot} now={now} kind="deadline" />
        </section>
        <section className="summary-panel">
          <h3>Куда подключиться или прийти</h3>
          <ActionList snapshot={snapshot} now={now} kind="event" />
        </section>
      </div>
    </section>
  );
}
export function WorkSummary({
  snapshot,
  now,
}: {
  snapshot: Snapshot;
  now: Date;
}) {
  const important = snapshot.posts
    .filter(
      (p) =>
        p.type !== "reference" &&
        p.state === "active" &&
        !postStatus(p, now).archive &&
        (p.priority !== "normal" || p.pinned),
    )
    .slice(0, 2);
  const hot = snapshot.posts.filter((p) => isHot(p, now)).length;
  return (
    <section className="work-summary" aria-label="Рабочая сводка">
      <div className="summary-intro">
        <div>
          <span className="eyebrow">ВАШ РАБОЧИЙ ДЕНЬ</span>
          <h2>Всё важное под рукой</h2>
          <p>Объявления, ближайшие действия и полезные материалы.</p>
        </div>
        <a className="summary-hot" href="#/calendar">
          Горит сейчас <b>{hot}</b>
          <span>Открыть календарь →</span>
        </a>
      </div>
      <div className="summary-grid">
        <section className="summary-panel">
          <div className="section-heading">
            <h3>Важное</h3>
            <button
              className="summary-jump"
              onClick={() =>
                document
                  .getElementById("news-feed")
                  ?.scrollIntoView({ block: "start" })
              }
            >
              К новостям ↓
            </button>
          </div>
          {important.length ? (
            important.map((p) => (
              <a
                className="summary-announcement"
                key={p.id}
                href={`#/post/${encodeURIComponent(p.id)}`}
              >
                <span className="eyebrow">
                  {p.priority === "urgent" ? "СРОЧНО" : "ОБРАТИТЕ ВНИМАНИЕ"}
                </span>
                <strong>{p.title}</strong>
              </a>
            ))
          ) : (
            <p className="muted">Все важные объявления появятся здесь.</p>
          )}
          <div className="quick-actions">
            <a href="#/documents">Найти документ →</a>
            <a href="#/tools">Открыть инструмент →</a>
          </div>
        </section>
        <section className="summary-panel">
          <div className="section-heading">
            <h3>Ближайшие сроки</h3>
            <a href="#/calendar?date=deadline">Все сроки →</a>
          </div>
          <ActionList snapshot={snapshot} now={now} kind="deadline" limit={2} />
        </section>
      </div>
      <section className="summary-events">
        <h3>Ближайшие события</h3>
        <ActionList snapshot={snapshot} now={now} kind="event" limit={2} />
      </section>
    </section>
  );
}
export function DocumentsView({
  snapshot,
  download,
  categoryId,
  onCategory,
}: {
  snapshot: Snapshot;
  download: (file: FileEntry) => Promise<void>;
  categoryId: string;
  onCategory: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const selected = categoryId,
    setSelected = onCategory;
  const categories = documentCategories(snapshot);
  const all = documents(snapshot),
    found = documents(snapshot, query, selected);
  const files = snapshot.posts
    .filter((p) => p.type !== "reference" && p.state !== "deleted")
    .flatMap((p) =>
      p.attachments
        .filter((f) => !f.superseded_at)
        .map((f) => ({ post: p, file: f })),
    );
  const pending = snapshot.posts
    .filter((p) => p.state !== "deleted")
    .flatMap((p) =>
      p.expected_attachments.map((f) => ({ post: p, label: f.label })),
    );
  return (
    <section className="documents-view">
      <header className="catalog-heading">
        <span className="eyebrow">БАЗА ЗНАНИЙ ФРАНШИЗЫ</span>
        <h1>Документы</h1>
        <p>Правила, инструкции и формы — в одном месте.</p>
      </header>
      <label className="catalog-search">
        Найти документ
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Название, рабочее слово или имя файла"
        />
      </label>
      <button
        className="reference-files-link"
        aria-label="Шаблоны и файлы"
        onClick={() =>
          document
            .getElementById("reference-files")
            ?.scrollIntoView({ block: "start" })
        }
      >
        Шаблоны и файлы ↓
      </button>
      <div className="documents-layout">
        <nav className="document-categories" aria-label="Категории документов">
          <button
            className={!selected ? "selected" : ""}
            aria-pressed={!selected}
            onClick={() => setSelected("")}
          >
            Все документы <span>{all.length}</span>
          </button>
          {categories
            .filter(
              (c) => !c.archived || all.some((p) => p.category_id === c.id),
            )
            .map((c) => (
              <button
                key={c.id}
                className={selected === c.id ? "selected" : ""}
                aria-pressed={selected === c.id}
                onClick={(e) => {
                  setSelected(selected === c.id ? "" : c.id);
                  e.currentTarget.scrollIntoView({
                    block: "nearest",
                    inline: "nearest",
                  });
                }}
              >
                {c.name}
                <span>{all.filter((p) => p.category_id === c.id).length}</span>
              </button>
            ))}
        </nav>
        <div className="document-results">
          <div className="section-heading">
            <h2>
              {categories.find((c) => c.id === selected)?.name ||
                "Все документы"}
            </h2>
            <span className="muted">{found.length}</span>
          </div>
          {found.length ? (
            found.map((p) => (
              <a
                className="document-card"
                key={p.id}
                href={`#/post/${encodeURIComponent(p.id)}`}
              >
                <div className="document-card-top">
                  <span className="document-type">
                    {p.attachments.length ? "МАТЕРИАЛ И ФАЙЛЫ" : "СТАТЬЯ"}
                  </span>
                  <span
                    className={
                      "document-state " +
                      (p.document?.status === "outdated" ? "outdated" : "")
                    }
                  >
                    {p.document?.status === "outdated"
                      ? "Требует обновления"
                      : p.document
                        ? "Проверен"
                        : "Актуальность не указана"}
                  </span>
                </div>
                <h3>{p.title}</h3>
                <p>{p.document?.description || p.body.slice(0, 160)}</p>
                <div className="document-card-meta">
                  <span>
                    {p.document?.reviewed_on
                      ? `Актуален на ${p.document.reviewed_on.split("-").reverse().join(".")}`
                      : "Дату проверки уточнит ответственный"}
                  </span>
                  <span>{p.document?.owner || p.source}</span>
                </div>
                <span className="document-open">Открыть материал →</span>
              </a>
            ))
          ) : (
            <div className="catalog-empty">
              <h3>
                {query || selected
                  ? "Материалы не найдены"
                  : "База знаний скоро появится"}
              </h3>
              <p>
                {query || selected
                  ? "Попробуйте другое слово или выберите все документы."
                  : "Здесь будут проверенные регламенты, инструкции, контакты и шаблоны. Материалы добавит администратор."}
              </p>
              {(query || selected) && (
                <button
                  onClick={() => {
                    setQuery("");
                    setSelected("");
                  }}
                >
                  Показать все документы
                </button>
              )}
            </div>
          )}
          <section
            className="catalog-files"
            id="reference-files"
            aria-label="Шаблоны и файлы"
          >
            <h2>Шаблоны и файлы</h2>
            <p className="muted">
              Вложения из новостей и архива. Файлы справочных материалов
              открываются в карточке документа.
            </p>
            {files
              .filter(
                ({ file, post }) =>
                  !query ||
                  `${file.name} ${post.title}`
                    .toLocaleLowerCase("ru")
                    .includes(query.toLocaleLowerCase("ru")),
              )
              .map(({ file, post }) => (
                <div className="catalog-file" key={`${post.id}-${file.id}`}>
                  <button
                    className="catalog-download"
                    onClick={() => void download(file)}
                  >
                    <strong>{file.name}</strong> · Скачать
                  </button>
                  <a href={`#/post/${encodeURIComponent(post.id)}`}>
                    {post.title} →
                  </a>
                </div>
              ))}
            {pending
              .filter(
                (f) =>
                  !query ||
                  `${f.label} ${f.post.title}`
                    .toLocaleLowerCase("ru")
                    .includes(query.toLocaleLowerCase("ru")),
              )
              .map((f, i) => (
                <div
                  className="catalog-file pending-file"
                  key={f.post.id + ":" + i}
                >
                  <strong>{f.label}</strong>
                  <span>Файл пока не добавлен</span>
                  <a href={`#/post/${encodeURIComponent(f.post.id)}`}>
                    Исходная публикация →
                  </a>
                </div>
              ))}
            {!files.length && (
              <p>
                Файлы ещё не добавлены. Ожидаемые вложения в новостях
                сохраняются в исходных карточках.
              </p>
            )}
          </section>
        </div>
      </div>
    </section>
  );
}
export function ToolsView({ snapshot }: { snapshot: Snapshot }) {
  const tools = workspaceSettings(snapshot).tools.filter((t: any) => t.enabled);
  return (
    <section className="tools-view">
      <header className="catalog-heading">
        <span className="eyebrow">ДЛЯ ЕЖЕДНЕВНОЙ РАБОТЫ</span>
        <h1>Инструменты</h1>
        <p>
          Проверенные сервисы франшизы. Каждый открывается в отдельной вкладке.
        </p>
      </header>
      <div className="tools-grid">
        {tools.map((t: any, i: number) => (
          <article className="tool-card" key={t.id}>
            <span className="tool-number">
              {String(i + 1).padStart(2, "0")}
            </span>
            <h2>{t.title}</h2>
            <p>{t.description}</p>
            <span className="muted tool-host">{new URL(t.url).hostname}</span>
            <a
              href={t.url}
              target="_blank"
              rel="noopener noreferrer"
              className="tool-open"
            >
              Открыть <span aria-hidden="true">↗</span>
              <span className="sr-only"> {t.title}</span>
            </a>
          </article>
        ))}
      </div>
      {!tools.length && (
        <div className="catalog-empty">
          <h2>Инструменты скоро появятся</h2>
          <p>Администратор добавит ссылки на рабочие сервисы.</p>
        </div>
      )}
      <p className="catalog-note">
        У сервисов сохраняются свои правила входа. Пароль от этого пространства
        не передаётся по ссылкам.
      </p>
    </section>
  );
}
export function DocumentInfo({ post }: { post: Post }) {
  if (!post.document)
    return (
      <p className="notice">
        Дата проверки актуальности этого материала пока не указана.
      </p>
    );
  const meta = post.document;
  return (
    <section className="document-info" aria-label="Сведения о документе">
      {meta.status === "outdated" && (
        <p className="notice">
          Материал требует обновления. Уточните действующую версию у
          ответственного.
        </p>
      )}
      <p className="document-description">{meta.description}</p>
      <dl>
        <div>
          <dt>Актуален на</dt>
          <dd>{meta.reviewed_on.split("-").reverse().join(".")}</dd>
        </div>
        <div>
          <dt>Ответственный</dt>
          <dd>{meta.owner}</dd>
        </div>
        <div>
          <dt>Версия</dt>
          <dd>{meta.version || "Не указана"}</dd>
        </div>
      </dl>
    </section>
  );
}
