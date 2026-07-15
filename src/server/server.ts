import "dotenv/config";
import path from "node:path";
import express from "express";
import { config } from "./config.js";
import { GalleryDirectoryError, readGalleryImages, resolveSafeMediaPath } from "./gallery.js";
import type { ErrorResponse, GalleryResponse } from "../shared/types.js";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", "loopback");

app.use((_request, response, next) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "SAMEORIGIN");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'");
  next();
});

app.get("/healthz", (_request, response) => response.type("text/plain").send("ok"));

app.get("/api/images", async (_request, response) => {
  response.setHeader("Cache-Control", "no-store");
  try {
    const payload: GalleryResponse = { images: await readGalleryImages(config.galleryDir) };
    response.json(payload);
  } catch (error) {
    const payload: ErrorResponse = {
      error: error instanceof GalleryDirectoryError ? error.message : "The gallery could not be loaded.",
    };
    response.status(503).json(payload);
  }
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
});
