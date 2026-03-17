import { FastifyReply } from "fastify";

/** Authenticated user payload attached to requests by auth middleware. */
export interface AuthPayload {
  userId: string;
  userType: string;
  roles: string[];
  jti: string;
  unitId: string | null;
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

/** Minimal query function interface — apps inject their own. */
export type QueryFn = (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;

/** Minimal getClient function — apps inject their own. */
export type GetClientFn = () => Promise<PoolClientLike>;

export interface PoolClientLike {
  query(text: string, params?: any[]): Promise<{ rows: any[]; rowCount: number | null }>;
  release(): void;
}

declare module "fastify" {
  interface FastifyRequest {
    authUser?: AuthPayload;
    authToken?: string;
  }
}
