import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiPatch } from "@/lib/api";
import { Plus, Trash2, Save, Loader2 } from "lucide-react";

interface NodeType {
  type: string;
  label: string;
  color?: string;
}

interface EdgeType {
  type: string;
  label: string;
  directed: boolean;
}

interface KgOntology {
  nodeTypes: NodeType[];
  edgeTypes: EdgeType[];
}

interface WorkspaceDetail {
  workspace_id: string;
  name: string;
  settings: {
    kgOntology?: KgOntology;
  } | null;
}

const PRESET_ONTOLOGIES: Record<string, KgOntology> = {
  generic: {
    nodeTypes: [
      { type: "person", label: "Person", color: "#3b82f6" },
      { type: "organization", label: "Organization", color: "#8b5cf6" },
      { type: "concept", label: "Concept", color: "#06b6d4" },
      { type: "location", label: "Location", color: "#10b981" },
      { type: "date", label: "Date", color: "#f59e0b" },
      { type: "event", label: "Event", color: "#ef4444" },
      { type: "technology", label: "Technology", color: "#6366f1" },
      { type: "document", label: "Document", color: "#78716c" },
    ],
    edgeTypes: [
      { type: "related_to", label: "Related To", directed: true },
      { type: "part_of", label: "Part Of", directed: true },
      { type: "created_by", label: "Created By", directed: true },
      { type: "located_in", label: "Located In", directed: true },
      { type: "uses", label: "Uses", directed: true },
      { type: "references", label: "References", directed: true },
    ],
  },
  medical: {
    nodeTypes: [
      { type: "disease", label: "Disease/Condition", color: "#ef4444" },
      { type: "symptom", label: "Symptom", color: "#f97316" },
      { type: "drug", label: "Drug/Medication", color: "#3b82f6" },
      { type: "procedure", label: "Procedure", color: "#8b5cf6" },
      { type: "anatomy", label: "Anatomy", color: "#10b981" },
      { type: "gene", label: "Gene/Protein", color: "#06b6d4" },
      { type: "organism", label: "Organism", color: "#84cc16" },
      { type: "study", label: "Study/Trial", color: "#78716c" },
    ],
    edgeTypes: [
      { type: "treats", label: "Treats", directed: true },
      { type: "causes", label: "Causes", directed: true },
      { type: "presents_with", label: "Presents With", directed: true },
      { type: "interacts_with", label: "Interacts With", directed: false },
      { type: "located_in", label: "Located In", directed: true },
      { type: "associated_with", label: "Associated With", directed: false },
      { type: "inhibits", label: "Inhibits", directed: true },
      { type: "activates", label: "Activates", directed: true },
    ],
  },
  legal: {
    nodeTypes: [
      { type: "statute", label: "Statute/Law", color: "#3b82f6" },
      { type: "case", label: "Case", color: "#8b5cf6" },
      { type: "party", label: "Party", color: "#10b981" },
      { type: "court", label: "Court", color: "#f59e0b" },
      { type: "judge", label: "Judge", color: "#06b6d4" },
      { type: "legal_concept", label: "Legal Concept", color: "#ef4444" },
      { type: "jurisdiction", label: "Jurisdiction", color: "#78716c" },
      { type: "evidence", label: "Evidence", color: "#6366f1" },
    ],
    edgeTypes: [
      { type: "cites", label: "Cites", directed: true },
      { type: "overrules", label: "Overrules", directed: true },
      { type: "amends", label: "Amends", directed: true },
      { type: "applies_to", label: "Applies To", directed: true },
      { type: "party_in", label: "Party In", directed: true },
      { type: "decided_by", label: "Decided By", directed: true },
      { type: "governed_by", label: "Governed By", directed: true },
    ],
  },
  engineering: {
    nodeTypes: [
      { type: "component", label: "Component", color: "#3b82f6" },
      { type: "system", label: "System", color: "#8b5cf6" },
      { type: "specification", label: "Specification", color: "#06b6d4" },
      { type: "material", label: "Material", color: "#10b981" },
      { type: "standard", label: "Standard", color: "#f59e0b" },
      { type: "failure_mode", label: "Failure Mode", color: "#ef4444" },
      { type: "test", label: "Test", color: "#6366f1" },
      { type: "requirement", label: "Requirement", color: "#78716c" },
    ],
    edgeTypes: [
      { type: "part_of", label: "Part Of", directed: true },
      { type: "depends_on", label: "Depends On", directed: true },
      { type: "satisfies", label: "Satisfies", directed: true },
      { type: "tested_by", label: "Tested By", directed: true },
      { type: "made_of", label: "Made Of", directed: true },
      { type: "conforms_to", label: "Conforms To", directed: true },
      { type: "causes", label: "Causes", directed: true },
    ],
  },
};

