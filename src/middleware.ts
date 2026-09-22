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
