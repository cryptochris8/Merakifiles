/**
 * Athlete Domains - Booster Manager
 * Manages cafe boosters, ice cream boosters, and mystery boxes for players.
 */

import type { Player } from 'hytopia';
import {
  GameModeType,
  Rank,
  RANK_CONFIG,
  BOOSTERS_CONFIG,
} from '../core/GameConfig';

// ============================================
// TYPES
// ============================================

export type BoosterId = keyof typeof BOOSTERS_CONFIG.items;

export interface OwnedBooster {
  boosterId: BoosterId;
  quantity: number;
}

export interface ActiveBooster {
  boosterId: BoosterId;
  activatedAt: number;
  /** For speed boosters: duration in ms (10 seconds at game start). */
  durationMs: number;
  /** For risk boosters: outcome multiplier set after game ends. */
  riskOutcome?: number;
}

export interface PlayerBoosterData {
  owned: Map<BoosterId, number>;
  active: ActiveBooster[];
  lastMysteryBoxClaim: number;
}

// ============================================
// BOOSTER MANAGER (SINGLETON)
// ============================================

export class BoosterManager {
  private static _instance: BoosterManager;

  /** Per-player booster state keyed by player id. */
  private playerBoosters: Map<string, PlayerBoosterData> = new Map();

  private constructor() {}

  public static get instance(): BoosterManager {
    if (!BoosterManager._instance) {
      BoosterManager._instance = new BoosterManager();
    }
    return BoosterManager._instance;
  }

  // ------------------------------------------
  // INITIALIZATION / CLEANUP
  // ------------------------------------------

  /**
   * Initialize booster data for a player, restoring from persisted data if available.
   */
  public initPlayer(player: Player): void {
    const persisted = player.getPersistedData();
    const saved = persisted?.boosters as Partial<{
      owned: Record<string, number>;
      lastMysteryBoxClaim: number;
    }> | undefined;

    const owned = new Map<BoosterId, number>();
    if (saved?.owned) {
      for (const [key, qty] of Object.entries(saved.owned)) {
        owned.set(key as BoosterId, qty);
      }
    }

    this.playerBoosters.set(player.id, {
      owned,
      active: [],
      lastMysteryBoxClaim: saved?.lastMysteryBoxClaim ?? 0,
    });
  }

  /**
   * Persist and clean up booster data when a player leaves.
   */
  public cleanupPlayer(player: Player): void {
    const data = this.playerBoosters.get(player.id);
    if (data) {
      this.persistPlayerData(player, data);
      this.playerBoosters.delete(player.id);
    }
  }

  /**
   * Save booster inventory to player persisted data.
   */
  private persistPlayerData(player: Player, data: PlayerBoosterData): void {
    const ownedObj: Record<string, number> = {};
    for (const [id, qty] of data.owned) {
      if (qty > 0) ownedObj[id] = qty;
    }
    player.setPersistedData({
      boosters: {
        owned: ownedObj,
        lastMysteryBoxClaim: data.lastMysteryBoxClaim,
      },
    });
  }

  // ------------------------------------------
  // PRICING & DISCOUNTS
  // ------------------------------------------

  /**
   * Calculate the final price of a booster for a player, applying rank discounts.
   * Athlete and Medalist ranks receive a 90% discount (pay only 10%).
   */
  public getPrice(boosterId: BoosterId, playerRank: Rank): number {
    const config = BOOSTERS_CONFIG.items[boosterId];
    if (!config) return 0;

    const basePrice = config.price;

    // Mystery box: free once per day, otherwise full price (no rank discount)
    if (boosterId === 'mysteryBox') {
      return basePrice;
    }

    // Rank discount for Athlete and Medalist
    if (playerRank === Rank.ATHLETE || playerRank === Rank.MEDALIST) {
      const discountFraction = BOOSTERS_CONFIG.discountPercent / 100;
      return Math.floor(basePrice * (1 - discountFraction));
    }

    return basePrice;
  }

  /**
   * Check if the mystery box free daily claim is available.
   */
  public isMysteryBoxFreeToday(playerId: string): boolean {
    const data = this.playerBoosters.get(playerId);
    if (!data) return false;

    const freeEveryMs = (BOOSTERS_CONFIG.items.mysteryBox as any).freeEveryMs ?? 86400000;
    return Date.now() - data.lastMysteryBoxClaim >= freeEveryMs;
  }

  // ------------------------------------------
  // PURCHASING
  // ------------------------------------------

