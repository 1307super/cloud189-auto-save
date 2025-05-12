const { LessThan, In } = require('typeorm');
const { Cloud189Service } = require('./cloud189');
const { MessageUtil } = require('./message');
const { logTaskEvent } = require('../utils/logUtils');
const ConfigService = require('./ConfigService');
const { CreateTaskDto } = require('../dto/TaskDto');
const { BatchTaskDto } = require('../dto/BatchTaskDto');
const { TaskCompleteEventDto } = require('../dto/TaskCompleteEventDto');
const { SchedulerService } = require('./scheduler');

const path = require('path');
const { StrmService } = require('./strm');
const { EventService } = require('./eventService');
const { TaskEventHandler } = require('./taskEventHandler');
const { ProxyFileService } = require('./ProxyFileService');
const AIService = require('./ai');
const harmonizedFilter = require('../utils/BloomFilter');
const cloud189Utils = require('../utils/Cloud189Utils');

class TaskService {
    constructor(taskRepo, accountRepo, proxyFileRepo) {
        this.taskRepo = taskRepo;
        this.accountRepo = accountRepo;
        this.messageUtil = new MessageUtil();
        this.eventService = EventService.getInstance();
        this.proxyFileService = new ProxyFileService(proxyFileRepo);
        // 如果还没有taskComplete事件的监听器，则添加
        if (!this.eventService.hasListeners('taskComplete')) {
            const taskEventHandler = new TaskEventHandler(this.messageUtil);
            this.eventService.on('taskComplete', async (eventDto) => {
                eventDto.taskService = this;
                eventDto.taskRepo = this.taskRepo;
                taskEventHandler.handle(eventDto);
            });
        }
    }

    // 解析分享链接
    async getShareInfo(cloud189, shareCode) {
         const shareInfo = await cloud189.getShareInfo(shareCode);
         if (!shareInfo) throw new Error('获取分享信息失败');
         if(shareInfo.res_code == "ShareAuditWaiting") {
            throw new Error('分享链接审核中, 请稍后再试');
         }
         return shareInfo;
    }

    // 创建任务的基础配置
    _createTaskConfig(taskDto, shareInfo, realFolder, resourceName, currentEpisodes = 0, shareFolderId = null, shareFolderName = "") {
        return {
            accountId: taskDto.accountId,
            shareLink: taskDto.shareLink,
            targetFolderId: taskDto.targetFolderId,
            realFolderId:realFolder.id,
            realFolderName:realFolder.name,
            status: 'pending',
            totalEpisodes: taskDto.totalEpisodes,
            resourceName,
            currentEpisodes,
            shareFileId: shareInfo.fileId,
            shareFolderId: shareFolderId || shareInfo.fileId,
            shareFolderName,
            shareId: shareInfo.shareId,
            shareMode: shareInfo.shareMode,
            accessCode: taskDto.accessCode,
            matchPattern: taskDto.matchPattern,
            matchOperator: taskDto.matchOperator,
            matchValue: taskDto.matchValue,
            remark: taskDto.remark,
            realRootFolderId: taskDto.realRootFolderId,
            enableCron: taskDto.enableCron,
            cronExpression: taskDto.cronExpression,
            sourceRegex: taskDto.sourceRegex,
            targetRegex: taskDto.targetRegex,
            enableTaskScraper: taskDto.enableTaskScraper,
            enableSystemProxy: taskDto.enableSystemProxy,
            isFolder: taskDto.isFolder
        };
    }

     // 验证并创建目标目录
     async _validateAndCreateTargetFolder(cloud189, taskDto, shareInfo) {
        if (!this.checkFolderInList(taskDto, '-1')) {
            return {id: taskDto.targetFolderId, name: '', oldFolder: true}
        }
        if (taskDto.enableSystemProxy) {
            // 不创建文件夹
            return {id: taskDto.targetFolderId, name: shareInfo.fileName}
        }
        // 检查目标文件夹是否存在
        await this.checkFolderExists(cloud189, taskDto.targetFolderId, shareInfo.fileName, taskDto.overwriteFolder);
        const targetFolder = await cloud189.createFolder(shareInfo.fileName, taskDto.targetFolderId);
        if (!targetFolder || !targetFolder.id) throw new Error('创建目录失败');
        return targetFolder;
    }

    // 处理文件夹分享
    async _handleFolderShare(cloud189, shareInfo, taskDto, rootFolder, tasks) {
        const result = await cloud189.listShareDir(shareInfo.shareId, shareInfo.fileId, shareInfo.shareMode, taskDto.accessCode);
        if (!result?.fileListAO) return;
        const { fileList: rootFiles = [], folderList: subFolders = [] } = result.fileListAO;
        // 处理根目录文件 如果用户选择了根目录, 则生成根目录任务
        if (rootFiles.length > 0 && !rootFolder?.oldFolder) {
            const enableOnlySaveMedia = ConfigService.getConfigValue('task.enableOnlySaveMedia');
            // mediaSuffixs转为小写
            const mediaSuffixs = ConfigService.getConfigValue('task.mediaSuffix').split(';').map(suffix => suffix.toLowerCase())
            // 校验文件是否一个满足条件的都没有, 如果都没有 直接跳过
            let shouldContinue = false;
            if (enableOnlySaveMedia && !rootFiles.some(file => this._checkFileSuffix(file, true, mediaSuffixs))) {
                shouldContinue = true
            }
            if (!shouldContinue) {
                taskDto.realRootFolderId = rootFolder.id;
                const rootTask = this.taskRepo.create(
                    this._createTaskConfig(
                        taskDto,
                        shareInfo, rootFolder, `${shareInfo.fileName}(根)`, 0
                    )
                );
                tasks.push(await this.taskRepo.save(rootTask));
            }
        }
        if (subFolders.length > 0) {
            taskDto.realRootFolderId = rootFolder.id;
            // 如果启用了 AI 分析，分析子文件夹
            if (AIService.isEnabled() && subFolders.length > 0) {
                try {
                    const resourceInfo = await this._analyzeResourceInfo(
                        shareInfo.fileName,
                        subFolders.map(f => ({ id:f.id, name: f.name })),
                        'folder'
                    );
                    // 遍历子文件夹，使用 AI 分析结果更新文件夹名称
                    for (const folder of subFolders) {
                        // 在 AI 分析结果中查找对应的文件夹
                        const aiFolder = resourceInfo.folders.find(f => f.id === folder.id);
                        if (aiFolder) {
                            folder.name = aiFolder.name;
                        }
                    }
                } catch (error) {
                    logTaskEvent('子文件夹 AI 分析失败，使用原始文件名: ' + error.message);
                }
            }
             // 处理子文件夹
            for (const folder of subFolders) {
                // 检查用户是否选择了该文件夹
                if (!this.checkFolderInList(taskDto, folder.id)) {
                    continue;
                }
                const subFolderContent = await cloud189.listShareDir(shareInfo.shareId, folder.id, shareInfo.shareMode, taskDto.accessCode);
                const hasFiles = subFolderContent?.fileListAO?.fileList?.length > 0;
                if (!hasFiles) {
                    logTaskEvent(`子文件夹 "${folder.name}" (ID: ${folder.id}) 为空，跳过目录。`);
                    continue; // 跳到下一个子文件夹
                }
                let realFolder;
                if (taskDto.enableSystemProxy) {
                    // 系统代理模式下不创建实际目录
                    realFolder = {
                        id: folder.id,
                        name: path.join(rootFolder.name, folder.name)
                    };
                } else {
                    // 检查目标文件夹是否存在
                    await this.checkFolderExists(cloud189, rootFolder.id, folder.fileName, taskDto.overwriteFolder);
                    realFolder = await cloud189.createFolder(folder.name, rootFolder.id);
                    if (!realFolder?.id) throw new Error('创建目录失败');
                    rootFolder?.oldFolder && (taskDto.realRootFolderId = realFolder.id);
                    realFolder.name = path.join(rootFolder.name, realFolder.name);
                }
                const subTask = this.taskRepo.create(
                    this._createTaskConfig(
                        taskDto,
                        shareInfo, realFolder, shareInfo.fileName, 0, folder.id, folder.name
                    )
                );
                tasks.push(await this.taskRepo.save(subTask));
            }
        }
    }

