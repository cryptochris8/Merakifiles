/**
 * Minecraft .mca (Anvil region) -> Hytopia map.json converter
 *
 * Reads a Minecraft world directory containing region/*.mca files and outputs
 * a Hytopia-compatible map.json with block type mappings.
 *
 * Uses prismarine-provider-anvil to parse chunks and prismarine-chunk for
 * block data. Streams JSON output to handle very large worlds.
 *
 * Usage:
 *   node scripts/mca-to-hytopia.cjs <world-dir> <output.json> [--min-y N] [--max-y N]
 *   node scripts/mca-to-hytopia.cjs --all [--min-y N] [--max-y N]
 */

const fs = require('fs');
const path = require('path');

// ============================================
// MINECRAFT -> HYTOPIA BLOCK MAPPING
// ============================================
// Identical to mc-to-hytopia.cjs - maps Minecraft block names to Hytopia textures.

const BLOCK_MAP = {
  // --- STONE & ORE ---
  stone: 'blocks/stone.png',
  smooth_stone: 'blocks/smooth-stone.png',
  cobblestone: 'blocks/cobblestone.png',
  mossy_cobblestone: 'blocks/mossy-cobblestone.png',
  stone_bricks: 'blocks/stone-bricks.png',
  mossy_stone_bricks: 'blocks/mossy-stone-bricks.png',
  cracked_stone_bricks: 'blocks/stone-bricks.png',
  chiseled_stone_bricks: 'blocks/stone-bricks.png',
  andesite: 'blocks/andesite.png',
  polished_andesite: 'blocks/andesite.png',
  diorite: 'blocks/diorite.png',
  polished_diorite: 'blocks/diorite.png',
  granite: 'blocks/granite.png',
  polished_granite: 'blocks/granite.png',
  deepslate: 'blocks/deepslate.png',
  cobbled_deepslate: 'blocks/cobbled-deepslate.png',
  coal_ore: 'blocks/coal-ore.png',
  deepslate_coal_ore: 'blocks/deepslate-coal-ore.png',
  iron_ore: 'blocks/iron-ore.png',
  deepslate_iron_ore: 'blocks/deepslate-iron-ore.png',
  gold_ore: 'blocks/gold-ore.png',
  deepslate_gold_ore: 'blocks/deepslate-gold-ore.png',
  diamond_ore: 'blocks/diamond-ore.png',
  deepslate_diamond_ore: 'blocks/deepslate-diamond-ore.png',
  emerald_ore: 'blocks/emerald-ore.png',
  deepslate_emerald_ore: 'blocks/deepslate-emerald-ore.png',
  coal_block: 'blocks/coal-block.png',
  iron_block: 'blocks/iron-block.png',
  gold_block: 'blocks/gold-block.png',
  diamond_block: 'blocks/diamond-block.png',
  emerald_block: 'blocks/emerald-block.png',

  // --- DIRT & GRASS ---
  dirt: 'blocks/dirt.png',
  coarse_dirt: 'blocks/dirt.png',
  rooted_dirt: 'blocks/dirt.png',
  grass_block: 'blocks/grass-block',
  podzol: 'blocks/dirt.png',
  mycelium: 'blocks/dirt.png',
  farmland: 'blocks/farmland',
  mud: 'blocks/dirt.png',

  // --- SAND ---
  sand: 'blocks/sand.png',
  red_sand: 'blocks/sand.png',
  sandstone: 'blocks/sandstone',
  cut_sandstone: 'blocks/sandstone',
  chiseled_sandstone: 'blocks/sandstone',
  smooth_sandstone: 'blocks/sandstone',
  red_sandstone: 'blocks/sandstone',

  // --- WOOD ---
  oak_log: 'blocks/oak-log',
  oak_wood: 'blocks/oak-log',
  stripped_oak_log: 'blocks/oak-log',
  oak_planks: 'blocks/oak-planks.png',
  birch_log: 'blocks/birch-log',
  birch_wood: 'blocks/birch-log',
  stripped_birch_log: 'blocks/birch-log',
  birch_planks: 'blocks/birch-planks.png',
  spruce_log: 'blocks/spruce-log',
  spruce_wood: 'blocks/spruce-log',
  stripped_spruce_log: 'blocks/spruce-log',
  spruce_planks: 'blocks/spruce-planks.png',
  dark_oak_log: 'blocks/oak-log',
  dark_oak_planks: 'blocks/oak-planks.png',
  jungle_log: 'blocks/oak-log',
  jungle_planks: 'blocks/oak-planks.png',
  acacia_log: 'blocks/spruce-log',
  acacia_planks: 'blocks/spruce-planks.png',
  mangrove_log: 'blocks/oak-log',
  mangrove_planks: 'blocks/oak-planks.png',
  cherry_log: 'blocks/birch-log',
  cherry_planks: 'blocks/birch-planks.png',
  crimson_stem: 'blocks/spruce-log',
  crimson_planks: 'blocks/spruce-planks.png',
  warped_stem: 'blocks/spruce-log',
  warped_planks: 'blocks/spruce-planks.png',

  // --- LEAVES ---
  oak_leaves: 'blocks/oak-leaves.png',
  birch_leaves: 'blocks/birch-leaves.png',
  spruce_leaves: 'blocks/spruce-leaves.png',
  dark_oak_leaves: 'blocks/dark-oak-leaves.png',
  jungle_leaves: 'blocks/jungle-leaves.png',
  azalea_leaves: 'blocks/azalea-leaves.png',
  flowering_azalea_leaves: 'blocks/azalea-flowering-leaves.png',
  cherry_leaves: 'blocks/cherry-leaves.png',
  acacia_leaves: 'blocks/oak-leaves.png',
  mangrove_leaves: 'blocks/jungle-leaves.png',

  // --- CONCRETE ---
  white_concrete: 'blocks/white-concrete.png',
  orange_concrete: 'blocks/orange-concrete.png',
  magenta_concrete: 'blocks/magenta-concrete.png',
  light_blue_concrete: 'blocks/light-blue-concrete.png',
  yellow_concrete: 'blocks/yellow-concrete.png',
  lime_concrete: 'blocks/lime-concrete.png',
  pink_concrete: 'blocks/pink-concrete.png',
  gray_concrete: 'blocks/gray-concrete.png',
  light_gray_concrete: 'blocks/light-gray-concrete.png',
  cyan_concrete: 'blocks/cyan-concrete.png',
  purple_concrete: 'blocks/purple-concrete.png',
  blue_concrete: 'blocks/blue-concrete.png',
  brown_concrete: 'blocks/brown-concrete.png',
  green_concrete: 'blocks/green-concrete.png',
  red_concrete: 'blocks/red-concrete.png',
  black_concrete: 'blocks/black-concrete.png',

  // --- CONCRETE POWDER (map to concrete) ---
  white_concrete_powder: 'blocks/white-concrete.png',
  orange_concrete_powder: 'blocks/orange-concrete.png',
  magenta_concrete_powder: 'blocks/magenta-concrete.png',
  light_blue_concrete_powder: 'blocks/light-blue-concrete.png',
  yellow_concrete_powder: 'blocks/yellow-concrete.png',
  lime_concrete_powder: 'blocks/lime-concrete.png',
  pink_concrete_powder: 'blocks/pink-concrete.png',
  gray_concrete_powder: 'blocks/gray-concrete.png',
  light_gray_concrete_powder: 'blocks/light-gray-concrete.png',
  cyan_concrete_powder: 'blocks/cyan-concrete.png',
  purple_concrete_powder: 'blocks/purple-concrete.png',
  blue_concrete_powder: 'blocks/blue-concrete.png',
  brown_concrete_powder: 'blocks/brown-concrete.png',
  green_concrete_powder: 'blocks/green-concrete.png',
  red_concrete_powder: 'blocks/red-concrete.png',
  black_concrete_powder: 'blocks/black-concrete.png',

  // --- WOOL (map to concrete equivalents) ---
  white_wool: 'blocks/white-concrete.png',
  orange_wool: 'blocks/orange-concrete.png',
  magenta_wool: 'blocks/magenta-concrete.png',
  light_blue_wool: 'blocks/light-blue-concrete.png',
  yellow_wool: 'blocks/yellow-concrete.png',
  lime_wool: 'blocks/lime-concrete.png',
  pink_wool: 'blocks/pink-concrete.png',
  gray_wool: 'blocks/gray-concrete.png',
  light_gray_wool: 'blocks/light-gray-concrete.png',
  cyan_wool: 'blocks/cyan-concrete.png',
  purple_wool: 'blocks/purple-concrete.png',
  blue_wool: 'blocks/blue-concrete.png',
  brown_wool: 'blocks/brown-concrete.png',
  green_wool: 'blocks/green-concrete.png',
  red_wool: 'blocks/red-concrete.png',
  black_wool: 'blocks/black-concrete.png',

  // --- TERRACOTTA (map to closest concrete) ---
  terracotta: 'blocks/brown-concrete.png',
  white_terracotta: 'blocks/white-concrete.png',
  orange_terracotta: 'blocks/orange-concrete.png',
  magenta_terracotta: 'blocks/magenta-concrete.png',
  light_blue_terracotta: 'blocks/light-blue-concrete.png',
  yellow_terracotta: 'blocks/yellow-concrete.png',
  lime_terracotta: 'blocks/lime-concrete.png',
  pink_terracotta: 'blocks/pink-concrete.png',
  gray_terracotta: 'blocks/gray-concrete.png',
  light_gray_terracotta: 'blocks/light-gray-concrete.png',
  cyan_terracotta: 'blocks/cyan-concrete.png',
  purple_terracotta: 'blocks/purple-concrete.png',
  blue_terracotta: 'blocks/blue-concrete.png',
  brown_terracotta: 'blocks/brown-concrete.png',
  green_terracotta: 'blocks/green-concrete.png',
  red_terracotta: 'blocks/red-concrete.png',
  black_terracotta: 'blocks/black-concrete.png',

  // --- GLASS ---
  glass: 'blocks/glass.png',
  white_stained_glass: 'blocks/glass-white.png',
  orange_stained_glass: 'blocks/glass-orange.png',
  magenta_stained_glass: 'blocks/glass-magenta.png',
  light_blue_stained_glass: 'blocks/glass-light-blue.png',
  yellow_stained_glass: 'blocks/glass-yellow.png',
  lime_stained_glass: 'blocks/glass-lime.png',
  pink_stained_glass: 'blocks/glass-pink.png',
  gray_stained_glass: 'blocks/glass-dark-gray.png',
  light_gray_stained_glass: 'blocks/glass-light-gray.png',
  cyan_stained_glass: 'blocks/glass-aqua.png',
  purple_stained_glass: 'blocks/glass-purple.png',
  blue_stained_glass: 'blocks/glass-blue.png',
  brown_stained_glass: 'blocks/glass-brown.png',
  green_stained_glass: 'blocks/glass-green.png',
  red_stained_glass: 'blocks/glass-red.png',
  black_stained_glass: 'blocks/glass-black.png',

  // --- GLASS PANES (map to glass) ---
  glass_pane: 'blocks/glass.png',
  white_stained_glass_pane: 'blocks/glass-white.png',
  orange_stained_glass_pane: 'blocks/glass-orange.png',
  light_blue_stained_glass_pane: 'blocks/glass-light-blue.png',
  yellow_stained_glass_pane: 'blocks/glass-yellow.png',
  lime_stained_glass_pane: 'blocks/glass-lime.png',
  pink_stained_glass_pane: 'blocks/glass-pink.png',
  gray_stained_glass_pane: 'blocks/glass-dark-gray.png',
  cyan_stained_glass_pane: 'blocks/glass-aqua.png',
  blue_stained_glass_pane: 'blocks/glass-blue.png',
  red_stained_glass_pane: 'blocks/glass-red.png',
  black_stained_glass_pane: 'blocks/glass-black.png',

  // --- BRICKS ---
  bricks: 'blocks/bricks.png',
  brick_block: 'blocks/bricks.png',
  nether_bricks: 'blocks/bricks.png',
  red_nether_bricks: 'blocks/bricks.png',
  prismarine: 'blocks/cyan-concrete.png',
  prismarine_bricks: 'blocks/cyan-concrete.png',
  dark_prismarine: 'blocks/cyan-concrete.png',

  // --- ICE & SNOW ---
  ice: 'blocks/ice.png',
  packed_ice: 'blocks/ice.png',
  blue_ice: 'blocks/ice.png',
  snow_block: 'blocks/snow.png',
  snow: 'blocks/snow.png',
  powder_snow: 'blocks/snow.png',

  // --- NETHER & END ---
  netherrack: 'blocks/red-concrete.png',
  nether_quartz_ore: 'blocks/andesite.png',
  quartz_block: 'blocks/white-concrete.png',
  smooth_quartz: 'blocks/white-concrete.png',
  chiseled_quartz_block: 'blocks/white-concrete.png',
  quartz_pillar: 'blocks/white-concrete.png',
  glowstone: 'blocks/yellow-concrete.png',
  soul_sand: 'blocks/brown-concrete.png',
  soul_soil: 'blocks/brown-concrete.png',
  basalt: 'blocks/gray-concrete.png',
  polished_basalt: 'blocks/gray-concrete.png',
  blackstone: 'blocks/black-concrete.png',
  polished_blackstone: 'blocks/black-concrete.png',
  polished_blackstone_bricks: 'blocks/black-concrete.png',
  end_stone: 'blocks/sand.png',
  end_stone_bricks: 'blocks/sand.png',
  purpur_block: 'blocks/purple-concrete.png',
  purpur_pillar: 'blocks/purple-concrete.png',
  obsidian: 'blocks/black-concrete.png',
  crying_obsidian: 'blocks/purple-concrete.png',

  // --- SPECIAL ---
  bedrock: 'blocks/deepslate.png',
  lava: 'blocks/lava.png',
  water: 'blocks/water.png',
  magma_block: 'blocks/magma-block.png',
  sponge: 'blocks/yellow-concrete.png',
  wet_sponge: 'blocks/yellow-concrete.png',
  hay_block: 'blocks/yellow-concrete.png',
  slime_block: 'blocks/lime-concrete.png',
  honey_block: 'blocks/orange-concrete.png',
  mushroom_stem: 'blocks/mushroom-stem.png',
  brown_mushroom_block: 'blocks/brown-mushroom-block.png',
  red_mushroom_block: 'blocks/red-mushroom-block.png',

  // --- MISC SOLID BLOCKS ---
  iron_bars: 'blocks/gray-concrete.png',
  chain: 'blocks/gray-concrete.png',
  barrier: null, // invisible - skip
  tnt: 'blocks/red-concrete.png',
  bookshelf: 'blocks/oak-planks.png',
  clay: 'blocks/light-gray-concrete.png',
  gravel: 'blocks/andesite.png',
  sea_lantern: 'blocks/glass-light-blue.png',
  bone_block: 'blocks/white-concrete.png',
  note_block: 'blocks/oak-planks.png',
  furnace: 'blocks/stone.png',
  blast_furnace: 'blocks/stone.png',
  smoker: 'blocks/stone.png',
  observer: 'blocks/stone.png',
  dispenser: 'blocks/stone.png',
  dropper: 'blocks/stone.png',
  piston: 'blocks/stone.png',
  sticky_piston: 'blocks/stone.png',
  target: 'blocks/white-concrete.png',
  dried_kelp_block: 'blocks/green-concrete.png',
  melon: 'blocks/lime-concrete.png',
  pumpkin: 'blocks/orange-concrete.png',
  carved_pumpkin: 'blocks/orange-concrete.png',
  jack_o_lantern: 'blocks/orange-concrete.png',
  shroomlight: 'blocks/yellow-concrete.png',
  redstone_lamp: 'blocks/yellow-concrete.png',
  redstone_block: 'blocks/red-concrete.png',
  lapis_block: 'blocks/blue-concrete.png',
  lapis_ore: 'blocks/blue-concrete.png',
  raw_iron_block: 'blocks/iron-block.png',
  raw_gold_block: 'blocks/gold-block.png',
  raw_copper_block: 'blocks/orange-concrete.png',
  copper_block: 'blocks/orange-concrete.png',
  exposed_copper: 'blocks/orange-concrete.png',
  weathered_copper: 'blocks/cyan-concrete.png',
  oxidized_copper: 'blocks/cyan-concrete.png',
  cut_copper: 'blocks/orange-concrete.png',
  tuff: 'blocks/andesite.png',
  calcite: 'blocks/white-concrete.png',
  amethyst_block: 'blocks/purple-concrete.png',
  moss_block: 'blocks/green-concrete.png',
  sculk: 'blocks/black-concrete.png',
};

