import { getLogContext } from "./log-context";
import { redactValue } from "./redact";

type LogLevel = "info" | "warn" | "error";
type LogFields = Record<string, unknown>;

function write(level: LogLevel, message: string, fields?: LogFields): void {
  const context = getLogContext();
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    message,
    requestId: context?.requestId ?? null,
    ...(fields ? (redactValue(fields) as LogFields) : {}),
  };
  const line = JSON.stringify(payload);
  if (level === "error") { console.error(line); return; }
  if (level === "warn") { console.warn(line); return; }
  console.log(line);
}

export function logInfo(message: string, fields?: LogFields): void { write("info", message, fields); }
export function logWarn(message: string, fields?: LogFields): void { write("warn", message, fields); }
export function logError(message: string, fields?: LogFields): void { write("error", message, fields); }
