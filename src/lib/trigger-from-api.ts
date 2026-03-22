import { runs, tasks } from "@trigger.dev/sdk/v3";
import { formatTriggerError } from "@/lib/trigger-errors";

/**
 * `tasks.triggerAndWait()` only works inside `task.run()`. From Next.js / any external
 * server, use `tasks.trigger()` + `runs.poll()` instead.
 */
export async function triggerTaskFromApi<TOutput>(
  taskId: string,
  payload: unknown,
  options?: { pollIntervalMs?: number }
): Promise<{ ok: true; output: TOutput } | { ok: false; error: string }> {
  const handle = await tasks.trigger(taskId, payload);
  const run = await runs.poll(handle.id, { pollIntervalMs: options?.pollIntervalMs ?? 500 });
  if (!run.isSuccess) {
    const errMsg = run.error?.message ?? formatTriggerError(run);
    return { ok: false, error: errMsg };
  }
  return { ok: true, output: run.output as TOutput };
}