export function WorkspaceSettings({ workspaceId }: { workspaceId: string }) {
  const qc = useQueryClient();

  const { data: workspace, isLoading } = useQuery({
    queryKey: ["workspace", workspaceId],
    queryFn: () => apiFetch<WorkspaceDetail>(`/api/v1/workspaces/${workspaceId}`),
    enabled: !!workspaceId,
  });

  const currentOntology = workspace?.settings?.kgOntology;

  const [nodeTypes, setNodeTypes] = useState<NodeType[]>([]);
  const [edgeTypes, setEdgeTypes] = useState<EdgeType[]>([]);
  const [initialized, setInitialized] = useState(false);

  // Initialize from workspace data once loaded
  if (workspace && !initialized) {
    setNodeTypes(currentOntology?.nodeTypes || PRESET_ONTOLOGIES.generic.nodeTypes);
    setEdgeTypes(currentOntology?.edgeTypes || PRESET_ONTOLOGIES.generic.edgeTypes);
    setInitialized(true);
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      apiPatch(`/api/v1/workspaces/${workspaceId}`, {
        settings: { kgOntology: { nodeTypes, edgeTypes } },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workspace", workspaceId] });
    },
  });

  const applyPreset = (preset: string) => {
    const ontology = PRESET_ONTOLOGIES[preset];
    if (ontology) {
      setNodeTypes([...ontology.nodeTypes]);
      setEdgeTypes([...ontology.edgeTypes]);
    }
  };

  const addNodeType = () => {
    setNodeTypes([...nodeTypes, { type: "", label: "", color: "#6b7280" }]);
  };

  const removeNodeType = (index: number) => {
    setNodeTypes(nodeTypes.filter((_, i) => i !== index));
  };

  const updateNodeType = (index: number, field: keyof NodeType, value: string) => {
    const updated = [...nodeTypes];
    updated[index] = { ...updated[index], [field]: value };
    if (field === "label" && !updated[index].type) {
      updated[index].type = value.toLowerCase().replace(/[^a-z0-9]/g, "_");
    }
    setNodeTypes(updated);
  };

  const addEdgeType = () => {
    setEdgeTypes([...edgeTypes, { type: "", label: "", directed: true }]);
  };

  const removeEdgeType = (index: number) => {
    setEdgeTypes(edgeTypes.filter((_, i) => i !== index));
  };

  const updateEdgeType = (index: number, field: keyof EdgeType, value: string | boolean) => {
    const updated = [...edgeTypes];
    updated[index] = { ...updated[index], [field]: value };
    if (field === "label" && !updated[index].type) {
      updated[index].type = (value as string).toLowerCase().replace(/[^a-z0-9]/g, "_");
    }
    setEdgeTypes(updated);
  };

  if (isLoading || !initialized) {
    return <div className="flex justify-center py-8"><Loader2 className="animate-spin text-gray-400" /></div>;
  }

  return (
    <div className="space-y-6">
      {/* Preset selector */}
      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-2">Load Preset Ontology</h4>
        <div className="flex gap-2 flex-wrap">
          {Object.keys(PRESET_ONTOLOGIES).map((preset) => (
            <button
              key={preset}
              onClick={() => applyPreset(preset)}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 capitalize"
            >
              {preset}
            </button>
          ))}
        </div>
      </div>

      {/* Node types */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-semibold text-gray-700">Entity Types ({nodeTypes.length})</h4>
          <button onClick={addNodeType} className="flex items-center gap-1 text-sm text-primary-600 hover:text-primary-700">
            <Plus size={14} /> Add
          </button>
        </div>
        <div className="space-y-2">
          {nodeTypes.map((nt, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="color"
                value={nt.color || "#6b7280"}
                onChange={(e) => updateNodeType(i, "color", e.target.value)}
                className="w-8 h-8 rounded border border-gray-200 cursor-pointer"
              />
              <input
                type="text"
                value={nt.label}
                onChange={(e) => updateNodeType(i, "label", e.target.value)}
                placeholder="Label (e.g. Disease)"
                className="flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg"
              />
              <input
                type="text"
                value={nt.type}
                onChange={(e) => updateNodeType(i, "type", e.target.value)}
                placeholder="type_key"
                className="w-36 px-3 py-1.5 text-sm border border-gray-200 rounded-lg font-mono text-xs"
              />
              <button onClick={() => removeNodeType(i)} className="p-1.5 text-gray-400 hover:text-red-500">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Edge types */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-semibold text-gray-700">Relationship Types ({edgeTypes.length})</h4>
          <button onClick={addEdgeType} className="flex items-center gap-1 text-sm text-primary-600 hover:text-primary-700">
            <Plus size={14} /> Add
          </button>
        </div>
        <div className="space-y-2">
          {edgeTypes.map((et, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="text"
                value={et.label}
                onChange={(e) => updateEdgeType(i, "label", e.target.value)}
                placeholder="Label (e.g. Treats)"
                className="flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg"
              />
              <input
                type="text"
                value={et.type}
                onChange={(e) => updateEdgeType(i, "type", e.target.value)}
                placeholder="type_key"
                className="w-36 px-3 py-1.5 text-sm border border-gray-200 rounded-lg font-mono text-xs"
              />
              <label className="flex items-center gap-1 text-xs text-gray-500 whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={et.directed}
                  onChange={(e) => updateEdgeType(i, "directed", e.target.checked)}
                  className="rounded"
                />
                Directed
              </label>
              <button onClick={() => removeEdgeType(i)} className="p-1.5 text-gray-400 hover:text-red-500">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Save */}
      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 text-sm font-medium"
        >
          {saveMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Save Ontology
        </button>
        {saveMutation.isSuccess && (
          <span className="text-sm text-green-600">Saved! New documents will use this ontology.</span>
        )}
        {saveMutation.isError && (
          <span className="text-sm text-red-600">Failed to save</span>
        )}
      </div>

      <p className="text-xs text-gray-400">
        Changes only affect documents ingested after saving. To re-extract existing documents,
        delete and re-upload them.
      </p>
    </div>
  );
}
