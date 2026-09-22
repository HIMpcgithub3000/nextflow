import { getAuthUserId } from "@/lib/auth";
import { redirect } from "next/navigation";
import { WorkflowBuilder } from "@/components/workflow-builder";

export const dynamic = "force-dynamic";

export default async function WorkflowPage() {
  const userId = await getAuthUserId();
  if (!userId) redirect("/sign-in");
  return <WorkflowBuilder />;
}
