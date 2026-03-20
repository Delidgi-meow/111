/**
 * Chronicle — State Manager
 * Агрегирует все данные из сообщений в единое текущее состояние мира.
 * Каждое сообщение хранит chronicle_meta — спарсенные данные.
 * StateManager проходит по всем и собирает latest state.
 */

import { parseMessage } from './tagParser.js';
import { simsEngine } from '../systems/sims.js';

// ============================================
// Пустое состояние
// ============================================

export function createEmptyState() {
    return {
        // World
        time: '',
        location: '',
        previousLocation: '',
        weather: '',
        atmosphere: '',
        characters: [],
        costumes: {},   // { charName: description }
        
        // Timeline
        events: [],     // [{ messageId, level, summary, time }]
        
        // Sims (managed by SimsEngine, but snapshot here)
        sims: {},       // { hunger: 70, hygiene: 80, ... }
        
        // Health
        hp: 100,
        intoxication: { value: 0, reason: '' },
        injuries: [],   // [{ name, severity, since }]
        habits: [],     // [{ name, detail }]
        
        // Cycle
        cycle: { day: null, phase: '', symptoms: '' },
        
        // Diary
        diary: [],      // [{ messageId, author, text, time }]
        
        // Wallet
        wallet: {
            balance: 0,
            currency: '₽',
            transactions: [], // [{ messageId, date, type, category, amount, currency, note }]
            categories: {},   // { catName: { total, icon, color } }
        },
        
        // NPC
        npcs: {},       // { name: { appearance, personality, relation, gender, age, birthday, ... } }
        
        // Affection
        affection: {},  // { npcName: { value, reason } }
        
        // Agenda
        agenda: [],     // [{ date, text, done, source }]
        
        // Locations (map nodes)
        locationMap: {
            nodes: {},    // { id: { name, desc, x, y, parent } }
            edges: [],    // [{ from, to }]
        },
        
        // Items
        items: {},      // { name: { icon, importance, description, holder, location } }
    };
}

// ============================================
// Категории кошелька по умолчанию
// ============================================

const DEFAULT_CATEGORIES = {
    'еда':          { icon: 'fa-utensils',   color: '#f59e0b' },
    'транспорт':    { icon: 'fa-car',        color: '#3b82f6' },
    'развлечения':  { icon: 'fa-gamepad',    color: '#ec4899' },
    'здоровье':     { icon: 'fa-pills',      color: '#10b981' },
    'одежда':       { icon: 'fa-shirt',      color: '#a78bfa' },
    'жильё':        { icon: 'fa-house',      color: '#8b5cf6' },
    'подарки':      { icon: 'fa-gift',       color: '#f472b6' },
    'доход':        { icon: 'fa-wallet',     color: '#34d399' },
};

// ============================================
// State Manager
// ============================================

class StateManager {
    constructor() {
        this.context = null;
        this.settings = null;
    }

    init(context, settings) {
        this.context = context;
        this.settings = settings;
    }

    /** Получить текущий чат */
    getChat() {
        return this.context?.chat || [];
    }

    /** Получить chronicle_meta для сообщения */
    getMeta(msgIdx) {
        const chat = this.getChat();
        if (msgIdx < 0 || msgIdx >= chat.length) return null;
        return chat[msgIdx].chronicle_meta || null;
    }

    /** Установить chronicle_meta для сообщения */
    setMeta(msgIdx, meta) {
        const chat = this.getChat();
        if (msgIdx < 0 || msgIdx >= chat.length) return;
        chat[msgIdx].chronicle_meta = meta;
    }

    // ----------------------------------------
    // Парсинг нового сообщения
    // ----------------------------------------

    /**
     * Спарсить сообщение и сохранить meta.
     * @param {number} msgIdx — индекс сообщения в чате
     * @returns {object|null} — спарсенные данные или null
     */
    parseAndStore(msgIdx) {
        const chat = this.getChat();
        if (msgIdx < 0 || msgIdx >= chat.length) return null;
        
        const message = chat[msgIdx].mes;
        if (!message) return null;
        
        const parsed = parseMessage(message);
        if (parsed) {
            this.setMeta(msgIdx, parsed);
        }
        
        return parsed;
    }

    // ----------------------------------------
    // Агрегация полного состояния
    // ----------------------------------------

    /**
     * Пройти по всем сообщениям и собрать текущее состояние.
     * @param {number} skipLast — пропустить последние N сообщений (для skipLast=1 при генерации)
     * @returns {object} — полное текущее состояние
     */
    aggregate(skipLast = 0) {
        const chat = this.getChat();
        const state = createEmptyState();
        const end = Math.max(0, chat.length - skipLast);
        
        // Инициализировать SimsEngine
        simsEngine.init();
        
        for (let i = 0; i < end; i++) {
            const meta = chat[i].chronicle_meta;
            if (!meta) continue;
            
            this._applyWorld(state, meta, i);
            this._applyEvents(state, meta, i);
            this._applySims(state, meta);
            this._applyHealth(state, meta);
            this._applyCycle(state, meta);
            this._applyDiary(state, meta, i);
            this._applyWallet(state, meta, i);
            this._applyNpcs(state, meta);
            this._applyAffection(state, meta);
            this._applyAgenda(state, meta);
            this._applyLocations(state, meta);
            this._applyItems(state, meta);
        }
        
        // Финализировать sims snapshot
        state.sims = { ...simsEngine.stats };
        
        return state;
    }

