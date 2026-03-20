import { useState, useRef, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { ChevronDown, Plus } from "lucide-react";

export function WorkspaceSwitcher() {
  const { workspaceId } = useParams();
  const { data: workspaces } = useWorkspaces();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const current = workspaces?.find((w) => w.workspace_id === workspaceId);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-surface-secondary transition-colors text-sm text-text-primary"
      >
        <span className="font-medium">{current?.name || "Select workspace"}</span>
        <ChevronDown size={16} className={`transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-64 max-w-[calc(100vw-2rem)] bg-surface-primary rounded-lg shadow-lg border border-border-primary z-50">
          <div className="p-2">
            {workspaces?.map((ws) => (
              <button
                type="button"
                key={ws.workspace_id}
                onClick={() => {
                  navigate(`/workspace/${ws.workspace_id}`);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-2 rounded text-sm hover:bg-surface-secondary ${
                  ws.workspace_id === workspaceId ? "bg-primary-50 text-primary-700" : "text-text-primary"
                }`}
              >
                <div className="font-medium">{ws.name}</div>
                {ws.description && (
                  <div className="text-xs text-text-secondary truncate">{ws.description}</div>
                )}
              </button>
            ))}
          </div>
          <div className="border-t border-border-primary p-2">
            <button
              type="button"
              onClick={() => {
                navigate("/");
                setOpen(false);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded text-sm text-primary-600 hover:bg-primary-50"
            >
              <Plus size={16} aria-hidden="true" />
              Create workspace
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
