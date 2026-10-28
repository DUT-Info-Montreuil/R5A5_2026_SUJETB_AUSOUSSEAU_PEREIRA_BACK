# 0002 Mécanisme de temps réel

Date : à compléter · Statut : à rédiger

<!-- Faits à disposition, à remplacer par votre rédaction -->
<!--
Besoins du sujet : B-16 chat d'équipe en direct, B-17 un exclu perd immédiatement l'accès, B-19 tournoi en direct
pour joueurs et spectateurs (même sans compte).
En place : Socket.IO. Salons tournament:<id> (ouverts à tous), team:<id> (droits revérifiés en base à chaque entrée),
user:<id> (notifications personnelles : member:kicked). Écritures uniquement en HTTP, le canal ne fait que notifier.
Jeton passé dans auth au handshake ; connexion fermée à l'expiration du jeton (session:expired) ; origine vérifiée.
Les services ne connaissent pas Socket.IO : ils appellent le port RealtimeNotifier (src/shared/application/realtimeNotifier.ts).
Options vues en cours (chapitre 4.10) : polling, SSE, WebSocket natif, Socket.IO. B-19 seul serait du SSE (un seul sens) ;
le chat demande des salons et un contrôle d'accès par salon.
Coûts à nommer : dépendance côté client et serveur, protocole propre (un client WebSocket natif ne peut pas s'y connecter),
plusieurs instances = adaptateur Redis à ajouter (chapitre 5.7), configuration du proxy (Upgrade, /socket.io/).
-->

## Le problème

## Les options

## Ce qu'on a choisi

## Ce que ça coûte
