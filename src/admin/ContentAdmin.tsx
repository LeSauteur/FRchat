import React, { useEffect, useRef, useState } from "react";
import type { Identity, Post, Snapshot } from "../types";
import {
  SETTINGS_ID,
  contentPost,
  documentCategories,
  documents,
  validateDocument,
  validateWorkspace,
  workspaceSettings,
} from "../lib/workspace.mjs";
import { moscowStamp, MAX_FILE_BYTES } from "../lib/writer.mjs";
import { dayKey } from "../lib/dates.mjs";
import { humanError } from "../lib/manager.mjs";
import { clearDraft, loadDraft, saveDraft } from "../lib/admin-session.mjs";
import {
  persistDraftFile,
  restoreDraftFiles,
  removeDraftFiles,
} from "../lib/draft-files.mjs";
type Props = {
  snapshot: Snapshot;
  identity: Identity;
  dataKey: CryptoKey;
  epoch: string;
  writer: any;
  onSaved: (result: any) => void;
  initialPost?: Post;
};
export default function ContentAdmin({
  snapshot,
  identity,
  dataKey,
  epoch,
  writer,
  onSaved,
  initialPost,
}: Props) {
  const [tab, setTab] = useState("documents"),
    [post, setPost] = useState<Post | null>(null),
    [basePost, setBasePost] = useState<Post | null>(null),
    [uploads, setUploads] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>(() =>
    workspaceSettings(snapshot),
  );
  const [settingsBase, setSettingsBase] = useState<Post | null>(
    () => snapshot.posts.find((p) => p.id === SETTINGS_ID) ?? null,
  );
  const [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [ready, setReady] = useState(false),
    [cached, setCached] = useState<any>(null),
    [draftSaved, setDraftSaved] = useState(true),
    [confirmDelete, setConfirmDelete] = useState(false);
  const [reviewVersion, setReviewVersion] = useState<{
    remote: Post | null;
    local: Post;
    remove: boolean;
  } | null>(null);
  const scope = { ...identity, id: identity.id + ".content" },
    queue = useRef<Promise<any>>(Promise.resolve()),
    sending = useRef(false),
    operation = useRef(crypto.randomUUID());
  const categories = documentCategories(snapshot);
  useEffect(() => {
    let stopped = false;
    loadDraft(scope, dataKey, epoch).then((value) => {
      if (!stopped) {
        setCached(value);
        if (!value && initialPost) edit(initialPost);
        setReady(true);
      }
    });
    return () => {
      stopped = true;
    };
  }, []);
  useEffect(() => {
    if (!ready || cached || (!post && !dirty)) return;
    const draft = {
      tab,
      post,
      basePost,
      settings,
      settingsBase,
      uploads: uploads.map(({ bytes, ...file }) => file),
      operation: operation.current,
    };
    queue.current = queue.current
      .then(() => saveDraft(draft, scope, dataKey, epoch))
      .then((ok) => {
        setDraftSaved(Boolean(ok));
        return ok;
      })
      .catch(() => {
        setDraftSaved(false);
        return false;
      });
  }, [tab, post, basePost, settings, dirty, uploads, ready, cached]);
  function patch(value: Partial<Post>) {
    setPost((p) => (p ? { ...p, ...value } : p));
    setDirty(true);
    setError("");
    setReviewVersion(null);
    setNotice("");
  }
  function meta(value: any) {
    if (post) patch({ document: { ...post.document!, ...value } });
  }
  async function discard() {
    await queue.current;
    clearDraft(scope.id);
    await removeDraftFiles(uploads, scope.id);
    setPost(null);
    setUploads([]);
    setCached(null);
    setDirty(false);
    setConfirmDelete(false);
    setError("");
    setReviewVersion(null);
    setSettings(workspaceSettings(snapshot));
    setSettingsBase(snapshot.posts.find((p) => p.id === SETTINGS_ID) ?? null);
    operation.current = crypto.randomUUID();
  }
  function edit(existing?: Post) {
    setBasePost(existing ?? null);
    setPost(
      existing
        ? {
            ...structuredClone(existing),
            document: existing.document ?? {
              description: existing.body.slice(0, 160),
              reviewed_on: dayKey(new Date()),
              owner: existing.source,
              version: "1",
              status: "current",
            },
          }
        : {
            ...contentPost(identity, crypto.randomUUID(), moscowStamp()),
            category_id:
              categories.find((c) => !c.archived)?.id ?? categories[0].id,
            document: {
              description: "",
              reviewed_on: dayKey(new Date()),
              owner: identity.label,
              version: "1",
              status: "current",
            },
          },
    );
    setUploads([]);
    setDirty(true);
    setError("");
    operation.current = crypto.randomUUID();
  }
  async function restore() {
    try {
      const files = await restoreDraftFiles(
        cached.uploads,
        scope.id,
        dataKey,
        epoch,
      );
      setTab(cached.tab);
      setPost(cached.post);
      setBasePost(cached.basePost);
      setSettings(cached.settings);
      setSettingsBase(cached.settingsBase);
      setUploads(files);
      operation.current = cached.operation ?? crypto.randomUUID();
      setDirty(true);
      setCached(null);
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function attach(input: HTMLInputElement) {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError("");
    const added: any[] = [];
    try {
      for (const file of [...(input.files ?? [])]) {
        if (
          file.size > MAX_FILE_BYTES ||
          [...uploads, ...added].reduce((n, f) => n + f.size, 0) + file.size >
            50 * 1024 * 1024
        )
          throw new Error("Один файл — до 25 МБ, вместе — до 50 МБ.");
        const f = {
          id: crypto.randomUUID(),
          name: file.name,
          mime: file.type || "application/octet-stream",
          size: file.size,
          bytes: new Uint8Array(await file.arrayBuffer()),
        };
        await persistDraftFile(f, scope.id, dataKey, epoch);
        added.push(f);
      }
      setUploads((prev) => [...prev, ...added]);
      setDirty(true);
    } catch (e: any) {
      await removeDraftFiles(added, scope.id);
      setError(e.message);
    } finally {
      input.value = "";
      sending.current = false;
      setBusy(false);
    }
  }
  async function save(
    deleted = false,
    resolveAgainst: Post | null | undefined = undefined,
  ) {
    if (sending.current) return;
    setError("");
    let candidate: Post;
    try {
      if (post) {
        if (!post.title.trim() || !post.body.trim())
          throw new Error("Укажите название и текст материала.");
        validateDocument(post.document);
        candidate = {
          ...post,
          state: deleted ? "deleted" : "active",
          title: post.title.trim(),
        };
      } else {
        validateWorkspace(settings);
        candidate = {
          ...(settingsBase ??
            contentPost(identity, SETTINGS_ID, moscowStamp())),
          title: "Настройки разделов",
          body: "Категории документов и каталог инструментов.",
          workspace: structuredClone(settings),
        };
      }
    } catch (e: any) {
      setError(e.message);
      return;
    }
    sending.current = true;
    setBusy(true);
    try {
      const saved = await queue.current;
      if (!saved) throw { kind: "draft" };
      if (!writer) throw { kind: "unavailable" };
      const result = await writer.savePost({
        post: candidate,
        basePost: post ? basePost : settingsBase,
        files: uploads,
        operationId: operation.current,
        resolveAgainst,
      });
      await queue.current;
      clearDraft(scope.id);
      await removeDraftFiles(uploads, scope.id);
      setPost(null);
      setBasePost(null);
      setUploads([]);
      setDirty(false);
      setConfirmDelete(false);
      setReviewVersion(null);
      operation.current = crypto.randomUUID();
      setSettings(workspaceSettings(result.snapshot));
      setSettingsBase(
        result.snapshot.posts.find((p: Post) => p.id === SETTINGS_ID) ?? null,
      );
      onSaved(result);
      setNotice(
        deleted
          ? "Материал убран из каталога. Его можно вернуть из удалённых публикаций."
          : post
            ? "Материал сохранён. Участники видят его в документах."
            : "Категории и инструменты сохранены.",
      );
    } catch (e: any) {
      if (e?.name === "PostConflict")
        setReviewVersion({
          remote: e.remote,
          local: candidate!,
          remove: deleted,
        });
      setError(
        e?.name === "PostConflict"
          ? "На другом устройстве уже сохранили изменения. Ваш вариант сохранён здесь. Сравните и выберите, что оставить."
          : humanError(e, draftSaved),
      );
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  function updateCategory(index: number, value: any) {
    setSettings((s: any) => ({
      ...s,
      document_categories: s.document_categories.map((c: any, i: number) =>
        i === index ? { ...c, ...value } : c,
      ),
    }));
    setDirty(true);
    setNotice("");
  }
  function updateTool(index: number, value: any) {
    setSettings((s: any) => ({
      ...s,
      tools: s.tools.map((t: any, i: number) =>
        i === index ? { ...t, ...value } : t,
      ),
    }));
    setDirty(true);
    setNotice("");
  }
  if (!ready) return <p>Открываем материалы…</p>;
  return (
    <section className="content-admin">
      <a className="manager-back" href="#/feed">
        ← Ваши публикации
      </a>
      <header className="catalog-heading">
        <p>УПРАВЛЕНИЕ СОДЕРЖИМЫМ</p>
        <h1>{post ? "Материал базы знаний" : "Документы и инструменты"}</h1>
        <p>Материалы, категории и полезные сервисы для участников.</p>
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {reviewVersion && (
        <section className="manager-card">
          <h2>Какой вариант оставить?</h2>
          <div className="content-fields-grid">
            <div>
              <h3>Ваш вариант</h3>
              <p>{reviewVersion.local.title}</p>
              <VersionContents post={reviewVersion.local} />
            </div>
            <div>
              <h3>Уже сохранено</h3>
              <p>{reviewVersion.remote?.title || "Материал убран"}</p>
              {reviewVersion.remote && (
                <VersionContents post={reviewVersion.remote} />
              )}
            </div>
          </div>
          <button
            disabled={busy}
            onClick={() =>
              void save(reviewVersion.remove, reviewVersion.remote)
            }
          >
            Оставить мои изменения
          </button>
          <button
            disabled={busy}
            onClick={() => {
              const remote = reviewVersion.remote;
              if (post) {
                if (!remote) {
                  setNotice(
                    "Материал убран на другом устройстве. Ваш текст сохранён; его можно сохранить как новый материал.",
                  );
                  setPost({
                    ...post,
                    id: crypto.randomUUID(),
                    created_at: moscowStamp(),
                  });
                } else setPost(structuredClone(remote));
                setBasePost(remote);
              } else {
                setSettings(
                  remote?.workspace ?? workspaceSettings({ posts: [] }),
                );
                setSettingsBase(remote);
              }
              setReviewVersion(null);
              setError("");
              setDirty(true);
            }}
          >
            Загрузить сохранённый вариант
          </button>
        </section>
      )}
      {cached ? (
        <section className="manager-card">
          <h2>У вас есть несохранённые изменения</h2>
          <p>Продолжить работу над материалами?</p>
          <button className="primary" onClick={restore}>
            Продолжить
          </button>
          <button onClick={discard}>Начать заново</button>
        </section>
      ) : post ? (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <fieldset
              disabled={busy || Boolean(reviewVersion)}
              className="content-fieldset"
            >
              <label>
                Название
                <input
                  required
                  maxLength={180}
                  value={post.title}
                  onChange={(e) => patch({ title: e.target.value })}
                />
              </label>
              <label>
                Категория
                <select
                  value={post.category_id}
                  onChange={(e) => patch({ category_id: e.target.value })}
                >
                  {categories
                    .filter((c) => !c.archived || c.id === post.category_id)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Краткое описание
                <textarea
                  required
                  rows={2}
                  maxLength={2000}
                  value={post.document!.description}
                  onChange={(e) => meta({ description: e.target.value })}
                />
              </label>
              <div className="content-fields-grid">
                <label>
                  Актуален на
                  <input
                    required
                    type="date"
                    value={post.document!.reviewed_on}
                    onChange={(e) => meta({ reviewed_on: e.target.value })}
                  />
                </label>
                <label>
                  Ответственный
                  <input
                    required
                    maxLength={160}
                    value={post.document!.owner}
                    onChange={(e) => meta({ owner: e.target.value })}
                  />
                </label>
                <label>
                  Версия
                  <input
                    maxLength={80}
                    value={post.document!.version}
                    onChange={(e) => meta({ version: e.target.value })}
                  />
                </label>
                <label>
                  Актуальность
                  <select
                    value={post.document!.status}
                    onChange={(e) => meta({ status: e.target.value })}
                  >
                    <option value="current">Действующий материал</option>
                    <option value="outdated">Требует обновления</option>
                  </select>
                </label>
              </div>
              <label>
                Текст и инструкция
                <textarea
                  required
                  rows={9}
                  value={post.body}
                  onChange={(e) => patch({ body: e.target.value })}
                />
              </label>
              <section className="manager-card">
                <h2>Вложения</h2>
                <p>
                  PDF и изображения можно просматривать с телефона. К таблице
                  или бланку добавьте инструкцию в тексте.
                </p>
                <label className="upload-label">
                  Выбрать файлы
                  <input
                    type="file"
                    multiple
                    onChange={(e) => void attach(e.currentTarget)}
                  />
                </label>
                {uploads.map((f) => (
                  <div className="content-file" key={f.id}>
                    <span>{f.name}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setUploads((files) =>
                          files.filter((item) => item.id !== f.id),
                        )
                      }
                    >
                      Убрать файл
                    </button>
                  </div>
                ))}
                {post.attachments
                  .filter((f) => !f.superseded_at)
                  .map((f) => (
                    <div className="content-file" key={f.id}>
                      <span>{f.name}</span>
                      <button
                        type="button"
                        onClick={() =>
                          patch({
                            attachments: post.attachments.map((item) =>
                              item.id === f.id
                                ? {
                                    ...item,
                                    superseded_at: moscowStamp(),
                                    version_label:
                                      basePost?.document?.version ||
                                      post.document?.version ||
                                      "Прежняя",
                                  }
                                : item,
                            ),
                          })
                        }
                      >
                        В прежние версии
                      </button>
                    </div>
                  ))}
                {post.attachments.some((f) => f.superseded_at) && (
                  <div>
                    <p>
                      Прежние файлы сохранятся в истории материала. Для замены
                      прикрепите новый файл.
                    </p>
                    {post.attachments
                      .filter((f) => f.superseded_at)
                      .map((f) => (
                        <div className="content-file" key={f.id}>
                          <span>{f.name} · прежняя версия</span>
                          <button
                            type="button"
                            onClick={() =>
                              patch({
                                attachments: post.attachments.map((item) =>
                                  item.id === f.id
                                    ? {
                                        ...item,
                                        superseded_at: undefined,
                                        version_label: undefined,
                                      }
                                    : item,
                                ),
                              })
                            }
                          >
                            Вернуть в действующие
                          </button>
                        </div>
                      ))}
                  </div>
                )}
              </section>
              <button type="submit" className="primary">
                {busy
                  ? "Сохраняем…"
                  : error
                    ? "Повторить сохранение"
                    : "Сохранить материал"}
              </button>
              <button type="button" onClick={() => setConfirmDelete(true)}>
                Отменить изменения
              </button>
              {basePost && (
                <button
                  type="button"
                  className="manager-delete"
                  onClick={() => setConfirmDelete(true)}
                >
                  Убрать из каталога
                </button>
              )}
            </fieldset>
          </form>
          {confirmDelete && (
            <section className="manager-card">
              <h2>Что сделать с материалом?</h2>
              <p>
                Изменения на устройстве можно отменить. Убранный материал можно
                вернуть из удалённых публикаций.
              </p>
              <button disabled={busy} onClick={discard}>
                Отменить изменения
              </button>
              {basePost && (
                <button disabled={busy} onClick={() => void save(true)}>
                  Да, убрать из каталога
                </button>
              )}
              <button disabled={busy} onClick={() => setConfirmDelete(false)}>
                Продолжить редактирование
              </button>
            </section>
          )}
        </>
      ) : (
        <>
          <nav
            className="workspace-subnav"
            aria-label="Содержимое пространства"
          >
            {[
              ["documents", "Документы"],
              ["categories", "Категории"],
              ["tools", "Инструменты"],
            ].map(([id, label]) => (
              <button
                disabled={busy}
                key={id}
                aria-pressed={tab === id}
                onClick={() => {
                  setTab(id);
                  setError("");
                }}
              >
                {label}
              </button>
            ))}
          </nav>
          <fieldset
            disabled={busy || Boolean(reviewVersion)}
            className="content-fieldset"
          >
            {tab === "documents" ? (
              <>
                <button
                  className="primary"
                  disabled={dirty}
                  onClick={() => edit()}
                >
                  + Добавить документ
                </button>
                {dirty && (
                  <p className="notice">
                    Сначала сохраните изменения категорий и инструментов.
                  </p>
                )}
                {documents(snapshot).map((p) => (
                  <article className="manager-card" key={p.id}>
                    <h2>{p.title}</h2>
                    <p>
                      {categories.find((c) => c.id === p.category_id)?.name} ·{" "}
                      {p.document?.owner || "Ответственный не указан"}
                    </p>
                    <button disabled={dirty} onClick={() => edit(p)}>
                      Изменить материал
                    </button>
                    <a
                      className="secondary"
                      href={`#/post/${encodeURIComponent(p.id)}`}
                    >
                      Открыть
                    </a>
                  </article>
                ))}
                {!documents(snapshot).length && (
                  <section className="manager-card">
                    <h2>База знаний пока пуста</h2>
                    <p>
                      Добавьте инструкцию, регламент или шаблон. Участники
                      увидят материал в разделе «Документы».
                    </p>
                  </section>
                )}
              </>
            ) : tab === "categories" ? (
              <>
                <p>
                  Категории можно переименовать и добавить. Скрытая категория
                  остаётся у уже размещённых материалов.
                </p>
                {settings.document_categories.map((c: any, i: number) => (
                  <div className="manager-card" key={c.id}>
                    <label>
                      Название категории
                      <input
                        maxLength={100}
                        value={c.name}
                        onChange={(e) =>
                          updateCategory(i, { name: e.target.value })
                        }
                      />
                    </label>
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={!c.archived}
                        onChange={(e) =>
                          updateCategory(i, { archived: !e.target.checked })
                        }
                      />
                      Предлагать при добавлении документа
                    </label>
                  </div>
                ))}
                <button
                  onClick={() => {
                    setSettings((s: any) => ({
                      ...s,
                      document_categories: [
                        ...s.document_categories,
                        {
                          id: "document-" + crypto.randomUUID(),
                          name: "Новая категория",
                        },
                      ],
                    }));
                    setDirty(true);
                  }}
                >
                  + Добавить категорию
                </button>
              </>
            ) : (
              <>
                <p>
                  Добавляйте только проверенные адреса. Инструмент открывается
                  отдельно и сохраняет собственные правила входа.
                </p>
                {settings.tools.map((t: any, i: number) => (
                  <section className="manager-card" key={t.id}>
                    <label>
                      Название инструмента
                      <input
                        maxLength={120}
                        value={t.title}
                        onChange={(e) =>
                          updateTool(i, { title: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      Для чего нужен
                      <textarea
                        rows={2}
                        maxLength={500}
                        value={t.description}
                        onChange={(e) =>
                          updateTool(i, { description: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      Адрес сайта
                      <input
                        type="url"
                        value={t.url}
                        onChange={(e) => updateTool(i, { url: e.target.value })}
                        placeholder="https://…"
                      />
                    </label>
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={t.enabled}
                        onChange={(e) =>
                          updateTool(i, { enabled: e.target.checked })
                        }
                      />
                      Показывать участникам
                    </label>
                  </section>
                ))}
                <button
                  onClick={() => {
                    setSettings((s: any) => ({
                      ...s,
                      tools: [
                        ...s.tools,
                        {
                          id: "tool-" + crypto.randomUUID(),
                          title: "Новый инструмент",
                          description: "",
                          url: "",
                          enabled: false,
                        },
                      ],
                    }));
                    setDirty(true);
                  }}
                >
                  + Добавить инструмент
                </button>
              </>
            )}
            {dirty && (
              <div className="content-save">
                <button
                  disabled={busy}
                  className="primary"
                  onClick={() => void save()}
                >
                  {busy ? "Сохраняем…" : "Сохранить категории и инструменты"}
                </button>
                <button disabled={busy} onClick={discard}>
                  Отменить изменения
                </button>
              </div>
            )}
          </fieldset>
        </>
      )}
      {(dirty || post) && (
        <p className={draftSaved ? "muted" : "error"}>
          {draftSaved
            ? "Изменения сохраняются на этом устройстве до отправки."
            : "Не удалось сохранить изменения на устройстве. Не закрывайте страницу."}
        </p>
      )}
    </section>
  );
}
function VersionContents({ post }: { post: Post }) {
  return (
    <div>
      {post.workspace ? (
        <>
          <p>
            Категории:{" "}
            {post.workspace.document_categories
              .map((c) => c.name + (c.archived ? " (скрыта)" : ""))
              .join(", ")}
          </p>
          <p>Инструменты:</p>
          {post.workspace.tools.map((t) => (
            <p key={t.id}>
              {t.title} — {t.url} {t.enabled ? "" : "(скрыт)"}
            </p>
          ))}
        </>
      ) : (
        <>
          <p className="manager-body">{post.body}</p>
          {post.document && (
            <p>
              {post.document.description} · {post.document.owner} ·{" "}
              {post.document.reviewed_on} · версия {post.document.version}
            </p>
          )}
          <p>
            Файлы:{" "}
            {post.attachments
              .filter((f) => !f.superseded_at)
              .map((f) => f.name)
              .join(", ") || "Нет файлов"}
          </p>
        </>
      )}
    </div>
  );
}
