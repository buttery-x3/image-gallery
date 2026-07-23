import { randomBytes } from "node:crypto";
import { unlink } from "node:fs/promises";
import type { Request, Response } from "express";
import argon2 from "argon2";
import { resolveSafeMediaPath } from "./gallery.js";

const cookieName = "gallery_admin";
const sessionLifetimeSeconds = 12 * 60 * 60;
const sessions = new Map<string, number>();

function cookieValue(request: Request, name: string): string | undefined {
  return request.get("cookie")?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}

export function isSameOrigin(request: Request): boolean {
  const host = request.get("host");
  return Boolean(host && request.get("origin") === `${request.protocol}://${host}`);
}

export function isAdmin(request: Request): boolean {
  const token = cookieValue(request, cookieName);
  if (!token) return false;
  const expiresAt = sessions.get(token);
  if (!expiresAt || expiresAt <= Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

export async function loginAdmin(request: Request, response: Response, passwordHash: string, password: string): Promise<boolean> {
  if (!await argon2.verify(passwordHash, password)) return false;
  const token = randomBytes(32).toString("base64url");
  sessions.set(token, Date.now() + sessionLifetimeSeconds * 1_000);
  response.append("Set-Cookie", [
    `${cookieName}=${token}`,
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${sessionLifetimeSeconds}`,
    request.secure ? "Secure" : "",
  ].filter(Boolean).join("; "));
  return true;
}

export function logoutAdmin(request: Request, response: Response): void {
  const token = cookieValue(request, cookieName);
  if (token) sessions.delete(token);
  response.append("Set-Cookie", `${cookieName}=; HttpOnly; SameSite=Strict; Max-Age=0${request.secure ? "; Secure" : ""}`);
}

export async function deleteGalleryImage(galleryDir: string, imagePath: string): Promise<boolean> {
  const resolved = await resolveSafeMediaPath(galleryDir, imagePath);
  if (!resolved) return false;
  await unlink(resolved);
  return true;
}
