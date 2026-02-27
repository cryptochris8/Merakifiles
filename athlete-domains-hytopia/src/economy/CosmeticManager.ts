/**
 * Athlete Domains - Cosmetic Manager
 * Manages jetski cosmetic colors: purchasing, equipping, and querying.
 */

import type { Player } from 'hytopia';
import {
  Rank,
  COSMETICS_CONFIG,
  BOOSTERS_CONFIG,
} from '../core/GameConfig';

// ============================================
// TYPES
// ============================================

export interface JetskiCosmeticConfig {
  id: string;
  name: string;
  color: string;
  price: number;
  isDefault: boolean;
}

export interface PlayerCosmeticData {
  ownedJetskis: Set<string>;
  equippedJetski: string;
}

// ============================================
// COSMETIC MANAGER (SINGLETON)
// ============================================

export class CosmeticManager {
  private static _instance: CosmeticManager;

  /** Per-player cosmetic state keyed by player id. */
  private playerCosmetics: Map<string, PlayerCosmeticData> = new Map();

  private constructor() {}

  public static get instance(): CosmeticManager {
    if (!CosmeticManager._instance) {
      CosmeticManager._instance = new CosmeticManager();
    }
    return CosmeticManager._instance;
  }

  // ------------------------------------------
  // INITIALIZATION / CLEANUP
  // ------------------------------------------

  /**
   * Initialize cosmetic data for a player, restoring from persisted data if available.
   * Every player owns the default red jetski.
   */
  public initPlayer(player: Player): void {
    const persisted = player.getPersistedData();
    const saved = persisted?.cosmetics as Partial<{
      ownedJetskis: string[];
      equippedJetski: string;
    }> | undefined;

    // Default jetski is always owned
    const defaultJetski = COSMETICS_CONFIG.jetskiColors.find((c) => c.isDefault);
    const defaultId = defaultJetski?.id ?? 'red';

    const ownedJetskis = new Set<string>(saved?.ownedJetskis ?? [defaultId]);
    // Ensure default is always in the set
    ownedJetskis.add(defaultId);

    const equippedJetski = saved?.equippedJetski ?? defaultId;

    this.playerCosmetics.set(player.id, {
      ownedJetskis,
      equippedJetski,
    });
  }

  /**
   * Persist and clean up cosmetic data when a player leaves.
   */
  public cleanupPlayer(player: Player): void {
    const data = this.playerCosmetics.get(player.id);
    if (data) {
      this.persistPlayerData(player, data);
      this.playerCosmetics.delete(player.id);
    }
  }

  /**
   * Save cosmetic data to player persisted data.
   */
  private persistPlayerData(player: Player, data: PlayerCosmeticData): void {
    player.setPersistedData({
      cosmetics: {
        ownedJetskis: Array.from(data.ownedJetskis),
        equippedJetski: data.equippedJetski,
      },
    });
  }

  // ------------------------------------------
  // PRICING & DISCOUNTS
  // ------------------------------------------

  /**
   * Calculate the price of a jetski cosmetic for a player, applying rank discounts.
   *
   * - Default (red) jetski is always free.
   * - Medalist rank gets 100% discount (free).
   * - Athlete rank gets 90% discount (same as booster discount).
   */
  public getPrice(cosmeticId: string, playerRank: Rank): number {
    const config = COSMETICS_CONFIG.jetskiColors.find((c) => c.id === cosmeticId);
    if (!config) return 0;

    // Default cosmetic is always free
    if (config.isDefault) return 0;

    const basePrice = config.price;

    // Medalist gets 100% discount (free)
    if (playerRank === Rank.MEDALIST) {
      return 0;
    }

    // Athlete gets 90% discount (same as booster discount)
    if (playerRank === Rank.ATHLETE) {
      const discountFraction = BOOSTERS_CONFIG.discountPercent / 100;
      return Math.floor(basePrice * (1 - discountFraction));
    }

    return basePrice;
  }

  // ------------------------------------------
  // PURCHASING
  // ------------------------------------------

