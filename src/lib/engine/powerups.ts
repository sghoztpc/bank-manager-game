import { POWER_UP, vnd } from "../config";
import type { PlayerRecord, PowerUpToken } from "../types";

// A correct answer to quizzes 1-4 grants a "boost" token: +10% on what the player's next correct
// case decision earns. Tokens are used automatically, oldest first, one per correct decision,
// inside the resolution step (src/lib/game/resolve.ts), the only place balances change.

export interface PowerUpDefinition {
  kind: string;
  name: string;
  description: string;
}

export const BOOST_KIND = "boost";

export const POWER_UPS: Record<string, PowerUpDefinition> = {
  [BOOST_KIND]: {
    kind: BOOST_KIND,
    name: `+${POWER_UP.boostPct * 100}% boost`,
    description: `Adds ${POWER_UP.boostPct * 100}% to what your next correct decision earns.`,
  },
};

export function grantPowerUp(player: PlayerRecord, source: string, itemIndex: number): PowerUpToken {
  const token: PowerUpToken = {
    tokenId: `${source}-${player.id}`,
    kind: BOOST_KIND,
    source,
    grantedAtItem: itemIndex,
    usedAtItem: null,
  };
  player.inventory.push(token);
  return token;
}

export const unusedPowerUps = (player: Pick<PlayerRecord, "inventory">) => player.inventory.filter((t) => t.usedAtItem === null);

/**
 * Called for a correct decision that earned `earned` VND: uses the oldest waiting token, if any,
 * and returns the boost to add (0 when there is no token).
 */
export function useBoost(player: PlayerRecord, earned: number, itemIndex: number): number {
  const token = unusedPowerUps(player)[0];
  if (!token || earned <= 0) return 0;
  token.usedAtItem = itemIndex;
  return vnd(earned * POWER_UP.boostPct);
}
