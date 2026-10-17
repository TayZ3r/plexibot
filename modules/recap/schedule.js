const TIME_ZONE = 'Europe/Paris';

const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

// Date et heure courantes à Paris, quel que soit le fuseau du serveur
function parisNow(date = new Date()) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
        timeZone: TIME_ZONE,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
    }).formatToParts(date).map(p => [p.type, p.value]));

    return {
        day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday),
        date: `${parts.year}-${parts.month}-${parts.day}`,
        minutes: Number(parts.hour) * 60 + Number(parts.minute),
    };
}

// Vrai si le récap planifié doit partir maintenant. Le créneau reste valable jusqu'à
// minuit pour rattraper un redémarrage du bot, mais ne part qu'une fois par jour.
function isDue(config, now = parisNow()) {
    if (!config.enabled || !config.channelId) return false;
    if (now.day !== config.day) return false;
    if (now.minutes < config.hour * 60 + config.minute) return false;
    return config.lastScheduledRun !== now.date;
}

function parseTime(value) {
    const match = /^([01]?\d|2[0-3])[:hH]([0-5]\d)$/.exec(value.trim());
    if (!match) return null;
    return {hour: Number(match[1]), minute: Number(match[2])};
}

function describe(config) {
    const time = `${String(config.hour).padStart(2, '0')}h${String(config.minute).padStart(2, '0')}`;
    return `chaque ${DAYS[config.day]} à ${time} (heure de Paris)`;
}

module.exports = {DAYS, parisNow, isDue, parseTime, describe};
