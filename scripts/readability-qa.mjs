import assert from "node:assert/strict";
import { writeFile, readFile } from "node:fs/promises";
import { installQaRoutes } from "./qa-fixture.mjs";
// Runs in-page. Font size is checked on the actual visible input, not its parent.
export function inspectInputs() {
  return [
    ...document.querySelectorAll(
      "input:not([type=checkbox]):not([type=radio]):not([type=file]),select,textarea",
    ),
  ]
    .filter(
      (e) =>
        e.getBoundingClientRect().width &&
        e.getBoundingClientRect().height &&
        getComputedStyle(e).visibility !== "hidden",
    )
    .filter(
      (e) =>
        parseFloat(getComputedStyle(e).fontSize) < 16 ||
        e.getBoundingClientRect().height < 47.9,
    )
    .map((e) => ({
      name: e.getAttribute("aria-label") || e.id || e.tagName,
      font: getComputedStyle(e).fontSize,
      height: e.getBoundingClientRect().height,
    }));
}
export async function checkReadability(browser, url, fixture) {
  const cases = [];
  for (const width of [390, 430, 1280])
    for (const theme of ["light", "dark"]) {
      const context = await browser.newContext({
        viewport: { width, height: width === 1280 ? 960 : 900 },
        colorScheme: theme,
        bypassCSP: true,
        acceptDownloads: true,
      });
      context.setDefaultTimeout(15000);
      const page = await context.newPage(),
        errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const auditInputs = async () =>
        assert.deepEqual(await page.evaluate(inspectInputs), []);
      const selected = () =>
        page.locator('.category-chips [data-category][aria-pressed="true"]');
      const assertCategory = async (category) => {
        assert.equal(await selected().count(), category ? 1 : 0);
        if (category) {
          assert.equal(
            await selected().getAttribute("data-category"),
            category,
          );
          assert.ok(
            (
              await page
                .locator(".post-card")
                .evaluateAll((cards) => cards.map((c) => c.dataset.category))
            ).every((c) => c === category),
          );
          const visible = await selected().evaluate((e) => {
            const item = e.getBoundingClientRect(),
              row = e.parentElement.getBoundingClientRect();
            return item.left >= row.left - 1 && item.right <= row.right + 1;
          });
          assert.equal(
            visible,
            true,
            "Selected category must be horizontally visible",
          );
        } else
          assert.equal(
            await page
              .getByRole("button", { name: "Все категории", exact: true })
              .getAttribute("aria-pressed"),
            "true",
          );
      };
      try {
        await installQaRoutes(page, fixture);
        await page.goto(url);
        await page.locator("#access-code").waitFor();
        await auditInputs();
        await page.locator("#access-code").focus();
        assert.equal(await page.evaluate(() => visualViewport.scale), 1);
        await page.locator("#access-code").fill(fixture.code);
        await page.getByRole("button", { name: "Открыть FRchat" }).click();
        await page.locator(".post-card").first().waitFor();
        assert.deepEqual(
          await page.locator(".bottom-nav a").allTextContents(),
          ["Актуально", "Календарь", "Избранное", "Справочник", "Архив"],
        );
        assert.equal(
          await page.locator('.sidebar nav a[href="#/files"]').count(),
          0,
        );
        const minima = {
          ".search input": 16,
          ".post-card h3": 18,
          ".card-excerpt": 16,
          ".card-date": 14,
          ".card-meta > .category-name": 14,
          ".bottom-nav a": 12,
        };
        for (const [selector, min] of Object.entries(minima)) {
          const fonts = await page
            .locator(selector)
            .evaluateAll((els) =>
              els
                .filter((e) => e.getBoundingClientRect().width)
                .map((e) => parseFloat(getComputedStyle(e).fontSize)),
            );
          assert.ok(
            fonts.every((font) => font >= min),
            `${selector}: ${fonts}`,
          );
        }
        await page
          .getByRole("button", { name: "Фильтры", exact: true })
          .click();
        await auditInputs();
        await page
          .getByRole("button", { name: "Фильтры", exact: true })
          .click();
        await page.locator('[data-category="developers"].chip').click();
        await assertCategory("developers");
        await page.locator('[data-category="meetings"].chip').click();
        await assertCategory("meetings");
        await page.goBack();
        await assertCategory("developers");
        await page.goForward();
        await assertCategory("meetings");
        await page.locator('[data-category="meetings"].chip').click();
        await assertCategory(null);
        await page.goto(url + "#/feed?category=developers&category=meetings");
        await page.reload();
        await page.locator(".post-card").first().waitFor();
        await assertCategory("meetings");
        await page.goto(url + "#/reference");
        await page
          .getByRole("heading", { name: "Справочник", exact: true })
          .waitFor();
        const files = page.getByRole("region", { name: "Шаблоны и файлы" });
        await files.waitFor();
        await page
          .getByRole("button", { name: "Шаблоны и файлы", exact: true })
          .click();
        assert.ok(await files.locator(".pending-file").count());
        const downloadEvent = page.waitForEvent("download");
        await files
          .getByRole("button")
          .filter({ hasText: "example.xlsx" })
          .click();
        const download = await downloadEvent;
        assert.equal(
          await readFile(await download.path(), "utf8"),
          "Synthetic QA file",
        );
        await page.goto(url + "#/files");
        await page
          .getByRole("heading", { name: "Справочник", exact: true })
          .waitFor();
        await files.waitFor();
        await page.goto(url + "#/feed");
        await page
          .getByRole("heading", { name: "Актуально", exact: true })
          .waitFor();
        await auditInputs();
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
        );
        await page.locator(".toast").waitFor({ state: "detached" });
        if (width !== 1280)
          await page.evaluate(() => {
            const daily = document.querySelector(".daily-task");
            window.scrollTo({
              top:
                daily.getBoundingClientRect().top +
                scrollY -
                document.querySelector(".topbar").getBoundingClientRect()
                  .height -
                12,
            });
          });
        await page.screenshot({
          path: `docs/qa/${width}-${theme}-readability-feed.png`,
          fullPage: false,
        });
        await page.evaluate(
          () => (document.documentElement.style.fontSize = "200%"),
        );
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
          "200% text must not overflow horizontally",
        );
        await auditInputs();
        assert.deepEqual(errors, []);
        cases.push({
          width,
          theme,
          input_min: 16,
          category: "single-toggle-and-scroll",
          navigation: 5,
          files_download_verified: true,
          legacy_files_link: true,
          text_200_percent: true,
          errors: 0,
        });
      } finally {
        await context.close();
      }
    }
  await writeFile(
    "docs/qa/readability-report.json",
    JSON.stringify(
      {
        synthetic: true,
        cases,
        notes: "Browser viewport checks, not a physical iPhone Safari run.",
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      readability_cases: cases.length,
      widths: [390, 430, 1280],
      themes: 2,
      passed: true,
    }),
  );
}
