/**
 * SumoGame - 1v1 Knockback Sumo game mode for Athlete Domains
 *
 * Features:
 * - 1v1 knockback combat on a circular platform (no weapons, push only)
 * - Click-to-push mechanic with directional impulse and cooldown
 * - Best of 5 rounds (first to 3 round wins takes the match)
 * - Fall detection below floor level triggers round loss
 * - Ring shrink after round 2 to increase pressure
 * - 3-second countdown between rounds
 * - Real-time score and round UI via player.ui.sendData()
 */

import {
  Entity,
  PlayerEntity,
  DefaultPlayerEntity,
  PlayerEvent,
  RigidBodyType,
  ColliderShape,
} from 'hytopia';
import type {
  Player,
  World,
  Vector3Like,
} from 'hytopia';

import { SUMO_CONFIG, GameModeType } from '../core/GameConfig';
import BaseGameMode from '../core/BaseGameMode';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SumoPlayerData {
  playerId: string;
  player: Player;
  playerEntity: PlayerEntity | null;
  spawnIndex: number;       // 0 or 1
  roundWins: number;
}

type MatchPhase =
  | 'WAITING'        // Waiting for players
  | 'COUNTDOWN'      // Between-round countdown
  | 'FIGHTING'       // Active round
  | 'ROUND_END'      // Brief pause after a round ends
  | 'MATCH_OVER';    // Match concluded

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const KNOCKBACK_RANGE = 3.0;              // Max distance (blocks) to hit another player
const KNOCKBACK_STRENGTH = 14.0;          // Horizontal impulse magnitude
const KNOCKBACK_UPWARD = 4.5;             // Upward impulse component
const KNOCKBACK_COOLDOWN_MS = 500;        // Cooldown between punches per player

const FALL_THRESHOLD = 3;                 // How far below floor level = elimination

const BETWEEN_ROUND_COUNTDOWN = 3;        // Seconds between rounds
const ROUND_END_PAUSE_MS = 1500;          // Brief pause after someone falls
const MATCH_END_DISPLAY_MS = 5000;        // How long to show match results

const RING_SHRINK_START_ROUND = 3;        // Ring starts shrinking from round 3 (after round 2)
const RING_SHRINK_INTERVAL_MS = 1000;     // Ring shrinks every second
const UI_UPDATE_INTERVAL_MS = 100;        // UI broadcast cadence

// ---------------------------------------------------------------------------
// SumoGame
// ---------------------------------------------------------------------------

export class SumoGame extends BaseGameMode {
  // ------ Abstract property implementations ------
  readonly name = SUMO_CONFIG.name;
  readonly type = GameModeType.SUMO;
  readonly minPlayers = SUMO_CONFIG.minPlayers;
  readonly maxPlayers = SUMO_CONFIG.minPlayers; // exactly 2
  readonly matchDuration = 600; // 10 min max; match ends when someone wins 3 rounds

  // ------ Player tracking ------
  private sumoPlayers: Map<string, SumoPlayerData> = new Map();
  private knockbackCooldowns: Map<string, number> = new Map();

  // ------ Match state ------
  private phase: MatchPhase = 'WAITING';
  private currentRound: number = 0;
  private countdownRemaining: number = 0;

  // ------ Ring state ------
  private currentRingRadius: number = SUMO_CONFIG.ringSize;
  private ringShrinkTimerId: ReturnType<typeof setInterval> | null = null;
  private placedBarrierCoords: Vector3Like[] = [];

  // ------ Timers ------
  private countdownTimerId: ReturnType<typeof setInterval> | null = null;
  private uiTimerId: ReturnType<typeof setInterval> | null = null;
  private roundEndTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private matchEndTimeoutId: ReturnType<typeof setTimeout> | null = null;

  // ------ Ring shrink accumulator for tick-based shrinking ------
  private ringShrinkAccumulatorMs: number = 0;
  private ringShrinkActive: boolean = false;

  constructor() {
    super();
  }

  // ========================================================================
  // BaseGameMode abstract method implementations
  // ========================================================================

