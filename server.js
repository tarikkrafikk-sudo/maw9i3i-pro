/**
 * server.js - Backend de paiement (YouCan Pay) - Maw9i3i.pro
 * =============================================================================
 * Deploye sur Render (maw9i3i-pro.onrender.com). Recoit les requetes AJAX du
 * modal de paiement (payment-modal.js) depuis www.maw9i3i-pro.com, appelle
 * l'API Tokenize de YouCan Pay, et renvoie du JSON propre (jamais une
 * redirection ni du HTML brut).
 *
 * IMPORTANT - correction par rapport a la demande initiale :
 * -----------------------------------------------------------------------
 * YouCan Pay ne documente aucune URL du type
 * "https://youcanpay.com/sandbox/payment-form/{token}" vers laquelle
 * rediriger le client. Le flux officiel (Tokenize -> yp.js) affiche le
 * formulaire de paiement directement DANS votre page via le widget embarque
 * yp.js - ce qui sert encore mieux votre besoin ("le modal reste sur le
 * domaine principal"), puisque le client ne quitte jamais maw9i3i-pro.com,
 * meme pas pour une redirection vers youcanpay.com.
 *
 * Ce serveur renvoie donc { token, public_key, ... } et c'est
 * payment-modal.js (cote frontend) qui monte le formulaire yp.js avec ce
 * token, a l'interieur du modal.
 *
 * Sources verifiees dans la documentation officielle avant d'ecrire ce code :
 * - Tokenize endpoint + champs :  https://developer.youcan.shop/youcan-pay/payment/tokenize
 * - Payment flow:                 https://developer.youcan.shop/youcan-pay/payment-flow
 * - yp.js (embed):                https://developer.youcan.shop/youcan-pay/yp-js/getting-started
 * - Webhooks (HMAC-SHA256):       https://developer.youcan.shop/youcan-pay/webhooks
 * =============================================================================
 */

'use strict';

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

const app = express();

// Raw body pour le webhook (necessaire pour verifier la signature), JSON normal pour le reste
app.use('/api/pay/webhook', express.raw({ type: '*/*' }));
app.use(express.json());

// -----------------------------------------------------------------------
// 1) Configuration - a definir dans Render (Environment Variables)
// -----------------------------------------------------------------------
const {
  YOUCAN_PRIVATE_KEY,                  // pri_sandbox_xxx (ou pri_live_xxx en production)
  YOUCAN_PUBLIC_KEY,                   // pub_sandbox_xxx (ou pub_live_xxx en production)
  YOUCAN_SANDBOX = 'true',             // 'true' en test, 'false' en production
  ALLOWED_ORIGIN = 'https://www.maw9i3i-pro.com,https://maw9i3i-pro.com',
  SUCCESS_URL = 'https://www.maw9i3i-pro.com/payment-success',
  ERROR_URL = 'https://www.maw9i3i-pro.com/payment-failed',
  PORT = 3000,
} = process.env;

const IS_SANDBOX = YOUCAN_SANDBOX !== 'false';
const TOKENIZE_URL = IS_SANDBOX
  ? 'https://youcanpay.com/sandbox/api/tokenize'
  : 'https://youcanpay.com/api/tokenize';

if (!YOUCAN_PRIVATE_KEY || !YOUCAN_PUBLIC_KEY) {
  // On ne bloque pas le demarrage (pour eviter une boucle de crash sur Render),
  // mais on log une erreur bien visible.
  console.error('[FATAL] YOUCAN_PRIVATE_KEY et/ou YOUCAN_PUBLIC_KEY manquants dans les variables d\'environnement !');
}

// -----------------------------------------------------------------------
// 2) CORS - uniquement votre domaine principal, jamais "*"
// -----------------------------------------------------------------------
const allowedOrigins = ALLOWED_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    // origin est undefined pour les requetes serveur-a-serveur (curl, Postman...) - on les autorise
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('CORS: Origin not allowed -> ' + origin));
  },
  methods: ['POST', 'GET', 'OPTIONS'],
}));

// -----------------------------------------------------------------------
// 3) Prix des packs - definis COTE SERVEUR uniquement !
// -----------------------------------------------------------------------
// Ne jamais faire confiance a un montant envoye par le frontend
// (req.body.amount) : n'importe qui peut le modifier depuis DevTools et
// payer 1 DH au lieu de 1499 DH. Le prix est toujours lu ici, a partir du
// pack_slug envoye par le client.
// Modifiez/ajoutez des packs selon vos produits reels.
const PACKS = {
  bdaya:    { label: 'Pack BDAYA',           amount_dh: 499  },
  mo9awala: { label: 'Pack MO9AWALA SGHIRA', amount_dh: 1499 },
  lkra:     { label: 'Pack L-KRA (mensuel)', amount_dh: 199  },
};

// -----------------------------------------------------------------------
// 4) Rate limiting simple en memoire (20 requetes/minute par IP) - suffisant
//    contre le spam basique. Si le trafic est important, remplacez par Redis.
// -----------------------------------------------------------------------
const hits = new Map();
function isRateLimited(ip) {
  const now = Date.now();
  const windowMs = 60000;
  const entry = hits.get(ip) || { count: 0, resetAt: now + windowMs };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + windowMs;
  }
  entry.count += 1;
  hits.set(ip, entry);
  return entry.count > 20;
}

function getClientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return xf.split(',')[0].trim();
  return req.socket.remoteAddress || '0.0.0.0';
}

function safeString(v, max) {
  max = max || 150;
  return String(v == null ? '' : v).trim().slice(0, max);
}

// -----------------------------------------------------------------------
// 5) POST /api/pay - cree un token de paiement chez YouCan Pay
// -----------------------------------------------------------------------
app.post('/api/pay', async (req, res) => {
  const ip = getClientIp(req);
  if (isRateLimited(ip)) {
    return res.status(429).json({ success: false, message: 'Trop de requetes. Reessayez dans un instant.' });
  }

  if (!YOUCAN_PRIVATE_KEY || !YOUCAN_PUBLIC_KEY) {
    return res.status(500).json({ success: false, message: 'Le service n\'est pas encore configure. Contactez le support.' });
  }

  const body = req.body || {};
  const pack_slug = body.pack_slug;
  const customer = body.customer || {};
  const pack = PACKS[pack_slug];

  if (!pack) {
    return res.status(400).json({ success: false, message: 'Pack inconnu.' });
  }

  const orderId = 'ORD-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  const amountCentimes = Math.round(pack.amount_dh * 100); // Tokenize attend le montant en unite minimale (centimes)

  try {
    const form = new FormData(); // FormData native (fetch) - Node 18+
    form.append('pri_key', YOUCAN_PRIVATE_KEY);
    form.append('order_id', orderId);
    form.append('amount', String(amountCentimes));
    form.append('currency', 'MAD');
    form.append('success_url', SUCCESS_URL);
    form.append('error_url', ERROR_URL);
    form.append('metadata[pack_slug]', pack_slug);
    form.append('metadata[source]', 'maw9i3i-pro-website');

    if (customer.name)  form.append('customer[name]', safeString(customer.name));
    if (customer.email) form.append('customer[email]', safeString(customer.email, 190));
    if (customer.phone) form.append('customer[phone]', safeString(customer.phone, 30));

    const ycRes = await fetch(TOKENIZE_URL, { method: 'POST', body: form });
    const ycData = await ycRes.json().catch(() => ({}));

    if (!ycRes.ok || !ycData.token) {
      console.error('[YouCan Pay] Tokenize a echoue:', ycRes.status, ycData);
      return res.status(502).json({
        success: false,
        message: ycData.message || 'Impossible de demarrer le paiement chez YouCan Pay.',
      });
    }

    // Log de la tentative de paiement (a remplacer par votre vraie base de donnees)
    console.log('[order] ' + orderId + ' - ' + pack.label + ' - ' + pack.amount_dh + ' DH - transaction_id=' + ycData.transaction_id);

    return res.json({
      success: true,
      order_id: orderId,
      token: ycData.token,
      transaction_id: ycData.transaction_id,
      public_key: YOUCAN_PUBLIC_KEY,
      sandbox: IS_SANDBOX,
      amount_dh: pack.amount_dh,
      pack_label: pack.label,
    });
  } catch (err) {
    console.error('[YouCan Pay] Erreur de connexion:', err);
    return res.status(502).json({ success: false, message: 'Impossible de contacter le service de paiement. Reessayez.' });
  }
});

// -----------------------------------------------------------------------
// 6) (fortement recommande) POST /api/pay/webhook - confirmation reelle du paiement
// -----------------------------------------------------------------------
// Ce que renvoie payment.confirm() cote frontend (result.status === 'succeeded')
// vient du navigateur du client : n'importe qui peut le falsifier depuis
// DevTools et pretendre avoir paye sans rien payer. La seule confirmation
// fiable est ce webhook, envoye par YouCan Pay serveur-a-serveur et signe en
// HMAC-SHA256. Ajoutez cette URL dans le Dashboard YouCan Pay :
//   https://maw9i3i-pro.onrender.com/api/pay/webhook
app.post('/api/pay/webhook', (req, res) => {
  const signature = req.headers['x-youcanpay-signature'];
  const rawBody = req.body; // Buffer (grace a express.raw ci-dessus)

  if (!signature || !YOUCAN_PRIVATE_KEY) {
    return res.status(400).send('missing signature');
  }

  const expected = crypto
    .createHmac('sha256', YOUCAN_PRIVATE_KEY)
    .update(rawBody)
    .digest('hex');

  const sigBuf = Buffer.from(String(signature));
  const expBuf = Buffer.from(expected);
  const valid = sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);

  if (!valid) {
    console.warn('[webhook] Signature invalide - requete ignoree.');
    return res.status(403).send('invalid signature');
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch (e) {
    return res.status(400).send('invalid json');
  }

  console.log('[webhook] event:', event.event_name, JSON.stringify(event.payload));

  // TODO: remplacez par votre vraie logique (mise a jour base de donnees,
  // email de confirmation, activation du service...) selon event.event_name :
  //   - "transaction.paid"   -> paiement reussi
  //   - "transaction.failed" -> paiement echoue

  res.status(200).send('ok');
});

// -----------------------------------------------------------------------
// 7) Health check (utile pour verifier que Render tourne bien)
// -----------------------------------------------------------------------
app.get('/api/pay/health', (req, res) => {
  res.json({ ok: true, sandbox: IS_SANDBOX, tokenize_url: TOKENIZE_URL });
});

app.listen(PORT, () => {
  console.log('Payment backend listening on port ' + PORT + ' - sandbox=' + IS_SANDBOX);
});
