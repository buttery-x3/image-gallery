import fs from "node:fs";
import path from "node:path";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

const fallbackTitle = "Image Gallery";
const fallbackDescription = "A simple private image gallery.";

type GalleryConfig = {
  siteName: string;
  searchMetadata: boolean;
  showTypeToggle: boolean;
  showLanguageToggle: boolean;
  showNames: boolean;
  showGitHubLink: boolean;
  enableReporting: boolean;
  enableSupportEmbed: boolean;
  showWatermark: boolean;
  watermarkText: string;
  watermarkPosition: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  contentNotice: {
    title: string;
    initialHtml: string;
    buttonLabel: string;
    expansionLabel: string;
    expansionHtml: string;
  };
  metadata?: { schemas?: Record<string, unknown> };
  typeLabels: Record<string, string>;
};

const defaultContentNotice: GalleryConfig["contentNotice"] = {
  title: "Content notice",
  initialHtml: [
    "<p>This website is intended not to show any sexually explicit content such as nudity.</p>",
    "<p>Due to the AI generated content some images may bypass initial review.</p>",
    "<p>This site is considered not safe for work despite not being explicit.</p>",
    "<p>Ecchi is considered okay -- Porn is not intended.</p>",
    "<p>Do you agree you will report any images using the red button which you find sexually explicit?</p>",
  ].join("\n"),
  buttonLabel: "I agree",
  expansionLabel: "more information (disclaimer)",
  expansionHtml: [
    "<p>The reason for this is to gain clearer understanding.</p>",
    "<p>Sheared clothing exposing breasts is common in fashion shows for example as fully unrestricted and viewable by all ages.</p>",
    "<p>The content on this site is similarly tasteful and artistic despite being AI generated as an artistic tool use.</p>",
    '<p>Complaints and questions are welcomed via e-mail at <a href="mailto:admin@flamehorn.com">admin@flamehorn.com</a>.</p>',
    "<p>This site is produced under good faith as an artistic/personal endeavor.</p>",
    "<p>I would also like to take this opportunity to pay my respects to the elders and traditional land owners of the Bunurong people on who's land this was thankfully developed.</p>",
  ].join("\n"),
};

function requiredText(record: Record<string, unknown>, key: string, prefix: string): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${prefix}.${key} must be a non-empty string.`);
  }
  return value.trim();
}

function requiredHtml(record: Record<string, unknown>, key: string, prefix: string): string {
  const value = record[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value) && value.length > 0 && value.every((fragment) => typeof fragment === "string" && fragment.trim())) {
    return value.map((fragment) => fragment.trim()).join("\n");
  }
  throw new Error(`${prefix}.${key} must be non-empty HTML or an array of non-empty HTML fragments.`);
}

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
  if (record.showTypeToggle !== undefined && typeof record.showTypeToggle !== "boolean") {
    throw new Error("gallery.config.json showTypeToggle must be true or false when configured.");
  }
  if (record.showGitHubLink !== undefined && typeof record.showGitHubLink !== "boolean") {
    throw new Error("gallery.config.json showGitHubLink must be true or false when configured.");
  }
  if (record.enableSupportEmbed !== undefined && typeof record.enableSupportEmbed !== "boolean") {
    throw new Error("gallery.config.json enableSupportEmbed must be true or false when configured.");
  }
  const watermarkText = typeof record.watermarkText === "string" ? record.watermarkText.trim() : "";
  if (!watermarkText) throw new Error("gallery.config.json watermarkText must be a non-empty string.");
  const watermarkPosition = record.watermarkPosition;
  if (!(["top-left", "top-right", "bottom-left", "bottom-right"] as const).includes(watermarkPosition as never)) {
    throw new Error("gallery.config.json watermarkPosition must be a corner name.");
  }
  let contentNotice = defaultContentNotice;
  if (record.contentNotice !== undefined) {
    if (!record.contentNotice || typeof record.contentNotice !== "object" || Array.isArray(record.contentNotice)) {
      throw new Error("gallery.config.json contentNotice must be an object.");
    }
    const notice = record.contentNotice as Record<string, unknown>;
    const prefix = "gallery.config.json contentNotice";
    contentNotice = {
      title: requiredText(notice, "title", prefix),
      initialHtml: requiredHtml(notice, "initialHtml", prefix),
      buttonLabel: requiredText(notice, "buttonLabel", prefix),
      expansionLabel: requiredText(notice, "expansionLabel", prefix),
      expansionHtml: requiredHtml(notice, "expansionHtml", prefix),
    };
  }
  let metadata: GalleryConfig["metadata"];
  const typeLabels: Record<string, string> = {};
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
    if (metadataRecord.schemas !== undefined) {
      for (const [sourceSchema, value] of Object.entries(metadataRecord.schemas as Record<string, unknown>)) {
        if (!value || typeof value !== "object" || Array.isArray(value)) continue;
        const typeLabel = (value as Record<string, unknown>).typeLabel;
        if (typeLabel === undefined) continue;
        if (typeof typeLabel !== "string" || !typeLabel.trim()) {
          throw new Error(`gallery.config.json metadata.schemas.${sourceSchema}.typeLabel must be a non-empty string.`);
        }
        typeLabels[sourceSchema] = typeLabel.trim();
      }
    }
    metadata = metadataRecord.schemas === undefined ? {} : { schemas: metadataRecord.schemas as Record<string, unknown> };
  }
  return {
    siteName,
    searchMetadata: record.searchMetadata as boolean,
    showTypeToggle: record.showTypeToggle === true,
    showLanguageToggle: record.showLanguageToggle as boolean,
    showNames: record.showNames as boolean,
    showGitHubLink: record.showGitHubLink === true,
    enableReporting: record.enableReporting as boolean,
    enableSupportEmbed: record.enableSupportEmbed === true,
    showWatermark: record.showWatermark as boolean,
    watermarkText,
    watermarkPosition: watermarkPosition as GalleryConfig["watermarkPosition"],
    contentNotice,
    typeLabels,
    ...(metadata ? { metadata } : {}),
  };
}

function optionalBoolean(value: string | undefined, name: string): boolean | undefined {
  if (value === undefined || value === "") return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false when configured.`);
}

