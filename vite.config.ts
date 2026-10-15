import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "local-development-csp",
      apply: "serve",
      transformIndexHtml(html) {
        // React's development preamble and Vite HMR only; production stays strict.
        return html
          .replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
          .replace("style-src 'self'", "style-src 'self' 'unsafe-inline'")
          .replace(
            "connect-src 'self'",
            "connect-src 'self' ws://127.0.0.1:* ws://localhost:*",
          );
      },
    },
  ],
  base: "./",
  server: {
    fs: {
      deny: [
        "**/.git/**",
        "**/.local/**",
        "**/samples/**",
        "**/docs/**",
        "**/tools/**",
        "**/scripts/**",
        "**/.env*",
        "**/*.local",
      ],
    },
  },
  build: { sourcemap: false, target: "es2022" },
});
