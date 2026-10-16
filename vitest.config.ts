import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
  define: {
    'import.meta.env.VITE_API_URL': JSON.stringify('http://localhost:4000'),
    'import.meta.env.MODE':         JSON.stringify('test'),
    'import.meta.env.DEV':          JSON.stringify(false),
    'import.meta.env.PROD':         JSON.stringify(false),
    'import.meta.env.SSR':          JSON.stringify(false),
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
