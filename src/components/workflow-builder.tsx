"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  type EdgeChange,
  type IsValidConnection,
  type NodeChange,
  type NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { UserButton } from "@clerk/nextjs";
import {
  Bot,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  FileImage,
  FileVideo,
  Frame,
  Scissors,
  Search,
  Type,
  Upload
} from "lucide-react";
import { formatDateTimeForDisplay } from "@/lib/format-datetime";
import { useWorkflowStore } from "@/store/workflow-store";
import {
  WORKFLOW_EDGE_COLOR,
  type NodeKind,
  type PortType,
  type RunStatus,
  type WorkflowEdge,
  type WorkflowNode,
  type WorkflowRun
} from "@/types/workflow";

const quickAccess = [
  { type: "text" as const, label: "Text Node", icon: Type },
  { type: "uploadImage" as const, label: "Upload Image Node", icon: FileImage },
  { type: "uploadVideo" as const, label: "Upload Video Node", icon: FileVideo },
  { type: "runAnyLlm" as const, label: "Run Any LLM Node", icon: Bot },
  { type: "cropImage" as const, label: "Crop Image Node", icon: Scissors },
  { type: "extractFrame" as const, label: "Extract Frame from Video Node", icon: Frame }
];

function statusClass(status: RunStatus) {
  if (status === "success") return "border-emerald-500/40 bg-emerald-500/20 text-emerald-300";
  if (status === "failed") return "border-red-500/40 bg-red-500/20 text-red-300";
  if (status === "running") return "border-amber-500/40 bg-amber-500/20 text-amber-300";
  return "border-zinc-500/40 bg-zinc-500/20 text-zinc-300";
}

function nodeOutputType(type: NodeKind): PortType {
  if (type === "uploadImage" || type === "cropImage" || type === "extractFrame") return "image";
  if (type === "uploadVideo") return "video";
  return "text";
}

function targetInputType(nodeType: NodeKind, handleId?: string | null): PortType | "any" {
  if (!handleId) return "any";
  if (nodeType === "runAnyLlm") {
    if (handleId === "images") return "image";
    return "text";
  }
  if (nodeType === "cropImage") {
    if (handleId === "image_url") return "image";
    return "text";
  }
  if (nodeType === "extractFrame") {
    if (handleId === "video_url") return "video";
    return "text";
  }
  return "any";
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded border border-zinc-700/80 bg-zinc-900/80 px-1.5 py-0.5 text-[10px] text-zinc-300">
      {children}
    </span>
  );
}

function useConnectedSetForNode(nodeId: string) {
  const edges = useWorkflowStore((s) => s.edges);
  return useMemo(
    () => new Set(edges.filter((e) => e.target === nodeId).map((e) => e.targetHandle ?? "input")),
    [edges, nodeId]
  );
}

/** String preview of what a node outputs (matches /api/execute upstream resolution). */
function sourceNodeOutputPreview(node: WorkflowNode): string {
  const v = node.data.values ?? {};
  const out = node.data.output ?? "";
  switch (node.type) {
    case "text":
      return v.text ?? "";
    case "uploadImage":
    case "uploadVideo":
      return (v.url ?? out).trim();
    case "cropImage":
      return (out || v.image_url || "").trim();
    case "extractFrame":
      return (out || v.video_url || "").trim();
    case "runAnyLlm":
      return String(out ?? "");
    default:
      return "";
  }
}

function resolveUpstreamInputPreview(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  targetId: string,
  handleId: string
): string {
  const edge = edges.find(
    (e) =>
      e.target === targetId &&
      (e.targetHandle === handleId || (handleId === "input" && (e.targetHandle == null || e.targetHandle === "input")))
  );
  if (!edge) return "";
  const source = nodes.find((n) => n.id === edge.source);
  if (!source) return "";
  return sourceNodeOutputPreview(source);
}

function useResolvedUpstreamInput(nodeId: string, handleId: string): string {
  const nodes = useWorkflowStore((s) => s.nodes);
  const edges = useWorkflowStore((s) => s.edges);
  return useMemo(
    () => resolveUpstreamInputPreview(nodes, edges, nodeId, handleId),
    [nodes, edges, nodeId, handleId]
  );
}

function patchValues(nodeId: string, next: Record<string, string>) {
  const store = useWorkflowStore.getState();
  const current = store.nodes.find((n) => n.id === nodeId)?.data.values ?? {};
  store.updateNodeData(nodeId, { values: { ...current, ...next } });
}

/** Avoids `response.json()` throwing on HTML/error pages or empty bodies from `/api/transloadit/upload`. */
async function parseTransloaditUploadJson(res: Response): Promise<{ url?: string; error?: string; hint?: string }> {
  const text = await res.text();
  if (!text.trim()) {
    return { error: res.ok ? "Empty response from server" : `Upload failed (HTTP ${res.status})` };
  }
  try {
    const j = JSON.parse(text) as { url?: string; error?: string; hint?: string };
    if (!res.ok && !j.error) {
      return { ...j, error: j.error ?? `HTTP ${res.status}` };
    }
    return j;
  } catch {
    return { error: text.slice(0, 200) || `HTTP ${res.status}` };
  }
}

