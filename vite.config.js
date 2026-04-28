import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Served from custom domain pogo.amplt.de, so base is "/".
export default defineConfig({
  plugins: [react()],
  base: "/",
  build: {
    outDir: "dist",
    sourcemap: false,
    // The embedded Pokémon names + KMZ polygons make the bundle ~200KB before
    // gzip — well within reason but let's bump the chunk warning to skip noise.
    chunkSizeWarningLimit: 600,
  },
});
