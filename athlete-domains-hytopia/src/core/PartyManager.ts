/**
 * PartyManager - Manages player parties for group queuing.
 *
 * Supports creating parties, inviting/accepting/declining, kicking members,
 * disbanding, and coordinating party-wide queue joins through MatchManager.
 */

import { Player } from 'hytopia';
import { LOBBY_CONFIG } from './GameConfig';
import type { GameModeType } from './GameConfig';
import { MatchManager } from './MatchManager';

// ============================================
// Types
// ============================================

export interface Party {
  id: string;
  leaderId: string;
  members: Player[];
  createdAt: number;
}

export interface PartyInvitation {
  partyId: string;
  fromPlayer: Player;
  toPlayer: Player;
  createdAt: number;
}

// ============================================
// PartyManager
// ============================================

export class PartyManager {
  private static _instance: PartyManager;

  /** All active parties keyed by party ID. */
  private parties: Map<string, Party> = new Map();

  /** Pending invitations keyed by invited player ID. */
  private pendingInvitations: Map<string, PartyInvitation> = new Map();

  /** Lookup: player ID -> party ID for quick party membership checks. */
  private playerPartyMap: Map<string, string> = new Map();

  /** Counter for generating unique party IDs. */
  private partyIdCounter = 0;

  /** Maximum players per party (from config). */
  private readonly maxPartySize: number = LOBBY_CONFIG.maxPlayersPerParty;

  /** Invitation expiry time in milliseconds (60 seconds). */
  private static readonly INVITATION_EXPIRY_MS = 60_000;

  private constructor() {}

  /** Singleton accessor. */
  static get instance(): PartyManager {
    if (!PartyManager._instance) {
      PartyManager._instance = new PartyManager();
    }
    return PartyManager._instance;
  }

  /**
   * Creates a new party with the given player as leader.
   *
   * @param leader - The player who will lead the party.
   * @returns The newly created party, or null if the player is already in a party.
   */
  createParty(leader: Player): Party | null {
    // Check if the player is already in a party.
    if (this.playerPartyMap.has(leader.id)) {
      console.info(`[PartyManager] ${leader.username} is already in a party.`);
      return null;
    }

    this.partyIdCounter += 1;
    const partyId = `party_${this.partyIdCounter}_${Date.now()}`;

    const party: Party = {
      id: partyId,
      leaderId: leader.id,
      members: [leader],
      createdAt: Date.now(),
    };

    this.parties.set(partyId, party);
    this.playerPartyMap.set(leader.id, partyId);

    console.info(`[PartyManager] Party ${partyId} created by ${leader.username}.`);
    return party;
  }

  /**
   * Sends an invitation from the party leader to another player.
   *
   * @param leader - The player sending the invitation (must be party leader).
   * @param target - The player being invited.
   * @returns True if the invitation was sent successfully.
   */
  invitePlayer(leader: Player, target: Player): boolean {
    const partyId = this.playerPartyMap.get(leader.id);
    if (!partyId) {
      console.info(`[PartyManager] ${leader.username} is not in a party.`);
      return false;
    }

    const party = this.parties.get(partyId);
    if (!party) return false;

    // Only the leader can invite.
    if (party.leaderId !== leader.id) {
      console.info(`[PartyManager] ${leader.username} is not the party leader.`);
      return false;
    }

    // Check party size limit.
    if (party.members.length >= this.maxPartySize) {
      console.info(`[PartyManager] Party ${partyId} is full (${this.maxPartySize} max).`);
      return false;
    }

    // Check if target is already in a party.
    if (this.playerPartyMap.has(target.id)) {
      console.info(`[PartyManager] ${target.username} is already in a party.`);
      return false;
    }

    // Check if there is already a pending invitation for this player.
    if (this.pendingInvitations.has(target.id)) {
      console.info(`[PartyManager] ${target.username} already has a pending invitation.`);
      return false;
    }

    const invitation: PartyInvitation = {
      partyId,
      fromPlayer: leader,
      toPlayer: target,
      createdAt: Date.now(),
    };

    this.pendingInvitations.set(target.id, invitation);

    console.info(`[PartyManager] ${leader.username} invited ${target.username} to party ${partyId}.`);
    return true;
  }

  /**
   * Accepts a pending party invitation.
   *
   * @param player - The player accepting the invitation.
   * @returns The party joined, or null if no valid invitation exists.
   */
  acceptInvitation(player: Player): Party | null {
    const invitation = this.pendingInvitations.get(player.id);
    if (!invitation) {
      console.info(`[PartyManager] ${player.username} has no pending invitation.`);
      return null;
    }

    // Check if the invitation has expired.
    if (Date.now() - invitation.createdAt > PartyManager.INVITATION_EXPIRY_MS) {
      this.pendingInvitations.delete(player.id);
      console.info(`[PartyManager] Invitation for ${player.username} has expired.`);
      return null;
    }

    const party = this.parties.get(invitation.partyId);
    if (!party) {
      this.pendingInvitations.delete(player.id);
      console.info(`[PartyManager] Party ${invitation.partyId} no longer exists.`);
      return null;
    }

    // Check if the party is still below max size.
    if (party.members.length >= this.maxPartySize) {
      this.pendingInvitations.delete(player.id);
      console.info(`[PartyManager] Party ${party.id} is now full.`);
      return null;
    }

    // Add the player to the party.
    party.members.push(player);
    this.playerPartyMap.set(player.id, party.id);
    this.pendingInvitations.delete(player.id);

    console.info(`[PartyManager] ${player.username} joined party ${party.id}.`);
    return party;
  }

