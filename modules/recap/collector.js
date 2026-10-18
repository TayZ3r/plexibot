const tmdb = require('./tmdb');
const trakt = require('./trakt');
const store = require('./store');

const MAX_TRACKED_SHOWS = 300;
const TRACKED_SHOW_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const CINEMA_TYPES = [2, 3];
const DIGITAL_TYPES = [4];

async function mapLimit(items, limit, fn) {
    const results = [];
    let index = 0;
    async function worker() {
        while (index < items.length) {
            const i = index++;
            results[i] = await fn(items[i]).catch(e => {
                console.error('[Recap] Erreur collecte élément:', e.message);
                return null;
            });
        }
    }
    await Promise.all(Array.from({length: limit}, worker));
    return results;
}

// Exécute une étape de collecte sans bloquer les autres si une source est en panne
async function step(name, fn) {
    try {
        return await fn();
    } catch (e) {
        console.error(`[Recap] Erreur collecte "${name}":`, e.response?.status ?? '', e.message);
        return [];
    }
}

async function collectTrending() {
    const lists = await Promise.all(['movie', 'tv'].map(tmdb.trending));
    return lists.flatMap(list => list.slice(0, 15).map((item, i) => ({
        ...item,
        key: `trending:tmdb:${item.mediaType}:${item.tmdbId}`,
        kind: 'trending',
        source: 'tmdb',
        rank: i + 1,
    })));
}

async function collectTrakt() {
    if (!trakt.isEnabled()) return [];

    const entries = (await Promise.all([
        ['trending', 'movie'], ['trending', 'tv'], ['anticipated', 'movie'], ['anticipated', 'tv'],
    ].map(async ([list, mediaType]) => (await trakt.list(list, mediaType)).map(e => ({...e, list})))))
        .flat();

    // Trakt renvoie les titres en anglais : on récupère la fiche FR sur TMDB
    const resolved = await mapLimit(entries, 5, async entry => {
        const details = entry.mediaType === 'movie'
            ? await tmdb.movieDetails(entry.tmdbId)
            : await tmdb.showSummary(entry.tmdbId);
        return {
            ...details,
            key: `${entry.list}:trakt:${entry.mediaType}:${entry.tmdbId}`,
            kind: entry.list,
            source: 'trakt',
            rank: entry.rank,
            score: entry.score,
        };
    });
    return resolved.filter(Boolean);
}

async function collectMovieReleases({kind, from, to, releaseTypes, limit}) {
    const movies = (await tmdb.discoverMovies({from, to, releaseTypes: releaseTypes.join('|')})).slice(0, limit);
    const withDates = await mapLimit(movies, 5, async movie => ({
        ...movie,
        key: `${kind}:${movie.tmdbId}`,
        kind,
        date: await tmdb.frenchReleaseDate(movie.tmdbId, releaseTypes) ?? movie.date,
    }));
    return withDates.filter(Boolean);
}

function maxSeason(show) {
    return show.seasons.reduce((max, s) => Math.max(max, s.number), 0);
}

function inWindow(date, from, to) {
    return Boolean(date) && date >= from && date <= to;
}

