# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

LinkBox is a personal link repository web app. Runs entirely client-side — **no backend, no server**. Vue 3 + TypeScript + Vite, persisted to IndexedDB via Dexie. All communication in Portuguese (BR).

## Commands (uses pnpm)

- `pnpm dev` — Vite dev server
- `pnpm build` — type-check (`vue-tsc`) + production build, in parallel
- `pnpm type-check` — standalone type-check
- `pnpm preview` — preview the built bundle

There are no tests or linting configured.

## Component file layout (Angular-style)

Every component is split into four files: `Foo.vue`, `Foo.html`, `Foo.ts`, `Foo.css`. The `.vue` file is only a shell:

```vue
<template src="./Foo.html"></template>
<script lang="ts" src="./Foo.ts"></script>
<style scoped src="./Foo.css"></style>
```

Two non-obvious rules that cause silent breakage if violated:

1. **External `.html` files must NOT contain a `<template>` wrapper.** The file content is injected *as* the template interior. If you wrap it, the browser gets an inert `<template>` element and the component renders blank with no console error.
2. **Use `defineComponent({ setup() { ... } })`, not `<script setup>`.** The `src` attribute is incompatible with `<script setup>`.

## Architecture

- **`src/db.ts`** — Dexie instance (DB name `linkbox`), two tables: `links` (indexed on `id, createdAt`) and `images` (blobs indexed on `linkId`).
- **`src/composables/linksStorage.ts`** — Singleton composable. Module-level `ref<Box[]>` is populated by an async `loadFromDB()` call at import time. `useLinksStorage()` returns the same reactive array to every caller. Image blobs are fetched via `fetchViaProxy`, capped at **500KB**, type-checked (must start with `image/`), then stored as blobs in Dexie.
- **`src/composables/useMetadataFetch.ts`** — Fetches page metadata for URL auto-fill. Also exports `fetchViaProxy` (shared with `linksStorage.ts` for image fetching). Strategy is layered:
  1. Try direct `fetch(url)` (works if site has permissive CORS).
  2. Fall back through CORS proxies in order: `corsproxy.io` → `codetabs.com`. `allorigins.win` was removed as unreliable.
  3. Parse meta tags from the HTML (`og:*`, `name="title"`, `name="description"`, `twitter:image`, then `<title>` as last resort).
  4. If metadata is insufficient (no title, or missing both description and image), look for `<link type="application/json+oembed">` in the HTML and fetch it.
  5. Final fallback: `noembed.com` — a generic oEmbed aggregator that handles YouTube, Vimeo, etc. Needed because proxies often return stripped/JS-only HTML for YouTube (no OG tags, no oEmbed link).
- **`src/components/Home.ts`** — Main screen. Holds an imperatively-managed `localImages: Record<id, objectURL>` map. A `watch(links, ..., { immediate: true })` loads blobs for newly-visible links in parallel (`Promise.all`) and creates object URLs. `onUnmounted` revokes all URLs. `confirmRemove` also revokes before deleting. Template displays `localImages[id] || link.image` so the external URL is a fallback if the local blob is missing.

## Conventions

- **Semicolons required** on every TS/JS statement (explicit user preference).
- **4-space indentation** in TS files.
- `@/` is aliased to `./src` in both Vite and tsconfig.
- Model types live in `src/models/` (e.g. `Box` is the link record).
