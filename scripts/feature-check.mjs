import assert from "node:assert/strict";
import { installQaRoutes } from "./qa-fixture.mjs";
async function expectCards(page, count) {
  await page.waitForFunction(
    (expected) => document.querySelectorAll(".post-card").length === expected,
    count,
  );
  assert.equal(await page.locator(".post-card").count(), count);
}
// Invoked by theme-qa so the same browser and owned CI preview are reused.
export async function checkFavoritesAndReference(browser, url, fixture) {
  for (const colorScheme of ["light", "dark"]) {
    const context = await browser.newContext({
      colorScheme,
      viewport: { width: 390, height: 844 },
    });
    try {
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await installQaRoutes(page, fixture);
      await page.goto(url);
      await page.locator("#access-code").fill(fixture.code);
      await page.getByRole("button", { name: "Открыть FRchat" }).click();
      await page.locator(".post-card").first().waitFor();
      await page.locator('.bottom-nav a[href="#/favorites"]').click();
      await page
        .getByRole("heading", { name: "В избранном пока пусто" })
        .waitFor();
      assert.equal(
        await page
          .getByText("Избранное хранится на этом устройстве", { exact: true })
          .count(),
        1,
      );
      await page.goto(url + "#/feed");
      const card = page.locator('.post-card[data-category="meetings"]');
      await card.getByRole("button", { name: "Добавить в избранное" }).click();
      assert.match(page.url(), /#\/feed$/); // Star must not follow the enclosing card link.
      await card.locator(".post-card-link").click();
      await page.locator(".post-body").waitFor();
      await page.getByRole("button", { name: "Удалить из избранного" }).click();
      await page.getByRole("button", { name: "Добавить в избранное" }).click();
      await page.reload();
      await page
        .getByRole("button", { name: "Удалить из избранного" })
        .waitFor();
      assert.deepEqual(
        await page.evaluate(() =>
          JSON.parse(localStorage.getItem("frchat.favorites.v1")),
        ),
        ["qa-meetings"],
      );
      await page.goto(url + "#/archive");
      await page
        .locator('.post-card[data-category="council"]')
        .getByRole("button", { name: "Добавить в избранное" })
        .click();
      await page.goto(url + "#/favorites");
      await page.locator(".post-card").first().waitFor();
      await expectCards(page, 2);
      assert.equal(await page.locator(".status-closed").count(), 1);
      await page.goto(
        url + "#/feed?q=" + encodeURIComponent("тестовая публикация"),
      );
      await page.getByRole("button", { name: "Фильтры", exact: true }).click();
      await page.getByRole("checkbox", { name: "Только избранное" }).check();
      await page.waitForURL(/favorites=1/);
      await expectCards(page, 2);
      await page.reload();
      await page.locator(".post-card").first().waitFor();
      await expectCards(page, 2);
      // Simulate a tombstone and a post fully removed from a subsequent snapshot.
      await page.evaluate(() =>
        localStorage.setItem(
          "frchat.favorites.v1",
          JSON.stringify(["qa-deleted", "qa-removed"]),
        ),
      );
      await page.goto(url + "#/favorites");
      await page.reload();
      await page.locator(".missing-favorite").waitFor();
      assert.equal(await page.locator(".status-deleted").count(), 2);
      await page.locator(".post-card-link").click();
      await page
        .getByRole("button", { name: "В избранное", exact: true })
        .click();
      await page.locator(".missing-favorite").waitFor();
      await page
        .locator(".missing-favorite")
        .getByRole("button", { name: "Удалить из избранного" })
        .click();
      await page.locator(".missing-favorite").waitFor({ state: "detached" });
      assert.equal(await page.locator(".missing-favorite").count(), 0);
      await page.goto(url + "#/reference");
      await page
        .getByRole("heading", { name: "Контакты тестовой поддержки" })
        .waitFor();
      assert.equal(
        await page.locator(".category-chips [data-category]").count(),
        5,
      );
      assert.equal(
        await page.locator(".post-card .status-reference").count(),
        1,
      );
      await page
        .locator('.category-chips [data-category="reference-payments"]')
        .click();
      await page
        .getByRole("heading", { name: "Публикаций пока нет" })
        .waitFor();
      await expectCards(page, 0);
      await page
        .getByRole("button", { name: "Все категории", exact: true })
        .click();
      await page.locator(".post-card-link").click();
      await page
        .getByRole("button", { name: "В справочник", exact: true })
        .waitFor();
      await page.goto(
        url + "#/feed?q=" + encodeURIComponent("support@example.org"),
      );
      await page.locator(".post-card").first().waitFor();
      await expectCards(page, 1);
      await page.goto(
        url + "#/archive?q=" + encodeURIComponent("support@example.org"),
      );
      await page
        .getByRole("heading", { name: "Публикаций пока нет" })
        .waitFor();
      await expectCards(page, 0);
      assert.deepEqual(errors, []);
      // Denied storage must preserve the current tab's bookmarks and explain persistence limits.
      await context.addInitScript(() => {
        Storage.prototype.getItem = () => {
          throw new Error("Storage denied for QA");
        };
        Storage.prototype.setItem = () => {
          throw new Error("Storage denied for QA");
        };
        Storage.prototype.removeItem = () => {
          throw new Error("Storage denied for QA");
        };
      });
      await page.goto(url);
      await page.reload();
      await page.locator("#access-code").fill(fixture.code);
      await page.getByRole("button", { name: "Открыть FRchat" }).click();
      await page
        .locator(".post-card")
        .first()
        .getByRole("button", { name: "Добавить в избранное" })
        .click();
      await page
        .getByRole("status")
        .filter({ hasText: "Браузер не разрешил сохранить избранное" })
        .waitFor();
      await page.locator('.bottom-nav a[href="#/favorites"]').click();
      await page
        .getByRole("heading", { name: "Избранное", exact: true })
        .waitFor();
      await expectCards(page, 1);
      assert.deepEqual(errors, []);
      console.log(
        JSON.stringify({
          features: "favorites/reference",
          system_scheme: colorScheme,
          passed: true,
        }),
      );
    } finally {
      await context.close();
    }
  }
}
