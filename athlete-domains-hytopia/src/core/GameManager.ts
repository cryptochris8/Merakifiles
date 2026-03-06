/**
 * GameManager - Central orchestrator singleton for Athlete Domains.
 *
 * Holds the World reference, initializes all subsystems, registers game modes,
 * handles player join/leave lifecycle, and manages the lobby area with NPC
 * entities for game selection.
 */

import {
  Player,
  PlayerEvent,
  PlayerUIEvent,
  DefaultPlayerEntity,
  Entity,
  RigidBodyType,
  ColliderShape,
  EntityEvent,
  PlayerCameraMode,
} from 'hytopia';
import type { World, Vector3Like } from 'hytopia';
import {
  GameModeType,
  LOBBY_CONFIG,
  SUMO_CONFIG,
  TOWER_DUEL_CONFIG,
  TREASURE_GUARD_CONFIG,
  PARKOUR_RACE_CONFIG,
  JETSKI_RACE_CONFIG,
  FOOTBALL_CONFIG,
  ARCHERY_CONFIG,
  DISABLED_GAME_MODES,
} from './GameConfig';
import { PlayerDataManager } from './PlayerDataManager';
import { MatchManager } from './MatchManager';
import { PartyManager } from './PartyManager';
import { UIManager } from './UIManager';
import { ShopManager } from '../economy/ShopManager';
import { BoosterManager } from '../economy/BoosterManager';
import { CosmeticManager } from '../economy/CosmeticManager';
import type BaseGameMode from './BaseGameMode';

// ============================================
// NPC Configuration
// ============================================

interface LobbyNPC {
  gameModeType: GameModeType;
  name: string;
  modelUri: string;
  position: Vector3Like;
  tag: string;
}

/**
 * NPC positions in the city, lined up in front of the soccer stadium.
 * NPCs are spaced along the X axis near the stadium entrance.
 * We use the Hytopia default player model since custom NPC models don't exist yet.
 */
const LOBBY_NPCS: LobbyNPC[] = [
  {
    gameModeType: GameModeType.SUMO,
    name: 'Sumo',
    modelUri: 'models/players/player.gltf',
    position: { x: -23.14, y: 6.29, z: -559.41 },
    tag: 'npc_sumo',
  },
  {
    gameModeType: GameModeType.FOOTBALL,
    name: 'Football',
    modelUri: 'models/players/player.gltf',
    position: { x: -18.14, y: 6.29, z: -559.41 },
    tag: 'npc_football',
  },
  {
    gameModeType: GameModeType.TOWER_DUEL,
    name: 'Tower Duel',
    modelUri: 'models/players/player.gltf',
    position: { x: -13.14, y: 6.29, z: -559.41 },
    tag: 'npc_tower_duel',
  },
  {
    gameModeType: GameModeType.TREASURE_GUARD,
    name: 'Treasure Guard',
    modelUri: 'models/players/player.gltf',
    position: { x: -8.14, y: 6.29, z: -559.41 },
    tag: 'npc_treasure_guard',
  },
  {
    gameModeType: GameModeType.PARKOUR_RACE,
    name: 'Parkour',
    modelUri: 'models/players/player.gltf',
    position: { x: -3.14, y: 6.29, z: -559.41 },
    tag: 'npc_parkour',
  },
  {
    gameModeType: GameModeType.JETSKI_RACE,
    name: 'Jetski Race',
    modelUri: 'models/players/player.gltf',
    position: { x: 1.86, y: 6.29, z: -559.41 },
    tag: 'npc_jetski',
  },
  {
    gameModeType: GameModeType.ARCHERY,
    name: 'Archery',
    modelUri: 'models/players/player.gltf',
    position: { x: 6.86, y: 6.29, z: -559.41 },
    tag: 'npc_archery',
  },
];

// ============================================
// GameManager
// ============================================

export class GameManager {
  private static _instance: GameManager;

  /** The main game world. */
  private world: World | null = null;

