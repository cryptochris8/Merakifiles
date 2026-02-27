/**
 * Athlete Domains - Parkour Race Game Mode
 *
 * A multi-checkpoint parkour race for 1-8 players. Players race through
 * 9 checkpoints across an elevated parkour course. Falling below the
 * current checkpoint by 17 blocks triggers a teleport reset. First player
 * to reach the final checkpoint wins, or the player with the most progress
 * when the 10-minute timer expires.
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
  DefaultPlayerEntityController,
  type Vector3Like,
} from 'hytopia';

import {
  PARKOUR_RACE_CONFIG,
  GameModeType,
  REWARDS_CONFIG,
  StatType,
} from '../core/GameConfig';
import BaseGameMode, { type GameModePlayer } from '../core/BaseGameMode';
import { UIManager } from '../core/UIManager';
import { PlayerDataManager } from '../core/PlayerDataManager';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ParkourPlayerData {
  currentCheckpoint: number;       // index into config checkpoints, -1 = at start
  lastCheckpointPos: Vector3Like;  // respawn location after falling
  finished: boolean;
  finishTime: number | null;       // ms elapsed from match start when finished
}

interface ParkourLeaderboardEntry {
  playerId: string;
  playerName: string;
  checkpoint: number;
  finished: boolean;
}

// ---------------------------------------------------------------------------
// ParkourRaceGame
// ---------------------------------------------------------------------------

export default class ParkourRaceGame extends BaseGameMode {
  // ---- Required abstract property overrides -------------------------------
  readonly name = PARKOUR_RACE_CONFIG.name;
  readonly type = GameModeType.PARKOUR_RACE;
  readonly minPlayers = PARKOUR_RACE_CONFIG.minPlayers;
  readonly maxPlayers = PARKOUR_RACE_CONFIG.maxPlayers;
  readonly matchDuration = PARKOUR_RACE_CONFIG.matchDuration;

  // ---- Config shortcut ----------------------------------------------------
  private readonly config = PARKOUR_RACE_CONFIG;

  // ---- Game-specific state ------------------------------------------------
  private parkourData: Map<string, ParkourPlayerData> = new Map();
  private checkpointEntities: Entity[] = [];
  private matchWinner: string | null = null;

  // ========================================================================
  // BaseGameMode hooks
  // ========================================================================

  protected onStart(): void {
    // Spawn checkpoint sensor entities
    this.spawnCheckpointSensors();

    // Unfreeze all players (they were frozen during countdown)
    for (const gp of this.gamePlayers.values()) {
      if (gp.playerEntity) {
        (gp.playerEntity as PlayerEntity).setTickWithPlayerInputEnabled(true);
      }
    }

    this.broadcastMessage('GO! Race to the finish!', '55FF55');
    this.broadcastParkourLeaderboard();
  }

  protected onEnd(): void {
    // Freeze all players
    for (const gp of this.gamePlayers.values()) {
      if (gp.playerEntity) {
        (gp.playerEntity as PlayerEntity).setTickWithPlayerInputEnabled(false);
      }
    }

    // Despawn checkpoint sensors
    for (const entity of this.checkpointEntities) {
      if (entity.isSpawned) entity.despawn();
    }
    this.checkpointEntities = [];

    // Persist stats
    const pdm = PlayerDataManager.instance;
    for (const player of this.players) {
      const pd = this.parkourData.get(player.id);
      pdm.incrementStat(player, StatType.PARKOUR_RACE_GAMES_PLAYED);
      if (pd) {
        pdm.incrementStat(player, StatType.PARKOUR_RACE_CHECKPOINTS_PASSED, pd.currentCheckpoint + 1);
      }
      if (this.matchWinner === player.id) {
        pdm.incrementStat(player, StatType.PARKOUR_RACE_WINS);
      }
    }
  }

  protected onPlayerJoin(player: Player): void {
    if (!this.world) return;

    const spawnIndex = (this.players.indexOf(player)) % this.config.spawnPoints.length;
    const sp = this.config.spawnPoints[Math.max(0, spawnIndex)];
    const spawnPos: Vector3Like = { x: sp.x, y: sp.y, z: sp.z };

    // Create and spawn the player entity
    const playerEntity = new PlayerEntity({
      player,
      name: player.username,
      modelUri: 'models/players/player.gltf',
      modelScale: 0.5,
      controller: new DefaultPlayerEntityController(),
    });

    playerEntity.spawn(this.world, spawnPos);

    // Store entity reference in the GameModePlayer record
    const gp = this.gamePlayers.get(player.id);
    if (gp) gp.playerEntity = playerEntity;

    // Freeze input until the match is ACTIVE
    if (!this.isRunning) {
      playerEntity.setTickWithPlayerInputEnabled(false);
    }

    // Init parkour-specific state
    this.parkourData.set(player.id, {
      currentCheckpoint: -1,
      lastCheckpointPos: { ...spawnPos },
      finished: false,
      finishTime: null,
    });

    // Send initial UI
    this.sendParkourUI(player);
  }

  protected onPlayerLeave(player: Player): void {
    // Despawn their entity
    const gp = this.gamePlayers.get(player.id);
    if (gp?.playerEntity?.isSpawned) {
      gp.playerEntity.despawn();
    }

    this.parkourData.delete(player.id);
    this.broadcastParkourLeaderboard();

    // If no players remain during an active match, force end
    if (this.isRunning && this.players.length === 0) {
      this.forceEnd();
    }
  }

  protected onTick(tickDeltaMs: number): void {
    // Fall detection: check each player's Y against their last checkpoint
    for (const player of this.players) {
      const gp = this.gamePlayers.get(player.id);
      const pd = this.parkourData.get(player.id);
      if (!gp?.playerEntity || !gp.playerEntity.isSpawned || !pd || pd.finished) continue;

      const pos = gp.playerEntity.position;

      if (pos.y < pd.lastCheckpointPos.y - this.config.deathBelowCheckpoint) {
        this.resetPlayerToCheckpoint(player, gp, pd);
      }
    }

    // Periodic leaderboard update (~every 500ms rather than every tick)
    // Use a simple modulus on the match elapsed time
    const elapsed = this.getElapsedTime();
    if (Math.floor(elapsed * 2) % 1 === 0) {
      this.broadcastParkourLeaderboard();
    }
  }

  // ========================================================================
  // Reward overrides
  // ========================================================================

  protected calculateRewards(): Map<string, number> {
    const rewards = new Map<string, number>();

    for (const player of this.players) {
      const pd = this.parkourData.get(player.id);
      const checkpoints = pd ? pd.currentCheckpoint + 1 : 0;
      let coins = checkpoints * REWARDS_CONFIG.parkourRacePerCheckpoint;

      if (this.matchWinner === player.id) {
        coins *= REWARDS_CONFIG.parkourRaceWinnerMultiplier;
      }

      rewards.set(player.id, coins);
    }

    return rewards;
  }

  protected getWinnerReward(): number {
    return this.config.checkpoints.length * REWARDS_CONFIG.parkourRacePerCheckpoint * REWARDS_CONFIG.parkourRaceWinnerMultiplier;
  }

  protected getParticipationReward(): number {
    return REWARDS_CONFIG.parkourRacePerCheckpoint;
  }

  // ========================================================================
  // Checkpoint system
  // ========================================================================

  /**
   * Spawns invisible sensor entities at each checkpoint location.
   * A ball sensor collider (radius 3) detects when a player entity enters.
   */
  private spawnCheckpointSensors(): void {
    if (!this.world) return;

    for (let i = 0; i < this.config.checkpoints.length; i++) {
      const cp = this.config.checkpoints[i];
      const checkpointIndex = i;

      const sensorEntity = new Entity({
        name: `parkour_cp_${i}`,
        modelUri: 'models/environment/checkpoint_marker.gltf',
        modelScale: 0.01,
        opacity: 0,
        tag: `parkour_checkpoint_${i}`,
        rigidBodyOptions: {
          type: RigidBodyType.FIXED,
          colliders: [
            {
              shape: ColliderShape.BALL,
              radius: 3,
              isSensor: true,
              collisionGroups: {
                belongsTo: [CollisionGroup.ENTITY_SENSOR],
                collidesWith: [CollisionGroup.PLAYER, CollisionGroup.ENTITY],
              },
            },
          ],
        },
      });

      // Listen for entity collisions on the sensor
      sensorEntity.on(EntityEvent.ENTITY_COLLISION, (payload) => {
        if (!payload.started) return;
        const otherEntity = payload.otherEntity;

        // Determine which player's entity collided
        for (const player of this.players) {
          const gp = this.gamePlayers.get(player.id);
          if (gp?.playerEntity && gp.playerEntity === otherEntity) {
            this.onPlayerHitCheckpoint(player, checkpointIndex);
            break;
          }
        }
      });

      sensorEntity.spawn(this.world, { x: cp.x, y: cp.y, z: cp.z });
      this.checkpointEntities.push(sensorEntity);
    }
  }

  /**
   * Called when a player enters a checkpoint sensor zone.
   */
  private onPlayerHitCheckpoint(player: Player, checkpointIndex: number): void {
    const pd = this.parkourData.get(player.id);
    if (!pd || pd.finished) return;

    // Only allow sequential progression (must be the very next checkpoint)
    if (checkpointIndex !== pd.currentCheckpoint + 1) return;

    pd.currentCheckpoint = checkpointIndex;
    pd.lastCheckpointPos = { ...this.config.checkpoints[checkpointIndex] };

    // Update the score tracked by BaseGameMode (checkpoint count as score)
    this.addScore(player.id, 1);

    // Personal notification
    const ui = UIManager.instance;
    ui.showNotification(
      player,
      `Checkpoint ${checkpointIndex + 1}/${this.config.checkpoints.length}`,
      '#55FFFF',
      1500,
    );

    // Milestone announcements (broadcast to all players)
    if (this.config.checkpointMilestones.includes(checkpointIndex)) {
      this.broadcastMessage(
        `${player.username} reached checkpoint ${checkpointIndex + 1}/${this.config.checkpoints.length}!`,
        '55FFFF',
      );
    }

    // Check for race completion (final checkpoint)
    if (checkpointIndex === this.config.checkpoints.length - 1) {
      this.onPlayerFinished(player, pd);
    }

    this.broadcastParkourLeaderboard();
  }

  /**
   * Called when a player reaches the last checkpoint.
   */
  private onPlayerFinished(player: Player, pd: ParkourPlayerData): void {
    pd.finished = true;
    pd.finishTime = this.getElapsedTime() * 1000;

    const elapsedSec = (pd.finishTime / 1000).toFixed(1);

    this.broadcastMessage(
      `${player.username} finished the Parkour Race in ${elapsedSec}s!`,
      'FFD700',
    );

    // First finisher wins
    if (!this.matchWinner) {
      this.matchWinner = player.id;

      this.broadcastMessage(
        `${player.username} wins the Parkour Race!`,
        '55FF55',
      );

      // End the match after a short celebration window
      setTimeout(() => {
        this.forceEnd();
      }, 5000);
    }
  }

  // ========================================================================
  // Fall reset
  // ========================================================================

  private resetPlayerToCheckpoint(
    player: Player,
    gp: GameModePlayer,
    pd: ParkourPlayerData,
  ): void {
    if (!gp.playerEntity || !gp.playerEntity.isSpawned) return;

    const respawn = pd.lastCheckpointPos;

    // Teleport back and kill velocity
    gp.playerEntity.setPosition({ x: respawn.x, y: respawn.y + 1, z: respawn.z });
    gp.playerEntity.setLinearVelocity({ x: 0, y: 0, z: 0 });

    UIManager.instance.showNotification(
      player,
      'You fell! Respawning at last checkpoint...',
      '#FF5555',
      2000,
    );
  }

  // ========================================================================
  // Leaderboard UI
  // ========================================================================

  private buildParkourLeaderboard(): ParkourLeaderboardEntry[] {
    const entries: ParkourLeaderboardEntry[] = [];

    for (const player of this.players) {
      const pd = this.parkourData.get(player.id);
      entries.push({
        playerId: player.id,
        playerName: player.username,
        checkpoint: pd ? pd.currentCheckpoint + 1 : 0,
        finished: pd?.finished ?? false,
      });
    }

    // Finished players first, then by checkpoint descending
    entries.sort((a, b) => {
      if (a.finished && !b.finished) return -1;
      if (!a.finished && b.finished) return 1;
      return b.checkpoint - a.checkpoint;
    });

    return entries;
  }

  private broadcastParkourLeaderboard(): void {
    const leaderboard = this.buildParkourLeaderboard();
    const data = {
      type: 'parkourLeaderboard',
      leaderboard,
      totalCheckpoints: this.config.checkpoints.length,
    };

    const ui = UIManager.instance;
    ui.broadcastData(this.players, data);
  }

  private sendParkourUI(player: Player): void {
    const pd = this.parkourData.get(player.id);

    player.ui.sendData({
      type: 'parkourState',
      gameMode: GameModeType.PARKOUR_RACE,
      checkpoint: pd ? pd.currentCheckpoint + 1 : 0,
      totalCheckpoints: this.config.checkpoints.length,
      finished: pd?.finished ?? false,
      leaderboard: this.buildParkourLeaderboard(),
      isRunning: this.isRunning,
    });
  }
}