  /**
   * Called when the match transitions to ACTIVE state.
   * Start the sumo match. Requires exactly 2 players already added.
   */
  protected onStart(): void {
    if (this.sumoPlayers.size < SUMO_CONFIG.minPlayers) {
      console.warn(
        `[SumoGame] Cannot start: need ${SUMO_CONFIG.minPlayers} players, ` +
        `have ${this.sumoPlayers.size}.`
      );
      return;
    }

    this.phase = 'WAITING';
    this.currentRound = 0;
    this.currentRingRadius = SUMO_CONFIG.ringSize;

    // Reset round wins
    for (const data of this.sumoPlayers.values()) {
      data.roundWins = 0;
    }

    // Start UI update timer
    this.uiTimerId = setInterval(() => {
      this.broadcastUI();
    }, UI_UPDATE_INTERVAL_MS);
    this.timers.push(this.uiTimerId);

    // Begin first round
    this.beginNextRound();
  }

  /**
   * Called when the match transitions to ENDING state.
   * Clean up all sumo-specific resources.
   */
  protected onEnd(): void {
    this.phase = 'MATCH_OVER';

    this.clearCountdownTimer();
    this.ringShrinkActive = false;

    if (this.roundEndTimeoutId !== null) {
      clearTimeout(this.roundEndTimeoutId);
      this.roundEndTimeoutId = null;
    }

    if (this.matchEndTimeoutId !== null) {
      clearTimeout(this.matchEndTimeoutId);
      this.matchEndTimeoutId = null;
    }

    // Remove placed barrier blocks
    this.removeBarrierBlocks();

    // Despawn player entities
    for (const data of this.sumoPlayers.values()) {
      if (data.playerEntity && data.playerEntity.isSpawned) {
        data.playerEntity.despawn();
      }
    }

    this.sumoPlayers.clear();
    this.knockbackCooldowns.clear();
  }

  /**
   * Called when a player joins this match instance.
   * The base class has already pushed the player into this.players and
   * set up gamePlayers / scores entries.
   */
  protected onPlayerJoin(player: Player): void {
    if (this.sumoPlayers.has(player.id)) {
      console.info(`[SumoGame] Player ${player.username} already in match.`);
      return;
    }

    if (this.sumoPlayers.size >= SUMO_CONFIG.minPlayers) {
      console.info(`[SumoGame] Match is full, cannot add ${player.username}.`);
      return;
    }

    const spawnIndex = this.sumoPlayers.size; // 0 for first, 1 for second

    // Create the player entity
    const spawnConfig = SUMO_CONFIG.spawnPoints[spawnIndex];
    const spawnPos: Vector3Like = { x: spawnConfig.x, y: spawnConfig.y, z: spawnConfig.z };

    const playerEntity = new DefaultPlayerEntity({
      player,
      name: player.username,
    });

    if (this.world) {
      playerEntity.spawn(this.world, spawnPos);
    }

    // Store sumo-specific player data
    const sumoData: SumoPlayerData = {
      playerId: player.id,
      player,
      playerEntity,
      spawnIndex,
      roundWins: 0,
    };

    this.sumoPlayers.set(player.id, sumoData);

    // Set up interact listener for knockback
    this.setupPlayerInteraction(player);

    // Send initial UI
    this.sendUIToPlayer(player);

    this.broadcastMessage(
      `${player.username} has joined the Sumo arena!`,
      '55FF55'
    );
  }

  /**
   * Called when a player leaves this match instance.
   * The base class handles removing from this.players and gamePlayers.
   */
  protected onPlayerLeave(player: Player): void {
    const data = this.sumoPlayers.get(player.id);
    if (!data) return;

    // Despawn their entity
    if (data.playerEntity && data.playerEntity.isSpawned) {
      data.playerEntity.despawn();
    }

    this.sumoPlayers.delete(player.id);
    this.knockbackCooldowns.delete(player.id);

    this.broadcastMessage(
      `${player.username} has left the Sumo arena.`,
      'FF5555'
    );

    // If a match is in progress and we're below 2 players, the remaining player wins
    if (this.isRunning && this.sumoPlayers.size < SUMO_CONFIG.minPlayers) {
      const remaining = Array.from(this.sumoPlayers.values())[0];
      if (remaining) {
        this.broadcastMessage(
          `${remaining.player.username} wins by forfeit!`,
          'FFD700'
        );
        this.announceMatchWinner(remaining);
      }
      this.forceEnd();
    }
  }

