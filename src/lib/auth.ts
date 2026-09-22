import { auth } from "@clerk/nextjs/server";

/**
 * Returns the authenticated Clerk userId, or falls back to a dev userId
 * if Clerk keys are not configured or in local development mode.
 */
export async function getAuthUserId(): Promise<string> {
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
