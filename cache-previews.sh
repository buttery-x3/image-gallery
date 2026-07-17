#!/usr/bin/env bash

set -Eeuo pipefail

repository_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$repository_dir"

node --input-type=module - "${1:-}" "${2:-}" <<'NODE'
import "dotenv/config";

const requestedBaseUrl = process.argv[2];
const requestedPathPrefix = process.argv[3]
  ?.replaceAll("\\", "/")
  .replace(/^\/+|\/+$/g, "");
const baseUrl = new URL(
  requestedBaseUrl || `http://127.0.0.1:${process.env.PORT ?? "8080"}/`,
);
if (!baseUrl.pathname.endsWith("/")) baseUrl.pathname += "/";

const galleryUrl = new URL("api/images", baseUrl);
galleryUrl.searchParams.set("includePreviewStatus", "1");
const galleryResponse = await fetch(galleryUrl, { cache: "no-store" });
if (!galleryResponse.ok) {
  throw new Error(`Could not load the gallery (${galleryResponse.status} ${galleryResponse.statusText}).`);
}

const payload = await galleryResponse.json();
if (!payload || !Array.isArray(payload.images)) {
  throw new Error("The gallery returned an unexpected response.");
}

const previewImages = payload.images.filter((image) => {
  if (!image || typeof image.previewUrl !== "string") return false;
  if (!requestedPathPrefix) return true;
  return typeof image.path === "string" && image.path.startsWith(`${requestedPathPrefix}/`);
});
const cachedCount = previewImages.filter((image) => image.previewCached === true).length;
const previewUrls = previewImages
  .filter((image) => image.previewCached !== true)
  .map((image) => image.previewUrl);

if (cachedCount > 0) {
  console.log(`${cachedCount} preview${cachedCount === 1 ? " is" : "s are"} already cached.`);
}

if (previewUrls.length === 0) {
  console.log(requestedPathPrefix
    ? `No PNG or GIF previews need caching in ${requestedPathPrefix}.`
    : "No PNG or GIF previews need caching.");
  process.exit(0);
}

console.log(`Caching ${previewUrls.length} missing preview${previewUrls.length === 1 ? "" : "s"} through ${baseUrl.href}`);

let nextIndex = 0;
let completed = 0;
const failures = [];

async function cacheNextPreview() {
  while (nextIndex < previewUrls.length) {
    const index = nextIndex;
    nextIndex += 1;
    const previewUrl = new URL(previewUrls[index], baseUrl);

    try {
      const response = await fetch(previewUrl, { method: "HEAD", cache: "no-store" });
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
    } catch (error) {
      failures.push(`${previewUrl.href}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      completed += 1;
      process.stdout.write(`\rCached ${completed}/${previewUrls.length}`);
    }
  }
}

await Promise.all(
  Array.from({ length: Math.min(4, previewUrls.length) }, () => cacheNextPreview()),
);
process.stdout.write("\n");

if (failures.length > 0) {
  console.error(`Failed to cache ${failures.length} preview${failures.length === 1 ? "" : "s"}:`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("All previews are cached.");
}
NODE
