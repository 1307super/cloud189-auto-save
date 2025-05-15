// 全局变量，用于存储当前正在编辑的推送配置的索引，null表示新增
let editingCustomPushIndex = null;

async function getCustomPushConfigs() {
    if (customPushConfigs) {
        return JSON.parse(JSON.stringify(customPushConfigs)); // 返回深拷贝副本
    }
    return []; // 如果未定义，则返回空数组
}

async function saveCustomPushConfigsToBackend(configs) {
    // 模拟保存到后端
    console.log("Saving custom push configs:", configs);
    if (customPushConfigs) {
        customPushConfigs = configs;
    }
    await saveSettings()
}


// --- Modal Control ---
function openCustomPushManagementModal() {
    renderCustomPushTable();
    document.getElementById('customPushManagementModal').style.display = 'block';
}

function closeCustomPushManagementModal() {
    document.getElementById('customPushManagementModal').style.display = 'none';
}

function openAddEditCustomPushModal(index = null) {
    editingCustomPushIndex = index;
    const form = document.getElementById('addEditCustomPushForm');
    form.reset(); // 重置表单
    document.getElementById('customPushFieldsContainer').innerHTML = ''; // 清空动态字段

    const modalTitle = document.getElementById('addEditCustomPushModalTitle');
    if (index === null) {
        modalTitle.textContent = '添加自定义推送';
        document.getElementById('customPushEnabled').checked = true; // 新增时默认启用
    } else {
        modalTitle.textContent = '编辑自定义推送';
        const config = customPushConfigs[index];
        if (config) {
            document.getElementById('customPushName').value = config.name || '';
            document.getElementById('customPushDescription').value = config.description || '';
            document.getElementById('customPushUrl').value = config.url || '';
            document.getElementById('customPushMethod').value = config.method || 'POST';
            document.getElementById('customPushContentType').value = config.contentType || 'application/json';
            document.getElementById('customPushEnabled').checked = config.enabled === true;

            if (config.fields && Array.isArray(config.fields)) {
                config.fields.forEach(field => addCustomPushFieldRow(field));
            }
        }
    }
    document.getElementById('addEditCustomPushModal').style.display = 'block';
}

function closeAddEditCustomPushModal() {
    document.getElementById('addEditCustomPushModal').style.display = 'none';
    editingCustomPushIndex = null;
}

// --- Table Rendering ---
async function renderCustomPushTable() {
    const configs = await getCustomPushConfigs();
    const tbody = document.getElementById('customPushTable').querySelector('tbody');
    tbody.innerHTML = ''; // 清空现有行

    if (!configs || configs.length === 0) {
        const tr = tbody.insertRow();
        const td = tr.insertCell();
        td.colSpan = 4;
        td.textContent = '暂无自定义推送配置。';
        td.style.textAlign = 'center';
        return;
    }

    configs.forEach((config, index) => {
        const tr = tbody.insertRow();
        tr.insertCell().textContent = config.name || 'N/A';
        tr.insertCell().textContent = config.description || 'N/A';

        // 启用开关
        const enabledCell = tr.insertCell();
        const label = document.createElement('label');
        label.className = 'switch';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = config.enabled === true;
        checkbox.onchange = () => toggleCustomPushEnable(index);
        const slider = document.createElement('span');
        slider.className = 'slider round';
        label.appendChild(checkbox);
        label.appendChild(slider);
        enabledCell.appendChild(label);

        // 操作按钮
        const actionsCell = tr.insertCell();
        const editButton = document.createElement('button');
        editButton.textContent = '编辑';
        editButton.className = 'btn-small';
        editButton.onclick = () => openAddEditCustomPushModal(index);
        actionsCell.appendChild(editButton);

        const deleteButton = document.createElement('button');
        deleteButton.textContent = '删除';
        deleteButton.className = 'btn-small btn-danger';
        deleteButton.style.marginLeft = '5px';
        deleteButton.onclick = () => deleteCustomPushConfig(index);
        actionsCell.appendChild(deleteButton);
    });
}

