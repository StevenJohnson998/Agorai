# TNR — Tests de Non-Régression

Fichier vivant. Mis à jour à chaque livraison majeure.
Chaque section = un domaine fonctionnel. Chaque ligne = un scénario à valider.

**Légende** : `[A]` = automatisé (vitest), `[M]` = manuel, `[S]` = semi-auto (script ou commande à lancer)

---

## 1. Build & Packaging

| # | Test | Type | Commande / Procédure | Résultat attendu |
|---|------|------|---------------------|-----------------|
| 1.1 | TypeScript compile | [S] | `npx tsc --noEmit` | Zero erreurs |
| 1.2 | Unit tests pass | [S] | `npx vitest run` | Tous les tests passent |
| 1.3 | npm pack (agorai) | [S] | `npm pack --dry-run` | Contient dist/, README.md, LICENSE. Pas de node_modules, data/, .env |
| 1.4 | npm pack (agorai-connect) | [S] | `cd packages/agorai-connect && npm pack --dry-run` | Contient dist/, README.md. Pas de src/, tests |
| 1.5 | package.json exports | [S] | `node -e "import('agorai').then(m => console.log(Object.keys(m)))"` | Exporte SqliteStore, startBridgeServer, createAdapter, etc. |
| 1.6 | Version coherence | [M] | Vérifier `package.json` version, `cli.ts` version string, CHANGELOG | Tous en accord |

---

## 2. Store SQLite

| # | Test | Type | Fichier test | Résultat attendu |
|---|------|------|-------------|-----------------|
| 2.1 | Agent CRUD | [A] | `store.test.ts` | register, re-register update, getByApiKey, list, remove, lastSeen |
| 2.2 | Project CRUD + visibility | [A] | `store.test.ts` | create, list filtré par clearance, getProject caché si clearance insuffisante |
| 2.3 | Memory CRUD + filters | [A] | `store.test.ts` | create, retrieve, filter by type/tags, visibility, limit après filtre, delete |
| 2.4 | Conversations + messages | [A] | `store.test.ts` | create conv, subscribe/unsubscribe, send/get messages, visibility, read tracking |
| 2.5 | Visibility capping | [A] | `store.test.ts` | Message envoyé avec visibility > clearance → cappé au clearance du sender |
| 2.6 | Limit après filtre | [A] | `store.test.ts` | limit appliqué après le filtre visibility (pas avant) |
| 2.7 | Message metadata JSON | [A] | `store.test.ts` | Metadata stockée et récupérée correctement (nested objects) |
| 2.8 | Since timestamp filter | [A] | `store.test.ts` | getMessages avec `since` retourne uniquement les messages après le timestamp |

---

## 3. Auth & Security

| # | Test | Type | Fichier test | Résultat attendu |
|---|------|------|-------------|-----------------|
| 3.1 | Hash sans salt | [A] | `auth.test.ts` | SHA-256 consistent, hashes différents pour clés différentes |
| 3.2 | Hash avec salt (HMAC) | [A] | `auth.test.ts` | HMAC-SHA-256, même salt = même hash, salt différent = hash différent |
| 3.3 | Auth valide | [A] | `auth.test.ts` | Clé valide → authenticated, agentId, agentName, clearanceLevel |
| 3.4 | Auth rejetée | [A] | `auth.test.ts` | Clé invalide/vide → authenticated: false, error message |
| 3.5 | Auto-registration | [A] | `auth.test.ts` | Premier auth crée l'agent dans le store |
| 3.6 | Clearance per key | [A] | `auth.test.ts` | Chaque clé retourne le bon clearanceLevel |
| 3.7 | LastSeen update | [A] | `auth.test.ts` | lastSeenAt mis à jour à chaque auth |

---

## 4. Bridge — Data Isolation