// Blocks to skip (non-solid, decorative, or air-like)
const SKIP_BLOCKS = new Set([
  'air', 'cave_air', 'void_air',
  'barrier', 'structure_void', 'light',
  // Non-solid blocks that don't translate well to Hytopia block grid
  'torch', 'wall_torch', 'soul_torch', 'soul_wall_torch', 'redstone_torch', 'redstone_wall_torch',
  'lever', 'button', 'stone_button', 'oak_button', 'spruce_button', 'birch_button',
  'pressure_plate', 'stone_pressure_plate', 'oak_pressure_plate', 'light_weighted_pressure_plate', 'heavy_weighted_pressure_plate',
  'tripwire', 'tripwire_hook', 'string',
  'flower_pot', 'potted_oak_sapling',
  'rail', 'powered_rail', 'detector_rail', 'activator_rail',
  'redstone_wire', 'repeater', 'comparator',
  'sign', 'oak_sign', 'oak_wall_sign', 'spruce_sign', 'spruce_wall_sign', 'birch_sign', 'birch_wall_sign',
  'hanging_sign', 'oak_hanging_sign',
  'ladder',
  'painting', 'item_frame', 'glow_item_frame',
  'armor_stand',
  'flower', 'dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy', 'cornflower', 'lily_of_the_valley', 'wither_rose', 'sunflower', 'lilac', 'rose_bush', 'peony',
  'tall_grass', 'short_grass', 'grass', 'fern', 'large_fern', 'dead_bush',
  'vine', 'glow_lichen', 'moss_carpet', 'sculk_vein',
  'sugar_cane', 'kelp', 'kelp_plant', 'seagrass', 'tall_seagrass',
  'wheat', 'carrots', 'potatoes', 'beetroots', 'melon_stem', 'pumpkin_stem',
  'lily_pad',
  'cobweb',
  'snow_layer',
  'fire', 'soul_fire',
  'nether_portal', 'end_portal',
  'spawner', 'mob_spawner',
  'end_rod',
  'chorus_flower', 'chorus_plant',
  'pointed_dripstone',
  'hanging_roots', 'spore_blossom',
  'candle', 'white_candle', 'orange_candle', 'magenta_candle',
  'bell', 'lantern', 'soul_lantern',
  'campfire', 'soul_campfire',
  'brewing_stand', 'cauldron', 'flower_pot',
  'head', 'skull', 'player_head', 'player_wall_head',
  'banner', 'white_banner', 'wall_banner',
  'bed', 'white_bed', 'orange_bed', 'red_bed',
  // Additional non-solid blocks found in schematics
  'azalea', 'flowering_azalea',
  'bamboo', 'bamboo_sapling',
  'hopper', 'lectern', 'cocoa', 'cake',
  'chest', 'ender_chest', 'trapped_chest', 'barrel',
  'anvil', 'chipped_anvil', 'damaged_anvil',
  'enchanting_table', 'grindstone', 'stonecutter', 'smithing_table', 'cartography_table', 'loom',
  'scaffolding', 'chain',
  'conduit', 'beacon',
  'sweet_berry_bush', 'cave_vines', 'cave_vines_plant',
  'composter', 'beehive', 'bee_nest',
]);

