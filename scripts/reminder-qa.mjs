import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import axe from "axe-core";
import {
  createAdminFixture,
  installAdminRoutes,
  syntheticAdminPassword,
  syntheticReaderPassword,
} from "./admin-fixture.mjs";
import { GitDataWriter } from "../src/lib/writer.mjs";
import { inspectContrast } from "./contrast-check.mjs";
import { inspectInputs } from "./readability-qa.mjs";
const makePost = (id, dates) => ({
  id,
  category_id: "company",
  title: "Подарки учебной команде",
  body: "Подарки учебной команде. Заявки до 1 ноября 2026 в 18:00. Оплата до 10 ноября 2026. Подайте список участников и оплатите заказ.",
  source: "Тестовый отдел",
  author: { id: "admin", display_name: "Руководство" },
  priority: "normal",
  pinned: false,
  state: "active",
  created_at: "2026-10-15T12:00:00+03:00",
  updated_at: "2026-10-15T12:00:00+03:00",
  dates,
  history: [],
  reminded_at: [],
  links: [],
  attachments: [],
  expected_attachments: [],
  related: [],
});
export async function checkReminders(browser, url) {
  const cases = [];
  for (const width of [390, 430, 1280])
    for (const theme of ["light", "dark"]) {
      const post = makePost("qa-gifts", [
        {
          id: "request",
          kind: "deadline",
          label: "Подать заявку",
          start: "2026-11-01T18:00:00+03:00",
        },
        {
          id: "payment",
          kind: "deadline",
          label: "Оплатить подарки",
          start: "2026-11-10T00:00:00+03:00",
          allDay: true,
        },
      ]);
      const event = {
        ...makePost("qa-event", [
          {
            id: "tour",
            kind: "event",
            label: "Брокер-тур",
            start: "2026-10-27T12:00:00+03:00",
          },
        ]),
        title: "Учебная встреча",
        body: "Будущая учебная встреча",
      };
      const f = await createAdminFixture({ additionalPosts: [post, event] });
      const writer = new GitDataWriter({
        request: f.backend.request,
        key: f.key,
        epoch: f.manifest.key_epoch,
        identity: f.identity,
      });
      const contexts = [],
        errors = [];
      async function open(account, path = "", existing) {
        const context =
          existing ??
          (await browser.newContext({
            viewport: { width, height: 900 },
            colorScheme: theme,
            timezoneId: "America/Los_Angeles",
            bypassCSP: true,
          }));
        if (!existing) contexts.push(context);
        await context.addInitScript(() =>
          localStorage.setItem("frchat.manager-help.v1", "done"),
        );
        const page = await context.newPage();
        page.on("pageerror", (e) => errors.push(e.message));
        await page.clock.setFixedTime(new Date("2026-10-22T12:00:00+03:00"));
        await installAdminRoutes(page, f);
        await page.goto(url + path);
        await page.locator("#account-login").selectOption(account);
        await page
          .locator("#access-code")
          .fill(
            account === "admin"
              ? syntheticAdminPassword
              : syntheticReaderPassword + (account === "user2" ? "2" : ""),
          );
        await page.getByRole("button", { name: "Открыть FRchat" }).click();
        return page;
      }
      const writes = () =>
        f.backend.calls.filter((c) => c.method === "PATCH").length;
      async function audit(page, screen) {
        await page.addScriptTag({ content: axe.source });
        const violations = await page.evaluate(async () =>
          (
            await axe.run(document, {
              runOnly: { type: "rule", values: ["color-contrast"] },
            })
          ).violations.map((v) => ({
            id: v.id,
            targets: v.nodes.map((n) => n.target),
          })),
        );
        assert.deepEqual(violations, [], screen);
        const contrast = await page.evaluate(inspectContrast);
        assert.deepEqual(contrast.failures, [], screen);
        assert.deepEqual(await page.evaluate(inspectInputs), [], screen);
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
          screen,
        );
        await page.screenshot({
          path: `docs/qa/${width}-${theme}-reminder-${screen}.png`,
          fullPage: false,
        });
        cases.push({ width, theme, screen, minContrast: contrast.minRatio });
      }
      try {
        const readers = [];
        for (const account of ["user1", "user2"]) {
          const reader = await open(account, "#/post/qa-gifts");
          await reader.locator(".post-view").waitFor();
          await reader.goto(url + "#/feed");
          await reader.locator(".post-card").first().waitFor();
          assert.equal(
            await reader
              .locator('a[href="#/post/qa-gifts"] .unread-dot')
              .count(),
            0,
          );
          readers.push(reader);
        }
        const page = await open("admin", "#/post/qa-gifts");
        await page
          .getByRole("button", { name: "Напомнить", exact: true })
          .click();
        const panel = page.getByRole("region", {
          name: "Подтверждение напоминания",
        });
        assert.equal(await panel.getByRole("radio").count(), 2);
        await panel.getByRole("radio").nth(1).check();
        await audit(page, "select");
        // Retry after lost connectivity, then two clicks still make just one reminder.
        f.backend.offline = true;
        await panel
          .getByRole("button", { name: "Да, напомнить", exact: true })
          .click();
        await page
          .getByRole("alert")
          .filter({ hasText: "Нет интернета" })
          .waitFor();
        assert.equal(writes(), 0);
        f.backend.offline = false;
        await panel
          .getByRole("button", { name: "Да, напомнить", exact: true })
          .evaluate((e) => {
            e.click();
            e.click();
          });
        await page
          .getByRole("heading", { name: "Готово!", exact: true })
          .waitFor();
        assert.equal(writes(), 1);
        let saved = (await writer.readSnapshot()).snapshot.posts.find(
          (p) => p.id === post.id,
        );
        assert.equal(saved.reminded_at.length, 1);
        assert.equal(saved.reminded_at[0].date_id, "payment");
        assert.equal(
          saved.history.filter((h) => h.type === "edited").length,
          0,
        );
        await page.evaluate(() =>
          Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: {
              writeText: async (text) => {
                window.qaCopied = text;
              },
            },
          }),
        );
        await page
          .getByRole("button", { name: "Скопировать для MAX", exact: true })
          .click();
        const announcement = await page.evaluate(() => window.qaCopied),
          link = announcement.split("\n").at(-1);
        assert.match(announcement, /Оплатить подарки/);
        assert.doesNotMatch(announcement, /Подать заявку/);
        assert.equal(new URL(link).hash, "#/post/qa-gifts");
        await audit(page, "success");
        // Open the copied URL with no storage at all; password entry must retain this route.
        const clean = await open("user1", new URL(link).hash);
        await clean.locator(".post-view h1").waitFor();
        assert.equal(
          await clean.locator(".post-view h1").innerText(),
          post.title,
        );
        assert.equal(new URL(clean.url()).hash, "#/post/qa-gifts");
        assert.equal(
          await clean
            .locator(".post-badges")
            .getByText(/Изменено/)
            .count(),
          0,
        );
        await audit(clean, "link-after-login");
        for (const reader of readers) {
          const before = Number(
            await reader.locator(".nav-count").first().innerText(),
          );
          await reader.reload();
          await reader.locator(".post-card.fresh-reminder").first().waitFor();
          assert.equal(
            await reader
              .locator('a[href="#/post/qa-gifts"] .unread-dot')
              .count(),
            1,
          );
          assert.equal(
            Number(await reader.locator(".nav-count").first().innerText()),
            before + 1,
          );
          const first = reader.locator(".post-card").first();
          assert.match(await first.innerText(), /Подарки учебной команде/);
          assert.equal(
            await reader
              .locator('a.post-card-link[href="#/post/qa-gifts"]')
              .count(),
            1,
          );
        }
        await audit(readers[0], "feed");
        await page
          .getByRole("link", { name: "На главную", exact: true })
          .click();
        await page
          .getByRole("heading", { name: "Ваши публикации", exact: true })
          .waitFor();
        const card = page
          .locator(".manager-card")
          .filter({
            has: page.getByRole("heading", { name: post.title, exact: true }),
          })
          .first();
        assert.match(await card.innerText(), /Напоминали 1 раз/);
        await card
          .getByRole("button", { name: "Напомнить", exact: true })
          .click();
        await page.getByText(/Уже напоминали меньше часа/).waitFor();
        assert.equal(
          await page
            .getByRole("button", { name: "Да, напомнить", exact: true })
            .isDisabled(),
          true,
        );
        await audit(page, "repeat-warning");
        await page
          .getByRole("button", { name: "Назад к выбору", exact: true })
          .click();
        // No deadline: confirmation without a date selector, event label still visible.
        await page.goto(url + "#/post/qa-event");
        await page
          .getByRole("button", { name: "Напомнить", exact: true })
          .click();
        assert.equal(await page.getByRole("radio").count(), 0);
        assert.match(await panel.innerText(), /Брокер-тур/);
        await page
          .getByRole("button", { name: "Назад к выбору", exact: true })
          .click();
        // A pasted link/file is retained even if the administrator chooses to remind instead.
        await page.goto(url + "#/feed");
        await page
          .getByRole("link", { name: "+ Новая публикация", exact: true })
          .click();
        const incoming = post.body + "\nhttps://example.org/extra";
        await page
          .getByRole("textbox", { name: "Текст сообщения 1", exact: true })
          .fill(incoming);
        await page.locator("input[type=file]").setInputFiles({
          name: "qa-note.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("Synthetic draft attachment"),
        });
        await page
          .getByRole("button", { name: "Проверить", exact: true })
          .click();
        const compare = page.getByRole("region", {
          name: "Проверка похожей публикации",
        });
        await compare.waitFor();
        assert.equal(
          await compare.locator(".manager-compare article").count(),
          2,
        );
        assert.equal(await compare.locator("button.primary").count(), 0);
        await compare
          .getByRole("button", { name: "Напомнить о старой", exact: true })
          .click();
        assert.equal(await panel.getByRole("radio").count(), 2);
        await panel
          .getByRole("checkbox", { name: "Да, хочу напомнить повторно" })
          .check();
        await panel
          .getByRole("button", { name: "Да, напомнить", exact: true })
          .click();
        await page
          .getByRole("heading", { name: "Готово!", exact: true })
          .waitFor();
        assert.equal(writes(), 2);
        saved = (await writer.readSnapshot()).snapshot.posts.find(
          (p) => p.id === post.id,
        );
        assert.equal(saved.body, post.body);
        assert.equal(saved.attachments.length, 0);
        assert.equal(saved.reminded_at.length, 2);
        await page
          .getByRole("link", { name: "На главную", exact: true })
          .click();
        await page
          .getByRole("link", { name: "+ Новая публикация", exact: true })
          .click();
        await page
          .getByRole("heading", {
            name: "У вас есть неопубликованный текст — продолжить?",
            exact: true,
          })
          .waitFor();
        await page
          .getByRole("button", { name: "Продолжить", exact: true })
          .click();
        await compare.waitFor();
        assert.match(
          await page.locator(".manager-editor").innerText(),
          /qa-note.txt/,
        );
        await compare
          .getByRole("button", { name: "Дописать в старую", exact: true })
          .click();
        assert.match(
          await page.locator(".manager-preview .manager-body").innerText(),
          /example.org\/extra/,
        );
        await page
          .getByRole("button", { name: "Всё верно", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Опубликовать", exact: true })
          .click();
        await page
          .getByRole("heading", { name: "Готово!", exact: true })
          .waitFor();
        saved = (await writer.readSnapshot()).snapshot.posts.find(
          (p) => p.id === post.id,
        );
        assert.equal(saved.body, post.body + "\n\n" + incoming);
        assert.equal(saved.attachments[0].name, "qa-note.txt");
        assert.equal(saved.reminded_at.length, 2);
        assert.equal(writes(), 3);
        assert.deepEqual(errors, []);
      } finally {
        for (const context of contexts) await context.close();
      }
    }
  await writeFile(
    "docs/qa/reminder-report.json",
    JSON.stringify(
      {
        synthetic: true,
        cases,
        scenarios: [
          "selected deadline",
          "offline retry and double click",
          "clean browser deep link after password",
          "two readers unread counts",
          "single raised card",
          "12-hour warning",
          "event without selector",
          "duplicate draft and attachment recovery",
          "append preserves history",
        ],
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`Reminder QA: ${cases.length} cases passed`);
}
