const fs = require('fs').promises;
const path = require('path');
const ConfigService = require('./ConfigService');
const { logTaskEvent } = require('../utils/logUtils');
const CryptoUtils = require('../utils/cryptoUtils');
const alistService = require('./alistService');
const { MessageUtil } = require('./message');

class StrmService {
    constructor() {
        this.enable = ConfigService.getConfigValue('strm.enable');
        this.baseDir = path.join(__dirname + '../../../strm');
        // 从环境变量获取 PUID 和 PGID，默认值设为 0
        this.puid = process.env.PUID || 0;
        this.pgid = process.env.PGID || 0;
        this.messageUtil = new MessageUtil();
    }

    // 确保目录存在并设置权限和组，递归创建的所有目录都设置为 777 权限
    async _ensureDirectoryExists(dirPath) {
        // 确保使用相对路径
        const relativePath = dirPath.startsWith(this.baseDir) 
            ? path.relative(this.baseDir, dirPath)
            : dirPath;
            
        const parts = relativePath.split(path.sep);
        let currentPath = this.baseDir;  // 从基础目录开始

        for (const part of parts) {
            if (part) {
                currentPath = path.join(currentPath, part);
                try {
                    await fs.mkdir(currentPath);
                    if (process.getuid && process.getuid() === 0) {
                        await fs.chown(currentPath, parseInt(this.puid), parseInt(this.pgid));
                    }
                    await fs.chmod(currentPath, 0o777);
                } catch (error) {
                    if (error.code !== 'EEXIST') {
                        throw new Error(`创建目录失败: ${error.message}`);
                    }
                }
            }
        }
    }

    /**
     * 生成 STRM 文件
     * @param {Array} files - 文件列表，每个文件对象需包含 name 属性
     * @param {boolean} overwrite - 是否覆盖已存在的文件
     * @param {boolean} compare - 是否比较文件名 默认比较
     * @returns {Promise<Array>} - 返回生成的文件列表
     */
    async generate(task, files, overwrite = false, compare = true) {
        if (!this.enable){
            logTaskEvent(`STRM生成未启用, 请启用后执行`);
            return;
        }
        logTaskEvent(`${task.resourceName} 开始生成STRM文件, 总文件数: ${files.length}`);
        const results = [];
        let success = 0;
        let failed = 0;
        let skipped = 0;
        try {
            // mediaSuffixs转为小写
            const mediaSuffixs = ConfigService.getConfigValue('task.mediaSuffix').split(';').map(suffix => suffix.toLowerCase())
            let taskName = task.realFolderName.substring(task.realFolderName.indexOf('/') + 1)
            // 去掉头尾/
            taskName = taskName.replace(/^\/|\/$/g, '');
            // 构建完整的目标目录路径
            const targetDir = path.join(this.baseDir,task.account.localStrmPrefix, taskName);
            if (compare) {
                // 查询出所有目录下的.strm文件
                const strmFiles = await this.listStrmFiles(path.join(task.account.localStrmPrefix, taskName));
                // 将不在strmFiles中的文件删除
                for (const file of strmFiles) {
                    if (!files.some(f => path.parse(f.name).name === path.parse(file.name).name)) {
                        await this.delete(file.path);
                    }
                }
            }
            overwrite && await this._deleteDirAllStrm(targetDir)
            await this._ensureDirectoryExists(targetDir);
            for (const file of files) {
                // 检查文件是否是媒体文件
                if (!this._checkFileSuffix(file, mediaSuffixs)) {
                    // logTaskEvent(`文件不是媒体文件，跳过: ${file.name}`);
                    skipped++
                    continue;
                }
                
                try {
                    const fileName = file.name;
                    const parsedPath = path.parse(fileName);
                    const fileNameWithoutExt = parsedPath.name;
                    const strmPath = path.join(targetDir, `${fileNameWithoutExt}.strm`);

                    // 检查文件是否存在
                    try {
                        await fs.access(strmPath);
                        if (!overwrite) {
                            // logTaskEvent(`STRM文件已存在，跳过: ${strmPath}`);
                            skipped++
                            continue;
                        }
                    } catch (err) {
                        // 文件不存在，继续处理
                    }

                    // 生成STRM文件内容
                    let content;
                    if (task.enableSystemProxy) {
                        const baseUrl = ConfigService.getConfigValue('system.baseUrl');
                        const code = CryptoUtils.encryptIds(task.id, file.id);
                        content = `${baseUrl}/proxy/${code}`;
                    } else {
                        content = this._joinUrl(this._joinUrl(task.account.cloudStrmPrefix, taskName), fileName);
                    }
                    await fs.writeFile(strmPath, content, 'utf8');
                    // 设置文件权限
                    if (process.getuid && process.getuid() === 0) {
                        await fs.chown(strmPath, parseInt(this.puid), parseInt(this.pgid));
                    }
                    await fs.chmod(strmPath, 0o777);
                    results.push({
                        originalFile: fileName,
                        strmFile: `${fileNameWithoutExt}.strm`,
                        path: strmPath
                    });
                    logTaskEvent(`生成STRM文件成功: ${strmPath}`);
                    success++
                } catch (error) {
                    logTaskEvent(`生成STRM文件失败: ${file.name}, 错误: ${error.message}`);
                    failed++
                }
            }
        } catch (error) {
            console.log(error)
            logTaskEvent(`生成STRM文件失败: ${error.message}`);
            failed++
        }
        // 记录文件总数, 成功数, 失败数, 跳过数
        const message = `🎉${task.resourceName} 生成STRM文件完成, 总文件数: ${files.length}, 成功数: ${success}, 失败数: ${failed}, 跳过数: ${skipped}`
        logTaskEvent(message);
        return message;
    }

