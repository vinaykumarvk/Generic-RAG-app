import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { Users } from "lucide-react";

interface UserAnalyticsResponse {
  active_users_30d: number;
  top_users: Array<{
    display_name: string;
    email: string;
    query_count: number;
  }>;
}

export function UserAnalyticsPanel({ workspaceId }: { workspaceId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["user-analytics", workspaceId],
    queryFn: () =>
      apiFetch<UserAnalyticsResponse>(
        `/api/v1/workspaces/${workspaceId}/analytics/users`
      ),
    enabled: !!workspaceId,
  });

  if (isLoading) {
    return (
      <div className="bg-surface border border-skin rounded-xl p-5 animate-pulse">
        <div className="h-4 bg-surface-alt rounded w-36 mb-3" />
        <div className="h-8 bg-surface-alt rounded w-20 mb-4" />
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-4 bg-surface-alt rounded w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="bg-surface border border-skin rounded-xl p-5">
        <p className="text-sm text-skin-muted">Failed to load user analytics.</p>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="bg-surface border border-skin rounded-xl p-5">
      <div className="flex items-center gap-2 mb-3">
        <Users size={16} className="text-primary-600" aria-hidden="true" />
        <h3 className="font-semibold text-skin-base">User Activity</h3>
      </div>

      <p className="text-2xl font-bold text-skin-base mb-4">
        {data.active_users_30d}
        <span className="text-sm font-normal text-skin-muted ml-2">active users (30 days)</span>
      </p>

      {data.top_users.length > 0 ? (
        <div>
          <h4 className="text-xs font-medium text-skin-muted uppercase tracking-wider mb-2">
            Top Users by Queries
          </h4>
          <div className="md:hidden space-y-3">
            {data.top_users.map((u) => (
              <article key={u.email} className="bg-surface-secondary border border-skin rounded-xl p-3 space-y-2">
                <div className="text-skin-base font-medium break-words">
                  {u.display_name || u.email}
                </div>
                {u.display_name && (
                  <div className="text-xs text-skin-muted break-all">{u.email}</div>
                )}
                <div className="flex items-center justify-between text-xs">
                  <span className="text-skin-muted">Queries</span>
                  <span className="font-medium text-skin-base">{u.query_count}</span>
                </div>
              </article>
            ))}
          </div>
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-skin">
                  <th scope="col" className="text-left py-1.5 pr-3 text-xs font-medium text-skin-muted">
                    User
                  </th>
                  <th scope="col" className="text-right py-1.5 pl-3 text-xs font-medium text-skin-muted">
                    Queries
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.top_users.map((u) => (
                  <tr key={u.email} className="border-b border-skin last:border-b-0">
                    <td className="py-1.5 pr-3">
                      <div className="text-skin-base truncate max-w-[12rem]">
                        {u.display_name || u.email}
                      </div>
                      {u.display_name && (
                        <div className="text-xs text-skin-muted truncate max-w-[12rem]">{u.email}</div>
                      )}
                    </td>
                    <td className="py-1.5 pl-3 text-right text-skin-muted font-medium">
                      {u.query_count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <p className="text-sm text-skin-muted">No user query activity in the last 30 days.</p>
      )}
    </div>
  );
}