type TransloaditUploadErrorState = { message: string; hint?: string };

function transloaditErrorFromJson(j: { error?: string; hint?: string }): TransloaditUploadErrorState {
  return {
    message: j.error ?? "Upload failed",
    hint: j.hint
  };
}

/** LLM output: focusable scroll region, visible scrollbar, wheel doesn’t zoom canvas, jump buttons. */
function LlmOutputScroll({ text, emptyLabel }: { text: string; emptyLabel: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const hasContent = text.trim().length > 0;

  const scrollByDir = (dir: "bottom" | "top") => {
    const el = ref.current;
    if (!el) return;
    el.scrollTo({
      top: dir === "bottom" ? el.scrollHeight : 0,
      behavior: "smooth"
    });
  };

  return (
    <div className="overflow-hidden rounded-md border border-zinc-700 bg-zinc-900/80">
      <div className="flex items-center justify-between gap-1 border-b border-zinc-700/80 bg-zinc-900/95 px-1.5 py-1">
        <span className="text-[9px] font-medium uppercase tracking-wide text-zinc-500">Output</span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            title="Scroll to top"
            disabled={!hasContent}
            onClick={() => scrollByDir("top")}
            className="nodrag nopan inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-zinc-600 bg-zinc-800/90 text-zinc-300 hover:border-violet-500/50 hover:text-zinc-100 disabled:pointer-events-none disabled:opacity-30"
          >
            <ChevronUp className="h-3.5 w-3.5" aria-hidden />
          </button>
          <button
            type="button"
            title="Scroll to bottom"
            disabled={!hasContent}
            onClick={() => scrollByDir("bottom")}
            className="nodrag nopan inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-zinc-600 bg-zinc-800/90 text-zinc-300 hover:border-violet-500/50 hover:text-zinc-100 disabled:pointer-events-none disabled:opacity-30"
          >
            <ChevronDown className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      </div>
      <div
        ref={ref}
        tabIndex={0}
        role="region"
        aria-label="LLM response output. Use mouse wheel, scrollbar, or buttons to scroll."
        className="nodrag nopan max-h-64 w-full cursor-text overflow-y-scroll scroll-smooth px-2 py-1.5 text-left text-[11px] leading-snug text-zinc-300 outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#15171f] [scrollbar-color:rgb(82_82_91)_rgb(24_24_27)] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-500 [&::-webkit-scrollbar-thumb]:hover:bg-violet-500/70 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-track]:bg-zinc-800/90"
        onWheel={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <p className="min-h-[2rem] select-text whitespace-pre-wrap break-words">
          {hasContent ? text : emptyLabel}
        </p>
      </div>
    </div>
  );
}

function TransloaditErrorCallout({ error }: { error: TransloaditUploadErrorState }) {
  return (
    <div className="max-h-36 overflow-y-auto rounded-md border border-red-500/35 bg-red-950/20 px-2 py-1.5 text-[10px] leading-snug">
      <p className="break-words font-medium text-red-300">{error.message}</p>
      {error.hint ? (
        <p className="mt-1.5 break-words border-t border-red-500/20 pt-1.5 text-zinc-400">{error.hint}</p>
      ) : null}
    </div>
  );
}

function NodeCard({
  title,
  subtitle,
  running,
  children
}: {
  title: string;
  subtitle: string;
  running?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={`w-[252px] rounded-2xl border border-zinc-700/70 bg-[#15171f]/92 shadow-[0_8px_24px_rgba(0,0,0,0.28)] transition-all ${
        running ? "node-running border-violet-500/70" : "hover:border-zinc-500/70"
      }`}
    >
      <div className="border-b border-zinc-700/60 px-3 py-2">
        <p className="text-xs font-semibold text-zinc-100">{title}</p>
        <p className="text-[11px] text-zinc-400">{subtitle}</p>
      </div>
      <div className="space-y-2 px-3 py-2">{children}</div>
    </div>
  );
}

function TextNode({ id, data }: NodeProps<WorkflowNode>) {
  return (
    <NodeCard title={data.label} subtitle="Plain text source" running={data.running}>
      <textarea
        value={data.values?.text ?? ""}
        onChange={(e) => patchValues(id, { text: e.target.value })}
        className="h-20 w-full resize-none rounded-md border border-zinc-700 bg-zinc-900/80 px-2 py-1 text-xs text-zinc-200"
      />
      <div className="flex justify-end">
        <Chip>text output</Chip>
      </div>
      <Handle type="source" position={Position.Right} id="output" className="!h-3 !w-3 !border-zinc-950 !bg-[#2f7bff]" />
    </NodeCard>
  );
}

function UploadImageNode({ id, data }: NodeProps<WorkflowNode>) {
  const url = data.values?.url ?? "";
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<TransloaditUploadErrorState | null>(null);
  const uploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploading(true);
    setUploadError(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const r = await fetch("/api/transloadit/upload", { method: "POST", body: fd });
      const j = await parseTransloaditUploadJson(r);
      if (j.url) {
        patchValues(id, { url: j.url });
      } else {
        setUploadError(transloaditErrorFromJson(j));
      }
    } catch (err) {
      setUploadError({
        message: err instanceof Error ? err.message : "Network error during upload"
      });
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };
  return (
    <NodeCard title={data.label} subtitle="Transloadit image upload" running={data.running}>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={uploadFile} />
      <div className="flex gap-1">
        <button
          type="button"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
          className="inline-flex flex-1 items-center justify-center gap-1 rounded-md border border-zinc-600 bg-zinc-800/80 px-2 py-1 text-[10px] text-zinc-200 hover:border-violet-500/50 disabled:opacity-50"
        >
          <Upload className="h-3 w-3" />
          {uploading ? "…" : "Upload"}
        </button>
      </div>
      {uploadError ? <TransloaditErrorCallout error={uploadError} /> : null}
      <input
        value={url}
        onChange={(e) => patchValues(id, { url: e.target.value })}
        placeholder="Paste image URL or upload"
        className="w-full rounded-md border border-zinc-700 bg-zinc-900/80 px-2 py-1 text-[11px] text-zinc-200 outline-none focus:border-violet-500/60"
      />
      <div className="rounded-md border border-dashed border-zinc-700 bg-zinc-900/80 px-2 py-3 text-center text-[11px] text-zinc-400">
        {url ? <img src={url} alt="preview" className="mx-auto max-h-20 rounded object-cover" /> : "Image preview"}
      </div>
      <div className="flex justify-end">
        <Chip>image url</Chip>
      </div>
      <Handle type="source" position={Position.Right} id="output" className="!h-3 !w-3 !border-zinc-950 !bg-[#2f7bff]" />
    </NodeCard>
  );
}

function UploadVideoNode({ id, data }: NodeProps<WorkflowNode>) {
  const url = data.values?.url ?? "";
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<TransloaditUploadErrorState | null>(null);
  const uploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploading(true);
    setUploadError(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const r = await fetch("/api/transloadit/upload", { method: "POST", body: fd });
      const j = await parseTransloaditUploadJson(r);
      if (j.url) {
        patchValues(id, { url: j.url });
      } else {
        setUploadError(transloaditErrorFromJson(j));
      }
    } catch (err) {
      setUploadError({
        message: err instanceof Error ? err.message : "Network error during upload"
      });
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };
  return (
    <NodeCard title={data.label} subtitle="Transloadit video upload" running={data.running}>
      <input ref={fileRef} type="file" accept="video/*" className="hidden" onChange={uploadFile} />
      <div className="flex gap-1">
        <button
          type="button"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
          className="inline-flex flex-1 items-center justify-center gap-1 rounded-md border border-zinc-600 bg-zinc-800/80 px-2 py-1 text-[10px] text-zinc-200 hover:border-violet-500/50 disabled:opacity-50"
        >
          <Upload className="h-3 w-3" />
          {uploading ? "…" : "Upload"}
        </button>
      </div>
      {uploadError ? <TransloaditErrorCallout error={uploadError} /> : null}
      <input
        value={url}
        onChange={(e) => patchValues(id, { url: e.target.value })}
        placeholder="Paste video URL or upload"
        className="w-full rounded-md border border-zinc-700 bg-zinc-900/80 px-2 py-1 text-[11px] text-zinc-200 outline-none focus:border-violet-500/60"
      />
      <div className="rounded-md border border-dashed border-zinc-700 bg-zinc-900/80 px-2 py-3 text-center text-[11px] text-zinc-400">
        {url ? <video src={url} controls className="mx-auto max-h-20 rounded" /> : "Video preview"}
      </div>
      <div className="flex justify-end">
        <Chip>video url</Chip>
      </div>
      <Handle type="source" position={Position.Right} id="output" className="!h-3 !w-3 !border-zinc-950 !bg-[#2f7bff]" />
    </NodeCard>
  );
}

function LlmNode({ id, data }: NodeProps<WorkflowNode>) {
  const connected = useConnectedSetForNode(id);
  return (
    <NodeCard title={data.label} subtitle="Gemini via Trigger.dev" running={data.running}>
      <div className="flex flex-wrap gap-1">
        <select
          value={data.values?.model ?? "gemini-2.5-flash"}
          onChange={(e) => patchValues(id, { model: e.target.value })}
          className="rounded border border-zinc-700 bg-zinc-900/80 px-1.5 py-0.5 text-[10px] text-zinc-200"
        >
          <option value="gemini-2.5-flash">gemini-2.5-flash</option>
          <option value="gemini-2.5-pro">gemini-2.5-pro</option>
        </select>
        <Chip>vision</Chip>
      </div>
      <textarea
        value={data.values?.system_prompt ?? ""}
        disabled={connected.has("system_prompt")}
        onChange={(e) => patchValues(id, { system_prompt: e.target.value })}
        placeholder="System prompt"
        className="h-14 w-full resize-none rounded-md border border-zinc-700 bg-zinc-900/80 px-2 py-1 text-[11px] text-zinc-200 disabled:opacity-50"
      />
      <textarea
        value={data.values?.user_message ?? ""}
        disabled={connected.has("user_message")}
        onChange={(e) => patchValues(id, { user_message: e.target.value })}
        placeholder="User message"
        className="h-16 w-full resize-none rounded-md border border-zinc-700 bg-zinc-900/80 px-2 py-1 text-[11px] text-zinc-200 disabled:opacity-50"
      />
      <LlmOutputScroll
        text={data.output ?? ""}
        emptyLabel="Response appears here after Run Full / Run Selected."
      />
      <Handle type="target" position={Position.Left} id="system_prompt" style={{ top: 44 }} className="!h-3 !w-3 !border-zinc-950 !bg-[#f2c14e]" />
      <Handle type="target" position={Position.Left} id="user_message" style={{ top: 78 }} className="!h-3 !w-3 !border-zinc-950 !bg-[#f2c14e]" />
      <Handle type="target" position={Position.Left} id="images" style={{ top: 112 }} className="!h-3 !w-3 !border-zinc-950 !bg-[#f2c14e]" />
      <Handle type="source" position={Position.Right} id="output" className="!h-3 !w-3 !border-zinc-950 !bg-[#2f7bff]" />
    </NodeCard>
  );
}

function CropNode({ id, data }: NodeProps<WorkflowNode>) {
  const connected = useConnectedSetForNode(id);
  const wireImageUrl = useResolvedUpstreamInput(id, "image_url");
  const imageUrlConnected = connected.has("image_url");
  const imageUrlValue = imageUrlConnected ? wireImageUrl : (data.values?.image_url ?? "");
  return (
    <NodeCard title={data.label} subtitle="FFmpeg crop task" running={data.running}>
      <input
        value={imageUrlValue}
        readOnly={imageUrlConnected}
        onChange={(e) => patchValues(id, { image_url: e.target.value })}
        placeholder={imageUrlConnected ? "No URL from upstream yet — upload or paste on source node" : "Image URL"}
        title={imageUrlConnected ? "Value comes from the connected node" : undefined}
        className={`w-full rounded-md border border-zinc-700 bg-zinc-900/80 px-2 py-1 text-[11px] text-zinc-200 ${
          imageUrlConnected ? "cursor-default border-violet-500/30 bg-zinc-950/60" : ""
        }`}
      />
      <div className="grid grid-cols-2 gap-1 text-[11px] text-zinc-300">
        <input
          value={data.values?.x_percent ?? "0"}
          disabled={connected.has("x_percent")}
          onChange={(e) => patchValues(id, { x_percent: e.target.value })}
          className="rounded-md border border-zinc-700 bg-zinc-900/80 px-2 py-1 disabled:opacity-50"
        />
        <input
          value={data.values?.y_percent ?? "0"}
          disabled={connected.has("y_percent")}
          onChange={(e) => patchValues(id, { y_percent: e.target.value })}
          className="rounded-md border border-zinc-700 bg-zinc-900/80 px-2 py-1 disabled:opacity-50"
        />
        <input
          value={data.values?.width_percent ?? "100"}
          disabled={connected.has("width_percent")}
          onChange={(e) => patchValues(id, { width_percent: e.target.value })}
          className="rounded-md border border-zinc-700 bg-zinc-900/80 px-2 py-1 disabled:opacity-50"
        />
        <input
          value={data.values?.height_percent ?? "100"}
          disabled={connected.has("height_percent")}
          onChange={(e) => patchValues(id, { height_percent: e.target.value })}
          className="rounded-md border border-zinc-700 bg-zinc-900/80 px-2 py-1 disabled:opacity-50"
        />
      </div>
      <Handle type="target" position={Position.Left} id="image_url" style={{ top: 58 }} className="!h-3 !w-3 !border-zinc-950 !bg-[#f2c14e]" />
      <Handle type="target" position={Position.Left} id="x_percent" style={{ top: 82 }} className="!h-3 !w-3 !border-zinc-950 !bg-[#f2c14e]" />
      <Handle type="target" position={Position.Left} id="y_percent" style={{ top: 98 }} className="!h-3 !w-3 !border-zinc-950 !bg-[#f2c14e]" />
      <Handle type="target" position={Position.Left} id="width_percent" style={{ top: 114 }} className="!h-3 !w-3 !border-zinc-950 !bg-[#f2c14e]" />
      <Handle type="target" position={Position.Left} id="height_percent" style={{ top: 130 }} className="!h-3 !w-3 !border-zinc-950 !bg-[#f2c14e]" />
      <Handle type="source" position={Position.Right} id="output" className="!h-3 !w-3 !border-zinc-950 !bg-[#2f7bff]" />
    </NodeCard>
  );
}

function ExtractFrameNode({ id, data }: NodeProps<WorkflowNode>) {
  const connected = useConnectedSetForNode(id);
  const wireVideoUrl = useResolvedUpstreamInput(id, "video_url");
  const videoUrlConnected = connected.has("video_url");
  const videoUrlValue = videoUrlConnected ? wireVideoUrl : (data.values?.video_url ?? "");
  return (
    <NodeCard title={data.label} subtitle="FFmpeg frame extraction" running={data.running}>
      <input
        value={videoUrlValue}
        readOnly={videoUrlConnected}
        onChange={(e) => patchValues(id, { video_url: e.target.value })}
        placeholder={
          videoUrlConnected ? "No URL from upstream yet — upload or paste on source node" : "Video URL"
        }
        title={videoUrlConnected ? "Value comes from the connected node" : undefined}
        className={`w-full rounded-md border border-zinc-700 bg-zinc-900/80 px-2 py-1 text-[11px] text-zinc-200 ${
          videoUrlConnected ? "cursor-default border-violet-500/30 bg-zinc-950/60" : ""
        }`}
      />
      <input
        value={data.values?.timestamp ?? "0"}
        disabled={connected.has("timestamp")}
        onChange={(e) => patchValues(id, { timestamp: e.target.value })}
        placeholder="Timestamp (seconds or 50%)"
        className="w-full rounded-md border border-zinc-700 bg-zinc-900/80 px-2 py-1 text-[11px] text-zinc-200 disabled:opacity-50"
      />
      <Handle type="target" position={Position.Left} id="video_url" style={{ top: 54 }} className="!h-3 !w-3 !border-zinc-950 !bg-[#f2c14e]" />
      <Handle type="target" position={Position.Left} id="timestamp" style={{ top: 90 }} className="!h-3 !w-3 !border-zinc-950 !bg-[#f2c14e]" />
      <Handle type="source" position={Position.Right} id="output" className="!h-3 !w-3 !border-zinc-950 !bg-[#2f7bff]" />
    </NodeCard>
  );
}

const nodeTypes = {
  text: TextNode,
  uploadImage: UploadImageNode,
  uploadVideo: UploadVideoNode,
  runAnyLlm: LlmNode,
  cropImage: CropNode,
  extractFrame: ExtractFrameNode
};

/** Must render as a child of `<ReactFlow />` — handles undo/redo and delete without double snapshotting. */
function FlowKeyboardShortcuts() {
  const { getNodes, getEdges, deleteElements } = useReactFlow();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("textarea, input, select")) return;

      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        useWorkflowStore.getState().undo();
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault();
        useWorkflowStore.getState().redo();
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        const selectedNodes = getNodes().filter((n) => n.selected);
        const selectedEdges = getEdges().filter((edge) => edge.selected);
        if (selectedNodes.length || selectedEdges.length) {
          e.preventDefault();
          void deleteElements({ nodes: selectedNodes, edges: selectedEdges });
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [getNodes, getEdges, deleteElements]);

  return null;
}

function Builder() {
  const {
    workflowId,
    setWorkflowId,
    nodes,
    edges,
    runs,
    selectedRunId,
    selectRun,
    onNodesChange: storeOnNodesChange,
    onEdgesChange: storeOnEdgesChange,
    onConnect,
    addNode,
    setRuns,
    addRun,
    setNodes,
    setEdges,
    pushSnapshot,
    undo,
    redo
  } = useWorkflowStore();
  const importRef = useRef<HTMLInputElement>(null);
  const lastSavedGraphRef = useRef<string | null>(null);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [leftOpen, setLeftOpen] = useState(true);
  const [dbMessage, setDbMessage] = useState<string | null>(null);
  const [persistHint, setPersistHint] = useState<string | null>(null);
  const [persistEnabled, setPersistEnabled] = useState(false);
  const [saveUi, setSaveUi] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const captureSavedGraph = useCallback(() => {
    const { nodes: n, edges: e } = useWorkflowStore.getState();
    lastSavedGraphRef.current = JSON.stringify({ nodes: n, edges: e });
  }, []);
  const selectedRun = useMemo(() => runs.find((r) => r.id === selectedRunId), [runs, selectedRunId]);
  const nodesById = useMemo(() => Object.fromEntries(nodes.map((node) => [node.id, node])), [nodes]);
  const [running, setRunning] = useState(false);
  const selectedNodeIds = useMemo(() => nodes.filter((n) => n.selected).map((n) => n.id), [nodes]);

  const onNodesChange = useCallback(
    (changes: NodeChange<WorkflowNode>[]) => {
      if (changes.some((c) => c.type === "remove")) {
        pushSnapshot();
      }
      storeOnNodesChange(changes);
    },
    [storeOnNodesChange, pushSnapshot]
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<WorkflowEdge>[]) => {
      if (changes.some((c) => c.type === "remove")) {
        pushSnapshot();
      }
      storeOnEdgesChange(changes);
    },
    [storeOnEdgesChange, pushSnapshot]
  );

  const exportWorkflow = useCallback(() => {
    const blob = new Blob([JSON.stringify({ nodes, edges }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "nextflow-workflow.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }, [nodes, edges]);

  const onImportFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(String(reader.result)) as { nodes?: WorkflowNode[]; edges?: WorkflowEdge[] };
          if (data.nodes && data.edges) {
            pushSnapshot();
            setNodes(data.nodes);
            setEdges(data.edges);
          }
        } catch {
          /* ignore */
        }
      };
      reader.readAsText(file);
      e.target.value = "";
    },
    [pushSnapshot, setNodes, setEdges]
  );

  const isValidConnection = useMemo<IsValidConnection>(
    () => (connection) => {
      if (!connection.source || !connection.target) return false;
      if (connection.source === connection.target) return false;
      const sourceNode = nodesById[connection.source];
      const targetNode = nodesById[connection.target];
      if (!sourceNode || !targetNode) return false;
      const sourceType = nodeOutputType(sourceNode.type);
      const expectedInput = targetInputType(targetNode.type, connection.targetHandle);
      if (expectedInput === "any") return true;
      return sourceType === expectedInput || (expectedInput === "text" && sourceType === "number");
    },
    [nodesById]
  );

  const hydrateRuns = useCallback(
    async (wfId: string) => {
      const response = await fetch(`/api/runs?workflowId=${wfId}`);
      if (!response.ok) return;
      const payload = (await response.json()) as Array<{
        id: string;
        createdAt: string;
        status: RunStatus;
        scope: "full" | "partial" | "single";
        durationMs: number;
        detailsJson: unknown;
      }>;
      const mapped: WorkflowRun[] = payload.map((item) => ({
        id: item.id,
        createdAt: item.createdAt,
        status: item.status,
        scope: item.scope,
        durationMs: item.durationMs,
        details: Array.isArray(item.detailsJson) ? (item.detailsJson as WorkflowRun["details"]) : []
      }));
      setRuns(mapped);
    },
    [setRuns]
  );

  useEffect(() => {
    const bootstrap = async () => {
      const response = await fetch("/api/workflows");
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        setPersistEnabled(false);
        setDbMessage(
          response.status === 401
            ? "Sign in to load saved workflows."
            : `Could not load workflows (${response.status}). Check DATABASE_URL and Prisma.`
        );
        if (typeof err === "object" && err && "error" in err) {
          console.error("/api/workflows", err);
        }
        return;
      }
      setDbMessage(null);
      const data = (await response.json()) as Array<{ id: string; graphJson: { nodes: WorkflowNode[]; edges: typeof edges } }>;
      if (data.length > 0) {
        const first = data[0];
        if (first.graphJson?.nodes && first.graphJson?.edges) {
          setNodes(first.graphJson.nodes);
          setEdges(first.graphJson.edges);
        }
        setWorkflowId(first.id);
        await hydrateRuns(first.id);
      }
      setPersistEnabled(true);
      const { nodes: n, edges: e } = useWorkflowStore.getState();
      lastSavedGraphRef.current = JSON.stringify({ nodes: n, edges: e });
    };
    void bootstrap();
  }, [hydrateRuns, setEdges, setNodes, setWorkflowId]);

  /** Debounced autosave — persists the canvas without requiring Run or manual Save. */
  useEffect(() => {
    if (!persistEnabled) return;
    const json = JSON.stringify({ nodes, edges });
    if (json === lastSavedGraphRef.current) return;

    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(async () => {
      autosaveTimerRef.current = null;
      setSaveUi("saving");
      try {
        const { workflowId: wid, nodes: n, edges: ed } = useWorkflowStore.getState();
        const res = await fetch("/api/workflows", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: wid,
            name: "Product Marketing Kit Generator",
            graphJson: { nodes: n, edges: ed }
          })
        });
        if (!res.ok) {
          setSaveUi("error");
          return;
        }
        const data = (await res.json()) as { id: string };
        setWorkflowId(data.id);
        lastSavedGraphRef.current = JSON.stringify({
          nodes: useWorkflowStore.getState().nodes,
          edges: useWorkflowStore.getState().edges
        });
        setSaveUi("saved");
        window.setTimeout(() => setSaveUi("idle"), 2000);
      } catch {
        setSaveUi("error");
      }
    }, 1200);

    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, [nodes, edges, persistEnabled, setWorkflowId]);

  const saveWorkflow = async () => {
    const payload = {
      id: workflowId,
      name: "Product Marketing Kit Generator",
      graphJson: { nodes, edges }
    };
    const response = await fetch("/api/workflows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      setDbMessage(
        `Save failed (${response.status}). Ensure DATABASE_URL is set in .env (not overridden by an empty DATABASE_URL= in .env.local).`
      );
      console.error("POST /api/workflows", err);
      return;
    }
    setDbMessage(null);
    setPersistHint(null);
    const created = (await response.json()) as { id: string };
    setWorkflowId(created.id);
    captureSavedGraph();
    setSaveUi("saved");
    window.setTimeout(() => setSaveUi("idle"), 2000);
    await hydrateRuns(created.id);
  };

  const execute = async (scope: "full" | "partial" | "single") => {
    if (scope !== "full" && selectedNodeIds.length === 0) return;
    setRunning(true);
    const baseNodes = nodes;
    const targetSet = new Set(scope === "full" ? nodes.map((n) => n.id) : selectedNodeIds);
    setNodes(baseNodes.map((node) => ({ ...node, data: { ...node.data, running: targetSet.has(node.id) } })));
    try {
      const response = await fetch("/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflowId,
          scope,
          selectedNodeIds,
          nodes: nodes.map((n) => ({ id: n.id, type: n.type, data: n.data })),
          edges: edges.map((e) => ({ source: e.source, target: e.target, targetHandle: e.targetHandle }))
        })
      });
      if (!response.ok) return;
      const payload = (await response.json()) as {
        details: WorkflowRun["details"];
        run: WorkflowRun;
        workflowId: string;
        nodeOutputs: Record<string, string>;
      };
      setWorkflowId(payload.workflowId);
      setNodes(
        baseNodes.map((node) => ({
          ...node,
          data: {
            ...node.data,
            output: payload.nodeOutputs[node.id] ?? node.data.output,
            running: false
          }
        }))
      );
      captureSavedGraph();
      addRun(payload.run);
      setPersistHint(null);
    } catch {
      setNodes(baseNodes.map((node) => ({ ...node, data: { ...node.data, running: false } })));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#090b12] text-zinc-100">
      <aside
        className={`soft-panel shrink-0 border-r border-zinc-800/70 transition-[width] duration-200 ease-out ${
          leftOpen ? "w-[286px] p-4" : "w-0 overflow-hidden border-0 p-0"
        }`}
      >
        <div className="mb-4 flex items-center justify-between gap-2">
          <h1 className="text-xl font-semibold tracking-tight">NextFlow</h1>
          <UserButton />
        </div>
        <div className="mb-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={saveWorkflow}
            className="rounded-lg border border-zinc-700 bg-zinc-900/90 px-2 py-1.5 text-xs hover:border-zinc-500"
          >
            Save
            {saveUi === "saving" ? (
              <span className="ml-1 text-zinc-500">…</span>
            ) : saveUi === "saved" ? (
              <span className="ml-1 text-emerald-400/90">✓</span>
            ) : saveUi === "error" ? (
              <span className="ml-1 text-red-400/90">!</span>
            ) : null}
          </button>
          <button
            type="button"
            onClick={() => void execute("full")}
            disabled={running}
            className="rounded-lg border border-violet-500/60 bg-violet-500/20 px-2 py-1.5 text-xs disabled:opacity-50"
          >
            Run Full
          </button>
        </div>
        <div className="mb-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={exportWorkflow}
            className="rounded-lg border border-zinc-700 bg-zinc-900/90 px-2 py-1.5 text-xs hover:border-zinc-500"
          >
            Export JSON
          </button>
          <button
            type="button"
            onClick={() => importRef.current?.click()}
            className="rounded-lg border border-zinc-700 bg-zinc-900/90 px-2 py-1.5 text-xs hover:border-zinc-500"
          >
            Import JSON
          </button>
        </div>
        <input ref={importRef} type="file" accept="application/json,.json" className="hidden" onChange={onImportFile} />
        <div className="mb-3 flex gap-2">
          <button
            type="button"
            onClick={undo}
            className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900/90 px-2 py-1.5 text-xs hover:border-zinc-500"
          >
            Undo
          </button>
          <button
            type="button"
            onClick={redo}
            className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900/90 px-2 py-1.5 text-xs hover:border-zinc-500"
          >
            Redo
          </button>
        </div>
        <p className="mb-4 text-[10px] leading-snug text-zinc-500" suppressHydrationWarning>
          Shortcuts: Cmd/Ctrl+Z undo · Cmd/Ctrl+Shift+Z redo · click a purple edge, then Delete or Backspace
        </p>
        <div className="mb-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => void execute(selectedNodeIds.length === 1 ? "single" : "partial")}
            disabled={running || selectedNodeIds.length === 0}
            className="rounded-lg border border-zinc-700 bg-zinc-900/90 px-2 py-1.5 text-xs disabled:opacity-50"
          >
            Run Selected
          </button>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-2 py-1.5 text-[11px] text-zinc-400">
            {selectedNodeIds.length} selected
          </div>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-zinc-500" />
          <input
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900/90 px-8 py-2 text-sm outline-none focus:border-violet-500/70"
            placeholder="Search nodes..."
          />
        </div>
        <p className="mb-2 mt-4 text-xs uppercase tracking-wider text-zinc-400">Quick Access</p>
        <div className="krea-scroll max-h-[calc(100vh-150px)] space-y-2 overflow-y-auto pr-1">
          {quickAccess.map((item) => (
            <button
              key={item.type}
              type="button"
              onClick={() =>
                addNode({
                  id: `${item.type}-${crypto.randomUUID()}`,
                  type: item.type,
                  position: { x: 340 + Math.random() * 220, y: 120 + Math.random() * 360 },
                  data: { label: item.label }
                })
              }
              className="flex w-full items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900/90 px-3 py-2 text-left text-sm transition hover:border-violet-500/60 hover:bg-zinc-800 active:scale-[0.99]"
            >
              <item.icon className="h-4 w-4 text-violet-400" />
              {item.label}
            </button>
          ))}
        </div>
      </aside>
      <button
        type="button"
        title={leftOpen ? "Collapse sidebar" : "Expand sidebar"}
        onClick={() => setLeftOpen((o) => !o)}
        className="soft-panel z-20 flex h-10 w-7 shrink-0 items-center justify-center border-y border-r border-zinc-800/70 bg-[#11131c] text-zinc-400 hover:text-zinc-100"
      >
        {leftOpen ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>
      <main className="relative flex-1 krea-grid">
        <ReactFlow
          colorMode="dark"
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          proOptions={{ hideAttribution: true }}
          defaultEdgeOptions={{
            animated: true,
            style: { stroke: WORKFLOW_EDGE_COLOR, strokeWidth: 1.8 },
            markerEnd: { type: MarkerType.ArrowClosed, color: WORKFLOW_EDGE_COLOR }
          }}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          isValidConnection={isValidConnection}
          fitView
        >
          <FlowKeyboardShortcuts />
          <Background color="#2c3044" gap={24} size={1.1} />
          <MiniMap
            className="!mb-4 !mr-4 !h-[120px] !w-[180px] !rounded-lg !border !border-zinc-700/70 !bg-[#11131c] !shadow-xl"
            maskColor="rgba(8,9,14,0.72)"
            nodeColor="#272a3f"
            pannable
            position="bottom-right"
            zoomable
          />
          <Controls
            className="!mb-4 !ml-4 !overflow-hidden !rounded-lg !border !border-zinc-700/70 !bg-[#11131c]"
            position="bottom-left"
          />
        </ReactFlow>
      </main>
      <aside className="soft-panel krea-scroll w-[338px] overflow-y-auto border-l border-zinc-800/70 p-4">
        <h2 className="mb-3 text-sm uppercase tracking-wider text-zinc-400">Workflow History</h2>
        {dbMessage ? (
          <p className="mb-3 rounded-md border border-amber-500/35 bg-amber-950/25 px-2 py-2 text-[11px] leading-snug text-amber-100/90">
            {dbMessage}
          </p>
        ) : null}
        {persistHint && !dbMessage ? (
          <p className="mb-3 rounded-md border border-violet-500/30 bg-violet-950/20 px-2 py-2 text-[11px] leading-snug text-violet-200/90">
            {persistHint}
          </p>
        ) : null}
        {persistEnabled && !dbMessage ? (
          <p className="mb-3 text-[11px] text-zinc-500">
            Canvas auto-saves ~1s after edits. Run times below use your <span className="text-zinc-400">local date &amp; time</span> (database stores UTC).
          </p>
        ) : null}
        <div className="space-y-2">
          {runs.length === 0 ? (
            <p className="text-sm text-zinc-500">No runs yet.</p>
          ) : (
            runs.map((run) => (
              <button
                key={run.id}
                type="button"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 p-3 text-left transition hover:border-zinc-500"
                onClick={() => selectRun(run.id)}
              >
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">Run #{run.id.slice(0, 6)}</div>
                  <span className={`rounded border px-1.5 py-0.5 text-[10px] ${statusClass(run.status)}`}>{run.status}</span>
                </div>
                <div className="mt-1 text-xs text-zinc-400">
                  {formatDateTimeForDisplay(run.createdAt)} · {run.scope} · {(run.durationMs / 1000).toFixed(1)}s
                </div>
              </button>
            ))
          )}
        </div>
        {selectedRun && (
          <div className="mt-4 rounded-lg border border-zinc-700 bg-zinc-900/95 p-3">
            <p className="text-sm font-semibold">Run Details</p>
            {selectedRun.details.map((detail) => (
              <div key={detail.nodeId} className="mt-2 border-t border-zinc-800 pt-2 text-xs">
                <p className="font-medium text-zinc-200">
                  {detail.nodeLabel}{" "}
                  <span className="font-normal text-zinc-500">({detail.nodeId})</span>
                </p>
                <p className="text-zinc-400">
                  {detail.status} · {(detail.executionMs / 1000).toFixed(2)}s
                  {detail.error ? <span className="text-red-400"> — {detail.error}</span> : null}
                </p>
                <pre className="mt-1 max-h-32 overflow-auto rounded border border-zinc-800/80 bg-black/40 p-2 text-[10px] leading-snug text-zinc-400">
                  {JSON.stringify(
                    {
                      inputs: detail.inputSnapshot,
                      output: detail.outputSnapshot,
                      error: detail.error
                    },
                    null,
                    2
                  )}
                </pre>
              </div>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}

export function WorkflowBuilder() {
  return (
    <ReactFlowProvider>
      <Builder />
    </ReactFlowProvider>
  );
}
