const express = require('express');
const app = express();

app.use(express.json());
app.use((req,res,next)=>{
  res.header('Access-Control-Allow-Origin','*');
  res.header('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS') return res.sendStatus(200);
  next();
});

app.post('/api/pay', (req,res)=>{
  console.log('ORDER:', req.body);
  res.json({success:true, order_id:'ORD-'+Date.now()});
});

app.get('/api/pay', (req,res)=>{
  res.json({status:'API running'});
});

app.use(express.static(__dirname));

const PORT = process.env.PORT || 10000;
app.listen(PORT, ()=>console.log('online on '+PORT));
