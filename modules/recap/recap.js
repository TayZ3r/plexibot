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

function toPayloadItem(event, plexIds) {
    const item = {
        id: itemId(event),
        type: event.mediaType === 'movie' ? 'film' : 'série',
        titre: event.title,
        titre_original: event.originalTitle !== event.title ? event.originalTitle : undefined,
        date: event.date ?? undefined,
        saison: event.season ?? undefined,
        plateformes: event.providers?.length ? event.providers : undefined,
        chaines: event.networks?.length ? event.networks : undefined,
        note_tmdb: event.rating ?? undefined,
        popularite_tmdb: event.popularity,
        synopsis: event.overview ?? undefined,
    };
    if (plexIds) item.sur_plex = plexIds[event.mediaType].has(event.tmdbId);
    return item;
}

// Les tendances sont vues à chaque collecte : on les fusionne par titre en gardant
// les signaux (source, liste, meilleur rang, nombre de collectes où il apparaît).
function mergePopularity(events, plexIds) {
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
        .map(({event, signals}) => ({...toPayloadItem(event, plexIds), signaux: signals}));
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

function buildEmbed(recap, {since, until, posterPath}) {
    const embed = new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setTitle(`🍿 Récap ciné & séries · du ${formatDay(since)} au ${formatDay(until)}`)
        .setDescription(truncate(recap.introduction, 1000))
        .setFooter({text: `Sources : TMDB${trakt.isEnabled() ? ' · Trakt' : ''} · Rédigé par Claude`})
        .setTimestamp(until);

    // Limites Discord : 25 champs, 1024 caractères par champ, 6000 caractères au total
    let budget = 6000 - embed.data.title.length - embed.data.description.length - embed.data.footer.text.length;
    for (const section of recap.sections.slice(0, 10)) {
        if (!section.lignes.length) continue;
        const name = truncate(`${section.emoji} ${section.titre}`, 256);
        const value = truncate(section.lignes.join('\n'), 1024);
        if (name.length + value.length > budget) break;
        budget -= name.length + value.length;
        embed.addFields({name, value});
    }

    if (posterPath) embed.setThumbnail(`${POSTER_URL}${posterPath}`);
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
        payload[KIND_LABELS[kind]] = items.map(e => toPayloadItem(e, plexIds));
    }
    payload.populaires_du_moment = mergePopularity(popularity, plexIds);

    const recap = await writeRecap(payload);

    const featured = events.find(e => itemId(e) === recap.a_la_une && e.poster);
    const embed = buildEmbed(recap, {since, until, posterPath: featured?.poster});

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