  /**
   * Declines a pending party invitation.
   *
   * @param player - The player declining.
   * @returns True if there was an invitation to decline.
   */
  declineInvitation(player: Player): boolean {
    if (this.pendingInvitations.has(player.id)) {
      this.pendingInvitations.delete(player.id);
      console.info(`[PartyManager] ${player.username} declined the party invitation.`);
      return true;
    }
    return false;
  }

  /**
   * Kicks a player from the party. Only the leader can kick.
   *
   * @param leader - The party leader performing the kick.
   * @param target - The player to kick.
   * @returns True if the player was successfully kicked.
   */
  kickPlayer(leader: Player, target: Player): boolean {
    const partyId = this.playerPartyMap.get(leader.id);
    if (!partyId) return false;

    const party = this.parties.get(partyId);
    if (!party) return false;

    if (party.leaderId !== leader.id) {
      console.info(`[PartyManager] ${leader.username} is not the party leader.`);
      return false;
    }

    // Cannot kick yourself.
    if (leader.id === target.id) {
      console.info(`[PartyManager] Leader cannot kick themselves. Use disbandParty.`);
      return false;
    }

    const idx = party.members.findIndex(m => m.id === target.id);
    if (idx === -1) {
      console.info(`[PartyManager] ${target.username} is not in party ${partyId}.`);
      return false;
    }

    party.members.splice(idx, 1);
    this.playerPartyMap.delete(target.id);

    console.info(`[PartyManager] ${target.username} was kicked from party ${partyId}.`);

    // If the party is now empty (should not happen since leader stays), disband.
    if (party.members.length === 0) {
      this.disbandParty(leader);
    }

    return true;
  }

  /**
   * Disbands a party. Only the leader can disband.
   *
   * @param leader - The party leader.
   * @returns True if the party was disbanded.
   */
  disbandParty(leader: Player): boolean {
    const partyId = this.playerPartyMap.get(leader.id);
    if (!partyId) return false;

    const party = this.parties.get(partyId);
    if (!party) return false;

    if (party.leaderId !== leader.id) {
      console.info(`[PartyManager] ${leader.username} is not the party leader.`);
      return false;
    }

    // Remove all members from the player-party map.
    for (const member of party.members) {
      this.playerPartyMap.delete(member.id);
    }

    // Remove any pending invitations for this party.
    for (const [playerId, invitation] of this.pendingInvitations.entries()) {
      if (invitation.partyId === partyId) {
        this.pendingInvitations.delete(playerId);
      }
    }

    this.parties.delete(partyId);
    console.info(`[PartyManager] Party ${partyId} disbanded.`);
    return true;
  }

  /**
   * Queues the entire party for a game mode.
   * Only the leader can initiate this. All party members join the queue together.
   *
   * @param leader - The party leader initiating the queue.
   * @param gameModeType - The game mode to queue for.
   * @returns True if the entire party was queued successfully.
   */
  queueParty(leader: Player, gameModeType: GameModeType): boolean {
    const partyId = this.playerPartyMap.get(leader.id);
    if (!partyId) {
      console.info(`[PartyManager] ${leader.username} is not in a party. Queue individually.`);
      return false;
    }

    const party = this.parties.get(partyId);
    if (!party) return false;

    if (party.leaderId !== leader.id) {
      console.info(`[PartyManager] Only the party leader can queue the party.`);
      return false;
    }

    const matchManager = MatchManager.instance;
    return matchManager.joinQueue(gameModeType, party.members, partyId);
  }

  /**
   * Returns the party a player belongs to, or undefined.
   *
   * @param player - The player to look up.
   */
  getPlayerParty(player: Player): Party | undefined {
    const partyId = this.playerPartyMap.get(player.id);
    if (!partyId) return undefined;
    return this.parties.get(partyId);
  }

  /**
   * Returns the pending invitation for a player, or undefined.
   *
   * @param player - The player to check.
   */
  getPendingInvitation(player: Player): PartyInvitation | undefined {
    return this.pendingInvitations.get(player.id);
  }

  /**
   * Checks if a player is the leader of their party.
   *
   * @param player - The player to check.
   */
  isPartyLeader(player: Player): boolean {
    const party = this.getPlayerParty(player);
    return party ? party.leaderId === player.id : false;
  }

  /**
   * Handles a player disconnecting. Removes them from party and
   * disbands if they were the leader.
   *
   * @param player - The player that disconnected.
   */
  handlePlayerDisconnect(player: Player): void {
    // Remove any pending invitation.
    this.pendingInvitations.delete(player.id);

    const partyId = this.playerPartyMap.get(player.id);
    if (!partyId) return;

    const party = this.parties.get(partyId);
    if (!party) {
      this.playerPartyMap.delete(player.id);
      return;
    }

    // If the disconnecting player is the leader, disband the party.
    if (party.leaderId === player.id) {
      // Remove all members.
      for (const member of party.members) {
        this.playerPartyMap.delete(member.id);
      }
      this.parties.delete(partyId);
      console.info(`[PartyManager] Party ${partyId} disbanded (leader ${player.username} disconnected).`);
    } else {
      // Just remove the member.
      party.members = party.members.filter(m => m.id !== player.id);
      this.playerPartyMap.delete(player.id);
      console.info(`[PartyManager] ${player.username} removed from party ${partyId} (disconnected).`);
    }
  }

  /**
   * Returns the number of active parties.
   */
  getPartyCount(): number {
    return this.parties.size;
  }
}
