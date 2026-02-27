/**
 * Athlete Domains - Jetski Race Game Mode
 *
 * A vehicular water race for 1-9 players around the island. Each player
 * is given a jetski model entity driven by WASD input. The course has
 * 39 checkpoints. When the first player completes all checkpoints a
 * 30-second countdown starts for remaining racers. Top 3 earn rewards.
 * Players can equip cosmetic jetski colours from their persisted data.
 *
 * Extends BaseGameMode and uses its state machine (WAITING -> COUNTDOWN ->
 * ACTIVE -> ENDING) along with the built-in tick loop, timer, scoreboard,
 * and reward distribution.
 */

import {
  Entity,
  PlayerEntity,
  Player,
  World,
  RigidBodyType,
  ColliderShape,
  CollisionGroup,
  PlayerEvent,
  EntityEvent,
  BaseEntityController,
  PlayerCameraOrientation,
  type PlayerInput,
  type Vector3Like,
} from 'hytopia';

import {
  JETSKI_RACE_CONFIG,
  COSMETICS_CONFIG,
  GameModeType,
  REWARDS_CONFIG,
  StatType,
} from '../core/GameConfig';
import BaseGameMode, { type GameModePlayer } from '../core/BaseGameMode';
import { UIManager } from '../core/UIManager';
import { PlayerDataManager } from '../core/PlayerDataManager';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Forward speed of the jetski (blocks / second). */
const JETSKI_SPEED = 18;

/** Boost speed when shift is held. */
const JETSKI_BOOST_SPEED = 24;

/**
 * Per-frame drag multiplier. Lower value = more momentum / drift.
 * Applied as speed *= drag^(dt*60) to stay frame-rate-independent.
 */
const JETSKI_DRAG = 0.92;

/** Turn rate in radians per second. */
const JETSKI_TURN_RATE = 2.4;

/** Water surface Y coordinate. Jetskis are clamped here. */
const WATER_Y = 63.0;

/** Seconds after the first finisher before the race closes. */
const FINISH_COUNTDOWN_SECONDS = 30;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface JetskiPlayerData {
  currentCheckpoint: number;       // 0-based, -1 = at start
  finished: boolean;
  finishTime: number | null;       // ms since match start
  finishPosition: number | null;   // 1st, 2nd, 3rd...
  jetskiColorId: string;           // cosmetic colour key
  jetskiEntity: Entity | null;
  /** Current yaw in radians for steering. */
  yaw: number;
  /** Current forward velocity magnitude (provides momentum/drift). */
  forwardSpeed: number;
  /** Whether input is frozen (pre-race or post-finish). */
  frozen: boolean;
}

interface JetskiLeaderboardEntry {
  playerId: string;
  playerName: string;
  checkpoint: number;
  finished: boolean;
  position: number | null;
}

// ---------------------------------------------------------------------------
// JetskiEntityController
// ---------------------------------------------------------------------------

/**
 * Custom entity controller attached to each jetski Entity.
 * Every tick it reads the owning player's current input and applies
 * steering, acceleration, drag, and water-level clamping.
 */
class JetskiEntityController extends BaseEntityController {
  private getState: () => JetskiPlayerData | undefined;

  constructor(getState: () => JetskiPlayerData | undefined) {
    super();
    this.getState = getState;
  }

  override tick(entity: Entity, deltaTimeMs: number): void {
    super.tick(entity, deltaTimeMs);

    const state = this.getState();
    if (!state || state.finished || state.frozen) return;

    const dt = deltaTimeMs / 1000;
    // Read the player's live input.
    // The Player reference is not directly on the controller - we stored
    // it in JetskiPlayerData via a closure from addPlayer.
    const input = (this as any)._playerRef?.input as PlayerInput | undefined;
    if (!input) return;

    // ----- Steering -------------------------------------------------------
    let turnInput = 0;
    if (input.a) turnInput += 1;   // turn left
    if (input.d) turnInput -= 1;   // turn right
    state.yaw += turnInput * JETSKI_TURN_RATE * dt;

    // ----- Acceleration / Braking / Drift ---------------------------------
    const isBoosting = !!input.sh;
    const maxSpeed = isBoosting ? JETSKI_BOOST_SPEED : JETSKI_SPEED;

    if (input.w) {
      state.forwardSpeed = Math.min(state.forwardSpeed + maxSpeed * 2 * dt, maxSpeed);
    } else if (input.s) {
      state.forwardSpeed = Math.max(state.forwardSpeed - maxSpeed * 3 * dt, -maxSpeed * 0.3);
    } else {
      // Coast: frame-rate-independent drag for natural drift
      state.forwardSpeed *= Math.pow(JETSKI_DRAG, dt * 60);
      if (Math.abs(state.forwardSpeed) < 0.1) state.forwardSpeed = 0;
    }

    // ----- World-space velocity from yaw ----------------------------------
    // Identity orientation faces -Z, so forward = (-sinYaw, 0, -cosYaw).
    const dirX = -Math.sin(state.yaw);
    const dirZ = -Math.cos(state.yaw);

    entity.setLinearVelocity({
      x: dirX * state.forwardSpeed,
      y: 0,
      z: dirZ * state.forwardSpeed,
    });

    // Clamp Y to water surface
    const pos = entity.position;
    if (Math.abs(pos.y - WATER_Y) > 0.3) {
      entity.setPosition({ x: pos.x, y: WATER_Y, z: pos.z });
    }

    // ----- Rotation (quaternion from yaw around Y) ------------------------
    const halfYaw = state.yaw / 2;
    entity.setRotation({
      x: 0,
      y: Math.sin(halfYaw),
      z: 0,
      w: Math.cos(halfYaw),
    });
  }
}

