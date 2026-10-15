import { AsyncLocalStorage } from "node:async_hooks";

export type LogContext = {
  requestId?: string;
  method?: string;
  path?: string;
  userId?: string;
};

const storage = new AsyncLocalStorage<LogContext>();

export function runWithLogContext<T>(ctx: LogContext, fn: () => T): T {
  return storage.run({ ...ctx }, fn);
}

export function tryGetLogContext(): LogContext | undefined {
  return storage.getStore();
}

export function setLogUserId(userId: string | undefined) {
  const store = storage.getStore();
  if (store && userId) store.userId = userId;
}
