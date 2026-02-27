#!/usr/bin/env node
/**
 * fill-water.cjs - Fills empty positions at/below a water level with water blocks.
 *
 * Reads a Hytopia WorldMap JSON and adds water blocks at specified Y levels
 * for any position that doesn't already have a block.
 *
 * Usage:
 *   node scripts/fill-water.cjs <input.json> <output.json> --waterY N --depth N --waterBlockId N
 *     [--minX N --maxX N --minZ N --maxZ N]
 *
 * --waterY: The Y level of the water surface (default: auto-detect from map)
 * --depth: How many layers deep to fill (default: 3)
 * --waterBlockId: The block type id for water (default: auto-detect "Water" type)
 * --minX/maxX/minZ/maxZ: Override bounds (default: use map bounds)
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);

function getArg(name) {
  const idx = args.indexOf(name);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function getArgNum(name) {
  const v = getArg(name);
  if (v === undefined) return undefined;
  return Number(v);
}

const inputFile = args[0];
const outputFile = args[1] || inputFile; // in-place by default

if (!inputFile || inputFile.startsWith('--')) {
  console.error('Usage: node fill-water.cjs <input.json> [output.json] --waterY N --depth N');
  process.exit(1);
}

console.log(`Input:  ${inputFile}`);
console.log(`Output: ${outputFile}`);

// Read the map
console.log('Loading map...');
const raw = fs.readFileSync(path.resolve(inputFile), 'utf-8');
const map = JSON.parse(raw);
const blocks = map.blocks;
const blockTypes = map.blockTypes;

// Find water block type id
let waterBlockId = getArgNum('--waterBlockId');
if (waterBlockId === undefined) {
  const waterType = blockTypes.find(bt => bt.name && bt.name.toLowerCase() === 'water');
  if (waterType) {
    waterBlockId = waterType.id;
    console.log(`Found water block type: id=${waterBlockId} (${waterType.name})`);
  } else {
    console.error('No water block type found. Use --waterBlockId to specify.');
    process.exit(1);
  }
}

// Compute map bounds
let mapMinX = Infinity, mapMaxX = -Infinity;
let mapMinZ = Infinity, mapMaxZ = -Infinity;

for (const coordStr of Object.keys(blocks)) {
  const c1 = coordStr.indexOf(',');
  const c2 = coordStr.indexOf(',', c1 + 1);
  const x = parseInt(coordStr.substring(0, c1), 10);
  const z = parseInt(coordStr.substring(c2 + 1), 10);
  if (x < mapMinX) mapMinX = x;
  if (x > mapMaxX) mapMaxX = x;
  if (z < mapMinZ) mapMinZ = z;
  if (z > mapMaxZ) mapMaxZ = z;
}

const fillMinX = getArgNum('--minX') ?? mapMinX;
const fillMaxX = getArgNum('--maxX') ?? mapMaxX;
const fillMinZ = getArgNum('--minZ') ?? mapMinZ;
const fillMaxZ = getArgNum('--maxZ') ?? mapMaxZ;

const waterY = getArgNum('--waterY') ?? 15;
const depth = getArgNum('--depth') ?? 3;

console.log(`Map bounds: X[${mapMinX}..${mapMaxX}] Z[${mapMinZ}..${mapMaxZ}]`);
console.log(`Fill bounds: X[${fillMinX}..${fillMaxX}] Z[${fillMinZ}..${fillMaxZ}]`);
console.log(`Water surface: Y=${waterY}, depth: ${depth} (filling Y=${waterY - depth + 1}..${waterY})`);

// Build a set of existing block positions for quick lookup
console.log('Building position index...');
const existingPositions = new Set(Object.keys(blocks));

// Fill water
console.log('Filling water...');
let addedCount = 0;
const yStart = waterY - depth + 1;
const yEnd = waterY;

const totalXZ = (fillMaxX - fillMinX + 1) * (fillMaxZ - fillMinZ + 1);
let progressCount = 0;

for (let x = fillMinX; x <= fillMaxX; x++) {
  for (let z = fillMinZ; z <= fillMaxZ; z++) {
    progressCount++;
    if (progressCount % 100000 === 0) {
      process.stdout.write(`  Progress: ${((progressCount / totalXZ) * 100).toFixed(0)}% (${addedCount} water blocks added)...\r`);
    }

    for (let y = yStart; y <= yEnd; y++) {
      const key = `${x},${y},${z}`;
      if (!existingPositions.has(key)) {
        blocks[key] = waterBlockId;
        existingPositions.add(key);
        addedCount++;
      }
    }
  }
}

console.log(`\nAdded ${addedCount} water blocks.`);
console.log(`Total blocks now: ${Object.keys(blocks).length}`);

// Write output
console.log('Writing output...');
const outputJson = JSON.stringify(map);
fs.writeFileSync(path.resolve(outputFile), outputJson, 'utf-8');
console.log(`Done! Output size: ${(outputJson.length / 1024 / 1024).toFixed(2)} MB`);
