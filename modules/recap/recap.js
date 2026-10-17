const {EmbedBuilder} = require('discord.js');
const client = require('../../index');
const store = require('./store');
const plex = require('./plex');
const trakt = require('./trakt');
const {writeRecap} = require('./writer');

const DEFAULT_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;
const POSTER_URL = 'https://image.tmdb.org/t/p/w342';
const EMBED_COLOR = 0xE5A00D;

// Nombre maximum d'éléments transmis à Claude par catégorie (il en garde 10 à 15 au total)
const KIND_LIMITS = {
    movie_cinema: 10,
    movie_digital: 8,
    movie_upcoming: 6,
    tv_new: 10,
    tv_season: 10,
    tv_renewed: 10,
    tv_canceled: 10,
    tv_ended: 6,
};

const KIND_LABELS = {
    movie_cinema: 'sorties_cinema',
    movie_digital: 'sorties_vod',
    movie_upcoming: 'films_a_venir',
    tv_new: 'nouvelles_series',
    tv_season: 'retours_de_saison',
    tv_renewed: 'renouvellements',
    tv_canceled: 'annulations',
    tv_ended: 'fins_de_serie',
};

const POPULARITY_KINDS = ['trending', 'anticipated'];

function itemId(event) {
    return `${event.mediaType}:${event.tmdbId}`;
}

// Plateformes et chaînes ne sont volontairement pas transmises : le récap ne les cite pas,
// seule la présence sur Plex est signalée (ajoutée au rendu, pas par Claude).
function toPayloadItem(event) {
    return {
        id: itemId(event),
        type: event.mediaType === 'movie' ? 'film' : 'série',
        titre: event.title,
        titre_original: event.originalTitle !== event.title ? event.originalTitle : undefined,
        date: event.date ?? undefined,
        saison: event.season ?? undefined,
        note_tmdb: event.rating ?? undefined,
        popularite_tmdb: event.popularity,
        synopsis: event.overview ?? undefined,
    };
}

// Les tendances sont vues à chaque collecte : on les fusionne par titre en gardant
// les signaux (source, liste, meilleur rang, nombre de collectes où il apparaît).
function mergePopularity(events) {
    const byTitle = new Map();
    for (const event of events) {
        const id = itemId(event);
        const entry = byTitle.get(id) ?? {event, signals: [], weight: 0};
        entry.signals.push({
            source: event.source,
            liste: event.kind === 'trending' ? 'tendances' : 'les_plus_attendus',
            meilleur_rang: event.rank,
            collectes: event.hits,
        });
        entry.weight += (16 - (event.rank ?? 15)) * event.hits;
        byTitle.set(id, entry);
    }
    return [...byTitle.values()]
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 20)
        .map(({event, signals}) => ({...toPayloadItem(event), signaux: signals}));
}

async function loadPlexIds() {
    if (!plex.isEnabled()) return null;
    try {
        return await plex.libraryTmdbIds();
    } catch (e) {
        console.error('[Recap] Erreur lecture bibliothèque Plex:', e.message);
        return null;
    }
}

function formatDay(date) {
    return date.toLocaleDateString('fr-FR', {day: 'numeric', month: 'long', timeZone: 'Europe/Paris'});
}

