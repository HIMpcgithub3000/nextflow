import type { Edge, Node } from "@xyflow/react";

/** Animated edge stroke + arrow — violet/purple (matches UI accent & checklist). */
export const WORKFLOW_EDGE_COLOR = "#a855f7";

export type NodeKind =
  | "text"
  | "uploadImage"
  | "uploadVideo"
  | "runAnyLlm"
  | "cropImage"
  | "extractFrame";

export type PortType = "text" | "image" | "video" | "number";

export type WorkflowNodeData = {
  label: string;
  running?: boolean;
  output?: string;
  values?: Record<string, string>;
};

export type WorkflowNode = Node<WorkflowNodeData, NodeKind>;
export type WorkflowEdge = Edge;

export type RunScope = "full" | "partial" | "single";
export type RunStatus = "success" | "failed" | "partial" | "running";

export type RunNodeDetail = {
  nodeId: string;
  nodeLabel: string;
  status: RunStatus;
  executionMs: number;
  inputSnapshot: Record<string, unknown>;
  outputSnapshot?: unknown;
  error?: string;
};

export type WorkflowRun = {
  id: string;
  createdAt: string;
  status: RunStatus;
  scope: RunScope;
  durationMs: number;
  details: RunNodeDetail[];
};
