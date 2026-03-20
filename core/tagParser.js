/**
 * Chronicle — Tag Parser
 * Парсит ВСЕ AI-теги из сообщения в structured data.
 * Каждый тег — отдельный метод, легко расширять.
 */

// ============================================
// Регулярки для извлечения тегов
// ============================================

const TAG_PATTERNS = {
    world:    /<world>([\s\S]*?)<\/world>/gi,
    event:    /<event>([\s\S]*?)<\/event>/gi,
    sims:     /<sims>([\s\S]*?)<\/sims>/gi,
    health:   /<health>([\s\S]*?)<\/health>/gi,
    cycle:    /<cycle>([\s\S]*?)<\/cycle>/gi,
    diary:    /<diary>([\s\S]*?)<\/diary>/gi,
    wallet:   /<wallet>([\s\S]*?)<\/wallet>/gi,
    npc:      /<npc>([\s\S]*?)<\/npc>/gi,
    agenda:   /<agenda>([\s\S]*?)<\/agenda>/gi,
    agendaDel:/<agenda->([\s\S]*?)<\/agenda->/gi,
    location: /<location>([\s\S]*?)<\/location>/gi,
    item:     /<item>([\s\S]*?)<\/item>/gi,
    itemDel:  /<item->([\s\S]*?)<\/item->/gi,
    affection:/<affection>([\s\S]*?)<\/affection>/gi,
};

// ============================================
// Утилиты парсинга
// ============================================

/** Разбивает содержимое тега на строки key:value */
function parseLines(content) {
    return content
        .split('\n')
        .map(l => l.trim())
        .filter(l => l && !l.startsWith('#') && !l.startsWith('//'));
}

/** Парсит строку key:value (первое двоеточие — разделитель) */
function parseKV(line) {
    const idx = line.indexOf(':');
    if (idx <= 0) return null;
    return {
        key: line.substring(0, idx).trim().toLowerCase(),
        value: line.substring(idx + 1).trim(),
    };
}

/** Извлекает число из строки, возвращает null если не число */
function extractNumber(str) {
    const match = str.match(/^([+-]?\d+(?:\.\d+)?)/);
    return match ? parseFloat(match[1]) : null;
}

/** Извлекает валюту и сумму: "850₽" → { amount: 850, currency: '₽' } */
function parseMoney(str) {
    const match = str.match(/^([+-]?\d+(?:[.,]\d+)?)\s*(.*)$/);
    if (!match) return null;
    return {
        amount: parseFloat(match[1].replace(',', '.')),
        currency: match[2].trim() || '₽',
    };
}

// ============================================
// Парсеры отдельных тегов
// ============================================

function parseWorld(content) {
    const result = {
        time: '', location: '', weather: '', atmosphere: '',
        characters: [], costumes: {},
    };
    
    for (const line of parseLines(content)) {
        const kv = parseKV(line);
        if (!kv) continue;
        
        switch (kv.key) {
            case 'time':
                result.time = kv.value;
                break;
            case 'location':
                result.location = kv.value;
                break;
            case 'weather':
                result.weather = kv.value;
                break;
            case 'atmosphere':
                result.atmosphere = kv.value;
                break;
            case 'characters': {
                result.characters = kv.value
                    .split(/[,，]/)
                    .map(c => c.trim())
                    .filter(Boolean);
                break;
            }
            case 'costume': {
                const eqIdx = kv.value.indexOf('=');
                if (eqIdx > 0) {
                    const char = kv.value.substring(0, eqIdx).trim();
                    const desc = kv.value.substring(eqIdx + 1).trim();
                    if (char && desc) result.costumes[char] = desc;
                }
                break;
            }
        }
    }
    
    return result;
}

function parseEvent(content) {
    const lines = parseLines(content);
    const events = [];
    
    for (const line of lines) {
        const pipeIdx = line.indexOf('|');
        if (pipeIdx > 0) {
            const levelRaw = line.substring(0, pipeIdx).trim().toLowerCase();
            const summary = line.substring(pipeIdx + 1).trim();
            
            let level = 'обычное';
            if (levelRaw === 'ключевое' || levelRaw === 'critical') level = 'ключевое';
            else if (levelRaw === 'важное' || levelRaw === 'important') level = 'важное';
            
            if (summary) {
                events.push({ level, summary });
            }
        } else if (line.trim()) {
            // Строка без уровня → обычное событие
            events.push({ level: 'обычное', summary: line.trim() });
        }
    }
    
    return events;
}

