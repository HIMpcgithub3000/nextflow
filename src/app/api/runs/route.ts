import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const runSchema = z.object({
  workflowId: z.string().min(1),
  scope: z.enum(["full", "partial", "single"]),
  status: z.enum(["success", "failed", "partial", "running"]),
  durationMs: z.number().int().nonnegative(),
  details: z.array(z.any())
});

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const workflowId = url.searchParams.get("workflowId");
  if (!workflowId) return NextResponse.json({ error: "workflowId is required" }, { status: 400 });
  const runs = await prisma.workflowRun.findMany({
    where: { userId, workflowId },
    orderBy: { createdAt: "desc" },
    take: 50
  });
  return NextResponse.json(runs);
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = runSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const run = await prisma.workflowRun.create({
    data: {
      userId,
      workflowId: parsed.data.workflowId,
      scope: parsed.data.scope,
      status: parsed.data.status,
      durationMs: parsed.data.durationMs,
      detailsJson: parsed.data.details
    }
  });
  return NextResponse.json(run);
}