  /**
   * Attempt to buy a booster for a player.
   * Returns true on success, false if insufficient funds or invalid booster.
   *
   * @param player - The purchasing player.
   * @param boosterId - The booster to purchase.
   * @param playerRank - The player's current rank.
   * @param playerCoins - The player's current coin balance.
   * @param deductCoins - Callback to deduct coins from the player's balance. Returns true if successful.
   */
  public buyBooster(
    player: Player,
    boosterId: BoosterId,
    playerRank: Rank,
    playerCoins: number,
    deductCoins: (amount: number) => boolean,
  ): boolean {
    const config = BOOSTERS_CONFIG.items[boosterId];
    if (!config) return false;

    const data = this.playerBoosters.get(player.id);
    if (!data) return false;

    // Handle mystery box
    if (boosterId === 'mysteryBox') {
      return this.handleMysteryBoxPurchase(player, data, playerCoins, deductCoins);
    }

    const price = this.getPrice(boosterId, playerRank);

    if (playerCoins < price) {
      player.ui.sendData({
        type: 'shop:error',
        message: `Not enough coins! You need ${price} coins.`,
      });
      return false;
    }

    if (!deductCoins(price)) return false;

    // Add booster to inventory
    const currentQty = data.owned.get(boosterId) ?? 0;
    data.owned.set(boosterId, currentQty + 1);

    this.persistPlayerData(player, data);

    player.ui.sendData({
      type: 'shop:purchased',
      boosterId,
      boosterName: config.name,
      price,
      newQuantity: currentQty + 1,
    });

    return true;
  }

  /**
   * Handle mystery box purchase with daily free logic.
   */
  private handleMysteryBoxPurchase(
    player: Player,
    data: PlayerBoosterData,
    playerCoins: number,
    deductCoins: (amount: number) => boolean,
  ): boolean {
    const isFree = this.isMysteryBoxFreeToday(player.id);
    const price = isFree ? 0 : BOOSTERS_CONFIG.items.mysteryBox.price;

    if (!isFree && playerCoins < price) {
      player.ui.sendData({
        type: 'shop:error',
        message: `Not enough coins! Mystery Box costs ${price} coins.`,
      });
      return false;
    }

    if (price > 0 && !deductCoins(price)) return false;

    // Record claim time
    data.lastMysteryBoxClaim = Date.now();

    // Award a random booster (excluding mystery box itself)
    const boosterKeys = Object.keys(BOOSTERS_CONFIG.items).filter(
      (k) => k !== 'mysteryBox',
    ) as BoosterId[];
    const randomKey = boosterKeys[Math.floor(Math.random() * boosterKeys.length)];
    const randomConfig = BOOSTERS_CONFIG.items[randomKey];

    const currentQty = data.owned.get(randomKey) ?? 0;
    data.owned.set(randomKey, currentQty + 1);

    this.persistPlayerData(player, data);

    player.ui.sendData({
      type: 'shop:mystery_box_opened',
      receivedBoosterId: randomKey,
      receivedBoosterName: randomConfig.name,
      wasFree: isFree,
    });

    return true;
  }

  // ------------------------------------------
  // CONSUMING & ACTIVATING
  // ------------------------------------------

  /**
   * Consume a booster from inventory (used before a game starts).
   * Removes one from inventory and marks it ready to activate.
   */
  public consumeBooster(player: Player, boosterId: BoosterId): boolean {
    const data = this.playerBoosters.get(player.id);
    if (!data) return false;

    const currentQty = data.owned.get(boosterId) ?? 0;
    if (currentQty <= 0) {
      player.ui.sendData({
        type: 'booster:error',
        message: `You don't have any ${BOOSTERS_CONFIG.items[boosterId]?.name ?? boosterId} boosters.`,
      });
      return false;
    }

    data.owned.set(boosterId, currentQty - 1);
    this.persistPlayerData(player, data);
    return true;
  }

  /**
   * Activate a consumed booster at the start of a game.
   * Speed boosters last 10 seconds. Multiplier and risk boosters last the full game.
   */
  public activateBooster(player: Player, boosterId: BoosterId): boolean {
    const data = this.playerBoosters.get(player.id);
    if (!data) return false;

    const config = BOOSTERS_CONFIG.items[boosterId];
    if (!config) return false;

    const active: ActiveBooster = {
      boosterId,
      activatedAt: Date.now(),
      durationMs: config.type === 'speed' ? 10_000 : Infinity,
    };

    data.active.push(active);

    player.ui.sendData({
      type: 'booster:activated',
      boosterId,
      boosterName: config.name,
      boosterType: config.type,
    });

    return true;
  }

