import "dotenv/config";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import { config } from "./config.js";
import { GalleryDirectoryError, imageKindFor, readGalleryImageDetails, readGalleryImages, resolveSafeMediaPath } from "./gallery.js";
import { imagePreviewPath } from "./previews.js";
import type {
  ErrorResponse,
  GalleryResponse,
  ImageReportRequest,
  ImageReportResponse,
} from "../shared/types.js";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", "loopback");

const galleryCacheTtlMs = 10_000;
type GalleryCacheEntry = {
  images: GalleryResponse["images"];
  body: string;
  etag: string;
  expiresAt: number;
};
const galleryCache = new Map<string, GalleryCacheEntry>();
const galleryReadsInFlight = new Map<string, Promise<GalleryCacheEntry>>();

try {
  fs.watch(config.galleryDir, { recursive: true }, () => galleryCache.clear());
} catch (error) {
  console.warn("Gallery changes will be picked up after the index cache expires:", error);
}

function galleryCacheKey(includeDetails: boolean, includePreviewStatus: boolean): string {
  return `${includeDetails ? "details" : "compact"}:${includePreviewStatus ? "preview-status" : "no-preview-status"}`;
}

async function readCachedGalleryImages(includeDetails: boolean, includePreviewStatus: boolean): Promise<GalleryCacheEntry> {
  const key = galleryCacheKey(includeDetails, includePreviewStatus);
  const cached = galleryCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached;

  const existingRead = galleryReadsInFlight.get(key);
  if (existingRead) return existingRead;

  const read = readGalleryImages(config.galleryDir, {
    includeDetails,
    includePreviewStatus,
    previewCacheDir: config.previewCacheDir,
  }).then((images) => {
    const body = JSON.stringify({ images } satisfies GalleryResponse);
    const entry: GalleryCacheEntry = {
      images,
      body,
      etag: `W/"${createHash("sha256").update(body).digest("base64url")}"`,
      expiresAt: Date.now() + galleryCacheTtlMs,
    };
    galleryCache.set(key, entry);
    return entry;
  }).finally(() => {
    galleryReadsInFlight.delete(key);
  });
  galleryReadsInFlight.set(key, read);
  return read;
}

app.use((_request, response, next) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "SAMEORIGIN");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; script-src 'self' https://cdnjs.buymeacoffee.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'");
  next();
});

app.get("/healthz", (_request, response) => response.type("text/plain").send("ok"));

app.post("/api/reports", express.json({ limit: "4kb", type: "application/json" }), async (request, response) => {
  response.setHeader("Cache-Control", "no-store");

  if (!config.reportingEnabled) {
    return void response.status(404).json({ error: "Image reporting is disabled." } satisfies ErrorResponse);
  }

  const requestHost = request.get("host");
  const requestOrigin = requestHost ? `${request.protocol}://${requestHost}` : undefined;
  if (!requestOrigin || request.get("origin") !== requestOrigin) {
    return void response.status(403).json({ error: "Report requests must come from this gallery." } satisfies ErrorResponse);
  }

  const body = request.body as Partial<ImageReportRequest> | undefined;
  if (
    !body || typeof body.imagePath !== "string" || body.imagePath.length > 2_048
  ) {
    return void response.status(400).json({ error: "Invalid image report." } satisfies ErrorResponse);
  }

  const mediaPath = await resolveSafeMediaPath(config.galleryDir, body.imagePath);
  if (!mediaPath) {
    return void response.status(404).json({ error: "The reported image could not be found." } satisfies ErrorResponse);
  }

  try {
    await fs.promises.mkdir(path.dirname(config.reportListPath), { recursive: true });
    await fs.promises.appendFile(config.reportListPath, `${mediaPath}\n`, "utf8");
  } catch (error) {
    console.error("Could not record image report:", error);
    return void response.status(502).json({ error: "The report could not be recorded." } satisfies ErrorResponse);
  }

  const payload: ImageReportResponse = { message: "Report recorded." };
  response.status(202).json(payload);
});

app.get("/api/images", async (request, response) => {
  try {
    const includePreviewStatus = request.query.includePreviewStatus === "1";
    const includeDetails = request.query.details === "1";
    const cached = await readCachedGalleryImages(includeDetails, includePreviewStatus);
    response.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
    response.setHeader("ETag", cached.etag);
    if (request.get("if-none-match")?.split(",").some((value) => value.trim() === cached.etag)) {
      return void response.status(304).end();
    }
    response.type("application/json").send(cached.body);
  } catch (error) {
    response.setHeader("Cache-Control", "no-store");
    const payload: ErrorResponse = {
      error: error instanceof GalleryDirectoryError ? error.message : "The gallery could not be loaded.",
    };
    response.status(503).json(payload);
  }
});

app.get("/api/image-details", async (request, response) => {
  response.setHeader("Cache-Control", "private, max-age=60");
  const requestedPath = typeof request.query.path === "string" ? request.query.path : "";
  const details = await readGalleryImageDetails(config.galleryDir, requestedPath);
  if (!details) return void response.status(404).json({ error: "Image details were not found." } satisfies ErrorResponse);
  response.json(details);
});

app.get(/^\/media\/(.+)$/, async (request, response, next) => {
  const requestedPath = request.params[0];
  if (!requestedPath) return void response.sendStatus(404);

  const mediaPath = await resolveSafeMediaPath(config.galleryDir, requestedPath);
  if (!mediaPath) return void response.sendStatus(404);

  response.setHeader("Cache-Control", "public, max-age=3600, must-revalidate");
  response.sendFile(mediaPath, { dotfiles: "deny", lastModified: true }, (error) => {
    if (error && !response.headersSent) next(error);
  });
});

app.get(/^\/previews\/(.+)$/, async (request, response, next) => {
  const requestedPath = request.params[0];
  if (!requestedPath) return void response.sendStatus(404);

  const imageKind = imageKindFor(requestedPath);
  if (imageKind !== "gif" && imageKind !== "png") return void response.sendStatus(404);

  const mediaPath = await resolveSafeMediaPath(config.galleryDir, requestedPath);
  if (!mediaPath) return void response.sendStatus(404);

  try {
    const previewPath = await imagePreviewPath(mediaPath, requestedPath, config.previewCacheDir);
    response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    response.type("webp");
    response.sendFile(path.basename(previewPath), {
      root: path.dirname(previewPath),
      dotfiles: "deny",
      lastModified: true,
    }, (error) => {
      if (error && !response.headersSent) next(error);
    });
  } catch (error) {
    next(error);
  }
});

app.use(express.static(config.publicDir, {
  index: false,
  fallthrough: true,
  maxAge: "1h",
  setHeaders(response, filePath) {
    if (filePath.includes(`${path.sep}assets${path.sep}`)) {
      response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    }
  },
}));

app.get(/.*/, (_request, response) => {
  response.setHeader("Cache-Control", "no-cache");
  response.sendFile(path.join(config.publicDir, "index.html"));
});

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  console.error(error);
  if (!response.headersSent) response.status(500).json({ error: "Unexpected server error." });
});

app.listen(config.port, config.host, () => {
  console.log(`Image Gallery listening at http://${config.host}:${config.port}`);
  console.log(`Serving media from ${config.galleryDir}`);
  void readCachedGalleryImages(false, false).catch((error) => {
    console.error("Could not warm the gallery index:", error);
  });
});
