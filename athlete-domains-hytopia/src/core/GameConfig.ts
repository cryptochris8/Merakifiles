/**
 * Athlete Domains - Game Configuration
 * Migrated from Minecraft AthleteDomains config.yml
 *
 * Arena coordinates have been recalculated for standalone arena maps loaded
 * via MapLoader. Each arena sits at a coordinate offset so multiple arenas
 * coexist in a single World without overlapping.
 */

import type { ArenaMapEntry } from './MapLoader';

// ============================================
// GAME MODE TYPES
// ============================================
export enum GameModeType {
  SUMO = 'SUMO',
  TOWER_DUEL = 'TOWER_DUEL',
  TREASURE_GUARD = 'TREASURE_GUARD',
  PARKOUR_RACE = 'PARKOUR_RACE',
  JETSKI_RACE = 'JETSKI_RACE',
  FOOTBALL = 'FOOTBALL',
  FOOTBALL_2V2 = 'FOOTBALL_2V2',
  FOOTBALL_3V3 = 'FOOTBALL_3V3',
  ARCHERY = 'ARCHERY',
}

// ============================================
// ARENA MAP CONFIGURATION
// ============================================

/** Coordinate offsets applied when merging arena maps. */
export const FOOTBALL_OFFSET = { x: 300, y: 0, z: 0 };
export const TREASURE_GUARD_OFFSET = { x: 600, y: 0, z: 0 };
export const ARCHERY_OFFSET = { x: 900, y: 0, z: 0 };
export const PARKOUR_OFFSET = { x: 0, y: 0, z: 600 };
export const TOWER_DUEL_OFFSET = { x: 600, y: 0, z: 600 };
export const JETSKI_OFFSET = { x: 0, y: 0, z: -600 };

/**
 * Arena maps to load and merge at startup.
 * Sumo arena doubles as the lobby area (no offset).
 * Each arena is placed at a unique offset to avoid overlapping.
 */
export const ARENA_MAPS: ArenaMapEntry[] = [
  { file: 'sumo-arena.json', offset: { x: 0, y: 0, z: 0 } },
  { file: 'football-field.json', offset: FOOTBALL_OFFSET },
  { file: 'treasure-guard.json', offset: TREASURE_GUARD_OFFSET },
  { file: 'archery.json', offset: ARCHERY_OFFSET },
  { file: 'parkour-course-extracted.json', offset: PARKOUR_OFFSET },
  { file: 'tower-duel-arena.json', offset: TOWER_DUEL_OFFSET },
  { file: 'jetski-track.json', offset: JETSKI_OFFSET },
];

/**
 * Game modes that are currently disabled. Empty = all enabled.
 * Previously disabled modes now have standalone arena maps extracted
 * from road.json and MCA sources.
 */
export const DISABLED_GAME_MODES: Set<GameModeType> = new Set([
  // All game modes are now enabled!
]);

// ============================================
// RANK SYSTEM
// ============================================
export enum Rank {
  NONE = 'NONE',
  VIP = 'VIP',
  ATHLETE = 'ATHLETE',
  MEDALIST = 'MEDALIST',
  ADMIN = 'ADMIN',
}

export const RANK_CONFIG: Record<Rank, { name: string; color: string; prefix: string; value: number }> = {
  [Rank.NONE]:     { name: 'None',     color: '#888888', prefix: '',           value: 0 },
  [Rank.VIP]:      { name: 'VIP',      color: '#FFFF00', prefix: '[VIP] ',     value: 1 },
  [Rank.ATHLETE]:  { name: 'Athlete',  color: '#FF55FF', prefix: '[ATHLETE] ', value: 3 },
  [Rank.MEDALIST]: { name: 'Medalist', color: '#5555FF', prefix: '[MEDALIST] ',value: 4 },
  [Rank.ADMIN]:    { name: 'Admin',    color: '#FF5555', prefix: '[Admin] ',   value: 2 },
};

// ============================================
// LOBBY CONFIG
// ============================================
export const LOBBY_CONFIG = {
  /** Spawn position in the city, between the soccer stadium and bowling alley. */
  spawnPosition: { x: -1.5, y: 3.79, z: -581.0 },
  /** Y level of the city ground (legacy field). */
  platformY: 7,
  /** Half-size of the lobby platform (legacy, no longer used for platform). */
  platformSize: 10,
  maxPlayersPerParty: 2,
};

