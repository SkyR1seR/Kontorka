// Контент MVP: роли, состав, батрачка, саботажи, записюльки Хозяина, сотрудники.
import { OS_PCS } from './map.js';

// ---------------------------------------------------------------------------
// Роли (TZ 8.1, GDD 4)
// ---------------------------------------------------------------------------
export const ROLES = {
  director: {
    id: 'director', name: 'Директор', team: 'kontorka',
    goal: 'Выполнить план Конторки и найти вредителей. Решения на планёрке — за тобой.',
    rules: [
      'Ты не видишь роли. Санкции — только на основании наблюдений.',
      'Ошибочная санкция бьёт по Конторке: растут кредики.',
      'Можешь созвать внеочередную планёрку (2 раза за матч).',
    ],
    example: 'Пример: «Колупеня видели у принтера перед поломкой — запускаю аудит».',
  },
  batrakan: {
    id: 'batrakan', name: 'Батракан', team: 'kontorka',
    goal: 'Выполняй батрачку, наблюдай за коллегами, помогай найти вредителей.',
    rules: [
      'Твоя работа двигает план Конторки.',
      'Запоминай, кто где был: журнал наблюдений [J] ведётся сам.',
      'Чини саботажи — это видно и снижает подозрения.',
    ],
    example: 'Пример: «Я колупал цифры на компьютере №3 и видел, как Глафира ушла в Техзону».',
  },
  vreditel: {
    id: 'vreditel', name: 'Вредитель', team: 'vrediteli',
    goal: 'Сорви план или доведи Конторку до кризиса — и останься в штате.',
    rules: [
      'Саботаж: подойди к объекту и удерживай [F]. Перезарядка 35 с.',
      'Работай для вида: бездействие вызывает подозрения.',
      'Один социальный трюк за матч: подбросить улику или подставную задачу.',
    ],
    example: 'Пример: выключить свет в Техзоне и в темноте сломать принтер.',
  },
  alesya: {
    id: 'alesya', name: 'Кудесница Алеся', team: 'kontorka',
    goal: 'Помоги Конторке: квадровые проверки показывают уровень риска сотрудника.',
    rules: [
      'Проверка — у терминала в Отделе квадров, 3 раза за матч.',
      'Результат: «низкий риск», «неопределённо» или «высокий риск». Это не роль!',
      'Остальное — как у батракана: работай и наблюдай.',
    ],
    example: 'Пример: «Проверила Шурупа — высокий риск. Но это не приговор».',
  },
  dusya: {
    id: 'dusya', name: 'Дуся', team: 'kontorka',
    goal: 'Следи за кукишами: у тумбы кассы тебе доступен журнал операций.',
    rules: [
      'Журнал кукишей показывает аномальные операции и кто был у шкапчиков.',
      'Ты видишь операции, но не роли.',
      'Ты заметная мишень — вредителям выгодно тебя подставить.',
    ],
    example: 'Пример: «В 10:40 из шкапчиков ушло 120 кукишей. Рядом были двое».',
  },
};

export const TEAM_NAME = { kontorka: 'Конторка', vrediteli: 'Вредители' };

// Рекомендуемый состав (GDD 4.1): [директор, вредители, спецроли, батраканы]
export const COMPOSITION = {
  6: [1, 1, 1, 3], 7: [1, 1, 1, 4], 8: [1, 2, 1, 4], 9: [1, 2, 1, 5],
  10: [1, 2, 2, 5], 11: [1, 2, 2, 6], 12: [1, 3, 2, 6],
};

// ---------------------------------------------------------------------------
// Баланс (TZ 11)
// ---------------------------------------------------------------------------
export const MATCH_LENGTHS = {
  short: { name: 'Короткий (~10 мин)', shifts: [150, 150, 100], tasksPerShift: [3, 3, 2], discuss: 50 },
  standard: { name: 'Стандартный (~20 мин)', shifts: [330, 330, 220], tasksPerShift: [4, 4, 3], discuss: 70 },
  full: { name: 'Полный (~27 мин)', shifts: [450, 450, 300], tasksPerShift: [5, 5, 4], discuss: 80 },
  // только режим разработчика: быстрый прогон
  test: { name: 'Тестовый (~4 мин)', shifts: [60, 60, 45], tasksPerShift: [2, 2, 1], discuss: 20, devOnly: true },
};

