/**
 * Chronicle — Prompt Builder
 * Собирает промпты для инъекции в контекст AI.
 * Включает: системный промпт (формат тегов), текущее состояние, OOC-эффекты.
 */

import { STAT_CONFIG, STAT_KEYS } from '../systems/sims.js';

// ============================================
// Системный промпт по умолчанию (формат тегов)
// ============================================

const DEFAULT_SYSTEM_PROMPT = `[Chronicle — Система памяти мира]

В конце КАЖДОГО ответа ты ОБЯЗАН добавить следующие теги. Теги НЕ отображаются в тексте — они нужны только для системы.

ОБЯЗАТЕЛЬНЫЕ теги (каждый ход):

<world>
time:конкретная дата и время (2026/3/15 14:30, НЕ "День 1", НЕ "следующий день")
location:место (разделяй уровни через · : Квартира·Кухня)
weather:погода (коротко)
atmosphere:атмосфера (коротко)
characters:имена персонажей в сцене через запятую
costume:Имя=описание наряда (отдельная строка на каждого)
</world>

<event>
уровень|описание события 20-50 слов
</event>
Уровни: обычное / важное / ключевое

<sims>
hunger:0-100|причина если изменилось
hygiene:0-100
sleep:0-100|причина если изменилось
arousal:0-100
</sims>

НЕОБЯЗАТЕЛЬНЫЕ теги (только при изменениях):

<health>
hp:0-100
intoxication:0-100|что пил/употреблял
injury:название|тяжесть (лёгкий/средний/тяжёлый)
habit:название|детали
</health>

<cycle>
day:день цикла
phase:фаза
symptoms:симптомы
</cycle>

<diary>
Имя|Запись от лица персонажа (мысли, переживания)
</diary>

<wallet>
balance:сумма₽
spend:категория|сумма₽|описание
income:сумма₽|источник
</wallet>

<npc>
Имя|внешность=описание|характер=описание|отношение=тип|пол:м/ж|возраст:число|birthday:ГГГГ/М/Д
</npc>

<affection>
Имя=+/-число|причина
</affection>

<agenda>
ГГГГ/М/Д|текст задачи/плана
</agenda>

<agenda->
текст завершённой задачи
</agenda->

<location>
Место·Комната|описание=физическое описание|связь=Место·Комната1,Место·Комната2
</location>

<item>
🔑Название|описание=владелец@расположение
</item>

<item->
Название удалённого/потерянного предмета
</item->

ПРАВИЛА:
- Все теги — в КОНЦЕ ответа, ПОСЛЕ текста истории
- time ВСЕГДА конкретная дата, НИКОГДА относительная ("через час", "на следующий день")
- <sims> значения 0-100, изменяй логично: еда повышает hunger, душ повышает hygiene
- Необязательные теги — ТОЛЬКО при реальных изменениях, не дублируй`;

// ============================================
// Сборка контекстного промпта
// ============================================

/**
 * Собирает промпт текущего состояния для инъекции.
 * @param {object} state — агрегированное состояние из stateManager
 * @param {object} settings — настройки расширения
 * @returns {string} — промпт для инъекции
 */
