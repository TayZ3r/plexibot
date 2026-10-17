const axios = require('axios');

function isEnabled() {
    return Boolean(process.env.PLEX_URL && process.env.PLEX_TOKEN);
}

async function get(path, params = {}) {
    const resp = await axios.get(`${process.env.PLEX_URL.replace(/\/$/, '')}${path}`, {
        params,
        timeout: 60000,
        headers: {'X-Plex-Token': process.env.PLEX_TOKEN, Accept: 'application/json'},
    });
    return resp.data.MediaContainer;
}

// Renvoie les IDs TMDB présents dans les bibliothèques films et séries du serveur Plex.
// Nécessite que les bibliothèques utilisent les agents Plex récents (GUID tmdb://).
async function libraryTmdbIds() {
    if (!isEnabled()) return null;
    const ids = {movie: new Set(), tv: new Set()};

    const sections = (await get('/library/sections')).Directory ?? [];
    for (const section of sections) {
        const mediaType = section.type === 'movie' ? 'movie' : section.type === 'show' ? 'tv' : null;
        if (!mediaType) continue;

        const items = (await get(`/library/sections/${section.key}/all`, {includeGuids: 1})).Metadata ?? [];
        for (const item of items) {
            const tmdbGuid = item.Guid?.find(g => g.id.startsWith('tmdb://'));
            if (tmdbGuid) ids[mediaType].add(Number(tmdbGuid.id.slice('tmdb://'.length)));
        }
    }
    return ids;
}

module.exports = {isEnabled, libraryTmdbIds};
