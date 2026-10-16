import test from "node:test";
import assert from "node:assert/strict";
import {
  createAdminFixture,
  syntheticAdminPassword,
  syntheticReaderPassword,
} from "../scripts/admin-fixture.mjs";
import { GitDataWriter, PostConflict } from "../src/lib/writer.mjs";
import { deriveKey, decryptBytes, decodeJson } from "../src/lib/crypto.mjs";
import {
  cleanMaxText,
  captureText,
  suggestDates,
} from "../src/lib/capture.mjs";
import { humanError } from "../src/lib/manager.mjs";
import { postStatus } from "../src/lib/dates.mjs";
import { rotateAccess } from "../src/lib/access-rotation.mjs";
test("yearless forwarded dates keep the nearest year; repeated headline date does not invent an extra session", () => {
  const old = suggestDates(
    "Автобусный брокер-тур — 18 сентября!\nВстречаемся 18 сентября в 12:30.",
    "2026-10-16T10:00:00+03:00",
  );
  assert.equal(old.dates.length, 1);
  assert.equal(old.dates[0].start, "2026-09-18T12:30:00+03:00");
  assert.ok(old.warnings.some((w) => w.includes("2026")));
  assert.equal(
    suggestDates("Встреча 5 января в 11:00", "2026-12-28T10:00:00+03:00")
      .dates[0].start,
    "2027-01-05T11:00:00+03:00",
  );
  assert.equal(
    suggestDates("Встреча 25 декабря в 11:00", "2027-01-03T10:00:00+03:00")
      .dates[0].start,
    "2026-12-25T11:00:00+03:00",
  );
  const separate = suggestDates(
    "БРОКЕР-ТУР 16.10.2026\n16.10.2026 сеансы 11:00 и 12:00\nСписки до 16.10.2026 в 10:00",
    "2026-10-15T10:00:00+03:00",
  );
  assert.deepEqual(
    separate.dates.map((d) => [d.kind, d.start.slice(11, 16)]),
    [
      ["event", "11:00"],
      ["event", "12:00"],
      ["deadline", "10:00"],
    ],
  );
});
const makeWriter = (f) =>
  new GitDataWriter({
    request: f.backend.request,
    key: f.key,
    epoch: f.manifest.key_epoch,
    identity: f.identity,
  });