    /**
     * 批量生成STRM文件 根据Alist目录
     * @param {string} startPath - 起始目录路径
     * @returns {Promise<object>} - 返回处理结果统计
     */
    async generateAll(accounts, overwrite = false) {
        if (!alistService.Enable()) {
            throw new Error('Alist功能未启用');
        }
        const messages = [];
        for(const account of accounts) {
            try {
                let startPath = path.basename(account.cloudStrmPrefix);
                // 初始化统计信息
                const stats = {
                    success: 0,
                    failed: 0,
                    skipped: 0,
                    totalFiles: 0,
                    processedDirs: new Set()
                };
                // 获取媒体文件后缀列表
                const mediaSuffixs = ConfigService.getConfigValue('task.mediaSuffix').split(';').map(suffix => suffix.toLowerCase());
                
                await this._processDirectory(startPath, account, stats, mediaSuffixs, overwrite);
                const userrname = account.username.replace(/(.{3}).*(.{4})/, '$1****$2');
                // 生成最终统计信息
                const message = `🎉账号: ${userrname}生成STRM文件完成\n` +
                              `处理目录数: ${stats.processedDirs.size}\n` +
                              `总文件数: ${stats.totalFiles}\n` +
                              `成功数: ${stats.success}\n` +
                              `失败数: ${stats.failed}\n` +
                              `跳过数: ${stats.skipped}`;
                logTaskEvent(message);
                messages.push(message);
            } catch (error) {
                const message = `生成STRM文件失败: ${error.message}`;
                logTaskEvent(message);
            }
        }
        if (messages.length > 0) {
            this.messageUtil.sendMessage(messages.join('\n\n'));
        }   
    }

