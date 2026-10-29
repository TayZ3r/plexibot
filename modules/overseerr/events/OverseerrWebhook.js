const chalk = require('chalk');
const client = require('../../../index');
const {createServer} = require('../server');

// Reçoit les webhooks d'Overseerr (Plexify) et envoie un DM au demandeur
// quand son film / sa série est disponible.
client.once('ready', () => {
    const secret = process.env.OVERSEERR_WEBHOOK_SECRET;
    const port = Number(process.env.OVERSEERR_WEBHOOK_PORT) || 3000;

    if (!secret) {
        console.warn(chalk.yellow('[Overseerr] OVERSEERR_WEBHOOK_SECRET absent : webhook désactivé'));
        return;
    }

    const server = createServer(client, {
        secret,
        testDiscordId: process.env.OVERSEERR_TEST_DISCORD_ID,
    });

    server.on('error', (e) => console.error(chalk.red(`[Overseerr] Erreur serveur webhook : ${e.message}`)));
    server.listen(port, () => {
        console.log(chalk.blue(`[Overseerr] Webhook en écoute sur :${port}/overseerr`));
    });
});
