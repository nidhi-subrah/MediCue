import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const backend = process.env.BACKEND_URL ?? "http://localhost:8000";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@shared": path.resolve(__dirname, "../shared") } },
  server: {
    fs: { allow: [".."] },
    proxy: {
      "/api": backend,
      "/ws": { target: backend.replace(/^http/, "ws"), ws: true },
    },
  },
});
