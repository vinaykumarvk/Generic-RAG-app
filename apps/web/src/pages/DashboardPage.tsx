import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWorkspaces, useCreateWorkspace } from "@/hooks/useWorkspaces";
import { Plus, FolderOpen, FileText, Users } from "lucide-react";

export function DashboardPage() {
  const { data: workspaces, isLoading } = useWorkspaces();
  const createWorkspace = useCreateWorkspace();
  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");

  const handleCreate = async () => {
    if (!name || !slug) return;
    const ws = await createWorkspace.mutateAsync({ name, slug, description: description || undefined });
    setShowCreate(false);
    setName("");
    setSlug("");
    setDescription("");
    navigate(`/workspace/${ws.workspace_id}`);
  };

  if (isLoading) {
    return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" /></div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Workspaces</h2>
          <p className="text-gray-500 text-sm mt-1">Select or create a workspace to get started</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors text-sm font-medium"
        >
          <Plus size={16} />
          New Workspace
        </button>
      </div>

      {showCreate && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6 shadow-sm">
          <h3 className="font-semibold mb-4">Create Workspace</h3>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
              <input value={name} onChange={(e) => { setName(e.target.value); if (!slug) setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-")); }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 outline-none" placeholder="My Knowledge Base" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Slug</label>
              <input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, ""))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 outline-none" placeholder="my-knowledge-base" />
            </div>
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 outline-none" rows={2} />
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreate} disabled={!name || !slug || createWorkspace.isPending}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 text-sm font-medium">
              {createWorkspace.isPending ? "Creating..." : "Create"}
            </button>
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm">Cancel</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {workspaces?.map((ws) => (
          <button
            key={ws.workspace_id}
            onClick={() => navigate(`/workspace/${ws.workspace_id}`)}
            className="bg-white border border-gray-200 rounded-xl p-5 text-left hover:shadow-md hover:border-primary-200 transition-all"
          >
            <div className="flex items-start gap-3">
              <div className="p-2 bg-primary-50 rounded-lg">
                <FolderOpen size={20} className="text-primary-600" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-gray-900 truncate">{ws.name}</h3>
                {ws.description && <p className="text-sm text-gray-500 mt-1 line-clamp-2">{ws.description}</p>}
              </div>
            </div>
            <div className="flex gap-4 mt-4 text-xs text-gray-400">
              <span className="flex items-center gap-1"><FileText size={12} />{ws.document_count ?? 0} docs</span>
              <span className="flex items-center gap-1"><Users size={12} />{ws.member_count ?? 0} members</span>
            </div>
          </button>
        ))}

        {workspaces?.length === 0 && (
          <div className="col-span-full text-center py-12 text-gray-400">
            No workspaces yet. Create one to get started.
          </div>
        )}
      </div>
    </div>
  );
}
