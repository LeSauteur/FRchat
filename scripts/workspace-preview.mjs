import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createWorkspaceFixture } from "./workspace-fixture.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export async function startWorkspacePreview(port = 4185) {
  const fixture = await createWorkspaceFixture();
  const server = createServer(async (req, res) => {
    const send = (status, type, body) => {
      res.writeHead(status, {
        "Content-Type": type,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(body);
    };
    const json = (value) =>
      send(200, "application/json", JSON.stringify(value));
    try {
      if (
        !["127.0.0.1:" + port, "localhost:" + port].includes(req.headers.host)
      )
        return send(403, "text/plain", "Local preview only");
      const url = new URL(req.url, "http://127.0.0.1:" + port),
        path = url.pathname;
      if (path === "/config.json")
        return json({
          dataSources: ["./pilot-data/"],
          feedbackUrl: "",
          dailyTaskUrl: `http://127.0.0.1:${port}/__preview/days.json`,
          dailyTaskHome: "https://lesauteur.github.io/domian-7-days/",
        });
      if (path === "/__preview/days.json") return json(fixture.dailyData);
      if (path === "/__preview/bridge.js")
        return send(
          200,
          "text/javascript",
          `
        const localFetch=window.fetch.bind(window);
        window.fetch=(input,options={})=>{
          const u=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href);
          if(u.origin===location.origin)return localFetch(input,options);
          if(u.origin==='https://api.github.com'&&u.pathname.startsWith('/repos/LeSauteur/FRchat-data/')){
            const headers=new Headers(options.headers);headers.delete('Authorization');
            return localFetch('/__preview/api'+u.pathname+u.search,{...options,headers,credentials:'omit'});
          }
          return Promise.reject(new Error('External requests are disabled in synthetic preview'));
        };
        document.addEventListener('DOMContentLoaded',()=>{const banner=document.createElement('aside');banner.className='preview-banner';banner.textContent='Локальный макет · искусственные данные';document.body.prepend(banner);});
      `,
        );
      if (path.startsWith("/__preview/api/")) {
        // No broad credentials or live requests: the entire Git Data API is in memory.
        if (
          req.headers.origin &&
          req.headers.origin !== `http://${req.headers.host}`
        )
          return send(403, "text/plain", "Same-origin only");
        let body = "";
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 75 * 1024 * 1024) throw new Error("Too large");
        }
        try {
          return json(
            await fixture.backend.request(
              req.method,
              path.slice("/__preview/api".length) + url.search,
              body ? JSON.parse(body) : undefined,
            ),
          );
        } catch (e) {
          return send(
            e.status ?? 503,
            "application/json",
            JSON.stringify({ message: "Synthetic service unavailable" }),
          );
        }
      }
      if (path.startsWith("/pilot-data/")) {
        const key = path.slice("/pilot-data/".length),
          bytes = fixture.backend.files.get(key);
        return send(
          bytes ? 200 : 404,
          key === "manifest.json"
            ? "application/json"
            : "application/octet-stream",
          bytes ? Buffer.from(bytes) : "Not found",
        );
      }
      const file = resolve(
        root,
        "dist",
        "." + decodeURIComponent(path === "/" ? "/index.html" : path),
      );
      const rel = relative(resolve(root, "dist"), file);
      if (rel.startsWith("..") || rel.includes(":"))
        return send(404, "text/plain", "Not found");
      const bytes = await readFile(file);
      if (extname(file) === ".html")
        return send(
          200,
          "text/html; charset=utf-8",
          bytes
            .toString()
            .replace(
              "<head>",
              '<head><script src="./__preview/bridge.js"></script><style>.preview-banner{background:#143463;color:white;font:14px/1.5 Arial;padding:10px 20px;position:relative;z-index:1000}.preview-banner+*{clear:both}</style>',
            ),
        );
      return send(
        200,
        {
          ".js": "text/javascript",
          ".css": "text/css",
          ".json": "application/json",
          ".png": "image/png",
          ".svg": "image/svg+xml",
          ".woff2": "font/woff2",
        }[extname(file)] ?? "application/octet-stream",
        bytes,
      );
    } catch (e) {
      send(404, "text/plain", "Preview resource unavailable");
    }
  });
  await new Promise((ok, no) => {
    server.once("error", no);
    server.listen(port, "127.0.0.1", ok);
  });
  return { server, fixture, url: `http://127.0.0.1:${port}/` };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { url } = await startWorkspacePreview(
    Number(process.env.FRCHAT_PREVIEW_PORT ?? 4185),
  );
  console.log("Synthetic workspace preview: " + url);
}
