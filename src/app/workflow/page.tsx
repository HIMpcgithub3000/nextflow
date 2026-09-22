import { getAuthUserId } from "@/lib/auth";
import { redirect } from "next/navigation";
import dynamic from "next/dynamic";

export const dynamic = "force-dynamic";

const WorkflowBuilder = dynamic(
  () => import("@/components/workflow-builder").then((m) => m.WorkflowBuilder),
  { ssr: false }
);

export default async function WorkflowPage() {
  const userId = await getAuthUserId();
  if (!userId) redirect("/sign-in");
  return <WorkflowBuilder />;
}
