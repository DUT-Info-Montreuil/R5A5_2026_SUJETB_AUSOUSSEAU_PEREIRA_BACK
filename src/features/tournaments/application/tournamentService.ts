import type { Logger, Page, Paginated, UnitOfWork } from '../../../shared/application/ports.js';
import type { RealtimeNotifier, TournamentDetail } from '../../../shared/application/realtimeNotifier.js';
import { NotFoundError } from '../../../shared/domain/errors.js';
import type { GameRepository } from '../../games/application/ports.js';
import type { JoinRequestRepository, TeamRepository } from '../../teams/application/ports.js';
import type { UserRepository } from '../../users/application/ports.js';
import { FINAL_ROUND, planBracket, resultOf, type Match, type TournamentResult } from '../domain/bracket.js';
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
    private readonly users: UserRepository;
    private readonly matchService: MatchService;
    private readonly reader: TournamentReader;
    private readonly notifier: RealtimeNotifier;
    private readonly uow: UnitOfWork;
    private readonly logger: Logger;
    private readonly randomInt: (maxExclusive: number) => number;

    constructor(deps: {
        tournaments: TournamentRepository;
        games: GameRepository;
        teams: TeamRepository;
        matches: MatchRepository;
        joinRequests: JoinRequestRepository;
        users: UserRepository;
        matchService: MatchService;
        reader: TournamentReader;
        notifier: RealtimeNotifier;
        uow: UnitOfWork;
        logger: Logger;
        randomInt: (maxExclusive: number) => number;
    }) {
        this.tournaments = deps.tournaments;
        this.games = deps.games;
        this.teams = deps.teams;
        this.matches = deps.matches;
        this.joinRequests = deps.joinRequests;
        this.users = deps.users;
        this.matchService = deps.matchService;
        this.reader = deps.reader;
        this.notifier = deps.notifier;
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
    create(input: { name: string; gameId: number; registrationClosesAt?: string | null }, adminId: number): TournamentDetail {
        if (!this.games.findById(input.gameId)) throw new NotFoundError('GAME_NOT_FOUND', 'Jeu introuvable');
        const tournament = this.tournaments.create(input.name, input.gameId, adminId, input.registrationClosesAt ?? null);
        this.logger.info('tournament_created', { tournament: tournament.id, game: input.gameId });
        return this.getDetail(tournament.id);
    }

    /** Date de clôture prévue, affichée aux joueurs : la clôture reste une action de l'admin (B-03). */
    setRegistrationClosesAt(id: number, at: string | null): TournamentDetail {
        assertStatus(this.reader.requireTournament(id), 'registration_open', 'Les inscriptions ne sont plus ouvertes');
        this.tournaments.setRegistrationClosesAt(id, at);
        this.reader.publishTournament(id);
        return this.getDetail(id);
    }

    /** B-03 / B-12 : fige les équipes, tire l'arbre au sort et rejette les demandes en attente. */
    close(id: number): TournamentDetail {
        const rejected = this.uow.run(() => {
            assertStatus(this.reader.requireTournament(id), 'registration_open', 'Les inscriptions ne sont pas ouvertes');
            const teamIds = this.teams.findByTournament(id).map((t) => t.id);
            for (const plan of planBracket(teamIds, this.randomInt)) this.matches.create(id, plan);
            this.tournaments.setStatus(id, 'registration_closed');
            return this.joinRequests.rejectPendingInTournament(id);
        });
        this.logger.info('tournament_registration_closed', { tournament: id });
        for (const request of rejected) this.notifier.joinRequestUpdated(request);
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

    /** Profil : bilan du joueur sur les tournois lancés ; l'historique ne garde que les tournois terminés. */
    playerStats(userId: number, page: Page): PlayerStats {
        if (!this.users.findById(userId)) throw new NotFoundError('USER_NOT_FOUND', 'Joueur introuvable');
        const participations = this.tournaments.findParticipations(userId);
        const matches = this.matches.findInTournamentsOf(userId);
        const teamIds = new Set(participations.map((p) => p.teamId));
        const played = matches.filter(
            (m) => m.status === 'finished' && ((m.teamAId !== null && teamIds.has(m.teamAId)) || (m.teamBId !== null && teamIds.has(m.teamBId))),
        );
        const history = participations
            .filter((p) => p.tournament.status === 'finished')
            .map((p) => ({
                tournament: p.tournament,
                result: resultOf(matches.filter((m) => m.tournamentId === p.tournament.id), p.teamId),
            }));
        return {
            tournaments: participations.length,
            matchesPlayed: played.length,
            matchesWon: played.filter((m) => m.winnerId !== null && teamIds.has(m.winnerId)).length,
            titles: played.filter((m) => m.round === FINAL_ROUND && teamIds.has(m.winnerId!)).length,
            // shortcut: pagination en mémoire, un joueur a peu de tournois ; passer en SQL s'il en a des milliers
            history: { items: history.slice(page.offset, page.offset + page.limit), total: history.length },
        };
    }
}

export interface PlayerStats {
    tournaments: number;
    matchesPlayed: number;
    matchesWon: number;
    titles: number;
    history: Paginated<{ tournament: Tournament; result: TournamentResult }>;
}
