const {spawn} = require('child_process');
const os = require('os');

// La rédaction passe par Claude Code en mode non interactif (`claude -p`), authentifié
// avec l'abonnement claude.ai via CLAUDE_CODE_OAUTH_TOKEN (généré par `claude setup-token`).
const CLAUDE_BIN = process.env.CLAUDE_CODE_PATH || 'claude';
const MODEL = 'opus';
const TIMEOUT_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 2;

const CATEGORY_KEYS = ['cinema', 'films', 'series', 'tendances'];

const SYSTEM_PROMPT = `Tu prépares le récap hebdomadaire de l'actualité films et séries pour une communauté Discord francophone.

Tu reçois en JSON les données collectées sur la période (TMDB et Trakt), déjà rangées par catégorie. Chaque titre a un champ "id".

Le récap est publié en 4 messages, un par catégorie (clé "categorie") :
- "cinema" : les sorties en salle de la semaine (données "sorties_cine").
- "films" : les sorties en VOD / numérique et les films attendus prochainement au cinéma (données "films").
- "series" : nouvelles séries, retours de saison, renouvellements, annulations et fins de série (données "series").
- "tendances" : les titres les plus populaires ou les plus attendus du moment, films comme séries (données "tendances").
N'inclus que les catégories qui ont du contenu.

Longueur : l'ensemble des 4 catégories doit se lire en 2 minutes environ, soit 400 à 450 mots au total (introductions et textes compris), répartis selon la richesse de chaque catégorie.

Sélection :
- 3 à 6 titres par catégorie. Privilégie ce qui intéresse le plus de monde : grosses sorties, séries populaires, renouvellement ou annulation d'une série connue. Un signal fort de popularité (rang élevé, présent sur plusieurs listes, popularité TMDB élevée) compte plus qu'une sortie confidentielle.
- Un titre n'apparaît qu'une seule fois dans tout le récap, dans la catégorie la plus pertinente.
- Classe les titres du plus marquant au moins marquant : l'image du premier illustre la catégorie.

Pour chaque catégorie :
- "introduction" : une à deux phrases (30 mots maximum) qui donnent le ton de la catégorie cette semaine, sans lister les titres.
- "elements" : pour chaque titre, son "id" et un "texte" de 20 à 40 mots, en français, sans répéter le titre (il est affiché automatiquement). Dis de quoi ça parle et pourquoi c'est notable cette semaine : date de sortie (format court, ex. « mer. 22 oct. »), saison, renouvellement ou annulation, note, popularité. Pour les séries, précise toujours de quoi il s'agit (nouvelle série, saison N, renouvelée, annulée, terminée).

Règles :
- Ne mentionne jamais de plateforme de streaming, de chaîne ni de service de diffusion.
- N'invente rien : uniquement ce qui figure dans les données (le synopsis peut être reformulé).
- Ton vivant et accessible, phrases complètes, pas de liste à puces dans les textes.

Réponds uniquement avec l'objet JSON demandé, sans texte autour.`;

const OUTPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['categories'],
    properties: {
        categories: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['categorie', 'introduction', 'elements'],
                properties: {
                    categorie: {type: 'string', enum: CATEGORY_KEYS},
                    introduction: {type: 'string'},
                    elements: {
                        type: 'array',
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            required: ['id', 'texte'],
                            properties: {
                                id: {type: 'string'},
                                texte: {type: 'string'},
                            },
                        },
                    },
                },
            },
        },
    },
};

function runClaude(input) {
    const args = [
        '-p', 'Rédige le récap à partir des données JSON fournies en entrée.',
        '--output-format', 'json',
        '--json-schema', JSON.stringify(OUTPUT_SCHEMA),
        '--system-prompt', SYSTEM_PROMPT,
        '--model', MODEL,
        '--effort', 'medium',
        // Pure rédaction : aucun outil, aucun serveur MCP, aucune session conservée
        '--tools', '',
        '--strict-mcp-config',
        '--no-session-persistence',
        '--max-turns', '3',
    ];

    return new Promise((resolve, reject) => {
        // Lancé hors du dossier du bot pour ne charger ni CLAUDE.md ni config de projet
        const child = spawn(CLAUDE_BIN, args, {cwd: os.tmpdir(), env: process.env});
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => child.kill('SIGTERM'), TIMEOUT_MS);

        child.stdout.on('data', chunk => { stdout += chunk; });
        child.stderr.on('data', chunk => { stderr += chunk; });
        child.on('error', e => {
            clearTimeout(timer);
            reject(e.code === 'ENOENT'
                ? new Error(`Claude Code introuvable (« ${CLAUDE_BIN} »). Installe-le ou renseigne CLAUDE_CODE_PATH.`)
                : e);
        });
        child.on('close', code => {
            clearTimeout(timer);
            // En cas d'échec dans la session (auth, quota…), Claude Code écrit quand même le résultat JSON sur stdout
            let output;
            try {
                output = JSON.parse(stdout);
            } catch {
                reject(new Error(`Claude Code a échoué (code ${code}) : ${(stderr || stdout).trim().slice(0, 500)}`));
                return;
            }
            if (output.is_error || code !== 0) {
                reject(new Error(`Claude Code a échoué (code ${code}) : ${String(output.result ?? stderr).slice(0, 500)}`));
                return;
            }
            resolve(output);
        });

        child.stdin.end(input);
    });
}

function isValidRecap(recap) {
    return Array.isArray(recap?.categories)
        && recap.categories.every(c => CATEGORY_KEYS.includes(c.categorie)
            && typeof c.introduction === 'string'
            && Array.isArray(c.elements)
            && c.elements.every(e => typeof e.id === 'string' && typeof e.texte === 'string'));
}

function extractRecap(output) {
    if (output.structured_output) return output.structured_output;
    // Repli si la sortie structurée est absente : le JSON est dans le texte de la réponse
    const text = String(output.result ?? '').replace(/^```(?:json)?\s*|\s*```$/g, '');
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

// Renvoie {categories: [{categorie, introduction, elements: [{id, texte}]}]}
async function writeRecap(payload) {
    let lastError;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            const recap = extractRecap(await runClaude(JSON.stringify(payload)));
            if (isValidRecap(recap)) return recap;
            lastError = new Error('Réponse de Claude Code mal formée');
        } catch (e) {
            lastError = e;
        }
        console.error(`[Recap] Rédaction, tentative ${attempt}/${MAX_ATTEMPTS} échouée :`, lastError.message);
    }
    throw lastError;
}

module.exports = {writeRecap};
