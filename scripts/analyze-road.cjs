/**
 * analyze-road.cjs
 * Analyzes the Hytopia WorldMap file road.json using streaming to avoid OOM.
 *
 * The file format is:
 * { "blockTypes": [...], "blocks": { "x,y,z": blockTypeId, ... } }
 *
 * Strategy: Read the file as a string, extract blockTypes with a targeted parse,
 * then stream through the blocks section using regex matching to avoid holding
 * the entire parsed object in memory.
 *
 * Run with: node --max-old-space-size=4096 analyze-road.cjs
 */

const fs = require('fs');
const path = require('path');

const MAP_PATH = path.join(__dirname, '..', 'athlete-domains-hytopia', 'assets', 'maps', 'road.json');

// ── Known Arena Bounding Boxes ──────────────────────────────────────────────
const ARENAS = [
  {
    name: 'Treasure Guard',
    center: { x: -132, y: 65, z: -110 },
    box: { xMin: -220, xMax: -90, yMin: 50, yMax: 85, zMin: -170, zMax: -90 },
  },
  {
    name: 'Archery',
    center: { x: -49, y: 67, z: 91 },
    box: { xMin: -110, xMax: 10, yMin: 55, yMax: 85, zMin: 30, zMax: 150 },
  },
  {
    name: 'Jetski Race (start area)',
    center: { x: -150, y: 63, z: -70 },
    box: { xMin: -200, xMax: -100, yMin: 50, yMax: 80, zMin: -120, zMax: -20 },
  },
  {
    name: 'Parkour Race',
    center: { x: 5, y: 140, z: -89 },
    box: { xMin: -108, xMax: 119, yMin: 100, yMax: 180, zMin: -232, zMax: 54 },
  },
];

const REGION_SIZE = 50;

console.log('='.repeat(80));
console.log('  ROAD.JSON SPATIAL ANALYSIS (streaming mode)');
console.log('='.repeat(80));
console.log();

const t0 = Date.now();

// ── Phase 1: Read the raw file as a Buffer to find structure ────────────────
console.log(`Reading ${MAP_PATH} ...`);
const buf = fs.readFileSync(MAP_PATH);
const fileSizeMB = (buf.length / 1e6).toFixed(1);
console.log(`  Read complete in ${((Date.now() - t0) / 1000).toFixed(1)}s  (${fileSizeMB} MB)`);

// ── Phase 2: Extract blockTypes (small array near the beginning) ────────────
console.log('Extracting blockTypes ...');
const raw = buf.toString('utf-8');
// Free the buffer
// buf is no longer needed but raw holds the string

// Find the blockTypes array - it's typically at the start
const btStart = raw.indexOf('"blockTypes"');
if (btStart === -1) {
  console.error('ERROR: Could not find "blockTypes" in file');
  process.exit(1);
}

// Find the opening bracket of the array
const arrStart = raw.indexOf('[', btStart);
// Now we need to find the matching closing bracket
let depth = 0;
let arrEnd = -1;
for (let i = arrStart; i < raw.length; i++) {
  if (raw[i] === '[') depth++;
  else if (raw[i] === ']') {
    depth--;
    if (depth === 0) { arrEnd = i; break; }
  }
}

const blockTypesJson = raw.substring(arrStart, arrEnd + 1);
const blockTypes = JSON.parse(blockTypesJson);

console.log(`  Found ${blockTypes.length} block types`);

// Build type name lookup
const typeNames = {};
for (const bt of blockTypes) {
  typeNames[bt.id] = bt.name || bt.textureUri || `id_${bt.id}`;
}

// ── Phase 3: Stream through blocks using regex on the raw string ────────────
console.log('Scanning blocks (streaming regex) ...');
const t2 = Date.now();

// Find the blocks object
const blocksKeyIdx = raw.indexOf('"blocks"');
if (blocksKeyIdx === -1) {
  console.error('ERROR: Could not find "blocks" in file');
  process.exit(1);
}
const blocksObjStart = raw.indexOf('{', blocksKeyIdx + 8);

// Stats accumulators
let totalBlocks = 0;
let minX = Infinity, maxX = -Infinity;
let minY = Infinity, maxY = -Infinity;
let minZ = Infinity, maxZ = -Infinity;
const typeCounts = {};
const regionMap = {};
const yLayerCounts = {};
const arenaBlocks = ARENAS.map(() => ({ count: 0, typeBreakdown: {} }));

// Regex to match each entry: "x,y,z":blockTypeId
// The keys look like "-132,65,-110" and values are integers
const entryRegex = /"(-?\d+),(-?\d+),(-?\d+)"\s*:\s*(\d+)/g;
entryRegex.lastIndex = blocksObjStart;

let match;
let progressNext = 1000000;

