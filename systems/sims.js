/**
 * Chronicle — Sims System
 * Глубокая симуляция: голод, гигиена, сон, возбуждение.
 * 
 * AI выдаёт значения в тегах → код валидирует, применяет decay,
 * рассчитывает cross-stat эффекты, генерирует пороговые OOC.
 */

// ============================================
// Конфигурация статов
// ============================================

export const STAT_CONFIG = {
    hunger: {
        name: 'Голод',
        icon: 'fa-utensils',
        color: '#f59e0b',
        colorLow: '#ef4444',
        // Decay: единиц в час
        decayPerHour: 3,
        // Макс. дельта за ход без спец. причины
        maxDeltaPerTurn: 30,
        // Пороги → эффекты
        thresholds: [
            { at: 50, direction: 'below', label: 'голодный', severity: 'mild' },
            { at: 20, direction: 'below', label: 'слабость от голода', severity: 'moderate' },
            { at: 10, direction: 'below', label: 'критический голод', severity: 'severe' },
        ],
        // Описание для OOC-инъекции по severity
        oocTemplates: {
            mild: 'Персонаж голоден — лёгкое раздражение, мысли о еде.',
            moderate: 'Персонаж сильно голоден — слабость, головокружение, раздражительность. Снижена концентрация.',
            severe: 'Персонаж на грани обморока от голода — дрожь в руках, помутнение сознания, может упасть.',
        },
    },
    hygiene: {
        name: 'Гигиена',
        icon: 'fa-shower',
        color: '#60a5fa',
        colorLow: '#a78bfa',
        decayPerHour: 2,
        maxDeltaPerTurn: 30,
        thresholds: [
            { at: 40, direction: 'below', label: 'немытый', severity: 'mild' },
            { at: 20, direction: 'below', label: 'NPC замечают', severity: 'moderate' },
            { at: 10, direction: 'below', label: 'отталкивающий запах', severity: 'severe' },
        ],
        oocTemplates: {
            mild: 'Персонаж давно не мылся — лёгкий дискомфорт, может стесняться.',
            moderate: 'Гигиена персонажа заметно низкая — NPC могут реагировать, избегать близости.',
            severe: 'Крайне низкая гигиена — неприятный запах очевиден всем, персонаж чешется и испытывает зуд.',
        },
    },
    sleep: {
        name: 'Сон',
        icon: 'fa-bed',
        color: '#a78bfa',
        colorLow: '#6366f1',
        // Decay только когда персонаж бодрствует
        decayPerHour: 4,
        // Восстановление во сне: +12/час
        recoveryPerHour: 12,
        maxDeltaPerTurn: 35,
        thresholds: [
            { at: 30, direction: 'below', label: 'сонливый', severity: 'mild' },
            { at: 15, direction: 'below', label: 'рассеянный', severity: 'moderate' },
            { at: 5,  direction: 'below', label: 'засыпает', severity: 'severe' },
        ],
        oocTemplates: {
            mild: 'Персонаж хочет спать — зевает, снижена внимательность.',
            moderate: 'Персонаж сильно не выспался — путает слова, рассеян, раздражён, замедлен.',
            severe: 'Персонаж на грани отключения — глаза закрываются сами, может заснуть в любой момент.',
        },
    },
    arousal: {
        name: 'Возбуждение',
        icon: 'fa-fire',
        color: '#ec4899',
        colorLow: '#f472b6',
        // Возбуждение затухает медленнее
        decayPerHour: 1,
        maxDeltaPerTurn: 40,
        thresholds: [
            { at: 60, direction: 'above', label: 'возбуждён', severity: 'mild' },
            { at: 80, direction: 'above', label: 'сильно возбуждён', severity: 'moderate' },
            { at: 95, direction: 'above', label: 'не может думать', severity: 'severe' },
        ],
        oocTemplates: {
            mild: 'Персонаж возбуждён — учащённое дыхание, отвлекается, взгляд задерживается.',
            moderate: 'Персонаж сильно возбуждён — тяжело сосредоточиться на чём-то кроме объекта желания.',
            severe: 'Возбуждение критическое — персонаж с трудом контролирует себя, всё остальное отходит на второй план.',
        },
    },
};

