/**
 * Athlete Domains - Main Server Entry Point
 * A sports-themed multiplayer game built on the Hytopia SDK.
 *
 * Merges multiple arena maps (sumo + football) into a single World, builds a
 * lobby platform, initializes the GameManager, and wires up the economy system.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  startServer,
  type Player,
  type World,
} from 'hytopia';

import { GameManager } from './src/core/GameManager';
import { ShopManager } from './src/economy/ShopManager';
import { PlayerDataManager } from './src/core/PlayerDataManager';
import { Rank, ARENA_MAPS } from './src/core/GameConfig';
import { mergeArenaMaps } from './src/core/MapLoader';

// ============================================
// LOAD & MERGE ARENA MAPS
// ============================================

const __dirname = dirname(fileURLToPath(import.meta.url));
const assetsDir = join(__dirname, 'assets');

console.log('[AthleteDomains] Merging arena maps...');
const worldMap = mergeArenaMaps(assetsDir, ARENA_MAPS);
console.log('[AthleteDomains] Arena maps merged. Lobby is in the city near the stadium.');

// ============================================
// SERVER ENTRY POINT
// ============================================

startServer(async (world: World) => {
  console.log('[AthleteDomains] Server starting...');

  // ------------------------------------------
  // LOAD MAP & CONFIGURE LIGHTING
  // ------------------------------------------

  world.loadMap(worldMap);

  // Warm daylight ambient
  world.setAmbientLightColor({ r: 255, g: 248, b: 230 });
  world.setAmbientLightIntensity(0.6);

  // Sun-like directional light
  world.setDirectionalLightColor({ r: 255, g: 240, b: 220 });
  world.setDirectionalLightIntensity(1.0);
  world.setDirectionalLightPosition({ x: 100, y: 200, z: 50 });

  // ------------------------------------------
  // INITIALIZE GAME MANAGER
  // ------------------------------------------

  // The GameManager handles everything: game mode registration, player
  // join/leave lifecycle, lobby NPCs, matchmaking, and chat commands.
  await GameManager.instance.initialize(world);

  // ------------------------------------------
  // INITIALIZE SHOP SYSTEM
  // ------------------------------------------

  const shopManager = ShopManager.instance;
  shopManager.init(world);

  // Wire up economy callbacks so shops can check coins / deduct coins
  // via the PlayerDataManager (the single source of truth for player state).
  const pdm = PlayerDataManager.instance;

  shopManager.getPlayerEconomy = (player: Player) => {
    const data = pdm.getPlayerData(player);
    return {
      coins: data?.coins ?? 0,
      rank: (data?.rank as Rank) ?? Rank.NONE,
    };
  };

  shopManager.deductPlayerCoins = (player: Player, amount: number) => {
    const data = pdm.getPlayerData(player);
    if (!data || data.coins < amount) return false;
    data.coins -= amount;
    pdm.savePlayerData(player);
    return true;
  };

  console.log('[AthleteDomains] Server ready. Waiting for players...');
});
