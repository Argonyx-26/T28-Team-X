/** Retry policy for the read queue: network drops (status 0) and 429 slow-downs wait and try again; everything
 * else is a real answer from the API and is shown as it is. Pure, so it is testable. */

export const BACKOFF_MS = [1000, 3000, 8000] as const;

/** Whether an API failure with this status is worth another attempt, and how long to wait first (null = give up). */
export function retryDelay(status: number, attempt: number): number | null {
  if (status !== 0 && status !== 429) return null;
  return attempt < BACKOFF_MS.length ? BACKOFF_MS[attempt] : null;
}
