import type { WorkflowEdge, WorkflowNode } from "@/types/workflow";
import { WORKFLOW_EDGE_COLOR } from "@/types/workflow";

export const sampleNodes: WorkflowNode[] = [
  {
    id: "text-system-1",
    type: "text",
    position: { x: 80, y: 80 },
    data: {
      label: "System Prompt A",
      values: {
        text: "You are a professional marketing copywriter. Generate a compelling one-paragraph product description."
      }
    }
  },
  {
    id: "text-user-1",
    type: "text",
    position: { x: 80, y: 250 },
    data: {
      label: "Product Details",
      values: {
        text: "Product: Wireless Bluetooth Headphones. Features: Noise cancellation, 30-hour battery, foldable design."
      }
    }
  },
  {
    id: "upload-image",
    type: "uploadImage",
    position: { x: 80, y: 430 },
    data: { label: "Upload Image" }
  },
  {
    id: "crop-image",
    type: "cropImage",
    position: { x: 390, y: 430 },
    data: {
      label: "Crop Image",
      values: { x_percent: "10", y_percent: "10", width_percent: "80", height_percent: "80" }
    }
  },
  {
    id: "llm-1",
    type: "runAnyLlm",
    position: { x: 700, y: 220 },
    data: { label: "Run Any LLM #1", values: { model: "gemini-2.5-flash" } }
  },
  {
    id: "upload-video",
    type: "uploadVideo",
    position: { x: 80, y: 650 },
    data: { label: "Upload Video" }
  },
  {
    id: "extract-frame",
    type: "extractFrame",
    position: { x: 390, y: 650 },
    data: { label: "Extract Frame", values: { timestamp: "50%" } }
  },
  {
    id: "text-system-2",
    type: "text",
    position: { x: 700, y: 500 },
    data: {
      label: "System Prompt B",
      values: {
        text: "You are a social media manager. Create a tweet-length marketing post based on the product image and video frame."
      }
    }
  },
  {
    id: "llm-2",
    type: "runAnyLlm",
    position: { x: 1040, y: 370 },
    data: { label: "Final Marketing Summary", values: { model: "gemini-2.5-flash" } }
  }
];

const edgeStyle = { stroke: WORKFLOW_EDGE_COLOR, strokeWidth: 1.8 as const };

export const sampleEdges: WorkflowEdge[] = [
  { id: "e1", source: "text-system-1", target: "llm-1", targetHandle: "system_prompt", animated: true, style: edgeStyle },
  { id: "e2", source: "text-user-1", target: "llm-1", targetHandle: "user_message", animated: true, style: edgeStyle },
  { id: "e3", source: "upload-image", target: "crop-image", targetHandle: "image_url", animated: true, style: edgeStyle },
  { id: "e4", source: "crop-image", target: "llm-1", targetHandle: "images", animated: true, style: edgeStyle },
  { id: "e5", source: "upload-video", target: "extract-frame", targetHandle: "video_url", animated: true, style: edgeStyle },
  { id: "e6", source: "text-system-2", target: "llm-2", targetHandle: "system_prompt", animated: true, style: edgeStyle },
  { id: "e7", source: "llm-1", target: "llm-2", targetHandle: "user_message", animated: true, style: edgeStyle },
  { id: "e8", source: "crop-image", target: "llm-2", targetHandle: "images", animated: true, style: edgeStyle },
  { id: "e9", source: "extract-frame", target: "llm-2", targetHandle: "images", animated: true, style: edgeStyle }
];
