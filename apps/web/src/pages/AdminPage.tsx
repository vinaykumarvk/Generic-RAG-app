import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiPost, apiPatch } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useParams } from "react-router-dom";
import { UserManagement } from "@/components/admin/UserManagement";
import { IngestionMonitor } from "@/components/admin/IngestionMonitor";
import { GraphStatsCard } from "@/components/admin/GraphStatsCard";
import {
  Settings, Zap, CheckCircle, XCircle, Loader2,
  Users, FileText, Database, Share2, Plus, Pencil, X,
} from "lucide-react";

const USE_CASE_OPTIONS = [
  "KG_EXTRACTION", "EMBEDDING", "CHUNK_SUMMARY", "QUERY_EXPANSION",
  "ENTITY_DETECTION", "RERANK", "ANSWER_GENERATION", "ANSWER_REGENERATION", "DOCUMENT_CLASSIFY",
  "OCR_CORRECTION", "GENERAL",
] as const;

const PROVIDER_TYPES = ["openai", "claude", "gemini", "ollama"] as const;

interface LlmProviderConfig {
  config_id: string;
  provider: string;
  display_name: string;
  api_base_url: string;
  model_id: string;
  is_active: boolean;
  is_default: boolean;
  max_tokens: number;
  temperature: number;
  config_jsonb?: { assigned_use_cases?: string[]; input_cost_per_million?: number; output_cost_per_million?: number };
}

interface ProviderFormData {
  provider: string;
  displayName: string;
  apiBaseUrl: string;
  apiKeyEnc: string;
  modelId: string;
  isActive: boolean;
  isDefault: boolean;
  maxTokens: number;
  temperature: number;
  assignedUseCases: string[];
  inputCostPerMillion: number | null;
  outputCostPerMillion: number | null;
}

type AdminTab = "users" | "ingestion" | "graph" | "settings" | "providers";