// Suit l'état d'un ensemble de séries d'un passage à l'autre pour détecter
// renouvellements (nouvelle saison ajoutée), annulations, fins et retours de saison.
async function collectShows(trendingShows, traktEvents) {
    const from = tmdb.isoDay(-7);
    const to = tmdb.isoDay(7);
    const now = Date.now();

    const [listed, newShows] = await Promise.all([
        step('séries populaires', tmdb.showLists),
        step('nouvelles séries', () => tmdb.discoverNewShows({from, to})),
    ]);

    const listedIds = new Set([
        ...trendingShows.map(s => s.tmdbId),
        ...traktEvents.filter(e => e.mediaType === 'tv').map(e => e.tmdbId),
        ...listed.map(s => s.tmdbId),
        ...newShows.slice(0, 15).map(s => s.tmdbId),
    ]);

    const tracked = await store.getTrackedShows();
    for (const id of listedIds) {
        tracked[id] = {...tracked[id], lastListed: now};
    }
    const ids = Object.entries(tracked)
        .filter(([, show]) => now - show.lastListed < TRACKED_SHOW_TTL_MS)
        .sort(([, a], [, b]) => b.lastListed - a.lastListed)
        .slice(0, MAX_TRACKED_SHOWS)
        .map(([id]) => Number(id));

    const details = (await mapLimit(ids, 5, tmdb.showDetails)).filter(Boolean);
    const events = [];
    const nextTracked = {};

    for (const show of details) {
        const prev = tracked[show.tmdbId];
        const base = {
            mediaType: 'tv',
            tmdbId: show.tmdbId,
            title: show.title,
            originalTitle: show.originalTitle,
            overview: show.overview,
            poster: show.poster,
            backdrop: show.backdrop,
            popularity: show.popularity,
            rating: show.rating,
            providers: show.providers,
            networks: show.networks,
        };
        const lastSeason = maxSeason(show);

        // Sans état précédent, on enregistre seulement la référence (pas de faux "renouvellement")
        if (prev?.status) {
            if (show.status === 'Canceled' && prev.status !== 'Canceled') {
                events.push({...base, key: `tv_canceled:${show.tmdbId}`, kind: 'tv_canceled', season: lastSeason});
            }
            if (show.status === 'Ended' && prev.status !== 'Ended') {
                events.push({...base, key: `tv_ended:${show.tmdbId}`, kind: 'tv_ended', season: lastSeason});
            }
            if (lastSeason > prev.maxSeason) {
                const season = show.seasons.find(s => s.number === lastSeason);
                events.push({
                    ...base,
                    key: `tv_renewed:${show.tmdbId}:${lastSeason}`,
                    kind: 'tv_renewed',
                    season: lastSeason,
                    date: season?.airDate ?? null,
                });
            }
        }

        for (const episode of [show.lastEpisode, show.nextEpisode]) {
            if (episode?.episode_number === 1 && episode.season_number > 1 && inWindow(episode.air_date, from, to)) {
                events.push({
                    ...base,
                    key: `tv_season:${show.tmdbId}:${episode.season_number}`,
                    kind: 'tv_season',
                    season: episode.season_number,
                    date: episode.air_date,
                });
            }
        }

        nextTracked[show.tmdbId] = {
            status: show.status,
            maxSeason: lastSeason,
            lastListed: tracked[show.tmdbId].lastListed,
        };
    }

    const detailsById = new Map(details.map(d => [d.tmdbId, d]));
    for (const show of newShows.slice(0, 15)) {
        if (!inWindow(show.date, from, to)) continue;
        const d = detailsById.get(show.tmdbId);
        events.push({
            ...show,
            key: `tv_new:${show.tmdbId}`,
            kind: 'tv_new',
            providers: d?.providers ?? [],
            networks: d?.networks ?? [],
        });
    }

    // Un échec réseau ne doit pas faire oublier l'état des séries non rafraîchies
    for (const id of ids) {
        if (!nextTracked[id]) nextTracked[id] = tracked[id];
    }
    await store.setTrackedShows(nextTracked);

    return events;
}

async function collect() {
    const started = Date.now();

    const trendingEvents = await step('tendances TMDB', collectTrending);
    const traktEvents = await step('Trakt', collectTrakt);
    const cinema = await step('sorties cinéma', () => collectMovieReleases({
        kind: 'movie_cinema', from: tmdb.isoDay(-3), to: tmdb.isoDay(7), releaseTypes: CINEMA_TYPES, limit: 12,
    }));
    const digital = await step('sorties VOD', () => collectMovieReleases({
        kind: 'movie_digital', from: tmdb.isoDay(-7), to: tmdb.isoDay(7), releaseTypes: DIGITAL_TYPES, limit: 10,
    }));
    const upcoming = await step('films à venir', () => collectMovieReleases({
        kind: 'movie_upcoming', from: tmdb.isoDay(8), to: tmdb.isoDay(30), releaseTypes: CINEMA_TYPES, limit: 8,
    }));
    const shows = await step('suivi des séries', () => collectShows(
        trendingEvents.filter(e => e.mediaType === 'tv'),
        traktEvents,
    ));

    const events = [...trendingEvents, ...traktEvents, ...cinema, ...digital, ...upcoming, ...shows];
    await store.upsertEvents(events);

    console.log(`[Recap] Collecte terminée : ${events.length} éléments en ${Math.round((Date.now() - started) / 1000)}s`);
    return events.length;
}

module.exports = {collect};
