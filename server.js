
/*
 LightTaskSheet - server.js (Production Build)
 Provides:
  - Simple JWT auth (HMAC SHA256)
  - JSON-file-based storage per user
  - /api/register
  - /api/login
  - /api/sheet/:username  (GET/POST)
  - No external dependencies except express, jsonwebtoken, bcryptjs
*/

const express = require('express');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const app = express();
app.use(express.json({ limit: '2mb' }));

const DATA_DIR = path.join(__dirname, 'data');
if(!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const USERS_FILE = path.join(DATA_DIR, 'users.json');
if(!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, JSON.stringify({}));

const SECRET = "lighttasksheet-secret-key-change-this";

function loadUsers(){
  if(!fs.existsSync(USERS_FILE)) return {};
  return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8') || "{}");
}

function saveUsers(obj){
  fs.writeFileSync(USERS_FILE, JSON.stringify(obj, null, 2));
}

function auth(req, res, next){
  const h = req.headers['authorization'];
  if(!h) return res.status(401).json({error:"Missing Authorization"});
  const token = h.replace(/^Bearer\s+/i,'');
  try{
    const dec = jwt.verify(token, SECRET);
    req.user = dec.username;
    next();
  }catch(e){
    return res.status(401).json({error:"Invalid token"});
  }
}

app.post('/api/register', (req,res)=>{
  const { username, password } = req.body;
  if(!username || !password) return res.status(400).json({error:"Missing fields"});
  const users = loadUsers();
  if(users[username]) return res.status(400).json({error:"User exists"});
  const hash = bcrypt.hashSync(password,10);
  users[username] = { password: hash };
  saveUsers(users);
  return res.json({ success:true });
});

app.post('/api/login', (req,res)=>{
  const { username, password } = req.body;
  const users = loadUsers();
  const u = users[username];
  if(!u) return res.status(401).json({error:"Invalid login"});
  if(!bcrypt.compareSync(password, u.password)) return res.status(401).json({error:"Invalid login"});
  const token = jwt.sign({ username }, SECRET, { expiresIn:'7d' });
  return res.json({ token, username });
});

app.get('/api/sheet/:username', auth, (req,res)=>{
  if(req.params.username !== req.user) return res.status(403).json({error:"Forbidden"});
  const file = path.join(DATA_DIR, req.user + '.json');
  if(!fs.existsSync(file)) return res.json({ sheet: null });
  const sheet = JSON.parse(fs.readFileSync(file,'utf8') || "null");
  return res.json({ sheet });
});

app.post('/api/sheet/:username', auth, (req,res)=>{
  if(req.params.username !== req.user) return res.status(403).json({error:"Forbidden"});
  const { sheet } = req.body;
  const file = path.join(DATA_DIR, req.user + '.json');
  fs.writeFileSync(file, JSON.stringify(sheet, null, 2));
  return res.json({ success:true });
});

// serve static files for public folder (index.html, style.css, script.js)
app.use('/', express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log("LightTaskSheet server running on port", PORT));