  /**
   * Called every world tick while the match is ACTIVE.
   * Handles fall detection (replaces the old setInterval-based check)
   * and ring shrink accumulation.
   */
  protected onTick(tickDeltaMs: number): void {
    // --- Fall detection (every tick while FIGHTING) ---
    if (this.phase === 'FIGHTING') {
      for (const data of this.sumoPlayers.values()) {
        if (!data.playerEntity || !data.playerEntity.isSpawned) continue;

        const pos = data.playerEntity.position;

        // Player fell below the floor level threshold
        if (pos.y < SUMO_CONFIG.floorLevel - FALL_THRESHOLD) {
          this.onPlayerFell(data);
          return; // Only one fall per tick
        }

        // Also check if player is outside the current ring radius (XZ plane)
        const ringCenter = SUMO_CONFIG.mapMiddle;
        const dx = pos.x - ringCenter.x;
        const dz = pos.z - ringCenter.z;
        const distFromCenter = Math.sqrt(dx * dx + dz * dz);

        // If player is way outside the ring horizontally and at or below floor,
        // they've effectively fallen off
        if (distFromCenter > this.currentRingRadius + 2 && pos.y <= SUMO_CONFIG.floorLevel) {
          this.onPlayerFell(data);
          return;
        }
      }
    }

    // --- Ring shrink (tick-based accumulator instead of setInterval) ---
    if (this.ringShrinkActive && this.phase === 'FIGHTING') {
      this.ringShrinkAccumulatorMs += tickDeltaMs;

      if (this.ringShrinkAccumulatorMs >= RING_SHRINK_INTERVAL_MS) {
        this.ringShrinkAccumulatorMs -= RING_SHRINK_INTERVAL_MS;

        const minRadius = SUMO_CONFIG.ringSize - SUMO_CONFIG.ringMaxReduction;
        const newRadius = this.currentRingRadius - SUMO_CONFIG.shrinkPerSecond;

        if (newRadius <= minRadius) {
          this.currentRingRadius = minRadius;
          this.ringShrinkActive = false;
        } else {
          this.currentRingRadius = newRadius;
        }

        // Place barrier blocks at the edges to visualize the shrink
        this.placeRingBarriers();
        this.broadcastUI();
      }
    }
  }

  // ========================================================================
  // Round lifecycle
  // ========================================================================

  /**
   * Begins the next round: teleport players, run countdown, then fight.
   */
  private beginNextRound(): void {
    this.currentRound += 1;
    this.phase = 'COUNTDOWN';

    // Teleport players to spawn points
    this.teleportPlayersToSpawns();

    // Reset velocities
    this.resetPlayerVelocities();

    // Check if ring should start shrinking (after round 2)
    if (this.currentRound >= RING_SHRINK_START_ROUND) {
      this.startRingShrink();
    }

    this.broadcastMessage(
      `Round ${this.currentRound} starting...`,
      'FFFF00'
    );

    // Run the between-round countdown
    this.countdownRemaining = BETWEEN_ROUND_COUNTDOWN;
    this.broadcastCountdown();

    this.clearCountdownTimer();
    this.countdownTimerId = setInterval(() => {
      this.countdownRemaining -= 1;

      if (this.countdownRemaining <= 0) {
        this.clearCountdownTimer();
        this.startFighting();
      } else {
        this.broadcastCountdown();
      }
    }, 1000);
  }

  /**
   * Transition into active fighting phase.
   */
  private startFighting(): void {
    this.phase = 'FIGHTING';

    this.broadcastMessage('FIGHT!', 'FF5555');

    // Broadcast UI immediately
    this.broadcastUI();
  }