  /** Subsystem references. */
  private playerDataManager: PlayerDataManager;
  private matchManager: MatchManager;
  private partyManager: PartyManager;
  private uiManager: UIManager;

  /** Spawned NPC entities in the lobby. */
  private lobbyNPCs: Entity[] = [];

  /** Tracks player entities spawned for each player in the lobby. */
  private playerEntities: Map<string, DefaultPlayerEntity> = new Map();

  private constructor() {
    this.playerDataManager = PlayerDataManager.instance;
    this.matchManager = MatchManager.instance;
    this.partyManager = PartyManager.instance;
    this.uiManager = UIManager.instance;
  }

  /** Singleton accessor. */
  static get instance(): GameManager {
    if (!GameManager._instance) {
      GameManager._instance = new GameManager();
    }
    return GameManager._instance;
  }

  /**
   * Returns the main world reference.
   */
  getWorld(): World | null {
    return this.world;
  }

  /**
   * Initializes the GameManager with the world. Sets up all subsystems,
   * registers game modes, spawns lobby NPCs, and registers event handlers.
   *
   * @param world - The main Hytopia World instance.
   */
  async initialize(world: World): Promise<void> {
    this.world = world;

    console.info('[GameManager] Initializing Athlete Domains...');

    // Initialize the match manager with the world.
    this.matchManager.initialize(world);

    // Preload and register all game modes.
    await this.preloadGameModes();

    // Register UI game mode metadata.
    this.registerUIGameModes();

    // Spawn lobby NPCs.
    this.spawnLobbyNPCs();

    // Register player lifecycle events.
    this.registerPlayerEvents();

    // Register chat commands.
    this.registerChatCommands();

    console.info('[GameManager] Athlete Domains initialized successfully.');
  }

  /**
   * Shuts down all subsystems. Call before server stops.
   */
  shutdown(): void {
    this.matchManager.shutdown();

    // Despawn lobby NPCs.
    for (const npc of this.lobbyNPCs) {
      if (npc.isSpawned) {
        npc.despawn();
      }
    }
    this.lobbyNPCs = [];

    console.info('[GameManager] Athlete Domains shut down.');
  }

  // ============================================
  // Private: Registration
  // ============================================

  /**
   * Preloads game mode modules via dynamic import and registers factories.
   * Must be awaited during initialization.
   */
  private async preloadGameModes(): Promise<void> {
    try {
      const [
        footballMod,
        sumoMod,
        towerDuelMod,
        treasureGuardMod,
        parkourRaceMod,
        jetskiRaceMod,
        archeryMod,
      ] = await Promise.all([
        import('../gamemodes/FootballGame'),
        import('../gamemodes/SumoGame'),
        import('../gamemodes/TowerDuelGame'),
        import('../gamemodes/TreasureGuardGame'),
        import('../gamemodes/ParkourRaceGame'),
        import('../gamemodes/JetskiRaceGame'),
        import('../gamemodes/ArcheryGame'),
      ]);

      // Sumo (default export)
      this.matchManager.registerGameMode(GameModeType.SUMO, () =>
        new sumoMod.default(),
      );

      // Football variants (named export with constructor arg)
      this.matchManager.registerGameMode(GameModeType.FOOTBALL, () =>
        new footballMod.FootballGame('1v1'),
      );
      this.matchManager.registerGameMode(GameModeType.FOOTBALL_2V2, () =>
        new footballMod.FootballGame('2v2'),
      );
      this.matchManager.registerGameMode(GameModeType.FOOTBALL_3V3, () =>
        new footballMod.FootballGame('3v3'),
      );

      // Tower Duel (named export, not default)
      this.matchManager.registerGameMode(GameModeType.TOWER_DUEL, () =>
        new towerDuelMod.TowerDuelGame(),
      );

      // Treasure Guard
      this.matchManager.registerGameMode(GameModeType.TREASURE_GUARD, () =>
        new treasureGuardMod.default(),
      );

      // Parkour Race
      this.matchManager.registerGameMode(GameModeType.PARKOUR_RACE, () =>
        new parkourRaceMod.default(),
      );

      // Jetski Race
      this.matchManager.registerGameMode(GameModeType.JETSKI_RACE, () =>
        new jetskiRaceMod.default(),
      );

      // Archery
      this.matchManager.registerGameMode(GameModeType.ARCHERY, () =>
        new archeryMod.default(),
      );

      console.info('[GameManager] Registered 9 game modes (all enabled).');
    } catch (err) {
      console.error('[GameManager] Error preloading game modes:', err);
    }
  }

