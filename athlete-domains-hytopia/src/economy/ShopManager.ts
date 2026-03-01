/**
 * Athlete Domains - Shop Manager
 * Handles NPC shop interactions for the Cafe and Ice Cream Stand.
 * Places NPC entities in the world and manages UI-driven buy/consume flows.
 */

import {
  Entity,
  Player,
  PlayerEvent,
  PlayerUIEvent,
  RigidBodyType,
  SceneUI,
  type World,
} from 'hytopia';
import {
  GameModeType,
  Rank,
  LOBBY_CONFIG,
  BOOSTERS_CONFIG,
} from '../core/GameConfig';
import { BoosterManager, type BoosterId } from './BoosterManager';
import { CosmeticManager } from './CosmeticManager';

// ============================================
// NPC PLACEMENT CONFIG
// ============================================

/** Cafe NPC location in the city near the stadium. */
const CAFE_NPC_POSITION = { x: 5.5, y: 24.0, z: -585.0 };

/** Ice cream stand NPCs in the city near the stadium. */
const ICE_CREAM_NPC_POSITIONS = [
  { x: -8.5, y: 24.0, z: -585.0 },
  { x: -5.5, y: 24.0, z: -585.0 },
];

// ============================================
// SHOP NPC MODELS
// ============================================

const CAFE_NPC_MODEL = 'models/players/player.gltf';
const ICE_CREAM_NPC_MODEL = 'models/players/player.gltf';

// ============================================
// TYPES
// ============================================

/** Cafe booster IDs (speed + risk boosters). */
const CAFE_BOOSTER_IDS: BoosterId[] = [
  'cappuccino',
  'latte',
  'espresso',
  'muffin',
  'mysteryBox',
];

/** Ice cream booster IDs (multiplier boosters). */
const ICE_CREAM_BOOSTER_IDS: BoosterId[] = [
  'vanillaIceCream',
  'chocolateIceCream',
  'chocolateChipCookieIceCream',
  'strawberryIceCream',
  'caramelIceCream',
];

export interface PlayerEconomyState {
  coins: number;
  rank: Rank;
}

// ============================================
// SHOP MANAGER (SINGLETON)
// ============================================

export class ShopManager {
  private static _instance: ShopManager;

  private world: World | null = null;
  private cafeNpc: Entity | null = null;
  private iceCreamNpcs: Entity[] = [];

  /**
   * Callback to get a player's current economy state (coins and rank).
   * Must be set by the GameManager or PlayerDataManager before shops can work.
   */
  public getPlayerEconomy: (player: Player) => PlayerEconomyState = () => ({
    coins: 0,
    rank: Rank.NONE,
  });

  /**
   * Callback to deduct coins from a player. Returns true on success.
   */
  public deductPlayerCoins: (player: Player, amount: number) => boolean = () => false;

  private constructor() {}

  public static get instance(): ShopManager {
    if (!ShopManager._instance) {
      ShopManager._instance = new ShopManager();
    }
    return ShopManager._instance;
  }

  // ------------------------------------------
  // INITIALIZATION
  // ------------------------------------------

  /**
   * Initialize shop NPCs in the world and register UI event listeners.
   */
  public init(world: World): void {
    this.world = world;
    this.spawnCafeNpc(world);
    this.spawnIceCreamNpcs(world);
  }

  /**
   * Register UI data listeners on a player to handle shop interactions.
   * Call this when a player joins the world.
   */
  public registerPlayerListeners(player: Player): void {
    player.ui.on(PlayerUIEvent.DATA, (payload: { playerUI: any; data: Record<string, any> }) => {
      const { data } = payload;
      if (!data || !data.type) return;

      switch (data.type) {
        case 'shop:open_cafe':
          this.openCafeShop(player);
          break;
        case 'shop:open_ice_cream':
          this.openIceCreamShop(player);
          break;
        case 'shop:buy':
          this.handlePurchase(player, data.boosterId as BoosterId);
          break;
        case 'shop:consume':
          this.handleConsume(player, data.boosterId as BoosterId);
          break;
        case 'shop:buy_cosmetic':
          this.handleCosmeticPurchase(player, data.cosmeticId as string);
          break;
        case 'shop:equip_cosmetic':
          this.handleCosmeticEquip(player, data.cosmeticId as string);
          break;
        case 'shop:close':
          // Unlock pointer when closing shop
          player.ui.lockPointer(true);
          break;
      }
    });
  }

