/**
 * FootballGame - Soccer game mode for Athlete Domains
 *
 * Features:
 * - Ball physics with sphere collider and dynamic rigid body
 * - Red / Blue team system with 1v1, 2v2, 3v3 variants
 * - Goal detection via sensor colliders on each goal hitbox
 * - First-to-3-goals or most goals after 5 minutes
 * - Post-goal reset with 5-second countdown
 * - Score, timer, and team UI updates via player.ui.sendData()
 */

import {
  Entity,
  PlayerEntity,
  DefaultPlayerEntity,
  EntityEvent,
  PlayerEvent,
  RigidBodyType,
  ColliderShape,
  CollisionGroup,
  SceneUI,
} from 'hytopia';
import type {
  Player,
  World,
  Vector3Like,
} from 'hytopia';

import { FOOTBALL_CONFIG, GameModeType } from '../core/GameConfig';
import { BaseGameMode, GameModeState } from '../core/BaseGameMode';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TeamId = 'red' | 'blue';

interface TeamData {
  id: TeamId;
  name: string;
  color: string;
  score: number;
  players: Set<string>; // player IDs
}

type FootballVariant = '1v1' | '2v2' | '3v3';

interface FootballPlayerData {
  playerId: string;
  player: Player;
  playerEntity: PlayerEntity | null;
  team: TeamId;
  spawnIndex: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const KICK_DISTANCE = 3.0;          // Max distance from ball to kick
const KICK_IMPULSE_STRENGTH = 12.0; // Base impulse magnitude
const KICK_UPWARD_FACTOR = 0.25;    // Upward component when kicking
const KICK_COOLDOWN_MS = 350;       // Cooldown between kicks per player

const BALL_RADIUS = 0.5;
const BALL_LINEAR_DAMPING = 0.8;    // Drag / air resistance
const BALL_ANGULAR_DAMPING = 1.0;   // Rotational drag
const BALL_BOUNCINESS = 0.6;        // Bounce coefficient
const BALL_FRICTION = 0.4;          // Surface friction
const BALL_MASS = 1.0;
const BALL_GRAVITY_SCALE = 1.5;     // Slightly heavier feel

const GOAL_RESET_DELAY_MS = 2000;   // Pause before 5s countdown after goal
const POST_GOAL_COUNTDOWN = 5;      // Seconds of countdown after goal reset

const TICK_RATE_MS = 50;            // UI update cadence (every 50ms)

// ---------------------------------------------------------------------------
// FootballGame
// ---------------------------------------------------------------------------

export class FootballGame extends BaseGameMode {
  // ---- Abstract property implementations (from BaseGameMode) ----
  readonly name: string;
  readonly type: GameModeType;
  readonly minPlayers: number;
  readonly maxPlayers: number;
  readonly matchDuration: number;

  // ------ Teams ------
  private teams: Map<TeamId, TeamData> = new Map();

  // ------ Players ------
  private footballPlayers: Map<string, FootballPlayerData> = new Map();
  private kickCooldowns: Map<string, number> = new Map(); // player id -> last kick timestamp

  // ------ Ball ------
  private ballEntity: Entity | null = null;

  // ------ Goals ------
  private goalSensors: Entity[] = [];

  // ------ Match state ------
  private variant: FootballVariant = '1v1';
  private matchTimerMs: number = 0;
  private uiTickAccumulator: number = 0;
  private isResetting: boolean = false; // true during post-goal reset sequence
  private countdownRemaining: number = 0;
  private countdownIntervalId: ReturnType<typeof setInterval> | null = null;

  // ------ Score SceneUI (floating above ball) ------
  private scoreSceneUI: SceneUI | null = null;

  constructor(variant: FootballVariant = '1v1') {
    super();

    this.variant = variant;

    // Assign abstract readonly properties (allowed in constructor)
    this.name = `Football ${variant}`;
    this.type = this.resolveGameModeType(variant);
    this.minPlayers = FOOTBALL_CONFIG.variants[variant].minPlayers;
    this.maxPlayers = FOOTBALL_CONFIG.variants[variant].minPlayers; // exact team fill
    this.matchDuration = FOOTBALL_CONFIG.matchDuration;

    // Initialize teams
    this.teams.set('red', {
      id: 'red',
      name: 'Red',
      color: FOOTBALL_CONFIG.teamColors.red,
      score: 0,
      players: new Set(),
    });
    this.teams.set('blue', {
      id: 'blue',
      name: 'Blue',
      color: FOOTBALL_CONFIG.teamColors.blue,
      score: 0,
      players: new Set(),
    });
  }

