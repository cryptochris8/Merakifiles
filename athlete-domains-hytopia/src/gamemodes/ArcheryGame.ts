/**
 * ArcheryGame - Target shooting game mode for Athlete Domains.
 *
 * 4 players stand on fixed dock positions. Mob targets spawn on one side of
 * the field, walk in a line to the other side, and despawn when they reach
 * the far end. Players shoot by left-clicking; the engine fires a raycast
 * from the camera. If the raycast hits a mob entity within 50 blocks the
 * target is destroyed and points are awarded.
 *
 * TNT Zombie targets award 0 points but grant 2 explosive arrows with a
 * larger hit radius. Only 1 TNT Zombie spawns per game.
 *
 * 90-second match (1.5 minutes); player with the most points wins.
 */

import {
  Entity,
  PlayerEntity,
  DefaultPlayerEntity,
  Player,
  RigidBodyType,
  ColliderShape,
  PlayerEvent,
  EntityEvent,
  SimpleEntityController,
  SceneUI,
} from 'hytopia';
import type { Vector3Like } from 'hytopia';

import { ARCHERY_CONFIG, GameModeType } from '../core/GameConfig';
import BaseGameMode, { GameModePlayer } from '../core/BaseGameMode';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface MobTargetConfig {
  name: string;
  points: number;
  speed: number;
  special?: string;
  spawnsPerGame?: number;
}

interface ActiveTarget {
  entity: Entity;
  mobType: string;
  config: MobTargetConfig;
  nametagUI: SceneUI;
  isAlive: boolean;
  despawnTimer?: ReturnType<typeof setTimeout>;
}

// Per-player extra state (explosive arrows count).
interface ArcheryPlayerState {
  explosiveArrows: number;
}

// Model URIs for target mob types.
const TARGET_MODEL_URIS: Record<string, string> = {
  zombie:         'models/mobs/zombie.gltf',
  skeleton:       'models/mobs/skeleton.gltf',
  goldenZombie:   'models/mobs/zombie.gltf',
  goldenSkeleton: 'models/mobs/skeleton.gltf',
  tntZombie:      'models/mobs/zombie.gltf',
};

// ---------------------------------------------------------------------------
// Fixed dock positions for the 4 players (near the archery practice area).
// ---------------------------------------------------------------------------
const DOCK_POSITIONS: Vector3Like[] = [
  { x: -49.5, y: 67.0, z: 75.5 },
  { x: -45.5, y: 67.0, z: 75.5 },
  { x: -53.5, y: 67.0, z: 75.5 },
  { x: -41.5, y: 67.0, z: 75.5 },
];

// ---------------------------------------------------------------------------
// Mob lane configuration -- mobs walk from one side to the other.
// ---------------------------------------------------------------------------
const LANE_START_X = -80.0;
const LANE_END_X   = -20.0;
const LANE_Y       = 67.0;

const LANE_Z_OPTIONS = [95.5, 100.5, 105.5, 110.5, 115.5];

// Maximum range for a valid shot.
const MAX_SHOT_RANGE = 50;
// Explosive arrow proximity radius.
const EXPLOSIVE_HIT_RADIUS = 5;
// Normal proximity tolerance for the secondary ray-check.
const NORMAL_HIT_RADIUS = 2;

// Spawn weights (higher = more common).
const SPAWN_WEIGHTS: Record<string, number> = {
  zombie:         40,
  skeleton:       30,
  goldenZombie:   15,
  goldenSkeleton: 8,
  tntZombie:      7,
};

// ---------------------------------------------------------------------------
// ArcheryGame
// ---------------------------------------------------------------------------

export default class ArcheryGame extends BaseGameMode {

  // ---- Required abstract properties from BaseGameMode --------------------
  readonly name = ARCHERY_CONFIG.name;
  readonly type = GameModeType.ARCHERY;
  readonly minPlayers = ARCHERY_CONFIG.minPlayers;
  readonly maxPlayers = ARCHERY_CONFIG.maxPlayers;
  readonly matchDuration = ARCHERY_CONFIG.matchDuration; // 90s

  // ---- Target state ------------------------------------------------------
  private activeTargets: Map<number, ActiveTarget> = new Map();
  private tntZombieSpawned: boolean = false;
  private totalTargetsSpawned: number = 0;

  // ---- Spawn scheduling --------------------------------------------------
  private spawnTimerHandle: ReturnType<typeof setTimeout> | null = null;

