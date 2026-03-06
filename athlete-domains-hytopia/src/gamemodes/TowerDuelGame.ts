/**
 * TowerDuelGame - 2v2 Team Battle game mode for Athlete Domains
 *
 * Features:
 * - Two teams (Blue and Red), each with 2 players in distinct roles
 * - Knight: melee fighter with sword, 20 HP, deals 4 damage per hit
 * - Tower: stationary archer with bow, 10 HP, arrows deal 3 damage
 * - Arrows are physics-based projectile entities with slight gravity
 * - Floating health bars above players via SceneUI
 * - Win condition: kill the enemy knight
 * - Best of 3 rounds with role swap after round 1
 * - 5-minute time limit per round
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

import { TOWER_DUEL_CONFIG, GameModeType } from '../core/GameConfig';
import { BaseGameMode } from '../core/BaseGameMode';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TeamId = 'blue' | 'red';
type RoleId = 'knight' | 'tower';

interface TowerDuelPlayerData {
  playerId: string;
  player: Player;
  playerEntity: PlayerEntity | null;
  team: TeamId;
  role: RoleId;
  hp: number;
  maxHp: number;
  healthBarUI: SceneUI | null;
  isDead: boolean;
}

interface TeamData {
  id: TeamId;
  name: string;
  color: string;
  roundWins: number;
  playerIds: string[]; // ordered: index 0 = initial knight, index 1 = initial tower
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MELEE_RANGE = 4.0;                 // Max distance for knight melee attack
const MELEE_COOLDOWN_MS = 500;           // Cooldown between melee hits
const ARROW_SPEED = 40.0;               // Arrow travel speed (blocks/second)
const ARROW_GRAVITY_SCALE = 0.15;        // Slight gravity on arrows
const ARROW_LIFETIME_MS = 5000;          // Arrow despawns after this time
const ARROW_COOLDOWN_MS = 800;           // Cooldown between arrow shots
const ARROW_COLLIDER_RADIUS = 0.15;      // Arrow hitbox radius
const ROUND_TIME_LIMIT_MS = 300_000;     // 5 minutes per round
const ROUND_START_DELAY_MS = 3000;       // Delay before round begins
const ROUND_END_DELAY_MS = 3000;         // Delay after round ends before next
const HEALTH_BAR_OFFSET_Y = 2.2;        // Height above player for health bar
const UI_TICK_INTERVAL_MS = 100;         // How often to send UI updates

// Tower offset from team spawn: towers are pushed back from the arena center
const TOWER_OFFSET_X_BLUE = -8;          // Blue tower further negative X
const TOWER_OFFSET_X_RED = 8;            // Red tower further positive X

// ---------------------------------------------------------------------------
// TowerDuelGame
// ---------------------------------------------------------------------------

export class TowerDuelGame extends BaseGameMode {
  // ---- Abstract property implementations ----
  readonly name = TOWER_DUEL_CONFIG.name;
  readonly type = GameModeType.TOWER_DUEL;
  readonly minPlayers = 4;
  readonly maxPlayers = 4;
  readonly matchDuration = TOWER_DUEL_CONFIG.matchDuration;

  // ------ Teams ------
  private teams: Map<TeamId, TeamData> = new Map();

  // ------ Players ------
  private tdPlayers: Map<string, TowerDuelPlayerData> = new Map();
  private meleeCooldowns: Map<string, number> = new Map();
  private arrowCooldowns: Map<string, number> = new Map();

  // ------ Arrow tracking ------
  private activeArrows: Map<Entity, { shooterId: string; spawnTime: number }> = new Map();

  // ------ Match state ------
  // NOTE: `this.world` is inherited from BaseGameMode (set by initialize())
  private currentRound: number = 0;       // 1-based round number
  private roundTimerMs: number = 0;
  private roundActive: boolean = false;
  private matchOver: boolean = false;
  private uiTickAccumulator: number = 0;

  // ------ Listeners to clean up ------
  private playerInteractListeners: Map<string, (payload: any) => void> = new Map();

  constructor() {
    super();

    // Initialize teams
    this.teams.set('blue', {
      id: 'blue',
      name: TOWER_DUEL_CONFIG.teams.blue.name,
      color: TOWER_DUEL_CONFIG.teams.blue.color,
      roundWins: 0,
      playerIds: [],
    });
    this.teams.set('red', {
      id: 'red',
      name: TOWER_DUEL_CONFIG.teams.red.name,
      color: TOWER_DUEL_CONFIG.teams.red.color,
      roundWins: 0,
      playerIds: [],
    });
  }

  // ========================================================================
  // BaseGameMode abstract implementations
  // ========================================================================

  protected onStart(): void {
    this.matchOver = false;
    this.currentRound = 0;

    this.assignTeams();
    this.startNextRound();
  }

  protected onEnd(): void {
    this.roundActive = false;
    this.matchOver = true;

    // Determine overall winner
    const blue = this.teams.get('blue')!;
    const red = this.teams.get('red')!;
    let winner: TeamId | null = null;
    if (blue.roundWins > red.roundWins) winner = 'blue';
    else if (red.roundWins > blue.roundWins) winner = 'red';

    this.broadcastToAll({
      type: 'TOWER_DUEL_MATCH_END',
      payload: {
        winner,
        blueWins: blue.roundWins,
        redWins: red.roundWins,
        isDraw: winner === null,
      },
    });

    // Cleanup all entities and UI
    this.cleanupAllArrows();
    this.cleanupAllPlayers();

    // Reset state
    this.tdPlayers.clear();
    this.meleeCooldowns.clear();
    this.arrowCooldowns.clear();
    this.playerInteractListeners.clear();
    this.teams.get('blue')!.roundWins = 0;
    this.teams.get('blue')!.playerIds = [];
    this.teams.get('red')!.roundWins = 0;
    this.teams.get('red')!.playerIds = [];
  }

  protected onPlayerJoin(player: Player): void {
    // Base class addPlayer() already adds to this.players array.

    // Team assignment happens in assignTeams() at match start.
    // If a player joins mid-match (reconnect), find their existing data.
    const existing = this.tdPlayers.get(player.id);
    if (existing) {
      existing.player = player;
      // Re-setup interaction
      this.setupPlayerInteraction(player);
      this.sendUIToPlayer(player);
    }
  }

  protected onPlayerLeave(player: Player): void {
    const data = this.tdPlayers.get(player.id);
    if (data) {
      // Despawn their entity
      this.despawnPlayerEntity(data);
      this.tdPlayers.delete(player.id);

      // Remove interact listener
      const listener = this.playerInteractListeners.get(player.id);
      if (listener) {
        player.off(PlayerEvent.INTERACT, listener);
        this.playerInteractListeners.delete(player.id);
      }
    }

    // Base class removePlayer() already removes from this.players array.

    // If a player leaves during an active round, their team forfeits the round
    if (this.roundActive && data) {
      const enemyTeam: TeamId = data.team === 'blue' ? 'red' : 'blue';
      this.onRoundWon(enemyTeam, 'forfeit');
    }
  }

  protected onTick(tickDeltaMs: number): void {
    if (!this.roundActive || this.matchOver) return;

    // Update round timer
    this.roundTimerMs -= tickDeltaMs;
    if (this.roundTimerMs <= 0) {
      this.roundTimerMs = 0;
      this.onRoundTimeout();
      return;
    }

    // Process arrow physics and lifetime
    this.tickArrows(tickDeltaMs);

    // Throttle UI updates
    this.uiTickAccumulator += tickDeltaMs;
    if (this.uiTickAccumulator >= UI_TICK_INTERVAL_MS) {
      this.uiTickAccumulator = 0;
      this.broadcastMatchUI();
    }
  }

  // ========================================================================
  // Team Assignment
  // ========================================================================

  /**
   * Assign the 4 players into two teams of 2.
   * First two players -> Blue, next two -> Red.
   */
  private assignTeams(): void {
    const playerList = Array.from(this.players);
    const blue = this.teams.get('blue')!;
    const red = this.teams.get('red')!;

    blue.playerIds = [];
    red.playerIds = [];

    for (let i = 0; i < playerList.length; i++) {
      const player = playerList[i];
      const team: TeamId = i < 2 ? 'blue' : 'red';
      const teamData = this.teams.get(team)!;
      teamData.playerIds.push(player.id);
    }
  }

  // ========================================================================
  // Round Management
  // ========================================================================

  /**
   * Start the next round. Handles role assignment and role swapping.
   */
  private startNextRound(): void {
    if (!this.world || this.matchOver) return;

    this.currentRound += 1;
    this.roundTimerMs = ROUND_TIME_LIMIT_MS;
    this.roundActive = false;

    // Cleanup previous round entities
    this.cleanupAllArrows();
    this.cleanupAllPlayers();

    // Assign roles for this round.
    // Round 1: playerIds[0] = knight, playerIds[1] = tower
    // Round 2+: swap roles from previous assignment
    for (const [teamId, teamData] of this.teams) {
      for (let i = 0; i < teamData.playerIds.length; i++) {
        const playerId = teamData.playerIds[i];
        const player = this.players.find(p => p.id === playerId);
        if (!player) continue;

        let role: RoleId;
        if (this.currentRound === 1) {
          // Initial assignment: index 0 = knight, index 1 = tower
          role = i === 0 ? 'knight' : 'tower';
        } else {
          // Swap from previous round
          const prevData = this.tdPlayers.get(playerId);
          role = prevData?.role === 'knight' ? 'tower' : 'knight';
        }

        const maxHp = role === 'knight'
          ? TOWER_DUEL_CONFIG.knightHealth
          : TOWER_DUEL_CONFIG.towerHealth;

        const tdData: TowerDuelPlayerData = {
          playerId,
          player,
          playerEntity: null,
          team: teamId,
          role,
          hp: maxHp,
          maxHp,
          healthBarUI: null,
          isDead: false,
        };

        this.tdPlayers.set(playerId, tdData);
      }
    }

    // Spawn all player entities
    for (const [playerId, data] of this.tdPlayers) {
      this.spawnPlayerForRound(data);
    }

    // Setup interactions for all players
    for (const [playerId, data] of this.tdPlayers) {
      this.setupPlayerInteraction(data.player);
    }

    // Broadcast round start info
    this.broadcastToAll({
      type: 'TOWER_DUEL_ROUND_START',
      payload: {
        round: this.currentRound,
        bestOf: TOWER_DUEL_CONFIG.bestOf,
        blueWins: this.teams.get('blue')!.roundWins,
        redWins: this.teams.get('red')!.roundWins,
      },
    });

    // Short delay before round goes active
    if (this.world) {
      this.world.chatManager.sendBroadcastMessage(
        `Round ${this.currentRound} starting in 3 seconds...`,
        'FFAA00',
      );
    }

    setTimeout(() => {
      if (this.matchOver) return;
      this.roundActive = true;

      if (this.world) {
        this.world.chatManager.sendBroadcastMessage('FIGHT!', 'FF5555');
      }

      this.broadcastMatchUI();
    }, ROUND_START_DELAY_MS);
  }

  /**
   * Spawn a player entity at their team/role-appropriate position.
   */
  private spawnPlayerForRound(data: TowerDuelPlayerData): void {
    if (!this.world) return;

    const spawnPos = this.getSpawnPosition(data.team, data.role);

    const playerEntity = new DefaultPlayerEntity({
      player: data.player,
      name: `${data.player.username} [${data.role.toUpperCase()}]`,
    });

    playerEntity.spawn(this.world, spawnPos);

    data.playerEntity = playerEntity;
    data.isDead = false;
    data.hp = data.maxHp;

    // Create floating health bar SceneUI
    const healthBarUI = new SceneUI({
      templateId: 'tower-duel-health-bar',
      attachedToEntity: playerEntity,
      offset: { x: 0, y: HEALTH_BAR_OFFSET_Y, z: 0 },
      viewDistance: 40,
      state: {
        hp: data.hp,
        maxHp: data.maxHp,
        role: data.role,
        team: data.team,
        teamColor: this.teams.get(data.team)!.color,
        playerName: data.player.username,
      },
    });

    healthBarUI.load(this.world);
    data.healthBarUI = healthBarUI;

    // If role is tower, lock the player in place (disable movement input)
    if (data.role === 'tower') {
      playerEntity.setTickWithPlayerInputEnabled(false);
    }
  }

  /**
   * Get spawn position for a team and role.
   * Knights spawn at the team's base spawn. Towers spawn offset further back.
   */
  private getSpawnPosition(team: TeamId, role: RoleId): Vector3Like {
    const teamConfig = team === 'blue'
      ? TOWER_DUEL_CONFIG.teams.blue
      : TOWER_DUEL_CONFIG.teams.red;

    // Knight uses spawnPoints[0], Tower uses spawnPoints[1]
    const baseSpawn = role === 'knight'
      ? { ...teamConfig.spawnPoints[0] }
      : { ...teamConfig.spawnPoints[1] };

    // Offset tower further back from arena center
    if (role === 'tower') {
      baseSpawn.x += team === 'blue' ? TOWER_OFFSET_X_BLUE : TOWER_OFFSET_X_RED;
      // Elevate tower slightly so they are on a raised platform
      baseSpawn.y += 3;
    }

    return baseSpawn;
  }

  /**
   * Handle round timeout (timer expired). The team whose knight has more
   * HP remaining wins. If tied, it is a draw for this round (no winner).
   */
  private onRoundTimeout(): void {
    if (!this.roundActive) return;
    this.roundActive = false;

    // Compare knight HP
    let blueKnightHp = 0;
    let redKnightHp = 0;

    for (const [, data] of this.tdPlayers) {
      if (data.role === 'knight' && !data.isDead) {
        if (data.team === 'blue') blueKnightHp = data.hp;
        else redKnightHp = data.hp;
      }
    }

    if (blueKnightHp > redKnightHp) {
      this.onRoundWon('blue', 'timeout');
    } else if (redKnightHp > blueKnightHp) {
      this.onRoundWon('red', 'timeout');
    } else {
      // Draw round - no winner awarded
      this.broadcastToAll({
        type: 'TOWER_DUEL_ROUND_DRAW',
        payload: {
          round: this.currentRound,
        },
      });

      // Proceed to next round or end match
      this.checkMatchEnd();
    }
  }

  /**
   * Called when a team wins a round.
   */
  private onRoundWon(winningTeam: TeamId, reason: 'kill' | 'timeout' | 'forfeit'): void {
    if (this.matchOver) return;
    this.roundActive = false;

    const teamData = this.teams.get(winningTeam)!;
    teamData.roundWins += 1;

    if (this.world) {
      this.world.chatManager.sendBroadcastMessage(
        `${teamData.name} Team wins Round ${this.currentRound}! (${reason})`,
        winningTeam === 'blue' ? '5555FF' : 'FF5555',
      );
    }

    this.broadcastToAll({
      type: 'TOWER_DUEL_ROUND_END',
      payload: {
        round: this.currentRound,
        winner: winningTeam,
        reason,
        blueWins: this.teams.get('blue')!.roundWins,
        redWins: this.teams.get('red')!.roundWins,
      },
    });

    this.checkMatchEnd();
  }

  /**
   * Check if the match should end (best of 3 = first to 2 wins).
   */
  private checkMatchEnd(): void {
    const blue = this.teams.get('blue')!;
    const red = this.teams.get('red')!;
    const winsNeeded = Math.ceil(TOWER_DUEL_CONFIG.bestOf / 2);

    if (blue.roundWins >= winsNeeded || red.roundWins >= winsNeeded) {
      // Match over
      setTimeout(() => {
        this.forceEnd();
      }, ROUND_END_DELAY_MS);
    } else if (this.currentRound >= TOWER_DUEL_CONFIG.bestOf) {
      // All rounds played - decide by total wins
      setTimeout(() => {
        this.forceEnd();
      }, ROUND_END_DELAY_MS);
    } else {
      // Start next round after delay
      setTimeout(() => {
        this.startNextRound();
      }, ROUND_END_DELAY_MS);
    }
  }

  // ========================================================================
  // Combat: Player Interaction
  // ========================================================================

  /**
   * Set up the INTERACT listener for a player.
   * Knights perform melee attacks; towers shoot arrows.
   */
  private setupPlayerInteraction(player: Player): void {
    // Remove any existing listener first
    const existingListener = this.playerInteractListeners.get(player.id);
    if (existingListener) {
      player.off(PlayerEvent.INTERACT, existingListener);
    }

    const listener = (payload: {
      player: Player;
      interactOrigin: Vector3Like;
      interactDirection: Vector3Like;
    }) => {
      if (!this.roundActive || this.matchOver) return;

      const data = this.tdPlayers.get(payload.player.id);
      if (!data || data.isDead) return;

      if (data.role === 'knight') {
        this.handleMeleeAttack(data, payload.interactOrigin, payload.interactDirection);
      } else {
        this.handleArrowShot(data, payload.interactOrigin, payload.interactDirection);
      }
    };

    player.on(PlayerEvent.INTERACT, listener);
    this.playerInteractListeners.set(player.id, listener);
  }

  // ========================================================================
  // Combat: Melee (Knight)
  // ========================================================================

  /**
   * Handle a knight attempting a melee attack.
   * Uses distance check to the enemy knight.
   */
  private handleMeleeAttack(
    attacker: TowerDuelPlayerData,
    interactOrigin: Vector3Like,
    interactDirection: Vector3Like,
  ): void {
    if (!this.world) return;

    // Check cooldown
    const now = Date.now();
    const lastMelee = this.meleeCooldowns.get(attacker.playerId) ?? 0;
    if (now - lastMelee < MELEE_COOLDOWN_MS) return;

    if (!attacker.playerEntity || !attacker.playerEntity.isSpawned) return;

    // Find enemy knight
    const enemyKnight = this.getEnemyKnight(attacker.team);
    if (!enemyKnight || enemyKnight.isDead) return;
    if (!enemyKnight.playerEntity || !enemyKnight.playerEntity.isSpawned) return;

    // Distance check between attacker and enemy knight
    const attackerPos = attacker.playerEntity.position;
    const enemyPos = enemyKnight.playerEntity.position;

    const dx = enemyPos.x - attackerPos.x;
    const dy = enemyPos.y - attackerPos.y;
    const dz = enemyPos.z - attackerPos.z;
    const distSq = dx * dx + dy * dy + dz * dz;

    if (distSq > MELEE_RANGE * MELEE_RANGE) return;

    // Direction check: the enemy should be roughly in front of the attacker
    const dist = Math.sqrt(distSq);
    if (dist < 0.01) return;

    const toEnemyX = dx / dist;
    const toEnemyY = dy / dist;
    const toEnemyZ = dz / dist;

    // Dot product with interact direction (camera facing)
    const dirLen = Math.sqrt(
      interactDirection.x * interactDirection.x +
      interactDirection.y * interactDirection.y +
      interactDirection.z * interactDirection.z,
    );

    if (dirLen < 0.01) return;

    const ndx = interactDirection.x / dirLen;
    const ndy = interactDirection.y / dirLen;
    const ndz = interactDirection.z / dirLen;

    const dot = toEnemyX * ndx + toEnemyY * ndy + toEnemyZ * ndz;

    // Require the enemy to be at least roughly in front (dot > 0 means same hemisphere)
    if (dot < 0.2) return;

    // Apply damage
    this.meleeCooldowns.set(attacker.playerId, now);
    this.applyDamage(enemyKnight, TOWER_DUEL_CONFIG.knightDamage, attacker);

    // Notify UI of melee hit
    attacker.player.ui.sendData({
      type: 'TOWER_DUEL_MELEE_HIT',
      payload: {
        targetId: enemyKnight.playerId,
        damage: TOWER_DUEL_CONFIG.knightDamage,
      },
    });
  }

  // ========================================================================
  // Combat: Arrow (Tower)
  // ========================================================================

  /**
   * Handle a tower shooting an arrow projectile.
   */
  private handleArrowShot(
    shooter: TowerDuelPlayerData,
    interactOrigin: Vector3Like,
    interactDirection: Vector3Like,
  ): void {
    if (!this.world) return;

    // Check cooldown
    const now = Date.now();
    const lastShot = this.arrowCooldowns.get(shooter.playerId) ?? 0;
    if (now - lastShot < ARROW_COOLDOWN_MS) return;

    if (!shooter.playerEntity || !shooter.playerEntity.isSpawned) return;

    this.arrowCooldowns.set(shooter.playerId, now);

    // Normalize direction
    const dirLen = Math.sqrt(
      interactDirection.x * interactDirection.x +
      interactDirection.y * interactDirection.y +
      interactDirection.z * interactDirection.z,
    );

    if (dirLen < 0.01) return;

    const ndx = interactDirection.x / dirLen;
    const ndy = interactDirection.y / dirLen;
    const ndz = interactDirection.z / dirLen;

    // Spawn arrow entity slightly in front of the shooter
    const shooterPos = shooter.playerEntity.position;
    const spawnPos: Vector3Like = {
      x: shooterPos.x + ndx * 1.5,
      y: shooterPos.y + 1.5 + ndy * 1.5,
      z: shooterPos.z + ndz * 1.5,
    };

    const arrowVelocity: Vector3Like = {
      x: ndx * ARROW_SPEED,
      y: ndy * ARROW_SPEED,
      z: ndz * ARROW_SPEED,
    };

    const arrowEntity = new Entity({
      name: 'Arrow',
      modelUri: 'models/projectiles/arrow.gltf',
      modelScale: 0.3,
      rigidBodyOptions: {
        type: RigidBodyType.DYNAMIC,
        linearVelocity: arrowVelocity,
        gravityScale: ARROW_GRAVITY_SCALE,
        ccdEnabled: true,
        linearDamping: 0,
        angularDamping: 10,
        colliders: [
          {
            shape: ColliderShape.BALL,
            radius: ARROW_COLLIDER_RADIUS,
            isSensor: true,
            collisionGroups: {
              belongsTo: [CollisionGroup.ENTITY_SENSOR],
              collidesWith: [CollisionGroup.PLAYER, CollisionGroup.BLOCK, CollisionGroup.ENTITY],
            },
          },
        ],
      },
      tag: `arrow-${shooter.playerId}`,
    });

    // Listen for collisions on the arrow (sensor)
    arrowEntity.on(EntityEvent.ENTITY_COLLISION, ({ entity, otherEntity, started }) => {
      if (!started) return;
      this.onArrowCollision(arrowEntity, otherEntity);
    });

    // Also listen for block collisions so arrow despawns on terrain hit
    arrowEntity.on(EntityEvent.BLOCK_COLLISION, ({ entity, started }) => {
      if (!started) return;
      this.despawnArrow(arrowEntity);
    });

    arrowEntity.spawn(this.world!, spawnPos);

    // Track the arrow
    this.activeArrows.set(arrowEntity, {
      shooterId: shooter.playerId,
      spawnTime: now,
    });
  }

  /**
   * Handle arrow colliding with an entity.
   */
  private onArrowCollision(arrowEntity: Entity, hitEntity: Entity): void {
    const arrowData = this.activeArrows.get(arrowEntity);
    if (!arrowData) return;

    // Find the player entity that was hit
    let hitPlayerData: TowerDuelPlayerData | undefined;

    for (const [, data] of this.tdPlayers) {
      if (data.playerEntity === hitEntity && !data.isDead) {
        hitPlayerData = data;
        break;
      }
    }

    if (!hitPlayerData) {
      // Hit something that is not a player - despawn arrow
      this.despawnArrow(arrowEntity);
      return;
    }

    // Don't damage teammates
    const shooterData = this.tdPlayers.get(arrowData.shooterId);
    if (!shooterData) {
      this.despawnArrow(arrowEntity);
      return;
    }

    if (hitPlayerData.team === shooterData.team) {
      // Friendly fire - just despawn the arrow, no damage
      this.despawnArrow(arrowEntity);
      return;
    }

    // Towers can only damage enemy knights (towers are out of melee reach but
    // could theoretically be hit by stray arrows - per spec, we allow arrow
    // damage to any enemy, but towers should be positioned safely)
    this.applyDamage(hitPlayerData, TOWER_DUEL_CONFIG.arrowDamage, shooterData);

    // Notify shooter
    shooterData.player.ui.sendData({
      type: 'TOWER_DUEL_ARROW_HIT',
      payload: {
        targetId: hitPlayerData.playerId,
        damage: TOWER_DUEL_CONFIG.arrowDamage,
      },
    });

    // Despawn the arrow on hit
    this.despawnArrow(arrowEntity);
  }

  /**
   * Tick all active arrows: despawn expired ones.
   */
  private tickArrows(_deltaMs: number): void {
    const now = Date.now();
    const toRemove: Entity[] = [];

    for (const [arrowEntity, arrowData] of this.activeArrows) {
      // Check lifetime
      if (now - arrowData.spawnTime > ARROW_LIFETIME_MS) {
        toRemove.push(arrowEntity);
        continue;
      }

      // Check if arrow fell below the world floor
      if (arrowEntity.isSpawned && arrowEntity.position.y < 50) {
        toRemove.push(arrowEntity);
      }
    }

    for (const arrow of toRemove) {
      this.despawnArrow(arrow);
    }
  }

  /**
   * Safely despawn an arrow and remove tracking.
   */
  private despawnArrow(arrowEntity: Entity): void {
    this.activeArrows.delete(arrowEntity);

    if (arrowEntity.isSpawned) {
      arrowEntity.despawn();
    }
  }

  /**
   * Clean up all active arrows.
   */
  private cleanupAllArrows(): void {
    for (const [arrowEntity] of this.activeArrows) {
      if (arrowEntity.isSpawned) {
        arrowEntity.despawn();
      }
    }
    this.activeArrows.clear();
  }

  // ========================================================================
  // Damage & Health
  // ========================================================================

  /**
   * Apply damage to a player. Updates HP, health bar, and checks for death.
   */
  private applyDamage(
    target: TowerDuelPlayerData,
    damage: number,
    attacker: TowerDuelPlayerData,
  ): void {
    if (target.isDead || !this.roundActive) return;

    target.hp = Math.max(0, target.hp - damage);

    // Update health bar SceneUI
    this.updateHealthBar(target);

    // Notify the target player
    target.player.ui.sendData({
      type: 'TOWER_DUEL_DAMAGE_TAKEN',
      payload: {
        attackerId: attacker.playerId,
        damage,
        remainingHp: target.hp,
      },
    });

    // Broadcast HP update to all
    this.broadcastToAll({
      type: 'TOWER_DUEL_HP_UPDATE',
      payload: {
        playerId: target.playerId,
        hp: target.hp,
        maxHp: target.maxHp,
        team: target.team,
        role: target.role,
      },
    });

    // Check for death
    if (target.hp <= 0) {
      this.onPlayerKilled(target, attacker);
    }
  }

  /**
   * Handle a player being killed (HP reaches 0).
   * If a knight dies, the round ends.
   */
  private onPlayerKilled(
    victim: TowerDuelPlayerData,
    killer: TowerDuelPlayerData,
  ): void {
    victim.isDead = true;

    if (this.world) {
      this.world.chatManager.sendBroadcastMessage(
        `${killer.player.username} (${killer.role}) eliminated ${victim.player.username} (${victim.role})!`,
        killer.team === 'blue' ? '5555FF' : 'FF5555',
      );
    }

    this.broadcastToAll({
      type: 'TOWER_DUEL_KILL',
      payload: {
        killerId: killer.playerId,
        killerRole: killer.role,
        victimId: victim.playerId,
        victimRole: victim.role,
      },
    });

    // If the victim is a knight, the killer's team wins the round
    if (victim.role === 'knight') {
      const winningTeam = killer.team;
      this.onRoundWon(winningTeam, 'kill');
    }
  }

  /**
   * Update a player's floating health bar SceneUI state.
   */
  private updateHealthBar(data: TowerDuelPlayerData): void {
    if (!data.healthBarUI) return;

    data.healthBarUI.setState({
      hp: data.hp,
      maxHp: data.maxHp,
      role: data.role,
      team: data.team,
      teamColor: this.teams.get(data.team)!.color,
      playerName: data.player.username,
    });
  }

  // ========================================================================
  // Helpers: Finding Enemies
  // ========================================================================

  /**
   * Get the enemy team's knight.
   */
  private getEnemyKnight(myTeam: TeamId): TowerDuelPlayerData | undefined {
    const enemyTeam: TeamId = myTeam === 'blue' ? 'red' : 'blue';

    for (const [, data] of this.tdPlayers) {
      if (data.team === enemyTeam && data.role === 'knight' && !data.isDead) {
        return data;
      }
    }

    return undefined;
  }

  // ========================================================================
  // Cleanup
  // ========================================================================

  /**
   * Despawn a player entity and unload their health bar UI.
   */
  private despawnPlayerEntity(data: TowerDuelPlayerData): void {
    if (data.healthBarUI) {
      data.healthBarUI.unload();
      data.healthBarUI = null;
    }

    if (data.playerEntity && data.playerEntity.isSpawned) {
      data.playerEntity.despawn();
    }

    data.playerEntity = null;
  }

  /**
   * Cleanup all player entities and health bars.
   */
  private cleanupAllPlayers(): void {
    for (const [, data] of this.tdPlayers) {
      this.despawnPlayerEntity(data);
    }
  }

  // ========================================================================
  // UI
  // ========================================================================

  /**
   * Broadcast the match state to all players.
   */
  private broadcastMatchUI(): void {
    const uiData = this.buildMatchUIData();
    for (const [, data] of this.tdPlayers) {
      data.player.ui.sendData(uiData);
    }
  }

  /**
   * Send current UI data to a single player.
   */
  private sendUIToPlayer(player: Player): void {
    player.ui.sendData(this.buildMatchUIData());

    const data = this.tdPlayers.get(player.id);
    if (data) {
      player.ui.sendData({
        type: 'TOWER_DUEL_ROLE_ASSIGNMENT',
        payload: {
          team: data.team,
          teamColor: this.teams.get(data.team)!.color,
          teamName: this.teams.get(data.team)!.name,
          role: data.role,
          hp: data.hp,
          maxHp: data.maxHp,
        },
      });
    }
  }

  /**
   * Build the full UI state payload.
   */
  private buildMatchUIData(): Record<string, unknown> {
    const blueTeam = this.teams.get('blue')!;
    const redTeam = this.teams.get('red')!;

    const timerSeconds = Math.ceil(this.roundTimerMs / 1000);
    const minutes = Math.floor(timerSeconds / 60);
    const seconds = timerSeconds % 60;
    const timerFormatted = `${minutes}:${seconds.toString().padStart(2, '0')}`;

    // Build player statuses
    const playerStatuses: Record<string, unknown>[] = [];
    for (const [, data] of this.tdPlayers) {
      playerStatuses.push({
        playerId: data.playerId,
        username: data.player.username,
        team: data.team,
        role: data.role,
        hp: data.hp,
        maxHp: data.maxHp,
        isDead: data.isDead,
      });
    }

    return {
      type: 'TOWER_DUEL_UI_UPDATE',
      payload: {
        round: this.currentRound,
        bestOf: TOWER_DUEL_CONFIG.bestOf,
        roundActive: this.roundActive,
        matchOver: this.matchOver,
        timer: timerFormatted,
        timerMs: this.roundTimerMs,
        blueTeam: {
          name: blueTeam.name,
          color: blueTeam.color,
          roundWins: blueTeam.roundWins,
        },
        redTeam: {
          name: redTeam.name,
          color: redTeam.color,
          roundWins: redTeam.roundWins,
        },
        players: playerStatuses,
      },
    };
  }

  /**
   * Send an arbitrary data payload to all tower duel players.
   */
  private broadcastToAll(data: Record<string, unknown>): void {
    for (const [, tdData] of this.tdPlayers) {
      tdData.player.ui.sendData(data);
    }
  }
}