// ============================================
// SUMO CONFIG
// ============================================
export const SUMO_CONFIG = {
  name: 'Sumo',
  startCountdown: 15,
  mapCountdown: 10,
  ringSize: 15,
  ringHeight: 2,
  ringMaxReduction: 6,
  shrinkPerSecond: 3,
  floorLevel: 65,
  minPlayers: 2,
  bestOf: 5,
  mapMiddle: { x: 0.5, y: 65.0, z: 0.5 },
  spawnPoints: [
    { x: 4.5, y: 65.0, z: 0.5, yaw: 90.0 },
    { x: -3.5, y: 65.0, z: 0.5, yaw: -90.0 },
  ],
};

// ============================================
// TOWER DUEL CONFIG
// ============================================
/**
 * Tower Duel coordinates recalculated for standalone tower-duel-arena.json
 * placed at TOWER_DUEL_OFFSET (600, 0, 600).
 *
 * Extraction center: (-40, 55, 0) -> (0, 0, 0) in extracted map.
 * Final coords = extracted + offset.
 */
export const TOWER_DUEL_CONFIG = {
  name: 'Tower Duel',
  startCountdown: 15,
  mapCountdown: 10,
  bestOf: 3,
  matchDuration: 300, // seconds
  mapMiddle: { x: 599.5, y: 18.5, z: 600.5 },
  teams: {
    blue: {
      color: '#5555FF',
      name: 'Blue',
      spawnPoints: [
        { x: 561.5, y: 36.0, z: 600.5, yaw: -90.0 }, // knight
        { x: 561.5, y: 36.0, z: 600.5, yaw: -90.0 }, // tower
      ],
    },
    red: {
      color: '#FF5555',
      name: 'Red',
      spawnPoints: [
        { x: 638.5, y: 36.0, z: 600.5, yaw: 90.0 }, // knight
        { x: 638.5, y: 36.0, z: 600.5, yaw: 90.0 }, // tower
      ],
    },
  },
  knightHealth: 20,
  towerHealth: 10,
  knightDamage: 4,
  arrowDamage: 3,
};

// ============================================
// TREASURE GUARD CONFIG
// ============================================
/**
 * Treasure Guard coordinates recalculated for standalone treasure-guard.json
 * placed at TREASURE_GUARD_OFFSET (600, 0, 0).
 *
 * Extraction center: (-132, 50, -110) -> (0, 0, 0) in extracted map.
 * Final coords = (orig - center) + offset.
 */
export const TREASURE_GUARD_CONFIG = {
  name: 'Treasure Guard',
  startCountdown: 15,
  mapCountdown: 10,
  matchDuration: 90, // seconds
  minPlayers: 1,
  treasureLocation: { x: 599.5, y: 15.0, z: 0.5 },
  playerSpawnPoints: [
    { x: 602.5, y: 15.0, z: -4.5 },
    { x: 599.5, y: 15.0, z: -4.5 },
    { x: 596.5, y: 15.0, z: -4.5 },
    { x: 593.5, y: 15.0, z: -4.5 },
  ],
  mobSpawnPoints: [
    { x: 633.5, y: 15.0, z: -15.5 },
    { x: 621.5, y: 15.0, z: -49.5 },
    { x: 607.5, y: 14.0, z: -53.5 },
    { x: 526.5, y: 15.0, z: 9.5 },
    { x: 516.5, y: 15.0, z: -7.5 },
  ],
  mobs: {
    slowZombie:    { name: 'Slow Zombie',     points: 1,  speed: 1.0, chance: 20, taps: 1,  color: '#55FF55' },
    skeleton:      { name: 'Skeleton',         points: 3,  speed: 1.2, chance: 18, taps: 1,  color: '#FFFFFF' },
    goldenZombie:  { name: 'Golden Zombie',    points: 10, speed: 1.4, chance: 15, taps: 3,  color: '#FFD700' },
    goldenSkeleton:{ name: 'Golden Skeleton',  points: 20, speed: 1.55,chance: 10, taps: 2,  color: '#FFD700' },
    bee:           { name: 'Bee',              points: 15, speed: 1.5, chance: 10, taps: 1,  color: '#FFFF00' },
    zombieTank:    { name: 'Tank Zombie',      points: 10, speed: 0.8, chance: 1,  taps: 20, color: '#444444' },
    tntZombie:     { name: 'TNT Zombie',       points: 0,  speed: 1.8, chance: 5,  taps: 1,  color: '#FF0000', spawnsPerGame: 1 },
  },
};

