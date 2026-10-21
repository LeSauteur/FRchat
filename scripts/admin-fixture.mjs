import { createHash } from "node:crypto";
import { createQaFixture, installQaRoutes } from "./qa-fixture.mjs";
import {
  deriveKey,
  newKdf,
  decodeJson,
  decryptBytes,
  encryptedObject,
  encodeJson,
} from "../src/lib/crypto.mjs";
export const syntheticAdminPassword = "qa-admin-password-only",
  syntheticReaderPassword = "qa-reader-password-only";
export async function createAdminFixture({ additionalPosts = [] } = {}) {
  const fixture = await createQaFixture(),
    { manifest, objects } = fixture,
    key = await deriveKey(fixture.code, manifest.kdf);
  async function read(ref) {
    return decodeJson(
      await decryptBytes(
        objects.get(ref.path),
        key,
        manifest.key_epoch,
        ref.object_id,
      ),
    );
  }
  async function store(data, id, objectKey = key) {
    const object = await encryptedObject(
      data,
      objectKey,
      manifest.key_epoch,
      id,
    );
    objects.set(object.ref.path, object.bytes);
    return object.ref;
  }
  const index = await read(manifest.index),
    posts = (await Promise.all(index.months.map(read))).flatMap((m) => m.posts);
  posts.push(...structuredClone(additionalPosts));
  index.count = posts.length;
  index.categories.push({
    id: "reminders",
    name: "Напоминания",
    emoji: "",
    retention_days: null,
  });
  index.months = [];
  for (const [month, entries] of Map.groupBy(posts, (p) =>
    p.created_at.slice(0, 7),
  ))
    index.months.push({
      month,
      ...(await store({ schema_version: 1, posts: entries }, `month:${month}`)),
    });
  manifest.index = await store(index, "index");
  manifest.schema = "frchat-manifest/2";
  manifest.accounts = [];
  for (const [id, role, password] of [
    ["admin", "admin", syntheticAdminPassword],
    ["user1", "reader", syntheticReaderPassword],
    ["user2", "reader", syntheticReaderPassword + "2"],
  ]) {
    const kdf = newKdf(),
      accessKey = await deriveKey(password, kdf),
      access = {
        schema: "frchat-access/1",
        id,
        role,
        data_code: fixture.code,
        ...(role === "admin" ? { publishing_token: "github_pat_qa" } : {}),
      };
    const credential = await store(access, `access:${id}`, accessKey);
    manifest.accounts.push({
      id,
      label: role === "admin" ? "Руководство" : "Участник 1",
      kdf,
      credential,
    });
    if (role === "admin") Object.assign(fixture, { accessKey, access });
  }
  Object.assign(fixture, {
    key,
    posts,
    index,
    identity: { id: "admin", role: "admin", label: "Руководство" },
  });
  fixture.backend = memoryGitData(
    new Map([...objects, ["manifest.json", encodeJson(manifest)]]),
  );
  return fixture;
}
export function memoryGitData(files) {
  const blobs = new Map(),
    trees = new Map(),
    commits = new Map(),
    calls = [];
  const hash = (value) => createHash("sha1").update(value).digest("hex");
  const makeBlob = (bytes) => {
    const sha = hash(bytes);
    blobs.set(sha, new Uint8Array(bytes));
    return sha;
  };
  const makeTree = (entries) => {
    const sha = hash(JSON.stringify(entries));
    trees.set(sha, entries);
    return sha;
  };
  let head;
  const startTree = makeTree(
    [...files].map(([path, bytes]) => ({
      path,
      mode: "100644",
      type: "blob",
      sha: makeBlob(bytes),
    })),
  );
  head = hash("initial");
  commits.set(head, { sha: head, tree: { sha: startTree }, parents: [] });
  const backend = {
    calls,
    blobs,
    trees,
    commits,
    beforePatch: null,
    loseResponse: false,
    denied: false,
    offline: false,
    get head() {
      return head;
    },
    get files() {
      return new Map(
        trees
          .get(commits.get(head).tree.sha)
          .map((e) => [e.path, blobs.get(e.sha)]),
      );
    },
  };
  backend.request = async (method, path, body) => {
    calls.push({ method, path, body });
    if (backend.offline) throw { kind: "network" };
    if (backend.denied) throw { status: 401 };
    const endpoint = path
      .replace(/^\/repos\/LeSauteur\/FRchat-data/iu, "")
      .split("?")[0];
    if (method === "GET" && endpoint === "/git/ref/heads/main")
      return { object: { sha: head } };
    if (method === "GET" && endpoint.startsWith("/git/commits/"))
      return commits.get(endpoint.split("/").at(-1));
    if (method === "GET" && endpoint.startsWith("/git/trees/"))
      return {
        tree: trees.get(endpoint.split("/").at(-1).split("?")[0]),
        truncated: false,
      };
    if (method === "GET" && endpoint.startsWith("/git/blobs/")) {
      const bytes = blobs.get(endpoint.split("/").at(-1));
      return {
        encoding: "base64",
        content: Buffer.from(bytes).toString("base64"),
        size: bytes.length,
      };
    }
    if (method === "POST" && endpoint === "/git/blobs")
      return { sha: makeBlob(Buffer.from(body.content, "base64")) };
    if (method === "POST" && endpoint === "/git/trees") {
      const entries = new Map(
        (trees.get(body.base_tree) ?? []).map((e) => [e.path, e]),
      );
      for (const e of body.tree) entries.set(e.path, e);
      return { sha: makeTree([...entries.values()]) };
    }
    if (method === "POST" && endpoint === "/git/commits") {
      const sha = hash(JSON.stringify(body));
      commits.set(sha, { ...body, sha, tree: { sha: body.tree } });
      return { sha };
    }
    if (method === "PATCH" && endpoint === "/git/refs/heads/main") {
      if (backend.beforePatch) {
        const hook = backend.beforePatch;
        backend.beforePatch = null;
        await hook();
      }
      if (body.force !== false || commits.get(body.sha).parents[0] !== head)
        throw { status: 422 };
      head = body.sha;
      if (backend.loseResponse) {
        backend.loseResponse = false;
        throw { kind: "network" };
      }
      return { object: { sha: head } };
    }
    throw new Error(`Unexpected mock request ${method} ${endpoint}`);
  };
  return backend;
}
export async function installAdminRoutes(page, fixture) {
  await installQaRoutes(page, fixture);
  await page.route("**/pilot-data/manifest.json*", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: Buffer.from(fixture.backend.files.get("manifest.json")),
    }),
  );
  await page.route("**/pilot-data/objects/*", (route) => {
    const path =
        "objects/" + new URL(route.request().url()).pathname.split("/").at(-1),
      bytes = fixture.backend.files.get(path);
    return route.fulfill(
      bytes
        ? { contentType: "application/octet-stream", body: Buffer.from(bytes) }
        : { status: 404 },
    );
  });
  await page.route(
    "https://api.github.com/repos/LeSauteur/FRchat-data/**",
    async (route) => {
      try {
        const request = route.request(),
          value = await fixture.backend.request(
            request.method(),
            new URL(request.url()).pathname + new URL(request.url()).search,
            request.postDataJSON(),
          );
        await route.fulfill({ json: value });
      } catch (e) {
        if (e.kind === "network") await route.abort("internetdisconnected");
        else
          await route.fulfill({
            status: e.status ?? 500,
            json: { message: "Synthetic error" },
          });
      }
    },
  );
}
