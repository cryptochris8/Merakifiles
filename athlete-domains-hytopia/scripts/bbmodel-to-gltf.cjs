#!/usr/bin/env node
/**
 * bbmodel-to-gltf.cjs
 *
 * Converts Blockbench .bbmodel files to glTF Binary (.glb) format
 * for use with the Hytopia SDK.
 *
 * Usage:
 *   node scripts/bbmodel-to-gltf.cjs --all
 *   node scripts/bbmodel-to-gltf.cjs <input.bbmodel> [output.glb]
 *
 * The .bbmodel format is JSON containing cube-based geometry with
 * embedded base64 PNG textures. This script builds glTF structures
 * manually (no three.js dependency) and outputs .glb binary files.
 *
 * Scale: 1/16 (Blockbench pixels -> Hytopia meters)
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCALE = 1 / 16; // Blockbench units (pixels) to meters

const MODELS_INPUT_DIR = path.resolve(__dirname, '..', '..', 'extracted', 'models', 'Models');
const MODELS_OUTPUT_DIR = path.resolve(__dirname, '..', 'assets', 'models');

// All known .bbmodel files to convert with --all
const ALL_MODELS = [
  'ice_cream_seller.bbmodel',
  'ice_cream_stand (1).bbmodel',
  'jersey_new (1).bbmodel',
  'rugby_ball (1).bbmodel',
];

// glTF constants
const GLTF_BYTE = 5120;
const GLTF_UNSIGNED_BYTE = 5121;
const GLTF_UNSIGNED_SHORT = 5123;
const GLTF_UNSIGNED_INT = 5125;
const GLTF_FLOAT = 5126;
const GLTF_ARRAY_BUFFER = 34962;
const GLTF_ELEMENT_ARRAY_BUFFER = 34963;

// Face definitions: name, normal, vertex indices for a unit cube [0,0,0]-[1,1,1]
// Vertices of unit cube:
//   0: [0,0,1]  1: [1,0,1]  2: [1,1,1]  3: [0,1,1]   (front/south, +Z)
//   4: [0,0,0]  5: [1,0,0]  6: [1,1,0]  7: [0,1,0]   (back/north, -Z)
const FACE_DEFINITIONS = {
  north: { // -Z face
    normal: [0, 0, -1],
    // Looking at -Z face from outside: vertices 5,4,7,6 (CW from outside = CCW for glTF)
    positions: [
      [1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]
    ],
    uvOrder: [0, 1, 3, 2], // maps to [bottom-left, bottom-right, top-right, top-left] of UV rect
  },
  east: { // +X face
    normal: [1, 0, 0],
    positions: [
      [1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]
    ],
    uvOrder: [0, 1, 3, 2],
  },
  south: { // +Z face
    normal: [0, 0, 1],
    positions: [
      [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]
    ],
    uvOrder: [0, 1, 3, 2],
  },
  west: { // -X face
    normal: [-1, 0, 0],
    positions: [
      [0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]
    ],
    uvOrder: [0, 1, 3, 2],
  },
  up: { // +Y face
    normal: [0, 1, 0],
    positions: [
      [0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]
    ],
    uvOrder: [0, 1, 3, 2],
  },
  down: { // -Y face
    normal: [0, -1, 0],
    positions: [
      [0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]
    ],
    uvOrder: [0, 1, 3, 2],
  },
};

const FACE_NAMES = ['north', 'east', 'south', 'west', 'up', 'down'];

// ---------------------------------------------------------------------------
// Utility: Convert degrees to radians
// ---------------------------------------------------------------------------
function degToRad(deg) {
  return deg * Math.PI / 180;
}

// ---------------------------------------------------------------------------
// Utility: Rotate a point around an origin by Euler angles (XYZ order)
// ---------------------------------------------------------------------------
function rotatePoint(point, origin, rotation) {
  let [x, y, z] = [point[0] - origin[0], point[1] - origin[1], point[2] - origin[2]];

  const rx = degToRad(rotation[0] || 0);
  const ry = degToRad(rotation[1] || 0);
  const rz = degToRad(rotation[2] || 0);

  // Rotate around X
  if (rx !== 0) {
    const cosX = Math.cos(rx), sinX = Math.sin(rx);
    const ny = y * cosX - z * sinX;
    const nz = y * sinX + z * cosX;
    y = ny; z = nz;
  }

  // Rotate around Y
  if (ry !== 0) {
    const cosY = Math.cos(ry), sinY = Math.sin(ry);
    const nx = x * cosY + z * sinY;
    const nz = -x * sinY + z * cosY;
    x = nx; z = nz;
  }

  // Rotate around Z
  if (rz !== 0) {
    const cosZ = Math.cos(rz), sinZ = Math.sin(rz);
    const nx = x * cosZ - y * sinZ;
    const ny = x * sinZ + y * cosZ;
    x = nx; y = ny;
  }

  return [x + origin[0], y + origin[1], z + origin[2]];
}

// ---------------------------------------------------------------------------
// Utility: Rotate a normal vector by Euler angles (XYZ order)
// ---------------------------------------------------------------------------
function rotateNormal(normal, rotation) {
  return rotatePoint(normal, [0, 0, 0], rotation);
}

// ---------------------------------------------------------------------------
// Build geometry for a single bbmodel element (cube)
// Returns { positions: Float32Array, normals: Float32Array, uvs: Float32Array, indices: Uint16Array }
// ---------------------------------------------------------------------------
function buildElementGeometry(element, resolution, textureCount) {
  const from = element.from;
  const to = element.to;
  const inflate = element.inflate || 0;
  const rotation = element.rotation || null;
  const origin = element.origin || [0, 0, 0];
  const mirrorUV = element.mirror_uv || false;

  // Compute inflated bounds
  const minX = (from[0] - inflate);
  const minY = (from[1] - inflate);
  const minZ = (from[2] - inflate);
  const maxX = (to[0] + inflate);
  const maxY = (to[1] + inflate);
  const maxZ = (to[2] + inflate);

  const sizeX = maxX - minX;
  const sizeY = maxY - minY;
  const sizeZ = maxZ - minZ;

  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  let vertexOffset = 0;

  for (const faceName of FACE_NAMES) {
    const faceData = element.faces[faceName];
    if (!faceData || faceData.texture === null || faceData.texture === undefined || faceData.texture === false) {
      continue; // Skip faces with no texture assigned
    }
    // Check if texture index is valid (-1 means no texture in some versions)
    if (faceData.texture === -1) continue;

    const faceDef = FACE_DEFINITIONS[faceName];

    // Generate 4 vertices for this face
    for (let i = 0; i < 4; i++) {
      const template = faceDef.positions[i];
      let px = minX + template[0] * sizeX;
      let py = minY + template[1] * sizeY;
      let pz = minZ + template[2] * sizeZ;

      let pos = [px, py, pz];

      // Apply element rotation if present
      if (rotation) {
        pos = rotatePoint(pos, origin, rotation);
      }

      // Scale to Hytopia units
      positions.push(pos[0] * SCALE, pos[1] * SCALE, pos[2] * SCALE);

      // Normal (also rotated if element has rotation)
      let norm = faceDef.normal.slice();
      if (rotation) {
        norm = rotateNormal(norm, rotation);
      }
      normals.push(norm[0], norm[1], norm[2]);
    }

    // UV coordinates from face data
    const faceUV = faceData.uv; // [u1, v1, u2, v2] in pixel coords
    const resW = resolution.width;
    const resH = resolution.height;

    // Normalize UVs to 0-1 range
    let u1 = faceUV[0] / resW;
    let v1 = faceUV[1] / resH;
    let u2 = faceUV[2] / resW;
    let v2 = faceUV[3] / resH;

    // glTF UV origin is top-left (same as Blockbench), V increases downward
    // But glTF expects V from bottom, so we need to flip V
    v1 = 1 - v1;
    v2 = 1 - v2;

    // Handle flipped UVs (when u1 > u2 or v1 < v2 in flipped coords)
    // The UV mapping for the 4 vertices of the face quad:
    // vertex 0 (bottom-left of face) -> (u1, v2) in glTF space (bottom-left of UV rect)
    // vertex 1 (bottom-right)        -> (u2, v2)
    // vertex 2 (top-right)           -> (u2, v1)
    // vertex 3 (top-left)            -> (u1, v1)

    // Check if UVs are flipped (mirror)
    let uvCoords;
    if (mirrorUV && (faceName === 'north' || faceName === 'south' || faceName === 'east' || faceName === 'west')) {
      // Mirror horizontally for mirrored elements
      uvCoords = [
        [u2, v2], // vertex 0
        [u1, v2], // vertex 1
        [u1, v1], // vertex 2
        [u2, v1], // vertex 3
      ];
    } else {
      uvCoords = [
        [u1, v2], // vertex 0 (bottom-left of face quad)
        [u2, v2], // vertex 1 (bottom-right)
        [u2, v1], // vertex 2 (top-right)
        [u1, v1], // vertex 3 (top-left)
      ];
    }

    for (let i = 0; i < 4; i++) {
      uvs.push(uvCoords[i][0], uvCoords[i][1]);
    }

    // Two triangles: 0-1-2 and 0-2-3
    indices.push(
      vertexOffset + 0, vertexOffset + 1, vertexOffset + 2,
      vertexOffset + 0, vertexOffset + 2, vertexOffset + 3
    );
    vertexOffset += 4;
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: new Uint16Array(indices),
  };
}

// ---------------------------------------------------------------------------
// Merge multiple geometries into one
// ---------------------------------------------------------------------------
function mergeGeometries(geoList) {
  let totalPositions = 0;
  let totalNormals = 0;
  let totalUVs = 0;
  let totalIndices = 0;

  for (const geo of geoList) {
    totalPositions += geo.positions.length;
    totalNormals += geo.normals.length;
    totalUVs += geo.uvs.length;
    totalIndices += geo.indices.length;
  }

  const positions = new Float32Array(totalPositions);
  const normalsArr = new Float32Array(totalNormals);
  const uvsArr = new Float32Array(totalUVs);

  // Determine if we need 32-bit indices
  const totalVertices = totalPositions / 3;
  const use32BitIndices = totalVertices > 65535;
  const indicesArr = use32BitIndices ? new Uint32Array(totalIndices) : new Uint16Array(totalIndices);

  let posOffset = 0;
  let normOffset = 0;
  let uvOffset = 0;
  let idxOffset = 0;
  let vertexBase = 0;

  for (const geo of geoList) {
    positions.set(geo.positions, posOffset);
    normalsArr.set(geo.normals, normOffset);
    uvsArr.set(geo.uvs, uvOffset);

    for (let i = 0; i < geo.indices.length; i++) {
      indicesArr[idxOffset + i] = geo.indices[i] + vertexBase;
    }

    posOffset += geo.positions.length;
    normOffset += geo.normals.length;
    uvOffset += geo.uvs.length;
    idxOffset += geo.indices.length;
    vertexBase += geo.positions.length / 3;
  }

  return {
    positions,
    normals: normalsArr,
    uvs: uvsArr,
    indices: indicesArr,
    use32BitIndices,
  };
}

// ---------------------------------------------------------------------------
// Compute bounding box of positions
// ---------------------------------------------------------------------------
function computeBounds(positions) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];

  for (let i = 0; i < positions.length; i += 3) {
    for (let j = 0; j < 3; j++) {
      if (positions[i + j] < min[j]) min[j] = positions[i + j];
      if (positions[i + j] > max[j]) max[j] = positions[i + j];
    }
  }

  return { min, max };
}

// ---------------------------------------------------------------------------
// Decode base64 data URI to Buffer
// ---------------------------------------------------------------------------
function decodeDataURI(dataURI) {
  const match = dataURI.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error('Invalid data URI');
  }
  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], 'base64'),
  };
}

// ---------------------------------------------------------------------------
// Build a GLB (Binary glTF) file
// ---------------------------------------------------------------------------
function buildGLB(geometry, textureBuffers) {
  const { positions, normals, uvs, indices, use32BitIndices } = geometry;

  // Build the binary buffer: positions + normals + uvs + indices + texture images
  const posBuffer = Buffer.from(positions.buffer, positions.byteOffset, positions.byteLength);
  const normBuffer = Buffer.from(normals.buffer, normals.byteOffset, normals.byteLength);
  const uvBuffer = Buffer.from(uvs.buffer, uvs.byteOffset, uvs.byteLength);
  const idxBuffer = Buffer.from(indices.buffer, indices.byteOffset, indices.byteLength);

  // Align each buffer view to 4 bytes
  function padTo4(buf) {
    const remainder = buf.length % 4;
    if (remainder === 0) return buf;
    return Buffer.concat([buf, Buffer.alloc(4 - remainder)]);
  }

  const paddedPos = padTo4(posBuffer);
  const paddedNorm = padTo4(normBuffer);
  const paddedUV = padTo4(uvBuffer);
  const paddedIdx = padTo4(idxBuffer);

  // Texture image buffers (already padded)
  const paddedTextures = textureBuffers.map(t => ({
    mimeType: t.mimeType,
    buffer: padTo4(t.buffer),
    originalLength: t.buffer.length,
  }));

  // Calculate total binary buffer size
  let totalBinSize = paddedPos.length + paddedNorm.length + paddedUV.length + paddedIdx.length;
  for (const t of paddedTextures) {
    totalBinSize += t.buffer.length;
  }

  // Build buffer views and accessors
  const bufferViews = [];
  const accessors = [];
  let byteOffset = 0;

  // 0: Positions
  bufferViews.push({
    buffer: 0,
    byteOffset: byteOffset,
    byteLength: posBuffer.length,
    target: GLTF_ARRAY_BUFFER,
  });
  const bounds = computeBounds(positions);
  accessors.push({
    bufferView: 0,
    componentType: GLTF_FLOAT,
    count: positions.length / 3,
    type: 'VEC3',
    min: bounds.min,
    max: bounds.max,
  });
  byteOffset += paddedPos.length;

  // 1: Normals
  bufferViews.push({
    buffer: 0,
    byteOffset: byteOffset,
    byteLength: normBuffer.length,
    target: GLTF_ARRAY_BUFFER,
  });
  accessors.push({
    bufferView: 1,
    componentType: GLTF_FLOAT,
    count: normals.length / 3,
    type: 'VEC3',
  });
  byteOffset += paddedNorm.length;

  // 2: UVs
  bufferViews.push({
    buffer: 0,
    byteOffset: byteOffset,
    byteLength: uvBuffer.length,
    target: GLTF_ARRAY_BUFFER,
  });
  accessors.push({
    bufferView: 2,
    componentType: GLTF_FLOAT,
    count: uvs.length / 2,
    type: 'VEC2',
  });
  byteOffset += paddedUV.length;

  // 3: Indices
  bufferViews.push({
    buffer: 0,
    byteOffset: byteOffset,
    byteLength: idxBuffer.length,
    target: GLTF_ELEMENT_ARRAY_BUFFER,
  });
  const indexComponentType = use32BitIndices ? GLTF_UNSIGNED_INT : GLTF_UNSIGNED_SHORT;
  accessors.push({
    bufferView: 3,
    componentType: indexComponentType,
    count: indices.length,
    type: 'SCALAR',
  });
  byteOffset += paddedIdx.length;

  // Texture buffer views (no target - these are images)
  const images = [];
  const textures = [];
  const materials = [];
  const samplers = [];

  if (paddedTextures.length > 0) {
    // Add a single sampler with nearest filtering for pixel art
    samplers.push({
      magFilter: 9728, // NEAREST
      minFilter: 9728, // NEAREST
      wrapS: 33071,    // CLAMP_TO_EDGE
      wrapT: 33071,    // CLAMP_TO_EDGE
    });
  }

  for (let i = 0; i < paddedTextures.length; i++) {
    const texInfo = paddedTextures[i];
    const bvIndex = bufferViews.length;

    bufferViews.push({
      buffer: 0,
      byteOffset: byteOffset,
      byteLength: texInfo.originalLength,
    });

    images.push({
      bufferView: bvIndex,
      mimeType: texInfo.mimeType,
    });

    textures.push({
      source: i,
      sampler: 0,
    });

    byteOffset += texInfo.buffer.length;
  }

  // Create materials - one per texture, or a default if no textures
  if (textures.length > 0) {
    // Use the first texture for the main material
    // (most bbmodels use a single texture atlas)
    materials.push({
      name: 'material_0',
      pbrMetallicRoughness: {
        baseColorTexture: {
          index: 0,
        },
        metallicFactor: 0,
        roughnessFactor: 1,
      },
      alphaMode: 'MASK',
      alphaCutoff: 0.1,
      doubleSided: true,
    });
  } else {
    materials.push({
      name: 'default_material',
      pbrMetallicRoughness: {
        baseColorFactor: [0.8, 0.8, 0.8, 1.0],
        metallicFactor: 0,
        roughnessFactor: 1,
      },
    });
  }

  // Build mesh
  const mesh = {
    primitives: [{
      attributes: {
        POSITION: 0,
        NORMAL: 1,
        TEXCOORD_0: 2,
      },
      indices: 3,
      material: 0,
    }],
  };

  // Build node
  const node = {
    mesh: 0,
    name: 'root',
  };

  // Build scene
  const scene = {
    nodes: [0],
    name: 'Scene',
  };

  // Build glTF JSON
  const gltf = {
    asset: {
      version: '2.0',
      generator: 'bbmodel-to-gltf.cjs (Merkari Studios)',
    },
    scene: 0,
    scenes: [scene],
    nodes: [node],
    meshes: [mesh],
    accessors: accessors,
    bufferViews: bufferViews,
    buffers: [{
      byteLength: totalBinSize,
    }],
    materials: materials,
  };

  if (samplers.length > 0) gltf.samplers = samplers;
  if (images.length > 0) gltf.images = images;
  if (textures.length > 0) gltf.textures = textures;

  // Encode glTF JSON
  let jsonString = JSON.stringify(gltf);
  // Pad JSON to 4-byte alignment with spaces
  while (Buffer.byteLength(jsonString, 'utf8') % 4 !== 0) {
    jsonString += ' ';
  }
  const jsonBuffer = Buffer.from(jsonString, 'utf8');

  // Assemble binary data buffer
  const binBufferParts = [paddedPos, paddedNorm, paddedUV, paddedIdx];
  for (const t of paddedTextures) {
    binBufferParts.push(t.buffer);
  }
  const binBuffer = Buffer.concat(binBufferParts);

  // Verify binary buffer size
  if (binBuffer.length !== totalBinSize) {
    console.warn(`WARNING: Binary buffer size mismatch. Expected ${totalBinSize}, got ${binBuffer.length}`);
  }

  // Build GLB
  // GLB Header: magic (4) + version (4) + length (4) = 12 bytes
  // Chunk 0 (JSON): length (4) + type (4) + data
  // Chunk 1 (BIN):  length (4) + type (4) + data
  const totalLength = 12 + 8 + jsonBuffer.length + 8 + binBuffer.length;

  const glb = Buffer.alloc(totalLength);
  let offset = 0;

  // Header
  glb.writeUInt32LE(0x46546C67, offset); offset += 4; // 'glTF' magic
  glb.writeUInt32LE(2, offset); offset += 4;           // version 2
  glb.writeUInt32LE(totalLength, offset); offset += 4;

  // JSON chunk
  glb.writeUInt32LE(jsonBuffer.length, offset); offset += 4;
  glb.writeUInt32LE(0x4E4F534A, offset); offset += 4; // 'JSON'
  jsonBuffer.copy(glb, offset); offset += jsonBuffer.length;

  // BIN chunk
  glb.writeUInt32LE(binBuffer.length, offset); offset += 4;
  glb.writeUInt32LE(0x004E4942, offset); offset += 4; // 'BIN\0'
  binBuffer.copy(glb, offset); offset += binBuffer.length;

  return glb;
}

// ---------------------------------------------------------------------------
// Convert a single .bbmodel file to .glb
// ---------------------------------------------------------------------------
function convertBBModel(inputPath, outputPath) {
  console.log(`\nConverting: ${inputPath}`);
  console.log(`Output:     ${outputPath}`);

  // Read and parse bbmodel
  const raw = fs.readFileSync(inputPath, 'utf8');
  const bbmodel = JSON.parse(raw);

  const modelName = bbmodel.name || path.basename(inputPath, '.bbmodel');
  const resolution = bbmodel.resolution || { width: 16, height: 16 };
  const elements = bbmodel.elements || [];
  const bbTextures = bbmodel.textures || [];

  console.log(`  Model name:  ${modelName}`);
  console.log(`  Format:      ${bbmodel.meta?.model_format || 'unknown'}`);
  console.log(`  Resolution:  ${resolution.width}x${resolution.height}`);
  console.log(`  Elements:    ${elements.length}`);
  console.log(`  Textures:    ${bbTextures.length}`);

  if (elements.length === 0) {
    console.log('  WARNING: No elements found, skipping.');
    return false;
  }

  // Build geometry for each element
  const geometries = [];
  let skippedZeroVolume = 0;

  for (const element of elements) {
    if (element.type !== 'cube') {
      console.log(`  Skipping non-cube element: ${element.type}`);
      continue;
    }

    // Check for zero-volume elements (planes) - skip them as they produce
    // degenerate geometry. Some bbmodels use zero-width planes for decoration.
    const from = element.from;
    const to = element.to;
    const sizeX = Math.abs(to[0] - from[0]);
    const sizeY = Math.abs(to[1] - from[1]);
    const sizeZ = Math.abs(to[2] - from[2]);

    if (sizeX < 0.001 || sizeY < 0.001 || sizeZ < 0.001) {
      // This is a plane/zero-volume element - still build it but
      // give it minimal thickness to avoid degenerate triangles
      const inflate = element.inflate || 0;
      const effectiveX = sizeX + inflate * 2;
      const effectiveY = sizeY + inflate * 2;
      const effectiveZ = sizeZ + inflate * 2;

      if (effectiveX < 0.001 || effectiveY < 0.001 || effectiveZ < 0.001) {
        skippedZeroVolume++;
        continue;
      }
    }

    const geo = buildElementGeometry(element, resolution, bbTextures.length);
    if (geo.positions.length > 0) {
      geometries.push(geo);
    }
  }

  if (skippedZeroVolume > 0) {
    console.log(`  Skipped ${skippedZeroVolume} zero-volume plane element(s)`);
  }

  if (geometries.length === 0) {
    console.log('  WARNING: No valid geometry produced, skipping.');
    return false;
  }

  console.log(`  Built ${geometries.length} element geometries`);

  // Merge all geometries
  const merged = mergeGeometries(geometries);
  console.log(`  Merged: ${merged.positions.length / 3} vertices, ${merged.indices.length / 3} triangles`);

  if (merged.use32BitIndices) {
    console.log('  Using 32-bit indices (large model)');
  }

  // Extract textures
  const textureBuffers = [];
  for (const tex of bbTextures) {
    if (tex.source) {
      try {
        const decoded = decodeDataURI(tex.source);
        textureBuffers.push(decoded);
        console.log(`  Texture "${tex.name}": ${decoded.buffer.length} bytes (${decoded.mimeType})`);
      } catch (e) {
        console.log(`  WARNING: Failed to decode texture "${tex.name}": ${e.message}`);
      }
    }
  }

  // If there are multiple textures, we only embed the first one in the material.
  // Also export the additional textures as separate PNG files alongside the .glb.
  if (textureBuffers.length > 1) {
    console.log(`  Note: Model has ${textureBuffers.length} textures. Using first as main material texture.`);
    const outDir = path.dirname(outputPath);
    const baseName = path.basename(outputPath, '.glb');
    for (let i = 1; i < textureBuffers.length; i++) {
      const texOutPath = path.join(outDir, `${baseName}_texture_${i}.png`);
      fs.writeFileSync(texOutPath, textureBuffers[i].buffer);
      console.log(`  Exported additional texture: ${texOutPath}`);
    }
  }

  // Build GLB with only the first texture embedded
  const singleTexture = textureBuffers.length > 0 ? [textureBuffers[0]] : [];
  const glb = buildGLB(merged, singleTexture);

  // Ensure output directory exists
  const outDir = path.dirname(outputPath);
  fs.mkdirSync(outDir, { recursive: true });

  // Write GLB file
  fs.writeFileSync(outputPath, glb);
  console.log(`  Written: ${outputPath} (${glb.length} bytes)`);

  // Also save the first texture separately as a PNG for reference
  if (textureBuffers.length > 0) {
    const baseName = path.basename(outputPath, '.glb');
    const texOutPath = path.join(outDir, `${baseName}_texture.png`);
    fs.writeFileSync(texOutPath, textureBuffers[0].buffer);
    console.log(`  Texture exported: ${texOutPath}`);
  }

  return true;
}

// ---------------------------------------------------------------------------
// Clean model name for output filename
// ---------------------------------------------------------------------------
function cleanModelName(filename) {
  // Remove (1), (2) etc. suffixes and clean up
  return filename
    .replace(/\.bbmodel$/i, '')
    .replace(/\s*\(\d+\)\s*/g, '')
    .replace(/\s+/g, '_')
    .toLowerCase();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage:');
    console.log('  node scripts/bbmodel-to-gltf.cjs --all');
    console.log('  node scripts/bbmodel-to-gltf.cjs <input.bbmodel> [output.glb]');
    process.exit(1);
  }

  if (args[0] === '--all') {
    console.log('=== Batch converting all .bbmodel files ===');
    console.log(`Input directory:  ${MODELS_INPUT_DIR}`);
    console.log(`Output directory: ${MODELS_OUTPUT_DIR}`);

    let success = 0;
    let failed = 0;

    for (const modelFile of ALL_MODELS) {
      const inputPath = path.join(MODELS_INPUT_DIR, modelFile);
      const outputName = cleanModelName(modelFile) + '.glb';
      const outputPath = path.join(MODELS_OUTPUT_DIR, outputName);

      if (!fs.existsSync(inputPath)) {
        console.log(`\nWARNING: File not found: ${inputPath}`);
        failed++;
        continue;
      }

      try {
        const result = convertBBModel(inputPath, outputPath);
        if (result) {
          success++;
        } else {
          failed++;
        }
      } catch (e) {
        console.error(`\nERROR converting ${modelFile}: ${e.message}`);
        console.error(e.stack);
        failed++;
      }
    }

    console.log(`\n=== Conversion complete: ${success} succeeded, ${failed} failed ===`);
  } else {
    // Single file mode
    const inputPath = path.resolve(args[0]);
    let outputPath;

    if (args[1]) {
      outputPath = path.resolve(args[1]);
    } else {
      const baseName = cleanModelName(path.basename(inputPath));
      outputPath = path.join(MODELS_OUTPUT_DIR, baseName + '.glb');
    }

    if (!fs.existsSync(inputPath)) {
      console.error(`ERROR: File not found: ${inputPath}`);
      process.exit(1);
    }

    try {
      convertBBModel(inputPath, outputPath);
    } catch (e) {
      console.error(`ERROR: ${e.message}`);
      console.error(e.stack);
      process.exit(1);
    }
  }
}

main();
