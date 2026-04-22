const axios = require('axios');

module.exports = {
    name: 'liens',
    description: 'Affiche les informations et liens pour s\'abonner',

    run: async (client, interaction) => {
        try {
            const resp = await axios.get(`${process.env.ADMIN_API_URL}/api/liens-message`, {
                headers: {'X-Bot-Api-Key': process.env.BOT_API_KEY},
                timeout: 5000,
            });
            const message = resp.data.message;
            if (!message) {
                await interaction.editReply({content: '❌ Aucun message configuré. Contactez un administrateur.'});
                return;
            }
            await interaction.editReply({content: message});
        } catch (e) {
            const msg = e.response?.data?.error || e.message;
            await interaction.editReply({content: `❌ Erreur : ${msg}`});
        }
    },
};
