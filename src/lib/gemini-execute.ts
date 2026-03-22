import { GoogleGenerativeAI } from "@google/generative-ai";
import type { Part } from "@google/generative-ai";

const DEFAULT_MODEL = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";

/** Max bytes per inline image (Gemini accepts large inputs; cap avoids OOM / abuse). */
const DEFAULT_MAX_IMAGE_BYTES = 20 * 1024 * 1024;

function maxImageBytes(): number {
  const raw = process.env.GEMINI_VISION_MAX_IMAGE_BYTES?.trim();
  if (!raw) return DEFAULT_MAX_IMAGE_BYTES;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_IMAGE_BYTES;
}

/** Map legacy / renamed model ids to current API ids (avoids 404s on newer keys). */
export function normalizeGeminiModelId(raw: string | undefined): string {
  const m = (raw ?? "").trim() || DEFAULT_MODEL;
  const map: Record<string, string> = {
    "gemini-1.5-flash": "gemini-2.5-flash",
    "gemini-1.5-flash-8b": "gemini-2.5-flash",
    "gemini-1.5-pro": "gemini-2.5-pro",
    "gemini-pro": "gemini-2.5-flash",
    "gemini-pro-vision": "gemini-2.5-flash"
  };
  return map[m] ?? m;
}

export type GeminiRunParams = {
  model: string;
  systemPrompt?: string;
  userMessage: string;
  imageUrls: string[];
};

function mimeFromPath(pathname: string): string | undefined {
  const ext = pathname.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    heic: "image/heic",
    bmp: "image/bmp",
    svg: "image/svg+xml"
  };
  return ext ? map[ext] : undefined;
}

function parseDataUrlImage(dataUrl: string): { mimeType: string; data: string } {
  const m = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl.trim());
  if (!m) {
    throw new Error("Invalid data URL — expected data:<mime>;base64,...");
  }
  const mimeType = m[1].trim();
  const data = m[2].replace(/\s/g, "");
  const approxBytes = (data.length * 3) / 4;
  if (approxBytes > maxImageBytes()) {
    throw new Error(`Image too large for inline vision (data URL ~${Math.round(approxBytes)} bytes).`);
  }
  return { mimeType, data };
}

/**
 * Load image bytes from an http(s) URL or data URL and return a Gemini inlineData part.
 */
export async function imageUrlToInlinePart(url: string): Promise<Part> {
  const trimmed = url.trim();
  if (!trimmed) {
    throw new Error("Empty image URL.");
  }

  if (trimmed.startsWith("data:")) {
    const { mimeType, data } = parseDataUrlImage(trimmed);
    if (!mimeType.startsWith("image/")) {
      throw new Error(`Data URL must be an image (got ${mimeType}).`);
    }
    return { inlineData: { mimeType, data } };
  }

  if (trimmed.startsWith("file:")) {
    throw new Error("Local file: URLs are not supported — use an https image URL or upload.");
  }

  const res = await fetch(trimmed, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`Failed to fetch image (${res.status}) for vision.`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxImageBytes()) {
    throw new Error(
      `Image too large for inline vision (${buf.length} bytes; max ${maxImageBytes()}). Set GEMINI_VISION_MAX_IMAGE_BYTES to raise the cap.`
    );
  }

  let mimeType = res.headers.get("content-type")?.split(";")[0]?.trim();
  if (!mimeType || mimeType === "application/octet-stream") {
    try {
      mimeType = mimeFromPath(new URL(trimmed).pathname);
    } catch {
      mimeType = mimeFromPath(trimmed);
    }
    mimeType = mimeType ?? "image/jpeg";
  }

  if (!mimeType.startsWith("image/")) {
    throw new Error(
      `URL is not an image for vision (Content-Type: ${mimeType}). Connect an image node or use image/* URLs.`
    );
  }

  return {
    inlineData: {
      mimeType,
      data: buf.toString("base64")
    }
  };
}

/**
 * Shared Gemini call used by Trigger task and optional API fallback.
 * Passes **inline image bytes** (multimodal), not URL strings in the prompt.
 * `apiKey` defaults to `process.env.GEMINI_API_KEY`.
 */
export async function runGeminiGenerate(params: GeminiRunParams, apiKey?: string): Promise<string> {
  const key = apiKey?.trim() || process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error("Missing GEMINI_API_KEY");

  const modelId = normalizeGeminiModelId(params.model);
  const genAI = new GoogleGenerativeAI(key);
  const model = genAI.getGenerativeModel({
    model: modelId,
    systemInstruction: params.systemPrompt || undefined
  });

  const urls = params.imageUrls.map((u) => u?.trim()).filter((u): u is string => !!u);
  const imageParts = await Promise.all(urls.map((url) => imageUrlToInlinePart(url)));
  const parts: Part[] = [{ text: params.userMessage }, ...imageParts];

  const result = await model.generateContent(parts);
  return result.response.text();
}
