import { useState, useEffect, useCallback } from "react";
import type { FeatureFlags, AssistantConfig } from "../types";

const DEFAULT_FLAGS: FeatureFlags = { nl_query: false, page_agent: false };

export function useFeatureFlags(config: AssistantConfig) {
  const [flags, setFlags] = useState<FeatureFlags>(DEFAULT_FLAGS);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (config.isOffline) return;
    try {
      const res = await fetch(`${config.apiBaseUrl}/api/v1/assistant/features/status`, {
        headers: config.authHeaders,
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setFlags({
          nl_query: data.flags?.nl_query ?? false,
          page_agent: data.flags?.page_agent ?? false,
        });
      }
    } catch {
      // Keep defaults
    } finally {
      setLoading(false);
    }
  }, [config.apiBaseUrl, config.authHeaders, config.isOffline]);

  useEffect(() => { refresh(); }, [refresh]);

  return { flags, loading, refresh };
}
