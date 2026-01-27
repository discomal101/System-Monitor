const express = require('express');
const path = require('path');

const app = express();
const PORT = 3021;

app.use(express.static(path.join(__dirname, 'public', 'html')));

app.use('/css', express.static(path.join(__dirname, 'public', 'css')));
app.use('/scripts', express.static(path.join(__dirname, 'public', 'scripts')));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(err.status || 500).send('Internal Server Error');
});

app.listen(PORT, () => {
  console.log(`Dashboard server running at http://localhost:${PORT}`);
});