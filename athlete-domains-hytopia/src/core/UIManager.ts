/**
 * UIManager - Manages HTML-based UI sent to players via Hytopia PlayerUI.
 *
 * Responsible for loading UI templates and pushing state updates for
 * game selector, scoreboard, timer, stats, queue status, team selection,
 * and end-of-game results.
 */

import { Player } from 'hytopia';
import { GameModeType } from './GameConfig';
import { MatchManager } from './MatchManager';

// ============================================
// Types
// ============================================

export interface GameModeInfo {
  type: GameModeType;
  name: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  queueCount: number;
}

export interface ScoreboardEntry {
  playerId: string;
  playerName: string;
  score: number;
  team?: string;
}

export interface MatchResultEntry {
  playerId: string;
  playerName: string;
  score: number;
  placement: number;
  coinsEarned: number;
  isWinner: boolean;
}

export interface TeamOption {
  id: string;
  name: string;
  color: string;
  playerCount: number;
  maxPlayers: number;
}

// ============================================
// UI Template Paths (relative to assets/)
// ============================================

const UI_TEMPLATES = {
  MAIN: 'ui/index.html',
} as const;

// ============================================
// UIManager
// ============================================

export class UIManager {
  private static _instance: UIManager;

  /** Registered game mode metadata for the game selector. */
  private gameModeInfos: Map<GameModeType, Omit<GameModeInfo, 'queueCount'>> = new Map();

  private constructor() {}

  /** Singleton accessor. */
  static get instance(): UIManager {
    if (!UIManager._instance) {
      UIManager._instance = new UIManager();
    }
    return UIManager._instance;
  }

  /**
   * Registers game mode information for display in the game selector.
   *
   * @param info - The game mode metadata (excluding live queue count).
   */
  registerGameMode(info: Omit<GameModeInfo, 'queueCount'>): void {
    this.gameModeInfos.set(info.type, info);
  }

  /**
   * Loads the main UI template for a player. Should be called when the player joins the world.
   *
   * @param player - The player to set up UI for.
   */
  loadMainUI(player: Player): void {
    player.ui.load(UI_TEMPLATES.MAIN);
  }

  /**
   * Shows the game selector menu with all registered game modes and live queue counts.
   *
   * @param player - The player to show the selector to.
   */
  showGameSelector(player: Player): void {
    const matchManager = MatchManager.instance;
    const queueCounts = matchManager.getAllQueueCounts();

    const gameModes: GameModeInfo[] = [];
    for (const [type, info] of this.gameModeInfos.entries()) {
      gameModes.push({
        ...info,
        queueCount: queueCounts.get(type) ?? 0,
      });
    }

    console.info(`[UIManager] showGameSelector for ${player.username}: ${gameModes.length} game modes`);

    player.ui.sendData({
      type: 'showGameSelector',
      gameModes,
    });

    // Unlock pointer so the player can interact with the menu.
    player.ui.lockPointer(false);
  }

  /**
   * Hides the game selector menu.
   *
   * @param player - The player to hide the selector for.
   */
  hideGameSelector(player: Player): void {
    player.ui.sendData({
      type: 'hideGameSelector',
    });

    // Re-lock pointer for gameplay.
    player.ui.lockPointer(true);
  }

  /**
   * Shows or updates the scoreboard during a game.
   *
   * @param player - The player to send the scoreboard to.
   * @param entries - The scoreboard entries sorted by score descending.
   * @param gameModeName - The name of the current game mode.
   */
  showScoreboard(player: Player, entries: ScoreboardEntry[], gameModeName: string): void {
    player.ui.sendData({
      type: 'showScoreboard',
      gameModeName,
      entries,
    });
  }

  /**
   * Updates the countdown or game timer display.
   *
   * @param player - The player to update.
   * @param timeRemainingSeconds - Seconds remaining in the current phase.
   * @param phase - The current phase label (e.g., 'COUNTDOWN', 'ACTIVE', 'ENDING').
   */
  updateTimer(player: Player, timeRemainingSeconds: number, phase: string): void {
    const minutes = Math.floor(timeRemainingSeconds / 60);
    const seconds = timeRemainingSeconds % 60;
    const formatted = `${minutes}:${seconds.toString().padStart(2, '0')}`;

    player.ui.sendData({
      type: 'updateTimer',
      timeRemaining: timeRemainingSeconds,
      timeFormatted: formatted,
      phase,
    });
  }