function readSupportEmbed(enabled: boolean, configuredPath: string | undefined): string | undefined {
  if (!enabled) return undefined;
  const relativePath = configuredPath?.trim() || ".private/support-embed.html";
  const embedPath = path.resolve(process.cwd(), relativePath);
  let markup: string;
  try {
    markup = fs.readFileSync(embedPath, "utf8").trim();
  } catch (error) {
    throw new Error(`Could not read enabled support embed ${embedPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!markup) throw new Error(`Enabled support embed ${embedPath} must not be empty.`);
  return markup;
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

function galleryHtml(
  title: string,
  description: string,
  siteUrl: URL | undefined,
  config: GalleryConfig,
  supportEmbed: string | undefined,
): Plugin {
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
        .replace("__GALLERY_TYPE_TOGGLE__", String(config.showTypeToggle))
        .replace("__GALLERY_TYPE_LABELS__", escapeHtml(JSON.stringify(config.typeLabels)))
        .replace("__GALLERY_LANGUAGE_TOGGLE__", String(config.showLanguageToggle))
        .replace("__GALLERY_SHOW_NAMES__", String(config.showNames))
        .replace("__GALLERY_GITHUB_LINK__", String(config.showGitHubLink))
        .replace("__GALLERY_ENABLE_REPORTING__", String(config.enableReporting))
        .replace("__GALLERY_SHOW_WATERMARK__", String(config.showWatermark))
        .replace("__GALLERY_WATERMARK_TEXT__", escapeHtml(config.watermarkText))
        .replace("__GALLERY_WATERMARK_POSITION__", config.watermarkPosition)
        .replace("__GALLERY_CONTENT_NOTICE__", escapeHtml(JSON.stringify(config.contentNotice)))
        .replace(
          "<!-- gallery-support-button -->",
          supportEmbed
            ? `<div id="support-controls" class="support-controls" data-support-hidden="false" hidden>
      <div id="support-button" class="support-button-host">${supportEmbed}</div>
      <button id="support-visibility-toggle" class="support-visibility-toggle" type="button" aria-label="Hide support link" title="Hide support link">
        <svg class="support-control-icon support-hide-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.75"/></svg>
        <svg class="support-control-icon support-restore-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 9h11v5.5A4.5 4.5 0 0 1 11.5 19h-2A4.5 4.5 0 0 1 5 14.5V9Z"/><path d="M16 11h1.5a2.5 2.5 0 0 1 0 5H16M7 5.5c0 1 1 1 1 2M11 5.5c0 1 1 1 1 2"/></svg>
      </button>
    </div>`
            : "",
        )
        .replace(
          "<!-- gallery-support-card -->",
          supportEmbed
            ? '<aside id="support-card" class="support-card" aria-label="Support this site" data-i18n-aria-label="supportSite" hidden><p data-i18n="enjoyingGallery">Enjoying the gallery?</p></aside>'
            : "",
        )
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
  const supportEnabled = optionalBoolean(env.ENABLE_SUPPORT_EMBED, "ENABLE_SUPPORT_EMBED") ?? config.enableSupportEmbed;
  const supportEmbed = readSupportEmbed(supportEnabled, env.SUPPORT_EMBED_FILE);

  const legacyFrontend = mode === "legacy";
  return {
    root: legacyFrontend ? "src/web" : "src/web-next",
    publicDir: legacyFrontend ? "public" : "../web/public",
    base: "./",
    plugins: [
      ...(!legacyFrontend ? [svelte()] : []),
      galleryHtml(title, description, siteUrl, config, supportEmbed),
    ],
    build: {
      outDir: legacyFrontend ? "../../dist/public-legacy" : "../../dist/public",
      emptyOutDir: false,
    },
    server: {
      ...(mode === "next" ? { host: "0.0.0.0" } : {}),
      proxy: {
        "/api": "http://127.0.0.1:8080",
        "/media": "http://127.0.0.1:8080",
        "/previews": "http://127.0.0.1:8080",
        "/healthz": "http://127.0.0.1:8080",
      },
    },
  };
});