  /**
   * Registers game mode info with the UIManager for the game selector display.
   */
  private registerUIGameModes(): void {
    this.uiManager.registerGameMode({
      type: GameModeType.SUMO,
      name: SUMO_CONFIG.name,
      description: 'Push your opponent off the ring!',
      minPlayers: SUMO_CONFIG.minPlayers,
      maxPlayers: 2,
    });

    this.uiManager.registerGameMode({
      type: GameModeType.FOOTBALL,
      name: FOOTBALL_CONFIG.name,
      description: '1v1 football - score 3 goals to win!',
      minPlayers: 2,
      maxPlayers: 2,
    });

    this.uiManager.registerGameMode({
      type: GameModeType.FOOTBALL_2V2,
      name: 'Football 2v2',
      description: '2v2 team football!',
      minPlayers: 4,
      maxPlayers: 4,
    });

    this.uiManager.registerGameMode({
      type: GameModeType.FOOTBALL_3V3,
      name: 'Football 3v3',
      description: '3v3 team football!',
      minPlayers: 6,
      maxPlayers: 6,
    });

    this.uiManager.registerGameMode({
      type: GameModeType.TOWER_DUEL,
      name: TOWER_DUEL_CONFIG.name,
      description: 'Knight vs Tower - destroy the other team!',
      minPlayers: 2,
      maxPlayers: 4,
    });

    this.uiManager.registerGameMode({
      type: GameModeType.TREASURE_GUARD,
      name: TREASURE_GUARD_CONFIG.name,
      description: 'Defend your treasure from waves of monsters!',
      minPlayers: TREASURE_GUARD_CONFIG.minPlayers,
      maxPlayers: 4,
    });

    this.uiManager.registerGameMode({
      type: GameModeType.PARKOUR_RACE,
      name: PARKOUR_RACE_CONFIG.name,
      description: 'Race through the parkour course!',
      minPlayers: PARKOUR_RACE_CONFIG.minPlayers,
      maxPlayers: PARKOUR_RACE_CONFIG.maxPlayers,
    });

    this.uiManager.registerGameMode({
      type: GameModeType.JETSKI_RACE,
      name: JETSKI_RACE_CONFIG.name,
      description: 'Race jetskis around the island!',
      minPlayers: JETSKI_RACE_CONFIG.minPlayers,
      maxPlayers: JETSKI_RACE_CONFIG.maxPlayers,
    });

    this.uiManager.registerGameMode({
      type: GameModeType.ARCHERY,
      name: ARCHERY_CONFIG.name,
      description: 'Practice your archery skills!',
      minPlayers: ARCHERY_CONFIG.minPlayers,
      maxPlayers: ARCHERY_CONFIG.maxPlayers,
    });
  }

  // ============================================
  // Private: Lobby NPCs
  // ============================================

