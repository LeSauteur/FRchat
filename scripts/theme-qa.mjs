import { chromium } from "playwright";
import axe from "axe-core";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createQaFixture, installQaRoutes } from "./qa-fixture.mjs";
import { inspectContrast } from "./contrast-check.mjs";
import { checkFavoritesAndReference } from "./feature-check.mjs";
import { checkAdmin } from "./admin-qa.mjs";
import { checkDuplicateFlows } from "./duplicate-qa.mjs";
import { checkReadability, inspectInputs } from "./readability-qa.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const url = process.env.FRCHAT_URL ?? "http://127.0.0.1:4173/";
const output = resolve(root, "docs/qa");
await mkdir(output, { recursive: true });
const fixture = await createQaFixture();
const emptyReferenceFixture = await createQaFixture({
  includeReferences: false,
});
let server;
if (process.argv.includes("--start-server")) {
  server = spawn(
    process.execPath,
    [
      resolve(root, "node_modules/vite/bin/vite.js"),
      "preview",
      "--host",
      "127.0.0.1",
      "--port",
      "4173",
      "--strictPort",
    ],
    { cwd: root, stdio: "ignore", windowsHide: true },
  );
  for (let attempt = 0; attempt < 40; attempt++) {
    if (server.exitCode !== null)
      throw new Error("QA preview exited before becoming ready");
    try {
      const response = await fetch(url);
      if (response.ok) break;
    } catch {}
    await setTimeout(200);
  }
}
const browser = await chromium.launch({
  headless: true,
  ...(process.platform === "win32" ? { channel: "msedge" } : {}),
});
const matrix = [],
  errors = [];
try {
  await checkReadability(browser, url, fixture);
  await checkAdmin(browser, url);
  await checkDuplicateFlows(browser, url);
  await checkFavoritesAndReference(browser, url, fixture);
  for (const width of [390, 430, 1280])
    for (const mode of [
      {
        system: "light",
        override: "system",
        name: "system-light",
        effective: "light",
      },
      {
        system: "dark",
        override: "system",
        name: "system-dark",
        effective: "dark",
      },
      {
        system: "light",
        override: "dark",
        name: "manual-dark",
        effective: "dark",
      },
      {
        system: "dark",
        override: "light",
        name: "manual-light",
        effective: "light",
      },
    ]) {
      const context = await browser.newContext({
        viewport: { width, height: width === 390 ? 844 : 960 },
        colorScheme: mode.system,
        bypassCSP: true,
      });
      await context.addInitScript((override) => {
        localStorage.setItem("frchat.theme.v1", override);
        localStorage.setItem(
          "frchat.favorites.v1",
          JSON.stringify([
            "qa-meetings",
            "qa-council",
            "qa-deleted",
            "qa-missing",
          ]),
        );
      }, mode.override);
      const page = await context.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      await installQaRoutes(page, fixture);
      const scenarios = [
        ["login", ""],
        ["feed", "#/feed"],
        ["post", "#/post/qa-meetings"],
        ["calendar", "#/calendar"],
        ["archive", "#/archive"],
        ["search", "#/feed?q=" + encodeURIComponent("тестовая публикация")],
        ["favorites", "#/favorites"],
        ["reference", "#/reference"],
        ["reference-empty", "#/reference"],
      ];
      for (const [screen, hash] of scenarios) {
        if (screen === "reference-empty") {
          await installQaRoutes(page, emptyReferenceFixture);
          await page.evaluate(() =>
            localStorage.removeItem("frchat.access.v1"),
          );
        }
        await page.goto(url + hash, { waitUntil: "networkidle" });
        if (screen === "reference-empty")
          await page.reload({ waitUntil: "networkidle" });
        if (screen === "login") await page.locator("#access-code").waitFor();
        else if (screen === "feed") {
          await page.locator("#access-code").fill(fixture.code);
          await page.getByRole("button", { name: "Открыть FRchat" }).click();
          await page.locator(".post-card").first().waitFor();
        } else if (screen === "reference-empty") {
          await page.locator("#access-code").fill(emptyReferenceFixture.code);
          await page.getByRole("button", { name: "Открыть FRchat" }).click();
          await page
            .getByRole("heading", {
              name: "Постоянная информация скоро появится",
            })
            .waitFor();
        } else await page.locator(".main-content").waitFor();
        if (screen === "search")
          await page
            .getByRole("button", { name: "Фильтры", exact: true })
            .click();
        if (
          screen === "favorites" &&
          (await page
            .getByRole("button", { name: "Фильтры", exact: true })
            .getAttribute("aria-expanded")) === "true"
        )
          await page
            .getByRole("button", { name: "Фильтры", exact: true })
            .click();
        if (mode.override !== "system" && screen === "feed") {
          // Exercise the real control in both directions, then audit the final persisted override.
          const toggle = page.getByRole("button", {
            name: "Переключить светлую или тёмную тему",
          });
          await toggle.click();
          await toggle.click();
          assert.equal(
            await page.locator("html").getAttribute("data-theme"),
            mode.override,
          );
        }
        const rootColors = await page.evaluate(() => ({
          body: getComputedStyle(document.body).color,
          bg: getComputedStyle(document.body).backgroundColor,
          root: getComputedStyle(document.documentElement).backgroundColor,
        }));
        assert.equal(
          rootColors.bg,
          mode.effective === "dark" ? "rgb(23, 26, 31)" : "rgb(246, 245, 242)",
        );
        assert.equal(
          rootColors.body,
          mode.effective === "dark" ? "rgb(241, 240, 238)" : "rgb(34, 37, 42)",
        );
        assert.equal(rootColors.root, rootColors.bg);
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
        );
        await page.addScriptTag({ content: axe.source });
        const axeResult = await page.evaluate(async () => {
          const result = await window.axe.run(document, {
            runOnly: { type: "rule", values: ["color-contrast"] },
          });
          return {
            violations: result.violations.flatMap((v) =>
              v.nodes.map((n) => ({
                target: n.target,
                summary: n.failureSummary,
              })),
            ),
            incomplete: result.incomplete.flatMap((v) =>
              v.nodes.map((n) => ({ target: n.target })),
            ),
          };
        });
        const contrast = await page.evaluate(inspectContrast);
        assert.deepEqual(
          await page.evaluate(inspectInputs),
          [],
          `${screen}: input font/height`,
        );
        const result = {
          width,
          mode: mode.name,
          screen,
          ...contrast,
          axeViolations: axeResult.violations,
          axeIncomplete: axeResult.incomplete,
        };
        matrix.push(result);
        if (contrast.failures.length || axeResult.violations.length)
          console.log(JSON.stringify(result));
        // Capture both schemes for each screen/width. Manual overrides are audited without duplicating images.
        if (mode.override === "system")
          await page.screenshot({
            path: resolve(output, `${width}-${mode.effective}-${screen}.png`),
            fullPage: false,
          });
      }
      await context.close();
    }
  await writeFile(
    resolve(output, "contrast-report.json"),
    JSON.stringify({ synthetic: true, cases: matrix, errors }, null, 2),
  );
  assert.deepEqual(errors, []);
  assert.equal(
    matrix.filter((item) => item.failures.length || item.axeViolations.length)
      .length,
    0,
    "Contrast regression; see docs/qa/contrast-report.json",
  );
  console.log(
    JSON.stringify({
      theme_cases: matrix.length,
      minimum_ratio: Math.min(...matrix.map((item) => item.minRatio)),
      axe_violations: 0,
      screenshots: matrix.filter((item) => item.mode.startsWith("system-"))
        .length,
      synthetic: true,
    }),
  );
} finally {
  await browser.close();
  server?.kill();
}
