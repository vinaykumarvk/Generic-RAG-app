/**
 * NotificationPreferences — Per-event channel preferences.
 * FR-021: Notification preferences management.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiPatch } from "@/lib/api";
import { Bell, Loader2, Mail } from "lucide-react";

interface NotificationPref {
  event_type: string;
  channel: string;
  enabled: boolean;
}

const EVENT_LABELS: Record<string, string> = {
  "upload.complete": "Upload completed",
  "ocr.low_confidence": "OCR low confidence (review needed)",
  "reprocess.complete": "Reprocess completed",
  "access.denied": "Access denied alert",
  "report.ready": "Report ready for download",
  "feedback.threshold": "Missing document feedback threshold",
  "metadata.review": "Metadata review required",
  "graph.conflict": "Graph conflict detected",
};

export function NotificationPreferences() {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["notification-preferences"],
    queryFn: () => apiFetch<{ preferences: NotificationPref[] }>("/api/v1/notifications/preferences"),
  });

  const toggleMutation = useMutation({
    mutationFn: (pref: { event_type: string; channel: string; enabled: boolean }) =>
      apiPatch("/api/v1/notifications/preferences", pref),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notification-preferences"] }),
  });

  if (isLoading) {
    return <div className="flex justify-center py-8"><Loader2 className="animate-spin text-text-tertiary" /></div>;
  }

  // Group by event_type
  const eventTypes = [...new Set((data?.preferences || []).map((p) => p.event_type))];
  const prefMap = new Map((data?.preferences || []).map((p) => [`${p.event_type}:${p.channel}`, p.enabled]));

  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-text-primary flex items-center gap-2">
        <Bell size={18} aria-hidden="true" />
        Notification Preferences
      </h3>
      <p className="text-sm text-text-tertiary">
        Choose which notifications you receive and through which channel.
      </p>

      {eventTypes.length === 0 ? (
        <p className="py-8 text-center text-text-tertiary">
          No notification preferences configured yet.
        </p>
      ) : (
        <>
          <div className="md:hidden space-y-3">
            {eventTypes.map((eventType) => (
              <article key={eventType} className="bg-surface-primary border border-border-primary rounded-xl p-4 space-y-3">
                <h4 className="font-medium text-text-primary">{EVENT_LABELS[eventType] || eventType}</h4>
                <div className="space-y-3">
                  {["in_app", "email"].map((channel) => {
                    const key = `${eventType}:${channel}`;
                    const enabled = prefMap.get(key) ?? (channel === "in_app");
                    return (
                      <div key={channel} className="flex items-center justify-between gap-3">
                        <span className="inline-flex items-center gap-2 text-sm text-text-secondary">
                          {channel === "in_app" ? <Bell size={14} aria-hidden="true" /> : <Mail size={14} aria-hidden="true" />}
                          {channel === "in_app" ? "In-App" : "Email"}
                        </span>
                        <label className="inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={enabled}
                            onChange={() =>
                              toggleMutation.mutate({ event_type: eventType, channel, enabled: !enabled })
                            }
                            className="sr-only peer"
                          />
                          <div className="relative w-9 h-5 bg-surface-alt peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-transparent after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-surface after:border-skin after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary-700" />
                          <span className="sr-only">{channel === "in_app" ? "In-app" : "Email"} for {eventType}</span>
                        </label>
                      </div>
                    );
                  })}
                </div>
              </article>
            ))}
          </div>

          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-primary">
                  <th scope="col" className="text-left py-2 pr-4 font-medium text-text-secondary">Event</th>
                  <th scope="col" className="text-center py-2 px-4 font-medium text-text-secondary">
                    <span className="flex items-center justify-center gap-1">
                      <Bell size={14} aria-hidden="true" /> In-App
                    </span>
                  </th>
                  <th scope="col" className="text-center py-2 px-4 font-medium text-text-secondary">
                    <span className="flex items-center justify-center gap-1">
                      <Mail size={14} aria-hidden="true" /> Email
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-primary">
                {eventTypes.map((eventType) => (
                  <tr key={eventType}>
                    <td className="py-3 pr-4 text-text-primary">
                      {EVENT_LABELS[eventType] || eventType}
                    </td>
                    {["in_app", "email"].map((channel) => {
                      const key = `${eventType}:${channel}`;
                      const enabled = prefMap.get(key) ?? (channel === "in_app");
                      return (
                        <td key={channel} className="py-3 px-4 text-center">
                          <label className="inline-flex items-center cursor-pointer">
                            <input
                              type="checkbox"
                              checked={enabled}
                              onChange={() =>
                                toggleMutation.mutate({ event_type: eventType, channel, enabled: !enabled })
                              }
                              className="sr-only peer"
                            />
                            <div className="relative w-9 h-5 bg-surface-alt peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-transparent after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-surface after:border-skin after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary-700" />
                            <span className="sr-only">{channel === "in_app" ? "In-app" : "Email"} for {eventType}</span>
                          </label>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