// Все ключи статов
export const STAT_KEYS = Object.keys(STAT_CONFIG);

// ============================================
// Cross-stat эффекты
// ============================================

/**
 * Модификаторы cross-stat.
 * Проверяются ПОСЛЕ применения AI-значений.
 * Возвращают объект модификаторов { stat: delta }.
 */
const CROSS_STAT_EFFECTS = [
    {
        name: 'Недосып усиливает голод',
        condition: (stats) => stats.sleep < 20,
        apply: (stats) => ({
            // Голод падает на 50% быстрее при недосыпе (для decay)
            _hungerDecayMultiplier: 1.5,
        }),
    },
    {
        name: 'Низкая гигиена снижает возбуждение',
        condition: (stats) => stats.hygiene < 30,
        apply: (stats) => ({
            arousal: Math.max(0, stats.arousal - 10),
        }),
    },
    {
        name: 'Сильный голод мешает спать',
        condition: (stats) => stats.hunger < 15,
        apply: (stats) => ({
            // Сон восстанавливается хуже
            _sleepRecoveryMultiplier: 0.5,
        }),
    },
    {
        name: 'Высокое возбуждение мешает спать',
        condition: (stats) => stats.arousal > 80,
        apply: (stats) => ({
            _sleepRecoveryMultiplier: 0.6,
        }),
    },
    {
        name: 'Критический голод + недосып = обморок',
        condition: (stats) => stats.hunger < 10 && stats.sleep < 10,
        apply: () => ({
            _faintRisk: true,
        }),
    },
];

// ============================================
// SimsEngine class
// ============================================

export class SimsEngine {
    constructor() {
        /** @type {Object<string, number>} текущие значения статов */
        this.stats = {};
        /** @type {Object<string, string>} причины последнего изменения */
        this.reasons = {};
        /** @type {Array} история: [{ timestamp, stats, reasons }] */
        this.history = [];
        /** @type {Object} активные модификаторы от cross-stat */
        this.modifiers = {};
        /** @type {Set<string>} уже отправленные пороговые OOC (сбрасываются при выходе из порога) */
        this.firedThresholds = new Set();
        /** @type {string|null} последняя дата-время из тега time */
        this.lastTime = null;
    }

    // ----------------------------------------
    // Инициализация
    // ----------------------------------------
    
    /** Инициализировать с дефолтными значениями */
    init(initial = {}) {
        for (const key of STAT_KEYS) {
            this.stats[key] = initial[key] ?? 70;
            this.reasons[key] = '';
        }
        this.modifiers = {};
        this.firedThresholds.clear();
    }

    /** Загрузить сохранённое состояние */
    load(saved) {
        if (!saved) return;
        this.stats = { ...saved.stats };
        this.reasons = { ...saved.reasons };
        this.history = saved.history || [];
        this.modifiers = saved.modifiers || {};
        this.firedThresholds = new Set(saved.firedThresholds || []);
        this.lastTime = saved.lastTime || null;
    }

    /** Сериализовать для сохранения */
    serialize() {
        return {
            stats: { ...this.stats },
            reasons: { ...this.reasons },
            history: this.history.slice(-100), // Хранить последние 100 записей
            modifiers: { ...this.modifiers },
            firedThresholds: [...this.firedThresholds],
            lastTime: this.lastTime,
        };
    }

    // ----------------------------------------
    // Применение AI-данных
    // ----------------------------------------

