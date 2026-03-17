import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiPost, apiPatch, apiDelete } from "@/lib/api";

interface Workspace {
  workspace_id: string;
  name: string;
  slug: string;
  description?: string;
  status: string;
  settings: Record<string, unknown>;
  member_count?: number;
  document_count?: number;
  created_at: string;
}

export function useWorkspaces() {
  return useQuery({
    queryKey: ["workspaces"],
    queryFn: () => apiFetch<{ workspaces: Workspace[] }>("/api/v1/workspaces").then((r) => r.workspaces),
  });
}

export function useWorkspace(id: string) {
  return useQuery({
    queryKey: ["workspaces", id],
    queryFn: () => apiFetch<Workspace>(`/api/v1/workspaces/${id}`),
    enabled: !!id,
  });
}

export function useCreateWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; slug: string; description?: string }) =>
      apiPost<Workspace>("/api/v1/workspaces", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workspaces"] }),
  });
}

export function useUpdateWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; name?: string; description?: string; status?: string }) =>
      apiPatch<Workspace>(`/api/v1/workspaces/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workspaces"] }),
  });
}

export function useDeleteWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/api/v1/workspaces/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workspaces"] }),
  });
}
