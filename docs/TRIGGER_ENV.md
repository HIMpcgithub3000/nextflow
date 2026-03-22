# Set `GEMINI_API_KEY` on Trigger.dev (cloud runs)

Cloud task runs do **not** read your laptop’s `.env` unless you copy the value into the Trigger.dev project.

## Option A — Automatic sync on deploy (recommended)

This repo’s `trigger.config.ts` uses `syncEnvVars` so **`GEMINI_API_KEY`**, optional **`GEMINI_MODEL`**, and **Transloadit** credentials from your local `.env` are uploaded when you deploy (for FFmpeg crop/frame tasks that upload results).

1. Put your key in **`.env`** (same machine you deploy from):

   ```env
   GEMINI_API_KEY=your_key_from_google_ai_studio
   # Optional — default model for tasks (new API keys: use a current id, e.g. gemini-2.5-flash)
   GEMINI_MODEL=gemini-2.5-flash
   TRANSLOADIT_AUTH_KEY=your_key
   TRANSLOADIT_AUTH_SECRET=your_secret
   ```

2. Deploy the worker:

   ```bash
   npm run trigger:deploy
   ```

   Or: `npx trigger.dev@latest deploy`

3. Confirm in the Trigger.dev dashboard: **Project → Environment variables** — `GEMINI_API_KEY` should appear for the target environment.

## Option B — Dashboard (manual)

1. Open [Trigger.dev](https://trigger.dev) → your project.
2. Go to **Environment variables** (or **Project settings → Secrets / Env** depending on UI version).
3. Add **`GEMINI_API_KEY`** with your Google AI Studio key for **Production** / **Staging** as needed.
4. Redeploy or restart workers if required by the UI.

## Verify

Run a test execution of task `run-gemini-llm` with payload:

```json
{ "userMessage": "Reply with OK only." }
```

If the key is missing in cloud, the task will error with `Missing GEMINI_API_KEY`.

## FFmpeg (`crop-image-ffmpeg`, `extract-frame-ffmpeg`)

Local **`npx trigger.dev dev`** runs tasks on your machine. If you see **`Error: spawn ffmpeg ENOENT`**, the worker process couldn’t find **`ffmpeg`** (minimal `PATH`, or not installed).

1. **Install FFmpeg** (includes `ffprobe`):
   - macOS: `brew install ffmpeg`
   - Linux: `sudo apt install ffmpeg` (or your distro’s package)
2. **Or set explicit paths** in **`.env.local`** (restart the Trigger dev process):

   ```env
   FFMPEG_PATH=/opt/homebrew/bin/ffmpeg
   FFPROBE_PATH=/opt/homebrew/bin/ffprobe
   ```

   Apple Silicon Homebrew uses `/opt/homebrew/bin`; Intel macOS often `/usr/local/bin`.

The task code resolves **`which ffmpeg`**, then common Homebrew paths, then **`FFMPEG_PATH`**, then the **bundled** binaries from npm **`ffmpeg-static`** and **`@ffprobe-installer/ffprobe`** (so `npm install` is often enough for local `npm run trigger:dev` without Homebrew).

**Trigger.dev cloud** builds bundle FFmpeg via `trigger.config.ts` (`ffmpeg()` extension) — cloud runs don’t rely on your laptop’s `brew` binary.

## Next.js API → Trigger.dev

The **`POST /api/execute`** route uses **`tasks.trigger(...)`** + **`runs.poll(...)`** for **every** node type (no inline execution in Next.js). Task ids: **`passthrough-text-node`**, **`passthrough-media-url`**, **`run-gemini-llm`**, **`crop-image-ffmpeg`**, **`extract-frame-ffmpeg`**. `tasks.triggerAndWait()` only works **inside** another Trigger task’s `run()`; it cannot be called from Next.js.

**Worker env:** **`GEMINI_API_KEY`** must be set on Trigger for **`run-gemini-llm`** (`syncEnvVars` on deploy or dashboard). **`TRIGGER_SECRET_KEY`** is required in **Next.js** so the API can enqueue runs. Legacy model ids like `gemini-1.5-flash` are normalized to current ids in code.

**Vision:** Image URLs from the workflow are **fetched on the server/worker** and sent to Gemini as **`inlineData` (base64)**, not as plain text in the prompt. Use **public `https` image URLs** (e.g. Transloadit results) so the runtime can download them. Optional **`GEMINI_VISION_MAX_IMAGE_BYTES`** caps per-image size (default 20MB) and is synced like `GEMINI_MODEL`.

## Vercel deploy (outline)

1. Connect the repo, set env vars: Clerk, `DATABASE_URL`, `GEMINI_*`, `TRIGGER_*`, `TRANSLOADIT_*`, `TRIGGER_SECRET_KEY`.
2. Build: `npm run build`; Release: `npx prisma migrate deploy` against Neon (e.g. Vercel post-deploy or CI).
3. Deploy Trigger workers: `npm run trigger:deploy` so cloud tasks match your `src/trigger/tasks.ts`.
