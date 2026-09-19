const {
    DB_KEY_STRIPE,
    denyIfNotAllowed,
    stripeClient,
    stripeError,
    findCustomersByEmail,
    listCountedSubscriptions,
    describeSubscription,
    periodLabel,
    formatAmount,
} = require('../lib');

module.exports = {
    name: 'parrain',
    description: 'Crédite au parrain 1 ou 2 mois de son abonnement Stripe',
    options: [
        {
            name: 'email',
            description: 'Email Stripe du parrain à créditer',
            type: 3,
            required: true,
        },
        {
            name: 'mois_offerts',
            description: 'Nombre de mois offerts au parrain',
            type: 4,
            required: true,
            choices: [
                {name: '1 mois', value: 1},
                {name: '2 mois', value: 2},
            ],
        },
    ],

    run: async (client, interaction) => {
        if (await denyIfNotAllowed(interaction)) return;

        const email = interaction.options.getString('email').trim();
        const freeMonths = interaction.options.getInteger('mois_offerts');

        const apiKey = await client.db.get(DB_KEY_STRIPE);
        if (!apiKey) {
            await interaction.editReply({content: "❌ Aucune clé Stripe configurée. Utilisez `/setupstripe` d'abord."});
            return;
        }

        const stripe = stripeClient(apiKey);

        let customers;
        try {
            customers = await findCustomersByEmail(stripe, email);
        } catch (e) {
            await interaction.editReply({content: `❌ Erreur Stripe lors de la recherche : ${stripeError(e)}`});
            return;
        }

        if (customers.length === 0) {
            await interaction.editReply({content: `❌ Aucun compte Stripe trouvé pour \`${email}\`. Aucun crédit effectué.`});
            return;
        }
        if (customers.length > 1) {
            await interaction.editReply({
                content: `❌ ${customers.length} comptes Stripe trouvés pour \`${email}\`. Aucun crédit effectué, à régler manuellement dans Stripe.`,
            });
            return;
        }
        const customer = customers[0];

        let subs;
        try {
            subs = await listCountedSubscriptions(stripe, customer.id);
        } catch (e) {
            await interaction.editReply({content: `❌ Erreur Stripe lors de la lecture des abonnements : ${stripeError(e)}`});
            return;
        }
        if (subs.length === 0) {
            await interaction.editReply({content: `❌ Aucun abonnement actif pour \`${email}\`. Aucun crédit effectué.`});
            return;
        }

        const described = subs.map(describeSubscription);
        const invalid = described.filter(d => d.error);
        if (invalid.length > 0) {
            const details = invalid.map(d => `\`${d.sub.id}\` : ${d.error}`).join('\n');
            await interaction.editReply({
                content: `❌ Impossible de calculer le prix de certains abonnements de \`${email}\`. Aucun crédit effectué.\n${details}`,
            });
            return;
        }

        // Abonnement retenu : celui dont la facture est la plus élevée
        const best = described.reduce((a, b) => (b.billed > a.billed ? b : a));
        const credit = Math.round(best.billed / best.months * freeMonths);
        if (credit <= 0) {
            await interaction.editReply({content: `❌ Le montant calculé est nul pour \`${email}\`. Aucun crédit effectué.`});
            return;
        }

        const period = periodLabel(best.months);
        try {
            // Un montant négatif sur le solde client = un crédit, déduit des prochaines factures
            const resp = await stripe.post(
                `/customers/${customer.id}/balance_transactions`,
                new URLSearchParams({
                    amount: String(-credit),
                    currency: best.currency,
                    description: `Parrainage : ${freeMonths} mois offert(s) sur abonnement ${period} (Discord, par ${interaction.user.username})`,
                }),
                {headers: {'Idempotency-Key': `parrain-${interaction.id}`}},
            );
            const balance = resp.data.ending_balance;
            await interaction.editReply({
                content: [
                    `✅ **${formatAmount(credit, best.currency)}** crédités sur le compte de \`${email}\`.`,
                    `Abonnement retenu : ${period}, ${formatAmount(best.billed, best.currency)} par facture.`,
                    `Calcul : ${formatAmount(best.billed, best.currency)} ÷ ${best.months} mois × ${freeMonths} mois offert(s).`,
                    `Nouveau crédit disponible : **${formatAmount(-balance, best.currency)}**.`,
                ].join('\n'),
            });
        } catch (e) {
            await interaction.editReply({content: `❌ Erreur Stripe lors du crédit : ${stripeError(e)}`});
        }
    },
};
