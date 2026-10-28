import type { Logger, Page, Paginated, UnitOfWork } from '../../../shared/application/ports.js';
import type { TournamentDetail } from '../../../shared/application/realtimeNotifier.js';
import { NotFoundError } from '../../../shared/domain/errors.js';
import type { GameRepository } from '../../games/application/ports.js';
import type { JoinRequestRepository, TeamRepository } from '../../teams/application/ports.js';
import { planBracket, type Match } from '../domain/bracket.js';
import { assertStatus, type Tournament, type TournamentStatus } from '../domain/tournament.js';
import type { MatchService } from './matchService.js';
import type { MatchRepository, TournamentRepository } from './ports.js';
import type { TournamentReader } from './tournamentReader.js';

export class TournamentService {
    private readonly tournaments: TournamentRepository;
    private readonly games: GameRepository;
    private readonly teams: TeamRepository;
    private readonly matches: MatchRepository;
    private readonly joinRequests: JoinRequestRepository;
    private readonly matchService: MatchService;
    private readonly reader: TournamentReader;
    private readonly uow: UnitOfWork;
    private readonly logger: Logger;
    private readonly randomInt: (maxExclusive: number) => number;

    constructor(deps: {
        tournaments: TournamentRepository;
        games: GameRepository;
        teams: TeamRepository;
        matches: MatchRepository;
        joinRequests: JoinRequestRepository;
        matchService: MatchService;
        reader: TournamentReader;
        uow: UnitOfWork;
        logger: Logger;
        randomInt: (maxExclusive: number) => number;
    }) {
        this.tournaments = deps.tournaments;
        this.games = deps.games;
        this.teams = deps.teams;
        this.matches = deps.matches;
        this.joinRequests = deps.joinRequests;
        this.matchService = deps.matchService;
        this.reader = deps.reader;
        this.uow = deps.uow;
        this.logger = deps.logger;
        this.randomInt = deps.randomInt;
    }

    /** B-02 */
    search(filters: { search?: string; status?: TournamentStatus }, page: Page): Paginated<Tournament> {
        return this.tournaments.search(filters, page);
    }

    getDetail(id: number): TournamentDetail {
        return this.reader.getDetail(id);
    }

    getMatches(id: number): Match[] {
        this.reader.requireTournament(id);
        return this.matches.findByTournament(id);
    }

    /** B-01 : le tournoi naît inscriptions ouvertes. */
    create(input: { name: string; gameId: number }, adminId: number): TournamentDetail {
        if (!this.games.findById(input.gameId)) throw new NotFoundError('GAME_NOT_FOUND', 'Jeu introuvable');
        const tournament = this.tournaments.create(input.name, input.gameId, adminId);
        this.logger.info('tournament_created', { tournament: tournament.id, game: input.gameId });
        return this.getDetail(tournament.id);
    }

    /** B-03 / B-12 : fige les équipes, tire l'arbre au sort et rejette les demandes en attente. */
    close(id: number): TournamentDetail {
        this.uow.run(() => {
            assertStatus(this.reader.requireTournament(id), 'registration_open', 'Les inscriptions ne sont pas ouvertes');
            const teamIds = this.teams.findByTournament(id).map((t) => t.id);
            for (const plan of planBracket(teamIds, this.randomInt)) this.matches.create(id, plan);
            this.joinRequests.rejectPendingInTournament(id);
            this.tournaments.setStatus(id, 'registration_closed');
        });
        this.logger.info('tournament_registration_closed', { tournament: id });
        this.reader.publishTournament(id);
        return this.getDetail(id);
    }

    /** B-04 : lance le tournoi ; les équipes incomplètes perdent leur premier match par forfait. */
    start(id: number): TournamentDetail {
        const decisions = this.uow.run(() => {
            assertStatus(this.reader.requireTournament(id), 'registration_closed', 'Le tournoi doit avoir ses inscriptions closes pour être lancé');
            this.tournaments.setStatus(id, 'in_progress');
            return this.matchService.applyStartForfeits(id);
        });
        this.logger.info('tournament_started', { tournament: id, forfeits: decisions.length });
        this.matchService.broadcast(decisions);
        this.reader.publishTournament(id);
        return this.getDetail(id);
    }
}