function parseSims(content) {
    const result = {};
    const VALID_STATS = ['hunger', 'hygiene', 'sleep', 'arousal'];
    
    for (const line of parseLines(content)) {
        const kv = parseKV(line);
        if (!kv || !VALID_STATS.includes(kv.key)) continue;
        
        const pipeIdx = kv.value.indexOf('|');
        let valueStr, reason;
        
        if (pipeIdx > 0) {
            valueStr = kv.value.substring(0, pipeIdx).trim();
            reason = kv.value.substring(pipeIdx + 1).trim();
        } else {
            valueStr = kv.value;
            reason = '';
        }
        
        const num = extractNumber(valueStr);
        if (num !== null) {
            result[kv.key] = {
                value: Math.max(0, Math.min(100, Math.round(num))),
                reason,
                raw: num,
            };
        }
    }
    
    return result;
}

function parseHealth(content) {
    const result = {
        hp: null,
        intoxication: null,
        injuries: [],
        habits: [],
    };
    
    for (const line of parseLines(content)) {
        const kv = parseKV(line);
        if (!kv) continue;
        
        switch (kv.key) {
            case 'hp': {
                const num = extractNumber(kv.value);
                if (num !== null) result.hp = Math.max(0, Math.min(100, Math.round(num)));
                break;
            }
            case 'intoxication': {
                const pipeIdx = kv.value.indexOf('|');
                const valueStr = pipeIdx > 0 ? kv.value.substring(0, pipeIdx).trim() : kv.value;
                const reason = pipeIdx > 0 ? kv.value.substring(pipeIdx + 1).trim() : '';
                const num = extractNumber(valueStr);
                if (num !== null) {
                    result.intoxication = {
                        value: Math.max(0, Math.min(100, Math.round(num))),
                        reason,
                    };
                }
                break;
            }
            case 'injury': {
                const parts = kv.value.split('|').map(p => p.trim());
                if (parts[0]) {
                    result.injuries.push({
                        name: parts[0],
                        severity: parts[1] || 'лёгкий',
                    });
                }
                break;
            }
            case 'habit': {
                const parts = kv.value.split('|').map(p => p.trim());
                if (parts[0]) {
                    result.habits.push({
                        name: parts[0],
                        detail: parts[1] || '',
                    });
                }
                break;
            }
        }
    }
    
    return result;
}

function parseCycle(content) {
    const result = { day: null, phase: '', symptoms: '' };
    
    for (const line of parseLines(content)) {
        const kv = parseKV(line);
        if (!kv) continue;
        
        switch (kv.key) {
            case 'day': {
                const num = extractNumber(kv.value);
                if (num !== null) result.day = Math.round(num);
                break;
            }
            case 'phase':
                result.phase = kv.value;
                break;
            case 'symptoms':
                result.symptoms = kv.value;
                break;
        }
    }
    
    return result;
}

function parseDiary(content) {
    const entries = [];
    
    for (const line of parseLines(content)) {
        const pipeIdx = line.indexOf('|');
        if (pipeIdx > 0) {
            const author = line.substring(0, pipeIdx).trim();
            const text = line.substring(pipeIdx + 1).trim();
            if (author && text) {
                entries.push({ author, text });
            }
        }
    }
    
    return entries;
}

function parseWallet(content) {
    const result = {
        balance: null,
        transactions: [],
    };
    
    for (const line of parseLines(content)) {
        const kv = parseKV(line);
        if (!kv) continue;
        
        switch (kv.key) {
            case 'balance': {
                const money = parseMoney(kv.value);
                if (money) {
                    result.balance = money;
                }
                break;
            }
            case 'spend': {
                // spend:категория|сумма|описание
                const parts = kv.value.split('|').map(p => p.trim());
                if (parts.length >= 2) {
                    const money = parseMoney(parts[1]);
                    if (money) {
                        result.transactions.push({
                            type: 'spend',
                            category: parts[0],
                            amount: money.amount,
                            currency: money.currency,
                            note: parts[2] || '',
                        });
                    }
                }
                break;
            }
            case 'income': {
                // income:сумма|описание
                const parts = kv.value.split('|').map(p => p.trim());
                const money = parseMoney(parts[0]);
                if (money) {
                    result.transactions.push({
                        type: 'income',
                        category: 'доход',
                        amount: money.amount,
                        currency: money.currency,
                        note: parts[1] || '',
                    });
                }
                break;
            }
        }
    }
    
    return result;
}

