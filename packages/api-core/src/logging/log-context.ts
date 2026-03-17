import { AsyncLocalStorage } from "node:async_hooks";

export type LogContext = { requestId?: string };

const storage = new AsyncLocalStorage<LogContext>();

export function setLogContext(context: LogContext): void {
  storage.enterWith(context);
}

export function getLogContext(): LogContext | undefined {
  return storage.getStore();
}
