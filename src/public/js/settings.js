async function loadSettings() {
    try {
        const response = await fetch('/api/settings');
        const data = await response.json();
        if (data.success) {
            const settings = data.data;
            // 项目域名
            document.getElementById('projectDomain').value = settings.system?.baseUrl || '';
            // 系统apiKey
            document.getElementById('systemApiKey').value = settings.system?.apiKey || '';
            // 任务设置
            document.getElementById('taskExpireDays').value = settings.task?.taskExpireDays || 3;
            document.getElementById('taskCheckCron').value = settings.task?.taskCheckCron || '0 19-23 * * *';
            document.getElementById('cleanRecycleCron').value = settings.task?.cleanRecycleCron || '0 */8 * * * ';
            document.getElementById('taskMaxRetries').value = settings.task?.maxRetries || 3;
            document.getElementById('taskRetryInterval').value = settings.task?.retryInterval || 300;
            document.getElementById('enableAutoClearRecycle').checked = settings.task?.enableAutoClearRecycle || false;
            document.getElementById('enableAutoClearFamilyRecycle').checked = settings.task?.enableAutoClearFamilyRecycle || false;
            document.getElementById('mediaSuffix').value = settings.task?.mediaSuffix || '.mkv;.iso;.ts;.mp4;.avi;.rmvb;.wmv;.m2ts;.mpg;.flv;.rm;.mov';
            document.getElementById('enableOnlySaveMedia').checked = settings.task?.enableOnlySaveMedia || false;
            document.getElementById('enableAutoCreateFolder').checked = settings.task?.enableAutoCreateFolder || false;

            // 企业微信设置
            document.getElementById('enableWecom').checked = settings.wecom?.enable || false;
            document.getElementById('wecomWebhook').value = settings.wecom?.webhook || '';
            
            // Telegram 设置
            document.getElementById('enableTelegram').checked = settings.telegram?.enable || false;
            document.getElementById('proxyDomain').value = settings.telegram?.proxyDomain || '';
            document.getElementById('telegramBotToken').value = settings.telegram?.botToken || '';
            document.getElementById('telegramChatId').value = settings.telegram?.chatId || '';
            
            // WXPusher 设置
            document.getElementById('enableWXPusher').checked = settings.wxpusher?.enable || false;
            document.getElementById('wXPusherSPT').value = settings.wxpusher?.spt || '';
            
            // 代理设置
            document.getElementById('proxyHost').value = settings.proxy?.host || '';
            document.getElementById('proxyPort').value = settings.proxy?.port || '';
            document.getElementById('proxyUsername').value = settings.proxy?.username || '';
            document.getElementById('proxyPassword').value = settings.proxy?.password || '';
            document.getElementById('proxyTelegram').checked = settings.proxy?.services?.telegram || false;
            document.getElementById('proxyTmdb').checked = settings.proxy?.services?.tmdb || false;
            document.getElementById('proxyOpenAI').checked = settings.proxy?.services?.openai || false;
            document.getElementById('proxyCloud189').checked = settings.proxy?.services?.cloud189 || false;

            // Bark 设置
            document.getElementById('enableBark').checked = settings.bark?.enable || false;
            document.getElementById('barkServerUrl').value = settings.bark?.serverUrl || '';
            document.getElementById('barkKey').value = settings.bark?.key || '';

            // 账号密码设置
            document.getElementById('systemUserName').value = settings.system?.username || '';
            document.getElementById('systemPassword').value = settings.system?.password || '';
            
            const enableStrm = settings.strm?.enable || false
            const enableEmby = settings.emby?.enable || false
            // 媒体信息设置
            document.getElementById('enableStrm').checked = enableStrm;
            document.getElementById('enableEmby').checked = enableEmby;
            document.getElementById('embyServer').value = settings.emby?.serverUrl || '';
            document.getElementById('embyApiKey').value = settings.emby?.apiKey || '';

            // tg机器人设置
            document.getElementById('enableTgBot').checked = settings.telegram?.bot?.enable || false;
            document.getElementById('tgBotToken').value = settings.telegram?.bot?.botToken || '';

            // cloudSaver设置
            document.getElementById('cloudSaverUrl').value = settings.cloudSaver?.baseUrl || '';
            document.getElementById('cloudSaverUsername').value = settings.cloudSaver?.username || '';
            document.getElementById('cloudSaverPassword').value = settings.cloudSaver?.password || '';
            // 刮削
            document.getElementById('enableScraper').checked = settings.tmdb?.enableScraper || false;
            // tmdbkey
            document.getElementById('tmdbApiKey').value = settings.tmdb?.tmdbApiKey || '';

            // openai配置
            document.getElementById('enableOpenAI').checked = settings.openai?.enable || false;
            document.getElementById('openaiBaseUrl').value = settings.openai?.baseUrl || '';
            document.getElementById('openaiApiKey').value = settings.openai?.apiKey || '';
            document.getElementById('openaiModel').value = settings.openai?.model || '';
            document.getElementById('openaiTemplate').value = settings.openai?.rename?.template || '';
            document.getElementById('openaiMovieTemplate').value = settings.openai?.rename?.movieTemplate || '';

            // alist
            document.getElementById('enableAlist').checked = settings.alist?.enable || false;
            document.getElementById('alistServer').value = settings.alist?.baseUrl || '';
            document.getElementById('alistApiKey').value = settings.alist?.apiKey || '';

            // pushplus
            document.getElementById('enablePushPlus').checked = settings.pushplus?.enable || false;
            document.getElementById('pushplusToken').value = settings.pushplus?.token || '';
            document.getElementById('pushplusTopic').value = settings.pushplus?.topic || '';
            document.getElementById('pushplusChannel').value = settings.pushplus?.channel || '';
            document.getElementById('pushplusWebhook').value = settings.pushplus?.webhook || '';
            document.getElementById('pushplusTo').value = settings.pushplus?.to || '';
        }
    } catch (error) {
        console.error('加载设置失败:', error);
    }
}