    /**
     * 处理单个目录
     * @param {string} dirPath - 目录路径
     * @param {object} stats - 统计信息
     * @param {array} mediaSuffixs - 媒体文件后缀列表
     * @private
     */
    async _processDirectory(dirPath, account, stats, mediaSuffixs, overwrite) {
        // 获取alist文件列表
        const alistResponse = await alistService.listFiles(dirPath);
        if (!alistResponse || !alistResponse.data) {
            throw new Error(`获取Alist文件列表失败: ${dirPath}`);
        }
        if (!alistResponse.data.content) {
            return;
        }

        const files = alistResponse.data.content;
        logTaskEvent(`开始处理目录 ${dirPath}, 文件数量: ${files.length}`);

        for (const file of files) {
            try {
                if (file.is_dir) {
                    // 递归处理子目录
                    await this._processDirectory(path.join(dirPath, file.name), account, stats, mediaSuffixs, overwrite);
                } else {
                    stats.totalFiles++;
                    // 检查是否为媒体文件
                    if (!this._checkFileSuffix(file, mediaSuffixs)) {
                        // console.log(`文件不是媒体文件，跳过: ${file.name}`);
                        stats.skipped++;
                        continue;
                    }

                    // 构建STRM文件路径
                    const relativePath = dirPath.substring(dirPath.indexOf('/') + 1).replace(/^\/+|\/+$/g, '')
                    const targetDir = path.join(this.baseDir, account.localStrmPrefix, relativePath);
                    const parsedPath = path.parse(file.name);
                    const strmPath = path.join(targetDir, `${parsedPath.name}.strm`);
                    overwrite && await this._deleteDirAllStrm(targetDir)
                    // 检查文件是否存在
                    try {
                        await fs.access(strmPath);
                        if (!overwrite) {
                            // console.log(`STRM文件已存在，跳过: ${strmPath}`);
                            stats.skipped++
                            continue;
                        }
                    } catch (err) {
                        // 文件不存在，继续处理
                    }

                    await this._ensureDirectoryExists(targetDir);

                    // 生成STRM文件内容
                    const content = this._joinUrl(account.cloudStrmPrefix, path.join(relativePath.replace(/^\/+|\/+$/g, ''), file.name));
                    // 写入STRM文件
                    await fs.writeFile(strmPath, content, 'utf8');
                    if (process.getuid && process.getuid() === 0) {
                        await fs.chown(strmPath, parseInt(this.puid), parseInt(this.pgid));
                    }
                    await fs.chmod(strmPath, 0o777);

                    stats.success++;
                    logTaskEvent(`生成STRM文件成功: ${strmPath}`);
                }
            } catch (error) {
                stats.failed++;
                logTaskEvent(`处理文件失败: ${file.name}, 错误: ${error.message}`);
            }
        }
    }

    async listStrmFiles(dirPath = '') {
        try {
            const targetPath = path.join(this.baseDir, dirPath);
            const results = [];
            
            // 检查目录是否存在
            try {
                await fs.access(targetPath);
            } catch (err) {
                return results;
            }
            // 读取目录内容
            const items = await fs.readdir(targetPath, { withFileTypes: true });
            for (const item of items) {
                const fullPath = path.join(targetPath, item.name);
                const relativePath = path.relative(this.baseDir, fullPath);
                if (item.isFile() && !item.name.startsWith('.') && path.extname(item.name) === '.strm') {
                    // 读取STRM文件内容
                    results.push({
                        id: item.name,
                        name: item.name,
                        path: relativePath
                    });
                }
            }
            
            return results;
        } catch (error) {
            throw new Error(`列出STRM文件失败: ${error.message}`);
        }
    }