// ============================================
// PARKOUR RACE CONFIG
// ============================================
/**
 * Parkour Race coordinates recalculated for standalone parkour-course-extracted.json
 * placed at PARKOUR_OFFSET (0, 0, 600).
 *
 * Extraction center: (112, 95, -208) -> (0, 0, 0) in extracted map.
 * Final coords = (orig - center) + offset.
 */
export const PARKOUR_RACE_CONFIG = {
  name: 'Parkour Race',
  startCountdown: 10,
  mapCountdown: 10,
  matchDuration: 600, // seconds (10 minutes)
  minPlayers: 1,
  maxPlayers: 8,
  deathYFloor: -5, // absolute Y below which the player is respawned
  checkpointMilestones: [1, 3, 5],
  // Checkpoints traced from extracted map + PARKOUR_OFFSET (0,0,600).
  // Course starts at Y=87 (x:14,z:627) and descends towards negative-X / higher-Z.
  // TODO: Verify checkpoint positions in-game and adjust as needed.
  checkpoints: [
    // Checkpoint positions need in-game verification. Use /spectator + /pos to find exact spots.
    // Sensor radius = 3 blocks, so approximate positions work.
    { x: 14.5,   y: 88.0,  z: 660.5 },   // CP1: far end of east platform (extracted z=60)
    { x: -33.5,  y: 88.0,  z: 670.5 },   // CP2: center of west platform (extracted x=-33,z=70)
    { x: -44.5,  y: 52.0,  z: 672.5 },   // CP3: Y=52 descent
    { x: -92.5,  y: 40.0,  z: 708.5 },   // CP4: Y=40 area
    { x: -130.5, y: 34.0,  z: 658.5 },   // CP5: Y=34 area
    { x: -187.5, y: 31.0,  z: 730.5 },   // CP6: far west
    { x: -203.5, y: 22.0,  z: 797.5 },   // CP7: Y=22 leading edge
    { x: -203.5, y: 16.0,  z: 797.5 },   // CP8: Y=16 area
    { x: -48.5,  y: 22.0,  z: 864.5 },   // CP9: finish area
  ],
  spawnPoints: [
    // Starting platform: extracted (x:11-18, y:87, z:26-28) + offset (0,0,600)
    { x: 14.5, y: 88.5, z: 627.5 },
    { x: 16.5, y: 88.5, z: 627.5 },
    { x: 14.5, y: 88.5, z: 628.5 },
    { x: 15.5, y: 88.5, z: 628.5 },
    { x: 16.5, y: 88.5, z: 628.5 },
    { x: 13.5, y: 88.5, z: 627.5 },
    { x: 17.5, y: 88.5, z: 627.5 },
    { x: 18.5, y: 88.5, z: 627.5 },
  ],
};

// ============================================
// JETSKI RACE CONFIG
// ============================================
/**
 * Jetski Race coordinates recalculated for standalone jetski-track.json
 * placed at JETSKI_OFFSET (0, 0, -600).
 *
 * Extraction center: (15, 48, -70) -> (0, 0, 0) in extracted map.
 * Final coords = (orig - center) + offset.
 */