    // 处理单文件分享
    async _handleSingleShare(cloud189, shareInfo, taskDto, rootFolder, tasks) {
        const shareFiles = await cloud189.getShareFiles(shareInfo.shareId, shareInfo.fileId, shareInfo.shareMode, taskDto.accessCode, false);
        if (!shareFiles?.length) throw new Error('获取文件列表失败');
        taskDto.realRootFolderId = rootFolder.id;
        const task = this.taskRepo.create(
            this._createTaskConfig(
                taskDto,
                shareInfo, rootFolder, shareInfo.fileName, 0
            )
        );
        tasks.push(await this.taskRepo.save(task));
    }

    async _analyzeResourceInfo(resourcePath, files, type = 'folder') {
        try {
            if (type == 'folder') {
                const result = await AIService.folderAnalysis(resourcePath, files);
                if (!result.success) {
                    throw new Error('AI 分析失败:'+ result.error);
                }
                return result.data;
            }
            const result = await AIService.simpleChatCompletion(resourcePath, files);
            if (!result.success) {
                throw new Error('AI 分析失败: ' + result.error);
            }
            return result.data;
        } catch (error) {
            throw new Error('AI 分析失败: ' + error.message);
        }
    }

    // 创建新任务
    async createTask(params) {
        const taskDto = new CreateTaskDto(params);
        taskDto.validate();
        // 获取分享信息
        const account = await this.accountRepo.findOneBy({ id: taskDto.accountId });
        if (!account) throw new Error('账号不存在');
        
        // 解析url
        const {url: parseShareLink, accessCode} = cloud189Utils.parseCloudShare(taskDto.shareLink)
        if (accessCode) {
            taskDto.accessCode = accessCode;
        }
        taskDto.shareLink = parseShareLink;
        const cloud189 = Cloud189Service.getInstance(account);
        const shareCode = cloud189Utils.parseShareCode(taskDto.shareLink);
        const shareInfo = await this.getShareInfo(cloud189, shareCode);
        // 如果分享链接是加密链接, 且没有提供访问码, 则抛出错误
        if (shareInfo.shareMode == 1 ) {
            if (!taskDto.accessCode) {
                throw new Error('分享链接为加密链接, 请提供访问码');
            }
            // 校验访问码是否有效
            const accessCodeResponse = await cloud189.checkAccessCode(shareCode, taskDto.accessCode);
            if (!accessCodeResponse) {
                throw new Error('校验访问码失败');
            }
            if (!accessCodeResponse.shareId) {
                throw new Error('访问码无效');
            }
            shareInfo.shareId = accessCodeResponse.shareId;
        }
        if (!shareInfo.shareId) {
            throw new Error('获取分享信息失败');
        }
        // 如果启用了 AI 分析
        if (AIService.isEnabled()) {
            try {
                const resourceInfo = await this._analyzeResourceInfo(shareInfo.fileName, [], 'folder');
                // 使用 AI 分析结果更新任务名称
                shareInfo.fileName = resourceInfo.year?`${resourceInfo.name} (${resourceInfo.year})`:resourceInfo.name;
                taskDto.taskName = shareInfo.fileName;
            } catch (error) {
                logTaskEvent('AI 分析失败，使用原始文件名: ' + error.message);
            }
        }
        // 如果任务名称存在 且和shareInfo的name不一致
        if (taskDto.taskName && taskDto.taskName != shareInfo.fileName) {
            shareInfo.fileName = taskDto.taskName;
        }
        taskDto.isFolder = true

        // 检查并创建目标目录
        const rootFolder = await this._validateAndCreateTargetFolder(cloud189, taskDto, shareInfo);
        const tasks = [];
        rootFolder.name = path.join(taskDto.targetFolder, rootFolder.name)
        if (shareInfo.isFolder) {
            await this._handleFolderShare(cloud189, shareInfo, taskDto, rootFolder, tasks);
        }

         // 处理单文件
         if (!shareInfo.isFolder) {
            taskDto.isFolder = false
            await this._handleSingleShare(cloud189, shareInfo, taskDto, rootFolder, tasks);
        }
        if (taskDto.enableCron) {
            for(const task of tasks) {
                SchedulerService.saveTaskJob(task, this)   
            }
        }
        return tasks;
    }

    // 删除任务
    async deleteTask(taskId, deleteCloud) {
        const task = await this.getTaskById(taskId);
        if (!task) throw new Error('任务不存在');
        const folderName = task.realFolderName.substring(task.realFolderName.indexOf('/') + 1);
        if (!task.enableSystemProxy && deleteCloud) {
            const account = await this.accountRepo.findOneBy({ id: task.accountId });
            if (!account) throw new Error('账号不存在');
            const cloud189 = Cloud189Service.getInstance(account);
            await this.deleteCloudFile(cloud189,await this.getRootFolder(task), 1);
            // 删除strm
            new StrmService().deleteDir(path.join(task.account.localStrmPrefix, folderName))
        }
        if (task.enableSystemProxy) {
            await this.proxyFileService.deleteFiles(task.id)
            // 删除strm
            new StrmService().deleteDir(path.join(task.account.localStrmPrefix, folderName))
        }
        // 删除定时任务
        if (task.enableCron) {
            SchedulerService.removeTaskJob(task.id)
        }
        await this.taskRepo.remove(task);
    }

