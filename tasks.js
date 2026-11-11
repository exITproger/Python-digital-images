/* ============================================================
   ВСЕ ПРАКТИЧЕСКИЕ ЗАДАНИЯ КУРСА + структурный анализатор кода.
   Пустые строки, комментарии и ширина отступов не важны —
   важны команды и то, внутри каких циклов/функций они стоят.
   Цвета и размеры не оцениваются (кроме заданий, где
   размер — суть рисунка, например мишень).
   ============================================================ */
'use strict';

/* ================= Разбор структуры кода ================= */

function stripComments(src) {
    let out = '', quote = null;
    for (let i = 0; i < src.length; i++) {
        const c = src[i];
        if (quote) {
            out += c;
            if (c === '\\') { out += src[i + 1] || ''; i++; }
            else if (c === quote) quote = null;
        } else if (c === '"' || c === "'") {
            quote = c; out += c;
        } else if (c === '#') {
            while (i < src.length && src[i] !== '\n') i++;
            out += '\n';
        } else out += c;
    }
    return out;
}

function analyze(raw) {
    const src = stripComments(raw);
    const lines = [];
    src.split('\n').forEach((t, i) => {
        const text = t.trim();
        if (!text) return;
        const indent = t.match(/^[ \t]*/)[0].replace(/\t/g, '    ').length;
        lines.push({ text, indent, no: i + 1, children: [] });
    });
    const root = { text: '', indent: -1, children: [] };
    const stack = [root];
    for (const l of lines) {
        while (stack.length > 1 && l.indent <= stack[stack.length - 1].indent) stack.pop();
        stack[stack.length - 1].children.push(l);
        if (/:\s*$/.test(l.text)) stack.push(l);
    }
    const env = {};
    const lists = {};
    lines.forEach(l => {
        const m = l.text.match(/^(\w+)\s*=\s*(-?\d+)\s*$/);
        if (m) env[m[1]] = Number(m[2]);
        const ml = l.text.match(/^(\w+)\s*=\s*\[(.*)\]\s*$/);
        if (ml) lists[ml[1]] = listItems(ml[2]);
    });
    return { src, lines, root, env, lists };
}

/* Число элементов в списке (учитывает вложенные скобки и кавычки). */
function listItems(s) {
    s = s.trim();
    if (!s) return 0;
    let depth = 0, q = null, n = 1;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
        if (c === '"' || c === "'") q = c;
        else if (c === '(' || c === '[' || c === '{') depth++;
        else if (c === ')' || c === ']' || c === '}') depth--;
        else if (c === ',' && depth === 0) n++;
    }
    return n;
}

function walk(node, fn) { fn(node); node.children.forEach(c => walk(c, fn)); }
function allNodes(a) { const out = []; walk(a.root, n => { if (n.text) out.push(n); }); return out; }
function bodyText(node) { let s = ''; walk(node, n => { if (n !== node && n.text) s += n.text + '\n'; }); return s; }
function countIn(text, name) { return (text.match(new RegExp('\\b' + name + '\\s*\\(', 'g')) || []).length; }
function blocks(a, re) { return allNodes(a).filter(n => re.test(n.text)); }

function rangeFactor(a, text) {
    const m = text.match(/\brange\s*\(([^)]*)\)/);
    if (!m) return null;
    const args = m[1].split(',').map(s => s.trim()).map(s => /^-?\d+$/.test(s) ? Number(s) : (s in a.env ? a.env[s] : NaN));
    if (args.some(isNaN)) return null;
    let start = 0, stop, step = 1;
    if (args.length === 1) stop = args[0];
    else { start = args[0]; stop = args[1]; if (args.length > 2) step = args[2]; }
    if (step === 0) return null;
    return Math.max(0, Math.ceil((stop - start) / step));
}

/* Множитель цикла: range(...) или список (переменная-список или литерал). */
function loopFactor(a, text) {
    const f = rangeFactor(a, text);
    if (f !== null) return f;
    if (!/^for\b/.test(text)) return null;
    const inline = text.match(/\bin\s*\[([^\]]*)\]/);
    if (inline) return listItems(inline[1]);
    const v = text.match(/\bin\s+(\w+)\s*:/);
    if (v && a.lists && v[1] in a.lists) return a.lists[v[1]];
    return null;
}

/* Сколько раз команда реально выполнится (циклы с известным числом повторений раскрываются).
   Заголовки def не считаются вызовами; у узла-цикла применяется его собственный множитель. */
function effCalls(a, name, node) {
    node = node || a.root;
    let total = /^def\b/.test(node.text) ? 0 : countIn(node.text, name);
    for (const c of node.children) total += effCalls(a, name, c);
    if (/^for\b/.test(node.text)) {
        const f = loopFactor(a, node.text);
        total *= (f === null ? 1 : f);
    }
    return Math.min(total, 100000);
}

