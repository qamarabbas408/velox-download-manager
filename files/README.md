# Velox — static UI

Static (no wired-up logic yet) desktop UI for a segmented download manager, matching a Rust/Tauri + React + TypeScript stack.

## Drop into an existing Vite + Tauri project

```bash
npm install lucide-react
npm install -D tailwindcss postcss autoprefixer
```

Copy `tailwind.config.ts` to your project root, and `src/*` into your `src/` folder (merging `index.css` with any existing global styles). Render `<App />` from your `main.tsx` as usual.

## What's here
- **App.tsx** — shell: sidebar + toolbar + scrollable list
- **components/Sidebar.tsx** — nav sections with counts, storage meter
- **components/Toolbar.tsx** — add-download action, search, live total speed
- **components/DownloadRow.tsx** — one row per file: icon, name, status, progress, stats, hover actions
- **components/SegmentedProgressBar.tsx** — the signature element: progress rendered as discrete cells, one per active connection, instead of a plain bar — a visual nod to how the engine actually fetches the file in parallel byte ranges
- **data/mockDownloads.ts** — static sample data (swap for real state once the Rust engine is wired up)
- **types.ts / utils/format.ts** — shared types and byte/speed/eta formatting

## Not wired up yet
Buttons (pause/resume/retry/remove/add/search) are static — no event handlers or real state. That's the natural next step once you're ready to connect this to Tauri commands.