// --- Form Field Management ---
function addCustomPushFieldRow(field = { type: 'string', key: '', value: '' }) {
    const container = document.getElementById('customPushFieldsContainer');
    const fieldRow = document.createElement('div');
    fieldRow.className = 'custom-push-field-row form-group';
    fieldRow.style.display = 'flex';
    fieldRow.style.gap = '10px';
    fieldRow.style.alignItems = 'center';
    fieldRow.style.marginBottom = '10px';

    const typeSelect = document.createElement('select');
    typeSelect.className = 'custom-push-field-type';
    const fieldTypes = [
        { display: '普通字段', value: 'string' },
        { display: 'JSON', value: 'json' },
        { display: '请求头', value: 'header' }
    ];
    fieldTypes.forEach(fieldType => {
        const option = document.createElement('option');
        option.value = fieldType.value; // 使用英文值作为 option 的 value
        option.textContent = fieldType.display; // 使用中文作为 option 的显示文本
        if (fieldType.value === field.type) { // 比较时使用 fieldType.value
            option.selected = true;
        }
        typeSelect.appendChild(option);
    });
    typeSelect.style.flex = '1'; // 平均分配宽度

    const keyInput = document.createElement('input');
    keyInput.type = 'text';
    keyInput.className = 'custom-push-field-key';
    keyInput.placeholder = '字段名';
    keyInput.value = field.key || '';
    keyInput.style.flex = '1'; // 平均分配宽度

    const valueInput = document.createElement('input');
    valueInput.type = 'text';
    valueInput.className = 'custom-push-field-value';
    valueInput.placeholder = '字段值';
    valueInput.value = field.value || '';
    valueInput.style.flex = '1'; // 平均分配宽度
    
    const valueTextarea = document.createElement('textarea');
    valueTextarea.className = 'custom-push-field-value';
    valueTextarea.placeholder = '字段值';
    valueTextarea.value = field.value || '';
    valueTextarea.style.flex = '1'; // 平均分配宽度
    valueTextarea.rows = 3;

    if (field.type === 'json') {
        valueInput.style.display = 'none';
    } else {
        valueTextarea.style.display = 'none';
    }

    typeSelect.onchange = () => {
        if (typeSelect.value === 'json') {
            valueInput.style.display = 'none';
            valueTextarea.style.display = 'block';
            try {
                const currentVal = JSON.parse(valueInput.value);
                valueTextarea.value = JSON.stringify(currentVal, null, 2);
            } catch (e) {
                valueTextarea.value = valueInput.value; 
            }
        } else {
            valueInput.style.display = 'block';
            valueTextarea.style.display = 'none';
            valueInput.value = valueTextarea.value; 
        }
    };


    const deleteIcon = document.createElement('span'); // 改为 span 元素
    deleteIcon.innerHTML = '&ndash;'; // 使用 en-dash 作为图标
    deleteIcon.title = '删除此字段';
    deleteIcon.style.cursor = 'pointer'; // 鼠标悬停时显示手型光标
    deleteIcon.style.fontSize = '20px'; // 稍微放大一点，使其更易点击
    deleteIcon.style.padding = '0 5px'; // 给一点内边距
    deleteIcon.style.lineHeight = '1'; // 调整行高以更好地垂直对齐
    deleteIcon.style.userSelect = 'none'; // 防止文本被选中

    deleteIcon.onclick = () => fieldRow.remove();

    fieldRow.appendChild(typeSelect);
    fieldRow.appendChild(keyInput);
    fieldRow.appendChild(valueInput);
    fieldRow.appendChild(valueTextarea);
    fieldRow.appendChild(deleteIcon); // 添加新的删除图标
    container.appendChild(fieldRow);
}

