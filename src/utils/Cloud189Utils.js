class Cloud189Utils {
    // 解析分享码
    static parseShareCode(shareLink) {
        // 解析分享链接
        let shareCode;
        const shareUrl = new URL(shareLink);
        if (shareUrl.origin.includes('content.21cn.com')) {
            // 处理订阅链接
            const params = new URLSearchParams(shareUrl.hash.split('?')[1]);
            shareCode = params.get('shareCode');
        } else if (shareUrl.pathname === '/web/share') {
            shareCode = shareUrl.searchParams.get('code');
        } else if (shareUrl.pathname.startsWith('/t/')) {
            shareCode = shareUrl.pathname.split('/').pop();
        }else if (shareUrl.hash && shareUrl.hash.includes('/t/')) {
            shareCode = shareUrl.hash.split('/').pop();
        }else if (shareUrl.pathname.includes('share.html')) {
            // 其他可能的 share.html 格式
            const hashParts = shareUrl.hash.split('/');
            shareCode = hashParts[hashParts.length - 1];
        }
        
        if (!shareCode) throw new Error('无效的分享链接');
        return shareCode
    }

    static parseCloudShare(shareText) {
        // 移除所有空格
        shareText = shareText.replace(/\s/g, '');
        shareText = decodeURIComponent(shareText);
        // 提取基本URL和访问码
        let url = '';
        let accessCode = '';
        
        // 匹配访问码的几种常见格式
        const accessCodePatterns = [
            /[（(]访问码[：:]\s*([a-zA-Z0-9]{4})[)）]/,  // （访问码：xxxx）
            /[（(]提取码[：:]\s*([a-zA-Z0-9]{4})[)）]/,  // （提取码：xxxx）
            /访问码[：:]\s*([a-zA-Z0-9]{4})/,           // 访问码：xxxx
            /提取码[：:]\s*([a-zA-Z0-9]{4})/,           // 提取码：xxxx
            /[（(]([a-zA-Z0-9]{4})[)）]/                // （xxxx）
        ];
        
        // 尝试匹配访问码
        for (const pattern of accessCodePatterns) {
            const match = shareText.match(pattern);
            if (match) {
                accessCode = match[1];
                // 从原文本中移除访问码部分
                shareText = shareText.replace(match[0], '');
                break;
            }
        }
        
        // 提取URL - 支持两种格式
        const urlPatterns = [
            /(https?:\/\/cloud\.189\.cn\/web\/share\?[^\s]+)/,     // web/share格式
            /(https?:\/\/cloud\.189\.cn\/t\/[a-zA-Z0-9]+)/,        // t/xxx格式
            /(https?:\/\/h5\.cloud\.189\.cn\/share\.html#\/t\/[a-zA-Z0-9]+)/, // h5分享格式
            /(https?:\/\/[^/]+\/web\/share\?[^\s]+)/,              // 其他域名的web/share格式
            /(https?:\/\/[^/]+\/t\/[a-zA-Z0-9]+)/,                 // 其他域名的t/xxx格式
            /(https?:\/\/[^/]+\/share\.html[^\s]*)/,               // share.html格式
            /(https?:\/\/content\.21cn\.com[^\s]+)/                // 订阅链接格式
        ];
    
        for (const pattern of urlPatterns) {
            const urlMatch = shareText.match(pattern);
            if (urlMatch) {
                url = urlMatch[1];
                break;
            }
        }
        
        return {
            url: url,
            accessCode: accessCode
        };
    }
}

module.exports = Cloud189Utils;