# pogo.filter.workshop

Pokémon GO Suchstring-Generator. Hundo-aware Trash & Trade filters, regional map (KMZ-driven), Tausch-Buddies.

## Quickstart

```bash
npm install
npm run dev          # http://localhost:5173
```

## Build & deploy to GitHub Pages

### One-time setup

1. **Create the repo** on GitHub (e.g. `pogo-filter-workshop`) and push this code:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin git@github.com:YOUR_USERNAME/pogo-filter-workshop.git
   git push -u origin main
   ```

2. **Update the base path** in `vite.config.js` to match your repo name:
   ```js
   base: "/pogo-filter-workshop/",
   ```
   - Repo at `github.com/jesper/pogo-filter-workshop` → `base: "/pogo-filter-workshop/"`
   - Custom domain or `username.github.io` repo → `base: "/"`

3. **Enable GitHub Pages**:
   - Repo → Settings → Pages
   - Source: **GitHub Actions**

### Deploy

Just push to `main`. The workflow in `.github/workflows/deploy.yml` builds and publishes automatically.

```bash
git push
```

Site goes live at `https://YOUR_USERNAME.github.io/pogo-filter-workshop/` after ~1 minute.

### Manual deploy (alternative)

If you don't want the GitHub Action:
```bash
npm run deploy
```
This uses the `gh-pages` package to push `dist/` to a `gh-pages` branch. Set Pages source to "Deploy from branch" → `gh-pages` in repo settings.

## Stack

- **Vite** + React 18
- **Tailwind CSS** (JIT, scans JSX directly)
- **d3-geo** for map projection
- **lucide-react** for icons
- **localStorage** for state persistence (no backend, fully client-side)

## Data sources

- **Pokémon names dictionary** (1025 species, EN + DE) from [Leidwesen's PhraseTranslator](https://leidwesen.github.io/PhraseTranslator/) — last updated APK 0.407.0 (April 2026). Embedded in `App.jsx`.
- **Regional polygons** from the community KMZ originally by u/zoglandboy / u/Mattman243 / pokemoncalendar.com (March 2022) plus manually-added Hawlucha (Mexico) and Stonjourner (UK) post-2022 regionals.
- **World topology** for the basemap fetched at runtime from `cdn.jsdelivr.net/npm/world-atlas` (with `unpkg.com` fallback).

## Privacy

100% client-side. No analytics, no API calls beyond the world topology basemap. All your data (hundos, buddies, home location, tagged Pokémon list) lives in your browser's localStorage.

## License

MIT or whatever you like — the regional polygon data is community-sourced and credit goes to the original KMZ authors.
