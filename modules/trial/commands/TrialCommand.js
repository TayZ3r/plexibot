const axios = require('axios');

// Rôle Discord autorisé à utiliser /trial (fixe, ne change pas)
const TRIAL_ALLOWED_ROLE_ID = '1165286018593861725';

module.exports = {
    name: 'trial',
    description: 'Démarre un essai gratuit de 48h pour un utilisateur Plex',
    options: [
        {
            name: 'plex_email',
            description: 'Adresse email Plex de l\'utilisateur',
            type: 3,
            required: true,
        },
        {
            name: 'discord_user',
            description: 'Utilisateur Discord à mentionner',
            type: 6,
            required: true,
        },
        {
            name: 'server',
            description: 'Serveur Plex de destination',
            type: 3,
            required: true,
            autocomplete: true,
        },
    ],

    autocomplete: async (client, interaction) => {
        const focused = interaction.options.getFocused().toLowerCase();
        try {
            const resp = await axios.get(`${process.env.ADMIN_API_URL}/api/servers`, {
                headers: {'X-Bot-Api-Key': process.env.BOT_API_KEY},
                timeout: 5000,
            });
            const matches = resp.data
                .filter(s => s.name.toLowerCase().includes(focused))
                .slice(0, 25)
                .map(s => ({name: s.name, value: String(s.id)}));
            await interaction.respond(matches);
        } catch {
            await interaction.respond([]);
        }
    },

    run: async (client, interaction) => {
        const member = interaction.member ?? await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
        if (!member?.roles?.cache?.has(TRIAL_ALLOWED_ROLE_ID)) {
            await interaction.editReply({content: "❌ Vous n'avez pas la permission d'utiliser cette commande."});
            return;
        }

        const plexEmail = interaction.options.getString('plex_email');
        const discordUser = interaction.options.getUser('discord_user');
        const serverId = interaction.options.getString('server');

        try {
            const resp = await axios.post(
                `${process.env.ADMIN_API_URL}/api/trials`,
                {
                    plex_email: plexEmail,
                    discord_id: discordUser.id,
                    discord_username: discordUser.username,
                    server_id: parseInt(serverId),
                    channel_id: interaction.channelId,
                },
                {
                    headers: {'X-Bot-Api-Key': process.env.BOT_API_KEY},
                    timeout: 30000,
                }
            );
            await interaction.editReply({content: resp.data.message});
        } catch (e) {
            const msg = e.response?.data?.error || e.message;
            await interaction.editReply({content: `❌ Erreur : ${msg}`});
        }
    },
};
