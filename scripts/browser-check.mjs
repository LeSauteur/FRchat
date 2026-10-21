import { chromium } from "playwright";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APP_URL = new URL(process.env.FRCHAT_URL ?? "http://127.0.0.1:4173/")
  .href;
if (!APP_URL.endsWith("/"))
  throw new Error("Адрес приложения должен заканчиваться на /");
const outputRoot = resolve(
  root,
  process.env.FRCHAT_URL ? ".local/browser-live" : ".local/browser",
);
await mkdir(outputRoot, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.platform === "win32" ? { channel: "msedge" } : {}),
});
try {
  for (const colorScheme of ["light", "dark"]) {
    const output = resolve(outputRoot, colorScheme);
    await mkdir(output, { recursive: true });
    const context = await browser.newContext({
      colorScheme,
      viewport: { width: 1280, height: 1000 },
    });
    const page = await context.newPage();
    const exceptions = [];
    page.on("pageerror", (e) => exceptions.push(e.message));
    const report = [];
    const passed = (value) => report.push(value);
    try {
      await page.goto(APP_URL + "", { waitUntil: "networkidle" });
      await page.locator("#access-code").fill("incorrect-synthetic-code");
      await page.getByRole("button", { name: "Открыть FRchat" }).click();
      await page.getByRole("alert").waitFor();
      assert.equal(await page.locator(".post-card").count(), 0);
      passed("incorrect code rejected without exposing posts");
      const records = JSON.parse(
        await readFile(resolve(root, ".local/pilot-accounts.json"), "utf8"),
      );
      const code = records.accounts.find((a) => a.id === "user1").password;
      await page.locator("#account-login").selectOption("user1");
      await page.locator("#access-code").fill(code);
      await page.getByRole("button", { name: "Открыть FRchat" }).click();
      await page.locator(".post-card").first().waitFor();
      assert.ok((await page.locator(".post-card").count()) > 10);
      await page.screenshot({
        path: resolve(output, "desktop-feed.png"),
        fullPage: true,
      });
      passed("real encrypted seed opens in browser");
      const firstCard = page.locator(".post-card").first();
      await firstCard
        .getByRole("button", { name: "Добавить в избранное" })
        .click();
      await page.goto(APP_URL + "#/favorites");
      await page.locator(".post-card").first().waitFor();
      assert.equal(await page.locator(".post-card").count(), 1);
      await page.reload();
      await page
        .getByRole("button", { name: "Удалить из избранного" })
        .waitFor();
      await page.goto(APP_URL + "#/archive");
      await page
        .locator(".post-card")
        .first()
        .getByRole("button", { name: "Добавить в избранное" })
        .click();
      await page.goto(APP_URL + "#/favorites");
      await page.locator(".post-card").first().waitFor();
      assert.equal(await page.locator(".post-card").count(), 2);
      passed("favorites persist across reload and retain archived real posts");
      await page.goto(APP_URL + "#/feed?favorites=1");
      await page.locator(".post-card").first().waitFor();
      assert.equal(await page.locator(".post-card").count(), 2);
      passed("favorites-only search includes archived saved posts");
      await page.goto(APP_URL + "#/reference");
      await page
        .getByRole("heading", { name: "Постоянная информация скоро появится" })
        .waitFor();
      assert.equal(
        await page.locator(".category-chips [data-category]").count(),
        5,
      );
      assert.equal(await page.locator(".post-card").count(), 0);
      passed(
        "pilot reference directory shows five categories and honest empty state",
      );
      await page.goto(APP_URL + "#/feed");
      await page.locator(".post-card").first().click();
      await page.locator(".post-body").waitFor();
      await page.reload();
      await page.locator(".post-body").waitFor();
      passed("saved access code and direct card route survive reload");
      await page.goto(APP_URL + "#/archive");
      await page.locator(".post-card").first().waitFor();
      assert.ok((await page.locator(".post-card").count()) >= 20);
      await page
        .getByRole("textbox", { name: "Поиск по публикациям" })
        .fill("квартальный отчёт");
      await page.waitForTimeout(200);
      assert.equal(await page.locator(".post-card").count(), 1);
      assert.ok(page.url().includes("q="));
      await page.reload();
      await page.locator(".post-card").first().waitFor();
      assert.equal(await page.locator(".post-card").count(), 1);
      passed("archive search and URL filters persist");
      await page.goto(
        APP_URL + "#/feed?q=" + encodeURIComponent("квартальный отчёт"),
      );
      await page.locator(".post-card").first().waitFor();
      assert.equal(await page.locator(".post-card").count(), 1);
      passed("search from feed includes archived publications");
      await page.goto(APP_URL + "#/calendar");
      await page.locator(".calendar-grid").waitFor();
      assert.equal(await page.locator(".day-cell").count(), 42);
      assert.ok((await page.locator(".day-dots i").count()) > 10);
      await page.screenshot({
        path: resolve(output, "desktop-calendar.png"),
        fullPage: true,
      });
      await page.getByRole("button", { name: "Предыдущий период" }).click();
      assert.match(
        await page.locator(".month-heading h2").innerText(),
        /сентябрь/i,
      );
      await page.getByRole("button", { name: "Сегодня", exact: true }).click();
      await page.getByRole("button", { name: "Неделя", exact: true }).click();
      assert.equal(await page.locator(".day-cell").count(), 7);
      await page.getByRole("button", { name: "Повестка", exact: true }).click();
      assert.equal(await page.locator(".agenda-day").count(), 14);
      passed("month, September navigation, week and 14-day agenda work");
      for (const width of [360, 390, 768]) {
        await page.setViewportSize({ width, height: 844 });
        await page.goto(APP_URL + "#/feed");
        await page.locator(".post-card").first().waitFor();
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > window.innerWidth,
          ),
          false,
        );
        if (width === 390)
          await page.screenshot({
            path: resolve(output, "mobile-feed.png"),
            fullPage: false,
          });
        await page.goto(APP_URL + "#/calendar");
        await page.locator(".calendar-grid").waitFor();
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > window.innerWidth,
          ),
          false,
        );
        if (width === 390)
          await page.screenshot({
            path: resolve(output, "mobile-calendar.png"),
            fullPage: false,
          });
      }
      passed("no horizontal overflow at 360, 390 and 768px");
      await page.setViewportSize({ width: 390, height: 844 });
      await page
        .getByRole("button", { name: "Переключить светлую или тёмную тему" })
        .click();
      assert.equal(
        await page.locator("html").getAttribute("data-theme"),
        colorScheme === "light" ? "dark" : "light",
      );
      await page.screenshot({
        path: resolve(output, "mobile-manual-toggle.png"),
        fullPage: true,
      });
      await page.goto(APP_URL + "#/files");
      await page.locator(".pending-file").first().waitFor();
      assert.equal(await page.locator(".pending-file").count(), 5);
      passed("manual theme override and five honest attachment placeholders");
      await page.locator(".mobile-lock").click();
      await page.locator("#access-code").waitFor();
      assert.equal(
        await page.evaluate(() => localStorage.getItem("frchat.access.v1")),
        null,
      );
      passed("logout forgets code and clears reader");
      const blocked = await context.request.get(
        APP_URL + "samples/seed/frchat-seed.json",
      );
      assert.ok(!(await blocked.text()).includes("frchat-seed/1"));
      const denied = await context.request.get(
        APP_URL + ".local/pilot-access-code.txt",
      );
      assert.ok(!(await denied.text()).includes(code));
      passed("production server does not expose local seed or access code");
      assert.deepEqual(exceptions, []);
      passed("no unhandled browser exceptions");
      await writeFile(
        resolve(output, "report.json"),
        JSON.stringify(
          { checks: report, tested_at: new Date().toISOString() },
          null,
          2,
        ),
      );
      console.log(
        JSON.stringify(
          {
            system_scheme: colorScheme,
            checks_passed: report.length,
            checks: report,
            screenshots: process.env.FRCHAT_URL
              ? ".local/browser-live/"
              : ".local/browser/",
          },
          null,
          2,
        ),
      );
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
