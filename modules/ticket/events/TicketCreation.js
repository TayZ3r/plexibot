const client = require('../../../index');
const {EmbedBuilder, PermissionsBitField} = require('discord.js');

const ticketTypes = {
    "1": "1309459343439036517",
    "2": "1309459389757001778",
    "3": "1309459445511884831",
    "4": "1309459475010162779",
    "5": "",
    "6": "",
};

async function createTicket(interaction, type) {
    try {
        const normalizedUserName = interaction.user.username.normalize("NFKC").toLowerCase();
        const channelName = `ticket-${normalizedUserName}`;

        const channel = await interaction.guild.channels.create({
            name: channelName,
            parent: type,
            permissionOverwrites: [
                {
                    id: interaction.user.id,
                    allow: [PermissionsBitField.Flags.ViewChannel],
                },
                {
                    id: interaction.guild.roles.everyone.id,
                    deny: [PermissionsBitField.Flags.ViewChannel],
                },
                {
                    id: interaction.guild.roles.cache.get(process.env.SUPPORT_ROLE_ID).id,
                    allow: [PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.AttachFiles, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.ViewChannel],
                },
            ],
        });

        await client.db.set(`ticket_${channel.id}`, {
            creator: interaction.user.id,
            date: Date.now(),
        });

        const embed = new EmbedBuilder()
            .setTitle('📋 Support')
            .setColor('#a0123b')
            .setDescription(`Bonjour ${interaction.user},\n\nMerci d'avoir contacté le support de **${interaction.guild.name}**.\n\nVeuillez décrire votre problème afin que nous puissions vous aider au mieux.`);
        const embed2 = new EmbedBuilder()
            .setColor('#a0123b')
            .setDescription(`Déjà client chez Plexify ? Indiquez l'adresse email liée à votre compte Plex pour accélérer votre prise en charge.\n\nPour les essai gratuits:\nInscrivez-vous sur https://plex.tv/ et indiquez-nous votre adresse e-mail !`);

        await channel.send({embeds: [embed, embed2]});
    } catch (error) {
        console.error("Erreur lors de la création du ticket", error);
    }
}

async function createTicketAndSendReply(interaction, type) {
    await createTicket(interaction, type);
    await interaction.reply({content: "Votre ticket a bien été créé !", ephemeral: true});
}

client.on("interactionCreate", async (interaction) => {
    if (interaction.isStringSelectMenu() && interaction.customId === 'ticket') {
        const tickets = (await client.db.all()).filter(o => o.id.startsWith(`ticket_`)).map(o => o.value);

        if (tickets.find(o => o.creator === interaction.user.id)) {
            await interaction.reply({content: "Vous avez déjà un ticket ouvert !", ephemeral: true});
            return;
        }

        const allowedValues = Object.keys(ticketTypes);
        if (allowedValues.includes(interaction.values[0])) {
            await createTicketAndSendReply(interaction, ticketTypes[interaction.values[0]]);
        }
    }
});