export const JETSKI_RACE_CONFIG = {
  name: 'Jetski Race',
  startCountdown: 10,
  mapCountdown: 10,
  matchDuration: 400, // seconds
  minPlayers: 1,
  maxPlayers: 9,
  checkpointMilestones: [10, 20, 30, 40, 47],
  checkpoints: [
    { x: -188.5, y: 15.0, z: -626.5 },
    { x: -204.5, y: 15.0, z: -662.5 },
    { x: -173.5, y: 15.0, z: -697.5 },
    { x: -164.5, y: 15.0, z: -735.5 },
    { x: -171.5, y: 15.0, z: -788.5 },
    { x: -159.5, y: 15.0, z: -811.5 },
    { x: -119.5, y: 15.0, z: -789.5 },
    { x: -75.5,  y: 15.0, z: -810.5 },
    { x: -56.5,  y: 15.0, z: -805.5 },
    { x: -30.5,  y: 15.0, z: -788.5 },
    { x: -9.5,   y: 15.0, z: -801.5 },
    { x: 7.5,    y: 15.0, z: -803.5 },
    { x: 18.5,   y: 15.0, z: -773.5 },
    { x: 32.5,   y: 15.0, z: -763.5 },
    { x: 60.5,   y: 15.0, z: -763.5 },
    { x: 93.5,   y: 15.0, z: -763.5 },
    { x: 117.5,  y: 15.0, z: -730.5 },
    { x: 159.5,  y: 15.0, z: -728.5 },
    { x: 185.5,  y: 15.0, z: -707.5 },
    { x: 203.5,  y: 15.0, z: -671.5 },
    { x: 186.5,  y: 15.0, z: -630.5 },
    { x: 183.5,  y: 15.0, z: -571.5 },
    { x: 188.5,  y: 15.0, z: -547.5 },
    { x: 214.5,  y: 15.0, z: -524.5 },
    { x: 209.5,  y: 15.0, z: -498.5 },
    { x: 205.5,  y: 15.0, z: -449.5 },
    { x: 194.5,  y: 15.0, z: -408.5 },
    { x: 144.5,  y: 15.0, z: -389.5 },
    { x: 80.5,   y: 15.0, z: -391.5 },
    { x: 43.5,   y: 15.0, z: -407.5 },
    { x: 29.5,   y: 15.0, z: -404.5 },
    { x: -0.5,   y: 15.0, z: -407.5 },
    { x: -46.5,  y: 15.0, z: -402.5 },
    { x: -84.5,  y: 15.0, z: -407.5 },
    { x: -97.5,  y: 15.0, z: -433.5 },
    { x: -141.5, y: 15.0, z: -430.5 },
    { x: -170.5, y: 15.0, z: -435.5 },
    { x: -167.5, y: 15.0, z: -477.5 },
    { x: -177.5, y: 15.0, z: -508.5 },
  ],
  spawnPoints: [
    { x: -167.5, y: 15.0, z: -610.5 },
    { x: -165.5, y: 15.0, z: -608.5 },
    { x: -167.5, y: 15.0, z: -606.5 },
    { x: -165.5, y: 15.0, z: -604.5 },
    { x: -167.5, y: 15.0, z: -602.5 },
    { x: -165.5, y: 15.0, z: -600.5 },
    { x: -167.5, y: 15.0, z: -598.5 },
    { x: -165.5, y: 15.0, z: -596.5 },
    { x: -167.5, y: 15.0, z: -594.5 },
  ],
  cosmeticColors: ['red', 'blue', 'yellow', 'green', 'pink', 'orange', 'black'],
};

// ============================================
// FOOTBALL CONFIG
// ============================================
/**
 * Football coordinates recalculated for standalone football-field.json
 * placed at FOOTBALL_OFFSET (X+300).
 *
 * Standalone field: surface at Y=0, Lime markings X:-35..29, Z:-19..15.
 * Field center ≈ (-3, 0, -2) in standalone coords.
 * With offset (300,0,0): field center ≈ (297, 0, -2).
 */
export const FOOTBALL_CONFIG = {
  name: 'Football',
  startCountdown: 10,
  mapCountdown: 10,
  matchDuration: 300, // seconds (5 minutes)
  goalsToWin: 3,
  betweenSetsCountdown: 5,
  ballSpawn: { x: 297.5, y: 1.0, z: -2.5 },
  goalHitboxes: [
    // Right (east) goal - near X=329
    { min: { x: 328.8, y: 0.0, z: -5.0 }, max: { x: 330.5, y: 3.0, z: 1.0 } },
    // Left (west) goal - near X=265
    { min: { x: 264.5, y: 0.0, z: -5.0 }, max: { x: 266.2, y: 3.0, z: 1.0 } },
  ],
  variants: {
    '1v1': {
      minPlayers: 2,
      spawnPoints: [
        { x: 271.5, y: 1.0, z: -2.5 },
        { x: 324.5, y: 1.0, z: -2.5 },
      ],
    },
    '2v2': {
      minPlayers: 4,
      spawnPoints: [
        { x: 271.5, y: 1.0, z: -2.5 },
        { x: 287.5, y: 1.0, z: -2.5 },
        { x: 324.5, y: 1.0, z: -2.5 },
        { x: 308.5, y: 1.0, z: -2.5 },
      ],
    },
    '3v3': {
      minPlayers: 6,
      spawnPoints: [
        { x: 271.5, y: 1.0, z: -2.5 },
        { x: 279.5, y: 1.0, z: -9.5 },
        { x: 287.5, y: 1.0, z: -2.5 },
        { x: 324.5, y: 1.0, z: -2.5 },
        { x: 316.5, y: 1.0, z: -9.5 },
        { x: 308.5, y: 1.0, z: -2.5 },
      ],
    },
  },
  teamColors: {
    red: '#FF5555',
    blue: '#5555FF',
  },
};

