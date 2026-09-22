import { auth } from "@clerk/nextjs/server";

/**
 * Returns the authenticated Clerk userId, or falls back to an API client / dev userId
 * when called via API Key or when Clerk keys are not configured.
 */
export async function getAuthUserId(req?: Request): Promise<string> {
  if (req) {
    const configuredApiKey = process.env.NEXTFLOW_API_KEY?.trim();
    if (configuredApiKey) {
      const providedKey = req.headers.get("x-api-key") || req.headers.get("authorization")?.replace("Bearer ", "");
      if (providedKey === configuredApiKey) {
        return "user_nexus_dev";
      }
    }
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
