const client = require('../../../index');
const { EmbedBuilder } = require('discord.js');

console.log('[annonces] AnnonceCreation.js chargé');

client.on('messageCreate', async (message) => {
  try {
    if (message.author.bot || !message.guild) return;

    const channelId = process.env.ANNOUNCEMENTS_CHANNEL_ID;
    if (!channelId) {
      console.error('[annonces] ANNOUNCEMENTS_CHANNEL_ID manquant dans .env');
      return;
    }
    if (message.channel.id !== channelId) return;

    const raw = (message.content || '').trim();
    if (!raw) return;

    const lines = raw.split('\n').filter(l => l.trim() !== '');
    const titleLine = lines.shift() || 'Annonce';

    // 🟢 Ici : on double les retours à la ligne
    const body = lines.join('\n').replace(/\n/g, '\n\n');

    await message.delete().catch(() => {});

    const signature = `L'équipe <:plexify_1:1309433875034013726><:plexify_2:1309433876677922836><:plexify_3:1309433878234140682>`;

    const embed = new EmbedBuilder()
      .setTitle(`📺  Annonce Plexify - ${titleLine}`)
      .setColor('#a0123b')
      .setDescription((body ? body + '\n\n' : '') + signature)
      .setTimestamp();

    await message.channel.send({ embeds: [embed] });
  } catch (error) {
    console.error('[annonces] Erreur:', error.stack || error.message);
  }
});
