# Roadmap

The Svelte public-gallery rewrite is complete. These items remain intentionally outside that parity and performance pass.

## Stable media identity and SQLite

Before server-backed favorites, ratings, or admin mutations, introduce a SQLite database outside `gallery/` and Git. Use WAL mode, explicit migrations, backups before migration, and a stable internal media ID associated with a content hash. Paths remain mutable records so state survives batch moves and operator renames.

Likely tables include `media`, `media_paths`, `ratings`, `favorites`, `reports`, `admin_sessions`, `admin_audit_log`, and `schema_migrations`.

## Admin authentication

Use an application login backed by `ADMIN_PASSWORD_HASH`, containing an Argon2id hash rather than plaintext. Provide an interactive hash-generation command. Successful login creates an opaque, rotated, SQLite-backed session using `HttpOnly`, `Secure`, `SameSite=Strict` cookies with idle and absolute expiry.

Mutations require origin validation and CSRF protection. Login requires throttling and increasing backoff. High-impact changes require recent reauthentication and an audit record. OAuth should later issue the same internal session type.

## Admin console

Reserve `/admin` and `/api/admin/*` for authenticated work. Planned capabilities are upload, delete, rename, metadata editing, report moderation, and operational diagnostics. Filesystem changes must validate paths, preserve same-stem sidecars, update previews and database paths, and fail recoverably. Public gallery routes remain read-only.

## User interactions

Local favorites may later migrate to accounts. Ratings can begin as a favorite-derived interaction and later become server-backed. Database records must use stable media IDs rather than paths.

## Presentation

The lightbox state is separate from gallery appearance so pan, zoom, gestures, and optional focal-point metadata can be added without changing masonry layout or source media.
