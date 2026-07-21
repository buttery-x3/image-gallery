import "dotenv/config";
import { lstat, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const generatedNameSuffix = ".gallery-name.json";
const modes = new Set(["generated-only", "all"]);

function isWithin(child, parent) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertSafeRoot(target, label, projectRoot) {
  const resolved = path.resolve(target);
  const filesystemRoot = path.parse(resolved).root;
  const homeDirectory = path.resolve(os.homedir());
  if (resolved === filesystemRoot) throw new Error(`Refusing to use the filesystem root as ${label}.`);
  if (isWithin(projectRoot, resolved)) throw new Error(`Refusing to use a directory containing the repository as ${label}: ${resolved}`);
  if (isWithin(homeDirectory, resolved)) throw new Error(`Refusing to use a directory containing the user home as ${label}: ${resolved}`);
  return resolved;
}

export function resolveCleanupRoots(environment = process.env, projectRoot = process.cwd()) {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const galleryRoot = assertSafeRoot(
    path.resolve(resolvedProjectRoot, environment.GALLERY_DIR ?? "gallery"),
    "GALLERY_DIR",
    resolvedProjectRoot,
  );
  const previewCacheRoot = assertSafeRoot(
    path.resolve(resolvedProjectRoot, environment.PREVIEW_CACHE_DIR ?? ".cache/previews"),
    "PREVIEW_CACHE_DIR",
    resolvedProjectRoot,
  );
  if (isWithin(previewCacheRoot, galleryRoot) || isWithin(galleryRoot, previewCacheRoot)) {
    throw new Error("GALLERY_DIR and PREVIEW_CACHE_DIR must be separate, non-nested directories.");
  }
  return { galleryRoot, previewCacheRoot };
}

async function rootEntries(root, label) {
  let stats;
  try {
    stats = await lstat(root);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  if (stats.isSymbolicLink()) throw new Error(`Refusing to clear symbolic-link ${label}: ${root}`);
  if (!stats.isDirectory()) throw new Error(`${label} is not a directory: ${root}`);
  return readdir(root, { withFileTypes: true });
}

async function generatedSidecars(root) {
  const results = [];
  for (const entry of await rootEntries(root, "gallery root")) {
    const entryPath = path.join(root, entry.name);
    if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) results.push(...await generatedSidecars(entryPath));
    else if (entry.isFile() && entry.name.endsWith(generatedNameSuffix)) results.push(entryPath);
  }
  return results;
}

function target(kind, targetPath) {
  return { kind, path: targetPath };
}

export async function planCleanup(mode, roots) {
  if (!modes.has(mode)) throw new Error(`Unsupported cleanup mode: ${String(mode)}`);
  const galleryEntries = await rootEntries(roots.galleryRoot, "gallery root");
  const cacheEntries = await rootEntries(roots.previewCacheRoot, "preview cache root");
  const targets = [];

  if (mode === "all") {
    for (const entry of galleryEntries) {
      if (entry.name === ".gitkeep") continue;
      targets.push(target("gallery content", path.join(roots.galleryRoot, entry.name)));
    }
  } else {
    for (const sidecar of await generatedSidecars(roots.galleryRoot)) {
      targets.push(target("generated-name sidecar", sidecar));
    }
  }
  for (const entry of cacheEntries) {
    targets.push(target("preview cache", path.join(roots.previewCacheRoot, entry.name)));
  }

  targets.sort((left, right) => left.path.localeCompare(right.path));
  return { mode, roots, targets };
}

export function confirmationPhrase(mode) {
  if (mode === "generated-only") return "DELETE GENERATED ARTIFACTS";
  if (mode === "all") return "DELETE ALL GALLERY CONTENT";
  throw new Error(`Unsupported cleanup mode: ${String(mode)}`);
}

export async function applyCleanup(plan) {
  let removed = 0;
  for (const item of plan.targets) {
    let stats;
    try {
      stats = await lstat(item.path);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    await rm(item.path, { recursive: stats.isDirectory() && !stats.isSymbolicLink(), force: false });
    removed += 1;
  }
  return removed;
}

function parseArguments(args) {
  const modeArguments = args.filter((argument) => argument === "--generated-only" || argument === "--all");
  const unknown = args.filter((argument) => !["--generated-only", "--all", "--apply"].includes(argument));
  if (modeArguments.length !== 1 || unknown.length > 0 || args.filter((argument) => argument === "--apply").length > 1) {
    throw new Error("Usage: node clear-gallery-data.mjs (--generated-only|--all) [--apply]");
  }
  return {
    mode: modeArguments[0] === "--all" ? "all" : "generated-only",
    apply: args.includes("--apply"),
  };
}

function printPlan(plan, apply) {
  const action = apply ? "Will permanently remove" : "Dry run would remove";
  console.log(`${action} ${plan.targets.length} target entr${plan.targets.length === 1 ? "y" : "ies"}:`);
  for (const item of plan.targets) console.log(`  [${item.kind}] ${item.path}`);
  if (plan.mode === "generated-only") {
    console.log("Original images, source JSON metadata, .duplicates, and .gitkeep are preserved.");
  } else {
    console.log(`The gallery root and ${path.join(plan.roots.galleryRoot, ".gitkeep")} are preserved.`);
  }
}

async function requestConfirmation(mode) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Destructive cleanup requires an interactive terminal; no non-interactive override is available.");
  }
  const phrase = confirmationPhrase(mode);
  console.warn("WARNING: This operation cannot be undone by the gallery application.");
  if (mode === "generated-only") {
    console.warn("Preview files can regenerate, but generated-name sidecars will remain absent until explicitly regenerated.");
  } else {
    console.warn("Every image, source metadata sidecar, generated sidecar, and duplicate quarantine entry will be deleted.");
  }
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await terminal.question(`Type ${phrase} to continue: `);
    return answer === phrase;
  } finally {
    terminal.close();
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const roots = resolveCleanupRoots();
  const plan = await planCleanup(options.mode, roots);
  printPlan(plan, options.apply);
  if (!options.apply) {
    console.log("No files changed. Pass --apply to request destructive cleanup.");
    return;
  }
  if (plan.targets.length === 0) {
    console.log("Nothing to remove.");
    return;
  }
  if (!await requestConfirmation(options.mode)) {
    console.log("Confirmation did not match; no files changed.");
    process.exitCode = 1;
    return;
  }
  const removed = await applyCleanup(plan);
  console.log(`Removed ${removed} target entr${removed === 1 ? "y" : "ies"}. Restart or refresh the gallery before verifying the result.`);
}

const isEntryPoint = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isEntryPoint) {
  main().catch((error) => {
    console.error(`Cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
