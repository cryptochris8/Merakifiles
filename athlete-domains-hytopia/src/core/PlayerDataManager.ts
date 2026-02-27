/**
 * PlayerDataManager - Manages persistent player data via Hytopia PersistenceManager.
 *
 * Handles loading, saving, and mutating player-specific data including coins,
 * rank, stats, boosters, cosmetics, and mystery box claims.
 */

import { Player } from 'hytopia';
import { Rank, StatType, COSMETICS_CONFIG } from './GameConfig';
import type { GameModeType } from './GameConfig';

// ============================================
// Types
// ============================================

export interface ActiveBooster {
  boosterId: string;
  type: string;
  remainingGames: number;
  multiplier?: number;
  applicableGames: GameModeType[] | 'ALL';
}

export interface PlayerCosmetics {
  ownedJetskiColors: string[];
  equippedJetskiColor: string;
}

export interface PlayerData {
  coins: number;
  rank: Rank;
  stats: Record<string, number>;
  boosters: ActiveBooster[];
  cosmetics: PlayerCosmetics;
  mysteryBoxLastClaim: number;
}

// ============================================
// PlayerDataManager
// ============================================

export class PlayerDataManager {
  private static _instance: PlayerDataManager;

  /** In-memory cache of player data keyed by player ID. */
  private playerDataCache: Map<string, PlayerData> = new Map();

  private constructor() {}

  /** Singleton accessor. */
  static get instance(): PlayerDataManager {
    if (!PlayerDataManager._instance) {
      PlayerDataManager._instance = new PlayerDataManager();
    }
    return PlayerDataManager._instance;
  }

  /**
   * Creates a fresh default PlayerData object.
   */
  private createDefaultData(): PlayerData {
    const defaultColor = COSMETICS_CONFIG.jetskiColors.find(c => c.isDefault);
    return {
      coins: 0,
      rank: Rank.NONE,
      stats: {},
      boosters: [],
      cosmetics: {
        ownedJetskiColors: defaultColor ? [defaultColor.id] : ['red'],
        equippedJetskiColor: defaultColor ? defaultColor.id : 'red',
      },
      mysteryBoxLastClaim: 0,
    };
  }

  /**
   * Loads persisted data for a player into the in-memory cache.
   * Should be called when a player joins the server.
   *
   * @param player - The player whose data to load.
   * @returns The loaded (or newly created) PlayerData.
   */
  async loadPlayerData(player: Player): Promise<PlayerData> {
    const raw = player.getPersistedData();

    let data: PlayerData;

    if (raw && typeof raw.athleteDomains === 'object' && raw.athleteDomains !== null) {
      const saved = raw.athleteDomains as Record<string, unknown>;
      const defaults = this.createDefaultData();

      data = {
        coins: typeof saved.coins === 'number' ? saved.coins : defaults.coins,
        rank: Object.values(Rank).includes(saved.rank as Rank) ? (saved.rank as Rank) : defaults.rank,
        stats: (typeof saved.stats === 'object' && saved.stats !== null
          ? saved.stats
          : defaults.stats) as Record<string, number>,
        boosters: Array.isArray(saved.boosters) ? (saved.boosters as ActiveBooster[]) : defaults.boosters,
        cosmetics: (typeof saved.cosmetics === 'object' && saved.cosmetics !== null
          ? {
              ownedJetskiColors: Array.isArray((saved.cosmetics as any).ownedJetskiColors)
                ? (saved.cosmetics as any).ownedJetskiColors
                : defaults.cosmetics.ownedJetskiColors,
              equippedJetskiColor: typeof (saved.cosmetics as any).equippedJetskiColor === 'string'
                ? (saved.cosmetics as any).equippedJetskiColor
                : defaults.cosmetics.equippedJetskiColor,
            }
          : defaults.cosmetics),
        mysteryBoxLastClaim: typeof saved.mysteryBoxLastClaim === 'number'
          ? saved.mysteryBoxLastClaim
          : defaults.mysteryBoxLastClaim,
      };
    } else {
      data = this.createDefaultData();
    }

    this.playerDataCache.set(player.id, data);
    return data;
  }

  /**
   * Persists the in-memory player data to the Hytopia persistence layer.
   *
   * @param player - The player whose data to save.
   */
  savePlayerData(player: Player): void {
    const data = this.playerDataCache.get(player.id);
    if (!data) return;

    player.setPersistedData({ athleteDomains: data as unknown as Record<string, unknown> });
  }

  /**
   * Returns the cached data for a player, or undefined if not loaded.
   *
   * @param player - The player to look up.
   */
  getPlayerData(player: Player): PlayerData | undefined {
    return this.playerDataCache.get(player.id);
  }

  /**
   * Adds coins to a player's balance and persists the change.
   *
   * @param player - The target player.
   * @param amount - The number of coins to add (can be negative for spending).
   * @returns The new coin balance, or -1 if data not loaded.
   */
  addCoins(player: Player, amount: number): number {
    const data = this.playerDataCache.get(player.id);
    if (!data) return -1;

    data.coins = Math.max(0, data.coins + amount);
    this.savePlayerData(player);
    return data.coins;
  }