// ============================================
// BLOCK MAPPING FUNCTIONS (from mc-to-hytopia.cjs)
// ============================================

/**
 * Strip "minecraft:" prefix and block state properties (e.g. [facing=north])
 */
function normalizeBlockName(name) {
  let n = name.replace(/^minecraft:/, '');
  const bracketIdx = n.indexOf('[');
  if (bracketIdx !== -1) n = n.substring(0, bracketIdx);
  return n;
}

/**
 * Attempt to find a Hytopia texture for a Minecraft block name.
 * Falls back to a best-guess based on keywords in the name.
 */
function resolveTexture(mcName) {
  // Direct lookup
  if (mcName in BLOCK_MAP) {
    return BLOCK_MAP[mcName];
  }

  // Stair/slab/wall/fence variants -> base material
  const suffixes = ['_stairs', '_slab', '_wall', '_fence', '_fence_gate', '_door', '_trapdoor'];
  for (const suffix of suffixes) {
    if (mcName.endsWith(suffix)) {
      const base = mcName.slice(0, -suffix.length);
      if (base in BLOCK_MAP) return BLOCK_MAP[base];
      if ((base + '_block') in BLOCK_MAP) return BLOCK_MAP[base + '_block'];
      if ((base + '_planks') in BLOCK_MAP) return BLOCK_MAP[base + '_planks'];
      if ((base + 's') in BLOCK_MAP) return BLOCK_MAP[base + 's'];
    }
  }

  // Keyword-based fallback
  if (mcName.includes('stone')) return 'blocks/stone.png';
  if (mcName.includes('cobble')) return 'blocks/cobblestone.png';
  if (mcName.includes('brick')) return 'blocks/bricks.png';
  if (mcName.includes('sand')) return 'blocks/sand.png';
  if (mcName.includes('dirt') || mcName.includes('mud')) return 'blocks/dirt.png';
  if (mcName.includes('grass')) return 'blocks/grass-block';
  if (mcName.includes('oak')) return 'blocks/oak-planks.png';
  if (mcName.includes('spruce')) return 'blocks/spruce-planks.png';
  if (mcName.includes('birch')) return 'blocks/birch-planks.png';
  if (mcName.includes('iron')) return 'blocks/iron-block.png';
  if (mcName.includes('gold')) return 'blocks/gold-block.png';
  if (mcName.includes('diamond')) return 'blocks/diamond-block.png';
  if (mcName.includes('glass')) return 'blocks/glass.png';
  if (mcName.includes('ice') || mcName.includes('frost')) return 'blocks/ice.png';
  if (mcName.includes('snow')) return 'blocks/snow.png';
  if (mcName.includes('leaves') || mcName.includes('leaf')) return 'blocks/oak-leaves.png';
  if (mcName.includes('log') || mcName.includes('wood')) return 'blocks/oak-log';
  if (mcName.includes('plank')) return 'blocks/oak-planks.png';
  if (mcName.includes('wool')) return 'blocks/white-concrete.png';
  if (mcName.includes('concrete')) return 'blocks/gray-concrete.png';
  if (mcName.includes('terracotta') || mcName.includes('glazed')) return 'blocks/brown-concrete.png';
  if (mcName.includes('quartz')) return 'blocks/white-concrete.png';
  if (mcName.includes('deepslate')) return 'blocks/deepslate.png';
  if (mcName.includes('copper')) return 'blocks/orange-concrete.png';
  if (mcName.includes('calcite') || mcName.includes('dripstone')) return 'blocks/andesite.png';
  if (mcName.includes('mushroom')) return 'blocks/brown-mushroom-block.png';

  return null; // truly unknown
}