export const BALANCE = {
  sabotageCooldown: 35,
  sabotageHold: 2.6,
  repairHold: 3.0,
  directorSanctions: 3,
  directorCalls: 2,
  alesyaChecks: 3,
  meetingGather: 8,
  meetingDecide: 25,
  meetingResult: 6,
  explainTime: 15,
  introRole: 10,
  introOrder: 7,
  planFactor: 0.82,
  openSabotageLimit: 3,
  visionRange: 13,
  visionDark: 4,
  speed: 3.6,
  minTaskTime: 2.5,
  kukishiPerTask: 10,
  kukishiPerRepair: 15,
  idleSeconds: 25,
  lightsOff: 12,
  archiveLock: 40,
  cartBlock: 45,
  accelCountdown: 50,
  restrictTime: 60,
  wrongFireKrediki: 25,
};

// ---------------------------------------------------------------------------
// Батрачка (GDD 5.3, TZ 6.1). 23 задачи.
// mg — мини-игра, stations — допустимые места, steps — многошаговая задача.
// ---------------------------------------------------------------------------
const CHECKPOINTS = ['cp_archive', 'cp_kvadry', 'cp_cabinet', 'cp_tech', 'cp_kassa', 'cp_openspace', 'cp_canteen', 'cp_entrance', 'cp_slop'];

export const TASKS = [
  { id: 'kolupanie', name: 'Колупание цифер', hint: 'Впиши пропущенные числа и нажми «Пересчитать».', mg: 'numbers', stations: OS_PCS, dur: [8, 12] },
  { id: 'razmus', name: 'Размусоливание букв', hint: 'Приведи три строки к шаблону.', mg: 'format', stations: OS_PCS, dur: [8, 12] },
  { id: 'koposh', name: 'Копошение в листочках', hint: 'Разложи папки по цвету и номеру.', mg: 'sortFolders', stations: ['arch_shelf_n', 'arch_shelf_b', 'arch_shelf_red'], dur: [9, 13], archive: true },
  { id: 'perekl', name: 'Переукладка папок', hint: 'Верни документы в ячейки по номерам.', mg: 'slots', stations: ['arch_desk', 'arch_cards'], dur: [8, 12], archive: true },
  { id: 'shkap', name: 'Проверка шкапчика', hint: 'Сверь содержимое шкапчика с описью.', mg: 'inventory', stations: ['kassa_lockers'], dur: [7, 10] },
  { id: 'protirka', name: 'Протирка таблички', hint: 'Сотри лишние символы, оставь нужную надпись.', mg: 'wipe', stations: ['ent_sign', 'cab_plate'], dur: [7, 10] },
  { id: 'printer', name: 'Кормление принтера', hint: 'Заправь бумагу и запусти тестовую печать.', mg: 'printer', stations: ['tech_printer1', 'tech_printer2'], dur: [8, 11], printer: true },
  { id: 'obhod_kv', name: 'Обход квадров', hint: 'Отметься у трёх стендов квадров в указанном порядке.', mg: 'stamp', steps: 'kvpoints', dur: [2, 3] },
  { id: 'sverka', name: 'Сверка кукишей', hint: 'Сопоставь строки двух ведомостей.', mg: 'ledger', stations: ['kassa_tumba'], dur: [9, 13] },
  { id: 'pereschet', name: 'Пересчёт кукишей', hint: 'Пересчитай кукиши и впиши сумму.', mg: 'coins', stations: ['kassa_desk'], dur: [8, 11] },
  { id: 'podpis', name: 'Подпись ведомости', hint: 'Обведи подпись по точкам.', mg: 'signature', stations: ['kassa_safe', 'dir_desk'], dur: [6, 9] },
  { id: 'uskor_to', name: 'Техобслуживание ускорителя', hint: 'Переключи три панели, дождавшись индикатора.', mg: 'timedPanels', stations: ['tech_acc1', 'tech_acc2', 'tech_acc3'], dur: [9, 12] },
  { id: 'uskor_check', name: 'Проверка ускорителя', hint: 'Повтори последовательность огоньков.', mg: 'simon', stations: ['tech_acc1', 'tech_acc2', 'tech_acc3'], dur: [9, 13] },
  { id: 'registr', name: 'Регистрация посетителя', hint: 'Перепиши имя посетителя в журнал.', mg: 'typeName', stations: ['ent_journal'], dur: [8, 12] },
  { id: 'shchi', name: 'Заправка кислых щей', hint: 'Возьми капусту в Слоповине и заправь бидон в Столовой.', mg: 'stir', steps: 'shchi', dur: [6, 9], plan: 2 },
  { id: 'obhod_otd', name: 'Обход отделов', hint: 'Отметься на четырёх контрольных постах по порядку.', mg: 'stamp', steps: 'checkpoints', dur: [2, 3], plan: 2 },
  { id: 'shtamp', name: 'Штампование записюлек', hint: 'Одобри правильные записюльки, остальные — отклони.', mg: 'stampDocs', stations: ['dir_desk', 'kv_desk2'], dur: [8, 12] },
  { id: 'ficus', name: 'Полив фикуса', hint: 'Налей воды ровно до отметки.', mg: 'water', stations: ['dir_ficus'], dur: [6, 9] },
  { id: 'karand', name: 'Заточка карандашей', hint: 'Крути точилку, пока карандаш не станет острым.', mg: 'sharpen', stations: ['kv_desk1'], dur: [6, 9] },
  { id: 'skrepki', name: 'Сортировка скрепок', hint: 'Разложи скрепки по коробкам нужного цвета.', mg: 'clips', stations: ['os_clips'], dur: [8, 11] },
  { id: 'zvonok', name: 'Звонок Хозяину', hint: 'Ответь на звонок правильной формулировкой.', mg: 'phone', stations: ['dir_phone', 'ent_phone'], dur: [7, 10] },
  { id: 'slop', name: 'Вычерпывание слоповины', hint: 'Качай насос в ритм, не давая давлению уйти в красное.', mg: 'pump', stations: ['slop_pump'], dur: [10, 14], plan: 2, rare: true },
  { id: 'bidon', name: 'Замена бидона', hint: 'Подними бидон и отпусти точно над горлышком.', mg: 'bidon', stations: ['os_cooler'], dur: [6, 9] },
];
export const TASK_BY_ID = Object.fromEntries(TASKS.map((t) => [t.id, t]));