    // 批量删除
    async deleteTasks(taskIds, deleteCloud) {
        for(const taskId of taskIds) {
            try{
                await this.deleteTask(taskId, deleteCloud)
            }catch (error){

            }
        }
    }

    // 获取文件夹下的所有文件
    async getAllFolderFiles(cloud189, task) {
        if (task.enableSystemProxy) {
            return await this.proxyFileService.getFilesByTaskId(task.id);
        }
        const folderId = task.realFolderId
        const folderInfo = await cloud189.listFiles(folderId);
        // 如果folderInfo.res_code == FileNotFound 需要重新创建目录
        if (folderInfo.res_code == "FileNotFound") {
            logTaskEvent('文件夹不存在!')
            if (!task) {
                throw new Error('文件夹不存在!');
            }
            logTaskEvent('正在重新创建目录');
            const enableAutoCreateFolder = ConfigService.getConfigValue('task.enableAutoCreateFolder');
            if (enableAutoCreateFolder) {
                await this._autoCreateFolder(cloud189, task);
                return await this.getAllFolderFiles(cloud189, task);
            }
        }
        if (!folderInfo || !folderInfo.fileListAO) {
            return [];
        }

        let allFiles = [...(folderInfo.fileListAO.fileList || [])];
        return allFiles;
    }

    // 自动创建目录
    async _autoCreateFolder(cloud189, task) {
         // 检查 targetFolderId 是否存在
         const targetFolderInfo = await cloud189.listFiles(task.targetFolderId);
         if (targetFolderInfo.res_code === "FileNotFound") {
             throw new Error('保存目录不存在，无法自动创建目录');
         }

        // 如果 realRootFolderId 存在，先检查是否可用
        if (task.realRootFolderId) {
            const rootFolderInfo = await cloud189.listFiles(task.realRootFolderId);
            if (rootFolderInfo.res_code === "FileNotFound") {
                // realRootFolderId 不存在或不可用，需要创建
                const rootFolderName = task.resourceName.replace('(根)', '').trim();
                logTaskEvent(`正在创建根目录: ${rootFolderName}`);
                const rootFolder = await cloud189.createFolder(rootFolderName, task.targetFolderId);
                if (!rootFolder?.id) throw new Error('创建根目录失败');
                task.realRootFolderId = rootFolder.id;
                logTaskEvent(`根目录创建成功: ${rootFolderName}`);
            }
        }

        // 如果是子文件夹任务，在 realRootFolderId 下创建子文件夹
        if (task.realRootFolderId !== task.realFolderId) {
            logTaskEvent(`正在创建子目录: ${task.shareFolderName}`);
            const subFolder = await cloud189.createFolder(task.shareFolderName, task.realRootFolderId);
            if (!subFolder?.id) throw new Error('创建子目录失败');
            task.realFolderId = subFolder.id;
            logTaskEvent(`子目录创建成功: ${task.shareFolderName}`);
        } else {
            // 如果是根目录任务，则 realFolderId 等于 realRootFolderId
            task.realFolderId = task.realRootFolderId;
        }

        await this.taskRepo.save(task);
        logTaskEvent('目录创建完成');
    }

    // 处理新文件
    async _handleNewFiles(task, newFiles, cloud189, mediaSuffixs) {
        const taskInfoList = [];
        const fileNameList = [];
        let fileCount = 0;

        for (const file of newFiles) {
            if (task.enableSystemProxy) {
                // 系统代理模式：保存到代理文件表
                taskInfoList.push({
                    id: file.id,
                    taskId: task.id,
                    name: file.name,
                    md5: file.md5,
                    size: file.size,
                    lastOpTime: file.lastOpTime
                })
            } else {
                // 普通模式：添加到转存任务
                taskInfoList.push({
                    fileId: file.id,
                    fileName: file.name,
                    isFolder: 0,
                    md5: file.md5,
                });
            }
            fileNameList.push(`├─ ${file.name}`);
            if (this._checkFileSuffix(file, true, mediaSuffixs)) fileCount++;
        }
        // 如果有多个文件，最后一个文件使用└─
        if (fileNameList.length > 0) {
            const lastItem = fileNameList.pop();
            fileNameList.push(lastItem.replace('├─', '└─'));
        }
        if (taskInfoList.length > 0) {
            if (!task.enableSystemProxy) {
                const batchTaskDto = new BatchTaskDto({
                    taskInfos: JSON.stringify(taskInfoList),
                    type: 'SHARE_SAVE',
                    targetFolderId: task.realFolderId,
                    shareId: task.shareId
                });
                await this.createBatchTask(cloud189, batchTaskDto);
            }else{
                // 系统代理模式：保存到代理文件表
                await this.proxyFileService.batchCreateFiles(taskInfoList);
            }
        }
        // 修改省略号的显示格式
        if (fileNameList.length > 20) {
            fileNameList.splice(5, fileNameList.length - 10, '├─ ...');
        }

        return { fileNameList, fileCount };
    }

    // 使用 AI 过滤文件列表
    async _filterFilesWithAI(task, fileList) {
        logTaskEvent(`任务 ${task.id}: 尝试使用 AI 进行文件过滤...`);

        // 1. 构建中文过滤描述
        let filterDescription = '';
        const pattern = task.matchPattern; // 例如: "剧集", "文件名"
        const operator = task.matchOperator; // 例如: "lt", "gt", "eq", "contains", "not contains"
        const value = task.matchValue; // 例如: "8", "特效", "1080p"

        if (!pattern || !operator || !value) {
            logTaskEvent(`任务 ${task.id}: AI 过滤条件不完整，跳过 AI 过滤。`);
            return null; // 条件不完整，无法生成描述
        }

        let operatorText = '';
        switch (operator) {
            case 'gt': operatorText = '大于'; break;
            case 'lt': operatorText = '小于'; break;
            case 'eq': operatorText = '等于'; break;
            case 'contains': operatorText = '包含'; break;
            case 'not contains': operatorText = '不包含'; break;
            default:
                logTaskEvent(`任务 ${task.id}: 未知的过滤操作符 "${operator}"，跳过 AI 过滤。`);
                return null;
        }

        // 根据 pattern 生成更自然的描述
        filterDescription = `筛选出 ${pattern} ${operatorText} "${value}" 的文件。请根据文件名判断。`;
        logTaskEvent(`任务 ${task.id}: 生成 AI 过滤描述: "${filterDescription}"`);


        // 2. 准备给 AI 的文件列表 (仅含 id 和 name)
        const filesForAI = fileList.map(f => ({ id: f.id, name: f.name }));

        // 3. 调用 AI 服务
        try {
            const aiResponse = await AIService.filterMediaFiles(task.resourceName, filesForAI, filterDescription);

            if (aiResponse.success && Array.isArray(aiResponse.data)) {
                logTaskEvent(`任务 ${task.id}: AI 文件过滤成功，保留 ${aiResponse.data.length} 个文件。`);
                // 使用 AI 返回的 id 列表来过滤原始的完整文件列表
                const keptFileIds = new Set(aiResponse.data);
                // 先应用后缀过滤，再应用AI过滤结果
                const filteredList = fileList.filter(file => keptFileIds.has(file.id));
                return filteredList; 
            } else {
                logTaskEvent(`任务 ${task.id}: AI 文件过滤失败: ${aiResponse.error || '未知错误'}。`);
                return null;
            }
        } catch (error) {
            logTaskEvent(`任务 ${task.id}: 调用 AI 文件过滤时发生错误: ${error.message}`);
            console.error(`AI filter error for task ${task.id}:`, error);
            return null; 
        }
    }

