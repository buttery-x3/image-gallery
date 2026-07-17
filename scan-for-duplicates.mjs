import "dotenv/config";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";

const supportedExtensions = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif"]);
const galleryRoot = path.resolve(process.env.GALLERY_DIR ?? "gallery");

if (process.argv.length > 2) {
  console.error("Usage: node scan-for-duplicates.mjs");
  process.exit(2);
}

function relativeGalleryPath(absolutePath) {
  return path.relative(galleryRoot, absolutePath).split(path.sep).join("/");
}

async function collectBatchedImages() {
  const images = [];

  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;

      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
      } else if (entry.isFile() && supportedExtensions.has(path.extname(entry.name).toLowerCase())) {
        images.push({ absolutePath, relativePath: relativeGalleryPath(absolutePath) });
      }
    }
  }

  const rootEntries = await readdir(galleryRoot, { withFileTypes: true });
  for (const entry of rootEntries) {
    if (entry.name.startsWith(".") || entry.isSymbolicLink() || !entry.isDirectory()) continue;
    await walk(path.join(galleryRoot, entry.name));
  }

  return images.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function contentHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function main() {
  const images = await collectBatchedImages();
  console.log(`Scanning ${images.length} batched image${images.length === 1 ? "" : "s"} with SHA-256...`);

  const imagesByHash = new Map();
  for (const [index, image] of images.entries()) {
    const hash = await contentHash(image.absolutePath);
    const matches = imagesByHash.get(hash) ?? [];
    matches.push(image.relativePath);
    imagesByHash.set(hash, matches);

    const scanned = index + 1;
    if (scanned % 100 === 0 && scanned < images.length) {
      console.log(`Hashed ${scanned}/${images.length} images...`);
    }
  }

  const duplicateGroups = [...imagesByHash.entries()]
    .filter(([, matches]) => matches.length > 1)
    .sort((left, right) => left[1][0].localeCompare(right[1][0]));

  if (duplicateGroups.length === 0) {
    console.log("No duplicate batched images found.");
    return;
  }

  console.log("");
  for (const [index, [hash, matches]] of duplicateGroups.entries()) {
    console.log(`Duplicate group ${index + 1} (SHA-256 ${hash}):`);
    for (const match of matches) console.log(`- ${match}`);
    console.log("");
  }

  const duplicateCopies = duplicateGroups.reduce((total, [, matches]) => total + matches.length - 1, 0);
  console.log(
    `Found ${duplicateCopies} duplicate cop${duplicateCopies === 1 ? "y" : "ies"} ` +
    `in ${duplicateGroups.length} group${duplicateGroups.length === 1 ? "" : "s"} ` +
    `across ${images.length} batched image${images.length === 1 ? "" : "s"}.`,
  );
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
