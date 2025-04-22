// index.js

require('dotenv').config();
const { Telegraf, Scenes, session } = require('telegraf');
const fetch = require('node-fetch');

const BOT_TOKEN      = process.env.BOT_TOKEN;
const WEBAPP_URL     = process.env.WEBAPP_URL;
const WEBAPP_SECRET  = process.env.WEBAPP_SECRET;

if (!BOT_TOKEN || !WEBAPP_URL || !WEBAPP_SECRET) {
  console.error('Error: BOT_TOKEN, WEBAPP_URL or WEBAPP_SECRET is missing');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

/**
 * Helper — делает GET-запрос к вашему Apps Script Web App
 * с параметрами params и возвращает распарсенный JSON.
 */
async function fetchJson(params) {
  const url = new URL(WEBAPP_URL);
  url.searchParams.append('secret', WEBAPP_SECRET);
  Object.entries(params).forEach(([k, v]) => url.searchParams.append(k, v));
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * Получить список игроков из Web App
 */
async function getPlayers() {
  // Apps Script doGet должен обрабатывать action=players и возвращать JSON‑массив имён
  return await fetchJson({ action: 'players' });
}

/**
 * Получить список треков из Web App
 */
async function getTracks() {
  // Apps Script doGet должен обрабатывать action=tracks и возвращать JSON‑массив названий
  return await fetchJson({ action: 'tracks' });
}

/**
 * /leaderboard — выводит рейтинг по очкам
 */
bot.command('leaderboard', async ctx => {
  try {
    // Apps Script doGet возвращает полный лист Players
    const data = await fetchJson({ action: 'leaderboard' });
    // data[0] — заголовки, data[1…] — строки [Player, TotalPoints, RacesCount, AvgPosition]
    const rows = data.slice(1).sort((a, b) => Number(a[1]) - Number(b[1]));
    let msg = '🏆 *Leaderboard* 🏆\n\n';
    rows.forEach(r => {
      msg += `• ${r[0]} — ${r[1]} pts (races: ${r[2]}, avg pos: ${r[3]})\n`;
    });
    await ctx.replyWithMarkdown(msg);
  } catch (err) {
    await ctx.reply(`Error fetching leaderboard:\n${err.message}`);
  }
});

//
// WizardScene для /newrace
//
const NewRaceWizard = new Scenes.WizardScene(
  'newrace-wizard',

  // Шаг 1: запрашиваем дату
  async ctx => {
    ctx.session.newRace = {};
    try {
      ctx.session.players = await getPlayers();
      ctx.session.tracks  = await getTracks();
    } catch (err) {
      return ctx.reply(`Error fetching setup data:\n${err.message}`);
    }
    await ctx.reply('🗓 Enter race date (YYYY-MM-DD):');
    return ctx.wizard.next();
  },

  // Шаг 2: сохраняем дату и запрашиваем трек
  async ctx => {
    ctx.session.newRace.date = ctx.message.text.trim();
    await ctx.reply('🏁 Choose track:', {
      reply_markup: {
        keyboard: ctx.session.tracks.map(t => [t]),
        one_time_keyboard: true
      }
    });
    return ctx.wizard.next();
  },

  // Шаг 3: сохраняем трек и запрашиваем позиции игроков
  async ctx => {
    ctx.session.newRace.track = ctx.message.text.trim();
    ctx.session.newRace.positions = [];
    ctx.session.step = 0;
    await ctx.reply(`Enter position for *${ctx.session.players[0]}*:`, { parse_mode: 'Markdown' });
    return ctx.wizard.next();
  },

  // Шаг 4: собираем все позиции и отправляем POST в Web App
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

    // Все позиции собраны — готовим данные для Web App
    const { date, track, positions } = ctx.session.newRace;
    const players = ctx.session.players;

    const payload = {
      secret:    WEBAPP_SECRET,
      date,
      track,
      players,
      positions
    };

    try {
      const response = await fetch(WEBAPP_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload)
      });
      const text = await response.text();
      if (text !== 'ok') throw new Error(text);
      await ctx.reply('✅ New race saved!');
    } catch (err) {
      await ctx.reply(`❌ Error saving race:\n${err.message}`);
    }

    return ctx.scene.leave();
  }
);

const stage = new Scenes.Stage([NewRaceWizard]);
bot.use(session());
bot.use(stage.middleware());

// Команда /newrace запускает наш Wizard
bot.command('newrace', ctx => ctx.scene.enter('newrace-wizard'));

// Запуск бота
bot.launch().then(() => console.log('🤖 Bot is up and running'));
