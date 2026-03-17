/** Result of a connector fetch operation. */
export interface ConnectorResult {
  items: ConnectorItem[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface ConnectorItem {
  externalId: string;
  source: string;
  contentType: string;
  rawData: Record<string, unknown>;
  fetchedAt: Date;
}

/**
 * Interface that every external data connector must implement.
 * Apps provide their own connector implementations (e.g., Twitter, Facebook)
 * that conform to this interface.
 */
export interface ExternalConnector {
  /** Unique identifier for this connector (e.g., "twitter", "facebook"). */
  name: string;

  /** Whether this connector is currently enabled. */
  isEnabled(): boolean | Promise<boolean>;

  /**
   * Fetch a batch of items from the external source.
   * @param cursor Optional pagination cursor from a previous fetch.
   */
  fetch(cursor?: string): Promise<ConnectorResult>;

  /**
   * Optional health check for the external service.
   * Returns true if the service is reachable.
   */
  healthCheck?(): Promise<boolean>;
}
