const { TelegramBotService } = require('../services/telegramBot');
const { logTaskEvent } = require('./logUtils');

class TelegramBotManager {
    static instance = null;
    static bot = null;
    static chatId = null;

    static getInstance() {
        if (!TelegramBotManager.instance) {
            TelegramBotManager.instance = new TelegramBotManager();
        }
        return TelegramBotManager.instance;
    }

    async handleBotStatus(botToken, chatId, enable) {
        const shouldEnableBot = enable && botToken && chatId;
        const botTokenChanged = TelegramBotManager.bot?.token !== botToken;
        const chatIdChanged = TelegramBotManager.bot?.chatId!== chatId;
        if (TelegramBotManager.bot && (!shouldEnableBot || botTokenChanged || chatIdChanged)) {
            TelegramBotManager.bot.stop();
            TelegramBotManager.bot = null;
            logTaskEvent(`Telegram机器人已停用`);
        }

        if (shouldEnableBot && (!TelegramBotManager.bot || botTokenChanged || chatIdChanged)) {
            TelegramBotManager.bot = new TelegramBotService(botToken, chatId);
            TelegramBotManager.bot.start()
            .then(() => {
                logTaskEvent(`Telegram机器人已启动`);
            })
            .catch(error => {
                logTaskEvent(`Telegram机器人启动失败: ${error.message}`);
            });
        }
    }

    getBot() {
        return TelegramBotManager.bot;
    }
}

module.exports = TelegramBotManager;