  /**
   * Attempt to buy a jetski cosmetic for a player.
   * Returns true on success.
   *
   * @param player - The purchasing player.
   * @param cosmeticId - The jetski color id to purchase.
   * @param playerRank - The player's current rank.
   * @param playerCoins - The player's current coin balance.
   * @param deductCoins - Callback to deduct coins. Returns true if successful.
   */
  public buyCosmetic(
    player: Player,
    cosmeticId: string,
    playerRank: Rank,
    playerCoins: number,
    deductCoins: (amount: number) => boolean,
  ): boolean {
    const config = COSMETICS_CONFIG.jetskiColors.find((c) => c.id === cosmeticId);
    if (!config) {
      player.ui.sendData({
        type: 'cosmetic:error',
        message: 'Invalid cosmetic.',
      });
      return false;
    }

    const data = this.playerCosmetics.get(player.id);
    if (!data) return false;

    // Already owned
    if (data.ownedJetskis.has(cosmeticId)) {
      player.ui.sendData({
        type: 'cosmetic:error',
        message: `You already own the ${config.name}!`,
      });
      return false;
    }

    const price = this.getPrice(cosmeticId, playerRank);

    if (price > 0 && playerCoins < price) {
      player.ui.sendData({
        type: 'cosmetic:error',
        message: `Not enough coins! You need ${price} coins for the ${config.name}.`,
      });
      return false;
    }

    if (price > 0 && !deductCoins(price)) return false;

    // Add to owned
    data.ownedJetskis.add(cosmeticId);
    this.persistPlayerData(player, data);

    player.ui.sendData({
      type: 'cosmetic:purchased',
      cosmeticId,
      cosmeticName: config.name,
      price,
    });

    return true;
  }

  // ------------------------------------------
  // EQUIPPING
  // ------------------------------------------

  /**
   * Equip a jetski cosmetic (must already be owned).
   */
  public equipCosmetic(player: Player, cosmeticId: string): boolean {
    const config = COSMETICS_CONFIG.jetskiColors.find((c) => c.id === cosmeticId);
    if (!config) {
      player.ui.sendData({
        type: 'cosmetic:error',
        message: 'Invalid cosmetic.',
      });
      return false;
    }

    const data = this.playerCosmetics.get(player.id);
    if (!data) return false;

    if (!data.ownedJetskis.has(cosmeticId)) {
      player.ui.sendData({
        type: 'cosmetic:error',
        message: `You don't own the ${config.name}. Purchase it first!`,
      });
      return false;
    }

    data.equippedJetski = cosmeticId;
    this.persistPlayerData(player, data);

    player.ui.sendData({
      type: 'cosmetic:equipped',
      cosmeticId,
      cosmeticName: config.name,
      cosmeticColor: config.color,
    });

    return true;
  }

  // ------------------------------------------
  // QUERIES
  // ------------------------------------------

  /**
   * Get the currently equipped jetski cosmetic for a player.
   */
  public getEquippedJetski(playerId: string): JetskiCosmeticConfig | null {
    const data = this.playerCosmetics.get(playerId);
    if (!data) return null;

    return COSMETICS_CONFIG.jetskiColors.find((c) => c.id === data.equippedJetski) ?? null;
  }

  /**
   * Get the equipped jetski color hex string for a player.
   */
  public getEquippedJetskiColor(playerId: string): string {
    const equipped = this.getEquippedJetski(playerId);
    return equipped?.color ?? '#FF5555'; // Default to red
  }

  /**
   * Get all owned cosmetic IDs for a player.
   */
  public getOwnedCosmetics(playerId: string): string[] {
    const data = this.playerCosmetics.get(playerId);
    if (!data) return [];
    return Array.from(data.ownedJetskis);
  }

  /**
   * Get all jetski cosmetics for shop display with ownership and pricing info.
   */
  public getShopItems(
    playerId: string,
    playerRank: Rank,
  ): {
    cosmeticId: string;
    name: string;
    color: string;
    price: number;
    isOwned: boolean;
    isEquipped: boolean;
    isDefault: boolean;
  }[] {
    const data = this.playerCosmetics.get(playerId);

    return COSMETICS_CONFIG.jetskiColors.map((config) => ({
      cosmeticId: config.id,
      name: config.name,
      color: config.color,
      price: this.getPrice(config.id, playerRank),
      isOwned: (data?.ownedJetskis.has(config.id)) ?? config.isDefault,
      isEquipped: data?.equippedJetski === config.id,
      isDefault: config.isDefault,
    }));
  }
}
