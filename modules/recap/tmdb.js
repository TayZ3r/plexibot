const axios = require('axios');

const TMDB_API = 'https://api.themoviedb.org/3';
const LANGUAGE = 'fr-FR';
const REGION = 'FR';

// TMDB accepte soit une clé API v3 (paramètre api_key), soit un jeton de lecture v4 (Bearer)
function tmdbClient() {
    const key = process.env.TMDB_API_KEY;
    if (!key) throw new Error('TMDB_API_KEY manquant');
    const isReadToken = key.startsWith('eyJ');
    return axios.create({
        baseURL: TMDB_API,
        timeout: 15000,
        params: {language: LANGUAGE, ...(isReadToken ? {} : {api_key: key})},
        headers: isReadToken ? {Authorization: `Bearer ${key}`} : {},
    });
}

let http;

async function get(path, params = {}) {
    http ??= tmdbClient();
    const resp = await http.get(path, {params});
    return resp.data;
}

function isoDay(offsetDays = 0) {
    return new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
}

function truncate(text, max) {
    if (!text) return null;
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// Forme commune à tous les éléments collectés, quelle que soit la source
function normalize(item, mediaType) {
    return {
        mediaType,
        tmdbId: item.id,
        title: item.title ?? item.name,
        originalTitle: item.original_title ?? item.original_name,
        date: item.release_date ?? item.first_air_date ?? null,
        overview: truncate(item.overview, 280),
        poster: item.poster_path ?? null,
        popularity: Math.round(item.popularity ?? 0),
        rating: item.vote_average ? Math.round(item.vote_average * 10) / 10 : null,
    };
}

async function trending(mediaType) {
    const data = await get(`/trending/${mediaType}/week`);
    return data.results.map(item => normalize(item, mediaType));
}

// Films sortant en France dans la fenêtre donnée. Types TMDB : 2/3 = cinéma, 4 = VOD/numérique, 6 = TV
async function discoverMovies({from, to, releaseTypes}) {
    const data = await get('/discover/movie', {
        region: REGION,
        with_release_type: releaseTypes,
        'release_date.gte': from,
        'release_date.lte': to,
        sort_by: 'popularity.desc',
        'vote_count.gte': 0,
    });
    return data.results.map(item => normalize(item, 'movie'));
}

// Date de sortie française réelle (la date "primaire" de TMDB est souvent celle des US)
async function frenchReleaseDate(movieId, releaseTypes) {
    const data = await get(`/movie/${movieId}/release_dates`);
    const fr = data.results.find(r => r.iso_3166_1 === REGION);
    const match = fr?.release_dates
        .filter(d => releaseTypes.includes(d.type))
        .sort((a, b) => a.release_date.localeCompare(b.release_date))[0];
    return match?.release_date.slice(0, 10) ?? null;
}

async function discoverNewShows({from, to}) {
    const data = await get('/discover/tv', {
        'first_air_date.gte': from,
        'first_air_date.lte': to,
        sort_by: 'popularity.desc',
        'vote_count.gte': 0,
    });
    return data.results.map(item => normalize(item, 'tv'));
}

async function showLists() {
    const [popular, onTheAir1, onTheAir2] = await Promise.all([
        get('/tv/popular'),
        get('/tv/on_the_air'),
        get('/tv/on_the_air', {page: 2}),
    ]);
    return [...popular.results, ...onTheAir1.results, ...onTheAir2.results].map(item => normalize(item, 'tv'));
}

async function showDetails(showId) {
    const data = await get(`/tv/${showId}`, {append_to_response: 'watch/providers'});
    const providers = data['watch/providers']?.results?.[REGION]?.flatrate?.map(p => p.provider_name) ?? [];
    return {
        ...normalize(data, 'tv'),
        status: data.status,
        networks: data.networks?.map(n => n.name) ?? [],
        providers,
        seasons: (data.seasons ?? []).filter(s => s.season_number > 0).map(s => ({
            number: s.season_number,
            airDate: s.air_date,
        })),
        lastEpisode: data.last_episode_to_air,
        nextEpisode: data.next_episode_to_air,
    };
}

async function movieDetails(movieId) {
    return normalize(await get(`/movie/${movieId}`), 'movie');
}

async function showSummary(showId) {
    return normalize(await get(`/tv/${showId}`), 'tv');
}

module.exports = {
    isoDay,
    trending,
    discoverMovies,
    frenchReleaseDate,
    discoverNewShows,
    showLists,
    showDetails,
    movieDetails,
    showSummary,
};
