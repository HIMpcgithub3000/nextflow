import { getAuthUserId, isApiKeyRequest } from "@/lib/auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const workflowSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(100),
  graphJson: z.any()
});

export async function GET(req: Request) {
  const isApiKey = isApiKeyRequest(req);
  const userId = await getAuthUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const data = await prisma.workflow.findMany({
    where: isApiKey ? {} : { userId },
    orderBy: { updatedAt: "desc" }
  });
  return NextResponse.json(data);
}

export async function POST(req: Request) {
  const isApiKey = isApiKeyRequest(req);
  const userId = await getAuthUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = workflowSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { id, name, graphJson } = parsed.data;

  if (id) {
    const existing = await prisma.workflow.findFirst({
      where: isApiKey ? { id } : { id, userId }
    });
    if (existing) {
      const updated = await prisma.workflow.update({
        where: { id: existing.id },
        data: { name, graphJson }
      });
      return NextResponse.json(updated);
    }
  }

  const created = await prisma.workflow.create({
    data: { userId, name, graphJson }
  });
  return NextResponse.json(created);
}

export async function DELETE(req: Request) {
  const isApiKey = isApiKeyRequest(req);
  const userId = await getAuthUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Workflow id required" }, { status: 400 });

  await prisma.workflow.deleteMany({
    where: isApiKey ? { id } : { id, userId }
  });
  return NextResponse.json({ success: true });
}
