import type { PlayerRecord, PowerUpToken } from "../types";

// Extension point only. The power-up catalogue (effects, limits, timing) is being designed
// separately, so correct answers to bonus questions 1-4 grant an "unassigned" token that has no
// effect yet. To add power-ups later:
//   1. register definitions in POWER_UPS below;
//   2. decide in grantPowerUp which kind a correct answer awards;
//   3. accept a token id on the submit endpoint and apply the effect inside the
//      resolution step (src/lib/game/resolve.ts), which is the only place balances change.

export interface PowerUpDefinition {
  kind: string;
  name: string;
  description: string;
}

export const UNASSIGNED_KIND = "unassigned";

export const POWER_UPS: Record<string, PowerUpDefinition> = {
  [UNASSIGNED_KIND]: {
    kind: UNASSIGNED_KIND,
    name: "Power-up token",
    description: "Earned for a correct bonus answer. Its effect has not been assigned yet.",
  },
};

export function grantPowerUp(player: PlayerRecord, source: string, itemIndex: number): PowerUpToken {
  const token: PowerUpToken = {
    tokenId: `${source}-${player.id}`,
    kind: UNASSIGNED_KIND,
    source,
    grantedAtItem: itemIndex,
  };
  player.inventory.push(token);
  return token;
}