// ============================================
// ARCHERY CONFIG
// ============================================
/**
 * Archery coordinates recalculated for standalone archery.json
 * placed at ARCHERY_OFFSET (900, 0, 0).
 *
 * Extraction center: (-49, 55, 91) -> (0, 0, 0) in extracted map.
 * Final coords = (orig - center) + offset.
 */
export const ARCHERY_CONFIG = {
  name: 'Archery',
  practiceLocation: { x: 899.5, y: 12.0, z: 0.5 },
  practiceRadius: 49,
  matchDuration: 90, // 1.5 minutes
  minPlayers: 4,
  maxPlayers: 4,
  mobs: {
    zombie:         { name: 'Zombie',          points: 1,  speed: 1.0 },
    skeleton:       { name: 'Skeleton',        points: 3,  speed: 1.5 },
    goldenZombie:   { name: 'Golden Zombie',   points: 10, speed: 2.0 },
    goldenSkeleton: { name: 'Golden Skeleton', points: 20, speed: 2.5 },
    tntZombie:      { name: 'TNT Zombie',      points: 0,  speed: 2.0, special: 'explosive_arrows', spawnsPerGame: 1 },
  },
};

// ============================================
// REWARDS CONFIG
// ============================================
export const REWARDS_CONFIG = {
  duelPerMinute: 100,
  sumoPoolPerMinute: 100,
  towerPoolPerMinute: 100,
  treasurePerHundredPoints: 250,
  parkourRacePerCheckpoint: 2,
  parkourRaceWinnerMultiplier: 5,
  jetskiRacePerCheckpoint: 1,
  jetskiRaceWinnerReward: 500,
  jetskiRaceSecondPlace: 3,
  jetskiRaceThirdPlace: 1,
  footballWinReward: 500,
  footballLossReward: 20,
};

// ============================================
// BOOSTERS CONFIG
// ============================================
export const BOOSTERS_CONFIG = {
  discountPercent: 90, // rank discount
  items: {
    cappuccino:   { name: 'Cappuccino',   price: 2000, type: 'speed',      games: [GameModeType.FOOTBALL, GameModeType.FOOTBALL_2V2, GameModeType.FOOTBALL_3V3] },
    latte:        { name: 'Latte',        price: 2000, type: 'speed',      games: [GameModeType.JETSKI_RACE] },
    espresso:     { name: 'Espresso',     price: 2000, type: 'speed',      games: [GameModeType.PARKOUR_RACE] },
    muffin:       { name: 'Muffin',       price: 2000, type: 'risk',       games: 'ALL' as const },
    vanillaIceCream:          { name: 'Vanilla Ice Cream',          price: 2000, type: 'multiplier', multiplier: 0.05, games: [GameModeType.FOOTBALL, GameModeType.FOOTBALL_2V2, GameModeType.FOOTBALL_3V3] },
    chocolateIceCream:        { name: 'Chocolate Ice Cream',        price: 2000, type: 'multiplier', multiplier: 0.05, games: [GameModeType.JETSKI_RACE] },
    chocolateChipCookieIceCream: { name: 'Choc Chip Cookie Ice Cream', price: 2000, type: 'multiplier', multiplier: 0.05, games: [GameModeType.PARKOUR_RACE] },
    strawberryIceCream:       { name: 'Strawberry Ice Cream',       price: 2000, type: 'multiplier', multiplier: 0.05, games: [GameModeType.SUMO, GameModeType.TOWER_DUEL] },
    caramelIceCream:          { name: 'Caramel Ice Cream',          price: 2000, type: 'multiplier', multiplier: 0.05, games: [GameModeType.TREASURE_GUARD] },
    mysteryBox:               { name: 'Mystery Box',                price: 1500, type: 'random',     freeEveryMs: 86400000 },
  },
};

