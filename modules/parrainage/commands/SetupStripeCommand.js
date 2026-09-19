const {DB_KEY_STRIPE, denyIfNotAllowed, stripeClient, stripeError} = require('../lib');

module.exports = {
    name: 'setupstripe',
    description: 'Configure la clé API Stripe utilisée pour les parrainages',
    ephemeral: true,
    options: [
        {
            name: 'cle_api',
            description: 'Clé API secrète Stripe (sk_... ou rk_...)',
            type: 3,
            required: true,
        },
    ],

    run: async (client, interaction) => {
        if (await denyIfNotAllowed(interaction)) return;

        const apiKey = interaction.options.getString('cle_api').trim();
        if (!/^(sk|rk)_(live|test)_/.test(apiKey)) {
            await interaction.editReply({content: '❌ Clé invalide : elle doit commencer par `sk_live_`, `sk_test_`, `rk_live_` ou `rk_test_`.'});
            return;
        }

        // Vérifie que la clé fonctionne et a accès aux clients avant de l'enregistrer
        try {
            await stripeClient(apiKey).get('/customers', {params: {limit: 1}});
        } catch (e) {
            await interaction.editReply({content: `❌ Clé refusée par Stripe : ${stripeError(e)}`});
            return;
        }

        await client.db.set(DB_KEY_STRIPE, apiKey);
        const mode = apiKey.includes('_live_') ? 'live' : 'test';
        await interaction.editReply({content: `✅ Clé Stripe enregistrée (mode **${mode}**, se termine par \`${apiKey.slice(-4)}\`).`});
    },
};