  // ---- Per-player extra state --------------------------------------------
  private archeryState: Map<string, ArcheryPlayerState> = new Map();
  private playerEntities: Map<string, PlayerEntity> = new Map();

  // ---- Mob config arrays (prebuilt from ARCHERY_CONFIG.mobs) -------------
  private mobKeys: string[];
  private mobConfigs: MobTargetConfig[];

  constructor() {
    super();
    this.mobKeys = Object.keys(ARCHERY_CONFIG.mobs);
    this.mobConfigs = Object.values(ARCHERY_CONFIG.mobs) as MobTargetConfig[];
  }

  // =========================================================================
  // BaseGameMode lifecycle hooks
  // =========================================================================

  protected onStart(): void {
    this.tntZombieSpawned = false;
    this.totalTargetsSpawned = 0;
    this.activeTargets.clear();

    this.broadcastMessage(
      `[Archery] Shoot targets for ${this.matchDuration}s! Highest score wins.`,
      'FFD700',
    );

    this.teleportPlayersToDocks();
    this.startTargetSpawning();
  }

  protected onEnd(): void {
    // Stop spawning.
    if (this.spawnTimerHandle) {
      clearTimeout(this.spawnTimerHandle);
      this.spawnTimerHandle = null;
    }

    // Despawn all remaining targets.
    for (const target of this.activeTargets.values()) {
      this.despawnTarget(target);
    }
    this.activeTargets.clear();

    // Despawn player entities.
    for (const pe of this.playerEntities.values()) {
      if (pe.isSpawned) pe.despawn();
    }
    this.playerEntities.clear();
    this.archeryState.clear();

    this.announceResults();
  }

  protected onPlayerJoin(player: Player): void {
    if (!this.world) return;

    const dockIndex = this.playerEntities.size;
    const dockPos = DOCK_POSITIONS[dockIndex % DOCK_POSITIONS.length];

    const playerEntity = new DefaultPlayerEntity({
      player,
      name: player.username,
    });
    playerEntity.spawn(this.world, dockPos);
    this.playerEntities.set(player.id, playerEntity);

    // Update gamePlayers with entity reference.
    const gp = this.gamePlayers.get(player.id);
    if (gp) gp.playerEntity = playerEntity;

    // Initialize per-player archery state.
    this.archeryState.set(player.id, { explosiveArrows: 0 });

    // Set max interact distance to cover the full range.
    player.setMaxInteractDistance(MAX_SHOT_RANGE);

    // Listen for left-click (INTERACT) events.
    player.on(PlayerEvent.INTERACT, (payload) => {
      this.handlePlayerShoot(
        payload.player,
        payload.interactOrigin,
        payload.interactDirection,
        payload.raycastHit,
      );
    });

    this.sendPlayerMessage(player, '[Archery] Left-click to shoot at targets!', '55FF55');
  }

  protected onPlayerLeave(player: Player): void {
    const pe = this.playerEntities.get(player.id);
    if (pe?.isSpawned) pe.despawn();
    this.playerEntities.delete(player.id);
    this.archeryState.delete(player.id);

    if (this.players.length === 0 && this.isRunning) {
      this.forceEnd();
    }
  }

  /**
   * Called every world tick while ACTIVE.
   * Currently no per-tick work beyond what the base class already handles
   * (timer countdown, scoreboard). Mob movement is handled by their
   * SimpleEntityController.
   */
  protected onTick(_tickDeltaMs: number): void {
    // No additional per-tick logic required.
    // Target despawn is handled via individual setTimeout timers.
  }

  // =========================================================================
  // Player teleport
  // =========================================================================

  private teleportPlayersToDocks(): void {
    let index = 0;
    for (const pe of this.playerEntities.values()) {
      const dockPos = DOCK_POSITIONS[index % DOCK_POSITIONS.length];
      if (pe.isSpawned) pe.setPosition(dockPos);
      index++;
    }
  }

  // =========================================================================
  // Target spawning
  // =========================================================================

  private startTargetSpawning(): void {
    this.scheduleNextSpawn();
  }

  private scheduleNextSpawn(): void {
    if (!this.isRunning) return;

    const elapsed = this.getElapsedTime();
    const progress = Math.min(elapsed / this.matchDuration, 1);
    // Interval shrinks from 1500 ms to 700 ms over the match.
    const interval = Math.max(700, 1500 - progress * 800);

    this.spawnTimerHandle = setTimeout(() => {
      if (!this.isRunning) return;
      this.spawnTarget();
      this.scheduleNextSpawn();
    }, interval);
  }

