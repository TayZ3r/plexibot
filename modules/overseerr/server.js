const http = require('http');
const crypto = require('crypto');
const chalk = require('chalk');
const {getNotificationConfig} = require('./notifications');
const {sendNotificationEmbed} = require('./dm');

const WEBHOOK_PATH = '/overseerr';
const MAX_BODY_BYTES = 1024 * 1024;

// Comparaison à temps constant de l'en-tête Authorization envoyé par Overseerr
function isAuthorized(header, secret) {
    if (!secret || !header) return false;
    const a = Buffer.from(String(header));
    const b = Buffer.from(String(secret));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function readJson(req) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                reject(new Error('Body trop volumineux'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
            } catch (e) {
                reject(e);
            }
        });
        req.on('error', reject);
    });
}

async function handleNotification(client, body, testDiscordId) {
    const {notification_type, subject, message, image, media, request} = body;
    const type = notification_type ? String(notification_type).toUpperCase() : '';

    if (!getNotificationConfig(type)) {
        console.log(chalk.gray(`[Overseerr] Notification ${type || '?'} ignorée`));
        return;
    }

    const discordId = type === 'TEST_NOTIFICATION'
        ? testDiscordId
        : request?.requestedBy_settings_discordId;

    if (!discordId) {
        console.log(chalk.yellow(`[Overseerr] Pas d'ID Discord pour ${request?.requestedBy_username || type}, DM ignoré`));
        return;
    }

    try {
        await sendNotificationEmbed(client, {discordId, type, subject, message, image, media});
    } catch (err) {
        console.error(chalk.red(`[Overseerr] Impossible d'envoyer le DM à ${discordId} (code ${err.code}) : ${err.message}`));
    }
}

function createServer(client, {secret, testDiscordId}) {
    return http.createServer(async (req, res) => {
        const url = (req.url || '').split('?')[0];

        if (req.method === 'GET' && url === `${WEBHOOK_PATH}/health`) {
            res.writeHead(200, {'Content-Type': 'application/json'});
            res.end(JSON.stringify({ok: true, discord: client.isReady()}));
            return;
        }

        if (req.method !== 'POST' || url !== WEBHOOK_PATH) {
            res.writeHead(404).end();
            return;
        }

        if (!isAuthorized(req.headers.authorization, secret)) {
            console.log(chalk.red('[Overseerr] Requête refusée : en-tête Authorization invalide'));
            res.writeHead(401).end();
            return;
        }

        let body;
        try {
            body = await readJson(req);
        } catch (e) {
            res.writeHead(400).end();
            return;
        }

        // Réponse immédiate à Overseerr, l'envoi du DM se fait ensuite
        res.writeHead(200).end();
        await handleNotification(client, body, testDiscordId);
    });
}

module.exports = {createServer, isAuthorized, handleNotification};
