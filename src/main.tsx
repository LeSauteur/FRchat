import React, { useEffect, useState, useMemo } from "react";
import { createRoot } from "react-dom/client";
import type {
  Category,
  Config,
  DateEntry,
  FileEntry,
  Filters,
  Post,
  Snapshot,
  Identity,
} from "./types";
import {
  DAY,
  addDays,
  dateEnd,
  dateLabel,
  dayKey,
  dayStart,
  formatDate,
  isHot,
  occurrences,
  postStatus,
  weekday,
} from "./lib/dates.mjs";
import { filterPosts } from "./lib/filters.mjs";
import {
  loadManifest,
  loadSnapshotWithKey,
  loadObject,
  readLocal,
  unlockSnapshot,
  writeLocal,
} from "./lib/storage.mjs";
import { safeUrl } from "./lib/model.mjs";
import {
  FAVORITES_KEY,
  loadFavorites,
  saveFavorites,
} from "./lib/favorites.mjs";
import { REFERENCE_CATEGORIES, isReference } from "./lib/reference.mjs";
import { sha256 } from "./lib/crypto.mjs";
import { GitDataWriter } from "./lib/writer.mjs";
import ManagerApp from "./admin/ManagerApp";
import "./styles.css";

const CODE_KEY = "frchat.access.v1";
const LOGIN_KEY = "frchat.login.v2";
const READ_KEY = "frchat.read.v1";
const DAY_IDS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];
const DAY_NAMES = [
  "Понедельник",
  "Вторник",
  "Среда",
  "Четверг",
  "Пятница",
  "Суббота",
  "Воскресенье",
];
const initialFilters: Filters = {
  q: "",
  categories: [],
  period: "all",
  dateKind: "all",
  status: "all",
  important: false,
  files: false,
  favorites: false,
  reminders: false,
  from: "",
  to: "",
};
function currentRoute() {
  const [path, query = ""] = location.hash.slice(1).split("?");
  const params = new URLSearchParams(query);
  return {
    path: path || "/feed",
    filters: {
      ...initialFilters,
      q: params.get("q") ?? "",
      categories: params.getAll("category"),
      period: params.get("period") ?? "all",
      dateKind:
        path === "/calendar"
          ? params.get("date") && params.get("date") !== "all"
            ? params.get("date")!
            : "event"
          : (params.get("date") ?? "all"),
      status: params.get("status") ?? "all",
      important: params.get("important") === "1",
      files: params.get("files") === "1",
      favorites: params.get("favorites") === "1",
      reminders: params.get("reminders") === "1",
      from: params.get("from") ?? "",
      to: params.get("to") ?? "",
    },
  };
}
function go(path: string, filters = initialFilters) {
  const q = new URLSearchParams();
  if (filters.q) q.set("q", filters.q);
  filters.categories.forEach((c) => q.append("category", c));
  for (const [key, value] of Object.entries({
    period: filters.period,
    date: filters.dateKind,
    status: filters.status,
    from: filters.from,
    to: filters.to,
  }))
    if (value && value !== "all") q.set(key, value);
  if (filters.important) q.set("important", "1");
  if (filters.files) q.set("files", "1");
  if (filters.favorites) q.set("favorites", "1");
  if (filters.reminders) q.set("reminders", "1");
  location.hash = path + (q.size ? "?" + q.toString() : "");
}
function Icon({ name, size = 21 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    home: (
      <>
        <path d="m3 10 9-7 9 7v10H3Z" />
        <path d="M9 20v-7h6v7" />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="3" />
        <path d="M7 3v5m10-5v5M3 11h18m-12 4h.01M12 15h.01M16 15h.01" />
      </>
    ),
    files: (
      <>
        <path d="M14 3H5v18h14V8Z" />
        <path d="M14 3v6h5M8 13h8m-8 4h6" />
      </>
    ),
    archive: (
      <>
        <rect x="3" y="4" width="18" height="4" rx="1" />
        <path d="M5 8v13h14V8m-10 5h6" />
      </>
    ),
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 5 5" />
      </>
    ),
    arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
    back: <path d="m14 5-7 7 7 7" />,
    link: (
      <>
        <path d="m9 15 6-6M8 17l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m0 0 1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0" />
      </>
    ),
    sun: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1" />
      </>
    ),
    filter: <path d="M3 5h18M6 12h12m-8 7h4" />,
    lock: (
      <>
        <rect x="5" y="10" width="14" height="11" rx="3" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    chat: <path d="M21 11a8 8 0 0 1-8 8H6l-4 3V11a9 9 0 0 1 19 0Z" />,
    pin: <path d="m15 3 6 6-3 1-4 4v4l-3-3-7 6 6-7-3-3h4l4-4Z" />,
    star: (
      <path d="m12 3 2.8 5.7 6.3.9-4.5 4.4 1.1 6.2-5.7-3-5.7 3 1.1-6.2L3 9.6l6.2-.9Z" />
    ),
    book: (
      <>
        <path d="M12 5v16M3 3l9 2 9-2v16l-9 2-9-2Z" />
        <path d="m6 8 3 .7m-3 4 3 .7m6-5 3-.7m-3 4.7 3-.7" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.files}
    </svg>
  );
}
const FavoritesContext = React.createContext<{
  ids: string[];
  toggle: (id: string) => void;
}>({ ids: [], toggle: () => {} });
function FavoriteButton({
  id,
  compact = true,
}: {
  id: string;
  compact?: boolean;
}) {
  const { ids, toggle } = React.useContext(FavoritesContext);
  const selected = ids.includes(id);
  const label = selected ? "Удалить из избранного" : "Добавить в избранное";
  return (
    <button
      type="button"
      className={`favorite-button ${compact ? "compact" : ""} ${selected ? "selected" : ""}`}
      aria-label={label}
      aria-pressed={selected}
      title={label}
      onClick={() => toggle(id)}
    >
      <Icon name="star" />
      {!compact && <span>{selected ? "В избранном" : "В избранное"}</span>}
    </button>
  );
}
function App() {
  const [favoriteIds, setFavoriteIds] = useState<string[]>(loadFavorites);
  const [config, setConfig] = useState<Config | null>(null);
  const [manifest, setManifest] = useState<any>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [sessionKey, setSessionKey] = useState<CryptoKey | null>(null);
  const [accessKey, setAccessKey] = useState<CryptoKey | null>(null);
  const [access, setAccess] = useState<any>(null);
  const [participantView, setParticipantView] = useState(false);
  const [identity, setIdentity] = useState<Identity>({
    id: "legacy",
    label: "Участник пилота",
    role: "reader",
  });
  const [accountId, setAccountId] = useState(
    () => readLocal("frchat.account.v2", "user1") ?? "user1",
  );
  const [writer, setWriter] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [source, setSource] = useState("");
  const [code, setCode] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [route, setRoute] = useState(currentRoute);
  const [now, setNow] = useState(new Date());
  const [toast, setToast] = useState("");
  const [dialog, setDialog] = useState<"install" | "feedback" | null>(null);
  const [feedback, setFeedback] = useState("");
  const [fallbackCopy, setFallbackCopy] = useState("");
  const [theme, setTheme] = useState(() =>
    readLocal("frchat.theme.v1", "system"),
  );
  const [read, setRead] = useState<Record<string, string>>(() => {
    try {
      const value = JSON.parse(readLocal(READ_KEY, "{}") ?? "{}");
      return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : {};
    } catch {
      return {};
    }
  });
  const base = new URL("./", location.href.split("#")[0]).href;
  function toggleFavorite(id: string) {
    const next = favoriteIds.includes(id)
      ? favoriteIds.filter((value) => value !== id)
      : [...favoriteIds, id];
    setFavoriteIds(next);
    if (!saveFavorites(next))
      setToast(
        "Браузер не разрешил сохранить избранное. Оно доступно до закрытия вкладки.",
      );
  }
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === FAVORITES_KEY || event.key === null)
        setFavoriteIds(loadFavorites());
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  async function unlock(
    value: string,
    cfg = config,
    mf = manifest,
    login = accountId,
    preferredSource = source,
  ) {
    if (!cfg || !mf) return;
    setBusy(true);
    setError("");
    try {
      const result = await unlockSnapshot(
        mf,
        value.trim(),
        [preferredSource, ...cfg.dataSources].filter(Boolean),
        base,
        login,
      );
      setSnapshot(result.snapshot as Snapshot);
      setSessionKey(result.key);
      setAccessKey(result.accessKey);
      setAccess(result.access);
      setIdentity(result.identity);
      setWriter(null);
      const saveKey = mf.schema === "frchat-manifest/2" ? LOGIN_KEY : CODE_KEY;
      const saveValue =
        mf.schema === "frchat-manifest/2"
          ? JSON.stringify({ account: login, password: value.trim() })
          : value.trim();
      if (remember && !writeLocal(saveKey, saveValue))
        setToast(
          "Браузер не разрешил запомнить код. Доступ открыт для этой вкладки.",
        );
      if (!remember) writeLocal(saveKey, null);
      if (mf.schema === "frchat-manifest/2")
        writeLocal("frchat.account.v2", login);
      if (result.identity.role === "admin" && result.accessKey) {
        const savedToken = result.access?.publishing_token;
        if (savedToken)
          setWriter(
            new GitDataWriter({
              token: savedToken,
              key: result.key,
              epoch: mf.key_epoch,
              identity: result.identity,
            }),
          );
      }
      setCode("");
    } catch (e) {
      setError((e as Error).message);
      writeLocal(CODE_KEY, null);
      writeLocal(LOGIN_KEY, null);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    async function start() {
      try {
        const response = await fetch(new URL("config.json", base), {
          cache: "no-cache",
        });
        if (!response.ok) throw new Error("Настройки приложения недоступны");
        const cfg: Config = await response.json();
        if (!cfg.dataSources?.length)
          throw new Error("Источник данных не настроен");
        setConfig(cfg);
        const loaded = await loadManifest(cfg.dataSources, base);
        setManifest(loaded.manifest);
        setSource(loaded.source);
        if (loaded.manifest.schema === "frchat-manifest/2") {
          writeLocal(CODE_KEY, null);
          let saved = null;
          try {
            saved = JSON.parse(readLocal(LOGIN_KEY, "null") ?? "null");
          } catch {
            writeLocal(LOGIN_KEY, null);
          }
          if (saved?.account && typeof saved.password === "string") {
            setAccountId(saved.account);
            await unlock(
              saved.password,
              cfg,
              loaded.manifest,
              saved.account,
              loaded.source,
            );
          }
        } else {
          const saved = readLocal(CODE_KEY);
          if (saved) await unlock(saved, cfg, loaded.manifest);
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    }
    void start();
    let activePath = currentRoute().path;
    const onHash = () => {
      const next = currentRoute();
      setRoute(next);
      // Filtering must not move a checkbox or search field under the fixed navigation.
      if (next.path !== activePath) window.scrollTo({ top: 0 });
      activePath = next.path;
    };
    const onVisible = () => setNow(new Date());
    window.addEventListener("hashchange", onHash);
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(onVisible, 30_000);
    return () => {
      window.removeEventListener("hashchange", onHash);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme ?? "system";
    writeLocal("frchat.theme.v1", theme);
  }, [theme]);
  useEffect(() => {
    if (toast) {
      const id = setTimeout(() => setToast(""), 4500);
      return () => clearTimeout(id);
    }
  }, [toast]);
  useEffect(() => {
    if (!dialog && !fallbackCopy) return;
    const previous = document.activeElement as HTMLElement | null;
    const modal = document.querySelector<HTMLElement>(".modal");
    const controls = () => [
      ...(modal?.querySelectorAll<HTMLElement>(
        "button:not(:disabled),a[href],textarea,input",
      ) ?? []),
    ];
    controls()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDialog(null);
        setFallbackCopy("");
      }
      if (event.key === "Tab") {
        const targets = controls(),
          first = targets[0],
          last = targets.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [dialog, fallbackCopy]);
  const postId = route.path.startsWith("/post/")
    ? decodeURIComponent(route.path.slice(6))
    : null;
  const selectedPost = snapshot?.posts.find((p) => p.id === postId);
  useEffect(() => {
    if (!selectedPost) return;
    setRead((previous) => {
      const next = { ...previous, [selectedPost.id]: selectedPost.updated_at };
      writeLocal(READ_KEY, JSON.stringify(next));
      return next;
    });
  }, [selectedPost?.id, selectedPost?.updated_at]);
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setToast("Скопировано");
    } catch {
      setFallbackCopy(text);
    }
  }
  function lock() {
    writeLocal(CODE_KEY, null);
    writeLocal(LOGIN_KEY, null);
    setSnapshot(null);
    setSessionKey(null);
    setAccessKey(null);
    setAccess(null);
    setParticipantView(false);
    setWriter(null);
    setIdentity({ id: "legacy", role: "reader", label: "Участник пилота" });
    setCode("");
    setError("");
  }
  function updateSnapshot(result: any, id?: string) {
    setSnapshot(result.snapshot);
    setManifest(result.manifest);
    if (result.head) {
      setSource(
        `https://raw.githubusercontent.com/LeSauteur/FRchat-data/${result.head}/`,
      );
      writeLocal(
        "frchat.data-head.v1",
        JSON.stringify({ sha: result.head, at: Date.now() }),
      );
    }
    if (id) {
      go(`/post/${encodeURIComponent(id)}`);
      setToast("Публикация сохранена. Можно скопировать анонс для MAX.");
    }
  }
  async function refresh() {
    if (!sessionKey || !config || refreshing) return;
    setRefreshing(true);
    try {
      if (identity.role === "admin" && writer)
        updateSnapshot(await writer.readSnapshot());
      else {
        const loaded = await loadManifest(config.dataSources, base, {
          fresh: true,
        });
        if (loaded.manifest.key_epoch !== manifest.key_epoch) {
          lock();
          setManifest(loaded.manifest);
          setError("Доступ обновлён. Введите свой пароль заново.");
          return;
        }
        if (loaded.manifest.index.sha256 !== manifest.index.sha256)
          updateSnapshot({
            snapshot: await loadSnapshotWithKey(
              loaded.manifest,
              sessionKey,
              [loaded.source, ...config.dataSources],
              base,
            ),
            manifest: loaded.manifest,
          });
        setSource(loaded.source);
      }
      setToast("Лента обновлена");
    } catch (e: any) {
      setToast(e.message);
    } finally {
      setRefreshing(false);
    }
  }
  async function download(file: FileEntry) {
    if (!sessionKey || !config) return;
    setToast("Подготавливаем файл…");
    try {
      const bytes = await loadObject(
        file.ref,
        manifest,
        sessionKey,
        [source, ...config.dataSources].filter(Boolean),
        base,
      );
      if ((await sha256(bytes)) !== file.sha256)
        throw new Error("Контрольная сумма файла не совпала");
      const url = URL.createObjectURL(new Blob([bytes], { type: file.mime }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.name;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setToast("Файл готов к скачиванию");
    } catch (e) {
      setToast((e as Error).message);
    }
  }
  if (!snapshot)
    return (
      <main className="access-page">
        <section className="access-brand">
          <div className="brand">
            <img src="./icon-192.png" alt="" />
            <span>
              FRchat<span className="brand-dot">•</span>
            </span>
          </div>
          <span className="eyebrow">ДОМИАН · ФРАНШИЗА</span>
          <h1>
            Важное.
            <br />В одном месте.
          </h1>
          <p>
            События, сроки и рабочие сообщения
            <br />
            для собственников офисов.
          </p>
          <div className="access-decoration">
            <Icon name="calendar" size={34} />
            <span>Лента · календарь · архив</span>
          </div>
        </section>
        <section className="access-form">
          <span className="pilot-tag">Пилот</span>
          <div className="lock-symbol">
            <Icon name="lock" size={30} />
          </div>
          <h2>Добро пожаловать</h2>
          <p>
            {manifest?.schema === "frchat-manifest/2"
              ? "Выберите свой логин и введите временный пароль участника пилота."
              : "Введите код, который вам передали для участия в пилоте."}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void unlock(code);
            }}
          >
            {manifest?.schema === "frchat-manifest/2" && (
              <>
                <label htmlFor="account-login">Логин</label>
                <select
                  id="account-login"
                  value={accountId}
                  onChange={(e) => {
                    setAccountId(e.target.value);
                    setRemember(e.target.value !== "admin");
                  }}
                >
                  {manifest.accounts.map((a: any) => (
                    <option key={a.id} value={a.id}>
                      {a.id} — {a.label}
                    </option>
                  ))}
                </select>
              </>
            )}
            <label htmlFor="access-code">
              {manifest?.schema === "frchat-manifest/2"
                ? "Пароль"
                : "Код доступа"}
            </label>
            <input
              id="access-code"
              type="password"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              autoFocus
              disabled={busy}
            />
            <label className="checkbox">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              {manifest?.schema === "frchat-manifest/2"
                ? "Запомнить пароль на этом устройстве"
                : "Запомнить на этом устройстве"}
            </label>
            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
            <button
              className="primary wide"
              disabled={busy || !manifest || !code.trim()}
            >
              {busy ? (
                "Открываем данные…"
              ) : (
                <>
                  Открыть FRchat <Icon name="arrow" />
                </>
              )}
            </button>
          </form>
          <p className="access-note">
            Если ссылка открылась внутри MAX, код может не сохраниться. Откройте
            её в Safari или Chrome.
          </p>
          {!manifest && !busy && (
            <button className="text-button" onClick={() => location.reload()}>
              Повторить загрузку
            </button>
          )}
        </section>
      </main>
    );
  if (identity.role === "admin" && sessionKey && !participantView)
    return (
      <ManagerApp
        snapshot={snapshot}
        identity={identity}
        dataKey={sessionKey}
        accessKey={accessKey}
        epoch={manifest.key_epoch}
        access={access}
        writer={writer}
        path={route.path}
        onSaved={updateSnapshot}
        onConnected={(result, nextWriter) => {
          updateSnapshot(result);
          setAccess(result.access);
          setWriter(nextWriter);
        }}
        onLogout={lock}
        onView={() => {
          setParticipantView(true);
          go("/feed");
        }}
        theme={theme ?? "system"}
        onTheme={() =>
          setTheme(
            theme === "light" ? "dark" : theme === "dark" ? "system" : "light",
          )
        }
      />
    );
  const section = route.path === "/archive" ? "archive" : "active";
  const calendar = route.path === "/calendar";
  const files = route.path === "/files";
  const favorites = route.path === "/favorites";
  const reference = route.path === "/reference";
  const filters = route.filters;
  const allCategories: Category[] = [
    ...snapshot.categories,
    ...REFERENCE_CATEGORIES,
  ];
  const missingFavorites = favoriteIds.filter(
    (id) => !snapshot.posts.some((p) => p.id === id),
  );
  const showMissingFavorites =
    favorites &&
    !filters.q &&
    !filters.categories.length &&
    !filters.important &&
    !filters.files &&
    filters.period === "all" &&
    ["all", "deleted"].includes(filters.status);
  const filtered = filterPosts(
    calendar ? snapshot.posts.filter((p) => !isReference(p)) : snapshot.posts,
    filters,
    now,
    reference
      ? "reference"
      : favorites
        ? "favorites"
        : calendar
          ? "calendar"
          : files || ((filters.q || filters.favorites) && section === "active")
            ? "all"
            : section,
    favoriteIds,
  ) as Post[];
  const unread = snapshot.posts.filter(
    (p) => p.state !== "deleted" && read[p.id] !== p.updated_at,
  ).length;
  const category = (post: Post) =>
    allCategories.find((c) => c.id === post.category_id)!;
  const nav = [
    { path: "/feed", icon: "home", label: "Актуально" },
    { path: "/calendar", icon: "calendar", label: "Календарь" },
    { path: "/favorites", icon: "star", label: "Избранное" },
    { path: "/reference", icon: "book", label: "Справочник" },
    { path: "/files", icon: "files", label: "Файлы" },
    { path: "/archive", icon: "archive", label: "Архив" },
  ];
  const navActive = (path: string) =>
    route.path === path || (path === "/feed" && route.path === "/");
  return (
    <FavoritesContext.Provider
      value={{ ids: favoriteIds, toggle: toggleFavorite }}
    >
      <div className="app-layout">
        <aside className="sidebar">
          <a className="brand" href="#/feed">
            <img src="./icon-192.png" alt="" />
            <span>
              FRchat<span className="brand-dot">•</span>
            </span>
          </a>
          <p className="brand-caption">Домиан · франшиза</p>
          <div className="sidebar-label">РАБОЧЕЕ ПРОСТРАНСТВО</div>
          <nav>
            {nav.map((n) => (
              <a
                key={n.path}
                href={"#" + n.path}
                className={navActive(n.path) ? "nav-link selected" : "nav-link"}
                aria-current={navActive(n.path) ? "page" : undefined}
              >
                <Icon name={n.icon} />
                <span>{n.label}</span>
                {n.path === "/feed" && unread > 0 && (
                  <b className="nav-count">{unread}</b>
                )}
              </a>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <button onClick={() => setDialog("install")}>
              <Icon name="home" />
              На главный экран
            </button>
            <button onClick={() => setDialog("feedback")}>
              <Icon name="chat" />
              Обратная связь
            </button>
            <button onClick={lock}>
              <Icon name="lock" />
              Забыть код и выйти
            </button>
            <span>Пилот для участников тестирования</span>
          </div>
        </aside>
        <div className="workspace">
          <header className="topbar">
            <a className="mobile-brand" href="#/feed">
              <img src="./icon-192.png" alt="" />
              <strong>FRchat</strong>
            </a>
            <span className="topbar-date">{formatDate(now, false)}</span>
            <span className="pilot-tag">Пилот</span>
            <button
              className="icon-button"
              aria-label="Переключить светлую или тёмную тему"
              onClick={() =>
                setTheme(
                  theme === "dark" ||
                    (theme === "system" &&
                      matchMedia("(prefers-color-scheme: dark)").matches)
                    ? "light"
                    : "dark",
                )
              }
            >
              <Icon name="sun" />
            </button>
            <button
              className="icon-button mobile-lock"
              aria-label="Забыть код и выйти"
              onClick={lock}
            >
              <Icon name="lock" />
            </button>
          </header>
          <main className="main-content" id="content">
            {participantView && (
              <div className="participant-preview-banner">
                <p>Вы смотрите ленту глазами участника</p>
                <button
                  className="primary"
                  onClick={() => {
                    setParticipantView(false);
                    go("/feed");
                  }}
                >
                  Вернуться к своим публикациям
                </button>
              </div>
            )}
            {source === "./pilot-data/" &&
              config?.dataSources[0] !== "./pilot-data/" && (
                <p className="notice">
                  Сейчас доступна резервная копия пилота. Свежие публикации
                  появятся после подключения к основному источнику.{" "}
                  <button className="text-button" onClick={() => refresh()}>
                    Повторить загрузку
                  </button>
                </p>
              )}
            {postId ? (
              selectedPost ? (
                <>
                  <PostView
                    post={selectedPost}
                    category={category(selectedPost)}
                    snapshot={snapshot}
                    now={now}
                    copy={copy}
                    download={download}
                  />
                </>
              ) : (
                <Empty
                  title="Публикация не найдена"
                  text="Возможно, ссылка устарела. Откройте ленту или воспользуйтесь поиском."
                />
              )
            ) : (
              <>
                <div className="page-heading">
                  <div>
                    <span className="eyebrow">
                      ИНФОРМАЦИЯ ДЛЯ СОБСТВЕННИКОВ
                    </span>
                    <h1>
                      {calendar
                        ? "Календарь"
                        : files
                          ? "Шаблоны и файлы"
                          : section === "archive"
                            ? "Архив"
                            : favorites
                              ? "Избранное"
                              : reference
                                ? "Справочник"
                                : "Актуально"}
                    </h1>
                    <p>
                      {calendar
                        ? "События и сроки — чтобы всё успеть."
                        : files
                          ? "Рабочие документы и формы из публикаций."
                          : section === "archive"
                            ? "Прошедшие события и завершённые задачи."
                            : favorites
                              ? "Избранное хранится на этом устройстве"
                              : reference
                                ? "Постоянная информация: оплаты, реквизиты, контакты, офисы и инструкции."
                                : `${snapshot.posts.filter((p) => p.state !== "deleted").length} публикаций · ${unread} непрочитанных`}
                    </p>
                  </div>
                  <button
                    className="feedback-button"
                    onClick={() => setDialog("feedback")}
                  >
                    <Icon name="chat" />
                    <span>Обратная связь</span>
                  </button>
                </div>
                {section === "active" &&
                  !calendar &&
                  !files &&
                  !favorites &&
                  !reference && (
                    <>
                      <Birthdays snapshot={snapshot} now={now} />
                      <DailyTask config={config!} now={now} copy={copy} />
                    </>
                  )}
                <FilterBar
                  filters={filters}
                  categories={reference ? REFERENCE_CATEGORIES : allCategories}
                  onChange={(next) => {
                    // Controlled inputs must update in the same event, before hashchange arrives.
                    setRoute({ ...route, filters: next });
                    go(route.path, next);
                  }}
                  calendar={calendar}
                />
                {calendar ? (
                  <CalendarView
                    posts={filtered}
                    categories={snapshot.categories}
                    now={now}
                    dateKind={filters.dateKind}
                    onDateKind={(dateKind) =>
                      go(route.path, { ...filters, dateKind })
                    }
                    reminders={
                      filters.reminders ||
                      filters.categories.includes("reminders")
                    }
                    onReminders={(reminders) => {
                      const next = { ...filters, reminders };
                      setRoute({ ...route, filters: next });
                      go(route.path, next);
                    }}
                  />
                ) : files ? (
                  <FilesView posts={filtered} download={download} />
                ) : reference &&
                  !snapshot.posts.some(
                    (p) => isReference(p) && p.state !== "deleted",
                  ) ? (
                  <Empty
                    title="Справочник скоро появится"
                    text="Алексей готовит материалы для пилота. Здесь будут оплаты и взносы, реквизиты и почты, контакты техподдержки, банков и партнёров, офисы и территории, инструкции."
                  />
                ) : favorites && favoriteIds.length === 0 ? (
                  <Empty
                    title="В избранном пока пусто"
                    text="Нажмите звёздочку в списке или в карточке публикации, чтобы быстро вернуться к ней."
                  />
                ) : (
                  <Feed
                    posts={filtered}
                    categories={allCategories}
                    now={now}
                    archive={section === "archive" || favorites || reference}
                    read={read}
                    heading={
                      favorites
                        ? "Сохранённые публикации"
                        : reference
                          ? "Постоянная информация"
                          : undefined
                    }
                    hideEmpty={
                      showMissingFavorites && missingFavorites.length > 0
                    }
                    collapseReminders={
                      section === "active" &&
                      !favorites &&
                      !reference &&
                      !filters.q &&
                      !filters.categories.length
                    }
                  />
                )}
                {showMissingFavorites &&
                  missingFavorites.map((id) => (
                    <article className="missing-favorite" key={id}>
                      <div>
                        <span className="status status-deleted">Удалено</span>
                        <h2>Публикация удалена</h2>
                        <p>
                          Публикации больше нет в доступных данных. Закладка
                          сохранена; её можно удалить звёздочкой.
                        </p>
                      </div>
                      <FavoriteButton id={id} />
                    </article>
                  ))}
              </>
            )}
          </main>
          <footer className="page-footer">
            <span>FRchat · Домиан</span>
            <button onClick={() => refresh()} disabled={refreshing}>
              {refreshing ? "Обновляем…" : "Обновить ленту"}
            </button>
            <button onClick={() => setDialog("install")}>
              Добавить на главный экран
            </button>
            <span>Даты и время — Москва</span>
          </footer>
        </div>
        <nav className="bottom-nav">
          {nav.map((n) => (
            <a
              key={n.path}
              href={"#" + n.path}
              className={navActive(n.path) ? "selected" : ""}
              aria-current={navActive(n.path) ? "page" : undefined}
            >
              <Icon name={n.icon} />
              <span>{n.label}</span>
            </a>
          ))}
        </nav>
        {toast && (
          <div className="toast" role="status">
            {toast}
          </div>
        )}
        {(dialog || fallbackCopy) && (
          <div
            className="modal-backdrop"
            onClick={() => {
              setDialog(null);
              setFallbackCopy("");
            }}
          >
            <section
              className="modal"
              role="dialog"
              aria-modal="true"
              aria-label={
                fallbackCopy
                  ? "Копирование"
                  : dialog === "install"
                    ? "На главный экран"
                    : "Обратная связь"
              }
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className="modal-close"
                onClick={() => {
                  setDialog(null);
                  setFallbackCopy("");
                }}
                aria-label="Закрыть"
              >
                ×
              </button>
              {fallbackCopy ? (
                <>
                  <h2>Скопируйте текст</h2>
                  <p>Браузер не разрешил автоматическое копирование.</p>
                  <textarea
                    autoFocus
                    readOnly
                    value={fallbackCopy}
                    onFocus={(e) => e.target.select()}
                  />
                </>
              ) : dialog === "install" ? (
                <>
                  <div className="lock-symbol">
                    <Icon name="home" size={28} />
                  </div>
                  <h2>Всегда под рукой</h2>
                  <p>Откройте FRchat в обычном браузере.</p>
                  <ul>
                    <li>
                      <strong>iPhone:</strong> Safari → «Поделиться» → «На экран
                      Домой».
                    </li>
                    <li>
                      <strong>Android:</strong> меню Chrome → «Добавить на
                      главный экран».
                    </li>
                  </ul>
                  <p className="muted">
                    Внутри MAX эта команда может быть недоступна. Приложение
                    использует интернет для загрузки данных.
                  </p>
                  <button
                    className="primary"
                    onClick={() => void copy(location.href)}
                  >
                    Скопировать ссылку
                  </button>
                </>
              ) : (
                <>
                  <h2>Обратная связь о пилоте</h2>
                  <p>Что получилось, а что стоит исправить?</p>
                  <textarea
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                    placeholder="Опишите, что вы делали и что произошло…"
                  />
                  {safeUrl(config?.feedbackUrl) ? (
                    <a
                      className="primary"
                      href={safeUrl(config!.feedbackUrl)!}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Открыть канал обратной связи <Icon name="arrow" />
                    </a>
                  ) : (
                    <p className="muted">
                      Канал обратной связи пока не настроен. Скопируйте отзыв и
                      передайте организатору пилота.
                    </p>
                  )}
                  <button
                    className="primary"
                    disabled={!feedback.trim()}
                    onClick={() =>
                      void copy(
                        `FRchat · отзыв о пилоте\n${feedback}\nРаздел: ${route.path}`,
                      )
                    }
                  >
                    Скопировать отзыв
                  </button>
                </>
              )}
            </section>
          </div>
        )}
      </div>
    </FavoritesContext.Provider>
  );
}

function Birthdays({ snapshot, now }: { snapshot: Snapshot; now: Date }) {
  const names = snapshot.birthdays
    .filter((b) => b.date === dayKey(now).slice(5))
    .map((b) => b.name);
  return names.length ? (
    <div className="birthday">🎉 Сегодня день рождения: {names.join(", ")}</div>
  ) : null;
}
function DailyTask({
  config,
  now,
  copy,
}: {
  config: Config;
  now: Date;
  copy: (text: string) => Promise<void>;
}) {
  const [data, setData] = useState<any>(null);
  const [progress, setProgress] = useState("");
  const index = weekday(dayKey(now)) - 1;
  const id = DAY_IDS[index];
  useEffect(() => {
    let active = true;
    fetch(config.dailyTaskUrl, {
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(5000),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((value) => {
        if (active) setData(value);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [config.dailyTaskUrl]);
  const days = data?.days ?? data?.WEEK_DAYS;
  const day = Array.isArray(days) ? days.find((d: any) => d.id === id) : null;
  useEffect(() => {
    function update() {
      try {
        const raw = readLocal("domian:calendar:v3");
        if (!raw || !day) return setProgress("");
        const state = JSON.parse(raw),
          record = state.days?.[dayKey(now)];
        const contentVersion = data.content_version ?? data.CONTENT_VERSION;
        if (
          state.version !== 3 ||
          !record ||
          record.contentVersion !== contentVersion ||
          !Array.isArray(day.checklist)
        )
          return setProgress("");
        const total = day.checklist.length;
        const done = day.checklist.filter(
          (task: any) =>
            record.tasks?.[`${id}:${contentVersion}:${task.id}`] === true,
        ).length;
        setProgress(total ? `${done} из ${total}` : "");
      } catch {
        setProgress("");
      }
    }
    update();
    window.addEventListener("storage", update);
    window.addEventListener("focus", update);
    return () => {
      window.removeEventListener("storage", update);
      window.removeEventListener("focus", update);
    };
  }, [data, day, id, dayKey(now)]);
  const url = new URL(`#day/${id}`, config.dailyTaskHome).href;
  return (
    <section className="daily-task">
      <div>
        <span className="eyebrow">
          ЗАДАЧА ДНЯ · {DAY_NAMES[index].toLocaleUpperCase("ru")}
        </span>
        <h2>{day?.title ?? "7 дней эффективной работы"}</h2>
        <p>
          {day?.promise ??
            "Чек-лист дня для руководителя — в приложении «7 дней»."}
        </p>
        {progress && (
          <span className="daily-progress">Сегодня: {progress}</span>
        )}
        <div className="daily-actions">
          <a href={url} target="_blank" rel="noreferrer">
            Открыть чек-лист <Icon name="arrow" size={17} />
          </a>
          <button
            onClick={() =>
              void copy(
                `${DAY_NAMES[index]} · ${day?.title ?? "Задача дня"}\n${day?.promise ?? "Откройте чек-лист дня в приложении «7 дней». https://lesauteur.github.io/domian-7-days/"}\n${url}`,
              )
            }
          >
            Скопировать задачу дня
          </button>
        </div>
        {!day && (
          <span className="daily-note">Тема дня пока доступна по ссылке</span>
        )}
      </div>
      <div className="daily-art" aria-hidden="true">
        <Icon name="check" size={64} />
        <span>7</span>
      </div>
    </section>
  );
}

function FilterBar({
  filters,
  categories,
  onChange,
  calendar,
}: {
  filters: Filters;
  categories: Category[];
  onChange: (filters: Filters) => void;
  calendar: boolean;
}) {
  const [open, setOpen] = useState(false);
  const set = (key: keyof Filters, value: any) =>
    onChange({ ...filters, [key]: value });
  const active =
    filters.categories.length ||
    filters.important ||
    filters.files ||
    filters.favorites ||
    filters.reminders ||
    filters.period !== "all" ||
    filters.status !== "all";
  return (
    <section className="filters" aria-label="Поиск и фильтры">
      <div className="search-row">
        <label className="search">
          <Icon name="search" />
          <input
            aria-label="Поиск по публикациям"
            placeholder="Найти сообщение, событие или файл"
            value={filters.q}
            onChange={(e) => set("q", e.target.value)}
          />
          {filters.q && (
            <button aria-label="Очистить поиск" onClick={() => set("q", "")}>
              ×
            </button>
          )}
        </label>
        <button
          className={open || active ? "filter-button active" : "filter-button"}
          aria-label="Фильтры"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <Icon name="filter" />
          <span>Фильтры</span>
          {Boolean(active) && <i />}
        </button>
      </div>
      <div className="category-chips">
        <button
          className={!filters.categories.length ? "chip selected" : "chip"}
          onClick={() => set("categories", [])}
        >
          Все категории
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            data-category={c.id}
            className={
              filters.categories.includes(c.id) ? "chip selected" : "chip"
            }
            aria-pressed={filters.categories.includes(c.id)}
            onClick={() =>
              set(
                "categories",
                filters.categories.includes(c.id)
                  ? filters.categories.filter((id) => id !== c.id)
                  : [...filters.categories, c.id],
              )
            }
          >
            <span className="category-dot" />
            {c.name}
          </button>
        ))}
      </div>
      {open && (
        <div className="filter-options">
          <label>
            Показывать даты
            <select
              value={filters.dateKind}
              onChange={(e) => set("dateKind", e.target.value)}
            >
              {!calendar && <option value="all">События и дедлайны</option>}
              <option value="event">По событиям</option>
              <option value="deadline">По дедлайнам</option>
              <option value="publication">По публикации</option>
            </select>
          </label>
          {!calendar && (
            <label>
              Период
              <select
                value={filters.period}
                onChange={(e) => set("period", e.target.value)}
              >
                <option value="all">Любое время</option>
                <option value="today">Сегодня</option>
                <option value="tomorrow">Завтра</option>
                <option value="week">Эта неделя</option>
                <option value="next-week">Следующая неделя</option>
                <option value="month">Этот месяц</option>
                <option value="custom">Выбрать диапазон</option>
              </select>
            </label>
          )}
          <label>
            Статус
            <select
              value={filters.status}
              onChange={(e) => set("status", e.target.value)}
            >
              <option value="all">Все статусы</option>
              <option value="upcoming">Предстоит</option>
              <option value="ongoing">Идёт сейчас</option>
              <option value="overdue">Срок истёк</option>
              <option value="closed">Завершено</option>
              <option value="past">В архиве</option>
              <option value="cancelled">Отменено</option>
              <option value="postponed">Перенесено</option>
              <option value="reference">Справочник</option>
              <option value="deleted">Удалено (в избранном)</option>
            </select>
          </label>
          {filters.period === "custom" && (
            <>
              <label>
                С
                <input
                  type="date"
                  value={filters.from}
                  onChange={(e) => set("from", e.target.value)}
                />
              </label>
              <label>
                По
                <input
                  type="date"
                  value={filters.to}
                  onChange={(e) => set("to", e.target.value)}
                />
              </label>
            </>
          )}
          <label className="checkbox">
            <input
              type="checkbox"
              checked={filters.important}
              onChange={(e) => set("important", e.target.checked)}
            />
            Только важное
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={filters.favorites}
              onChange={(e) => set("favorites", e.target.checked)}
            />
            Только избранное
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={filters.files}
              onChange={(e) => set("files", e.target.checked)}
            />
            С файлами
          </label>
          <button
            className="text-button"
            onClick={() => onChange(initialFilters)}
          >
            Сбросить фильтры
          </button>
        </div>
      )}
    </section>
  );
}

function PostCard({
  post,
  category,
  now,
  read,
}: {
  post: Post;
  category: Category;
  now: Date;
  read?: string;
}) {
  const status = postStatus(post, now);
  const dates = occurrences(
    post,
    new Date(+now - DAY).toISOString(),
    new Date(+now + 32 * DAY).toISOString(),
  ) as DateEntry[];
  const nextFor = (kind: string) =>
    dates.find((d) => d.kind === kind && dateEnd(d) >= +now && !d.cancelled) ??
    post.dates
      .filter((d) => d.kind === kind && !d.recurrence)
      .sort((a, b) => a.start.localeCompare(b.start))
      .find((d) => dateEnd(d) >= +now) ??
    dates.filter((d) => d.kind === kind).at(-1) ??
    post.dates.filter((d) => d.kind === kind).at(-1);
  const nextEvent = nextFor("event"),
    nextDeadline = nextFor("deadline");
  return (
    <article
      className={`post-card ${post.category_id === "money" && !status.archive ? "money-card" : ""}`}
      data-category={post.category_id}
    >
      <FavoriteButton id={post.id} />
      <a
        className="post-card-link"
        href={"#/post/" + encodeURIComponent(post.id)}
      >
        <div className="card-meta">
          <span className="category-name">
            <span className="category-dot" />
            {category?.name}
          </span>
          {post.pinned && (
            <span className="pin-label">
              <Icon name="pin" size={13} />
              Закреплено
            </span>
          )}
          {read !== post.updated_at && (
            <span className="unread-dot" title="Не прочитано" />
          )}
        </div>
        <h3>{post.title}</h3>
        {[nextEvent, nextDeadline].filter(Boolean).map((next) => (
          <div
            key={next!.id}
            data-date-kind={next!.kind}
            className={
              "card-date " +
              (next!.kind === "deadline" && status.id === "overdue"
                ? "danger"
                : "")
            }
          >
            <Icon name="calendar" size={15} />
            <span>
              <span className="card-date-label">
                {next!.label ||
                  (next!.kind === "deadline" ? "Срок" : "Событие")}
                :{" "}
              </span>
              {dateLabel(next!)}
              {next!.kind === "deadline" && dateEnd(next!) <= +now
                ? " · срок истёк"
                : ""}
            </span>
          </div>
        ))}
        <p className="card-excerpt">
          {post.body.replace(/https?:\/\/\S+/g, "").slice(0, 155)}
        </p>
        <div className="card-bottom">
          <span>{formatDate(post.created_at, false)}</span>
          <div>
            {status.id !== "active" && (
              <span className={`status status-${status.id}`}>
                {status.label}
              </span>
            )}
            {post.priority !== "normal" && (
              <span className="important-label">
                {post.priority === "urgent" ? "Срочно" : "Важно"}
              </span>
            )}
            {Boolean(
              post.attachments.length || post.expected_attachments.length,
            ) && <Icon name="files" size={15} />}
          </div>
        </div>
        {post.reminded_at.length > 0 && (
          <span className="reminder-label">
            Напоминаний: {post.reminded_at.length}
          </span>
        )}
      </a>
    </article>
  );
}
function Feed({
  posts,
  categories,
  now,
  archive,
  read,
  heading,
  hideEmpty = false,
  collapseReminders = false,
}: {
  posts: Post[];
  categories: Category[];
  now: Date;
  archive: boolean;
  read: Record<string, string>;
  heading?: string;
  hideEmpty?: boolean;
  collapseReminders?: boolean;
}) {
  const reminders = collapseReminders
    ? posts.filter((p) => p.category_id === "reminders")
    : [];
  const hot = !archive ? posts.filter((p) => isHot(p, now)) : [];
  const pinned = !archive
    ? posts.filter(
        (p) => p.pinned && !hot.includes(p) && !reminders.includes(p),
      )
    : [];
  const other = posts.filter(
    (p) => !hot.includes(p) && !pinned.includes(p) && !reminders.includes(p),
  );
  const render = (items: Post[]) => (
    <div className="post-grid">
      {items.map((p) => (
        <PostCard
          key={p.id}
          post={p}
          category={categories.find((c) => c.id === p.category_id)!}
          now={now}
          read={read[p.id]}
        />
      ))}
    </div>
  );
  return (
    <>
      {hot.length > 0 && (
        <section className="feed-section">
          <div className="section-heading">
            <h2>
              <span className="hot-dot" />
              Горит
            </h2>
            <span>Ближайшие события и сроки</span>
          </div>
          {render(hot)}
        </section>
      )}
      {pinned.length > 0 && (
        <section className="feed-section">
          <div className="section-heading">
            <h2>Закреплённое</h2>
            <span>{pinned.length}</span>
          </div>
          {render(pinned)}
        </section>
      )}
      {other.length > 0 && (
        <section className="feed-section">
          <div className="section-heading">
            <h2>
              {heading ?? (archive ? "Прошедшие публикации" : "Рабочая лента")}
            </h2>
            <span>{other.length}</span>
          </div>
          {render(other)}
        </section>
      )}
      {posts.length === 0 && !hideEmpty && (
        <Empty
          title="Публикаций пока нет"
          text="Попробуйте изменить фильтры или посмотреть архив."
        />
      )}
      {reminders.length > 0 && (
        <details className="reminders-section">
          <summary>Напоминания · {reminders.length}</summary>
          <p className="muted">
            Регулярные правила и сроки собраны здесь один раз.
          </p>
          {render(reminders)}
        </details>
      )}
    </>
  );
}

function linkTitle(type: string) {
  const titles: Record<string, string> = {
    meeting: "Ссылка на встречу",
    form: "Форма и регистрация",
    chat: "Открыть чат",
    payment: "Оплата",
    other: "Открыть ссылку",
  };
  return titles[type] ?? "Открыть ссылку";
}
function TextBody({ text }: { text: string }) {
  const tokens = text.split(/(https?:\/\/[^\s<>]+)/g);
  return (
    <div className="post-body">
      {tokens.map((part, i) => {
        const cleaned = part.replace(/[.,;)]+$/, "");
        const url = /^https?:/.test(part) ? safeUrl(cleaned) : null;
        return url ? (
          <React.Fragment key={i}>
            <a href={url} target="_blank" rel="noreferrer">
              {cleaned}
            </a>
            {part.slice(cleaned.length)}
          </React.Fragment>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        );
      })}
    </div>
  );
}
function Attachment({
  file,
  download,
}: {
  file: FileEntry;
  download: (file: FileEntry) => Promise<void>;
}) {
  return (
    <button className="file-row" onClick={() => void download(file)}>
      <span className="file-icon">
        <Icon name="files" />
      </span>
      <span>
        <strong>{file.name}</strong>
        <small>
          {(file.size / 1024).toLocaleString("ru-RU", {
            maximumFractionDigits: 0,
          })}{" "}
          КБ · Скачать
        </small>
      </span>
      <Icon name="arrow" size={18} />
    </button>
  );
}
function PostView({
  post,
  category,
  snapshot,
  now,
  copy,
  download,
}: {
  post: Post;
  category: Category;
  snapshot: Snapshot;
  now: Date;
  copy: (text: string) => Promise<void>;
  download: (file: FileEntry) => Promise<void>;
}) {
  const status = postStatus(post, now);
  const series = post.dates.filter((d) => d.recurrence);
  const expanded = series.length
    ? (occurrences(
        post,
        new Date(+now - 7 * DAY).toISOString(),
        new Date(+now + 14 * DAY).toISOString(),
      ) as DateEntry[])
    : post.dates;
  const nextMeeting = expanded.find(
    (d) =>
      d.kind === "event" && !d.cancelled && dateEnd(d) >= +now && d.meeting_url,
  );
  const staticMeeting =
    !series.length && post.links.find((l) => l.type === "meeting");
  const meetingUrl =
    nextMeeting?.meeting_url ?? (staticMeeting ? staticMeeting.url : null);
  return (
    <article className="post-view" data-category={post.category_id}>
      <button
        className="back-link"
        onClick={() =>
          go(
            post.state === "deleted"
              ? "/favorites"
              : isReference(post)
                ? "/reference"
                : status.archive
                  ? "/archive"
                  : "/feed",
          )
        }
      >
        <Icon name="back" size={17} />
        {post.state === "deleted"
          ? "В избранное"
          : isReference(post)
            ? "В справочник"
            : status.archive
              ? "В архив"
              : "К ленте"}
      </button>
      <span className="category-name">
        <span className="category-dot" />
        {category.name}
      </span>
      <h1>{post.title}</h1>
      <FavoriteButton id={post.id} compact={false} />
      <div className="post-badges">
        <span className={`status status-${status.id}`}>{status.label}</span>
        {post.pinned && <span className="status">Закреплено</span>}
        {post.priority !== "normal" && (
          <span className="status important-label">
            {post.priority === "urgent" ? "Срочно" : "Важно"}
          </span>
        )}
        {post.history.length > 0 && (
          <span className="status">Обновлено · {post.history.length}</span>
        )}
      </div>
      <div className="post-byline">
        Источник: {post.source} · {formatDate(post.created_at)}
      </div>
      {meetingUrl && safeUrl(meetingUrl) && (
        <a
          className="primary meeting-button"
          href={safeUrl(meetingUrl)!}
          target="_blank"
          rel="noreferrer"
        >
          Подключиться
          {nextMeeting ? ` · ${formatDate(nextMeeting.start, false)}` : ""}
          <Icon name="arrow" />
        </a>
      )}
      {post.state === "postponed" && (
        <div className="notice">
          Мероприятие перенесено. Новая дата пока не объявлена; прежняя дата
          сохранена в истории.
        </div>
      )}
      {expanded.length > 0 && (
        <section className="post-dates">
          {series.length > 0 && (
            <div className="date-section-heading">
              Повторяется каждую неделю · ближайшие даты
            </div>
          )}
          {expanded.map((d, i) => (
            <div
              key={`${d.id}-${d.start}-${i}`}
              className={
                "date-row " +
                (d.cancelled || post.state === "postponed"
                  ? "cancelled-date"
                  : "")
              }
            >
              <span className="date-kind">
                {d.kind === "deadline" ? "Дедлайн" : "Событие"}
              </span>
              <div>
                <strong>{dateLabel(d)}</strong>
                {d.label && <small>{d.label}</small>}
                {d.cancelled && <small>Отменено / перенесено</small>}
                {d.meeting_url && safeUrl(d.meeting_url) && (
                  <a
                    href={safeUrl(d.meeting_url)!}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Подключение на эту дату ↗
                  </a>
                )}
              </div>
            </div>
          ))}
        </section>
      )}
      <TextBody text={post.body} />
      {post.links.filter((link) => !series.length || link.type !== "meeting")
        .length > 0 && (
        <section className="detail-section">
          <h2>Ссылки</h2>
          {post.links
            .filter((link) => !series.length || link.type !== "meeting")
            .map(
              (link, i) =>
                safeUrl(link.url) && (
                  <a
                    className="link-row"
                    key={i}
                    href={safeUrl(link.url)!}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span className="file-icon">
                      <Icon name="link" />
                    </span>
                    <span>
                      <strong>{link.label || linkTitle(link.type)}</strong>
                      <small>{new URL(link.url).hostname}</small>
                    </span>
                    <Icon name="arrow" size={17} />
                  </a>
                ),
            )}
        </section>
      )}
      {(post.attachments.length > 0 ||
        post.expected_attachments.length > 0) && (
        <section className="detail-section">
          <h2>Файлы</h2>
          {post.attachments.map((f) => (
            <Attachment key={f.id} file={f} download={download} />
          ))}
          {post.expected_attachments.map((f, i) => (
            <div className="file-row pending-file" key={i}>
              <Icon name="files" />
              <span>
                <strong>{f.label}</strong>
                <small>Файл будет добавлен</small>
              </span>
            </div>
          ))}
        </section>
      )}
      {post.related.length > 0 && (
        <section className="detail-section">
          <h2>Связанные публикации</h2>
          {post.related.map((id) => {
            const p = snapshot.posts.find((p) => p.id === id);
            return p ? (
              <a
                className="related-link"
                key={id}
                href={"#/post/" + encodeURIComponent(id)}
              >
                {p.title}
                <Icon name="arrow" size={17} />
              </a>
            ) : null;
          })}
        </section>
      )}
      {(post.history.length > 0 || post.reminded_at.length > 0) && (
        <section className="detail-section">
          <h2>История публикации</h2>
          <div className="timeline">
            {[
              ...post.history,
              ...post.reminded_at
                .filter(
                  (r) =>
                    !post.history.some(
                      (h) => h.type === "reminded" && h.at === r.at,
                    ),
                )
                .map((r) => ({
                  ...r,
                  text: "Напоминание о публикации",
                  type: "reminded",
                })),
            ]
              .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
              .map((h) => (
                <div className="timeline-entry" key={h.id}>
                  <span />
                  <div>
                    {h.text}
                    <small>{formatDate(h.at)}</small>
                  </div>
                </div>
              ))}
          </div>
        </section>
      )}
      <div className="post-actions">
        <button
          className="secondary"
          onClick={() =>
            void copy(
              new URL(
                `#/post/${encodeURIComponent(post.id)}`,
                location.href.split("#")[0],
              ).href,
            )
          }
        >
          <Icon name="link" size={17} />
          Скопировать ссылку
        </button>
        <span>Время — московское</span>
      </div>
    </article>
  );
}

type CalendarItem = DateEntry & { post: Post; publication?: boolean };
function CalendarView({
  posts,
  categories,
  now,
  dateKind,
  onDateKind,
  reminders,
  onReminders,
}: {
  posts: Post[];
  categories: Category[];
  now: Date;
  dateKind: string;
  onDateKind: (kind: string) => void;
  reminders: boolean;
  onReminders: (value: boolean) => void;
}) {
  const [selected, setSelected] = useState(dayKey(now));
  const [month, setMonth] = useState(dayKey(now).slice(0, 7) + "-01");
  const [view, setView] = useState<"month" | "week" | "agenda">("month");
  const monthStart = addDays(month, 1 - weekday(month));
  const weekStart = addDays(selected, 1 - weekday(selected));
  const from =
    view === "month" ? monthStart : view === "week" ? weekStart : selected;
  const to = addDays(from, view === "month" ? 42 : view === "week" ? 7 : 14);
  const items: CalendarItem[] = useMemo(
    () =>
      posts
        .flatMap((post) => {
          if (dateKind === "publication")
            return Date.parse(post.created_at) >= dayStart(from) &&
              Date.parse(post.created_at) < dayStart(to)
              ? [
                  {
                    id: post.id,
                    kind: "event" as const,
                    start: post.created_at,
                    label: "Опубликовано",
                    post,
                    publication: true,
                  },
                ]
              : [];
          return occurrences(
            post,
            new Date(dayStart(from)).toISOString(),
            new Date(dayStart(to)).toISOString(),
          )
            .filter((d: DateEntry) => dateKind === "all" || d.kind === dateKind)
            .map((d: DateEntry) => ({ ...d, post }));
        })
        .sort((a, b) => Date.parse(a.start) - Date.parse(b.start)),
    [posts, dateKind, from, to],
  );
  const onDay = (key: string) =>
    items.filter(
      (d) =>
        dayKey(d.start) <= key &&
        (d.allDay && d.end
          ? dayKey(new Date(Date.parse(d.end) - 1)) >= key
          : dayKey(d.start) === key),
    );
  function move(amount: number) {
    if (view !== "month")
      return setSelected(
        addDays(selected, amount * (view === "week" ? 7 : 14)),
      );
    const date = new Date(month + "T12:00:00+03:00");
    date.setUTCMonth(date.getUTCMonth() + amount);
    const key = dayKey(date).slice(0, 7) + "-01";
    setMonth(key);
    setSelected(key);
  }
  const days = Array.from({ length: view === "month" ? 42 : 7 }, (_, i) =>
    addDays(from, i),
  );
  const title = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    month: "long",
    year: "numeric",
  }).format(new Date(month + "T12:00:00+03:00"));
  const agendaKeys =
    view === "month"
      ? [selected]
      : Array.from({ length: view === "week" ? 7 : 14 }, (_, i) =>
          addDays(from, i),
        );
  return (
    <section className="calendar-view">
      <div className="calendar-kind">
        <div className="segmented" aria-label="Тип дат календаря">
          {[
            ["event", "События"],
            ["deadline", "Дедлайны"],
            ["publication", "Публикации"],
          ].map(([kind, label]) => (
            <button
              key={kind}
              className={dateKind === kind ? "selected" : ""}
              aria-pressed={dateKind === kind}
              onClick={() => onDateKind(kind)}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={reminders}
            onChange={(e) => onReminders(e.target.checked)}
          />
          Регулярные напоминания
        </label>
      </div>
      <div className="calendar-toolbar">
        <div className="segmented">
          {(["month", "week", "agenda"] as const).map((v) => (
            <button
              className={view === v ? "selected" : ""}
              key={v}
              onClick={() => setView(v)}
            >
              {{ month: "Месяц", week: "Неделя", agenda: "Повестка" }[v]}
            </button>
          ))}
        </div>
        <button
          className="secondary compact"
          onClick={() => {
            setSelected(dayKey(now));
            setMonth(dayKey(now).slice(0, 7) + "-01");
          }}
        >
          Сегодня
        </button>
      </div>
      <div
        className={
          "calendar-columns " + (view !== "month" ? "single-column" : "")
        }
      >
        <div className="calendar-panel">
          <div className="month-heading">
            <button aria-label="Предыдущий период" onClick={() => move(-1)}>
              <Icon name="back" />
            </button>
            <h2>
              {view === "month"
                ? title
                : `${formatDate(new Date(dayStart(from)), false)} — ${formatDate(new Date(dayStart(addDays(to, -1))), false)}`}
            </h2>
            <button aria-label="Следующий период" onClick={() => move(1)}>
              <Icon name="arrow" />
            </button>
          </div>
          {view !== "agenda" && (
            <>
              <div className="weekdays">
                {["ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ", "ВС"].map((d) => (
                  <span key={d}>{d}</span>
                ))}
              </div>
              <div className="calendar-grid">
                {days.map((key) => {
                  const events = onDay(key);
                  return (
                    <button
                      key={key}
                      className={[
                        "day-cell",
                        key.slice(0, 7) !== month.slice(0, 7) &&
                        view === "month"
                          ? "outside"
                          : "",
                        key === dayKey(now) ? "today" : "",
                        key === selected ? "chosen" : "",
                      ].join(" ")}
                      aria-label={`${formatDate(new Date(dayStart(key)), false)}, событий: ${events.length}`}
                      aria-pressed={key === selected}
                      onClick={() => setSelected(key)}
                    >
                      <span>{Number(key.slice(8))}</span>
                      <div className="day-dots">
                        {[...new Set(events.map((d) => d.post.category_id))]
                          .slice(0, 4)
                          .map((id) => (
                            <i key={id} data-category={id} />
                          ))}
                      </div>
                      {events.length > 4 && <small>+{events.length - 4}</small>}
                    </button>
                  );
                })}
              </div>
            </>
          )}
          <div className="calendar-legend">
            <span>
              <i className="legend-event" />
              Событие
            </span>
            <span>
              <i className="legend-deadline" />
              Дедлайн
            </span>
            <span>Время — МСК</span>
          </div>
        </div>
        <div className="agenda-list">
          {agendaKeys.map((key) => {
            const events = onDay(key);
            return (
              <section className="agenda-day" key={key}>
                <h3>
                  {key === dayKey(now) ? "Сегодня · " : ""}
                  {formatDate(new Date(dayStart(key)), false)}
                </h3>
                {events.length ? (
                  events.map((d, i) => (
                    <a
                      className={
                        "agenda-event " + (d.cancelled ? "cancelled-date" : "")
                      }
                      key={`${d.id}-${d.start}-${i}`}
                      href={"#/post/" + encodeURIComponent(d.post.id)}
                      data-category={d.post.category_id}
                    >
                      <time>
                        {d.kind === "deadline"
                          ? "срок"
                          : d.time_unspecified
                            ? "уточняется"
                            : d.allDay
                              ? "весь день"
                              : new Intl.DateTimeFormat("ru-RU", {
                                  timeZone: "Europe/Moscow",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                }).format(new Date(d.start))}
                      </time>
                      <div>
                        <strong>{d.post.title}</strong>
                        <small>
                          {d.cancelled
                            ? "Отменено / перенесено"
                            : d.label ||
                              categories.find(
                                (c) => c.id === d.post.category_id,
                              )?.name}
                        </small>
                        {d.meeting_url && !d.cancelled && (
                          <span className="meeting-indicator">
                            Есть ссылка на подключение
                          </span>
                        )}
                      </div>
                      <Icon name="arrow" size={16} />
                    </a>
                  ))
                ) : (
                  <p className="no-events">На этот день событий нет</p>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </section>
  );
}
function FilesView({
  posts,
  download,
}: {
  posts: Post[];
  download: (file: FileEntry) => Promise<void>;
}) {
  const withFiles = posts.filter(
    (p) => p.attachments.length || p.expected_attachments.length,
  );
  return withFiles.length ? (
    <div className="files-list">
      {withFiles.map((p) => (
        <section className="files-group" key={p.id}>
          <a href={"#/post/" + encodeURIComponent(p.id)}>
            <h2>{p.title}</h2>
          </a>
          {p.attachments.map((f) => (
            <Attachment key={f.id} file={f} download={download} />
          ))}
          {p.expected_attachments.map((f, i) => (
            <div className="file-row pending-file" key={i}>
              <Icon name="files" />
              <span>
                <strong>{f.label}</strong>
                <small>Файл будет добавлен</small>
              </span>
            </div>
          ))}
        </section>
      ))}
    </div>
  ) : (
    <Empty
      title="Файлы не найдены"
      text="Попробуйте изменить поисковый запрос или категории."
    />
  );
}
function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty">
      <Icon name="search" size={32} />
      <h2>{title}</h2>
      <p>{text}</p>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
