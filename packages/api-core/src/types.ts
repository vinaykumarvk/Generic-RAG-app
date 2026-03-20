import { FastifyReply, FastifyRequest } from "fastify";

/** Authenticated user payload attached to requests by auth middleware. */
export interface AuthPayload {
  userId: string;
  user_id?: string;
  userType: string;
  roles: string[];
  jti: string;
  unitId: string | null;
  unit_id?: string | null;
}

/** User record returned from authentication/creation. */
export interface AuthUser {
  user_id: string;
  username: string;
  full_name: string;
  user_type: string;
  roles: string[];
  unit_id: string | null;
}

/** Authentication result from local auth. */
export interface AuthResult {
  user: AuthUser | null;
  mfaRequired?: boolean;
  mfaUserId?: string;
}

/** Standard API error shape. */
export interface ApiError {
  error: string;
  message: string;
  statusCode: number;
}

export type QueryParams = unknown[];
export type QueryRow = Record<string, unknown>;

export interface QueryResult<T = any> {
  rows: T[];
  rowCount: number | null;
}

/** Minimal query function interface — apps inject their own. */
export type QueryFn = <T = any>(text: string, params?: QueryParams) => Promise<QueryResult<T>>;

/** Minimal getClient function — apps inject their own. */
export type GetClientFn = () => Promise<PoolClientLike>;

export interface PoolClientLike {
  query<T = any>(text: string, params?: QueryParams): Promise<QueryResult<T>>;
  release(): void;
}

export interface RequestUserPosting {
  system_role_ids?: string[];
  role_key?: string | null;
}

export interface RequestUserLike {
  userId?: string;
  user_id?: string;
  userType?: string;
  roles?: string[];
  postings?: RequestUserPosting[];
}

export type RequestUserResolver = (request: FastifyRequest) => RequestUserLike | AuthPayload | undefined;

declare module "fastify" {
  interface FastifyRequest {
    authUser?: AuthPayload;
    authToken?: string;
    user?: unknown;
    _idempotencyKey?: string;
  }

  interface FastifyReply {
    _idempotencyBody?: unknown;
  }
}
