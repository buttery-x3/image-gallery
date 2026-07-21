import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
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
      writeFile(path.join(galleryDirectory, "creature.json"), '{"schema":"anime_creature_lite_v4/v1"}'),
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
    assert.match(stdout, /creature\.png \+ creature\.json/);
    assert.doesNotMatch(stdout, /creature\.png ->/);
    assert.match(stdout, /Images that would be renamed: 1/);
    assert.match(stdout, /Generated name metadata files that would be added: 1/);
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
