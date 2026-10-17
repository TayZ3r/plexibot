const client = require('../../index');

const DB_CONFIG = 'recap.config';
const DB_EVENTS = 'recap.events';
const DB_SHOWS = 'recap.trackedShows';

// Au-delà, un événement n'a plus d'intérêt pour un récap
const EVENT_RETENTION_MS = 60 * 24 * 60 * 60 * 1000;

const DEFAULT_CONFIG = {
    enabled: false,
    channelId: null,
    day: 0,
    hour: 18,
    minute: 0,
    // Début de la période couverte par le prochain récap
    lastRecapAt: null,
    // Date (YYYY-MM-DD, heure de Paris) du dernier passage planifié, pour ne publier qu'une fois par jour
    lastScheduledRun: null,
};

async function getConfig() {
    return {...DEFAULT_CONFIG, ...(await client.db.get(DB_CONFIG))};
}

async function updateConfig(patch) {
    const config = {...(await getConfig()), ...patch};
    await client.db.set(DB_CONFIG, config);
    return config;
}

async function getEvents() {
    return (await client.db.get(DB_EVENTS)) ?? {};
}

function bestRank(a, b) {
    const ranks = [a, b].filter(r => typeof r === 'number');
    return ranks.length ? Math.min(...ranks) : null;
}

// Fusionne les événements collectés : un événement déjà connu garde sa date de première
// détection, on met à jour sa dernière apparition et son meilleur rang.
async function upsertEvents(events) {
    const all = await getEvents();
    const now = Date.now();

    for (const event of events) {
        const existing = all[event.key];
        if (existing) {
            all[event.key] = {
                ...existing,
                ...event,
                firstSeen: existing.firstSeen,
                lastSeen: now,
                hits: existing.hits + 1,
                rank: bestRank(existing.rank, event.rank),
            };
        } else {
            all[event.key] = {...event, firstSeen: now, lastSeen: now, hits: 1};
        }
    }

    for (const [key, event] of Object.entries(all)) {
        if (now - event.lastSeen > EVENT_RETENTION_MS) delete all[key];
    }

    await client.db.set(DB_EVENTS, all);
}

async function markReported(keys) {
    const all = await getEvents();
    const now = Date.now();
    for (const key of keys) {
        if (all[key]) all[key].reportedAt = now;
    }
    await client.db.set(DB_EVENTS, all);
}

async function getTrackedShows() {
    return (await client.db.get(DB_SHOWS)) ?? {};
}

async function setTrackedShows(shows) {
    await client.db.set(DB_SHOWS, shows);
}

module.exports = {getConfig, updateConfig, getEvents, upsertEvents, markReported, getTrackedShows, setTrackedShows};
