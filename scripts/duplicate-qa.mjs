import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import axe from "axe-core";
import {
  createAdminFixture,
  installAdminRoutes,
  syntheticAdminPassword,
} from "./admin-fixture.mjs";
import { captureText } from "../src/lib/capture.mjs";
import { GitDataWriter } from "../src/lib/writer.mjs";
import { occurrences } from "../src/lib/dates.mjs";
import { inspectContrast } from "./contrast-check.mjs";
const oldText =
  "БРОКЕР-ТУР: учебный квартал\n27 октября 2026 в 11:00. Приглашаем на презентацию и прогулку по территории. Запись по ссылке https://example.org/old-tour";
const newText = oldText.replace("old-tour", "new-tour");
const makePost = (id, text) => ({
  id,
  type: "post",
  ...captureText([text], "2026-10-21T12:00:00+03:00"),
  created_at: "2026-10-01T12:00:00+03:00",
  updated_at: "2026-10-01T12:00:00+03:00",
  author: { id: "admin", display_name: "Руководство" },
  state: "active",
  priority: "normal",
  pinned: false,
  attachments: [],
  expected_attachments: [],
  history: [],
  reminded_at: [],
  related: [],
});
export async function checkDuplicateFlows(browser, url) {
  const cases = [];
  for (const width of [390, 430, 1280])
    for (const theme of ["light", "dark"]) {
      const old = makePost("old-tour", oldText),
        series = {
          ...makePost(
            "qa-weekly",
            "Еженедельное собрание офисов. Каждый вторник онлайн.",
          ),
          category_id: "reminders",
          dates: [
            {
              id: "weekly-date",
              kind: "event",
              start: "2026-09-29T11:00:00+03:00",
              recurrence: {
                frequency: "weekly",
                weekdays: [2],
                occurrence_links: [
                  {
                    occurrence_date: "2026-09-29",
                    url: "https://example.org/sep29",
                  },
                  {
                    occurrence_date: "2026-10-20",
                    url: "https://example.org/oct20",
                  },
                ],
              },
            },
          ],
        };
      const fixture = await createAdminFixture({
        additionalPosts: [old, series],
      });
      const writer = new GitDataWriter({
        request: fixture.backend.request,
        key: fixture.key,
        epoch: fixture.manifest.key_epoch,
        identity: fixture.identity,
      });
      const context = await browser.newContext({
        viewport: { width, height: width === 390 ? 844 : 960 },
        colorScheme: theme,
        bypassCSP: true,
      });
      context.setDefaultTimeout(15000);
      await context.addInitScript(() =>
        localStorage.setItem("frchat.manager-help.v1", "done"),
      );
      const page = await context.newPage(),
        errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await installAdminRoutes(page, fixture);
      const writes = () =>
        fixture.backend.calls.filter((c) => c.method === "PATCH").length;
      async function start(text) {
        await page.goto(url + "#/feed");
        await page
          .getByRole("link", { name: "+ Новая публикация", exact: true })
          .click();
        await page
          .getByRole("textbox", { name: "Текст сообщения 1", exact: true })
          .fill(text);
        await page
          .getByRole("button", { name: "Проверить", exact: true })
          .click();
        await page
          .getByRole("heading", { name: "Проверьте", exact: true })
          .waitFor();
      }
      async function audit(screen) {
        await page.addScriptTag({ content: axe.source });
        const violations = await page.evaluate(async () =>
          (
            await window.axe.run(document, {
              runOnly: { type: "rule", values: ["color-contrast"] },
            })
          ).violations.map((v) => v.id),
        );
        const contrast = await page.evaluate(inspectContrast);
        assert.deepEqual(violations, []);
        assert.deepEqual(contrast.failures, []);
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
        );
        await page.screenshot({
          path: `docs/qa/${width}-${theme}-admin-${screen}.png`,
          fullPage: true,
        });
        cases.push({
          width,
          theme,
          screen,
          minRatio: contrast.minRatio,
          contrast_violations: 0,
        });
      }
      try {
        await page.goto(url);
        await page.locator("#account-login").selectOption("admin");
        await page.locator("#access-code").fill(syntheticAdminPassword);
        await page.getByRole("button", { name: "Открыть FRchat" }).click();
        await page
          .getByRole("heading", { name: "Ваши публикации", exact: true })
          .waitFor();
        await start(newText);
        const notice = page.getByRole("region", {
          name: "Проверка похожей публикации",
        });
        await notice.waitFor();
        assert.equal(
          await notice.locator(".manager-compare article").count(),
          2,
        );
        assert.equal(await notice.locator("button.primary").count(), 0);
        assert.equal(
          await page
            .getByRole("button", { name: "Всё верно", exact: true })
            .count(),
          0,
        );
        assert.equal(
          await notice
            .getByRole("button", {
              name: "Напомнить о старой",
              exact: true,
            })
            .isDisabled(),
          false,
        );
        assert.equal(writes(), 0);
        await audit("duplicate-new-link");
        await notice
          .getByRole("button", { name: "Дописать в старую", exact: true })
          .click();
        assert.equal(writes(), 0);
        await page
          .getByRole("button", { name: "Всё верно", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Опубликовать", exact: true })
          .click();
        await page
          .getByRole("heading", { name: "Готово!", exact: true })
          .waitFor();
        let state = (await writer.readSnapshot()).snapshot;
        assert.equal(state.posts.filter((p) => p.id === "old-tour").length, 1);
        assert.equal(
          state.posts.find((p) => p.id === "old-tour").body,
          old.body + "\n\n" + newText,
        );
        assert.equal(
          state.posts.find((p) => p.id === "old-tour").created_at,
          old.created_at,
        );
        assert.equal(
          state.posts.find((p) => p.id === "old-tour").reminded_at.length,
          0,
        );
        assert.equal(writes(), 1);
        const weeklyText =
          "Еженедельное собрание офисов\n27 октября 2026 в 11:30. Ссылка на подключение https://domian.ktalk.ru/qa-oct27";
        await start(weeklyText + "\nhttps://domian.ktalk.ru/qa-extra-link");
        await page
          .getByRole("button", {
            name: "Добавить ссылку к собранию 27 октября",
            exact: true,
          })
          .click();
        await page
          .getByRole("alert")
          .filter({ hasText: "Оставьте одну ссылку" })
          .waitFor();
        assert.equal(writes(), 1);
        await page
          .getByRole("button", { name: "Изменить текст и файлы", exact: true })
          .click();
        await page
          .getByRole("textbox", { name: "Текст сообщения 1", exact: true })
          .fill(weeklyText);
        await page
          .getByRole("button", { name: "Проверить", exact: true })
          .click();
        await page
          .getByRole("button", {
            name: "Добавить ссылку к собранию 27 октября",
            exact: true,
          })
          .waitFor();
        assert.equal(
          await page
            .getByRole("button", {
              name: "Напомнить о старой",
              exact: true,
            })
            .count(),
          0,
        );
        await audit("series-link");
        await page
          .getByRole("button", {
            name: "Добавить ссылку к собранию 27 октября",
            exact: true,
          })
          .click();
        assert.equal(writes(), 1);
        assert.match(
          await page.locator(".manager-preview").innerText(),
          /27 октября.*11:30/s,
        );
        assert.ok(
          (await page.locator(".manager-preview").innerText()).includes(
            "Подключиться к этой встрече",
          ),
        );
        await audit("series-review");
        await page
          .getByRole("button", { name: "Всё верно", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Опубликовать", exact: true })
          .click();
        await page
          .getByRole("heading", { name: "Готово!", exact: true })
          .waitFor();
        state = (await writer.readSnapshot()).snapshot;
        const updated = state.posts.find((p) => p.id === "qa-weekly");
        assert.equal(state.posts.length, fixture.posts.length);
        assert.equal(updated.body, series.body);
        assert.equal(updated.reminded_at.length, 0);
        const dates = occurrences(updated, "2026-09-28", "2026-11-05");
        assert.equal(
          dates.find((d) => d.occurrence_date === "2026-10-20").meeting_url,
          "https://example.org/oct20",
        );
        assert.equal(
          dates.find((d) => d.occurrence_date === "2026-10-27").meeting_url,
          "https://domian.ktalk.ru/qa-oct27",
        );
        assert.equal(
          dates.find((d) => d.occurrence_date === "2026-10-27").start,
          "2026-10-27T11:30:00+03:00",
        );
        assert.equal(
          dates.find((d) => d.occurrence_date === "2026-11-03").meeting_url,
          undefined,
        );
        assert.equal(
          dates.find((d) => d.occurrence_date === "2026-11-03").start,
          "2026-11-03T11:00:00+03:00",
        );
        await start(newText);
        await page
          .getByRole("button", { name: "Опубликовать как новую", exact: true })
          .click();
        assert.equal(writes(), 2);
        await page
          .getByRole("button", { name: "Всё верно", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Опубликовать", exact: true })
          .click();
        await page
          .getByRole("heading", { name: "Готово!", exact: true })
          .waitFor();
        state = (await writer.readSnapshot()).snapshot;
        assert.equal(state.posts.length, fixture.posts.length + 1);
        assert.equal(writes(), 3);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    }
  await writeFile(
    "docs/qa/duplicate-report.json",
    JSON.stringify(
      {
        synthetic: true,
        cases,
        scenarios: {
          new_link_offers_append: true,
          append_preserves_existing_body: true,
          selection_does_not_publish: true,
          update_preserves_id: true,
          new_post_explicit: true,
          series_occurrence_only: true,
          neighboring_weeks_unchanged: true,
        },
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      duplicate_cases: cases.length,
      themes: 2,
      widths: [390, 430, 1280],
      passed: true,
    }),
  );
}
