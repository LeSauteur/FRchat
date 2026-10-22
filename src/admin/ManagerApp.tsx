import React, { useState } from "react";
import type { Identity, Post, Snapshot } from "../types";
import ManagerEditor, { ManagerPreview } from "./ManagerEditor";
import OwnerSetup from "./OwnerSetup";
import { fullDate, humanError } from "../lib/manager.mjs";
import { moscowStamp } from "../lib/writer.mjs";
import { postStatus } from "../lib/dates.mjs";
import { readLocal, writeLocal } from "../lib/storage.mjs";
import { REFERENCE_CATEGORIES } from "../lib/reference.mjs";
import ReminderPanel from "./ReminderPanel";
import { canRemind, reminderDescription } from "../lib/reminders.mjs";
export default function ManagerApp({
  snapshot,
  identity,
  dataKey,
  accessKey,
  epoch,
  access,
  writer,
  path,
  onSaved,
  onConnected,
  onLogout,
  theme,
  onTheme,
  onView,
}: {
  snapshot: Snapshot;
  identity: Identity;
  dataKey: CryptoKey;
  accessKey: CryptoKey | null;
  epoch: string;
  access: any;
  writer: any;
  path: string;
  onSaved: (result: any) => void;
  onConnected: (result: any, writer: any) => void;
  onLogout: () => void;
  theme: string;
  onTheme: () => void;
  onView: () => void;
}) {
  const [help, setHelp] = useState<number | null>(() =>
      readLocal("frchat.manager-help.v1") === "done" ? null : 0,
    ),
    [section, setSection] = useState("active"),
    [query, setQuery] = useState(""),
    [remove, setRemove] = useState<Post | null>(null),
    [undo, setUndo] = useState<Post | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [settings, setSettings] = useState(false),
    [remind, setRemind] = useState<Post | null>(null);
  const categories = [...snapshot.categories, ...REFERENCE_CATEGORIES];
  async function changeState(post: Post, state: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (!writer) throw { kind: "unavailable" };
      const at = moscowStamp(),
        id = crypto.randomUUID();
      const result = await writer.savePost({
        post: {
          ...post,
          state,
          history: [
            ...post.history,
            {
              id,
              at,
              type: state === "deleted" ? "deleted" : "restored",
              text:
                state === "deleted"
                  ? "Публикация удалена"
                  : "Публикация возвращена",
              by: identity.label,
            },
          ],
        },
        basePost: post,
        operationId: id,
      });
      onSaved(result);
      setRemove(null);
      setUndo(
        state === "deleted"
          ? result.snapshot.posts.find((p: Post) => p.id === post.id)
          : null,
      );
    } catch (e) {
      setError(humanError(e, false));
    } finally {
      setBusy(false);
    }
  }
  const shell = (content: React.ReactNode) => (
    <main className="manager-app">
      <header className="manager-header">
        <a href="#/feed" className="manager-brand">
          FRchat<span> •</span>
        </a>
        <div>
          <button onClick={onLogout}>Выйти</button>
        </div>
      </header>
      <div className="manager-content">{content}</div>
    </main>
  );
  if (path === "/setup")
    return shell(
      <OwnerSetup
        identity={identity}
        dataKey={dataKey}
        accessKey={accessKey}
        epoch={epoch}
        access={access}
        onConnected={onConnected}
      />,
    );
  if (help !== null) {
    const titles = [
        "Скопируйте сообщение в MAX",
        "Вставьте текст",
        "Нажмите «Опубликовать»",
      ],
      texts = [
        "Откройте нужное сообщение в MAX. Нажмите и удерживайте его, затем выберите «Копировать».",
        "На главной нажмите «+ Новая публикация», затем «Вставить из буфера».",
        "Проверьте карточку и нажмите «Всё верно», затем «Опубликовать». Готово!",
      ];
    return shell(
      <section className="manager-focus">
        <p>Как опубликовать · {help + 1} из 3</p>
        <h1>{titles[help]}</h1>
        <p>{texts[help]}</p>
        <button
          className="primary"
          onClick={() => {
            if (help < 2) setHelp(help + 1);
            else {
              writeLocal("frchat.manager-help.v1", "done");
              setHelp(null);
            }
          }}
        >
          {help < 2 ? "Дальше" : "Понятно"}
        </button>
      </section>,
    );
  }
  if (remind)
    return shell(
      <ReminderPanel
        key={remind.id}
        post={remind}
        identity={identity}
        writer={writer}
        onSaved={onSaved}
        onBack={() => setRemind(null)}
      />,
    );
  if (path === "/admin/new" || path.startsWith("/admin/edit/")) {
    const id = path.startsWith("/admin/edit/")
        ? decodeURIComponent(path.slice(12))
        : "",
      existing = snapshot.posts.find((p) => p.id === id);
    if (id && !existing)
      return shell(
        <>
          <h1>Публикация не найдена</h1>
          <a href="#/feed">На главную</a>
        </>,
      );
    return shell(
      <ManagerEditor
        key={id || "new"}
        snapshot={snapshot}
        existing={existing}
        identity={identity}
        dataKey={dataKey}
        epoch={epoch}
        writer={writer}
        onSaved={onSaved}
      />,
    );
  }
  const selected = path.startsWith("/post/")
    ? snapshot.posts.find((p) => p.id === decodeURIComponent(path.slice(6)))
    : null;
  const rows = snapshot.posts
    .filter((p) => {
      if (
        query &&
        !`${p.title} ${p.body}`
          .toLocaleLowerCase("ru")
          .includes(query.toLocaleLowerCase("ru"))
      )
        return false;
      if (section === "deleted") return p.state === "deleted";
      if (p.state === "deleted") return false;
      if (section === "reference")
        return p.type === "reference" || p.state === "reference";
      if (p.type === "reference" || p.state === "reference") return false;
      if (section === "reminders") return p.category_id === "reminders";
      if (p.category_id === "reminders") return false;
      return postStatus(p, new Date()).archive === (section === "archive");
    })
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const actions = (p: Post) => (
    <div className="manager-card-actions">
      {p.state === "deleted" ? (
        <button disabled={busy} onClick={() => changeState(p, "active")}>
          Вернуть публикацию
        </button>
      ) : (
        <>
          <a
            className="secondary manager-edit"
            href={`#/admin/edit/${encodeURIComponent(p.id)}`}
          >
            Исправить
          </a>
          <button
            disabled={busy || !canRemind(p)}
            onClick={() => {
              setRemind(p);
              window.scrollTo({ top: 0 });
            }}
          >
            Напомнить
          </button>
          <button
            className="manager-delete"
            disabled={busy}
            onClick={() => {
              setRemove(p);
              setError("");
              window.scrollTo({ top: 0 });
            }}
          >
            Удалить
          </button>
        </>
      )}
    </div>
  );
  if (remove)
    return shell(
      <section className="manager-focus">
        <h1>Удалить публикацию?</h1>
        <p>
          «{remove.title}» исчезнет из ленты. Её можно будет вернуть из раздела
          «Удалённые».
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button
          disabled={busy}
          className="primary"
          onClick={() => changeState(remove, "deleted")}
        >
          {busy ? "Удаляем…" : "Да, удалить"}
        </button>
        <button disabled={busy} onClick={() => setRemove(null)}>
          Оставить публикацию
        </button>
      </section>,
    );
  return shell(
    <>
      <div className="manager-home-title">
        <div>
          <p>Руководство</p>
          <h1>{selected ? "Публикация" : "Ваши публикации"}</h1>
        </div>
        <div className="manager-home-tools">
          <button onClick={onView}>Как видят участники</button>
          <button onClick={() => setHelp(0)}>Как это работает?</button>
          <button onClick={() => setSettings(!settings)}>Настройки</button>
        </div>
      </div>
      <div className="manager-home-action">
        <a className="primary" href="#/admin/new">
          + Новая публикация
        </a>
      </div>
      {settings && (
        <section className="manager-card">
          <h2>Настройки</h2>
          <button onClick={onTheme}>
            Тема:{" "}
            {theme === "light"
              ? "светлая"
              : theme === "dark"
                ? "тёмная"
                : "как на устройстве"}
          </button>
          <p>
            Выберите удобную яркость экрана. Настройка сохраняется на этом
            устройстве.
          </p>
        </section>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {undo && (
        <div className="notice">
          <p>Публикация удалена. Можно вернуть её.</p>
          <button disabled={busy} onClick={() => changeState(undo, "active")}>
            Вернуть публикацию
          </button>
        </div>
      )}
      {selected ? (
        <>
          <a className="manager-back" href="#/feed">
            ← На главную
          </a>
          <ManagerPreview post={selected} categories={categories} />
          <ReminderHistory post={selected} />
          {actions(selected)}
        </>
      ) : (
        <>
          <nav className="manager-tabs" aria-label="Публикации руководителя">
            {[
              ["active", "Актуально"],
              ["archive", "Архив"],
              ["reminders", "Напоминания"],
              ["reference", "Справочник"],
              ["deleted", "Удалённые"],
            ].map(([id, label]) => (
              <button
                key={id}
                aria-pressed={section === id}
                onClick={() => setSection(id)}
              >
                {label}
              </button>
            ))}
          </nav>
          <label>
            Найти публикацию
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Название или слова из сообщения"
            />
          </label>
          {!rows.length && (
            <section className="manager-card">
              <h2>
                {section === "reference"
                  ? "Справочник пока пуст"
                  : "Публикаций пока нет"}
              </h2>
              <p>
                {section === "reference"
                  ? "Здесь будут постоянные контакты, реквизиты и инструкции. Алексей готовит материалы."
                  : "Создайте новую публикацию или посмотрите другой раздел."}
              </p>
            </section>
          )}
          {rows.map((p) => (
            <article key={p.id} className="manager-card">
              <p className="manager-category">
                {categories.find((c) => c.id === p.category_id)?.name} ·{" "}
                {postStatus(p, new Date()).label}
              </p>
              <h2>
                <a href={`#/post/${encodeURIComponent(p.id)}`}>{p.title}</a>
              </h2>
              {p.dates.slice(0, 2).map((d) => (
                <p key={d.id}>
                  {d.label || (d.kind === "event" ? "Событие" : "Срок")}:{" "}
                  {fullDate(d)}
                </p>
              ))}
              {actions(p)}
              <ReminderHistory post={p} />
            </article>
          ))}
        </>
      )}
    </>,
  );
}
function ReminderHistory({ post }: { post: Post }) {
  if (!post.reminded_at.length) return <p>Напоминали 0 раз</p>;
  return (
    <details className="manager-reminder-history">
      <summary>Напоминали {post.reminded_at.length} раз</summary>
      {[...post.reminded_at]
        .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
        .map((r) => (
          <p key={r.id}>
            {fullDate({ kind: "event", start: r.at })} ·{" "}
            {reminderDescription(r)}
          </p>
        ))}
    </details>
  );
}