// ---------------------------------------------------------------------------
// JetskiRaceGame
// ---------------------------------------------------------------------------

export default class JetskiRaceGame extends BaseGameMode {
  // ---- Required abstract property overrides -------------------------------
  readonly name = JETSKI_RACE_CONFIG.name;
  readonly type = GameModeType.JETSKI_RACE;
  readonly minPlayers = JETSKI_RACE_CONFIG.minPlayers;
  readonly maxPlayers = JETSKI_RACE_CONFIG.maxPlayers;
  readonly matchDuration = JETSKI_RACE_CONFIG.matchDuration;

  // ---- Config shortcut ----------------------------------------------------
  private readonly config = JETSKI_RACE_CONFIG;

  // ---- Game-specific state ------------------------------------------------
  private jetskiData: Map<string, JetskiPlayerData> = new Map();
  private checkpointEntities: Entity[] = [];
  private finishOrder = 0;
  private firstFinisherTime: number | null = null; // matchStartedAt-relative ms
  private finishCountdownTimer: ReturnType<typeof setInterval> | null = null;

  // ========================================================================
  // BaseGameMode hooks
  // ========================================================================

  protected onStart(): void {
    this.spawnCheckpointSensors();

    // Unfreeze all jetskis
    for (const [id, jd] of this.jetskiData) {
      jd.frozen = false;
    }

    this.broadcastMessage('GO! Race around the island!', '55FF55');
    this.broadcastJetskiLeaderboard();
  }

  protected onEnd(): void {
    // Stop all jetskis
    for (const jd of this.jetskiData.values()) {
      jd.frozen = true;
      jd.forwardSpeed = 0;
      if (jd.jetskiEntity?.isSpawned) {
        jd.jetskiEntity.setLinearVelocity({ x: 0, y: 0, z: 0 });
      }
    }

    // Clean up finish countdown
    if (this.finishCountdownTimer) {
      clearInterval(this.finishCountdownTimer);
      this.finishCountdownTimer = null;
    }

    // Despawn checkpoint sensors
    for (const entity of this.checkpointEntities) {
      if (entity.isSpawned) entity.despawn();
    }
    this.checkpointEntities = [];

    // Persist stats
    const pdm = PlayerDataManager.instance;
    for (const player of this.players) {
      const jd = this.jetskiData.get(player.id);
      pdm.incrementStat(player, StatType.BOAT_RACE_GAMES_PLAYED);
      if (jd) {
        pdm.incrementStat(player, StatType.BOAT_RACE_CHECKPOINTS_PASSED, jd.currentCheckpoint + 1);
      }
      if (jd?.finishPosition === 1) {
        pdm.incrementStat(player, StatType.BOAT_RACE_WINS);
      }
    }
  }