export function buildContextPrompt(state, settings) {
    const sections = [];

    // ── Время и место ──
    if (settings.sendWorld !== false) {
        const worldLines = [];
        if (state.time) worldLines.push(`Текущее время: ${state.time}`);
        if (state.location) worldLines.push(`Место: ${state.location}`);
        if (state.weather) worldLines.push(`Погода: ${state.weather}`);

        if (worldLines.length) {
            sections.push(`[Мир]\n${worldLines.join('\n')}`);
        }
    }

    // ── Наряды присутствующих ──
    if (settings.sendCostumes !== false && state.characters?.length) {
        const costumeLines = [];
        for (const char of state.characters) {
            if (state.costumes[char]) {
                costumeLines.push(`${char}: ${state.costumes[char]}`);
            }
        }
        if (costumeLines.length) {
            sections.push(`[Наряды]\n${costumeLines.join('\n')}`);
        }
    }

    // ── Симс ──
    if (settings.sendSims !== false) {
        const simsLines = [];
        for (const key of STAT_KEYS) {
            const config = STAT_CONFIG[key];
            const value = state.sims[key] ?? 70;
            simsLines.push(`${config.name}: ${value}/100`);
        }
        sections.push(`[Статы персонажа]\n${simsLines.join(' | ')}`);
    }

    // ── Здоровье ──
    if (settings.sendHealth !== false) {
        const healthLines = [];
        if (state.hp < 100) healthLines.push(`HP: ${state.hp}/100`);
        if (state.intoxication?.value > 0) {
            healthLines.push(`Опьянение: ${state.intoxication.value}/100`);
        }
        if (state.injuries.length) {
            for (const inj of state.injuries) {
                healthLines.push(`Травма: ${inj.name} (${inj.severity})`);
            }
        }
        if (healthLines.length) {
            sections.push(`[Здоровье]\n${healthLines.join('\n')}`);
        }
    }

    // ── Цикл ──
    if (settings.sendCycle !== false && state.cycle?.day !== null) {
        let cycleText = `День цикла: ${state.cycle.day}`;
        if (state.cycle.phase) cycleText += ` (${state.cycle.phase})`;
        if (state.cycle.symptoms) cycleText += ` — ${state.cycle.symptoms}`;
        sections.push(`[Цикл]\n${cycleText}`);
    }

    // ── Предметы ──
    if (settings.sendItems !== false && Object.keys(state.items).length) {
        const itemLines = [];
        for (const [name, info] of Object.entries(state.items)) {
            let line = info.icon ? `${info.icon} ${name}` : name;
            if (info.holder) line += ` (у ${info.holder})`;
            itemLines.push(line);
        }
        sections.push(`[Инвентарь]\n${itemLines.join(', ')}`);
    }

    // ── Кошелёк ──
    if (settings.sendWallet !== false && state.wallet.balance !== 0) {
        sections.push(`[Кошелёк: ${state.wallet.balance}${state.wallet.currency}]`);
    }

    // ── NPC в сцене ──
    if (settings.sendNpcs !== false && state.characters?.length) {
        const npcLines = [];
        for (const char of state.characters) {
            const npc = state.npcs[char];
            if (npc) {
                let line = char;
                if (npc.relation) line += ` (${npc.relation})`;
                if (npc.personality) line += ` — ${npc.personality}`;
                npcLines.push(line);
            }
        }
        if (npcLines.length) {
            sections.push(`[NPC в сцене]\n${npcLines.join('\n')}`);
        }
    }

    // ── Симпатия NPC ──
    if (settings.sendAffection !== false && Object.keys(state.affection).length) {
        const affLines = [];
        for (const [name, data] of Object.entries(state.affection)) {
            affLines.push(`${name}: ${data.value}`);
        }
        sections.push(`[Симпатия]\n${affLines.join(' | ')}`);
    }

    // ── Ближайшие даты (для AI-контекста) ──
    if (settings.sendCalendar !== false) {
        const upcoming = buildUpcomingDates(state);
        if (upcoming) {
            sections.push(upcoming);
        }
    }

    return sections.join('\n\n');
}

/**
 * Собирает ближайшие даты (дни рождения, агенды) для AI-контекста.
 */
function buildUpcomingDates(state) {
    if (!state.time) return null;

    const events = [];

    // Дни рождения NPC
    for (const [name, npc] of Object.entries(state.npcs)) {
        if (npc.birthday) {
            events.push({ type: '🎂', text: `День рождения: ${name}`, date: npc.birthday });
        }
    }

    // Агенды
    for (const item of state.agenda) {
        if (!item.done && item.date) {
            events.push({ type: '📋', text: item.text, date: item.date });
        }
    }

    if (!events.length) return null;

    const lines = events.slice(0, 5).map(e => `${e.type} ${e.date} — ${e.text}`);
    return `[Ближайшие даты]\n${lines.join('\n')}`;
}

/**
 * Возвращает системный промпт (с кастомизацией).
 */
export function getSystemPrompt(settings) {
    return settings.customSystemPrompt || DEFAULT_SYSTEM_PROMPT;
}

/**
 * Собирает OOC-промпты от всех систем.
 * @param {SimsEngine} simsEngine
 * @param {object} state
 * @returns {string[]} — массив OOC-строк
 */
export function collectOOCPrompts(simsEngine, state) {
    const prompts = [];

    // Sims OOC (пороговые эффекты) — уже собраны в simsEngine при applyAIData
    // Здесь добавляем дополнительные

    // Опьянение → поведение
    if (state.intoxication?.value > 40) {
        const level = state.intoxication.value;
        if (level > 80) {
            prompts.push('[OOC: Персонаж сильно пьян — нечёткая речь, потеря координации, эмоциональная нестабильность.]');
        } else if (level > 60) {
            prompts.push('[OOC: Персонаж пьян — снижен самоконтроль, развязный язык, покачивается.]');
        } else {
            prompts.push('[OOC: Персонаж подвыпивший — расслаблен, слегка раскрепощён, может сболтнуть лишнее.]');
        }
    }

    // Травмы → ограничения
    for (const injury of state.injuries) {
        if (injury.severity === 'тяжёлый' || injury.severity === 'severe') {
            prompts.push(`[OOC: Серьёзная травма — ${injury.name}. Персонаж испытывает сильную боль, ограничен в движениях.]`);
        }
    }

    return prompts;
}