  // ========================================================================
  // Abstract implementations
  // ========================================================================

  /**
   * Called when the match starts. Sets up ball, goal sensors, and begins timer.
   */
  protected onStart(): void {
    this.matchTimerMs = this.matchDuration * 1000;
    this.isResetting = false;

    this.spawnBall(this.world!);
    this.spawnGoalSensors(this.world!);
    this.assignTeams();
    this.teleportPlayersToSpawns(this.world!);
    this.broadcastUI();
  }

  /**
   * Called when the match ends. Cleans up entities.
   */
  protected onEnd(): void {
    this.cleanupBall();
    this.cleanupGoalSensors();
    this.clearCountdownInterval();

    // Announce winner
    const redScore = this.teams.get('red')!.score;
    const blueScore = this.teams.get('blue')!.score;
    let winnerTeam: TeamId | null = null;

    if (redScore > blueScore) winnerTeam = 'red';
    else if (blueScore > redScore) winnerTeam = 'blue';

    this.broadcastToAll({
      type: 'FOOTBALL_MATCH_END',
      payload: {
        winner: winnerTeam,
        redScore,
        blueScore,
        isDraw: winnerTeam === null,
      },
    });

    // Clean up all football player tracking
    this.footballPlayers.clear();
    this.kickCooldowns.clear();
    this.teams.get('red')!.players.clear();
    this.teams.get('red')!.score = 0;
    this.teams.get('blue')!.players.clear();
    this.teams.get('blue')!.score = 0;
  }

  /**
   * Called when a player joins the match. Assigns them to a team and spawns
   * their PlayerEntity.
   */
  protected onPlayerJoin(player: Player): void {
    // Pick team with fewer players
    const red = this.teams.get('red')!;
    const blue = this.teams.get('blue')!;
    const team: TeamId = red.players.size <= blue.players.size ? 'red' : 'blue';
    const teamData = this.teams.get(team)!;
    teamData.players.add(player.id);

    // Determine spawn index based on team and player count
    const spawnIndex = this.getSpawnIndex(team, teamData.players.size - 1);

    const playerEntity = new DefaultPlayerEntity({
      player,
      name: player.username,
    });

    const spawnPos = this.getSpawnPosition(spawnIndex);
    playerEntity.spawn(this.world!, spawnPos);

    // Store player data
    const fpData: FootballPlayerData = {
      playerId: player.id,
      player,
      playerEntity,
      team,
      spawnIndex,
    };
    this.footballPlayers.set(player.id, fpData);

    // Listen for INTERACT events on the world level for this player
    // (Player clicks are emitted as PlayerEvent.INTERACT)
    this.setupPlayerInteraction(player);

    // Send initial data
    this.sendUIToPlayer(player);

    this.broadcastToAll({
      type: 'FOOTBALL_PLAYER_JOINED',
      payload: {
        playerId: player.id,
        username: player.username,
        team,
      },
    });
  }

  /**
   * Called when a player leaves the match.
   */
  protected onPlayerLeave(player: Player): void {
    const fpData = this.footballPlayers.get(player.id);
    if (fpData) {
      // Remove from team
      const teamData = this.teams.get(fpData.team);
      if (teamData) {
        teamData.players.delete(player.id);
      }

      // Despawn player entity
      if (fpData.playerEntity && fpData.playerEntity.isSpawned) {
        fpData.playerEntity.despawn();
      }

      this.footballPlayers.delete(player.id);
    }

    this.scores.delete(player.id);
    this.kickCooldowns.delete(player.id);

    this.broadcastToAll({
      type: 'FOOTBALL_PLAYER_LEFT',
      payload: {
        playerId: player.id,
      },
    });
  }

  /**
   * Called every world tick. Updates match timer and UI.
   */
  protected onTick(tickDeltaMs: number): void {
    if (this.state !== GameModeState.ACTIVE) return;
    if (this.isResetting) return;

    // Decrement match timer
    this.matchTimerMs -= tickDeltaMs;

    if (this.matchTimerMs <= 0) {
      this.matchTimerMs = 0;
      this.forceEnd();
      return;
    }

    // Throttle UI updates
    this.uiTickAccumulator += tickDeltaMs;
    if (this.uiTickAccumulator >= TICK_RATE_MS) {
      this.uiTickAccumulator = 0;
      this.broadcastUI();
    }
  }