function parseNpc(content) {
    const npcs = {};
    
    for (const line of parseLines(content)) {
        const parts = line.split('|').map(p => p.trim());
        if (parts.length < 2) continue;
        
        const name = parts[0];
        if (!name) continue;
        
        const info = {};
        
        for (let i = 1; i < parts.length; i++) {
            const part = parts[i];
            // key=value или key:value
            const eqIdx = part.indexOf('=');
            const colonIdx = part.indexOf(':');
            
            let key, value;
            if (eqIdx > 0 && (colonIdx < 0 || eqIdx < colonIdx)) {
                key = part.substring(0, eqIdx).trim().toLowerCase();
                value = part.substring(eqIdx + 1).trim();
            } else if (colonIdx > 0) {
                key = part.substring(0, colonIdx).trim().toLowerCase();
                value = part.substring(colonIdx + 1).trim();
            } else {
                continue;
            }
            
            switch (key) {
                case 'внешность': case 'appearance':
                    info.appearance = value; break;
                case 'характер': case 'personality':
                    info.personality = value; break;
                case 'отношение': case 'relation': case 'relationship':
                    info.relation = value; break;
                case 'пол': case 'gender':
                    info.gender = value; break;
                case 'возраст': case 'age': {
                    const num = extractNumber(value);
                    if (num !== null) info.age = Math.round(num);
                    break;
                }
                case 'день_рождения': case 'birthday': case 'др':
                    info.birthday = value; break;
                default:
                    info[key] = value;
            }
        }
        
        npcs[name] = info;
    }
    
    return npcs;
}

function parseAgenda(content) {
    const items = [];
    
    for (const line of parseLines(content)) {
        const pipeIdx = line.indexOf('|');
        if (pipeIdx > 0) {
            const date = line.substring(0, pipeIdx).trim();
            const text = line.substring(pipeIdx + 1).trim();
            if (text) items.push({ date, text, done: false, source: 'ai' });
        } else if (line.trim()) {
            items.push({ date: '', text: line.trim(), done: false, source: 'ai' });
        }
    }
    
    return items;
}

function parseAgendaDelete(content) {
    return parseLines(content).filter(Boolean);
}

function parseLocation(content) {
    const locations = [];
    
    for (const line of parseLines(content)) {
        const parts = line.split('|').map(p => p.trim());
        if (!parts[0]) continue;
        
        const loc = { name: parts[0], desc: '', connections: [] };
        
        for (let i = 1; i < parts.length; i++) {
            const eqIdx = parts[i].indexOf('=');
            if (eqIdx <= 0) continue;
            
            const key = parts[i].substring(0, eqIdx).trim().toLowerCase();
            const value = parts[i].substring(eqIdx + 1).trim();
            
            switch (key) {
                case 'описание': case 'desc':
                    loc.desc = value; break;
                case 'связь': case 'connection': case 'связи':
                    loc.connections = value.split(/[,，]/).map(c => c.trim()).filter(Boolean);
                    break;
            }
        }
        
        locations.push(loc);
    }
    
    return locations;
}

function parseItems(content) {
    const items = [];
    
    for (const line of parseLines(content)) {
        // item:🔑Ключи|holder@location  или  item:Ключи(3)|описание=holder@location
        const kv = parseKV(line);
        if (!kv) {
            // Строка без key: — парсим напрямую
            parseItemLine(line, items);
            continue;
        }
        
        if (kv.key === 'item' || kv.key === 'item!' || kv.key === 'item!!') {
            parseItemLine(kv.value, items, kv.key === 'item!!' ? 'ключевой' : kv.key === 'item!' ? 'важный' : '');
        }
    }
    
    // Если нет key:value строк, парсим каждую строку как item
    if (items.length === 0) {
        for (const line of parseLines(content)) {
            parseItemLine(line, items);
        }
    }
    
    return items;
}

function parseItemLine(line, items, importance = '') {
    if (!line) return;
    
    // Emoji icon
    let icon = null;
    let rest = line;
    const emojiMatch = line.match(/^([\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}])/u);
    if (emojiMatch) {
        icon = emojiMatch[1];
        rest = line.substring(icon.length).trim();
    }
    
    // name|description=holder@location
    const eqIdx = rest.indexOf('=');
    const pipeIdx = rest.indexOf('|');
    
    let name, description = '', holder = '', location = '';
    
    if (pipeIdx > 0 && (eqIdx < 0 || pipeIdx < eqIdx)) {
        name = rest.substring(0, pipeIdx).trim();
        const afterPipe = rest.substring(pipeIdx + 1).trim();
        
        const eqIdx2 = afterPipe.indexOf('=');
        if (eqIdx2 > 0) {
            description = afterPipe.substring(0, eqIdx2).trim();
            const holderLoc = afterPipe.substring(eqIdx2 + 1).trim();
            const atIdx = holderLoc.indexOf('@');
            if (atIdx >= 0) {
                holder = holderLoc.substring(0, atIdx).trim();
                location = holderLoc.substring(atIdx + 1).trim();
            } else {
                holder = holderLoc;
            }
        } else {
            const atIdx = afterPipe.indexOf('@');
            if (atIdx >= 0) {
                holder = afterPipe.substring(0, atIdx).trim();
                location = afterPipe.substring(atIdx + 1).trim();
            } else {
                holder = afterPipe;
            }
        }
    } else if (eqIdx > 0) {
        name = rest.substring(0, eqIdx).trim();
        const holderLoc = rest.substring(eqIdx + 1).trim();
        const atIdx = holderLoc.indexOf('@');
        if (atIdx >= 0) {
            holder = holderLoc.substring(0, atIdx).trim();
            location = holderLoc.substring(atIdx + 1).trim();
        } else {
            holder = holderLoc;
        }
    } else {
        name = rest;
    }
    
    if (name) {
        items.push({ name, icon, importance, description, holder, location });
    }
}

