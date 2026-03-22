import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

/**
 * Next.js merges `.env` then `.env.local`; a line like `DATABASE_URL=` (empty) in `.env.local`
 * overrides a real URL from `.env` with `""`, which breaks Prisma. Reload from disk when empty.
 */
function parseDatabaseUrlFromEnvFile(filePath: string): string | undefined {
  if (!existsSync(filePath)) return undefined;
  const content = readFileSync(filePath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (!trimmed.startsWith("DATABASE_URL=")) continue;
    let v = trimmed.slice("DATABASE_URL=".length).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    return v.length > 0 ? v : undefined;
  }
  return undefined;
}

function ensureDatabaseUrl() {
  if (process.env.DATABASE_URL?.trim()) return;
  const cwd = process.cwd();
  for (const name of [".env", ".env.local"] as const) {
    const url = parseDatabaseUrlFromEnvFile(resolve(cwd, name));
    if (url) {
      process.env.DATABASE_URL = url;
      return;
    }
  }
}

ensureDatabaseUrl();

declare global {
  var prisma: PrismaClient | undefined;
}

export const prisma = global.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") global.prisma = prisma;
