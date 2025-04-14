const TelegramBot = require('node-telegram-bot-api');
const { AppDataSource } = require('../database');
const { Task, Account, CommonFolder } = require('../entities');
const { TaskService } = require('./task');
const { EmbyService } = require('./emby');
const { Cloud189Service } = require('./cloud189');
const path = require('path');

class TelegramBotService {
    constructor(token) {
        this.bot = new TelegramBot(token, { polling: true, request: {
            agentOptions: {
                keepAlive: true,
                family: 4
            }
        } });
        this.accountRepo = AppDataSource.getRepository(Account);
        this.commonFolderRepo = AppDataSource.getRepository(CommonFolder);
        this.taskRepo = AppDataSource.getRepository(Task);
        this.taskService = new TaskService(this.taskRepo, this.accountRepo);
        this.currentAccountId = null;
        this.currentAccount = null;
        this.currentShareLink = null;
        this.currentAccessCode = null;
        this.lastButtonMessageId = null;  // 上次按钮消息
        this.currentFolderPath = '';  // 当前路径
        this.currentFolderId = '-11';  // 当前文件夹ID
        this.folders = new Map();
        this.parentFolderIds = new Set();

        // 全局任务列表消息id
        this.globalTaskListMessageId = null;
        // 全局常用目录列表消息id
        this.globalCommonFolderListMessageId = null;

        // 设置命令菜单
        this.bot.setMyCommands([
            { command: 'help', description: '帮助信息' },
            { command: 'accounts', description: '账号列表' },
            { command: 'tasks', description: '任务列表' },
            { command: 'execute_all', description: '执行所有任务' },
            { command: 'fl', description: '常用目录列表' },
            { command: 'fs', description: '添加常用目录' },
            { command: 'cancel', description: '取消当前操作' }
        ]);

        this.initCommands();
    }

