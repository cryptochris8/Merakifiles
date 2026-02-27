/**
 * BaseGameMode - Abstract base class for all game modes in Athlete Domains.
 *
 * Provides the core lifecycle (state machine), player tracking, score tracking,
 * countdown timer, reward calculation, and tick loop. Concrete game modes
 * extend this class and implement the abstract hooks.
 */

import { Player, WorldLoopEvent } from 'hytopia';
import type { World, PlayerEntity } from 'hytopia';
import { GameModeType, REWARDS_CONFIG } from './GameConfig';
import { UIManager } from './UIManager';
import { PlayerDataManager } from './PlayerDataManager';

// ============================================
// Types
// ============================================

/** The lifecycle states of a game mode match. */
export enum GameModeState {
  WAITING = 'WAITING',
  COUNTDOWN = 'COUNTDOWN',
  ACTIVE = 'ACTIVE',
  ENDING = 'ENDING',
}

export interface GameModePlayer {
  player: Player;
  playerEntity?: PlayerEntity;
  score: number;
}

export interface PlayerScore {
  playerId: string;
  playerName: string;
  score: number;
}

// ============================================
// BaseGameMode
// ============================================

export abstract class BaseGameMode {
  // ---- Abstract properties (must be set by subclass constructors) ----
  abstract readonly name: string;
  abstract readonly type: GameModeType;
  abstract readonly minPlayers: number;
  abstract readonly maxPlayers: number;
  abstract readonly matchDuration: number; // seconds

  // ---- Protected state ----
  protected state: GameModeState = GameModeState.WAITING;
  protected matchId: string = '';
  protected world: World | null = null;
  protected players: Player[] = [];
  protected gamePlayers: Map<string, GameModePlayer> = new Map();
  protected scores: Map<string, PlayerScore> = new Map();
  protected timeRemainingSeconds: number = 0;
  protected countdownSeconds: number = 10;
  protected isRunning: boolean = false;
  protected matchStartedAt: number = 0;
  protected timers: ReturnType<typeof setInterval>[] = [];

  /** Tracks the last second value to detect whole-second changes within the tick loop. */
  private lastTickSecond: number = -1;

  /** Whether we are still listening to ticks (guard for cleanup). */
  private tickActive: boolean = false;

  // ---- Abstract methods (subclasses must implement) ----

  /**
   * Called when the match transitions to ACTIVE state.
   * Set up the arena, spawn entities, give items, etc.
   */
  protected abstract onStart(): void;

  /**
   * Called when the match transitions to ENDING state.
   * Clean up arena entities, apply final scoring, etc.
   */
  protected abstract onEnd(): void;

  /**
   * Called when a player joins this match instance (before or during ACTIVE).
   *
   * @param player - The player joining.
   */
  protected abstract onPlayerJoin(player: Player): void;

  /**
   * Called when a player leaves this match instance.
   *
   * @param player - The player leaving.
   */
  protected abstract onPlayerLeave(player: Player): void;

  /**
   * Called every world tick while the match is ACTIVE.
   *
   * @param tickDeltaMs - Milliseconds since the last tick.
   */
  protected abstract onTick(tickDeltaMs: number): void;

  // ---- Public API ----

  /**
   * Initializes the game mode with a match ID and world reference.
   * Called by MatchManager before players are added.
   *
   * @param matchId - The unique match identifier.
   * @param world - The world this match runs in.
   */
  initialize(matchId: string, world: World): void {
    this.matchId = matchId;
    this.world = world;
    this.state = GameModeState.WAITING;
    this.players = [];
    this.gamePlayers.clear();
    this.scores.clear();
    this.timeRemainingSeconds = this.matchDuration;
    this.lastTickSecond = -1;
    this.isRunning = false;
    this.tickActive = false;
  }

  /**
   * Adds a player to this match. Initializes their score and calls onPlayerJoin.
   *
   * @param player - The player to add.
   */
  addPlayer(player: Player): void {
    if (this.players.some(p => p.id === player.id)) return;

    this.players.push(player);

    this.gamePlayers.set(player.id, {
      player,
      score: 0,
    });

    this.scores.set(player.id, {
      playerId: player.id,
      playerName: player.username,
      score: 0,
    });

    this.onPlayerJoin(player);
  }

  /**
   * Removes a player from this match. Calls onPlayerLeave.
   *
   * @param player - The player to remove.
   */
  removePlayer(player: Player): void {
    const idx = this.players.findIndex(p => p.id === player.id);
    if (idx === -1) return;

    this.players.splice(idx, 1);
    this.gamePlayers.delete(player.id);
    this.onPlayerLeave(player);
  }

