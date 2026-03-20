import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiDelete } from "@/lib/api";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { CreateUserForm } from "./CreateUserForm";
import { EditUserModal } from "./EditUserModal";
import { Users, Plus, Shield, UserX, Pencil } from "lucide-react";

interface User {
  user_id: string;
  email: string;
  full_name: string;
  user_type: string;
  status: string;
  created_at: string;
  last_login_at?: string;
}

export function UserManagement() {
  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [editTarget, setEditTarget] = useState<User | null>(null);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => apiFetch<{ users: User[] }>("/api/v1/users"),
  });

  const deleteMutation = useMutation({
    mutationFn: (userId: string) => apiDelete(`/api/v1/users/${userId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      setDeleteTarget(null);
    },
  });

  const users = data?.users || [];

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" role="status" aria-label="Loading users" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-lg font-semibold text-text-primary flex items-center gap-2">
          <Users size={20} aria-hidden="true" />
          User Management
        </h3>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="btn-primary w-full justify-center sm:w-auto"
        >
          <Plus size={14} aria-hidden="true" />
          Create User
        </button>
      </div>

      {showCreate && (
        <CreateUserForm
          onSuccess={() => {
            setShowCreate(false);
            qc.invalidateQueries({ queryKey: ["admin-users"] });
          }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {users.length === 0 ? (
        <p className="text-center py-8 text-text-secondary">No users found</p>
      ) : (
        <>
          <div className="md:hidden space-y-3">
            {users.map((user) => (
              <article key={user.user_id} className="bg-surface-primary border border-border-primary rounded-xl p-4 space-y-3">
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h4 className="font-medium text-text-primary break-words">{user.full_name}</h4>
                      <p className="text-sm text-text-secondary break-all mt-1">{user.email}</p>
                    </div>
                    <span className={`text-xs font-medium shrink-0 ${
                      user.status === "ACTIVE" ? "text-success" :
                      user.status === "ARCHIVED" ? "text-text-tertiary" : "text-warning"
                    }`}>
                      {user.status}
                    </span>
                  </div>

                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
                    user.user_type === "ADMIN"
                      ? "surface-warning-soft text-warning"
                      : "bg-surface-secondary text-text-secondary"
                  }`}>
                    {user.user_type === "ADMIN" && <Shield size={10} aria-hidden="true" />}
                    {user.user_type}
                  </span>
                </div>

                <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                  <div>
                    <dt className="text-text-tertiary">Created</dt>
                    <dd className="text-text-primary font-medium mt-0.5">
                      {user.created_at ? new Date(user.created_at).toLocaleDateString() : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-text-tertiary">Last Login</dt>
                    <dd className="text-text-primary font-medium mt-0.5">
                      {user.last_login_at ? new Date(user.last_login_at).toLocaleDateString() : "Never"}
                    </dd>
                  </div>
                </dl>

                {user.status !== "ARCHIVED" && (
                  <div className="flex items-center justify-end gap-2 border-t border-border-primary pt-3">
                    <button
                      type="button"
                      onClick={() => setEditTarget(user)}
                      className="p-2 rounded-lg text-text-tertiary hover:bg-surface-secondary hover:text-primary-600 transition-colors"
                      aria-label={`Edit ${user.full_name}`}
                    >
                      <Pencil size={16} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(user)}
                      className="p-2 rounded-lg text-text-tertiary hover:bg-surface-secondary hover-text-danger transition-colors"
                      aria-label={`Deactivate ${user.full_name}`}
                    >
                      <UserX size={16} aria-hidden="true" />
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>

          <div className="hidden md:block bg-surface-primary border border-border-primary rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-secondary border-b border-border-primary">
                <tr>
                  <th scope="col" className="text-left px-4 py-3 font-medium text-text-secondary">Name</th>
                  <th scope="col" className="text-left px-4 py-3 font-medium text-text-secondary">Email</th>
                  <th scope="col" className="text-left px-4 py-3 font-medium text-text-secondary">Role</th>
                  <th scope="col" className="text-left px-4 py-3 font-medium text-text-secondary">Status</th>
                  <th scope="col" className="text-left px-4 py-3 font-medium text-text-secondary">Created</th>
                  <th scope="col" className="text-right px-4 py-3 font-medium text-text-secondary">Last Login</th>
                  <th scope="col" className="text-right px-4 py-3 font-medium text-text-secondary">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-primary">
                {users.map((user) => (
                  <tr key={user.user_id} className="hover:bg-surface-secondary">
                    <td className="px-4 py-3 font-medium text-text-primary">{user.full_name}</td>
                    <td className="px-4 py-3 text-text-secondary">{user.email}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
                        user.user_type === "ADMIN"
                          ? "surface-warning-soft text-warning"
                          : "bg-surface-secondary text-text-secondary"
                      }`}>
                        {user.user_type === "ADMIN" && <Shield size={10} aria-hidden="true" />}
                        {user.user_type}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium ${
                        user.status === "ACTIVE" ? "text-success" :
                        user.status === "ARCHIVED" ? "text-text-tertiary" : "text-warning"
                      }`}>
                        {user.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-text-tertiary">
                      {user.created_at ? new Date(user.created_at).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-text-tertiary">
                      {user.last_login_at ? new Date(user.last_login_at).toLocaleDateString() : "Never"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {user.status !== "ARCHIVED" && (
                          <>
                            <button
                              type="button"
                              onClick={() => setEditTarget(user)}
                              className="p-1.5 rounded-lg text-text-tertiary hover:bg-surface-secondary hover:text-primary-600 transition-colors"
                              aria-label={`Edit ${user.full_name}`}
                            >
                              <Pencil size={14} aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(user)}
                              className="p-1.5 rounded-lg text-text-tertiary hover:bg-surface-secondary hover-text-danger transition-colors"
                              aria-label={`Deactivate ${user.full_name}`}
                            >
                              <UserX size={14} aria-hidden="true" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {editTarget && (
        <EditUserModal
          user={editTarget}
          onSuccess={() => {
            setEditTarget(null);
            qc.invalidateQueries({ queryKey: ["admin-users"] });
          }}
          onCancel={() => setEditTarget(null)}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Deactivate user"
          message={`Are you sure you want to deactivate "${deleteTarget.full_name}"? Their account will be archived and all sessions revoked.`}
          confirmLabel="Deactivate user"
          variant="danger"
          onConfirm={() => deleteMutation.mutate(deleteTarget.user_id)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
