import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { VitePWA } from "vite-plugin-pwa";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["logo-64.png", "logo-192.png", "logo-256.png", "logo-512.png", "logo.gif", "contact-avatar.png", "wechat-qr.png", "icons/study.gif", "icons/exam.gif", "icons/mix.gif", "icons/flame.gif", "icons/plan.gif", "icons/logo-green.gif", "icons/logo-blue.gif", "icons/logo-purple.gif", "icons/logo-pink.gif", "icons/logo-orange.gif", "icons/logo-teal.gif", "icons/logo-tech.gif", "icons/logo-forest.gif", "icons/logo-space.gif", "icons/logo-cloud.gif"],
      manifest: {
        name: "刷题宝（网页版）",
        short_name: "刷题宝",
        description: "智能题库练习应用 · 导入即刷 · AI 自动解析",
        theme_color: "#42b883",
        background_color: "#ffffff",
        display: "standalone",
        orientation: "portrait",
        icons: [
          {
            src: "logo-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "logo-512.png",
            sizes: "512x512",
            type: "image/png",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
  ],

  // 通用配置（非 Tauri 专用）
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    target: "es2019",
  },
});