    initCommands() {

        this.bot.onText(/\/help/, async (msg) => {
            const helpText = 
                '🤖 天翼云盘机器人使用指南\n\n' +
                '📋 基础命令：\n' +
                '/help - 显示帮助信息\n' +
                '/accounts - 账号列表与切换\n' +
                '/tasks - 显示下载任务列表\n' +
                '/fl - 显示常用目录列表\n' +
                '/fs - 添加常用目录\n' +
                '/cancel - 取消当前操作\n\n' +
                '📥 创建任务：\n' +
                '直接发送天翼云盘分享链接即可创建任务\n' +
                '格式：链接（支持访问码的链接）\n\n' +
                '📝 任务操作：\n' +
                '/execute_[ID] - 执行指定任务\n' +
                '/execute_all - 执行所有任务\n' +
                '/strm_[ID] - 生成STRM文件\n' +
                '/emby_[ID] - 通知Emby刷新\n' +
                '/deletetask_[ID] - 删除指定任务\n\n' +
                '📁 目录操作：\n' +
                '/delfolder_[ID] - 删除指定常用目录';

            await this.bot.sendMessage(msg.chat.id, helpText);
        });

        this.bot.onText(/cloud\.189\.cn/, async (msg) => {
            const chatId = msg.chat.id;
            let shareLink = msg.text;
            
            let accessCode
            // 需要验证shareLink是否包含访问码
            if (shareLink.includes('访问码：')) {
                // 验证并解析分享链接
                const regex = /^(https:\/\/cloud\.189\.cn\/t\/[a-zA-Z0-9]+)(?:\s*（访问码：([a-zA-Z0-9]+)）)?$/;
                const linkMatch = regex.exec(shareLink);
                if (!linkMatch) {
                    return this.bot.sendMessage(chatId, '无效的天翼云盘分享链接');
                }
                shareLink = linkMatch[1];
                accessCode = linkMatch[2] || '';
            }
        
            try {
                if (!this._checkUserId(chatId)) return;
                await this.handleFolderSelection(chatId, shareLink, null, accessCode);
            } catch (error) {
                console.log(error)
                this.bot.sendMessage(chatId, `处理失败: ${error.message}`);
            }
        });


        // 添加账号列表命令
        this.bot.onText(/\/accounts/, async (msg) => {
            await this.showAccounts(msg.chat.id);
        });

        // 添加任务列表命令
        this.bot.onText(/\/tasks/, async (msg) => {
            const chatId = msg.chat.id;
            if (!this._checkUserId(chatId)) return
            await this.showTasks(msg.chat.id);
        });

        // 添加常用目录查询命令
        this.bot.onText(/\/fl$/, async (msg) => {
            const chatId = msg.chat.id;
            if (!this._checkUserId(chatId)) return
            await this.showCommonFolders(chatId);
        });

        this.bot.onText(/\/fs$/, async (msg) => {
            const chatId = msg.chat.id;
            if (!this._checkUserId(chatId)) return
            await this.showFolderTree(chatId);
        });

        // 执行任务
        this.bot.onText(/^\/execute_(\d+)$/, async (msg, match) => {
            const chatId = msg.chat.id;
            const taskId = match[1];
            if(!this._checkTaskId(taskId)) return;
            const message = await this.bot.sendMessage(chatId, `任务开始执行`);
            try{
                await this.taskService.processAllTasks(true, [taskId])   
                this.bot.deleteMessage(chatId, message.message_id);
                await this.bot.sendMessage(chatId, `任务执行完成`);
            }catch(e){
                await this.bot.editMessageText(`任务执行失败: ${e.message}`, {
                    chat_id: chatId,
                    message_id: message.message_id
                });
                return;
            }
        })

        // 执行所有任务
        this.bot.onText(/^\/execute_all$/, async (msg) => {
            const chatId = msg.chat.id;
            const message = await this.bot.sendMessage(chatId, `开始执行所有任务...`);
            try {
                await this.taskService.processAllTasks(true);
                this.bot.editMessageText("所有任务执行完成", {
                    chat_id: chatId,
                    message_id: message.message_id
                });
            } catch(e) {
                await this.bot.editMessageText(`任务执行失败: ${e.message}`, {
                    chat_id: chatId,
                    message_id: message.message_id
                });
            }
        });

        // 生成strm
        this.bot.onText(/\/strm_(\d+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            const taskId = match[1];
            if(!this._checkTaskId(taskId)) return;
            const task = await this.taskService.getTaskById(taskId);
            if (!task) {
                await this.bot.sendMessage(chatId, '未找到该任务');
                return;
            }
            const message = await this.bot.sendMessage(chatId, '开始生成strm...');
            try{
                this.taskService._createStrmFileByTask(task, false);
            }catch(e){
                await this.bot.sendMessage(chatId, `生成strm失败: ${e.message}`);
                return;
            }
            // 删除消息
            await this.bot.deleteMessage(chatId, message.message_id);
        })
        // 通知emby
        this.bot.onText(/\/emby_(\d+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            const taskId = match[1];
            if(!this._checkTaskId(taskId)) return;
            const task = await this.taskService.getTaskById(taskId);
            if (!task) {
                await this.bot.sendMessage(chatId, '未找到该任务');
                return;
            }
            const message = await this.bot.sendMessage(chatId, '开始通知emby...');
            try{
                const embyService = new EmbyService()                
                await embyService.notify(task)
                // 删除消息
            await this.bot.deleteMessage(chatId, msg.message_id);
            }catch(e){
                await this.bot.sendMessage(chatId, `通知失败: ${e.message}`);
                return;
            }
        })
        // 添加删除任务命令
        this.bot.onText(/\/dt_(\d+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            const taskId = match[1];
            const keyboard = [
                [
                    { text: '是', callback_data: JSON.stringify({ t: 'dt', i: taskId, c: true, df: true }) },
                    { text: '否', callback_data: JSON.stringify({ t: 'dt', i: taskId, c: true, df: false }) }
                ],
                [{ text: '取消', callback_data: JSON.stringify({ t: 'dt', c: false }) }]
            ];
            await this.bot.sendMessage(chatId, '是否同步删除网盘文件？', {
                reply_markup: { inline_keyboard: keyboard }
            });
        });

        // 删除常用目录
        this.bot.onText(/\/df_(\d+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            const folderId = match[1];
            if (!this._checkUserId(chatId)) return
          
            try {
                await this.commonFolderRepo.delete({
                    id: folderId,
                    accountId: this.currentAccountId
                });
                await this.bot.sendMessage(chatId, '删除成功');
                await this.showCommonFolders(chatId);
            } catch (error) {
                await this.bot.sendMessage(chatId, `删除失败: ${error.message}`);
            }
        });

        this.bot.onText(/\/cancel/, async (msg) => {
            const chatId = msg.chat.id;
            // 清除缓存
            this.currentShareLink = null;
            this.currentAccessCode = null;
            
            try {
                if (this.lastButtonMessageId) {
                    await this.bot.deleteMessage(chatId, this.lastButtonMessageId);
                    this.lastButtonMessageId = null;
                }
            } catch (error) {
                console.error('删除消息失败:', error);
            }
            
            await this.bot.sendMessage(chatId, '已取消当前操作');
        });

        // 修改回调处理
        this.bot.on('callback_query', async (callbackQuery) => {
            const data = JSON.parse(callbackQuery.data);
            const chatId = callbackQuery.message.chat.id;
            const messageId = callbackQuery.message.message_id;

            try {
                switch (data.t) {
                    case 'f': // 文件夹选择
                        await this.createTask(chatId, data, messageId);
                        break;
                    case 'of': // 覆盖文件夹
                        if (!data.o) {
                            await this.bot.editMessageText("已取消任务创建",{
                                chat_id: chatId,
                                message_id: messageId
                            });
                            return;
                        }
                        await this.createTask(chatId, data, messageId);
                        break;
                    case 'sa': // 设置当前账号
                        await this.setCurrentAccount(chatId, data, messageId);
                        break;
                    case 'tp': // 任务分页
                        await this.showTasks(chatId, data.p, messageId);
                        break;
                    case 'dt': // 删除任务
                        if (!data.c) {
                            await this.bot.editMessageText("已取消删除",{
                                chat_id: chatId,
                                message_id: messageId
                            });
                            return;
                        }
                        await this.deleteTask(chatId, data, messageId);
                        break;
                    case 'fd': // 进入下一级目录
                        await this.showFolderTree(chatId, data, messageId);
                        break;
                    case 'fc': // 取消操作
                        await this.bot.deleteMessage(chatId, messageId);
                        break;
                    case 'fs': // 保存当前目录
                        await this.saveFolderAsFavorite(chatId, data, messageId);
                        break;
                }
            } catch (error) {
                this.bot.sendMessage(chatId, `处理失败: ${error.message}`);
            }
        });
    }

