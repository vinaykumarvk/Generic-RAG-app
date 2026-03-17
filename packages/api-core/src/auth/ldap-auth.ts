import type { QueryFn } from "../types";
import { logWarn, logInfo } from "../logging/logger";

export interface LdapAuthConfig {
  url: string;
  baseDn: string;
  bindDn?: string;
  bindPassword?: string;
  searchFilter?: string;
  tlsOptions?: { rejectUnauthorized?: boolean };
}

export interface LdapAuthResult {
  success: boolean;
  userId?: string;
  displayName?: string;
  email?: string;
  groups?: string[];
  error?: string;
}

export interface LdapAuth {
  authenticate(username: string, password: string): Promise<LdapAuthResult>;
  isConnected(): boolean;
}

/**
 * Creates an LDAP authentication adapter.
 * This is a stub implementation — actual LDAP binding requires an ldapjs-compatible library.
 * The stub validates config and delegates to the DB user table for credential matching,
 * logging a warning that real LDAP is not yet wired.
 */
export function createLdapAuth(config: LdapAuthConfig, queryFn: QueryFn): LdapAuth {
  let connected = false;

  if (!config.url || !config.baseDn) {
    logWarn("LDAP_CONFIG_INCOMPLETE", { url: !!config.url, baseDn: !!config.baseDn });
  } else {
    logInfo("LDAP_AUTH_CONFIGURED", { url: config.url, baseDn: config.baseDn });
    connected = true;
  }

  async function authenticate(username: string, password: string): Promise<LdapAuthResult> {
    if (!connected) {
      logWarn("LDAP_NOT_CONNECTED", { message: "LDAP auth attempted but adapter is not connected — check LDAP_URL and LDAP_BASE_DN" });
      return { success: false, error: "LDAP adapter not connected" };
    }

    // Stub: in production this would perform an LDAP bind + search.
    // Hard fail in production — stub must never be used for real authentication.
    if (process.env.NODE_ENV === "production") {
      logWarn("LDAP_STUB_BLOCKED", { message: "LDAP stub authentication blocked in production — configure real LDAP provider" });
      return { success: false, error: "LDAP stub not allowed in production" };
    }
    logWarn("LDAP_STUB_MODE", { message: "Using stub LDAP implementation — replace with real ldapjs bind in production" });

    try {
      const result = await queryFn(
        `SELECT user_id, full_name, username FROM user_account
         WHERE username = $1 AND is_active = true
         LIMIT 1`,
        [username]
      );

      if (result.rows.length === 0) {
        return { success: false, error: "User not found or not provisioned" };
      }

      const user = result.rows[0];
      // In stub mode we accept any password — real impl would bind to LDAP server
      return {
        success: true,
        userId: user.user_id,
        displayName: user.full_name,
        email: user.username,
        groups: [],
      };
    } catch (err) {
      logWarn("LDAP_AUTH_ERROR", { error: (err as Error).message });
      return { success: false, error: "LDAP authentication failed" };
    }
  }

  return {
    authenticate,
    isConnected: () => connected,
  };
}
