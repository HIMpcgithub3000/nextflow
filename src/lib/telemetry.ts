import crypto from "node:crypto";

export interface SpanAttribute {
  key: string;
  value: {
    stringValue?: string;
    intValue?: string;
    boolValue?: boolean;
    doubleValue?: number;
  };
}

export interface SpanPayload {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind?: number; // 1 = INTERNAL, 2 = SERVER, 3 = CLIENT
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: SpanAttribute[];
  status?: {
    code: number; // 0 = UNSET, 1 = OK, 2 = ERROR
    message?: string;
  };
}

export function generateTraceId(): string {
  return crypto.randomBytes(16).toString("hex");
}

export function generateSpanId(): string {
  return crypto.randomBytes(8).toString("hex");
}

export function toUnixNano(timestampMs: number): string {
  return (BigInt(timestampMs) * 1_000_000n).toString();
}

export async function sendSpansToSigNoz(spans: SpanPayload[]): Promise<boolean> {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim() || "http://127.0.0.1:4318";
  const serviceName = process.env.OTEL_SERVICE_NAME?.trim() || "nextflow-workflow-engine";

  const payload = {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: serviceName } },
            { key: "deployment.environment", value: { stringValue: process.env.NODE_ENV || "production" } },
            { key: "host.name", value: { stringValue: "nexus-ec2" } }
          ]
        },
        scopeSpans: [
          {
            scope: { name: "nextflow.workflow.tracer", version: "1.0.0" },
            spans
          }
        ]
      }
    ]
  };

  try {
    const url = `${endpoint.replace(/\/$/, "")}/v1/traces`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(4000)
    });
    return res.ok;
  } catch (err) {
    console.warn("[Telemetry] Failed to send spans to SigNoz:", err instanceof Error ? err.message : err);
    return false;
  }
}