const changed = (post, title) => ({ ...structuredClone(post), title });
test("writer commits post, month, index and encrypted attachment atomically; retries are idempotent", async () => {
  const f = await createAdminFixture(),
    writer = makeWriter(f),
    original = f.posts[0],
    head = f.backend.head;
  const result = await writer.savePost({
    post: changed(original, "Synthetic updated title"),
    basePost: original,
    files: [
      {
        name: "qa.txt",
        mime: "text/plain",
        bytes: new TextEncoder().encode("Private file content"),
      },
    ],
    operationId: "op-1",
  });
  assert.notEqual(result.head, head);
  const patches = f.backend.calls.filter((c) => c.method === "PATCH");
  assert.equal(patches.length, 1);
  assert.equal(patches[0].body.force, false);
  const restored = await writer.readSnapshot(),
    post = restored.snapshot.posts.find((p) => p.id === original.id);
  assert.equal(post.title, "Synthetic updated title");
  assert.equal(post.attachments.length, 1);
  assert.equal(
    new TextDecoder().decode(
      await decryptBytes(
        f.backend.files.get(post.attachments[0].ref.path),
        f.key,
        f.manifest.key_epoch,
        post.attachments[0].ref.object_id,
      ),
    ),
    "Private file content",
  );
  const retry = await writer.savePost({
    post: changed(original, "Synthetic updated title"),
    basePost: original,
    operationId: "op-1",
  });
  assert.equal(retry.alreadySaved, true);
  assert.equal(f.backend.calls.filter((c) => c.method === "PATCH").length, 1);
});
test("different posts merge after moved ref; the same post requires an explicit choice", async () => {
  const f = await createAdminFixture(),
    a = makeWriter(f),
    b = makeWriter(f),
    p = f.posts[0],
    q = f.posts[1];
  f.backend.beforePatch = () =>
    b.savePost({
      post: changed(q, "Other administrator"),
      basePost: q,
      operationId: "other-post",
    });
  await a.savePost({
    post: changed(p, "First administrator"),
    basePost: p,
    operationId: "first-post",
  });
  let remote = await a.readSnapshot();
  assert.equal(
    remote.snapshot.posts.find((x) => x.id === q.id).title,
    "Other administrator",
  );
  assert.equal(
    remote.snapshot.posts.find((x) => x.id === p.id).title,
    "First administrator",
  );
  const attempt = {
    post: changed(p, "Stale edit"),
    basePost: p,
    operationId: "same-post",
  };
  await assert.rejects(() => a.savePost(attempt), PostConflict);
  const current = remote.snapshot.posts.find((x) => x.id === p.id);
  await a.savePost({ ...attempt, resolveAgainst: current });
  assert.equal(
    (await a.readSnapshot()).snapshot.posts.find((x) => x.id === p.id).title,
    "Stale edit",
  );
});
test("lost response after successful ref update does not duplicate a publication", async () => {
  const f = await createAdminFixture(),
    writer = makeWriter(f);
  f.backend.loseResponse = true;
  const result = await writer.savePost({
    post: changed(f.posts[0], "Lost response"),
    basePost: f.posts[0],
    operationId: "lost",
  });
  assert.equal(result.alreadySaved, true);
  assert.equal(
    result.snapshot.posts
      .find((p) => p.id === f.posts[0].id)
      .history.filter((h) => h.id === "lost").length,
    1,
  );
});
test("publishing credential is wrapped by admin password, never by reader data key", async () => {
  const f = await createAdminFixture(),
    writer = makeWriter(f),
    result = await writer.savePublishingToken({
      accessKey: f.accessKey,
      access: f.access,
      token: "github_pat_synthetic",
    }),
    ref = result.manifest.accounts.find((a) => a.id === "admin").credential,
    bytes = f.backend.files.get(ref.path);
  assert.equal(
    decodeJson(
      await decryptBytes(
        bytes,
        await deriveKey(
          syntheticAdminPassword,
          result.manifest.accounts[0].kdf,
        ),
        f.manifest.key_epoch,
        ref.object_id,
      ),
    ).publishing_token,
    "github_pat_synthetic",
  );
  await assert.rejects(() =>
    decryptBytes(bytes, f.key, f.manifest.key_epoch, ref.object_id),
  );
  const readerKey = await deriveKey(
    syntheticReaderPassword,
    result.manifest.accounts[1].kdf,
  );
  await assert.rejects(() =>
    decryptBytes(bytes, readerKey, f.manifest.key_epoch, ref.object_id),
  );
  assert.equal(
    [...f.backend.files.values()].some((b) =>
      Buffer.from(b).includes("github_pat_synthetic"),
    ),
    false,
  );
  assert.throws(
    () =>
      new GitDataWriter({
        key: f.key,
        epoch: f.manifest.key_epoch,
        identity: { id: "user1", role: "reader" },
      }),
  );
});
test("MAX metadata is removed conservatively; separate pastes produce one post", () => {
  const input =
    "Переслано: Тестовый отдел\nБРОКЕР-ТУР 16.10.2026\nВстреча в 11:00\n👍 3\n11:58";
  const result = captureText(
    [input, "Запись по ссылке https://example.org/register"],
    "2026-10-15T10:00:00+03:00",
  );
  assert.equal(result.category_id, "developers");
  assert.ok(!result.body.includes("Переслано"));
  assert.ok(!result.body.includes("11:58"));
  assert.equal(result.links.length, 1);
  assert.equal(result.dates[0].start, "2026-10-16T11:00:00+03:00");
  assert.equal(
    cleanMaxText("Начало встречи\n11:58").text,
    "Начало встречи\n11:58",
  );
});
test("date parser separates list deadline from event and rejects a weekday mismatch", () => {
  const result = suggestDates(
    "Списки до 2 октября 2026 в 16:00\nПоездка 25 октября 2026, время уточняется",
    "2026-10-01T11:00:00+03:00",
  );
  assert.deepEqual(
    result.dates.map((d) => d.kind),
    ["deadline", "event"],
  );
  assert.equal(result.dates[0].start, "2026-10-02T16:00:00+03:00");
  assert.equal(result.dates[1].time_unspecified, true);
  assert.equal(
    suggestDates("29 октября 2026 (вторник) 11:00", "2026-10-01").warnings
      .length,
    1,
  );
  const range = suggestDates(
    "Вылет с 25 октября по 20 ноября, после покупки билетов",
    "2026-10-01",
  );
  assert.equal(range.dates.length, 0);
  assert.ok(range.warnings.length);
});
test("all-day deadline and bounded weekly series archive at their real boundaries", () => {
  const post = {
    state: "active",
    dates: [
      {
        id: "x",
        kind: "event",
        start: "2026-09-15T11:00:00+03:00",
        recurrence: { frequency: "weekly", weekdays: [2], until: "2026-10-31" },
      },
    ],
  };
  assert.equal(
    postStatus(post, new Date("2026-10-27T12:59:59+03:00")).archive,
    false,
  );
  assert.equal(
    postStatus(post, new Date("2026-10-27T13:00:00+03:00")).archive,
    true,
  );
});
test("leader errors contain an action and hide infrastructure terminology", () => {
  assert.match(
    humanError({ status: 401 }),
    /Публикация временно недоступна, напишите Алексею/,
  );
  assert.equal(
    humanError({ kind: "network" }),
    "Нет интернета. Текст сохранён — нажмите «Повторить», когда появится связь.",
  );
  for (const e of [
    { status: 401 },
    { status: 403 },
    { status: 409 },
    { kind: "network" },
    new Error("GitHub API token 401"),
  ])
    assert.doesNotMatch(
      humanError(e),
      /GitHub|токен|API|401|403|409|конфликт/iu,
    );
});
test("revoking one reader rotates all data and attachments, preserving other passwords and encrypted publishing access", async () => {
  const f = await createAdminFixture(),
    remote = await makeWriter(f).readSnapshot();
  const next = await rotateAccess({
    remote,
    oldKey: f.key,
    accounts: [
      { id: "admin", password: syntheticAdminPassword },
      { id: "user1", password: syntheticReaderPassword },
      { id: "user2", password: syntheticReaderPassword + "2" },
    ],
    revokedId: "user1",
    readBytes: (ref) => f.backend.files.get(ref.path),
  });
  assert.notEqual(next.manifest.key_epoch, f.manifest.key_epoch);
  assert.deepEqual(
    next.manifest.accounts.map((a) => a.id),
    ["admin", "user2"],
  );
  const reader = next.manifest.accounts.find((a) => a.id === "user2"),
    wrapKey = await deriveKey(syntheticReaderPassword + "2", reader.kdf),
    payload = decodeJson(
      await decryptBytes(
        next.objects.get(reader.credential.path),
        wrapKey,
        next.manifest.key_epoch,
        reader.credential.object_id,
      ),
    );
  const key = await deriveKey(payload.data_code, next.manifest.kdf),
    index = decodeJson(
      await decryptBytes(
        next.objects.get(next.manifest.index.path),
        key,
        next.manifest.key_epoch,
        "index",
      ),
    );
  assert.equal(index.count, f.posts.length);
  await assert.rejects(() =>
    decryptBytes(
      next.objects.get(next.manifest.index.path),
      f.key,
      next.manifest.key_epoch,
      "index",
    ),
  );
  const admin = next.manifest.accounts.find((a) => a.id === "admin"),
    adminKey = await deriveKey(syntheticAdminPassword, admin.kdf),
    adminAccess = decodeJson(
      await decryptBytes(
        next.objects.get(admin.credential.path),
        adminKey,
        next.manifest.key_epoch,
        admin.credential.object_id,
      ),
    );
  assert.equal(adminAccess.publishing_token, "github_pat_qa");
  const posts = [];
  for (const month of index.months)
    posts.push(
      ...decodeJson(
        await decryptBytes(
          next.objects.get(month.path),
          key,
          next.manifest.key_epoch,
          month.object_id,
        ),
      ).posts,
    );
  const file = posts.find((p) => p.attachments.length).attachments[0];
  assert.notEqual(
    file.ref.path,
    f.posts.find((p) => p.attachments.length).attachments[0].ref.path,
  );
  assert.equal(
    new TextDecoder().decode(
      await decryptBytes(
        next.objects.get(file.ref.path),
        key,
        next.manifest.key_epoch,
        file.ref.object_id,
      ),
    ),
    "Synthetic QA file",
  );
});