  /**
   * Spawns NPC entities in the lobby for game mode selection.
   */
  private spawnLobbyNPCs(): void {
    if (!this.world) return;

    for (const npcConfig of LOBBY_NPCS) {
      const npc = new Entity({
        name: npcConfig.name,
        modelUri: npcConfig.modelUri,
        tag: npcConfig.tag,
        rigidBodyOptions: {
          type: RigidBodyType.FIXED,
          colliders: [
            {
              shape: ColliderShape.CYLINDER,
              halfHeight: 0.9,
              radius: 0.4,
            },
          ],
        },
      });

      npc.on(EntityEvent.INTERACT, (payload: { entity: Entity; player: Player }) => {
        const { player } = payload;
        // If player is already in a match, ignore.
        if (this.matchManager.getPlayerMatch(player)) return;
        // Open the game selector UI for this game mode.
        this.uiManager.showGameSelector(player);
      });

      npc.spawn(this.world, npcConfig.position);
      npc.setModelScale(3);
      this.lobbyNPCs.push(npc);
    }

    console.info(`[GameManager] Spawned ${this.lobbyNPCs.length} lobby NPCs.`);
  }

  // ============================================
  // Private: Player Events
  // ============================================

  /**
   * Registers global player join/leave event handlers.
   */
  private registerPlayerEvents(): void {
    if (!this.world) return;

    const world = this.world;

    // Handle player joining the world.
    world.on(PlayerEvent.JOINED_WORLD, async (payload: { player: Player; world: World }) => {
      const { player } = payload;
      await this.handlePlayerJoin(player);
    });

    // Handle player leaving the world.
    world.on(PlayerEvent.LEFT_WORLD, (payload: { player: Player; world: World }) => {
      const { player } = payload;
      this.handlePlayerLeave(player);
    });
  }

  /**
   * Handles a player joining the server.
   * Loads their data, spawns them in the lobby, and shows the main UI.
   *
   * @param player - The player that joined.
   */
  private async handlePlayerJoin(player: Player): Promise<void> {
    if (!this.world) return;

    console.info(`[GameManager] Player ${player.username} joined.`);

    // Load persisted data.
    await this.playerDataManager.loadPlayerData(player);

    // Initialize economy subsystems for this player.
    BoosterManager.instance.initPlayer(player);
    CosmeticManager.instance.initPlayer(player);
    ShopManager.instance.registerPlayerListeners(player);

    // Spawn the player entity in the lobby.
    const playerEntity = new DefaultPlayerEntity({
      player,
    });
    playerEntity.spawn(this.world, LOBBY_CONFIG.spawnPosition);
    this.playerEntities.set(player.id, playerEntity);

    // Attach camera to player entity in third-person mode.
    player.camera.setAttachedToEntity(playerEntity);
    player.camera.setMode(PlayerCameraMode.THIRD_PERSON);

    // Load the main UI.
    this.uiManager.loadMainUI(player);

    // Lock pointer for movement (WASD). Player can open game selector via /games or NPC.
    player.ui.lockPointer(true);

    // Listen for UI data events from this player (button clicks, selections, etc.).
    player.ui.on(PlayerUIEvent.DATA, (payload: { playerUI: any; data: Record<string, any> }) => {
      this.handleUIEvent(player, payload.data);
    });

    // Send initial coin balance (sendData may be buffered until client HTML loads).
    const playerData = this.playerDataManager.getPlayerData(player);
    if (playerData) {
      this.uiManager.showCoinUpdate(player, playerData.coins, 0);
    }

    // Welcome message.
    this.world.chatManager.sendPlayerMessage(
      player,
      `Welcome to Athlete Domains, ${player.username}! Type /games to open the game selector.`,
      'FFFF00',
    );
  }

  /**
   * Handles a player leaving the server. Cleans up all subsystems.
   *
   * @param player - The player that left.
   */
  private handlePlayerLeave(player: Player): void {
    console.info(`[GameManager] Player ${player.username} left.`);

    // Clean up economy subsystems (persists data).
    BoosterManager.instance.cleanupPlayer(player);
    CosmeticManager.instance.cleanupPlayer(player);

    // Save player data one final time.
    this.playerDataManager.savePlayerData(player);

    // Clean up match/queue state.
    this.matchManager.handlePlayerDisconnect(player);

    // Clean up party state.
    this.partyManager.handlePlayerDisconnect(player);

    // Remove from player data cache.
    this.playerDataManager.removePlayerData(player);

    // Despawn their player entity.
    const entity = this.playerEntities.get(player.id);
    if (entity && entity.isSpawned) {
      entity.despawn();
    }
    this.playerEntities.delete(player.id);
  }

