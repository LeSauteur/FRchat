// Entirely artificial review content. This module never reads .local or samples.
import { createAdminFixture } from "./admin-fixture.mjs";
import {
  contentPost,
  DEFAULT_DOCUMENT_CATEGORIES,
  DEFAULT_TOOLS,
  SETTINGS_ID,
} from "../src/lib/workspace.mjs";
import { GitDataWriter, moscowStamp } from "../src/lib/writer.mjs";
import { dayKey } from "../src/lib/dates.mjs";
export function syntheticPdf() {
  const stream =
    "BT /F1 18 Tf 50 740 Td (Synthetic workspace document) Tj 0 -30 Td /F1 12 Tf (Preview only. No real company data.) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let text = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(text.length);
    text += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = text.length;
  text += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => String(n).padStart(10, "0") + " 00000 n \n")
    .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(text);
}
export async function createWorkspaceFixture() {
  const who = { id: "admin", label: "Учебный администратор", role: "admin" },
    at = moscowStamp();
  const materials = [
    [
      "workspace-regulation",
      "reference-instructions",
      "Как подготовить ежемесячный отчёт",
      "Порядок подготовки и отправки отчёта: от проверки цифр до передачи файла.",
      "1. Проверьте период и заполните учебный шаблон.\n\n2. Сверьте итоговые суммы.\n\n3. Отправьте файл на reports@example.org.\n\nЭто искусственная инструкция для проверки интерфейса. Реальные правила будут добавлены после согласования.",
    ],
    [
      "workspace-template",
      "document-templates",
      "Шаблон ежемесячного отчёта",
      "Таблица для подготовки отчётности. Скачайте и заполните копию.",
      "Откройте файл в Excel или другом табличном редакторе.\n\nКолонки: период, офис, показатель, сумма. Данные в примере вымышлены.",
    ],
    [
      "workspace-brand",
      "document-brand",
      "Правила использования логотипа",
      "Краткая памятка по размещению фирменного знака.",
      "Используйте утверждённые исходники и сохраняйте пропорции.\n\nЭтот пример демонстрирует карточку, требующую обновления; он не является брендбуком.",
    ],
  ].map(([id, category_id, title, description, body], i) => ({
    ...contentPost(who, id, at),
    category_id,
    title,
    body,
    document: {
      description,
      reviewed_on: dayKey(new Date()),
      owner: "Учебный отдел",
      version: "1.0",
      status: i === 2 ? "outdated" : "current",
    },
  }));
  const settings = {
    ...contentPost(who, SETTINGS_ID, at),
    title: "Настройки разделов",
    body: "Учебный каталог.",
    workspace: {
      version: 1,
      document_categories: structuredClone(DEFAULT_DOCUMENT_CATEGORIES),
      tools: structuredClone(DEFAULT_TOOLS),
    },
  };
  const fixture = await createAdminFixture({
    additionalPosts: [...materials, settings],
  });
  const writer = new GitDataWriter({
    request: fixture.backend.request,
    key: fixture.key,
    epoch: fixture.manifest.key_epoch,
    identity: fixture.identity,
  });
  for (const [i, files] of [
    [
      0,
      [
        {
          name: "synthetic-regulation.pdf",
          mime: "application/pdf",
          bytes: syntheticPdf(),
        },
      ],
    ],
    [
      1,
      [
        {
          name: "synthetic-monthly-report.csv",
          mime: "text/csv",
          bytes: new TextEncoder().encode(
            "\uFEFFПериод;Офис;Показатель;Сумма\nУчебный;Пример;Тест;0\n",
          ),
        },
      ],
    ],
  ]) {
    await writer.savePost({
      post: materials[i],
      basePost: materials[i],
      files,
      operationId: "fixture-file-" + i,
    });
  }
  return fixture;
}