    // ----------------------------------------
    // Применение каждого блока данных
    // ----------------------------------------

    _applyWorld(state, meta, msgIdx) {
        if (!meta.world) return;
        const w = meta.world;
        
        if (w.time) state.time = w.time;
        if (w.location) {
            state.previousLocation = state.location;
            state.location = w.location;
        }
        if (w.weather) state.weather = w.weather;
        if (w.atmosphere) state.atmosphere = w.atmosphere;
        if (w.characters?.length) state.characters = [...w.characters];
        if (w.costumes) {
            for (const [char, desc] of Object.entries(w.costumes)) {
                state.costumes[char] = desc;
            }
        }
    }

    _applyEvents(state, meta, msgIdx) {
        if (!meta.events?.length) return;
        
        for (const ev of meta.events) {
            state.events.push({
                messageId: msgIdx,
                level: ev.level,
                summary: ev.summary,
                time: meta.world?.time || '',
            });
        }
    }

    _applySims(state, meta) {
        if (!meta.sims) return;
        const time = meta.world?.time || null;
        simsEngine.applyAIData(meta.sims, time);
    }

    _applyHealth(state, meta) {
        if (!meta.health) return;
        const h = meta.health;
        
        if (h.hp !== null) state.hp = h.hp;
        if (h.intoxication) state.intoxication = h.intoxication;
        
        // Травмы: добавляем новые, не дублируем
        for (const injury of h.injuries) {
            const existing = state.injuries.find(
                i => i.name.toLowerCase() === injury.name.toLowerCase()
            );
            if (existing) {
                existing.severity = injury.severity;
            } else {
                state.injuries.push({ ...injury, since: meta.world?.time || '' });
            }
        }
        
        // Привычки: обновляем
        for (const habit of h.habits) {
            const existing = state.habits.find(
                h => h.name.toLowerCase() === habit.name.toLowerCase()
            );
            if (existing) {
                existing.detail = habit.detail;
            } else {
                state.habits.push({ ...habit });
            }
        }
    }

    _applyCycle(state, meta) {
        if (!meta.cycle) return;
        
        if (meta.cycle.day !== null) state.cycle.day = meta.cycle.day;
        if (meta.cycle.phase) state.cycle.phase = meta.cycle.phase;
        if (meta.cycle.symptoms) state.cycle.symptoms = meta.cycle.symptoms;
    }

    _applyDiary(state, meta, msgIdx) {
        if (!meta.diary?.length) return;
        
        for (const entry of meta.diary) {
            state.diary.push({
                messageId: msgIdx,
                author: entry.author,
                text: entry.text,
                time: meta.world?.time || '',
            });
        }
    }

    _applyWallet(state, meta, msgIdx) {
        if (!meta.wallet) return;
        const w = meta.wallet;
        
        // Balance: AI может установить абсолютное значение
        if (w.balance) {
            state.wallet.balance = w.balance.amount;
            state.wallet.currency = w.balance.currency;
        }
        
        // Транзакции
        for (const tx of w.transactions) {
            const record = {
                messageId: msgIdx,
                date: meta.world?.time || '',
                type: tx.type,
                category: tx.category,
                amount: tx.amount,
                currency: tx.currency || state.wallet.currency,
                note: tx.note,
            };
            
            state.wallet.transactions.push(record);
            
            // Обновить баланс (если AI не выставил абсолют)
            if (!w.balance) {
                if (tx.type === 'spend') {
                    state.wallet.balance -= tx.amount;
                } else if (tx.type === 'income') {
                    state.wallet.balance += tx.amount;
                }
            }
            
            // Обновить категории
            const catKey = tx.category.toLowerCase();
            if (!state.wallet.categories[catKey]) {
                const defaults = DEFAULT_CATEGORIES[catKey] || { icon: 'fa-tag', color: '#94a3b8' };
                state.wallet.categories[catKey] = { ...defaults, total: 0 };
            }
            if (tx.type === 'spend') {
                state.wallet.categories[catKey].total += tx.amount;
            }
        }
    }

    _applyNpcs(state, meta) {
        if (!meta.npcs || !Object.keys(meta.npcs).length) return;
        
        for (const [name, info] of Object.entries(meta.npcs)) {
            if (!state.npcs[name]) {
                state.npcs[name] = { firstSeen: meta.world?.time || '' };
            }
            
            // Мержим поля (не перезаписываем undefined)
            for (const [key, value] of Object.entries(info)) {
                if (value !== undefined && value !== '') {
                    state.npcs[name][key] = value;
                }
            }
        }
    }