while ((match = entryRegex.exec(raw)) !== null) {
  const x = parseInt(match[1], 10);
  const y = parseInt(match[2], 10);
  const z = parseInt(match[3], 10);
  const typeId = parseInt(match[4], 10);

  totalBlocks++;

  // Bounding box
  if (x < minX) minX = x;
  if (x > maxX) maxX = x;
  if (y < minY) minY = y;
  if (y > maxY) maxY = y;
  if (z < minZ) minZ = z;
  if (z > maxZ) maxZ = z;

  // Per-type count
  typeCounts[typeId] = (typeCounts[typeId] || 0) + 1;

  // XZ region heatmap
  const rx = Math.floor(x / REGION_SIZE);
  const rz = Math.floor(z / REGION_SIZE);
  const rKey = `${rx},${rz}`;
  regionMap[rKey] = (regionMap[rKey] || 0) + 1;

  // Y-layer
  yLayerCounts[y] = (yLayerCounts[y] || 0) + 1;

  // Arena membership
  for (let i = 0; i < ARENAS.length; i++) {
    const b = ARENAS[i].box;
    if (x >= b.xMin && x <= b.xMax && y >= b.yMin && y <= b.yMax && z >= b.zMin && z <= b.zMax) {
      arenaBlocks[i].count++;
      arenaBlocks[i].typeBreakdown[typeId] = (arenaBlocks[i].typeBreakdown[typeId] || 0) + 1;
    }
  }

  if (totalBlocks >= progressNext) {
    process.stdout.write(`  ... ${(totalBlocks / 1e6).toFixed(1)}M blocks scanned\r`);
    progressNext += 1000000;
  }
}

console.log(`  Scan complete: ${totalBlocks.toLocaleString()} blocks in ${((Date.now() - t2) / 1000).toFixed(1)}s`);
console.log();

// ── 1. Basic Stats ──────────────────────────────────────────────────────────
console.log('== 1. BASIC STATS =============================================');
console.log(`  Total block types defined : ${blockTypes.length}`);
console.log(`  Total blocks placed       : ${totalBlocks.toLocaleString()}`);
console.log();

// ── 2. Bounding Box ─────────────────────────────────────────────────────────
console.log('== 2. BOUNDING BOX ============================================');
console.log(`  X : ${minX} .. ${maxX}  (span ${maxX - minX + 1})`);
console.log(`  Y : ${minY} .. ${maxY}  (span ${maxY - minY + 1})`);
console.log(`  Z : ${minZ} .. ${maxZ}  (span ${maxZ - minZ + 1})`);
const volume = (maxX - minX + 1) * (maxY - minY + 1) * (maxZ - minZ + 1);
console.log(`  Volume (bounding) : ${volume.toLocaleString()} possible positions`);
console.log(`  Fill ratio        : ${((totalBlocks / volume) * 100).toFixed(4)}%`);
console.log();

// ── 3. Block Type Usage ─────────────────────────────────────────────────────
console.log('== 3. BLOCK TYPE USAGE (sorted by count) ======================');
const sortedTypes = Object.entries(typeCounts)
  .map(([id, count]) => ({ id: parseInt(id, 10), count }))
  .sort((a, b) => b.count - a.count);

console.log(`  ${'ID'.padStart(4)}  ${'Count'.padStart(12)}  ${'%'.padStart(7)}  Name`);
console.log(`  ${'─'.repeat(4)}  ${'─'.repeat(12)}  ${'─'.repeat(7)}  ${'─'.repeat(40)}`);
for (const entry of sortedTypes) {
  const pct = ((entry.count / totalBlocks) * 100).toFixed(2);
  const name = typeNames[entry.id] || `unknown_${entry.id}`;
  console.log(`  ${String(entry.id).padStart(4)}  ${entry.count.toLocaleString().padStart(12)}  ${(pct + '%').padStart(7)}  ${name}`);
}

// Check for defined-but-unused types
const usedIds = new Set(sortedTypes.map(e => e.id));
const unusedTypes = blockTypes.filter(bt => !usedIds.has(bt.id));
if (unusedTypes.length > 0) {
  console.log(`  (${unusedTypes.length} block types defined but unused: ${unusedTypes.map(bt => bt.name || bt.id).join(', ')})`);
}
console.log();

// ── 4. Spatial Density Heatmap ──────────────────────────────────────────────
console.log('== 4. SPATIAL DENSITY HEATMAP (50x50 XZ regions) =============');
const regionEntries = Object.entries(regionMap)
  .map(([key, count]) => {
    const [rx, rz] = key.split(',').map(Number);
    return {
      rx, rz,
      xFrom: rx * REGION_SIZE,
      xTo: (rx + 1) * REGION_SIZE - 1,
      zFrom: rz * REGION_SIZE,
      zTo: (rz + 1) * REGION_SIZE - 1,
      count,
    };
  })
  .sort((a, b) => b.count - a.count);

