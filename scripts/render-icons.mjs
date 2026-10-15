import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const browser = await chromium.launch({
  headless: true,
  ...(process.platform === "win32" ? { channel: "msedge" } : {}),
});
try {
  const page = await browser.newPage();
  const svg = await readFile(resolve(root, "public/icon.svg"), "utf8");
  for (const size of [180, 192, 512]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{width:100vw;height:100vh;display:block}</style>${svg}`,
    );
    await page.screenshot({
      path: resolve(root, `public/icon-${size}.png`),
      omitBackground: true,
    });
  }
} finally {
  await browser.close();
}
console.log("Иконки 180/192/512 px готовы.");
