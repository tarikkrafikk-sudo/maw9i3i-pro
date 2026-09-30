const express = require('express');
const app = express();
app.use(express.json());
app.use(express.static('.')); // kaykhdem index.html dyalk

const PORT = process.env.PORT || 10000;

app.post('/api/pay', async (req,res)=>{
  const r = await fetch('https://youcanpay.com/api/pay',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({
      pri_key: process.env.YOUCAN_PRIVATE_KEY,
      amount: req.body.amount*100,
      currency: 'MAD',
      order_id: 'ORDER-'+Date.now(),
      success_url: 'https://www.maw9i3i-pro.com/success.html',
      fail_url: 'https://www.maw9i3i-pro.com/fail.html'
    })
  });
  const data = await r.json();
  res.json(data);
});

app.listen(PORT, ()=>console.log('Node khdam'));