document.getElementById('settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const settings = {
        task: {
            taskExpireDays: parseInt(document.getElementById('taskExpireDays').value) || 3,
            taskCheckCron: document.getElementById('taskCheckCron').value || '0 19-23 * * *',
            cleanRecycleCron: document.getElementById('cleanRecycleCron').value || '0 */8 * * *',
            maxRetries: parseInt(document.getElementById('taskMaxRetries').value) || 3,
            retryInterval: parseInt(document.getElementById('taskRetryInterval').value) || 300,
            enableAutoClearRecycle: document.getElementById('enableAutoClearRecycle').checked,
            enableAutoClearFamilyRecycle: document.getElementById('enableAutoClearFamilyRecycle').checked,
            mediaSuffix: document.getElementById('mediaSuffix').value,
            enableOnlySaveMedia: document.getElementById('enableOnlySaveMedia').checked,
            enableAutoCreateFolder: document.getElementById('enableAutoCreateFolder').checked
        },
        wecom: {
            enable: document.getElementById('enableWecom').checked,
            webhook: document.getElementById('wecomWebhook').value
        },
        telegram: {
            enable: document.getElementById('enableTelegram').checked,
            proxyDomain: document.getElementById('proxyDomain').value,
            botToken: document.getElementById('telegramBotToken').value,
            chatId: document.getElementById('telegramChatId').value,
            bot: {
                enable: document.getElementById('enableTgBot').checked,
                botToken: document.getElementById('tgBotToken').value
            }
        },
        wxpusher: {
            enable: document.getElementById('enableWXPusher').checked,
            spt: document.getElementById('wXPusherSPT').value
        },
        proxy: {
            host: document.getElementById('proxyHost').value,
            port: parseInt(document.getElementById('proxyPort').value) || 0,
            username: document.getElementById('proxyUsername').value,
            password: document.getElementById('proxyPassword').value,
            services:{
                telegram: document.getElementById('proxyTelegram').checked,
                tmdb: document.getElementById('proxyTmdb').checked,
                openai: document.getElementById('proxyOpenAI').checked,
                cloud189: document.getElementById('proxyCloud189').checked
            }
        },
        bark: {
            enable: document.getElementById('enableBark').checked,
            serverUrl: document.getElementById('barkServerUrl').value,
            key: document.getElementById('barkKey').value
        },
        system: {
            username: document.getElementById('systemUserName').value,
            password: document.getElementById('systemPassword').value,
            baseUrl: document.getElementById('projectDomain').value,
            apiKey: document.getElementById('systemApiKey').value
        },
        pushplus: {
            enable: document.getElementById('enablePushPlus').checked,
            token: document.getElementById('pushplusToken').value,
            topic: document.getElementById('pushplusTopic').value,
            channel: document.getElementById('pushplusChannel').value,
            webhook: document.getElementById('pushplusWebhook').value,
            to: document.getElementById('pushplusTo').value
        },
    };
    // taskRetryInterval不能少于60秒
    if (settings.task.taskRetryInterval < 60) {
        message.warning("任务重试间隔不能小于60秒")
        return 
    }

    try {
        const response = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });
        const data = await response.json();
        if (data.success) {
            message.success('设置保存成功');
        } else {
            message.warning('设置保存失败: ' + data.error);
        }
    } catch (error) {
        message.warning('设置保存失败: ' + error.message);
    }
});

// 在页面加载时初始化设置
document.addEventListener('DOMContentLoaded', loadSettings);

function generateApiKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let apiKey = '';
    for (let i = 0; i < 32; i++) {
        apiKey += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    document.getElementById('systemApiKey').value = apiKey;
}