| # | Test | Type | Fichier test | Résultat attendu |
|---|------|------|-------------|-----------------|
| 4.1 | Round-trip complet | [A] | `bridge-integration.test.ts` | register → project → conversation → messages → read |
| 4.2 | Visibility cross-agent | [A] | `bridge-integration.test.ts` | Agent externe voit uniquement les données public |
| 4.3 | Memory visibility | [A] | `bridge-integration.test.ts` | Memory respecte la visibility entre agents |
| 4.4 | Write capping | [A] | `bridge-integration.test.ts` | Visibility cappée → pas d'escalade de privilège |
| 4.5 | delete_memory ownership | [A] | `bridge-integration.test.ts` | Agent ne peut pas supprimer la mémoire d'un autre |
| 4.6 | set_memory project access | [A] | `bridge-integration.test.ts` | Agent ne peut pas écrire dans un projet au-dessus de sa clearance |
| 4.7 | create_conversation access | [A] | `bridge-integration.test.ts` | Agent ne peut pas créer de conversation dans un projet inaccessible |
| 4.8 | subscribe access | [A] | `bridge-integration.test.ts` | Agent ne peut pas s'abonner à une conversation d'un projet inaccessible |
| 4.9 | get_messages subscription | [A] | `bridge-integration.test.ts` | Agent non-abonné bloqué par isSubscribed |
| 4.10 | send_message subscription | [A] | `bridge-integration.test.ts` | Agent non-abonné ne peut pas envoyer de message |
| 4.11 | list_subscribers subscription | [A] | `bridge-integration.test.ts` | Agent non-abonné ne peut pas lister les abonnés |
| 4.12 | list_agents project filter | [A] | `bridge-integration.test.ts` | project_id filtre aux agents abonnés dans ce projet |
| 4.13 | Erreurs opaques | [A] | `bridge-integration.test.ts` | Toutes les erreurs retournent "Not found or access denied" |

---

## 5. Bridge Tool Schemas

| # | Test | Type | Fichier test | Résultat attendu |
|---|------|------|-------------|-----------------|
| 5.1 | RegisterAgent validation | [A] | `bridge-tools.test.ts` | Accepte input valide, applique defaults, rejette sans name |
| 5.2 | CreateProject validation | [A] | `bridge-tools.test.ts` | Accepte input valide, rejette visibility invalide |
| 5.3 | SetMemory validation | [A] | `bridge-tools.test.ts` | Accepte full input, applique defaults |
| 5.4 | SendMessage validation | [A] | `bridge-tools.test.ts` | Accepte input valide, defaults, tous types, rejette type invalide |
| 5.5 | GetMessages validation | [A] | `bridge-tools.test.ts` | Accepte filtres, rejette limit hors range |
| 5.6 | Subscribe validation | [A] | `bridge-tools.test.ts` | Default history=full, accepte from_join |
| 5.7 | Size limits | [A] | `bridge-tools.test.ts` | Rejette: name >200, content >100KB, memory >50KB, tags >20, capabilities >20, tag >50 chars |
| 5.8 | Schemas minimaux | [A] | `bridge-tools.test.ts` | ListAgents, ListProjects, GetStatus, DeleteMemory, etc. — champs requis validés |

---

## 6. Internal Agent

| # | Test | Type | Fichier test | Résultat attendu |
|---|------|------|-------------|-----------------|
| 6.1 | Discovery + subscription | [A] | `internal-agent.test.ts` | Agent découvre les conversations et s'y abonne |
| 6.2 | Active mode response | [A] | `internal-agent.test.ts` | Agent répond aux messages non-lus |
| 6.3 | Passive mode — no mention | [A] | `internal-agent.test.ts` | Agent ignore les messages sans @mention |
| 6.4 | Passive mode — with mention | [A] | `internal-agent.test.ts` | Agent répond quand @mentionné |
| 6.5 | Self-filtering | [A] | `internal-agent.test.ts` | Agent ne répond pas à ses propres messages (pas de boucle) |
| 6.6 | Mark read after success | [A] | `internal-agent.test.ts` | Messages marqués lus seulement après envoi réussi |
| 6.7 | No mark read on failure | [A] | `internal-agent.test.ts` | Messages restent non-lus si l'adapter échoue (retry au prochain poll) |
| 6.8 | Graceful shutdown | [A] | `internal-agent.test.ts` | AbortSignal arrête proprement le loop en <2s |

