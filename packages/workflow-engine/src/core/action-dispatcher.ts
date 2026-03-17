import type { ActionContext, ActionHandler, EngineLogger } from "../types";

const noopLogger: EngineLogger = {
  info() {},
  warn() {},
  error() {},
};

export class ActionDispatcher {
  private handlers: Map<string, ActionHandler>;
  private logger: EngineLogger;

  constructor(handlers: ActionHandler[], logger?: EngineLogger) {
    this.handlers = new Map(handlers.map((h) => [h.actionKey, h]));
    this.logger = logger ?? noopLogger;
  }

  async dispatch(actionKey: string, ctx: ActionContext): Promise<void> {
    const handler = this.handlers.get(actionKey);
    if (!handler) {
      this.logger.warn(`No handler registered for action: ${actionKey}`, {
        actionKey,
        entityId: ctx.entityRef.entityId,
        transitionId: ctx.fromStateId + " -> " + ctx.toStateId,
      });
      return;
    }
    await handler.execute(ctx);
  }

  hasHandler(actionKey: string): boolean {
    return this.handlers.has(actionKey);
  }
}