  // ============================================
  // Private: UI Event Handling
  // ============================================

  /**
   * Routes incoming UI events from a player to the appropriate handler.
   *
   * @param player - The player that sent the event.
   * @param data - The event data from the client UI.
   */
  private handleUIEvent(player: Player, data: Record<string, any>): void {
    switch (data.type) {
      case 'joinQueue':
        this.handleJoinQueue(player, data.gameModeType as GameModeType);
        break;

      case 'leaveQueue':
        this.handleLeaveQueue(player);
        break;

      case 'openGameSelector':
        this.uiManager.showGameSelector(player);
        break;

      case 'closeGameSelector':
        this.uiManager.hideGameSelector(player);
        break;

      case 'viewStats':
        this.handleViewStats(player);
        break;

      case 'createParty':
        this.handleCreateParty(player);
        break;

      case 'inviteToParty':
        this.handleInviteToParty(player, data.targetUsername as string);
        break;

      case 'acceptPartyInvite':
        this.handleAcceptPartyInvite(player);
        break;

      case 'declinePartyInvite':
        this.partyManager.declineInvitation(player);
        break;

      case 'leaveParty':
        this.handleLeaveParty(player);
        break;

      case 'selectTeam':
        // Forwarded to the active game mode via match.
        break;

      case 'requestPointerLock':
        // Client-side recovery: re-lock pointer if no menu should be open.
        if (!this.matchManager.isPlayerInMatch(player)) {
          player.ui.lockPointer(true);
        }
        break;

      default:
        break;
    }
  }

  /**
   * Handles a player requesting to join a game mode queue.
   */
  private handleJoinQueue(player: Player, gameModeType: GameModeType): void {
    try {
      // Check if the player is in a party - if so, the leader queues the whole party.
      const party = this.partyManager.getPlayerParty(player);

      if (party) {
        if (party.leaderId !== player.id) {
          this.uiManager.hideGameSelector(player);
          this.uiManager.showNotification(player, 'Only the party leader can queue.', '#FF5555');
          return;
        }
        const success = this.partyManager.queueParty(player, gameModeType);
        if (success) {
          for (const member of party.members) {
            this.uiManager.hideGameSelector(member);
            // If the match started immediately, despawn lobby entity and skip queue UI.
            if (this.matchManager.isPlayerInMatch(member)) {
              this.despawnLobbyEntity(member);
            } else {
              this.uiManager.showQueueStatus(
                member,
                gameModeType,
                1,
                this.matchManager.getQueueCount(gameModeType),
                30,
              );
            }
          }
        } else {
          this.uiManager.hideGameSelector(player);
          this.uiManager.showNotification(player, 'Failed to join queue.', '#FF5555');
        }
      } else {
        const success = this.matchManager.joinQueue(gameModeType, [player]);
        if (success) {
          this.uiManager.hideGameSelector(player);
          // If the match started immediately (minPlayers reached), despawn lobby entity
          // and skip queue UI — the game mode has already spawned its own entity.
          if (this.matchManager.isPlayerInMatch(player)) {
            this.despawnLobbyEntity(player);
          } else {
            this.uiManager.showQueueStatus(
              player,
              gameModeType,
              1,
              this.matchManager.getQueueCount(gameModeType),
              30,
            );
          }
        } else {
          this.uiManager.hideGameSelector(player);
          this.uiManager.showNotification(player, 'Failed to join queue.', '#FF5555');
        }
      }
    } catch (err) {
      // If anything throws (game mode init, entity spawn, etc.), always re-lock pointer
      // so the player isn't stuck frozen with an unlocked cursor.
      console.error('[GameManager] Error in handleJoinQueue:', err);
      this.uiManager.hideGameSelector(player);
      this.uiManager.showNotification(player, 'Error joining game. Try again.', '#FF5555');
    }
  }

