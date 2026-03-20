import { useEffect, useRef, useState, useCallback } from "react";
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

/** Node color CSS variable names — resolved at render time via getComputedStyle */
const NODE_COLOR_VARS: Record<string, string> = {
  person: "--color-graph-person",
  organization: "--color-graph-org",
  concept: "--color-graph-concept",
  location: "--color-graph-location",
  technology: "--color-graph-tech",
  event: "--color-graph-event",
  document: "--color-graph-doc",
  case: "--color-graph-case",
  physical_object: "--color-graph-object",
  legal_reference: "--color-graph-legal",
  assertion: "--color-graph-assertion",
  default: "--color-graph-default",
};

function resolveNodeColors(): Record<string, string> {
  const style = getComputedStyle(document.documentElement);
  const colors: Record<string, string> = {};
  for (const [type, varName] of Object.entries(NODE_COLOR_VARS)) {
    const val = style.getPropertyValue(varName).trim();
    colors[type] = val ? `rgb(${val})` : "";
  }
  // Fallback defaults when CSS vars are not defined
  if (!colors.person) colors.person = "rgb(59,130,246)";
  if (!colors.organization) colors.organization = "rgb(245,158,11)";
  if (!colors.concept) colors.concept = "rgb(16,185,129)";
  if (!colors.location) colors.location = "rgb(139,92,246)";
  if (!colors.technology) colors.technology = "rgb(239,68,68)";
  if (!colors.event) colors.event = "rgb(6,182,212)";
  if (!colors.document) colors.document = "rgb(107,114,128)";
  if (!colors.case) colors.case = "rgb(249,115,22)";
  if (!colors.physical_object) colors.physical_object = "rgb(132,204,22)";
  if (!colors.legal_reference) colors.legal_reference = "rgb(168,85,247)";
  if (!colors.assertion) colors.assertion = "rgb(236,72,153)";
  if (!colors.default) colors.default = "rgb(156,163,175)";
  return colors;
}

interface GraphCanvasProps {
  workspaceId: string;
  typeFilter: string | null;
  onNodeSelect: (nodeId: string) => void;
}

export function GraphCanvas({ workspaceId, typeFilter, onNodeSelect }: GraphCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ width: 800, height: 600 });

  // ResizeObserver for responsive canvas
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setDims({ width: Math.floor(width), height: Math.floor(height) });
        }
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const { data } = useQuery({
    queryKey: ["graph-data", workspaceId, typeFilter],
    queryFn: async () => {
      const nodesResult = await apiFetch<{ nodes: GraphNode[] }>(
        `/api/v1/workspaces/${workspaceId}/graph/nodes?limit=100${typeFilter ? `&type=${typeFilter}` : ""}`
      );
      if (nodesResult.nodes.length === 0) return { nodes: [], edges: [] };

      // Multi-seed explore: pick up to 10 seeds spread evenly across the node list
      const seeds = nodesResult.nodes;
      const step = Math.max(1, Math.floor(seeds.length / 10));
      const seedIds: string[] = [];
      for (let i = 0; i < seeds.length && seedIds.length < 10; i += step) {
        seedIds.push(seeds[i].node_id);
      }

      const exploreResults = await Promise.all(
        seedIds.map((id) =>
          apiFetch<GraphData>(
            `/api/v1/workspaces/${workspaceId}/graph/explore?node_id=${id}&hops=1&limit=200`
          )
        )
      );

      // Union + deduplicate
      const nodeMap = new Map<string, GraphNode>();
      const edgeSet = new Set<string>();
      const edges: GraphEdge[] = [];

      for (const result of exploreResults) {
        for (const node of result.nodes) {
          nodeMap.set(node.node_id, node);
        }
        for (const edge of result.edges) {
          const key = `${edge.source}-${edge.target}-${edge.edge_type}`;
          if (!edgeSet.has(key)) {
            edgeSet.add(key);
            edges.push(edge);
          }
        }
      }

      return { nodes: Array.from(nodeMap.values()), edges };
    },
    enabled: !!workspaceId,
  });

  const handleClick = useCallback(
    (e: MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas || !data) return;
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (canvas.width / rect.width);
      const y = (e.clientY - rect.top) * (canvas.height / rect.height);

      // Access stored positions from the canvas dataset
      const positionsJson = canvas.dataset.positions;
      if (!positionsJson) return;
      const positions: Record<string, { x: number; y: number }> = JSON.parse(positionsJson);

      for (const node of data.nodes) {
        const pos = positions[node.node_id];
        if (!pos) continue;
        const dx = x - pos.x;
        const dy = y - pos.y;
        if (dx * dx + dy * dy < 100) {
          onNodeSelect(node.node_id);
          return;
        }
      }
    },
    [data, onNodeSelect]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener("click", handleClick);
    return () => canvas.removeEventListener("click", handleClick);
  }, [handleClick]);

  useEffect(() => {
    if (!data || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = dims.width;
    canvas.height = dims.height;

    // Resolve theme colors from CSS variables
    const computedStyle = getComputedStyle(document.documentElement);
    const textColorVar = computedStyle.getPropertyValue("--color-text").trim();
    const borderColorVar = computedStyle.getPropertyValue("--color-border").trim();
    const surfaceColorVar = computedStyle.getPropertyValue("--color-surface").trim();

    const textColor = textColorVar ? `rgb(${textColorVar})` : "rgb(55,65,81)";
    const edgeColor = borderColorVar ? `rgb(${borderColorVar})` : "rgb(229,231,235)";
    const outlineColor = surfaceColorVar ? `rgb(${surfaceColorVar})` : "rgb(255,255,255)";
    const nodeColors = resolveNodeColors();

    // Simple force-directed layout simulation
    const positions = new Map<string, { x: number; y: number; vx: number; vy: number }>();

    data.nodes.forEach((node, i) => {
      const angle = (2 * Math.PI * i) / data.nodes.length;
      const radius = Math.min(canvas.width, canvas.height) * 0.3;
      positions.set(node.node_id, {
        x: canvas.width / 2 + Math.cos(angle) * radius + (Math.random() - 0.5) * 50,
        y: canvas.height / 2 + Math.sin(angle) * radius + (Math.random() - 0.5) * 50,
        vx: 0,
        vy: 0,
      });
    });

    // Run force simulation iterations
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
        if (dist === 0) continue;
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
        pos.x = Math.max(40, Math.min(canvas.width - 40, pos.x));
        pos.y = Math.max(40, Math.min(canvas.height - 40, pos.y));
      }
    }

    // Store positions for click handler
    const posObj: Record<string, { x: number; y: number }> = {};
    for (const [id, pos] of positions) {
      posObj[id] = { x: pos.x, y: pos.y };
    }
    canvas.dataset.positions = JSON.stringify(posObj);

    // Draw
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw edges
    ctx.strokeStyle = edgeColor;
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
      const color = nodeColors[node.node_type] || nodeColors.default;

      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 8, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = outlineColor;
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.font = "11px sans-serif";
      ctx.fillStyle = textColor;
      ctx.textAlign = "center";
      ctx.fillText(node.name.slice(0, 20), pos.x, pos.y + 20);
    }
  }, [data, dims]);

  return (
    <div ref={containerRef} className="w-full h-full">
      <canvas ref={canvasRef} className="w-full h-full cursor-pointer" />
    </div>
  );
}
