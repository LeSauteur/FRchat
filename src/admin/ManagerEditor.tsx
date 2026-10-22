import React, { useEffect, useMemo, useRef, useState } from "react";
import type { DateEntry, Identity, Post, Snapshot } from "../types";
import { captureText, similarPosts } from "../lib/capture.mjs";
import { prepareDuplicateUpdate, seriesPreview } from "../lib/duplicates.mjs";
import { clearDraft, loadDraft, saveDraft } from "../lib/admin-session.mjs";
import {
  persistDraftFile,
  restoreDraftFiles,
  removeDraftFiles,
} from "../lib/draft-files.mjs";
import { moscowStamp, MAX_FILE_BYTES } from "../lib/writer.mjs";
import {
  announcement,
  fullDate,
  humanError,
  shortDay,
} from "../lib/manager.mjs";
import { REFERENCE_CATEGORIES } from "../lib/reference.mjs";
import { dayKey } from "../lib/dates.mjs";
import ReminderPanel from "./ReminderPanel";
import { canRemind } from "../lib/reminders.mjs";
type Upload = {
  id: string;
  name: string;
  mime: string;
  size: number;
  bytes: Uint8Array;
};
export const emptyPost = (identity: Identity): Post => ({
  id: crypto.randomUUID(),
  type: "post",
  category_id: "company",
  title: "",
  body: "",
  source: identity.label,
  priority: "normal",
  pinned: false,
  author: { id: identity.id, display_name: identity.label },
  created_at: moscowStamp(),
  updated_at: moscowStamp(),
  state: "active",
  dates: [],
  links: [],
  attachments: [],
  expected_attachments: [],
  history: [],
  reminded_at: [],
  related: [],
});
export function ManagerPreview({
  post,
  categories,
}: {
  post: Post;
  categories: { id: string; name: string }[];
}) {
  return (
    <article className="manager-card manager-preview">
      <p className="manager-category">
        {categories.find((c) => c.id === post.category_id)?.name ??
          "Жизнь компании"}
      </p>
      <h2>{post.title || "Новая публикация"}</h2>
      {post.dates.map((d) => (
        <p className="manager-date" key={d.id}>
          <strong>
            {d.label || (d.kind === "event" ? "Событие" : "Срок")}:
          </strong>{" "}
          {fullDate(d)}
          {d.recurrence && " · повторяется каждую неделю"}
        </p>
      ))}
      <p className="manager-body">{post.body}</p>
      {post.links.map((l, i) => (
        <p key={i}>
          <a href={l.url} target="_blank" rel="noopener noreferrer">
            {l.label || "Открыть ссылку"}
          </a>
        </p>
      ))}
      {post.attachments.map((f) => (
        <p key={f.id}>📎 {f.name}</p>
      ))}
    </article>
  );
}
export default function ManagerEditor({
  snapshot,
  existing,
  identity,
  dataKey,
  epoch,
  writer,
  onSaved,
}: {
  snapshot: Snapshot;
  existing?: Post;
  identity: Identity;
  dataKey: CryptoKey;
  epoch: string;
  writer: any;
  onSaved: (result: any) => void;
}) {
  const [post, setPost] = useState<Post>(() =>
    existing ? structuredClone(existing) : emptyPost(identity),
  );
  const [basePost, setBasePost] = useState<Post | null>(existing ?? null),
    [fragments, setFragments] = useState([existing?.body ?? ""]),
    [files, setFiles] = useState<Upload[]>([]);
  const [step, setStep] = useState(existing ? 2 : 1),
    [field, setField] = useState(""),
    [warnings, setWarnings] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [ready, setReady] = useState(false),
    [cached, setCached] = useState<any>(null),
    [saved, setSaved] = useState(true),
    [keepNew, setKeepNew] = useState(Boolean(existing)),
    [conflict, setConflict] = useState<any>(null),
    [done, setDone] = useState<Post | null>(null),
    [copied, setCopied] = useState(false),
    [copyText, setCopyText] = useState("");
  const [remindTarget, setRemindTarget] = useState<Post | null>(null);
  const [seriesFocus, setSeriesFocus] = useState<any>(null);
  const [incomingPost, setIncomingPost] = useState<Post | null>(null);
  const operation = useRef(crypto.randomUUID()),
    queue = useRef<Promise<any>>(Promise.resolve()),
    sending = useRef(false),
    completed = useRef(false),
    attachmentWork = useRef(false),
    pendingDrafts = useRef(0);
  const categories =
    post.type === "reference" ? REFERENCE_CATEGORIES : snapshot.categories;
  const duplicates = useMemo(
    () => (basePost || keepNew ? [] : similarPosts(post, snapshot.posts)),
    [post, keepNew, snapshot.posts, basePost],
  );
  const match = duplicates[0];
  const seriesHasLink = post.links.some(
    (link) =>
      link.type === "meeting" ||
      (post.links.length === 1 && link.type === "other"),
  );
  const needsUpdate = Boolean(
    match &&
    (match.additions.links.length ||
      match.additions.dates.length ||
      files.length),
  );
  useEffect(() => {
    let stopped = false;
    loadDraft(identity, dataKey, epoch).then((value) => {
      if (stopped) return;
      if (value?.post && value?.fragments) setCached(value);
      else setReady(true);
    });
    return () => {
      stopped = true;
    };
  }, []);
  useEffect(() => {
    if (
      !ready ||
      completed.current ||
      (!fragments.some((v) => v.trim()) && !post.body)
    )
      return;
    const value = {
      version: 2,
      post,
      basePost,
      fragments,
      files: files.map(({ bytes, ...f }) => f),
      step,
      operationId: operation.current,
      keepNew,
      seriesFocus,
      incomingPost,
    };
    pendingDrafts.current++;
    queue.current = queue.current
      .catch(() => {})
      .then(() => saveDraft(value, identity, dataKey, epoch))
      .then((ok) => {
        setSaved(ok);
        return ok;
      })
      .catch(() => {
        setSaved(false);
        return false;
      })
      .finally(() => {
        pendingDrafts.current--;
      });
  }, [
    post,
    basePost,
    fragments,
    files,
    ready,
    step,
    keepNew,
    seriesFocus,
    incomingPost,
  ]);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (
        sending.current ||
        attachmentWork.current ||
        pendingDrafts.current ||
        !saved
      ) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [saved]);
  function patch(value: Partial<Post>) {
    setPost((p) => ({ ...p, ...value }));
    operation.current = crypto.randomUUID();
    setError("");
    setRemindTarget(null);
  }
  function next(value: number) {
    setStep(value);
    setError("");
    window.scrollTo({ top: 0 });
  }
  function analyse() {
    const result = captureText(fragments, new Date());
    if (!result.body) {
      setError("Вставьте текст сообщения.");
      return;
    }
    if (!basePost) setKeepNew(false);
    patch({
      body: result.body,
      title: result.title,
      source: result.source || post.source,
      links: !basePost
        ? result.links
        : [
            ...new Map(
              [...post.links, ...result.links].map((l) => [l.url, l]),
            ).values(),
          ],
      ...(!basePost
        ? {
            category_id: categories.some((c) => c.id === result.category_id)
              ? result.category_id
              : "company",
            dates: result.dates,
          }
        : {}),
    });
    setWarnings(result.warnings);
    next(2);
  }
  async function addFiles(incoming: File[]) {
    if (
      incoming.some((f) => f.size > MAX_FILE_BYTES) ||
      files.reduce((n, f) => n + f.size, 0) +
        incoming.reduce((n, f) => n + f.size, 0) >
        50 * 1024 * 1024
    ) {
      setError("Один файл — до 25 МБ, все файлы вместе — до 50 МБ.");
      return;
    }
    attachmentWork.current = true;
    setBusy(true);
    setError("");
    try {
      const pending: Upload[] = [];
      for (const f of incoming) {
        const file = {
          id: crypto.randomUUID(),
          name: f.name,
          mime: f.type,
          size: f.size,
          bytes: new Uint8Array(await f.arrayBuffer()),
        };
        await persistDraftFile(file, identity.id, dataKey, epoch);
        pending.push(file);
      }
      setFiles((p) => [...p, ...pending]);
      operation.current = crypto.randomUUID();
    } catch {
      setError(
        "Не удалось сохранить файл на устройстве. Попробуйте прикрепить его ещё раз.",
      );
    } finally {
      attachmentWork.current = false;
      setBusy(false);
    }
  }
  function validate() {
    if (!post.body.trim()) return "Вставьте текст сообщения.";
    if (post.body.length > 250000)
      return "Сообщение слишком длинное. Разделите его на несколько публикаций.";
    if (
      post.dates.some(
        (d) =>
          !Number.isFinite(Date.parse(d.start)) ||
          (d.end && Date.parse(d.end) <= Date.parse(d.start)) ||
          (d.recurrence?.until && d.recurrence.until < dayKey(d.start)),
      )
    )
      return "Проверьте даты: окончание должно быть позже начала.";
    return "";
  }
  async function finish(result: any, id: string) {
    completed.current = true;
    await queue.current;
    clearDraft(identity.id);
    await removeDraftFiles(files, identity.id);
    onSaved(result);
    setDone(result.snapshot.posts.find((p: Post) => p.id === id));
    window.scrollTo({ top: 0 });
  }
  async function publish(resolveAgainst?: Post | null) {
    if (sending.current) return;
    const invalid = validate();
    if (invalid) {
      setError(invalid);
      return;
    }
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      await queue.current;
      if (!writer) throw { kind: "unavailable" };
      const result = await writer.savePost({
        post: {
          ...post,
          title:
            post.title.trim() || post.body.trim().split("\n")[0].slice(0, 150),
        },
        basePost,
        files,
        operationId: operation.current,
        resolveAgainst,
      });
      await finish(result, post.id);
    } catch (e: any) {
      if (e.name === "PostConflict") setConflict(e);
      setError(humanError(e, saved));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  function updateExisting() {
    if (!match) return;
    try {
      const nextPost = prepareDuplicateUpdate(post, match, {
        id: crypto.randomUUID(),
        at: moscowStamp(),
        by: identity.label,
        mode: "append",
      });
      setIncomingPost(post);
      setSeriesFocus(
        match.kind === "series"
          ? { date_id: match.date_id, occurrence_date: match.occurrence_date }
          : null,
      );
      setBasePost(structuredClone(match.post));
      setPost(nextPost);
      setKeepNew(true);
      setRemindTarget(null);
      operation.current = crypto.randomUUID();
      setWarnings([
        match.kind === "series"
          ? `Обновляете только ${shortDay(match.occurrence_date + "T12:00:00+03:00")}. Другие даты серии сохранятся. Проверьте карточку перед отправкой.`
          : "Обновляете существующую публикацию. Проверьте текст, даты и ссылки перед отправкой.",
      ]);
      setError("");
      requestAnimationFrame(() => window.scrollTo({ top: 0 }));
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function restore() {
    try {
      const restored = await restoreDraftFiles(
        cached.files,
        identity.id,
        dataKey,
        epoch,
      );
      setFiles(restored as Upload[]);
    } catch (e: any) {
      setWarnings([e.message]);
      setFiles([]);
    }
    setPost(cached.post);
    setBasePost(cached.basePost ?? null);
    setFragments(cached.fragments);
    setStep(cached.step ?? 1);
    operation.current = cached.operationId ?? crypto.randomUUID();
    setKeepNew(cached.keepNew ?? Boolean(cached.basePost));
    setSeriesFocus(cached.seriesFocus ?? null);
    setIncomingPost(cached.incomingPost ?? null);
    setCached(null);
    setReady(true);
  }
  if (cached)
    return (
      <section className="manager-focus">
        <h1>У вас есть неопубликованный текст — продолжить?</h1>
        <p>{cached.post.title || cached.fragments.join(" ").slice(0, 180)}</p>
        <button className="primary" onClick={restore}>
          Продолжить
        </button>
        <button
          onClick={async () => {
            await removeDraftFiles(cached.files ?? [], identity.id);
            clearDraft(identity.id);
            setCached(null);
            setReady(true);
          }}
        >
          Начать заново
        </button>
      </section>
    );
  if (!ready) return <p role="status">Открываем ваш текст…</p>;
  if (remindTarget)
    return (
      <ReminderPanel
        key={remindTarget.id}
        post={remindTarget}
        incoming={post}
        identity={identity}
        writer={writer}
        onSaved={onSaved}
        onBack={() => setRemindTarget(null)}
        beforeSend={async () => {
          const ok = await queue.current;
          if (!ok) throw { kind: "draft" };
        }}
      />
    );
  if (done)
    return (
      <section className="manager-focus manager-done">
        <div className="manager-check" aria-hidden="true">
          ✓
        </div>
        <h1>Готово!</h1>
        <p>Публикацию видят все участники</p>
        <button
          className="primary"
          onClick={async () => {
            const text = announcement(done, location.href.split("#")[0]);
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
            } catch {
              setCopyText(text);
            }
          }}
        >
          Скопировать сообщение для MAX
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
        <a className="secondary" href="#/feed">
          На главную
        </a>
      </section>
    );
  return (
    <section className="manager-editor">
      <a className="manager-back" href="#/feed">
        ← На главную
      </a>
      <p className="manager-step">Шаг {step} из 3</p>
      <h1>
        {step === 1
          ? "Вставьте текст"
          : step === 2
            ? "Проверьте"
            : "Опубликуйте"}
      </h1>
      {error && (
        <div className="error" role="alert">
          <p>{error}</p>
          {step === 3 && !conflict && (
            <button disabled={busy} onClick={() => publish()}>
              Повторить
            </button>
          )}
        </div>
      )}
      {!saved && (
        <p className="notice">
          Текст пока не сохранился на устройстве. Не закрывайте эту вкладку.
        </p>
      )}
      <fieldset disabled={busy} aria-busy={busy} className="manager-fields">
        {step === 1 && (
          <>
            <button
              className="secondary wide"
              onClick={async () => {
                try {
                  const text = await navigator.clipboard.readText();
                  setFragments((v) =>
                    v.map((s, i) => (i === v.length - 1 ? text : s)),
                  );
                } catch {
                  setError(
                    "Нажмите и удерживайте поле текста, затем выберите «Вставить».",
                  );
                }
              }}
            >
              Вставить из буфера
            </button>
            {fragments.map((value, i) => (
              <label key={i}>
                Текст сообщения {fragments.length > 1 ? i + 1 : ""}
                <textarea
                  aria-label={`Текст сообщения ${i + 1}`}
                  rows={i === 0 ? 8 : 5}
                  placeholder="Вставьте сюда сообщение из MAX"
                  value={value}
                  onChange={(e) => {
                    setFragments((p) =>
                      p.map((v, n) => (n === i ? e.target.value : v)),
                    );
                    operation.current = crypto.randomUUID();
                  }}
                />
              </label>
            ))}
            <button onClick={() => setFragments((p) => [...p, ""])}>
              + Добавить ещё текст
            </button>
            <label className="manager-file-button">
              📎 Прикрепить файл
              <input
                aria-label="Прикрепить файл"
                type="file"
                multiple
                onChange={(e) => {
                  void addFiles(Array.from(e.target.files ?? []));
                  e.target.value = "";
                }}
              />
            </label>
            {files.map((f) => (
              <p key={f.id}>
                📎 {f.name}{" "}
                <button
                  onClick={() => {
                    setFiles((p) => p.filter((v) => v.id !== f.id));
                    void removeDraftFiles([f], identity.id);
                  }}
                >
                  Убрать файл
                </button>
              </p>
            ))}
            <p className="manager-hint">
              Заголовок, категория и даты заполнятся сами.
            </p>
            <div className="manager-bottom">
              <button
                className="primary"
                disabled={!fragments.some((v) => v.trim())}
                onClick={analyse}
              >
                Проверить
              </button>
            </div>
          </>
        )}
        {step === 2 && (
          <>
            {match && (
              <section
                className="notice manager-duplicate"
                aria-label="Проверка похожей публикации"
              >
                <h2>
                  {match.kind === "series"
                    ? "Найдено собрание в расписании"
                    : "Есть похожая публикация. Что сделать?"}
                </h2>
                <div className="manager-compare">
                  {[
                    {
                      label: "Уже опубликовано",
                      value:
                        match.kind === "series"
                          ? seriesPreview(match.post, match)
                          : match.post,
                    },
                    { label: "Ваше сообщение", value: post },
                  ].map(({ label, value }) => (
                    <article className="manager-card" key={label}>
                      <h3>{label}</h3>
                      <p>
                        <strong>{value.title}</strong>
                      </p>
                      {value.dates.length ? (
                        value.dates.map((date: DateEntry) => (
                          <p key={date.id}>
                            {date.label ||
                              (date.kind === "deadline" ? "Срок" : "Событие")}
                            : {fullDate(date)}
                            {date.recurrence ? " · каждую неделю" : ""}
                          </p>
                        ))
                      ) : (
                        <p>Дата не указана</p>
                      )}
                      {value.links.map((link: any) => (
                        <p className="manager-compare-link" key={link.url}>
                          <a
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {link.label || link.url}
                          </a>
                        </p>
                      ))}
                    </article>
                  ))}
                </div>
                {match.kind === "series" ? (
                  <>
                    <p>Ссылка будет относиться только к выбранной дате.</p>
                    <button onClick={updateExisting}>
                      {seriesHasLink ? "Добавить ссылку к" : "Обновить"}{" "}
                      {match.post.dates.find(
                        (d: DateEntry) => d.id === match.date_id,
                      )?.kind === "event"
                        ? seriesHasLink
                          ? "собранию"
                          : "собрание"
                        : seriesHasLink
                          ? "напоминанию"
                          : "напоминание"}{" "}
                      {shortDay(match.occurrence_date + "T12:00:00+03:00")}
                    </button>
                    <button
                      onClick={() => {
                        setKeepNew(true);
                        setRemindTarget(null);
                      }}
                    >
                      Это новое
                    </button>
                  </>
                ) : (
                  <>
                    {needsUpdate && (
                      <p>
                        В вашем сообщении есть новая ссылка, дата или файл.
                        Выберите «Дописать в старую», чтобы сохранить
                        дополнения.
                      </p>
                    )}
                    <button
                      disabled={!canRemind(match.post)}
                      onClick={() => setRemindTarget(match.post)}
                    >
                      Напомнить о старой
                    </button>
                    <button onClick={updateExisting}>Дописать в старую</button>
                    <button
                      onClick={() => {
                        setKeepNew(true);
                        setRemindTarget(null);
                      }}
                    >
                      Опубликовать как новую
                    </button>
                  </>
                )}
              </section>
            )}
            {warnings.map((w, i) => (
              <p className="notice" key={i}>
                {w}
              </p>
            ))}
            <ManagerPreview
              post={seriesPreview(post, seriesFocus)}
              categories={categories}
            />
            {files.map((f) => (
              <p key={f.id}>📎 {f.name}</p>
            ))}
            {seriesFocus && (
              <section className="manager-card">
                <h2>Новое сообщение для этой даты</h2>
                <p className="manager-body">{incomingPost?.body}</p>
                <p>
                  Текст сохранится в истории. Ссылка и время изменятся только у
                  выбранной встречи.
                </p>
                <button
                  onClick={() => {
                    if (incomingPost) setPost(incomingPost);
                    setBasePost(null);
                    setSeriesFocus(null);
                    setIncomingPost(null);
                    setKeepNew(false);
                    setWarnings([]);
                    next(1);
                  }}
                >
                  Изменить новое сообщение
                </button>
              </section>
            )}
            {!seriesFocus && (
              <>
                <div className="manager-edit-row">
                  <strong>
                    Категория:{" "}
                    {categories.find((c) => c.id === post.category_id)?.name}
                  </strong>
                  <button
                    onClick={() =>
                      setField(field === "category" ? "" : "category")
                    }
                  >
                    Изменить категорию
                  </button>
                </div>
                {field === "category" && (
                  <section className="manager-card">
                    <label>
                      Раздел
                      <select
                        value={post.type ?? "post"}
                        onChange={(e) =>
                          patch({
                            type: e.target.value as "post" | "reference",
                            category_id:
                              e.target.value === "reference"
                                ? REFERENCE_CATEGORIES[0].id
                                : "company",
                          })
                        }
                      >
                        <option value="post">Рабочие сообщения</option>
                        <option value="reference">Справочник</option>
                      </select>
                    </label>
                    <label>
                      Категория
                      <select
                        value={post.category_id}
                        onChange={(e) => patch({ category_id: e.target.value })}
                      >
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button onClick={() => setField("")}>Готово</button>
                  </section>
                )}
                <div className="manager-edit-row">
                  <strong>Заголовок</strong>
                  <button
                    onClick={() => setField(field === "title" ? "" : "title")}
                  >
                    Изменить заголовок
                  </button>
                </div>
                {field === "title" && (
                  <label>
                    Заголовок
                    <input
                      maxLength={180}
                      value={post.title}
                      onChange={(e) => patch({ title: e.target.value })}
                    />
                    <button onClick={() => setField("")}>Готово</button>
                  </label>
                )}
                <div className="manager-edit-row">
                  <strong>
                    {post.dates.length ? "Даты" : "Дат в тексте нет"}
                  </strong>
                  <button
                    onClick={() => setField(field === "dates" ? "" : "dates")}
                  >
                    Изменить даты
                  </button>
                </div>
                {field === "dates" && (
                  <section className="manager-card">
                    <p>
                      Событие — когда проходит встреча. Срок — до какого дня и
                      времени нужно подать заявку, оплатить или отправить отчёт.
                      Все даты и время — московские.
                    </p>
                    {post.dates.map((d, i) => {
                      const change = (p: Partial<DateEntry>) =>
                        patch({
                          dates: post.dates.map((v, n) =>
                            n === i ? { ...v, ...p } : v,
                          ),
                        });
                      return (
                        <div className="manager-date-edit" key={d.id}>
                          <label>
                            Что означает дата
                            <select
                              value={d.kind}
                              onChange={(e) =>
                                change({
                                  kind: e.target.value as "event" | "deadline",
                                })
                              }
                            >
                              <option value="event">Событие</option>
                              <option value="deadline">Срок</option>
                            </select>
                          </label>
                          <label>
                            Подпись даты
                            <input
                              value={d.label ?? ""}
                              placeholder={
                                d.kind === "event" ? "Событие" : "Срок"
                              }
                              onChange={(e) =>
                                change({ label: e.target.value })
                              }
                            />
                          </label>
                          <label>
                            Дата
                            <input
                              type="date"
                              value={d.start.slice(0, 10)}
                              onChange={(e) =>
                                change({
                                  start: e.target.value
                                    ? e.target.value +
                                      "T" +
                                      (d.start.match(/T(.+)$/)?.[1] ||
                                        "00:00:00+03:00")
                                    : "",
                                })
                              }
                            />
                          </label>
                          <label>
                            {d.kind === "event"
                              ? "Время начала"
                              : "Последнее время"}
                            <input
                              type="time"
                              disabled={d.allDay || d.time_unspecified}
                              value={d.start.slice(11, 16)}
                              onChange={(e) =>
                                change({
                                  start:
                                    d.start.slice(0, 11) +
                                    e.target.value +
                                    ":00+03:00",
                                })
                              }
                            />
                          </label>
                          <label className="checkbox">
                            <input
                              type="checkbox"
                              checked={Boolean(
                                d.kind === "deadline"
                                  ? d.allDay
                                  : d.time_unspecified,
                              )}
                              onChange={(e) =>
                                change(
                                  d.kind === "deadline"
                                    ? { allDay: e.target.checked }
                                    : { time_unspecified: e.target.checked },
                                )
                              }
                            />
                            {d.kind === "deadline"
                              ? "До конца дня"
                              : "Время уточняется"}
                          </label>
                          <label>
                            Окончание (если известно)
                            <input
                              type="datetime-local"
                              value={d.end?.slice(0, 16) ?? ""}
                              onChange={(e) =>
                                change({
                                  end: e.target.value
                                    ? e.target.value + ":00+03:00"
                                    : undefined,
                                })
                              }
                            />
                          </label>
                          <label className="checkbox">
                            <input
                              type="checkbox"
                              checked={Boolean(d.recurrence)}
                              onChange={(e) =>
                                change({
                                  recurrence: e.target.checked
                                    ? {
                                        frequency: "weekly",
                                        weekdays: [
                                          new Date(
                                            d.start.slice(0, 10) + "T12:00:00Z",
                                          ).getUTCDay() || 7,
                                        ],
                                      }
                                    : undefined,
                                })
                              }
                            />
                            Повторяется каждую неделю
                          </label>
                          {d.recurrence && (
                            <label>
                              Последняя неделя (если известна)
                              <input
                                type="date"
                                value={d.recurrence.until ?? ""}
                                onChange={(e) =>
                                  change({
                                    recurrence: {
                                      ...d.recurrence!,
                                      until: e.target.value || undefined,
                                    },
                                  })
                                }
                              />
                            </label>
                          )}
                          <button
                            onClick={() =>
                              patch({
                                dates: post.dates.filter((_, n) => n !== i),
                              })
                            }
                          >
                            Убрать дату
                          </button>
                        </div>
                      );
                    })}
                    <button
                      onClick={() =>
                        patch({
                          dates: [
                            ...post.dates,
                            {
                              id: crypto.randomUUID(),
                              kind: "event",
                              start: dayKey(new Date()) + "T00:00:00+03:00",
                              time_unspecified: true,
                            },
                          ],
                        })
                      }
                    >
                      + Добавить дату
                    </button>
                    <button
                      onClick={() => {
                        const invalid = validate();
                        if (invalid) setError(invalid);
                        else setField("");
                      }}
                    >
                      Готово
                    </button>
                  </section>
                )}
                <div className="manager-edit-row">
                  <strong>Размещение</strong>
                  <button
                    onClick={() =>
                      setField(field === "placement" ? "" : "placement")
                    }
                  >
                    Изменить размещение
                  </button>
                </div>
                {field === "placement" && (
                  <section className="manager-card">
                    <label>
                      Состояние
                      <select
                        value={post.state}
                        onChange={(e) =>
                          patch({
                            state: e.target.value,
                            closed_at:
                              e.target.value === "closed"
                                ? moscowStamp()
                                : undefined,
                          })
                        }
                      >
                        <option value="active">Актуально</option>
                        <option value="closed">Завершено досрочно</option>
                        <option value="cancelled">Отменено</option>
                        <option value="postponed">
                          Перенесено — дата уточняется
                        </option>
                      </select>
                    </label>
                    <label>
                      Важность
                      <select
                        value={post.priority}
                        onChange={(e) => patch({ priority: e.target.value })}
                      >
                        <option value="normal">Обычная</option>
                        <option value="important">Важно</option>
                        <option value="urgent">Срочно</option>
                      </select>
                    </label>
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={post.pinned}
                        onChange={(e) => patch({ pinned: e.target.checked })}
                      />
                      Закрепить в ленте
                    </label>
                    <button onClick={() => setField("")}>Готово</button>
                  </section>
                )}
                <div className="manager-edit-row">
                  <strong>Текст и файлы</strong>
                  <button onClick={() => next(1)}>
                    Изменить текст и файлы
                  </button>
                </div>
              </>
            )}
            {!match && (
              <div className="manager-bottom">
                {field && (
                  <p
                    id="manager-field-hint"
                    className="manager-edit-hint"
                    role="status"
                  >
                    {field === "dates"
                      ? "Нажмите «Готово» в блоке дат, чтобы продолжить."
                      : "Нажмите «Готово» в открытом блоке, чтобы продолжить."}
                  </p>
                )}
                <button
                  className="primary"
                  aria-describedby={field ? "manager-field-hint" : undefined}
                  disabled={Boolean(field)}
                  onClick={() => {
                    const invalid = validate();
                    if (invalid) setError(invalid);
                    else next(3);
                  }}
                >
                  Всё верно
                </button>
              </div>
            )}
          </>
        )}
        {step === 3 && (
          <>
            <p>Остался один шаг. Сообщение появится у всех участников.</p>
            <ManagerPreview
              post={seriesPreview(post, seriesFocus)}
              categories={categories}
            />
            <button onClick={() => next(2)}>Вернуться к проверке</button>
            <div className="manager-bottom">
              <button className="primary" onClick={() => publish()}>
                {busy ? "Публикуем…" : "Опубликовать"}
              </button>
            </div>
          </>
        )}
      </fieldset>
      {conflict && (
        <section className="notice">
          <h2>Публикацию уже успели изменить</h2>
          <h3>Сейчас опубликовано</h3>
          <p>{conflict.remote?.body ?? "Публикация удалена"}</p>
          <h3>Ваш текст</h3>
          <p>{post.body}</p>
          <button
            disabled={busy}
            onClick={() => {
              const remote = conflict.remote;
              setConflict(null);
              void publish(remote);
            }}
          >
            Оставить мой текст
          </button>
          <button
            disabled={busy}
            onClick={() => {
              if (conflict.remote) {
                setPost(conflict.remote);
                setBasePost(conflict.remote);
                setFragments([conflict.remote.body]);
              }
              setConflict(null);
              next(2);
            }}
          >
            Открыть последний текст
          </button>
        </section>
      )}
      <p className="manager-hint" role="status">
        {busy
          ? "Публикуем…"
          : saved
            ? "Текст сохраняется автоматически"
            : "Не закрывайте эту вкладку"}
      </p>
    </section>
  );
}
