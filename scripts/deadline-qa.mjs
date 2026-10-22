import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import axe from "axe-core";
import {
  createAdminFixture,
  installAdminRoutes,
  syntheticReaderPassword,
} from "./admin-fixture.mjs";
import { inspectContrast } from "./contrast-check.mjs";
export async function checkDeadlines(browser, url) {
  const cases = [];
  for (const width of [390, 430, 1280])
    for (const theme of ["light", "dark"]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        colorScheme: theme,
        timezoneId: "Pacific/Honolulu",
        bypassCSP: true,
      });
      const page = await context.newPage(),
        errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const fixture = await createAdminFixture({
        additionalPosts: [
          {
            id: "qa-gifts",
            category_id: "company",
            title: "Учебные подарки: заявка и оплата",
            body: "Синтетический пример двух отдельных сроков.",
            source: "Тестовый отдел",
            author: { id: "admin", display_name: "Руководство" },
            priority: "normal",
            pinned: false,
            state: "active",
            created_at: "2026-10-15T12:00:00+03:00",
            updated_at: "2026-10-15T12:00:00+03:00",
            history: [],
            reminded_at: [],
            links: [],
            attachments: [],
            expected_attachments: [],
            related: [],
            dates: [
              {
                id: "request",
                kind: "deadline",
                label: "Заявки на подарки",
                start: "2026-11-01T18:00:00+03:00",
              },
              {
                id: "payment",
                kind: "deadline",
                label: "Оплата подарков",
                start: "2026-11-10T00:00:00+03:00",
                allDay: true,
              },
            ],
          },
        ],
      });
      try {
        await page.clock.setFixedTime(new Date("2026-11-08T12:00:00+03:00"));
        await installAdminRoutes(page, fixture);
        await page.goto(url + "#/post/qa-gifts");
        await page.locator("#account-login").selectOption("user1");
        await page.locator("#access-code").fill(syntheticReaderPassword);
        await page.getByRole("button", { name: "Открыть FRchat" }).click();
        await page.locator(".post-view").waitFor();
        assert.match(
          await page.locator(".date-row.deadline-expired").innerText(),
          /Заявки на подарки/,
        );
        assert.match(
          await page.locator(".date-row.deadline-approaching").innerText(),
          /Оплата подарков/,
        );
        for (const [stamp, kind] of [
          ["2026-11-08T12:00:00+03:00", "approaching"],
          ["2026-11-10T12:00:00+03:00", "urgent"],
        ]) {
          await page.clock.setFixedTime(new Date(stamp));
          await page.reload();
          await page.locator(`.date-row.deadline-${kind}`).waitFor();
          await page.addScriptTag({ content: axe.source });
          assert.deepEqual(
            await page.evaluate(async () =>
              (
                await axe.run(document, {
                  runOnly: { type: "rule", values: ["color-contrast"] },
                })
              ).violations.map((v) => v.id),
            ),
            [],
          );
          const contrast = await page.evaluate(inspectContrast);
          assert.deepEqual(contrast.failures, []);
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth > innerWidth,
            ),
            false,
          );
          await page.screenshot({
            path: `docs/qa/${width}-${theme}-deadline-${kind}.png`,
            fullPage: false,
          });
          cases.push({
            width,
            theme,
            timezone: "Pacific/Honolulu",
            screen: kind,
            minContrast: contrast.minRatio,
          });
        }
        await page.goto(url + "#/feed?q=Учебные%20подарки");
        const card = page
          .locator(".post-card")
          .filter({ hasText: "Учебные подарки" });
        await card.waitFor();
        assert.match(
          await card.locator(".card-date.deadline-urgent").innerText(),
          /Оплата подарков/,
        );
        assert.match(
          await card.locator(".completed-deadline").innerText(),
          /Заявки на подарки/,
        );
        await page.screenshot({
          path: `docs/qa/${width}-${theme}-deadline-feed.png`,
          fullPage: false,
        });
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    }
  await writeFile(
    "docs/qa/deadline-report.json",
    JSON.stringify({ synthetic: true, cases }, null, 2) + "\n",
  );
  console.log(
    `Deadline QA: ${cases.length} cases passed (Moscow cutoffs on Honolulu device)`,
  );
}
