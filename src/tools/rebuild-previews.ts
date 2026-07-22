import "dotenv/config";
import { mkdir, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { config } from "../server/config.js";
import { imagePreviewPath, imagePreviewProfile } from "../server/previews.js";

const previewExtensions = new Set([".gif", ".png"]);

function isWithin(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertSafeCacheRoot(): void {
  const cacheRoot = path.resolve(config.previewCacheDir);
  const projectRoot = path.resolve(process.cwd());
  const filesystemRoot = path.parse(cacheRoot).root;
  const homeDirectory = path.resolve(os.homedir());
  if (cacheRoot === filesystemRoot) throw new Error("Refusing to use the filesystem root as PREVIEW_CACHE_DIR.");
  if (isWithin(projectRoot, cacheRoot)) throw new Error(`Refusing to use a directory containing the repository as PREVIEW_CACHE_DIR: ${cacheRoot}`);
  if (isWithin(homeDirectory, cacheRoot)) throw new Error(`Refusing to use a directory containing the user home as PREVIEW_CACHE_DIR: ${cacheRoot}`);
  if (isWithin(cacheRoot, config.galleryDir) || isWithin(config.galleryDir, cacheRoot)) {
    throw new Error("GALLERY_DIR and PREVIEW_CACHE_DIR must be separate, non-nested directories.");
  }
}

async function findPreviewSources(directory: string, relativeDirectory = ""): Promise<Array<{ absolutePath: string; relativePath: string }>> {
  const sources: Array<{ absolutePath: string; relativePath: string }> = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) sources.push(...await findPreviewSources(absolutePath, relativePath));
    else if (entry.isFile() && previewExtensions.has(path.extname(entry.name).toLocaleLowerCase())) {
      sources.push({ absolutePath, relativePath });
    }
  }
  return sources;
}

async function main(): Promise<void> {
  const unknown = process.argv.slice(2).filter((argument) => argument !== "--apply");
  if (unknown.length > 0) throw new Error("Usage: npm run rebuild-previews -- [--apply]");
  assertSafeCacheRoot();
  const sources = await findPreviewSources(config.galleryDir);
  if (!process.argv.includes("--apply")) {
    console.log(`Dry run: ${sources.length} PNG/GIF preview${sources.length === 1 ? "" : "s"} would be rebuilt using ${imagePreviewProfile}.`);
    console.log("No files changed. Re-run with -- --apply to replace the derived preview cache.");
    return;
  }

  await rm(config.previewCacheDir, { recursive: true, force: true });
  await mkdir(config.previewCacheDir, { recursive: true });
  let completed = 0;
  let nextIndex = 0;
  const failures: string[] = [];
  async function worker(): Promise<void> {
    while (nextIndex < sources.length) {
      const source = sources[nextIndex++]!;
      try {
        await imagePreviewPath(source.absolutePath, source.relativePath, config.previewCacheDir);
      } catch (error) {
        failures.push(`${source.relativePath}: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        completed += 1;
        process.stdout.write(`\rRebuilt ${completed}/${sources.length}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, sources.length) }, () => worker()));
  if (sources.length > 0) process.stdout.write("\n");
  if (failures.length > 0) throw new Error(`Some previews could not be rebuilt:\n${failures.join("\n")}`);
  console.log(`Rebuilt ${sources.length} preview${sources.length === 1 ? "" : "s"} using ${imagePreviewProfile}.`);
}

main().catch((error) => {
  console.error(`Preview rebuild failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
