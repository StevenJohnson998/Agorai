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

## 13. Message Metadata & Confidentiality (v0.4)

| # | Test | Type | Fichier test | Résultat attendu |
|---|------|------|-------------|-----------------|
| 13.1 | bridgeMetadata on normal send | [A] | `store.test.ts` | `bridgeMetadata` contient visibility, senderClearance, visibilityCapped=false, timestamp, instructions |
| 13.2 | bridgeMetadata on capped send | [A] | `store.test.ts` | `visibilityCapped=true`, `originalVisibility` présent quand visibility > clearance |
| 13.3 | agentMetadata round-trip | [A] | `store.test.ts` | agentMetadata envoyé par sender récupéré tel quel par getMessages |
| 13.4 | Anti-forge: strip _bridge keys | [A] | `store.test.ts` | Clés commençant par `_bridge` supprimées du metadata agent avant stockage |
| 13.5 | Null metadata graceful | [A] | `store.test.ts` | `null` metadata → `agentMetadata: null`, `bridgeMetadata` généré normalement |
| 13.6 | Strip all _bridge → null agentMetadata | [A] | `store.test.ts` | Si toutes les clés sont `_bridge*`, `agentMetadata` résultant = null |
| 13.7 | Project confidentiality default | [A] | `store.test.ts` | Projet créé sans mode → `confidentialityMode: "normal"` |
| 13.8 | Project confidentiality explicit | [A] | `store.test.ts` | Projet créé avec `strict` ou `flexible` → mode stocké correctement |
| 13.9 | Project confidentiality in retrieve | [A] | `store.test.ts` | `getProject()` retourne `confidentialityMode` |
| 13.10 | Bridge instructions — normal mode | [A] | `store.test.ts` | `bridgeMetadata.instructions.mode === "normal"`, instruction mentionne output visibility |
| 13.11 | Bridge instructions — flexible mode | [A] | `store.test.ts` | `bridgeMetadata.instructions.mode === "flexible"`, instruction autorise tout level |
| 13.12 | High-water mark tracking | [A] | `store.test.ts` | `getMessages()` crée/met à jour le high-water mark de l'agent pour le projet |
| 13.13 | High-water mark never decreases | [A] | `store.test.ts` | Lire des messages `public` après `confidential` → mark reste `confidential` |
| 13.14 | High-water mark null for unknown | [A] | `store.test.ts` | `getHighWaterMark()` retourne null pour agent/projet inconnu |
| 13.15 | High-water mark per-project | [A] | `store.test.ts` | Tracks séparément pour chaque projet |
| 13.16 | agentMetadata + bridgeMetadata in messages | [A] | `store.test.ts` | `handles message metadata (agentMetadata + bridgeMetadata)` — ancien test migré |
| 13.17 | Schema migration (existing DB) | [M] | — | Base existante v0.3 → les colonnes `agent_metadata`, `bridge_metadata`, `confidentiality_mode` ajoutées automatiquement, données `metadata` existantes migrées vers `agent_metadata` |
| 13.18 | Bridge: agentMetadata filtered per sender | [M] | — | Via MCP: `get_messages` retourne `agentMetadata` uniquement pour les messages du reader (pas ceux des autres agents) |
| 13.19 | Bridge: deprecated metadata excluded | [M] | — | Via MCP: réponse `get_messages` ne contient pas l'ancien champ `metadata` |

---

## 14. SSE Push Notifications (v0.3)

| # | Test | Type | Fichier test | Résultat attendu |
|---|------|------|-------------|-----------------|
| 14.1 | Notify subscribed (exclude sender) | [A] | `bridge-sse.test.ts` | Abonné reçoit notification, sender non |
| 14.2 | No notify unsubscribed | [A] | `bridge-sse.test.ts` | Agent non-abonné ne reçoit pas la notification |
| 14.3 | Visibility gating — team receives team | [A] | `bridge-sse.test.ts` | Agent `team` reçoit notification `team` |
| 14.4 | Visibility gating — team blocks confidential | [A] | `bridge-sse.test.ts` | Agent `team` ne reçoit PAS notification `confidential` |
| 14.5 | Visibility gating — confidential receives confidential | [A] | `bridge-sse.test.ts` | Agent `confidential` reçoit notification `confidential` |
| 14.6 | Content preview — truncated at 200 | [A] | `bridge-sse.test.ts` | Preview tronqué à 200 chars + `…` |
| 14.7 | Content preview — short not truncated | [A] | `bridge-sse.test.ts` | Message court non tronqué |
| 14.8 | Notification payload fields | [A] | `bridge-sse.test.ts` | Contient conversationId, messageId, fromAgent, type, visibility, preview |
| 14.9 | Multi-subscriber scenario | [A] | `bridge-sse.test.ts` | Plusieurs abonnés notifiés avec filtrage visibility correct |
| 14.10 | SSE E2E — curl stream | [M] | — | `curl -N -H "Authorization: Bearer <key>" http://127.0.0.1:3100/mcp` reçoit les notifications en temps réel quand un autre agent envoie un message |

