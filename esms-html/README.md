# ESMS — HTML, CSS et JavaScript

Interface native sans React, Next.js, TypeScript, Tailwind ou compilation. Serveur Node.js JavaScript pour les comptes, les permissions et les documents privés. Version précédente conservée dans le dossier voisin `esms`.

## Démarrage

Installer Node.js 24 ou plus récent, puis depuis ce dossier :

```sh
npm install
npm start
```

Ouvrir http://127.0.0.1:3000/register pour créer un compte, ou /login pour se connecter. `pnpm install --frozen-lockfile` fonctionne aussi avec le verrou fourni. Aucun `build` nécessaire. Ne pas ouvrir index.html directement : les comptes nécessitent le serveur.

## Fonctionnalités

- Inscription membre : identifiant unique, prénom, nom, filière, année universitaire, photo et plusieurs cellules.
- Cellules : Event, Sponsoring, Communication, Média, Design, Soirée et Show, Logistique, Jeux et Sport.
- Connexion par nom d’utilisateur et mot de passe ; modification du profil et du mot de passe.
- Missions assignées, échéances et statuts ; réunions et présences gérées par les responsables.
- Documents privés importés par l’administrateur, autorisations individuelles, téléchargement et révocation.
- Administration des rôles et activation des comptes, journal d’activité.

## Premier administrateur local

Créer son compte sur le site, arrêter le serveur, puis :

```sh
npm run admin -- promote votre.identifiant
npm start
```

Tous les nouveaux comptes sont membres. Aucun mot de passe administrateur prédéfini. L’outil de maintenance accepte également `reset-password identifiant` avec le nouveau mot de passe fourni par entrée standard. Arrêter le serveur avant toute maintenance : la base locale est utilisée par un seul processus.

## Stockage local et sauvegardes

Sans configuration, PostgreSQL embarqué PGlite conserve les données dans `.esms-data/database`, y compris les photos et documents. Les règles SQL RLS s’appliquent aux opérations applicatives. Les mots de passe sont salés et hachés par scrypt ; les sessions locales sont opaques, hachées en base, expirent après sept jours et utilisent un cookie HttpOnly/SameSite=Lax. Les changements de mot de passe révoquent les anciennes sessions locales. Les photos sont décodées, redimensionnées et réencodées sans métadonnées.

Sauvegarder tout `.esms-data` serveur arrêté. Le ZIP ne contient ni comptes, ni fichiers privés, ni dépendances. Pour reprendre une base de l’ancienne version, arrêter les deux serveurs et copier son `.esms-data` ici, ou définir `ESMS_DATA_DIR` vers son répertoire existant. Ne jamais ouvrir la même base avec deux processus. Les données locales ne sont pas automatiquement transférées vers Supabase.

## Supabase facultatif

Copier `.env.example` vers `.env`, renseigner SUPABASE_URL et SUPABASE_PUBLISHABLE_KEY, puis exécuter dans Supabase, dans l’ordre, les deux fichiers de `supabase/migrations/`. Activer les inscriptions email/password et désactiver la confirmation email : l’application utilise un identifiant et une adresse interne `identifiant@members.esms.invalid`, qui ne reçoit pas de mail. La récupération de compte est donc administrative. Le premier rôle admin peut être attribué via SQL dans le projet Supabase par son propriétaire.

Le navigateur parle uniquement au serveur ESMS ; celui-ci utilise la clé publique Supabase et les JWT de chaque membre, jamais une clé service-role. Les sessions Supabase sont conservées dans la base locale privée du serveur et référencées par un cookie opaque. Protéger ce répertoire et ses sauvegardes. Les règles RLS gouvernent les tables et le stockage privé. Les photos sont visibles par leur propriétaire et les responsables. Les documents nécessitent un accès individuel, même pour les responsables ; les administrateurs ont accès à tous.

L’adaptateur Supabase est inclus, mais aucune connexion à un projet Supabase distant n’a été validée dans cette livraison. Le fonctionnement local et les migrations/RLS ont été testés. Cette livraison est locale, non déployée.

## Fichiers à modifier

- `public/index.html` : document HTML et chargement des ressources.
- `public/app.js` : formulaires HTML, navigation, appels API et vues en JavaScript natif.
- `public/styles.css` : styles CSS natifs et adaptation mobile.
- `server.js` : routes HTTP explicites et contrôle des permissions.
- `server/` : validation, comptes, stockage et adaptateurs local/Supabase.
- `supabase/migrations/` : schéma PostgreSQL, fonctions et RLS.
- `tests/` : tests unitaires, sécurité SQL et parcours HTTP.

## Vérification

```sh
npm test
```

21 tests réussis : validation, images, permissions RLS, anti-usurpation, documents privés, inscription HTTP, protection d’origine, connexion, persistance après redémarrage, missions, présences et fichiers. Les tests créent des bases temporaires distinctes puis les retirent. Le test HTTP utilise le port 3107.

## Configuration d’hébergement

Par défaut, écoute uniquement sur 127.0.0.1:3000. Pour un hébergement, configurer HOST/PORT, APP_ORIGIN à l’origine HTTPS exacte, COOKIE_SECURE=true et un proxy HTTPS. Les mutations exigent l’origine exacte et un en-tête personnalisé. Utiliser un seul processus par base PGlite, protéger les sauvegardes et prévoir une limitation des requêtes au proxy. Les limites de connexion locales sont persistantes ; Supabase applique ses propres limites. La récupération de mot de passe par email et les notifications ne sont pas incluses.

## Identité visuelle
Palette noir, rouge #D6202A et blanc, confirmée par le propriétaire. Écusson repris de https://ensem-sport.club/logo-invert.png et palette de https://ensem-sport.club/styles.css ; sources consultées le 25 octobre 2026. Le fichier du logo est servi localement sans appel externe du navigateur.