/**
 * Check if a block should be skipped (non-solid / decorative).
 */
function shouldSkip(mcName) {
  if (SKIP_BLOCKS.has(mcName)) return true;
  if (mcName.includes('banner')) return true;
  if (mcName.includes('candle')) return true;
  if (mcName.includes('sign') && !mcName.includes('design')) return true;
  if (mcName.includes('head') || mcName.includes('skull')) return true;
  if (mcName.includes('potted_')) return true;
  if (mcName.includes('button')) return true;
  if (mcName.includes('pressure_plate')) return true;
  if (mcName.includes('_carpet') && !mcName.includes('moss_carpet')) return true;
  if (mcName.includes('torch')) return true;
  if (mcName.includes('sapling')) return true;
  if (mcName.includes('flower') && !mcName.includes('block')) return true;
  return false;
}

// ============================================
// REGION FILE PARSING
// ============================================

/**
 * Parse region filenames in a directory to get a list of region coords.
 * Returns [{rx, rz, file}, ...] for each r.<rx>.<rz>.mca file.
 */
function listRegionFiles(regionDir) {
  const files = fs.readdirSync(regionDir);
  const regions = [];
  for (const file of files) {
    const match = file.match(/^r\.(-?\d+)\.(-?\d+)\.mca$/);
    if (match) {
      regions.push({
        rx: parseInt(match[1], 10),
        rz: parseInt(match[2], 10),
        file: path.join(regionDir, file),
      });
    }
  }
  return regions;
}

