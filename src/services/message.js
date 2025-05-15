const messageManager = require('./message/MessageManager');
const ConfigService = require('./ConfigService');


class MessageUtil {
    constructor() {
        this._init();
    }

    _init() {
        const settings = ConfigService.getConfig()
        // 初始化消息推送配置
        messageManager.initialize({
            wework: {
                enabled: settings.wecom?.enable || false,
                webhook: settings.wecom?.webhook || '',
            },
            telegram: {
                enabled: settings.telegram?.enable || false,
                botToken: settings.telegram?.botToken || '',
                chatId: settings.telegram?.chatId || '',
                proxy: {
                    type: "http",
                    host: settings.proxy?.host || '',
                    port: settings.proxy?.port || '',
                    username: settings.proxy?.username || '',
                    password: settings.proxy?.password || ''
                },
                cfProxyDomain: settings.telegram?.proxyDomain || ''
            },
            wxpusher: {
                enabled: settings.wxpusher?.enable || false,
                spt: settings.wxpusher?.spt || ''
            },
            bark:{
                enabled: settings.bark?.enable || false,
                serverUrl: settings.bark?.serverUrl || '',
                key: settings.bark?.key || '',
            },
            pushplus:{
                enabled: settings.pushplus?.enable || false,
                token: settings.pushplus?.token || '',
                topic: settings.pushplus?.topic || '',
                channel: settings.pushplus?.channel || '',
                webhook: settings.pushplus?.webhook || '',
                to: settings.pushplus?.to || '',
            },
            customPush: settings.customPush || []
        });
    }


    async updateConfig() {
        this._init();
    }

    // 发送消息
    async sendMessage(message) {
        await messageManager.sendMessage(message);
    }
    // 发送刮削消息
    async sendScrapeMessage(message) {
        await messageManager.sendScrapeMessage(message);
    }
}

module.exports = { MessageUtil };