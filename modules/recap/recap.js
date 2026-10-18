const {EmbedBuilder} = require('discord.js');
const client = require('../../index');
const store = require('./store');
const plex = require('./plex');
const trakt = require('./trakt');
const {writeRecap} = require('./writer');

const DEFAULT_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;
const IMAGE_URL = 'https://image.tmdb.org/t/p/w780';
const PLEXIFY_EMOJI = '<:plexify_1:1309433875034013726>';
// Les emojis personnalisés ne s'affichent pas dans un footer : on y met l'image de l'emoji en icône
const PLEXIFY_ICON = 'https://cdn.discordapp.com/emojis/1309433875034013726.png';

// Nombre maximum d'éléments transmis à Claude par type d'actualité
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

// Catégorie (un embed chacune) et intitulé de chaque type d'actualité dans les données envoyées à Claude
const KIND_GROUPS = {
    movie_cinema: ['sorties_cine', 'en_salle'],
    movie_digital: ['films', 'sorties_vod'],
    movie_upcoming: ['films', 'prochainement_au_cinema'],
    tv_new: ['series', 'nouvelles_series'],
    tv_season: ['series', 'retours_de_saison'],
    tv_renewed: ['series', 'renouvellements'],
    tv_canceled: ['series', 'annulations'],
    tv_ended: ['series', 'fins_de_serie'],
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

// Ordre, titre et couleur de chaque embed. Les couleurs suivent le dégradé du logo Plexify (rouge → bleu).
const CATEGORIES = [
    {key: 'cinema', title: '🎬 Sorties ciné', color: 0xDB0000},
    {key: 'films', title: '🎞️ Films', color: 0xA0123D},
    {key: 'series', title: '📺 Séries', color: 0x642379},
    {key: 'tendances', title: '🔥 Tendances', color: 0x2935B6},
];
const MAX_PER_CATEGORY = 6;

function renderItem(item, text, plexIds) {
    const onPlex = plexIds?.[item.mediaType]?.has(item.tmdbId);
    return `**${item.title}**${onPlex ? ` ${PLEXIFY_EMOJI}` : ''}\n${truncate(text.trim(), 350)}`;
}

function buildEmbeds(recap, {since, until, titles, plexIds}) {
    const used = new Set();
    const embeds = [];

    for (const {key, title, color} of CATEGORIES) {
        const category = recap.categories.find(c => c.categorie === key);
        if (!category) continue;
        const elements = category.elements
            // Ignore les ids inconnus et les doublons qu'aurait pu renvoyer Claude
            .filter(e => titles.has(e.id) && !used.has(e.id) && used.add(e.id))
            .slice(0, MAX_PER_CATEGORY);
        if (!elements.length) continue;

        const items = elements.map(e => titles.get(e.id));
        const description = [
            `*${truncate(category.introduction.trim(), 250)}*`,
            ...elements.map((e, i) => renderItem(items[i], e.texte, plexIds)),
        ].join('\n\n');

        const embed = new EmbedBuilder()
            .setColor(color)
            .setTitle(title)
            .setDescription(truncate(description, 4096));

        // Image du titre le plus marquant de la catégorie (Claude les classe par importance)
        const illustrated = items.find(item => item.backdrop) ?? items.find(item => item.poster);
        const image = illustrated?.backdrop ?? illustrated?.poster;
        if (image) embed.setImage(`${IMAGE_URL}${image}`);

        embeds.push(embed);
    }

    // Période, légende et sources une seule fois, sous le dernier embed
    embeds.at(-1)?.setFooter({
        text: [
            plexIds ? 'dispo sur Plexify' : null,
            `Du ${formatDay(since)} au ${formatDay(until)}`,
            `Sources : TMDB${trakt.isEnabled() ? ' · Trakt' : ''}`,
        ].filter(Boolean).join('  •  '),
        iconURL: plexIds ? PLEXIFY_ICON : undefined,
    });
    return embeds;
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
        const [group, label] = KIND_GROUPS[kind];
        payload[group] = {...payload[group], [label]: items.map(toPayloadItem)};
    }
    payload.tendances = mergePopularity(popularity);

    const recap = await writeRecap(payload);

    // Titre exact et images de chaque id : le titre affiché vient des données, pas de Claude
    const titles = new Map();
    for (const event of events) {
        const id = itemId(event);
        const known = titles.get(id);
        if (!known || (!known.backdrop && event.backdrop) || (!known.poster && !known.backdrop && event.poster)) {
            titles.set(id, event);
        }
    }
    const embeds = buildEmbeds(recap, {since, until, titles, plexIds});
    if (!embeds.length) throw new Error('Claude Code n\'a renvoyé aucun titre exploitable');

    return {embeds, until, reportedKeys: selected.map(e => e.key)};
}

async function publishRecap() {
    const config = await store.getConfig();
    if (!config.channelId) throw new Error('Aucun salon configuré (/recap config)');

    const result = await buildRecap();
    if (!result) return null;

    const channel = await client.channels.fetch(config.channelId);
    const message = await channel.send({embeds: result.embeds});

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
    return channel.send({content: '🧪 Récap de test (7 derniers jours)', embeds: result.embeds});
}

module.exports = {buildRecap, publishRecap, publishTestRecap};
