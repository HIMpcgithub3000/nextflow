import type { Connection, Edge } from "@xyflow/react";

/** Returns true if adding `connection` would create a directed cycle in the workflow DAG. */
export function wouldCreateCycle(edges: Edge[], connection: Connection): boolean {
  const source = connection.source;
  const target = connection.target;
  if (!source || !target) return false;
  if (source === target) return true;

  const forward = new Map<string, string[]>();
  for (const e of edges) {
    if (!forward.has(e.source)) forward.set(e.source, []);
    forward.get(e.source)!.push(e.target);
  }

  const stack = [target];
  const seen = new Set<string>();
  while (stack.length) {
    const n = stack.pop()!;
    if (n === source) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    for (const next of forward.get(n) ?? []) stack.push(next);
  }
  return false;
}
