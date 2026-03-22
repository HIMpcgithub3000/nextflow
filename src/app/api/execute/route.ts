import { auth } from "@clerk/nextjs/server";
import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { triggerTaskFromApi } from "@/lib/trigger-from-api";
import type { RunNodeDetail, RunScope, RunStatus } from "@/types/workflow";

function requireTriggerEnv() {
  if (!process.env.TRIGGER_SECRET_KEY?.trim()) {
    throw new Error(
      "Missing TRIGGER_SECRET_KEY — all node runs use Trigger.dev (passthrough-text-node, passthrough-media-url, run-gemini-llm, crop-image-ffmpeg, extract-frame-ffmpeg)."
    );
  }
}

const nodeSchema = z.object({
  id: z.string(),
  type: z.enum(["text", "uploadImage", "uploadVideo", "runAnyLlm", "cropImage", "extractFrame"]),
  data: z.object({
    label: z.string(),
    output: z.string().optional(),
    values: z.record(z.string(), z.string()).optional()
  })
});

const edgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  targetHandle: z.string().optional().nullable()
});

const executeSchema = z.object({
  workflowId: z.string().optional(),
  scope: z.enum(["full", "partial", "single"]),
  selectedNodeIds: z.array(z.string()).optional(),
  nodes: z.array(nodeSchema),
  edges: z.array(edgeSchema)
});

type RuntimeNode = z.infer<typeof nodeSchema>;
type RuntimeEdge = z.infer<typeof edgeSchema>;

function upstreamNodes(nodeId: string, edges: RuntimeEdge[]) {
  return edges.filter((e) => e.target === nodeId).map((e) => e.source);
}

function topoLevels(nodes: RuntimeNode[], edges: RuntimeEdge[]) {
  const indegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  const included = new Set(nodes.map((n) => n.id));

  for (const n of nodes) {
    indegree.set(n.id, 0);
    outgoing.set(n.id, []);
  }

  for (const e of edges) {
    if (!included.has(e.source) || !included.has(e.target)) continue;
    indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1);
    outgoing.get(e.source)?.push(e.target);
  }

  const queue: string[] = [];
  indegree.forEach((degree, id) => {
    if (degree === 0) queue.push(id);
  });

  const levels: string[][] = [];
  let remaining = queue;
  let visited = 0;
  while (remaining.length > 0) {
    levels.push(remaining);
    const next: string[] = [];
    for (const id of remaining) {
      visited += 1;
      for (const child of outgoing.get(id) ?? []) {
        const v = (indegree.get(child) ?? 0) - 1;
        indegree.set(child, v);
        if (v === 0) next.push(child);
      }
    }
    remaining = next;
  }

  if (visited !== nodes.length) throw new Error("Cycle detected in workflow graph.");
  return levels;
}

const DEFAULT_MODEL = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";