  protected onPlayerJoin(player: Player): void {
    if (!this.world) return;

    const spawnIndex = (this.players.indexOf(player)) % this.config.spawnPoints.length;
    const sp = this.config.spawnPoints[Math.max(0, spawnIndex)];

    // Resolve cosmetic jetski colour
    const jetskiColorId = this.resolveJetskiColor(player);
    const cosmeticDef = COSMETICS_CONFIG.jetskiColors.find(c => c.id === jetskiColorId)
                        ?? COSMETICS_CONFIG.jetskiColors[0];

    // Compute initial yaw: face toward the first checkpoint
    const firstCp = this.config.checkpoints[0];
    const dx = firstCp.x - sp.x;
    const dz = firstCp.z - sp.z;
    const initialYaw = Math.atan2(-dx, -dz);

    // Init jetski-specific data
    const jd: JetskiPlayerData = {
      currentCheckpoint: -1,
      finished: false,
      finishTime: null,
      finishPosition: null,
      jetskiColorId,
      jetskiEntity: null,
      yaw: initialYaw,
      forwardSpeed: 0,
      frozen: true, // frozen until race starts
    };

    this.jetskiData.set(player.id, jd);

    // Create the jetski entity with the custom controller
    const controller = new JetskiEntityController(() => this.jetskiData.get(player.id));
    // Stash a reference to the player on the controller so it can read input
    (controller as any)._playerRef = player;

    const jetskiEntity = new Entity({
      name: `jetski_${player.username}`,
      modelUri: 'models/jetski.glb',
      modelScale: 1,
      controller,
      tintColor: this.hexToRgb(cosmeticDef.color),
      rigidBodyOptions: {
        type: RigidBodyType.KINEMATIC_VELOCITY,
        colliders: [
          {
            shape: ColliderShape.BLOCK,
            halfExtents: { x: 0.6, y: 0.5, z: 1.2 },
            collisionGroups: {
              belongsTo: [CollisionGroup.ENTITY],
              collidesWith: [CollisionGroup.BLOCK, CollisionGroup.ENTITY],
            },
          },
          // Sensor collider for checkpoint detection
          {
            shape: ColliderShape.BALL,
            radius: 2,
            isSensor: true,
            collisionGroups: {
              belongsTo: [CollisionGroup.ENTITY_SENSOR],
              collidesWith: [CollisionGroup.ENTITY_SENSOR],
            },
          },
        ],
      },
    });

    jetskiEntity.spawn(this.world, { x: sp.x, y: WATER_Y, z: sp.z });
    jd.jetskiEntity = jetskiEntity;

    // Set initial rotation
    const halfYaw = initialYaw / 2;
    jetskiEntity.setRotation({
      x: 0,
      y: Math.sin(halfYaw),
      z: 0,
      w: Math.cos(halfYaw),
    });

    // Create a PlayerEntity parented to the jetski so the player has
    // a camera anchor and rides along with the vehicle automatically.
    const playerEntity = new PlayerEntity({
      player,
      name: player.username,
      modelUri: 'models/players/player.gltf',
      modelScale: 0.5,
      parent: jetskiEntity,
    });

    playerEntity.spawn(this.world, { x: sp.x, y: WATER_Y + 0.8, z: sp.z });

    // Store the PlayerEntity in the BaseGameMode player map
    const gp = this.gamePlayers.get(player.id);
    if (gp) gp.playerEntity = playerEntity;

    // Attach camera to the jetski for a third-person chase view
    player.camera.setAttachedToEntity(jetskiEntity);

    this.sendJetskiUI(player);
  }

  protected onPlayerLeave(player: Player): void {
    const jd = this.jetskiData.get(player.id);

    // Despawn jetski
    if (jd?.jetskiEntity?.isSpawned) {
      jd.jetskiEntity.despawn();
    }

    // Despawn player entity
    const gp = this.gamePlayers.get(player.id);
    if (gp?.playerEntity?.isSpawned) {
      gp.playerEntity.despawn();
    }

    this.jetskiData.delete(player.id);
    this.broadcastJetskiLeaderboard();

    if (this.isRunning && this.players.length === 0) {
      this.forceEnd();
    }
  }

  protected onTick(tickDeltaMs: number): void {
    // Broadcast the finish countdown to unfinished players if it is active
    if (this.firstFinisherTime !== null) {
      const elapsedSinceFirst = this.getElapsedTime() * 1000 - this.firstFinisherTime;
      const remaining = Math.max(0, FINISH_COUNTDOWN_SECONDS * 1000 - elapsedSinceFirst);

      if (remaining > 0) {
        for (const player of this.players) {
          const jd = this.jetskiData.get(player.id);
          if (jd && !jd.finished) {
            player.ui.sendData({
              type: 'jetskiFinishCountdown',
              remaining: Math.ceil(remaining / 1000),
            });
          }
        }
      }
    }

    // Periodic leaderboard update
    this.broadcastJetskiLeaderboard();
  }

  // ========================================================================
  // Reward overrides
  // ========================================================================