  /**
   * Despawns a player's lobby entity (when entering a match that spawns its own entity).
   */
  private despawnLobbyEntity(player: Player): void {
    const entity = this.playerEntities.get(player.id);
    if (entity && entity.isSpawned) {
      entity.despawn();
      console.info(`[GameManager] Despawned lobby entity for ${player.username} (entering match).`);
    }
  }

  /**
   * Re-spawns a player's lobby entity (when returning from a match to the lobby).
   */
  respawnLobbyEntity(player: Player): void {
    if (!this.world) return;

    const existing = this.playerEntities.get(player.id);
    if (existing && !existing.isSpawned) {
      existing.spawn(this.world, LOBBY_CONFIG.spawnPosition);
      player.camera.setAttachedToEntity(existing);
      player.camera.setMode(PlayerCameraMode.THIRD_PERSON);
      console.info(`[GameManager] Re-spawned lobby entity for ${player.username} (returning to lobby).`);
    }
  }

  /**
   * Handles a player leaving the queue.
   */
  private handleLeaveQueue(player: Player): void {
    const removed = this.matchManager.leaveQueue(player);
    if (removed) {
      this.uiManager.hideQueueStatus(player);
      // Return to normal gameplay instead of re-opening the game selector.
      // Re-opening the selector would call lockPointer(false) again, potentially
      // trapping the player if the UI doesn't render correctly.
      this.uiManager.hideAll(player);
      this.uiManager.showNotification(player, 'Left the queue.', '#FFFF00');
    }
  }

  /**
   * Handles a player viewing their stats.
   */
  private handleViewStats(player: Player): void {
    const data = this.playerDataManager.getPlayerData(player);
    if (!data) return;

    // Convert stat keys to readable names and send.
    const readableStats: Record<string, number> = {};
    for (const [key, value] of Object.entries(data.stats)) {
      const readableName = key
        .replace(/_/g, ' ')
        .toLowerCase()
        .replace(/\b\w/g, c => c.toUpperCase());
      readableStats[readableName] = value;
    }

    this.uiManager.showStats(player, readableStats, player.username);
  }

  /**
   * Handles party creation.
   */
  private handleCreateParty(player: Player): void {
    const party = this.partyManager.createParty(player);
    if (party) {
      this.uiManager.showNotification(player, 'Party created! Invite friends to join.', '#55FF55');
    } else {
      this.uiManager.showNotification(player, 'You are already in a party.', '#FF5555');
    }
  }

  /**
   * Handles sending a party invitation.
   */
  private handleInviteToParty(player: Player, targetUsername: string): void {
    if (!this.world) return;

    // Find the target player in the world.
    const allEntities = this.world.entityManager.getAllPlayerEntities();
    const targetEntity = allEntities.find(e => e.player.username === targetUsername);

    if (!targetEntity) {
      this.uiManager.showNotification(player, `Player "${targetUsername}" not found.`, '#FF5555');
      return;
    }

    const target = targetEntity.player;
    const success = this.partyManager.invitePlayer(player, target);

    if (success) {
      this.uiManager.showNotification(player, `Invited ${target.username} to your party.`, '#55FF55');
      this.uiManager.showNotification(
        target,
        `${player.username} invited you to their party! Type /accept to join.`,
        '#FFFF00',
        10000,
      );
    } else {
      this.uiManager.showNotification(player, 'Could not send invitation.', '#FF5555');
    }
  }

  /**
   * Handles accepting a party invitation.
   */
  private handleAcceptPartyInvite(player: Player): void {
    const party = this.partyManager.acceptInvitation(player);
    if (party) {
      this.uiManager.showNotification(player, 'You joined the party!', '#55FF55');

      // Notify the leader.
      const leader = this.players.find(p => p.id === party.leaderId);
      if (leader) {
        this.uiManager.showNotification(leader, `${player.username} joined your party.`, '#55FF55');
      }
    } else {
      this.uiManager.showNotification(player, 'No valid party invitation found.', '#FF5555');
    }
  }

