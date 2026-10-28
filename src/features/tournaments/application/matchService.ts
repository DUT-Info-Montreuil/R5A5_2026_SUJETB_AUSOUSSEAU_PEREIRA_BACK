import type { Logger, UnitOfWork } from '../../../shared/application/ports.js';
import type { RealtimeNotifier } from '../../../shared/application/realtimeNotifier.js';
import { NotFoundError } from '../../../shared/domain/errors.js';
import type { TeamRepository } from '../../teams/application/ports.js';
import { TEAM_SIZE, isComplete } from '../../teams/domain/team.js';
import {
    assertPlayable,
    assertSchedulable,
    loserOf,
    nextMatchSlot,
    opponentOf,
    startForfeitWinner,
    winnerByScore,
    type Match,
} from '../domain/bracket.js';
import type { MatchRepository, TournamentRepository } from './ports.js';
import type { TournamentReader } from './tournamentReader.js';

/** Ce qu'a produit une validation de match, à diffuser une fois la transaction terminée. */
export interface Decision {
    tournamentId: number;
    loserId: number;
    changedMatchIds: number[];
}

export class MatchService {
    private readonly matches: MatchRepository;
    private readonly teams: TeamRepository;
    private readonly tournaments: TournamentRepository;
    private readonly reader: TournamentReader;
    private readonly notifier: RealtimeNotifier;
    private readonly uow: UnitOfWork;
    private readonly logger: Logger;

    constructor(deps: {
        matches: MatchRepository;
        teams: TeamRepository;
        tournaments: TournamentRepository;
        reader: TournamentReader;
        notifier: RealtimeNotifier;
        uow: UnitOfWork;
        logger: Logger;
    }) {
        this.matches = deps.matches;
        this.teams = deps.teams;
        this.tournaments = deps.tournaments;
        this.reader = deps.reader;
        this.notifier = deps.notifier;
        this.uow = deps.uow;
        this.logger = deps.logger;
    }

    /** B-13 / B-14 : l'admin saisit le score, le gagnant avance. */
    recordResult(matchId: number, scores: { scoreA: number; scoreB: number }): Match {
        const decision = this.uow.run(() => {
            const match = this.requirePlayable(matchId);
            const winnerId = winnerByScore(match, scores.scoreA, scores.scoreB);
            return this.decide(match, winnerId, scores, false);
        });
        this.logger.info('match_result_recorded', { match: matchId, score_a: scores.scoreA, score_b: scores.scoreB });
        this.broadcast([decision]);
        this.reader.publishTournament(decision.tournamentId);
        return this.matches.findById(matchId)!;
    }

    /** B-15 : l'équipe déclarée forfait perd, son adversaire est qualifié. */
    declareForfeit(matchId: number, forfeitingTeamId: number): Match {
        const decision = this.uow.run(() => {
            const match = this.requirePlayable(matchId);
            const winnerId = opponentOf(match, forfeitingTeamId);
            return this.decide(match, winnerId, { scoreA: null, scoreB: null }, true);
        });
        this.logger.info('match_forfeit_declared', { match: matchId, team: forfeitingTeamId });
        this.broadcast([decision]);
        this.reader.publishTournament(decision.tournamentId);
        return this.matches.findById(matchId)!;
    }

    /** Horaire prévu, affiché aux joueurs (compte à rebours). `null` l'efface. */
    schedule(matchId: number, at: string | null): Match {
        const match = this.matches.findById(matchId);
        if (!match) throw new NotFoundError('MATCH_NOT_FOUND', 'Match introuvable');
        assertSchedulable(match);
        this.matches.schedule(matchId, at);
        const updated = this.matches.findById(matchId)!;
        this.notifier.matchUpdated(updated);
        this.reader.publishTournament(match.tournamentId);
        return updated;
    }

    /**
     * B-04 : au lancement, une équipe incomplète (moins de 5 joueurs, ou un joueur sans rôle)
     * perd son premier match par forfait. À appeler dans la transaction de lancement.
     */
    applyStartForfeits(tournamentId: number): Decision[] {
        const decisions: Decision[] = [];
        for (const match of this.matches.findByTournament(tournamentId).filter((m) => m.round === 1)) {
            // Une équipe de 5 dont un joueur n'a pas de rôle compte comme incomplète
            const sizeOf = (teamId: number) => {
                const team = this.teams.findById(teamId)!;
                return isComplete(team) ? TEAM_SIZE : Math.min(team.members.length, TEAM_SIZE - 1);
            };
            const winnerId = startForfeitWinner(match, sizeOf(match.teamAId!), sizeOf(match.teamBId!), TEAM_SIZE);
            if (winnerId !== null) decisions.push(this.decide(match, winnerId, { scoreA: null, scoreB: null }, true));
        }
        return decisions;
    }

    /** Après commit : matchs modifiés et fermeture du chat de l'éliminé (B-18). L'appelant publie le tournoi. */
    broadcast(decisions: Decision[]): void {
        for (const { loserId, changedMatchIds } of decisions) {
            for (const id of changedMatchIds) this.notifier.matchUpdated(this.matches.findById(id)!);
            this.reader.publishTeam(loserId);
            this.notifier.teamChatClosed(loserId);
        }
    }

    private requirePlayable(matchId: number): Match {
        const match = this.matches.findById(matchId);
        if (!match) throw new NotFoundError('MATCH_NOT_FOUND', 'Match introuvable');
        assertPlayable(match, this.tournaments.findById(match.tournamentId)!);
        return match;
    }

    private decide(
        match: Match,
        winnerId: number,
        scores: { scoreA: number | null; scoreB: number | null },
        isForfeit: boolean,
    ): Decision {
        const loserId = loserOf(match, winnerId);
        this.matches.finish(match.id, { winnerId, ...scores, isForfeit });
        this.teams.setEliminated(loserId);

        const changedMatchIds = [match.id];
        const next = nextMatchSlot(match);
        if (next) {
            const nextMatch = this.matches.findAt(match.tournamentId, next.round, next.position)!;
            this.matches.placeTeam(nextMatch.id, next.slot, winnerId);
            changedMatchIds.push(nextMatch.id);
        } else {
            this.tournaments.setStatus(match.tournamentId, 'finished');
            this.logger.info('tournament_finished', { tournament: match.tournamentId, winner: winnerId });
        }
        return { tournamentId: match.tournamentId, loserId, changedMatchIds };
    }
}
