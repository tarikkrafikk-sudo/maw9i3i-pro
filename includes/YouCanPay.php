<?php
/**
 * includes/YouCanPay.php
 * -----------------------------------------------------------------------
 * Client léger (sans Composer) pour l'API YouCan Pay v2.
 * عميل PHP خفيف (بلا Composer) لـ YouCan Pay API v2 — باش الملفات يبقاو
 * سهلين للرفع بالـ FTP.
 *
 * Documentation officielle : https://developer.youcan.shop/youcan-pay/introduction
 *
 * IMPORTANT / مهم:
 * L'endpoint "Tokenize" (POST /api/tokenize) est documenté officiellement
 * et confirmé par le SDK officiel (composer: youcanpay/payment-sdk).
 * Le champ exact retourné pour l'URL de paiement hébergée ("standalone
 * redirect") n'est PAS publié tel quel dans la doc publique au moment de
 * l'écriture de ce fichier : le SDK officiel expose une méthode
 * `getPaymentURL($locale)` sur l'objet Token, mais ne documente pas la
 * chaîne exacte. C'est pourquoi ce client fournit DEUX façons d'utiliser
 * le token, et te laisse choisir celle qui marche le mieux avec ton compte :
 *
 *   1) redirectUrl()  → construit une URL de paiement hébergée à partir du
 *      token (pattern déduit du SDK officiel : pay.youcan.shop/{token}).
 *      À TESTER en sandbox avant la mise en prod. Si ça ne fonctionne pas,
 *      contacte le support YouCan Pay ou installe le SDK officiel
 *      (composer require youcanpay/payment-sdk) qui gère ça pour toi.
 *
 *   2) Le formulaire intégré (voir /pay/checkout.php + assets/ycpay-form.js)
 *      qui utilise le script officiel https://pay.youcan.shop/js/ycpay.js
 *      — CETTE méthode est 100% documentée et garantie de fonctionner.
 *      C'est la méthode utilisée par défaut dans ce projet.
 *
 * Dans les deux cas, la confirmation RÉELLE et fiable du paiement se fait
 * toujours côté serveur via le webhook (/pay/webhook.php) — jamais via le
 * simple retour du navigateur.
 * -----------------------------------------------------------------------
 */

class YouCanPayException extends Exception {}

class YouCanPay
{
    private string $privateKey;
    private string $publicKey;
    private bool $sandbox;

    public function __construct(string $privateKey, string $publicKey, bool $sandbox = true)
    {
        $this->privateKey = $privateKey;
        $this->publicKey  = $publicKey;
        $this->sandbox    = $sandbox;
    }

    /**
     * Base de l'API REST (Tokenize, Transactions...).
     * Sandbox base URI documentée : https://youcanpay.com/sandbox/api/
     */
    private function apiBase(): string
    {
        return $this->sandbox
            ? 'https://youcanpay.com/sandbox/api'
            : 'https://youcanpay.com/api';
    }

