import type { Logger, UnitOfWork } from '../../../shared/application/ports.js';
import type { RealtimeNotifier } from '../../../shared/application/realtimeNotifier.js';
import { ConflictError, RuleViolationError } from '../../../shared/domain/errors.js';
import type { GameRepository } from '../../games/application/ports.js';
import type { TournamentReader } from '../../tournaments/application/tournamentReader.js';
import { BRACKET_SIZE } from '../../tournaments/domain/bracket.js';
import { assertRegistrationOpen } from '../../tournaments/domain/tournament.js';
import { assertCanKick, assertCaptain, assertMember, assertTargetMember, successorOf, type Team } from '../domain/team.js';
import type { JoinRequestRepository, TeamRepository } from './ports.js';

export class TeamService {
    private readonly teams: TeamRepository;
    private readonly games: GameRepository;
    private readonly joinRequests: JoinRequestRepository;
    private readonly reader: TournamentReader;
    private readonly notifier: RealtimeNotifier;
    private readonly uow: UnitOfWork;
    private readonly logger: Logger;

    constructor(deps: {
        teams: TeamRepository;
        games: GameRepository;
        joinRequests: JoinRequestRepository;
        reader: TournamentReader;
        notifier: RealtimeNotifier;
        uow: UnitOfWork;
        logger: Logger;
    }) {
        this.teams = deps.teams;
        this.games = deps.games;
        this.joinRequests = deps.joinRequests;
        this.reader = deps.reader;
        this.notifier = deps.notifier;
        this.uow = deps.uow;
        this.logger = deps.logger;
    }

    /** B-06 : recherche publique. La collection est bornée (8 équipes de 5) : pas de pagination. */
    listByTournament(tournamentId: number, search?: string): Team[] {
        this.reader.requireTournament(tournamentId);
        return this.teams.findByTournament(tournamentId, search);
    }

    get(id: number): Team {
        return this.reader.requireTeam(id).team;
    }

    /** B-05 / B-07 : le créateur devient capitaine ; une seule équipe par joueur et par tournoi. */
    create(tournamentId: number, userId: number, name: string): Team {
        const team = this.uow.run(() => {
            assertRegistrationOpen(this.reader.requireTournament(tournamentId));
            this.assertNotInTournament(tournamentId, userId);
            if (this.teams.countByTournament(tournamentId) >= BRACKET_SIZE) {
                throw new ConflictError('TOURNAMENT_FULL', `Ce tournoi a déjà ${BRACKET_SIZE} équipes`);
            }
            const created = this.teams.create(tournamentId, name, userId);
            this.joinRequests.cancelPendingOfUserInTournament(userId, tournamentId);
            return created;
        });
        this.logger.info('team_created', { team: team.id, tournament: tournamentId, user: userId });
        return this.publish(team.id, tournamentId);
    }

    /** B-09 */
    rename(teamId: number, userId: number, name: string): Team {
        const { tournament } = this.asCaptain(teamId, userId);
        this.teams.rename(teamId, name);
        return this.publish(teamId, tournament.id);
    }

    /** B-10 : membres, demandes et messages partent en cascade. */
    remove(teamId: number, userId: number): void {
        const { tournament } = this.asCaptain(teamId, userId);
        this.teams.remove(teamId);
        this.logger.info('team_deleted', { team: teamId, user: userId });
        this.notifier.teamDeleted(teamId);
        this.reader.publishTournament(tournament.id);
    }

    /** B-09 */
    transferCaptaincy(teamId: number, userId: number, targetUserId: number): Team {
        const { team, tournament } = this.asCaptain(teamId, userId);
        assertTargetMember(team, targetUserId);
        this.teams.setCaptain(teamId, targetUserId);
        return this.publish(teamId, tournament.id);
    }

    /** B-08 / B-09 : le rôle doit appartenir au jeu du tournoi. `null` retire le rôle. */
    setMemberRole(teamId: number, userId: number, targetUserId: number, roleId: number | null): Team {
        const { team, tournament } = this.asCaptain(teamId, userId);
        assertTargetMember(team, targetUserId);
        if (roleId !== null && this.games.findRole(roleId)?.gameId !== tournament.game.id) {
            throw new RuleViolationError('INVALID_ROLE', 'Ce rôle n\'existe pas pour le jeu de ce tournoi');
        }
        this.teams.setMemberRole(teamId, targetUserId, roleId);
        return this.publish(teamId, tournament.id);
    }

    /** B-09 / B-17 : l'exclu perd immédiatement l'accès à l'espace d'échange. */
    kick(teamId: number, userId: number, targetUserId: number): Team {
        const { team, tournament } = this.asCaptain(teamId, userId);
        assertCanKick(team, userId, targetUserId);
        this.teams.removeMember(teamId, targetUserId);
        this.logger.info('team_member_kicked', { team: teamId, user: userId, target: targetUserId });
        this.notifier.memberKicked(teamId, targetUserId);
        return this.publish(teamId, tournament.id);
    }

    /**
     * B-06 : quitter tant que les inscriptions sont ouvertes. Si le capitaine part, le membre arrivé
     * le plus tôt reprend ; s'il était seul, l'équipe est supprimée.
     */
    leave(teamId: number, userId: number): void {
        const { team, tournament } = this.reader.requireTeam(teamId);
        const member = assertMember(team, userId);
        assertRegistrationOpen(tournament);

        const teamDeleted = this.uow.run(() => {
            this.teams.removeMember(teamId, userId);
            if (!member.isCaptain) return false;
            const successor = successorOf(team, userId);
            if (!successor) {
                this.teams.remove(teamId);
                return true;
            }
            this.teams.setCaptain(teamId, successor.userId);
            return false;
        });

        this.notifier.memberLeft(teamId, userId);
        if (teamDeleted) {
            this.notifier.teamDeleted(teamId);
            this.reader.publishTournament(tournament.id);
        } else {
            this.publish(teamId, tournament.id);
        }
    }

    assertNotInTournament(tournamentId: number, userId: number): void {
        if (this.teams.findTeamIdOfUser(tournamentId, userId) !== undefined) {
            throw new ConflictError('ALREADY_IN_TEAM', 'Vous êtes déjà dans une équipe de ce tournoi');
        }
    }

    /** Vérifications des actions du capitaine, dans l'ordre : introuvable, interdit, puis inscriptions closes (B-09, B-10, B-11). */
    private asCaptain(teamId: number, userId: number) {
        const context = this.reader.requireTeam(teamId);
        assertCaptain(context.team, userId);
        assertRegistrationOpen(context.tournament);
        return context;
    }

    private publish(teamId: number, tournamentId: number): Team {
        this.reader.publishTeam(teamId);
        this.reader.publishTournament(tournamentId);
        return this.teams.findById(teamId)!;
    }
}