  /**
   * Shows the end-of-game results screen.
   *
   * @param player - The player to show results to.
   * @param results - The match result entries.
   * @param gameModeName - The name of the game mode that just ended.
   */
  showResults(player: Player, results: MatchResultEntry[], gameModeName: string): void {
    player.ui.sendData({
      type: 'showResults',
      gameModeName,
      results,
    });

    // Unlock pointer so the player can view and interact with results.
    player.ui.lockPointer(false);
  }

  /**
   * Shows the player stats display.
   *
   * @param player - The player to show stats to.
   * @param stats - Record of stat names to their values.
   * @param playerName - The player's display name.
   */
  showStats(player: Player, stats: Record<string, number>, playerName: string): void {
    player.ui.sendData({
      type: 'showStats',
      playerName,
      stats,
    });

    player.ui.lockPointer(false);
  }

  /**
   * Shows the queue status indicator (waiting for match).
   *
   * @param player - The player to show queue status to.
   * @param gameModeType - The game mode being queued for.
   * @param queuePosition - The player's position in the queue.
   * @param totalInQueue - Total players in the queue.
   * @param estimatedWaitSeconds - Estimated wait time in seconds.
   */
  showQueueStatus(
    player: Player,
    gameModeType: GameModeType,
    queuePosition: number,
    totalInQueue: number,
    estimatedWaitSeconds: number,
  ): void {
    const info = this.gameModeInfos.get(gameModeType);
    player.ui.sendData({
      type: 'showQueueStatus',
      gameModeName: info?.name ?? gameModeType,
      gameModeType,
      queuePosition,
      totalInQueue,
      estimatedWaitSeconds,
    });
  }

  /**
   * Hides the queue status indicator.
   *
   * @param player - The player to update.
   */
  hideQueueStatus(player: Player): void {
    player.ui.sendData({
      type: 'hideQueueStatus',
    });
  }

  /**
   * Shows the team selection UI (used for football and other team modes).
   *
   * @param player - The player to show team selection to.
   * @param teams - Available team options.
   * @param gameModeName - The name of the game mode.
   */
  showTeamSelection(player: Player, teams: TeamOption[], gameModeName: string): void {
    player.ui.sendData({
      type: 'showTeamSelection',
      gameModeName,
      teams,
    });

    player.ui.lockPointer(false);
  }

  /**
   * Hides the team selection UI.
   *
   * @param player - The player to update.
   */
  hideTeamSelection(player: Player): void {
    player.ui.sendData({
      type: 'hideTeamSelection',
    });

    player.ui.lockPointer(true);
  }

  /**
   * Shows a notification toast message.
   *
   * @param player - The player to notify.
   * @param message - The message text.
   * @param color - Optional hex color for the message.
   * @param durationMs - How long the notification should stay visible (default 3000).
   */
  showNotification(player: Player, message: string, color?: string, durationMs: number = 3000): void {
    player.ui.sendData({
      type: 'showNotification',
      message,
      color: color ?? '#FFFFFF',
      durationMs,
    });
  }

  /**
   * Shows the coin balance update animation.
   *
   * @param player - The player to update.
   * @param currentBalance - The player's current coin balance.
   * @param change - The amount of coins added (positive) or removed (negative).
   */
  showCoinUpdate(player: Player, currentBalance: number, change: number): void {
    player.ui.sendData({
      type: 'coinUpdate',
      balance: currentBalance,
      change,
    });
  }

  /**
   * Hides all active UI overlays for a player, resetting to the default HUD.
   *
   * @param player - The player to reset.
   */
  hideAll(player: Player): void {
    player.ui.sendData({
      type: 'hideAll',
    });

    // Re-lock pointer for normal gameplay.
    player.ui.lockPointer(true);
  }

  /**
   * Sends an arbitrary data payload to the player's UI.
   * Useful for custom game-mode-specific UI updates.
   *
   * @param player - The target player.
   * @param data - The data object to send.
   */
  sendCustomData(player: Player, data: object): void {
    player.ui.sendData(data);
  }

  /**
   * Broadcasts a UI update to multiple players at once.
   *
   * @param players - The players to send to.
   * @param data - The data object to send.
   */
  broadcastData(players: Player[], data: object): void {
    for (const player of players) {
      player.ui.sendData(data);
    }
  }
}
