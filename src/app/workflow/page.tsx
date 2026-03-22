import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { WorkflowBuilder } from "@/components/workflow-builder";

export default async function WorkflowPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  return <WorkflowBuilder />;
}