export function buildTaskSteps(task, rng) {
  if (task.steps === 'kvpoints') return rng.shuffle(['kv_point1', 'kv_point2', 'kv_point3']);
  if (task.steps === 'shchi') return ['slop_cabbage', 'can_pot'];
  if (task.steps === 'checkpoints') return rng.shuffle(CHECKPOINTS).slice(0, 4);
  return [rng.pick(task.stations)];
}

// Мини-игра конкретного шага (для многошаговых задач первый шаг «взять» отличается)
export function stepMinigame(task, stepIdx) {
  if (task.id === 'shchi' && stepIdx === 0) return 'pickup';
  return task.mg;
}

// ---------------------------------------------------------------------------
// Саботажи (GDD 6.2, TZ 3.4). 13 видов, у каждого — три категории следов.
// ---------------------------------------------------------------------------
export const SABOTAGES = [
  { id: 'printer_break', name: 'Сломать принтер', cat: 'Объектный', stations: ['tech_printer1', 'tech_printer2'],
    incident: 'Принтер сломан', trace: 'В лотке зажёвана бумага, пахнет гарью.', repair: 'Вытащить зажёванную бумагу', repairMg: 'jam' },
  { id: 'lights_off', name: 'Вырубить свет', cat: 'Объектный', stations: ['tech_shield'], chooseZone: true,
    incident: 'Отключение света', trace: 'Рубильник зоны опущен вручную.', repair: null },
  { id: 'folders_mix', name: 'Перепутать папки', cat: 'Объектный', stations: ['arch_shelf_n', 'arch_shelf_b', 'arch_shelf_red'],
    incident: 'Папка не в своём отделе', trace: 'На стеллаже пустое место, папка нашлась в чужой зоне.', repair: 'Вернуть папку в Архив' },
  { id: 'kukishi_steal', name: 'Утащить кукиши', cat: 'Экономический', stations: ['kassa_lockers'],
    incident: 'Кассовый баланс не сходится', trace: 'Из шкапчика пропали кукиши.', repair: 'Сверить баланс у тумбы кассы', repairStation: 'kassa_tumba', repairMg: 'ledger' },
  { id: 'order_forge', name: 'Подменить записюльку', cat: 'Информационный', stations: ['ent_board'],
    incident: 'Записюлька подменена', trace: 'Печать смазана, на доске висит «версия 2».', repair: 'Сравнить версии записюльки', repairMg: 'compare' },
  { id: 'archive_lock', name: 'Закрыть архив', cat: 'Маршрутный', stations: ['kv_keybox'],
    incident: 'Архив заперт', trace: 'Ключа от Архива нет на крючке.', repair: 'Вернуть ключ и отпереть Архив' },
  { id: 'status_corrupt', name: 'Исказить статус задачи', cat: 'Информационный', stations: OS_PCS,
    incident: 'Статус задачи искажён', trace: 'На мониторе — «ОШИБКА СТАТУСА», выполненная задача снята.', repair: 'Восстановить запись', repairMg: 'typeName' },
  { id: 'cart_block', name: 'Перенести тележку', cat: 'Маршрутный', stations: ['slop_cart'], carry: 'cart',
    incident: 'Проход загорожен тележкой', trace: 'Тележку из Слоповины кто-то прикатил к двери.', repair: 'Откатить тележку' },
  { id: 'locker_lock', name: 'Запереть шкапчики', cat: 'Маршрутный', stations: ['kassa_lockers'],
    incident: 'Шкапчики заперты', trace: 'Кодовый замок перенастроен.', repair: 'Подобрать код', repairMg: 'code' },
  { id: 'accel_overload', name: 'Перегрузить ускоритель', cat: 'Объектный', stations: ['tech_acc1', 'tech_acc2', 'tech_acc3'],
    incident: 'Перегрузка калоидного ускорителя!', trace: 'Регулятор выкручен до упора.', repair: 'Стабилизировать панель' },
  { id: 'soup_spoil', name: 'Испортить щи', cat: 'Объектный', stations: ['can_pot'],
    incident: 'Щи испорчены', trace: 'В бидон высыпали что-то подозрительное.', repair: 'Вылить испорченные щи' },
];
export const SOCIAL_TRICKS = [
  { id: 'plant_evidence', name: 'Подбросить улику', desc: 'К последнему инциденту добавится «найденный пропуск» выбранного сотрудника.' },
  { id: 'fake_task', name: 'Подставная задача', desc: 'Выбранный сотрудник получит странное поручение к месту саботажа.' },
];
export const SABOTAGE_BY_ID = Object.fromEntries(SABOTAGES.map((s) => [s.id, s]));
export const TRICK_BY_ID = Object.fromEntries(SOCIAL_TRICKS.map((s) => [s.id, s]));

