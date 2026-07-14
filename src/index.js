require('dotenv').config();

const express = require('express');
const morgan = require('morgan');
const cors = require('cors');
const rateLimit = require('./middleware/rateLimit');
const errorHandler = require('./middleware/error');

const authRoutes = require('./routes/auth');
const guildRoutes = require('./routes/guilds');
const userRoutes = require('./routes/users');
const chatRoutes = require('./routes/chat');
const activityRoutes = require('./routes/activity');
const leaderboardRoutes = require('./routes/leaderboard');
const achievementRoutes = require('./routes/achievements');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(morgan('dev'));
app.use(cors());
app.use(express.json());
app.use(rateLimit);

app.get('/', (req, res) => res.json({ ok: true, message: 'Elijah Aniempire API' }));

app.use('/api/auth', authRoutes);
app.use('/api/guilds', guildRoutes);
app.use('/api/users', userRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/achievements', achievementRoutes);

// 404
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Centralized error handler
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
