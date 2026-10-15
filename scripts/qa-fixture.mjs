// Synthetic content only. Never load samples or the pilot access code for public QA artifacts.
import {
  newKdf,
  deriveKey,
  encryptedObject,
  encryptBytes,
  sha256,
} from "../src/lib/crypto.mjs";
import { addDays, dayKey, dayStart } from "../src/lib/dates.mjs";
export async function createQaFixture() {
  const now = new Date(),
    today = dayKey(now);
  const stamp = (offset) =>
    new Date(+now + offset * 3_600_000 + 3 * 3_600_000)
      .toISOString()
      .replace("Z", "+03:00");
  const categories = [
    ["reporting", "Отчётность"],
    ["office-requests", "Запросы к офисам"],
    ["money", "Роялти и мотивация"],
    ["meetings", "Собрания"],
    ["council", "Совет"],
    ["ethics", "Этика"],
    ["education", "Обучение"],
    ["developers", "Брокер-туры"],
    ["partners", "Партнёры"],
    ["it", "IT"],
    ["security", "Безопасность"],
    ["company", "Жизнь компании"],
  ].map(([id, name]) => ({ id, name, emoji: "", retention_days: 90 }));
  const posts = categories.map((category, i) => ({
    id: `qa-${category.id}`,
    category_id: category.id,
    title: `${category.name}: тестовая публикация`,
    body: "Обезличенный пример для проверки интерфейса.\n\nРабочая информация, сроки и ссылки остаются читаемыми в обеих темах.",
    source: "Тестовый отдел",
    author: { id: "qa", display_name: "Администратор" },
    priority: i % 3 ? "normal" : "important",
    pinned: i < 4,
    created_at: stamp(-48 - i),
    updated_at: stamp(-2),
    state: "active",
    dates: [],
    links: [],
    attachments: [],
    expected_attachments: [],
    related: [],
    history: [
      {
        id: `history-${i}`,
        at: stamp(-4),
        text: "Уточнены сроки и условия участия",
        type: "edited",
        by: "Администратор",
      },
    ],
    reminded_at: [{ id: `reminder-${i}`, at: stamp(-3) }],
  }));
  posts[0].dates = [
    {
      id: "overdue",
      kind: "deadline",
      start: stamp(-1),
      label: "Срок передачи тестового отчёта",
    },
  ];
  posts[1].dates = [
    {
      id: "tomorrow",
      kind: "deadline",
      start: stamp(24),
      label: "Передать данные",
    },
  ];
  posts[3].dates = [
    {
      id: "ongoing",
      kind: "event",
      start: stamp(-0.5),
      end: stamp(1),
      label: "Встреча команды",
    },
  ];
  posts[3].links = [
    {
      type: "meeting",
      url: "https://example.org/qa-meeting",
      label: "Тестовая встреча",
    },
  ];
  posts[3].related = ["qa-council"];
  posts[4].state = "closed";
  posts[4].closed_at = stamp(-24);
  posts[4].dates = [
    {
      id: "past",
      kind: "event",
      start: stamp(-72),
      label: "Прошедшая встреча",
    },
  ];
  posts[5].state = "postponed";
  posts[5].dates = [
    {
      id: "moved",
      kind: "event",
      start: stamp(-24),
      label: "Новая дата уточняется",
    },
  ];
  posts[6].state = "cancelled";
  posts[6].dates = [{ id: "cancelled", kind: "event", start: stamp(-48) }];
  posts[7].dates = [
    {
      id: "upcoming",
      kind: "event",
      start: stamp(25),
      label: "Будущее мероприятие",
    },
  ];
  posts[8].expected_attachments = [{ label: "Тестовый шаблон таблицы" }];
  const kdf = newKdf(),
    code = "synthetic-qa-not-a-pilot-password";
  const epoch = "0123456789abcdef0123456789abcdef";
  const key = await deriveKey(code, kdf);
  const objects = new Map();
  const bytes = new TextEncoder().encode("Synthetic QA file");
  const encrypted = await encryptBytes(bytes, key, epoch, "qa-file");
  const hash = await sha256(encrypted);
  const fileRef = {
    path: `objects/${hash}.bin`,
    sha256: hash,
    object_id: "qa-file",
  };
  objects.set(fileRef.path, encrypted);
  posts[3].attachments = [
    {
      id: "qa-file",
      name: "example.xlsx",
      mime: "application/octet-stream",
      size: bytes.length,
      sha256: await sha256(bytes),
      ref: fileRef,
    },
  ];
  async function store(data, id) {
    const object = await encryptedObject(data, key, epoch, id);
    objects.set(object.ref.path, object.bytes);
    return object.ref;
  }
  const month = await store({ schema_version: 1, posts }, "qa-month");
  const index = await store(
    {
      schema_version: 1,
      generated_at: now.toISOString(),
      period: { from: addDays(today, -30), to: today },
      count: posts.length,
      categories,
      birthdays: [{ name: "Участник пилота", date: today.slice(5) }],
      months: [month],
    },
    "qa-index",
  );
  const manifest = {
    schema: "frchat-manifest/1",
    key_epoch: epoch,
    kdf,
    index,
  };
  return { code, manifest, objects };
}
export async function installQaRoutes(page, fixture) {
  await page.route("**/config.json", (route) =>
    route.fulfill({
      json: {
        dataSources: ["./pilot-data/"],
        feedbackUrl: "",
        dailyTaskUrl: "https://example.org/qa-days.json",
        dailyTaskHome: "https://example.org/",
      },
    }),
  );
  await page.route("**/pilot-data/manifest.json", (route) =>
    route.fulfill({ json: fixture.manifest }),
  );
  await page.route("**/pilot-data/objects/*", (route) => {
    const key =
      "objects/" + new URL(route.request().url()).pathname.split("/").at(-1);
    const bytes = fixture.objects.get(key);
    return route.fulfill(
      bytes
        ? { contentType: "application/octet-stream", body: Buffer.from(bytes) }
        : { status: 404 },
    );
  });
  // The real integration is intentionally unavailable; screenshots reflect the pilot's honest fallback.
  await page.route("https://example.org/qa-days.json", (route) =>
    route.fulfill({ status: 404 }),
  );
}
