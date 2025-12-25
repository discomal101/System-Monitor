const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'html', 'index.html')));

app.use('/scripts', express.static(path.join(__dirname, 'scripts')));

app.get('/health', (req, res) => res.json({status: 'ok', ts: new Date().toISOString()}));

app.listen(PORT, () => console.log(`Dashboard server listening on port ${PORT}`));
