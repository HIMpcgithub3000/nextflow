import { resolve } from "node:path";
import { config } from "dotenv";
import { ffmpeg, syncEnvVars } from "@trigger.dev/build/extensions/core";
import { defineConfig } from "@trigger.dev/sdk";

// Trigger CLI does not load this file’s process.env the same way as Next.js — load .env ourselves.
config({ path: resolve(process.cwd(), ".env") });
config({ path: resolve(process.cwd(), ".env.local"), override: true });

// Trigger `init` / CLI often writes TRIGGER_PROJECT_REF; docs also use TRIGGER_PROJECT_ID — accept both.
const projectId =
  process.env.TRIGGER_PROJECT_ID?.trim() ||
  process.env.TRIGGER_PROJECT_REF?.trim();
if (!projectId) {
  throw new Error(
    "Missing project ref. Set TRIGGER_PROJECT_ID or TRIGGER_PROJECT_REF in .env (or .env.local) to your proj_xxx ref from the Trigger.dev dashboard. Example: TRIGGER_PROJECT_REF=proj_abc123"
  );
}

export default defineConfig({
  project: projectId,
  runtime: "node",
  maxDuration: 300,
  build: {
    extensions: [
      ffmpeg({ version: "7" }),
      // On `trigger.dev deploy`, push secrets from local .env to Trigger.dev workers.
      syncEnvVars(async () => {
        const out: Record<string, string> = {};
        const key = process.env.GEMINI_API_KEY?.trim();
        const model = process.env.GEMINI_MODEL?.trim();
        const tlKey = process.env.TRANSLOADIT_AUTH_KEY?.trim();
        const tlSecret = process.env.TRANSLOADIT_AUTH_SECRET?.trim();
        const visionMax = process.env.GEMINI_VISION_MAX_IMAGE_BYTES?.trim();
        if (key) out.GEMINI_API_KEY = key;
        if (model) out.GEMINI_MODEL = model;
        if (visionMax) out.GEMINI_VISION_MAX_IMAGE_BYTES = visionMax;
        if (tlKey) out.TRANSLOADIT_AUTH_KEY = tlKey;
        if (tlSecret) out.TRANSLOADIT_AUTH_SECRET = tlSecret;
        return Object.keys(out).length ? out : undefined;
      })
    ]
  }
});
