# NextFlow

LLM workflow builder (React Flow + Clerk + Neon/Prisma + Trigger.dev + Transloadit).

## Quick start

```bash
cp .env.example .env.local
# Fill DATABASE_URL, Clerk keys, GEMINI_API_KEY, TRIGGER_PROJECT_ID or TRIGGER_PROJECT_REF,
# TRIGGER_SECRET_KEY, TRANSLOADIT_AUTH_KEY, TRANSLOADIT_AUTH_SECRET

npm install
npx prisma migrate dev
npm run dev
```

- App: [http://localhost:3000/workflow](http://localhost:3000/workflow) (home redirects).
- Trigger.dev local worker: `npm run trigger:dev` (requires Trigger + Gemini env; see `docs/TRIGGER_ENV.md`). For **crop/frame** tasks, the worker resolves **ffmpeg/ffprobe** from PATH, **`FFMPEG_PATH`/`FFPROBE_PATH`**, or bundled **`ffmpeg-static`** / **`@ffprobe-installer/ffprobe`** after `npm install`.

## Architecture notes

- **Execute** — `POST /api/execute` runs the DAG; **every node type** is implemented as a **Trigger.dev task** (`passthrough-text-node`, `passthrough-media-url`, `run-gemini-llm`, `crop-image-ffmpeg`, `extract-frame-ffmpeg`) via **`tasks.trigger`** + **`runs.poll`** (not `triggerAndWait`, which only works inside `task.run()`). There is **no** inline Gemini or node logic in Next.js — set **`TRIGGER_SECRET_KEY`** on Vercel; **`GEMINI_API_KEY`** must be available to the **Trigger** worker (e.g. `syncEnvVars` on `trigger:deploy`).
- **LLM vision** — Images wired into the LLM node are **downloaded and sent as Gemini `inlineData`** (`src/lib/gemini-execute.ts`), not as URL text. URLs must be **fetchable** (e.g. public `https` Transloadit links).
- **Media** — Crop/frame tasks use **FFmpeg** in the worker (see `trigger.config.ts` `ffmpeg()` extension) and upload outputs with **Transloadit**. The Next.js route `POST /api/transloadit/upload` handles browser file uploads for image/video nodes; the body is validated with **Zod** (`transloaditUploadFormSchema` in `src/app/api/transloadit/upload/route.ts` — `file` must be a non-empty `File`, optional MIME `image/*` or `video/*`, max size default **512 MB**, override with **`TRANSLOADIT_UPLOAD_MAX_MB`**). If you see **`GET_ACCOUNT_UNKNOWN_AUTH_KEY`**, fix **Auth Key / Secret** in `.env.local` — see **`docs/TRANSLOADIT.md`**.
- **Edges** — Workflow connections use **animated purple** strokes (`WORKFLOW_EDGE_COLOR` in `src/types/workflow.ts`).

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Next.js |
| `npm run build` | Production build |
| `npm run trigger:dev` | Local Trigger worker |
| `npm run trigger:deploy` | Deploy tasks + sync env to Trigger |
| `npx prisma migrate dev` | DB migrations (dev) |
| `npx prisma migrate deploy` | DB migrations (prod) |
