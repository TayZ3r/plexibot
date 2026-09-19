const axios = require('axios');

// Rôle Discord autorisé à utiliser les commandes de parrainage (fixe, ne change pas)
const ALLOWED_ROLE_ID = '1165286018593861725';

const STRIPE_API = 'https://api.stripe.com/v1';
const DB_KEY_STRIPE = 'parrainage.stripeKey';

// Statuts d'abonnement pris en compte pour calculer le crédit
const COUNTED_STATUSES = ['active', 'past_due'];

async function hasAllowedRole(interaction) {
    const member = interaction.member ?? await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
    return Boolean(member?.roles?.cache?.has(ALLOWED_ROLE_ID));
}

async function denyIfNotAllowed(interaction) {
    if (await hasAllowedRole(interaction)) return false;
    await interaction.editReply({content: "❌ Vous n'avez pas la permission d'utiliser cette commande."});
    return true;
}

function stripeClient(apiKey) {
    return axios.create({
        baseURL: STRIPE_API,
        auth: {username: apiKey, password: ''},
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        timeout: 15000,
    });
}

function stripeError(e) {
    return e.response?.data?.error?.message || e.message;
}

// Stripe filtre les emails de façon sensible à la casse : on cherche l'email tel quel
// et en minuscules, puis on dédoublonne par id.
async function findCustomersByEmail(stripe, email) {
    const variants = [...new Set([email, email.toLowerCase()])];
    const found = new Map();
    for (const variant of variants) {
        const resp = await stripe.get('/customers', {params: {email: variant, limit: 10}});
        for (const c of resp.data.data) found.set(c.id, c);
    }
    return [...found.values()];
}

async function listCountedSubscriptions(stripe, customerId) {
    const subs = [];
    let startingAfter;
    do {
        const resp = await stripe.get('/subscriptions', {
            params: {customer: customerId, status: 'all', limit: 100, starting_after: startingAfter},
        });
        subs.push(...resp.data.data);
        startingAfter = resp.data.has_more ? resp.data.data.at(-1).id : undefined;
    } while (startingAfter);
    return subs.filter(s => COUNTED_STATUSES.includes(s.status));
}

function intervalToMonths({interval, interval_count: count}) {
    if (interval === 'month') return count;
    if (interval === 'year') return count * 12;
    return null;
}

function periodLabel(months) {
    const labels = {1: 'mensuel', 3: 'trimestriel', 6: 'semestriel', 12: 'annuel'};
    return labels[months] ?? `tous les ${months} mois`;
}

// Prix catalogue d'une facture de l'abonnement : somme des (prix unitaire × quantité)
// de ses éléments, sans coupons. Renvoie une erreur si le tarif n'est pas calculable.
function describeSubscription(sub) {
    const items = sub.items?.data ?? [];
    if (items.length === 0) return {sub, error: 'aucun élément'};

    let billed = 0;
    let months = null;
    let currency = null;
    for (const item of items) {
        const price = item.price;
        if (!price?.recurring) return {sub, error: 'tarif non récurrent'};
        if (price.billing_scheme === 'tiered' || price.recurring.usage_type === 'metered') {
            return {sub, error: 'tarif par paliers ou à l\'usage non géré'};
        }
        const unit = price.unit_amount ?? Math.round(parseFloat(price.unit_amount_decimal));
        if (!Number.isFinite(unit)) return {sub, error: 'prix unitaire introuvable'};

        const itemMonths = intervalToMonths(price.recurring);
        if (!itemMonths) return {sub, error: `périodicité « ${price.recurring.interval} » non gérée`};

        billed += unit * (item.quantity ?? 1);
        months = itemMonths;
        currency = price.currency;
    }
    return {sub, billed, months, currency};
}

function formatAmount(cents, currency = 'eur') {
    return (cents / 100).toLocaleString('fr-FR', {style: 'currency', currency: currency.toUpperCase()});
}

module.exports = {
    DB_KEY_STRIPE,
    denyIfNotAllowed,
    stripeClient,
    stripeError,
    findCustomersByEmail,
    listCountedSubscriptions,
    describeSubscription,
    periodLabel,
    formatAmount,
};
