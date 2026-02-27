/**
 * MatchManager - Manages game queues, matchmaking, and active match lifecycle.
 *
 * Handles player queuing for any game mode, party-aware queue joining,
 * match starting when minimum players are met (or after a timeout),
 * active match tracking, and returning players to the lobby on match end.
 */

import { Player } from 'hytopia';
import type { World } from 'hytopia';
import type { GameModeType } from './GameConfig';
import { LOBBY_CONFIG } from './GameConfig';
import type { BaseGameMode } from './BaseGameMode';

// ============================================
// Types
// ============================================

export interface QueueEntry {
  player: Player;
  partyId: string | null;
  joinedAt: number;
}

export interface ActiveMatch {
  id: string;
  gameMode: BaseGameMode;
  players: Player[];
  startedAt: number;
}

// ============================================
// MatchManager
// ============================================

export class MatchManager {
  private static _instance: MatchManager;

  /** Queues per game mode type. */
  private queues: Map<GameModeType, QueueEntry[]> = new Map();

  /** All currently active matches keyed by match ID. */
  private activeMatches: Map<string, ActiveMatch> = new Map();

  /** Registered game mode factories keyed by type. */
  private gameModeFactories: Map<GameModeType, () => BaseGameMode> = new Map();

  /** Reference to the main world for lobby operations. */
  private world: World | null = null;

  /** Queue check interval handle. */
  private queueCheckInterval: ReturnType<typeof setInterval> | null = null;

  /** Timeout (ms) before starting a match with fewer than ideal players. */
  private static readonly QUEUE_TIMEOUT_MS = 30_000;

  /** Counter for generating unique match IDs. */
  private matchIdCounter = 0;

  private constructor() {}

  /** Singleton accessor. */
  static get instance(): MatchManager {
    if (!MatchManager._instance) {
      MatchManager._instance = new MatchManager();
    }
    return MatchManager._instance;
  }

  /**
   * Initializes the match manager with a world reference and starts the queue polling loop.
   *
   * @param world - The main game world.
   */
  initialize(world: World): void {
    this.world = world;

    // Poll queues every 2 seconds to check if matches should start.
    if (this.queueCheckInterval) {
      clearInterval(this.queueCheckInterval);
    }
    this.queueCheckInterval = setInterval(() => {
      this.processQueues();
    }, 2000);
  }

  /**
   * Registers a game mode factory so the match manager can create instances on demand.
   *
   * @param type - The game mode type.
   * @param factory - A function that returns a new BaseGameMode instance.
   */
  registerGameMode(type: GameModeType, factory: () => BaseGameMode): void {
    this.gameModeFactories.set(type, factory);
  }

  /**
   * Adds a player (or party of players) to the queue for a game mode.
   *
   * @param gameModeType - The game mode to queue for.
   * @param players - Array of players (single player or full party).
   * @param partyId - Optional party ID if queuing as a group.
   * @returns True if all players were successfully queued.
   */
  joinQueue(gameModeType: GameModeType, players: Player[], partyId: string | null = null): boolean {
    // Ensure the game mode is registered.
    if (!this.gameModeFactories.has(gameModeType)) {
      console.info(`[MatchManager] Unknown game mode: ${gameModeType}`);
      return false;
    }

    // Check none of the players are already in a queue or match.
    for (const player of players) {
      if (this.isPlayerInQueue(player) || this.isPlayerInMatch(player)) {
        console.info(`[MatchManager] Player ${player.username} is already in a queue or match.`);
        return false;
      }
    }

    // Initialize queue if needed.
    if (!this.queues.has(gameModeType)) {
      this.queues.set(gameModeType, []);
    }

    const queue = this.queues.get(gameModeType)!;
    const now = Date.now();

    for (const player of players) {
      queue.push({
        player,
        partyId,
        joinedAt: now,
      });
    }

    console.info(
      `[MatchManager] ${players.map(p => p.username).join(', ')} joined ${gameModeType} queue. ` +
      `Queue size: ${queue.length}`
    );

    // Attempt immediate match start if enough players.
    this.tryStartMatch(gameModeType);

    return true;
  }

  /**
   * Removes a player from their current queue.
   *
   * @param player - The player to remove.
   * @returns True if the player was found and removed.
   */
  leaveQueue(player: Player): boolean {
    for (const [gameModeType, queue] of this.queues.entries()) {
      const idx = queue.findIndex(e => e.player.id === player.id);
      if (idx !== -1) {
        // If the player has a party, remove all party members from the queue.
        const entry = queue[idx];
        if (entry.partyId) {
          const partyId = entry.partyId;
          const remaining = queue.filter(e => e.partyId !== partyId);
          this.queues.set(gameModeType, remaining);
        } else {
          queue.splice(idx, 1);
        }
        console.info(`[MatchManager] ${player.username} left ${gameModeType} queue.`);
        return true;
      }
    }
    return false;
  }

