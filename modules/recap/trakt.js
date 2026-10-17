const axios = require('axios');

const TRAKT_API = 'https://api.trakt.tv';

function isEnabled() {
    return Boolean(process.env.TRAKT_CLIENT_ID);
}

async function get(path, params = {}) {
    const resp = await axios.get(`${TRAKT_API}${path}`, {
        params,
        timeout: 15000,
        headers: {
            'Content-Type': 'application/json',
            'trakt-api-version': '2',
            'trakt-api-key': process.env.TRAKT_CLIENT_ID,
        },
    });
    return resp.data;
}

// Renvoie [{tmdbId, mediaType, rank, score}] ; les titres FR sont résolus ensuite via TMDB.
// list = 'trending' (vus en ce moment) ou 'anticipated' (les plus attendus)
async function list(list, mediaType) {
    const traktType = mediaType === 'movie' ? 'movies' : 'shows';
    const key = mediaType === 'movie' ? 'movie' : 'show';
    const data = await get(`/${traktType}/${list}`, {limit: 15});
    return data
        .map((entry, i) => ({
            tmdbId: entry[key]?.ids?.tmdb,
            mediaType,
            rank: i + 1,
            score: entry.watchers ?? entry.list_count ?? null,
        }))
        .filter(entry => entry.tmdbId);
}

module.exports = {isEnabled, list};
