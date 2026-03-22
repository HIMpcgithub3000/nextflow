import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const workflowSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(100),
  graphJson: z.any()
});

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const data = await prisma.workflow.findMany({ where: { userId }, orderBy: { updatedAt: "desc" } });
  return NextResponse.json(data);
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = workflowSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { id, name, graphJson } = parsed.data;
  const data = id
    ? await prisma.workflow.update({ where: { id }, data: { name, graphJson } })
    : await prisma.workflow.create({ data: { userId, name, graphJson } });
  return NextResponse.json(data);
}
