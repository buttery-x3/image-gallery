import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import {
  applyCleanup,
  confirmationPhrase,
  planCleanup,
  resolveCleanupRoots,
} from "./clear-gallery-data.mjs";

const temporaryDirectories = [];

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "image-gallery-cleanup-test-"));
  temporaryDirectories.push(root);
  const galleryRoot = path.join(root, "gallery");
  const previewCacheRoot = path.join(root, "cache", "previews");
  await mkdir(path.join(galleryRoot, "batch", "nested"), { recursive: true });
  await mkdir(path.join(galleryRoot, ".duplicates", "old"), { recursive: true });
  await mkdir(path.join(previewCacheRoot, "ab"), { recursive: true });
  await writeFile(path.join(galleryRoot, ".gitkeep"), "");
  await writeFile(path.join(galleryRoot, "batch", "image.png"), "image");
  await writeFile(path.join(galleryRoot, "batch", "image.json"), "{}");
  await writeFile(path.join(galleryRoot, "batch", "image.gallery-name.json"), "{}");
  await writeFile(path.join(galleryRoot, "batch", "nested", "other.gallery-name.json"), "{}");
  await writeFile(path.join(galleryRoot, ".duplicates", "old", "duplicate.png"), "image");
  await writeFile(path.join(galleryRoot, ".duplicates", "old", "duplicate.gallery-name.json"), "{}");
  await writeFile(path.join(previewCacheRoot, "ab", "preview.webp"), "preview");
  return { root, galleryRoot, previewCacheRoot };
}

async function exists(filePath) {
  return access(filePath).then(() => true, () => false);
}

after(async () => {
  for (const directory of temporaryDirectories) await rm(directory, { recursive: true, force: true });
});

test("generated-only removes cache and generated names while preserving source content", async () => {
  const roots = await fixture();
  const plan = await planCleanup("generated-only", roots);
  assert.equal(plan.targets.filter((item) => item.kind === "generated-name sidecar").length, 2);
  assert.equal(plan.targets.filter((item) => item.kind === "preview cache").length, 1);

  await applyCleanup(plan);

  assert.equal(await exists(path.join(roots.galleryRoot, "batch", "image.png")), true);
  assert.equal(await exists(path.join(roots.galleryRoot, "batch", "image.json")), true);
  assert.equal(await exists(path.join(roots.galleryRoot, "batch", "image.gallery-name.json")), false);
  assert.equal(await exists(path.join(roots.galleryRoot, ".duplicates", "old", "duplicate.png")), true);
  assert.equal(await exists(path.join(roots.galleryRoot, ".duplicates", "old", "duplicate.gallery-name.json")), true);
  assert.deepEqual(await readdir(roots.previewCacheRoot), []);
});

test("all removes gallery contents and cache but preserves the root and .gitkeep", async () => {
  const roots = await fixture();
  const plan = await planCleanup("all", roots);
  assert.deepEqual(
    plan.targets.filter((item) => item.kind === "gallery content").map((item) => path.basename(item.path)).sort(),
    [".duplicates", "batch"],
  );

  await applyCleanup(plan);

  assert.deepEqual(await readdir(roots.galleryRoot), [".gitkeep"]);
  assert.deepEqual(await readdir(roots.previewCacheRoot), []);
});

test("configured roots reject broad and nested destructive targets", () => {
  const projectRoot = path.join(os.tmpdir(), "image-gallery-cleanup-project");
  assert.throws(
    () => resolveCleanupRoots({ GALLERY_DIR: projectRoot, PREVIEW_CACHE_DIR: path.join(projectRoot, "cache") }, projectRoot),
    /containing the repository/,
  );
  assert.throws(
    () => resolveCleanupRoots({ GALLERY_DIR: "gallery", PREVIEW_CACHE_DIR: "gallery/cache" }, projectRoot),
    /separate, non-nested/,
  );
});

test("each mode has a deliberately different confirmation phrase", () => {
  assert.equal(confirmationPhrase("generated-only"), "DELETE GENERATED ARTIFACTS");
  assert.equal(confirmationPhrase("all"), "DELETE ALL GALLERY CONTENT");
});

test("applied cleanup refuses piped confirmation and leaves files untouched", async () => {
  const roots = await fixture();
  const scriptPath = fileURLToPath(new URL("./clear-gallery-data.mjs", import.meta.url));
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, "--all", "--apply"], {
      cwd: roots.root,
      env: {
        ...process.env,
        GALLERY_DIR: roots.galleryRoot,
        PREVIEW_CACHE_DIR: roots.previewCacheRoot,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stderr }));
    child.stdin.end("DELETE ALL GALLERY CONTENT\n");
  });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /requires an interactive terminal/);
  assert.equal(await exists(path.join(roots.galleryRoot, "batch", "image.png")), true);
  assert.equal(await exists(path.join(roots.previewCacheRoot, "ab", "preview.webp")), true);
});
