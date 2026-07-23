import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { deleteGalleryImage } from "./admin.js";

test("admin deletion removes only the selected safe media file", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "image-gallery-admin-"));
  try {
    await mkdir(path.join(root, "batch"));
    await writeFile(path.join(root, "batch", "image.gif"), "gif");
    await writeFile(path.join(root, "batch", "image.json"), "{}");

    assert.equal(await deleteGalleryImage(root, "batch/image.gif"), true);
    assert.equal(await readFile(path.join(root, "batch", "image.json"), "utf8"), "{}");
    assert.equal(await deleteGalleryImage(root, "../outside.gif"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
