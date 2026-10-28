# 0001 Base de données

Date : à compléter · Statut : à rédiger

<!-- Faits à disposition, à remplacer par votre rédaction -->
<!--
En place : SQLite (better-sqlite3), un fichier data/arch-rivals.db, schéma sql/schema.sqlite.sql en tables STRICT,
contraintes en base (UNIQUE, CHECK, clés étrangères, index unique partiel « un seul capitaine par équipe »).
Accès isolé dans les repositories (src/features/*/infrastructure/sqlite*.ts) derrière des interfaces (application/ports.ts) :
passer à PostgreSQL ne touche que ces fichiers et le composition root.
Le commit d2f0edf parle d'un SQLite « provisoire avant passage en PostgreSQL » : la décision est à trancher ici.
Questions à traiter : volume réel (quelques tournois par semestre), une seule instance ou plusieurs, hébergement inconnu,
installation sans serveur de base pour le correcteur, écritures concurrentes (WAL), sauvegarde (copie d'un fichier).
Coûts à nommer : une seule machine (pas de réplication), un écrivain à la fois, migration à prévoir si l'association grandit.
-->

## Le problème

## Les options

## Ce qu'on a choisi

## Ce que ça coûte