  /** Weighted random target type selection. */
  private selectTargetType(): { key: string; config: MobTargetConfig } {
    let totalWeight = 0;
    const entries: { key: string; config: MobTargetConfig; weight: number }[] = [];

    for (let i = 0; i < this.mobKeys.length; i++) {
      const key = this.mobKeys[i];
      const config = this.mobConfigs[i];

      // Skip TNT zombie if already used.
      if (key === 'tntZombie' && this.tntZombieSpawned) continue;

      const w = SPAWN_WEIGHTS[key] ?? 10;
      totalWeight += w;
      entries.push({ key, config, weight: w });
    }

    let roll = Math.random() * totalWeight;
    for (const entry of entries) {
      roll -= entry.weight;
      if (roll <= 0) return { key: entry.key, config: entry.config };
    }

    return { key: this.mobKeys[0], config: this.mobConfigs[0] };
  }

  private spawnTarget(): void {
    if (!this.isRunning || !this.world) return;

    const { key, config } = this.selectTargetType();

    if (key === 'tntZombie') this.tntZombieSpawned = true;

    // Pick a random lane and direction.
    const laneZ = LANE_Z_OPTIONS[Math.floor(Math.random() * LANE_Z_OPTIONS.length)];
    const leftToRight = Math.random() > 0.5;
    const startX = leftToRight ? LANE_START_X : LANE_END_X;
    const endX   = leftToRight ? LANE_END_X : LANE_START_X;

    const startPos: Vector3Like = { x: startX, y: LANE_Y, z: laneZ };
    const endPos: Vector3Like   = { x: endX,   y: LANE_Y, z: laneZ };

    // SimpleEntityController for straight-line movement.
    const controller = new SimpleEntityController();
    controller.moveLoopedAnimations = ['walk'];

    const modelUri = TARGET_MODEL_URIS[key] ?? 'models/mobs/zombie.gltf';
    const tintColor = this.getMobTintColor(key);

    const targetEntity = new Entity({
      name: config.name,
      modelUri,
      modelScale: key === 'tntZombie' ? 1.0 : 0.8,
      controller,
      rigidBodyOptions: {
        type: RigidBodyType.KINEMATIC_POSITION,
        colliders: [
          {
            shape: ColliderShape.CAPSULE,
            halfHeight: 0.5,
            radius: 0.4,
          },
        ],
      },
      tag: `archery_target_${key}_${this.totalTargetsSpawned}`,
      tintColor,
    });

    targetEntity.spawn(this.world, startPos);

    // Nametag showing name and point value.
    const nametagUI = new SceneUI({
      templateId: 'archery-target-nametag',
      attachedToEntity: targetEntity,
      offset: { x: 0, y: 2.0, z: 0 },
      state: {
        name: config.name,
        points: config.points,
        color: this.getMobColorHex(key),
        special: config.special ?? null,
      },
      viewDistance: 60,
    });
    nametagUI.load(this.world);

    const entityId = targetEntity.id!;

    // Start movement.
    const ctrl = targetEntity.controller as SimpleEntityController;
    ctrl.move(endPos, config.speed);
    ctrl.face(endPos, 10);

    // Auto-despawn when reaching the end of the lane.
    const distance = Math.abs(endX - startX);
    const travelTimeMs = (distance / config.speed) * 1000;

    const despawnTimer = setTimeout(() => {
      const t = this.activeTargets.get(entityId);
      if (t?.isAlive) {
        t.isAlive = false;
        this.despawnTarget(t);
        this.activeTargets.delete(entityId);
      }
    }, travelTimeMs + 1000);

    const activeTarget: ActiveTarget = {
      entity: targetEntity,
      mobType: key,
      config,
      nametagUI,
      isAlive: true,
      despawnTimer,
    };
    this.activeTargets.set(entityId, activeTarget);
    this.totalTargetsSpawned++;

    // Direct click hit handler.
    targetEntity.on(EntityEvent.INTERACT, (payload) => {
      this.handleDirectHit(entityId, payload.player);
    });
  }

  private despawnTarget(target: ActiveTarget): void {
    if (target.despawnTimer) clearTimeout(target.despawnTimer);
    if (target.nametagUI?.isLoaded) target.nametagUI.unload();
    if (target.entity?.isSpawned) target.entity.despawn();
  }

  // =========================================================================
  // Shooting mechanic
  // =========================================================================

