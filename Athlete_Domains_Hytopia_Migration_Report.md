# Athlete Domains Asset Audit & Hytopia Migration Analysis
**Date:** February 25, 2026
**Prepared for:** Christopher
**Project:** Athlete Domains (originally NFT Worlds / Merkari Studios)

---

## Background

Athlete Domains was originally built as a sports-themed gaming project on NFT Worlds (Minecraft-based crypto gaming platform). After Microsoft prohibited cryptocurrency use in Minecraft, the NFT Worlds team pivoted and created Hytopia - their own independent gaming platform. Christopher had already hired Merkari Studios to create Minecraft-compatible games, worlds, and assets. This report audits all existing assets and evaluates what can be migrated to Hytopia or other gaming platforms.

---

## What You Have (Merkari Files Inventory)

### Design Documents (26MB)
The project is extensively documented with 4 key documents:
- **Game Document (9.1MB)** - Full specs for Sumo, Tower Duel, Archery, Range Practice
- **Expansion Document (13MB)** - Football (1v1/2v2/3v3), Boat/Jetski Race, Parkour Race, Cafe system, Ice Cream Stands, Rank system
- **Client Document (3.6MB)** - Original NFT Worlds client specifications
- **Demo Meeting Notes** - Status/todo tracking

### 3D Models (Blockbench .bbmodel format)
- Ice cream seller NPC
- Ice cream stand
- Jersey
- Rugby ball (3 variants)
- Jetski (in .rar archives)

These are in **Blockbench format** - directly relevant for Hytopia conversion.

### 6 Minecraft World Maps
- **Island/Lobby** - Main hub city with central stadium
- **Football Field** - Soccer arena
- **Parkour Course** - Racing parkour map
- **Road** - Treasure Guard game map
- **Sumo Dojo** - 1v1 arena
- **Tower Duel Arena** - Team battle arena

### 18 Character Skins + 100+ Textures
- 12 named Athlete NPCs (Aidan, Alan, David, Emma, Kloey, Leo, Maya, Noah, Oliva, Sarah, Tyson, Will)
- 6 game-specific skins (Blue/Red Knights, Towers, Sumo wrestlers)
- Item textures: cafe drinks (espresso, latte, cappuccino), ice cream flavors, rank badges, mystery box
- Full Oraxen resource pack with 100+ custom item textures

### Custom Plugin (Java)
- `Athlete_FINAL.jar` - Complete game logic for all 8 game modes
- 1,595-line `config.yml` with all game settings, rewards, spawn points, economy balance
- MySQL database integration, rank system (VIP, Athlete, Medalist, Admin), economy system

### 8 Implemented Game Modes
1. **Sumo Wrestling** - 1v1 PvP knockback combat (best of 5)
2. **Tower Duel** - 2v2 team battles with tower/duelist roles (best of 3)
3. **Treasure Guard** - Wave-based mob defense
4. **Parkour Race** - Competitive checkpoint racing (4-8 players)
5. **Jetski Race** - Water racing with checkpoints (3-7 players)
6. **Football 1v1** - Soccer matches
7. **Football 2v2** - Team soccer
8. **Football 3v3** - Large team soccer

### Economy & Progression System
- In-game currency system
- Cafe with speed boost consumables (Espresso, Latte, Cappuccino, Muffin)
- Ice Cream Stand with reward multiplier boosters (5% boost per flavor)
- Mystery Box system (daily free box)
- Cosmetic shop (Jetski colors)
- Rank system with perks (VIP, Athlete, Medalist, Admin)
- Statistics tracking: games played, wins, kills, checkpoints, high scores
- Leaderboard holograms throughout the world

### Server Backups (~19GB)
- Multiple dated backups of the full server state
- Cross-version support data (Minecraft 1.18.2 - 1.20.4)

### Third-Party Plugins (44 JARs)
Citizens (NPCs), WorldGuard (protection), Multiverse (worlds), ModelEngine (3D models), Oraxen (custom items), DecentHolograms, EssentialsX, LuckPerms, ViaVersion, PlaceholderAPI, FastAsyncWorldEdit, Vault (economy), and more.

---

## What Can Be Used in Hytopia

### YES - Directly Convertible