  // ========================================================================
  // Ball
  // ========================================================================

  /**
   * Create the ball entity with a dynamic rigid body and sphere collider.
   */
  private spawnBall(world: World): void {
    this.ballEntity = new Entity({
      name: 'Football',
      blockTextureUri: 'textures/football.png',
      blockHalfExtents: { x: BALL_RADIUS, y: BALL_RADIUS, z: BALL_RADIUS },
      rigidBodyOptions: {
        type: RigidBodyType.DYNAMIC,
        linearDamping: BALL_LINEAR_DAMPING,
        angularDamping: BALL_ANGULAR_DAMPING,
        gravityScale: BALL_GRAVITY_SCALE,
        ccdEnabled: true,
        enabledRotations: { x: true, y: true, z: true },
        colliders: [
          {
            shape: ColliderShape.BALL,
            radius: BALL_RADIUS,
            bounciness: BALL_BOUNCINESS,
            friction: BALL_FRICTION,
            mass: BALL_MASS,
            collisionGroups: {
              belongsTo: [CollisionGroup.ENTITY],
              collidesWith: [CollisionGroup.ALL],
            },
          },
        ],
      },
    });

    // Register entity collision events for goal detection
    this.ballEntity.on(EntityEvent.ENTITY_COLLISION, ({ entity, otherEntity, started }) => {
      if (started) {
        this.onBallEntityCollision(otherEntity);
      }
    });

    this.ballEntity.spawn(world, { ...FOOTBALL_CONFIG.ballSpawn });

    // Create a SceneUI above the ball showing the score
    this.scoreSceneUI = new SceneUI({
      templateId: 'football-score',
      attachedToEntity: this.ballEntity,
      offset: { x: 0, y: 1.5, z: 0 },
      viewDistance: 60,
      state: {
        redScore: 0,
        blueScore: 0,
      },
    });
    this.scoreSceneUI.load(world);
  }

  /**
   * Reset ball to center with zero velocity.
   */
  private resetBall(): void {
    if (!this.ballEntity || !this.ballEntity.isSpawned) return;

    this.ballEntity.setPosition({ ...FOOTBALL_CONFIG.ballSpawn });
    this.ballEntity.setLinearVelocity({ x: 0, y: 0, z: 0 });
    this.ballEntity.setAngularVelocity({ x: 0, y: 0, z: 0 });
  }

  /**
   * Remove ball entity from world.
   */
  private cleanupBall(): void {
    if (this.scoreSceneUI) {
      this.scoreSceneUI.unload();
      this.scoreSceneUI = null;
    }
    if (this.ballEntity && this.ballEntity.isSpawned) {
      this.ballEntity.despawn();
    }
    this.ballEntity = null;
  }

  // ========================================================================
  // Goal sensors
  // ========================================================================

  /**
   * Create invisible sensor entities for each goal hitbox.
   * When the ball overlaps a sensor, a goal is scored.
   */
  private spawnGoalSensors(world: World): void {
    FOOTBALL_CONFIG.goalHitboxes.forEach((hitbox, index) => {
      // Compute center and half extents from min/max
      const center: Vector3Like = {
        x: (hitbox.min.x + hitbox.max.x) / 2,
        y: (hitbox.min.y + hitbox.max.y) / 2,
        z: (hitbox.min.z + hitbox.max.z) / 2,
      };

      const halfExtents: Vector3Like = {
        x: (hitbox.max.x - hitbox.min.x) / 2,
        y: (hitbox.max.y - hitbox.min.y) / 2,
        z: (hitbox.max.z - hitbox.min.z) / 2,
      };

      // Goal index 0 = right goal (scoring for blue team means red scores when ball enters)
      // Goal index 1 = left goal
      // Right goal (positive X) is defended by blue -> ball entering = red scores
      // Left goal (negative X) is defended by red -> ball entering = blue scores
      const goalTag = index === 0 ? 'goal-right' : 'goal-left';

      const goalSensor = new Entity({
        name: `GoalSensor-${goalTag}`,
        blockTextureUri: 'textures/transparent.png',
        blockHalfExtents: halfExtents,
        rigidBodyOptions: {
          type: RigidBodyType.FIXED,
          colliders: [
            {
              shape: ColliderShape.BLOCK,
              halfExtents,
              isSensor: true,
              collisionGroups: {
                belongsTo: [CollisionGroup.ENTITY_SENSOR],
                collidesWith: [CollisionGroup.ENTITY],
              },
            },
          ],
        },
        tag: goalTag,
        opacity: 0,
      });

      // Enable collision events so ENTITY_COLLISION fires
      goalSensor.on(EntityEvent.ENTITY_COLLISION, ({ entity, otherEntity, started }) => {
        if (started && otherEntity === this.ballEntity) {
          this.onGoalScored(goalTag);
        }
      });

      goalSensor.spawn(world, center);
      this.goalSensors.push(goalSensor);
    });
  }