    /**
     * تكوين "توكن" الأداء (Tokenize) — أول خطوة فكل عملية أداء.
     * Crée un jeton de paiement (Tokenize) — 1ère étape de toute transaction.
     *
     * @param string $orderId     معرف الطلب الفريد ديالنا (order_id)
     * @param int    $amountCentimes مبلغ بالسنتيم (MAD * 100) — مثال: 49900 = 499.00 DH
     * @param string $successUrl  URL يرجع ليها الزبون من بعد نجاح الأداء
     * @param string $errorUrl    URL يرجع ليها الزبون من بعد فشل الأداء
     * @param array  $customer    ['name'=>, 'email'=>, 'phone'=>, 'country_code'=>'MA', ...]
     * @param array  $metadata    بيانات إضافية اختيارية (pack_slug, payment_type...)
     *
     * @return array{token_id: string, transaction_id: string|null, raw: array}
     * @throws YouCanPayException
     */
    public function tokenize(
        string $orderId,
        int $amountCentimes,
        string $successUrl,
        string $errorUrl,
        array $customer = [],
        array $metadata = []
    ): array {
        if ($this->privateKey === '') {
            throw new YouCanPayException('YOUCAN_PRIVATE_KEY غير محدد فملف .env');
        }

        $customerDefaults = [
            'name'         => '',
            'address'      => '',
            'zip_code'     => '',
            'city'         => '',
            'state'        => '',
            'country_code' => 'MA',
            'phone'        => '',
            'email'        => '',
        ];
        $customer = array_merge($customerDefaults, $customer);

        $payload = [
            'pri_key'     => $this->privateKey,
            'order_id'    => $orderId,
            'amount'      => (string) $amountCentimes, // بالسنتيم (integer minor units)
            'currency'    => YOUCAN_CURRENCY,
            'success_url' => $successUrl,
            'error_url'   => $errorUrl,
            'customer'    => $customer,
            'metadata'    => $metadata,
        ];

        $response = $this->post($this->apiBase() . '/tokenize', $payload);

        $tokenId = $response['token']['id']
            ?? (is_string($response['token'] ?? null) ? $response['token'] : null)
            ?? $response['id']
            ?? null;

        if (!$tokenId) {
            throw new YouCanPayException(
                'ما توصلناش بـ token من YouCan Pay. الجواب: ' . json_encode($response, JSON_UNESCAPED_UNICODE)
            );
        }

        return [
            'token_id'       => (string) $tokenId,
            'transaction_id' => $response['transaction_id'] ?? null,
            'raw'            => $response,
        ];
    }

    /**
     * URL ديال صفحة الأداء المستضافة (hosted checkout) بناءً على التوكن.
     * ⚠️ اختبر هاد الرابط فوضع sandbox قبل ما تفعّلو فالإنتاج (voir note en haut du fichier).
     */
    public function redirectUrl(string $tokenId, string $locale = 'ar'): string
    {
        $base = 'https://pay.youcan.shop';
        return $base . '/' . rawurlencode($tokenId) . '?lang=' . rawurlencode($locale)
            . ($this->sandbox ? '&sandbox=1' : '');
    }

    /**
     * التحقق من توقيع الـ webhook (HMAC-SHA256 على الـ body الخام + المفتاح الخاص).
     * Vérifie la signature webhook (HMAC-SHA256 sur le corps brut + clé privée).
     *
     * @param string $rawBody   الـ body الخام كيفما وصل بلا أي تعديل (json_decode/encode كيبدل البايتات!)
     * @param string $signature قيمة الهيدر X-YOUCANPAY-SIGNATURE
     */
    public function verifyWebhookSignature(string $rawBody, string $signature): bool
    {
        if ($signature === '' || $this->privateKey === '') {
            return false;
        }
        $expected = hash_hmac('sha256', $rawBody, $this->privateKey);
        return hash_equals($expected, $signature);
    }

    /**
     * طلب POST بصيغة form-data (application/x-www-form-urlencoded) عبر cURL.
     */
    private function post(string $url, array $data): array
    {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => http_build_query($data),
            CURLOPT_HTTPHEADER     => [
                'Accept: application/json',
                'Content-Type: application/x-www-form-urlencoded',
            ],
            CURLOPT_TIMEOUT        => 30,
            CURLOPT_SSL_VERIFYPEER => true,
        ]);

        $body    = curl_exec($ch);
        $errno   = curl_errno($ch);
        $error   = curl_error($ch);
        $status  = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($errno !== 0) {
            throw new YouCanPayException('خطأ فالاتصال بـ YouCan Pay: ' . $error);
        }

        $decoded = json_decode((string) $body, true);
        if (!is_array($decoded)) {
            throw new YouCanPayException('جواب غير صالح من YouCan Pay (HTTP ' . $status . '): ' . substr((string) $body, 0, 500));
        }

        if ($status >= 400) {
            $msg = $decoded['message'] ?? $decoded['error'] ?? json_encode($decoded, JSON_UNESCAPED_UNICODE);
            throw new YouCanPayException('YouCan Pay رفض الطلب (HTTP ' . $status . '): ' . $msg);
        }

        return $decoded;
    }
}
