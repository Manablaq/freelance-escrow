/**
 * Pure guard used before and after asynchronous transaction confirmation reads.
 * @param {number} startedVersion
 * @param {number} currentVersion
 * @param {AbortSignal} signal
 */
export function canApplyScopeResult(startedVersion, currentVersion, signal) {
  return !signal.aborted && startedVersion === currentVersion;
}