---

## 7. Debate Engine

| # | Test | Type | Fichier test | Résultat attendu |
|---|------|------|-------------|-----------------|
| 7.1 | Debate with mocks | [A] | `integration.test.ts` | Debate complète avec mock adapters |
| 7.2 | Protocol selection — vote | [A] | `integration.test.ts` | Questions de comparaison → VoteConsensus |
| 7.3 | Protocol selection — quorum | [A] | `integration.test.ts` | Questions de sécurité → QuorumConsensus |
| 7.4 | Persona bonuses | [A] | `integration.test.ts` | Bonus de persona appliqué au consensus |
| 7.5 | Dissent detection | [A] | `integration.test.ts` | Dissent inclus dans le résultat quand applicable |
| 7.6 | All agents fail | [A] | `integration.test.ts` | Abort propre quand tous les agents échouent |
| 7.7 | Multi-round debate | [A] | `integration.test.ts` | Plusieurs rounds exécutés correctement |
| 7.8 | computeMaxRounds | [A] | `orchestrator.test.ts` | Valeur explicite, quick mode, low/medium/high thoroughness |
| 7.9 | Budget estimation | [A] | `orchestrator.test.ts` | Estimation correcte, flag over-budget |

---

## 8. Consensus

| # | Test | Type | Fichier test | Résultat attendu |
|---|------|------|-------------|-----------------|
| 8.1 | VoteConsensus — highest confidence | [A] | `consensus.test.ts` | Sélectionne la réponse avec la plus haute confiance |
| 8.2 | VoteConsensus — persona bonus | [A] | `consensus.test.ts` | Bonus de persona pondère le score |
| 8.3 | VoteConsensus — threshold | [A] | `consensus.test.ts` | Filtre sous le seuil de confiance |
| 8.4 | VoteConsensus — dissent | [A] | `consensus.test.ts` | Dissent quand les poids sont proches |
| 8.5 | DebateConsensus | [A] | `consensus.test.ts` | Highest-weighted, lower dissent threshold (30%) |

---

## 9. Personas, Config, Adapters, Logging

| # | Test | Type | Fichier test | Résultat attendu |
|---|------|------|-------------|-----------------|
| 9.1 | Persona resolution | [A] | `personas.test.ts` | Built-in, custom, override, multi-resolve, system prompt building |
| 9.2 | Config parsing | [A] | `config.test.ts` | Defaults, full config, validation errors, data dir resolution |
| 9.3 | Adapter factory | [A] | `adapters.test.ts` | Ollama, Claude, Gemini, OpenAI-compat, auto-detect, explicit type, errors |
| 9.4 | Confidence extraction | [A] | `confidence.test.ts` | Parse [confidence: X.XX], case insensitive, default 0.5 |
| 9.5 | Timeout calculation | [A] | `confidence.test.ts` | CLI vs HTTP base, caps correctes |
| 9.6 | Logger | [A] | `logger.test.ts` | Log levels, truncation |
| 9.7 | Sensitive data scan | [A] | `memory.test.ts` | Détecte emails, API keys, IPs. Clean text → vide |

---

## 10. CLI