  /**
   * Handles a player leaving their party.
   */
  private handleLeaveParty(player: Player): void {
    const party = this.partyManager.getPlayerParty(player);
    if (!party) {
      this.uiManager.showNotification(player, 'You are not in a party.', '#FF5555');
      return;
    }

    if (party.leaderId === player.id) {
      this.partyManager.disbandParty(player);
      this.uiManager.showNotification(player, 'Party disbanded.', '#FFFF00');
    } else {
      // Non-leaders can leave by having the leader kick them, or we handle it directly.
      party.members = party.members.filter(m => m.id !== player.id);
      this.uiManager.showNotification(player, 'You left the party.', '#FFFF00');
    }
  }

  // ============================================
  // Private: Chat Commands
  // ============================================

  /**
   * Registers slash commands for party management and utility.
   */
  private registerChatCommands(): void {
    if (!this.world) return;

    const chatManager = this.world.chatManager;

    chatManager.registerCommand('/party', (player: Player, _args: string[], _message: string) => {
      this.handleCreateParty(player);
    });

    chatManager.registerCommand('/invite', (player: Player, args: string[], _message: string) => {
      // args[0] is "/invite", remaining args form the username.
      const targetName = args.slice(1).join(' ').trim();
      if (!targetName) {
        this.world?.chatManager.sendPlayerMessage(player, 'Usage: /invite <username>', 'FF5555');
        return;
      }
      this.handleInviteToParty(player, targetName);
    });

    chatManager.registerCommand('/accept', (player: Player, _args: string[], _message: string) => {
      this.handleAcceptPartyInvite(player);
    });

    chatManager.registerCommand('/decline', (player: Player, _args: string[], _message: string) => {
      this.partyManager.declineInvitation(player);
      this.uiManager.showNotification(player, 'Invitation declined.', '#FFFF00');
    });

    chatManager.registerCommand('/leave', (player: Player, _args: string[], _message: string) => {
      this.handleLeaveParty(player);
    });

    chatManager.registerCommand('/stats', (player: Player, _args: string[], _message: string) => {
      this.handleViewStats(player);
    });

    chatManager.registerCommand('/games', (player: Player, _args: string[], _message: string) => {
      console.info(`[GameManager] /games command from ${player.username}`);
      this.uiManager.showGameSelector(player);
    });

    // Debug: toggle spectator camera for scouting coordinates.
    chatManager.registerCommand('/spectator', (player: Player, _args: string[], _message: string) => {
      const cam = player.camera;
      if (cam.mode === PlayerCameraMode.SPECTATOR) {
        cam.setMode(PlayerCameraMode.THIRD_PERSON);
        this.world?.chatManager.sendPlayerMessage(player, 'Camera: third-person', '55FF55');
      } else {
        cam.setMode(PlayerCameraMode.SPECTATOR);
        this.world?.chatManager.sendPlayerMessage(player, 'Camera: spectator (fly around freely)', '55FF55');
      }
    });

    // Debug: print current position to chat.
    chatManager.registerCommand('/pos', (player: Player, _args: string[], _message: string) => {
      const pe = this.playerEntities.get(player.id);
      if (!pe) return;
      const p = pe.position;
      const msg = `Position: x=${p.x.toFixed(1)}, y=${p.y.toFixed(1)}, z=${p.z.toFixed(1)}`;
      this.world?.chatManager.sendPlayerMessage(player, msg, '55FFFF');
    });
  }

  /**
   * Helper to find all online players in the world.
   */
  private get players(): Player[] {
    if (!this.world) return [];
    return this.world.entityManager.getAllPlayerEntities().map(e => e.player);
  }
}
