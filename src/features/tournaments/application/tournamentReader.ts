import type { RealtimeNotifier, TournamentDetail } from '../../../shared/application/realtimeNotifier.js';
import { NotFoundError } from '../../../shared/domain/errors.js';
import type { TeamRepository } from '../../teams/application/ports.js';
import type { Team } from '../../teams/domain/team.js';
import type { Tournament } from '../domain/tournament.js';
import type { MatchRepository, TournamentRepository } from './ports.js';

/** Lectures partagées par les services, et diffusion de l'état à jour après une écriture. */
export class TournamentReader {
    private readonly tournaments: TournamentRepository;
    private readonly teams: TeamRepository;
    private readonly matches: MatchRepository;
    private readonly notifier: RealtimeNotifier;

    constructor(deps: { tournaments: TournamentRepository; teams: TeamRepository; matches: MatchRepository; notifier: RealtimeNotifier }) {
        this.tournaments = deps.tournaments;
        this.teams = deps.teams;
        this.matches = deps.matches;
        this.notifier = deps.notifier;
    }

    requireTournament(id: number): Tournament {
        const tournament = this.tournaments.findById(id);
        if (!tournament) throw new NotFoundError('TOURNAMENT_NOT_FOUND', 'Tournoi introuvable');
        return tournament;
    }

    requireTeam(id: number): { team: Team; tournament: Tournament } {
        const team = this.teams.findById(id);
        if (!team) throw new NotFoundError('TEAM_NOT_FOUND', 'Équipe introuvable');
        return { team, tournament: this.tournaments.findById(team.tournamentId)! };
    }

    getDetail(id: number): TournamentDetail {
        return {
            tournament: this.requireTournament(id),
            teams: this.teams.findByTournament(id),
            matches: this.matches.findByTournament(id),
        };
    }

    // B-19 : après chaque changement, ceux qui suivent le tournoi reçoivent son état complet
    publishTournament(id: number): void {
        if (this.tournaments.findById(id)) this.notifier.tournamentUpdated(this.getDetail(id));
    }

    publishTeam(id: number): void {
        const team = this.teams.findById(id);
        if (team) this.notifier.teamUpdated(team);
    }
}
