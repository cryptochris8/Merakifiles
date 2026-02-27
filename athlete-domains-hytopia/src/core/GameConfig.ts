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

/**
 * Arena maps to load and merge at startup.
 * Sumo arena doubles as the lobby area (no offset).
 * Football field is placed 300 blocks east.
 */
export const ARENA_MAPS: ArenaMapEntry[] = [
  { file: 'sumo-arena.json', offset: { x: 0, y: 0, z: 0 } },
  { file: 'football-field.json', offset: FOOTBALL_OFFSET },
];

/**
 * Game modes that are currently disabled because their arenas are only
 * available in road.json (too large to load) or have no unique schematic.
 */
export const DISABLED_GAME_MODES: Set<GameModeType> = new Set([
  GameModeType.TOWER_DUEL,       // schematic is duplicate of football
  GameModeType.TREASURE_GUARD,   // only in road.json
  GameModeType.PARKOUR_RACE,     // only in road.json
  GameModeType.JETSKI_RACE,      // only in road.json
  GameModeType.ARCHERY,          // only in road.json
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
  /** Spawn position on the lobby platform above the sumo arena. */
  spawnPosition: { x: 0.5, y: 82.0, z: 0.5 },
  /** Y level of the lobby platform (built programmatically by MapLoader). */
  platformY: 80,
  /** Half-size of the lobby platform (full width = 2*size+1 = 21 blocks). */
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
export const TOWER_DUEL_CONFIG = {
  name: 'Tower Duel',
  startCountdown: 15,
  mapCountdown: 10,
  bestOf: 3,
  matchDuration: 300, // seconds
  mapMiddle: { x: -40.5, y: 73.5, z: 0.5 },
  teams: {
    blue: {
      color: '#5555FF',
      name: 'Blue',
      spawnPoints: [
        { x: -78.5, y: 91.0, z: 0.5, yaw: -90.0 }, // knight
        { x: -78.5, y: 91.0, z: 0.5, yaw: -90.0 }, // tower
      ],
    },
    red: {
      color: '#FF5555',
      name: 'Red',
      spawnPoints: [
        { x: -1.5, y: 91.0, z: 0.5, yaw: 90.0 }, // knight
        { x: -1.5, y: 91.0, z: 0.5, yaw: 90.0 }, // tower
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
export const TREASURE_GUARD_CONFIG = {
  name: 'Treasure Guard',
  startCountdown: 15,
  mapCountdown: 10,
  matchDuration: 90, // seconds
  minPlayers: 1,
  treasureLocation: { x: -132.5, y: 65.0, z: -109.5 },
  playerSpawnPoints: [
    { x: -129.5, y: 65.0, z: -114.5 },
    { x: -132.5, y: 65.0, z: -114.5 },
    { x: -135.5, y: 65.0, z: -114.5 },
    { x: -138.5, y: 65.0, z: -114.5 },
  ],
  mobSpawnPoints: [
    { x: -98.5, y: 65.0, z: -125.5 },
    { x: -110.5, y: 65.0, z: -159.5 },
    { x: -124.5, y: 64.0, z: -163.5 },
    { x: -205.5, y: 65.0, z: -100.5 },
    { x: -215.5, y: 65.0, z: -117.5 },
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
export const PARKOUR_RACE_CONFIG = {
  name: 'Parkour Race',
  startCountdown: 10,
  mapCountdown: 10,
  matchDuration: 600, // seconds (10 minutes)
  minPlayers: 1,
  maxPlayers: 8,
  deathBelowCheckpoint: 17,
  checkpointMilestones: [1, 5, 7],
  checkpoints: [
    { x: 118.5, y: 165.0, z: -208.5 },
    { x: 102.5, y: 171.0, z: -231.5 },
    { x: 59.5,  y: 159.0, z: -219.5 },
    { x: 3.5,   y: 147.0, z: -201.5 },
    { x: -54.5, y: 136.0, z: -163.5 },
    { x: -75.5, y: 126.0, z: -77.5  },
    { x: -107.7,y: 117.0, z: -29.0  },
    { x: -101.5,y: 110.0, z: 23.5   },
    { x: -37.5, y: 121.0, z: 53.5   },
  ],
  spawnPoints: [
    { x: 111.5, y: 165.0, z: -208.5 },
    { x: 111.5, y: 165.0, z: -209.5 },
    { x: 111.5, y: 165.0, z: -207.5 },
    { x: 113.5, y: 165.0, z: -207.5 },
    { x: 113.5, y: 165.0, z: -208.5 },
    { x: 113.5, y: 165.0, z: -209.5 },
    { x: 115.5, y: 165.0, z: -208.5 },
    { x: 116.5, y: 165.0, z: -208.5 },
  ],
};

// ============================================
// JETSKI RACE CONFIG
// ============================================
export const JETSKI_RACE_CONFIG = {
  name: 'Jetski Race',
  startCountdown: 10,
  mapCountdown: 10,
  matchDuration: 400, // seconds
  minPlayers: 1,
  maxPlayers: 9,
  checkpointMilestones: [10, 20, 30, 40, 47],
  checkpoints: [
    { x: -173.5, y: 63.0, z: -96.5 },
    { x: -189.5, y: 63.0, z: -132.5 },
    { x: -158.5, y: 63.0, z: -167.5 },
    { x: -149.5, y: 63.0, z: -205.5 },
    { x: -156.5, y: 63.0, z: -258.5 },
    { x: -144.5, y: 63.0, z: -281.5 },
    { x: -104.5, y: 63.0, z: -259.5 },
    { x: -60.5,  y: 63.0, z: -280.5 },
    { x: -41.5,  y: 63.0, z: -275.5 },
    { x: -15.5,  y: 63.0, z: -258.5 },
    { x: 5.5,    y: 63.0, z: -271.5 },
    { x: 22.5,   y: 63.0, z: -273.5 },
    { x: 33.5,   y: 63.0, z: -243.5 },
    { x: 47.5,   y: 63.0, z: -233.5 },
    { x: 75.5,   y: 63.0, z: -233.5 },
    { x: 108.5,  y: 63.0, z: -233.5 },
    { x: 132.5,  y: 63.0, z: -200.5 },
    { x: 174.5,  y: 63.0, z: -198.5 },
    { x: 200.5,  y: 63.0, z: -177.5 },
    { x: 218.5,  y: 63.0, z: -141.5 },
    { x: 201.5,  y: 63.0, z: -100.5 },
    { x: 198.5,  y: 63.0, z: -41.5 },
    { x: 203.5,  y: 63.0, z: -17.5 },
    { x: 229.5,  y: 63.0, z: 5.5 },
    { x: 224.5,  y: 63.0, z: 31.5 },
    { x: 220.5,  y: 63.0, z: 80.5 },
    { x: 209.5,  y: 63.0, z: 121.5 },
    { x: 159.5,  y: 63.0, z: 140.5 },
    { x: 95.5,   y: 63.0, z: 138.5 },
    { x: 58.5,   y: 63.0, z: 122.5 },
    { x: 44.5,   y: 63.0, z: 125.5 },
    { x: 14.5,   y: 63.0, z: 122.5 },
    { x: -31.5,  y: 63.0, z: 127.5 },
    { x: -69.5,  y: 63.0, z: 122.5 },
    { x: -82.5,  y: 63.0, z: 96.5 },
    { x: -126.5, y: 63.0, z: 99.5 },
    { x: -155.5, y: 63.0, z: 94.5 },
    { x: -152.5, y: 63.0, z: 52.5 },
    { x: -162.5, y: 63.0, z: 21.5 },
  ],
  spawnPoints: [
    { x: -152.5, y: 63.0, z: -80.5 },
    { x: -150.5, y: 63.0, z: -78.5 },
    { x: -152.5, y: 63.0, z: -76.5 },
    { x: -150.5, y: 63.0, z: -74.5 },
    { x: -152.5, y: 63.0, z: -72.5 },
    { x: -150.5, y: 63.0, z: -70.5 },
    { x: -152.5, y: 63.0, z: -68.5 },
    { x: -150.5, y: 63.0, z: -66.5 },
    { x: -152.5, y: 63.0, z: -64.5 },
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
export const ARCHERY_CONFIG = {
  name: 'Archery',
  practiceLocation: { x: -49.5, y: 67.0, z: 91.5 },
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
