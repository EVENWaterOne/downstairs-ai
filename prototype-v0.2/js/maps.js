/* 地图：RPG Maker 式格子地图的固定底图。GM 只能往上摆人和物件（场景 JSON），不能改底图。
 * 图例：# 墙  . 地面  = 栏杆（挡路，可以往下看）  o 柱子  ~ 草地（可走）  其他字母是出入口，见 exits。
 * 坐标 (x, y)：x 是列，y 是行，从 0 开始。不依赖 DOM。 */
(function (root) {
  "use strict";

  const MAPS = {
    corridor: {
      name: { zh: "七楼走廊", en: "Level 7 corridor" },
      rows: [
        "#######B####C####E###",
        "#S.................L#",
        "#..................L#",
        "=====================",
      ],
      exits: {
        B: { to: "flat_lin", at: [5, 7] },
        C: { to: "flat_aisyah", at: [6, 8] }, E: { to: "flat_mei", at: [5, 7] },
        S: { to: "void_deck", at: [2, 1] }, L: { to: "void_deck", at: [19, 1] }
      }
    },
    void_deck: {
      name: { zh: "楼下 void deck", en: "Void deck" },
      rows: [
        "######################",
        "#S.................L.#",
        "#..o.....o.....o.....#",
        "R....................#",
        "#..o.....o.....o.....#",
        "#....................#",
        "##O###~~~~~~~~~~~~~~~#",
        "#~~~~~~1~~2~~3~~4~~~~#",
        "#~~~~~~~~~~~~~~~~~~~~#",
        "#~~5~~~~~6~~~~~7~~~~~X",
        "######################",
      ],
      exits: {
        S: { to: "corridor", at: [1, 2] }, L: { to: "corridor", at: [18, 2] },
        O: { to: "office", at: [3, 4] }, X: { to: "dorm", at: [2, 4] },
        R: { to: "flat_chen", at: [4, 6] }
      },
      // 7 个地块：游戏端建的设施画在这里
      plots: { 1: [7, 7], 2: [10, 7], 3: [13, 7], 4: [16, 7], 5: [3, 9], 6: [9, 9], 7: [15, 9] }
    },
    office: {
      name: { zh: "你的办公室", en: "Your office" },
      rows: ["########", "#......#", "#......#", "#......#", "#......#", "##O#####"],
      exits: { O: { to: "void_deck", at: [2, 5] } }
    },
    flat_chen: {
      // 陈阿姨不住 317A：她租的是隔壁出租组屋的一房式（八十年代的一房式出租屋在单独的出租楼里），从楼下走过来
      name: { zh: "陈阿姨家（隔壁出租组屋，一房式）", en: "Mdm Chan's flat (1-room, rental block next door)" },
      rows: ["########", "#......#", "#......#", "#......#", "#......#", "#......#", "#......#", "####R###"],
      exits: { R: { to: "void_deck", at: [1, 3] } }
    },
    flat_lin: {
      name: { zh: "林家（四房式）", en: "The Lims' flat (4-room)" },
      rows: ["############", "#....#.....#", "#....#.....#", "#..........#", "#..........#", "#....#.....#", "#....#.....#", "#..........#", "#####B######"],
      exits: { B: { to: "corridor", at: [7, 1] } }
    },
    flat_aisyah: {
      name: { zh: "Aisyah 家（五房式）", en: "Aisyah's flat (5-room)" },
      rows: ["##############", "#....#...#...#", "#....#...#...#", "#............#", "#............#", "#............#", "#....#...#...#", "#....#...#...#", "#............#", "######C#######"],
      exits: { C: { to: "corridor", at: [12, 1] } }
    },
    flat_mei: {
      name: { zh: "Mei 家（三房式）", en: "Mei's flat (3-room)" },
      rows: ["###########", "#....#....#", "#....#....#", "#.........#", "#.........#", "#.........#", "#.........#", "#.........#", "#####E#####"],
      exits: { E: { to: "corridor", at: [17, 1] } }
    },
    dorm: {
      name: { zh: "客工宿舍的一间房", en: "A dormitory room" },
      rows: ["############", "#..........#", "#..........#", "#..........#", "#..........#", "#..........#", "##X#########"],
      exits: { X: { to: "void_deck", at: [20, 9] } }
    }
  };

  // 物件：GM 只能用这些。maps 是允许出现的地图；"*" 表示任何地图
  const PROPS = {
    chess_table: { name: { zh: "象棋桌", en: "Chess table" }, maps: ["void_deck", "flat_chen"] },
    chess_board: { name: { zh: "旧象棋盘", en: "Old chessboard" }, maps: ["flat_chen", "void_deck"] },
    red_headscarf: { name: { zh: "裱起来的红头巾", en: "Framed red headscarf" }, maps: ["flat_chen"] },
    clogs: { name: { zh: "红色木屐", en: "Red clogs" }, maps: ["flat_chen", "corridor"] },
    long_table: { name: { zh: "长木桌", en: "Long table" }, maps: ["void_deck", "flat_aisyah"] },
    wedding_tent: { name: { zh: "马来婚礼棚", en: "Malay wedding tent" }, maps: ["void_deck"] },
    funeral_wake: { name: { zh: "守夜的灵堂", en: "Funeral wake" }, maps: ["void_deck"] },
    prayer_mat: { name: { zh: "礼拜毯", en: "Prayer mat" }, maps: ["flat_aisyah", "dorm"] },
    kuih_tray: { name: { zh: "一盘马来糕", en: "Tray of kuih" }, maps: ["flat_aisyah", "void_deck", "corridor"] },
    laundry_pole: { name: { zh: "晾衣竹竿", en: "Laundry pole" }, maps: ["corridor", "flat_lin", "flat_aisyah", "flat_mei", "flat_chen"] },
    shoe_rack: { name: { zh: "鞋架", en: "Shoe rack" }, maps: ["corridor"] },
    potted_plant: { name: { zh: "盆栽", en: "Potted plant" }, maps: ["corridor", "void_deck", "flat_chen", "flat_lin", "flat_aisyah", "flat_mei"] },
    altar: { name: { zh: "神台香炉", en: "Altar and incense" }, maps: ["corridor", "flat_chen", "flat_lin"] },
    tv: { name: { zh: "电视", en: "Television" }, maps: ["flat_lin", "flat_aisyah", "flat_mei", "dorm", "void_deck"] },
    sofa: { name: { zh: "皮沙发", en: "Leather sofa" }, maps: ["flat_lin"] },
    flashcards: { name: { zh: "墙上的识字卡", en: "Flashcards on the wall" }, maps: ["flat_lin"] },
    bicycle: { name: { zh: "脚车", en: "Bicycle" }, maps: ["corridor", "void_deck", "flat_lin"] },
    skateboard: { name: { zh: "滑板", en: "Skateboard" }, maps: ["void_deck", "flat_lin"] },
    boxes: { name: { zh: "没拆完的纸箱", en: "Unopened boxes" }, maps: ["flat_mei", "corridor"] },
    calendar: { name: { zh: "东北挂历", en: "Calendar from the north-east" }, maps: ["flat_mei"] },
    couplets: { name: { zh: "手写春联", en: "Hand-written couplets" }, maps: ["flat_mei", "corridor", "flat_chen"] },
    bunk: { name: { zh: "双层铁床", en: "Steel bunk bed" }, maps: ["dorm"] },
    locker: { name: { zh: "储物柜", en: "Locker" }, maps: ["dorm"] },
    family_photo: { name: { zh: "家人照片", en: "Family photo" }, maps: ["dorm", "flat_mei", "flat_aisyah", "flat_lin"] },
    shrine: { name: { zh: "小神像", en: "Small shrine" }, maps: ["dorm"] },
    lunch_tiffin: { name: { zh: "饭盒", en: "Tiffin carrier" }, maps: ["void_deck", "corridor", "dorm"] },
    kopi_cup: { name: { zh: "一杯咖啡乌", en: "Cup of kopi-o" }, maps: ["*"] },
    flyer: { name: { zh: "联络所的传单", en: "Community centre flyer" }, maps: ["*"] },
    notice: { name: { zh: "公告板上的通告", en: "Notice on the board" }, maps: ["void_deck", "corridor", "office"] },
    bench: { name: { zh: "长凳", en: "Bench" }, maps: ["void_deck"] },
    trolley: { name: { zh: "清洁推车", en: "Cleaning trolley" }, maps: ["void_deck", "corridor"] },
    forms: { name: { zh: "一叠表格", en: "Stack of forms" }, maps: ["office", "flat_chen", "flat_aisyah", "flat_mei", "flat_lin"] },
    desk: { name: { zh: "办公桌", en: "Desk" }, maps: ["office"] },
    bed: { name: { zh: "床", en: "Bed" }, maps: ["flat_chen", "flat_lin", "flat_aisyah", "flat_mei"] },
    table: { name: { zh: "饭桌", en: "Dining table" }, maps: ["flat_chen", "flat_lin", "flat_aisyah", "flat_mei"] },
    stove: { name: { zh: "灶台", en: "Stove" }, maps: ["flat_chen", "flat_lin", "flat_aisyah", "flat_mei"] },
    wardrobe: { name: { zh: "衣柜", en: "Wardrobe" }, maps: ["flat_lin", "flat_aisyah", "flat_mei"] }
  };

  // 固定家具（M2）：每张图平时摆着的东西，人走不过去。GM 的场景物件和日子里的临时物件摆在这之上
  const FURNITURE = {
    corridor: [["altar", 6, 1], ["shoe_rack", 8, 1], ["shoe_rack", 13, 1], ["potted_plant", 3, 2], ["shoe_rack", 18, 1]],
    void_deck: [["chess_table", 6, 3], ["notice", 11, 1], ["bench", 12, 5], ["bench", 18, 5], ["trolley", 20, 4]],
    office: [["desk", 3, 1], ["notice", 6, 1]],
    flat_chen: [["altar", 1, 1], ["red_headscarf", 3, 1], ["bed", 6, 1], ["chess_board", 5, 3], ["table", 2, 5], ["stove", 6, 5], ["clogs", 3, 6]],
    flat_lin: [["bed", 1, 1], ["wardrobe", 4, 1], ["flashcards", 6, 1], ["bed", 10, 1], ["sofa", 8, 4], ["tv", 10, 4], ["stove", 1, 6], ["table", 7, 6], ["altar", 9, 7], ["bicycle", 10, 7]],
    flat_aisyah: [["prayer_mat", 1, 1], ["bed", 4, 1], ["bed", 8, 1], ["bed", 12, 1], ["tv", 12, 3], ["table", 9, 5], ["kuih_tray", 10, 5], ["stove", 1, 7], ["long_table", 12, 7]],
    flat_mei: [["bed", 1, 1], ["boxes", 3, 1], ["calendar", 6, 1], ["bed", 9, 1], ["table", 7, 4], ["stove", 1, 6], ["tv", 9, 6], ["couplets", 4, 7]],
    dorm: [["bunk", 1, 1], ["bunk", 4, 1], ["bunk", 7, 1], ["locker", 10, 1], ["family_photo", 1, 4], ["shrine", 10, 4], ["lunch_tiffin", 6, 5]]
  };

  const WALKABLE = new Set([".", "~"]);
  const MAX_PROPS = 14;

  function tile(mapId, x, y) {
    const m = MAPS[mapId];
    // 模型可能漏写坐标或写成别的东西：不是整数就当作地图外
    if (!m || !Number.isInteger(x) || !Number.isInteger(y) || y < 0 || y >= m.rows.length || x < 0 || x >= m.rows[y].length) return null;
    return m.rows[y][x];
  }
  function isExit(mapId, x, y) { const t = tile(mapId, x, y); return !!t && !!MAPS[mapId].exits[t]; }
  function isPlot(mapId, x, y) { const p = MAPS[mapId].plots; return !!p && Object.values(p).some(([px, py]) => px === x && py === y); }
  // 人能站的格子：地面、草地、出入口、地块
  function standable(mapId, x, y) {
    const t = tile(mapId, x, y);
    if (t == null) return false;
    return WALKABLE.has(t) || isExit(mapId, x, y) || /[1-7]/.test(t);
  }
  // 物件能放的格子：地面或草地，不能挡出入口，不能占地块
  function placeable(mapId, x, y) { const t = tile(mapId, x, y); return t != null && WALKABLE.has(t); }
  function propAllowed(kind, mapId) { const p = PROPS[kind]; return !!p && (p.maps.includes("*") || p.maps.includes(mapId)); }

  root.V2Maps = { MAPS, PROPS, FURNITURE, MAX_PROPS, tile, standable, placeable, propAllowed, isExit, isPlot };
})(typeof window !== "undefined" ? window : globalThis);
