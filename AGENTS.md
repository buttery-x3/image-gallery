# Agent instructions

## Purpose

This repository is intentionally a small private image gallery. Keep the implementation direct and avoid adding infrastructure intended for a large production team.

## Architecture

- `src/server` contains the Node.js/Express service.
- `src/web` contains the framework-free Vite/TypeScript SPA.
- `src/shared` contains the API types shared by both sides.
- `src/tools` contains small local maintenance and schema-onboarding commands.
- `metadata-schemas` contains declarative mappings from source metadata schemas to gallery tags.
- `name-generation-schemas` contains declarative filename and optional short-name generation rules.
- `gallery` is local content and must never be committed, modified, or deleted by application code except through an explicitly requested, operator-invoked maintenance command with dry-run and confirmation safeguards.
- The production build is generated under `dist` and is not committed.

## Product invariants

- Gallery images default to exactly 300px wide above the narrow-mobile breakpoint. Browser-local appearance settings may select compact, large, or adaptive widths.
- Gallery image height defaults to natural and unconstrained. Explicit fixed-ratio appearance modes may use `cover` or `contain`; natural mode must never crop or distort thumbnails.
- Gallery images have rounded corners.
- Lightbox images have square corners and use `object-fit: contain` with a viewport margin.
- GIF animation must be preserved.
- Gallery DOM must remain viewport-virtualized. Media files must be viewport-prioritized and limited to four concurrent loads, then continue through the full gallery in the background; do not assign every image URL during initial rendering.
- Header responsiveness must be CSS-driven through grid/flex layout and container queries. Do not reintroduce continuous JavaScript element-width measurement.
- The Copy link control must produce an absolute direct media URL. Copy image may fall back to that URL when image clipboard writing is unsupported.
- All browser requests must remain compatible with both `/` and a stripped Caddy prefix such as `/image-gallery/`.
- The server is read-only and must not add upload, delete, rename, or image-processing behavior unless explicitly requested.
- Hidden files and symbolic links must not be exposed.
- Ordinary same-stem JSON sidecars must be preserved regardless of whether their schema is enabled or understood.
- The batcher must remain schema-neutral; new metadata formats should normally be added through declarative definitions.
- Product categories and name generation are assigned per source metadata schema in `gallery.config.json`, not embedded in reusable definitions.
- The optional top-level type selector is keyed directly by source metadata schema and uses its configured `typeLabel`; render only present configured schemas and hide the selector unless at least two types are present.
- Contextual name generation must remain explicit per source schema through `pipeline: "contextual/v1"`; direct generators remain the default.
- Pipeline stages and the batcher must remain feature-neutral. Domain behavior belongs in declarative name definitions and consumes canonical tags from metadata definitions.
- Missing optional contextual values must fall back without blocking. Japanese contextual display names use declared semantic Japanese vocabulary, not automatic phonetic transliteration.
- Do not automatically rename or backfill existing gallery media when naming rules change.

## Scope discipline

Do not add Docker, Go, a database, authentication, CI workflows, a frontend framework, or a large test suite unless the user explicitly changes the scope.

## Before handing off changes

Run only the lightweight checks appropriate to this project:

```sh
npm run typecheck
npm run test:metadata
npm run test:cleanup
npm run build
```

For visual changes, perform a short browser smoke check covering the gallery layout, Copy control, and lightbox. Do not introduce a browser test harness solely for that check.
