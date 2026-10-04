import { auth } from "@clerk/nextjs/server";

/**
 * Returns the authenticated Clerk userId, or falls back to an API client / dev userId
 * when called via API Key or when Clerk keys are not configured.
 */
export function isApiKeyRequest(req?: Request): boolean {
  if (!req) return false;
  const configuredApiKey = process.env.NEXTFLOW_API_KEY?.trim();
  if (!configuredApiKey) return false;
  const providedKey = req.headers.get("x-api-key") || req.headers.get("authorization")?.replace("Bearer ", "");
  return Boolean(providedKey && providedKey === configuredApiKey);
}

export async function getAuthUserId(req?: Request): Promise<string> {
  if (isApiKeyRequest(req)) {
    return "user_nexus_dev";
  }

  const hasClerkKey = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim());
  if (hasClerkKey) {
    try {
      const { userId } = await auth();
      if (userId) return userId;
    } catch {
      // Return dev fallback if Clerk fails during development
    }
  }
  return process.env.DEV_USER_ID || "user_nexus_dev";
}
