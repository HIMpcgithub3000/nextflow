import { SignUp } from "@clerk/nextjs";
import Link from "next/link";

export default function SignUpPage() {
  const hasClerk = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim());
  if (!hasClerk) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-[#0a0b10] text-slate-200 p-4">
        <div className="p-8 rounded-xl bg-slate-900 border border-slate-800 text-center max-w-md shadow-2xl">
          <h1 className="text-xl font-semibold mb-2">NextFlow Dev Mode</h1>
          <p className="text-sm text-slate-400 mb-6">Clerk publishable key is not configured. Dev mode active.</p>
          <Link href="/workflow" className="inline-block px-5 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm transition">
            Continue to Workflow Builder &rarr;
          </Link>
        </div>
      </main>
    );
  }
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0a0b10]">
      <SignUp />
    </main>
  );
}
