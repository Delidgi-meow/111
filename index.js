/**
 * Chronicle — Хроники Мира
 * Точка входа: хуки ST, инициализация drawer, связывание модулей.
 *
 * Автор: kissa
 * Версия: 0.1.0
 */

import { renderExtensionTemplateAsync, getContext, extension_settings } from '/scripts/extensions.js';
import { saveSettingsDebounced, eventSource, event_types } from '/script.js';

import { parseMessage, getRegexRules, hasChronicleData } from './core/tagParser.js';
import { stateManager, createEmptyState } from './core/stateManager.js';
import { buildContextPrompt, getSystemPrompt, collectOOCPrompts } from './core/promptBuilder.js';
import { simsEngine, STAT_CONFIG, STAT_KEYS } from './systems/sims.js';

// ============================================
// Константы (auto-detect folder from import.meta.url)
// ============================================

const EXT_NAME = 'chronicle';
const VERSION = '0.1.0';

// Авто-определение пути расширения из URL текущего модуля
// import.meta.url = "http://127.0.0.1:8000/scripts/extensions/third-party/FOLDER_NAME/index.js"
// Нужно извлечь "third-party/FOLDER_NAME"
const _scriptUrl = import.meta.url;
const _extMatch = _scriptUrl.match(/\/scripts\/extensions\/(third-party\/[^/]+)\//);
const EXT_FOLDER = _extMatch ? _extMatch[1] : 'third-party/SillyTavern-Chronicle';
const TEMPLATE_PATH = `${EXT_FOLDER}/assets/templates`;

console.log(`[Chronicle] Detected extension folder: ${EXT_FOLDER}`);

// ============================================
// Настройки по умолчанию
// ============================================

const DEFAULT_SETTINGS = {
    enabled: true,
    autoParse: true,
    injectContext: true,
    showMessagePanel: true,
    contextDepth: 15,
    injectionPosition: 1,

    // Модули — что отправлять AI
    sendWorld: true,
    sendCostumes: true,
    sendSims: true,
    sendHealth: true,
    sendCycle: true,
    sendItems: true,
    sendWallet: true,
    sendNpcs: true,
    sendAffection: true,
    sendCalendar: true,
    sendDiary: false,       // Дневник по умолчанию НЕ инъектируется (только для чтения)

    // Промпты
    customSystemPrompt: '',

    // Внешний вид
    themeMode: 'dark',
    customCSS: '',
    customThemes: [],

    // Панель
    panelWidth: 100,
    panelOffset: 0,
    showTopIcon: true,

    // Вектора
    vectorEnabled: false,
    vectorModel: 'Xenova/multilingual-e5-small',

    // Авто-конспект
    autoSummaryEnabled: false,
    autoSummaryKeepRecent: 10,
};

// ============================================
// Глобальное состояние
// ============================================

let settings = {};
let isInitialized = false;
let lastState = createEmptyState();
let pendingOOC = [];

// ============================================
// Настройки
// ============================================

function loadSettings() {
    if (!extension_settings[EXT_NAME]) {
        extension_settings[EXT_NAME] = {};
    }
    settings = Object.assign({}, DEFAULT_SETTINGS, extension_settings[EXT_NAME]);
    extension_settings[EXT_NAME] = settings;
}

function saveSettings() {
    extension_settings[EXT_NAME] = settings;
    saveSettingsDebounced();
}

// ============================================
// Regex Rules — автоинъекция в ST
// ============================================

function ensureRegexRules() {
    try {
        // ST хранит regex rules в разных местах в зависимости от версии
        const context = getContext();
        const regexScripts = extension_settings?.regex_extension?.scripts
            || context?.extensionSettings?.regex
            || null;
        
        if (!regexScripts || !Array.isArray(regexScripts)) {
            console.log('[Chronicle] Regex system not found, skipping auto-rules. Add regex rules manually if needed.');
            return;
        }
        
        const existingIds = regexScripts.map(r => r.id || r.scriptName);
        const rules = getRegexRules();
        
        for (const rule of rules) {
            if (!existingIds.includes(rule.id) && !existingIds.includes(rule.scriptName)) {
                regexScripts.push(rule);
                console.log(`[Chronicle] Regex rule added: ${rule.id}`);
            }
        }
    } catch (err) {
        console.warn('[Chronicle] Could not auto-inject regex rules:', err.message);
    }
}

// ============================================
// Event Handlers
// ============================================

/** Новое сообщение AI → парсим теги, обновляем состояние */
async function onMessageReceived(messageIndex) {
    if (!settings.enabled || !settings.autoParse) return;

    const context = getContext();
    const chat = context.chat;
    if (!chat || messageIndex < 0 || messageIndex >= chat.length) return;

    const message = chat[messageIndex].mes;
    if (!hasChronicleData(message)) return;

    // Парсим и сохраняем
    const parsed = stateManager.parseAndStore(messageIndex);
    if (!parsed) return;

    console.log(`[Chronicle] Parsed message #${messageIndex}:`, Object.keys(parsed).filter(k => parsed[k] !== null && (Array.isArray(parsed[k]) ? parsed[k].length : true)));

    // Применяем sims с валидацией
    if (parsed.sims) {
        const time = parsed.world?.time || null;
        const { warnings, oocPrompts } = simsEngine.applyAIData(parsed.sims, time);

        for (const w of warnings) {
            console.warn(`[Chronicle Sims] ${w}`);
        }

        // Копим OOC для следующей генерации
        pendingOOC.push(...oocPrompts);
    }

    // Обновляем полное состояние
    lastState = stateManager.aggregate();

    // Обновляем UI
    refreshAllDisplays();

    // Сохраняем
    context.saveChat();
}

/** Перед отправкой промпта AI → инъектируем контекст */
function onPromptReady(eventData) {
    if (!settings.enabled || !settings.injectContext) return;

    // Агрегируем текущее состояние (пропуская последнее сообщение = генерируемое)
    const state = stateManager.aggregate(1);

    // Системный промпт
    const systemPrompt = getSystemPrompt(settings);

    // Контекстный промпт (текущее состояние)
    const contextPrompt = buildContextPrompt(state, settings);

    // OOC-эффекты (пороговые + здоровье)
    const oocFromState = collectOOCPrompts(simsEngine, state);
    const allOOC = [...pendingOOC, ...oocFromState];
    pendingOOC = []; // Сбрасываем

    // Инъекция в нужные позиции
    if (eventData?.chat) {
        // Системный промпт — в начало
        if (systemPrompt) {
            eventData.chat.unshift({
                role: 'system',
                content: systemPrompt,
            });
        }

        // Контекст + OOC — перед последним сообщением user
        const injection = [contextPrompt, ...allOOC].filter(Boolean).join('\n\n');
        if (injection) {
            // Находим позицию для вставки (перед последним user message)
            let insertIdx = eventData.chat.length - 1;
            for (let i = eventData.chat.length - 1; i >= 0; i--) {
                if (eventData.chat[i].role === 'user') {
                    insertIdx = i;
                    break;
                }
            }

            eventData.chat.splice(insertIdx, 0, {
                role: 'system',
                content: injection,
            });
        }
    }
}

/** Смена чата → перезагрузить состояние */
async function onChatChanged() {
    if (!settings.enabled) return;

    stateManager.init(getContext(), settings);

    // Парсим все сообщения, у которых нет chronicle_meta
    const chat = stateManager.getChat();
    for (let i = 0; i < chat.length; i++) {
        if (!chat[i].chronicle_meta && chat[i].mes) {
            if (hasChronicleData(chat[i].mes)) {
                stateManager.parseAndStore(i);
            }
        }
    }

    // Инициализировать Sims
    simsEngine.init();

    // Агрегировать
    lastState = stateManager.aggregate();
    refreshAllDisplays();
}

/** Сообщение отрендерено → добавить message panel */
function onMessageRendered(messageIndex) {
    if (!settings.enabled || !settings.showMessagePanel) return;
    renderMessagePanel(messageIndex);
}

/** Сообщение удалено → обновить */
function onMessageDeleted(messageIndex) {
    if (!settings.enabled) return;
    lastState = stateManager.aggregate();
    refreshAllDisplays();
}

/** Сообщение отредактировано → перепарсить */
function onMessageEdited(messageIndex) {
    if (!settings.enabled) return;

    const chat = stateManager.getChat();
    if (messageIndex >= 0 && messageIndex < chat.length) {
        if (hasChronicleData(chat[messageIndex].mes)) {
            stateManager.parseAndStore(messageIndex);
        } else {
            // Теги удалены — очистить meta
            chat[messageIndex].chronicle_meta = null;
        }
    }

    lastState = stateManager.aggregate();
    refreshAllDisplays();
}

// ============================================
// UI — Drawer
// ============================================

async function getTemplate(name) {
    try {
        return await renderExtensionTemplateAsync(TEMPLATE_PATH, name);
    } catch (err) {
        console.warn(`[Chronicle] Template "${name}" via ST API failed, trying direct fetch...`, err.message);
        try {
            // Fallback: прямой fetch по определённому пути
            const url = `/scripts/extensions/${TEMPLATE_PATH}/${name}.html`;
            const resp = await fetch(url);
            if (resp.ok) return await resp.text();
        } catch (_) { /* ignore */ }
        
        console.error(`[Chronicle] Could not load template "${name}". Check that the extension folder contains assets/templates/${name}.html`);
        return `<div id="chronicle_drawer" style="display:none;"><!-- template ${name} failed to load --></div>`;
    }
}

async function initDrawer() {
    const $drawer = $('#chronicle_drawer');
    if (!$drawer.length) return;

    // Синхронизировать настройки → UI
    syncSettingsUI();
}

function initTabs() {
    $(document).on('click', '.chr-tab', function () {
        const tab = $(this).data('tab');
        if (!tab) return;

        // Переключить активность
        $('.chr-tab').removeClass('active');
        $(this).addClass('active');

        $('.chr-tab-content').removeClass('active');
        $(`#chr-tab-${tab}`).addClass('active');
    });
}

function syncSettingsUI() {
    // TODO: заполнить UI настроек значениями из settings
}

// ============================================
// UI — Обновление отображений
// ============================================

function refreshAllDisplays() {
    refreshStatusTab();
    refreshSimsTab();
    refreshHealthTab();
    refreshTimelineTab();
    refreshCharactersTab();
    refreshItemsTab();
    refreshCalendarTab();
    refreshLocationMap();
}

function refreshStatusTab() {
    // Время
    $('#chr-current-date').text(lastState.time || '--/--');
    $('#chr-current-weather').text(lastState.weather || '');
    $('#chr-current-location').text(lastState.location || 'Не задано');
    $('#chr-current-atmosphere').text(lastState.atmosphere || '');

    // Мини-симс
    for (const key of STAT_KEYS) {
        const value = lastState.sims[key] ?? 70;
        const config = STAT_CONFIG[key];
        const $bar = $(`#chr-mini-sims .chr-sim-bar[data-stat="${key}"]`);
        if ($bar.length) {
            $bar.find('.chr-sim-bar__fill')
                .css('width', `${value}%`)
                .css('background-color', simsEngine.getStatColor(key))
                .toggleClass('low', value < 20);
            $bar.find('.chr-sim-bar__value').text(value);
        }
    }
}

function refreshSimsTab() {
    for (const key of STAT_KEYS) {
        const value = lastState.sims[key] ?? 70;
        const reason = simsEngine.reasons[key] || '';
        const $bar = $(`#chr-tab-sims .chr-sim-bar[data-stat="${key}"]`);
        if ($bar.length) {
            $bar.find('.chr-sim-bar__fill')
                .css('width', `${value}%`)
                .css('background-color', simsEngine.getStatColor(key))
                .toggleClass('low', value < 20);
            $bar.find('.chr-sim-bar__value').text(value);
            $bar.find('.chr-sim-bar__reason').text(reason);
        }
    }
}

function refreshHealthTab() {
    // HP
    $('#chr-hp-value').text(lastState.hp);
    $('#chr-hp-fill').css('width', `${lastState.hp}%`);

    // Опьянение
    const intox = lastState.intoxication?.value || 0;
    $('#chr-intox-value').text(intox);
    $('#chr-intox-fill').css('width', `${intox}%`);

    // Травмы
    const $injuries = $('#chr-injuries-list').empty();
    if (lastState.injuries.length) {
        for (const inj of lastState.injuries) {
            const dotClass = inj.severity === 'тяжёлый' ? 'severe' :
                             inj.severity === 'средний' ? 'medium' : 'light';
            $injuries.append(`
                <div class="chr-injury-item">
                    <div class="chr-injury-item__dot ${dotClass}"></div>
                    <span style="color: var(--chr-text); font-size: 12px;">${inj.name}</span>
                    <span class="chr-tag chr-tag--${dotClass === 'severe' ? 'danger' : dotClass === 'medium' ? 'warning' : 'info'}">${inj.severity}</span>
                </div>
            `);
        }
    } else {
        $injuries.append('<div class="chr-empty"><i class="fa-solid fa-heart-pulse"></i>Травм нет</div>');
    }

    // Привычки
    const $habits = $('#chr-habits-list').empty();
    for (const habit of lastState.habits) {
        $habits.append(`
            <div class="chr-habit-item">
                <i class="fa-solid fa-smoking"></i>
                <span>${habit.name}</span>
                <span style="color: var(--chr-text-dim);">${habit.detail}</span>
            </div>
        `);
    }

    // Цикл
    const cycle = lastState.cycle;
    if (cycle?.day !== null) {
        $('#chr-cycle-display').show();
        $('#chr-cycle-day').text(`День ${cycle.day}`);
        $('#chr-cycle-phase').text(cycle.phase || '');
        $('#chr-cycle-symptoms').text(cycle.symptoms || '');
    } else {
        $('#chr-cycle-display').hide();
    }
}

function refreshTimelineTab() {
    const $list = $('#chr-timeline-list').empty();

    if (!lastState.events.length) {
        $list.append('<div class="chr-empty"><i class="fa-solid fa-timeline"></i>Событий нет</div>');
        return;
    }

    // Показать последние 50
    const events = lastState.events.slice(-50).reverse();
    for (const ev of events) {
        $list.append(`
            <div class="chr-timeline-item chr-glass-card" data-level="${ev.level}">
                <div class="chr-timeline-item__time">${ev.time || ''}</div>
                <div class="chr-timeline-item__text">${ev.summary}</div>
            </div>
        `);
    }
}

function refreshCharactersTab() {
    const $list = $('#chr-characters-list').empty();

    const npcNames = Object.keys(lastState.npcs);
    if (!npcNames.length) {
        $list.append('<div class="chr-empty"><i class="fa-solid fa-users"></i>Персонажей нет</div>');
        return;
    }

    for (const name of npcNames) {
        const npc = lastState.npcs[name];
        const affection = lastState.affection[name];
        const initial = name.charAt(0).toUpperCase();
        const isPresent = lastState.characters.includes(name);

        let tagsHtml = '';
        if (npc.gender) tagsHtml += `<span class="chr-tag">${npc.gender}</span>`;
        if (npc.age) tagsHtml += `<span class="chr-tag">${npc.age} лет</span>`;
        if (npc.relation) tagsHtml += `<span class="chr-tag chr-tag--primary">${npc.relation}</span>`;
        if (affection) {
            const affClass = affection.value >= 0 ? 'chr-tag--success' : 'chr-tag--danger';
            tagsHtml += `<span class="chr-tag ${affClass}">♥ ${affection.value > 0 ? '+' : ''}${affection.value}</span>`;
        }
        if (isPresent) tagsHtml += `<span class="chr-tag chr-tag--accent">в сцене</span>`;

        $list.append(`
            <div class="chr-npc-card chr-glass-card">
                <div class="chr-npc-card__header">
                    <div class="chr-npc-card__avatar">${initial}</div>
                    <div>
                        <div class="chr-npc-card__name">${name}</div>
                        ${npc.appearance ? `<div style="font-size:11px;color:var(--chr-text-muted);">${npc.appearance}</div>` : ''}
                    </div>
                </div>
                ${npc.birthday ? `<div class="chr-npc-card__birthday"><i class="fa-solid fa-cake-candles"></i>${npc.birthday}</div>` : ''}
                <div class="chr-npc-card__tags">${tagsHtml}</div>
            </div>
        `);
    }
}

function refreshItemsTab() {
    // Кошелёк
    const wallet = lastState.wallet;
    $('#chr-wallet-amount').text(wallet.balance.toLocaleString('ru-RU'));
    $('#chr-wallet-currency').text(wallet.currency);

    // Транзакции
    const $txList = $('#chr-wallet-transactions').empty();
    const recentTx = wallet.transactions.slice(-10).reverse();
    for (const tx of recentTx) {
        const isSpend = tx.type === 'spend';
        $txList.append(`
            <div class="chr-wallet-tx">
                <div class="chr-wallet-tx__icon ${tx.type}">
                    <i class="fa-solid ${isSpend ? 'fa-arrow-down' : 'fa-arrow-up'}"></i>
                </div>
                <div class="chr-wallet-tx__info">
                    <div class="chr-wallet-tx__category">${tx.category}</div>
                    <div class="chr-wallet-tx__note">${tx.note}</div>
                </div>
                <div class="chr-wallet-tx__amount ${tx.type}">
                    ${isSpend ? '-' : '+'}${tx.amount}${tx.currency}
                </div>
            </div>
        `);
    }

    // Предметы
    const $items = $('#chr-items-list').empty();
    const itemEntries = Object.entries(lastState.items);
    if (!itemEntries.length) {
        $items.append('<div class="chr-empty"><i class="fa-solid fa-box-open"></i>Инвентарь пуст</div>');
        return;
    }

    for (const [name, info] of itemEntries) {
        const icon = info.icon || '📦';
        const importanceTag = info.importance === 'ключевой'
            ? '<span class="chr-tag chr-tag--danger">ключевой</span>'
            : info.importance === 'важный'
                ? '<span class="chr-tag chr-tag--warning">важный</span>'
                : '';

        $items.append(`
            <div class="chr-glass-card" style="padding:8px 12px;margin-bottom:4px;display:flex;align-items:center;gap:8px;">
                <span style="font-size:16px;">${icon}</span>
                <div style="flex:1;min-width:0;">
                    <div style="font-size:12px;font-weight:600;color:var(--chr-text);">${name} ${importanceTag}</div>
                    ${info.holder ? `<div style="font-size:10px;color:var(--chr-text-dim);">у ${info.holder}${info.location ? ' @ ' + info.location : ''}</div>` : ''}
                </div>
            </div>
        `);
    }
}

function refreshCalendarTab() {
    // TODO: полная реализация календаря
    // Пока — placeholder
}

function refreshLocationMap() {
    // TODO: SVG интерактивная карта
    // Пока — placeholder
}

// ============================================
// UI — Message Panel
// ============================================

function renderMessagePanel(messageIndex) {
    // TODO: рендер glassmorphism панели под сообщением
}

// ============================================
// Инициализация
// ============================================

jQuery(async () => {
    console.log(`[Chronicle] Loading v${VERSION}... (folder: ${EXT_FOLDER})`);

    try {
        loadSettings();
        ensureRegexRules();

        // Вставить drawer в DOM
        const drawerHtml = await getTemplate('drawer');
        if (drawerHtml) {
            $('#extensions-settings-button').after(drawerHtml);
            console.log('[Chronicle] Drawer template inserted');
        }

        await initDrawer();
        initTabs();

        stateManager.init(getContext(), settings);

        // Подписаться на события ST (с проверкой — не все event_types есть во всех версиях ST)
        const safeOn = (eventName, eventType, handler) => {
            if (eventType) {
                eventSource.on(eventType, handler);
            } else {
                console.warn(`[Chronicle] Event "${eventName}" not available in this ST version, skipping`);
            }
        };

        safeOn('CHARACTER_MESSAGE_RENDERED', event_types.CHARACTER_MESSAGE_RENDERED, onMessageReceived);
        safeOn('CHAT_COMPLETION_PROMPT_READY', event_types.CHAT_COMPLETION_PROMPT_READY, onPromptReady);
        safeOn('CHAT_CHANGED', event_types.CHAT_CHANGED, onChatChanged);
        safeOn('MESSAGE_RENDERED', event_types.MESSAGE_RENDERED, onMessageRendered);
        safeOn('MESSAGE_DELETED', event_types.MESSAGE_DELETED, onMessageDeleted);
        safeOn('MESSAGE_EDITED', event_types.MESSAGE_EDITED, onMessageEdited);
        safeOn('MESSAGE_SWIPED', event_types.MESSAGE_SWIPED, () => {
            if (!settings.enabled) return;
            lastState = stateManager.aggregate();
            refreshAllDisplays();
        });

        // Начальная загрузка
        await onChatChanged();

        isInitialized = true;
        console.log(`[Chronicle] v${VERSION} loaded! ✓`);
    } catch (err) {
        console.error(`[Chronicle] Initialization failed:`, err);
    }
});
