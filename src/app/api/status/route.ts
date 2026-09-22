import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const configuredApiKey = process.env.NEXTFLOW_API_KEY?.trim();
  if (configuredApiKey) {
    const providedKey = req.headers.get("x-api-key") || req.headers.get("authorization")?.replace("Bearer ", "");
    if (providedKey !== configuredApiKey) {
      return NextResponse.json({ error: "Invalid NextFlow API Key" }, { status: 401 });
    }
  }

  const startDb = Date.now();
  let dbOk = false;
  let dbLatency = 0;
  let workflowCount = 0;
  let runCount = 0;

  try {
    const [wCount, rCount] = await Promise.all([
      prisma.workflow.count(),
      prisma.workflowRun.count()
    ]);
    workflowCount = wCount;
    runCount = rCount;
    dbOk = true;
    dbLatency = Date.now() - startDb;
  } catch {
    dbOk = false;
  }

  // Check SigNoz via API
  const signozEndpoint = process.env.SIGNOZ_ENDPOINT || "http://127.0.0.1:8080";
  const signozApiKey = process.env.SIGNOZ_API_KEY?.trim() || "";
  let signozOk = false;
  let signozVersion = "";

  try {
    const headers: Record<string, string> = {};
    if (signozApiKey) {
      headers["SIGNOZ-API-KEY"] = signozApiKey;
    }
    const snzRes = await fetch(`${signozEndpoint.replace(/\/$/, "")}/api/v1/version`, {
      headers,
      signal: AbortSignal.timeout(2500)
    });
    if (snzRes.ok) {
      const data = await snzRes.json() as { version?: string };
      signozOk = true;
      signozVersion = data.version || "active";
    }
  } catch {
    signozOk = false;
  }

  return NextResponse.json({
    status: dbOk ? "online" : "degraded",
    engine: "NextFlow Workflow Engine v1.0.0",
    database: {
      connected: dbOk,
      latencyMs: dbLatency,
      counts: {
        workflows: workflowCount,
        runs: runCount
      }
    },
    signoz: {
      connected: signozOk,
      endpoint: signozEndpoint,
      version: signozVersion,
      apiKeyConfigured: Boolean(signozApiKey)
    },
    timestamp: new Date().toISOString()
  });
}
