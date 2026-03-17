import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

interface GraphNode {
  node_id: string;
  name: string;
  node_type: string;
  description: string;
}

interface GraphEdge {
  source: string;
  target: string;
  edge_type: string;
  weight: number;
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const NODE_COLORS: Record<string, string> = {
  person: "#3b82f6",
  org: "#f59e0b",
  concept: "#10b981",
  location: "#8b5cf6",
  technology: "#ef4444",
  event: "#06b6d4",
  document: "#6b7280",
  default: "#9ca3af",
};

interface GraphCanvasProps {
  workspaceId: string;
  typeFilter: string | null;
  onNodeSelect: (nodeId: string) => void;
}

export function GraphCanvas({ workspaceId, typeFilter, onNodeSelect }: GraphCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const { data } = useQuery({
    queryKey: ["graph-data", workspaceId, typeFilter],
    queryFn: async () => {
      const nodesResult = await apiFetch<{ nodes: GraphNode[] }>(
        `/api/v1/workspaces/${workspaceId}/graph/nodes?limit=100${typeFilter ? `&type=${typeFilter}` : ""}`
      );
      if (nodesResult.nodes.length === 0) return { nodes: [], edges: [] };

      // Get edges for all fetched nodes
      const firstNodeId = nodesResult.nodes[0].node_id;
      const exploreResult = await apiFetch<GraphData>(
        `/api/v1/workspaces/${workspaceId}/graph/explore?node_id=${firstNodeId}&hops=2&limit=200`
      );
      return exploreResult;
    },
    enabled: !!workspaceId,
  });

  useEffect(() => {
    if (!data || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.parentElement?.getBoundingClientRect();
    canvas.width = rect?.width || 800;
    canvas.height = rect?.height || 600;

    // Simple force-directed layout simulation
    const positions = new Map<string, { x: number; y: number; vx: number; vy: number }>();

    data.nodes.forEach((node, i) => {
      const angle = (2 * Math.PI * i) / data.nodes.length;
      const radius = Math.min(canvas.width, canvas.height) * 0.3;
      positions.set(node.node_id, {
        x: canvas.width / 2 + Math.cos(angle) * radius + (Math.random() - 0.5) * 50,
        y: canvas.height / 2 + Math.sin(angle) * radius + (Math.random() - 0.5) * 50,
        vx: 0, vy: 0,
      });
    });

    // Run a few iterations of force simulation
    for (let iter = 0; iter < 100; iter++) {
      // Repulsion between all nodes
      for (const [id1, p1] of positions) {
        for (const [id2, p2] of positions) {
          if (id1 >= id2) continue;
          const dx = p2.x - p1.x;
          const dy = p2.y - p1.y;
          const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
          const force = 5000 / (dist * dist);
          p1.vx -= (dx / dist) * force;
          p1.vy -= (dy / dist) * force;
          p2.vx += (dx / dist) * force;
          p2.vy += (dy / dist) * force;
        }
      }

      // Attraction along edges
      for (const edge of data.edges) {
        const p1 = positions.get(edge.source);
        const p2 = positions.get(edge.target);
        if (!p1 || !p2) continue;
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const force = (dist - 100) * 0.01;
        p1.vx += (dx / dist) * force;
        p1.vy += (dy / dist) * force;
        p2.vx -= (dx / dist) * force;
        p2.vy -= (dy / dist) * force;
      }

      // Apply velocities with damping
      for (const [, pos] of positions) {
        pos.x += pos.vx * 0.1;
        pos.y += pos.vy * 0.1;
        pos.vx *= 0.9;
        pos.vy *= 0.9;
        // Keep in bounds
        pos.x = Math.max(40, Math.min(canvas.width - 40, pos.x));
        pos.y = Math.max(40, Math.min(canvas.height - 40, pos.y));
      }
    }

    // Draw
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw edges
    ctx.strokeStyle = "#e5e7eb";
    ctx.lineWidth = 1;
    for (const edge of data.edges) {
      const p1 = positions.get(edge.source);
      const p2 = positions.get(edge.target);
      if (!p1 || !p2) continue;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }

    // Draw nodes
    for (const node of data.nodes) {
      const pos = positions.get(node.node_id);
      if (!pos) continue;
      const color = NODE_COLORS[node.node_type] || NODE_COLORS.default;

      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 8, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.font = "11px sans-serif";
      ctx.fillStyle = "#374151";
      ctx.textAlign = "center";
      ctx.fillText(node.name.slice(0, 20), pos.x, pos.y + 20);
    }

    // Handle click
    const handleClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      for (const node of data.nodes) {
        const pos = positions.get(node.node_id);
        if (!pos) continue;
        const dx = x - pos.x;
        const dy = y - pos.y;
        if (dx * dx + dy * dy < 100) {
          onNodeSelect(node.node_id);
          return;
        }
      }
    };

    canvas.addEventListener("click", handleClick);
    return () => canvas.removeEventListener("click", handleClick);
  }, [data, onNodeSelect]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full cursor-pointer"
    />
  );
}