// ---------------------------------------------------------------------------
// Записюльки Хозяина (GDD 8). Одна активная одновременно.
// ---------------------------------------------------------------------------
export const ORDERS = [
  { id: 'speedup', type: 'Производственное', title: 'Ускорить шабашку!',
    text: 'Хозяин недоволен темпами. Шабашка короче, план выше, за каждую задачу +5 кукишей.' },
  { id: 'greet', type: 'Социальное', title: 'Поздороваться с Директором',
    text: 'Все батраканы обязаны лично поздороваться с Директором [G]. Вежливым — обещание.' },
  { id: 'red_ban', type: 'Запрет', title: 'Красные папки вне обращения',
    text: 'Красный стеллаж опечатан, дверь Архив—Квадры закрыта на учёт.' },
  { id: 'kvadry_check', type: 'Кадровое', title: 'Проверить отдел квадров',
    text: 'Каждый отмечается на посту Отдела квадров. Кудеснице — дополнительная проверка.' },
  { id: 'no_chairs', type: 'Абсурдное', title: 'Не допускать кресел к работе',
    text: 'Кресла изъяты. Работа за компьютерами идёт стоя — медленнее.' },
  { id: 'kukishi_urgent', type: 'Производственное', title: 'Срочно сверить кукиши',
    text: 'Касса под контролем: двум сотрудникам выдана сверка, журнал кукишей пишет подробнее.' },
  { id: 'silence', type: 'Запрет', title: 'Режим тишины в Опенспейсе',
    text: 'В Опенспейсе запрещены разговоры. Реплики там не слышны.' },
  { id: 'economy', type: 'Производственное', title: 'Экономия электричества',
    text: 'В Архиве и Слоповине свет приглушён. Отключения света длятся дольше.' },
  { id: 'lunch', type: 'Социальное', title: 'Обязательный обед',
    text: 'Каждый обязан съесть тарелку кислых щей в Столовой. Голодные копят дебики.' },
  { id: 'printer_permit', type: 'Запрет', title: 'Принтер — только по записи',
    text: 'Перед печатью получи разрешение у стола Директора.' },
  { id: 'lockers_inv', type: 'Кадровое', title: 'Инвентаризация шкапчиков',
    text: 'Всем выдана проверка шкапчика. Дуся видит журнал кукишей откуда угодно.' },
  { id: 'stakhanov', type: 'Абсурдное', title: 'Поощрение стахановцев',
    text: 'Тройка самых работящих получит по два обещания. Кукиши за задачи удвоены.' },
  { id: 'slop_sealed', type: 'Запрет', title: 'Слоповина опечатана',
    text: 'Двери в Слоповину из Опенспейса и Входной закрыты. Ходить через Техзону.' },
];
export const ORDER_BY_ID = Object.fromEntries(ORDERS.map((o) => [o.id, o]));

