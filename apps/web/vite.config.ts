import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig(({ mode }) => {
  const rootEnv = loadEnv(mode, path.resolve(__dirname, "../.."), "");
  const webEnv = loadEnv(mode, __dirname, "");
  const proxyTarget =
    process.env.VITE_PROXY_TARGET ||
    webEnv.VITE_PROXY_TARGET ||
    rootEnv.VITE_PROXY_TARGET ||
    process.env.VITE_API_BASE_URL ||
    webEnv.VITE_API_BASE_URL ||
    rootEnv.VITE_API_BASE_URL ||
    "http://localhost:3001";

  return {
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: proxyTarget,
          changeOrigin: true,
        },
      },
    },
  };
});
