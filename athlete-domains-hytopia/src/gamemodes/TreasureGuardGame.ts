/**
 * TreasureGuardGame - Wave defense game mode for Athlete Domains.
 *
 * Players defend a treasure chest from waves of mobs that pathfind toward it.
 * Mobs spawn from 5 spawn points with weighted random selection.
 * Players attack mobs by left-clicking (interacting) within melee range.
 * 90-second match; highest score wins. Up to 4 players.
 *
 * Mob types have different point values, speeds, taps-to-kill, and spawn
 * weights. TNT Zombie is limited to 1 per game and explodes near the treasure
 * for massive damage.
 *
 * The treasure has an HP bar. If it reaches 0 the game ends early.
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
  PathfindingEntityController,
  SimpleEntityController,
  SceneUI,
} from 'hytopia';
import type { Vector3Like } from 'hytopia';

import { TREASURE_GUARD_CONFIG, GameModeType, REWARDS_CONFIG } from '../core/GameConfig';
import BaseGameMode, { GameModePlayer } from '../core/BaseGameMode';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface MobTypeConfig {
  name: string;
  points: number;
  speed: number;
  chance: number;
  taps: number;
  color: string;
  spawnsPerGame?: number;
}

interface ActiveMob {
  entity: Entity;
  mobType: string;
  config: MobTypeConfig;
  tapsRemaining: number;
  nametagUI: SceneUI;
  isAlive: boolean;
}

// Model URIs for each mob type (relative to server assets directory).
const MOB_MODEL_URIS: Record<string, string> = {
  slowZombie:     'models/mobs/zombie.gltf',
  skeleton:       'models/mobs/skeleton.gltf',
  goldenZombie:   'models/mobs/zombie.gltf',
  goldenSkeleton: 'models/mobs/skeleton.gltf',
  bee:            'models/mobs/bee.gltf',
  zombieTank:     'models/mobs/zombie.gltf',
  tntZombie:      'models/mobs/zombie.gltf',
};

// ---------------------------------------------------------------------------
// TreasureGuardGame
// ---------------------------------------------------------------------------

export default class TreasureGuardGame extends BaseGameMode {

  // ---- Required abstract properties from BaseGameMode --------------------
  readonly name = TREASURE_GUARD_CONFIG.name;
  readonly type = GameModeType.TREASURE_GUARD;
  readonly minPlayers = TREASURE_GUARD_CONFIG.minPlayers ?? 1;
  readonly maxPlayers = 4;
  readonly matchDuration = TREASURE_GUARD_CONFIG.matchDuration; // 90s

  // ---- Treasure state ----------------------------------------------------
  private treasureHealth: number = 100;
  private readonly maxTreasureHealth: number = 100;
  private treasureEntity: Entity | null = null;
  private treasureHealthUI: SceneUI | null = null;

  // ---- Mob state ---------------------------------------------------------
  private activeMobs: Map<number, ActiveMob> = new Map();
  private tntZombieSpawned: boolean = false;
  private totalMobsSpawned: number = 0;

  // ---- Spawn scheduling --------------------------------------------------
  private spawnTimerHandle: ReturnType<typeof setTimeout> | null = null;

  // ---- Weighted spawn table (precomputed) --------------------------------
  private spawnTable: { key: string; config: MobTypeConfig }[] = [];
  private totalWeight: number = 0;

  // ---- Player entity tracking (separate from base gamePlayers) -----------
  private playerEntities: Map<string, PlayerEntity> = new Map();

  constructor() {
    super();
    this.buildSpawnTable();
  }

  // =========================================================================
  // BaseGameMode lifecycle hooks
  // =========================================================================

  protected onStart(): void {
    this.treasureHealth = this.maxTreasureHealth;
    this.tntZombieSpawned = false;
    this.totalMobsSpawned = 0;
    this.activeMobs.clear();

    this.broadcastMessage(
      `[Treasure Guard] Defend the treasure for ${this.matchDuration}s!`,
      'FFD700',
    );

    this.spawnTreasure();
    this.teleportPlayersToSpawns();
    this.startMobSpawning();
  }

  protected onEnd(): void {
    // Stop mob spawning.
    if (this.spawnTimerHandle) {
      clearTimeout(this.spawnTimerHandle);
      this.spawnTimerHandle = null;
    }

    // Despawn all active mobs.
    for (const mob of this.activeMobs.values()) {
      this.despawnMob(mob);
    }
    this.activeMobs.clear();

    // Despawn treasure.
    if (this.treasureEntity?.isSpawned) {
      this.treasureEntity.despawn();
    }
    if (this.treasureHealthUI?.isLoaded) {
      this.treasureHealthUI.unload();
    }

    // Despawn player entities.
    for (const pe of this.playerEntities.values()) {
      if (pe.isSpawned) pe.despawn();
    }
    this.playerEntities.clear();

    // Announce final standings.
    this.announceResults();
  }

  protected onPlayerJoin(player: Player): void {
    if (!this.world) return;

    const spawnIndex = this.playerEntities.size;
    const spawnPos =
      TREASURE_GUARD_CONFIG.playerSpawnPoints[spawnIndex] ??
      TREASURE_GUARD_CONFIG.playerSpawnPoints[0];

    const playerEntity = new DefaultPlayerEntity({
      player,
      name: player.username,
    });
    playerEntity.spawn(this.world, spawnPos);
    this.playerEntities.set(player.id, playerEntity);

    // Update the gamePlayers map with the entity reference.
    const gp = this.gamePlayers.get(player.id);
    if (gp) gp.playerEntity = playerEntity;

    // Set interaction distance for melee range.
    player.setMaxInteractDistance(5);

    // Listen for INTERACT to handle melee hits.
    player.on(PlayerEvent.INTERACT, (payload) => {
      this.handlePlayerInteract(payload.player, payload.raycastHit);
    });

    this.sendPlayerMessage(
      player,
      '[Treasure Guard] Left-click mobs to attack them!',
      '55FF55',
    );
  }

  protected onPlayerLeave(player: Player): void {
    const pe = this.playerEntities.get(player.id);
    if (pe?.isSpawned) pe.despawn();
    this.playerEntities.delete(player.id);

    // If nobody left, force the match to end.
    if (this.players.length === 0 && this.isRunning) {
      this.forceEnd();
    }
  }

  /**
   * Called every world tick while ACTIVE.
   * Handles mob proximity checks and early-end conditions.
   */
  protected onTick(_tickDeltaMs: number): void {
    this.checkMobProximityToTreasure();

    // End early if treasure is destroyed.
    if (this.treasureHealth <= 0) {
      this.broadcastMessage(
        '[Treasure Guard] The treasure has been destroyed!',
        'FF5555',
      );
      this.forceEnd();
    }
  }

  // =========================================================================
  // Reward override
  // =========================================================================

  protected getWinnerReward(): number {
    // treasurePerHundredPoints * (winner score / 100)
    const topScore = this.getScoreboard()[0]?.score ?? 0;
    return REWARDS_CONFIG.treasurePerHundredPoints * Math.max(1, Math.floor(topScore / 100));
  }

  // =========================================================================
  // Spawn table
  // =========================================================================

  private buildSpawnTable(): void {
    const mobs = TREASURE_GUARD_CONFIG.mobs as Record<string, MobTypeConfig>;
    this.spawnTable = [];
    this.totalWeight = 0;

    for (const [key, config] of Object.entries(mobs)) {
      this.spawnTable.push({ key, config });
      this.totalWeight += config.chance;
    }
  }

  /** Weighted random mob selection. Respects spawnsPerGame limits. */
  private selectMobType(): { key: string; config: MobTypeConfig } | null {
    let roll = Math.random() * this.totalWeight;

    for (const entry of this.spawnTable) {
      // Enforce single-spawn limit for TNT Zombie.
      if (entry.key === 'tntZombie' && this.tntZombieSpawned) {
        continue;
      }

      roll -= entry.config.chance;
      if (roll <= 0) {
        return entry;
      }
    }

    // Fallback: slow zombie.
    return this.spawnTable.find(e => e.key === 'slowZombie') ?? this.spawnTable[0];
  }

  // =========================================================================
  // Treasure entity
  // =========================================================================

  private spawnTreasure(): void {
    if (!this.world) return;

    const pos = TREASURE_GUARD_CONFIG.treasureLocation;

    this.treasureEntity = new Entity({
      name: 'Treasure',
      modelUri: 'models/environment/chest.gltf',
      modelScale: 1.0,
      rigidBodyOptions: {
        type: RigidBodyType.FIXED,
      },
      tag: 'treasure',
    });
    this.treasureEntity.spawn(this.world, pos);

    // Health bar UI above the chest.
    this.treasureHealthUI = new SceneUI({
      templateId: 'treasure-guard-health',
      attachedToEntity: this.treasureEntity,
      offset: { x: 0, y: 2.5, z: 0 },
      state: {
        label: 'Treasure',
        health: this.treasureHealth,
        maxHealth: this.maxTreasureHealth,
      },
      viewDistance: 50,
    });
    this.treasureHealthUI.load(this.world);
  }

  // =========================================================================
  // Player teleport
  // =========================================================================

  private teleportPlayersToSpawns(): void {
    let index = 0;
    for (const pe of this.playerEntities.values()) {
      const sp = TREASURE_GUARD_CONFIG.playerSpawnPoints[
        index % TREASURE_GUARD_CONFIG.playerSpawnPoints.length
      ];
      if (pe.isSpawned) pe.setPosition(sp);
      index++;
    }
  }

  // =========================================================================
  // Mob spawning
  // =========================================================================

  private startMobSpawning(): void {
    this.scheduleNextSpawn();
  }

  private scheduleNextSpawn(): void {
    if (!this.isRunning) return;

    // Spawn interval decreases from 2000 ms to 500 ms over the match.
    const elapsed = this.getElapsedTime();
    const progress = Math.min(elapsed / this.matchDuration, 1);
    const interval = Math.max(500, 2000 - progress * 1500);

    this.spawnTimerHandle = setTimeout(() => {
      if (!this.isRunning) return;
      this.spawnMob();
      this.scheduleNextSpawn();
    }, interval);
  }

  private spawnMob(): void {
    if (!this.isRunning || !this.world) return;

    const selected = this.selectMobType();
    if (!selected) return;

    const { key, config } = selected;

    if (key === 'tntZombie') this.tntZombieSpawned = true;

    // Random spawn point.
    const spawnPoints = TREASURE_GUARD_CONFIG.mobSpawnPoints;
    const sp = spawnPoints[Math.floor(Math.random() * spawnPoints.length)];

    // Bees spawn slightly higher.
    const spawnPos: Vector3Like = key === 'bee'
      ? { x: sp.x, y: sp.y + 3, z: sp.z }
      : { x: sp.x, y: sp.y, z: sp.z };

    // Pathfinding controller for navigation toward treasure.
    const controller = new PathfindingEntityController();

    const modelUri = MOB_MODEL_URIS[key] ?? 'models/mobs/zombie.gltf';
    const tintColor = this.hexToRgb(config.color);

    const mobEntity = new Entity({
      name: config.name,
      modelUri,
      modelScale: key === 'zombieTank' ? 1.5 : key === 'bee' ? 0.6 : 0.8,
      controller,
      rigidBodyOptions: {
        type: RigidBodyType.KINEMATIC_POSITION,
        colliders: [
          {
            shape: ColliderShape.CAPSULE,
            halfHeight: 0.4,
            radius: 0.35,
          },
        ],
      },
      tag: `mob_${key}_${this.totalMobsSpawned}`,
      tintColor,
    });

    mobEntity.spawn(this.world, spawnPos);

    // Nametag showing mob name, point value, and remaining taps.
    const nametagUI = new SceneUI({
      templateId: 'treasure-guard-mob-nametag',
      attachedToEntity: mobEntity,
      offset: { x: 0, y: 2.0, z: 0 },
      state: {
        name: config.name,
        points: config.points,
        color: config.color,
        tapsRemaining: config.taps,
        tapsTotal: config.taps,
      },
      viewDistance: 30,
    });
    nametagUI.load(this.world);

    const mobId = mobEntity.id!;

    const activeMob: ActiveMob = {
      entity: mobEntity,
      mobType: key,
      config,
      tapsRemaining: config.taps,
      nametagUI,
      isAlive: true,
    };
    this.activeMobs.set(mobId, activeMob);
    this.totalMobsSpawned++;

    // Listen for direct clicks on the mob entity.
    mobEntity.on(EntityEvent.INTERACT, (payload) => {
      this.handleMobInteract(mobId, payload.player);
    });

    // Start pathfinding toward the treasure.
    this.pathfindMobToTreasure(mobEntity, config.speed);
  }

  private pathfindMobToTreasure(mobEntity: Entity, speed: number): void {
    const target = TREASURE_GUARD_CONFIG.treasureLocation;
    const ctrl = mobEntity.controller as PathfindingEntityController | undefined;
    if (!ctrl || !mobEntity.isSpawned) return;

    const found = ctrl.pathfind(target, speed);
    if (!found) {
      // Fallback: straight-line walk (PathfindingEC extends SimpleEC).
      ctrl.move(target, speed);
      ctrl.face(target, 5);
    }
  }

  // =========================================================================
  // Combat -- player hits mob
  // =========================================================================

  /**
   * Fired from PlayerEvent.INTERACT.
   * The engine sends a raycastHit containing the hit entity if any.
   */
  private handlePlayerInteract(
    player: Player,
    raycastHit?: { hitEntity?: Entity; hitDistance?: number },
  ): void {
    if (!this.isRunning) return;
    if (!raycastHit?.hitEntity) return;

    const hitEntityId = raycastHit.hitEntity.id;
    if (hitEntityId === undefined) return;

    const mob = this.activeMobs.get(hitEntityId);
    if (!mob || !mob.isAlive) return;

    this.damageMob(mob, player);
  }

  /**
   * Fired from EntityEvent.INTERACT on the mob itself.
   */
  private handleMobInteract(mobId: number, player: Player): void {
    if (!this.isRunning) return;

    const mob = this.activeMobs.get(mobId);
    if (!mob || !mob.isAlive) return;

    this.damageMob(mob, player);
  }

  private damageMob(mob: ActiveMob, player: Player): void {
    if (!mob.isAlive) return;

    mob.tapsRemaining--;

    // Update nametag with remaining taps.
    if (mob.nametagUI.isLoaded) {
      mob.nametagUI.setState({ tapsRemaining: mob.tapsRemaining });
    }

    if (mob.tapsRemaining <= 0) {
      mob.isAlive = false;

      // Award points through the base class addScore.
      const newTotal = this.addScore(player.id, mob.config.points);

      this.sendPlayerMessage(
        player,
        `+${mob.config.points} pts (${mob.config.name}) | Total: ${newTotal}`,
        '55FF55',
      );
      this.broadcastMessage(
        `${player.username} killed a ${mob.config.name}!`,
        'AAAAAA',
      );

      this.despawnMob(mob);
      this.activeMobs.delete(mob.entity.id!);
    } else {
      this.sendPlayerMessage(
        player,
        `Hit ${mob.config.name}! ${mob.tapsRemaining}/${mob.config.taps} taps left.`,
        'FFFF55',
      );
    }
  }

  private despawnMob(mob: ActiveMob): void {
    if (mob.nametagUI?.isLoaded) mob.nametagUI.unload();
    if (mob.entity?.isSpawned) mob.entity.despawn();
  }

  // =========================================================================
  // Mob proximity check (called every tick)
  // =========================================================================

  private checkMobProximityToTreasure(): void {
    const treasurePos = TREASURE_GUARD_CONFIG.treasureLocation;
    const reachDist = 2.5;
    const mobsToRemove: number[] = [];

    for (const [mobId, mob] of this.activeMobs) {
      if (!mob.isAlive || !mob.entity.isSpawned) continue;

      const pos = mob.entity.position;
      const dx = pos.x - treasurePos.x;
      const dz = pos.z - treasurePos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist <= reachDist) {
        let damage = 5;

        if (mob.mobType === 'tntZombie') {
          damage = 30;
          this.broadcastMessage('TNT Zombie EXPLODED near the treasure!', 'FF0000');
        }

        this.treasureHealth = Math.max(0, this.treasureHealth - damage);

        if (this.treasureHealthUI?.isLoaded) {
          this.treasureHealthUI.setState({ health: this.treasureHealth });
        }

        this.broadcastMessage(
          `A ${mob.config.name} reached the treasure! (-${damage} HP, ${this.treasureHealth} left)`,
          'FF5555',
        );

        mob.isAlive = false;
        mobsToRemove.push(mobId);
      }
    }

    for (const id of mobsToRemove) {
      const mob = this.activeMobs.get(id);
      if (mob) {
        this.despawnMob(mob);
        this.activeMobs.delete(id);
      }
    }
  }

  // =========================================================================
  // Results announcement
  // =========================================================================

  private announceResults(): void {
    const scoreboard = this.getScoreboard();
    const survived = this.treasureHealth > 0;

    this.broadcastMessage('=== TREASURE GUARD RESULTS ===', 'FFD700');
    this.broadcastMessage(
      survived ? 'The treasure survived!' : 'The treasure was destroyed!',
      survived ? '55FF55' : 'FF5555',
    );

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
  }

  // =========================================================================
  // Utilities
  // =========================================================================

  /** Convert hex color string like '#FFD700' or 'FFD700' to { r, g, b } (0-1). */
  private hexToRgb(hex: string): { r: number; g: number; b: number } {
    const clean = hex.replace('#', '');
    return {
      r: parseInt(clean.substring(0, 2), 16) / 255,
      g: parseInt(clean.substring(2, 4), 16) / 255,
      b: parseInt(clean.substring(4, 6), 16) / 255,
    };
  }
}