  protected calculateRewards(): Map<string, number> {
    const rewards = new Map<string, number>();

    for (const player of this.players) {
      const jd = this.jetskiData.get(player.id);
      const checkpoints = jd ? jd.currentCheckpoint + 1 : 0;
      let coins = checkpoints * REWARDS_CONFIG.jetskiRacePerCheckpoint;

      if (jd?.finishPosition === 1) {
        coins += REWARDS_CONFIG.jetskiRaceWinnerReward;
      } else if (jd?.finishPosition === 2) {
        coins *= REWARDS_CONFIG.jetskiRaceSecondPlace;
      } else if (jd?.finishPosition === 3) {
        coins *= REWARDS_CONFIG.jetskiRaceThirdPlace;
      }

      rewards.set(player.id, coins);
    }

    return rewards;
  }

  protected getWinnerReward(): number {
    return REWARDS_CONFIG.jetskiRaceWinnerReward;
  }

  protected getParticipationReward(): number {
    return this.config.checkpoints.length * REWARDS_CONFIG.jetskiRacePerCheckpoint;
  }

  // ========================================================================
  // Checkpoint system
  // ========================================================================

  private spawnCheckpointSensors(): void {
    if (!this.world) return;

    for (let i = 0; i < this.config.checkpoints.length; i++) {
      const cp = this.config.checkpoints[i];
      const checkpointIndex = i;

      const sensorEntity = new Entity({
        name: `jetski_cp_${i}`,
        modelUri: 'models/environment/checkpoint_marker.gltf',
        modelScale: 0.01,
        opacity: 0,
        tag: `jetski_checkpoint_${i}`,
        rigidBodyOptions: {
          type: RigidBodyType.FIXED,
          colliders: [
            {
              shape: ColliderShape.BALL,
              radius: 5,
              isSensor: true,
              collisionGroups: {
                belongsTo: [CollisionGroup.ENTITY_SENSOR],
                collidesWith: [CollisionGroup.ENTITY_SENSOR, CollisionGroup.ENTITY],
              },
            },
          ],
        },
      });

      // Listen for jetski collisions on this sensor
      sensorEntity.on(EntityEvent.ENTITY_COLLISION, (payload) => {
        if (!payload.started) return;
        this.onSensorCollision(payload.otherEntity, checkpointIndex);
      });

      sensorEntity.spawn(this.world, { x: cp.x, y: WATER_Y, z: cp.z });
      this.checkpointEntities.push(sensorEntity);
    }
  }

  private onSensorCollision(otherEntity: Entity, checkpointIndex: number): void {
    // Find which player's jetski was hit
    for (const player of this.players) {
      const jd = this.jetskiData.get(player.id);
      if (jd?.jetskiEntity && otherEntity === jd.jetskiEntity) {
        this.onPlayerHitCheckpoint(player, jd, checkpointIndex);
        break;
      }
    }
  }

  private onPlayerHitCheckpoint(
    player: Player,
    jd: JetskiPlayerData,
    checkpointIndex: number,
  ): void {
    if (jd.finished) return;

    // Sequential progression only
    if (checkpointIndex !== jd.currentCheckpoint + 1) return;

    jd.currentCheckpoint = checkpointIndex;

    // Update BaseGameMode score (checkpoint count)
    this.addScore(player.id, 1);

    // Personal notification
    UIManager.instance.showNotification(
      player,
      `Checkpoint ${checkpointIndex + 1}/${this.config.checkpoints.length}`,
      '#55FFFF',
      1500,
    );

    // Milestone announcements
    if (this.config.checkpointMilestones.includes(checkpointIndex)) {
      this.broadcastMessage(
        `${player.username} reached checkpoint ${checkpointIndex + 1}/${this.config.checkpoints.length}!`,
        '55FFFF',
      );
    }

    // Check for finish
    if (checkpointIndex === this.config.checkpoints.length - 1) {
      this.onPlayerFinished(player, jd);
    }

    this.broadcastJetskiLeaderboard();
  }

