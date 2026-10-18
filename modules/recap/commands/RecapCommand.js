const {ChannelType} = require('discord.js');
const store = require('../store');
const {buildRecap, publishRecap, publishTestRecap} = require('../recap');
const {DAYS, parisNow, parseTime, describe} = require('../schedule');

// Même rôle que /trial (fixe, ne change pas)
const RECAP_ALLOWED_ROLE_ID = '1165286018593861725';

module.exports = {
    name: 'recap',
    description: 'Récap hebdomadaire de l\'actualité films et séries',
    ephemeral: true,
    options: [
        {
            name: 'config',
            description: 'Définit le salon et la récurrence du récap',
            type: 1,
            options: [
                {
                    name: 'salon',
                    description: 'Salon où publier le récap',
                    type: 7,
                    channel_types: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
                    required: true,
                },
                {
                    name: 'jour',
                    description: 'Jour de publication',
                    type: 4,
                    required: true,
                    choices: DAYS.map((day, i) => ({name: day, value: i})),
                },
                {
                    name: 'heure',
                    description: 'Heure de publication, heure de Paris (ex. 18:00)',
                    type: 3,
                    required: true,
                },
            ],
        },
        {name: 'statut', description: 'Affiche la configuration actuelle du récap', type: 1},
        {name: 'apercu', description: 'Génère le récap et te l\'affiche sans le publier', type: 1},
        {name: 'publier', description: 'Publie le récap immédiatement dans le salon configuré', type: 1},
        {
            name: 'test',
            description: 'Envoie un récap des 7 derniers jours, sans affecter le récap planifié',
            type: 1,
            options: [
                {
                    name: 'salon',
                    description: 'Salon où envoyer le test (par défaut : ce salon)',
                    type: 7,
                    channel_types: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
                    required: false,
                },
            ],
        },
        {name: 'pause', description: 'Suspend la publication automatique', type: 1},
        {name: 'reprendre', description: 'Réactive la publication automatique', type: 1},
    ],

    run: async (client, interaction) => {
        const member = interaction.member ?? await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
        if (!member?.roles?.cache?.has(RECAP_ALLOWED_ROLE_ID)) {
            await interaction.editReply({content: "❌ Vous n'avez pas la permission d'utiliser cette commande."});
            return;
        }

        const sub = interaction.options.getSubcommand();
        try {
            if (sub === 'config') {
                const channel = interaction.options.getChannel('salon');
                const day = interaction.options.getInteger('jour');
                const time = parseTime(interaction.options.getString('heure'));
                if (!time) {
                    await interaction.editReply({content: '❌ Heure invalide. Format attendu : `18:00` ou `18h00`.'});
                    return;
                }

                // Si le créneau du jour est déjà passé, on attend la semaine suivante plutôt que de publier tout de suite
                const now = parisNow();
                const slotPassedToday = now.day === day && now.minutes >= time.hour * 60 + time.minute;
                const config = await store.updateConfig({
                    enabled: true,
                    channelId: channel.id,
                    day,
                    ...time,
                    ...(slotPassedToday ? {lastScheduledRun: now.date} : {}),
                });
                await interaction.editReply({content: `✅ Récap publié dans ${channel} ${describe(config)}.`});
                return;
            }

            if (sub === 'statut') {
                const config = await store.getConfig();
                const events = Object.values(await store.getEvents());
                const since = config.lastRecapAt ?? 0;
                const pending = events.filter(e => e.lastSeen >= since).length;
                const lines = [
                    `**Salon :** ${config.channelId ? `<#${config.channelId}>` : 'non configuré'}`,
                    `**Récurrence :** ${config.channelId ? describe(config) : '—'}`,
                    `**État :** ${config.enabled ? '▶️ actif' : '⏸️ en pause'}`,
                    `**Dernier récap :** ${config.lastRecapAt ? `<t:${Math.floor(config.lastRecapAt / 1000)}:F>` : 'aucun'}`,
                    `**Éléments collectés depuis :** ${pending}`,
                ];
                await interaction.editReply({content: lines.join('\n')});
                return;
            }

            if (sub === 'apercu') {
                const result = await buildRecap();
                if (!result) {
                    await interaction.editReply({content: 'Rien à récapituler pour le moment : la collecte n\'a encore rien trouvé.'});
                    return;
                }
                await interaction.editReply({content: '👀 Aperçu (non publié) :', embeds: result.embeds});
                return;
            }

            if (sub === 'publier') {
                const message = await publishRecap();
                await interaction.editReply({
                    content: message ? `✅ Récap publié : ${message.url}` : 'Rien à récapituler pour le moment.',
                });
                return;
            }

            if (sub === 'test') {
                const channel = interaction.options.getChannel('salon') ?? interaction.channel;
                await interaction.editReply({content: '⏳ Génération du récap de test…'});
                const message = await publishTestRecap(channel);
                await interaction.editReply({
                    content: message
                        ? `✅ Récap de test envoyé : ${message.url}`
                        : 'Rien à récapituler : la collecte n\'a encore rien trouvé (vérifie TMDB_API_KEY et les logs `[Recap]`).',
                });
                return;
            }

            if (sub === 'pause' || sub === 'reprendre') {
                const config = await store.updateConfig({enabled: sub === 'reprendre'});
                await interaction.editReply({
                    content: config.enabled ? `▶️ Récap réactivé (${describe(config)}).` : '⏸️ Récap automatique en pause.',
                });
            }
        } catch (e) {
            console.error(`[Recap] Erreur /recap ${sub}:`, e);
            await interaction.editReply({content: `❌ Erreur : ${e.message}`}).catch(() => {});
        }
    },
};
