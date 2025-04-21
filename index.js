require('dotenv').config();
const { Telegraf, Scenes, session } = require('telegraf');
const sheets = require('./sheets');
const bot = new Telegraf(process.env.BOT_TOKEN);

// 1) Отримати масив гравців
async function getPlayers() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: 'Players!A2:A'
  });
  return res.data.values ? res.data.values.flat() : [];
}
// 2) Отримати масив треків
async function getTracks() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: 'Track name!A2:A'
  });
  return res.data.values ? res.data.values.flat() : [];
}

// ————————————
// Команда /leaderboard
bot.command('leaderboard', async ctx => {
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: 'Players!A2:D'
  });
  const rows = resp.data.values || [];
  // сортуємо за TotalPoints (колонка B)
  rows.sort((a,b) => Number(a[1]) - Number(b[1]));
  let msg = '🏆 *Leaderboard* 🏆\n';
  rows.forEach(r => {
    msg += `• ${r[0]} — ${r[1]} pts (races: ${r[2]}, avg pos: ${r[3]})\n`;
  });
  await ctx.replyWithMarkdown(msg);
});

// ————————————
// Wizard для /newrace
const NewRaceWizard = new Scenes.WizardScene(
  'newrace-wizard',
  async ctx => {
    ctx.session.newRace = {};
    ctx.session.players = await getPlayers();
    ctx.session.tracks  = await getTracks();
    await ctx.reply('🗓 Enter race date (YYYY-MM-DD):');
    return ctx.wizard.next();
  },
  async ctx => {
    ctx.session.newRace.date = ctx.message.text;
    await ctx.reply('🏁 Choose track:', {
      reply_markup: {
        keyboard: [ctx.session.tracks.map(t => [t])],
        one_time_keyboard: true
      }
    });
    return ctx.wizard.next();
  },
  async ctx => {
    ctx.session.newRace.track = ctx.message.text;
    // Запитати позиції для кожного гравця
    ctx.session.newRace.positions = [];
    ctx.session.step = 0;
    await ctx.reply(`Enter position for *${ctx.session.players[0]}*:`, { parse_mode:'Markdown' });
    return ctx.wizard.next();
  },
  async ctx => {
    // Зберігаємо поточну позицію
    ctx.session.newRace.positions.push(Number(ctx.message.text));
    ctx.session.step++;
    if (ctx.session.step < ctx.session.players.length) {
      return ctx.reply(`Position for *${ctx.session.players[ctx.session.step]}*:`, { parse_mode:'Markdown' });
    }
    // Всі позиції введені — записуємо в Sheets
    const { date, track, positions } = ctx.session.newRace;
    const raceId = 'R' + String(Date.now()).slice(-6);
    // Формуємо масив рядків
    const values = ctx.session.players.map((p, i) => [
      raceId, date, track, p, positions[i], positions[i]
    ]);
    // Додаємо в Races
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: 'Races!A:F',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values }
    });
    await ctx.reply('✅ New race saved!');
    // Тут можна викликати Apps Script WebApp для recalculateAll(), якщо хочете
    return ctx.scene.leave();
  }
);

const stage = new Scenes.Stage([NewRaceWizard]);
bot.use(session());
bot.use(stage.middleware());

bot.command('newrace', ctx => ctx.scene.enter('newrace-wizard'));

// Запуск бота
bot.launch();