  /**
   * Remove all goal sensor entities.
   */
  private cleanupGoalSensors(): void {
    for (const sensor of this.goalSensors) {
      if (sensor.isSpawned) {
        sensor.despawn();
      }
    }
    this.goalSensors = [];
  }

  // ========================================================================
  // Goal scoring
  // ========================================================================

  /**
   * Handle when the ball enters a goal sensor.
   */
  private onGoalScored(goalTag: string): void {
    if (this.state !== GameModeState.ACTIVE) return;
    if (this.isResetting) return;

    this.isResetting = true;

    // Determine scoring team:
    // goal-right (positive X side) is defended by blue -> red scores
    // goal-left (negative X side) is defended by red -> blue scores
    const scoringTeam: TeamId = goalTag === 'goal-right' ? 'red' : 'blue';
    const teamData = this.teams.get(scoringTeam)!;
    teamData.score += 1;

    // Update score scene UI
    if (this.scoreSceneUI) {
      this.scoreSceneUI.setState({
        redScore: this.teams.get('red')!.score,
        blueScore: this.teams.get('blue')!.score,
      });
    }

    // Notify all players of the goal
    this.broadcastToAll({
      type: 'FOOTBALL_GOAL',
      payload: {
        scoringTeam,
        redScore: this.teams.get('red')!.score,
        blueScore: this.teams.get('blue')!.score,
      },
    });

    // Check win condition
    if (teamData.score >= FOOTBALL_CONFIG.goalsToWin) {
      // Team has reached the goals-to-win threshold
      setTimeout(() => {
        this.forceEnd();
      }, GOAL_RESET_DELAY_MS);
      return;
    }

    // Reset after delay, then countdown
    setTimeout(() => {
      this.resetAfterGoal();
    }, GOAL_RESET_DELAY_MS);
  }

  /**
   * After a goal: reset ball, teleport players, and run countdown.
   */
  private resetAfterGoal(): void {
    if (!this.world) return;

    this.resetBall();
    this.teleportPlayersToSpawns(this.world);

    // Start post-goal countdown
    this.countdownRemaining = POST_GOAL_COUNTDOWN;
    this.broadcastToAll({
      type: 'FOOTBALL_COUNTDOWN',
      payload: { seconds: this.countdownRemaining },
    });

    this.clearCountdownInterval();
    this.countdownIntervalId = setInterval(() => {
      this.countdownRemaining -= 1;

      if (this.countdownRemaining <= 0) {
        this.clearCountdownInterval();
        this.isResetting = false;

        this.broadcastToAll({
          type: 'FOOTBALL_RESUME',
          payload: {},
        });
        this.broadcastUI();
      } else {
        this.broadcastToAll({
          type: 'FOOTBALL_COUNTDOWN',
          payload: { seconds: this.countdownRemaining },
        });
      }
    }, 1000);
  }

  /**
   * Called when the ball entity collides with another entity.
   * Used as a fallback for goal detection if the ball collides
   * with a goal sensor entity directly.
   */
  private onBallEntityCollision(otherEntity: Entity): void {
    if (this.state !== GameModeState.ACTIVE) return;
    if (this.isResetting) return;

    // Check if the other entity is one of the goal sensors
    for (const sensor of this.goalSensors) {
      if (otherEntity === sensor && sensor.tag) {
        this.onGoalScored(sensor.tag);
        return;
      }
    }
  }