console.log(`  Total regions with blocks: ${regionEntries.length}`);
console.log();
console.log('  Top 30 densest regions:');
const hdr = `  ${'#'.padStart(3)}  ${'X range'.padEnd(18)}  ${'Z range'.padEnd(18)}  ${'Blocks'.padStart(10)}  Bar`;
console.log(hdr);
console.log(`  ${'─'.repeat(3)}  ${'─'.repeat(18)}  ${'─'.repeat(18)}  ${'─'.repeat(10)}  ${'─'.repeat(30)}`);

const maxRegionCount = regionEntries.length > 0 ? regionEntries[0].count : 1;
for (let i = 0; i < Math.min(30, regionEntries.length); i++) {
  const r = regionEntries[i];
  const xRange = `${r.xFrom}..${r.xTo}`;
  const zRange = `${r.zFrom}..${r.zTo}`;
  const barLen = Math.round((r.count / maxRegionCount) * 30);
  const bar = '#'.repeat(barLen);
  console.log(`  ${String(i + 1).padStart(3)}  ${xRange.padEnd(18)}  ${zRange.padEnd(18)}  ${r.count.toLocaleString().padStart(10)}  ${bar}`);
}
console.log();

// ── 5. Arena Analysis ───────────────────────────────────────────────────────
console.log('== 5. ARENA / GAME-MODE ANALYSIS ==============================');
for (let i = 0; i < ARENAS.length; i++) {
  const arena = ARENAS[i];
  const data = arenaBlocks[i];
  const b = arena.box;
  const arenaVol = (b.xMax - b.xMin + 1) * (b.yMax - b.yMin + 1) * (b.zMax - b.zMin + 1);
  const fillPct = data.count > 0 ? ((data.count / arenaVol) * 100).toFixed(2) : '0.00';

  console.log(`  +-- ${arena.name} ${'─'.repeat(Math.max(1, 52 - arena.name.length))}+`);
  console.log(`  |  Center  : (${arena.center.x}, ${arena.center.y}, ${arena.center.z})`);
  console.log(`  |  Box     : X[${b.xMin}..${b.xMax}] Y[${b.yMin}..${b.yMax}] Z[${b.zMin}..${b.zMax}]`);
  console.log(`  |  Volume  : ${arenaVol.toLocaleString()} possible positions`);
  console.log(`  |  Blocks  : ${data.count.toLocaleString()}  (${fillPct}% fill)`);

  // Top 5 block types in this arena
  const arenaTypes = Object.entries(data.typeBreakdown)
    .map(([tid, cnt]) => ({ tid: parseInt(tid, 10), cnt }))
    .sort((a, b) => b.cnt - a.cnt)
    .slice(0, 5);

  if (arenaTypes.length > 0) {
    console.log(`  |  Top block types:`);
    for (const at of arenaTypes) {
      const tName = typeNames[at.tid] || `unknown_${at.tid}`;
      const pct = ((at.cnt / data.count) * 100).toFixed(1);
      console.log(`  |    ${tName.padEnd(35)} ${at.cnt.toLocaleString().padStart(8)}  (${pct}%)`);
    }
  } else {
    console.log(`  |  (no blocks found in this bounding box)`);
  }
  console.log(`  +${'─'.repeat(57)}+`);
  console.log();
}

// ── 6. Y-Layer Distribution ─────────────────────────────────────────────────
console.log('== 6. Y-LAYER DISTRIBUTION (top 20 layers) ====================');
const yLayers = Object.entries(yLayerCounts)
  .map(([y, count]) => ({ y: parseInt(y, 10), count }))
  .sort((a, b) => b.count - a.count);

const yMaxCount = yLayers.length > 0 ? yLayers[0].count : 1;
console.log(`  ${'Y'.padStart(5)}  ${'Blocks'.padStart(12)}  Bar`);
console.log(`  ${'─'.repeat(5)}  ${'─'.repeat(12)}  ${'─'.repeat(40)}`);
for (let i = 0; i < Math.min(20, yLayers.length); i++) {
  const l = yLayers[i];
  const barLen = Math.round((l.count / yMaxCount) * 40);
  console.log(`  ${String(l.y).padStart(5)}  ${l.count.toLocaleString().padStart(12)}  ${'#'.repeat(barLen)}`);
}
console.log(`  (${yLayers.length} total Y layers with blocks)`);
console.log();

// ── Done ────────────────────────────────────────────────────────────────────
const totalTime = ((Date.now() - t0) / 1000).toFixed(1);
console.log('='.repeat(80));
console.log(`  Analysis complete in ${totalTime}s`);
console.log('='.repeat(80));
