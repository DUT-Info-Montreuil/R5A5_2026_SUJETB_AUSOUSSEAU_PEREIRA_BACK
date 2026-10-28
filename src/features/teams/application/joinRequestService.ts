import type { Logger, Page, Paginated, UnitOfWork } from '../../../shared/application/ports.js';
import { AccessDeniedError, NotFoundError } from '../../../shared/domain/errors.js';
import type { TournamentReader } from '../../tournaments/application/tournamentReader.js';
import { assertRegistrationOpen } from '../../tournaments/domain/tournament.js';
import { assertCaptain, assertNotFull, assertPending, type JoinRequest } from '../domain/team.js';
import type { JoinRequestRepository, TeamRepository } from './ports.js';
import type { TeamService } from './teamService.js';

export class JoinRequestService {
    private readonly joinRequests: JoinRequestRepository;
    private readonly teams: TeamRepository;
    private readonly teamService: TeamService;
    private readonly reader: TournamentReader;
    private readonly uow: UnitOfWork;
    private readonly logger: Logger;

    constructor(deps: {
        joinRequests: JoinRequestRepository;
        teams: TeamRepository;
        teamService: TeamService;
        reader: TournamentReader;
        uow: UnitOfWork;
        logger: Logger;
    }) {
        this.joinRequests = deps.joinRequests;
        this.teams = deps.teams;
        this.teamService = deps.teamService;
        this.reader = deps.reader;
        this.uow = deps.uow;
        this.logger = deps.logger;
    }

    /** B-06 / B-07 : demander à rejoindre une équipe, sans en avoir déjà une dans ce tournoi. */
    create(teamId: number, userId: number): JoinRequest {
        const { team, tournament } = this.reader.requireTeam(teamId);
        assertRegistrationOpen(tournament);
        this.teamService.assertNotInTournament(tournament.id, userId);
        assertNotFull(team);
        return this.joinRequests.create(teamId, userId);
    }

    /** B-10 : seul le capitaine voit les demandes. */
    listPending(teamId: number, userId: number, page: Page): Paginated<JoinRequest> {
        const { team } = this.reader.requireTeam(teamId);
        assertCaptain(team, userId);
        return this.joinRequests.findPendingByTeam(teamId, page);
    }

    /** B-08 / B-10 : refusé si l'équipe a déjà 5 membres. */
    accept(requestId: number, userId: number): JoinRequest {
        const { request, tournament } = this.asCaptainOf(requestId, userId);
        this.uow.run(() => {
            this.teamService.assertNotInTournament(tournament.id, request.user.id);
            assertNotFull(this.teams.findById(request.teamId)!);
            this.teams.addMember(request.teamId, tournament.id, request.user.id);
            this.joinRequests.setStatus(request.id, 'accepted');
            this.joinRequests.cancelPendingOfUserInTournament(request.user.id, tournament.id);
        });
        this.logger.info('join_request_accepted', { join_request: request.id, team: request.teamId, user: request.user.id });
        this.reader.publishTeam(request.teamId);
        this.reader.publishTournament(tournament.id);
        return this.joinRequests.findById(request.id)!;
    }

    reject(requestId: number, userId: number): JoinRequest {
        const { request } = this.asCaptainOf(requestId, userId);
        this.joinRequests.setStatus(request.id, 'rejected');
        return this.joinRequests.findById(request.id)!;
    }

    /** Seul l'auteur annule sa demande, pas même le capitaine. */
    cancel(requestId: number, userId: number): void {
        const request = this.requireRequest(requestId);
        if (request.user.id !== userId) {
            throw new AccessDeniedError('NOT_REQUEST_AUTHOR', 'Seul l\'auteur de la demande peut l\'annuler');
        }
        assertPending(request);
        this.joinRequests.setStatus(request.id, 'cancelled');
    }

    private requireRequest(id: number): JoinRequest {
        const request = this.joinRequests.findById(id);
        if (!request) throw new NotFoundError('JOIN_REQUEST_NOT_FOUND', 'Demande introuvable');
        return request;
    }

    private asCaptainOf(requestId: number, userId: number) {
        const request = this.requireRequest(requestId);
        const { team, tournament } = this.reader.requireTeam(request.teamId);
        assertCaptain(team, userId);
        assertRegistrationOpen(tournament);
        assertPending(request);
        return { request, tournament };
    }
}
