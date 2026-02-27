/**
 * MapLoader - Merges multiple Hytopia WorldMap JSON files into a single world.
 *
 * Since world.loadMap() replaces all blocks, we pre-merge arena maps with
 * coordinate offsets into one combined WorldMap that can be loaded once.
 * Handles block type deduplication and ID remapping across maps.
 *
 * IMPORTANT: In Hytopia WorldMap format, block values are blockType `id` values
 * (1-based), NOT array indices. The `id` field of each blockType entry determines
 * how blocks reference it.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WorldMap } from 'hytopia';

// ============================================
// Types
// ============================================

export interface ArenaMapEntry {
  /** Filename in assets/maps/ (e.g. 'sumo-arena.json'). */
  file: string;
  /** Coordinate offset to apply when merging. */
  offset: { x: number; y: number; z: number };
}

// ============================================
// MapLoader
// ============================================

/**
 * Loads and merges multiple arena maps into a single WorldMap.
 *
 * @param assetsDir - Absolute path to the assets directory.
 * @param entries - Arena map entries with file names and offsets.
 * @returns A combined WorldMap ready for world.loadMap().
 */
export function mergeArenaMaps(assetsDir: string, entries: ArenaMapEntry[]): WorldMap {
  if (entries.length === 0) {
    throw new Error('[MapLoader] No arena map entries provided.');
  }

  // Combined block types, keyed by name for deduplication.
  const combinedBlockTypes: any[] = [];
  const combinedBlocks: Record<string, number | { i: number; r?: number }> = {};

  // Map from blockType name -> new id in the combined map.
  const nameToNewId: Map<string, number> = new Map();

  // Next available id for new block types (Hytopia uses 1-based ids).
  let nextId = 1;

  for (const entry of entries) {
    const filePath = join(assetsDir, 'maps', entry.file);
    console.log(`[MapLoader] Loading ${entry.file} (offset: ${entry.offset.x},${entry.offset.y},${entry.offset.z})...`);

    const raw = readFileSync(filePath, 'utf-8');
    const map = JSON.parse(raw) as WorldMap;

    const mapBlockTypes = (map as any).blockTypes ?? [];
    const mapBlocks = (map as any).blocks ?? {};

    // Build remap: old blockType id -> new blockType id.
    const idRemap: Map<number, number> = new Map();

    for (const bt of mapBlockTypes) {
      const oldId: number = bt.id;
      const name: string = bt.name ?? JSON.stringify(bt);

      if (nameToNewId.has(name)) {
        // Already registered under a different (or same) id.
        idRemap.set(oldId, nameToNewId.get(name)!);
      } else {
        // New block type - assign next available id.
        const newId = nextId++;
        const newBt = { ...bt, id: newId };
        combinedBlockTypes.push(newBt);
        nameToNewId.set(name, newId);
        idRemap.set(oldId, newId);
      }
    }

    // Copy blocks with offset and remapped ids.
    const ox = entry.offset.x;
    const oy = entry.offset.y;
    const oz = entry.offset.z;
    let skippedCount = 0;

    for (const [coordStr, blockData] of Object.entries(mapBlocks)) {
      // Get the original block type id.
      const origId = typeof blockData === 'number' ? blockData : (blockData as any).i;

      // Remap to new id.
      const newId = idRemap.get(origId);
      if (newId === undefined) {
        skippedCount++;
        continue;
      }

      const commaIdx1 = coordStr.indexOf(',');
      const commaIdx2 = coordStr.indexOf(',', commaIdx1 + 1);
      const bx = parseInt(coordStr.substring(0, commaIdx1), 10) + ox;
      const by = parseInt(coordStr.substring(commaIdx1 + 1, commaIdx2), 10) + oy;
      const bz = parseInt(coordStr.substring(commaIdx2 + 1), 10) + oz;
      const newKey = `${bx},${by},${bz}`;

      if (typeof blockData === 'number') {
        combinedBlocks[newKey] = newId;
      } else {
        const entry2 = blockData as { i: number; r?: number };
        const remapped: { i: number; r?: number } = { i: newId };
        if (entry2.r !== undefined) {
          remapped.r = entry2.r;
        }
        combinedBlocks[newKey] = remapped;
      }
    }

    if (skippedCount > 0) {
      console.log(`[MapLoader] Skipped ${skippedCount} blocks with unmapped type ids in ${entry.file}.`);
    }

    console.log(`[MapLoader] Merged ${Object.keys(mapBlocks).length - skippedCount} blocks from ${entry.file}.`);
  }

  console.log(
    `[MapLoader] Combined map: ${Object.keys(combinedBlocks).length} blocks, ` +
    `${combinedBlockTypes.length} block types (ids 1-${nextId - 1}).`
  );

  return {
    blockTypes: combinedBlockTypes,
    blocks: combinedBlocks,
  } as WorldMap;
}

/**
 * Generates a small platform of blocks to serve as the lobby spawn area.
 * Adds blocks directly to an existing WorldMap's blocks dictionary.
 *
 * @param map - The WorldMap to add lobby blocks to.
 * @param center - The center position of the platform.
 * @param size - Half-size of the platform (full size = 2*size+1).
 * @param blockTypeId - The block type id (1-based) to use for the platform.
 */
export function addLobbyPlatform(
  map: WorldMap,
  center: { x: number; y: number; z: number },
  size: number,
  blockTypeId: number,
): void {
  const blocks = (map as any).blocks as Record<string, number>;

  for (let x = center.x - size; x <= center.x + size; x++) {
    for (let z = center.z - size; z <= center.z + size; z++) {
      blocks[`${x},${center.y},${z}`] = blockTypeId;
    }
  }

  // Add walls around the edge (2 blocks high) to prevent falling off.
  for (let x = center.x - size; x <= center.x + size; x++) {
    for (let dy = 1; dy <= 2; dy++) {
      blocks[`${x},${center.y + dy},${center.z - size}`] = blockTypeId;
      blocks[`${x},${center.y + dy},${center.z + size}`] = blockTypeId;
    }
  }
  for (let z = center.z - size; z <= center.z + size; z++) {
    for (let dy = 1; dy <= 2; dy++) {
      blocks[`${center.x - size},${center.y + dy},${z}`] = blockTypeId;
      blocks[`${center.x + size},${center.y + dy},${z}`] = blockTypeId;
    }
  }
}