  /**
   * Begins the countdown phase. Transitions state from WAITING to COUNTDOWN
   * and starts the tick listener.
   */
  beginCountdown(): void {
    if (this.state !== GameModeState.WAITING) return;

    this.state = GameModeState.COUNTDOWN;
    this.timeRemainingSeconds = this.countdownSeconds;
    this.lastTickSecond = this.countdownSeconds;

    this.startTickListener();

    // Notify players of countdown start.
    const uiManager = UIManager.instance;
    for (const player of this.players) {
      uiManager.updateTimer(player, this.timeRemainingSeconds, this.state);
      uiManager.showNotification(player, `${this.name} starting in ${this.countdownSeconds}s!`, '#FFFF00');
    }
  }

  /**
   * Forces the match to end immediately. Used when too many players leave.
   */
  forceEnd(): void {
    if (this.state === GameModeState.ENDING) return;
    this.transitionToEnding();
  }

  /**
   * Returns the current state of the game mode.
   */
  getState(): GameModeState {
    return this.state;
  }

  /**
   * Returns an array of current scores sorted descending by score.
   */
  getScoreboard(): PlayerScore[] {
    return Array.from(this.scores.values()).sort((a, b) => b.score - a.score);
  }

  /**
   * Adds points to a player's score.
   *
   * @param playerId - The player ID to award points to.
   * @param points - The number of points to add.
   * @returns The player's new total score, or -1 if player not found.
   */
  addScore(playerId: string, points: number): number {
    const entry = this.scores.get(playerId);
    if (!entry) return -1;

    entry.score += points;

    // Also update the GameModePlayer score.
    const gp = this.gamePlayers.get(playerId);
    if (gp) {
      gp.score = entry.score;
    }

    this.broadcastScoreboard();
    return entry.score;
  }

  /**
   * Gets the score of a specific player.
   *
   * @param playerId - The player ID.
   * @returns The player's score, or 0 if not found.
   */
  getScore(playerId: string): number {
    return this.scores.get(playerId)?.score ?? 0;
  }

  /**
   * Returns the elapsed time in seconds since match start.
   */
  getElapsedTime(): number {
    return this.isRunning ? (Date.now() - this.matchStartedAt) / 1000 : 0;
  }

  /**
   * Returns the remaining time in seconds.
   */
  getRemainingTime(): number {
    return Math.max(0, this.timeRemainingSeconds);
  }

  // ---- Protected helpers ----

  /**
   * Broadcasts the current scoreboard to all players in the match.
   */
  protected broadcastScoreboard(): void {
    const uiManager = UIManager.instance;
    const entries = this.getScoreboard().map(s => ({
      playerId: s.playerId,
      playerName: s.playerName,
      score: s.score,
    }));

    for (const player of this.players) {
      uiManager.showScoreboard(player, entries, this.name);
    }
  }

  /**
   * Broadcasts the timer to all players.
   */
  protected broadcastTimer(): void {
    const uiManager = UIManager.instance;
    for (const player of this.players) {
      uiManager.updateTimer(player, this.timeRemainingSeconds, this.state);
    }
  }

  /**
   * Sends a broadcast message to all players through the world chat.
   *
   * @param message - The message to send.
   * @param color - Optional hex color code (without #).
   */
  protected broadcastMessage(message: string, color?: string): void {
    if (this.world) {
      this.world.chatManager.sendBroadcastMessage(message, color);
    }
  }

  /**
   * Sends a message to a specific player through the world chat.
   *
   * @param player - The player to message.
   * @param message - The message to send.
   * @param color - Optional hex color code (without #).
   */
  protected sendPlayerMessage(player: Player, message: string, color?: string): void {
    if (this.world) {
      this.world.chatManager.sendPlayerMessage(player, message, color);
    }
  }

  /**
   * Clears all setInterval timers created by the game mode.
   */
  protected clearAllTimers(): void {
    for (const timer of this.timers) {
      clearInterval(timer);
    }
    this.timers = [];
  }

  /**
   * Calculates rewards for all players at match end.
   * Override in subclasses for custom reward logic.
   *
   * @returns A map of player ID to coins earned.
   */
  protected calculateRewards(): Map<string, number> {
    const rewards = new Map<string, number>();
    const scoreboard = this.getScoreboard();

    for (let i = 0; i < scoreboard.length; i++) {
      const entry = scoreboard[i];
      let coins = 0;

      // Base reward: winner gets more than losers.
      if (i === 0) {
        coins = this.getWinnerReward();
      } else {
        coins = this.getParticipationReward();
      }

      rewards.set(entry.playerId, coins);
    }

    return rewards;
  }

  /**
   * Returns the coin reward for the winner. Override per game mode.
   */
  protected getWinnerReward(): number {
    return REWARDS_CONFIG.duelPerMinute * Math.max(1, Math.floor(this.matchDuration / 60));
  }

