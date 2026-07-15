import path from "node:path";

const projectRoot = path.resolve(process.cwd());

function parsePort(value: string | undefined): number {
  const port = Number.parseInt(value ?? "8080", 10);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid PORT value: ${value ?? ""}`);
  }

  return port;
}

export const config = {
  galleryDir: path.resolve(projectRoot, process.env.GALLERY_DIR ?? "gallery"),
  publicDir: path.resolve(projectRoot, "dist/public"),
  host: process.env.HOST ?? "127.0.0.1",
  port: parsePort(process.env.PORT),
};