  /**
   * Starts a match for a given game mode with the queued players.
   *
   * @param gameModeType - The game mode to start.
   * @param forcedPlayers - Optionally override which players to include.
   * @returns The match ID if started, or null if it could not start.
   */
  startMatch(gameModeType: GameModeType, forcedPlayers?: Player[]): string | null {
    if (!this.world) {
      console.info('[MatchManager] Cannot start match: world not initialized.');
      return null;
    }

    const factory = this.gameModeFactories.get(gameModeType);
    if (!factory) {
      console.info(`[MatchManager] No factory registered for ${gameModeType}.`);
      return null;
    }

    const gameMode = factory();
    const queue = this.queues.get(gameModeType) ?? [];

    let matchPlayers: Player[];

    if (forcedPlayers) {
      matchPlayers = forcedPlayers;
    } else {
      // Take up to maxPlayers from the front of the queue.
      const take = Math.min(queue.length, gameMode.maxPlayers);
      const entries = queue.splice(0, take);
      matchPlayers = entries.map(e => e.player);
    }

    if (matchPlayers.length < gameMode.minPlayers) {
      console.info(
        `[MatchManager] Not enough players for ${gameModeType}. ` +
        `Need ${gameMode.minPlayers}, have ${matchPlayers.length}.`
      );
      return null;
    }

    // Generate match ID.
    this.matchIdCounter += 1;
    const matchId = `match_${gameModeType}_${this.matchIdCounter}_${Date.now()}`;

    // Register the active match.
    const activeMatch: ActiveMatch = {
      id: matchId,
      gameMode,
      players: matchPlayers,
      startedAt: Date.now(),
    };
    this.activeMatches.set(matchId, activeMatch);

    // Initialize the game mode and add players.
    gameMode.initialize(matchId, this.world);
    for (const player of matchPlayers) {
      gameMode.addPlayer(player);
    }

    // Begin the game mode lifecycle.
    gameMode.beginCountdown();

    console.info(
      `[MatchManager] Match ${matchId} started with ${matchPlayers.length} players.`
    );

    return matchId;
  }

  /**
   * Ends an active match and returns its players to the lobby.
   *
   * @param matchId - The ID of the match to end.
   */
  endMatch(matchId: string): void {
    const match = this.activeMatches.get(matchId);
    if (!match) {
      console.info(`[MatchManager] Match ${matchId} not found.`);
      return;
    }

    // Teleport all surviving players back to the lobby spawn.
    if (this.world) {
      for (const player of match.players) {
        this.returnPlayerToLobby(player);
      }
    }

    this.activeMatches.delete(matchId);
    console.info(`[MatchManager] Match ${matchId} ended.`);
  }

  /**
   * Returns the number of players in the queue for a specific game mode.
   *
   * @param gameModeType - The game mode to check.
   * @returns The number of queued players.
   */
  getQueueCount(gameModeType: GameModeType): number {
    const queue = this.queues.get(gameModeType);
    return queue ? queue.length : 0;
  }

  /**
   * Returns all queue counts for every registered game mode.
   */
  getAllQueueCounts(): Map<GameModeType, number> {
    const counts = new Map<GameModeType, number>();
    for (const type of this.gameModeFactories.keys()) {
      counts.set(type, this.getQueueCount(type));
    }
    return counts;
  }

  /**
   * Returns the active match a player is in, or undefined.
   *
   * @param player - The player to look up.
   */
  getPlayerMatch(player: Player): ActiveMatch | undefined {
    for (const match of this.activeMatches.values()) {
      if (match.players.some(p => p.id === player.id)) {
        return match;
      }
    }
    return undefined;
  }

  /**
   * Checks if a player is currently in any queue.
   *
   * @param player - The player to check.
   */
  isPlayerInQueue(player: Player): boolean {
    for (const queue of this.queues.values()) {
      if (queue.some(e => e.player.id === player.id)) return true;
    }
    return false;
  }

  /**
   * Checks if a player is currently in any active match.
   *
   * @param player - The player to check.
   */
  isPlayerInMatch(player: Player): boolean {
    return this.getPlayerMatch(player) !== undefined;
  }

  /**
   * Handles a player disconnecting mid-queue or mid-match.
   *
   * @param player - The player that disconnected.
   */
  handlePlayerDisconnect(player: Player): void {
    // Remove from queue.
    this.leaveQueue(player);

    // Remove from active match.
    const match = this.getPlayerMatch(player);
    if (match) {
      match.players = match.players.filter(p => p.id !== player.id);
      match.gameMode.removePlayer(player);

      // If below minimum players, end the match.
      if (match.players.length < match.gameMode.minPlayers) {
        match.gameMode.forceEnd();
        this.endMatch(match.id);
      }
    }
  }

  /**
   * Cleans up the queue polling interval. Call on server shutdown.
   */
  shutdown(): void {
    if (this.queueCheckInterval) {
      clearInterval(this.queueCheckInterval);
      this.queueCheckInterval = null;
    }
  }

  // ============================================
  // Private helpers
  // ============================================

  /**
   * Processes all queues, starting matches when conditions are met.
   */
  private processQueues(): void {
    for (const gameModeType of this.gameModeFactories.keys()) {
      this.tryStartMatch(gameModeType);
    }
  }

  /**
   * Attempts to start a match for a game mode if the queue has enough players
   * or the timeout has elapsed.
   */
  private tryStartMatch(gameModeType: GameModeType): void {
    const factory = this.gameModeFactories.get(gameModeType);
    if (!factory) return;

    const queue = this.queues.get(gameModeType);
    if (!queue || queue.length === 0) return;

    // Create a temporary instance to read minPlayers / maxPlayers.
    const tempMode = factory();
    const minPlayers = tempMode.minPlayers;

    // Check if we have enough players.
    if (queue.length >= minPlayers) {
      this.startMatch(gameModeType);
      return;
    }

    // Check if the oldest entry has been waiting beyond the timeout.
    const oldest = queue[0];
    if (oldest && Date.now() - oldest.joinedAt >= MatchManager.QUEUE_TIMEOUT_MS) {
      // Only start if we have at least the absolute minimum (some modes allow 1).
      if (queue.length >= Math.max(1, minPlayers)) {
        this.startMatch(gameModeType);
      }
    }
  }

  /**
   * Teleports a player back to the lobby spawn position.
   */
  private returnPlayerToLobby(player: Player): void {
    if (!this.world) return;

    const entities = this.world.entityManager.getPlayerEntitiesByPlayer(player);
    if (entities.length > 0) {
      entities[0].setPosition(LOBBY_CONFIG.spawnPosition);
    }
  }
}