  /**
   * Returns the coin reward for non-winner participants. Override per game mode.
   */
  protected getParticipationReward(): number {
    return Math.floor(this.getWinnerReward() * 0.2);
  }

  // ---- Private lifecycle ----

  /**
   * Subscribes to the world tick loop.
   */
  private startTickListener(): void {
    if (!this.world) return;

    this.tickActive = true;

    this.world.loop.on(WorldLoopEvent.TICK_START, (payload: { worldLoop: any; tickDeltaMs: number }) => {
      if (!this.tickActive) return;
      this.handleTick(payload.tickDeltaMs);
    });
  }

  /**
   * Stops the tick listener.
   */
  private stopTickListener(): void {
    this.tickActive = false;
  }

  /**
   * Master tick handler. Routes to the appropriate phase logic.
   *
   * @param tickDeltaMs - Milliseconds since the last tick.
   */
  private handleTick(tickDeltaMs: number): void {
    // If the match has ended or is waiting, stop processing.
    if (this.state === GameModeState.ENDING || this.state === GameModeState.WAITING) return;

    // Convert tick delta to seconds for the countdown timer.
    const deltaSeconds = tickDeltaMs / 1000;

    if (this.state === GameModeState.COUNTDOWN) {
      this.timeRemainingSeconds -= deltaSeconds;
      const currentSecond = Math.ceil(this.timeRemainingSeconds);

      // Broadcast timer on each whole second change.
      if (currentSecond !== this.lastTickSecond && currentSecond >= 0) {
        this.lastTickSecond = currentSecond;
        this.broadcastTimer();

        // Announce countdown milestones.
        if (currentSecond <= 5 && currentSecond > 0) {
          const uiManager = UIManager.instance;
          for (const player of this.players) {
            uiManager.showNotification(player, `${currentSecond}...`, '#FFFF00', 1000);
          }
        }
      }

      if (this.timeRemainingSeconds <= 0) {
        this.transitionToActive();
      }
    } else if (this.state === GameModeState.ACTIVE) {
      this.timeRemainingSeconds -= deltaSeconds;
      const currentSecond = Math.ceil(this.timeRemainingSeconds);

      if (currentSecond !== this.lastTickSecond && currentSecond >= 0) {
        this.lastTickSecond = currentSecond;
        this.broadcastTimer();
      }

      // Call the subclass tick.
      this.onTick(tickDeltaMs);

      // Check if time ran out.
      if (this.timeRemainingSeconds <= 0) {
        this.transitionToEnding();
      }
    }
  }

  /**
   * Transitions from COUNTDOWN to ACTIVE.
   */
  private transitionToActive(): void {
    this.state = GameModeState.ACTIVE;
    this.timeRemainingSeconds = this.matchDuration;
    this.lastTickSecond = this.matchDuration;
    this.matchStartedAt = Date.now();
    this.isRunning = true;

    const uiManager = UIManager.instance;
    for (const player of this.players) {
      uiManager.showNotification(player, `${this.name} has started!`, '#55FF55', 2000);
    }

    this.onStart();
    this.broadcastScoreboard();
    this.broadcastTimer();
  }

  /**
   * Transitions to the ENDING state. Calculates rewards, shows results, cleans up.
   */
  private transitionToEnding(): void {
    this.state = GameModeState.ENDING;
    this.isRunning = false;

    // Stop the tick listener.
    this.stopTickListener();

    // Clear any timers the subclass created.
    this.clearAllTimers();

    // Call the subclass end hook.
    this.onEnd();

    // Calculate and distribute rewards.
    const rewards = this.calculateRewards();
    const playerDataManager = PlayerDataManager.instance;
    const uiManager = UIManager.instance;
    const scoreboard = this.getScoreboard();

    const results = scoreboard.map((entry, index) => {
      const coinsEarned = rewards.get(entry.playerId) ?? 0;

      // Find the player object.
      const player = this.players.find(p => p.id === entry.playerId);
      if (player && coinsEarned > 0) {
        const newBalance = playerDataManager.addCoins(player, coinsEarned);
        uiManager.showCoinUpdate(player, newBalance, coinsEarned);
      }

      return {
        playerId: entry.playerId,
        playerName: entry.playerName,
        score: entry.score,
        placement: index + 1,
        coinsEarned,
        isWinner: index === 0,
      };
    });

    // Show results to all players.
    for (const player of this.players) {
      uiManager.showResults(player, results, this.name);
    }

    // Notify the MatchManager to handle lobby return after a delay.
    const matchId = this.matchId;
    setTimeout(async () => {
      // Use dynamic import to avoid circular dependency issues at module load.
      const { MatchManager } = await import('./MatchManager');
      MatchManager.instance.endMatch(matchId);
    }, 8000);
  }
}

export default BaseGameMode;
