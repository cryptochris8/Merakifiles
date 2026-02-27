#!/usr/bin/env node
/**
 * extract-arena.cjs - Streaming arena extractor for Hytopia WorldMap JSON.
 *
 * Streams through a large WorldMap JSON file, extracting only blocks within
 * a specified bounding box. Uses streaming JSON to avoid loading the entire
 * 130MB+ file into memory as a parsed object.
 *
 * Usage:
 *   node --max-old-space-size=2048 scripts/extract-arena.cjs <input> <output> \
 *     --minX N --maxX N --minY N --maxY N --minZ N --maxZ N \
 *     [--centerX N --centerY N --centerZ N]
 */

const fs = require('fs');
const path = require('path');
const { parser } = require('stream-json');
const { streamValues } = require('stream-json/streamers/StreamValues');

// ---- Parse arguments ----
const args = process.argv.slice(2);

function getArg(name) {
  const idx = args.indexOf(name);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function getArgNum(name) {
  const v = getArg(name);
  if (v === undefined) return undefined;
  const n = Number(v);
  if (Number.isNaN(n)) {
    console.error(`Invalid number for ${name}: ${v}`);
    process.exit(1);
  }
  return n;
}

const inputFile = args[0];
const outputFile = args[1];

if (!inputFile || !outputFile || inputFile.startsWith('--') || outputFile.startsWith('--')) {
  console.error('Usage: node extract-arena.cjs <input.json> <output.json> --minX N --maxX N --minY N --maxY N --minZ N --maxZ N [--centerX N --centerY N --centerZ N]');
  process.exit(1);
}

const bbMinX = getArgNum('--minX');
const bbMaxX = getArgNum('--maxX');
const bbMinY = getArgNum('--minY');
const bbMaxY = getArgNum('--maxY');
const bbMinZ = getArgNum('--minZ');
const bbMaxZ = getArgNum('--maxZ');

if (bbMinX === undefined || bbMaxX === undefined || bbMinY === undefined || bbMaxY === undefined || bbMinZ === undefined || bbMaxZ === undefined) {
  console.error('All bounding box arguments are required: --minX --maxX --minY --maxY --minZ --maxZ');
  process.exit(1);
}

const centerX = getArgNum('--centerX') ?? Math.round((bbMinX + bbMaxX) / 2);
const centerY = getArgNum('--centerY') ?? bbMinY;
const centerZ = getArgNum('--centerZ') ?? Math.round((bbMinZ + bbMaxZ) / 2);

console.log(`Input:  ${inputFile}`);
console.log(`Output: ${outputFile}`);
console.log(`Bounding box: X[${bbMinX}..${bbMaxX}] Y[${bbMinY}..${bbMaxY}] Z[${bbMinZ}..${bbMaxZ}]`);
console.log(`Center offset: (${centerX}, ${centerY}, ${centerZ}) -> (0, 0, 0)`);

/**
 * Two-pass approach:
 * Pass 1: Read just the blockTypes array (small - just scan the first part of JSON).
 * Pass 2: Stream through blocks, extracting those within the bounding box.
 *
 * Actually, we can do it in a single pass with a custom approach:
 * Read the file as text line-by-line / chunk-by-chunk and manually parse the
 * blocks section. But this is fragile.
 *
 * Better: Use a two-phase read. Phase 1 reads blockTypes via a small buffer.
 * Phase 2 uses regex-based chunk scanning of the blocks object.
 */

async function main() {
  const inputPath = path.resolve(inputFile);
  const fileSize = fs.statSync(inputPath).size;
  console.log(`File size: ${(fileSize / 1024 / 1024).toFixed(1)} MB`);

  // Phase 1: Extract blockTypes by reading just the beginning of the file.
  // The blockTypes array appears before the blocks object in these files.
  console.log('Phase 1: Reading blockTypes...');

  // Read the first 1MB which should contain all blockTypes.
  const headerBuf = Buffer.alloc(Math.min(1024 * 1024, fileSize));
  const fd = fs.openSync(inputPath, 'r');
  fs.readSync(fd, headerBuf, 0, headerBuf.length, 0);

  const headerStr = headerBuf.toString('utf-8');

  // Find the blockTypes array.
  const btStart = headerStr.indexOf('"blockTypes"');
  if (btStart === -1) {
    console.error('Could not find blockTypes in input file.');
    process.exit(1);
  }

  // Find the opening bracket.
  const arrStart = headerStr.indexOf('[', btStart);
  if (arrStart === -1) {
    console.error('Could not find blockTypes array start.');
    process.exit(1);
  }

  // Find matching closing bracket by counting bracket depth.
  let depth = 0;
  let arrEnd = -1;
  for (let i = arrStart; i < headerStr.length; i++) {
    if (headerStr[i] === '[') depth++;
    else if (headerStr[i] === ']') {
      depth--;
      if (depth === 0) {
        arrEnd = i;
        break;
      }
    }
  }

  if (arrEnd === -1) {
    // Need to read more of the file for blockTypes.
    console.error('blockTypes array extends beyond 1MB header read. This is unexpected.');
    process.exit(1);
  }

  const blockTypesJson = headerStr.substring(arrStart, arrEnd + 1);
  const blockTypes = JSON.parse(blockTypesJson);
  console.log(`Found ${blockTypes.length} block types.`);

  // Build lookup from old id -> blockType object.
  const oldIdToType = new Map();
  for (const bt of blockTypes) {
    oldIdToType.set(bt.id, bt);
  }

  // Phase 2: Stream through the blocks section.
  // We'll read the file in chunks and use regex to extract block entries.
  console.log('Phase 2: Streaming blocks extraction...');

  // Find where the "blocks" object starts.
  const blocksKeyPos = headerStr.indexOf('"blocks"');
  let blocksObjStart = -1;
  if (blocksKeyPos !== -1) {
    blocksObjStart = headerStr.indexOf('{', blocksKeyPos + 8);
  }

  // If blocks key wasn't in the first 1MB, we need to scan further.
  let fileOffset = 0;
  if (blocksObjStart === -1) {
    // Scan for it
    const SCAN_CHUNK = 4 * 1024 * 1024;
    let scanBuf = Buffer.alloc(SCAN_CHUNK);
    let scanOffset = 0;
    while (scanOffset < fileSize) {
      const bytesRead = fs.readSync(fd, scanBuf, 0, SCAN_CHUNK, scanOffset);
      const scanStr = scanBuf.toString('utf-8', 0, bytesRead);
      const idx = scanStr.indexOf('"blocks"');
      if (idx !== -1) {
        blocksObjStart = scanOffset + scanStr.indexOf('{', idx + 8);
        break;
      }
      scanOffset += bytesRead - 20; // overlap to catch split keys
    }
    if (blocksObjStart === -1) {
      console.error('Could not find blocks object in input file.');
      process.exit(1);
    }
  }

  console.log(`Blocks object starts at byte offset ~${blocksObjStart}`);

  // Now stream through the blocks object extracting key-value pairs.
  // The blocks object looks like: { "x,y,z": N, "x,y,z": {"i":N,"r":N}, ... }
  // We'll read chunks and use a simple state machine to extract entries.

  const extractedBlocks = {};
  const usedOldIds = new Set();
  let extractedCount = 0;
  let totalParsed = 0;

  const CHUNK_SIZE = 16 * 1024 * 1024; // 16MB chunks
  const readBuf = Buffer.alloc(CHUNK_SIZE);
  let readPos = blocksObjStart + 1; // skip the opening {
  let leftover = ''; // incomplete data from previous chunk
  let braceDepth = 1; // we're inside the outer blocks { }
  let done = false;

  while (!done && readPos < fileSize) {
    const bytesRead = fs.readSync(fd, readBuf, 0, CHUNK_SIZE, readPos);
    if (bytesRead === 0) break;

    const chunk = leftover + readBuf.toString('utf-8', 0, bytesRead);
    leftover = '';
    readPos += bytesRead;

    let i = 0;
    while (i < chunk.length && !done) {
      // Skip whitespace and commas.
      while (i < chunk.length && (chunk[i] === ' ' || chunk[i] === '\n' || chunk[i] === '\r' || chunk[i] === '\t' || chunk[i] === ',')) {
        i++;
      }

      if (i >= chunk.length) break;

      // Check for end of blocks object.
      if (chunk[i] === '}') {
        braceDepth--;
        if (braceDepth === 0) {
          done = true;
          break;
        }
        i++;
        continue;
      }

      // Expect a key: "x,y,z"
      if (chunk[i] !== '"') {
        i++;
        continue;
      }

      // Find the end of the key string.
      const keyStart = i + 1;
      const keyEnd = chunk.indexOf('"', keyStart);
      if (keyEnd === -1) {
        // Key split across chunks - keep as leftover.
        leftover = chunk.substring(i);
        break;
      }

      const key = chunk.substring(keyStart, keyEnd);
      i = keyEnd + 1;

      // Skip the colon.
      while (i < chunk.length && (chunk[i] === ' ' || chunk[i] === ':')) {
        i++;
      }

      if (i >= chunk.length) {
        leftover = '"' + key + '":';
        break;
      }

      // Read the value - either a number or an object { ... }.
      let value;
      if (chunk[i] === '{') {
        // Object value - find closing brace.
        const objEnd = chunk.indexOf('}', i);
        if (objEnd === -1) {
          leftover = '"' + key + '":' + chunk.substring(i);
          break;
        }
        const objStr = chunk.substring(i, objEnd + 1);
        try {
          value = JSON.parse(objStr);
        } catch (e) {
          i = objEnd + 1;
          continue;
        }
        i = objEnd + 1;
      } else {
        // Number value - read until comma, }, whitespace.
        const numStart = i;
        while (i < chunk.length && chunk[i] !== ',' && chunk[i] !== '}' && chunk[i] !== ' ' && chunk[i] !== '\n' && chunk[i] !== '\r') {
          i++;
        }
        if (i >= chunk.length) {
          leftover = '"' + key + '":' + chunk.substring(numStart);
          break;
        }
        const numStr = chunk.substring(numStart, i);
        value = parseInt(numStr, 10);
        if (Number.isNaN(value)) continue;
        // Don't consume the } here - let the loop handle it.
      }

      totalParsed++;
      if (totalParsed % 1000000 === 0) {
        process.stdout.write(`  Parsed ${(totalParsed / 1000000).toFixed(0)}M blocks, extracted ${extractedCount}...\r`);
      }

      // Parse the coordinate key.
      const commaIdx1 = key.indexOf(',');
      const commaIdx2 = key.indexOf(',', commaIdx1 + 1);
      if (commaIdx1 === -1 || commaIdx2 === -1) continue;

      const bx = parseInt(key.substring(0, commaIdx1), 10);
      const by = parseInt(key.substring(commaIdx1 + 1, commaIdx2), 10);
      const bz = parseInt(key.substring(commaIdx2 + 1), 10);

      // Check bounding box.
      if (bx < bbMinX || bx > bbMaxX || by < bbMinY || by > bbMaxY || bz < bbMinZ || bz > bbMaxZ) {
        continue;
      }

      // Shift coordinates.
      const nx = bx - centerX;
      const ny = by - centerY;
      const nz = bz - centerZ;
      const newKey = `${nx},${ny},${nz}`;

      const origId = typeof value === 'number' ? value : value.i;
      usedOldIds.add(origId);

      extractedBlocks[newKey] = value;
      extractedCount++;
    }
  }

  fs.closeSync(fd);

  console.log(`\nParsed ${totalParsed} total blocks, extracted ${extractedCount}.`);
  console.log(`Used ${usedOldIds.size} unique block types.`);

  if (extractedCount === 0) {
    console.error('WARNING: No blocks found in the specified bounding box!');
    // Still write an empty map.
  }

  // Rebuild block types with sequential IDs.
  console.log('Rebuilding block types...');
  const oldToNewId = new Map();
  const newBlockTypes = [];
  let nextId = 1;

  const sortedOldIds = [...usedOldIds].sort((a, b) => a - b);
  for (const oldId of sortedOldIds) {
    const bt = oldIdToType.get(oldId);
    if (!bt) {
      console.warn(`  Warning: block type id ${oldId} not found in blockTypes array.`);
      continue;
    }
    const newId = nextId++;
    oldToNewId.set(oldId, newId);
    newBlockTypes.push({ ...bt, id: newId });
  }

  console.log(`Remapped ${newBlockTypes.length} block types (ids 1-${nextId - 1}).`);

  // Remap block IDs.
  console.log('Remapping block IDs...');
  const finalBlocks = {};

  for (const [coordStr, blockData] of Object.entries(extractedBlocks)) {
    const origId = typeof blockData === 'number' ? blockData : blockData.i;
    const newId = oldToNewId.get(origId);
    if (newId === undefined) continue;

    if (typeof blockData === 'number') {
      finalBlocks[coordStr] = newId;
    } else {
      const remapped = { i: newId };
      if (blockData.r !== undefined) {
        remapped.r = blockData.r;
      }
      finalBlocks[coordStr] = remapped;
    }
  }

  // Write output.
  const outputPath = path.resolve(outputFile);
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log('Writing output...');
  const outputMap = { blockTypes: newBlockTypes, blocks: finalBlocks };
  const outputJson = JSON.stringify(outputMap);
  fs.writeFileSync(outputPath, outputJson, 'utf-8');

  const outSize = (outputJson.length / 1024 / 1024).toFixed(2);
  console.log(`Done! Output: ${Object.keys(finalBlocks).length} blocks, ${newBlockTypes.length} block types, ${outSize} MB`);

  // Show bounding box of output.
  let oMinX = Infinity, oMaxX = -Infinity;
  let oMinY = Infinity, oMaxY = -Infinity;
  let oMinZ = Infinity, oMaxZ = -Infinity;
  for (const coordStr of Object.keys(finalBlocks)) {
    const c1 = coordStr.indexOf(',');
    const c2 = coordStr.indexOf(',', c1 + 1);
    const x = parseInt(coordStr.substring(0, c1), 10);
    const y = parseInt(coordStr.substring(c1 + 1, c2), 10);
    const z = parseInt(coordStr.substring(c2 + 1), 10);
    if (x < oMinX) oMinX = x;
    if (x > oMaxX) oMaxX = x;
    if (y < oMinY) oMinY = y;
    if (y > oMaxY) oMaxY = y;
    if (z < oMinZ) oMinZ = z;
    if (z > oMaxZ) oMaxZ = z;
  }
  console.log(`Output extents: X[${oMinX}..${oMaxX}] Y[${oMinY}..${oMaxY}] Z[${oMinZ}..${oMaxZ}]`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
