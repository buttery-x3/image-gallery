import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

interface DimensionRecord {
  size: number;
  mtimeMs: number;
  width: number;
  height: number;
}

interface DimensionCacheFile {
  version: 1;
  images: Record<string, DimensionRecord>;
}

export class ImageDimensionCache {
  readonly #cachePath: string;
  #records: Record<string, DimensionRecord> | undefined;
  #dirty = false;

  constructor(cachePath: string) {
    this.#cachePath = cachePath;
  }

  async dimensions(
    absolutePath: string,
    relativePath: string,
    size: number,
    mtimeMs: number,
  ): Promise<{ width: number; height: number } | undefined> {
    await this.#load();
    const cached = this.#records![relativePath];
    if (cached?.size === size && cached.mtimeMs === mtimeMs) {
      return { width: cached.width, height: cached.height };
    }

    try {
      const metadata = await sharp(absolutePath, { animated: true }).metadata();
      if (!metadata.width || !metadata.height) return undefined;
      this.#records![relativePath] = {
        size,
        mtimeMs,
        width: metadata.width,
        height: metadata.pageHeight ?? metadata.height,
      };
      this.#dirty = true;
      return { width: metadata.width, height: metadata.pageHeight ?? metadata.height };
    } catch (error) {
      console.warn(`Could not read dimensions for ${relativePath}:`, error);
      return undefined;
    }
  }

  async flush(): Promise<void> {
    if (!this.#dirty || !this.#records) return;
    await mkdir(path.dirname(this.#cachePath), { recursive: true });
    const temporaryPath = `${this.#cachePath}.${process.pid}.tmp`;
    const payload: DimensionCacheFile = { version: 1, images: this.#records };
    await writeFile(temporaryPath, `${JSON.stringify(payload)}\n`, "utf8");
    try {
      await rename(temporaryPath, this.#cachePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" && (error as NodeJS.ErrnoException).code !== "EPERM") throw error;
      await unlink(this.#cachePath).catch(() => undefined);
      await rename(temporaryPath, this.#cachePath);
    }
    this.#dirty = false;
  }

  async #load(): Promise<void> {
    if (this.#records) return;
    try {
      const parsed = JSON.parse(await readFile(this.#cachePath, "utf8")) as Partial<DimensionCacheFile>;
      this.#records = parsed.version === 1 && parsed.images && typeof parsed.images === "object" ? parsed.images : {};
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn("Ignoring invalid gallery dimension cache:", error);
      }
      this.#records = {};
    }
  }
}
