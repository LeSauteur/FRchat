import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import axe from "axe-core";
import {
  createAdminFixture,
  installAdminRoutes,
  syntheticAdminPassword,
} from "./admin-fixture.mjs";
import { inspectContrast } from "./contrast-check.mjs";
import { inspectInputs } from "./readability-qa.mjs";
const text =
  "Переслано: Тестовый отдел\nБРОКЕР-ТУР: знакомство с учебным кварталом\nЗавтра в 11:00 приглашаем на презентацию домов и прогулку по территории. Запись по ссылке https://example.org/register\n👍 3\n11:58";
async function login(page, url) {
  await page.goto(url + "#/feed");
  await page.locator("#account-login").selectOption("admin");
  await page.locator("#access-code").fill(syntheticAdminPassword);
  await page.getByRole("button", { name: "Открыть FRchat" }).click();
}
export async function checkAdmin(browser, url) {
  const output = resolve("docs/qa"),
    cases = [],
    errors = [];
  await mkdir(output, { recursive: true });
  for (const width of [390, 430, 1280])
    for (const [system, override] of [
      ["light", "system"],
      ["dark", "system"],
      ["light", "dark"],
      ["dark", "light"],
    ]) {
      const f = await createAdminFixture(),
        context = await browser.newContext({
          viewport: { width, height: width === 390 ? 844 : 960 },
          colorScheme: system,
          bypassCSP: true,
        });
      await context.addInitScript((override) => {
        localStorage.setItem("frchat.theme.v1", override);
      }, override);
      const page = await context.newPage();
      page.on("pageerror", (e) => errors.push(e.message));
      await installAdminRoutes(page, f);
      const effective = override === "system" ? system : override;
      async function audit(screen) {
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
          screen + " overflow",
        );
        await page.addScriptTag({ content: axe.source });
        const axeErrors = await page.evaluate(async () => {
          const r = await window.axe.run(document, {
            runOnly: { type: "rule", values: ["color-contrast"] },
          });
          return r.violations.map((v) => ({
            id: v.id,
            nodes: v.nodes.map((n) => n.target),
          }));
        });
        const contrast = await page.evaluate(inspectContrast);
        assert.deepEqual(
          await page.evaluate(inspectInputs),
          [],
          screen + ": input sizes",
        );
        const sizes = await page.evaluate(() => {
          const visible = (e) =>
            e.getBoundingClientRect().width > 0 &&
            e.getBoundingClientRect().height > 0 &&
            getComputedStyle(e).visibility !== "hidden";
          return {
            smallText: [...document.querySelectorAll(".manager-app *")]
              .filter(
                (e) =>
                  visible(e) &&
                  [...e.childNodes].some(
                    (n) => n.nodeType === 3 && n.textContent.trim(),
                  ) &&
                  parseFloat(getComputedStyle(e).fontSize) < 16,
              )
              .map((e) => e.tagName + ":" + getComputedStyle(e).fontSize),
            smallControls: [
              ...document.querySelectorAll(
                ".manager-app button,.manager-app a.primary,.manager-app a.secondary,.manager-app input:not([type=checkbox]),.manager-app select",
              ),
            ]
              .filter(
                (e) => visible(e) && e.getBoundingClientRect().height < 47.9,
              )
              .map((e) => e.textContent.trim()),
          };
        });
        const record = {
          width,
          system,
          override,
          screen,
          ...contrast,
          axeErrors,
          ...sizes,
        };
        cases.push(record);
        if (
          axeErrors.length ||
          contrast.failures.length ||
          sizes.smallText.length ||
          sizes.smallControls.length
        )
          console.log(JSON.stringify(record));
        if (override === "system")
          await page.screenshot({
            path: resolve(output, `${width}-${effective}-admin-${screen}.png`),
            fullPage: false,
          });
        assert.deepEqual(axeErrors, [], screen);
        assert.deepEqual(contrast.failures, [], screen);
        assert.deepEqual(sizes.smallText, [], screen);
        assert.deepEqual(sizes.smallControls, [], screen);
      }
      await login(page, url);
      for (let i = 0; i < 3; i++) {
        await page
          .getByRole("heading", {
            name: [
              "Скопируйте сообщение в MAX",
              "Вставьте текст",
              "Нажмите «Опубликовать»",
            ][i],
          })
          .waitFor();
        await audit("help-" + (i + 1));
        await page
          .getByRole("button", {
            name: i < 2 ? "Дальше" : "Понятно",
            exact: true,
          })
          .click();
      }
      await page.getByRole("heading", { name: "Ваши публикации" }).waitFor();
      await audit("home");
      await page
        .getByRole("link", { name: "+ Новая публикация", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "Вставьте текст", exact: true })
        .waitFor();
      await page
        .getByRole("textbox", { name: "Текст сообщения 1", exact: true })
        .fill(text);
      await audit("step-1");
      const started = Date.now();
      let taps = 0;
      await page
        .getByRole("button", { name: "Проверить", exact: true })
        .click();
      taps++;
      await page
        .getByRole("heading", { name: "Проверьте", exact: true })
        .waitFor();
      await audit("step-2");
      await page
        .getByRole("button", { name: "Изменить даты", exact: true })
        .click();
      await page
        .getByText("Нажмите «Готово» в блоке дат, чтобы продолжить.", {
          exact: true,
        })
        .waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "Всё верно", exact: true })
          .isDisabled(),
        true,
      );
      assert.equal(
        await page
          .getByRole("button", { name: "Всё верно", exact: true })
          .evaluate((e) => getComputedStyle(e).cursor),
        "not-allowed",
      );
      await audit("date-editor");
      await page.getByRole("button", { name: "Готово", exact: true }).click();
      assert.equal(
        await page
          .getByRole("button", { name: "Всё верно", exact: true })
          .isEnabled(),
        true,
      );
      assert.match(
        await page.locator(".manager-preview").innerText(),
        /Событие:/,
      );
      assert.doesNotMatch(
        await page.locator(".manager-preview").innerText(),
        /Переслано:|👍 3|11:58/,
      );
      await page
        .getByRole("button", { name: "Всё верно", exact: true })
        .click();
      taps++;
      await audit("step-3");
      // Two clicks dispatched together must still produce a single write.
      await page
        .getByRole("button", { name: "Опубликовать", exact: true })
        .evaluate((e) => {
          e.click();
          e.click();
        });
      taps++;
      await page
        .getByRole("heading", { name: "Готово!", exact: true })
        .waitFor();
      await audit("success");
      assert.equal(taps, 3);
      assert.equal(
        f.backend.calls.filter((c) => c.method === "PATCH").length,
        1,
      );
      cases.at(-1).taps_after_paste = taps;
      cases.at(-1).flow_seconds = (Date.now() - started) / 1000;
      await page.getByRole("link", { name: "На главную", exact: true }).click();
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
        .getByRole("heading", {
          name: "Есть похожая публикация. Что сделать?",
          exact: true,
        })
        .waitFor();
      await audit("duplicate");
      await page
        .getByRole("button", { name: "Это повтор — напомнить", exact: true })
        .click();
      assert.equal(
        f.backend.calls.filter((c) => c.method === "PATCH").length,
        1,
        "Selecting remind must not publish before confirmation",
      );
      await audit("remind-confirm");
      await page
        .getByRole("button", { name: "Назад к выбору", exact: true })
        .click();
      assert.equal(
        f.backend.calls.filter((c) => c.method === "PATCH").length,
        1,
      );
      await page
        .getByRole("button", { name: "Это повтор — напомнить", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Да, напомнить", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "Готово!", exact: true })
        .waitFor();
      const updated = JSON.parse(
        new TextDecoder().decode(f.backend.files.get("manifest.json")),
      );
      assert.ok(updated.index);
      await context.close();
    }
  // Failure and recovery flows get their own isolated browser and backend.
  const f = await createAdminFixture(),
    context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
  await context.addInitScript(() =>
    localStorage.setItem("frchat.manager-help.v1", "done"),
  );
  const page = await context.newPage();
  await installAdminRoutes(page, f);
  await login(page, url);
  await page
    .getByRole("link", { name: "+ Новая публикация", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Текст сообщения 1", exact: true })
    .fill(text + "\nСохранённый черновик.");
  await page.waitForFunction(() =>
    localStorage.getItem("frchat.draft.v1.admin"),
  );
  const raw = await page.evaluate(() =>
    localStorage.getItem("frchat.draft.v1.admin"),
  );
  assert.ok(!raw.includes("Сохранённый"));
  await page.reload();
  await page.locator("#access-code").fill(syntheticAdminPassword);
  await page.getByRole("button", { name: "Открыть FRchat" }).click();
  await page
    .getByRole("heading", {
      name: "У вас есть неопубликованный текст — продолжить?",
      exact: true,
    })
    .waitFor();
  await page.getByRole("button", { name: "Продолжить", exact: true }).click();
  assert.match(
    await page
      .getByRole("textbox", { name: "Текст сообщения 1", exact: true })
      .inputValue(),
    /Сохранённый черновик/,
  );
  await page.getByRole("button", { name: "Проверить", exact: true }).click();
  await page.getByRole("button", { name: "Всё верно", exact: true }).click();
  f.backend.offline = true;
  await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Нет интернета. Текст сохранён" })
    .waitFor();
  assert.equal(f.backend.calls.filter((c) => c.method === "PATCH").length, 0);
  f.backend.offline = false;
  f.backend.denied = true;
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Публикация временно недоступна, напишите Алексею" })
    .waitFor();
  assert.doesNotMatch(
    await page.locator(".manager-app").innerText(),
    /токен|GitHub|API|401|403|409|коммит|конфликт/iu,
  );
  f.backend.denied = false;
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await page.getByRole("heading", { name: "Готово!", exact: true }).waitFor();
  assert.equal(f.backend.calls.filter((c) => c.method === "PATCH").length, 1);
  await page.getByRole("link", { name: "На главную", exact: true }).click();
  const card = page
    .locator(".manager-card")
    .filter({ hasText: "БРОКЕР-ТУР: знакомство" })
    .first();
  await card.getByRole("button", { name: "Удалить", exact: true }).click();
  await page.getByRole("button", { name: "Да, удалить", exact: true }).click();
  await page
    .getByRole("button", { name: "Вернуть публикацию", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Вернуть публикацию", exact: true })
    .click();
  await page
    .locator(".manager-card")
    .filter({ hasText: "БРОКЕР-ТУР: знакомство" })
    .first()
    .waitFor();
  await context.close();
  assert.deepEqual(errors, []);
  await writeFile(
    resolve(output, "admin-report.json"),
    JSON.stringify(
      {
        synthetic: true,
        cases,
        errors,
        scenarios: {
          reload_draft: true,
          offline: true,
          expired_access: true,
          retry: true,
          double_click: true,
          duplicate_reminder: true,
          delete_restore: true,
        },
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      admin_cases: cases.length,
      taps_after_paste: 3,
      contrast_violations: 0,
      font_min: 16,
      controls_min: 48,
      scenarios: 7,
    }),
  );
}
