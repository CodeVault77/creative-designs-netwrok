/**
 * Quotas.
 *
 * Not a monetisation lever — ADR-0005 defers payments, so there is no paid
 * tier for these to gate. They are an abuse ceiling: without them one script
 * can fill the database, and the cost of that lands on every other user.
 *
 * Set high enough that a real person never meets one. §17 caps the RENDERER
 * at 300 nodes; the storage limit sits well above that so nobody hits a wall
 * while building something legitimate.
 *
 * Numbers live here, in one place, so raising them is a one-line change rather
 * than a hunt through route handlers.
 */

export const QUOTAS = {
  /** Maps one account may own. */
  mapsPerUser: 50,
  /** Nodes in one map. Comfortably above the 300-node render budget. */
  nodesPerMap: 1000,
  /** Bytes for a single uploaded image. */
  assetBytes: 5 * 1024 * 1024,
  /** Total upload bytes per account. */
  assetBytesPerUser: 100 * 1024 * 1024,
} as const;

export interface QuotaFailure {
  quota: keyof typeof QUOTAS;
  limit: number;
  message: string;
}

export function checkMapQuota(current: number): QuotaFailure | null {
  if (current < QUOTAS.mapsPerUser) return null;
  return {
    quota: 'mapsPerUser',
    limit: QUOTAS.mapsPerUser,
    // Says what to do next, not just that something is refused.
    message: `You have reached ${QUOTAS.mapsPerUser} maps. Delete one to make room, or get in touch if you need more.`,
  };
}

export function checkNodeQuota(current: number): QuotaFailure | null {
  if (current <= QUOTAS.nodesPerMap) return null;
  return {
    quota: 'nodesPerMap',
    limit: QUOTAS.nodesPerMap,
    message: `A map can hold ${QUOTAS.nodesPerMap} nodes. Split this into two maps and link them.`,
  };
}

export function checkAssetQuota(
  bytes: number,
  usedBytes: number,
): QuotaFailure | null {
  if (bytes > QUOTAS.assetBytes) {
    return {
      quota: 'assetBytes',
      limit: QUOTAS.assetBytes,
      message: `Images must be under ${Math.round(QUOTAS.assetBytes / 1024 / 1024)} MB.`,
    };
  }
  if (usedBytes + bytes > QUOTAS.assetBytesPerUser) {
    return {
      quota: 'assetBytesPerUser',
      limit: QUOTAS.assetBytesPerUser,
      message:
        'You have used all your image storage. Delete some images to make room.',
    };
  }
  return null;
}