  /**
   * Called when a player falls off the platform.
   */
  private onPlayerFell(loser: SumoPlayerData): void {
    if (this.phase !== 'FIGHTING') return;

    this.phase = 'ROUND_END';
    this.ringShrinkActive = false;

    // Determine the winner of this round
    const winner = this.getOpponent(loser);
    if (!winner) return;

    winner.roundWins += 1;

    // Update base scores via the public API
    this.addScore(winner.playerId, 1);

    this.broadcastMessage(
      `${winner.player.username} wins Round ${this.currentRound}!`,
      '55FF55'
    );

    this.broadcastUI();

    // Check if match is over (first to 3 wins)
    const winsNeeded = Math.ceil(SUMO_CONFIG.bestOf / 2);
    if (winner.roundWins >= winsNeeded) {
      // Match over
      this.roundEndTimeoutId = setTimeout(() => {
        this.roundEndTimeoutId = null;
        this.onMatchOver(winner);
      }, ROUND_END_PAUSE_MS);
    } else {
      // Proceed to next round after a brief pause
      this.roundEndTimeoutId = setTimeout(() => {
        this.roundEndTimeoutId = null;
        this.beginNextRound();
      }, ROUND_END_PAUSE_MS);
    }
  }

  /**
   * Called when a player has won the match (first to 3 round wins).
   */
  private onMatchOver(winner: SumoPlayerData): void {
    this.phase = 'MATCH_OVER';
    this.ringShrinkActive = false;

    this.announceMatchWinner(winner);

    // Allow the result to display before triggering base class end
    this.matchEndTimeoutId = setTimeout(() => {
      this.matchEndTimeoutId = null;
      this.forceEnd();
    }, MATCH_END_DISPLAY_MS);
  }

  /**
   * Announce the match winner to all players.
   */
  private announceMatchWinner(winner: SumoPlayerData): void {
    const loser = this.getOpponent(winner);
    const loserName = loser ? loser.player.username : 'opponent';

    this.broadcastMessage(
      `${winner.player.username} wins the Sumo match ` +
      `${winner.roundWins} - ${loser ? loser.roundWins : 0}!`,
      'FFD700'
    );

    // Send match-over UI data
    for (const data of this.sumoPlayers.values()) {
      data.player.ui.sendData({
        type: 'SUMO_MATCH_OVER',
        payload: {
          winnerId: winner.playerId,
          winnerName: winner.player.username,
          winnerScore: winner.roundWins,
          loserId: loser?.playerId ?? null,
          loserName,
          loserScore: loser?.roundWins ?? 0,
        },
      });
    }
  }

  // ========================================================================
  // Knockback / Player interaction
  // ========================================================================

  /**
   * Register PlayerEvent.INTERACT listener for push/knockback on click.
   */
  private setupPlayerInteraction(player: Player): void {
    player.on(PlayerEvent.INTERACT, ({ player: interactingPlayer }) => {
      this.handlePunch(interactingPlayer);
    });
  }

