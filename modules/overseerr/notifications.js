// Types de notifications Overseerr traités par le bot (les autres sont ignorés)
const NOTIFICATIONS = {
    MEDIA_AVAILABLE: {
        color: 0x2ecc71,
        author: 'Votre demande a été traitée',
    },
    TEST_NOTIFICATION: {
        color: 0x95a5a6,
        author: 'Notification de test Plexify',
    },
};

function getNotificationConfig(type) {
    if (!type) return undefined;
    return NOTIFICATIONS[String(type).toUpperCase()];
}

function getTmdbUrl(media) {
    if (!media?.tmdbId) return null;
    const type = media.media_type === 'tv' ? 'tv' : 'movie';
    return `https://www.themoviedb.org/${type}/${media.tmdbId}`;
}

module.exports = {
    NOTIFICATIONS,
    getNotificationConfig,
    getTmdbUrl,
};