| Asset | Conversion Method | Effort |
|-------|------------------|--------|
| **World Maps (6 templates)** | Hytopia World Editor at build.hytopia.com has a **one-click Minecraft map converter** (released March 2025). Upload your map templates and convert directly. | Low |
| **3D Models (.bbmodel)** | Open in Blockbench -> Export as **glTF/GLB** -> Place in Hytopia `assets/models/` folder. Hytopia natively supports glTF/GLB. | Low |
| **Character Skins (.png)** | Can be used as textures on player/NPC model entities in Hytopia. May need format adjustment. | Low-Medium |
| **Item Textures (.png)** | Resize from 16x16 to **24x24 pixels** (Hytopia's standard), place in `assets/blocks/` or use as UI elements. | Low |
| **Game Design Documents** | Most valuable asset - all game rules, mechanics, economy balance, and progression systems are fully documented and translate 1:1 to any platform. | None needed |
| **Config Data (YAML)** | Spawn points, reward values, game timers, booster multipliers - all balance data can inform Hytopia TypeScript code directly. | Low |

### NO - Must Be Rebuilt

| Asset | Why | Notes |
|-------|-----|-------|
| **Java Plugin (Athlete_FINAL.jar)** | Hytopia uses **TypeScript/JavaScript**, not Java. Minecraft plugin APIs (Bukkit/Spigot) don't exist in Hytopia. | The logic/design is documented and can guide TypeScript reimplementation |
| **Third-party Plugins (44 JARs)** | Citizens, WorldGuard, ModelEngine, etc. are Minecraft-specific. | Hytopia has built-in equivalents: EntityManager for NPCs, Physics for collisions, SceneUI for holograms |
| **Minecraft Server Config** | server.properties, bukkit.yml, etc. are Minecraft-specific. | Hytopia has its own config patterns |

---

## Hytopia SDK Overview

### Platform Status
- SDK launched **February 2025**, currently in **alpha/beta**
- **143,000+ users** with **1.93 million minutes of playtime** (as of Sept 2025)
- Cross-platform: web browsers, PC/Mac/Linux, Android/iOS, Discord Activities
- Server-authoritative architecture with managed hosting

### Technical Stack
- **Language:** TypeScript/JavaScript (NPM package)
- **Engine Core:** Rust compiled to WebAssembly
- **Physics:** Rapier SIMD engine
- **Networking:** WebRTC with WebSocket fallback
- **3D Format:** glTF/GLB only
- **Block Textures:** 24x24 pixels

### Key SDK Features Relevant to Athlete Domains

- **Entity System**: `PlayerEntity` for players, `Entity` for NPCs/balls/vehicles with full physics
- **Controllers**: `DefaultPlayerEntityController` (player movement), `PathfindingEntityController` (NPC AI), `SimpleEntityController` (objects like balls)
- **Physics**: Full Rapier engine - collisions, raycasts, knockback (perfect for Sumo), ball physics (perfect for Football)
- **Voxel Terrain**: Block placement, custom block types with `BlockTypeRegistry`, chunk management
- **UI System**: HTML overlay UI (`PlayerUI`) for scoreboards/timers/menus + `SceneUI` for 3D in-world elements (holograms, nameplates)
- **Persistence**: `PersistenceManager` for player data saving (stats, currency, ranks)
- **Audio**: Positional audio via `AudioManager`
- **Animations**: Model animation blending with `EntityModelAnimationLoopMode`
- **Multiplayer**: Built-in WebRTC networking with automatic scaling
- **World Management**: Multi-world support, `WorldManager`, map loading from JSON

---

## Game Mode Feasibility on Hytopia

| Game Mode | Feasibility | Key SDK Features Needed |
|-----------|------------|------------------------|
| **Football/Soccer** | HIGH | Physics for ball entity, team system, collision events, timer UI, score tracking |
| **Sumo** | HIGH | Knockback physics via impulses, 1v1 matchmaking, arena boundary detection |
| **Tower Duel** | HIGH | Projectile raycasts for arrows, team system, zone/role mechanics |
| **Parkour Race** | HIGH | Checkpoint collision triggers (block events), countdown timer, leaderboard UI |
| **Jetski Race** | HIGH | Custom vehicle entity with GLB model, water/liquid block detection, checkpoints |
| **Treasure Guard** | HIGH | Wave spawner logic, `PathfindingEntityController` for mobs, scoring system |
| **Archery** | HIGH | Raycasts or projectile entities, target scoring, mob movement patterns |
| **Cafe/Ice Cream Economy** | HIGH | `PersistenceManager` for currency, `PlayerUI` for shop menus, booster effect timers |

---

## Hytopia Conversion Pathways

### World Maps
- **Primary tool:** Hytopia World Editor at **build.hytopia.com**
- One-click Minecraft map conversion (released March 2025)
- Large maps (>500x500 blocks) may lag temporarily during conversion
- Outputs Hytopia-compatible map JSON format

### 3D Models (.bbmodel -> glTF/GLB)
1. Open .bbmodel file in Blockbench
2. File -> Export -> Export glTF Model (or GLB)
3. Place exported file in Hytopia project `assets/models/` directory
4. Reference in code: `modelUri: 'models/ice_cream_stand.glb'`

### Textures (16x16 -> 24x24)
1. Open PNG texture files
2. Resize from 16x16 to 24x24 pixels (nearest-neighbor scaling to maintain pixel art)
3. Place in Hytopia project `assets/blocks/` directory
4. For multi-face blocks, create folder with `+x.png`, `-x.png`, `+y.png`, `-y.png`, `+z.png`, `-z.png`

### Third-Party Conversion Tools
- **Hytale Converter** (hytale-converter.com) - Converts .schematic files to prefabs, up to 20M blocks
- **Bloxelizer** (bloxelizer.com) - Supports .schematic, .schem, .litematic, .nbt, .mcstructure
- **ItsMyConvert** (itsmyconvert.com) - Schematic converter between Minecraft versions

---

## Recommended Migration Path

### Phase 1: Environment Setup
1. Convert all 6 world maps using the Hytopia World Editor at build.hytopia.com
2. Convert all .bbmodel files to GLB via Blockbench export
3. Resize and organize textures (16x16 -> 24x24)
4. Set up a Hytopia project scaffold with TypeScript

### Phase 2: Core Systems (TypeScript)
1. Build lobby system with game mode selection
2. Implement player persistence (stats, currency, ranks)
3. Create matchmaking/queue system
4. Build shared UI components (scoreboards, timers, menus)

### Phase 3: First Game Mode - Football/Soccer
- Best documented game mode
- Uses the most Hytopia-native features (ball physics, teams, scoring)
- Serves as proof of concept for the platform

### Phase 4: Remaining Game Modes
- Sumo (knockback physics)
- Parkour Race (checkpoint system)
- Tower Duel (team roles + projectiles)
- Jetski Race (vehicle entity)
- Treasure Guard (wave spawner + AI)
- Archery (target shooting)

### Phase 5: Economy & Progression
- Cafe and Ice Cream Stand shop systems
- Currency earning and spending
- Booster/multiplier effects
- Rank system with perks
- Leaderboards

---

## Other Platforms to Consider

Your assets (especially design docs, 3D models, and textures) could also work on:

| Platform | Pros | Cons |
|----------|------|------|
| **Roblox** | Massive player base, mature platform | Uses Lua scripting, 30% revenue cut |
| **Core Games** | Unreal Engine-based, high quality visuals | Smaller player base |
| **The Sandbox** | Voxel-based, crypto-native (aligns with NFT Worlds origins) | Still developing, smaller audience |
| **Hytale** (future) | Minecraft-like, supports custom content | Not yet released |

---

## Key File Locations

| File | Path |
|------|------|
| Main Plugin | `extracted\worlds\plugins\Athlete_FINAL.jar` |
| Game Config | `extracted\worlds\plugins\AthleteDomains\config.yml` |
| Game Design Doc | `Athlete Domains Game Document.docx` |
| Expansion Doc | `Athlete Domains_ Expansion Document.docx` |
| Client Doc | `Christopher x Meraki _ NFTWorlds Client.docx` |
| 3D Models | `organized\assets\models\` |
| Character Skins | `organized\assets\skins\` |
| Textures | `organized\assets\textures\` |
| World Templates | `extracted\worlds\map_template_*.zip` |
| Complete Build | `Athlete_Domains.zip` (53MB) |
| Latest Backup | `Latest.gz` (4.3GB) |

---

## Bottom Line

**There is significant reusable value in the existing assets.** The world maps, 3D models, textures, character skins, and especially the detailed game design documents are all portable. The main investment for Hytopia will be rewriting the Java game logic in TypeScript - but the SDK has all the building blocks needed, and the 1,595-line config.yml serves as an excellent specification for the rewrite. The Hytopia World Editor's Minecraft converter is the fastest path to seeing the stadium and city running on the new platform.

---

*Report generated with the assistance of Claude Code using Hytopia MCP tools and SDK documentation research.*