  /**
   * When a player left-clicks, Hytopia fires PlayerEvent.INTERACT with:
   *   interactOrigin    - the camera world position
   *   interactDirection - the camera look direction (unit vector)
   *   raycastHit?       - the first object hit by the engine raycast
   *
   * We first check the engine raycast for a direct mob hit.
   * If that misses (or was a block), we do a manual proximity scan along
   * the ray to handle near-misses and the explosive-arrow wider radius.
   */
  private handlePlayerShoot(
    player: Player,
    origin: Vector3Like,
    direction: Vector3Like,
    raycastHit?: { hitEntity?: Entity; hitDistance?: number; hitPoint?: Vector3Like },
  ): void {
    if (!this.isRunning) return;

    const state = this.archeryState.get(player.id);
    if (!state) return;

    const isExplosive = state.explosiveArrows > 0;
    const hitRadius = isExplosive ? EXPLOSIVE_HIT_RADIUS : NORMAL_HIT_RADIUS;

    // -- Check 1: Engine raycast direct hit on a mob entity. -----------------
    if (raycastHit?.hitEntity) {
      const hitId = raycastHit.hitEntity.id;
      if (
        hitId !== undefined &&
        raycastHit.hitDistance !== undefined &&
        raycastHit.hitDistance <= MAX_SHOT_RANGE
      ) {
        const target = this.activeTargets.get(hitId);
        if (target?.isAlive) {
          this.scoreHit(player, state, target, hitId);
          return;
        }
      }
    }

    // -- Check 2: Manual proximity scan along the ray. -----------------------
    const found = this.findTargetAlongRay(origin, direction, hitRadius);
    if (found) {
      this.scoreHit(player, state, found.target, found.entityId);
      return;
    }

    // Miss.
    if (isExplosive) {
      this.sendPlayerMessage(player, 'Explosive arrow missed!', 'FF5555');
    }
  }

  /** Direct click on a mob entity via EntityEvent.INTERACT. */
  private handleDirectHit(entityId: number, player: Player): void {
    if (!this.isRunning) return;

    const state = this.archeryState.get(player.id);
    if (!state) return;

    const target = this.activeTargets.get(entityId);
    if (!target?.isAlive) return;

    this.scoreHit(player, state, target, entityId);
  }

  /**
   * Finds the closest target along a ray using point-to-line distance.
   */
  private findTargetAlongRay(
    origin: Vector3Like,
    direction: Vector3Like,
    hitRadius: number,
  ): { target: ActiveTarget; entityId: number } | null {
    // Normalize direction.
    const len = Math.sqrt(direction.x ** 2 + direction.y ** 2 + direction.z ** 2);
    if (len === 0) return null;
    const dx = direction.x / len;
    const dy = direction.y / len;
    const dz = direction.z / len;

    let closestT = Infinity;
    let closest: { target: ActiveTarget; entityId: number } | null = null;

    for (const [entityId, target] of this.activeTargets) {
      if (!target.isAlive || !target.entity.isSpawned) continue;

      const pos = target.entity.position;

      // Vector from origin to mob center.
      const ox = pos.x - origin.x;
      const oy = pos.y - origin.y;
      const oz = pos.z - origin.z;

      // Project onto the ray.
      const t = ox * dx + oy * dy + oz * dz;
      if (t < 0 || t > MAX_SHOT_RANGE) continue;

      // Closest point on ray to mob center.
      const px = origin.x + dx * t;
      const py = origin.y + dy * t;
      const pz = origin.z + dz * t;

      const dist = Math.sqrt(
        (px - pos.x) ** 2 + (py - pos.y) ** 2 + (pz - pos.z) ** 2,
      );

      if (dist <= hitRadius && t < closestT) {
        closestT = t;
        closest = { target, entityId };
      }
    }

    return closest;
  }

