import {
  base64,
  decodeJson,
  encodeJson,
  encryptedObject,
  encryptBytes,
  decryptBytes,
  sha256,
} from "./crypto.mjs";
import { validateManifest, validateRef } from "./storage.mjs";
import { validateSnapshot } from "./model.mjs";
export const DATA_REPOSITORY = {
  owner: "LeSauteur",
  repo: "FRchat-data",
  branch: "main",
};
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export class PostConflict extends Error {
  constructor(remote, local) {
    super(
      "Карточку изменил другой администратор. Выберите версию перед сохранением.",
    );
    this.name = "PostConflict";
    this.remote = remote;
    this.local = local;
  }
}
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .filter((k) => value[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export function moscowStamp(value = Date.now()) {
  return new Date(+new Date(value) + 3 * 3600000)
    .toISOString()
    .replace("Z", "+03:00");
}
export function fromBase64(text) {
  if (typeof text !== "string" || text.length > 50 * 1024 * 1024)
    throw new Error("Слишком большой объект GitHub");
  return Uint8Array.from(atob(text.replace(/\s/g, "")), (c) => c.charCodeAt(0));
}
export function githubRequest(token, onExpiration = () => {}) {
  return async (method, path, body) => {
    // Tokens are sent only to GitHub's API, never to a configurable host or redirect.
    if (
      !path.startsWith(
        `/repos/${DATA_REPOSITORY.owner}/${DATA_REPOSITORY.repo}/`,
      )
    )
      throw new Error("Запись разрешена только в репозиторий данных FRchat");
    let response;
    try {
      response = await fetch(`https://api.github.com${path}`, {
        method,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2026-03-10",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        redirect: "error",
        signal: AbortSignal.timeout(method === "POST" ? 90000 : 20000),
      });
    } catch {
      const error = new Error(
        "GitHub не ответил. Проверьте соединение. Повторная попытка не создаст дубль публикации.",
      );
      error.kind = "network";
      throw error;
    }
    const expiry = response.headers.get(
      "github-authentication-token-expiration",
    );
    if (expiry) onExpiration(expiry);
    if (!response.ok) {
      const error = new Error(
        response.status === 401
          ? "GitHub не принял токен. Подключите новый токен публикации."
          : response.status === 403 || response.status === 404
            ? "Нет доступа к FRchat-data. Нужен fine-grained токен: этот репозиторий, Contents: Read and write. Также проверьте лимит запросов GitHub."
            : `Не удалось сохранить данные в GitHub (${response.status}).`,
      );
      error.status = response.status;
      throw error;
    }
    return response.json();
  };
}
export class GitDataWriter {
  /** @param {any} options */
  constructor(options) {
    const { token = "", request, key, epoch, identity, onExpiration } = options;
    if (identity?.role !== "admin")
      throw new Error("Публиковать может только администратор");
    if (!key || !/^[a-f0-9]{32}$/.test(epoch))
      throw new Error("Нужен действующий вход администратора");
    if (!request && !token?.trim())
      throw new Error("Подключите токен публикации");
    this.request = request ?? githubRequest(token.trim(), onExpiration);
    this.key = key;
    this.epoch = epoch;
    this.identity = identity;
    this.base = `/repos/${DATA_REPOSITORY.owner}/${DATA_REPOSITORY.repo}`;
  }
  async readHead() {
    const ref = await this.request(
      "GET",
      `${this.base}/git/ref/heads/main?v=${Date.now()}`,
    );
    if (!/^[a-f0-9]{40}$/.test(ref.object?.sha))
      throw new Error("Некорректный HEAD данных");
    return ref.object.sha;
  }
  async readSnapshot() {
    const head = await this.readHead();
    const commit = await this.request(
      "GET",
      `${this.base}/git/commits/${head}`,
    );
    const tree = await this.request(
      "GET",
      `${this.base}/git/trees/${commit.tree.sha}?recursive=1`,
    );
    if (tree.truncated || !Array.isArray(tree.tree))
      throw new Error(
        "Репозиторий данных слишком велик для этой версии редактора",
      );
    const paths = new Map(
      tree.tree.filter((e) => e.type === "blob").map((e) => [e.path, e.sha]),
    );
    const readBlob = async (path) => {
      const sha = paths.get(path);
      if (!sha)
        throw new Error("Снимок данных неполон. Публикация остановлена.");
      const blob = await this.request("GET", `${this.base}/git/blobs/${sha}`);
      if (blob.encoding !== "base64" || blob.size > 36 * 1024 * 1024)
        throw new Error("Неподдерживаемый объект хранилища");
      return fromBase64(blob.content);
    };
    const manifest = validateManifest(
      decodeJson(await readBlob("manifest.json")),
    );
    if (manifest.key_epoch !== this.epoch)
      throw new Error(
        "Ключ доступа изменён. Выйдите и войдите снова перед публикацией.",
      );
    const readObject = async (ref) => {
      validateRef(ref);
      const bytes = await readBlob(ref.path);
      if ((await sha256(bytes)) !== ref.sha256)
        throw new Error("Контрольная сумма данных не совпала");
      return decryptBytes(bytes, this.key, this.epoch, ref.object_id);
    };
    const index = decodeJson(await readObject(manifest.index));
    if (
      index.schema_version !== 1 ||
      !Array.isArray(index.months) ||
      index.months.length > 240
    )
      throw new Error("Некорректный индекс данных");
    const posts = [];
    for (const month of index.months)
      posts.push(...decodeJson(await readObject(month)).posts);
    if (
      posts.length !== index.count ||
      new Set(posts.map((p) => p.id)).size !== posts.length
    )
      throw new Error("Неполный набор публикаций");
    return {
      head,
      treeSha: commit.tree.sha,
      manifest,
      index,
      snapshot: validateSnapshot({ ...index, posts }),
      paths,
    };
  }
  async savePublishingToken({ accessKey, access, token }) {
    if (this.identity.id !== "admin" || access?.role !== "admin" || !accessKey)
      throw new Error("Нужен вход владельца");
    for (let attempt = 0; attempt < 3; attempt++) {
      const remote = await this.readSnapshot();
      const account = remote.manifest.accounts.find(
        (a) => a.id === this.identity.id,
      );
      if (!account) throw new Error("Доступ владельца не найден");
      const payload = { ...access, publishing_token: token };
      const object = await encryptedObject(
        payload,
        accessKey,
        this.epoch,
        account.credential.object_id,
      );
      const manifest = {
        ...remote.manifest,
        updated_at: moscowStamp(),
        accounts: remote.manifest.accounts.map((a) =>
          a.id === account.id ? { ...a, credential: object.ref } : a,
        ),
      };
      const entries = [];
      for (const [path, bytes] of [
        [object.ref.path, object.bytes],
        ["manifest.json", encodeJson(manifest)],
      ]) {
        const blob = await this.request("POST", `${this.base}/git/blobs`, {
          content: base64(bytes),
          encoding: "base64",
        });
        entries.push({ path, mode: "100644", type: "blob", sha: blob.sha });
      }
      const tree = await this.request("POST", `${this.base}/git/trees`, {
        base_tree: remote.treeSha,
        tree: entries,
      });
      const commit = await this.request("POST", `${this.base}/git/commits`, {
        message: "FRchat: configure encrypted publishing access",
        tree: tree.sha,
        parents: [remote.head],
      });
      try {
        await this.request("PATCH", `${this.base}/git/refs/heads/main`, {
          sha: commit.sha,
          force: false,
        });
        return {
          snapshot: remote.snapshot,
          manifest,
          access: payload,
          head: commit.sha,
        };
      } catch (error) {
        if (attempt === 2 || (await this.readHead()) === remote.head)
          throw error;
      }
    }
  }
  async savePost({
    post,
    basePost = null,
    files = [],
    operationId,
    resolveAgainst = undefined,
  }) {
    if (
      !post?.id ||
      !operationId ||
      !/^\d{4}-\d{2}-\d{2}T/.test(post.created_at)
    )
      throw new Error("Некорректная публикация");
    if (
      files.some((f) => f.bytes.length > MAX_FILE_BYTES) ||
      files.reduce((n, f) => n + f.bytes.length, 0) > 50 * 1024 * 1024
    )
      throw new Error(
        "Один файл — до 25 МБ, всего за одну публикацию — до 50 МБ",
      );
    const pending = new Map(),
      blobCache = new Map();
    const local = structuredClone(post);
    local.attachments = [...(local.attachments ?? [])];
    for (const file of files) {
      const id = file.id ?? crypto.randomUUID(),
        objectId = `file:${id}`;
      const encrypted = await encryptBytes(
          file.bytes,
          this.key,
          this.epoch,
          objectId,
        ),
        hash = await sha256(encrypted);
      const ref = {
        path: `objects/${hash}.bin`,
        sha256: hash,
        object_id: objectId,
      };
      pending.set(ref.path, encrypted);
      local.attachments.push({
        id,
        name: file.name,
        mime: file.mime || "application/octet-stream",
        size: file.bytes.length,
        sha256: await sha256(file.bytes),
        ref,
        uploaded_at: moscowStamp(),
        permanent_template: Boolean(file.permanent_template),
      });
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const remote = await this.readSnapshot();
      const previous = remote.snapshot.posts.find((p) => p.id === local.id);
      if (previous?.history?.some((h) => h.id === operationId))
        return { ...remote, alreadySaved: true };
      const expected = resolveAgainst === undefined ? basePost : resolveAgainst;
      if (canonical(previous ?? null) !== canonical(expected ?? null))
        throw new PostConflict(previous ?? null, local);
      if (previous && previous.created_at !== local.created_at)
        throw new Error("Дата создания существующей карточки не изменяется");
      const changed = structuredClone(local);
      changed.updated_at = moscowStamp(
        Math.max(Date.now(), Date.parse(previous?.updated_at ?? "") + 1 || 0),
      );
      if (changed.state === "closed" && !changed.closed_at)
        changed.closed_at = changed.updated_at;
      changed.history = [
        ...new Map(
          [...(previous?.history ?? []), ...(changed.history ?? [])].map(
            (h) => [h.id, h],
          ),
        ).values(),
      ];
      if (!changed.history.some((h) => h.id === operationId))
        changed.history.push({
          id: operationId,
          at: changed.updated_at,
          type:
            changed.state === "closed" && previous?.state !== "closed"
              ? "closed"
              : basePost
                ? "edited"
                : "created",
          text:
            changed.state === "closed" && previous?.state !== "closed"
              ? "Завершено досрочно"
              : basePost
                ? "Публикация обновлена"
                : "Публикация создана",
          by: this.identity.label,
        });
      const posts = previous
        ? remote.snapshot.posts.map((p) => (p.id === changed.id ? changed : p))
        : [...remote.snapshot.posts, changed];
      validateSnapshot({ ...remote.snapshot, posts });
      const month = changed.created_at.slice(0, 7);
      const monthObject = await encryptedObject(
        {
          schema_version: 1,
          posts: posts.filter((p) => p.created_at.slice(0, 7) === month),
        },
        this.key,
        this.epoch,
        `month:${month}`,
      );
      const months = remote.index.months.filter((m) => m.month !== month);
      months.push({ month, ...monthObject.ref });
      months.sort((a, b) => a.month.localeCompare(b.month));
      const index = {
        ...remote.index,
        count: posts.length,
        months,
        generated_at: changed.updated_at,
      };
      const indexObject = await encryptedObject(
        index,
        this.key,
        this.epoch,
        "index",
      );
      const manifest = {
        ...remote.manifest,
        index: indexObject.ref,
        updated_at: changed.updated_at,
      };
      const objects = new Map(pending);
      objects.set(monthObject.ref.path, monthObject.bytes);
      objects.set(indexObject.ref.path, indexObject.bytes);
      objects.set("manifest.json", encodeJson(manifest));
      const entries = [];
      for (const [path, bytes] of objects) {
        let blobSha = blobCache.get(path) ?? remote.paths.get(path);
        if (!blobSha || path === "manifest.json") {
          const blob = await this.request("POST", `${this.base}/git/blobs`, {
            content: base64(bytes),
            encoding: "base64",
          });
          blobSha = blob.sha;
          if (path !== "manifest.json") blobCache.set(path, blobSha);
        }
        entries.push({ path, mode: "100644", type: "blob", sha: blobSha });
      }
      const tree = await this.request("POST", `${this.base}/git/trees`, {
        base_tree: remote.treeSha,
        tree: entries,
      });
      const commit = await this.request("POST", `${this.base}/git/commits`, {
        message: "FRchat: update encrypted publication",
        tree: tree.sha,
        parents: [remote.head],
      });
      try {
        await this.request("PATCH", `${this.base}/git/refs/heads/main`, {
          sha: commit.sha,
          force: false,
        });
        return {
          snapshot: validateSnapshot({ ...index, posts }),
          manifest,
          head: commit.sha,
        };
      } catch (error) {
        // Distinguish a moved ref from validation/permission failures. A lost response is also safe to retry.
        const head = await this.readHead();
        if (head === remote.head) throw error;
        if (attempt === 2) {
          const latest = await this.readSnapshot();
          if (
            latest.snapshot.posts
              .find((p) => p.id === local.id)
              ?.history?.some((h) => h.id === operationId)
          )
            return { ...latest, alreadySaved: true };
          throw new Error(
            "Данные несколько раз изменились во время записи. Черновик сохранён; повторите публикацию.",
          );
        }
      }
    }
  }
}
