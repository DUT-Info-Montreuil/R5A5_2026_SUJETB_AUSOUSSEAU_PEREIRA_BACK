import type { Logger, Page, Paginated, UnitOfWork } from '../../../shared/application/ports.js';
import type { RealtimeNotifier } from '../../../shared/application/realtimeNotifier.js';
import type { TeamRepository } from '../../teams/application/ports.js';
import type { TournamentReader } from '../../tournaments/application/tournamentReader.js';
import { assertCanPredict, assertValidBracket, rankBrackets, scoreOf, type Pick, type Score, type Standing } from '../domain/prediction.js';
import type { PredictionRepository, PredictionSummary } from './ports.js';

export class PredictionService {
    private readonly predictions: PredictionRepository;
    private readonly teams: TeamRepository;
    private readonly reader: TournamentReader;
    private readonly notifier: RealtimeNotifier;
    private readonly uow: UnitOfWork;
    private readonly logger: Logger;

    constructor(deps: {
        predictions: PredictionRepository;
        teams: TeamRepository;
        reader: TournamentReader;
        notifier: RealtimeNotifier;
        uow: UnitOfWork;
        logger: Logger;
    }) {
        this.predictions = deps.predictions;
        this.teams = deps.teams;
        this.reader = deps.reader;
        this.notifier = deps.notifier;
        this.uow = deps.uow;
        this.logger = deps.logger;
    }

    /** Enregistre (ou remplace) l'arbre du spectateur, puis annonce la nouvelle répartition du public. */
    submit(tournamentId: number, userId: number, picks: Pick[]): Score & { picks: Pick[] } {
        const { tournament, matches } = this.reader.getDetail(tournamentId);
        assertCanPredict(tournament, this.teams.findTeamIdOfUser(tournamentId, userId) !== undefined);
        assertValidBracket(picks, matches);
        this.uow.run(() => this.predictions.replace(tournamentId, userId, picks));
        this.logger.info('bracket_predicted', { tournament: tournamentId, user: userId });
        this.notifier.predictionsUpdated(this.summary(tournamentId));
        return this.mine(tournamentId, userId);
    }

    mine(tournamentId: number, userId: number): Score & { picks: Pick[] } {
        const { matches } = this.reader.getDetail(tournamentId);
        const picks = this.predictions.findPicks(tournamentId, userId);
        return { picks, ...scoreOf(picks, matches) };
    }

    // shortcut: classement calculé en mémoire à chaque lecture, assez pour quelques milliers de spectateurs ;
    // au-delà, stocker les points à la validation d'un match et trier en SQL
    leaderboard(tournamentId: number, page: Page): Paginated<Standing> {
        const { matches } = this.reader.getDetail(tournamentId);
        const standings = rankBrackets(this.predictions.findBrackets(tournamentId), matches);
        return { items: standings.slice(page.offset, page.offset + page.limit), total: standings.length };
    }

    summary(tournamentId: number): PredictionSummary {
        const { matches } = this.reader.getDetail(tournamentId);
        const brackets = this.predictions.findBrackets(tournamentId);
        return {
            tournamentId,
            participants: brackets.length,
            matches: matches.map((match) => {
                const counts = new Map<number, number>();
                for (const b of brackets) {
                    const teamId = b.picks.find((p) => p.matchId === match.id)?.teamId;
                    if (teamId !== undefined) counts.set(teamId, (counts.get(teamId) ?? 0) + 1);
                }
                return { matchId: match.id, picks: [...counts].map(([teamId, count]) => ({ teamId, count })) };
            }),
        };
    }
}