    _applyAffection(state, meta) {
        if (!meta.affection || !Object.keys(meta.affection).length) return;
        
        for (const [name, data] of Object.entries(meta.affection)) {
            if (!state.affection[name]) {
                state.affection[name] = { value: 0, reason: '' };
            }
            
            if (data.type === 'absolute') {
                state.affection[name].value = data.value;
            } else if (data.type === 'relative') {
                state.affection[name].value += data.value;
            }
            
            if (data.reason) {
                state.affection[name].reason = data.reason;
            }
        }
    }

    _applyAgenda(state, meta) {
        // Удаления
        if (meta.agendaDelete?.length) {
            for (const delText of meta.agendaDelete) {
                const lower = delText.toLowerCase();
                state.agenda = state.agenda.filter(
                    a => !a.text.toLowerCase().includes(lower)
                );
            }
        }
        
        // Новые
        if (meta.agenda?.length) {
            for (const item of meta.agenda) {
                // Проверяем дубликат
                const exists = state.agenda.some(
                    a => a.text.toLowerCase() === item.text.toLowerCase()
                );
                if (!exists) {
                    state.agenda.push({ ...item });
                }
            }
        }
    }

    _applyLocations(state, meta) {
        if (!meta.locations?.length) return;
        
        for (const loc of meta.locations) {
            const id = this._locationNameToId(loc.name);
            
            // Создать / обновить ноду
            if (!state.locationMap.nodes[id]) {
                state.locationMap.nodes[id] = {
                    name: loc.name,
                    desc: loc.desc,
                    x: 50 + Object.keys(state.locationMap.nodes).length * 120,
                    y: 50 + (Object.keys(state.locationMap.nodes).length % 3) * 100,
                    parent: this._getParentFromName(loc.name),
                };
            } else {
                if (loc.desc) state.locationMap.nodes[id].desc = loc.desc;
            }
            
            // Связи
            for (const connName of loc.connections) {
                const connId = this._locationNameToId(connName);
                
                // Создать ноду-связь если не существует
                if (!state.locationMap.nodes[connId]) {
                    state.locationMap.nodes[connId] = {
                        name: connName,
                        desc: '',
                        x: state.locationMap.nodes[id].x + 150,
                        y: state.locationMap.nodes[id].y,
                        parent: this._getParentFromName(connName),
                    };
                }
                
                // Добавить ребро (без дубликатов)
                const edgeExists = state.locationMap.edges.some(
                    e => (e.from === id && e.to === connId) || (e.from === connId && e.to === id)
                );
                if (!edgeExists) {
                    state.locationMap.edges.push({ from: id, to: connId });
                }
            }
        }
    }

    _applyItems(state, meta) {
        // Удаления
        if (meta.itemsDelete?.length) {
            for (const name of meta.itemsDelete) {
                const lower = name.toLowerCase();
                // Ищем по базовому имени
                for (const key of Object.keys(state.items)) {
                    if (key.toLowerCase().includes(lower) || lower.includes(key.toLowerCase())) {
                        delete state.items[key];
                    }
                }
            }
        }
        
        // Новые / обновлённые
        if (meta.items?.length) {
            for (const item of meta.items) {
                const existing = this._findItemByName(state.items, item.name);
                
                if (existing) {
                    // Обновить существующий
                    if (item.icon) state.items[existing].icon = item.icon;
                    if (item.holder) state.items[existing].holder = item.holder;
                    if (item.location) state.items[existing].location = item.location;
                    if (item.description) state.items[existing].description = item.description;
                    if (item.importance) state.items[existing].importance = item.importance;
                } else {
                    // Новый предмет
                    state.items[item.name] = {
                        icon: item.icon || null,
                        importance: item.importance || '',
                        description: item.description || '',
                        holder: item.holder || '',
                        location: item.location || '',
                    };
                }
            }
        }
    }

    // ----------------------------------------
    // Утилиты
    // ----------------------------------------

    _locationNameToId(name) {
        return name
            .toLowerCase()
            .replace(/[·\s>→/\\]/g, '_')
            .replace(/[^a-zа-яё0-9_]/gi, '')
            .replace(/_+/g, '_');
    }

    _getParentFromName(name) {
        // "Квартира·Кухня" → "Квартира"
        const sep = name.indexOf('·');
        return sep > 0 ? name.substring(0, sep).trim() : '';
    }

    _findItemByName(items, name) {
        const lower = name.toLowerCase();
        if (items[name]) return name;
        for (const key of Object.keys(items)) {
            if (key.toLowerCase() === lower) return key;
        }
        return null;
    }
}

// Синглтон
export const stateManager = new StateManager();