    // 执行任务
    async processTask(task) {
        let saveResults = [];
        try {
            const account = await this.accountRepo.findOneBy({ id: task.accountId });
            if (!account) {
                logTaskEvent(`账号不存在，accountId: ${task.accountId}`);
                throw new Error('账号不存在');
            }
            task.account = account;
            const cloud189 = Cloud189Service.getInstance(account);
             // 获取分享文件列表并进行增量转存
             const shareDir = await cloud189.listShareDir(task.shareId, task.shareFolderId, task.shareMode,task.accessCode, task.isFolder);
             if(shareDir.res_code == "ShareAuditWaiting") {
                logTaskEvent("分享链接审核中, 等待下次执行")
                return ''
             }
             if (!shareDir?.fileListAO?.fileList) {
                logTaskEvent("获取文件列表失败: " + JSON.stringify(shareDir));
                throw new Error('获取文件列表失败');
            }
            let shareFiles = [...shareDir.fileListAO.fileList];            
            const folderFiles = await this.getAllFolderFiles(cloud189, task);
            const enableOnlySaveMedia = ConfigService.getConfigValue('task.enableOnlySaveMedia');
            // mediaSuffixs转为小写
            const mediaSuffixs = ConfigService.getConfigValue('task.mediaSuffix').split(';').map(suffix => suffix.toLowerCase())
            const { existingFiles, existingFileNames, existingMediaCount } = folderFiles.reduce((acc, file) => {
                if (!file.isFolder) {
                    acc.existingFiles.add(file.md5);
                    acc.existingFileNames.add(file.name);
                    if ((task.totalEpisodes == null || task.totalEpisodes <= 0) || this._checkFileSuffix(file, true, mediaSuffixs)) {
                        acc.existingMediaCount++;
                    }
                }
                return acc;
            }, { 
                existingFiles: new Set(), 
                existingFileNames: new Set(), 
                existingMediaCount: 0 
            });
            let aiFiltered = false;
            if (AIService.isEnabled() && task.matchPattern && task.matchOperator && task.matchValue) {
                const aiResult = await this._filterFilesWithAI(task, shareFiles)
                if (aiResult != null) {
                    shareFiles = aiResult;
                    aiFiltered = true;
                }
            }
            
            const newFiles = shareFiles
                .filter(file => 
                    !file.isFolder && !existingFiles.has(file.md5) 
                   && !existingFileNames.has(file.name)
                   && this._checkFileSuffix(file, enableOnlySaveMedia, mediaSuffixs)
                   && (aiFiltered || this._handleMatchMode(task, file))
                   && !this.isHarmonized(file)
                );

            // 处理新文件并保存到数据库和云盘
            if (newFiles.length > 0) {
                const { fileNameList, fileCount } = await this._handleNewFiles(task, newFiles, cloud189, mediaSuffixs);
                const resourceName = task.shareFolderName? `${task.resourceName}/${task.shareFolderName}` : task.resourceName;
                saveResults.push(`${resourceName}追更${fileCount}集: \n${fileNameList.join('\n')}`);
                const firstExecution = !task.lastFileUpdateTime;
                task.status = 'processing';
                task.lastFileUpdateTime = new Date();
                task.currentEpisodes = existingMediaCount + fileCount;
                task.retryCount = 0;
                this.eventService.emit('taskComplete', new TaskCompleteEventDto({
                    task,
                    cloud189,
                    fileList: newFiles,
                    overwriteStrm: false,
                    firstExecution: firstExecution
                }));
            } else if (task.lastFileUpdateTime) {
                // 检查是否超过3天没有新文件
                const now = new Date();
                const lastUpdate = new Date(task.lastFileUpdateTime);
                const daysDiff = (now.getTime() - lastUpdate.getTime()) / (1000 * 60 * 60 * 24);
                if (daysDiff >= ConfigService.getConfigValue('task.taskExpireDays')) {
                    task.status = 'completed';
                }
                task.currentEpisodes = existingMediaCount;
                logTaskEvent(`${task.resourceName} 没有增量剧集`)
            }
            // 检查是否达到总数
            if (task.totalEpisodes && task.currentEpisodes >= task.totalEpisodes) {
                task.status = 'completed';
                logTaskEvent(`${task.resourceName} 已完结`)
            }

            task.lastCheckTime = new Date();
            await this.taskRepo.save(task);
            return saveResults.join('\n');
        } catch (error) {
            return await this._handleTaskFailure(task, error);
        }
    }

    // 获取所有任务
    async getTasks() {
        return await this.taskRepo.find({
            order: {
                id: 'DESC'
            }
        });
    }

    // 获取待处理任务
    async getPendingTasks(ignore = false, taskIds = []) {
        const conditions = [
            {
                status: 'pending',
                nextRetryTime: null,
                ...(ignore ? {} : { enableCron: false })
            },
            {
                status: 'processing',
                ...(ignore ? {} : { enableCron: false })
            }
        ];
        return await this.taskRepo.find({
            relations: {
                account: true
            },
            select: {
                account: {
                    username: true,
                    localStrmPrefix: true,
                    cloudStrmPrefix: true,
                    embyPathReplace: true
                }
            },
            where: [
                ...(taskIds.length > 0 
                    ? [{ id: In(taskIds) }] 
                    : conditions)
            ]
        });
    }