function parseItemDelete(content) {
    return parseLines(content)
        .map(l => l.replace(/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, '').trim())
        .filter(Boolean);
}

function parseAffection(content) {
    const result = {};
    
    for (const line of parseLines(content)) {
        // Даниил=+5|помогла с ужином
        const eqIdx = line.indexOf('=');
        if (eqIdx <= 0) continue;
        
        const name = line.substring(0, eqIdx).trim();
        const rest = line.substring(eqIdx + 1).trim();
        
        const pipeIdx = rest.indexOf('|');
        const valueStr = pipeIdx > 0 ? rest.substring(0, pipeIdx).trim() : rest;
        const reason = pipeIdx > 0 ? rest.substring(pipeIdx + 1).trim() : '';
        
        const num = extractNumber(valueStr);
        if (num !== null && name) {
            const isRelative = valueStr.startsWith('+') || valueStr.startsWith('-');
            result[name] = {
                type: isRelative ? 'relative' : 'absolute',
                value: num,
                reason,
            };
        }
    }
    
    return result;
}

// ============================================
// Главная функция парсинга
// ============================================

/**
 * Парсит ВСЕ Chronicle-теги из текста сообщения.
 * @param {string} message — полный текст сообщения AI
 * @returns {object|null} — structured data или null если тегов нет
 */
export function parseMessage(message) {
    if (!message) return null;
    
    const result = {
        world: null,
        events: [],
        sims: null,
        health: null,
        cycle: null,
        diary: [],
        wallet: null,
        npcs: {},
        agenda: [],
        agendaDelete: [],
        locations: [],
        items: [],
        itemsDelete: [],
        affection: {},
    };
    
    let hasData = false;
    
    // World
    let match;
    const worldPattern = new RegExp(TAG_PATTERNS.world.source, 'gi');
    while ((match = worldPattern.exec(message)) !== null) {
        result.world = parseWorld(match[1]);
        hasData = true;
    }
    
    // Events
    const eventPattern = new RegExp(TAG_PATTERNS.event.source, 'gi');
    while ((match = eventPattern.exec(message)) !== null) {
        result.events.push(...parseEvent(match[1]));
        hasData = true;
    }
    
    // Sims
    const simsPattern = new RegExp(TAG_PATTERNS.sims.source, 'gi');
    while ((match = simsPattern.exec(message)) !== null) {
        result.sims = parseSims(match[1]);
        hasData = true;
    }
    
    // Health
    const healthPattern = new RegExp(TAG_PATTERNS.health.source, 'gi');
    while ((match = healthPattern.exec(message)) !== null) {
        result.health = parseHealth(match[1]);
        hasData = true;
    }
    
    // Cycle
    const cyclePattern = new RegExp(TAG_PATTERNS.cycle.source, 'gi');
    while ((match = cyclePattern.exec(message)) !== null) {
        result.cycle = parseCycle(match[1]);
        hasData = true;
    }
    
    // Diary
    const diaryPattern = new RegExp(TAG_PATTERNS.diary.source, 'gi');
    while ((match = diaryPattern.exec(message)) !== null) {
        result.diary.push(...parseDiary(match[1]));
        hasData = true;
    }
    
    // Wallet
    const walletPattern = new RegExp(TAG_PATTERNS.wallet.source, 'gi');
    while ((match = walletPattern.exec(message)) !== null) {
        result.wallet = parseWallet(match[1]);
        hasData = true;
    }
    
    // NPC
    const npcPattern = new RegExp(TAG_PATTERNS.npc.source, 'gi');
    while ((match = npcPattern.exec(message)) !== null) {
        Object.assign(result.npcs, parseNpc(match[1]));
        hasData = true;
    }
    
    // Agenda
    const agendaPattern = new RegExp(TAG_PATTERNS.agenda.source, 'gi');
    while ((match = agendaPattern.exec(message)) !== null) {
        result.agenda.push(...parseAgenda(match[1]));
        hasData = true;
    }
    
    // Agenda delete
    const agendaDelPattern = new RegExp(TAG_PATTERNS.agendaDel.source, 'gi');
    while ((match = agendaDelPattern.exec(message)) !== null) {
        result.agendaDelete.push(...parseAgendaDelete(match[1]));
        hasData = true;
    }
    
    // Location
    const locPattern = new RegExp(TAG_PATTERNS.location.source, 'gi');
    while ((match = locPattern.exec(message)) !== null) {
        result.locations.push(...parseLocation(match[1]));
        hasData = true;
    }
    
    // Items
    const itemPattern = new RegExp(TAG_PATTERNS.item.source, 'gi');
    while ((match = itemPattern.exec(message)) !== null) {
        result.items.push(...parseItems(match[1]));
        hasData = true;
    }
    
    // Items delete
    const itemDelPattern = new RegExp(TAG_PATTERNS.itemDel.source, 'gi');
    while ((match = itemDelPattern.exec(message)) !== null) {
        result.itemsDelete.push(...parseItemDelete(match[1]));
        hasData = true;
    }
    
    // Affection
    const affPattern = new RegExp(TAG_PATTERNS.affection.source, 'gi');
    while ((match = affPattern.exec(message)) !== null) {
        Object.assign(result.affection, parseAffection(match[1]));
        hasData = true;
    }
    
    return hasData ? result : null;
}

