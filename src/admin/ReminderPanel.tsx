import React, { useRef, useState } from "react";
import type { Identity, Post } from "../types";
import {
  canRemind,
  prepareReminder,
  recentReminder,
  reminderAnnouncement,
  reminderChoiceKey,
  reminderDates,
} from "../lib/reminders.mjs";
import { fullDate, humanError } from "../lib/manager.mjs";
import { moscowStamp } from "../lib/writer.mjs";
import { nextPostDate } from "../lib/dates.mjs";
/** One confirmation and write path, used both from management and duplicate review. */
export default function ReminderPanel({
  post,
  identity,
  writer,
  onSaved,
  onBack,
  beforeSend,
  incoming,
}: {
  post: Post;
  identity: Identity;
  writer: any;
  onSaved: (result: any) => void;
  onBack: () => void;
  beforeSend?: () => Promise<void>;
  incoming?: Post;
}) {
  const [currentPost, setCurrentPost] = useState(post);
  post = currentPost;
  const dates = reminderDates(post),
    [choice, setChoice] = useState(dates[0] ? reminderChoiceKey(dates[0]) : ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [done, setDone] = useState<Post | null>(null),
    [copied, setCopied] = useState(false),
    [copyText, setCopyText] = useState(""),
    [recentAccepted, setRecentAccepted] = useState(false);
  const operation = useRef(crypto.randomUUID()),
    sending = useRef(false);
  const recent = recentReminder(post);
  const event = !dates.length ? nextPostDate(post, "event") : null;
  async function send() {
    if (sending.current || (recent && !recentAccepted)) return;
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      await beforeSend?.();
      if (!writer) throw { kind: "unavailable" };
      const changed = prepareReminder(post, {
        id: operation.current,
        at: moscowStamp(),
        by: identity.label,
        choiceKey: choice,
      });
      const result = await writer.savePost({
        post: changed,
        basePost: post,
        operationId: operation.current,
      });
      onSaved(result);
      setDone(result.snapshot.posts.find((p: Post) => p.id === post.id));
      window.scrollTo({ top: 0 });
    } catch (e: any) {
      if (e.name === "PostConflict") {
        try {
          const latest = await writer.readSnapshot();
          onSaved(latest);
          const updated = latest.snapshot.posts.find(
            (p: Post) => p.id === post.id,
          );
          if (updated) setCurrentPost(updated);
          setRecentAccepted(false);
          operation.current = crypto.randomUUID();
          setError(
            "Публикацию уже успели изменить. Мы открыли свежую версию — проверьте срок и подтвердите ещё раз.",
          );
        } catch {
          setError(
            "Не удалось обновить публикацию. Вернитесь назад и попробуйте ещё раз, когда появится связь.",
          );
        }
      } else
        setError(e.kind === "validation" ? e.message : humanError(e, true));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  if (done)
    return (
      <section
        className="manager-focus manager-done"
        aria-label="Напоминание отправлено"
      >
        <h1>Готово!</h1>
        <p>
          Карточка поднята в ленте. Участники увидят напоминание при обновлении.
        </p>
        {incoming && <p>Вставленный текст и файлы сохранены в черновике.</p>}
        <button
          className="primary"
          onClick={async () => {
            const reminder = done.reminded_at.find(
              (r) => r.id === operation.current,
            )!;
            const text = reminderAnnouncement(
              done,
              reminder,
              location.href.split("#")[0],
            );
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
            } catch {
              setCopyText(text);
            }
          }}
        >
          Скопировать для MAX
        </button>
        {copied && <p role="status">Скопировано — можно вставить в MAX</p>}
        {copyText && (
          <label>
            Выделите и скопируйте сообщение
            <textarea
              readOnly
              value={copyText}
              onFocus={(e) => e.target.select()}
            />
          </label>
        )}
        {incoming && (
          <button onClick={onBack}>Вернуться к вставленному тексту</button>
        )}
        <a
          className="secondary"
          href="#/feed"
          onClick={() => {
            if (!incoming) onBack();
          }}
        >
          На главную
        </a>
      </section>
    );
  return (
    <section
      className="manager-focus reminder-panel"
      aria-label="Подтверждение напоминания"
    >
      <h1>Напомнить участникам?</h1>
      {incoming && (
        <div className="manager-compare">
          {[
            { label: "Уже опубликовано", value: post },
            { label: "Ваше сообщение", value: incoming },
          ].map(({ label, value }) => (
            <article className="manager-card" key={label}>
              <h2>{label}</h2>
              <strong>{value.title}</strong>
              {value.dates.map((d) => (
                <p key={d.id}>
                  {d.label || (d.kind === "deadline" ? "Срок" : "Событие")}:{" "}
                  {fullDate(d)}
                </p>
              ))}
              <p>{value.body}</p>
            </article>
          ))}
        </div>
      )}
      <h2>{post.title}</h2>
      {dates.length > 0 ? (
        <fieldset disabled={busy}>
          <legend>О каком сроке напомнить?</legend>
          {dates.map((d) => (
            <label className="reminder-choice" key={reminderChoiceKey(d)}>
              <input
                type="radio"
                name="reminder-date"
                checked={choice === reminderChoiceKey(d)}
                onChange={() => setChoice(reminderChoiceKey(d))}
              />
              <span>
                {d.label || "Срок"}: {fullDate(d)}
              </span>
            </label>
          ))}
        </fieldset>
      ) : (
        <p>
          {event
            ? `${event.label || "Событие"}: ${fullDate(event)}`
            : "Напоминание о публикации без даты."}
        </p>
      )}
      <p>
        Текст и даты опубликованной карточки сохранятся. Выделение в ленте
        действует сутки.
      </p>
      {incoming && (
        <p>
          Вставленный текст не добавится к карточке. Он сохранён в черновике.
        </p>
      )}
      {recent && (
        <div className="notice">
          <p>{recent.text}</p>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={recentAccepted}
              disabled={busy}
              onChange={(e) => setRecentAccepted(e.target.checked)}
            />
            Да, хочу напомнить повторно
          </label>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!canRemind(post) && (
        <p>
          Событие завершено или все сроки уже прошли. Напоминать о нём больше
          нельзя.
        </p>
      )}
      <button
        disabled={
          busy || !canRemind(post) || Boolean(recent && !recentAccepted)
        }
        onClick={() => void send()}
      >
        {busy ? "Отправляем напоминание…" : "Да, напомнить"}
      </button>
      <button disabled={busy} onClick={onBack}>
        Назад к выбору
      </button>
    </section>
  );
}
