require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');
const { Server } = require('socket.io');

const authRoutes = require('./routes/auth');
const bracketRoutes = require('./routes/bracket');
const matchRoutes = require('./routes/matches');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.set('io', io);
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', authRoutes);
app.use('/api/bracket', bracketRoutes);
app.use('/api/matches', matchRoutes);

io.on('connection', (socket) => {
  socket.on('join:match', (matchNumber) => socket.join(`match:${matchNumber}`));
  socket.on('leave:match', (matchNumber) => socket.leave(`match:${matchNumber}`));
  socket.on('join:bracket', () => socket.join('bracket'));
});

const PORT = process.env.PORT || 3000;

async function start() {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI is not set. Copy .env.example to .env and fill in your Atlas connection string.');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB.');
  server.listen(PORT, () => {
    console.log(`Tennis tournament tracker running on http://localhost:${PORT}`);
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
