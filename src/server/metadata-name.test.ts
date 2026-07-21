import assert from "node:assert/strict";
import test from "node:test";
import { parseImageNameMetadata } from "./metadata.js";

test("reads legacy bilingual generated-name metadata", () => {
  assert.deepEqual(parseImageNameMetadata({
    schema: "image-gallery/name/v1",
    shortName: { en: "Hana Mori", ja: "ハナ・モリ" },
  }), { en: "Hana Mori", ja: "ハナ・モリ" });
});

test("reads either representation from provenance-bearing v2 metadata", () => {
  const provenance = {
    schema: "image-gallery/name/v2",
    sourceMetadataSchema: "example/v1",
    generatorSchema: "image-gallery/name-generator/example/v1",
  };
  assert.deepEqual(parseImageNameMetadata({ ...provenance, shortName: { en: "Hana Mori" } }), { en: "Hana Mori" });
  assert.deepEqual(parseImageNameMetadata({ ...provenance, shortName: { ja: "ハナ・モリ" } }), { ja: "ハナ・モリ" });
});

test("rejects incomplete v2 provenance and incomplete legacy metadata", () => {
  assert.equal(parseImageNameMetadata({
    schema: "image-gallery/name/v2",
    shortName: { en: "Hana Mori" },
  }), undefined);
  assert.equal(parseImageNameMetadata({
    schema: "image-gallery/name/v1",
    shortName: { en: "Hana Mori" },
  }), undefined);
});
