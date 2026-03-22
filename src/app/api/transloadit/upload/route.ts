import { randomUUID } from "node:crypto";
import { mkdtemp, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { ApiError, Transloadit } from "transloadit";
import { z } from "zod";

export const runtime = "nodejs";

/** Default cap for browser → API uploads (images + short videos). Override via env if needed. */
const MAX_UPLOAD_BYTES = (() => {
  const raw = process.env.TRANSLOADIT_UPLOAD_MAX_MB?.trim();
  const mb = raw ? Number(raw) : 512;
  return Number.isFinite(mb) && mb > 0 ? Math.floor(mb * 1024 * 1024) : 512 * 1024 * 1024;
})();

function isWebFile(value: unknown): value is File {
  return typeof File !== "undefined" && value instanceof File;
}

/**
 * Validates `multipart/form-data` with field `file` (single File, non-empty, size cap, image/video MIME when set).
 */
export const transloaditUploadFormSchema = z.object({
  file: z
    .custom<File>(isWebFile, {
      message: 'Expected multipart field "file" to be a File.'
    })
    .refine((f) => f.size > 0, "File must not be empty.")
    .refine(
      (f) => f.size <= MAX_UPLOAD_BYTES,
      `File exceeds maximum size (${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB).`
    )
    .refine(
      (f) => !f.type || /^(image|video)\//i.test(f.type),
      "File must be an image or video (MIME type must start with image/ or video/ when provided)."
    )
});

export type TransloaditUploadForm = z.infer<typeof transloaditUploadFormSchema>;

export function parseTransloaditUploadFormData(formData: FormData) {
  return transloaditUploadFormSchema.safeParse({ file: formData.get("file") });
}

/** Fields Transloadit may use for a public/signed file URL (see assemblyStatusResultSchema). */
const RESULT_URL_KEYS = [
  "ssl_url",
  "signed_ssl_url",
  "url",
  "signed_url",
  "streaming_url",
  "hls_url"
] as const;

function pickUrlFromResultItem(f: Record<string, unknown>): string | null {
  for (const k of RESULT_URL_KEYS) {
    const v = f[k];
    if (typeof v === "string" && v.length > 0 && /^https?:\/\//i.test(v)) return v;
  }
  return null;
}

/**
 * Walk Transloadit assembly `results` and `uploads` for a file URL.
 * Prefer `exported` (second pipeline step), then `:original`, then other steps; also scans `uploads`.
 */
function extractUrlFromAssemblyResult(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const o = result as Record<string, unknown>;

  const results = o.results;
  if (results && typeof results === "object") {
    const r = results as Record<string, unknown>;
    const prefer = ["exported", ":original"];
    const keys = [...new Set([...prefer, ...Object.keys(r)])];
    for (const step of keys) {
      const arr = r[step];
      if (!Array.isArray(arr)) continue;
      for (const item of arr) {
        if (!item || typeof item !== "object") continue;
        const url = pickUrlFromResultItem(item as Record<string, unknown>);
        if (url) return url;
      }
    }
  }

  const uploads = o.uploads;
  if (Array.isArray(uploads)) {
    for (const item of uploads) {
      if (!item || typeof item !== "object") continue;
      const url = pickUrlFromResultItem(item as Record<string, unknown>);
      if (url) return url;
    }
  }

  return null;
}

function isVideoFile(file: File, safeName: string): boolean {
  const mime = file.type || "";
  if (mime.startsWith("video/")) return true;
  return /\.(mp4|webm|mov|mkv|m4v|avi)$/i.test(safeName);
}

/**
 * Server-side upload to Transloadit (used by image/video nodes).
 * Images: upload + `/image/resize` so a stable `ssl_url` is produced (same pattern as Trigger tasks).
 * Video: `:original` + `/video/encode` (remux, codec copy) so a deliverable URL lands in `exported`, same idea as image/resize.
 */
export async function POST(request: Request) {
  let tempPath: string | null = null;
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const key = process.env.TRANSLOADIT_AUTH_KEY?.trim();
    const secret = process.env.TRANSLOADIT_AUTH_SECRET?.trim();
    if (!key || !secret) {
      return NextResponse.json(
        { error: "Transloadit is not configured (TRANSLOADIT_AUTH_KEY / TRANSLOADIT_AUTH_SECRET)." },
        { status: 503 }
      );
    }

    const formData = await request.formData();
    const parsedForm = parseTransloaditUploadFormData(formData);
    if (!parsedForm.success) {
      return NextResponse.json({ error: parsedForm.error.flatten() }, { status: 400 });
    }
    const { file } = parsedForm.data;

    const buf = Buffer.from(await file.arrayBuffer());
    const dir = await mkdtemp(join(tmpdir(), "nf-up-"));
    const safeName = file.name?.replace(/[^\w.\-]+/g, "_") || "upload";
    tempPath = join(dir, `${randomUUID()}-${safeName}`);
    await writeFile(tempPath, buf);

    const video = isVideoFile(file, safeName);

    const steps = video
      ? {
          ":original": { robot: "/upload/handle" as const },
          /** Remux with stream copy so we get stable `ssl_url` on `exported` (upload/handle alone often omits it for video). */
          exported: {
            robot: "/video/encode" as const,
            use: ":original",
            preset: "empty" as const,
            ffmpeg_stack: "v6" as const,
            ffmpeg: {
              "codec:v": "copy",
              "codec:a": "copy"
            }
          }
        }
      : {
          ":original": { robot: "/upload/handle" as const },
          exported: {
            robot: "/image/resize" as const,
            use: ":original",
            width: 4096,
            height: 4096,
            resize_strategy: "fit" as const
          }
        };

    const transloadit = new Transloadit({ authKey: key, authSecret: secret });
    // Transloadit's generated step types are very strict; runtime shape matches their REST API.
    const result = await transloadit.createAssembly({
      params: { steps } as import("transloadit").CreateAssemblyOptions["params"],
      files: { file: tempPath },
      waitForCompletion: true,
      timeout: 30 * 60 * 1000
    });

    const url = extractUrlFromAssemblyResult(result);
    if (!url) {
      return NextResponse.json(
        {
          error:
            "Transloadit finished but no file URL was found in results. Check account billing / template limits or try another file.",
          ...(process.env.NODE_ENV === "development" && {
            hint: "Video uses :original + video/encode (exported); images use :original + image/resize. Also check uploads[] / signed_ssl_url in the raw assembly."
          })
        },
        { status: 502 }
      );
    }

    return NextResponse.json({ url });
  } catch (err) {
    console.error("[api/transloadit/upload]", err);

    if (err instanceof ApiError) {
      const unknownKey =
        err.code === "GET_ACCOUNT_UNKNOWN_AUTH_KEY" ||
        err.message.includes("UNKNOWN_AUTH_KEY") ||
        err.message.includes("unknown auth key");
      return NextResponse.json(
        {
          error: err.message,
          code: err.code,
          reason: err.reason,
          ...(unknownKey && {
            hint: "Use your Transloadit Account Auth Key + Auth Secret (dashboard → Credentials). Update .env.local and restart npm run dev. See docs/TRANSLOADIT.md."
          })
        },
        { status: 502 }
      );
    }

    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 500 }
    );
  } finally {
    if (tempPath) {
      await unlink(tempPath).catch(() => {});
    }
  }
}