// Поддельные записюльки (саботаж «Подменить записюльку»)
export const FORGED_ORDERS = [
  { id: 'f_printers', type: 'Запрет', title: 'Принтеры на профилактике', forged: true,
    text: 'Принтеры не трогать до особого распоряжения. Печать запрещена.' },
  { id: 'f_kassa', type: 'Запрет', title: 'Касса — только для Дуси', forged: true,
    text: 'Посторонним к тумбе кассы и шкапчикам не подходить.' },
  { id: 'f_coffee', type: 'Абсурдное', title: 'Кофе — обязателен', forged: true,
    text: 'Каждые пять минут батракан обязан пить кофе. Без кофе — дебики.' },
  { id: 'f_archive', type: 'Запрет', title: 'Архив закрыт на учёт', forged: true,
    text: 'Архивные задачи заморожены до конца шабашки.' },
];
export const ALL_ORDERS = [...ORDERS, ...FORGED_ORDERS];
export const ALL_ORDER_BY_ID = Object.fromEntries(ALL_ORDERS.map((o) => [o.id, o]));

// ---------------------------------------------------------------------------
// Сотрудники Конторки: имена и внешность (low-poly пресеты)
// ---------------------------------------------------------------------------
export const STAFF = [
  { name: 'Колупень', full: 'Господин Колупень', g: 'm', look: { body: 'thin', head: 'long', skin: '#f2b48f', hair: 'flat', hairColor: '#a0522d', shirt: '#d9b531', jacket: '#d9b531', tie: '#5b4a1a', pants: '#6b4a2b', glasses: 'octa', nose: 1.9, eyes: 1.25, brow: 'angry' } },
  { name: 'Шуруп', full: 'Шуруп Петрович', g: 'm', look: { body: 'normal', head: 'round', skin: '#e9a983', hair: 'spiky', hairColor: '#c8702d', shirt: '#eae6d6', tie: '#9a1f1f', pants: '#2f2f38', nose: 1.0, eyes: 1.35, brow: 'worried' } },
  { name: 'Глафира', full: 'Глафира Тюх', g: 'f', look: { body: 'fat', head: 'wide', skin: '#e79a85', hair: 'bun', hairColor: '#8a8a7a', shirt: '#c9b24a', apron: true, pants: '#3b3a33', nose: 1.2, eyes: 1.15, brow: 'angry' } },
  { name: 'Лёня', full: 'Лёня Кнопкин', g: 'm', look: { body: 'thin', head: 'round', skin: '#f0c09a', hair: 'comb', hairColor: '#2e2016', shirt: '#9fb7d6', tie: '#1d3c78', pants: '#3a3f4a', glasses: 'round', nose: 1.1, eyes: 1.2, brow: 'neutral' } },
  { name: 'Зинаида', full: 'Зинаида Скрепкина', g: 'f', look: { body: 'normal', head: 'round', skin: '#f3c3a2', hair: 'bob', hairColor: '#7a2a2a', shirt: '#b5486a', pants: '#3a2e3a', nose: 0.9, eyes: 1.3, brow: 'worried', lipstick: true } },
  { name: 'Евлампий', full: 'Евлампий Дыркин', g: 'm', look: { body: 'fat', head: 'wide', skin: '#e8a487', hair: 'bald', hairColor: '#6d5a48', shirt: '#e6e1cf', tie: '#2c6a3a', pants: '#40382f', mustache: true, nose: 1.4, eyes: 1.1, brow: 'neutral' } },
  { name: 'Клава', full: 'Клава Мышкина', g: 'f', look: { body: 'thin', head: 'long', skin: '#f5cfb2', hair: 'bob', hairColor: '#d8c27a', shirt: '#6f8f6a', pants: '#2b3427', glasses: 'octa', nose: 1.3, eyes: 1.3, brow: 'worried' } },
  { name: 'Гена', full: 'Гена Шпингалет', g: 'm', look: { body: 'normal', head: 'long', skin: '#dda07a', hair: 'spiky', hairColor: '#20201f', shirt: '#cf6a2c', pants: '#2e3440', nose: 1.5, eyes: 1.15, brow: 'angry' } },
  { name: 'Нюра', full: 'Нюра Печаткина', g: 'f', look: { body: 'fat', head: 'round', skin: '#efb497', hair: 'bun', hairColor: '#3c2a1d', shirt: '#7d6db0', pants: '#2b2738', nose: 1.0, eyes: 1.25, brow: 'neutral', lipstick: true } },
  { name: 'Ипполит', full: 'Ипполит Сургуч', g: 'm', look: { body: 'thin', head: 'long', skin: '#f2c4a4', hair: 'comb', hairColor: '#b8b8b0', shirt: '#e4e0d0', jacket: '#4a4f5a', tie: '#7a1a1a', pants: '#4a4f5a', glasses: 'round', nose: 1.6, eyes: 1.1, brow: 'angry', mustache: true } },
  { name: 'Люся', full: 'Люся Клякса', g: 'f', look: { body: 'normal', head: 'round', skin: '#f6d0b5', hair: 'bob', hairColor: '#1f1a17', shirt: '#4f8fa8', pants: '#24323a', nose: 0.9, eyes: 1.4, brow: 'worried' } },
  { name: 'Борис', full: 'Борис Протокол', g: 'm', look: { body: 'fat', head: 'wide', skin: '#dc9a7e', hair: 'flat', hairColor: '#5a3a1a', shirt: '#f0ece0', jacket: '#2f3c55', tie: '#b02a2a', pants: '#2f3c55', nose: 1.3, eyes: 1.05, brow: 'angry' } },
  { name: 'Марфуша', full: 'Марфуша Бублик', g: 'f', look: { body: 'normal', head: 'wide', skin: '#ebb08f', hair: 'bun', hairColor: '#b4552b', shirt: '#d9d36a', pants: '#3a3a2a', nose: 1.1, eyes: 1.3, brow: 'neutral', lipstick: true } },
  { name: 'Стасик', full: 'Стасик Пупырь', g: 'm', look: { body: 'thin', head: 'round', skin: '#f1bc95', hair: 'spiky', hairColor: '#e0c060', shirt: '#eae6d6', tie: '#9a1f1f', pants: '#2f2f38', nose: 1.0, eyes: 1.45, brow: 'worried' } },
];

export const NPC_LOOKS = {
  bidonya: { body: 'fat', head: 'wide', skin: '#e0857a', hair: 'bun', hairColor: '#9b9b8a', shirt: '#d8c766', apron: true, pants: '#d8c766', nose: 1.2, eyes: 1.2, brow: 'angry', dress: true, scale: 1.12 },
  tosya: { body: 'fat', head: 'round', skin: '#f0b79a', hair: 'bob', hairColor: '#c04a2a', shirt: '#5a7a9a', pants: '#2a3a4a', glasses: 'round', nose: 1.0, eyes: 1.2, brow: 'neutral', dress: true },
};

// Хозяин и его печать (подделка выдаёт себя опечаткой)
export const OWNER_STAMP = 'ХОЗЯИН · УТВЕРЖДАЮ';
export const FORGED_STAMPS = ['ХОЗЯЕН · УТВЕРЖДАЮ', 'ХОЗЯИН · УТВЕРЖАЮ', 'ХОЗЯИИН · УТВЕРЖДАЮ', 'ХОЗЯИН · УТВЕРДЖАЮ'];

export function genderize(g, m, f) { return g === 'f' ? f : m; }
