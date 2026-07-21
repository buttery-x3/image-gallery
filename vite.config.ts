import fs from "node:fs";
import path from "node:path";
import { defineConfig, loadEnv, type Plugin } from "vite";

const fallbackTitle = "Image Gallery";
const fallbackDescription = "A simple private image gallery.";

type GalleryConfig = {
  siteName: string;
  searchMetadata: boolean;
  showLanguageToggle: boolean;
  showNames: boolean;
  enableReporting: boolean;
  showWatermark: boolean;
  watermarkText: string;
  watermarkPosition: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  metadata?: { schemas?: Record<string, unknown> };
};

function readGalleryConfig(): GalleryConfig {
  const configPath = path.resolve(process.cwd(), "gallery.config.json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (error) {
    throw new Error(`Could not read ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("gallery.config.json must contain a JSON object.");
  }
  const record = parsed as Record<string, unknown>;
  const siteName = typeof record.siteName === "string" ? record.siteName.trim() : "";
  if (!siteName) throw new Error("gallery.config.json siteName must be a non-empty string.");
  for (const key of ["searchMetadata", "showLanguageToggle", "showNames", "enableReporting", "showWatermark"] as const) {
    if (typeof record[key] !== "boolean") throw new Error(`gallery.config.json ${key} must be true or false.`);
  }
  const watermarkText = typeof record.watermarkText === "string" ? record.watermarkText.trim() : "";
  if (!watermarkText) throw new Error("gallery.config.json watermarkText must be a non-empty string.");
  const watermarkPosition = record.watermarkPosition;
  if (!(["top-left", "top-right", "bottom-left", "bottom-right"] as const).includes(watermarkPosition as never)) {
    throw new Error("gallery.config.json watermarkPosition must be a corner name.");
  }
  let metadata: GalleryConfig["metadata"];
  if (record.metadata !== undefined) {
    if (!record.metadata || typeof record.metadata !== "object" || Array.isArray(record.metadata)) {
      throw new Error("gallery.config.json metadata must be an object.");
    }
    const metadataRecord = record.metadata as Record<string, unknown>;
    if (metadataRecord.enabledSchemas !== undefined) {
      throw new Error("gallery.config.json metadata.enabledSchemas has been replaced by metadata.schemas.");
    }
    if (metadataRecord.schemas !== undefined && (
      !metadataRecord.schemas || typeof metadataRecord.schemas !== "object" || Array.isArray(metadataRecord.schemas)
    )) throw new Error("gallery.config.json metadata.schemas must be an object keyed by source metadata schema.");
    metadata = metadataRecord.schemas === undefined ? {} : { schemas: metadataRecord.schemas as Record<string, unknown> };
  }
  return {
    siteName,
    searchMetadata: record.searchMetadata as boolean,
    showLanguageToggle: record.showLanguageToggle as boolean,
    showNames: record.showNames as boolean,
    enableReporting: record.enableReporting as boolean,
    showWatermark: record.showWatermark as boolean,
    watermarkText,
    watermarkPosition: watermarkPosition as GalleryConfig["watermarkPosition"],
    ...(metadata ? { metadata } : {}),
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character]!);
}

function publicSiteUrl(value: string | undefined): URL | undefined {
  if (!value?.trim()) return undefined;

  const siteUrl = new URL(value.trim());
  if (siteUrl.protocol !== "http:" && siteUrl.protocol !== "https:") {
    throw new Error("SITE_URL must use http or https.");
  }
  siteUrl.hash = "";
  siteUrl.search = "";
  if (!siteUrl.pathname.endsWith("/")) siteUrl.pathname += "/";
  return siteUrl;
}

function galleryHtml(title: string, description: string, siteUrl: URL | undefined, config: GalleryConfig): Plugin {
  return {
    name: "gallery-html-metadata",
    transformIndexHtml(html) {
      const metadata = [
        `<meta name="description" content="${escapeHtml(description)}" />`,
        '<meta property="og:type" content="website" />',
        `<meta property="og:site_name" content="${escapeHtml(title)}" />`,
        `<meta property="og:title" content="${escapeHtml(title)}" />`,
        `<meta property="og:description" content="${escapeHtml(description)}" />`,
        '<meta name="twitter:card" content="summary" />',
        `<meta name="twitter:title" content="${escapeHtml(title)}" />`,
        `<meta name="twitter:description" content="${escapeHtml(description)}" />`,
      ];

      if (siteUrl) {
        const socialImageUrl = new URL("social-preview.png", siteUrl).href;
        metadata.push(
          `<link rel="canonical" href="${escapeHtml(siteUrl.href)}" />`,
          `<meta property="og:url" content="${escapeHtml(siteUrl.href)}" />`,
          `<meta property="og:image" content="${escapeHtml(socialImageUrl)}" />`,
          '<meta property="og:image:type" content="image/png" />',
          '<meta property="og:image:width" content="256" />',
          '<meta property="og:image:height" content="256" />',
          `<meta property="og:image:alt" content="${escapeHtml(`${title} icon`)}" />`,
          `<meta name="twitter:image" content="${escapeHtml(socialImageUrl)}" />`,
          `<meta name="twitter:image:alt" content="${escapeHtml(`${title} icon`)}" />`,
        );
      }

      return html
        .replaceAll("__GALLERY_TITLE__", escapeHtml(title))
        .replace("__GALLERY_SEARCH_METADATA__", String(config.searchMetadata))
        .replace("__GALLERY_LANGUAGE_TOGGLE__", String(config.showLanguageToggle))
        .replace("__GALLERY_SHOW_NAMES__", String(config.showNames))
        .replace("__GALLERY_ENABLE_REPORTING__", String(config.enableReporting))
        .replace("__GALLERY_SHOW_WATERMARK__", String(config.showWatermark))
        .replace("__GALLERY_WATERMARK_TEXT__", escapeHtml(config.watermarkText))
        .replace("__GALLERY_WATERMARK_POSITION__", config.watermarkPosition)
        .replace("<!-- gallery-metadata -->", metadata.join("\n    "));
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const config = readGalleryConfig();
  const title = config.siteName || fallbackTitle;
  const description = env.GALLERY_DESCRIPTION?.trim() || fallbackDescription;
  const siteUrl = publicSiteUrl(env.SITE_URL);

  return {
    root: "src/web",
    base: "./",
    plugins: [galleryHtml(title, description, siteUrl, config)],
    build: {
      outDir: "../../dist/public",
      emptyOutDir: false,
    },
    server: {
      proxy: {
        "/api": "http://127.0.0.1:8080",
        "/media": "http://127.0.0.1:8080",
        "/previews": "http://127.0.0.1:8080",
        "/healthz": "http://127.0.0.1:8080",
      },
    },
  };
});