| # | Test | Type | Commande | Résultat attendu |
|---|------|------|---------|-----------------|
| 10.1 | Help | [S] | `node dist/cli.js --help` | Affiche usage avec toutes les commandes dont `agent` et `serve` |
| 10.2 | Version | [S] | `node dist/cli.js --version` | Affiche la version cohérente avec package.json |
| 10.3 | Init | [S] | `node dist/cli.js init` (dans un tmp dir) | Crée agorai.config.json avec defaults |
| 10.4 | Agent — no adapter | [S] | `node dist/cli.js agent` | Erreur: --adapter is required |
| 10.5 | Agent — unknown adapter | [S] | `node dist/cli.js agent --adapter nonexistent` | Erreur: Unknown agent |
| 10.6 | Serve — no bridge config | [S] | `node dist/cli.js serve` (sans bridge dans config) | Erreur: bridge not configured |
| 10.7 | Serve — with-agent unknown | [S] | `node dist/cli.js serve --with-agent nonexistent` | Erreur: Unknown agent |

---

## 11. Tests d'intégration manuels (pré-release)

| # | Test | Type | Procédure | Résultat attendu |
|---|------|------|----------|-----------------|
| 11.1 | Bridge startup | [M] | `agorai serve` avec config valide | Bridge démarre, affiche endpoint/health/agents/db |
| 11.2 | Health endpoint | [M] | `curl http://127.0.0.1:3100/health` | JSON avec status, uptime, version |
| 11.3 | Agent connect (agorai-connect) | [M] | Lancer un agent agorai-connect avec Ollama | Agent se connecte, discover, subscribe |
| 11.4 | Internal agent (--with-agent) | [M] | `agorai serve --with-agent ollama` | Bridge démarre + agent interne polls, heartbeat visible |
| 11.5 | Internal agent standalone | [M] | `agorai agent --adapter ollama --mode active` | Agent démarre, polls, heartbeat |
| 11.6 | Multi-agent conversation | [M] | 2+ agents connectés, envoyer un message depuis un | L'autre agent répond, messages dans le bon ordre |
| 11.7 | Passive mode @mention | [M] | Agent en passive, envoyer message sans/avec @mention | Ignore sans @mention, répond avec @mention |
| 11.8 | Session recovery | [M] | Restart bridge pendant qu'un agent tourne | Agent reconnecte avec backoff |
| 11.9 | Graceful shutdown | [M] | Ctrl+C sur `agorai serve --with-agent` | Bridge + agents s'arrêtent proprement |
| 11.10 | Debate CLI | [M] | `agorai debate "test" --agents ollama` | Debate complète avec résultat et consensus |

---

## 12. Sécurité (pré-release)

| # | Test | Type | Procédure | Résultat attendu |
|---|------|------|----------|-----------------|
| 12.1 | Auth sans clé | [M] | `curl -X POST http://127.0.0.1:3100/mcp` (sans Authorization) | 401 Unauthorized |
| 12.2 | Auth mauvaise clé | [M] | `curl -H "Authorization: Bearer wrong"` | 401 Invalid API key |
| 12.3 | Rate limit | [M] | 121+ requêtes en <60s | 429 Too Many Requests + Retry-After header |
| 12.4 | Body size limit | [M] | Envoyer un body >512KB | 413 Payload Too Large |
| 12.5 | Cross-agent isolation | [M] | Agent A crée un projet confidential, Agent B (team) tente d'y accéder | Not found or access denied |

---

## Historique des exécutions

| Date | Version | Tests auto | Tests manuels | Résultat | Notes |
|------|---------|-----------|--------------|---------|-------|
| 2026-02-28 | v0.2.3 | 170/170 ✅ | — | PASS | Première exécution TNR. Tests manuels 11.x/12.x à faire pré-release |

---

## Notes

- Les tests `[A]` sont exécutés automatiquement par `npx vitest run`
- Les tests `[M]` nécessitent un bridge actif avec config valide + au moins un modèle disponible (Ollama recommandé)
- Les tests `[S]` sont des commandes shell à exécuter manuellement mais vérifiables par script
- Mettre à jour ce fichier à chaque ajout de feature, nouvelle version, ou bug corrigé
- agorai-connect a ses propres 45 tests dans `packages/agorai-connect/` (non détaillés ici — voir son propre test runner)
