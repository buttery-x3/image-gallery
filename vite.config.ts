import { defineConfig, loadEnv, type Plugin } from "vite";

const fallbackTitle = "Image Gallery";
const fallbackDescription = "A simple private image gallery.";

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

function galleryHtml(title: string, description: string, siteUrl: URL | undefined): Plugin {
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
        .replace("<!-- gallery-metadata -->", metadata.join("\n    "));
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const title = env.GALLERY_TITLE?.trim() || fallbackTitle;
  const description = env.GALLERY_DESCRIPTION?.trim() || fallbackDescription;
  const siteUrl = publicSiteUrl(env.SITE_URL);

  return {
    root: "src/web",
    base: "./",
    plugins: [galleryHtml(title, description, siteUrl)],
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