  /**
   * Handle a player's punch attempt. If an opponent is within range,
   * apply a knockback impulse in the direction from attacker to target.
   */
  private handlePunch(player: Player): void {
    if (this.phase !== 'FIGHTING') return;

    const attackerData = this.sumoPlayers.get(player.id);
    if (!attackerData || !attackerData.playerEntity || !attackerData.playerEntity.isSpawned) return;

    // Check cooldown
    const now = Date.now();
    const lastPunch = this.knockbackCooldowns.get(player.id) ?? 0;
    if (now - lastPunch < KNOCKBACK_COOLDOWN_MS) return;

    // Find the opponent
    const targetData = this.getOpponent(attackerData);
    if (!targetData || !targetData.playerEntity || !targetData.playerEntity.isSpawned) return;

    // Check distance between attacker and target
    const attackerPos = attackerData.playerEntity.position;
    const targetPos = targetData.playerEntity.position;

    const dx = targetPos.x - attackerPos.x;
    const dy = targetPos.y - attackerPos.y;
    const dz = targetPos.z - attackerPos.z;
    const distSq = dx * dx + dy * dy + dz * dz;

    if (distSq > KNOCKBACK_RANGE * KNOCKBACK_RANGE) return;

    // Calculate direction from attacker to target (horizontal plane primarily)
    const horizontalDist = Math.sqrt(dx * dx + dz * dz);
    let dirX: number;
    let dirZ: number;

    if (horizontalDist > 0.001) {
      dirX = dx / horizontalDist;
      dirZ = dz / horizontalDist;
    } else {
      // Players are stacked vertically; use attacker's facing direction
      const facing = player.camera.facingDirection;
      const facingLen = Math.sqrt(facing.x * facing.x + facing.z * facing.z);
      dirX = facingLen > 0 ? facing.x / facingLen : 1;
      dirZ = facingLen > 0 ? facing.z / facingLen : 0;
    }

    // Apply punchy knockback impulse to the TARGET
    const impulse: Vector3Like = {
      x: dirX * KNOCKBACK_STRENGTH,
      y: KNOCKBACK_UPWARD,
      z: dirZ * KNOCKBACK_STRENGTH,
    };

    targetData.playerEntity.applyImpulse(impulse);

    // Set cooldown
    this.knockbackCooldowns.set(player.id, now);

    // Optional: small self-recoil to make it feel more physical
    const recoil: Vector3Like = {
      x: -dirX * 1.5,
      y: 0,
      z: -dirZ * 1.5,
    };
    attackerData.playerEntity.applyImpulse(recoil);

    // Send punch feedback to both players
    player.ui.sendData({
      type: 'SUMO_PUNCH_HIT',
      payload: {
        attackerId: attackerData.playerId,
        targetId: targetData.playerId,
        direction: { x: dirX, z: dirZ },
      },
    });

    targetData.player.ui.sendData({
      type: 'SUMO_PUNCH_RECEIVED',
      payload: {
        attackerId: attackerData.playerId,
        direction: { x: dirX, z: dirZ },
      },
    });
  }

  // ========================================================================
  // Ring shrink
  // ========================================================================

  /**
   * Start the ring shrink process. Called at the beginning of rounds >= 3.
   * Uses the tick-based accumulator checked in onTick().
   */
  private startRingShrink(): void {
    this.ringShrinkActive = true;
    this.ringShrinkAccumulatorMs = 0;

    this.broadcastMessage(
      'The ring is shrinking!',
      'FF5555'
    );
  }

  /**
   * Place barrier blocks around the current ring edge.
   * Blocks are placed in a ring pattern between the current ring radius
   * and the original ring size, at the floor level.
   */
  private placeRingBarriers(): void {
    if (!this.world) return;

    const center = SUMO_CONFIG.mapMiddle;
    const outerRadius = SUMO_CONFIG.ringSize;
    const innerRadius = this.currentRingRadius;

    // Only place new barriers at the inner edge (avoid re-placing)
    // We iterate around the circumference and fill blocks between inner and outer
    for (let angle = 0; angle < 360; angle += 5) {
      const radians = (angle * Math.PI) / 180;

      for (let r = Math.floor(innerRadius); r <= outerRadius; r += 1) {
        const bx = Math.round(center.x + r * Math.cos(radians));
        const bz = Math.round(center.z + r * Math.sin(radians));
        const by = SUMO_CONFIG.floorLevel;

        const coord: Vector3Like = { x: bx, y: by, z: bz };

        // Check if this block is actually outside the current ring
        const dx = bx - center.x;
        const dz = bz - center.z;
        const distFromCenter = Math.sqrt(dx * dx + dz * dz);

        if (distFromCenter >= innerRadius) {
          // Remove the block (set to 0 = air) to create void at the edges
          try {
            this.world.chunkLattice.setBlock(coord, 0);
            this.placedBarrierCoords.push(coord);
          } catch {
            // Block might not exist, that's fine
          }
        }
      }
    }
  }

