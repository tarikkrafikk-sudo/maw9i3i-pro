export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const body = req.body;

    // 9ra les infos li jayin mn modal
    const customer_name = body.customer_name || body.name || 'Client';
    const customer_phone = body.customer_phone || body.phone || '';
    const customer_address = body.customer_address || body.address || 'Agadir';
    const quantity = body.quantity || 1;

    // Prix - bdelha ila bghiti
    const amount = 19900; // 199 DH en centimes

    const youcanPayload = {
      amount: amount * parseInt(quantity),
      currency: "MAD",
      customer: {
        name: customer_name,
        phone: customer_phone,
        address: customer_address
      },
      payment_method: {
        type: "cash"
      },
      metadata: {
        product: body.product_name || "Produit",
        quantity: quantity
      },
      success_url: "https://maw9i3i-pro.com/success.php",
      fail_url: "https://maw9i3i-pro.com/fail.php"
    };

    const response = await fetch("https://youcanpay.com/api/payment", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Preferred-Locale": "fr",
        "Authorization": "Bearer " + process.env.YOUCANPAY_PRIVATE_KEY
      },
      body: JSON.stringify(youcanPayload)
    });

    const data = await response.json();
    
    if (!response.ok) {
      return res.status(400).json(data);
    }

    return res.status(200).json(data);

  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
}
