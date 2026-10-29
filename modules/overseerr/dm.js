const chalk = require('chalk');
const {EmbedBuilder} = require('discord.js');
const {getNotificationConfig, getTmdbUrl} = require('./notifications');

async function sendNotificationEmbed(client, {discordId, type, subject, message, image, media}) {
    const config = getNotificationConfig(type);
    if (!config) return;

    const user = await client.users.fetch(discordId);

    const embed = new EmbedBuilder()
        .setAuthor({name: config.author})
        .setTitle((subject || 'Plexify').slice(0, 256))
        .setColor(config.color)
        .setTimestamp();

    if (message) embed.setDescription(message.slice(0, 4000));
    if (image) embed.setThumbnail(image);

    if (type === 'MEDIA_AVAILABLE') {
        const tmdbUrl = getTmdbUrl(media);
        if (tmdbUrl) embed.setURL(tmdbUrl);
    }

    await user.send({embeds: [embed]});
    console.log(chalk.green(`[Overseerr] DM envoyé à ${user.tag} (${subject})`));
}

module.exports = {sendNotificationEmbed};