    /**
     * 删除STRM文件
     * @param {string} fileName - 原始文件名
     * @returns {Promise<void>}
     */
    async delete(fileName) {
        const parsedPath = path.parse(fileName);
        const dirPath = parsedPath.dir;
        const fileNameWithoutExt = parsedPath.name;
        const strmPath = path.join(this.baseDir, dirPath, `${fileNameWithoutExt}.strm`);
        const nfoPath = path.join(this.baseDir, dirPath, `${fileNameWithoutExt}.nfo`);
        const thumbPath = path.join(this.baseDir, dirPath, `${fileNameWithoutExt}-thumb.jpg`);
        try {
           // 删除 .strm 文件
           try {
                await fs.access(strmPath);
                await fs.unlink(strmPath);
                logTaskEvent(`删除STRM文件成功: ${strmPath}`);
            } catch (err) {
                if (err.code !== 'ENOENT') { // 如果不是文件不存在错误，则记录
                    logTaskEvent(`尝试删除STRM文件失败: ${strmPath}, 错误: ${err.message}`);
                }
            }

            // 删除 .nfo 文件
            try {
                await fs.access(nfoPath);
                await fs.unlink(nfoPath);
                logTaskEvent(`删除NFO文件成功: ${nfoPath}`);
            } catch (err) {
                if (err.code !== 'ENOENT') { // 如果不是文件不存在错误，则记录
                    logTaskEvent(`尝试删除NFO文件失败: ${nfoPath}, 错误: ${err.message}`);
                }
            }

            // 删除 -thumb.jpg 图片
            try {
                await fs.access(thumbPath);
                await fs.unlink(thumbPath);
                logTaskEvent(`删除Thumb图片成功: ${thumbPath}`);
            } catch (err) {
                if (err.code !== 'ENOENT') { // 如果不是文件不存在错误，则记录
                    logTaskEvent(`尝试删除Thumb图片失败: ${thumbPath}, 错误: ${err.message}`);
                }
            }
            
            // 尝试删除空目录
            const targetDir = path.join(this.baseDir, dirPath);
            const files = await fs.readdir(targetDir);
            if (files.length === 0) {
                await fs.rmdir(targetDir);
                logTaskEvent(`删除空目录: ${targetDir}`);
            }
        } catch (error) {
            if (error.code !== 'ENOENT') {
                throw new Error(`删除STRM文件失败: ${error.message}`);
            }
        }
    }
    // 删除目录
    async deleteDir(dirPath) {
        try {
            const targetDir = path.join(this.baseDir, dirPath);
             // 检查目录是否存在
             try {
                await fs.access(targetDir);
            } catch (err) {
                // 目录不存在，直接返回
                // logTaskEvent(`STRM目录不存在，跳过删除: ${targetDir}`);
                return;
            }
            await fs.rm(targetDir, { recursive: true });
            logTaskEvent(`删除STRM目录成功: ${targetDir}`);

            // 检查并删除空的父目录
            const parentDir = path.dirname(targetDir);
            try {
                const files = await fs.readdir(parentDir);
                if (files.length === 0) {
                    await fs.rm(parentDir, { recursive: true });
                    logTaskEvent(`删除空目录: ${parentDir}`);
                }
            } catch (err) {
                
            }
        } catch (error) {
            logTaskEvent(`删除STRM目录失败: ${error.message}`);
        }
    }
    // 删除目录下的所有.strm文件
    async  _deleteDirAllStrm(dirPath) {
        // 检查目录是否存在
        try {
            await fs.access(dirPath);
        } catch (err) {
            // 目录不存在，直接返回
            logTaskEvent(`STRM目录不存在，跳过删除: ${dirPath}`);
            return;
        }
        const files = await fs.readdir(dirPath);
        await Promise.all(files.map(async file => {
            const filePath = path.join(dirPath, file);
            if (path.extname(filePath) === '.strm') {
                try {
                    await fs.unlink(filePath);
                    logTaskEvent(`删除文件成功: ${filePath}`);
                } catch (err) {
                    logTaskEvent(`删除文件失败: ${err.message}`);
                }
            }
        }));
    }
    //检查文件是否是媒体文件
    _checkFileSuffix(file, mediaSuffixs) {
         // 获取文件后缀
         const fileExt = '.' + file.name.split('.').pop().toLowerCase();
         return mediaSuffixs.includes(fileExt)
    }

    _joinUrl(base, path) {
        // 移除 base 末尾的斜杠（如果有）
        base = base.replace(/\/$/, '');
        // 移除 path 开头的斜杠（如果有）
        path = path.replace(/^\//, '');
        return `${base}/${path}`;
    }

    // 根据文件名获取STRM文件路径
    getStrmPath(task) {
        let taskName = task.realFolderName.substring(task.realFolderName.indexOf('/') + 1);
        if (!this.enable){
            // 如果cloudStrmPrefix存在 且不是url地址
            if (task.account.cloudStrmPrefix && !task.account.cloudStrmPrefix.startsWith('http')) {
                return path.join(task.account.cloudStrmPrefix, taskName);
            }
        }else{
            return path.join(this.baseDir, task.account.localStrmPrefix, taskName);
        }
        return '';
    }
}

module.exports = { StrmService };