/**
 * Возвращает список regex rules для авто-инъекции в ST.
 * Скрывает все Chronicle-теги из отображения и отправки AI.
 */
export function getRegexRules() {
    const tags = [
        { id: 'chronicle_world',    name: 'Chronicle — Скрыть <world>',     pattern: '<world>[\\s\\S]*?</world>' },
        { id: 'chronicle_event',    name: 'Chronicle — Скрыть <event>',     pattern: '<event>[\\s\\S]*?</event>' },
        { id: 'chronicle_sims',     name: 'Chronicle — Скрыть <sims>',      pattern: '<sims>[\\s\\S]*?</sims>' },
        { id: 'chronicle_health',   name: 'Chronicle — Скрыть <health>',    pattern: '<health>[\\s\\S]*?</health>' },
        { id: 'chronicle_cycle',    name: 'Chronicle — Скрыть <cycle>',     pattern: '<cycle>[\\s\\S]*?</cycle>' },
        { id: 'chronicle_diary',    name: 'Chronicle — Скрыть <diary>',     pattern: '<diary>[\\s\\S]*?</diary>' },
        { id: 'chronicle_wallet',   name: 'Chronicle — Скрыть <wallet>',    pattern: '<wallet>[\\s\\S]*?</wallet>' },
        { id: 'chronicle_npc',      name: 'Chronicle — Скрыть <npc>',       pattern: '<npc>[\\s\\S]*?</npc>' },
        { id: 'chronicle_agenda',   name: 'Chronicle — Скрыть <agenda>',    pattern: '<agenda-?>[\\s\\S]*?</agenda-?>' },
        { id: 'chronicle_location', name: 'Chronicle — Скрыть <location>',  pattern: '<location>[\\s\\S]*?</location>' },
        { id: 'chronicle_item',     name: 'Chronicle — Скрыть <item>',      pattern: '<item-?>[\\s\\S]*?</item-?>' },
        { id: 'chronicle_affect',   name: 'Chronicle — Скрыть <affection>', pattern: '<affection>[\\s\\S]*?</affection>' },
    ];
    
    return tags.map(t => ({
        id: t.id,
        scriptName: t.name,
        description: t.name,
        findRegex: `/${t.pattern}/gim`,
        replaceString: '',
        trimStrings: [],
        placement: [2],       // REGEX_PLACEMENT.MD_DISPLAY и PROMPT
        disabled: false,
        markdownOnly: true,
        promptOnly: true,
        runOnEdit: true,
        substituteRegex: 0,
        minDepth: null,
        maxDepth: null,
    }));
}

/**
 * Проверяет, есть ли в тексте хотя бы один Chronicle-тег.
 */
export function hasChronicleData(message) {
    if (!message) return false;
    return /<(?:world|event|sims|health|cycle|diary|wallet|npc|agenda|location|item|affection)>/i.test(message);
}