    // 更新任务
    async updateTask(taskId, updates) {
        const task = await this.taskRepo.findOne({
            where: { id: taskId },
            relations: {
                account: true
            },
            select: {
                account: {
                    username: true,
                    localStrmPrefix: true,
                    cloudStrmPrefix: true,
                    embyPathReplace: true
                }
            }
        });
        if (!task) throw new Error('任务不存在');

        // 如果原realFolderName和现realFolderName不一致 则需要删除原strm
        if (updates.realFolderName && updates.realFolderName !== task.realFolderName && ConfigService.getConfigValue('strm.enable')) {
            // 删除原strm
            // 从realFolderName中获取文件夹名称
            const folderName = task.realFolderName.substring(task.realFolderName.indexOf('/') + 1);
            new StrmService().deleteDir(path.join(task.account.localStrmPrefix, folderName))
        }
        // 只允许更新特定字段
        const allowedFields = ['resourceName', 'realFolderId', 'currentEpisodes', 'totalEpisodes', 'status','realFolderName', 'shareFolderName', 'shareFolderId', 'matchPattern','matchOperator','matchValue','remark', 'enableCron', 'cronExpression', 'enableTaskScraper'];
        for (const field of allowedFields) {
            if (updates[field] !== undefined) {
                task[field] = updates[field];
            }
        }
        // 如果currentEpisodes和totalEpisodes为null 则设置为0
        if (task.currentEpisodes === null) {
            task.currentEpisodes = 0;
        }
        if (task.totalEpisodes === null) {
            task.totalEpisodes = 0;
        }
        
        // 验证状态值
        const validStatuses = ['pending', 'processing', 'completed', 'failed'];
        if (!validStatuses.includes(task.status)) {
            throw new Error('无效的状态值');
        }

        // 验证数值字段
        if (task.currentEpisodes !== null && task.currentEpisodes < 0) {
            throw new Error('更新数不能为负数');
        }
        if (task.totalEpisodes !== null && task.totalEpisodes < 0) {
            throw new Error('总数不能为负数');
        }
        if (task.matchPattern && !task.matchValue) {
            throw new Error('匹配模式需要提供匹配值');
        }
        const newTask = await this.taskRepo.save(task)
        SchedulerService.removeTaskJob(task.id)
        if (task.enableCron && task.cronExpression) {
            SchedulerService.saveTaskJob(newTask, this)
        }
        return newTask;
    }

    // 自动重命名
    async autoRename(cloud189, task) {
        if ((!task.sourceRegex || !task.targetRegex) && !AIService.isEnabled()) return [];
        let message = []
        let newFiles = [];
        let files = [];

        if (task.enableSystemProxy) {
            files = await this.proxyFileService.getFilesByTaskId(task.id);
        } else {
            const folderInfo = await cloud189.listFiles(task.realFolderId);
            if (!folderInfo || !folderInfo.fileListAO) return [];
            files = folderInfo.fileListAO.fileList;
        }
        if (!files || files.length === 0) return [];
        
        // 过滤掉文件夹
        files = files.filter(file => !file.isFolder);

        // 使用 AI 重命名或正则重命名
        if (AIService.isEnabled()) {
            logTaskEvent(` ${task.resourceName} 开始使用 AI 重命名`);
            try {
                const resourceInfo = await this._analyzeResourceInfo(
                    task.resourceName,
                    files.map(f => ({ id: f.id, name: f.name })),
                    'file'
                );
                await this._processRename(cloud189, task, files, resourceInfo, message, newFiles);
            } catch (error) {
                logTaskEvent('AI 重命名失败，使用正则表达式重命名: ' + error.message);
                await this._processRegexRename(cloud189, task, files, message, newFiles);
            }
        } else {
            logTaskEvent(` ${task.resourceName} 开始使用正则表达式重命名`);
            await this._processRegexRename(cloud189, task, files, message, newFiles);
        }

        // 处理消息和保存结果
        await this._handleRenameResults(task, message, newFiles);
        return newFiles;
    }


    // 处理重命名结果
    async _handleRenameResults(task, message, newFiles) {
        if (message.length > 0) {
            const lastMessage = message[message.length - 1];
            message[message.length - 1] = lastMessage.replace('├─', '└─');
        }
        if (task.enableSystemProxy && newFiles.length > 0) {
            await this.proxyFileService.batchUpdateFiles(newFiles);
        }
        // 修改省略号的显示格式
        if (message.length > 20) {
            message.splice(5, message.length - 10, '├─ ...');
        }
        message.length > 0 && logTaskEvent(`${task.resourceName}自动重命名完成: \n${message.join('\n')}`)
        message.length > 0 && this.messageUtil.sendMessage(`${task.resourceName}自动重命名: \n${message.join('\n')}`);
    }

    // 根据AI分析结果生成新文件名
    _generateFileName(file, aiFile, resourceInfo, template) {
        if (!aiFile) return file.name;
        
        // 构建文件名替换映射
        const replaceMap = {
            '{name}': aiFile.name || resourceInfo.name,
            '{year}': resourceInfo.year || '',
            '{s}': aiFile.season?.padStart(2, '0') || '01',
            '{e}': aiFile.episode?.padStart(2, '0') || '01',
            '{sn}': parseInt(aiFile.season) || '1',                    // 不补零的季数
            '{en}': parseInt(aiFile.episode) || '1',                   // 不补零的集数
            '{ext}': aiFile.extension || path.extname(file.name),
            '{se}': `S${aiFile.season?.padStart(2, '0') || '01'}E${aiFile.episode?.padStart(2, '0') || '01'}`
        };

        // 替换模板中的占位符
        let newName = template;
        for (const [key, value] of Object.entries(replaceMap)) {
            newName = newName.replace(new RegExp(key, 'g'), value);
        }
        // 清理文件名中的非法字符
        return this._sanitizeFileName(newName);
    }
    // 处理重命名过程
    async _processRename(cloud189, task, files, resourceInfo, message, newFiles) {
        const newNames = resourceInfo.episode;
        // 处理aiFilename, 文件命名通过配置文件的占位符获取
        // 获取用户配置的文件名模板，如果没有配置则使用默认模板
        const template = resourceInfo.type === 'movie' 
        ? '{name} ({year}){ext}'  // 电影模板
        : ConfigService.getConfigValue('openai.rename.template') || '{name} - {se}{ext}';  // 剧集模板
        for (const file of files) {
            try {
                const aiFile = newNames.find(f => f.id === file.id);
                if (!aiFile) {
                    newFiles.push(file);
                    continue;
                }
                const newName = this._generateFileName(file, aiFile, resourceInfo, template);
                // 判断文件名是否已存在
                if (file.name === newName) {
                    newFiles.push(file);
                    continue;   
                }
                await this._renameFile(cloud189, task, file, newName, message, newFiles);
            } catch (error) {
                logTaskEvent(`${file.name}重命名失败: ${error.message}`);
                newFiles.push(file);
            }
        }
    }