export function AdminPage() {
  const { isAdmin } = useAuth();
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const [activeTab, setActiveTab] = useState<AdminTab>("users");
  const qc = useQueryClient();

  const { data: providers, isLoading } = useQuery({
    queryKey: ["llm-providers"],
    queryFn: () => apiFetch<{ providers: LlmProviderConfig[] }>("/api/v1/assistant/llm/providers").then((r) => r.providers),
    enabled: isAdmin && activeTab === "providers",
  });

  const testMutation = useMutation({
    mutationFn: (p: LlmProviderConfig) =>
      apiPost<{ success: boolean; latencyMs: number; error?: string }>("/api/v1/assistant/llm/test", {
        provider: p.provider, apiBaseUrl: p.api_base_url, apiKeyEnc: p.api_base_url, modelId: p.model_id,
      }),
  });

  const createMutation = useMutation({
    mutationFn: (data: ProviderFormData) => apiPost<{ provider: LlmProviderConfig }>("/api/v1/assistant/llm/providers", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["llm-providers"] }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<ProviderFormData> }) =>
      apiPatch<{ provider: LlmProviderConfig }>(`/api/v1/assistant/llm/providers/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["llm-providers"] }),
  });

  const [testResults, setTestResults] = useState<Record<string, { success: boolean; latencyMs: number; error?: string }>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const handleTest = async (p: LlmProviderConfig) => {
    try {
      const result = await testMutation.mutateAsync(p);
      setTestResults((prev) => ({ ...prev, [p.config_id]: result }));
    } catch {
      setTestResults((prev) => ({ ...prev, [p.config_id]: { success: false, latencyMs: 0, error: "Test failed" } }));
    }
  };

  if (!isAdmin) {
    return <div className="text-center py-12 text-text-secondary">Admin access required</div>;
  }

  const tabs: { key: AdminTab; label: string; icon: React.ReactNode }[] = [
    { key: "users", label: "Users", icon: <Users size={16} aria-hidden="true" /> },
    { key: "ingestion", label: "Ingestion", icon: <FileText size={16} aria-hidden="true" /> },
    { key: "graph", label: "Graph", icon: <Share2 size={16} aria-hidden="true" /> },
    { key: "settings", label: "Settings", icon: <Database size={16} aria-hidden="true" /> },
    { key: "providers", label: "LLM Providers", icon: <Zap size={16} aria-hidden="true" /> },
  ];

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-text-primary flex items-center gap-2">
          <Settings size={24} aria-hidden="true" />
          Administration
        </h2>
        <p className="text-text-secondary text-sm mt-1">Manage users, ingestion, and system configuration</p>
      </div>

      {/* Tab navigation */}
      <div className="flex gap-1 border-b border-border-primary mb-6" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === tab.key
                ? "border-primary-600 text-primary-600"
                : "border-transparent text-text-secondary hover:text-text-primary hover:border-border-primary"
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "users" && <UserManagement />}

      {activeTab === "ingestion" && workspaceId && (
        <IngestionMonitor workspaceId={workspaceId} />
      )}
      {activeTab === "ingestion" && !workspaceId && (
        <p className="text-text-secondary text-sm text-center py-8">Select a workspace to view ingestion status</p>
      )}

      {activeTab === "graph" && workspaceId && (
        <GraphStatsCard workspaceId={workspaceId} />
      )}
      {activeTab === "graph" && !workspaceId && (
        <p className="text-text-secondary text-sm text-center py-8">Select a workspace to view graph statistics</p>
      )}

      {activeTab === "settings" && (
        <div className="bg-surface-primary border border-border-primary rounded-xl p-6">
          <h3 className="font-semibold text-lg mb-4 flex items-center gap-2 text-text-primary">
            <Database size={18} className="text-primary-500" aria-hidden="true" />
            System Settings
          </h3>
          <SystemSettingsPanel />
        </div>
      )}

      {activeTab === "providers" && (
        <div className="bg-surface-primary border border-border-primary rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-lg flex items-center gap-2 text-text-primary">
              <Zap size={18} className="text-warning" aria-hidden="true" />
              LLM Providers
            </h3>
            <button
              type="button"
              onClick={() => { setShowCreate(true); setEditingId(null); }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700"
            >
              <Plus size={14} aria-hidden="true" /> Add Provider
            </button>
          </div>

          {showCreate && (
            <ProviderForm
              onSubmit={async (data) => { await createMutation.mutateAsync(data); setShowCreate(false); }}
              onCancel={() => setShowCreate(false)}
              isSubmitting={createMutation.isPending}
            />
          )}

          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="animate-spin text-text-tertiary" /></div>
          ) : (
            <div className="space-y-3">
              {providers?.map((p) => (
                <div key={p.config_id}>
                  {editingId === p.config_id ? (
                    <ProviderForm
                      initial={p}
                      onSubmit={async (data) => { await updateMutation.mutateAsync({ id: p.config_id, data }); setEditingId(null); }}
                      onCancel={() => setEditingId(null)}
                      isSubmitting={updateMutation.isPending}
                    />
                  ) : (
                    <div className="flex items-center justify-between p-4 border border-border-primary rounded-lg">
                      <div className="flex items-center gap-4">
                        <div>
                          <div className="font-medium text-text-primary">{p.display_name}</div>
                          <div className="text-sm text-text-secondary">
                            {p.provider} / {p.model_id} — {p.api_base_url}
                          </div>
                        </div>
                        <div className="flex gap-2 flex-wrap">
                          {p.is_active && <span className="text-xs badge-success px-2 py-0.5 rounded">Active</span>}
                          {p.is_default && <span className="text-xs badge-brand px-2 py-0.5 rounded">Default</span>}
                          {p.config_jsonb?.assigned_use_cases?.map((uc) => (
                            <span key={uc} className="text-xs bg-surface-alt text-skin-accent px-2 py-0.5 rounded">
                              {uc.replace(/_/g, " ")}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {testResults[p.config_id] && (
                          <span className={`flex items-center gap-1 text-sm ${testResults[p.config_id].success ? "text-success" : "text-danger"}`}>
                            {testResults[p.config_id].success
                              ? <><CheckCircle size={14} aria-hidden="true" /> {testResults[p.config_id].latencyMs}ms</>
                              : <><XCircle size={14} aria-hidden="true" /> {testResults[p.config_id].error}</>}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => handleTest(p)}
                          disabled={testMutation.isPending}
                          className="px-3 py-1.5 text-sm border border-border-primary rounded-lg hover:bg-surface-secondary disabled:opacity-50 text-text-secondary"
                        >
                          Test
                        </button>
                        <button
                          type="button"
                          onClick={() => { setEditingId(p.config_id); setShowCreate(false); }}
                          className="px-3 py-1.5 text-sm border border-border-primary rounded-lg hover:bg-surface-secondary text-text-secondary"
                          aria-label={`Edit ${p.display_name}`}
                        >
                          <Pencil size={14} aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {providers?.length === 0 && !showCreate && (
                <p className="text-center py-8 text-text-tertiary">No LLM providers configured</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ProviderForm({
  initial,
  onSubmit,
  onCancel,
  isSubmitting,
}: {
  initial?: LlmProviderConfig;
  onSubmit: (data: ProviderFormData) => Promise<void>;
  onCancel: () => void;
  isSubmitting: boolean;
}) {
  const [form, setForm] = useState<ProviderFormData>({
    provider: initial?.provider || "openai",
    displayName: initial?.display_name || "",
    apiBaseUrl: initial?.api_base_url || "",
    apiKeyEnc: "",
    modelId: initial?.model_id || "",
    isActive: initial?.is_active ?? true,
    isDefault: initial?.is_default ?? false,
    maxTokens: initial?.max_tokens ?? 2048,
    temperature: initial?.temperature ?? 0.3,
    assignedUseCases: initial?.config_jsonb?.assigned_use_cases || [],
    inputCostPerMillion: initial?.config_jsonb?.input_cost_per_million ?? null,
    outputCostPerMillion: initial?.config_jsonb?.output_cost_per_million ?? null,
  });

  const set = (field: keyof ProviderFormData, value: unknown) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const toggleUseCase = (uc: string) => {
    setForm((prev) => ({
      ...prev,
      assignedUseCases: prev.assignedUseCases.includes(uc)
        ? prev.assignedUseCases.filter((u) => u !== uc)
        : [...prev.assignedUseCases, uc],
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const data = { ...form };
    // Don't send empty apiKeyEnc on edit (preserve existing)
    if (initial && !data.apiKeyEnc) {
      const { apiKeyEnc: _, ...rest } = data;
      onSubmit(rest as ProviderFormData);
    } else {
      onSubmit(data);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="p-4 mb-4 border border-border-primary rounded-lg bg-surface-secondary space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="font-medium text-text-primary">{initial ? "Edit Provider" : "Add Provider"}</h4>
        <button type="button" onClick={onCancel} aria-label="Cancel" className="text-text-tertiary hover:text-text-primary">
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-sm text-text-secondary">Provider Type</span>
          <select
            value={form.provider}
            onChange={(e) => set("provider", e.target.value)}
            className="mt-1 block w-full px-3 py-2 bg-surface-primary border border-border-primary rounded-lg text-text-primary text-sm"
          >
            {PROVIDER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>

        <label className="block">
          <span className="text-sm text-text-secondary">Display Name</span>
          <input
            type="text"
            required
            value={form.displayName}
            onChange={(e) => set("displayName", e.target.value)}
            className="mt-1 block w-full px-3 py-2 bg-surface-primary border border-border-primary rounded-lg text-text-primary text-sm"
          />
        </label>

        <label className="block">
          <span className="text-sm text-text-secondary">API Base URL</span>
          <input
            type="text"
            required={!initial}
            value={form.apiBaseUrl}
            onChange={(e) => set("apiBaseUrl", e.target.value)}
            className="mt-1 block w-full px-3 py-2 bg-surface-primary border border-border-primary rounded-lg text-text-primary text-sm"
          />
        </label>

        <label className="block">
          <span className="text-sm text-text-secondary">API Key {initial ? "(leave blank to keep)" : ""}</span>
          <input
            type="password"
            value={form.apiKeyEnc}
            onChange={(e) => set("apiKeyEnc", e.target.value)}
            className="mt-1 block w-full px-3 py-2 bg-surface-primary border border-border-primary rounded-lg text-text-primary text-sm"
          />
        </label>

        <label className="block">
          <span className="text-sm text-text-secondary">Model ID</span>
          <input
            type="text"
            required={!initial}
            value={form.modelId}
            onChange={(e) => set("modelId", e.target.value)}
            className="mt-1 block w-full px-3 py-2 bg-surface-primary border border-border-primary rounded-lg text-text-primary text-sm"
          />
        </label>

        <div className="flex items-center gap-6 pt-5">
          <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
            <input type="checkbox" checked={form.isActive} onChange={(e) => set("isActive", e.target.checked)} />
            Active
          </label>
          <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
            <input type="checkbox" checked={form.isDefault} onChange={(e) => set("isDefault", e.target.checked)} />
            Default
          </label>
        </div>

        <label className="block">
          <span className="text-sm text-text-secondary">Input cost ($/1M tokens)</span>
          <input
            type="number"
            step="0.001"
            min="0"
            value={form.inputCostPerMillion ?? ""}
            onChange={(e) => set("inputCostPerMillion", e.target.value ? Number(e.target.value) : null)}
            placeholder="e.g. 0.1625"
            className="mt-1 block w-full px-3 py-2 bg-surface-primary border border-border-primary rounded-lg text-text-primary text-sm"
          />
        </label>

        <label className="block">
          <span className="text-sm text-text-secondary">Output cost ($/1M tokens)</span>
          <input
            type="number"
            step="0.001"
            min="0"
            value={form.outputCostPerMillion ?? ""}
            onChange={(e) => set("outputCostPerMillion", e.target.value ? Number(e.target.value) : null)}
            placeholder="e.g. 1.30"
            className="mt-1 block w-full px-3 py-2 bg-surface-primary border border-border-primary rounded-lg text-text-primary text-sm"
          />
        </label>
      </div>

      {!form.isDefault && (
        <div>
          <span className="text-sm text-text-secondary block mb-2">Assigned Tasks</span>
          <div className="flex flex-wrap gap-2">
            {USE_CASE_OPTIONS.map((uc) => (
              <button
                key={uc}
                type="button"
                onClick={() => toggleUseCase(uc)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  form.assignedUseCases.includes(uc)
                    ? "bg-surface-alt border-border-brand text-skin-accent"
                    : "border-border-primary text-text-tertiary hover:border-border-secondary"
                }`}
              >
                {uc.replace(/_/g, " ")}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onCancel} className="px-4 py-2 text-sm border border-border-primary rounded-lg text-text-secondary hover:bg-surface-primary">
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 flex items-center gap-2"
        >
          {isSubmitting && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
          {initial ? "Save Changes" : "Create Provider"}
        </button>
      </div>
    </form>
  );
}

/** FR-023/AC-01: System settings panel — fetches and displays grouped settings */
function SystemSettingsPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-settings"],
    queryFn: () => apiFetch<{ settings: Record<string, Array<{ key: string; value: string; value_type: string; description: string | null; updated_at: string }>> }>("/api/v1/admin/settings"),
  });

  if (isLoading) {
    return <div className="flex justify-center py-8"><Loader2 className="animate-spin text-text-tertiary" /></div>;
  }

  const settings = data?.settings;
  if (!settings || Object.keys(settings).length === 0) {
    return <p className="text-text-secondary text-sm text-center py-8">No system settings configured</p>;
  }

  return (
    <div className="space-y-6">
      {Object.entries(settings).map(([category, items]) => (
        <div key={category}>
          <h4 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-2 capitalize">{category}</h4>
          <div className="space-y-2">
            {items.map((item) => (
              <div key={item.key} className="flex items-center justify-between py-2 px-3 bg-surface-secondary rounded-lg">
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-text-primary">{item.key}</span>
                  {item.description && <p className="text-xs text-text-tertiary truncate">{item.description}</p>}
                </div>
                <span className="text-sm font-mono text-text-secondary ml-4">{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