  /**
   * Deactivate all boosters for a player (call at game end).
   */
  public deactivateAll(playerId: string): void {
    const data = this.playerBoosters.get(playerId);
    if (data) {
      data.active = [];
    }
  }

  // ------------------------------------------
  // QUERIES
  // ------------------------------------------

  /**
   * Get all currently active boosters for a player that apply to a specific game mode.
   */
  public getActiveBoostersForGame(
    playerId: string,
    gameMode: GameModeType,
  ): ActiveBooster[] {
    const data = this.playerBoosters.get(playerId);
    if (!data) return [];

    const now = Date.now();

    return data.active.filter((ab) => {
      const config = BOOSTERS_CONFIG.items[ab.boosterId];
      if (!config) return false;

      // Check if still active (speed boosters expire)
      if (ab.durationMs !== Infinity && now - ab.activatedAt > ab.durationMs) {
        return false;
      }

      // Check game applicability
      const games = 'games' in config ? (config as any).games : undefined;
      if (games === 'ALL') return true;
      if (Array.isArray(games)) return games.includes(gameMode);

      return false;
    });
  }

  /**
   * Check if a speed booster is currently active (within the first 10 seconds).
   */
  public isSpeedBoostActive(playerId: string, gameMode: GameModeType): boolean {
    const active = this.getActiveBoostersForGame(playerId, gameMode);
    return active.some((ab) => {
      const config = BOOSTERS_CONFIG.items[ab.boosterId];
      return config?.type === 'speed' && Date.now() - ab.activatedAt <= ab.durationMs;
    });
  }

  /**
   * Calculate the total reward multiplier from all active boosters for a game.
   * Base multiplier is 1.0.
   *
   * - Ice cream (multiplier) boosters add +0.05 each.
   * - Muffin (risk) booster: if the player won, multiply by 1.10; if lost, multiply by 0.90.
   *
   * @param playerId - The player's id.
   * @param gameMode - The current game mode.
   * @param didWin - Whether the player won (used for risk booster calculation).
   * @returns The final reward multiplier.
   */
  public calculateRewardMultiplier(
    playerId: string,
    gameMode: GameModeType,
    didWin: boolean,
  ): number {
    const active = this.getActiveBoostersForGame(playerId, gameMode);
    let multiplier = 1.0;

    for (const ab of active) {
      const config = BOOSTERS_CONFIG.items[ab.boosterId] as any;
      if (!config) continue;

      if (config.type === 'multiplier' && typeof config.multiplier === 'number') {
        // Ice cream boosters: add the multiplier bonus (e.g., +0.05)
        multiplier += config.multiplier;
      } else if (config.type === 'risk') {
        // Muffin risk booster: win = 1.10x, lose = 0.90x
        multiplier *= didWin ? 1.10 : 0.90;
      }
      // Speed boosters do not affect reward multiplier
    }

    return multiplier;
  }

  /**
   * Get the player's booster inventory for display in the shop UI.
   */
  public getInventory(playerId: string): { boosterId: BoosterId; name: string; quantity: number }[] {
    const data = this.playerBoosters.get(playerId);
    if (!data) return [];

    const result: { boosterId: BoosterId; name: string; quantity: number }[] = [];
    for (const [boosterId, qty] of data.owned) {
      if (qty > 0) {
        const config = BOOSTERS_CONFIG.items[boosterId];
        result.push({
          boosterId,
          name: config?.name ?? boosterId,
          quantity: qty,
        });
      }
    }
    return result;
  }

  /**
   * Get all booster items for shop display with prices computed for a given rank.
   */
  public getShopItems(playerRank: Rank): {
    boosterId: BoosterId;
    name: string;
    price: number;
    type: string;
    games: string;
  }[] {
    const items: {
      boosterId: BoosterId;
      name: string;
      price: number;
      type: string;
      games: string;
    }[] = [];

    for (const [key, config] of Object.entries(BOOSTERS_CONFIG.items)) {
      const boosterId = key as BoosterId;
      const price = this.getPrice(boosterId, playerRank);
      const games = 'games' in config ? (config as any).games : undefined;
      const gamesStr =
        games === 'ALL'
          ? 'All Games'
          : Array.isArray(games)
            ? games.join(', ')
            : 'Special';

      items.push({
        boosterId,
        name: config.name,
        price,
        type: config.type,
        games: gamesStr,
      });
    }

    return items;
  }
}
