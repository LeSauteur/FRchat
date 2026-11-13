import { chromium } from "playwright";
import axe from "axe-core";
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { startWorkspacePreview } from "./workspace-preview.mjs";
import { inspectContrast } from "./contrast-check.mjs";
import { GitDataWriter } from "../src/lib/writer.mjs";
const output = resolve("docs/qa/workspace");
await mkdir(output, { recursive: true });
const { server, fixture, url } = await startWorkspacePreview(4186);
const browser = await chromium.launch({
  headless: true,
  ...(process.platform === "win32" ? { channel: "msedge" } : {}),
});
const report = [],
  errors = [];
async function login(page, admin = false) {
  await page.goto(url);
  await page.locator("#account-login").selectOption(admin ? "admin" : "user1");
  await page
    .locator("#access-code")
    .fill(admin ? "qa-admin-password-only" : "qa-reader-password-only");
  await page.getByRole("button", { name: "Открыть FRchat" }).click();
  await page.locator(admin ? ".manager-app" : ".main-content").waitFor();
}
async function inspect(page, name) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  assert.equal(overflow, false, name + " horizontal overflow");
  const small = await page
    .locator("input:not([type=checkbox]):not([type=radio]),select,textarea")
    .evaluateAll((els) =>
      els
        .filter(
          (e) =>
            getComputedStyle(e).display !== "none" &&
            parseFloat(getComputedStyle(e).fontSize) < 16,
        )
        .map((e) => e.outerHTML.slice(0, 100)),
    );
  assert.deepEqual(small, [], name + " small inputs");
  await page.addScriptTag({ content: axe.source });
  const contrast = await page.evaluate(inspectContrast);
  assert.deepEqual(
    contrast.failures,
    [],
    name + " contrast " + JSON.stringify(contrast.failures),
  );
  const axeResult = await page.evaluate(async () =>
    window.axe.run(document, {
      runOnly: { type: "rule", values: ["color-contrast"] },
    }),
  );
  assert.equal(axeResult.violations.length, 0, name + " axe contrast");
  report.push({ name, contrast: contrast.minRatio, measured: contrast.tested });
}
try {
  for (const width of [390, 430, 1280])
    for (const colorScheme of ["light", "dark"]) {
      const context = await browser.newContext({
        viewport: { width, height: width === 1280 ? 960 : 844 },
        colorScheme,
        bypassCSP: true,
      });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      page.on("pageerror", (e) => errors.push(e.message));
      try {
        await login(page);
        for (const [screen, hash, ready] of [
          ["summary", "#/feed", ".work-summary"],
          ["calendar", "#/calendar", ".calendar-grid"],
          ["documents", "#/documents", ".document-card"],
          ["document", "#/post/workspace-regulation", ".document-info"],
          ["tools", "#/tools", ".tool-card"],
          [
            "search",
            "#/feed?q=" + encodeURIComponent("ежемесячный отчёт"),
            ".search-results",
          ],
        ]) {
          await page.goto(url + hash);
          await page.locator(ready).first().waitFor();
          await inspect(page, `${width}-${colorScheme}-${screen}`);
          await page.screenshot({
            path: resolve(output, `${width}-${colorScheme}-${screen}.png`),
            fullPage: false,
          });
        }
        await page.goto(url + "#/documents");
        await page
          .getByLabel("Найти документ", { exact: true })
          .fill("synthetic-monthly-report.csv");
        assert.equal(await page.locator(".document-card").count(), 1);
        await page.goto(url + "#/reference");
        await page
          .getByRole("heading", { name: "Документы", exact: true })
          .waitFor();
        await page.goto(url + "#/files");
        await page
          .getByRole("heading", { name: "Документы", exact: true })
          .waitFor();
        await page.goto(url + "#/reference?category=document-templates");
        await page.locator(".document-card").first().waitFor();
        assert.equal(await page.locator(".document-card").count(), 1);
        await page.reload();
        await page.locator(".document-card").first().waitFor();
        assert.equal(await page.locator(".document-card").count(), 1);
        for (const hash of ["#/favorites", "#/archive", "#/post/qa-meetings"]) {
          await page.goto(url + hash);
          await page.locator(".main-content").waitFor();
        }
        await page.goto(url + "#/post/workspace-regulation");
        const [download] = await Promise.all([
          page.waitForEvent("download"),
          page.locator(".attachment-actions .file-row").click(),
        ]);
        assert.equal(download.suggestedFilename(), "synthetic-regulation.pdf");
        assert.equal(
          (await readFile(await download.path())).subarray(0, 5).toString(),
          "%PDF-",
        );
        // The browser owns its PDF viewer. Headless Chromium may download a PDF
        // instead, or retain a pending "load" after committing its blob URL.
        // Require a real blob navigation OR a valid native PDF download.
        let resolveNative, nativeTimer, popup;
        const nativeDownload = new Promise((resolve, reject) => {
          resolveNative = resolve;
          nativeTimer = setTimeout(
            () =>
              reject(
                new Error(
                  "PDF preview produced neither a committed blob nor a native download: " +
                    popup?.url(),
                ),
              ),
            20000,
          );
        });
        const onNativeDownload = (d) => resolveNative({ download: d });
        const onPreviewPage = (p) => p.once("download", onNativeDownload);
        context.on("page", onPreviewPage);
        page.on("download", onNativeDownload);
        try {
          [popup] = await Promise.all([
            page.waitForEvent("popup"),
            page.getByRole("button", { name: "Просмотреть файл" }).click(),
          ]);
          const outcome = await Promise.race([
            popup
              .waitForURL(/^blob:/, { waitUntil: "commit" })
              .then(() => ({ view: true }))
              .catch((error) => {
                // A native download aborts navigation before its download event
                // is delivered. Keep waiting for the validated file in this case.
                if (error.message.includes("net::ERR_ABORTED"))
                  return new Promise(() => {});
                throw error;
              }),
            nativeDownload,
          ]);
          if (outcome.download) {
            assert.equal(
              (await readFile(await outcome.download.path()))
                .subarray(0, 5)
                .toString(),
              "%PDF-",
            );
          } else assert.match(popup.url(), /^blob:/);
        } finally {
          clearTimeout(nativeTimer);
          context.off("page", onPreviewPage);
          page.off("download", onNativeDownload);
          await popup?.close();
        }
        await page.goto(url + "#/tools");
        assert.equal(
          await page.locator(".tool-open").getAttribute("href"),
          "https://lesauteur.github.io/domian-7-days/",
        );
        const toggle = page.getByRole("button", {
          name: "Переключить светлую или тёмную тему",
        });
        await toggle.click();
        assert.equal(
          await page.locator("html").getAttribute("data-theme"),
          colorScheme === "dark" ? "light" : "dark",
        );
        await inspect(page, `${width}-${colorScheme}-manual-toggle`);
      } finally {
        await context.close();
      }
    }
  for (const colorScheme of ["light", "dark"]) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      colorScheme,
      bypassCSP: true,
    });
    await context.addInitScript(() =>
      localStorage.setItem("frchat.manager-help.v1", "done"),
    );
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    page.setDefaultTimeout(15000);
    try {
      await login(page, true);
      await page
        .getByRole("link", { name: "Документы и инструменты", exact: true })
        .click();
      await page.getByRole("button", { name: "+ Добавить документ" }).waitFor();
      await page
        .getByRole("button", { name: "Категории", exact: true })
        .click();
      await page.getByRole("button", { name: "+ Добавить категорию" }).click();
      await page
        .getByRole("textbox", { name: "Название категории" })
        .last()
        .fill("Учебные материалы " + colorScheme);
      await page
        .getByRole("button", { name: "Сохранить категории и инструменты" })
        .click();
      await page.getByRole("status").waitFor();
      await page
        .getByRole("button", { name: "Инструменты", exact: true })
        .click();
      await page.getByRole("button", { name: "+ Добавить инструмент" }).click();
      await page
        .getByRole("textbox", { name: "Название инструмента" })
        .last()
        .fill("Учебный сервис " + colorScheme);
      await page
        .getByRole("textbox", { name: "Для чего нужен" })
        .last()
        .fill("Искусственный пример для проверки управления.");
      await page
        .getByRole("textbox", { name: "Адрес сайта" })
        .last()
        .fill("https://example.org/workspace-" + colorScheme);
      await inspect(page, `390-${colorScheme}-admin-tools`);
      await page.screenshot({
        path: resolve(output, `390-${colorScheme}-admin-tools.png`),
        fullPage: true,
      });
      const parallelWriter = new GitDataWriter({
        request: fixture.backend.request,
        key: fixture.key,
        epoch: fixture.manifest.key_epoch,
        identity: fixture.identity,
      });
      const parallelSnapshot = await parallelWriter.readSnapshot();
      const parallelSettings = parallelSnapshot.snapshot.posts.find(
        (p) => p.id === "frchat-workspace-settings",
      );
      await parallelWriter.savePost({
        post: { ...parallelSettings, body: "Synthetic simultaneous update" },
        basePost: parallelSettings,
        operationId: "parallel-" + colorScheme,
      });
      await page
        .getByRole("button", { name: "Сохранить категории и инструменты" })
        .click();
      await page
        .getByRole("heading", { name: "Какой вариант оставить?", exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "Оставить мои изменения", exact: true })
        .click();
      await page.getByRole("status").waitFor();
      await page
        .getByRole("button", { name: "Документы", exact: true })
        .click();
      await page.getByRole("button", { name: "+ Добавить документ" }).click();
      await page
        .getByRole("textbox", { name: "Название", exact: true })
        .fill("Учебная памятка " + colorScheme);
      await page
        .getByLabel("Категория")
        .selectOption({ label: "Учебные материалы " + colorScheme });
      await page
        .getByRole("textbox", { name: "Краткое описание" })
        .fill("Проверка самостоятельной публикации документа.");
      await page
        .getByRole("textbox", { name: "Текст и инструкция" })
        .fill(
          "Искусственный материал. Его можно исправить и скачать вложение.",
        );
      await page.locator("input[type=file]").setInputFiles({
        name: "synthetic-note.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("Synthetic document attachment"),
      });
      await page.getByText("synthetic-note.txt", { exact: true }).waitFor();
      await inspect(page, `390-${colorScheme}-admin-document`);
      await page.screenshot({
        path: resolve(output, `390-${colorScheme}-admin-document.png`),
        fullPage: true,
      });
      await page.reload();
      // Admin deliberately does not remember the password by default. Re-enter it
      // after reopening; the separately encrypted draft and files must survive.
      await page.locator("#account-login").selectOption("admin");
      await page.locator("#access-code").fill("qa-admin-password-only");
      await page.getByRole("button", { name: "Открыть FRchat" }).click();
      await page
        .getByRole("button", { name: "Продолжить", exact: true })
        .click();
      await page.getByText("synthetic-note.txt", { exact: true }).waitFor();
      assert.equal(
        await page
          .getByRole("textbox", { name: "Название", exact: true })
          .inputValue(),
        "Учебная памятка " + colorScheme,
      );
      fixture.backend.offline = true;
      await page
        .getByRole("button", { name: "Сохранить материал", exact: true })
        .click();
      await page.getByRole("alert").waitFor();
      assert.match(await page.getByRole("alert").innerText(), /Текст сохранён/);
      fixture.backend.offline = false;
      await page.getByRole("button", { name: "Повторить сохранение" }).click();
      await page.getByRole("status").waitFor();
      const writer = new GitDataWriter({
        request: fixture.backend.request,
        key: fixture.key,
        epoch: fixture.manifest.key_epoch,
        identity: fixture.identity,
      });
      const snapshot = (await writer.readSnapshot()).snapshot;
      assert.equal(
        snapshot.posts.filter(
          (p) => p.title === "Учебная памятка " + colorScheme,
        ).length,
        1,
      );
      await page
        .getByRole("button", { name: "Изменить материал" })
        .last()
        .waitFor();
      await page.goto(url + "#/feed");
      await page.getByRole("button", { name: "Как видят участники" }).click();
      await page.goto(url + "#/documents");
      await page
        .getByRole("heading", {
          name: "Учебная памятка " + colorScheme,
          exact: true,
        })
        .waitFor();
    } finally {
      fixture.backend.offline = false;
      await context.close();
    }
  }
  assert.deepEqual(errors, []);
  await writeFile(
    resolve(output, "report.json"),
    JSON.stringify(
      {
        screens: report,
        errors,
        checks: [
          "four sections",
          "old routes",
          "global and document search",
          "secure file download and preview",
          "both themes and manual toggle",
          "admin creates categories and tools",
          "encrypted draft and attachment recovery",
          "offline retry without duplicate",
          "simultaneous settings edit requires an explicit choice",
          "legacy document category URL persists after reload",
        ],
        syntheticOnly: true,
      },
      null,
      2,
    ),
  );
  console.log(
    `Workspace QA passed: ${report.length} contrast/layout checks, no page errors.`,
  );
} finally {
  await browser.close();
  await new Promise((ok) => server.close(ok));
}
