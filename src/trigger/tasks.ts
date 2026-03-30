import { execFile, execFileSync } from "node:child_process";
import { accessSync, constants as fsConstants, existsSync } from "node:fs";
import { mkdtemp, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import ffmpegStatic from "ffmpeg-static";
import { task } from "@trigger.dev/sdk";
import { Transloadit } from "transloadit";
import { z } from "zod";
import { runGeminiGenerate } from "@/lib/gemini-execute";

const execFileAsync = promisify(execFile);

/** Default for new Google AI Studio keys — override with payload.model or GEMINI_MODEL. */
const DEFAULT_GEMINI_MODEL = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";

const passthroughTextPayload = z.object({
  text: z.string().optional().default("")
});

/**
 * Text node — returns stored text via Trigger so `/api/execute` never runs node logic inline.
 */
export const passthroughTextTask = task({
  id: "passthrough-text-node",
  run: async (payload: unknown) => {
    const p = passthroughTextPayload.parse(payload ?? {});
    return { text: p.text };
  }
});

const passthroughMediaPayload = z.object({
  url: z.string(),
  kind: z.enum(["image", "video"])
});

/**
 * Upload image/video nodes — validates URL in the worker (same contract as previous inline check).
 */
export const passthroughMediaUrlTask = task({
  id: "passthrough-media-url",
  run: async (payload: unknown) => {
    const p = passthroughMediaPayload.parse(payload ?? {});
    const u = p.url.trim();
    if (!u) {
      throw new Error("No uploaded media URL found. Upload media first.");
    }
    if (!/^https?:\/\//i.test(u)) {
      throw new Error("Media URL must be an http(s) URL.");
    }
    return { url: u };
  }
});

/** Accepts camelCase or snake_case; dashboard "test" runs often send empty `{}` */
const llmPayload = z
  .object({
    model: z.string().optional(),
    systemPrompt: z.string().optional(),
    system_prompt: z.string().optional(),
    userMessage: z.string().optional(),
    user_message: z.string().optional(),
    imageUrls: z.array(z.string()).optional(),
    image_urls: z.array(z.string()).optional()
  })
  .passthrough()
  .transform((raw) => {
    const urls = raw.imageUrls ?? raw.image_urls ?? [];
    const userMessage = (raw.userMessage ?? raw.user_message ?? "").trim();
    const systemPrompt = raw.systemPrompt ?? raw.system_prompt;
    return {
      model: raw.model?.trim() || DEFAULT_GEMINI_MODEL,
      systemPrompt: systemPrompt?.trim() || undefined,
      userMessage,
      imageUrls: urls.filter((u) => typeof u === "string" && u.length > 0)
    };
  });

/** Gemini LLM — invoked only from `/api/execute` via `tasks.trigger` + `runs.poll` (never inline Gemini in Next.js). */
export const runGeminiTask = task({
  id: "run-gemini-llm",
  run: async (payload: unknown) => {
    const parsed = llmPayload.parse(payload ?? {});
    if (!parsed.userMessage) {
      throw new Error(
        'Missing user message. Send { "userMessage": "..." } or { "user_message": "..." } (dashboard test payload is often empty).'
      );
    }
    const text = await runGeminiGenerate({
      model: parsed.model,
      systemPrompt: parsed.systemPrompt,
      userMessage: parsed.userMessage,
      imageUrls: parsed.imageUrls
    });
    return { text };
  }
});

/** Trigger `dev` often runs with a minimal PATH — Homebrew’s ffmpeg may be missing. */
function whichOnPath(cmd: string): string | null {
  try {
    if (process.platform === "win32") {
      const out = execFileSync("where", [cmd], { encoding: "utf8" }).trim().split(/\r?\n/)[0];
      return out || null;
    }
    return execFileSync("which", [cmd], { encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
}

let cachedFfmpeg: string | null = null;

/** Resolve ffmpeg binary from `ffmpeg-static` even when the default export path is wrong (bundlers / CWD). */
function resolveBundledFfmpegPath(): string | null {
  const ext = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const candidates: string[] = [];
  if (typeof ffmpegStatic === "string" && ffmpegStatic.length > 0) {
    candidates.push(ffmpegStatic);
  }
  candidates.push(join(process.cwd(), "node_modules", "ffmpeg-static", ext));
  try {
    const req = createRequire(import.meta.url);
    const resolved = req("ffmpeg-static") as string | null;
    if (resolved) candidates.push(resolved);
    const pkgDir = dirname(req.resolve("ffmpeg-static/package.json"));
    candidates.push(join(pkgDir, ext));
  } catch {
    /* ignore — bundled or path resolution may fail in some runners */
  }
  for (const p of candidates) {
    if (!p) continue;
    try {
      if (existsSync(p)) {
        accessSync(p, fsConstants.X_OK);
        return p;
      }
    } catch {
      /* exists but not marked executable — still try (some environments strip +x) */
      if (existsSync(p)) return p;
    }
  }
  return null;
}

function resolveFfmpeg(): string {
  if (cachedFfmpeg) return cachedFfmpeg;

  const fromEnv = process.env.FFMPEG_PATH?.trim();
  if (fromEnv) {
    try {
      accessSync(fromEnv, fsConstants.X_OK);
      cachedFfmpeg = fromEnv;
      return fromEnv;
    } catch {
      throw new Error(
        `FFMPEG_PATH is set but not executable: ${fromEnv}. Fix the path or install ffmpeg (e.g. brew install ffmpeg).`
      );
    }
  }

  const which = whichOnPath("ffmpeg");
  if (which) {
    cachedFfmpeg = which;
    return which;
  }

  const fallbacks =
    process.platform === "darwin"
      ? ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"]
      : process.platform === "linux"
        ? ["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg"]
        : [];
  for (const p of fallbacks) {
    try {
      accessSync(p, fsConstants.X_OK);
      cachedFfmpeg = p;
      return p;
    } catch {
      /* try next */
    }
  }

  /** Last resort: `ffmpeg-static` (path may break after esbuild — try cwd + require.resolve). */
  const bundled = resolveBundledFfmpegPath();
  if (bundled) {
    cachedFfmpeg = bundled;
    return bundled;
  }

  throw new Error(
    "ffmpeg not found (spawn ENOENT). Install: `brew install ffmpeg`, or set FFMPEG_PATH in .env.local " +
      "to the full path (e.g. /opt/homebrew/bin/ffmpeg). The repo also bundles ffmpeg via the `ffmpeg-static` " +
      "package — run `npm install` and restart `npm run trigger:dev`. See docs/TRIGGER_ENV.md — FFmpeg."
  );
}

function ffmpegBin() {
  return resolveFfmpeg();
}

async function downloadToFile(url: string, dest: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download media (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
}

function firstSslUrlFromAssembly(result: {
  results?: Record<string, Array<{ ssl_url?: string | null; url?: string | null }>>;
}) {
  const r = result.results;
  if (!r) throw new Error("Transloadit assembly returned no results");
  for (const arr of Object.values(r)) {
    const f = arr[0];
    const ssl = f?.ssl_url;
    if (typeof ssl === "string" && ssl.length > 0) return ssl;
    const u = f?.url;
    if (typeof u === "string" && u.startsWith("http")) return u;
  }
  throw new Error("No output URL in Transloadit results");
}

async function uploadFileToTransloadit(localPath: string): Promise<string> {
  const key = process.env.TRANSLOADIT_AUTH_KEY?.trim();
  const secret = process.env.TRANSLOADIT_AUTH_SECRET?.trim();
  if (!key || !secret) {
    throw new Error("Missing TRANSLOADIT_AUTH_KEY or TRANSLOADIT_AUTH_SECRET in Trigger env (sync via trigger:deploy).");
  }
  const transloadit = new Transloadit({ authKey: key, authSecret: secret });
  const result = await transloadit.createAssembly({
    params: {
      steps: {
        ":original": { robot: "/upload/handle" },
        /** Re-encode slightly so we always get a deliverable asset URL */
        exported: {
          robot: "/image/resize",
          use: ":original",
          width: 4096,
          height: 4096,
          resize_strategy: "fit"
        }
      }
    },
    files: { file: localPath },
    waitForCompletion: true,
    timeout: 15 * 60 * 1000
  });
  return firstSslUrlFromAssembly(result);
}

const cropPayload = z
  .object({
    imageUrl: z.string().url().optional(),
    image_url: z.string().url().optional(),
    xPercent: z.number().min(0).max(100).optional(),
    yPercent: z.number().min(0).max(100).optional(),
    widthPercent: z.number().min(0).max(100).optional(),
    heightPercent: z.number().min(0).max(100).optional(),
    x_percent: z.coerce.number().min(0).max(100).optional(),
    y_percent: z.coerce.number().min(0).max(100).optional(),
    width_percent: z.coerce.number().min(0).max(100).optional(),
    height_percent: z.coerce.number().min(0).max(100).optional()
  })
  .superRefine((val, ctx) => {
    if (!val.imageUrl && !val.image_url) {
      ctx.addIssue({ code: "custom", message: "Provide imageUrl or image_url" });
    }
  })
  .transform((p) => ({
    imageUrl: (p.imageUrl ?? p.image_url) as string,
    xPercent: p.xPercent ?? p.x_percent ?? 0,
    yPercent: p.yPercent ?? p.y_percent ?? 0,
    widthPercent: Math.max(0.1, p.widthPercent ?? p.width_percent ?? 100),
    heightPercent: Math.max(0.1, p.heightPercent ?? p.height_percent ?? 100)
  }));

/** FFmpeg crop + Transloadit upload */
export const cropImageTask = task({
  id: "crop-image-ffmpeg",
  run: async (payload: unknown) => {
    const p = cropPayload.parse(payload);
    const dir = await mkdtemp(join(tmpdir(), "nf-crop-"));
    const inputPath = join(dir, "in");
    const outputPath = join(dir, "out.jpg");
    await downloadToFile(p.imageUrl, inputPath);

    const xp = p.xPercent;
    const yp = p.yPercent;
    const wp = p.widthPercent;
    const hp = p.heightPercent;

    const vf = `crop='iw*${wp}/100':'ih*${hp}/100':'iw*${xp}/100':'ih*${yp}/100'`;
    await execFileAsync(ffmpegBin(), ["-y", "-i", inputPath, "-vf", vf, "-q:v", "2", outputPath]);

    const outputUrl = await uploadFileToTransloadit(outputPath);
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
    return { outputUrl };
  }
});

const framePayload = z
  .object({
    videoUrl: z.string().url().optional(),
    video_url: z.string().url().optional(),
    timestamp: z.string().optional()
  })
  .superRefine((val, ctx) => {
    if (!val.videoUrl && !val.video_url) {
      ctx.addIssue({ code: "custom", message: "Provide videoUrl or video_url" });
    }
  })
  .transform((p) => ({
    videoUrl: (p.videoUrl ?? p.video_url) as string,
    timestamp: p.timestamp?.trim() || "0"
  }));

/** Duration via ffmpeg stderr — avoids ffprobe / `@ffprobe-installer/*` (breaks Trigger Linux bundle). */
async function probeDurationSeconds(videoPath: string): Promise<number> {
  const ffmpeg = ffmpegBin();
  let stderr = "";
  try {
    const result = await execFileAsync(ffmpeg, ["-hide_banner", "-i", videoPath, "-f", "null", "-"], {
      maxBuffer: 12 * 1024 * 1024
    });
    stderr = typeof result.stderr === "string" ? result.stderr : String(result.stderr ?? "");
  } catch (err: unknown) {
    const e = err as { stderr?: string | Buffer };
    stderr =
      typeof e.stderr === "string" ? e.stderr : e.stderr ? Buffer.from(e.stderr).toString("utf8") : "";
  }
  const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
  if (!m) throw new Error(`Could not read video duration from ffmpeg. stderr: ${stderr.slice(0, 500)}`);
  const hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  const sec = parseFloat(m[3]);
  const total = hh * 3600 + mm * 60 + sec;
  if (!Number.isFinite(total) || total <= 0) throw new Error("Invalid video duration");
  return total;
}

/** FFmpeg extract frame + Transloadit upload */
export const extractFrameTask = task({
  id: "extract-frame-ffmpeg",
  run: async (payload: unknown) => {
    const p = framePayload.parse(payload);
    const dir = await mkdtemp(join(tmpdir(), "nf-frame-"));
    const videoPath = join(dir, "in");
    const framePath = join(dir, "frame.jpg");
    await downloadToFile(p.videoUrl, videoPath);

    let seekSec = 0;
    const ts = p.timestamp;
    if (ts.endsWith("%")) {
      const pct = parseFloat(ts.slice(0, -1));
      if (!Number.isFinite(pct)) throw new Error("Invalid percentage timestamp");
      const dur = await probeDurationSeconds(videoPath);
      seekSec = (dur * pct) / 100;
    } else {
      seekSec = parseFloat(ts);
      if (!Number.isFinite(seekSec) || seekSec < 0) throw new Error("Invalid timestamp (use seconds or e.g. 50%)");
    }

    await execFileAsync(ffmpegBin(), [
      "-y",
      "-ss",
      String(seekSec),
      "-i",
      videoPath,
      "-frames:v",
      "1",
      "-q:v",
      "2",
      framePath
    ]);

    const outputUrl = await uploadFileToTransloadit(framePath);
    await unlink(videoPath).catch(() => {});
    await unlink(framePath).catch(() => {});
    return { outputUrl };
  }
});
