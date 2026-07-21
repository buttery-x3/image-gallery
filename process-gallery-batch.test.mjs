import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const projectRoot = path.dirname(fileURLToPath(import.meta.url));

test("batch naming is selected independently for each source metadata schema", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "image-gallery-batch-test-"));
  const galleryDirectory = path.join(temporaryRoot, "gallery");
  const previewDirectory = path.join(temporaryRoot, "previews");
  await mkdir(galleryDirectory);
  try {
    await Promise.all([
      writeFile(path.join(galleryDirectory, "woman.png"), new Uint8Array([1, 2, 3])),
      writeFile(path.join(galleryDirectory, "woman.json"), '{"schema":"anime_waifu_lite/v1"}'),
      writeFile(path.join(galleryDirectory, "creature.png"), new Uint8Array([4, 5, 6, 7])),
      writeFile(path.join(galleryDirectory, "creature.json"), JSON.stringify({ anime_creature_lite_v4: {
        schema: "anime_creature_lite_v4/v1",
        creature_family: "CANINE",
        species: "fox",
        global_selections: { creature_color_primary: "white", creature_color_secondary: "black" },
      } })),
    ]);
    const { stdout } = await execFileAsync(process.execPath, ["process-gallery-batch.mjs", "--dry-run"], {
      cwd: projectRoot,
      env: {
        ...process.env,
        GALLERY_DIR: galleryDirectory,
        PREVIEW_CACHE_DIR: previewDirectory,
        BATCH_NAME_STYLE: "",
      },
    });
    assert.match(stdout, /woman\.png -> [a-z]+-[a-z]+\.png/);
    assert.match(stdout, /creature\.png -> [a-z]+-(?:white|black|soft|wild|bright|swift)(?:tail|paw|fang|ear)\.png/);
    assert.match(stdout, /Images that would be renamed: 2/);
    assert.match(stdout, /Generated name metadata files that would be added: 2/);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("the removed environment naming switch fails with migration guidance", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, ["process-gallery-batch.mjs", "--dry-run"], {
      cwd: projectRoot,
      env: { ...process.env, BATCH_NAME_STYLE: "japanese-fantasy" },
    }),
    (error) => {
      assert.match(error.stderr, /BATCH_NAME_STYLE is no longer supported/);
      assert.match(error.stderr, /metadata\.schemas\.<source-schema>\.nameGeneration/);
      return true;
    },
  );
});

test("orphan source JSON is reported for quarantine without blocking valid images", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "image-gallery-orphan-dry-run-test-"));
  const galleryDirectory = path.join(temporaryRoot, "gallery");
  const previewDirectory = path.join(temporaryRoot, "previews");
  await mkdir(galleryDirectory);
  try {
    await Promise.all([
      writeFile(path.join(galleryDirectory, "valid.png"), new Uint8Array([1, 2, 3])),
      writeFile(path.join(galleryDirectory, "orphan.json"), '{"schema":"example/v1"}'),
    ]);
    const { stdout } = await execFileAsync(process.execPath, ["process-gallery-batch.mjs", "--dry-run"], {
      cwd: projectRoot,
      env: {
        ...process.env,
        GALLERY_DIR: galleryDirectory,
        PREVIEW_CACHE_DIR: previewDirectory,
        BATCH_NAME_STYLE: "",
      },
    });
    assert.match(stdout, /Would quarantine 1 orphan source JSON file/);
    assert.match(stdout, /orphan\.json.*orphan source JSON; no same-name image/);
    assert.match(stdout, /Images that would be added: 1/);
    assert.match(stdout, /Orphan source JSON files that would be quarantined: 1/);
    assert.deepEqual((await readdir(galleryDirectory)).sort(), ["orphan.json", "valid.png"]);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("a batch containing only orphan source JSON moves it into recoverable quarantine", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "image-gallery-orphan-apply-test-"));
  const galleryDirectory = path.join(temporaryRoot, "gallery");
  const previewDirectory = path.join(temporaryRoot, "previews");
  await mkdir(galleryDirectory);
  try {
    await writeFile(path.join(galleryDirectory, "orphan.json"), "not required to be valid when no image exists");
    const { stdout } = await execFileAsync(process.execPath, ["process-gallery-batch.mjs"], {
      cwd: projectRoot,
      env: {
        ...process.env,
        GALLERY_DIR: galleryDirectory,
        PREVIEW_CACHE_DIR: previewDirectory,
        BATCH_NAME_STYLE: "",
      },
    });
    const rootEntries = await readdir(galleryDirectory);
    assert.deepEqual(rootEntries, [".duplicates"]);
    const quarantineBatches = await readdir(path.join(galleryDirectory, ".duplicates"));
    assert.equal(quarantineBatches.length, 1);
    assert.deepEqual(
      await readdir(path.join(galleryDirectory, ".duplicates", quarantineBatches[0])),
      ["orphan.json"],
    );
    assert.match(stdout, /Quarantined 1 orphan source JSON file/);
    assert.match(stdout, /Orphan source JSON files quarantined: 1/);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
