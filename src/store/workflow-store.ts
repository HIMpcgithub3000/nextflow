"use client";

import { create } from "zustand";
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  MarkerType,
  type Connection,
  type EdgeChange,
  type NodeChange
} from "@xyflow/react";
import { wouldCreateCycle } from "@/lib/graph";
import { WORKFLOW_EDGE_COLOR, type WorkflowEdge, type WorkflowNode, type WorkflowRun } from "@/types/workflow";
import { sampleEdges, sampleNodes } from "@/lib/sample-workflow";

type Snapshot = { nodes: WorkflowNode[]; edges: WorkflowEdge[] };

type WorkflowState = {
  workflowId?: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  runs: WorkflowRun[];
  history: Snapshot[];
  future: Snapshot[];
  selectedRunId?: string;
  onNodesChange: (changes: NodeChange<WorkflowNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<WorkflowEdge>[]) => void;
  onConnect: (connection: Connection) => void;
  addNode: (node: WorkflowNode) => void;
  setNodes: (nodes: WorkflowNode[]) => void;
  setEdges: (edges: WorkflowEdge[]) => void;
  updateNodeData: (nodeId: string, data: Partial<WorkflowNode["data"]>) => void;
  setWorkflowId: (workflowId?: string) => void;
  setRuns: (runs: WorkflowRun[]) => void;
  addRun: (run: WorkflowRun) => void;
  selectRun: (runId?: string) => void;
  pushSnapshot: () => void;
  undo: () => void;
  redo: () => void;
};

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  workflowId: undefined,
  nodes: sampleNodes,
  edges: sampleEdges,
  runs: [],
  history: [],
  future: [],
  selectedRunId: undefined,
  onNodesChange: (changes) =>
    set((state) => ({
      nodes: applyNodeChanges(changes, state.nodes)
    })),
  onEdgesChange: (changes) =>
    set((state) => ({
      edges: applyEdgeChanges(changes, state.edges)
    })),
  onConnect: (connection) =>
    set((state) => {
      if (wouldCreateCycle(state.edges, connection)) return state;
      return {
        history: [...state.history, { nodes: state.nodes, edges: state.edges }],
        future: [],
        edges: addEdge(
          {
            ...connection,
            animated: true,
            style: { stroke: WORKFLOW_EDGE_COLOR, strokeWidth: 1.8 },
            markerEnd: { type: MarkerType.ArrowClosed, color: WORKFLOW_EDGE_COLOR }
          },
          state.edges
        )
      };
    }),
  addNode: (node) =>
    set((state) => ({
      history: [...state.history, { nodes: state.nodes, edges: state.edges }],
      future: [],
      nodes: [...state.nodes, node]
    })),
  setNodes: (nodes) => set({ nodes }),
  setEdges: (edges) => set({ edges }),
  updateNodeData: (nodeId, data) =>
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === nodeId ? { ...node, data: { ...node.data, ...data } } : node
      )
    })),
  setWorkflowId: (workflowId) => set({ workflowId }),
  setRuns: (runs) => set({ runs }),
  addRun: (run) => set((state) => ({ runs: [run, ...state.runs] })),
  selectRun: (runId) => set({ selectedRunId: runId }),
  pushSnapshot: () => {
    const { nodes, edges, history } = get();
    set({ history: [...history, { nodes, edges }], future: [] });
  },
  undo: () => {
    const { history, nodes, edges, future } = get();
    const prev = history[history.length - 1];
    if (!prev) return;
    set({
      nodes: prev.nodes,
      edges: prev.edges,
      history: history.slice(0, -1),
      future: [...future, { nodes, edges }]
    });
  },
  redo: () => {
    const { future, nodes, edges, history } = get();
    const next = future[future.length - 1];
    if (!next) return;
    set({
      nodes: next.nodes,
      edges: next.edges,
      future: future.slice(0, -1),
      history: [...history, { nodes, edges }]
    });
  }
}));
