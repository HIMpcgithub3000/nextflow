import { getAuthUserId } from "@/lib/auth";
import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { triggerTaskFromApi } from "@/lib/trigger-from-api";
import { runGeminiGenerate } from "@/lib/gemini-execute";
import { generateTraceId, generateSpanId, toUnixNano, sendSpansToSigNoz, type SpanPayload } from "@/lib/telemetry";
import type { RunNodeDetail, RunScope, RunStatus } from "@/types/workflow";

const DEFAULT_MODEL = "gemini-2.5-flash";

function hasTriggerEnv() {
  return Boolean(process.env.TRIGGER_SECRET_KEY?.trim());
}

function requireTriggerEnv() {
  if (!hasTriggerEnv()) {
    throw new Error(
      "Missing TRIGGER_SECRET_KEY — running with local execution fallback where possible."
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
    outgoing.set(e.source, [...(outgoing.get(e.source) ?? []), e.target]);
  }

  const levels: string[][] = [];
  let zeroIndegree = [...indegree.entries()].filter(([, d]) => d === 0).map(([id]) => id);

  while (zeroIndegree.length) {
    levels.push(zeroIndegree);
    const nextZeros: string[] = [];
    for (const id of zeroIndegree) {
      for (const to of outgoing.get(id) ?? []) {
        const nextDeg = (indegree.get(to) ?? 0) - 1;
        indegree.set(to, nextDeg);
        if (nextDeg === 0) nextZeros.push(to);
      }
    }
    zeroIndegree = nextZeros;
  }

  return levels;
}

async function runNode(
  node: RuntimeNode,
  edges: RuntimeEdge[],
  outputs: Map<string, unknown>
): Promise<{ detail: RunNodeDetail; output: unknown; startMs: number; endMs: number }> {
  const start = Date.now();
  const readInput = (handle: string) => {
    return edges
      .filter((e) => e.target === node.id && (e.targetHandle ?? "input") === handle)
      .map((e) => outputs.get(e.source))
      .filter((v) => v !== undefined);
  };

  const inputSnapshot: Record<string, unknown> = {
    values: node.data.values ?? {},
    connected: Object.fromEntries(
      edges
        .filter((e) => e.target === node.id)
        .map((e) => [e.targetHandle ?? "input", outputs.get(e.source)])
    )
  };

  try {
    if (node.type === "text") {
      const text = String(readInput("input")[0] ?? node.data.values?.text ?? "");
      let output = text;
      if (hasTriggerEnv()) {
        const run = await triggerTaskFromApi<{ text: string }>("passthrough-text-node", { text });
        if (!run.ok) throw new Error(run.error);
        output = String(run.output.text ?? "");
      }
      const end = Date.now();
      return {
        detail: {
          nodeId: node.id,
          nodeLabel: node.data.label,
          status: "success" as const,
          executionMs: end - start,
          inputSnapshot,
          outputSnapshot: output
        } satisfies RunNodeDetail,
        output,
        startMs: start,
        endMs: end
      };
    }

    if (node.type === "uploadImage" || node.type === "uploadVideo") {
      const url = String(readInput("input")[0] ?? node.data.values?.url ?? "");
      let output = url;
      if (hasTriggerEnv()) {
        const run = await triggerTaskFromApi<{ url: string }>("passthrough-media-url", {
          url,
          kind: node.type === "uploadImage" ? "image" : "video"
        });
        if (!run.ok) throw new Error(run.error);
        output = String(run.output.url ?? "");
      }
      const end = Date.now();
      return {
        detail: {
          nodeId: node.id,
          nodeLabel: node.data.label,
          status: "success" as const,
          executionMs: end - start,
          inputSnapshot,
          outputSnapshot: output
        } satisfies RunNodeDetail,
        output,
        startMs: start,
        endMs: end
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
      const end = Date.now();
      return {
        detail: {
          nodeId: node.id,
          nodeLabel: node.data.label,
          status: "success" as const,
          executionMs: end - start,
          inputSnapshot,
          outputSnapshot: output
        } satisfies RunNodeDetail,
        output,
        startMs: start,
        endMs: end
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
      const end = Date.now();
      return {
        detail: {
          nodeId: node.id,
          nodeLabel: node.data.label,
          status: "success" as const,
          executionMs: end - start,
          inputSnapshot,
          outputSnapshot: output
        } satisfies RunNodeDetail,
        output,
        startMs: start,
        endMs: end
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

    let text = "";
    if (hasTriggerEnv()) {
      const llmRun = await triggerTaskFromApi<{ text: string }>("run-gemini-llm", llmParams);
      if (!llmRun.ok) throw new Error(llmRun.error);
      text = String(llmRun.output.text ?? "");
    } else if (process.env.GEMINI_API_KEY?.trim()) {
      text = await runGeminiGenerate(llmParams);
    } else {
      text = `[Local NextFlow Execution Demo]\nProcessed input with model "${modelName}":\n"${userMessage}"\nSystem prompt: ${systemPrompt || "none"}`;
    }

    const end = Date.now();
    return {
      detail: {
        nodeId: node.id,
        nodeLabel: node.data.label,
        status: "success" as const,
        executionMs: end - start,
        inputSnapshot,
        outputSnapshot: text
      } satisfies RunNodeDetail,
      output: text,
      startMs: start,
      endMs: end
    };
  } catch (error) {
    const end = Date.now();
    const message = error instanceof Error ? error.message : "Unknown execution error";
    return {
      detail: {
        nodeId: node.id,
        nodeLabel: node.data.label,
        status: "failed" as const,
        executionMs: end - start,
        inputSnapshot,
        error: message
      } satisfies RunNodeDetail,
      output: "",
      startMs: start,
      endMs: end
    };
  }
}

export async function POST(request: Request) {
  const userId = await getAuthUserId(request);
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
  const nodeTimings: Array<{ nodeId: string; label: string; type: string; startMs: number; endMs: number; status: RunStatus; error?: string }> = [];

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
      const nodeRef = nodeById.get(item.detail.nodeId);
      nodeTimings.push({
        nodeId: item.detail.nodeId,
        label: item.detail.nodeLabel,
        type: nodeRef?.type || "unknown",
        startMs: item.startMs,
        endMs: item.endMs,
        status: item.detail.status,
        error: item.detail.error
      });
    }
  }

  const endedAt = Date.now();
  const hasFailure = details.some((d) => d.status === "failed");
  const hasSuccess = details.some((d) => d.status === "success");
  const status: RunStatus = hasFailure ? (hasSuccess ? "partial" : "failed") : "success";
  const durationMs = endedAt - startedAt;

  const graphPayload = {
    nodes: parsed.data.nodes,
    edges: parsed.data.edges
  } as Prisma.InputJsonValue;

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

  // Emit OpenTelemetry Traces to SigNoz APM
  const traceId = generateTraceId();
  const rootSpanId = generateSpanId();
  const spans: SpanPayload[] = [
    {
      traceId,
      spanId: rootSpanId,
      name: `workflow.run [${scope}]`,
      kind: 1, // INTERNAL
      startTimeUnixNano: toUnixNano(startedAt),
      endTimeUnixNano: toUnixNano(endedAt),
      attributes: [
        { key: "workflow.id", value: { stringValue: workflowId } },
        { key: "run.id", value: { stringValue: persistedRun.id } },
        { key: "run.scope", value: { stringValue: scope } },
        { key: "run.status", value: { stringValue: status } },
        { key: "run.duration_ms", value: { intValue: String(durationMs) } },
        { key: "run.node_count", value: { intValue: String(runNodes.length) } }
      ],
      status: {
        code: status === "failed" ? 2 : 1,
        message: status === "failed" ? "Workflow run encountered errors" : undefined
      }
    }
  ];

  for (const t of nodeTimings) {
    const childSpanId = generateSpanId();
    spans.push({
      traceId,
      spanId: childSpanId,
      parentSpanId: rootSpanId,
      name: `node.execute [${t.type}] ${t.label}`,
      kind: 1,
      startTimeUnixNano: toUnixNano(t.startMs),
      endTimeUnixNano: toUnixNano(t.endMs),
      attributes: [
        { key: "node.id", value: { stringValue: t.nodeId } },
        { key: "node.label", value: { stringValue: t.label } },
        { key: "node.type", value: { stringValue: t.type } },
        { key: "node.status", value: { stringValue: t.status } },
        ...(t.error ? [{ key: "error.message", value: { stringValue: t.error } }] : [])
      ],
      status: {
        code: t.status === "failed" ? 2 : 1,
        message: t.error
      }
    });
  }

  // Fire-and-forget send to SigNoz
  sendSpansToSigNoz(spans).catch(() => {});

  return NextResponse.json({
    status,
    durationMs,
    details,
    nodeOutputs: Object.fromEntries(outputs),
    workflowId,
    traceId,
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
