const client = require('../../../index');
const store = require('../store');
const {collect} = require('../collector');
const {publishRecap} = require('../recap');
const {parisNow, isDue} = require('../schedule');

const COLLECT_INTERVAL_MS = 6 * 60 * 60 * 1000;
const SCHEDULE_CHECK_MS = 60 * 1000;

let collecting = false;
let publishing = false;

async function runCollect() {
    if (collecting || !process.env.TMDB_API_KEY) return;
    collecting = true;
    try {
        await collect();
    } catch (e) {
        console.error('[Recap] Erreur collecte:', e.message);
    } finally {
        collecting = false;
    }
}

async function checkSchedule() {
    if (publishing) return;
    const config = await store.getConfig();
    const now = parisNow();
    if (!isDue(config, now)) return;

    publishing = true;
    // Marqué avant la publication : en cas d'échec on ne réessaie pas toutes les minutes,
    // les éléments non publiés restent disponibles pour le prochain récap.
    await store.updateConfig({lastScheduledRun: now.date});
    try {
        // Collecte fraîche juste avant la rédaction pour avoir les tendances du jour
        await runCollect();
        const message = await publishRecap();
        console.log(message ? '[Recap] Récap hebdomadaire publié' : '[Recap] Rien à publier cette semaine');
    } catch (e) {
        console.error('[Recap] Erreur publication récap:', e.message);
    } finally {
        publishing = false;
    }
}

client.once('ready', () => {
    if (!process.env.TMDB_API_KEY) {
        console.warn('[Recap] TMDB_API_KEY absent : collecte désactivée');
    }
    runCollect();
    setInterval(runCollect, COLLECT_INTERVAL_MS);
    setInterval(() => checkSchedule().catch(e => console.error('[Recap] Erreur planification:', e.message)), SCHEDULE_CHECK_MS);
});