  // ========================================================================
  // Player interaction (kicking)
  // ========================================================================

  /**
   * Set up the listener for player clicks (PlayerEvent.INTERACT).
   * When a player clicks, if they are close enough to the ball, kick it.
   */
  private setupPlayerInteraction(player: Player): void {
    player.on(PlayerEvent.INTERACT, ({ player: interactingPlayer }) => {
      this.handlePlayerKick(interactingPlayer);
    });
  }

  /**
   * Handle a player attempting to kick the ball.
   */
  private handlePlayerKick(player: Player): void {
    if (this.state !== GameModeState.ACTIVE) return;
    if (this.isResetting) return;
    if (!this.ballEntity || !this.ballEntity.isSpawned) return;

    const fpData = this.footballPlayers.get(player.id);
    if (!fpData || !fpData.playerEntity || !fpData.playerEntity.isSpawned) return;

    // Check cooldown
    const now = Date.now();
    const lastKick = this.kickCooldowns.get(player.id) ?? 0;
    if (now - lastKick < KICK_COOLDOWN_MS) return;

    // Check distance to ball
    const playerPos = fpData.playerEntity.position;
    const ballPos = this.ballEntity.position;

    const dx = ballPos.x - playerPos.x;
    const dy = ballPos.y - playerPos.y;
    const dz = ballPos.z - playerPos.z;
    const distSq = dx * dx + dy * dy + dz * dz;

    if (distSq > KICK_DISTANCE * KICK_DISTANCE) return;

    // Get facing direction from player camera orientation
    const facingDir = player.camera.facingDirection;

    // Normalize the facing direction (should already be normalized, but ensure)
    const len = Math.sqrt(
      facingDir.x * facingDir.x +
      facingDir.y * facingDir.y +
      facingDir.z * facingDir.z
    );

    const nx = len > 0 ? facingDir.x / len : 0;
    const ny = len > 0 ? facingDir.y / len : 0;
    const nz = len > 0 ? facingDir.z / len : 0;

    // Compute impulse: primarily horizontal in facing direction, with upward component
    const impulse: Vector3Like = {
      x: nx * KICK_IMPULSE_STRENGTH,
      y: Math.max(ny, KICK_UPWARD_FACTOR) * KICK_IMPULSE_STRENGTH * 0.5,
      z: nz * KICK_IMPULSE_STRENGTH,
    };

    this.ballEntity.applyImpulse(impulse);

    // Set cooldown
    this.kickCooldowns.set(player.id, now);

    // Notify the kicker's UI (optional kick feedback)
    player.ui.sendData({
      type: 'FOOTBALL_KICK',
      payload: {
        playerId: player.id,
      },
    });
  }

  // ========================================================================
  // Team assignment
  // ========================================================================

  /**
   * Assign players to teams based on join order. First half = red, second half = blue.
   * This is called at match start for players already in the lobby.
   */
  private assignTeams(): void {
    const playerList = this.players;
    const halfSize = Math.ceil(playerList.length / 2);

    playerList.forEach((player, index) => {
      const team: TeamId = index < halfSize ? 'red' : 'blue';
      const teamData = this.teams.get(team)!;
      teamData.players.add(player.id);

      const existingData = this.footballPlayers.get(player.id);
      if (existingData) {
        existingData.team = team;
        existingData.spawnIndex = this.getSpawnIndex(team, index < halfSize ? index : index - halfSize);
      }
    });
  }

  // ========================================================================
  // Spawns
  // ========================================================================

  /**
   * Get the spawn index for a player given their team and position within the team.
   */
  private getSpawnIndex(team: TeamId, teamPlayerIndex: number): number {
    const variantConfig = FOOTBALL_CONFIG.variants[this.variant];
    const spawnPoints = variantConfig.spawnPoints;
    const playersPerTeam = spawnPoints.length / 2;

    // Red team uses first half of spawn points, blue team uses second half
    const offset = team === 'red' ? 0 : playersPerTeam;
    return offset + (teamPlayerIndex % playersPerTeam);
  }