  /**
   * Process a successful hit: award points, handle explosive arrows,
   * handle TNT zombie special.
   */
  private scoreHit(
    player: Player,
    state: ArcheryPlayerState,
    target: ActiveTarget,
    entityId: number,
  ): void {
    if (!target.isAlive) return;
    target.isAlive = false;

    const wasExplosive = state.explosiveArrows > 0;

    if (wasExplosive) {
      state.explosiveArrows--;
      this.sendPlayerMessage(
        player,
        `Explosive arrow used! ${state.explosiveArrows} remaining.`,
        'FFA500',
      );

      // Area damage around the hit position.
      const hitPos = target.entity.position;
      this.explosiveAreaDamage(player, state, hitPos, entityId);
    }

    // Award points via base class.
    const newTotal = this.addScore(player.id, target.config.points);

    // Handle TNT Zombie special: grant explosive arrows.
    if (target.config.special === 'explosive_arrows') {
      state.explosiveArrows += 2;
      this.sendPlayerMessage(
        player,
        'TNT Zombie hit! You received 2 explosive arrows!',
        'FF5555',
      );
      this.broadcastMessage(
        `${player.username} hit a TNT Zombie and got explosive arrows!`,
        'FFA500',
      );
    } else if (target.config.points > 0) {
      this.sendPlayerMessage(
        player,
        `+${target.config.points} pts (${target.config.name}) | Total: ${newTotal}`,
        '55FF55',
      );
    }

    // Despawn the target.
    this.despawnTarget(target);
    this.activeTargets.delete(entityId);
  }

  /**
   * Explosive arrow AoE: destroy all targets within EXPLOSIVE_HIT_RADIUS
   * of the explosion center.
   */
  private explosiveAreaDamage(
    player: Player,
    _state: ArcheryPlayerState,
    center: Vector3Like,
    excludeId: number,
  ): void {
    const idsToDestroy: number[] = [];

    for (const [entityId, target] of this.activeTargets) {
      if (!target.isAlive || entityId === excludeId || !target.entity.isSpawned) continue;

      const pos = target.entity.position;
      const dx = pos.x - center.x;
      const dy = pos.y - center.y;
      const dz = pos.z - center.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (dist <= EXPLOSIVE_HIT_RADIUS) {
        idsToDestroy.push(entityId);
      }
    }

    for (const entityId of idsToDestroy) {
      const target = this.activeTargets.get(entityId);
      if (target?.isAlive) {
        target.isAlive = false;
        this.addScore(player.id, target.config.points);
        this.despawnTarget(target);
        this.activeTargets.delete(entityId);
      }
    }

    if (idsToDestroy.length > 0) {
      this.sendPlayerMessage(
        player,
        `Explosive arrow destroyed ${idsToDestroy.length} extra target(s)!`,
        'FFA500',
      );
    }
  }

  // =========================================================================
  // Results announcement
  // =========================================================================

  private announceResults(): void {
    const scoreboard = this.getScoreboard();

    this.broadcastMessage('=== ARCHERY RESULTS ===', 'FFD700');

    if (scoreboard.length === 0) {
      this.broadcastMessage('No players scored.', 'AAAAAA');
      return;
    }

    for (let i = 0; i < scoreboard.length; i++) {
      const place = i + 1;
      const medal =
        place === 1 ? '[1st]' :
        place === 2 ? '[2nd]' :
        place === 3 ? '[3rd]' :
        `[${place}th]`;
      const color =
        place === 1 ? 'FFD700' :
        place === 2 ? 'C0C0C0' :
        place === 3 ? 'CD7F32' :
        'AAAAAA';
      this.broadcastMessage(
        `${medal} ${scoreboard[i].playerName}: ${scoreboard[i].score} points`,
        color,
      );
    }

    const winner = scoreboard[0];
    if (winner) {
      this.broadcastMessage(
        `Winner: ${winner.playerName} with ${winner.score} points!`,
        'FFD700',
      );
    }
  }

  // =========================================================================
  // Utilities
  // =========================================================================

  /** Get tint color for mob types as { r, g, b } in 0-1 range. */
  private getMobTintColor(key: string): { r: number; g: number; b: number } {
    const colors: Record<string, { r: number; g: number; b: number }> = {
      zombie:         { r: 0.33, g: 1.0,  b: 0.33 },
      skeleton:       { r: 0.9,  g: 0.9,  b: 0.9  },
      goldenZombie:   { r: 1.0,  g: 0.84, b: 0.0  },
      goldenSkeleton: { r: 1.0,  g: 0.84, b: 0.0  },
      tntZombie:      { r: 1.0,  g: 0.2,  b: 0.2  },
    };
    return colors[key] ?? { r: 0.5, g: 0.5, b: 0.5 };
  }

  /** Get hex color string for UI display. */
  private getMobColorHex(key: string): string {
    const colors: Record<string, string> = {
      zombie:         '#55FF55',
      skeleton:       '#FFFFFF',
      goldenZombie:   '#FFD700',
      goldenSkeleton: '#FFD700',
      tntZombie:      '#FF0000',
    };
    return colors[key] ?? '#AAAAAA';
  }
}
