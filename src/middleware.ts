import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";

const isProtectedRoute = createRouteMatcher([
  "/workflow(.*)",
  "/api/workflows(.*)",
  "/api/runs(.*)",
  "/api/execute(.*)",
  "/api/transloadit(.*)"
]);

export default function middleware(req: NextRequest, evt: any) {
  // Allow API key authenticated requests directly through to route handlers
  const configuredApiKey = process.env.NEXTFLOW_API_KEY?.trim();
  if (configuredApiKey) {
    const providedKey = req.headers.get("x-api-key") || req.headers.get("authorization")?.replace("Bearer ", "");
    if (providedKey === configuredApiKey) {
      return NextResponse.next();
    }
  }

  const hasClerkKey = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim());
  if (!hasClerkKey) {
    return NextResponse.next();
  }
  return clerkMiddleware(async (auth, request) => {
    if (isProtectedRoute(request)) {
      await auth.protect();
    }
  })(req, evt);
}

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)", "/(api|trpc)(.*)"]
};
