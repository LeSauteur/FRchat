import { chromium } from "playwright";
import axe from "axe-core";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { startWorkspacePreview } from "./workspace-preview.mjs";
import { inspectContrast } from "./contrast-check.mjs";
import { instruction } from "../src/lib/instruction.mjs";

const output = resolve(
  process.env.FRCHAT_QA_OUTPUT ?? ".local/qa/instruction-20261119/instruction",
);
await mkdir(output, { recursive: true });
const { server, url } = await startWorkspacePreview(4193);
const browser = await chromium.launch({
  headless: true,
  ...(process.platform === "win32" ? { channel: "msedge" } : {}),
});
const screens = [],
  errors = [];
async function inspect(page, name) {
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    name + " overflow",
  );
  assert.equal(
    await page.locator(".main-content h1").count(),
    1,
    name + " single title",
  );
  assert.equal(
    await page
      .locator('a[href="#/documents"][aria-current=page]:visible')
      .count(),
    1,
    name + " documents navigation",
  );
  const contrast = await page.evaluate(inspectContrast);
  assert.deepEqual(
    contrast.failures,
    [],
    name + " contrast: " + JSON.stringify(contrast.failures),
  );
  await page.addScriptTag({ content: axe.source });
  const result = await page.evaluate(async () =>
    window.axe.run(document, {
      runOnly: { type: "rule", values: ["color-contrast"] },
    }),
  );
  assert.equal(result.violations.length, 0, name + " axe contrast");
  screens.push({ name, minRatio: contrast.minRatio, tested: contrast.tested });
}
try {
  for (const width of [390, 430, 1280])
    for (const colorScheme of ["light", "dark"]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        colorScheme,
        bypassCSP: true,
        permissions: ["clipboard-read", "clipboard-write"],
      });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      page.on("pageerror", (error) => errors.push(error.message));
      try {
        await page.goto(url + "#/documents/instruction/registration");
        assert.equal(
          await page.locator(".instruction-view").count(),
          0,
          "normal login gate remains in place",
        );
        await page.locator("#account-login").selectOption("user1");
        await page.locator("#access-code").fill("qa-reader-password-only");
        await page
          .getByRole("button", { name: "Открыть FRchat", exact: true })
          .click();
        await page.locator(".instruction-view").waitFor();
        for (const article of instruction.articles) {
          await page.goto(url + "#/documents/instruction/" + article.slug);
          await page
            .getByRole("heading", { name: article.title, exact: true })
            .waitFor();
          await inspect(page, `${width}-${colorScheme}-${article.slug}`);
          if (
            [
              "registration",
              "groups",
              "offices",
              "important-contacts",
            ].includes(article.slug)
          )
            await page.screenshot({
              path: resolve(
                output,
                `${width}-${colorScheme}-${article.slug}.png`,
              ),
              fullPage: false,
            });
        }
        await page.goto(url + "#/documents");
        await page
          .getByLabel("Найти документ", { exact: true })
          .fill("Лилекина");
        assert.equal(await page.locator(".instruction-card").count(), 1);
        await page.locator(".instruction-card").click();
        assert.equal(
          await page.locator(".instruction-person").count(),
          1,
          "catalog result opens filtered contact",
        );
        await page.getByLabel("Найти контакт", { exact: true }).fill("съемка");
        assert.equal(await page.locator(".instruction-person").count(), 1);
        await page
          .getByRole("heading", { name: "Плешаков Тимур", exact: true })
          .waitFor();
        await page.getByLabel("Найти контакт", { exact: true }).fill("928 774");
        await page
          .getByRole("heading", { name: "Поползина Екатерина", exact: true })
          .waitFor();
        await page.reload();
        assert.equal(
          await page.getByLabel("Найти контакт", { exact: true }).inputValue(),
          "928 774",
        );
        await page
          .getByRole("heading", { name: "Поползина Екатерина", exact: true })
          .waitFor();
        await page
          .getByLabel("Поиск по всему пространству", { exact: true })
          .fill("Лилекина");
        await page.getByRole("button", { name: "Найти", exact: true }).click();
        await page
          .locator(".instruction-search-results .instruction-card")
          .waitFor();
        assert.equal(
          await page
            .locator(".instruction-search-results .instruction-card")
            .count(),
          1,
        );
        await page
          .locator(".instruction-search-results .instruction-card")
          .click();
        assert.equal(
          await page.locator(".instruction-person").count(),
          1,
          "global result opens filtered contact",
        );
        await page.goto(
          url +
            "#/documents/instruction/groups?q=" +
            encodeURIComponent("Иловайский"),
        );
        assert.equal(await page.locator(".instruction-group").count(), 1);
        await page.reload();
        await page.getByLabel("Найти группу MAX", { exact: true }).waitFor();
        assert.equal(await page.locator(".instruction-group").count(), 1);
        await page
          .getByRole("link", { name: "Документы", exact: true })
          .first()
          .click();
        await page
          .getByRole("heading", { name: "Документы", exact: true })
          .waitFor();
        await page.goBack();
        await page.getByLabel("Найти группу MAX", { exact: true }).waitFor();
        assert.equal(await page.locator(".instruction-group").count(), 1);
        await page.goto(
          url + "#/documents/instruction/groups?category=Новостройки",
        );
        assert.equal(await page.locator(".instruction-group").count(), 35);
        await page
          .getByRole("button", { name: "Ипотека", exact: true })
          .click();
        assert.equal(await page.locator(".instruction-group").count(), 2);
        await page
          .getByLabel("Найти группу MAX", { exact: true })
          .fill("неттакойгруппы");
        await page
          .getByRole("heading", { name: "Ничего не найдено", exact: true })
          .waitFor();
        await page
          .getByRole("button", { name: "Сбросить поиск", exact: true })
          .click();
        assert.equal(await page.locator(".instruction-group").count(), 43);
        await page.goto(url + "#/documents/instruction/offices");
        await page.getByLabel("Найти офис", { exact: true }).fill("Шахты");
        assert.equal(await page.locator(".instruction-person").count(), 2);
        await page
          .getByRole("button", { name: "Офисы Павла Орлова", exact: true })
          .click();
        await page.getByLabel("Найти офис", { exact: true }).fill("");
        assert.equal(await page.locator(".instruction-person").count(), 9);
        await page.reload();
        await page.getByLabel("Найти офис", { exact: true }).waitFor();
        assert.equal(await page.locator(".instruction-person").count(), 9);
        await page.goto(url + "#/documents/instruction/registration");
        await page.getByRole("checkbox", { name: "ИНН", exact: true }).check();
        await page.getByText("Готово 1 из 6", { exact: true }).waitFor();
        await page
          .getByRole("button", { name: "Скопировать шапку ⧉", exact: true })
          .click();
        await page
          .getByRole("status")
          .filter({ hasText: "Скопировано" })
          .waitFor();
        assert.match(
          await page.evaluate(() => navigator.clipboard.readText()),
          /Стажёр или агент с опытом \(45%\)/,
        );
        await page.reload();
        await page.getByText("Готово 0 из 6", { exact: true }).waitFor();
        await page.goto(url + "#/documents/instruction/documents");
        for (const file of instruction.files) {
          const [download] = await Promise.all([
            page.waitForEvent("download"),
            page.locator(`a[href="./instruction-files/${file.name}"]`).click(),
          ]);
          const bytes = await readFile(await download.path());
          assert.equal(
            createHash("sha256").update(bytes).digest("hex"),
            file.sha256,
          );
        }
        await page.goto(url + "#/documents/instruction/not-a-section");
        await page
          .getByRole("heading", {
            name: "Раздел инструкции не найден",
            exact: true,
          })
          .waitFor();
        await page.goto(url + "#/reference");
        await page
          .getByRole("heading", { name: "Документы", exact: true })
          .waitFor();
        await page.screenshot({
          path: resolve(output, `${width}-${colorScheme}-documents.png`),
          fullPage: false,
        });
      } finally {
        await context.close();
      }
    }
  assert.deepEqual(errors, []);
  await writeFile(
    resolve(output, "report.json"),
    JSON.stringify(
      {
        screens,
        errors,
        checks: [
          "normal login",
          "native routes",
          "all 12 sections",
          "catalog and global search",
          "contacts by name and phone",
          "directory query and category persist through reload and browser back",
          "MAX category deep link and reset",
          "office groups",
          "checklist and copy",
          "reload without storing checklist",
          "all 3 downloads and SHA256",
          "legacy routes",
          "missing article",
        ],
        source: instruction.source_revision,
        privateData: "synthetic only; imported instruction is already public",
      },
      null,
      2,
    ),
  );
  console.log(
    `Instruction QA passed: ${screens.length} contrast/layout checks, search, filters, copy and downloads; no page errors.`,
  );
} finally {
  await browser.close();
  await new Promise((ok) => server.close(ok));
}
