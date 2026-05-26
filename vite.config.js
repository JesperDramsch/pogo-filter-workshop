import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Served from custom domain pogo.amplt.de, so base is "/".
export default defineConfig({
  plugins: [
    react(),
    // PWA conversion exists primarily so Firefox Mobile honours
    // navigator.storage.persist() — Fenix gates durable storage on
    // PWA-install heuristics (manifest + SW + icons), and without them
    // localStorage gets evicted even when persisted() reports true.
    // Chrome/Safari users get free offline support as a side effect.
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: [
        "favicon.svg",
        "favicon.ico",
        "apple-touch-icon-180x180.png",
      ],
      manifest: {
        name: "pogo.filter.workshop",
        short_name: "pogo.workshop",
        description:
          "Pokémon GO Suchstring-Generator: hundo-aware Trash & Trade Filter, regionale Karte, Tausch-Buddies.",
        lang: "de",
        theme_color: "#0F1419",
        background_color: "#0F1419",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "pwa-64x64.png", sizes: "64x64", type: "image/png" },
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "maskable-icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
        cleanupOutdatedCaches: true,
        navigateFallback: "/index.html",
        // Bundled JSON blobs (PvP rankings, raid bosses, KMZ polygons)
        // can push individual chunks past the 2 MiB Workbox default.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      // Keep dev SW-free so we don't fight stale caches while iterating.
      devOptions: { enabled: false },
    }),
  ],
  base: "/",
  build: {
    outDir: "dist",
    sourcemap: false,
    // The embedded Pokémon names + KMZ polygons make the bundle ~200KB before
    // gzip — well within reason but let's bump the chunk warning to skip noise.
    chunkSizeWarningLimit: 600,
  },
});
