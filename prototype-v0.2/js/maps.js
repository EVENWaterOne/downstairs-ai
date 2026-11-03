/* 地图：RPG Maker 式格子地图的固定底图。GM 只能往上摆人和物件（场景 JSON），不能改底图。
 * 11-02 Polaris："只做每个住户自己的房间和交互，办公室和房间走廊之类的不用做"。所以只有五张图：四户的家，加上 Kumar 他们宿舍的房间。
 *   楼下、走廊照样可以在话里提到、在旁白里听到，只是人去不了；游戏端建在楼下地块上的设施由模拟器记着，不画在地图上。
 * 图例：# 墙  . 地面  字母是门。门不再通到别的图：换一家用地图上方的门牌（board.js 的 visit），进门时站在门里面那一格。
 * 坐标 (x, y)：x 是列，y 是行，从 0 开始。不依赖 DOM。 */
(function (root) {
  "use strict";

  const MAPS = {
    flat_chen: {
      // 陈阿姨不住 317A：她租的是隔壁出租组屋的一房式（八十年代的一房式出租屋在单独的出租楼里）
      name: { zh: "陈阿姨家（隔壁出租组屋，一房式）", en: "Mdm Chan's flat (1-room, rental block next door)" }, short: { zh: "陈阿姨家", en: "Mdm Chan's" },
      rows: ["########", "#......#", "#......#", "#......#", "#......#", "#......#", "#......#", "####R###"],
      exits: { R: {} }
    },
    flat_lin: {
      name: { zh: "林家（四房式）", en: "The Lims' flat (4-room)" }, short: { zh: "林家", en: "The Lims'" },
      rows: ["############", "#....#.....#", "#....#.....#", "#..........#", "#..........#", "#....#.....#", "#....#.....#", "#..........#", "#####B######"],
      exits: { B: {} }
    },
    flat_aisyah: {
      name: { zh: "Aisyah 家（五房式）", en: "Aisyah's flat (5-room)" }, short: { zh: "Aisyah 家", en: "Aisyah's" },
      rows: ["##############", "#....#...#...#", "#....#...#...#", "#............#", "#............#", "#............#", "#....#...#...#", "#....#...#...#", "#............#", "######C#######"],
      exits: { C: {} }
    },
    flat_mei: {
      name: { zh: "Mei 家（三房式）", en: "Mei's flat (3-room)" }, short: { zh: "Mei 家", en: "Mei's" },
      rows: ["###########", "#....#....#", "#....#....#", "#.........#", "#.........#", "#.........#", "#.........#", "#.........#", "#####E#####"],
      exits: { E: {} }
    },
    dorm: {
      // Kumar 和工友不住组屋，他们的家是客工宿舍的一间房（10-28 Polaris）
      name: { zh: "客工宿舍的一间房", en: "A dormitory room" }, short: { zh: "宿舍", en: "The dorm" },
      rows: ["############", "#..........#", "#..........#", "#..........#", "#..........#", "#..........#", "##X#########"],
      exits: { X: {} }
    }
  };
  // 门牌栏的顺序（app.js，门牌上写 short）：四户的家，最后是宿舍
  const HOMES = ["flat_chen", "flat_lin", "flat_aisyah", "flat_mei", "dorm"];

  // 物件：GM 只能用这些。maps 是允许出现的地图；"*" 表示任何地图。
  // 11-02 只剩各家以后，只在公共空间出现的东西（马来婚礼棚、灵堂、长凳、公告板、清洁推车、办公桌、鞋架、楼下的象棋桌）拿掉了：
  // 这些事可以在话里提、在旁白里听到，不摆在地图上。Aisyah 家的马来糕可以出现在每一家（送糕）
  const FLATS = ["flat_chen", "flat_lin", "flat_aisyah", "flat_mei"];
  const PROPS = {
    chess_board: { name: { zh: "旧象棋盘", en: "Old chessboard" }, maps: ["flat_chen"] },
    red_headscarf: { name: { zh: "裱起来的红头巾", en: "Framed red headscarf" }, maps: ["flat_chen"] },
    clogs: { name: { zh: "红色木屐", en: "Red clogs" }, maps: ["flat_chen"] },
    long_table: { name: { zh: "长木桌", en: "Long table" }, maps: ["flat_aisyah"] },
    prayer_mat: { name: { zh: "礼拜毯", en: "Prayer mat" }, maps: ["flat_aisyah", "dorm"] },
    kuih_tray: { name: { zh: "一盘马来糕", en: "Tray of kuih" }, maps: FLATS },
    laundry_pole: { name: { zh: "晾衣竹竿", en: "Laundry pole" }, maps: FLATS },
    potted_plant: { name: { zh: "盆栽", en: "Potted plant" }, maps: FLATS },
    altar: { name: { zh: "神台香炉", en: "Altar and incense" }, maps: ["flat_chen", "flat_lin"] },
    tv: { name: { zh: "电视", en: "Television" }, maps: ["flat_lin", "flat_aisyah", "flat_mei", "dorm"] },
    sofa: { name: { zh: "皮沙发", en: "Leather sofa" }, maps: ["flat_lin"] },
    flashcards: { name: { zh: "墙上的识字卡", en: "Flashcards on the wall" }, maps: ["flat_lin"] },
    bicycle: { name: { zh: "脚车", en: "Bicycle" }, maps: ["flat_lin"] },
    skateboard: { name: { zh: "滑板", en: "Skateboard" }, maps: ["flat_lin"] },
    boxes: { name: { zh: "没拆完的纸箱", en: "Unopened boxes" }, maps: ["flat_mei"] },
    calendar: { name: { zh: "东北挂历", en: "Calendar from the north-east" }, maps: ["flat_mei"] },
    couplets: { name: { zh: "手写春联", en: "Hand-written couplets" }, maps: ["flat_mei", "flat_chen"] },
    bunk: { name: { zh: "双层铁床", en: "Steel bunk bed" }, maps: ["dorm"] },
    locker: { name: { zh: "储物柜", en: "Locker" }, maps: ["dorm"] },
    family_photo: { name: { zh: "家人照片", en: "Family photo" }, maps: ["dorm", "flat_mei", "flat_aisyah", "flat_lin"] },
    shrine: { name: { zh: "小神像", en: "Small shrine" }, maps: ["dorm"] },
    lunch_tiffin: { name: { zh: "饭盒", en: "Tiffin carrier" }, maps: ["dorm"] },
    kopi_cup: { name: { zh: "一杯咖啡乌", en: "Cup of kopi-o" }, maps: ["*"] },
    flyer: { name: { zh: "联络所的传单", en: "Community centre flyer" }, maps: ["*"] },
    forms: { name: { zh: "一叠表格", en: "Stack of forms" }, maps: FLATS.concat(["dorm"]) },
    bed: { name: { zh: "床", en: "Bed" }, maps: FLATS },
    table: { name: { zh: "饭桌", en: "Dining table" }, maps: FLATS },
    stove: { name: { zh: "灶台", en: "Stove" }, maps: FLATS },
    wardrobe: { name: { zh: "衣柜", en: "Wardrobe" }, maps: ["flat_lin", "flat_aisyah", "flat_mei"] }
  };

  // 固定家具（M2）：每张图平时摆着的东西，人走不过去。GM 的场景物件和日子里的临时物件摆在这之上
  const FURNITURE = {
    flat_chen: [["altar", 1, 1], ["red_headscarf", 3, 1], ["bed", 6, 1], ["chess_board", 5, 3], ["table", 2, 5], ["stove", 6, 5], ["clogs", 3, 6]],
    flat_lin: [["bed", 1, 1], ["wardrobe", 4, 1], ["flashcards", 6, 1], ["bed", 10, 1], ["sofa", 8, 4], ["tv", 10, 4], ["stove", 1, 6], ["table", 7, 6], ["altar", 9, 7], ["bicycle", 10, 7]],
    flat_aisyah: [["prayer_mat", 1, 1], ["bed", 4, 1], ["bed", 8, 1], ["bed", 12, 1], ["tv", 12, 3], ["table", 9, 5], ["kuih_tray", 10, 5], ["stove", 1, 7], ["long_table", 12, 7]],
    flat_mei: [["bed", 1, 1], ["boxes", 3, 1], ["calendar", 6, 1], ["bed", 9, 1], ["table", 7, 4], ["stove", 1, 6], ["tv", 9, 6], ["couplets", 4, 7]],
    dorm: [["bunk", 1, 1], ["bunk", 4, 1], ["bunk", 7, 1], ["locker", 10, 1], ["family_photo", 1, 4], ["shrine", 10, 4], ["lunch_tiffin", 6, 5]]
  };

  const WALKABLE = new Set(["."]);
  const MAX_PROPS = 14;

  function tile(mapId, x, y) {
    const m = MAPS[mapId];
    // 模型可能漏写坐标或写成别的东西：不是整数就当作地图外
    if (!m || !Number.isInteger(x) || !Number.isInteger(y) || y < 0 || y >= m.rows.length || x < 0 || x >= m.rows[y].length) return null;
    return m.rows[y][x];
  }
  function isExit(mapId, x, y) { const t = tile(mapId, x, y); return !!t && !!MAPS[mapId].exits[t]; }
  // 人能站的格子：地面和门
  function standable(mapId, x, y) {
    const t = tile(mapId, x, y);
    if (t == null) return false;
    return WALKABLE.has(t) || isExit(mapId, x, y);
  }
  // 物件能放的格子：地面，不能挡门
  function placeable(mapId, x, y) { const t = tile(mapId, x, y); return t != null && WALKABLE.has(t); }
  function propAllowed(kind, mapId) { const p = PROPS[kind]; return !!p && (p.maps.includes("*") || p.maps.includes(mapId)); }
  // 门在哪一格；进门时站的那一格（门里面挨着门的地面，不看家具和人，board.js 再从这里找最近的空位）
  function doorOf(mapId) {
    const m = MAPS[mapId];
    if (!m) return null;
    for (let y = 0; y < m.rows.length; y++) for (let x = 0; x < m.rows[y].length; x++) if (isExit(mapId, x, y)) return [x, y];
    return null;
  }
  function entryOf(mapId) {
    const d = doorOf(mapId);
    if (!d) return null;
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) if (placeable(mapId, d[0] + dx, d[1] + dy)) return [d[0] + dx, d[1] + dy];
    return null;
  }

  root.V2Maps = { MAPS, HOMES, PROPS, FURNITURE, MAX_PROPS, tile, standable, placeable, propAllowed, isExit, doorOf, entryOf };
})(typeof window !== "undefined" ? window : globalThis);
