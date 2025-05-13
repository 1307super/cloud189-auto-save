document.addEventListener('DOMContentLoaded', () => {
    // 监听表单提交
    document.getElementById('mediaForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        await saveMediaSettings();
    });
});


async function saveMediaSettings() {
    const enableStrm = document.getElementById('enableStrm').checked
    const enableEmby = document.getElementById('enableEmby').checked
    const settings = {
        strm: {
            enable: enableStrm,
        },
        emby: {
            enable: enableEmby,
            serverUrl: document.getElementById('embyServer').value,
            apiKey: document.getElementById('embyApiKey').value,
        },
        cloudSaver: {
            baseUrl: document.getElementById('cloudSaverUrl').value,
            username: document.getElementById('cloudSaverUsername').value,
            password: document.getElementById('cloudSaverPassword').value,
        },
        tmdb: {
            enableScraper: document.getElementById('enableScraper').checked,
            tmdbApiKey: document.getElementById('tmdbApiKey').value
        },
        openai: {
            enable: document.getElementById('enableOpenAI').checked,
            baseUrl: document.getElementById('openaiBaseUrl').value, //  document.getElementById('openaiBaseUrl').value, // URL_ADDRESS.openai.co
            apiKey: document.getElementById('openaiApiKey').value,
            model: document.getElementById('openaiModel').value,
            rename: {
                template: document.getElementById('openaiTemplate').value,
                movieTemplate: document.getElementById('openaiMovieTemplate').value,
            }
        },
        alist: {
            enable: document.getElementById('enableAlist').checked,
            baseUrl: document.getElementById('alistServer').value,
            apiKey: document.getElementById('alistApiKey').value
        }
    };

    try {
        const response = await fetch('/api/settings/media', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });
        const result = await response.json();
        if (result.success) {
            message.success('保存成功');
        } else {
            message.warning('保存失败: ' + result.error);
        }
    } catch (error) {
        message.warning('保存失败: ' + error.message);
    }
}