async function runNode(node: RuntimeNode, edges: RuntimeEdge[], outputs: Map<string, unknown>) {
  const start = Date.now();
  const incoming = edges.filter((e) => e.target === node.id);
  const readInput = (handle: string) =>
    incoming.filter((i) => i.targetHandle === handle).map((i) => outputs.get(i.source));

  const inputSnapshot: Record<string, unknown> = {};
  incoming.forEach((e) => {
    inputSnapshot[e.targetHandle ?? "input"] = outputs.get(e.source);
  });

  try {
    if (node.type === "text") {
      requireTriggerEnv();
      const run = await triggerTaskFromApi<{ text: string }>("passthrough-text-node", {
        text: node.data.values?.text ?? ""
      });
      if (!run.ok) throw new Error(run.error);
      const output = String(run.output.text ?? "");
      return {
        detail: {
          nodeId: node.id,
          nodeLabel: node.data.label,
          status: "success" as const,
          executionMs: Date.now() - start,
          inputSnapshot,
          outputSnapshot: output
        } satisfies RunNodeDetail,
        output
      };
    }

    if (node.type === "uploadImage" || node.type === "uploadVideo") {
      requireTriggerEnv();
      const run = await triggerTaskFromApi<{ url: string }>("passthrough-media-url", {
        url: node.data.values?.url ?? node.data.output ?? "",
        kind: node.type === "uploadImage" ? "image" : "video"
      });
      if (!run.ok) throw new Error(run.error);
      const output = String(run.output.url ?? "");
      return {
        detail: {
          nodeId: node.id,
          nodeLabel: node.data.label,
          status: "success" as const,
          executionMs: Date.now() - start,
          inputSnapshot,
          outputSnapshot: output
        } satisfies RunNodeDetail,
        output
      };
    }

    if (node.type === "cropImage") {
      const imageInput = (readInput("image_url")[0] ?? node.data.values?.image_url ?? "") as string;
      if (!imageInput) throw new Error("Missing image input for crop node.");
      requireTriggerEnv();
      const xp = parseFloat(String(readInput("x_percent")[0] ?? node.data.values?.x_percent ?? "0"));
      const yp = parseFloat(String(readInput("y_percent")[0] ?? node.data.values?.y_percent ?? "0"));
      const wp = parseFloat(String(readInput("width_percent")[0] ?? node.data.values?.width_percent ?? "100"));
      const hp = parseFloat(String(readInput("height_percent")[0] ?? node.data.values?.height_percent ?? "100"));
      const run = await triggerTaskFromApi<{ outputUrl: string }>("crop-image-ffmpeg", {
        imageUrl: imageInput,
        xPercent: Number.isFinite(xp) ? xp : 0,
        yPercent: Number.isFinite(yp) ? yp : 0,
        widthPercent: Number.isFinite(wp) ? wp : 100,
        heightPercent: Number.isFinite(hp) ? hp : 100
      });
      if (!run.ok) throw new Error(run.error);
      const output = String(run.output.outputUrl ?? "");
      return {
        detail: {
          nodeId: node.id,
          nodeLabel: node.data.label,
          status: "success" as const,
          executionMs: Date.now() - start,
          inputSnapshot,
          outputSnapshot: output
        } satisfies RunNodeDetail,
        output
      };
    }

    if (node.type === "extractFrame") {
      const videoInput = (readInput("video_url")[0] ?? node.data.values?.video_url ?? "") as string;
      if (!videoInput) throw new Error("Missing video input for frame extraction.");
      requireTriggerEnv();
      const ts = String(readInput("timestamp")[0] ?? node.data.values?.timestamp ?? "0");
      const run = await triggerTaskFromApi<{ outputUrl: string }>("extract-frame-ffmpeg", {
        videoUrl: videoInput,
        timestamp: ts
      });
      if (!run.ok) throw new Error(run.error);
      const output = String(run.output.outputUrl ?? "");
      return {
        detail: {
          nodeId: node.id,
          nodeLabel: node.data.label,
          status: "success" as const,
          executionMs: Date.now() - start,
          inputSnapshot,
          outputSnapshot: output
        } satisfies RunNodeDetail,
        output
      };
    }

    const modelName = node.data.values?.model ?? DEFAULT_MODEL;
    const systemPrompt = String(readInput("system_prompt")[0] ?? node.data.values?.system_prompt ?? "");
    const userMessage = String(readInput("user_message")[0] ?? node.data.values?.user_message ?? "");
    const imageInputs = readInput("images").filter((v): v is string => typeof v === "string" && v.length > 0);

    if (!userMessage) throw new Error("LLM node requires user_message.");

    const llmParams = {
      model: modelName,
      systemPrompt: systemPrompt || undefined,
      userMessage,
      imageUrls: imageInputs
    };

    requireTriggerEnv();
    const llmRun = await triggerTaskFromApi<{ text: string }>("run-gemini-llm", llmParams);
    if (!llmRun.ok) throw new Error(llmRun.error);
    const text = String(llmRun.output.text ?? "");

    return {
      detail: {
        nodeId: node.id,
        nodeLabel: node.data.label,
        status: "success" as const,
        executionMs: Date.now() - start,
        inputSnapshot,
        outputSnapshot: text
      } satisfies RunNodeDetail,
      output: text
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown execution error";
    return {
      detail: {
        nodeId: node.id,
        nodeLabel: node.data.label,
        status: "failed" as const,
        executionMs: Date.now() - start,
        inputSnapshot,
        error: message
      } satisfies RunNodeDetail,
      output: ""
    };
  }
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = executeSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const startedAt = Date.now();
  const { scope, selectedNodeIds = [], edges, nodes } = parsed.data;
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const targetSet = scope === "full" ? new Set(nodes.map((n) => n.id)) : new Set(selectedNodeIds);

  if (scope !== "full" && targetSet.size === 0) {
    return NextResponse.json({ error: "No selected nodes were provided." }, { status: 400 });
  }

  const dependencySet = new Set<string>(targetSet);
  const queue = [...targetSet];
  while (queue.length) {
    const nodeId = queue.shift();
    if (!nodeId) continue;
    for (const up of upstreamNodes(nodeId, edges)) {
      if (!dependencySet.has(up)) {
        dependencySet.add(up);
        queue.push(up);
      }
    }
  }

  const runNodes = nodes.filter((n) => dependencySet.has(n.id));
  const runEdges = edges.filter((e) => dependencySet.has(e.source) && dependencySet.has(e.target));
  const levels = topoLevels(runNodes, runEdges);

  const outputs = new Map<string, unknown>();
  const details: RunNodeDetail[] = [];

  for (const level of levels) {
    const levelResults = await Promise.all(
      level.map(async (nodeId) => {
        const node = nodeById.get(nodeId);
        if (!node) throw new Error(`Missing node ${nodeId}`);
        return runNode(node, runEdges, outputs);
      })
    );
    for (const item of levelResults) {
      outputs.set(item.detail.nodeId, item.output);
      details.push(item.detail);
    }
  }

  const hasFailure = details.some((d) => d.status === "failed");
  const hasSuccess = details.some((d) => d.status === "success");
  const status: RunStatus = hasFailure ? (hasSuccess ? "partial" : "failed") : "success";
  const durationMs = Date.now() - startedAt;

  const graphPayload = {
    nodes: parsed.data.nodes,
    edges: parsed.data.edges
  } as Prisma.InputJsonValue;

  /** Ensure a workflow row exists and stores the latest graph (so runs are never orphaned from edits). */
  let workflowId = parsed.data.workflowId;
  if (workflowId) {
    const owned = await prisma.workflow.findFirst({ where: { id: workflowId, userId } });
    if (owned) {
      await prisma.workflow.update({
        where: { id: owned.id },
        data: { graphJson: graphPayload }
      });
    } else {
      const created = await prisma.workflow.create({
        data: {
          userId,
          name: "Product Marketing Kit Generator",
          graphJson: graphPayload
        }
      });
      workflowId = created.id;
    }
  } else {
    const created = await prisma.workflow.create({
      data: {
        userId,
        name: "Product Marketing Kit Generator",
        graphJson: graphPayload
      }
    });
    workflowId = created.id;
  }

  const persistedRun = await prisma.workflowRun.create({
    data: {
      userId,
      workflowId,
      scope: scope as RunScope,
      status,
      durationMs,
      detailsJson: details as unknown as Prisma.InputJsonValue
    }
  });

  return NextResponse.json({
    status,
    durationMs,
    details,
    nodeOutputs: Object.fromEntries(outputs),
    workflowId,
    run: {
      id: persistedRun.id,
      createdAt: persistedRun.createdAt.toISOString(),
      status: persistedRun.status,
      scope: persistedRun.scope,
      durationMs: persistedRun.durationMs,
      details
    }
  });
}