---

## 15. Agent Management CLI & Config Manager

| # | Test | Type | Fichier test | Résultat attendu |
|---|------|------|-------------|-----------------|
| 15.1 | loadRawConfig preserves fields | [A] | `config-manager.test.ts` | Charge et préserve tous les champs JSON bruts |
| 15.2 | Config round-trip sans perte | [A] | `config-manager.test.ts` | save → load → identique |
| 15.3 | generatePassKey format | [A] | `config-manager.test.ts` | Base64url de longueur attendue |
| 15.4 | generatePassKey unique | [A] | `config-manager.test.ts` | Deux appels → clés différentes |
| 15.5 | addAgent — openai-compat | [A] | `config-manager.test.ts` | Ajouté dans `bridge.apiKeys` ET `agents[]` |
| 15.6 | addAgent — MCP type | [A] | `config-manager.test.ts` | Ajouté dans `bridge.apiKeys` SEULEMENT (pas `agents[]`) |
| 15.7 | addAgent — ollama | [A] | `config-manager.test.ts` | Ajouté dans les deux arrays |
| 15.8 | addAgent — duplicate rejeté | [A] | `config-manager.test.ts` | Throw si nom déjà existant |
| 15.9 | addAgent — default clearance team | [A] | `config-manager.test.ts` | Clearance par défaut = `team` |
| 15.10 | addAgent — crée bridge section si manquante | [A] | `config-manager.test.ts` | Config vide → section `bridge` créée automatiquement |
| 15.11 | listAgents — merge bridge + agents | [A] | `config-manager.test.ts` | Fusionne `bridge.apiKeys` et `agents[]` par nom |
| 15.12 | listAgents — empty config | [A] | `config-manager.test.ts` | Retourne tableau vide |
| 15.13 | listAgents — orphan agents | [A] | `config-manager.test.ts` | Agents dans `agents[]` mais pas dans `bridge.apiKeys` inclus |
| 15.14 | updateAgent — model | [A] | `config-manager.test.ts` | Met à jour le modèle dans `agents[]` |
| 15.15 | updateAgent — clearance | [A] | `config-manager.test.ts` | Met à jour le clearance dans `bridge.apiKeys` |
| 15.16 | updateAgent — multiple fields | [A] | `config-manager.test.ts` | Plusieurs champs mis à jour en une fois |
| 15.17 | updateAgent — unknown rejeté | [A] | `config-manager.test.ts` | Throw si agent inconnu |
| 15.18 | updateAgent — no changes rejeté | [A] | `config-manager.test.ts` | Throw si aucun changement spécifié |
| 15.19 | removeAgent — both arrays | [A] | `config-manager.test.ts` | Supprimé de `bridge.apiKeys` ET `agents[]` |
| 15.20 | removeAgent — MCP only | [A] | `config-manager.test.ts` | Supprimé de `bridge.apiKeys` uniquement |
| 15.21 | removeAgent — unknown rejeté | [A] | `config-manager.test.ts` | Throw si agent inconnu |
| 15.22 | removeAgent — preserve others | [A] | `config-manager.test.ts` | Les autres agents restent intacts |

---

## 16. agorai-connect

