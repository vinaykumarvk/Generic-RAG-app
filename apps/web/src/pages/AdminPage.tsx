import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiPost } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { Settings, Zap, CheckCircle, XCircle, Loader2 } from "lucide-react";

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

export function AdminPage() {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();

  const { data: providers, isLoading } = useQuery({
    queryKey: ["llm-providers"],
    queryFn: () => apiFetch<{ providers: LlmProviderConfig[] }>("/api/v1/admin/llm/providers").then((r) => r.providers),
    enabled: isAdmin,
  });

  const testMutation = useMutation({
    mutationFn: (configId: string) => apiPost<{ success: boolean; latencyMs: number; error?: string }>(`/api/v1/admin/llm/test`, { config_id: configId }),
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
    return <div className="text-center py-12 text-gray-500">Admin access required</div>;
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Settings size={24} />
          Administration
        </h2>
        <p className="text-gray-500 text-sm mt-1">Manage LLM providers and system configuration</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
          <Zap size={18} className="text-amber-500" />
          LLM Providers
        </h3>

        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="animate-spin text-gray-400" /></div>
        ) : (
          <div className="space-y-3">
            {providers?.map((p) => (
              <div key={p.config_id} className="flex items-center justify-between p-4 border border-gray-100 rounded-lg">
                <div className="flex items-center gap-4">
                  <div>
                    <div className="font-medium">{p.display_name}</div>
                    <div className="text-sm text-gray-500">
                      {p.provider} / {p.model_id} — {p.api_base_url}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {p.is_active && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">Active</span>}
                    {p.is_default && <span className="text-xs bg-primary-100 text-primary-700 px-2 py-0.5 rounded">Default</span>}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {testResults[p.config_id] && (
                    <span className={`flex items-center gap-1 text-sm ${testResults[p.config_id].success ? "text-green-600" : "text-red-600"}`}>
                      {testResults[p.config_id].success
                        ? <><CheckCircle size={14} /> {testResults[p.config_id].latencyMs}ms</>
                        : <><XCircle size={14} /> {testResults[p.config_id].error}</>}
                    </span>
                  )}
                  <button
                    onClick={() => handleTest(p.config_id)}
                    disabled={testMutation.isPending}
                    className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                  >
                    Test
                  </button>
                </div>
              </div>
            ))}

            {providers?.length === 0 && (
              <p className="text-center py-8 text-gray-400">No LLM providers configured</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