// ============================================
// MAIN CONVERTER
// ============================================

/**
 * Convert a Minecraft world directory (with region/ folder) to Hytopia map.json.
 * Uses prismarine-provider-anvil chunk-by-chunk, with streaming JSON output.
 */
async function convertWorld(worldDir, outputPath, opts = {}) {
  const regionDir = path.join(worldDir, 'region');
  if (!fs.existsSync(regionDir)) {
    throw new Error(`No region/ directory found in: ${worldDir}`);
  }

  const worldName = path.basename(worldDir);
  console.log(`\n========================================`);
  console.log(`Converting world: ${worldName}`);
  console.log(`  World dir: ${worldDir}`);
  console.log(`  Output:    ${outputPath}`);
  console.log(`========================================`);

  // List all region files
  const regionFiles = listRegionFiles(regionDir);
  if (regionFiles.length === 0) {
    throw new Error(`No .mca files found in: ${regionDir}`);
  }
  console.log(`  Found ${regionFiles.length} region files`);

  // Compute total chunk range for centering
  let minChunkX = Infinity, maxChunkX = -Infinity;
  let minChunkZ = Infinity, maxChunkZ = -Infinity;
  for (const { rx, rz } of regionFiles) {
    const cxStart = rx * 32;
    const czStart = rz * 32;
    minChunkX = Math.min(minChunkX, cxStart);
    maxChunkX = Math.max(maxChunkX, cxStart + 31);
    minChunkZ = Math.min(minChunkZ, czStart);
    maxChunkZ = Math.max(maxChunkZ, czStart + 31);
  }

  // Center offset: shift so the center of the world is at origin
  const centerBlockX = Math.floor(((minChunkX + maxChunkX + 1) * 16) / 2);
  const centerBlockZ = Math.floor(((minChunkZ + maxChunkZ + 1) * 16) / 2);
  console.log(`  Chunk range: X[${minChunkX}..${maxChunkX}] Z[${minChunkZ}..${maxChunkZ}]`);
  console.log(`  Center offset: (${-centerBlockX}, ${-centerBlockZ})`);

  // Initialize prismarine-provider-anvil for Minecraft 1.20.4
  const AnvilFactory = require('prismarine-provider-anvil').Anvil;
  const Anvil = AnvilFactory('1.20.4');
  const anvil = new Anvil(regionDir);

  // Texture -> block ID mapping (shared across all chunks)
  const textureToId = new Map();
  const blockTypes = [];
  let nextId = 1;
  const unmappedBlocks = new Map();

  // Stats
  let totalBlocks = 0;
  let skippedBlocks = 0;
  let emptyChunks = 0;
  let errorChunks = 0;
  let processedChunks = 0;

  // Count total chunks to process (up to 32*32 per region, but many may be empty)
  const totalPossibleChunks = regionFiles.length * 32 * 32;

  // Prepare streaming output
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const writeStream = fs.createWriteStream(outputPath);
  const write = (s) => new Promise((resolve, reject) => {
    if (!writeStream.write(s)) {
      writeStream.once('drain', resolve);
    } else {
      resolve();
    }
  });

  // Write placeholder for blockTypes (we'll need to rewrite the file header later)
  // Instead, we collect all blocks first in a streaming fashion, then prepend the header.
  // But since blockTypes depend on which blocks we encounter, we use a two-pass approach:
  // Pass 1 - stream blocks to a temp file, track blockTypes
  // Pass 2 - write final JSON with blockTypes header + blocks from temp

  // Actually, we can write the blocks section first to a temp file, then assemble.
  const tempBlocksPath = outputPath + '.tmp';
  const tempStream = fs.createWriteStream(tempBlocksPath);
  const writeTemp = (s) => new Promise((resolve, reject) => {
    if (!tempStream.write(s)) {
      tempStream.once('drain', resolve);
    } else {
      resolve();
    }
  });

  let firstBlock = true;
  const startTime = Date.now();

  // Y range for 1.20.4: -64 to +319 (height 384)
  // Can be overridden via opts to trim underground/sky and reduce file size
  const MIN_Y = opts.minY ?? -64;
  const MAX_Y = opts.maxY ?? 320;
  console.log(`  Y range: ${MIN_Y} to ${MAX_Y - 1}`);

  // Process each region file
  for (let ri = 0; ri < regionFiles.length; ri++) {
    const { rx, rz } = regionFiles[ri];
    const regionLabel = `r.${rx}.${rz}.mca`;
    const pct = Math.round(((ri) / regionFiles.length) * 100);
    process.stdout.write(`\r  [${pct}%] Processing region ${regionLabel} (${ri + 1}/${regionFiles.length}) - ${totalBlocks} blocks placed...`);

    // Iterate all 32x32 chunk positions in this region
    for (let localX = 0; localX < 32; localX++) {
      for (let localZ = 0; localZ < 32; localZ++) {
        const chunkX = rx * 32 + localX;
        const chunkZ = rz * 32 + localZ;

        let chunk;
        try {
          chunk = await anvil.load(chunkX, chunkZ);
        } catch (err) {
          // Chunk doesn't exist or is corrupted - skip silently
          errorChunks++;
          continue;
        }

        if (!chunk) {
          emptyChunks++;
          continue;
        }

        processedChunks++;

        // Iterate all blocks in this chunk
        // Chunk local coords: x 0-15, z 0-15, y MIN_Y to MAX_Y-1
        const pos = { x: 0, y: 0, z: 0 };
        for (pos.y = MIN_Y; pos.y < MAX_Y; pos.y++) {
          for (pos.z = 0; pos.z < 16; pos.z++) {
            for (pos.x = 0; pos.x < 16; pos.x++) {
              let block;
              try {
                block = chunk.getBlock(pos);
              } catch {
                continue;
              }

              if (!block || !block.name) continue;

              const mcName = normalizeBlockName(block.name);

              // Skip air variants
              if (mcName === 'air' || mcName === 'cave_air' || mcName === 'void_air') continue;

              // Skip non-solid/decorative blocks
              if (shouldSkip(mcName)) {
                skippedBlocks++;
                continue;
              }

              // Resolve Hytopia texture
              const textureUri = resolveTexture(mcName);
              if (textureUri === null) {
                if (BLOCK_MAP[mcName] === null) {
                  skippedBlocks++;
                  continue;
                }
                // Truly unmapped
                unmappedBlocks.set(mcName, (unmappedBlocks.get(mcName) || 0) + 1);
                continue;
              }

              // Assign or retrieve Hytopia block type ID
              let blockId = textureToId.get(textureUri);
              if (blockId === undefined) {
                blockId = nextId++;
                textureToId.set(textureUri, blockId);

                const name = textureUri
                  .replace('blocks/', '')
                  .replace('.png', '')
                  .split('-')
                  .map(w => w.charAt(0).toUpperCase() + w.slice(1))
                  .join(' ');

                const blockType = { id: blockId, name, textureUri };
                if (!textureUri.endsWith('.png')) blockType.isMultiTexture = true;
                if (textureUri.includes('water') || textureUri.includes('lava')) blockType.isLiquid = true;
                blockTypes.push(blockType);
              }

              // World position (centered)
              const worldX = chunkX * 16 + pos.x - centerBlockX;
              const worldY = pos.y; // keep Y as-is (Hytopia uses same Y convention)
              const worldZ = chunkZ * 16 + pos.z - centerBlockZ;

              const key = `${worldX},${worldY},${worldZ}`;

              if (firstBlock) {
                await writeTemp(`"${key}":${blockId}`);
                firstBlock = false;
              } else {
                await writeTemp(`,"${key}":${blockId}`);
              }
              totalBlocks++;
            }
          }
        }
      }
    }
  }

  // Close temp blocks stream
  await new Promise((resolve) => tempStream.end(resolve));

  process.stdout.write(`\r  [100%] All regions processed. ${totalBlocks} blocks placed.                              \n`);

  // Now assemble the final JSON: blockTypes header + blocks from temp file
  console.log(`  Assembling final map.json...`);

  await write('{"blockTypes":');
  await write(JSON.stringify(blockTypes, null, 2));
  await write(',"blocks":{');

  // Stream temp blocks file into output
  await new Promise((resolve, reject) => {
    const readStream = fs.createReadStream(tempBlocksPath, { highWaterMark: 64 * 1024 });
    readStream.on('data', (chunk) => {
      if (!writeStream.write(chunk)) {
        readStream.pause();
        writeStream.once('drain', () => readStream.resume());
      }
    });
    readStream.on('end', resolve);
    readStream.on('error', reject);
  });

  await write('}}');
  await new Promise((resolve) => writeStream.end(resolve));

  // Clean up temp file
  try { fs.unlinkSync(tempBlocksPath); } catch {}

  // Close anvil file handles
  try { await anvil.close(); } catch {}

  // Report
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const stats = fs.statSync(outputPath);
  const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);

  console.log(`\n  --- Conversion Summary ---`);
  console.log(`  Time elapsed:       ${elapsed}s`);
  console.log(`  Regions processed:  ${regionFiles.length}`);
  console.log(`  Chunks loaded:      ${processedChunks}`);
  console.log(`  Chunks empty:       ${emptyChunks}`);
  console.log(`  Chunks errored:     ${errorChunks}`);
  console.log(`  Block types:        ${blockTypes.length}`);
  console.log(`  Total placed blocks: ${totalBlocks.toLocaleString()}`);
  console.log(`  Skipped (non-solid): ${skippedBlocks.toLocaleString()}`);
  console.log(`  Output file size:   ${fileSizeMB} MB`);

  if (unmappedBlocks.size > 0) {
    console.log(`  Unmapped blocks (${unmappedBlocks.size} types):`);
    const sorted = [...unmappedBlocks.entries()].sort((a, b) => b[1] - a[1]);
    for (const [name, count] of sorted.slice(0, 20)) {
      console.log(`    - ${name}: ${count.toLocaleString()}`);
    }
    if (sorted.length > 20) {
      console.log(`    ... and ${sorted.length - 20} more`);
    }
  }

  console.log(`  Done!\n`);

  return { totalBlocks, blockTypes: blockTypes.length, unmapped: unmappedBlocks.size };
}