    /**
     * Применить данные из спарсенного <sims> тега.
     * @param {Object} simsData — результат parseSims()
     * @param {string} currentTime — текущее время из <world> тега
     * @returns {{ warnings: string[], oocPrompts: string[] }}
     */
    applyAIData(simsData, currentTime = null) {
        const warnings = [];
        const oocPrompts = [];

        // 1. Рассчитать decay по времени (если время изменилось)
        if (currentTime && this.lastTime) {
            const hoursPassed = this._calculateHoursBetween(this.lastTime, currentTime);
            if (hoursPassed > 0) {
                this._applyDecay(hoursPassed);
            }
        }
        if (currentTime) {
            this.lastTime = currentTime;
        }

        // 2. Применить AI-значения с валидацией
        for (const [key, data] of Object.entries(simsData)) {
            if (!STAT_CONFIG[key]) continue;
            
            const config = STAT_CONFIG[key];
            const oldValue = this.stats[key] ?? 70;
            let newValue = data.value;
            
            // Валидация: clamp 0-100
            newValue = Math.max(0, Math.min(100, newValue));
            
            // Проверка дельты
            const delta = Math.abs(newValue - oldValue);
            if (delta > config.maxDeltaPerTurn) {
                if (data.reason) {
                    // Есть причина — принимаем с warning
                    warnings.push(
                        `${config.name}: Δ${delta > 0 ? '+' : ''}${newValue - oldValue} ` +
                        `(макс. ±${config.maxDeltaPerTurn}). Причина: "${data.reason}" — принято.`
                    );
                } else {
                    // Нет причины — ограничиваем
                    const clampedDelta = config.maxDeltaPerTurn * Math.sign(newValue - oldValue);
                    newValue = oldValue + clampedDelta;
                    warnings.push(
                        `${config.name}: Δ${delta} без причины, ограничено до ±${config.maxDeltaPerTurn}.`
                    );
                }
            }
            
            this.stats[key] = newValue;
            this.reasons[key] = data.reason || '';
        }

        // 3. Cross-stat эффекты
        this._applyCrossStats();

        // 4. Пороговые проверки → OOC
        for (const key of STAT_KEYS) {
            const config = STAT_CONFIG[key];
            const value = this.stats[key];
            
            for (const threshold of config.thresholds) {
                const thresholdId = `${key}_${threshold.at}_${threshold.direction}`;
                const isTriggered = threshold.direction === 'below' 
                    ? value < threshold.at 
                    : value > threshold.at;
                
                if (isTriggered && !this.firedThresholds.has(thresholdId)) {
                    // Порог пересечён впервые → генерируем OOC
                    this.firedThresholds.add(thresholdId);
                    const template = config.oocTemplates[threshold.severity];
                    if (template) {
                        oocPrompts.push(
                            `[OOC: ${config.name} = ${value}/100 (${threshold.label}). ${template}]`
                        );
                    }
                } else if (!isTriggered && this.firedThresholds.has(thresholdId)) {
                    // Вышли из порога → сбрасываем
                    this.firedThresholds.delete(thresholdId);
                }
            }
        }

        // 5. Специальные эффекты
        if (this.modifiers._faintRisk) {
            oocPrompts.push(
                '[OOC: КРИТИЧЕСКОЕ СОСТОЯНИЕ — голод и сон на минимуме. ' +
                'Персонаж может потерять сознание в любой момент. ' +
                'Его движения замедлены, речь путаная, зрение плывёт.]'
            );
        }

        // 6. Запись в историю
        this.history.push({
            timestamp: currentTime || new Date().toISOString(),
            stats: { ...this.stats },
            reasons: { ...this.reasons },
        });

        return { warnings, oocPrompts };
    }

    // ----------------------------------------
    // Decay
    // ----------------------------------------

