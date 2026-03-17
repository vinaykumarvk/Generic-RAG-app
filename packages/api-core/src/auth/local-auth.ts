import argon2 from "argon2";
import type { QueryFn, AuthUser, AuthResult } from "../types";

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
  });
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export async function getUserRoles(queryFn: QueryFn, userId: string): Promise<string[]> {
  const result = await queryFn(
    `SELECT r.role_key FROM user_role ur JOIN role r ON r.role_id = ur.role_id WHERE ur.user_id = $1`,
    [userId],
  );
  return result.rows.map((row: { role_key: string }) => row.role_key);
}

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MINUTES = 15;

export async function authenticate(queryFn: QueryFn, username: string, password: string): Promise<AuthResult> {
  const result = await queryFn(
    `SELECT user_id, username, full_name, password_hash, user_type, unit_id, locked_until, mfa_enabled FROM user_account WHERE username = $1 AND is_active = true`,
    [username],
  );
  if (result.rows.length === 0) return { user: null };

  const user = result.rows[0];

  // Check if the account is currently locked
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    return { user: null };
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    // Increment failed attempts and lock if threshold reached
    await queryFn(
      `UPDATE user_account SET
        failed_login_attempts = failed_login_attempts + 1,
        last_failed_login = NOW(),
        locked_until = CASE WHEN failed_login_attempts + 1 >= $2 THEN NOW() + INTERVAL '1 minute' * $3 ELSE NULL END
       WHERE user_id = $1`,
      [user.user_id, MAX_FAILED_ATTEMPTS, LOCKOUT_DURATION_MINUTES],
    );
    return { user: null };
  }

  // Reset failed login attempts on successful authentication
  await queryFn(
    `UPDATE user_account SET failed_login_attempts = 0, locked_until = NULL, last_failed_login = NULL WHERE user_id = $1`,
    [user.user_id],
  );

  // If MFA is enabled, require second factor before issuing token
  if (user.mfa_enabled) {
    return { user: null, mfaRequired: true, mfaUserId: user.user_id };
  }

  const roles = await getUserRoles(queryFn, user.user_id);

  return {
    user: {
      user_id: user.user_id,
      username: user.username,
      full_name: user.full_name,
      user_type: user.user_type,
      roles,
      unit_id: user.unit_id || null,
    },
  };
}

export async function createUser(queryFn: QueryFn, input: {
  username: string;
  password: string;
  fullName: string;
  userType?: string;
}): Promise<AuthUser> {
  const passwordHash = await hashPassword(input.password);
  const result = await queryFn(
    `INSERT INTO user_account (username, password_hash, full_name, user_type) VALUES ($1, $2, $3, $4) RETURNING user_id, username, full_name, user_type`,
    [input.username, passwordHash, input.fullName, input.userType || "OFFICER"],
  );
  const user = result.rows[0];
  return {
    user_id: user.user_id,
    username: user.username,
    full_name: user.full_name,
    user_type: user.user_type,
    roles: [],
    unit_id: null,
  };
}