  /**
   * Get the spawn position for a given spawn index.
   */
  private getSpawnPosition(spawnIndex: number): Vector3Like {
    const variantConfig = FOOTBALL_CONFIG.variants[this.variant];
    const spawnPoints = variantConfig.spawnPoints;

    if (spawnIndex >= 0 && spawnIndex < spawnPoints.length) {
      return { ...spawnPoints[spawnIndex] };
    }

    // Fallback to ball spawn with offset
    return {
      x: FOOTBALL_CONFIG.ballSpawn.x + (spawnIndex % 2 === 0 ? -5 : 5),
      y: FOOTBALL_CONFIG.ballSpawn.y,
      z: FOOTBALL_CONFIG.ballSpawn.z,
    };
  }

  /**
   * Teleport all players to their respective spawn positions.
   */
  private teleportPlayersToSpawns(world: World): void {
    for (const [playerId, fpData] of this.footballPlayers) {
      if (fpData.playerEntity && fpData.playerEntity.isSpawned) {
        const spawnPos = this.getSpawnPosition(fpData.spawnIndex);
        fpData.playerEntity.setPosition(spawnPos);
        fpData.playerEntity.setLinearVelocity({ x: 0, y: 0, z: 0 });
      }
    }
  }

  // ========================================================================
  // UI
  // ========================================================================

  /**
   * Broadcast the current match state to all players.
   */
  private broadcastUI(): void {
    const uiData = this.buildUIData();

    for (const [playerId, fpData] of this.footballPlayers) {
      fpData.player.ui.sendData(uiData);
    }
  }

  /**
   * Send UI data to a single player.
   */
  private sendUIToPlayer(player: Player): void {
    player.ui.sendData(this.buildUIData());

    // Also send team assignment
    const fpData = this.footballPlayers.get(player.id);
    if (fpData) {
      player.ui.sendData({
        type: 'FOOTBALL_TEAM_ASSIGNMENT',
        payload: {
          team: fpData.team,
          teamColor: this.teams.get(fpData.team)!.color,
          teamName: this.teams.get(fpData.team)!.name,
        },
      });
    }
  }

  /**
   * Build the UI state object sent to clients.
   */
  private buildUIData(): Record<string, unknown> {
    const redTeam = this.teams.get('red')!;
    const blueTeam = this.teams.get('blue')!;

    const timerSeconds = Math.ceil(this.matchTimerMs / 1000);
    const minutes = Math.floor(timerSeconds / 60);
    const seconds = timerSeconds % 60;
    const timerFormatted = `${minutes}:${seconds.toString().padStart(2, '0')}`;

    // Build team rosters
    const redPlayers: string[] = [];
    const bluePlayers: string[] = [];

    for (const [playerId, fpData] of this.footballPlayers) {
      if (fpData.team === 'red') {
        redPlayers.push(fpData.player.username);
      } else {
        bluePlayers.push(fpData.player.username);
      }
    }

    return {
      type: 'FOOTBALL_UI_UPDATE',
      payload: {
        state: this.state,
        variant: this.variant,
        timer: timerFormatted,
        timerMs: this.matchTimerMs,
        goalsToWin: FOOTBALL_CONFIG.goalsToWin,
        redTeam: {
          name: redTeam.name,
          color: redTeam.color,
          score: redTeam.score,
          players: redPlayers,
        },
        blueTeam: {
          name: blueTeam.name,
          color: blueTeam.color,
          score: blueTeam.score,
          players: bluePlayers,
        },
        isResetting: this.isResetting,
        countdownRemaining: this.countdownRemaining,
      },
    };
  }

  /**
   * Send an arbitrary data payload to all football players.
   */
  private broadcastToAll(data: Record<string, unknown>): void {
    for (const [playerId, fpData] of this.footballPlayers) {
      fpData.player.ui.sendData(data);
    }
  }

  // ========================================================================
  // Utility
  // ========================================================================

  /**
   * Map the variant string to the appropriate GameModeType enum value.
   */
  private resolveGameModeType(variant: FootballVariant): GameModeType {
    switch (variant) {
      case '2v2': return GameModeType.FOOTBALL_2V2;
      case '3v3': return GameModeType.FOOTBALL_3V3;
      default:    return GameModeType.FOOTBALL;
    }
  }

  /**
   * Clear the post-goal countdown interval if active.
   */
  private clearCountdownInterval(): void {
    if (this.countdownIntervalId !== null) {
      clearInterval(this.countdownIntervalId);
      this.countdownIntervalId = null;
    }
  }
}
