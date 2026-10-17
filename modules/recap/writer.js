const {spawn} = require('child_process');
const os = require('os');

// La rédaction passe par Claude Code en mode non interactif (`claude -p`), authentifié
// avec l'abonnement claude.ai via CLAUDE_CODE_OAUTH_TOKEN (généré par `claude setup-token`).
const CLAUDE_BIN = process.env.CLAUDE_CODE_PATH || 'claude';
const MODEL = 'opus';
const TIMEOUT_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 2;

const SECTION_KEYS = ['cinema', 'vod', 'series', 'renouvellements', 'annulations', 'tendances', 'a_venir'];

const SYSTEM_PROMPT = `Tu prépares le récap hebdomadaire de l'actualité films et séries pour une communauté Discord francophone.

Tu reçois en JSON les données collectées sur la période (TMDB et Trakt) : sorties cinéma, sorties VOD, films à venir, nouvelles séries, retours de saison, renouvellements, annulations, fins de série, tendances et titres les plus attendus. Chaque titre a un champ "id".

Sélection :
- 10 à 12 titres au total, 4 au maximum par section. Privilégie ce qui intéresse le plus de monde : grosses sorties, séries populaires, renouvellement ou annulation d'une série connue. Un signal fort de popularité (rang élevé, présent sur plusieurs listes, popularité TMDB élevée) compte plus qu'une sortie confidentielle.
- Un titre n'apparaît qu'une seule fois, dans la section la plus pertinente.

Sections (clé "section") : "cinema" (sorties en salle), "vod" (sorties numériques), "series" (nouvelles séries et retours de saison), "renouvellements", "annulations" (annulations et fins de série), "tendances" (populaires ou très attendus du moment), "a_venir" (films qui sortent bientôt). N'inclus que les sections qui ont du contenu.

Pour chaque titre, donne son "id" et une accroche "info" :
- 60 caractères maximum, en français, sans répéter le titre (il est affiché automatiquement).
- Une seule info utile : la date (format court, ex. « mer. 22 oct. »), la saison (ex. « Saison 3 »), ou en quelques mots pourquoi c'est notable.
- Ne mentionne jamais de plateforme de streaming, de chaîne ni de service de diffusion.
- N'invente rien : uniquement ce qui figure dans les données.

"introduction" : une phrase de 150 caractères maximum qui donne le ton de la semaine, sans lister de titres.
"a_la_une" : l'id du titre le plus marquant de la période, dont l'affiche illustrera le message.

Réponds uniquement avec l'objet JSON demandé, sans texte autour.`;

const OUTPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['introduction', 'sections', 'a_la_une'],
    properties: {
        introduction: {type: 'string'},
        sections: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['section', 'elements'],
                properties: {
                    section: {type: 'string', enum: SECTION_KEYS},
                    elements: {
                        type: 'array',
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            required: ['id', 'info'],
                            properties: {
                                id: {type: 'string'},
                                info: {type: 'string'},
                            },
                        },
                    },
                },
            },
        },
        a_la_une: {type: 'string'},
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
    return typeof recap?.introduction === 'string'
        && typeof recap.a_la_une === 'string'
        && Array.isArray(recap.sections)
        && recap.sections.every(s => SECTION_KEYS.includes(s.section) && Array.isArray(s.elements)
            && s.elements.every(e => typeof e.id === 'string' && typeof e.info === 'string'));
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

// Renvoie {introduction, sections: [{section, elements: [{id, info}]}], a_la_une}
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