// ============================================
// MAIN
// ============================================

const WORLDS_DIR = path.join('C:', 'Users', 'chris', 'Merkari-files', 'extracted', 'worlds');
const OUTPUT_DIR = path.join('C:', 'Users', 'chris', 'Merkari-files', 'athlete-domains-hytopia', 'assets', 'maps');

const ALL_WORLDS = [
  {
    input: path.join(WORLDS_DIR, 'map_template_island'),
    output: path.join(OUTPUT_DIR, 'lobby-island.json'),
    name: 'Lobby Island',
  },
  {
    input: path.join(WORLDS_DIR, 'map_template_parkour'),
    output: path.join(OUTPUT_DIR, 'parkour-course.json'),
    name: 'Parkour Course',
  },
];

async function main() {
  const rawArgs = process.argv.slice(2);

  // Parse --min-y and --max-y flags from anywhere in the args
  const opts = {};
  const args = [];
  for (let i = 0; i < rawArgs.length; i++) {
    if (rawArgs[i] === '--min-y' && i + 1 < rawArgs.length) {
      opts.minY = parseInt(rawArgs[++i], 10);
    } else if (rawArgs[i] === '--max-y' && i + 1 < rawArgs.length) {
      opts.maxY = parseInt(rawArgs[++i], 10);
    } else {
      args.push(rawArgs[i]);
    }
  }

  if (args[0] === '--all') {
    console.log('=== Minecraft .mca (Anvil) -> Hytopia Converter ===');
    console.log(`Converting all ${ALL_WORLDS.length} world templates...\n`);
    if (opts.minY != null || opts.maxY != null) {
      console.log(`  Y filter: min=${opts.minY ?? -64} max=${opts.maxY ?? 320}`);
    }

    for (const { input, output, name } of ALL_WORLDS) {
      if (!fs.existsSync(input)) {
        console.log(`  SKIP: ${name} (directory not found: ${input})`);
        continue;
      }
      if (!fs.existsSync(path.join(input, 'region'))) {
        console.log(`  SKIP: ${name} (no region/ folder in: ${input})`);
        continue;
      }

      try {
        await convertWorld(input, output, opts);
      } catch (err) {
        console.error(`  ERROR converting ${name}: ${err.message}`);
        console.error(err.stack);
      }
    }

    console.log('\n=== All conversions complete! ===');
    console.log(`Output directory: ${OUTPUT_DIR}`);
  } else if (args.length >= 2) {
    const worldDir = path.resolve(args[0]);
    const outputPath = path.resolve(args[1]);

    if (!fs.existsSync(worldDir)) {
      console.error(`Error: World directory not found: ${worldDir}`);
      process.exit(1);
    }
    if (!fs.existsSync(path.join(worldDir, 'region'))) {
      console.error(`Error: No region/ folder found in: ${worldDir}`);
      process.exit(1);
    }

    try {
      await convertWorld(worldDir, outputPath, opts);
    } catch (err) {
      console.error(`Fatal error: ${err.message}`);
      console.error(err.stack);
      process.exit(1);
    }
  } else if (args.length === 1) {
    // Single arg: world dir, auto-generate output name
    const worldDir = path.resolve(args[0]);
    const worldName = path.basename(worldDir);
    const outputPath = path.join(OUTPUT_DIR, worldName + '.json');

    if (!fs.existsSync(worldDir)) {
      console.error(`Error: World directory not found: ${worldDir}`);
      process.exit(1);
    }
    if (!fs.existsSync(path.join(worldDir, 'region'))) {
      console.error(`Error: No region/ folder found in: ${worldDir}`);
      process.exit(1);
    }

    try {
      await convertWorld(worldDir, outputPath, opts);
    } catch (err) {
      console.error(`Fatal error: ${err.message}`);
      console.error(err.stack);
      process.exit(1);
    }
  } else {
    console.log('Minecraft .mca (Anvil Region) to Hytopia map.json Converter');
    console.log('');
    console.log('Usage:');
    console.log('  node scripts/mca-to-hytopia.cjs <world-dir> <output.json>');
    console.log('  node scripts/mca-to-hytopia.cjs <world-dir>');
    console.log('  node scripts/mca-to-hytopia.cjs --all');
    console.log('');
    console.log('Arguments:');
    console.log('  <world-dir>    Minecraft world directory (must contain a region/ folder)');
    console.log('  <output.json>  Output path for the Hytopia map.json file');
    console.log('');
    console.log('Options:');
    console.log('  --all          Convert both world templates (lobby island + parkour course)');
    console.log('');
    console.log('World templates:');
    for (const { input, name } of ALL_WORLDS) {
      const exists = fs.existsSync(input) ? 'OK' : 'NOT FOUND';
      console.log(`  - ${name}: ${input} [${exists}]`);
    }
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
