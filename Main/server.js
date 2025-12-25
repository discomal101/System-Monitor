const express = require('express');
const path = require('path');
const app = express();
const PORT = 3021;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  const fs = require('fs');
  const indexDir = path.join(__dirname, 'public', 'html');
  const indexFile = 'index.html';
  const indexPath = path.join(indexDir, indexFile);
  console.log('Serving index at', indexPath, 'exists:', fs.existsSync(indexPath));
  res.sendFile(indexFile, { root: indexDir }, (err) => {
    if (err) {
      console.error('sendFile error code:', err && err.code, 'path:', err && err.path, 'resolved:', indexPath, err);
      res.status(err && err.status || 500).send(`Error serving index.html: ${err && err.message}`);
    }
  });
});

app.use('/scripts', express.static(path.join(__dirname, 'scripts')));

app.get('/health', (req, res) => res.json({status: 'ok', ts: new Date().toISOString()}));

// Error handler for uncaught errors
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(err.status || 500).send(err.message || 'Internal Server Error');
});

app.listen(PORT, () => console.log(`Dashboard server listening on port ${PORT}`));
