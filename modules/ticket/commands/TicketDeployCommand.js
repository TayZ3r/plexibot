const {EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder} = require('discord.js');

module.exports = {
    name: "ticket",
    description: "Permet de déployer le système de ticket",


    run: async (client, interaction) => {

        const ticket = new EmbedBuilder()
            .setTitle('Support - Plexify :tv:')
            .setColor('#a0123b')
            .setDescription('Contactez notre équipe grâce à un ticket, il sera pris en charge dès que possible !\n\nAfin de créer un ticket et obtenir de l\'aide, réagissez avec la catégorie juste en dessous. 📩\n\n:warning: Merci de préciser votre adresse e-mail Plex et/ou Stripe en expliquant votre problème, plainte ou requête !')

        const row = new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('ticket')
                    .setPlaceholder('Aucune catégorie sélectionnée')
                    .addOptions([
                        {
                            label: '🧏 Essai gratuit de 48h',
                            description: 'Envie d\'essayer notre service gratuitement ?',
                            value: '1',
                        },
                        {
                            label: '🤖 Technique',
                            description: 'Un soucis avec l\'un de nos services ? C\'est ici !',
                            value: '2',
                        },
                        {
                            label: '💸 Commercial',
                            description: 'Besoin d\'aide avec un paiement ?.',
                            value: '3',
                        },
                        {
                            label: '❓ Autre',
                            description: 'Pour tout autre problème non-cité..',
                            value: '4',
                        }
                    ]),
            );


        await interaction.deleteReply();
        await interaction.channel.send({embeds: [ticket], components: [row]});
    }
}