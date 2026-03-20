type ErrorReporter = {
  captureException: (error: unknown, context?: Record<string, unknown>) => void;
  captureMessage: (message: string, level?: "info" | "warning" | "error") => void;
  setUser: (user: { id: string; email?: string } | null) => void;
};

type ViteMetaEnv = {
  VITE_SENTRY_DSN?: string;
};

type SentryLike = {
  captureException: (error: unknown, context?: { extra?: Record<string, unknown> }) => void;
  captureMessage: (message: string, level?: "info" | "warning" | "error") => void;
  setUser: (user: { id: string; email?: string } | null) => void;
};

type ErrorReportingGlobal = typeof globalThis & {
  __VITE_META_ENV__?: ViteMetaEnv;
  __SENTRY__?: SentryLike;
};

let reporter: ErrorReporter | null = null;

function noopReporter(): ErrorReporter {
  return {
    captureException: () => {},
    captureMessage: () => {},
    setUser: () => {},
  };
}

export function initErrorReporting(options: {
  dsn?: string;
  environment?: string;
  release?: string;
  app: string;
}): ErrorReporter {
  // globalThis.__VITE_ENV__ is set by Vite; avoid import.meta for CJS compat
  const runtimeGlobal = globalThis as ErrorReportingGlobal;
  const viteMeta = typeof globalThis !== "undefined" ? runtimeGlobal.__VITE_META_ENV__ : undefined;
  const dsn = options.dsn || viteMeta?.VITE_SENTRY_DSN;
  if (!dsn) {
    reporter = noopReporter();
    return reporter;
  }

  const Sentry = runtimeGlobal.__SENTRY__;
  if (Sentry) {
    reporter = {
      captureException: (error, context) => {
        Sentry.captureException(error, context ? { extra: context } : undefined);
      },
      captureMessage: (message, level) => {
        Sentry.captureMessage(message, level);
      },
      setUser: (user) => {
        Sentry.setUser(user);
      },
    };
    return reporter;
  }

  reporter = {
    captureException: (error, context) => {
      const body = JSON.stringify({
        exception: { values: [{ type: "Error", value: String(error) }] },
        extra: context,
        tags: { app: options.app },
        environment: options.environment || "production",
        release: options.release,
        platform: "javascript",
      });
      // Parse DSN: https://<key>@<host>/<project-id>
      const dsnMatch = dsn.match(/^https?:\/\/([^@]+)@([^/]+)\/(.+)$/);
      const sentryKey = dsnMatch?.[1] ?? dsn.split("@")[0]?.split("//")[1];
      const sentryHost = dsnMatch?.[2] ?? "sentry.io";
      const sentryProject = dsnMatch?.[3] ?? "0";
      const endpoint = `https://${sentryHost}/api/${sentryProject}/envelope/`;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-Sentry-Auth": `Sentry sentry_key=${sentryKey}, sentry_version=7`,
      };
      try {
        if (typeof navigator !== "undefined" && navigator.sendBeacon) {
          navigator.sendBeacon(endpoint, body);
        } else {
          fetch(endpoint, { method: "POST", headers, body, keepalive: true }).catch(() => {});
        }
      } catch {
        /* best-effort reporting */
      }
    },
    captureMessage: (message, level) => {
      reporter?.captureException(new Error(message), { level });
    },
    setUser: () => {},
  };
  return reporter;
}

export function getErrorReporter(): ErrorReporter {
  return reporter || noopReporter();
}
