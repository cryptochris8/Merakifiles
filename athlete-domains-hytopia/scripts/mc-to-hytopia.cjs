/**
 * Minecraft .schem (Sponge Schematic) -> Hytopia map.json converter
 *
 * Uses prismarine-schematic to parse .schem files and outputs
 * Hytopia-compatible map.json with block type mappings.
 *
 * Usage:
 *   node scripts/mc-to-hytopia.js <input.schem> [output.json]
 *   node scripts/mc-to-hytopia.js --all   (converts all 4 schematics)
 */

const fs = require('fs');
const path = require('path');
const { Schematic } = require('prismarine-schematic');
const { Vec3 } = require('vec3');
const nbtLib = require('nbt');

// ============================================
// MINECRAFT -> HYTOPIA BLOCK MAPPING
// ============================================
// Maps Minecraft block names (without "minecraft:" prefix) to Hytopia texture URIs.
// Hytopia textures come from the MapTopia asset library (24x24 block textures).
// Blocks without .png extension are multi-texture (directory-based).

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
// CONVERTER
// ============================================

/**
 * Strip "minecraft:" prefix and block state properties (e.g. [facing=north])
 */
function normalizeBlockName(name) {
  let n = name.replace(/^minecraft:/, '');
  // Remove block state properties
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
      // Try with common block suffixes
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
  // Skip common non-solid patterns
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

/**
 * Convert a .schem file to Hytopia map.json format.
 */
async function convertSchematic(inputPath, outputPath) {
  console.log(`\nConverting: ${path.basename(inputPath)}`);
  console.log(`  Input:  ${inputPath}`);
  console.log(`  Output: ${outputPath}`);

  // Read schematic
  const buffer = await fs.promises.readFile(inputPath);
  const schematic = await Schematic.read(buffer);

  console.log(`  Size: ${schematic.size.x} x ${schematic.size.y} x ${schematic.size.z} (${schematic.size.x * schematic.size.y * schematic.size.z} total voxels)`);

  // Collect unique textures and blocks
  const textureToId = new Map(); // textureUri -> blockTypeId
  const blockTypes = [];
  const blocks = {};
  let nextId = 1;
  let totalBlocks = 0;
  let skippedBlocks = 0;
  const unmappedBlocks = new Map(); // mcName -> count

  // Center the schematic: offset so center is near origin, base at y=0
  const offsetX = -Math.floor(schematic.size.x / 2);
  const offsetY = 0; // keep base at y=0
  const offsetZ = -Math.floor(schematic.size.z / 2);

  // Iterate all blocks
  const start = schematic.start();
  const end = schematic.end();

  for (let y = start.y; y <= end.y; y++) {
    for (let z = start.z; z <= end.z; z++) {
      for (let x = start.x; x <= end.x; x++) {
        let block;
        try {
          block = schematic.getBlock(new Vec3(x, y, z));
        } catch {
          continue;
        }

        if (!block || !block.name) continue;

        const mcName = normalizeBlockName(block.name);

        // Skip air and non-solid
        if (mcName === 'air' || mcName === 'cave_air' || mcName === 'void_air') continue;
        if (shouldSkip(mcName)) {
          skippedBlocks++;
          continue;
        }

        // Resolve Hytopia texture
        const textureUri = resolveTexture(mcName);
        if (textureUri === null) {
          // null means explicitly skip (like barrier)
          if (BLOCK_MAP[mcName] === null) {
            skippedBlocks++;
            continue;
          }
          // Truly unmapped
          unmappedBlocks.set(mcName, (unmappedBlocks.get(mcName) || 0) + 1);
          continue;
        }

        // Assign block type ID
        let blockId = textureToId.get(textureUri);
        if (blockId === undefined) {
          blockId = nextId++;
          textureToId.set(textureUri, blockId);

          // Determine name from texture
          const name = textureUri
            .replace('blocks/', '')
            .replace('.png', '')
            .split('-')
            .map(w => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ');

          const blockType = {
            id: blockId,
            name,
            textureUri,
          };

          // Multi-texture blocks don't have .png extension
          if (!textureUri.endsWith('.png')) {
            blockType.isMultiTexture = true;
          }

          // Liquid blocks
          if (textureUri.includes('water') || textureUri.includes('lava')) {
            blockType.isLiquid = true;
          }

          blockTypes.push(blockType);
        }

        // Map block position (centered)
        const bx = (x - start.x) + offsetX;
        const by = (y - start.y) + offsetY;
        const bz = (z - start.z) + offsetZ;
        const key = `${bx},${by},${bz}`;
        blocks[key] = blockId;
        totalBlocks++;
      }
    }
  }

  // Build output JSON
  const mapJson = {
    blockTypes,
    blocks,
  };

  // Write output
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  await fs.promises.writeFile(outputPath, JSON.stringify(mapJson, null, 2));

  // Report
  console.log(`  Block types: ${blockTypes.length}`);
  console.log(`  Total placed blocks: ${totalBlocks}`);
  console.log(`  Skipped (non-solid): ${skippedBlocks}`);

  if (unmappedBlocks.size > 0) {
    console.log(`  Unmapped blocks (${unmappedBlocks.size} types):`);
    const sorted = [...unmappedBlocks.entries()].sort((a, b) => b[1] - a[1]);
    for (const [name, count] of sorted.slice(0, 20)) {
      console.log(`    - ${name}: ${count}`);
    }
    if (sorted.length > 20) {
      console.log(`    ... and ${sorted.length - 20} more`);
    }
  }

  const fileSizeMB = (Buffer.byteLength(JSON.stringify(mapJson)) / (1024 * 1024)).toFixed(2);
  console.log(`  Output file size: ~${fileSizeMB} MB`);
  console.log(`  Done!`);

  return { totalBlocks, blockTypes: blockTypes.length, unmapped: unmappedBlocks.size };
}

// ============================================
// FALLBACK CONVERTER (for large schematics that exceed prismarine-nbt limits)
// Uses the 'nbt' npm package to manually parse Sponge schematic format.
// ============================================

/**
 * Fallback converter for large .schem files using the 'nbt' package.
 * Optimized: pre-computes palette -> hytopia ID mapping and streams JSON output.
 */
async function convertSchematicFallback(inputPath, outputPath) {
  console.log(`  (Using fallback NBT parser for large schematic)`);

  const buffer = await fs.promises.readFile(inputPath);

  // Parse NBT using the 'nbt' package (no size limits)
  const nbtData = await new Promise((resolve, reject) => {
    nbtLib.parse(buffer, (err, data) => {
      if (err) reject(err);
      else resolve(data.value);
    });
  });

  // Extract schematic data (Sponge v1 or v2)
  const root = nbtData.Schematic ? nbtData.Schematic.value : nbtData;
  const width = root.Width.value;
  const height = root.Height.value;
  const length = root.Length.value;
  const blockDataSigned = root.BlockData.value; // Int8Array
  const palette = root.Palette.value;

  console.log(`  Size: ${width} x ${height} x ${length} (${width * height * length} total voxels)`);
  console.log(`  Palette size: ${Object.keys(palette).length}`);

  // Convert to Uint8Array for correct varint reading
  // nbt package returns byteArray as a regular Array of signed numbers (-128 to 127)
  const blockData = (blockDataSigned instanceof Int8Array || blockDataSigned instanceof Uint8Array)
    ? new Uint8Array(blockDataSigned.buffer, blockDataSigned.byteOffset, blockDataSigned.byteLength)
    : Uint8Array.from(blockDataSigned, b => b & 0xFF);

  // Pre-compute: for each palette index, what Hytopia block ID does it map to?
  // This avoids normalizing/resolving on every single voxel.
  const textureToId = new Map();
  const blockTypes = [];
  let nextId = 1;
  const unmappedBlocks = new Map();

  // paletteToHytopia[paletteIdx] = hytopiaBlockId (0 = skip)
  const maxPaletteIdx = Math.max(...Object.values(palette).map(e => e.value)) + 1;
  const paletteToHytopia = new Int32Array(maxPaletteIdx); // 0 = skip

  for (const [blockName, entry] of Object.entries(palette)) {
    const paletteIdx = entry.value;
    const mcName = normalizeBlockName(blockName);

    // Air
    if (mcName === 'air' || mcName === 'cave_air' || mcName === 'void_air') {
      paletteToHytopia[paletteIdx] = 0;
      continue;
    }
    // Non-solid
    if (shouldSkip(mcName)) {
      paletteToHytopia[paletteIdx] = -1; // skip but count
      continue;
    }

    const textureUri = resolveTexture(mcName);
    if (textureUri === null) {
      if (BLOCK_MAP[mcName] === null) {
        paletteToHytopia[paletteIdx] = -1;
      } else {
        paletteToHytopia[paletteIdx] = -2; // unmapped
        unmappedBlocks.set(mcName, 0); // will count during iteration
      }
      continue;
    }

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

    paletteToHytopia[paletteIdx] = blockId;
  }

  // Also build a reverse lookup for unmapped counting
  const paletteToMcName = {};
  for (const [blockName, entry] of Object.entries(palette)) {
    paletteToMcName[entry.value] = normalizeBlockName(blockName);
  }

  console.log(`  Pre-computed ${blockTypes.length} block types. Streaming blocks to file...`);

  // Center offsets
  const offsetX = -Math.floor(width / 2);
  const offsetZ = -Math.floor(length / 2);

  // Stream JSON output to avoid building huge object in memory
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const writeStream = fs.createWriteStream(outputPath);
  const write = (s) => new Promise((resolve, reject) => {
    if (!writeStream.write(s)) {
      writeStream.once('drain', resolve);
    } else {
      resolve();
    }
  });

  // Write blockTypes header
  await write('{"blockTypes":');
  await write(JSON.stringify(blockTypes, null, 2));
  await write(',"blocks":{');

  let totalBlocks = 0;
  let skippedBlocks = 0;
  let first = true;

  // Read block data (varint encoded), stream blocks to file
  let dataIdx = 0;
  const totalVoxels = width * height * length;
  let voxelCount = 0;
  const reportInterval = Math.floor(totalVoxels / 10);

  for (let y = 0; y < height; y++) {
    for (let z = 0; z < length; z++) {
      for (let x = 0; x < width; x++) {
        voxelCount++;
        if (dataIdx >= blockData.length) break;

        // Inline varint read for performance
        let paletteIdx = 0;
        let shift = 0;
        while (true) {
          const b = blockData[dataIdx++];
          paletteIdx |= (b & 0x7F) << shift;
          if ((b & 0x80) === 0) break;
          shift += 7;
        }

        if (paletteIdx >= maxPaletteIdx) continue;
        const hytopiaId = paletteToHytopia[paletteIdx];

        if (hytopiaId === 0) continue; // air
        if (hytopiaId === -1) { skippedBlocks++; continue; } // non-solid skip
        if (hytopiaId === -2) {
          // unmapped
          const mcName = paletteToMcName[paletteIdx];
          if (mcName) unmappedBlocks.set(mcName, (unmappedBlocks.get(mcName) || 0) + 1);
          continue;
        }

        // Write block entry
        const key = `${x + offsetX},${y},${z + offsetZ}`;
        if (first) {
          await write(`"${key}":${hytopiaId}`);
          first = false;
        } else {
          await write(`,"${key}":${hytopiaId}`);
        }
        totalBlocks++;

        // Progress report
        if (voxelCount % reportInterval === 0) {
          const pct = Math.round((voxelCount / totalVoxels) * 100);
          process.stdout.write(`\r  Progress: ${pct}% (${totalBlocks} blocks placed)`);
        }
      }
    }
  }

  await write('}}');
  await new Promise((resolve) => writeStream.end(resolve));

  console.log(`\r  Progress: 100%                                    `);

  // Report
  console.log(`  Block types: ${blockTypes.length}`);
  console.log(`  Total placed blocks: ${totalBlocks}`);
  console.log(`  Skipped (non-solid): ${skippedBlocks}`);

  if (unmappedBlocks.size > 0) {
    console.log(`  Unmapped blocks (${unmappedBlocks.size} types):`);
    const sorted = [...unmappedBlocks.entries()].sort((a, b) => b[1] - a[1]);
    for (const [name, count] of sorted.slice(0, 20)) {
      console.log(`    - ${name}: ${count}`);
    }
    if (sorted.length > 20) console.log(`    ... and ${sorted.length - 20} more`);
  }

  const stats = fs.statSync(outputPath);
  const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
  console.log(`  Output file size: ~${fileSizeMB} MB`);
  console.log(`  Done!`);

  return { totalBlocks, blockTypes: blockTypes.length, unmapped: unmappedBlocks.size };
}

// ============================================
// MAIN
// ============================================

const SCHEMATICS_DIR = path.join(
  'C:', 'Users', 'chris', 'Merkari-files', 'extracted', 'worlds',
  'plugins', 'FastAsyncWorldEdit', 'schematics'
);

const OUTPUT_DIR = path.join(
  'C:', 'Users', 'chris', 'Merkari-files', 'athlete-domains-hytopia', 'assets', 'maps'
);

const ALL_SCHEMATICS = [
  { input: 'football_field.schem', output: 'football-field.json' },
  { input: 'sumo.schem', output: 'sumo-arena.json' },
  { input: 'tower_duel.schem', output: 'tower-duel.json' },
  { input: 'road.schem', output: 'road.json' },
];

async function main() {
  const args = process.argv.slice(2);

  if (args[0] === '--all') {
    console.log('=== Minecraft -> Hytopia Converter ===');
    console.log(`Converting all ${ALL_SCHEMATICS.length} schematics...\n`);

    for (const { input, output } of ALL_SCHEMATICS) {
      const inputPath = path.join(SCHEMATICS_DIR, input);
      const outputPath = path.join(OUTPUT_DIR, output);

      if (!fs.existsSync(inputPath)) {
        console.log(`  SKIP: ${input} (file not found)`);
        continue;
      }

      try {
        await convertSchematic(inputPath, outputPath);
      } catch (err) {
        console.log(`  Primary parser failed (${err.message.substring(0, 60)}...)`);
        try {
          await convertSchematicFallback(inputPath, outputPath);
        } catch (err2) {
          console.error(`  ERROR: Fallback also failed: ${err2.message}`);
        }
      }
    }

    console.log('\n=== All conversions complete! ===');
    console.log(`Output directory: ${OUTPUT_DIR}`);
  } else if (args.length >= 1) {
    const inputPath = path.resolve(args[0]);
    const outputPath = args[1]
      ? path.resolve(args[1])
      : inputPath.replace(/\.schem$/, '.json');

    if (!fs.existsSync(inputPath)) {
      console.error(`Error: File not found: ${inputPath}`);
      process.exit(1);
    }

    try {
      await convertSchematic(inputPath, outputPath);
    } catch (err) {
      console.log(`  Primary parser failed, trying fallback...`);
      await convertSchematicFallback(inputPath, outputPath);
    }
  } else {
    console.log('Usage:');
    console.log('  node scripts/mc-to-hytopia.js <input.schem> [output.json]');
    console.log('  node scripts/mc-to-hytopia.js --all');
    console.log('');
    console.log('Options:');
    console.log('  --all    Convert all 4 schematics (football, sumo, tower_duel, road)');
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