  private onPlayerFinished(player: Player, jd: JetskiPlayerData): void {
    this.finishOrder++;
    jd.finished = true;
    jd.finishTime = this.getElapsedTime() * 1000;
    jd.finishPosition = this.finishOrder;
    jd.forwardSpeed = 0;
    jd.frozen = true;

    // Stop the jetski
    if (jd.jetskiEntity?.isSpawned) {
      jd.jetskiEntity.setLinearVelocity({ x: 0, y: 0, z: 0 });
    }

    const elapsedSec = (jd.finishTime / 1000).toFixed(1);
    const ordinal = this.ordinal(this.finishOrder);

    this.broadcastMessage(
      `${player.username} finished ${ordinal} in ${elapsedSec}s!`,
      'FFD700',
    );

    // First finisher starts the 30-second countdown
    if (this.finishOrder === 1) {
      this.firstFinisherTime = jd.finishTime;

      const allFinished = this.allPlayersFinished();
      if (allFinished) {
        // Everyone done, end soon
        setTimeout(() => this.forceEnd(), 3000);
        return;
      }

      this.broadcastMessage(
        `${player.username} finished first! ${FINISH_COUNTDOWN_SECONDS} seconds remaining!`,
        'FFFF55',
      );

      // Schedule force-end after countdown
      const timer = setTimeout(() => {
        this.broadcastMessage('Finish countdown expired! Race complete.', 'FFD700');
        this.forceEnd();
      }, FINISH_COUNTDOWN_SECONDS * 1000);
      this.timers.push(timer as any);
    } else {
      // Check if all remaining players have finished
      if (this.allPlayersFinished()) {
        setTimeout(() => this.forceEnd(), 3000);
      }
    }
  }

  private allPlayersFinished(): boolean {
    for (const player of this.players) {
      const jd = this.jetskiData.get(player.id);
      if (jd && !jd.finished) return false;
    }
    return true;
  }

  // ========================================================================
  // Leaderboard UI
  // ========================================================================

  private buildJetskiLeaderboard(): JetskiLeaderboardEntry[] {
    const entries: JetskiLeaderboardEntry[] = [];

    for (const player of this.players) {
      const jd = this.jetskiData.get(player.id);
      entries.push({
        playerId: player.id,
        playerName: player.username,
        checkpoint: jd ? jd.currentCheckpoint + 1 : 0,
        finished: jd?.finished ?? false,
        position: jd?.finishPosition ?? null,
      });
    }

    // Finished players sorted by position, then unfinished by checkpoint desc
    entries.sort((a, b) => {
      if (a.finished && !b.finished) return -1;
      if (!a.finished && b.finished) return 1;
      if (a.finished && b.finished) {
        return (a.position ?? 99) - (b.position ?? 99);
      }
      return b.checkpoint - a.checkpoint;
    });

    return entries;
  }

  private broadcastJetskiLeaderboard(): void {
    const leaderboard = this.buildJetskiLeaderboard();
    const data = {
      type: 'jetskiLeaderboard',
      leaderboard,
      totalCheckpoints: this.config.checkpoints.length,
    };

    UIManager.instance.broadcastData(this.players, data);
  }

  private sendJetskiUI(player: Player): void {
    const jd = this.jetskiData.get(player.id);

    player.ui.sendData({
      type: 'jetskiState',
      gameMode: GameModeType.JETSKI_RACE,
      checkpoint: jd ? jd.currentCheckpoint + 1 : 0,
      totalCheckpoints: this.config.checkpoints.length,
      finished: jd?.finished ?? false,
      finishPosition: jd?.finishPosition ?? null,
      jetskiColor: jd?.jetskiColorId ?? 'red',
      leaderboard: this.buildJetskiLeaderboard(),
      isRunning: this.isRunning,
    });
  }

  // ========================================================================
  // Cosmetics
  // ========================================================================

  /**
   * Resolve the player's equipped jetski colour from their persisted data.
   * Falls back to the default (red) if nothing is found.
   */
  private resolveJetskiColor(player: Player): string {
    const pdm = PlayerDataManager.instance;
    const data = pdm.getPlayerData(player);
    if (data?.cosmetics?.equippedJetskiColor) {
      const valid = COSMETICS_CONFIG.jetskiColors.find(
        c => c.id === data.cosmetics.equippedJetskiColor,
      );
      if (valid) return valid.id;
    }
    const defaultColor = COSMETICS_CONFIG.jetskiColors.find(c => c.isDefault);
    return defaultColor ? defaultColor.id : 'red';
  }

  // ========================================================================
  // Utilities
  // ========================================================================

  /**
   * Convert a hex colour string (#RRGGBB or RRGGBB) to the RgbColor
   * object expected by the Hytopia SDK.
   */
  private hexToRgb(hex: string): { r: number; g: number; b: number } {
    const cleaned = hex.replace('#', '');
    return {
      r: parseInt(cleaned.substring(0, 2), 16),
      g: parseInt(cleaned.substring(2, 4), 16),
      b: parseInt(cleaned.substring(4, 6), 16),
    };
  }

  private ordinal(n: number): string {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
}
