import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiPost } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useParams } from "react-router-dom";
import { UserManagement } from "@/components/admin/UserManagement";
import { IngestionMonitor } from "@/components/admin/IngestionMonitor";
import { GraphStatsCard } from "@/components/admin/GraphStatsCard";
import {
  Settings, Zap, CheckCircle, XCircle, Loader2,
  Users, FileText, Database, Share2,
} from "lucide-react";

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
    mutationFn: (configId: string) => apiPost<{ success: boolean; latencyMs: number; error?: string }>(`/api/v1/assistant/llm/test`, { config_id: configId }),
  });

  const [testResults, setTestResults] = useState<Record<string, { success: boolean; latencyMs: number; error?: string }>>({});

  const handleTest = async (configId: string) => {
    try {
      const result = await testMutation.mutateAsync(configId);
      setTestResults((prev) => ({ ...prev, [configId]: result }));
    } catch {
      setTestResults((prev) => ({ ...prev, [configId]: { success: false, latencyMs: 0, error: "Test failed" } }));
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
          <h3 className="font-semibold text-lg mb-4 flex items-center gap-2 text-text-primary">
            <Zap size={18} className="text-warning" aria-hidden="true" />
            LLM Providers
          </h3>

          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="animate-spin text-text-tertiary" /></div>
          ) : (
            <div className="space-y-3">
              {providers?.map((p) => (
                <div key={p.config_id} className="flex items-center justify-between p-4 border border-border-primary rounded-lg">
                  <div className="flex items-center gap-4">
                    <div>
                      <div className="font-medium text-text-primary">{p.display_name}</div>
                      <div className="text-sm text-text-secondary">
                        {p.provider} / {p.model_id} — {p.api_base_url}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {p.is_active && <span className="text-xs badge-success px-2 py-0.5 rounded">Active</span>}
                      {p.is_default && <span className="text-xs badge-brand px-2 py-0.5 rounded">Default</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {testResults[p.config_id] && (
                      <span className={`flex items-center gap-1 text-sm ${testResults[p.config_id].success ? "text-success" : "text-danger"}`}>
                        {testResults[p.config_id].success
                          ? <><CheckCircle size={14} aria-hidden="true" /> {testResults[p.config_id].latencyMs}ms</>
                          : <><XCircle size={14} aria-hidden="true" /> {testResults[p.config_id].error}</>}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => handleTest(p.config_id)}
                      disabled={testMutation.isPending}
                      className="px-3 py-1.5 text-sm border border-border-primary rounded-lg hover:bg-surface-secondary disabled:opacity-50 text-text-secondary"
                    >
                      Test
                    </button>
                  </div>
                </div>
              ))}

              {providers?.length === 0 && (
                <p className="text-center py-8 text-text-tertiary">No LLM providers configured</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
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
