// index.js

require('dotenv').config();
const { Telegraf, Scenes, session } = require('telegraf');
const fetch = require('node-fetch');

const BOT_TOKEN     = process.env.BOT_TOKEN;
const WEBAPP_URL    = process.env.WEBAPP_URL;
const WEBAPP_SECRET = process.env.WEBAPP_SECRET;

if (!BOT_TOKEN || !WEBAPP_URL || !WEBAPP_SECRET) {
  console.error('Error: BOT_TOKEN, WEBAPP_URL or WEBAPP_SECRET is missing');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// helper: GET to Apps Script WebApp
async function fetchJson(params) {
  const url = new URL(WEBAPP_URL);
  url.searchParams.append('secret', WEBAPP_SECRET);
  Object.entries(params).forEach(([k, v]) => url.searchParams.append(k, v));
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// fetch players and tracks
async function getPlayers() { return fetchJson({ action: 'players' }); }
async function getTracks()  { return fetchJson({ action: 'tracks'  }); }

// /leaderboard
bot.command('leaderboard', async ctx => {
  try {
    const data = await fetchJson({ action: 'leaderboard' });
    const rows = data.slice(1).sort((a,b)=>Number(a[1])-Number(b[1]));
    let msg = '🏆 *Leaderboard* 🏆\n\n';
    rows.forEach(r=>{
      msg += `• ${r[0]} — ${r[1]} pts (races: ${r[2]}, avg pos: ${r[3]})\n`;
    });
    await ctx.replyWithMarkdown(msg);
  } catch(err) {
    await ctx.reply(`Error fetching leaderboard:\n${err.message}`);
  }
});

// WizardScene for /newrace without asking date
const NewRaceWizard = new Scenes.WizardScene(
  'newrace-wizard',

  // Step 1: load players/tracks, set date, ask track
  async ctx => {
    ctx.session.newRace = {};
    // today as YYYY-MM-DD
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
        keyboard: ctx.session.tracks.map(t=>[t]),
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

  // Step 3: collect positions and submit
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

    // all positions collected
    const { date, track, positions } = ctx.session.newRace;
    const players = ctx.session.players;
    const payload = { secret: WEBAPP_SECRET, date, track, players, positions };

    try {
      const res = await fetch(WEBAPP_URL, {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify(payload)
      });
      const text = await res.text();
      if (text!=='ok') throw new Error(text);
      await ctx.reply('✅ New race saved for ' + date + ' on ' + track + '!');
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

bot.launch().then(()=>console.log('🤖 Bot is running'));
