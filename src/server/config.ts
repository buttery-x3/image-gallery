import { readFileSync } from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(process.cwd());
function readReportingEnabled(): boolean {
  const configPath = path.join(projectRoot, "gallery.config.json");
  try {
    const parsed: unknown = JSON.parse(readFileSync(configPath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    return (parsed as Record<string, unknown>).enableReporting === true;
  } catch {
    return false;
  }
}
const reportingEnabled = readReportingEnabled();
const galleryDir = path.resolve(projectRoot, process.env.GALLERY_DIR ?? "gallery");
const previewCacheDir = path.resolve(projectRoot, process.env.PREVIEW_CACHE_DIR ?? ".cache/previews");

const cacheRelativeToGallery = path.relative(galleryDir, previewCacheDir);
if (
  cacheRelativeToGallery === "" ||
  (!cacheRelativeToGallery.startsWith("..") && !path.isAbsolute(cacheRelativeToGallery))
) {
  throw new Error("PREVIEW_CACHE_DIR must be outside GALLERY_DIR.");
}

function parsePort(value: string | undefined): number {
  const port = Number.parseInt(value ?? "8080", 10);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid PORT value: ${value ?? ""}`);
  }

  return port;
}

function parseOptionalPort(value: string | undefined, fallback: number): number {
  if (!value?.trim()) return fallback;
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid REPORT_SMTP_PORT value: ${value}`);
  }
  return port;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  const normalized = value?.trim();
  if (!normalized) return fallback;
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error(`Invalid boolean value: ${value}`);
}

const reportSmtpHost = process.env.REPORT_SMTP_HOST?.trim();
const reportSmtpUser = process.env.REPORT_SMTP_USER?.trim();
const reportSmtpPassword = process.env.REPORT_SMTP_PASSWORD;
if (Boolean(reportSmtpUser) !== Boolean(reportSmtpPassword)) {
  throw new Error("REPORT_SMTP_USER and REPORT_SMTP_PASSWORD must be set together.");
}

export const config = {
  galleryDir,
  previewCacheDir,
  publicDir: path.resolve(projectRoot, "dist/public"),
  host: process.env.HOST ?? "127.0.0.1",
  port: parsePort(process.env.PORT),
  reportingEnabled,
  reportEmailTo: "admin@flamehorn.com",
  reportEmailFrom: process.env.REPORT_EMAIL_FROM?.trim() || "Image Gallery <admin@flamehorn.com>",
  reportSmtp: reportSmtpHost ? {
    host: reportSmtpHost,
    port: parseOptionalPort(process.env.REPORT_SMTP_PORT, 587),
    secure: parseBoolean(process.env.REPORT_SMTP_SECURE, false),
    ...(reportSmtpUser && reportSmtpPassword ? {
      auth: { user: reportSmtpUser, pass: reportSmtpPassword },
    } : {}),
  } : undefined,
};
