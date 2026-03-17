/** Configuration for OIDC authentication (Phase 2). */
export interface OidcConfig {
  issuerUrl: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  claimMapping?: {
    userId?: string;
    userType?: string;
    roles?: string;
    unitId?: string;
  };
}
