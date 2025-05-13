const fs = require('fs');
const path = require('path');
class ConfigService {
  constructor() {
    // 配置文件路径
    this._configPath = path.join(__dirname, '../../data');
    this._configFile = this._configPath + '/config.json';
    this._config = {
      task: {
        taskExpireDays: 3,
        taskCheckCron: '0 19-23 * * *',
        cleanRecycleCron: '0 */8 * * *',
        maxRetries: 3,        // 最大重试次数
        retryInterval: 300,   // 重试间隔（秒）
        enableAutoClearRecycle: false,
        enableAutoClearFamilyRecycle: false,
        mediaSuffix: '.mkv;.iso;.ts;.mp4;.avi;.rmvb;.wmv;.m2ts;.mpg;.flv;.rm;.mov', // 媒体文件后缀
        enableOnlySaveMedia: false, // 只保存媒体文件
        // 文件夹不存在时重新创建
        enableAutoCreateFolder: false,
      },
      wecom: {
        enable: false,
        webhook: ''
      },
      telegram: {
        enable: false,
        proxyDomain: '',
        botToken: '',
        chatId: '',
        bot: {
          enable: false,
          botToken: ''
        }
      },
      wxpusher: {
        enable: false,
        spt: ''
      },
      proxy: {
        host: '',
        port: 0,
        username: '',
        password: '',
        services: {
          telegram: true,
          tmdb: true,
          cloud189: false
        }
      },
      bark: {
        enable: false,
        serverUrl: '', 
        key: ''
      },
      pushplus: {
        enable: false,           // 是否启用推送
        token: '',              // PushPlus token
        topic: '',              // 群组编码，不填仅发送给自己
        channel: 'wechat',      // 发送渠道：wechat/webhook/cp/sms/mail
        webhook: '',            // webhook编码，仅在channel为webhook时需要
        to: ''                  // 好友令牌，用于指定接收消息的用户
    },
      system: {
        username: 'admin',
        password: 'admin',
        baseUrl: '',
        apiKey: ''
      },
      strm: {
        enable: false,
      },
      emby: {
        enable: false,
        serverUrl: '',
        apiKey: ''
      },
      cloudSaver: {
        baseUrl: '',
        username: '',
        password: ''
      },
      tmdb: {
        enableScraper: false,
        apiKey: ''
      },
      openai: {
        enable: false,
        baseUrl: '',
        apiKey: '',
        model: 'GLM-4-Flash-250414',
        rename: {
          template: "{name} - {se}{ext}",  // 默认模板
          movieTemplate: "{name} ({year}){ext}",  // 电影模板
        }
      },
      alist: {
        enable: false,
        baseUrl: '',
        apiKey: ''
      }
    };
    this._init();
  }

  _init() {
    try {
      if (!fs.existsSync(this._configPath)) {
        fs.mkdirSync(this._configPath, { recursive: true });
      }
      if (fs.existsSync(this._configFile)) {
        const data = fs.readFileSync(this._configFile, 'utf8');
        const fileConfig = JSON.parse(data);
        this._config = this._deepMerge(this._config, fileConfig);
      }else {
        this._saveConfig();
      }
    } catch (error) {
      console.error('系统配置初始化失败:', error);
    }
  }

  // 添加深度合并方法
  _deepMerge(target, source) {
    const result = { ...target };
    for (const key in source) {
      if (source[key] instanceof Object && !Array.isArray(source[key])) {
        result[key] = this._deepMerge(result[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
    return result;
  }


  _saveConfig() {
    try {
      fs.writeFileSync(this._configFile, JSON.stringify(this._config, null, 2));
    } catch (error) {
      console.error('系统配置保存失败:', error);
    }
  }

  getConfig() {
    return this._config;
  }

  setConfig(config) {
    this._config = { ...this._config, ...config };
    this._saveConfig();
  }

  getConfigValue(key, defaultValue = null) {
    const keys = key.split('.');
    let value = this._config;
    for (const k of keys) {
      value = value?.[k];
      if (value === undefined) break;
    }
    return value ?? defaultValue;
  }

  setConfigValue(key, value) {
    const keys = key.split('.');
    let current = this._config;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!current[keys[i]]) {
        current[keys[i]] = {};
      }
      current = current[keys[i]];
    }
    current[keys[keys.length - 1]] = value;
    this._saveConfig();
  }
}

// 导出单例实例
module.exports = new ConfigService();