function truncate(text, max) {
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// Ordre, emoji et intitulé de chaque section : fixés ici pour un rendu identique chaque semaine
const SECTIONS = [
    ['cinema', '🎬 Au cinéma'],
    ['vod', '💿 En VOD'],
    ['series', '📺 Séries'],
    ['renouvellements', '🔁 Renouvelées'],
    ['annulations', '❌ Annulées ou terminées'],
    ['tendances', '🔥 Tendances'],
    ['a_venir', '📅 À venir'],
];
const MAX_PER_SECTION = 4;

function renderLine(item, info, plexIds) {
    const onPlex = plexIds?.[item.mediaType]?.has(item.tmdbId);
    return `**${item.title}** — ${truncate(info.trim(), 80)}${onPlex ? ' ✅' : ''}`;
}

function buildEmbed(recap, {since, until, titles, plexIds}) {
    const featured = titles.get(recap.a_la_une);
    const embed = new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setTitle('🍿 Récap ciné & séries')
        .setDescription(`*${truncate(recap.introduction.trim(), 300)}*`)
        .setFooter({
            text: [
                `Du ${formatDay(since)} au ${formatDay(until)}`,
                plexIds ? '✅ dispo sur Plex' : null,
                `Sources : TMDB${trakt.isEnabled() ? ' · Trakt' : ''}`,
            ].filter(Boolean).join('  •  '),
        });

    const used = new Set();
    for (const [key, name] of SECTIONS) {
        const lines = recap.sections
            .filter(s => s.section === key)
            .flatMap(s => s.elements)
            // Ignore les ids inconnus et les doublons qu'aurait pu renvoyer Claude
            .filter(e => titles.has(e.id) && !used.has(e.id) && used.add(e.id))
            .slice(0, MAX_PER_SECTION)
            .map(e => renderLine(titles.get(e.id), e.info, plexIds));
        if (lines.length) embed.addFields({name, value: truncate(lines.join('\n'), 1024)});
    }

    if (featured?.poster) embed.setThumbnail(`${POSTER_URL}${featured.poster}`);
    return embed;
}

// Compile les événements collectés depuis le dernier récap et fait rédiger le message.
// Renvoie null s'il n'y a rien à publier.
// Options de test : `since` force le début de la période, `includeReported` reprend les annonces déjà publiées.
async function buildRecap({since: forcedSince, includeReported = false} = {}) {
    const config = await store.getConfig();
    const until = new Date();
    const since = forcedSince ?? new Date(config.lastRecapAt ?? until.getTime() - DEFAULT_PERIOD_MS);

    const events = Object.values(await store.getEvents())
        .filter(e => e.lastSeen >= since.getTime());

    const popularity = events.filter(e => POPULARITY_KINDS.includes(e.kind));
    // Les annonces déjà publiées dans un précédent récap ne sont pas répétées
    const news = events.filter(e => !POPULARITY_KINDS.includes(e.kind) && (includeReported || !e.reportedAt));
    if (!news.length && !popularity.length) return null;

    const plexIds = await loadPlexIds();
    const payload = {
        periode: {du: since.toISOString().slice(0, 10), au: until.toISOString().slice(0, 10)},
    };
    const selected = [];
    for (const [kind, limit] of Object.entries(KIND_LIMITS)) {
        const items = news
            .filter(e => e.kind === kind)
            .sort((a, b) => b.popularity - a.popularity)
            .slice(0, limit);
        if (!items.length) continue;
        selected.push(...items);
        payload[KIND_LABELS[kind]] = items.map(toPayloadItem);
    }
    payload.populaires_du_moment = mergePopularity(popularity);

    const recap = await writeRecap(payload);

    // Titre exact et affiche de chaque id : le titre affiché vient des données, pas de Claude
    const titles = new Map();
    for (const event of events) {
        const id = itemId(event);
        if (!titles.has(id) || (!titles.get(id).poster && event.poster)) titles.set(id, event);
    }
    const embed = buildEmbed(recap, {since, until, titles, plexIds});

    return {embed, until, reportedKeys: selected.map(e => e.key)};
}

async function publishRecap() {
    const config = await store.getConfig();
    if (!config.channelId) throw new Error('Aucun salon configuré (/recap config)');

    const result = await buildRecap();
    if (!result) return null;

    const channel = await client.channels.fetch(config.channelId);
    const message = await channel.send({embeds: [result.embed]});

    await store.markReported(result.reportedKeys);
    await store.updateConfig({lastRecapAt: result.until.getTime()});
    return message;
}

// Publie un récap des 7 derniers jours sans toucher à l'état du récap planifié
// (période et annonces déjà publiées inchangées).
async function publishTestRecap(channel) {
    const result = await buildRecap({
        since: new Date(Date.now() - DEFAULT_PERIOD_MS),
        includeReported: true,
    });
    if (!result) return null;
    return channel.send({content: '🧪 Récap de test (7 derniers jours)', embeds: [result.embed]});
}

module.exports = {buildRecap, publishRecap, publishTestRecap};
