import { getAuthUserId } from "@/lib/auth";
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
  const userId = await getAuthUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const workflowId = url.searchParams.get("workflowId");
  const limit = url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : 50;

  const whereClause: Record<string, unknown> = { userId };
  if (workflowId) {
    whereClause.workflowId = workflowId;
  }

  const runs = await prisma.workflowRun.findMany({
    where: whereClause,
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      workflow: {
        select: { name: true }
      }
    }
  });

  const formatted = runs.map(r => ({
    id: r.id,
    workflowId: r.workflowId,
    workflowName: r.workflow?.name || "Workflow " + r.workflowId.slice(0, 8),
    scope: r.scope,
    status: r.status,
    durationMs: r.durationMs,
    details: r.detailsJson,
    createdAt: r.createdAt.toISOString()
  }));

  return NextResponse.json(formatted);
}

export async function POST(req: Request) {
  const userId = await getAuthUserId(req);
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
