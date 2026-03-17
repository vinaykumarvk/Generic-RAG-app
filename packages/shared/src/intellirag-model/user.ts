import { z } from "zod";

// ---------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------

export const RagUserTypeSchema = z.enum(["ADMIN", "MEMBER", "VIEWER", "API_KEY"]);
export type RagUserType = z.infer<typeof RagUserTypeSchema>;

export const UserStatusSchema = z.enum(["ACTIVE", "DISABLED", "LOCKED"]);
export type UserStatus = z.infer<typeof UserStatusSchema>;

export const UserSchema = z.object({
  user_id: z.string().uuid(),
  username: z.string().min(3).max(100),
  email: z.string().email(),
  full_name: z.string().min(1).max(200),
  user_type: RagUserTypeSchema.default("MEMBER"),
  status: UserStatusSchema.default("ACTIVE"),
  password_hash: z.string().optional(),
  avatar_url: z.string().url().optional(),
  last_login_at: z.string().datetime().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type User = z.infer<typeof UserSchema>;

export const CreateUserSchema = z.object({
  username: z.string().min(3).max(100),
  email: z.string().email(),
  full_name: z.string().min(1).max(200),
  password: z.string().min(8),
  user_type: RagUserTypeSchema.optional(),
});
export type CreateUser = z.infer<typeof CreateUserSchema>;

export const WorkspaceMemberSchema = z.object({
  workspace_id: z.string().uuid(),
  user_id: z.string().uuid(),
  role: z.enum(["OWNER", "ADMIN", "EDITOR", "VIEWER"]),
  joined_at: z.string().datetime(),
});
export type WorkspaceMember = z.infer<typeof WorkspaceMemberSchema>;