    async showAccounts(chatId, messageId = null) {
        const accounts = await this.accountRepo.find();
        const keyboard = accounts.map(account => [{
            text: `${account.username.slice(0, 3)}***${account.username.slice(-3)} ${account.id === this.currentAccountId ? '✅' : ''}`,
            callback_data: JSON.stringify({ t: 'sa', i: account.id, a: `${account.username.slice(0, 3)}***${account.username.slice(-3)}` })
        }]);

        const message = '账号列表 (✅表示当前选中账号):';
        if (messageId) {
            await this.bot.editMessageText(message, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: { inline_keyboard: keyboard }
            });
        } else {
            await this.bot.sendMessage(chatId, message, {
                reply_markup: { inline_keyboard: keyboard }
            });
        }
    }

    async showTasks(chatId, page = 1, messageId = null) {
        const pageSize = 5;
        const skip = (page - 1) * pageSize;
        
        const [tasks, total] = await this.taskRepo.findAndCount({
            order: { updatedAt: 'DESC' },
            take: pageSize,
            skip: skip
        });

        const totalPages = Math.ceil(total / pageSize);
        
        const taskList = tasks.map(task => 
            `📺 ${task.resourceName}\n` +
            `⏱ 进度：${task.currentEpisodes}${task.totalEpisodes ? '/' + task.totalEpisodes : ''} 集\n` +
            `🔄 状态：${this.formatStatus(task.status)}\n` +
            `⌚️ 更新：${new Date(task.lastFileUpdateTime).toLocaleString('zh-CN')}\n` +
            `📁 执行: /execute_${task.id}\n` +
            `📁 STRM：/strm_${task.id}\n` +
            `🎬 Emby：/emby_${task.id}\n` +
            `❌ 删除: /deletetask_${task.id}`
        ).join('\n\n');

        const keyboard = [];

        // 添加分页按钮
        if (totalPages > 1) {
            const pageButtons = [];
            if (page > 1) {
                pageButtons.push({
                    text: '⬅️',
                    callback_data: JSON.stringify({ t: 'tp', p: page - 1 })
                });
            }
            pageButtons.push({
                text: `${page}/${totalPages}`,
                callback_data: JSON.stringify({ t: 'tp', p: page })
            });
            if (page < totalPages) {
                pageButtons.push({
                    text: '➡️',
                    callback_data: JSON.stringify({ t: 'tp', p: page + 1 })
                });
            }
            keyboard.push(pageButtons);
        }

        const message = tasks.length > 0 ? 
            `📋 任务列表 (第${page}页):\n\n${taskList}` : 
            '📭 暂无任务';

        if (messageId) {
            await this.bot.editMessageText(message, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: keyboard }
            });
        } else {
            // 先删除之前的消息
            if (this.globalTaskListMessageId) {
                await this.bot.deleteMessage(chatId, this.globalTaskListMessageId);
            }
            const newMessage = await this.bot.sendMessage(chatId, message, {
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: keyboard }
            });
            this.globalTaskListMessageId = newMessage.message_id;
        }
    }

    formatStatus(status) {
        const statusMap = {
            'pending': '⏳ 待处理',
            'processing': '🔄 处理中',
            'completed': '✅ 已完成',
            'failed': '❌ 失败'
        };
        return statusMap[status] || status;
    }

    async setCurrentAccount(chatId, data, messageId) {
        try {
            const accountId = data.i;
            if (this.currentAccountId == accountId) {
                await this.bot.sendMessage(chatId, `账号[${data.a}]已被选中`);
                await this.bot.deleteMessage(chatId, messageId);
                return;
            } 
            this.currentAccountId = accountId;
            // 获取账号信息
            const account = await this.accountRepo.findOneBy({ id: accountId });
            if (!account) {
                await this.bot.sendMessage(chatId, '未找到该账号');
            }
            this.currentAccount = account;
            // 删除原消息
            await this.bot.deleteMessage(chatId, messageId);
            await this.bot.sendMessage(chatId, `已选择账号: ${this._getDesensitizedUserName()}`);

        } catch (error) {
            this.bot.sendMessage(chatId, `设置当前账号失败: ${error.message}`);
        }
    }

    async handleFolderSelection(chatId, shareLink, messageId = null,accessCode) {
        const folders = await this.commonFolderRepo.find({ where: { accountId: this.currentAccountId } });
        
        if (folders.length === 0) {
            const keyboard = [[{ 
                text: '📁 添加常用目录',
                callback_data: JSON.stringify({ t: 'fd', f: '-11' })
            }]];
            const message = `当前账号: ${this._getDesensitizedUserName()} \n 未找到常用目录，请添加常用目录`;
            if (messageId) {
                await this.bot.editMessageText(message, {
                    chat_id: chatId,
                    message_id: messageId,
                    reply_markup: { inline_keyboard: keyboard }
                });
                this.globalCommonFolderListMessageId = null
            } else {
                await this.bot.sendMessage(chatId, message, {reply_markup: { inline_keyboard: keyboard }});
            }
            return;
        }
        // 缓存当前分享信息
        this.currentShareLink = shareLink;
        this.currentAccessCode = accessCode;
        const keyboard = folders.map(folder => [{
            text: folder.path.length > 30 ? 
                  '.../' + folder.path.split('/').slice(-2).join('/') : 
                  folder.path,
            callback_data: JSON.stringify({
                t: 'f',               // type
                f: folder.id,   // folderId
            })
        }]);

        const message = `当前账号: ${this._getDesensitizedUserName()} \n请选择保存目录:`;
        if (messageId) {
            await this.bot.editMessageText(message, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: {
                    inline_keyboard: keyboard
                }
            });
            this.lastButtonMessageId = messageId;
        } else {
            const msg = await this.bot.sendMessage(chatId, message, {
                reply_markup: {
                    inline_keyboard: keyboard
                }
            });
            this.lastButtonMessageId = msg.message_id;
        }
    }

    async createTask(chatId, data, messageId) {
        try {
            const targetFolderId = data.f;
            // 根据targetFolderId查询出folderName
            const targetFolder = await this.commonFolderRepo.findOne({ where: { id: targetFolderId } });
            if (!targetFolder) {
                await this.bot.sendMessage(chatId, '未找到该目录');
                return
            }
            // 发送任务创建中消息
            const message = await this.bot.editMessageText('任务创建中...',{
                chat_id: chatId,
                message_id: messageId
            });
            const taskDto = {
                accountId: this.currentAccountId,
                shareLink: this.currentShareLink,
                targetFolderId: targetFolderId,
                targetFolder: targetFolder.path,
                tgbot: true,
                overwriteFolder: data?.o,
            };
            const tasks = await this.taskService.createTask(taskDto);
            // 遍历获取task.id
            const taskIds = tasks.map(task => task.id);
            this.bot.editMessageText('任务创建成功, 执行中...', {
                chat_id: chatId,
                message_id: message.message_id
            });
            if(taskIds.length > 0) {
                await this.taskService.processAllTasks(true, taskIds)   
            }
            this.bot.deleteMessage(chatId, message.message_id);
            // 发送任务执行完成消息
            this.bot.sendMessage(chatId, '任务执行完成');
            // 清空缓存
            this.currentShareLink = null;
            this.currentAccessCode = null;
        } catch (error) {
            // 如果报错是 folder already exists 则提示用户是否需要覆盖
            if (error.message.includes('folder already exists')) {
                const keyboard = [
                    [{ text: '是', callback_data: JSON.stringify({ t: 'of', f: data.f, o: true }) }],
                    [{ text: '否', callback_data: JSON.stringify({ t: 'of', f: data.f, o: false }) }]
                ];
                await this.bot.editMessageText('该目录下已有同名文件夹，是否覆盖？', {
                    chat_id: chatId,
                    message_id: messageId,
                    reply_markup: {
                        inline_keyboard: keyboard
                    }
                });
                return;
            }else{
                await this.bot.editMessageText(`任务创建失败: ${error.message}`, {
                    chat_id: chatId,
                    message_id: messageId
                });
                // 清空缓存
                this.currentShareLink = null;
                this.currentAccessCode = null;
                return;
            }
        }
    }

    async deleteTask(chatId,data,messageId) {
        try{
            // 判断data.i是否为数字
            if(isNaN(data.i)) {
                await this.bot.editMessageText('任务ID无效', {
                    chat_id: chatId,
                    message_id: messageId
                });
                return;
            }
            // 发送任务删除中消息
            await this.bot.editMessageText('任务删除中...',{
                chat_id: chatId,
                message_id: messageId
            });

            await this.taskService.deleteTask(parseInt(data.i), data.df);
            await this.bot.editMessageText('任务删除成功', {
                chat_id: chatId,
                message_id: messageId
            });
            // 刷新任务列表
            setTimeout(() => this.showTasks(chatId, 1), 800);
        }catch(e) {
            this.bot.editMessageText(`任务删除失败: ${e.message}`, {
                chat_id: chatId,
                message_id: messageId
            });
        }
    }

    async showCommonFolders(chatId, messageId = null) {
        const folders = await this.commonFolderRepo.find({ 
            where: { 
                accountId: this.currentAccountId 
            },
            order: {
                path: 'ASC'
            }
        });
        const keyboard = [[{ 
            text: '📁 添加常用目录',
            callback_data: JSON.stringify({ t: 'fd', f: '-11' })
        }]];
        if (folders.length === 0) {
            const message = `当前账号: ${this._getDesensitizedUserName()} \n 未找到常用目录，请先添加常用目录`;
            if (messageId) {
                await this.bot.editMessageText(message, {
                    chat_id: chatId,
                    message_id: messageId,
                    reply_markup: { inline_keyboard: keyboard }
                });
                this.globalCommonFolderListMessageId = null
            } else { 
                if (this.globalCommonFolderListMessageId) {
                    await this.bot.deleteMessage(chatId, this.globalCommonFolderListMessageId);
                    this.globalCommonFolderListMessageId = null;
                }
                await this.bot.sendMessage(chatId, message,{reply_markup: { inline_keyboard: keyboard }});
            }
            return;
        }

        const folderList = folders.map(folder => 
            `📁 ${folder.path}\n❌ 删除: /df_${folder.id}`
        ).join('\n\n');

        const message = `当前账号: ${this._getDesensitizedUserName()} \n 常用目录列表:\n\n${folderList}`;
        if (messageId) {
            await this.bot.editMessageText(message, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: { inline_keyboard: keyboard }
            });
            this.globalCommonFolderListMessageId = null
        } else {
            if (this.globalCommonFolderListMessageId) {
                await this.bot.deleteMessage(chatId, this.globalCommonFolderListMessageId);
            }
            const newMessage = await this.bot.sendMessage(chatId, message,{reply_markup: { inline_keyboard: keyboard }});
            this.globalCommonFolderListMessageId = newMessage.message_id;
        }
    }

    async showFolderTree(chatId, data, messageId = null) {
        try {
            let folderId = data?.f || '-11';
            if (!this._checkUserId()) return;
            if (data?.r) {
               // 返回上一级目录，从记录的父级ID中获取
               const parentId = Array.from(this.parentFolderIds).pop() || '-11';
               this.parentFolderIds.delete(parentId);
               const path = this.currentFolderPath.split('/').filter(Boolean);
               path.pop();
               path.pop();
               this.currentFolderPath = path.join('/');
               folderId = parentId;
            } else if (folderId !== '-11') {
                // 非根目录时记录父级ID
                const folder = this.folders.get(folderId);
                if (folder?.pId) {
                    this.parentFolderIds.add(folder.pId);
                }
            }
            const cloud189 = Cloud189Service.getInstance(this.currentAccount);
            const folders = await cloud189.getFolderNodes(folderId);
            if (!folders) {
                await this.bot.sendMessage(chatId, '获取文件夹列表失败');
                return;
            }

            // 获取当前账号的所有常用目录
            const commonFolders = await this.commonFolderRepo.find({
                where: { accountId: this.currentAccountId }
            });
            const commonFolderIds = new Set(commonFolders.map(f => f.id));

            // 更新当前ID
            this.currentFolderId = folderId;

            // 处理路径更新
            if (folderId === '-11') {
                // 根目录
                this.currentFolderPath = '/';
            } else {
                this.currentFolderPath = path.join(this.currentFolderPath, this.folders.get(folderId).name);
            }

            const keyboard = [];
            
            // 添加文件夹按钮
            for (const folder of folders) {
                keyboard.push([{
                    text: `📁 ${folder.name}${commonFolderIds.has(folder.id) ? ' ✅' : ''}`,
                    callback_data: JSON.stringify({
                        t: 'fd',
                        f: folder.id
                    })
                }]);
                this.folders.set(folder.id, folder);
            }
            
            // 添加操作按钮
            keyboard.push([
                {
                    text: '❌ 关闭',
                    callback_data: JSON.stringify({ t: 'fc' })
                },
                ...(folderId !== '-11' ? [{
                    text: '🔄 返回',
                    callback_data: JSON.stringify({
                        t: 'fd',
                        f: folders[0]?.pId || '-11',
                        r: true
                    })
                }] : []),
                {
                    text: '✅ 确认',
                    callback_data: JSON.stringify({ 
                        t: 'fs',
                        f: folderId
                    })
                },
            ]);

            const message = `当前账号: ${this._getDesensitizedUserName()} \n 当前路径: ${this.currentFolderPath}\n请选择要添加的目录:`;

            if (messageId) {
                await this.bot.editMessageText(message, {
                    chat_id: chatId,
                    message_id: messageId,
                    reply_markup: { inline_keyboard: keyboard }
                });
            } else {
                await this.bot.sendMessage(chatId, message, {
                    reply_markup: { inline_keyboard: keyboard }
                });
            }

        } catch (error) {
            console.log(error);
            this.bot.sendMessage(chatId, `获取目录失败: ${error.message}`);
        }
    }

    async saveFolderAsFavorite(chatId, data, messageId) {
        try {
            const currentPath = this.currentFolderPath|| '';

            // 校验目录是否已经是常用目录
            const existingFavorite = await this.commonFolderRepo.findOne({
                where: {
                    accountId: this.currentAccountId,
                    id: data.f
                }
            });
            if (existingFavorite) {
                await this.bot.editMessageText(`${data.p || '根目录'} 已经是常用目录`, {
                    chat_id: chatId,
                    message_id: messageId
                });
                this.globalCommonFolderListMessageId = null;
                return;
            }
            const favorite = {
                accountId: this.currentAccountId,
                id: data.f,
                path: currentPath,
                name: currentPath.split('/').pop() || '根目录'
            };
            
            await this.commonFolderRepo.save(favorite);
            await this.bot.editMessageText(`已将 ${currentPath || '根目录'} 添加到常用目录`, {
                chat_id: chatId,
                message_id: messageId
            });
            
        } catch (error) {
            throw new Error(`保存常用目录失败: ${error.message}`);
        }
    }

    // 校验任务id
    _checkTaskId(taskId) {
        if(isNaN(taskId)) {
            this.bot.editMessageText('任务ID无效', {
                chat_id: chatId,
                message_id: messageId
            });
            return false;
        }
        return true;
    }
    // 校验当前是否有用户id
    _checkUserId(chatId) {
        if(!this.currentAccountId) {
            this.bot.sendMessage(chatId, '请先使用 /accounts 选择账号');
            return false;
        }
        return true;
    }
    // 获取当前已脱敏的用户名
    _getDesensitizedUserName() {
       return this.currentAccount.username.replace(/(.{3}).*(.{4})/, '$1****$2');
    }

}

module.exports = { TelegramBotService };