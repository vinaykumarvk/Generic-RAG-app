// Types
export type {
  AuthPayload,
  AuthUser,
  AuthResult,
  ApiError,
  QueryFn,
  GetClientFn,
  PoolClientLike,
} from "./types";

// Errors
export { sendError, send400, send401, send403, send404, validateFilePath } from "./errors";

// Logging
export { logInfo, logWarn, logError } from "./logging/logger";
export { setLogContext, getLogContext } from "./logging/log-context";
export type { LogContext } from "./logging/log-context";
export { redactValue } from "./logging/redact";

// Auth
export {
  hashPassword,
  verifyPassword,
  getUserRoles,
  authenticate,
  createUser,
} from "./auth/local-auth";
export type { OidcConfig } from "./auth/types";
export { createOidcAuth } from "./auth/oidc-auth";
export type { OidcAuth } from "./auth/oidc-auth";
export { createLdapAuth } from "./auth/ldap-auth";
export type { LdapAuth, LdapAuthConfig, LdapAuthResult } from "./auth/ldap-auth";

// Middleware
export { createAuthMiddleware } from "./middleware/auth-middleware";
export type { AuthMiddleware, AuthMiddlewareConfig } from "./middleware/auth-middleware";
export { createAuditLogger } from "./middleware/audit-logger";
export type { AuditLogger, AuditLoggerConfig } from "./middleware/audit-logger";
export { createIdempotencyMiddleware } from "./middleware/idempotency";
export { createRoleGuard } from "./middleware/role-guard";
export type { IdempotencyMiddleware, IdempotencyMiddlewareConfig } from "./middleware/idempotency";

// Scheduler
export { createSlaScheduler } from "./scheduler/sla-scheduler";
export type { SlaScheduler, SlaSchedulerConfig } from "./scheduler/sla-scheduler";

// Routes
export { createAuthRoutes } from "./routes/auth-routes";
export type { AuthRouteDeps } from "./routes/auth-routes";
export { createAdminRoutes } from "./routes/admin-routes";
export type { AdminRouteDeps } from "./routes/admin-routes";
export { createConfigRoutes } from "./routes/config-routes";
export type { ConfigRouteDeps } from "./routes/config-routes";
export { createNotificationRoutes } from "./routes/notification-routes";
export type { NotificationRouteDeps } from "./routes/notification-routes";
export { createTaskRoutes } from "./routes/task-routes";
export type { TaskRouteDeps } from "./routes/task-routes";
export { createOidcRoutes } from "./routes/oidc-routes";
export type { OidcRouteDeps } from "./routes/oidc-routes";
export { createConfigGovernanceRoutes } from "./routes/config-governance-routes";
export type { ConfigGovernanceRouteDeps } from "./routes/config-governance-routes";
export { createNlQueryRoutes } from "./routes/nl-query-routes";
export type { NlQueryRouteDeps, NlQueryPattern } from "./routes/nl-query-routes";
export { createPageAgentRoutes } from "./routes/page-agent-routes";
export type { PageAgentRouteDeps } from "./routes/page-agent-routes";
export { createFeatureToggleRoutes } from "./routes/feature-toggle-routes";
export type { FeatureToggleRouteDeps } from "./routes/feature-toggle-routes";
export { createLlmConfigRoutes } from "./routes/llm-config-routes";
export type { LlmConfigRouteDeps } from "./routes/llm-config-routes";

// LLM
export { createLlmProvider } from "./llm/llm-provider";
export type {
  LlmProvider,
  LlmProviderDeps,
  LlmProviderConfig,
  LlmUseCase,
  LlmMessage,
  LlmCompletionRequest,
  LlmCompletionResponse,
  EmbeddingRequest,
  EmbeddingResponse,
  JsonFieldSpec,
  ModelRoutingConfig,
  RetrievalPreset,
} from "./llm/llm-provider";

// App builder
export { createApp } from "./app-builder";
export type { AppBuilderConfig, SwaggerTag } from "./app-builder";

// DB
export { createPool } from "./db";
export type { CreatePoolConfig } from "./db";

// Testing
export { createTestHelpers } from "./testing/test-helpers";
export type { TestHelperConfig } from "./testing/test-helpers";