  /**
   * Gets the value of a specific stat for a player.
   *
   * @param player - The target player.
   * @param stat - The stat type to retrieve.
   * @returns The stat value, or 0 if not set.
   */
  getStat(player: Player, stat: StatType): number {
    const data = this.playerDataCache.get(player.id);
    if (!data) return 0;
    return data.stats[stat] ?? 0;
  }

  /**
   * Increments a stat by a given amount (default 1) and persists.
   *
   * @param player - The target player.
   * @param stat - The stat type to increment.
   * @param amount - The amount to add (default 1).
   * @returns The new stat value.
   */
  incrementStat(player: Player, stat: StatType, amount: number = 1): number {
    const data = this.playerDataCache.get(player.id);
    if (!data) return 0;

    const current = data.stats[stat] ?? 0;
    data.stats[stat] = current + amount;
    this.savePlayerData(player);
    return data.stats[stat];
  }

  /**
   * Sets a high score stat if the new value exceeds the current value.
   *
   * @param player - The target player.
   * @param stat - The stat type representing a high score.
   * @param score - The new score to compare.
   * @returns True if a new high score was set.
   */
  setHighScore(player: Player, stat: StatType, score: number): boolean {
    const data = this.playerDataCache.get(player.id);
    if (!data) return false;

    const current = data.stats[stat] ?? 0;
    if (score > current) {
      data.stats[stat] = score;
      this.savePlayerData(player);
      return true;
    }
    return false;
  }

  /**
   * Adds a booster to the player's active boosters.
   *
   * @param player - The target player.
   * @param booster - The booster to add.
   */
  addBooster(player: Player, booster: ActiveBooster): void {
    const data = this.playerDataCache.get(player.id);
    if (!data) return;

    data.boosters.push(booster);
    this.savePlayerData(player);
  }

  /**
   * Consumes one use of any applicable boosters for a game mode.
   * Returns all active boosters that applied.
   *
   * @param player - The target player.
   * @param gameMode - The game mode being played.
   * @returns Array of boosters that were consumed.
   */
  consumeBoosters(player: Player, gameMode: GameModeType): ActiveBooster[] {
    const data = this.playerDataCache.get(player.id);
    if (!data) return [];

    const consumed: ActiveBooster[] = [];

    data.boosters = data.boosters.filter(booster => {
      const applies =
        booster.applicableGames === 'ALL' ||
        booster.applicableGames.includes(gameMode);

      if (applies && booster.remainingGames > 0) {
        booster.remainingGames -= 1;
        consumed.push({ ...booster });
        return booster.remainingGames > 0;
      }
      return true;
    });

    if (consumed.length > 0) {
      this.savePlayerData(player);
    }

    return consumed;
  }

  /**
   * Unlocks a jetski color cosmetic for the player.
   *
   * @param player - The target player.
   * @param colorId - The color ID to unlock.
   * @returns True if successfully unlocked (was not already owned).
   */
  unlockJetskiColor(player: Player, colorId: string): boolean {
    const data = this.playerDataCache.get(player.id);
    if (!data) return false;

    if (data.cosmetics.ownedJetskiColors.includes(colorId)) return false;

    data.cosmetics.ownedJetskiColors.push(colorId);
    this.savePlayerData(player);
    return true;
  }

  /**
   * Equips a jetski color cosmetic for the player.
   *
   * @param player - The target player.
   * @param colorId - The color ID to equip (must be owned).
   * @returns True if successfully equipped.
   */
  equipJetskiColor(player: Player, colorId: string): boolean {
    const data = this.playerDataCache.get(player.id);
    if (!data) return false;

    if (!data.cosmetics.ownedJetskiColors.includes(colorId)) return false;

    data.cosmetics.equippedJetskiColor = colorId;
    this.savePlayerData(player);
    return true;
  }

  /**
   * Updates the mystery box last claim timestamp.
   *
   * @param player - The target player.
   */
  claimMysteryBox(player: Player): void {
    const data = this.playerDataCache.get(player.id);
    if (!data) return;

    data.mysteryBoxLastClaim = Date.now();
    this.savePlayerData(player);
  }

  /**
   * Checks whether the player can claim a free mystery box.
   *
   * @param player - The target player.
   * @param freeEveryMs - The cooldown duration in milliseconds.
   * @returns True if the cooldown has elapsed.
   */
  canClaimMysteryBox(player: Player, freeEveryMs: number): boolean {
    const data = this.playerDataCache.get(player.id);
    if (!data) return false;

    return Date.now() - data.mysteryBoxLastClaim >= freeEveryMs;
  }

  /**
   * Removes the cached data for a player. Call on disconnect.
   *
   * @param player - The player to remove from cache.
   */
  removePlayerData(player: Player): void {
    this.playerDataCache.delete(player.id);
  }
}
