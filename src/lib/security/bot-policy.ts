export type BotVerification = {
  success: boolean;
  hostname?: string;
  action?: string;
  challenge_ts?: string;
};

export function isValidBotVerification(
  result: BotVerification,
  expected: { hostname: string; action: string; now?: number },
): boolean {
  const challengedAt = result.challenge_ts ? Date.parse(result.challenge_ts) : Number.NaN;
  return Boolean(
    result.success &&
    result.hostname === expected.hostname &&
    result.action === expected.action &&
    Number.isFinite(challengedAt) &&
    Math.abs((expected.now ?? Date.now()) - challengedAt) <= 5 * 60_000,
  );
}