const hasImportTurtle = a => /(^|\n)\s*(import\s+turtle|from\s+turtle\s+import)/.test(a.src);
const hasTurtle = a => /\bTurtle\s*\(/.test(a.src);
const hasImportRandom = a => /(^|\n)\s*import\s+random\b/.test(a.src);
/* Цвета считаются и внутри функций: если функцию вызывают N раз, её цвета учитываются N раз. */
function colorCalls(a) {
    function outsideDefs(node) {
        if (/^def\b/.test(node.text)) return 0;
        let t = countIn(node.text, 'pencolor') + countIn(node.text, 'color') + countIn(node.text, 'fillcolor');
        for (const c of node.children) t += outsideDefs(c);
        if (/^for\b/.test(node.text)) {
            const f = loopFactor(a, node.text);
            t *= (f === null ? 1 : f);
        }
        return t;
    }
    let total = outsideDefs(a.root);
    for (const d of defBlocks(a)) {
        const calls = effCalls(a, defName(d));
        const inside = effCalls(a, 'pencolor', d) + effCalls(a, 'color', d) + effCalls(a, 'fillcolor', d);
        total += calls * inside;
    }
    return total;
}
const hasRandom = a => /\brandom\s*\.\s*(randint|choice|random|uniform|randrange)\s*\(/.test(a.src);
const hasClickBinding = a => /\b(onscreenclick|onclick)\s*\(\s*\w+/.test(a.src);
const hasListen = a => /\blisten\s*\(/.test(a.src);

function defBlocks(a) { return blocks(a, /^def\s+\w+\s*\(/); }
function defParams(node) {
    const m = node.text.match(/^def\s+\w+\s*\(([^)]*)\)/);
    return m && m[1].trim() ? m[1].split(',').map(s => s.trim()) : [];
}
function defName(node) { const m = node.text.match(/^def\s+(\w+)/); return m ? m[1] : ''; }
function bigLoop(a, min) {
    return blocks(a, /^for\s+\w+\s+in\s+range\s*\(/).find(n => {
        const f = rangeFactor(a, n.text);
        return f === null ? false : f >= min;
    });
}
function loopWithFactor(a, min, max) {
    return blocks(a, /^for\s+\w+\s+in\s+range\s*\(/).find(n => {
        const f = rangeFactor(a, n.text);
        return f !== null && f >= min && (max == null || f <= max);
    });
}
function keyList(a) {
    const out = [], re = /\bonkey(?:press)?\s*\(\s*[\w.]+\s*,\s*["']([^"']+)["']/g;
    let m; while ((m = re.exec(a.src))) out.push(m[1]);
    return out;
}
function colorList(a, min) {
    const m = a.src.match(/\w+\s*=\s*\[([^\]]*)\]/);
    return !!m && (m[1].match(/["'][^"']+["']/g) || []).length >= min;
}
function rgbIn(node) { return /\b(pencolor|color|fillcolor)\s*\([^)]*,[^)]*,/.test(bodyText(node)); }
function dotSizes(a) {
    const out = [], re = /\bdot\s*\(\s*(\d+)/g;
    let m; while ((m = re.exec(a.src))) out.push(Number(m[1]));
    return out;
}
/* Число поворотов на заданный угол с раскрытием циклов. */
function turnsEff(a, angle) {
    const re = new RegExp('\\b(left|right)\\s*\\(\\s*' + angle + '\\b', 'g');
    function count(node) {
        let t = (node.text.match(re) || []).length;
        for (const c of node.children) t += count(c);
        if (/^for\b/.test(node.text)) {
            const f = loopFactor(a, node.text);
            t *= (f === null ? 1 : f);
        }
        return t;
    }
    return count(a.root);
}

/* ================= УРОК 1 • Фигуры по очереди ================= */

const LESSONS = [
{ n: 1, title: 'Фигуры по очереди', tasks: [
    { id: '1-1', tag: 'Разминка 1', title: 'Первый квадрат 100×100',
      task: 'Создай черепашку, задай форму turtle и нарисуй квадрат: 4 раза «шаг вперёд 100 + поворот налево 90». Каждая команда — с новой строки.',
      checks: [
        { label: 'Подключён модуль turtle', hint: 'Добавь import turtle в начало программы.', test: hasImportTurtle },
        { label: 'Создана черепашка Turtle()', hint: 'Нужна строка t = turtle.Turtle().', test: hasTurtle },
        { label: 'Форма черепашки: shape("turtle")', hint: 'Добавь t.shape("turtle"), чтобы курсор стал черепашкой.', test: a => /\bshape\s*\(\s*["']turtle["']\s*\)/.test(a.src) },
        { label: '4 стороны: минимум 4 шага forward', hint: 'У квадрата 4 стороны — нужно 4 команды t.forward(100).', test: a => effCalls(a, 'forward') >= 4 },
        { label: '4 угла: минимум 4 поворота на 90°', hint: 'После каждой стороны поворачивай: t.left(90). Всего 4 раза.', test: a => turnsEff(a, 90) >= 4 },
    ]},
    { id: '1-2', tag: 'ГЛАВНОЕ ЗАДАНИЕ 1', title: 'Парад фигур: квадрат, треугольник, круг',
      task: 'Нарисуй по очереди синий квадрат (80), оранжевый треугольник (угол 120°) и малиновый круг. Между фигурами переходи без следа: penup → forward → pendown.',
      checks: [
        { label: 'Подключён модуль turtle', hint: 'Добавь import turtle в начало программы.', test: hasImportTurtle },
        { label: 'Создана черепашка Turtle()', hint: 'Нужна строка t = turtle.Turtle().', test: hasTurtle },
        { label: 'Стороны фигур: минимум 7 шагов forward', hint: 'Квадрат — 4 стороны и треугольник — 3: всего минимум 7 команд t.forward(...) (циклы тоже считаются).', test: a => effCalls(a, 'forward') >= 7 },
        { label: 'Повороты на углах: минимум 6 команд left/right', hint: 'У квадрата 4 угла и у треугольника 3 — нужно минимум 6 поворотов.', test: a => effCalls(a, 'left') + effCalls(a, 'right') >= 6 },
        { label: 'Углы квадрата 90° и треугольника 120°', hint: 'Для квадрата поворачивай на 90, для треугольника на 120 (или используй формулу 360 / число сторон).', test: a => (turnsEff(a, 90) >= 4 || /360\s*\//.test(a.src)) && (turnsEff(a, 120) >= 3 || /360\s*\//.test(a.src)) },
        { label: 'Третья фигура — круг: circle() или dot()', hint: 'Нарисуй круг: t.circle(40) или t.dot(...).', test: a => /\b(circle|dot)\s*\(/.test(a.src) },
        { label: 'Переходы без следа: penup() и pendown()', hint: 'Между фигурами: t.penup(), перейти, t.pendown().', test: a => /\bpenup\s*\(/.test(a.src) && /\bpendown\s*\(/.test(a.src) },
        { label: 'Смена цвета минимум 2 раза', hint: 'Перед каждой фигурой меняй цвет: t.pencolor(...) или t.color(...). Сами цвета любые!', test: a => colorCalls(a) >= 2 },
    ]},
    { id: '1-3', tag: 'Практика 2', title: 'Весёлый светофор из трёх кругов',
      task: 'Поставь три закрашенных круга через t.dot(60, цвет): красный, жёлтый, зелёный. Между сигналами подними перо, поверни вниз и проползи 70 пикселей.',
      checks: [
        { label: 'Подключён модуль turtle', hint: 'Добавь import turtle.', test: hasImportTurtle },
        { label: 'Создана черепашка Turtle()', hint: 'Нужна строка t = turtle.Turtle().', test: hasTurtle },
        { label: 'Три сигнала: минимум 3 команды dot()', hint: 'Каждый круг светофора — это t.dot(60, "цвет"). Нужно 3 штуки.', test: a => effCalls(a, 'dot') >= 3 },
        { label: 'Каждый сигнал своего цвета: dot(размер, цвет)', hint: 'Передавай цвет вторым аргументом: t.dot(60, "red"), t.dot(60, "gold"), t.dot(60, "limegreen").', test: a => (a.src.match(/\bdot\s*\([^)]*,/g) || []).length >= 3 },
        { label: 'Переходы без следа: penup()', hint: 'Перед движением между кругами подними перо: t.penup().', test: a => /\bpenup\s*\(/.test(a.src) },
        { label: 'Поворот вниз и шаги между кругами', hint: 'Поверни вниз t.right(90) и шагай t.forward(70) между сигналами (минимум 2 шага).', test: a => /\b(right\s*\(\s*90|setheading\s*\(\s*270)/.test(a.src) && effCalls(a, 'forward') >= 2 },
    ]},
    { id: '1-4', tag: 'Практика 3', title: 'Домик: стены и крыша с заливкой',
      task: 'Нарисуй квадрат стен 120 с заливкой (begin_fill / end_fill), поднимись наверх по стене и нарисуй треугольную крышу 120° тоже с заливкой. Цвет пера и заливки задавай через t.color(перо, заливка).',
      checks: [
        { label: 'Подключён модуль turtle', hint: 'Добавь import turtle.', test: hasImportTurtle },
        { label: 'Создана черепашка Turtle()', hint: 'Нужна строка t = turtle.Turtle().', test: hasTurtle },
        { label: 'Заливка двух частей: begin_fill() и end_fill() по 2 раза', hint: 'Оберни и стены, и крышу: t.begin_fill() перед рисованием и t.end_fill() после.', test: a => effCalls(a, 'begin_fill') >= 2 && effCalls(a, 'end_fill') >= 2 },
        { label: 'Цвет пера и заливки: color(перо, заливка) минимум 2 раза', hint: 'Задавай два цвета сразу: t.color("sienna", "moccasin") для стен и t.color("darkred", "crimson") для крыши.', test: a => (a.src.match(/\bcolor\s*\([^)]*,/g) || []).length >= 2 },
        { label: 'Стены + подъём + крыша: минимум 8 шагов forward', hint: '4 стороны стен + подъём наверх + 3 стороны крыши = минимум 8 команд forward.', test: a => effCalls(a, 'forward') >= 8 },
        { label: 'Углы: 4 поворота по 90° и 3 поворота по 120°', hint: 'Стены — квадрат (90°), крыша — треугольник (120°).', test: a => turnsEff(a, 90) >= 4 && turnsEff(a, 120) >= 3 },
    ]},
    { id: '1-5', tag: 'Бонус ⭐', title: 'Снеговик из трёх снежных комов',
      task: 'На тёмном фоне нарисуй снеговика: три белых кома через dot() (120, 90 и 60), поднимаясь вверх, и оранжевый нос-морковку dot(12, "orange").',
      checks: [
        { label: 'Подключён модуль turtle', hint: 'Добавь import turtle.', test: hasImportTurtle },
        { label: 'Создана черепашка Turtle()', hint: 'Нужна строка t = turtle.Turtle().', test: hasTurtle },
        { label: 'Цветной фон: bgcolor(...)', hint: 'Включи тёмный фон: turtle.bgcolor("midnightblue").', test: a => /\bbgcolor\s*\(/.test(a.src) },
        { label: 'Без следов между комами: penup()', hint: 'Снеговики рисуются точками — подними перо: t.penup().', test: a => /\bpenup\s*\(/.test(a.src) },
        { label: 'Три кома + нос: минимум 4 команды dot()', hint: 'Нижний ком, средний, голова и нос — всего минимум 4 точки.', test: a => effCalls(a, 'dot') >= 4 },
        { label: 'Подъём между комами: минимум 2 шага forward', hint: 'Переходи вверх между комами: t.left(90) и t.forward(...).', test: a => effCalls(a, 'forward') >= 2 },
        { label: 'Нос-морковка своего цвета', hint: 'Нос задай цветом прямо в точке: t.dot(12, "orange").', test: a => /\bdot\s*\([^)]*,/.test(a.src) },
    ]},
]},

/* ================= УРОК 2 • Циклы и узоры ================= */

{ n: 2, title: 'Циклы и Узоры', tasks: [
    { id: '2-1', tag: 'Задание 1', title: 'Три многоугольника через цикл',
      task: 'Нарисуй циклом for пятиугольник (5 сторон), шестиугольник (6) и восьмиугольник (8). Угол поворота = 360 / число сторон. Между фигурами — переходы penup/pendown и разные цвета.',
      checks: [
        { label: 'Подключён модуль turtle', hint: 'Добавь import turtle.', test: hasImportTurtle },
        { label: 'Создана черепашка Turtle()', hint: 'Нужна строка t = turtle.Turtle().', test: hasTurtle },
        { label: 'Фигуры рисуются циклом for ... in range', hint: 'Вместо повторения команд используй цикл: for i in range(sides):', test: a => blocks(a, /^for\s+\w+\s+in\s+range\s*\(/).length > 0 },
        { label: 'Угол по формуле 360 / число сторон', hint: 'Поворачивай на t.left(360 / sides) — тогда цикл подходит для любой фигуры.', test: a => blocks(a, /^for\b/).some(l => /360\s*\//.test(bodyText(l))) },
        { label: 'Все стороны трёх фигур: минимум 15 шагов forward', hint: '5 + 6 + 8 = 19 сторон. Циклы раскрываются — нужно минимум 15 шагов.', test: a => effCalls(a, 'forward') >= 15 },
        { label: 'Переходы без следа: penup() и pendown()', hint: 'Между фигурами поднимай перо, переходи вправо и опускай.', test: a => /\bpenup\s*\(/.test(a.src) && /\bpendown\s*\(/.test(a.src) },
        { label: 'Разные цвета фигур: минимум 2 смены цвета', hint: 'Меняй цвет перед каждой фигурой: t.color(...) или t.pencolor(...).', test: a => colorCalls(a) >= 2 },
    ]},
    { id: '2-2', tag: 'Задание 2', title: 'Золотая пятиконечная звезда',
      task: 'На ночном фоне нарисуй звезду с заливкой: цикл на 5 повторений, шаг 150 и поворот 144°. Цвет пера и заливки — через t.color(перо, заливка).',
      checks: [
        { label: 'Подключён модуль turtle', hint: 'Добавь import turtle.', test: hasImportTurtle },
        { label: 'Создана черепашка Turtle()', hint: 'Нужна строка t = turtle.Turtle().', test: hasTurtle },
        { label: 'Ночное небо: bgcolor(...)', hint: 'Включи тёмный фон: turtle.bgcolor("midnightblue").', test: a => /\bbgcolor\s*\(/.test(a.src) },
        { label: 'Цикл ровно на 5 лучей: for ... in range(5)', hint: 'У звезды 5 лучей: for i in range(5):', test: a => !!loopWithFactor(a, 5, 5) },
        { label: 'Внутри цикла: шаг forward и поворот на 144°', hint: 'В теле цикла: t.forward(150) и t.left(144).', test: a => { const l = loopWithFactor(a, 5, 5); return !!l && /\bforward\s*\(/.test(bodyText(l)) && /\b(left|right)\s*\(\s*144\b/.test(bodyText(l)); } },
        { label: 'Заливка: color(перо, заливка) + begin_fill/end_fill', hint: 'Задай два цвета t.color("orange", "gold") и оберни цикл в t.begin_fill() / t.end_fill().', test: a => /\bcolor\s*\([^)]*,/.test(a.src) && /\bbegin_fill\s*\(/.test(a.src) && /\bend_fill\s*\(/.test(a.src) },
    ]},
    { id: '2-3', tag: 'Задание 3', title: 'Кружевной цветок из 12 квадратов',
      task: 'Вложенные циклы: внешний на 12 лепестков, внутри — квадрат циклом на 4 стороны (поворот 90°). После каждого квадрата поверни на 30°.',
      checks: [
        { label: 'Подключён модуль turtle', hint: 'Добавь import turtle.', test: hasImportTurtle },
        { label: 'Создана черепашка Turtle()', hint: 'Нужна строка t = turtle.Turtle().', test: hasTurtle },
        { label: 'Внешний цикл: минимум 8 лепестков', hint: 'Внешний цикл: for i in range(12):', test: a => !!bigLoop(a, 8) },
        { label: 'Вложенный цикл: квадрат внутри цветка', hint: 'Внутри внешнего цикла напиши ещё один цикл: for j in range(4):', test: a => { const l = bigLoop(a, 8); return !!l && blocks({ root: l, env: a.env }, /^for\b/).length > 0; } },
        { label: 'Внутри вложенного цикла: стороны квадрата (forward + left 90°)', hint: 'Квадрат рисуется так: t.forward(90) и t.left(90) внутри внутреннего цикла.', test: a => { const l = bigLoop(a, 8); if (!l) return false; return blocks({ root: l, env: a.env }, /^for\b/).some(inner => { const b = bodyText(inner); return /\bforward\s*\(/.test(b) && /\b(left|right)\s*\(\s*90\b/.test(b); }); } },
        { label: 'Поворот лепестка после квадрата', hint: 'После внутреннего цикла поверни для следующего лепестка: t.left(30).', test: a => { const l = bigLoop(a, 8); return !!l && (countIn(bodyText(l), 'left') + countIn(bodyText(l), 'right')) >= 2; } },
    ]},
    { id: '2-4', tag: 'Задание 4', title: 'Спираль-туннель с растущим шагом',
      task: 'Цикл на 60+ шагов: шаг вперёд растёт (i * 4), поворот 90°. Попробуй угол 89 или 91 — спираль закрутится в 3D-туннель!',
      checks: [
        { label: 'Подключён модуль turtle', hint: 'Добавь import turtle.', test: hasImportTurtle },
        { label: 'Создана черепашка Turtle()', hint: 'Нужна строка t = turtle.Turtle().', test: hasTurtle },
        { label: 'Большой цикл: минимум 40 шагов', hint: 'Спираль: for i in range(60):', test: a => !!bigLoop(a, 40) },
        { label: 'Внутри цикла: растущий шаг forward(i * ...)', hint: 'Шаг должен расти вместе с i: t.forward(i * 4).', test: a => { const l = bigLoop(a, 40); return !!l && /\bforward\s*\([^)]*\*/.test(bodyText(l)); } },
        { label: 'Внутри цикла: поворот left() / right()', hint: 'Добавь поворот: t.left(90), t.left(89) или t.left(91).', test: a => { const l = bigLoop(a, 40); return !!l && /\b(left|right)\s*\(/.test(bodyText(l)); } },
    ]},
    { id: '2-5', tag: 'Проект Урока 2', title: 'Радужная спираль 🌈',
      task: 'Список из 6 цветов радуги + цикл на 80 шагов: цвет через остаток colors[i % 6], растущий шаг i * 3 и поворот 59°.',
      checks: [
        { label: 'Подключён модуль turtle', hint: 'Добавь import turtle.', test: hasImportTurtle },
        { label: 'Создана черепашка Turtle()', hint: 'Нужна строка t = turtle.Turtle().', test: hasTurtle },
        { label: 'Большой цикл: for ... in range (минимум 20 шагов)', hint: 'Спираль рисуется циклом, например for i in range(80):', test: a => !!bigLoop(a, 20) },
        { label: 'Список минимум из 3 цветов', hint: 'Создай список: colors = ["red", "orange", "gold", ...].', test: a => colorList(a, 3) },
        { label: 'Внутри цикла: цвет через остаток colors[i % ...]', hint: 'В теле цикла меняй цвет: t.pencolor(colors[i % 6]).', test: a => { const l = bigLoop(a, 20); return !!l && /\b(pencolor|color)\s*\([^)]*%/.test(bodyText(l)); } },
        { label: 'Внутри цикла: растущий шаг forward(i * ...)', hint: 'В теле цикла шаг должен расти: t.forward(i * 3).', test: a => { const l = bigLoop(a, 20); return !!l && /\bforward\s*\([^)]*\*/.test(bodyText(l)); } },
        { label: 'Внутри цикла: поворот left() / right()', hint: 'В теле цикла добавь поворот, например t.left(59).', test: a => { const l = bigLoop(a, 20); return !!l && /\b(left|right)\s*\(/.test(bodyText(l)); } },
    ]},
    { id: '2-6', tag: 'Бонус ⭐', title: 'Звёздный вихрь (спираль из звёзд)',
      task: 'Та же радужная спираль, но угол поворота — звёздный: 145°. Подбери 4 своих любимых цвета в списке.',
      checks: [
        { label: 'Подключён модуль turtle', hint: 'Добавь import turtle.', test: hasImportTurtle },
        { label: 'Создана черепашка Turtle()', hint: 'Нужна строка t = turtle.Turtle().', test: hasTurtle },
        { label: 'Список минимум из 3 цветов', hint: 'Создай список своих цветов: colors = ["deeppink", "cyan", "gold", ...].', test: a => colorList(a, 3) },
        { label: 'Большой цикл: минимум 40 шагов', hint: 'Вихрь: for i in range(70):', test: a => !!bigLoop(a, 40) },
        { label: 'Внутри цикла: цвет через остаток colors[i % ...]', hint: 'Меняй цвет в цикле: t.pencolor(colors[i % 4]).', test: a => { const l = bigLoop(a, 40); return !!l && /\b(pencolor|color)\s*\([^)]*%/.test(bodyText(l)); } },
        { label: 'Внутри цикла: растущий шаг forward(i * ...)', hint: 'Шаг растёт: t.forward(i * 4).', test: a => { const l = bigLoop(a, 40); return !!l && /\bforward\s*\([^)]*\*/.test(bodyText(l)); } },
        { label: 'Звёздный угол поворота: 144–146°', hint: 'Секрет звезды: t.left(145) вместо 59.', test: a => { const l = bigLoop(a, 40); return !!l && /\b(left|right)\s*\(\s*14[456]\b/.test(bodyText(l)); } },
    ]},
]},

/* ================= УРОК 3 • Координаты (X, Y) ================= */

{ n: 3, title: 'Координаты (X, Y)', tasks: [
    { id: '3-1', tag: 'Задание 1', title: 'Созвездие Большой Ковш',
      task: 'На тёмном небе соедини 7 звёзд ковша: прыгай goto(x, y), ставь точку dot() и веди линию к следующей звезде. Не забудь penup/pendown.',
      checks: [
        { label: 'Подключён модуль turtle', hint: 'Добавь import turtle.', test: hasImportTurtle },
        { label: 'Создана черепашка Turtle()', hint: 'Нужна строка t = turtle.Turtle().', test: hasTurtle },
        { label: 'Ночное небо: bgcolor(...)', hint: 'Сделай фон тёмно-синим: turtle.bgcolor("midnightblue").', test: a => /\bbgcolor\s*\(/.test(a.src) },
        { label: '7 звёзд: минимум 7 прыжков goto(x, y)', hint: 'Каждая звезда созвездия — переход в свою точку: t.goto(x, y).', test: a => effCalls(a, 'goto') >= 7 },
        { label: '7 звёзд: минимум 7 точек dot()', hint: 'В каждой точке ставь звезду: t.dot(12, "gold").', test: a => effCalls(a, 'dot') >= 7 },
        { label: 'Переходы без следа: penup() и pendown()', hint: 'Перед прыжком подними перо, после — опусти, чтобы соединять звёзды линиями.', test: a => /\bpenup\s*\(/.test(a.src) && /\bpendown\s*\(/.test(a.src) },
    ]},
    { id: '3-2', tag: 'Задание 2', title: 'Снайперская мишень из колец',
      task: 'В центре (0, 0) нарисуй 4 вложенных круга через dot(): от большого к маленькому, разные цвета. Попробуй превратить мишень в щит со звездой!',
      checks: [
        { label: 'Подключён модуль turtle', hint: 'Добавь import turtle.', test: hasImportTurtle },
        { label: 'Создана черепашка Turtle()', hint: 'Нужна строка t = turtle.Turtle().', test: hasTurtle },
        { label: 'Минимум 4 вложенных круга: dot()', hint: 'Кольца мишени рисуются точками: t.dot(240, ...), t.dot(180, ...), t.dot(120, ...), t.dot(60, ...).', test: a => effCalls(a, 'dot') >= 4 },
        { label: 'Каждое кольцо своего цвета: dot(размер, цвет)', hint: 'Передавай цвет вторым аргументом каждой точки.', test: a => (a.src.match(/\bdot\s*\([^)]*,/g) || []).length >= 4 },
        { label: 'Кольца разного размера: минимум 3 размера', hint: 'Круги должны уменьшаться: например 240, 180, 120, 60.', test: a => new Set(dotSizes(a)).size >= 3 },
    ]},
    { id: '3-3', tag: 'Задание 3', title: 'Эмодзи-смайлик 😎',
      task: 'Жёлтая голова dot(220) в центре, два глаза через goto + dot, и улыбка — дуга circle(радиус, угол) из точки (-45, -20).',
      checks: [
        { label: 'Подключён модуль turtle', hint: 'Добавь import turtle.', test: hasImportTurtle },
        { label: 'Создана черепашка Turtle()', hint: 'Нужна строка t = turtle.Turtle().', test: hasTurtle },
        { label: 'Голова и глаза: минимум 3 точки dot()', hint: 'Голова — большой dot, глаза — два маленьких.', test: a => effCalls(a, 'dot') >= 3 },
        { label: 'Точные прыжки: минимум 3 команды goto(x, y)', hint: 'Глаза и улыбка ставятся в свои координаты: t.goto(-40, 30), t.goto(40, 30), t.goto(-45, -20).', test: a => countIn(a.src, 'goto') >= 3 },
        { label: 'Улыбка — дуга: circle(радиус, угол)', hint: 'Улыбка рисуется неполным кругом: t.circle(52, 120).', test: a => /\bcircle\s*\([^)]*,/.test(a.src) },
    ]},
    { id: '3-4', tag: 'Проект Урока 3', title: 'Алмазный меч из Minecraft ⚔️',
      task: 'Функция pixel(x, y, col) рисует кубик в точке. Циклом for поставь 6 кубиков лезвия по диагонали, добавь рукоять и золотую гарду.',
      checks: [
        { label: 'Подключён модуль turtle', hint: 'Добавь import turtle.', test: hasImportTurtle },
        { label: 'Своя функция def с параметрами (x, y, ...)', hint: 'Нужна функция кубика: def pixel(x, y, col):', test: a => defBlocks(a).some(d => defParams(d).length >= 2) },
        { label: 'Внутри функции: прыжок goto(x, y)', hint: 'Функция должна прыгать в точку: t.goto(x, y).', test: a => defBlocks(a).some(d => /\bgoto\s*\([^)]*,/.test(bodyText(d))) },
        { label: 'Внутри функции: penup() и pendown()', hint: 'Перед прыжком подними перо, после — опусти.', test: a => defBlocks(a).some(d => { const b = bodyText(d); return /\bpenup\s*\(/.test(b) && /\bpendown\s*\(/.test(b); }) },
        { label: 'Внутри функции: рисуется кубик (forward или dot)', hint: 'Внутри функции нарисуй кубик: стороны forward или точка dot.', test: a => defBlocks(a).some(d => /\b(forward|dot)\s*\(/.test(bodyText(d))) },
        { label: 'Цикл for вызывает функцию минимум 6 раз', hint: 'Лезвие меча — 6 кубиков в цикле: for i in range(6): pixel(...).', test: a => { const d = defBlocks(a).find(x => defParams(x).length >= 2); if (!d) return false; const name = defName(d); return blocks(a, /^for\b/).some(f => effCalls(a, name, f) >= 6); } },
    ]},
    { id: '3-5', tag: 'Бонус ⭐', title: 'Пиксельное сердечко ❤️',
      task: 'Собери сердце из кубиков pixel(): ряды через циклы по спискам координат (for x in [...]). Подпиши «100 HP» через write().',
      checks: [
        { label: 'Подключён модуль turtle', hint: 'Добавь import turtle.', test: hasImportTurtle },
        { label: 'Функция кубика def с параметрами', hint: 'Используй функцию pixel(x, y, col) из проекта урока.', test: a => defBlocks(a).some(d => defParams(d).length >= 2) },
        { label: 'Внутри функции: прыжок goto(x, y)', hint: 'Кубик ставится в точку: t.goto(x, y) внутри функции.', test: a => defBlocks(a).some(d => /\bgoto\s*\([^)]*,/.test(bodyText(d))) },
        { label: 'Ряды сердца: цикл по списку for x in [...]', hint: 'Ряд кубиков удобно ставить циклом по списку: for x in [-25, 0, 25]:', test: a => /for\s+\w+\s+in\s*\[/.test(a.src) },
        { label: 'Минимум 8 кубиков сердца', hint: 'Сердце — это минимум 8-11 кубиков: вызовы функции считаются вместе с циклами.', test: a => { const d = defBlocks(a).find(x => defParams(x).length >= 2); return !!d && effCalls(a, defName(d)) >= 8; } },
        { label: 'Подпись: write("100 HP")', hint: 'Подпиши сердечко: t.write("100 HP", ...).', test: a => /\bwrite\s*\(/.test(a.src) },
    ]},
]},

/* ================= УРОК 4 • Функции и Random ================= */

{ n: 4, title: 'Функции и Random', tasks: [
    { id: '4-1', tag: 'Задание 1', title: 'Сказочный лес из трёх ёлок 🌲',
      task: 'Функция tree(x, y, size, col) переходит в точку и рисует ёлку размером size. Вызови её 3 раза — маленькую, большую и среднюю ёлки разных оттенков.',
      checks: [
        { label: 'Подключён модуль turtle', hint: 'Добавь import turtle.', test: hasImportTurtle },
        { label: 'Создана черепашка Turtle()', hint: 'Нужна строка t = turtle.Turtle().', test: hasTurtle },
        { label: 'Функция ёлки: def с параметрами (x, y, size, ...)', hint: 'Напиши def tree(x, y, size, col): — минимум 3 параметра.', test: a => defBlocks(a).some(d => defParams(d).length >= 3) },
        { label: 'Внутри функции: переход goto(x, y)', hint: 'Ёлка сажается в свою точку: t.goto(x, y) внутри функции.', test: a => defBlocks(a).some(d => /\bgoto\s*\([^)]*,/.test(bodyText(d))) },
        { label: 'Внутри функции: рисуется крона (forward + повороты)', hint: 'Крона — треугольник: forward и left/right внутри функции.', test: a => defBlocks(a).some(d => { const b = bodyText(d); return /\bforward\s*\(/.test(b) && /\b(left|right)\s*\(/.test(b); }) },
        { label: 'Три ёлки: функция вызвана минимум 3 раза', hint: 'Посади лес: tree(...), tree(...), tree(...) — минимум 3 вызова.', test: a => { const d = defBlocks(a).find(x => defParams(x).length >= 3); return !!d && effCalls(a, defName(d)) >= 3; } },
    ]},
    { id: '4-2', tag: 'Задание 2', title: 'Генератор звёздного неба (40 звёзд)',
      task: 'Подключи random. Функция star(x, y, size) рисует звезду. Цикл на 40 шагов генерирует случайные x, y, size и вызывает star().',
      checks: [
        { label: 'Подключён модуль turtle', hint: 'Добавь import turtle.', test: hasImportTurtle },
        { label: 'Подключён модуль random', hint: 'Добавь import random.', test: hasImportRandom },
        { label: 'Функция звезды: def с параметрами', hint: 'Напиши def star(x, y, size):', test: a => defBlocks(a).some(d => defParams(d).length >= 2) },
        { label: 'Цикл на всё небо: минимум 20 повторений', hint: 'Рассыпь звёзды циклом: for i in range(40):', test: a => !!bigLoop(a, 20) },
        { label: 'Внутри цикла: случайные числа random', hint: 'Генерируй координаты и размер: random.randint(...).', test: a => { const l = bigLoop(a, 20); return !!l && /\brandom\s*\.\s*\w+\s*\(/.test(bodyText(l)); } },
        { label: 'Внутри цикла: вызов функции звезды (минимум 20 раз)', hint: 'В теле цикла вызывай star(x, y, size) — цикл сам раскроется в 40 вызовов.', test: a => { const d = defBlocks(a).find(x => defParams(x).length >= 2); const l = bigLoop(a, 20); return !!d && !!l && effCalls(a, defName(d), l) >= 20; } },
    ]},
    { id: '4-3', tag: 'Проект Урока 4', title: 'Ночной мегаполис 🌆',
      task: 'Три слоя: звёзды и месяц на небе, функция building(x, w, h) для силуэтов домов, случайные высоты и жёлтые окна. Поставь минимум 3 дома.',
      checks: [
        { label: 'Подключён модуль turtle', hint: 'Добавь import turtle.', test: hasImportTurtle },
        { label: 'Подключён модуль random', hint: 'Добавь import random — без него не будет случайности.', test: hasImportRandom },
        { label: 'Своя функция def с параметрами', hint: 'Напиши функцию дома: def building(x, w, h):', test: a => defBlocks(a).some(d => defParams(d).length >= 2) },
        { label: 'Внутри функции: goto(x, y)', hint: 'Дом ставится в точку экрана: t.goto(...) внутри функции.', test: a => defBlocks(a).some(d => /\bgoto\s*\([^)]*,/.test(bodyText(d))) },
        { label: 'Случайность: random.randint / random.choice', hint: 'Используй random.randint(...) для высот или random.choice(...) для цветов окон.', test: hasRandom },
        { label: 'Цикл for вызывает функцию минимум 3 раза', hint: 'Построй улицу: цикл должен вызвать твою функцию хотя бы 3 раза (в примере — 6 домов).', test: a => { const d = defBlocks(a).find(x => defParams(x).length >= 2); if (!d) return false; return blocks(a, /^for\b/).length > 0 && effCalls(a, defName(d)) >= 3; } },
    ]},
    { id: '4-4', tag: 'Бонус ⭐', title: 'Салют над городом 🎆',
      task: 'Функция firework(x, y, col): из точки в небе 12 лучей в цикле (forward → dot → backward → поворот 30°). Запусти 3 разноцветных залпа.',
      checks: [
        { label: 'Подключён модуль turtle', hint: 'Добавь import turtle.', test: hasImportTurtle },
        { label: 'Функция салюта: def с параметрами (x, y, ...)', hint: 'Напиши def firework(x, y, col):', test: a => defBlocks(a).some(d => defParams(d).length >= 2) },
        { label: 'Внутри функции: цикл лучей for', hint: 'Лучи рисуются циклом: for i in range(12): внутри функции.', test: a => defBlocks(a).some(d => blocks({ root: d, env: a.env }, /^for\b/).length > 0) },
        { label: 'Внутри цикла: луч forward, точка dot и возврат backward', hint: 'Каждый луч: t.forward(35), t.dot(5), t.backward(35).', test: a => defBlocks(a).some(d => blocks({ root: d, env: a.env }, /^for\b/).some(f => { const b = bodyText(f); return /\bforward\s*\(/.test(b) && /\bdot\s*\(/.test(b) && /\bbackward\s*\(/.test(b); })) },
        { label: 'Три залпа: функция вызвана минимум 3 раза', hint: 'Запусти салюты: firework(...), firework(...), firework(...).', test: a => { const d = defBlocks(a).find(x => defParams(x).length >= 2); return !!d && effCalls(a, defName(d)) >= 3; } },
    ]},
]},

/* ================= УРОК 5 • Палитра RGB ================= */

{ n: 5, title: '16 млн цветов RGB', tasks: [
    { id: '5-1', tag: 'Задание 1', title: 'Неоновая полоса — градиент заката',
      task: 'colormode(255), чёрный фон, толстое перо и старт слева через goto. Цикл на 250 шагов: pencolor из трёх чисел (R, G, B) и шаг forward(1).',
      checks: [
        { label: 'Подключён модуль turtle', hint: 'Добавь import turtle.', test: hasImportTurtle },
        { label: 'Режим RGB: colormode(255)', hint: 'Включи полноцветный режим: turtle.colormode(255).', test: a => /\bcolormode\s*\(\s*255\s*\)/.test(a.src) },
        { label: 'Тёмный фон: bgcolor(...)', hint: 'Неон светится на чёрном: turtle.bgcolor("black").', test: a => /\bbgcolor\s*\(/.test(a.src) },
        { label: 'Толстое перо: pensize(...)', hint: 'Полоса рисуется толстым пером: t.pensize(40).', test: a => /\bpensize\s*\(/.test(a.src) },
        { label: 'Старт полосы: goto(x, y)', hint: 'Отведи черепашку влево: t.goto(-125, 0).', test: a => /\bgoto\s*\([^)]*,/.test(a.src) },
        { label: 'Длинный цикл: минимум 100 шагов', hint: 'Градиент: for i in range(250):', test: a => !!bigLoop(a, 100) },
        { label: 'Внутри цикла: цвет из трёх чисел (R, G, B)', hint: 'Меняй цвет на каждом шаге: t.pencolor(250, i, 250 - i).', test: a => { const l = bigLoop(a, 100); return !!l && rgbIn(l); } },
        { label: 'Внутри цикла: шаг forward', hint: 'На каждом шаге двигайся вперёд: t.forward(1).', test: a => { const l = bigLoop(a, 100); return !!l && /\bforward\s*\(/.test(bodyText(l)); } },
    ]},
    { id: '5-2', tag: 'Задание 2', title: 'Гипнотический неоновый портал 🌀',
      task: 'colormode(255) + цикл на 120 шагов: RGB-цвет, растущий шаг forward(i * 2) и поворот 89° — квадратный светящийся туннель.',
      checks: [
        { label: 'Подключён модуль turtle', hint: 'Добавь import turtle.', test: hasImportTurtle },
        { label: 'Режим RGB: colormode(255)', hint: 'Включи полноцветный режим: turtle.colormode(255).', test: a => /\bcolormode\s*\(\s*255\s*\)/.test(a.src) },
        { label: 'Тёмный фон: bgcolor(...)', hint: 'Портал светится в темноте: turtle.bgcolor("black").', test: a => /\bbgcolor\s*\(/.test(a.src) },
        { label: 'Большой цикл: минимум 60 шагов', hint: 'Портал: for i in range(120):', test: a => !!bigLoop(a, 60) },
        { label: 'Внутри цикла: цвет из трёх чисел (R, G, B)', hint: 't.pencolor(255 - i * 2, i * 2, 240) или через переменные r, g, b.', test: a => { const l = bigLoop(a, 60); return !!l && rgbIn(l); } },
        { label: 'Внутри цикла: растущий шаг forward(i * ...)', hint: 'Шаг растёт: t.forward(i * 2).', test: a => { const l = bigLoop(a, 60); return !!l && /\bforward\s*\([^)]*\*/.test(bodyText(l)); } },
        { label: 'Внутри цикла: закрутка — поворот 89° или 91°', hint: 'Секрет туннеля: t.left(89) вместо 90.', test: a => { const l = bigLoop(a, 60); return !!l && /\b(left|right)\s*\(\s*(89|91)\b/.test(bodyText(l)); } },
    ]},
    { id: '5-3', tag: 'Задание 3', title: 'Кристаллический цветок (угол 121°)',
      task: 'Эксперимент с порталом: поменяй угол на 121° и палитру на огненную (красный → золотой). Геометрия узора станет треугольным вихрем.',
      checks: [
        { label: 'Подключён модуль turtle', hint: 'Добавь import turtle.', test: hasImportTurtle },
        { label: 'Режим RGB: colormode(255)', hint: 'Включи полноцветный режим: turtle.colormode(255).', test: a => /\bcolormode\s*\(\s*255\s*\)/.test(a.src) },
        { label: 'Большой цикл: минимум 60 шагов', hint: 'Кристалл: for i in range(120):', test: a => !!bigLoop(a, 60) },
        { label: 'Внутри цикла: цвет из трёх чисел (R, G, B)', hint: 'Огненная палитра: t.pencolor(255, i * 2, 40).', test: a => { const l = bigLoop(a, 60); return !!l && rgbIn(l); } },
        { label: 'Внутри цикла: растущий шаг forward(i * ...)', hint: 'Шаг растёт: t.forward(i * 2.5).', test: a => { const l = bigLoop(a, 60); return !!l && /\bforward\s*\([^)]*\*/.test(bodyText(l)); } },
        { label: 'Треугольный вихрь: поворот 121°', hint: 'Главный эксперимент: t.left(121).', test: a => { const l = bigLoop(a, 60); return !!l && /\b(left|right)\s*\(\s*121\b/.test(bodyText(l)); } },
    ]},
    { id: '5-4', tag: 'Проект Урока 5', title: 'Космический лотос 🌸',
      task: 'Спирограф из неоновых колец: colormode(255), цикл на 100 шагов, RGB-цвет, растущий круг circle(30 + i) и поворот 15°.',
      checks: [
        { label: 'Подключён модуль turtle', hint: 'Добавь import turtle.', test: hasImportTurtle },
        { label: 'Режим RGB: colormode(255)', hint: 'Включи полноцветный режим: turtle.colormode(255).', test: a => /\bcolormode\s*\(\s*255\s*\)/.test(a.src) },
        { label: 'Большой цикл: минимум 30 повторений', hint: 'Лотос — это много кругов: for i in range(100):', test: a => !!bigLoop(a, 30) },
        { label: 'Внутри цикла: цвет из трёх чисел (R, G, B)', hint: 'В теле цикла задавай цвет тремя числами: t.pencolor(80, i * 2, 255 - i * 2).', test: a => { const l = bigLoop(a, 30); return !!l && rgbIn(l); } },
        { label: 'Внутри цикла: круги circle()', hint: 'В теле цикла рисуй круги: t.circle(30 + i).', test: a => { const l = bigLoop(a, 30); return !!l && /\bcircle\s*\(/.test(bodyText(l)); } },
        { label: 'Внутри цикла: поворот left() / right()', hint: 'После каждого круга поворачивай: t.left(15).', test: a => { const l = bigLoop(a, 30); return !!l && /\b(left|right)\s*\(/.test(bodyText(l)); } },
    ]},
    { id: '5-5', tag: 'Бонус ⭐', title: 'Экран мыльных пузырей',
      task: 'Цикл на 80 шагов + random: случайная точка goto, случайный яркий RGB-цвет (100–255) и кружок dot() случайного размера.',
      checks: [
        { label: 'Подключён модуль turtle', hint: 'Добавь import turtle.', test: hasImportTurtle },
        { label: 'Подключён модуль random', hint: 'Добавь import random.', test: hasImportRandom },
        { label: 'Режим RGB: colormode(255)', hint: 'Случайные цвета — это числа: turtle.colormode(255).', test: a => /\bcolormode\s*\(\s*255\s*\)/.test(a.src) },
        { label: 'Большой цикл: минимум 40 пузырей', hint: 'Рассыпь пузыри: for i in range(80):', test: a => !!bigLoop(a, 40) },
        { label: 'Внутри цикла: случайные числа random', hint: 'Координаты, цвет и размер — случайные: random.randint(...).', test: a => { const l = bigLoop(a, 40); return !!l && /\brandom\s*\.\s*\w+\s*\(/.test(bodyText(l)); } },
        { label: 'Внутри цикла: прыжок goto(x, y)', hint: 'Каждый пузырь в своей точке: t.goto(x, y).', test: a => { const l = bigLoop(a, 40); return !!l && /\bgoto\s*\(/.test(bodyText(l)); } },
        { label: 'Внутри цикла: кружок dot()', hint: 'Пузырь — это точка: t.dot(random.randint(15, 55), (r, g, b)).', test: a => { const l = bigLoop(a, 40); return !!l && /\bdot\s*\(/.test(bodyText(l)); } },
    ]},
]},

/* ================= УРОК 6 • Кнопки и мышка ================= */

{ n: 6, title: 'Кнопки и Мышка', tasks: [
    { id: '6-1', tag: 'Задание 1', title: 'Джойстик: управление 4 стрелками 🎮',
      task: 'Четыре функции движения (вперёд, назад, налево, направо), привязанные через onkey к клавишам "Up", "Down", "Left", "Right". Не забудь listen()!',
      checks: [
        { label: 'Подключён модуль turtle', hint: 'Добавь import turtle.', test: hasImportTurtle },
        { label: 'Создана черепашка Turtle()', hint: 'Нужна строка t = turtle.Turtle().', test: hasTurtle },
        { label: 'Четыре функции управления: def × 4', hint: 'Напиши go_up(), go_down(), turn_left(), turn_right().', test: a => defBlocks(a).length >= 4 },
        { label: 'Привязка к клавишам: минимум 4 команды onkey', hint: 'Каждая функция вешается на свою клавишу: turtle.onkey(go_up, "Up").', test: a => keyList(a).length >= 4 },
        { label: 'Все 4 стрелки: "Up", "Down", "Left", "Right"', hint: 'Проверь, что привязаны все четыре клавиши-стрелки.', test: a => { const k = keyList(a); return ['Up', 'Down', 'Left', 'Right'].every(x => k.includes(x)); } },
        { label: 'Клавиатура слушает: listen()', hint: 'Без turtle.listen() клавиши не работают!', test: hasListen },
    ]},
    { id: '6-2', tag: 'Задание 2', title: 'Апгрейд пульта: цветные кнопки и ластик 🎨',
      task: 'К джойстику добавь функции цветов на клавиши "1", "2", "3", ластик clear() на "c" и яркий кружок dot() на пробел "space".',
      checks: [
        { label: 'Подключён модуль turtle', hint: 'Добавь import turtle.', test: hasImportTurtle },
        { label: 'Функции пульта: минимум 3 функции def', hint: 'Напиши set_red(), set_green(), set_gold() и clear_screen().', test: a => defBlocks(a).length >= 3 },
        { label: 'Цветные кнопки: клавиши "1", "2", "3"', hint: 'Привяжи цвета: turtle.onkey(set_red, "1") и т.д.', test: a => { const k = keyList(a); return ['1', '2', '3'].every(x => k.includes(x)); } },
        { label: 'Ластик: клавиша "c" и команда clear()', hint: 'Очистка экрана: turtle.onkey(clear_screen, "c") и t.clear() внутри функции.', test: a => keyList(a).includes('c') && /\bclear\s*\(/.test(a.src) },
        { label: 'Кружок на пробел: клавиша "space" и dot()', hint: 'На пробел повесь точку: turtle.onkey(..., "space") и t.dot(30).', test: a => keyList(a).includes('space') && /\bdot\s*\(/.test(a.src) },
        { label: 'Клавиатура слушает: listen()', hint: 'Без turtle.listen() клавиши не работают!', test: hasListen },
    ]},
    { id: '6-3', tag: 'Проект Урока 6', title: 'Шоу фейерверков по клику 🎆',
      task: 'Функция boom(x, y) переходит в точку клика и рисует салют из 12 лучей со светящимися точками. Привяжи её к клику: onscreenclick(boom).',
      checks: [
        { label: 'Подключён модуль turtle', hint: 'Добавь import turtle.', test: hasImportTurtle },
        { label: 'Функция с двумя параметрами: def ...(x, y)', hint: 'Напиши def boom(x, y): — она получает точку клика.', test: a => defBlocks(a).some(d => defParams(d).length === 2) },
        { label: 'Функция привязана к клику или клавише', hint: 'Привяжи функцию: turtle.onscreenclick(boom) или turtle.onkey(...).', test: a => /\b(onscreenclick|onclick|onkey|onkeypress)\s*\(\s*\w+/.test(a.src) },
        { label: 'Внутри функции: переход goto(x, y)', hint: 'Внутри функции: t.goto(x, y) — в точку клика.', test: a => defBlocks(a).some(d => defParams(d).length === 2 && /\bgoto\s*\([^)]*,/.test(bodyText(d))) },
        { label: 'Внутри функции: цикл лучей for', hint: 'Салют — это лучи в цикле: for i in range(12): внутри функции.', test: a => defBlocks(a).some(d => blocks({ root: d, env: a.env }, /^for\b/).length > 0) },
        { label: 'Внутри цикла: луч forward и возврат backward (или dot)', hint: 'Луч рисруется так: t.forward(size), t.dot(...), t.backward(size).', test: a => defBlocks(a).some(d => blocks({ root: d, env: a.env }, /^for\b/).some(f => { const b = bodyText(f); return /\bforward\s*\(/.test(b) && /\b(backward|dot)\s*\(/.test(b); })) },
    ]},
    { id: '6-4', tag: 'Бонус ⭐', title: 'Поляна штампов черепашек',
      task: 'По клику мышки черепашка прыгает в точку, поворачивается на случайный угол, меняет цвет и ставит отпечаток stamp(). Клавиша "c" очищает экран.',
      checks: [
        { label: 'Подключён модуль turtle', hint: 'Добавь import turtle.', test: hasImportTurtle },
        { label: 'Реакция на клик: onscreenclick / onclick', hint: 'Привяжи функцию к клику: turtle.onscreenclick(stamp_here).', test: hasClickBinding },
        { label: 'Функция клика с параметрами (x, y) и goto', hint: 'def stamp_here(x, y): и внутри t.goto(x, y).', test: a => defBlocks(a).some(d => defParams(d).length === 2 && /\bgoto\s*\([^)]*,/.test(bodyText(d))) },
        { label: 'Отпечаток: stamp()', hint: 'Главная команда задания: t.stamp().', test: a => /\bstamp\s*\(/.test(a.src) },
        { label: 'Случайность: random для угла или цвета', hint: 'Случайный поворот и цвет: random.randint(0, 360), random.choice(cols).', test: hasRandom },
        { label: 'Очистка по клавише "c"', hint: 'Добавь ластик: turtle.onkey(..., "c") и t.clear().', test: a => keyList(a).includes('c') && /\bclear\s*\(/.test(a.src) },
    ]},
]},

/* ================= УРОК 7 • Гонка черепашек ================= */

{ n: 7, title: 'Гонка Черепашек', tasks: [
    { id: '7-1', tag: 'Этап 1', title: 'Гоночный стадион и линия финиша 🏟️',
      task: 'Тёмный фон, белая линия старта слева (X = -180) и золотая линия финиша справа (X = 180) через goto. Подпиши «ФИНИШ» через write().',
      checks: [
        { label: 'Подключён модуль turtle', hint: 'Добавь import turtle.', test: hasImportTurtle },
        { label: 'Создана черепашка Turtle()', hint: 'Нужна черепашка-судья: ref = turtle.Turtle().', test: hasTurtle },
        { label: 'Фон космодрома: bgcolor(...)', hint: 'Сделай тёмный фон: turtle.bgcolor("#0f172a").', test: a => /\bbgcolor\s*\(/.test(a.src) },
        { label: 'Две линии: минимум 4 прыжка goto(x, y)', hint: 'У каждой линии 2 конца:.goto(-180, 120) → goto(-180, -120) и так же справа.', test: a => countIn(a.src, 'goto') >= 4 },
        { label: 'Линии без следов между ними: penup() и pendown()', hint: 'Между стартом и финишем переходи с поднятым пером.', test: a => /\bpenup\s*\(/.test(a.src) && /\bpendown\s*\(/.test(a.src) },
        { label: 'Две линии двух цветов', hint: 'Старт белый, финиш золотой: pencolor(...) перед каждой линией.', test: a => colorCalls(a) >= 2 },
        { label: 'Подпись «ФИНИШ»: write(...)', hint: 'Подпиши финиш сверху: ref.write("ФИНИШ", ...).', test: a => /\bwrite\s*\(/.test(a.src) },
    ]},
    { id: '7-2', tag: 'Этап 2', title: 'Три гонщика на старте 🐢🐢🐢',
      task: 'Создай трёх гонщиков t1, t2, t3 разных цветов и поставь их на линию старта X = -180 на высотах 60, 0 и -60. Опусти перья — за каждым тянется цветной след.',
      checks: [
        { label: 'Подключён модуль turtle', hint: 'Добавь import turtle.', test: hasImportTurtle },
        { label: 'Три гонщика: минимум 3 черепашки Turtle()', hint: 'Создай t1, t2 и t3 — каждый turtle.Turtle().', test: a => countIn(a.src, 'Turtle') >= 3 },
        { label: 'Каждый гонщик своего цвета: минимум 3 цвета', hint: 'Задай цвета: t1.color("crimson"), t2.color("deepskyblue"), t3.color("limegreen").', test: a => colorCalls(a) >= 3 },
        { label: 'Расстановка на старте: минимум 3 прыжка goto(x, y)', hint: 'Каждого гонщика поставь на старт: t1.goto(-180, 60) и т.д.', test: a => countIn(a.src, 'goto') >= 3 },
        { label: 'Переход без следа и боевой след: penup() и pendown()', hint: 'На старт переходи с penup(), затем опусти перо pendown().', test: a => /\bpenup\s*\(/.test(a.src) && /\bpendown\s*\(/.test(a.src) },
    ]},
    { id: '7-3', tag: 'Этап 3', title: 'Гонка и чемпион! 🏆',
      task: 'Цикл на 150 шагов: все три гонщика шагают на random.randint(1, 8). Проверяй финиш через if ... xcor() >= 180, останавливай гонку break и объяви победителя через write().',
      checks: [
        { label: 'Подключён модуль turtle', hint: 'Добавь import turtle.', test: hasImportTurtle },
        { label: 'Подключён модуль random', hint: 'Добавь import random.', test: hasImportRandom },
        { label: 'Минимум 3 черепашки Turtle()', hint: 'Создай трёх гонщиков: t1, t2, t3 — каждый turtle.Turtle().', test: a => countIn(a.src, 'Turtle') >= 3 },
        { label: 'Цикл гонки for / while', hint: 'Гонка — это цикл: for step in range(150):', test: a => blocks(a, /^(for|while)\b/).length > 0 },
        { label: 'Внутри цикла: 3 случайных шага forward(random...)', hint: 'Каждый гонщик шагает в цикле: t1.forward(random.randint(1, 8)) и так все три.', test: a => blocks(a, /^(for|while)\b/).some(l => (bodyText(l).match(/\bforward\s*\([^)]*random/g) || []).length >= 3) },
        { label: 'Проверка финиша: if ... xcor()', hint: 'Проверяй координату: if t1.xcor() >= 180:', test: a => blocks(a, /^if\b/).some(n => /\bxcor\s*\(/.test(n.text)) },
        { label: 'Остановка гонки: break', hint: 'Когда чемпион определён — break останавливает цикл.', test: a => /\bbreak\b/.test(a.src) },
        { label: 'Объявление победителя: write(...)', hint: 'Выведи поздравление на экран через write(...).', test: a => /\bwrite\s*\(/.test(a.src) },
    ]},
    { id: '7-4', tag: 'Мини-Игра 2', title: 'Поймай черепашку мышкой! 🎯',
      task: 'Клик по самой черепашке (t.onclick) — она убегает в случайное место, а очки растут. Выводи счёт на экран через write().',
      checks: [
        { label: 'Подключён модуль turtle', hint: 'Добавь import turtle.', test: hasImportTurtle },
        { label: 'Подключён модуль random', hint: 'Добавь import random — черепашка убегает случайно.', test: hasImportRandom },
        { label: 'Клик по черепашке: onclick / onscreenclick', hint: 'Повесь функцию: t.onclick(catch_me).', test: hasClickBinding },
        { label: 'Функция клика def с параметрами (x, y)', hint: 'Напиши def catch_me(x, y):', test: a => defBlocks(a).some(d => defParams(d).length >= 2) },
        { label: 'Внутри функции: побег в случайную точку', hint: 'Черепашка убегает: t.goto(random.randint(...), random.randint(...)).', test: a => defBlocks(a).some(d => /\brandom\s*\.\s*\w+\s*\(/.test(bodyText(d))) },
        { label: 'Счётчик очков', hint: 'Заведи переменную счёта: score = 0 и увеличивай её при клике.', test: a => /\bscore\b/i.test(a.src) },
        { label: 'Счёт на экране: write(...)', hint: 'Выводи очки: t.write("Очки: " + str(score), ...).', test: a => /\bwrite\s*\(/.test(a.src) },
    ]},
    { id: '7-5', tag: 'Бонус ⭐', title: 'Две черепашки-зеркала',
      task: 'Две черепашки рисуют один узор синхронно в одном цикле: t1 поворачивает налево, t2 — зеркально направо. Шаг растёт: forward(i * 3).',
      checks: [
        { label: 'Подключён модуль turtle', hint: 'Добавь import turtle.', test: hasImportTurtle },
        { label: 'Две черепашки: минимум 2 Turtle()', hint: 'Создай пару: t1 = turtle.Turtle() и t2 = turtle.Turtle().', test: a => countIn(a.src, 'Turtle') >= 2 },
        { label: 'Общий цикл рисования for', hint: 'Обе черепашки рисуют в одном цикле: for i in range(60):', test: a => blocks(a, /^for\b/).length > 0 },
        { label: 'Внутри цикла: зеркальные повороты left и right', hint: 'В одном цикле: t1.left(59) и t2.right(59).', test: a => blocks(a, /^for\b/).some(l => { const b = bodyText(l); return /\bleft\s*\(/.test(b) && /\bright\s*\(/.test(b); }) },
        { label: 'Внутри цикла: растущий шаг forward(i * ...)', hint: 'Узор растёт: t1.forward(i * 3) и t2.forward(i * 3).', test: a => blocks(a, /^for\b/).some(l => /\bforward\s*\([^)]*\*/.test(bodyText(l))) },
    ]},
]},

/* ================= УРОК 8 • Финальный проект ================= */

{ n: 8, title: 'Финальный Проект 🏆', tasks: [
    { id: '8-1', tag: 'Финальный проект', title: 'Мой шедевр на Python (любой трек)',
      task: 'Выбери трек (пейзаж/город, неоновая мандала, игра или открытка) и собери проект из 4 ингредиентов: фон bgcolor, цикл for, своя функция def или интерактив, подпись write. Минимум 3 цвета!',
      checks: [
        { label: 'Подключён модуль turtle', hint: 'Добавь import turtle.', test: hasImportTurtle },
        { label: 'Создана черепашка Turtle()', hint: 'Нужна строка t = turtle.Turtle().', test: hasTurtle },
        { label: 'Ингредиент 1: фон bgcolor(...)', hint: 'Задай фон окна: turtle.bgcolor(...).', test: a => /\bbgcolor\s*\(/.test(a.src) },
        { label: 'Ингредиент 2: цикл for ... in range(...)', hint: 'Используй цикл для повторения узоров, звёзд или окон.', test: a => blocks(a, /^for\s+\w+\s+in\s+range\s*\(/).length > 0 },
        { label: 'Ингредиент 3: своя функция def или интерактив', hint: 'Напиши def ... или добавь onscreenclick / onkey.', test: a => defBlocks(a).length > 0 || /\b(onscreenclick|onclick|onkey|onkeypress)\s*\(/.test(a.src) },
        { label: 'Ингредиент 4: подпись write(...)', hint: 'Выведи название проекта: t.write("Мой проект", ...).', test: a => /\bwrite\s*\(/.test(a.src) },
        { label: 'Минимум 3 цвета в рисунке', hint: 'Используй минимум 3-4 сочетающихся цвета (pencolor / color / fillcolor).', test: a => colorCalls(a) >= 3 },
    ]},
]},
];

/* Общее требование ко всем заданиям: программа должна завершаться turtle.done(). */
LESSONS.forEach(l => l.tasks.forEach(t => t.checks.push({
    label: 'Завершение программы: turtle.done()',
    hint: 'Добавь turtle.done() в самый конец программы — без неё окно рисунка не работает как надо.',
    test: a => /\b(done|mainloop)\s*\(/.test(a.src),
})));