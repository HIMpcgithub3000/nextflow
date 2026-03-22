/**
 * Turn Trigger.dev task errors (often plain objects / API bodies) into readable strings.
 */
export function formatTriggerError(err: unknown): string {
  if (err == null) return "Unknown Trigger error (null/undefined)";
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;

  if (typeof err === "object") {
    const o = err as Record<string, unknown>;
    if (typeof o.message === "string") return o.message;
    if (typeof o.error === "string") return o.error;
    if (typeof o.body === "string") return o.body;
    if (o.body && typeof o.body === "object") {
      try {
        return JSON.stringify(o.body);
      } catch {
        /* ignore */
      }
    }
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }

  return String(err);
}