  /**
   * Remove all placed barrier blocks (restore ring for next use).
   */
  private removeBarrierBlocks(): void {
    // We don't restore blocks since we removed them to create void.
    // The map reload will handle restoration.
    this.placedBarrierCoords = [];
  }

  // ========================================================================
  // Player spawning / teleportation
  // ========================================================================

  /**
   * Teleport both players to their respective spawn points.
   */
  private teleportPlayersToSpawns(): void {
    for (const data of this.sumoPlayers.values()) {
      if (!data.playerEntity || !data.playerEntity.isSpawned) continue;

      const spawnConfig = SUMO_CONFIG.spawnPoints[data.spawnIndex];
      const spawnPos: Vector3Like = {
        x: spawnConfig.x,
        y: spawnConfig.y,
        z: spawnConfig.z,
      };

      data.playerEntity.setPosition(spawnPos);
    }
  }

  /**
   * Reset velocities on all player entities.
   */
  private resetPlayerVelocities(): void {
    for (const data of this.sumoPlayers.values()) {
      if (!data.playerEntity || !data.playerEntity.isSpawned) continue;
      data.playerEntity.setLinearVelocity({ x: 0, y: 0, z: 0 });
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

    for (const data of this.sumoPlayers.values()) {
      data.player.ui.sendData(uiData);
    }
  }

  /**
   * Send UI data to a single player.
   */
  private sendUIToPlayer(player: Player): void {
    player.ui.sendData(this.buildUIData());
  }

  /**
   * Send countdown UI to all players.
   */
  private broadcastCountdown(): void {
    for (const data of this.sumoPlayers.values()) {
      data.player.ui.sendData({
        type: 'SUMO_COUNTDOWN',
        payload: {
          seconds: this.countdownRemaining,
          round: this.currentRound,
        },
      });
    }

    this.broadcastMessage(
      `${this.countdownRemaining}...`,
      'FFFF00'
    );
  }

  /**
   * Build the UI state object sent to clients.
   */
  private buildUIData(): Record<string, unknown> {
    const playerArray = Array.from(this.sumoPlayers.values());
    const player1 = playerArray[0] ?? null;
    const player2 = playerArray[1] ?? null;

    const winsNeeded = Math.ceil(SUMO_CONFIG.bestOf / 2);

    return {
      type: 'SUMO_UI_UPDATE',
      payload: {
        gameMode: 'SUMO',
        phase: this.phase,
        currentRound: this.currentRound,
        bestOf: SUMO_CONFIG.bestOf,
        winsNeeded,
        ringRadius: this.currentRingRadius,
        maxRingRadius: SUMO_CONFIG.ringSize,
        countdownRemaining: this.countdownRemaining,
        player1: player1
          ? {
              id: player1.playerId,
              name: player1.player.username,
              roundWins: player1.roundWins,
            }
          : null,
        player2: player2
          ? {
              id: player2.playerId,
              name: player2.player.username,
              roundWins: player2.roundWins,
            }
          : null,
        // Formatted score string for HUD display
        scoreDisplay: player1 && player2
          ? `${player1.player.username} ${player1.roundWins} - ${player2.roundWins} ${player2.player.username}`
          : 'Waiting for players...',
        roundDisplay: this.currentRound > 0
          ? `Round ${this.currentRound} of ${SUMO_CONFIG.bestOf}`
          : 'Waiting...',
      },
    };
  }

  // ========================================================================
  // Timer helpers
  // ========================================================================

  /**
   * Clear the between-round countdown timer.
   */
  private clearCountdownTimer(): void {
    if (this.countdownTimerId !== null) {
      clearInterval(this.countdownTimerId);
      this.countdownTimerId = null;
    }
  }

  // ========================================================================
  // Utility
  // ========================================================================

  /**
   * Get the opponent of a given player.
   */
  private getOpponent(playerData: SumoPlayerData): SumoPlayerData | null {
    for (const data of this.sumoPlayers.values()) {
      if (data.playerId !== playerData.playerId) {
        return data;
      }
    }
    return null;
  }
}

export default SumoGame;
