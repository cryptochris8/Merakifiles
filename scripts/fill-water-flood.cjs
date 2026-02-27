#!/usr/bin/env node
/**
 * fill-water-flood.cjs - Simple ocean fill.
 *
 * Strategy: any (x,z) column with ZERO solid blocks = ocean.
 * Flood fills from map edges through ocean-only columns, then
 * places water blocks at specified Y levels.
 *
 * Usage:
 *   node scripts/fill-water-flood.cjs <input.json> <output.json>
 *     [--waterY N] [--depth N] [--waterBlockId N]
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
const outputFile = args[1] || inputFile;

if (!inputFile || inputFile.startsWith('--')) {
  console.error('Usage: node fill-water-flood.cjs <input.json> [output.json] [options]');
  process.exit(1);
}

console.log(`Input:  ${inputFile}`);
console.log(`Output: ${outputFile}`);

console.log('Loading map...');
const raw = fs.readFileSync(path.resolve(inputFile), 'utf-8');
const map = JSON.parse(raw);
const blocks = map.blocks;
const blockTypes = map.blockTypes;

// Find water block type
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

// Step 1: Compute bounds before removing water
console.log('Computing bounds...');
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

const xRange = mapMaxX - mapMinX + 1;
const zRange = mapMaxZ - mapMinZ + 1;
console.log(`Map bounds: X[${mapMinX}..${mapMaxX}] Z[${mapMinZ}..${mapMaxZ}] (${xRange} x ${zRange})`);

// Step 2: Remove ALL water blocks
console.log('Removing all water blocks...');
let removedCount = 0;
for (const key of Object.keys(blocks)) {
  const val = blocks[key];
  const blockId = typeof val === 'number' ? val : val.i;
  if (blockId === waterBlockId) {
    delete blocks[key];
    removedCount++;
  }
}
console.log(`Removed ${removedCount} water blocks.`);
console.log(`Solid blocks remaining: ${Object.keys(blocks).length}`);

// Step 3: Find which (x,z) columns have ANY solid block
console.log('Detecting land columns...');
const hasBlock = new Uint8Array(xRange * zRange); // 0 = empty (ocean), 1 = has block (land)

for (const coordStr of Object.keys(blocks)) {
  const c1 = coordStr.indexOf(',');
  const c2 = coordStr.indexOf(',', c1 + 1);
  const x = parseInt(coordStr.substring(0, c1), 10);
  const z = parseInt(coordStr.substring(c2 + 1), 10);
  const idx = (x - mapMinX) * zRange + (z - mapMinZ);
  hasBlock[idx] = 1;
}

let landColumns = 0, oceanColumns = 0;
for (let i = 0; i < hasBlock.length; i++) {
  if (hasBlock[i]) landColumns++;
  else oceanColumns++;
}
console.log(`Land columns (has blocks): ${landColumns}`);
console.log(`Ocean columns (completely empty): ${oceanColumns}`);

// Step 4: BFS flood fill from map edges through empty columns only
console.log('Flood-filling from edges through empty columns...');
const visited = new Uint8Array(xRange * zRange);
const queue = [];

function tryEnqueue(xOff, zOff) {
  if (xOff < 0 || xOff >= xRange || zOff < 0 || zOff >= zRange) return;
  const idx = xOff * zRange + zOff;
  if (visited[idx]) return;
  if (hasBlock[idx]) return; // land - blocked
  visited[idx] = 1;
  queue.push(xOff, zOff);
}

// Seed edges
for (let xo = 0; xo < xRange; xo++) {
  tryEnqueue(xo, 0);
  tryEnqueue(xo, zRange - 1);
}
for (let zo = 1; zo < zRange - 1; zo++) {
  tryEnqueue(0, zo);
  tryEnqueue(xRange - 1, zo);
}

// BFS
let head = 0;
while (head < queue.length) {
  const xo = queue[head++];
  const zo = queue[head++];
  tryEnqueue(xo - 1, zo);
  tryEnqueue(xo + 1, zo);
  tryEnqueue(xo, zo - 1);
  tryEnqueue(xo, zo + 1);
}

const reachedColumns = queue.length / 2;
console.log(`Flood fill reached ${reachedColumns} ocean columns (skipped ${oceanColumns - reachedColumns} interior empty columns).`);

// Step 5: Place water
const waterY = getArgNum('--waterY') ?? 7;
const depthVal = getArgNum('--depth') ?? 3;
const yStart = waterY - depthVal + 1;
const yEnd = waterY;

console.log(`Placing water at Y=${yStart}..${yEnd} (surface=${waterY}, depth=${depthVal})...`);

let addedTotal = 0;
for (let i = 0; i < queue.length; i += 2) {
  const x = queue[i] + mapMinX;
  const z = queue[i + 1] + mapMinZ;
  for (let y = yStart; y <= yEnd; y++) {
    const key = `${x},${y},${z}`;
    blocks[key] = waterBlockId;
    addedTotal++;
  }
}

console.log(`Added ${addedTotal} water blocks.`);
console.log(`Total blocks now: ${Object.keys(blocks).length}`);

// Write output
console.log('Writing output...');
const outputJson = JSON.stringify(map);
fs.writeFileSync(path.resolve(outputFile), outputJson, 'utf-8');
console.log(`Done! Output size: ${(outputJson.length / 1024 / 1024).toFixed(2)} MB`);
