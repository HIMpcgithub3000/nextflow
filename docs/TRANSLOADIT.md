# Transloadit credentials (`GET_ACCOUNT_UNKNOWN_AUTH_KEY`)

If uploads fail with **`Could not get workspace, this is an unknown auth key`**, Transloadit does not recognize the value in **`TRANSLOADIT_AUTH_KEY`**.

## What to put in `.env.local`

You need the **account Auth Key** and **Auth Secret** from the Transloadit dashboard — **not** a template ID, **not** a Smart CDN key alone, and **not** placeholder text.

1. Sign in at [transloadit.com](https://transloadit.com).
2. Open **Account** → **API / Credentials** (wording may vary: “Template credentials”, “Auth keys”, or **Credentials** under your account).
3. Create or select an **Auth Key** pair. You should see:
   - **Auth Key** (public identifier, often looks like a long hex string)
   - **Auth Secret** (secret used to sign requests)
4. Copy them **exactly** into `.env.local`:

   ```env
   TRANSLOADIT_AUTH_KEY=paste_auth_key_here
   TRANSLOADIT_AUTH_SECRET=paste_auth_secret_here
   ```

5. **No** surrounding quotes unless your key itself contains spaces (rare). **No** trailing spaces.
6. Restart the Next dev server: `npm run dev`.

The same variables are used by:

- `POST /api/transloadit/upload` (browser uploads)
- Trigger tasks that upload FFmpeg outputs (`syncEnvVars` in `trigger.config.ts` + `npm run trigger:deploy`)

## Verify

After fixing keys, upload a small **PNG** or **JPG** in the app. If it still fails, check the **Transloadit dashboard → Assemblies** for error details (quota, billing, or robot limits).
