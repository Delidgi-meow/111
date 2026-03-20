/**
 * Chronicle — Time Utilities
 * Парсинг дат, расчёт относительного времени, форматирование.
 */

const WEEKDAY_NAMES_RU = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const MONTH_NAMES_RU = [
    'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
];
const MONTH_NAMES_SHORT = [
    'Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн',
    'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'
];

/**
 * Парсит строку даты/времени из AI-тега.
 * Поддерживает: "2026/3/15 14:30", "2026/03/15", "2026-3-15 14:30"
 * @returns {{ year, month, day, hour, minute, date: Date } | null}
 */
export function parseStoryDateTime(str) {
    if (!str) return null;
    
    const match = str.match(
        /(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/
    );
    if (!match) return null;
    
    const year = parseInt(match[1]);
    const month = parseInt(match[2]);
    const day = parseInt(match[3]);
    const hour = match[4] ? parseInt(match[4]) : 12;
    const minute = match[5] ? parseInt(match[5]) : 0;
    
    const date = new Date(year, month - 1, day, hour, minute);
    
    return { year, month, day, hour, minute, date };
}

/**
 * Рассчитать относительное время между двумя строками.
 * @returns {string} — "2 часа назад", "вчера в 15:00", "3 дня назад"
 */
export function formatRelativeTime(fromStr, toStr) {
    const from = parseStoryDateTime(fromStr);
    const to = parseStoryDateTime(toStr);
    if (!from || !to) return '';
    
    const diffMs = to.date.getTime() - from.date.getTime();
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffMinutes < 1) return 'только что';
    if (diffMinutes < 60) return `${diffMinutes} мин. назад`;
    if (diffHours < 24) return `${diffHours} ч. назад`;
    if (diffDays === 1) return `вчера в ${pad2(from.hour)}:${pad2(from.minute)}`;
    if (diffDays < 7) return `${diffDays} дн. назад`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} нед. назад`;
    return `${from.day} ${MONTH_NAMES_SHORT[from.month - 1]}`;
}

/**
 * Рассчитать часы между двумя строками (для decay).
 */
export function hoursBetween(fromStr, toStr) {
    const from = parseStoryDateTime(fromStr);
    const to = parseStoryDateTime(toStr);
    if (!from || !to) return 0;
    
    const diffMs = to.date.getTime() - from.date.getTime();
    return Math.max(0, diffMs / (1000 * 60 * 60));
}

/**
 * Форматировать дату для отображения: "15 Мар 2026, Пн 14:30"
 */
export function formatDisplayDateTime(str) {
    const parsed = parseStoryDateTime(str);
    if (!parsed) return str || '—';
    
    const weekday = WEEKDAY_NAMES_RU[parsed.date.getDay()];
    const monthName = MONTH_NAMES_SHORT[parsed.month - 1];
    
    let result = `${parsed.day} ${monthName} ${parsed.year}, ${weekday}`;
    if (parsed.hour !== 12 || parsed.minute !== 0) {
        result += ` ${pad2(parsed.hour)}:${pad2(parsed.minute)}`;
    }
    
    return result;
}

/**
 * Получить данные для рендера календаря.
 * @param {number} year
 * @param {number} month — 1-12
 * @returns {{ monthName, year, days: Array<{ day, isToday, isOtherMonth, date }> }}
 */
export function getCalendarGrid(year, month) {
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);
    const daysInMonth = lastDay.getDate();
    
    // День недели первого дня (Пн=0, Вс=6)
    let startWeekday = firstDay.getDay() - 1;
    if (startWeekday < 0) startWeekday = 6;
    
    const days = [];
    
    // Дни предыдущего месяца
    const prevMonth = new Date(year, month - 1, 0);
    const prevDays = prevMonth.getDate();
    for (let i = startWeekday - 1; i >= 0; i--) {
        days.push({
            day: prevDays - i,
            isOtherMonth: true,
            date: `${year}/${month - 1}/${prevDays - i}`,
        });
    }
    
    // Дни текущего месяца
    for (let d = 1; d <= daysInMonth; d++) {
        days.push({
            day: d,
            isOtherMonth: false,
            date: `${year}/${month}/${d}`,
        });
    }
    
    // Дни следующего месяца (заполнить до 42 = 6 рядов)
    const remaining = 42 - days.length;
    for (let d = 1; d <= remaining; d++) {
        days.push({
            day: d,
            isOtherMonth: true,
            date: `${year}/${month + 1}/${d}`,
        });
    }
    
    return {
        monthName: MONTH_NAMES_RU[month - 1],
        year,
        days,
    };
}

/** Pad number to 2 digits */
function pad2(n) {
    return String(n).padStart(2, '0');
}

export { MONTH_NAMES_RU, MONTH_NAMES_SHORT, WEEKDAY_NAMES_RU };
