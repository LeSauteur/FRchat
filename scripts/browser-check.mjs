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
const output = resolve(
  root,
  process.env.FRCHAT_URL ? ".local/browser-live" : ".local/browser",
);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.platform === "win32" ? { channel: "msedge" } : {}),
});
const context = await browser.newContext({
  colorScheme: "light",
  viewport: { width: 1440, height: 1000 },
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
  const code = (
    await readFile(resolve(root, ".local/pilot-access-code.txt"), "utf8")
  ).trim();
  await page.locator("#access-code").fill(code);
  await page.getByRole("button", { name: "Открыть FRchat" }).click();
  await page.locator(".post-card").first().waitFor();
  assert.ok((await page.locator(".post-card").count()) > 10);
  await page.screenshot({
    path: resolve(output, "desktop-feed.png"),
    fullPage: true,
  });
  passed("real encrypted seed opens in browser");
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
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  await page.screenshot({
    path: resolve(output, "mobile-dark.png"),
    fullPage: true,
  });
  await page.goto(APP_URL + "#/files");
  await page.locator(".pending-file").first().waitFor();
  assert.equal(await page.locator(".pending-file").count(), 5);
  passed("dark theme and five honest attachment placeholders");
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
  await browser.close();
}
