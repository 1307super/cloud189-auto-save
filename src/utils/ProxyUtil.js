const ConfigService = require('../services/ConfigService');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { HttpProxyAgent } = require('http-proxy-agent');

class ProxyUtil {
    static getProxy(service) {
        let proxy = null;
        if (!this._checkServiceEnabled(service)) {
            return proxy;
        }
        const proxyConfig = ConfigService.getConfigValue('proxy');
        const { type = 'http', host, port, username, password } = proxyConfig;
        if (host && port) {
            let proxyUrl = `${type}://${host}:${port}`;
            if (username && password) {
                proxyUrl = `${type}://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}`;
            }
            proxy = proxyUrl;
        }
        return proxy;
    }
    static getProxyAgent(service) {
        const proxy = this.getProxy(service);
        return !proxy?{}:{
            http: new HttpProxyAgent(proxy),
            https: new HttpsProxyAgent(proxy)
        }
    }
    static _checkServiceEnabled(service) {
        const services = ['tmdb', 'cloud189', 'telegram', 'customPush'];
        if (!services.includes(service)) {
            console.log(`[ProxyUtil] 未知的服务: ${service}`);
            return false;
        }
        return ConfigService.getConfigValue(`proxy.services.${service}`);
    }
}

module.exports = ProxyUtil;