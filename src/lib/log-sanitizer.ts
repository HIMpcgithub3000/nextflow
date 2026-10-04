/**
 * Log and Telemetry Data Sanitizer for NextFlow
 *
 * Automatically redacts API keys, credentials, JWTs, database URLs,
 * and PII from execution logs, error messages, and OpenTelemetry spans
 * before persisting to the database or emitting to SigNoz APM.
 */

// Regex patterns for sensitive credential signatures
const SENSITIVE_PATTERNS: Array<{ regex: RegExp; replacement: string }> = [
  // Google / Gemini API Keys (AIzaSy...)
  { regex: /AIzaSy[A-Za-z0-9_-]{33}/g, replacement: "[REDACTED_GEMINI_KEY]" },

  // Clerk Keys (sk_test_..., sk_live_..., pk_test_..., pk_live_...)
  { regex: /sk_(?:test|live)_[A-Za-z0-9]{20,}/g, replacement: "[REDACTED_CLERK_SECRET]" },
  { regex: /pk_(?:test|live)_[A-Za-z0-9=_-]{20,}/g, replacement: "[REDACTED_CLERK_PUBKEY]" },

  // OpenAI API Keys (sk-..., sk-proj-...)
  { regex: /sk-(?:proj-)?[A-Za-z0-9_-]{32,}/g, replacement: "[REDACTED_OPENAI_KEY]" },

  // Anthropic API Keys (sk-ant-...)
  { regex: /sk-ant-[A-Za-z0-9_-]{32,}/g, replacement: "[REDACTED_ANTHROPIC_KEY]" },

  // Bearer Tokens & Authorization Headers
  { regex: /Bearer\s+[A-Za-z0-9._~+/-]{16,}=*/gi, replacement: "Bearer [REDACTED_TOKEN]" },

  // JWT Tokens (header.payload.signature)
  { regex: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, replacement: "[REDACTED_JWT]" },

  // Database Connection Strings with Passwords
  { regex: /(postgres(?:ql)?:\/\/[^:]+:)([^@]+)(@)/gi, replacement: "$1[REDACTED_PASSWORD]$3" },
  { regex: /(mongodb(?:\+srv)?:\/\/[^:]+:)([^@]+)(@)/gi, replacement: "$1[REDACTED_PASSWORD]$3" },
  { regex: /(mysql:\/\/[^:]+:)([^@]+)(@)/gi, replacement: "$1[REDACTED_PASSWORD]$3" },

  // Generic key/secret assignment patterns (e.g. apiKey="...", password: "...")
  {
    regex: /(["']?(?:password|secret|api[_-]?key|token|auth|access_token|refresh_token)["']?\s*[:=]\s*["'])([^"'&\s]{6,})(["'])/gi,
    replacement: "$1[REDACTED_SECRET]$3"
  }
];

const SENSITIVE_KEY_NAMES = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "signoz-access-token",
  "signoz-ingestion-key",
  "clerk_secret_key",
  "gemini_api_key",
  "transloadit_auth_secret",
  "trigger_secret_key",
  "password",
  "secret",
  "token",
  "apikey",
  "api_key"
]);

/**
 * Sanitizes a plain text string by replacing matching secrets and credentials.
 */
export function sanitizeText(text: string): string {
  if (!text || typeof text !== "string") return text;
  let sanitized = text;
  for (const { regex, replacement } of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(regex, replacement);
  }
  return sanitized;
}

/**
 * Recursively traverses an object or array and redacts sensitive keys and values.
 */
export function sanitizeObject<T>(data: T, depth = 0): T {
  if (depth > 10) return data; // Prevent infinite recursion on circular refs
  if (data === null || data === undefined) return data;

  if (typeof data === "string") {
    return sanitizeText(data) as unknown as T;
  }

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeObject(item, depth + 1)) as unknown as T;
  }

  if (typeof data === "object") {
    const sanitizedObj: Record<string, any> = {};
    for (const [key, value] of Object.entries(data as Record<string, any>)) {
      const lowerKey = key.toLowerCase();
      if (SENSITIVE_KEY_NAMES.has(lowerKey)) {
        sanitizedObj[key] = "[REDACTED_SENSITIVE]";
      } else if (typeof value === "string") {
        sanitizedObj[key] = sanitizeText(value);
      } else {
        sanitizedObj[key] = sanitizeObject(value, depth + 1);
      }
    }
    return sanitizedObj as T;
  }

  return data;
}

/**
 * Sanitizes run details before storing into PostgreSQL database.
 */
export function sanitizeWorkflowRunDetails(details: any[]): any[] {
  if (!Array.isArray(details)) return details;
  return details.map((d) => ({
    ...d,
    error: d.error ? sanitizeText(String(d.error)) : d.error,
    inputSnapshot: d.inputSnapshot ? sanitizeObject(d.inputSnapshot) : d.inputSnapshot,
    outputSnapshot: d.outputSnapshot ? (typeof d.outputSnapshot === "string" ? sanitizeText(d.outputSnapshot) : sanitizeObject(d.outputSnapshot)) : d.outputSnapshot
  }));
}

/**
 * Sanitizes OpenTelemetry span payloads before transmitting to SigNoz collector.
 */
export function sanitizeSpanPayloads<T extends { attributes?: Array<{ key: string; value: any }>; name?: string; status?: { message?: string } }>(spans: T[]): T[] {
  if (!Array.isArray(spans)) return spans;
  return spans.map((span) => {
    const sanitizedAttributes = Array.isArray(span.attributes)
      ? span.attributes.map((attr) => {
          if (attr.value?.stringValue) {
            return {
              ...attr,
              value: {
                ...attr.value,
                stringValue: sanitizeText(attr.value.stringValue)
              }
            };
          }
          return attr;
        })
      : span.attributes;

    const sanitizedStatus = span.status?.message
      ? { ...span.status, message: sanitizeText(span.status.message) }
      : span.status;

    return {
      ...span,
      attributes: sanitizedAttributes,
      status: sanitizedStatus
    };
  });
}