    // 清理文件名中的非法字符
    _sanitizeFileName(fileName) {
        // 移除文件名中的非法字符
        return fileName.replace(/[<>:"/\\|?*]/g, '')
            .replace(/\s+/g, ' ')  // 合并多个空格
            .trim();
    }
    // 处理正则表达式重命名
    async _processRegexRename(cloud189, task, files, message, newFiles) {
        if (!task.sourceRegex || !task.targetRegex) return [];
        for (const file of files) {
            try {
                const destFileName = file.name.replace(new RegExp(task.sourceRegex), task.targetRegex);
                if (destFileName === file.name) {
                    newFiles.push(file);
                    continue;
                }
                await this._renameFile(cloud189, task, file, destFileName, message, newFiles);
            } catch (error) {
                logTaskEvent(`${file.name}重命名失败: ${error.message}`);
                newFiles.push(file);
            }
        }
    }

    // 执行单个文件重命名
    async _renameFile(cloud189, task, file, newName, message, newFiles) {
        let renameResult;
        if (task.enableSystemProxy) {
            renameResult = { id: file.id, name: newName };
        } else {
            renameResult = await cloud189.renameFile(file.id, newName);
        }

        if (!task.enableSystemProxy && (!renameResult || renameResult.res_code != 0)) {
            // message.push(`├─ ${file.name} → ${newName}失败, 原因:${newName}${renameResult?.res_msg}`);
            newFiles.push(file);
        } else {
            message.push(`├─ ${file.name} → ${newName}`);
            newFiles.push({
                ...file,
                name: newName
            });
        }
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    // 检查任务状态
    async checkTaskStatus(cloud189, taskId, count = 0, batchTaskDto) {
        if (count > 5) {
             return false;
        }
        let type = batchTaskDto.type || 'SHARE_SAVE';
        // 轮询任务状态
        const task = await cloud189.checkTaskStatus(taskId, batchTaskDto)
        if (!task) {
            return false;
        }
        logTaskEvent(`任务编号: ${task.taskId}, 任务状态: ${task.taskStatus}`)
        if (task.taskStatus == 3 || task.taskStatus == 1) {
            // 暂停200毫秒
            await new Promise(resolve => setTimeout(resolve, 200));
            return await this.checkTaskStatus(cloud189,taskId, count++, batchTaskDto)
        }
        if (task.taskStatus == 4) {
            // 如果failedCount > 0 说明有失败或者被和谐的文件, 需要查一次文件列表
            if (task.failedCount > 0 && type == 'SHARE_SAVE') {
                const targetFolderId = batchTaskDto.targetFolderId;
                const fileList = await this.getAllFolderFiles(cloud189, {
                    enableSystemProxy: false,
                    realFolderId: targetFolderId
                });
                //  当前转存的文件列表为taskInfos 需反序列化
                const taskInfos = JSON.parse(batchTaskDto.taskInfos);
                // fileList和taskInfos进行对比 拿到不在fileList中的文件
                const conflictFiles = taskInfos.filter(taskInfo => {
                    return !fileList.some(file => file.md5 === taskInfo.md5);
                });
                if (conflictFiles.length > 0) {
                    // 打印日志
                    logTaskEvent(`任务编号: ${task.taskId}, 任务状态: ${task.taskStatus}, 有${conflictFiles.length}个文件冲突, 已忽略: ${conflictFiles.map(file => file.fileName).join(',')}`);
                    // 加入和谐文件中
                    harmonizedFilter.addHarmonizedList(conflictFiles.map(file => file.md5))
                }
            }
            return true;
        }
        // 如果status == 2 说明有冲突
        if (task.taskStatus == 2) {
            const conflictTaskInfo = await cloud189.getConflictTaskInfo(taskId);
            if (!conflictTaskInfo) {
                return false
            }
            // 忽略冲突
            const taskInfos = conflictTaskInfo.taskInfos;
            for (const taskInfo of taskInfos) {
                taskInfo.dealWay = 1;
            }
            await cloud189.manageBatchTask(taskId, conflictTaskInfo.targetFolderId, taskInfos);
            await new Promise(resolve => setTimeout(resolve, 200));
            return await this.checkTaskStatus(cloud189, taskId, count++, batchTaskDto)
        }
        return false;
    }

    // 执行所有任务
    async processAllTasks(ignore = false, taskIds = []) {
        const tasks = await this.getPendingTasks(ignore, taskIds);
        if (tasks.length === 0) {
            logTaskEvent('没有待处理的任务');
            return;
        }
        let saveResults = []
        logTaskEvent(`================================`);
        for (const task of tasks) {
            const taskName = task.shareFolderName?(task.resourceName + '/' + task.shareFolderName): task.resourceName || '未知'
            logTaskEvent(`任务[${taskName}]开始执行`);
            try {
                const result = await this.processTask(task);
            if (result) {
                saveResults.push(result)
            }
            } catch (error) {
                logTaskEvent(`任务${task.id}执行失败: ${error.message}`);
            }finally {
                logTaskEvent(`任务[${taskName}]执行完成`);
            }
            // 暂停500ms
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        if (saveResults.length > 0) {
            this.messageUtil.sendMessage(saveResults.join("\n\n"))
        }
        logTaskEvent(`================================`);
        return saveResults
    }
    // 处理匹配模式
    _handleMatchMode(task, file) {
        if (!task.matchPattern || !task.matchValue) {
            return true;
        } 
        const matchPattern = task.matchPattern;
        const matchOperator = task.matchOperator; // lt eq gt
        const matchValue = task.matchValue;
        const regex = new RegExp(matchPattern);
        // 根据正则表达式提取文件名中匹配上的值 然后根据matchOperator判断是否匹配
        const match = file.name.match(regex);
        if (match) {
            const matchResult = match[0];
            const values = this._handleMatchValue(matchOperator, matchResult, matchValue);
            if (matchOperator === 'lt' && values[0] < values[1]) {
                return true;
            }
            if (matchOperator === 'eq' && values[0] === values[1]) {
                return true;
            }
            if (matchOperator === 'gt' && values[0] > values[1]) {
                return true;
            }
            if (matchOperator === 'contains' && matchResult.includes(matchValue)) {
                return true;
            }
            if (matchOperator === 'notContains' && !matchResult.includes(matchValue)) {
                return true;
            }
        }
        return false;
    }

    // 根据matchOperator判断值是否要转换为数字
    _handleMatchValue(matchOperator, matchResult, matchValue) {    
        if (matchOperator === 'lt' || matchOperator === 'gt') {
            return [parseFloat(matchResult), parseFloat(matchValue)];
        }
        return [matchResult, matchValue];
    }

    // 任务失败处理逻辑
    async _handleTaskFailure(task, error) {
        logTaskEvent(error);
        const maxRetries = ConfigService.getConfigValue('task.maxRetries');
        const retryInterval = ConfigService.getConfigValue('task.retryInterval');
        // 初始化重试次数
        if (!task.retryCount) {
            task.retryCount = 0;
        }
        
        if (task.retryCount < maxRetries) {
            task.retryCount++;
            task.status = 'pending';
            task.lastError = `${error.message} (重试 ${task.retryCount}/${maxRetries})`;
            // 设置下次重试时间
            task.nextRetryTime = new Date(Date.now() + retryInterval * 1000);
            logTaskEvent(`任务将在 ${retryInterval} 秒后重试 (${task.retryCount}/${maxRetries})`);
        } else {
            task.status = 'failed';
            task.lastError = `${error.message} (已达到最大重试次数 ${maxRetries})`;
            logTaskEvent(`任务达到最大重试次数 ${maxRetries}，标记为失败`);
        }
        
        await this.taskRepo.save(task);
        return '';
    }

     // 获取需要重试的任务
     async getRetryTasks() {
        const now = new Date();
        return await this.taskRepo.find({
            relations: {
                account: true
            },
            select: {
                account: {
                    username: true,
                    localStrmPrefix: true,
                    cloudStrmPrefix: true,
                    embyPathReplace: true
                }
            },
            where: {
                status: 'pending',
                nextRetryTime: LessThan(now),
                retryCount: LessThan(ConfigService.getConfigValue('task.maxRetries'))
            }
        });
    }

    // 处理重试任务
    async processRetryTasks() {
        const retryTasks = await this.getRetryTasks();
        if (retryTasks.length === 0) {
            return [];
        }
        let saveResults = [];
        logTaskEvent(`================================`);
        for (const task of retryTasks) {
            const taskName = task.shareFolderName?(task.resourceName + '/' + task.shareFolderName): task.resourceName || '未知'
            logTaskEvent(`任务[${taskName}]开始重试`);
            try {
                const result = await this.processTask(task);
                if (result) {
                    saveResults.push(result);
                }
            } catch (error) {
                console.error(`重试任务${task.name}执行失败:`, error);
            }finally {
                logTaskEvent(`任务[${taskName}]重试完成`);
            }
            // 任务间隔
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        if (saveResults.length > 0) {
            this.messageUtil.sendMessage(saveResults.join("\n\n"));
        }
        logTaskEvent(`================================`);
        return saveResults;
    }
    // 创建批量任务
    async createBatchTask(cloud189, batchTaskDto) {
        const resp = await cloud189.createBatchTask(batchTaskDto);
        if (!resp) {
            throw new Error('批量任务处理失败');
        }
        if (resp.res_code != 0) {
            throw new Error(resp.res_msg);
        }
        logTaskEvent(`批量任务处理中: ${JSON.stringify(resp)}`)
        if (!await this.checkTaskStatus(cloud189,resp.taskId, 0 , batchTaskDto)) {
            throw new Error('检查批量任务状态: 批量任务处理失败');
        }
        logTaskEvent(`批量任务处理完成`)
    }
    // 定时清空回收站
    async clearRecycleBin(enableAutoClearRecycle, enableAutoClearFamilyRecycle) {
        const accounts = await this.accountRepo.find()
        if (accounts) {
            for (const account of accounts) {
                let username = account.username.replace(/(.{3}).*(.{4})/, '$1****$2');
                try {
                    const cloud189 = Cloud189Service.getInstance(account); 
                    await this._clearRecycleBin(cloud189, username, enableAutoClearRecycle, enableAutoClearFamilyRecycle)
                } catch (error) {
                    logTaskEvent(`定时[${username}]清空回收站任务执行失败:${error.message}`);
                }
            }
        }
    }

    // 执行清空回收站
    async _clearRecycleBin(cloud189, username, enableAutoClearRecycle, enableAutoClearFamilyRecycle) {
        const params = {
            taskInfos: '[]',
            type: 'EMPTY_RECYCLE',
        }   
        const batchTaskDto = new BatchTaskDto(params);
        if (enableAutoClearRecycle) {
            logTaskEvent(`开始清空[${username}]个人回收站`)
            await this.createBatchTask(cloud189, batchTaskDto)
            logTaskEvent(`清空[${username}]个人回收站完成`)
            // 延迟10秒
            await new Promise(resolve => setTimeout(resolve, 10000));
        }
        if (enableAutoClearFamilyRecycle) {
            // 获取家庭id
            const familyInfo = await cloud189.getFamilyInfo()
            if (familyInfo == null) {
                logTaskEvent(`用户${username}没有家庭主账号, 跳过`)
                return
            }
            logTaskEvent(`开始清空[${username}]家庭回收站`)
            batchTaskDto.familyId = familyInfo.familyId
            await this.createBatchTask(cloud189, batchTaskDto)
            logTaskEvent(`清空[${username}]家庭回收站完成`)
        }
    }
    // 校验文件后缀
    _checkFileSuffix(file,enableOnlySaveMedia, mediaSuffixs) {
        // 获取文件后缀
        const fileExt = '.' + file.name.split('.').pop().toLowerCase();
        const isMedia = mediaSuffixs.includes(fileExt)
        // 如果启用了只保存媒体文件, 则检查文件后缀是否在配置中
        if (enableOnlySaveMedia && !isMedia) {
            return false
        }
        return true
    }
    // 根据realRootFolderId获取根目录
    async getRootFolder(task) {
        if (task.realRootFolderId) {
            // 判断realRootFolderId下是否还有其他目录, 通过任务查询 查询realRootFolderId是否有多个任务, 如果存在多个 则使用realFolderId
            const tasks = await this.taskRepo.find({
                where: {
                    realRootFolderId: task.realRootFolderId
                }
            })
            if (tasks.length > 1) {
                return {id: task.realFolderId, name: task.realFolderName}    
            }
            return {id: task.realRootFolderId, name: task.shareFolderName}
        }
        logTaskEvent(`任务[${task.resourceName}]为老版本系统创建, 无法删除网盘内容, 跳过`)
        return null
    }
    // 删除网盘文件
    async deleteCloudFile(cloud189, file, isFolder) {
        if (!file) return;
        const taskInfos = []
        // 如果file是数组, 则遍历删除
        if (Array.isArray(file)) {
            for (const f of file) {
                taskInfos.push({
                    fileId: f.id,
                    fileName: f.name,
                    isFolder: isFolder
                })
            }
        }else{
            taskInfos.push({
                fileId: file.id,
                fileName: file.name,
                isFolder: isFolder
            })
        }
        console.log(taskInfos)
        
        const batchTaskDto = new BatchTaskDto({
            taskInfos: JSON.stringify(taskInfos),
            type: 'DELETE',
            targetFolderId: ''
        });
        await this.createBatchTask(cloud189, batchTaskDto)
    }

    // 根据任务创建STRM文件
    async createStrmFileByTask(taskIds, overwrite) {
        const tasks = await this.taskRepo.find({
            where: {
                id: In(taskIds)
            },
            relations: {
                account: true
            },
            select: {
                account: {
                    username: true,
                    localStrmPrefix: true,
                    cloudStrmPrefix: true,
                    embyPathReplace: true
                }
            },
        })
        if (tasks.length == 0) {
            throw new Error('任务不存在')
        }
        for (const task of tasks) {
            try {
                await this._createStrmFileByTask(task, overwrite)   
            }catch (error) {
                logTaskEvent(`任务[${task.resourceName}]生成strm失败: ${error.message}`)
            }
        }
    }
    // 根据任务执行生成strm
    async _createStrmFileByTask(task, overwrite) {
        if (!task) {
            throw new Error('任务不存在')
        }
        let account = await this._getAccountById(task.accountId)
        if (!account) {
            logTaskEvent(`任务[${task.resourceName}]账号不存在, 跳过`)
            return
        }
        const cloud189 = Cloud189Service.getInstance(account);
        // 获取文件列表
        const fileList = await this.getAllFolderFiles(cloud189, task)
        if (fileList.length == 0) {
            throw new Error('文件列表为空')
        }
        const strmService = new StrmService()
        const message = await strmService.generate(task, fileList, overwrite);
        this.messageUtil.sendMessage(message);
    }
    // 根据accountId获取账号
    async _getAccountById(accountId) {
        return await this.accountRepo.findOne({
            where: {
                id: accountId
            }
        })
    }

    // 根据分享链接获取文件目录组合 资源名 资源名/子目录1 资源名/子目录2
    async parseShareFolderByShareLink(shareLink, accountId, accessCode) {
        const account = await this._getAccountById(accountId)
        if (!account) {
            throw new Error('账号不存在')
        }
        const cloud189 = Cloud189Service.getInstance(account);
        const shareCode = cloud189Utils.parseShareCode(shareLink)
        const shareInfo = await this.getShareInfo(cloud189, shareCode)
        if (shareInfo.shareMode == 1) {
            if (!accessCode) {
                throw new Error('分享链接为私密链接, 请输入提取码')
            }
            // 校验访问码是否有效
            const accessCodeResponse = await cloud189.checkAccessCode(shareCode, accessCode);
            if (!accessCodeResponse) {
                throw new Error('校验访问码失败');
            }
            if (!accessCodeResponse.shareId) {
                throw new Error('访问码无效');
            }
            shareInfo.shareId = accessCodeResponse.shareId;
        }
        const folders = []
        // 根目录为分享链接的名称
        folders.push({id: -1 ,name: shareInfo.fileName})
        if (!shareInfo.isFolder) {
            return folders;
        }
        // 遍历分享链接的目录
        const result = await cloud189.listShareDir(shareInfo.shareId, shareInfo.fileId, shareInfo.shareMode, accessCode);
        if (!result?.fileListAO) return folders;
        const { folderList: subFolders = [] } = result.fileListAO;
        subFolders.forEach(folder => {
            folders.push({id: folder.id, name: path.join(shareInfo.fileName, folder.name)});
        });
        return folders;
    }

    // 校验目录是否在目录列表中
    checkFolderInList(taskDto, folderId) {
        return (!taskDto.selectedFolders || taskDto.selectedFolders.length === 0) || taskDto.tgbot || (taskDto.selectedFolders?.includes(folderId) || false);
    }

    // 校验云盘中是否存在同名目录
    async checkFolderExists(cloud189, targetFolderId, folderName, overwriteFolder = false) {
        const folderInfo = await cloud189.listFiles(targetFolderId);
        if (!folderInfo) {
            throw new Error('获取文件列表失败');
        }

        // 检查目标文件夹是否存在
        const { folderList = [] } = folderInfo.fileListAO;
        const existFolder = folderList.find(folder => folder.name === folderName);
        if (existFolder) {
            if (!overwriteFolder) {
                throw new Error('folder already exists');
            }
            // 如果用户需要覆盖, 则删除目标目录
            await this.deleteCloudFile(cloud189, existFolder, 1)
        }
    }

    // 根据id获取任务
    async getTaskById(id) {
        return await this.taskRepo.findOne({
            where: { id: parseInt(id) },
            relations: {
                account: true
            },
            select: {
                account: {
                    username: true,
                    localStrmPrefix: true,
                    cloudStrmPrefix: true,
                    embyPathReplace: true
                }
            }
        });
    }
    // ai命名处理
    async handleAiRename(files, resourceInfo) {
        const template = resourceInfo.type === 'movie' 
        ? '{name} ({year}){ext}'  // 电影模板
        : ConfigService.getConfigValue('openai.rename.template') || '{name} - {se}{ext}';  // 剧集模板
        const aiNames = resourceInfo.episode
        const newFiles = [];
        for (const file of files) {
            try {
                const aiFile = aiNames.find(f => f.id === file.id);
                if (!aiFile) {
                    continue;
                }
                const newName = this._generateFileName(file, aiFile, resourceInfo, template);
                // 判断文件名是否已存在
                if (file.name === newName) {
                    continue;   
                }
                newFiles.push({
                    ...file,
                    fileId: file.id,
                    oldName: file.name,
                    destFileName: newName
                });
            } catch (error) {
                logTaskEvent(`${file.name}AI重命名处理失败: ${error.message}`);
            }
        }
        return newFiles;
    }
    // 根据布隆过滤器判断是否被和谐
    isHarmonized(file) {
        // 检查资源是否被和谐
        if (harmonizedFilter.isHarmonized(file.md5)) {
            logTaskEvent(`文件 ${file.name} 被和谐`);
            return true;
        }    
        return false
    }

    // 根据文件id批量删除文件
    async deleteFiles(taskId, files) {
        const task = await this.getTaskById(taskId)
        if (!task) {
            throw new Error('任务不存在')
        }
        const strmService = new StrmService()
        const folderName = task.realFolderName.substring(task.realFolderName.indexOf('/') + 1);
        let strmList = []
        strmList = files.map(file => path.join(folderName, file.name));
        // 判断是否启用了系统代理
        if (task.enableSystemProxy) {
            // 代理文件
            await this.proxyFileService.batchDeleteFilesById(files.map(file => file.id));
        }else{
            // 删除网盘文件
            const cloud189 = Cloud189Service.getInstance(task.account);
            await this.deleteCloudFile(cloud189,files, 0);
        }
        for (const strm of strmList) {
            // 删除strm文件
            await strmService.delete(path.join(task.account.localStrmPrefix, strm));
        }

    }
}

module.exports = { TaskService };