    /** Применить time-based decay */
    _applyDecay(hours) {
        const clampedHours = Math.min(hours, 24); // Макс. 24 часа decay за раз
        
        for (const key of STAT_KEYS) {
            const config = STAT_CONFIG[key];
            let decayRate = config.decayPerHour;
            
            // Модификаторы decay от cross-stat
            const multiplierKey = `_${key}DecayMultiplier`;
            if (this.modifiers[multiplierKey]) {
                decayRate *= this.modifiers[multiplierKey];
            }
            
            const decay = decayRate * clampedHours;
            
            // Возбуждение: decay к нулю (затухание)
            if (key === 'arousal') {
                this.stats[key] = Math.max(0, this.stats[key] - decay);
            } else {
                // Остальные: decay вниз
                this.stats[key] = Math.max(0, this.stats[key] - decay);
            }
        }
    }

    // ----------------------------------------
    // Cross-stat
    // ----------------------------------------

    /** Пересчитать cross-stat эффекты */
    _applyCrossStats() {
        this.modifiers = {};
        
        for (const effect of CROSS_STAT_EFFECTS) {
            if (effect.condition(this.stats)) {
                const mods = effect.apply(this.stats);
                for (const [key, value] of Object.entries(mods)) {
                    if (key.startsWith('_')) {
                        // Модификатор — сохраняем
                        this.modifiers[key] = value;
                    } else if (STAT_KEYS.includes(key)) {
                        // Прямое изменение стата
                        this.stats[key] = Math.max(0, Math.min(100, value));
                    }
                }
            }
        }
    }

    // ----------------------------------------
    // Утилиты
    // ----------------------------------------

    /** Рассчитать часы между двумя временны́ми строками */
    _calculateHoursBetween(timeA, timeB) {
        const parseTime = (str) => {
            // Ожидаем формат "YYYY/M/D H:MM" или "YYYY/M/D"
            const match = str.match(/(\d{4})\/?(\d{1,2})\/?(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/);
            if (!match) return null;
            return new Date(
                parseInt(match[1]),
                parseInt(match[2]) - 1,
                parseInt(match[3]),
                parseInt(match[4] || '12'),
                parseInt(match[5] || '0')
            );
        };
        
        const dateA = parseTime(timeA);
        const dateB = parseTime(timeB);
        
        if (!dateA || !dateB) return 0;
        
        const diffMs = dateB.getTime() - dateA.getTime();
        return Math.max(0, diffMs / (1000 * 60 * 60));
    }

    /** Получить текущий уровень (label) стата */
    getStatLevel(key) {
        const config = STAT_CONFIG[key];
        if (!config) return null;
        
        const value = this.stats[key] ?? 70;
        
        // Сортируем пороги по строгости (severe → mild)
        const sorted = [...config.thresholds].sort((a, b) => {
            if (a.direction === 'below') return a.at - b.at;
            return b.at - a.at;
        });
        
        for (const t of sorted) {
            const triggered = t.direction === 'below' ? value < t.at : value > t.at;
            if (triggered) return t;
        }
        
        return null;
    }

    /** Получить цвет бара стата */
    getStatColor(key) {
        const config = STAT_CONFIG[key];
        if (!config) return '#888';
        
        const value = this.stats[key] ?? 70;
        const level = this.getStatLevel(key);
        
        if (level && (level.severity === 'severe' || level.severity === 'moderate')) {
            return config.colorLow;
        }
        
        return config.color;
    }

    /** Получить процент для отрисовки бара */
    getStatPercent(key) {
        return Math.max(0, Math.min(100, this.stats[key] ?? 70));
    }

    /**
     * Генерирует суммарный промпт-инъекцию для текущего состояния.
     * Включает только статы с заметными эффектами.
     */
    buildContextPrompt() {
        const lines = [];
        
        for (const key of STAT_KEYS) {
            const config = STAT_CONFIG[key];
            const value = this.stats[key];
            const reason = this.reasons[key];
            
            let line = `${config.name}: ${value}/100`;
            if (reason) line += ` (${reason})`;
            
            const level = this.getStatLevel(key);
            if (level) line += ` [${level.label}]`;
            
            lines.push(line);
        }
        
        return `[Статы персонажа: ${lines.join('; ')}]`;
    }
}

// Экспорт синглтона
export const simsEngine = new SimsEngine();
