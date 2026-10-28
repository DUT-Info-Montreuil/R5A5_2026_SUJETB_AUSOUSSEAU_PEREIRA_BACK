# 0003 Format et destination des logs

Date : à compléter · Statut : à rédiger

<!-- Faits à disposition, à remplacer par votre rédaction -->
<!--
En place : pino, JSON Lines sur la sortie standard. Une ligne par requête écrite par un middleware branché en premier ;
erreurs 500 : une ligne à part avec la pile, reliée par request_id ; événements métier écrits par les use cases via le port
Logger (ils ne connaissent pas pino). Niveaux DEBUG / INFO / WARNING / ERROR / CRITICAL, 4xx en WARNING, 5xx en ERROR.
request_id aussi renvoyé au client (header X-Request-Id) et propagé aux logs métier (AsyncLocalStorage).
Exclus : corps de requête, mots de passe, jetons, emails, adresse IP (donnée personnelle sans besoin identifié).
Options de format vues en cours (chapitre 2.5) : texte, texte à séparateurs, JSON Lines.
Options de destination (chapitre 2.6) : console, fichiers avec rotation, base de données, plateforme centralisée, service cloud.
Le sujet dit que l'hébergeur (service informatique de l'université) n'est pas connu : la sortie standard laisse le choix
de la destination à l'exploitation sans toucher au code.
Coûts à nommer : rien n'est conservé sans collecte en aval ; durée de conservation et rotation à fixer avec l'hébergeur.
-->

## Le problème

## Les options

## Ce qu'on a choisi

## Ce que ça coûte