  // ------------------------------------------
  // NPC SPAWNING
  // ------------------------------------------

  private spawnCafeNpc(world: World): void {
    this.cafeNpc = new Entity({
      name: 'Cafe Barista',
      modelUri: CAFE_NPC_MODEL,
      modelScale: 1.0,
      rigidBodyOptions: {
        type: RigidBodyType.KINEMATIC_POSITION,
      },
    });

    this.cafeNpc.spawn(world, CAFE_NPC_POSITION);

    // Attach a SceneUI label above the NPC
    const label = new SceneUI({
      templateId: 'hytopia:nametag',
      attachedToEntity: this.cafeNpc,
      offset: { x: 0, y: 2.2, z: 0 },
    });
    label.load(world);
  }

  private spawnIceCreamNpcs(world: World): void {
    for (const pos of ICE_CREAM_NPC_POSITIONS) {
      const npc = new Entity({
        name: 'Ice Cream Vendor',
        modelUri: ICE_CREAM_NPC_MODEL,
        modelScale: 1.0,
        rigidBodyOptions: {
          type: RigidBodyType.KINEMATIC_POSITION,
        },
      });

      npc.spawn(world, pos);

      const label = new SceneUI({
        templateId: 'hytopia:nametag',
        attachedToEntity: npc,
        offset: { x: 0, y: 2.2, z: 0 },
      });
      label.load(world);

      this.iceCreamNpcs.push(npc);
    }
  }

  // ------------------------------------------
  // SHOP OPENING
  // ------------------------------------------

  /**
   * Open the Cafe shop menu for a player.
   * Sends cafe booster items with prices to the client UI.
   */
  public openCafeShop(player: Player): void {
    const economy = this.getPlayerEconomy(player);
    const boosterManager = BoosterManager.instance;

    const items = CAFE_BOOSTER_IDS.map((id) => {
      const config = BOOSTERS_CONFIG.items[id];
      const price = boosterManager.getPrice(id, economy.rank);
      const owned = boosterManager.getInventory(player.id).find((b) => b.boosterId === id);

      return {
        boosterId: id,
        name: config.name,
        price,
        type: config.type,
        ownedQuantity: owned?.quantity ?? 0,
        isMysteryBoxFree: id === 'mysteryBox' ? boosterManager.isMysteryBoxFreeToday(player.id) : undefined,
        description: this.getBoosterDescription(id),
      };
    });

    // Unlock pointer for menu navigation
    player.ui.lockPointer(false);

    player.ui.sendData({
      type: 'shop:cafe_menu',
      shopName: 'Cafe',
      playerCoins: economy.coins,
      items,
      inventory: boosterManager.getInventory(player.id),
    });
  }

  /**
   * Open the Ice Cream Stand shop menu for a player.
   * Sends ice cream booster items with prices to the client UI.
   */
  public openIceCreamShop(player: Player): void {
    const economy = this.getPlayerEconomy(player);
    const boosterManager = BoosterManager.instance;

    const items = ICE_CREAM_BOOSTER_IDS.map((id) => {
      const config = BOOSTERS_CONFIG.items[id];
      const price = boosterManager.getPrice(id, economy.rank);
      const owned = boosterManager.getInventory(player.id).find((b) => b.boosterId === id);

      return {
        boosterId: id,
        name: config.name,
        price,
        type: config.type,
        ownedQuantity: owned?.quantity ?? 0,
        description: this.getBoosterDescription(id),
      };
    });

    // Unlock pointer for menu navigation
    player.ui.lockPointer(false);

    player.ui.sendData({
      type: 'shop:ice_cream_menu',
      shopName: 'Ice Cream Stand',
      playerCoins: economy.coins,
      items,
      inventory: boosterManager.getInventory(player.id),
    });
  }

  // ------------------------------------------
  // PURCHASE HANDLING
  // ------------------------------------------