// ============================================
// COSMETICS CONFIG
// ============================================
export const COSMETICS_CONFIG = {
  jetskiColors: [
    { id: 'red',    name: 'Red Jetski',    color: '#FF5555', price: 0,     isDefault: true },
    { id: 'blue',   name: 'Blue Jetski',   color: '#5555FF', price: 10000, isDefault: false },
    { id: 'yellow', name: 'Yellow Jetski',  color: '#FFFF55', price: 10000, isDefault: false },
    { id: 'green',  name: 'Green Jetski',  color: '#55FF55', price: 10000, isDefault: false },
    { id: 'pink',   name: 'Pink Jetski',   color: '#FF55FF', price: 10000, isDefault: false },
    { id: 'orange', name: 'Orange Jetski', color: '#FFA500', price: 10000, isDefault: false },
    { id: 'black',  name: 'Black Jetski',  color: '#555555', price: 10000, isDefault: false },
  ],
};

// ============================================
// STAT TYPES
// ============================================
export enum StatType {
  SUMO_GAMES_PLAYED = 'SUMO_GAMES_PLAYED',
  SUMO_WINS = 'SUMO_WINS',
  TOWER_DUELS_GAMES_PLAYED = 'TOWER_DUELS_GAMES_PLAYED',
  TOWER_DUELS_GAMES_WON = 'TOWER_DUELS_GAMES_WON',
  TOWER_DUELS_KNIGHT_KILLS = 'TOWER_DUELS_KNIGHT_KILLS',
  TOWER_DUELS_TOWER_KILLS = 'TOWER_DUELS_TOWER_KILLS',
  TREASURE_GUARD_GAMES_PLAYED = 'TREASURE_GUARD_GAMES_PLAYED',
  TREASURE_GUARD_GAMES_WON = 'TREASURE_GUARD_GAMES_WON',
  TREASURE_GUARD_GAMES_SURVIVED = 'TREASURE_GUARD_GAMES_SURVIVED',
  TREASURE_GUARD_GAMES_LOST = 'TREASURE_GUARD_GAMES_LOST',
  TREASURE_GUARD_MONSTER_KILLS = 'TREASURE_GUARD_MONSTER_KILLS',
  TREASURE_GUARD_HIGH_SCORE = 'TREASURE_GUARD_HIGH_SCORE',
  PARKOUR_RACE_GAMES_PLAYED = 'PARKOUR_RACE_GAMES_PLAYED',
  PARKOUR_RACE_CHECKPOINTS_PASSED = 'PARKOUR_RACE_CHECKPOINTS_PASSED',
  PARKOUR_RACE_WINS = 'PARKOUR_RACE_WINS',
  BOAT_RACE_GAMES_PLAYED = 'BOAT_RACE_GAMES_PLAYED',
  BOAT_RACE_CHECKPOINTS_PASSED = 'BOAT_RACE_CHECKPOINTS_PASSED',
  BOAT_RACE_WINS = 'BOAT_RACE_WINS',
  FOOTBALL_GAMES_PLAYED = 'FOOTBALL_GAMES_PLAYED',
  FOOTBALL_GOALS_SCORED = 'FOOTBALL_GOALS_SCORED',
  FOOTBALL_WINS = 'FOOTBALL_WINS',
  FOOTBALL_2V2_GAMES_PLAYED = 'FOOTBALL_2V2_GAMES_PLAYED',
  FOOTBALL_2V2_GOALS_SCORED = 'FOOTBALL_2V2_GOALS_SCORED',
  FOOTBALL_2V2_WINS = 'FOOTBALL_2V2_WINS',
  FOOTBALL_3V3_GAMES_PLAYED = 'FOOTBALL_3V3_GAMES_PLAYED',
  FOOTBALL_3V3_GOALS_SCORED = 'FOOTBALL_3V3_GOALS_SCORED',
  FOOTBALL_3V3_WINS = 'FOOTBALL_3V3_WINS',
}
