import { getAuthUserId } from "@/lib/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const userId = await getAuthUserId();
  if (userId) redirect("/workflow");
  redirect("/sign-in");
}
