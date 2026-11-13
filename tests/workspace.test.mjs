import test from "node:test";
import assert from "node:assert/strict";
import { createWorkspaceFixture } from "../scripts/workspace-fixture.mjs";
import {
  DEFAULT_TOOLS,
  contentPost,
  documents,
  workspaceSettings,
  toolUrl,
  validateWorkspace,
  validateDocument,
  SETTINGS_ID,
  upcomingActions,
} from "../src/lib/workspace.mjs";
import { filterPosts } from "../src/lib/filters.mjs";
import { validateSnapshot, importSeed } from "../src/lib/model.mjs";
import { rotateAccess } from "../src/lib/access-rotation.mjs";
import {
  syntheticAdminPassword,
  syntheticReaderPassword,
} from "../scripts/admin-fixture.mjs";
import {
  GitDataWriter,
  PostConflict,
  moscowStamp,
} from "../src/lib/writer.mjs";
import { decryptBytes, decodeJson } from "../src/lib/crypto.mjs";
test("existing snapshots need no migration; documents are permanent, searchable and settings never enter news/search/favorites", () => {
  const at = moscowStamp(),
    identity = { id: "admin", label: "Synthetic" };
  const p = {
    ...contentPost(identity, "doc", at),
    title: "Порядок отчётности",
    body: "Инструкция",
    document: {
      description: "Ежемесячный отчёт",
      owner: "Учебный отдел",
      reviewed_on: "2026-11-13",
      version: "1",
      status: "outdated",
    },
  };
  const config = {
    ...contentPost(identity, SETTINGS_ID, at),
    title: "Secret settings title",
    workspace: {
      version: 1,
      document_categories: [
        { id: "reference-instructions", name: "Инструкции" },
      ],
      tools: DEFAULT_TOOLS,
    },
  };
  const s = validateSnapshot({
    schema_version: 1,
    categories: [],
    posts: [p, config],
  });
  assert.equal(documents(s, "учебный отдел")[0].id, "doc");
  assert.equal(documents(s).length, 1);
  for (const section of ["active", "archive", "all", "favorites"])
    assert.ok(
      !filterPosts(s.posts, {}, new Date(), section, [SETTINGS_ID]).some(
        (p) => p.id === SETTINGS_ID,
      ),
    );
  assert.equal(
    filterPosts(s.posts, {}, new Date("2040-01-01"), "reference").length,
    1,
  );
  assert.equal(workspaceSettings({ posts: [] }).tools[0].id, "seven-days");
});
test("catalog rejects unsafe URLs and invalid dates; only HTTPS links without credentials are accepted", () => {
  for (const url of [
    "javascript:alert(1)",
    "http://example.org",
    "https://user:pass@example.org",
    "//example.org",
    "mailto:a@example.org",
  ])
    assert.equal(toolUrl(url), null);
  assert.equal(toolUrl("https://example.org/path"), "https://example.org/path");
  assert.throws(() =>
    validateWorkspace({
      version: 1,
      document_categories: [
        { id: "x", name: "Test" },
        { id: "x", name: "Duplicate" },
      ],
      tools: [],
    }),
  );
  assert.throws(() =>
    validateDocument({
      description: "Test",
      owner: "QA",
      version: "1",
      status: "current",
      reviewed_on: "2026-02-30",
    }),
  );
});
test("seed import preserves new document categories and optional metadata without requiring a data migration", () => {
  const at = moscowStamp();
  const p = {
    ...contentPost({ id: "qa", label: "QA" }, "template", at),
    category_id: "document-templates",
    title: "Template",
    body: "Synthetic",
    document: {
      description: "Synthetic",
      owner: "QA",
      reviewed_on: "2026-11-13",
      version: "1",
      status: "current",
    },
  };
  const s = importSeed({
    schema: "frchat-seed/1",
    posts: [],
    references: [p],
    categories: [],
    period: { from: "2026-11-01", to: "2026-11-30" },
    generated_at: at,
  });
  assert.deepEqual(s.posts[0].document, p.document);
  assert.equal(s.posts[0].category_id, "document-templates");
});
test("access rotation retains current and superseded document files plus catalog settings", async () => {
  const f = await createWorkspaceFixture(),
    writer = new GitDataWriter({
      request: f.backend.request,
      key: f.key,
      epoch: f.manifest.key_epoch,
      identity: f.identity,
    });
  const remote = await writer.readSnapshot(),
    doc = remote.snapshot.posts.find((p) => p.id === "workspace-regulation");
  await writer.savePost({
    post: {
      ...doc,
      attachments: doc.attachments.map((file) => ({
        ...file,
        superseded_at: moscowStamp(),
        version_label: "1",
      })),
    },
    basePost: doc,
    files: [
      {
        name: "current.txt",
        mime: "text/plain",
        bytes: new TextEncoder().encode("Synthetic current file"),
      },
    ],
    operationId: "prepare-rotation",
  });
  const current = await writer.readSnapshot();
  const rotated = await rotateAccess({
    remote: current,
    oldKey: f.key,
    accounts: [
      { id: "admin", password: syntheticAdminPassword },
      { id: "user1", password: syntheticReaderPassword },
      { id: "user2", password: syntheticReaderPassword + "2" },
    ],
    revokedId: "user2",
    readBytes: async (ref) => f.backend.files.get(ref.path),
  });
  const read = async (ref) =>
    decodeJson(
      await decryptBytes(
        rotated.objects.get(ref.path),
        rotated.key,
        rotated.manifest.key_epoch,
        ref.object_id,
      ),
    );
  const index = await read(rotated.manifest.index),
    posts = (await Promise.all(index.months.map(read))).flatMap((m) => m.posts);
  const saved = posts.find((p) => p.id === doc.id);
  assert.equal(saved.attachments.length, 2);
  assert.ok(saved.attachments[0].superseded_at);
  assert.deepEqual(saved.document, doc.document);
  assert.deepEqual(
    workspaceSettings({ posts }),
    workspaceSettings(current.snapshot),
  );
  for (const file of saved.attachments)
    assert.ok(
      (
        await decryptBytes(
          rotated.objects.get(file.ref.path),
          rotated.key,
          rotated.manifest.key_epoch,
          file.ref.object_id,
        )
      ).length,
    );
  assert.deepEqual(
    rotated.manifest.accounts.map((a) => a.id),
    ["admin", "user1"],
  );
});
test("working summary keeps deadline labels separate from events and excludes cancelled/reference data", () => {
  const at = "2026-11-13T12:00:00+03:00";
  const p = {
    ...contentPost({ id: "admin", label: "QA" }, "post", at),
    type: "post",
    dates: [
      {
        id: "application",
        kind: "deadline",
        label: "Подать заявку",
        start: "2026-11-13T17:00:00+03:00",
      },
      {
        id: "payment",
        kind: "deadline",
        label: "Оплатить",
        start: "2026-11-16T17:00:00+03:00",
      },
      {
        id: "event",
        kind: "event",
        label: "Поездка",
        start: "2026-11-20T12:00:00+03:00",
      },
    ],
  };
  assert.deepEqual(
    upcomingActions([p], new Date(at), "deadline").map((x) => x.date.label),
    ["Подать заявку", "Оплатить"],
  );
  assert.equal(
    upcomingActions([p], new Date(at), "event")[0].date.label,
    "Поездка",
  );
  assert.equal(
    upcomingActions(
      [
        { ...p, type: "reference" },
        { ...p, state: "cancelled" },
      ],
      new Date(at),
    ).length,
    0,
  );
});
test("content settings and document replacement round-trip encrypted writer without changing reader accounts or other posts", async () => {
  const f = await createWorkspaceFixture(),
    writer = new GitDataWriter({
      request: f.backend.request,
      key: f.key,
      epoch: f.manifest.key_epoch,
      identity: f.identity,
    });
  const before = await writer.readSnapshot(),
    p = before.snapshot.posts.find((p) => p.id === "workspace-regulation"),
    settings = before.snapshot.posts.find((p) => p.id === SETTINGS_ID);
  const result = await writer.savePost({
    post: {
      ...p,
      document: { ...p.document, version: "2" },
      attachments: p.attachments.map((file) => ({
        ...file,
        superseded_at: moscowStamp(),
        version_label: "1",
      })),
    },
    basePost: p,
    files: [
      {
        name: "new.txt",
        mime: "text/plain",
        bytes: new TextEncoder().encode("Synthetic new version"),
      },
    ],
    operationId: "replace-file",
  });
  const saved = result.snapshot.posts.find((x) => x.id === p.id);
  assert.equal(saved.attachments.length, 2);
  assert.equal(saved.document.version, "2");
  for (const file of saved.attachments) {
    const bytes = await decryptBytes(
      f.backend.files.get(file.ref.path),
      f.key,
      f.manifest.key_epoch,
      file.ref.object_id,
    );
    assert.ok(bytes.length > 0);
  }
  assert.deepEqual(result.manifest.accounts, before.manifest.accounts);
  assert.deepEqual(
    result.snapshot.posts.filter((x) => x.id !== p.id),
    before.snapshot.posts.filter((x) => x.id !== p.id),
  );
  const update = {
    ...settings,
    workspace: {
      ...settings.workspace,
      tools: [
        ...DEFAULT_TOOLS,
        {
          id: "qa",
          title: "QA",
          description: "Example",
          url: "https://example.org",
          enabled: false,
        },
      ],
    },
  };
  await writer.savePost({
    post: update,
    basePost: settings,
    operationId: "settings-1",
  });
  const roundtrip = await writer.readSnapshot();
  assert.equal(workspaceSettings(roundtrip.snapshot).tools.length, 2);
  assert.equal(
    roundtrip.snapshot.posts.find((x) => x.id === p.id).attachments.length,
    2,
  );
  await assert.rejects(
    () =>
      writer.savePost({
        post: settings,
        basePost: settings,
        operationId: "stale-settings",
      }),
    PostConflict,
  );
});