| # | Test | Type | Fichier test | Résultat attendu |
|---|------|------|-------------|-----------------|
| 16.1 | callModel — URL construction | [A] | `model-caller.test.ts` | Construit l'URL correcte depuis endpoint |
| 16.2 | callModel — Authorization header | [A] | `model-caller.test.ts` | Envoie `Authorization: Bearer` quand apiKey fourni |
| 16.3 | callModel — empty choices error | [A] | `model-caller.test.ts` | Throw sur réponse avec choices vide |
| 16.4 | callModel — /chat/completions detection | [A] | `model-caller.test.ts` | N'ajoute pas `/chat/completions` si déjà présent |
| 16.5 | callModel — HTTP error | [A] | `model-caller.test.ts` | Throw sur erreur HTTP |
| 16.6 | McpClient — initialize | [A] | `mcp-client.test.ts` | Envoie initialize, capture session ID |
| 16.7 | McpClient — tool calls | [A] | `mcp-client.test.ts` | Structure JSON-RPC correcte |
| 16.8 | McpClient — SSE responses | [A] | `mcp-client.test.ts` | Parse les réponses SSE |
| 16.9 | McpClient — JSON-RPC error | [A] | `mcp-client.test.ts` | Throw sur erreur JSON-RPC |
| 16.10 | McpClient — SessionExpiredError | [A] | `mcp-client.test.ts` | 404 + "Session not found" → SessionExpiredError |
| 16.11 | McpClient — BridgeUnreachableError | [A] | `mcp-client.test.ts` | Connection refused → BridgeUnreachableError |
| 16.12 | McpClient — resetSession | [A] | `mcp-client.test.ts` | Efface l'état de session |
| 16.13 | Backoff — exponential delays | [A] | `backoff.test.ts` | Délais exponentiels corrects |
| 16.14 | Backoff — max cap | [A] | `backoff.test.ts` | Plafonné à maxMs |
| 16.15 | Backoff — jitter | [A] | `backoff.test.ts` | Jitter dans la plage attendue |
| 16.16 | Backoff — reset on succeed | [A] | `backoff.test.ts` | `succeed()` remet le compteur à zéro |
| 16.17 | Backoff — wait increments | [A] | `backoff.test.ts` | `wait()` incrémente le failure count |
| 16.18 | SSE stream — push notifications | [A] | `sse-stream.test.ts` | Reçoit les notifications push via SSE |
| 16.19 | Config paths — platform detection | [A] | `config-paths.test.ts` | Retourne une plateforme valide |
| 16.20 | Config paths — Windows candidates | [A] | `config-paths.test.ts` | Inclut Windows Store path, ≥3 candidats, APPDATA en premier |
| 16.21 | Config paths — macOS/Linux | [A] | `config-paths.test.ts` | Application Support (macOS), .config (Linux) |
| 16.22 | Config paths — defaultConfigPath | [A] | `config-paths.test.ts` | Retourne un string pour chaque plateforme |
| 16.23 | Config paths — resolveNodePath | [A] | `config-paths.test.ts` | `node` sur non-windows, full path sur Windows |
| 16.24 | Config paths — searchClaudeConfig | [A] | `config-paths.test.ts` | Vide si pas de config, trouve les fichiers imbriqués |
| 16.25 | URL utils — normalizeBridgeUrl | [A] | `utils.test.ts` | Ajoute `/mcp`, strip trailing slash, https, multi-slash |
| 16.26 | URL utils — baseUrl | [A] | `utils.test.ts` | Strip `/mcp`, `/mcp/`, trailing slashes |

---

## Historique des exécutions

| Date | Version | Tests auto | Tests manuels | Résultat | Notes |
|------|---------|-----------|--------------|---------|-------|
| 2026-02-28 | v0.2.3 | 170/170 ✅ | — | PASS | Première exécution TNR. Tests manuels 11.x/12.x à faire pré-release |
| 2026-03-01 | v0.4.0 | 222/222 ✅ + 62/62 ✅ | SSE E2E ✅ | PASS | Ajout sections 13-16. agorai 222 tests, agorai-connect 62 tests. SSE testé E2E (curl instant, Claude Desktop polling ~8s) |

---

## Notes

- Les tests `[A]` sont exécutés automatiquement par `npx vitest run`
- Les tests `[M]` nécessitent un bridge actif avec config valide + au moins un modèle disponible (Ollama recommandé)
- Les tests `[S]` sont des commandes shell à exécuter manuellement mais vérifiables par script
- Mettre à jour ce fichier à chaque ajout de feature, nouvelle version, ou bug corrigé
- agorai-connect a ses propres 62 tests dans `packages/agorai-connect/` — détaillés en section 16
- Les tests manuels `[M]` de la section 13 (13.17-13.19) nécessitent un bridge actif et deux agents connectés
- Les gaps identifiés (schema migration, bridge-level agentMetadata filtering, deprecated metadata exclusion) sont couverts par les tests manuels 13.17-13.19