function getCustomPushConfigFromForm() {
    const config = {
        name: document.getElementById('customPushName').value.trim(),
        description: document.getElementById('customPushDescription').value.trim(),
        url: document.getElementById('customPushUrl').value.trim(),
        method: document.getElementById('customPushMethod').value,
        contentType: document.getElementById('customPushContentType').value,
        enabled: document.getElementById('customPushEnabled').checked,
        fields: []
    };

    if (!config.name || !config.url) {
        message.warning('名称和URL不能为空。');
        throw new Error('名称和URL不能为空。');
    }

    const fieldRows = document.getElementById('customPushFieldsContainer').querySelectorAll('.custom-push-field-row');
    for (const row of fieldRows) {
        const type = row.querySelector('.custom-push-field-type').value;
        const key = row.querySelector('.custom-push-field-key').value.trim();
        let value;

        if (type === 'json') {
            value = row.querySelector('textarea.custom-push-field-value').value.trim();
            try {
                JSON.parse(value); // Validate JSON format
            } catch (e) {
                message.warning(`字段 "${key || '(未命名JSON字段)'}" 的JSON值格式无效: ${e.message}`);
                throw new Error(`字段 "${key || '(未命名JSON字段)'}" 的JSON值格式无效: ${e.message}`);
            }
        } else {
            value = row.querySelector('input.custom-push-field-value').value.trim();
        }

        if ((type === 'string' || type === 'header') && !key) {
            message.warning(`类型为 "${type}" 的字段必须填写字段名。`);
            throw new Error(`类型为 "${type}" 的字段必须填写字段名。`);
        }
        config.fields.push({ type, key, value });
    }
    const fieldKeys = new Set();
    let jsonBodyFieldSet = false;
    for (const field of config.fields) {
        if (field.key) { // Only check non-empty keys for duplicates
            if (fieldKeys.has(field.key)) {
                message.warning(`字段名 "${field.key}" 在当前配置中重复。`);
                throw new Error(`字段名 "${field.key}" 在当前配置中重复。`);
            }
            fieldKeys.add(field.key);
        }
        if (field === 'json') {
            if (jsonBodyFieldSet) {
                message.warning('检测到多个 "JSON" 类型的字段。请保留一个');
                throw new Error(`检测到多个 "JSON" 类型的字段。请保留一个`);
            }
            jsonBodyFieldSet = true;
        }
    }
    return config;
}

async function saveCustomPushConfig(event) {
    event.preventDefault();
    let newConfigData;
    try {
        newConfigData = getCustomPushConfigFromForm();
    } catch (error) {
        // Error message already shown by getCustomPushConfigFromForm
        console.error("Error getting config from form for saving:", error.message);
        return; // Stop execution if form data is invalid
    }

    const configs = await getCustomPushConfigs();

    if (editingCustomPushIndex === null) {
        configs.push(newConfigData); // 添加新配置
    } else {
        configs[editingCustomPushIndex] = newConfigData; // 更新现有配置
    }

    try {
        await saveCustomPushConfigsToBackend(configs);
        closeAddEditCustomPushModal();
        renderCustomPushTable();
    } catch (error) {
        console.error("保存自定义推送配置失败:", error);
    }
}

async function deleteCustomPushConfig(index) {
    if (!confirm('确定要删除此自定义推送配置吗？')) {
        return;
    }
    const configs = await getCustomPushConfigs();
    configs.splice(index, 1);
    await saveCustomPushConfigsToBackend(configs);
    renderCustomPushTable();
}

async function toggleCustomPushEnable(index) {
    const configs = await getCustomPushConfigs();
    if (configs[index]) {
        configs[index].enabled = !configs[index].enabled;
        await saveCustomPushConfigsToBackend(configs);
        // renderCustomPushTable(); // 可选：如果状态很多，重新渲染；如果只是开关，可以不重渲染
        message.success(`推送 "${configs[index].name}" 已${configs[index].enabled ? '启用' : '禁用'}`);
    }
}

async function testCustomPushConfig() {
    let configToTest;
    try {
        configToTest = getCustomPushConfigFromForm();
    } catch (error) {
        // Error message already shown by getCustomPushConfigFromForm
        console.error("Error getting config from form for testing:", error.message);
        return; // Stop execution if form data is invalid
    }
    const testButton = document.getElementById('testCustomPushBtn');
    const originalButtonText = testButton.textContent;
    testButton.textContent = '测试中...';
    testButton.disabled = true;
    console.log(configToTest)
    try {
        const response = await fetch('/api/custom-push/test', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(configToTest)
        });
        const result = await response.json();

        if (result.success) {
            message.success(`测试推送成功: ${result.message || '目标服务器已响应'}`);
            console.log("目标服务器响应详情:", result.targetResponse);
            alert(`测试成功！`);
        } else {
            message.error(`测试推送失败: ${result.message || result.errorDetails || '未知错误'}`);
        }
    } catch (error) {
        message.error(`测试推送API调用失败: ${error.message}`);
        console.error("测试推送API调用错误:", error);
        alert(`测试API调用出错: ${error.message}`);
    } finally {
        testButton.textContent = originalButtonText;
        testButton.disabled = false;
    }
}

