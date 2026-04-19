const client = require('../../../index');
const axios = require('axios');

const CHECK_INTERVAL_MS = 5 * 60 * 1000;

async function checkExpiredTrials() {
    try {
        const resp = await axios.get(`${process.env.ADMIN_API_URL}/api/trials/expired`, {
            headers: {'X-Bot-Api-Key': process.env.BOT_API_KEY},
            timeout: 10000,
        });

        for (const trial of resp.data) {
            try {
                const channel = await client.channels.fetch(trial.channel_id);
                await channel.send(trial.message);

                await axios.patch(
                    `${process.env.ADMIN_API_URL}/api/trials/${trial.id}/notified`,
                    {},
                    {headers: {'X-Bot-Api-Key': process.env.BOT_API_KEY}, timeout: 5000}
                );
            } catch (e) {
                console.error(`[Trial] Erreur envoi expiry trial #${trial.id}:`, e.message);
            }
        }
    } catch (e) {
        console.error('[Trial] Erreur fetch expired:', e.message);
    }
}

client.once('ready', () => {
    setInterval(checkExpiredTrials, CHECK_INTERVAL_MS);
});