  /**
   * Handle a buy request from the shop UI.
   */
  public handlePurchase(player: Player, boosterId: BoosterId): void {
    if (!boosterId || !BOOSTERS_CONFIG.items[boosterId]) {
      player.ui.sendData({
        type: 'shop:error',
        message: 'Invalid booster.',
      });
      return;
    }

    const economy = this.getPlayerEconomy(player);
    const boosterManager = BoosterManager.instance;

    const success = boosterManager.buyBooster(
      player,
      boosterId,
      economy.rank,
      economy.coins,
      (amount: number) => this.deductPlayerCoins(player, amount),
    );

    if (success) {
      // Refresh the shop menu so the player sees updated inventory/coins
      this.refreshCurrentShop(player, boosterId);
    }
  }

  /**
   * Handle a consume request from the UI (player wants to use a booster before a game).
   */
  public handleConsume(player: Player, boosterId: BoosterId): void {
    if (!boosterId || !BOOSTERS_CONFIG.items[boosterId]) {
      player.ui.sendData({
        type: 'booster:error',
        message: 'Invalid booster.',
      });
      return;
    }

    const boosterManager = BoosterManager.instance;
    const consumed = boosterManager.consumeBooster(player, boosterId);

    if (consumed) {
      player.ui.sendData({
        type: 'booster:consumed',
        boosterId,
        boosterName: BOOSTERS_CONFIG.items[boosterId].name,
        remainingQuantity:
          boosterManager.getInventory(player.id).find((b) => b.boosterId === boosterId)?.quantity ?? 0,
      });
    }
  }

  // ------------------------------------------
  // COSMETIC PURCHASE / EQUIP (delegates to CosmeticManager)
  // ------------------------------------------

  private handleCosmeticPurchase(player: Player, cosmeticId: string): void {
    const economy = this.getPlayerEconomy(player);
    const cosmeticManager = CosmeticManager.instance;

    cosmeticManager.buyCosmetic(
      player,
      cosmeticId,
      economy.rank,
      economy.coins,
      (amount: number) => this.deductPlayerCoins(player, amount),
    );
  }

  private handleCosmeticEquip(player: Player, cosmeticId: string): void {
    CosmeticManager.instance.equipCosmetic(player, cosmeticId);
  }

  // ------------------------------------------
  // HELPERS
  // ------------------------------------------

  /**
   * Refresh the currently open shop for the player after a purchase.
   */
  private refreshCurrentShop(player: Player, boosterId: BoosterId): void {
    if (CAFE_BOOSTER_IDS.includes(boosterId)) {
      this.openCafeShop(player);
    } else if (ICE_CREAM_BOOSTER_IDS.includes(boosterId)) {
      this.openIceCreamShop(player);
    }
  }

  /**
   * Generate a human-readable description for a booster.
   */
  private getBoosterDescription(boosterId: BoosterId): string {
    const config = BOOSTERS_CONFIG.items[boosterId] as any;
    if (!config) return '';

    switch (config.type) {
      case 'speed':
        return 'Grants a speed boost for the first 10 seconds of the game.';
      case 'risk':
        return 'Risk booster: Win = 1.10x rewards, Lose = 0.90x rewards.';
      case 'multiplier':
        return `+${(config.multiplier * 100).toFixed(0)}% reward multiplier for the game.`;
      case 'random':
        return 'Opens a mystery box containing a random booster. Free once per day!';
      default:
        return '';
    }
  }

  /**
   * Check if a player is near any shop NPC (for interact-based opening).
   * Returns the shop type or null.
   */
  public getShopNearPlayer(playerPosition: { x: number; y: number; z: number }): 'cafe' | 'ice_cream' | null {
    const interactRange = 4.0;

    if (this.cafeNpc) {
      const dx = playerPosition.x - CAFE_NPC_POSITION.x;
      const dz = playerPosition.z - CAFE_NPC_POSITION.z;
      if (Math.sqrt(dx * dx + dz * dz) < interactRange) {
        return 'cafe';
      }
    }

    for (const pos of ICE_CREAM_NPC_POSITIONS) {
      const dx = playerPosition.x - pos.x;
      const dz = playerPosition.z - pos.z;
      if (Math.sqrt(dx * dx + dz * dz) < interactRange) {
        return 'ice_cream';
      }
    }

    return null;
  }
}
