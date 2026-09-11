/** Preserve desktop defaults; constrain parallel Chrome tabs on a small server. */
export function awardConcurrency(): number {
  const value = Number(process.env.AWARD_CONCURRENCY);
  return Number.isInteger(value) && value >= 1 && value <= 6 ? value : 6;
}
