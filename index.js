// index.js

require('dotenv').config();
const { Telegraf, Scenes, session } = require('telegraf');
const fetch = require('node-fetch');
const express = require('express');

// env vars
const BOT_TOKEN     = process.env.BOT_TOKEN;
const WEBAPP_URL    = process.env.WEBAPP_URL;
const WEBAPP_SECRET = process.env.WEBAPP_SECRET;
const PORT          = process.env.PORT || 3000;

// validate
if (!BOT_TOKEN || !WEBAPP_URL || !WEBAPP_SECRET) {
  console.error('Error: BOT_TOKEN, WEBAPP_URL or WEBAPP_SECRET is missing');
  process.exit(1);
}

// --- Telegram Bot setup ---
const bot = new Telegraf(BOT_TOKEN);

async function fetchJson(params) {
  const url = new URL(WEBAPP_URL);
  url.searchParams.append('secret', WEBAPP_SECRET);
  Object.entries(params).forEach(([k, v]) => url.searchParams.append(k, v));
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function getPlayers() { return fetchJson({ action: 'players' }); }
async function getTracks()  { return fetchJson({ action: 'tracks'  }); }

// /leaderboard
bot.command('leaderboard', async ctx => {
  try {
    const data = await fetchJson({ action: 'leaderboard' });
    const rows = data.slice(1).sort((a,b) => Number(a[1]) - Number(b[1]));
    let msg = '🏆 *Leaderboard* 🏆\n\n';
    rows.forEach(r => {
      msg += `• ${r[0]} — ${r[1]} pts (races: ${r[2]}, avg pos: ${r[3]})\n`;
    });
    await ctx.replyWithMarkdown(msg);
  } catch(err) {
    await ctx.reply(`Error fetching leaderboard:\n${err.message}`);
  }
});

// Wizard for /newrace (uses today’s date automatically)
const NewRaceWizard = new Scenes.WizardScene(
  'newrace-wizard',

  // Step 1: set date, load players & tracks, ask track
  async ctx => {
    ctx.session.newRace = {};
    // today in YYYY-MM-DD (SV locale)
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    ctx.session.newRace.date = new Date().toLocaleDateString('sv', { timeZone: tz });
    try {
      ctx.session.players = await getPlayers();
      ctx.session.tracks  = await getTracks();
    } catch(err) {
      return ctx.reply(`Error fetching setup data:\n${err.message}`);
    }
    await ctx.reply('🏁 Choose track for today:', {
      reply_markup: {
        keyboard: ctx.session.tracks.map(t => [t]),
        one_time_keyboard: true,
        resize_keyboard: true
      }
    });
    return ctx.wizard.next();
  },

  // Step 2: save track, ask first player position
  async ctx => {
    ctx.session.newRace.track = ctx.message.text.trim();
    ctx.session.newRace.positions = [];
    ctx.session.step = 0;
    await ctx.reply(
      `Enter position for *${ctx.session.players[0]}*:`,
      { parse_mode: 'Markdown' }
    );
    return ctx.wizard.next();
  },

  // Step 3: collect all positions, send to WebApp
  async ctx => {
    const pos = Number(ctx.message.text.trim());
    ctx.session.newRace.positions.push(pos);
    ctx.session.step++;
    if (ctx.session.step < ctx.session.players.length) {
      return ctx.reply(
        `Enter position for *${ctx.session.players[ctx.session.step]}*:`,
        { parse_mode: 'Markdown' }
      );
    }
    // Submit payload
    const { date, track, positions } = ctx.session.newRace;
    const players = ctx.session.players;
    const payload = { secret: WEBAPP_SECRET, date, track, players, positions };
    try {
      const res = await fetch(WEBAPP_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload)
      });
      const text = await res.text();
      if (text !== 'ok') throw new Error(text);
      await ctx.reply(`✅ New race saved for ${date} on ${track}!`);
    } catch(err) {
      await ctx.reply(`❌ Error saving race:\n${err.message}`);
    }
    return ctx.scene.leave();
  }
);

const stage = new Scenes.Stage([NewRaceWizard]);
bot.use(session());
bot.use(stage.middleware());
bot.command('newrace', ctx => ctx.scene.enter('newrace-wizard'));

// --- Express Web Interface ---
const app = express();

// Home
app.get('/', (req, res) => {
  res.send(`
    <html>
      <head><title>Blur Cup Tracker</title></head>
      <body>
        <h1>Blur Cup Tracker</h1>
        <ul>
          <li><a href="/leaderboard">Leaderboard</a></li>
        </ul>
      </body>
    </html>
  `);
});

// Leaderboard page
app.get('/leaderboard', async (req, res) => {
  try {
    const data = await fetchJson({ action: 'leaderboard' });
    const rows = data.slice(1).sort((a,b)=>Number(a[1])-Number(b[1]));
    let html = `
      <html><head><title>Leaderboard</title></head>
      <body><h1>Leaderboard</h1>
      <table border="1">
        <tr><th>Player</th><th>Points</th><th>Races</th><th>Avg</th></tr>`;
    rows.forEach(r => {
      html += `<tr>
        <td>${r[0]}</td>
        <td>${r[1]}</td>
        <td>${r[2]}</td>
        <td>${r[3]}</td>
      </tr>`;
    });
    html += `</table><p><a href="/">Home</a></p></body></html>`;
    res.send(html);
  } catch(err) {
    res.status(500).send('Error loading leaderboard: ' + err.message);
  }
});

// Start only the role you need
const ROLE = process.env.PROCESS_ROLE;
if (ROLE === 'worker') {
  bot.launch().then(() => console.log('🤖 Bot launched (worker)'));
}
if (ROLE === 'web') {
  app.listen(PORT, () => console.log(`🌐 Web server listening on port ${PORT}`));
}
