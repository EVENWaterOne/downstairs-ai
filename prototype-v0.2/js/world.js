/* 世界数据：BLK 317A · 日落邻区，1989–2088。
 * 住户的需求、障碍、照片、原作台词来自 Downstairs（team-4 downstairs-demo 分支 engine.js）；
 * 来历、张力、秘密、人生阶段按《V0.2 世界观与角色设定》（docs/V0.2_WORLD.md）。
 * 面向玩家的文字都是 { zh, en } 两份；id 和字段名沿用 Downstairs，方便以后接入真游戏。不依赖 DOM。 */
(function (root) {
  "use strict";

  const START_YEAR = 1989;
  const LEASE_END = 2088;

  const NEEDS = {
    "🪑": { zh: "能坐下歇脚", en: "A place to rest" },
    "🤝": { zh: "邻里往来", en: "Neighbours and company" },
    "🧒": { zh: "托儿", en: "Childcare" },
    "🚌": { zh: "出行", en: "Getting around" },
    "🎊": { zh: "节庆聚会的地方", en: "Room to celebrate" },
    "🍜": { zh: "吃得起、吃得了的饭", en: "Food they can eat and afford" }
  };

  const BARRIERS = {
    "📱": { zh: "要用手机预约", en: "Phone booking required" },
    "📝": { zh: "要先登记", en: "Registration required" },
    "💲": { zh: "太贵", en: "Too expensive" },
    "🗣": { zh: "活动语言听不懂", en: "Activity language barrier" },
    "🚫": { zh: "仅限居民", en: "Residents only" },
    "🍲": { zh: "没有清真食物", en: "No halal options" }
  };

  const BADGES = {
    lively: { zh: "活力", en: "Vibrancy" }, green: { zh: "绿色", en: "Green" },
    tidy: { zh: "整洁", en: "Tidiness" }, standard: { zh: "合规", en: "Compliance" }
  };

  // 设施：needs / stars 照搬 Downstairs
  const FACILITIES = {
    club: { name: { zh: "社区俱乐部", en: "Community Club" }, needs: ["🤝"], stars: { lively: 1 } },
    smart: { name: { zh: "智能社区中心", en: "Smart Community Hub" }, needs: ["🤝"], stars: { tidy: 1, standard: 1 } },
    hawker: { name: { zh: "熟食中心", en: "Hawker Centre" }, needs: ["🍜"], stars: { lively: 1 } },
    walkway: { name: { zh: "有盖走廊", en: "Covered Walkway" }, needs: ["🚌"], stars: { lively: 1 } },
    bus: { name: { zh: "巴士站", en: "Bus Stop" }, needs: ["🚌"], stars: { lively: 1 } },
    roof: { name: { zh: "屋顶花园", en: "Rooftop Garden" }, needs: [], stars: { green: 1 } },
    solar: { name: { zh: "太阳能板", en: "Solar Panels" }, needs: [], stars: { green: 1 } },
    rain: { name: { zh: "雨水花园", en: "Rain Garden" }, needs: [], stars: { green: 1 } },
    childcare: { name: { zh: "托儿中心", en: "Childcare Centre" }, needs: ["🧒"], stars: { standard: 1 } },
    daycare: { name: { zh: "乐龄日间中心", en: "Day Centre" }, needs: ["🪑", "🤝"], stars: { standard: 1 } },
    feedback: { name: { zh: "反馈亭", en: "Feedback Kiosk" }, needs: [], stars: { standard: 1 } },
    rest: { name: { zh: "休息亭", en: "Rest Shelter" }, needs: ["🪑"], stars: {} },
    canteen: { name: { zh: "平价食堂", en: "Affordable Canteen" }, needs: ["🍜"], stars: {} },
    blank: { name: { zh: "留空地", en: "Open Space" }, needs: ["🪑", "🤝", "🎊"], stars: {} }
  };

  // 政策：Downstairs 的政策卡 + 原作信件里的抉择（V0.2 不做信件，改由游戏端当政策执行）。
  // flags 是游戏端开关，access() 会读；delta 是对各户满意度的直接影响（[决定]：原作没有数值满意度）。
  const POLICIES = {
    cleanup: { name: { zh: "楼下清理行动", en: "Clean-up Drive" }, cost: 1, stars: { tidy: 1 }, delta: { aisyah: -4, mei: -4, kumar: -4 }, repeatable: true },
    register: { name: { zh: "上门协助登记", en: "Registration Visits" }, cost: 1, stars: {}, flags: { registration: true }, delta: { chen: 6 } },
    tighten_quota: { name: { zh: "收紧族群配额", en: "Tighten Ethnic Quota" }, cost: 1, stars: { standard: 1 }, flags: { trapped: true }, delta: { aisyah: -20 } },
    flexible: { name: { zh: "配额弹性申请", en: "Flexible Quota" }, cost: 1, stars: { standard: -1 }, flags: { trapped: false }, delta: { aisyah: 12 }, requires: { flag: "trapped" } },
    assisted_counter: { name: { zh: "人工预约柜台", en: "Assisted Booking Counter" }, cost: 1, stars: { tidy: -1 }, flags: { humanWindow: true }, delta: { chen: 8 }, requires: { built: "smart" } },
    rent_rise: { name: { zh: "批准摊位涨租", en: "Allow Stall Rent Rise" }, cost: 1, stars: {}, flags: { rent: true }, delta: { aisyah: -10, mei: -10, kumar: -10 }, requires: { built: "hawker" } },
    keep_stalls: { name: { zh: "保留平价摊位", en: "Retain Affordable Stalls" }, cost: 1, stars: { lively: -1 }, flags: { rent: false }, delta: { aisyah: 4, mei: 4, kumar: 4 }, requires: { built: "hawker" } },
    cooking_corner: { name: { zh: "留出楼下煮食角", en: "Set Aside a Cooking Corner" }, cost: 1, stars: { standard: -1 }, flags: { selfCook: true }, delta: { mei: 8, kumar: 8, lin: -3 } }
  };

  // 住户。tension.a / tension.b 是核心张力的两头；lean 从 -3（完全偏 a）到 3（完全偏 b），0 是两头拉扯。
  const RESIDENTS = {
    chen: {
      name: { zh: "陈阿姨", en: "Mdm Chan" }, full_name: { zh: "陈好", en: "Chan Ho" },
      subtitle: { zh: "三水妇女 · 独居", en: "Samsui woman · Lives alone" },
      home: "flat_chen", born: 1922, arrives: 1989, needs: ["🪑", "🤝"], barriers: ["📱", "📝"],
      photo: { zh: "象棋角", en: "The Chess Corner" },
      bio: {
        zh: "1922 年生于广东三水，1937 年十五岁随同乡姐妹南下，在码头和工地扛砖挑沙四十多年，新加坡早期的组屋有些是她盖的。没有结婚，养女七十年代嫁去澳大利亚，很少回来。1961 年河水山大火烧掉了全部家当。1989 年在 317A 隔壁的出租组屋租下一间一房式，每天走过来，在 317A 楼下跟老伯们下象棋，下得比他们都好，嘴上不饶人。说三水粤语和一点福建话、马来话，不识字，华语只听得懂一点。",
        en: "Born 1922 in Sanshui, Guangdong; came to Singapore in 1937 at fifteen with village sisters and carried bricks and sand on building sites for over forty years. Some early HDB blocks were built by her hands. Never married; her adopted daughter married in Australia in the 1970s and rarely visits. Lost everything in the 1961 Bukit Ho Swee fire. In 1989 she rents a one-room flat in the rental block next to 317A and walks over every day to play Chinese chess with the old men under 317A, beating them all. Speaks Sanshui Cantonese with some Hokkien and Malay, cannot read, understands little Mandarin."
      },
      tension: {
        a: { zh: "建造者", en: "The builder" }, b: { zh: "被遗忘的人", en: "The forgotten" },
        about: { zh: "这座城有一部分是她扛起来的，可华语、表格、手机预约一层层把她落在后面", en: "She carried part of this city on her shoulders, yet Mandarin, forms and phone bookings leave her further behind" },
        toward_a: { zh: "有人向她请教、有人记得她做过什么、象棋角还在", en: "Someone asks her advice, remembers what she built, the chess corner survives" },
        toward_b: { zh: "需要识字、需要手机、需要登记的设施和政策；象棋角消失", en: "Facilities and policies that need reading, phones or registration; the chess corner disappears" }
      },
      voice: { zh: "短句，夹粤语：后生仔、唔该、冇所谓、食咗饭未", en: "Very short English mixed with Cantonese and Singlish: 'Boy, you eat already or not?'" },
      goal: { zh: "楼下还有人一起下棋、说话", en: "Still have people to play chess and talk with downstairs" },
      secrets: [
        { id: "daughter", zh: "养女十几年没回来，红包也停了；她跟邻居说女儿在澳洲做老板", en: "Her daughter has not visited in over ten years and stopped sending money; she tells neighbours her daughter runs a business in Australia" },
        { id: "riot_1964", zh: "1964 年骚乱时，是 Aisyah 家的老祖母把她藏在家里过了一夜", en: "In the 1964 riots, Aisyah's mother-in-law hid her overnight" }
      ],
      first_view: { zh: "又一个拿表格来的年轻人，坐不了五分钟就走", en: "Another young one with forms, gone in five minutes" },
      quote: { zh: "以前楼下有人摆象棋桌。现在活动都要用手机预约，我不会用，也不知道要先登记。", en: "People used to set up chess tables downstairs. Activities now need a booking on a phone. I do not know how to use it, or that I need to register first." },
      stages: [
        { zh: "67–76 岁，身体硬朗，象棋角是她的地盘", en: "Aged 67–76, sturdy; the chess corner is her turf" },
        { zh: "77–86 岁，膝盖坏了；SARS 那年一个人关在家三个月", en: "Aged 77–86, knees failing; alone at home for three months during SARS" },
        { zh: "87–96 岁，很少下楼，可能在这十年过世", en: "Aged 87–96, rarely goes down; may pass away this decade" }
      ],
      // 没有深刻意义的日常：GM 可以直接拿来用，不必点题
      everyday: [
        { zh: "每天下午去巴刹买一条小鱼，跟鱼贩为两毛钱吵半天", en: "Buys one small fish at the market every afternoon and haggles over twenty cents" },
        { zh: "赢了棋会得意一整个下午，输了就说今天太热", en: "Gloats for the whole afternoon after a win; after a loss, it was too hot today" }
      ],
      members: [{ id: "chen", name: { zh: "陈阿姨", en: "Mdm Chan" }, from: 1989, to: null }]
    },
    lin: {
      name: { zh: "林家", en: "The Lim Family" }, full_name: { zh: "林伟明、郑慧玲和林俊豪", en: "Lim Wei Ming, Tay Hui Ling and Lim Jun Hao" },
      subtitle: { zh: "双职工年轻家庭", en: "Young dual-income family" },
      home: "flat_lin", born: 1960, arrives: 1989, needs: ["🧒", "🚌"], barriers: [],
      photo: { zh: "周末滑板", en: "Weekend Skateboarding" },
      bio: {
        zh: "林伟明（1960 年生，福建人）理工学院毕业、服完兵役，进了一家美资硬盘厂，从技术员做到工程师，每年还回营做后备军人。郑慧玲（1962 年生，潮州人）1980 年进银行，从柜台文员做起，想升主任。儿子俊豪 1988 年生。两边父母住在别的镇，帮不上忙，托儿中心要排队一年。家里说华语，跟孩子说英语。他们是真心觉得新加坡待他们不薄的一家：什么设施都能用，日子一年比一年好，这也是他们的盲点，他们不太看得见别人为什么用不上。",
        en: "Lim Wei Ming (b. 1960, Hokkien) finished polytechnic and national service, then joined an American hard-disk plant, rising from technician to engineer; he still does reservist training. Tay Hui Ling (b. 1962, Teochew) joined a bank in 1980 as a counter clerk and wants to make officer. Their son Jun Hao was born in 1988. Both sets of parents live in other towns; the childcare queue is a year long. Mandarin at home, English with the boy. They sincerely feel Singapore has treated them well: every facility works for them and each year is better than the last. That is also their blind spot; they rarely see why others cannot get in."
      },
      // 林家的核心张力是一家人共同的去留，倾向记在家庭这一层；伟明、慧玲各自另有一对（见 members）
      split: true, tension_holder: "family",
      tension: {
        a: { zh: "往上走", en: "Moving up" }, b: { zh: "留下来", en: "Staying put" },
        about: { zh: "新加坡告诉他们努力就能往上走，可他们的人情、父母和孩子的童年都在这座楼里", en: "Singapore tells them hard work moves you up, yet their ties, parents and their son's childhood are all in this block" },
        toward_a: { zh: "升职、学区、私宅、邻里摩擦", en: "Promotions, school districts, condos, friction with neighbours" },
        toward_b: { zh: "邻居帮他们带过孩子、楼下有他们在乎的人和事", en: "Neighbours who minded their son; people and things downstairs they care about" }
      },
      voice: { zh: "华语夹英文和 Singlish：这个 can or not？我们很 busy 的", en: "Fluent Singapore English: 'Can help us check the childcare list? We both work, very difficult one.'" },
      goal: { zh: "两个人都能继续上班，孩子有人照顾，将来住得更好", en: "Both keep working, the boy is cared for, and someday a better home" },
      // holder：只有这个人知道，家里其他人也不知道；没有 holder 的是全家都知道、只瞒着外人的事
      secrets: [
        { id: "condo", zh: "伟明一直攒钱想买私宅搬走，慧玲不想离父母太远", en: "Wei Ming saves to buy a condo and leave; Hui Ling does not want to move far from her parents" },
        { id: "laid_off", holder: "weiming", from: 1998, zh: "1998 年初伟明的厂把新加坡的生产线关了，他被裁员，三个月没告诉家里，每天照样穿衬衫出门", en: "In early 1998 Wei Ming's plant shut its Singapore line and he was retrenched; for three months he told no one at home and left every morning in a shirt" },
        { id: "hk_offer", holder: "huiling", from: 1996, zh: "1996 年银行想调慧玲去香港分行升主任，她为了俊豪推掉了，从没跟伟明提过", en: "In 1996 the bank offered Hui Ling a promotion to its Hong Kong branch; she turned it down for Jun Hao's sake and never told Wei Ming" }
      ],
      first_view: { zh: "一个可以帮忙排托儿名额的人", en: "Someone who might help with the childcare queue" },
      quote: { zh: "我们什么设施都能用。我们需要有人带孩子，需要交通去上班。楼下的路也要好走。", en: "We can use all the facilities. We need someone to care for our child and transport to work. The paths downstairs need to be easy to get around, too." },
      stages: [
        { zh: "托儿排队、通勤、加班；慧玲升了主任，最爱投诉也最爱参加活动；1998 年初伟明被裁，瞒了三个月", en: "Childcare queue, commuting, overtime; Hui Ling makes officer, complains most and joins most; Wei Ming is retrenched in early 1998 and hides it for three months" },
        { zh: "俊豪 2000 年考 PSLE，后来读理工学院；伟明改行卖保险，比以前更信肯干就有出路；家里主要靠慧玲的收入", en: "Jun Hao sits the PSLE in 2000, later goes to polytechnic; Wei Ming sells insurance and believes harder than ever that effort pays; Hui Ling's salary carries the home" },
        { zh: "俊豪 2008 年入伍，服完兵役去澳洲读书，家里空了；真有钱买私宅时，慧玲反而不想走", en: "Jun Hao enlists in 2008 and goes to study in Australia after NS; the flat empties; when they can finally afford a condo, Hui Ling no longer wants to go" }
      ],
      everyday: [
        { zh: "周末一家三口去巴刹吃早餐，伟明永远点同一碗鱼片米粉", en: "Weekend breakfast at the market, Wei Ming always ordering the same fish-slice bee hoon" },
        { zh: "慧玲追第八波道的连续剧，到了关键时刻谁打电话来都不接", en: "Hui Ling follows the Channel 8 drama and will not pick up the phone at the cliffhanger" }
      ],
      members: [
        {
          id: "weiming", name: { zh: "林伟明", en: "Lim Wei Ming" }, from: 1989, to: null, born: 1960,
          bio: { zh: "那套肯学、肯干就有出路的道理，他是受益者：理工学院、硬盘厂、四房式。他喜欢给年轻人讲道理。", en: "He has done well by the creed that anyone who learns and works hard will get on: polytechnic, the disk plant, a four-room flat. He likes giving young people advice." },
          goal: { zh: "让这个家一年比一年好，证明肯干就有出路", en: "Make each year better for the family than the last, and prove that hard work pays" },
          // about_from：about 里写的是以后的走向，这一年之前不给角色本人看（提示词里只给两头和推力）
          tension: {
            about_from: 1998,
            a: { zh: "信念", en: "Belief" }, b: { zh: "经历", en: "Experience" },
            about: { zh: "被裁以后他没有怀疑那套道理，反而抓得更紧，好像只要自己重新站起来，就证明它还是对的。这让他撑住了，也让他越来越看不懂那些从来没机会往上走的人，比如 Kumar", en: "After the retrenchment he does not doubt the creed; he holds it tighter, as if getting back on his feet will prove it right. It keeps him standing, and makes him less and less able to understand people who never had a way up, like Kumar" },
            toward_a: { zh: "重新找到出路、卖出保险、有人请他给年轻人讲讲道理", en: "Finding a way back, closing a sale, being asked to give young people advice" },
            toward_b: { zh: "被裁、求职被拒、看见肯干却没有出路的人、儿子不想走他那条路", en: "Retrenchment, rejected applications, seeing hard workers with no way up, a son who will not follow his path" }
          },
          // 口头禅放在 voice 里：设定门不拦 voice，台词可以照说
          voice: { zh: "讲实际，爱讲道理，口头禅：这个国家给你机会，你要自己争气。被问到难处就笑着说没事、已经有安排了", en: "Practical, likes to give advice; his line: 'The country gives you a chance, the rest is up to you.' Asked about trouble, he smiles and says it's fine, he has something lined up" }
        },
        {
          id: "huiling", name: { zh: "郑慧玲", en: "Tay Hui Ling" }, from: 1989, to: null, born: 1962,
          bio: { zh: "八十年代大批走进职场的那一代女人之一，能干、要强，是楼里热心张罗活动的人，也是最常投诉楼下乱的人：工人坐在楼梯口、走廊堆东西、婚礼棚子挡了车位。她不觉得自己有偏见，她只是希望一切有秩序。", en: "One of the generation of women who poured into work in the 1980s: capable and driven, the one who organises things in the block, and the one who complains most about mess: workers on the stairs, clutter in the corridor, a wedding tent over the parking. She does not think she is prejudiced; she just wants order." },
          goal: { zh: "升到主任，自己的事业和这个家都不松手", en: "Make officer, and let go of neither her career nor the family" },
          tension: {
            about_from: 1999,
            a: { zh: "自己的事业", en: "Her own career" }, b: { zh: "这个家", en: "This family" },
            about: { zh: "她从柜台做到主任，伟明失业那几年家里靠她；可家里的大事还是习惯由伟明拍板，连他被裁她都是最后一个知道的。她生气的不是丢了工作，而是凭什么不告诉我", en: "She rose from the counter to officer and carried the household through Wei Ming's lost years, yet big decisions are still his by habit, and she was the last to learn he had been retrenched. What angers her is not the lost job but being kept out of it" },
            toward_a: { zh: "升职、被派去别处、被当成只是个太太", en: "A promotion, a posting elsewhere, being treated as just a wife" },
            toward_b: { zh: "托儿排不上、俊豪出事、父母老了、伟明需要她", en: "No childcare place, trouble with Jun Hao, ageing parents, Wei Ming needing her" }
          },
          voice: { zh: "快，利落，先讲重点；生气时反而很客气", en: "Quick and to the point; when angry she becomes very polite" }
        },
        { id: "junhao", name: { zh: "林俊豪", en: "Lim Jun Hao" }, from: 1989, to: 2011, born: 1988, talks_from: 1993,
          bio: {
            zh: "林家的独子，1988 年生。", en: "The Lims' only child, born 1988.",
            later: [
              { from: 1993, zh: "在楼下骑脚车。", en: "Rides his bicycle under the block." },
              { from: 1995, zh: "1995 年上了小一；脚车坏了就去找 Kumar，跟他学会了补车胎。", en: "Started Primary 1 in 1995; when his bicycle breaks he goes to Kumar, who taught him to patch tyres." },
              { from: 2000, zh: "2000 年考了 PSLE。", en: "Sat the PSLE in 2000." }
            ]
          },
          goal: { zh: "骑脚车，跟楼下的大孩子一起玩", en: "Ride his bicycle and play with the big kids downstairs" },
          voice: { zh: "小孩子的新加坡英语，夹几个家里说的华语词", en: "A small boy's Singapore English, with a few Mandarin words from home" } }
      ]
    },
    aisyah: {
      name: { zh: "Aisyah 一家", en: "Aisyah’s Family" }, full_name: { zh: "Rahman、Aisyah 和孩子们", en: "Rahman, Aisyah and their children" },
      subtitle: { zh: "从甘榜迁来的马来家庭", en: "Malay family resettled from the kampong" },
      home: "flat_aisyah", born: 1953, arrives: 1989, needs: ["🎊", "🍜"], barriers: ["🍲", "💲"],
      photo: { zh: "开斋节长桌", en: "The Hari Raya Table" },
      bio: {
        zh: "Rahman bin Osman（1950 年生）1970 年开始开巴士，1973 年几家巴士公司合并成新加坡巴士公司（SBS）后一直开到现在，话少、固执、虔诚。Aisyah binte Kassim（1953 年生）是这个家的灵魂，在家做椰浆饭和马来糕，卖给邻居，每天清早也送一盘去巴刹旁老熟食中心的摊位寄卖。四个孩子，长女 Nurul（1975 年生）最直接，最小的 Hafiz（1985 年生）在楼下踢球长大；老祖母 Mak Esah（1920 年生）同住。原来就住在这片地上的甘榜，八十年代中期征地，1989 年作为安置户分到 317A，是这片土地最早的主人之一。阳台上收着一张可以拆开的长木桌，过节时搬下楼。",
        en: "Rahman bin Osman (b. 1950) started driving buses in 1970 and has driven for Singapore Bus Service since the companies merged in 1973: quiet, stubborn, devout. Aisyah binte Kassim (b. 1953) is the heart of the home; she makes nasi lemak and kuih for the neighbours and every morning drops a tray at a stall in the old hawker centre by the market. Four children: the eldest, Nurul (b. 1975), says what she thinks; the youngest, Hafiz (b. 1985), grows up playing football downstairs. Grandmother Mak Esah (b. 1920) lives with them. They lived in the kampong on this very land until it was acquired in the mid-1980s, and were given a resettlement flat in 317A in 1989, so they are among its first owners. A folding long table waits on the balcony for festivals."
      },
      // 一家人各有各的想法：和气 ↔ 公道 在 Aisyah 本人心里来回，Rahman 和 Nurul 是把她往两头拉的人（他们有自己的目标，不另设张力）
      split: true, tension_holder: "aisyah_kassim",
      tension: {
        a: { zh: "和气", en: "Keeping the peace" }, b: { zh: "公道", en: "Fairness" },
        about: { zh: "既要和邻居、和政府保持和气，又咽不下不公平；Rahman 要她忍，Nurul 要她说，她自己两头都放不下", en: "She must keep the peace with neighbours and the authorities, yet cannot swallow unfairness; Rahman wants her to bear it, Nurul wants her to speak, and she cannot let go of either" },
        toward_a: { zh: "邻居来吃开斋节的糕、有人替他们说话", en: "Neighbours come for Hari Raya kuih; someone speaks up on their behalf" },
        toward_b: { zh: "卖房被配额卡住、清理行动收走长桌、没有清真摊位", en: "The quota blocks their sale, the clean-up takes away the long table, no halal stalls" }
      },
      voice: { zh: "Aisyah 的华语是甘榜和巴刹学的，简单，夹马来语：吃啦吃啦，makan dulu；Insya-Allah", en: "Singapore English with Malay: 'Come, makan first. Don't shy.'" },
      goal: { zh: "过节时邻居们还能聚在一张桌子边，孩子们有出息", en: "Neighbours still gather at one table for festivals; the children do well" },
      secrets: [
        { id: "riot_1964", holder: "mak_esah", zh: "1964 年骚乱时，老祖母 Mak Esah 把一个华人女工藏在家里过了一夜，那人就是陈阿姨", en: "In the 1964 riots, Mak Esah hid a Chinese labourer overnight: Mdm Chan" },
        { id: "move_bedok", from: 2009, zh: "他们在考虑卖房搬去勿洛，离亲戚近一点；可亲戚住的那几座楼马来比例已经满了，他们买不进去", en: "They are thinking of selling to move to Bedok, near relatives, but the blocks where the relatives live have reached their Malay limit, so they cannot buy there" },
        { id: "signed_early", holder: "rahman", zh: "八十年代征地时，Rahman 是甘榜里最早签字、拿了赔偿的几户之一。有老邻居说过他太听话，这句话他记到现在，从不提", en: "When the kampong was acquired in the 1980s, Rahman was among the first to sign and take compensation. An old neighbour once called him too obedient; he still remembers it and never mentions it" },
        { id: "savings", holder: "aisyah_kassim", zh: "卖糕的钱比 Rahman 以为的多，她一点一点存着，留给孩子们读书", en: "The kuih money is more than Rahman thinks; she puts it aside bit by bit for the children's schooling" },
        { id: "boyfriend", holder: "nurul", from: 1993, to: 2002, zh: "Nurul 在理工学院交了一个印度穆斯林男朋友，还不敢告诉爸爸；妈妈大概猜到了", en: "At polytechnic Nurul is seeing an Indian Muslim boy and dares not tell her father; her mother has probably guessed" },
        { id: "trial", holder: "hafiz", from: 2000, zh: "Hafiz 偷偷去国家队的青训试训过，没选上，谁也没说", en: "Hafiz secretly tried out for the national youth squad, was not picked, and told no one" }
      ],
      first_view: { zh: "Aisyah 会请你吃东西；Rahman 会看你吃不吃、怎么吃", en: "Aisyah will feed you; Rahman will watch whether and how you eat" },
      quote: { zh: "热闹的地方不一定有我们能吃的东西。以前过节，我们会在楼下摆一张长桌。现在还有地方摆吗？", en: "A lively place does not always have food we can eat. During festivals, we used to put a long table downstairs. Is there still room for it now?" },
      stages: [
        { zh: "EIP 刚推出还没感觉；长桌摆在 void deck，老祖母还在；Nurul 读理工学院，恋爱了；1994 年马来西亚杯决赛那晚，Rahman 和 Hafiz 跟全楼的人一起守着电视", en: "EIP is new and not yet felt; the long table is on the void deck; grandmother is alive; Nurul is at polytechnic and in love; on the night of the 1994 Malaysia Cup final Rahman and Hafiz watch with the whole block" },
        { zh: "老祖母过世；Nurul 和印度穆斯林丈夫在 void deck 办婚礼，Rahman 最后还是出来招呼客人；Hafiz 服兵役；熟食中心清真摊不够", en: "Grandmother passes; Nurul marries her Indian Muslim husband with a wedding on the void deck, and Rahman comes out to greet the guests after all; Hafiz does national service; too few halal stalls" },
        { zh: "想卖房：这座楼华人比例是满的，不能卖给华人买家，只能等马来、印度和其他族群的买家，等了很久，出价也低；勿洛那边又买不进；孙辈出生；Rahman 退休", en: "They try to sell: the block is at its Chinese limit, so they cannot sell to Chinese buyers and must wait for Malay, Indian or other buyers; the wait is long and offers are low, and Bedok is closed to them too; grandchildren; Rahman retires" }
      ],
      everyday: [
        { zh: "Rahman 开早班，下午回来先睡一觉，傍晚在走廊上听马来语电台的足球", en: "Rahman drives the early shift, naps in the afternoon and listens to football on Malay radio in the corridor at dusk" },
        { zh: "厨房里总有一锅东西在煮，Hafiz 放学进门先掀锅盖", en: "There is always a pot on the stove; Hafiz lifts the lid the moment he gets home" }
      ],
      members: [
        {
          id: "rahman", name: { zh: "Rahman", en: "Rahman" }, from: 1989, to: null, born: 1950,
          bio: { zh: "觉得马来人要自己争气，不欠人情、不惹事。政府给了他们一间五房式、他有一份稳定的工，做人要知足。不喜欢女儿嫁给不同族群的人。", en: "Believes Malays must stand on their own feet, owe no favours and make no trouble. The government gave them a five-room flat and him a steady job; one should be content. Does not want his daughter marrying outside her race." },
          goal: { zh: "把这个家体体面面地撑到退休，孩子们都有正当的工作，嫁娶都在自己人里", en: "Keep the family respectable until he retires; every child in decent work, marrying within their own" },
          view: { zh: "遇到不公平先忍，自己做得更好就是回答；家里的事不在外人面前说", en: "Bear unfairness first; doing better yourself is the answer; family matters stay inside the family" },
          voice: { zh: "话少，马来语为主，华语和英语都只说短句：Tak payah，不用了", en: "Few words, mostly Malay, short phrases in English: 'Tak payah, no need.'" }
        },
        {
          id: "aisyah_kassim", name: { zh: "Aisyah", en: "Aisyah" }, from: 1989, to: null, born: 1953,
          // 王美洗碗的事她是知道的，记在 Mei 家的秘密 dishwashing 里（known_to，1994 年起）
          bio: { zh: "在丈夫和女儿之间两头说好话，什么都看在眼里，看见了也不说。", en: "Smooths things between her husband and her daughter, and notices everything; what she sees, she keeps to herself." },
          goal: { zh: "一家人和邻居都还能坐在一张长桌边，谁也不用下不了台", en: "Family and neighbours still around one long table, with no one losing face" },
          view: { zh: "过日子要圆；可谁欠了谁一个公道，她都记得", en: "Life must be kept smooth; yet she remembers exactly who is owed fairness" }
        },
        {
          id: "nurul", name: { zh: "Nurul", en: "Nurul" }, from: 1989, to: 2003, born: 1975,
          bio: {
            zh: "英文学校读出来的一代。觉得自己首先是新加坡公民，该有的就该有，不必靠谁体谅。", en: "Of the English-school generation. Sees herself first as a Singapore citizen: what is due should be given, not granted as a kindness.",
            later: [{ from: 1992, zh: "1992 年进了理工学院读商科。", en: "Entered polytechnic for business studies in 1992." }]
          },
          goal: { zh: "读完书，做一份不用看人脸色的工作，有话当面说", en: "Finish her studies, find work where she need not read anyone's face, and say things to people directly" },
          view: { zh: "不公平就该讲出来，讲给该听的人听；嫌爸爸太忍、妈妈太圆", en: "Unfairness should be named, to the people who need to hear it; thinks her father too patient and her mother too smooth" },
          voice: { zh: "英语为主，说话直接，夹几句马来语；跟长辈说马来语", en: "Mostly English, and direct, with a few Malay words; Malay with her elders" }
        },
        {
          id: "hafiz", name: { zh: "Hafiz", en: "Hafiz" }, from: 1989, to: null, born: 1985,
          bio: {
            zh: "从小在 void deck 跟华人、印度孩子一起踢球，满口 Singlish。", en: "Plays football on the void deck with Chinese and Indian kids, all Singlish.",
            later: [{ from: 1993, zh: "比俊豪大几岁，是楼下孩子们的头。", en: "A few years older than Jun Hao and the leader of the kids downstairs." }]
          },
          goal: { zh: "踢球，跟朋友混在一起，将来当球员", en: "Football, his friends, and one day playing for a team" },
          view: { zh: "不太想族群的事，朋友就是朋友；觉得爸爸和姐姐吵的东西很 heavy", en: "Does not think much about race; friends are friends; finds his father's and sister's arguments 'very heavy'" },
          voice: { zh: "满口 Singlish 夹马来语，说话快，总在喊人一起踢球", en: "Fast Singlish with Malay thrown in; always calling people to come and play football" }
        },
        {
          id: "mak_esah", name: { zh: "Mak Esah", en: "Mak Esah" }, from: 1989, to: 2001, born: 1920,
          bio: { zh: "只说马来语，和陈阿姨用巴刹马来话交谈。甘榜时代邻里有事都来找她。", en: "Speaks only Malay, and talks with Mdm Chan in bazaar Malay. In the kampong days everyone came to her when something was wrong." },
          goal: { zh: "看着孙子孙女成家，长桌还能摆起来", en: "See her grandchildren married, and the long table still set out" },
          view: { zh: "甘榜里没有那么多规矩，邻居就是邻居", en: "In the kampong there were not so many rules; a neighbour was a neighbour" },
          voice: { zh: "只说马来语，话少，说话时会拍拍人的手", en: "Malay only, few words; pats your hand while she talks" }
        }
      ]
    },
    mei: {
      name: { zh: "Mei 一家", en: "Mei’s Family" }, full_name: { zh: "王美、周建国和周晓雨", en: "Wang Mei, Zhou Jianguo and Zhou Xiaoyu" },
      subtitle: { zh: "九十年代来的中国专才家庭", en: "PRC talent family arriving in the 1990s" },
      // 1992 年来新加坡，先在隔壁楼租房间；317A 是 1989 年的新楼，原屋主住满 5 年（最低居住年限）才能在公开市场转售，所以 1994 年才买得到
      home: "flat_mei", born: 1963, arrives: 1994, needs: ["🍜", "🤝"], barriers: ["🗣", "💲"],
      photo: { zh: "第一次敲邻居家的门", en: "The First Knock Next Door" },
      bio: {
        zh: "周建国（1960 年生，哈尔滨人）1992 年被一家外资电子厂聘来新加坡，和林伟明同一行。王美（1963 年生）原来是哈尔滨一所中学的语文老师。来了以后她想回学校教书，可国内的文凭和教龄换不成这里公立学校的任职资格，英语也过不了面试；碰壁几次以后，先在托儿中心做兼职清洁，后来在巴刹旁那个老熟食中心洗碗。女儿晓雨 1986 年生，1993 年上小一，第一年哭了很多次。一家人先在隔壁那座楼租了一个房间，1993 年夫妻都拿到永久居民，1994 年买下 317A 一户移民加拿大人家的二手三房式。她说标准普通话，可楼下老人说福建话、广东话，年轻人说英语和 Singlish，联络所的传单是英文的。",
        en: "Zhou Jianguo (b. 1960, Harbin) was recruited to Singapore in 1992 by a foreign electronics plant, the same industry as Lim Wei Ming. Wang Mei (b. 1963) taught Chinese at a Harbin secondary school. Here she tried to go back to teaching, but her Chinese diploma and years of service did not convert into a local public-school post, and her English did not get her through interviews; after a few rejections she cleaned part-time at a childcare centre, then washed dishes at the old hawker centre by the market. Their daughter Xiaoyu (b. 1986) started Primary 1 in 1993 and cried through much of the first year. The family first rented a room in the next block; both parents became permanent residents in 1993, and in 1994 they bought a resale three-room flat in 317A from a family emigrating to Canada. Her Mandarin is standard, but the old folk speak Hokkien and Cantonese, the young speak English and Singlish, and the community centre's flyers are in English."
      },
      // Mei 家的核心张力是王美自己的，倾向记在她身上
      split: true, tension_holder: "wangmei",
      tension: {
        a: { zh: "熟悉", en: "Familiar" }, b: { zh: "陌生", en: "Strange" },
        about: { zh: "满街汉字和华人的脸，一开口全对不上", en: "Chinese signs and Chinese faces everywhere, yet nothing fits once she speaks",
          later: [{ from: 2009, zh: "；如今新加坡熟了，回哈尔滨反而成了陌生人", en: "; now Singapore is familiar and Harbin has become strange" }] },
        anchor: { zh: "\"我是老师\"是她唯一完全熟悉的东西。她在乎的不是瞒住洗碗这份工，而是别人怎么看她：在熟食中心天天见面的人面前，她可以是一起干活的人；在林家这些只知道她教华文的人面前，她还是王老师。守住这个样子，是一种被逼出来的自尊。被人当成只是个洗碗的，她脚下的地就没了；有人尊重她是老师（请她教华文、写春联），她就在这里有了落脚处。她也不只是守着它：她帮邻居孩子改作文，老师是她还在做的事", en: "'I am a teacher' is the one thing fully familiar to her. What she cares about is not hiding the dishwashing but how she is seen: to the people she meets at the hawker centre every day she can be a fellow worker; to the Lims and others who know her only as the woman who teaches Chinese she is still Teacher Wang. Keeping that picture is a self-respect forced on her. Being taken for just a dishwasher pulls the ground away; being respected as a teacher (asked to teach Chinese, write couplets) gives her a footing here. Nor does she only guard it: she corrects the neighbours' children's compositions; teaching is something she still does",
          later: [{ from: 1999, zh: "；这些年慢慢有人专门来请教华文", en: "; over the years people have started coming to her for Chinese" }] },
        toward_a: { zh: "有人敲门、在熟食中心跟 Aisyah 学做糕、有人请她改作文、有人尊重她是老师", en: "Someone knocks; learning kuih with Aisyah; being asked to correct a composition; being respected as a teacher" },
        toward_b: { zh: "英文传单、被叫\"大陆人\"、被当成只是个洗碗的", en: "English-only flyers, being called 'PRC', being taken for just a dishwasher" }
      },
      voice: { zh: "标准北方普通话，讲究措辞，熟了以后有东北人的幽默", en: "Careful, bookish English: 'Excuse me, may I ask whether this activity requires registration?'" },
      goal: { zh: "在这里真的有朋友，女儿有出息", en: "Real friends here, and a good future for her daughter" },
      secrets: [
        // known_to：别的户里也知道这件事的人
        { id: "dishwashing", from: 1994, known_to: ["aisyah_kassim", "kumar"], zh: "她在巴刹旁那个老熟食中心洗碗。每天去送糕的 Aisyah、中午在那里吃饭的 Kumar 他们、炒粿条的阿成都看见过，谁也没说破；林家和建国厂里的同事不知道。她不怕被看见的人知道，怕的是别人知道以后，把她当成什么人", en: "She washes dishes at the old hawker centre by the market. Aisyah, who drops off kuih every morning, Kumar's crew, who eat lunch there, and Ah Seng at the char kway teow stall have all seen her and said nothing; the Lims and Jianguo's colleagues do not know. She does not mind those who see her; what she fears is what others will take her for once they know" },
        { id: "not_a_teacher", holder: "wangmei", zh: "她真正怕的不是别人知道她在洗碗，而是连自己都开始不信自己还是老师。有人笑着说你可以开补习班，她会突然不说话：她分不清那是认她是老师，还是在说她只能做补习", en: "What she truly fears is not people finding out about the dishes but no longer believing, herself, that she is a teacher. When someone laughs that she could open a tuition centre she goes quiet: she cannot tell whether it honours her as a teacher or tells her tuition is all she can be" },
        { id: "return", zh: "周建国一直在考虑回国，王美不想再搬一次家", en: "Jianguo keeps thinking of going back to China; Mei will not move again" }
      ],
      first_view: { zh: "一个本地人，不知道会不会看不起她", en: "A local; she cannot tell if you will look down on her" },
      quote: { zh: "俱乐部活动用的语言我还是听不太懂。希望有个吃得起饭的地方，也希望有邻居愿意敲门打个招呼。", en: "I still find it hard to understand the language used for club activities. I hope there is somewhere we can afford to eat, and a neighbour willing to knock and say hello." },
      stages: [
        { zh: "1994 年搬进来，箱子没拆完，听不懂，交不到朋友；在熟食中心天天碰见来送糕的 Aisyah；开始帮邻居孩子改作文；1998 年帮俊豪补华文，不肯收钱", en: "Moves in in 1994, boxes unopened, cannot follow, no friends yet; sees Aisyah every morning when she drops off kuih at the hawker centre; starts correcting the neighbours' children's compositions; in 1998 tutors Jun Hao in Chinese and will not take money" },
        { zh: "入籍；晓雨华文比同学好，后来上了大学；跟 Aisyah 熟了，学做马来糕；有人专门来请她教华文；对更新来的移民，她说出了当年别人对她说过的话", en: "Naturalised; Xiaoyu's Chinese beats her classmates' and she gets into university; grows close to Aisyah and learns to make kuih; people come to her for Chinese; to newer migrants she says what was once said to her" },
        { zh: "2013 年前后网上对新移民的敌意，她在楼下也感觉得到；晓雨要和本地男朋友结婚；回哈尔滨反而陌生", en: "Feels the online hostility to new migrants around 2013 even downstairs; Xiaoyu is to marry a local boyfriend; Harbin now feels foreign" }
      ],
      everyday: [
        { zh: "晚上在走廊上织毛衣，跟晓雨用东北话斗嘴", en: "Knits in the corridor in the evenings, bickering with Xiaoyu in north-eastern Mandarin" },
        { zh: "建国周末在家包饺子，一包就是一百个，分给左邻右舍", en: "At weekends Jianguo makes dumplings, a hundred at a time, and hands them round the corridor" }
      ],
      members: [
        {
          id: "wangmei", name: { zh: "王美", en: "Wang Mei" }, from: 1994, to: null, born: 1963,
          bio: { zh: "很要面子，非常想交朋友，却总在等别人先来敲门。她觉得本地华人华文差、没文化，本地人觉得她傲慢；两边都有一点对。她可以拒绝施舍，却会很认真地教一个孩子写作文。", en: "Proud, longing for friends, always waiting for someone else to knock first. She thinks local Chinese have poor Chinese and little culture; locals think she is arrogant; both are partly right. She will refuse charity, yet will teach a child to write an essay with great care." },
          goal: { zh: "在这里真的有朋友，女儿有出息，还有人叫她一声王老师", en: "Real friends here, a good future for her daughter, and someone who still calls her Teacher Wang" }
        },
        {
          id: "jianguo", name: { zh: "周建国", en: "Zhou Jianguo" }, from: 1994, to: null, born: 1960,
          bio: { zh: "厂里的好工程师，话不多，看得出别人有难处，却拿不准该不该问。国内这几年发展得快，他心里一直放着回去这件事。", en: "A good engineer, not talkative; he can tell when someone is struggling but never knows whether to ask. China is booming and the thought of going back never leaves him." },
          goal: { zh: "把活干好，攒一笔钱，哪天回去也不丢人", en: "Do good work and save enough that going back one day would not be a loss of face" },
          voice: { zh: "东北口音的普通话，实在，爱开玩笑但点到为止", en: "Plain-spoken Mandarin with a north-eastern accent; jokes, but never too far" }
        },
        { id: "xiaoyu", name: { zh: "周晓雨", en: "Zhou Xiaoyu" }, from: 1994, to: null, born: 1986,
          bio: { zh: "1993 年上小一，英文追得很快，在学校说英语，回家说普通话", en: "Started Primary 1 in 1993 and caught up fast in English; English at school, Mandarin at home",
            later: [{ from: 1999, zh: "，慢慢地两边都说得像本地人", en: ", and she has come to sound local in both" }] },
          goal: { zh: "在班上交到朋友，不被人笑口音", en: "Make friends in class and not be laughed at for her accent" },
          voice: { zh: "在家说普通话，带一点爸妈的东北腔；在外面英语越说越多", en: "Mandarin with a touch of her parents' north-eastern accent at home; more and more English outside" } }
      ]
    },
    kumar: {
      name: { zh: "Kumar 和工友", en: "Kumar & Friends" }, full_name: { zh: "Kumar Rajendran、Shohel，后来的 Murugan", en: "Kumar Rajendran, Shohel, later Murugan" },
      subtitle: { zh: "南亚客工 · 不是居民", en: "South Asian migrant workers · Not residents" },
      home: "dorm", born: 1966, arrives: 1989, needs: ["🪑", "🍜"], barriers: ["🚫", "💲", "📝"],
      photo: { zh: "午间的阴凉", en: "Shade at Lunchtime" },
      bio: {
        zh: "Kumar Rajendran（1966 年生，泰米尔纳德邦坦贾武尔人）1987 年来新加坡做建筑，317A 就有他参与盖的。楼盖好以后，他转到市镇理事会的清洁承包商，负责这几座楼的清洁维修。老家有妻子 Lakshmi，每月把大部分工资寄回去。他和工友们住在半小时车程外的宿舍，十几个人一间房，每天早上被卡车载来。中午没地方坐，就蹲在楼梯底下吃带来的饭。",
        en: "Kumar Rajendran (b. 1966, Thanjavur, Tamil Nadu) came in 1987 as a construction worker and helped build 317A. Once it was finished he moved to the town council's cleaning contractor on these blocks. His wife Lakshmi is back home; most of his pay goes to her. He and his crew live in a dormitory half an hour away, a dozen to a room, trucked in every morning. At lunch there is nowhere to sit, so they squat under the stairs with food from the dorm.",
        later: [
          { from: 1990, zh: "1990 年女儿 Priya 出生，寄回去的钱多了一份打算。", en: "His daughter Priya was born in 1990; the money home now has a purpose." },
          { from: 1995, zh: "1995 年孟加拉来的工友 Shohel（1972 年生）加入，两人用破碎的英语和马来语交流。", en: "Shohel (b. 1972, Bangladesh) joined the crew in 1995; they talk in broken English and Malay." }
        ]
      },
      tension: {
        a: { zh: "伪装", en: "The mask" }, b: { zh: "真实", en: "The true self" },
        about: { zh: "在楼里他永远客气、永远 OK OK boss；回到宿舍才是会骂人、会开玩笑、会对着家里寄来的照片发呆的他。这是处境逼出来的生存方式，不是性格，也不是骗人", en: "In the block he is always polite, always 'OK OK boss'; back at the dorm he swears, jokes and stares at the photos from home. The mask is how a migrant worker survives here, not his character and never a lie" },
        toward_a: { zh: "投诉、盘查、仅限居民", en: "Complaints, checks, residents-only rules", later: [{ from: 2014, zh: "、2013 年骚乱后的气氛", en: ", the mood after the 2013 riot" }] },
        toward_b: { zh: "有人记得他的名字、问他家里怎么样、不把他的话告诉承包商", en: "Someone remembers his name, asks about his family back home, does not repeat his words to the contractor" }
      },
      voice: { zh: "华语几乎不会，用简单英语夹马来语：Boss，ok ok；tak apa", en: "Simple English with Malay and Tamil: 'Sir, no problem one. We sit here only, five minutes.'" },
      // 女儿 1990 年才出生：之前的目标是多寄钱回家
      goal: { zh: "午休有个阴凉地方", en: "Shade at lunch",
        later: [{ to: 1989, zh: "；多攒点钱寄回家", en: "; send more money home" }, { from: 1990, zh: "；攒够钱供女儿读书", en: "; pay for his daughter's studies" }] },
      secrets: [
        { id: "permit", zh: "工作准证明年到期，承包商还没说会不会续", en: "His work permit ends next year; the contractor has not said if it will be renewed" },
        { id: "loan", from: 2008, zh: "Priya 考上大学，学费比他算的多，他在借钱", en: "Priya got into university; the fees are more than he planned and he is borrowing" },
        { id: "sees_all", zh: "楼里谁家吵架、谁一个人几天没出门，他都知道", en: "He knows which flat quarrels and who has not come out for days" }
      ],
      first_view: { zh: "居民那边的人。很客气，不说真话，直到你证明你会听", en: "One of the residents' people. Polite, not honest, until you prove you will listen" },
      quote: { zh: "我们每天在这里打扫、维修，可是午休时没地方坐。有些地方只给居民用，有些又太贵。", en: "We clean and maintain this place every day, but have nowhere to sit at lunchtime. Some places are for residents only; others are too expensive." },
      stages: [
        { zh: "二十多岁到三十出头，317A 他熟到每一根水管", en: "Twenties to early thirties; he knows every pipe in 317A" },
        { zh: "老大哥，带新工友；SARS 时天天量体温、不许进联络所；Priya 读中学，成绩好，2008 年考上大学", en: "The old hand training newcomers; daily temperature checks and barred from the community centre during SARS; Priya does well at school and gets into university in 2008" },
        { zh: "2012 年 Priya 大学毕业；2013 年骚乱后被更多盘查；2014 年 Kumar 回国，侄子 Murugan 接班，年轻、有手机、更敢说话", en: "Priya graduates in 2012; more checks after the 2013 riot; in 2014 Kumar goes home and his nephew Murugan takes over: young, with a phone, more outspoken" }
      ],
      everyday: [
        { zh: "周日去小印度，在草地上坐一下午，打电话回家要排队", en: "Sundays in Little India, an afternoon on the grass and a queue for the phone home" },
        { zh: "宿舍里有人用小电饭锅煮咖喱，一层楼都闻得到", en: "Someone in the dorm cooks curry in a small rice cooker and the whole floor can smell it" }
      ],
      members: [
        { id: "kumar", name: { zh: "Kumar", en: "Kumar" }, from: 1989, to: 2014 },
        { id: "shohel", name: { zh: "Shohel", en: "Shohel" }, from: 1995, to: 2008 },
        { id: "murugan", name: { zh: "Murugan", en: "Murugan" }, from: 2014, to: null }
      ]
    }
  };

  // 住户之间（不在开局告诉玩家，要靠对话浮出来）
  const RELATIONS = [
    // members：这段旧事只有这几个人知道（拆开的户要写到人）
    { id: "riot_1964", between: ["chen", "aisyah"], members: ["chen", "mak_esah"], zh: "1964 年骚乱时 Mak Esah 救过陈阿姨，两人都认得对方，从没说破", en: "Mak Esah saved Mdm Chan in 1964; both remember, neither has said so" },
    { id: "builders", between: ["chen", "kumar"], zh: "都是盖楼的人；她每天给他留咖啡乌，嘴上嫌他扫地不干净", en: "Both builders; she leaves him kopi-o daily and complains about his sweeping" },
    { id: "same_trade", between: ["lin", "mei"], zh: "伟明和建国同一行，常在楼下聊厂里的事，可能互相介绍工作，也可能竞争；慧玲对大陆人有说不出口的戒心，却也为俊豪的华文发愁", en: "Wei Ming and Jianguo share a trade and talk shop downstairs; allies or rivals; Hui Ling is quietly wary of PRC newcomers, yet worries about Jun Hao's Chinese" },
    { id: "stairwell", between: ["lin", "kumar"], zh: "慧玲投诉工人坐楼梯口不好看", en: "Hui Ling complains about workers on the stairs", later: [{ from: 1995, zh: "；俊豪的脚车坏了总去找 Kumar，跟他学会了补车胎", en: "; young Jun Hao takes his bicycle to Kumar and has learned to patch tyres from him" }] },
    { id: "two_cooks", between: ["aisyah", "mei"], zh: "两个做吃的女人在熟食中心认识；一个是这片地最早的主人，一个是最新来的", en: "Two women who cook meet at the hawker centre; the oldest owner of this land and the newest arrival" },
    { id: "tent", between: ["aisyah", "lin"], zh: "马来婚礼的棚子挡了停车", en: "The wedding tent blocks parking", later: [{ from: 1992, zh: "；林家孩子每年开斋节都去 Aisyah 家吃糕", en: "; the Lim boy eats Aisyah's kuih every Hari Raya" }] }
  ];

  // 场景种子：规划层可以安排的、住户之间自己发生的事（玩家只能看到一部分）。没有坏人
  const SCENE_SEEDS = [
    {
      id: "help_and_pride", decade: 1, year: 1998, residents: ["lin", "mei"], characters: ["weiming", "jianguo", "huiling", "wangmei"],
      zh: "伟明被裁，建国在同一轮调整里保住了位子。建国听说另一家厂在招工程师，把招聘启事带给伟明，伟明笑着说不用啦，我已经有安排了；建国看出他有难处，不知道该不该再问。同一段时间，慧玲为俊豪的华文发愁，王美主动说可以帮他看作文；慧玲要付补习费，王美不肯收。两家都想帮对方，又都怕自己的好意伤了对方的面子",
      en: "Wei Ming is retrenched; Jianguo keeps his job in the same round of cuts. Hearing that another plant is hiring engineers, Jianguo brings Wei Ming the advert; Wei Ming laughs and says no need, he has something lined up, and Jianguo, seeing the trouble, cannot decide whether to ask again. Meanwhile Hui Ling frets over Jun Hao's Chinese and Wang Mei offers to look at his compositions; Hui Ling wants to pay for tuition and Wang Mei refuses. Each family tries to help the other, and each fears its kindness will wound the other's pride"
    }
  ];

  const SUPPORTING = {
    ong: { name: { zh: "王伯", en: "Mr Ong" }, role: { zh: "居委会主席，退休公务员，好心但只看报告和数字", en: "Residents' Committee chairman, retired civil servant, kind but reads only reports and numbers" } },
    ah_seng: { name: { zh: "阿成", en: "Ah Seng" }, role: { zh: "熟食中心炒粿条摊老板，八十年代从路边被迁入熟食中心", en: "Char kway teow hawker, moved off the street into a hawker centre in the 1980s" } },
    ms_tan: { name: { zh: "Ms Tan", en: "Ms Tan" }, role: { zh: "市镇理事会职员，管清洁承包、维修和楼下使用许可", en: "Town council officer for cleaning contracts, repairs and void-deck permits" } }
  };

  // 十个十年。history 是这十年真实发生的事（GM 可以引用、安排成场景背景）
  const DECADES = [
    { title: { zh: "新镇落成", en: "A New Town" }, years: [1989, 1998], history: [
      { year: 1989, zh: "3 月推出种族融合政策（EIP），按座和邻区限定各族群比例", en: "March: Ethnic Integration Policy sets ethnic limits per block and neighbourhood" },
      { year: 1990, zh: "10 月新加坡与中国建交；11 月吴作栋接任总理", en: "October: Singapore and China establish diplomatic relations; November: Goh Chok Tong becomes Prime Minister" },
      { year: 1992, zh: "开始从中国引进专才；Mei 一家来到新加坡，先在隔壁楼租房间", en: "Recruitment of PRC talent; Mei's family arrives and rents a room in the next block" },
      { year: 1994, zh: "317A 的第一批屋主住满 5 年，可以转售了；Mei 一家搬进 317A；12 月新加坡队 4 比 0 赢下马来西亚杯决赛，之后退出马来西亚的比赛", en: "317A's first owners pass the five-year minimum occupation period and may resell; Mei's family moves in; in December Singapore beat Pahang 4–0 to win the Malaysia Cup, then leave the Malaysian competitions" },
      { year: 1995, zh: "推出选择性整体重建计划（SERS）", en: "Selective En bloc Redevelopment Scheme (SERS) introduced" },
      { year: 1997, zh: "亚洲金融风暴；硬盘厂陆续关闭或迁出新加坡", en: "Asian financial crisis; disk-drive plants begin closing or leaving Singapore" },
      { year: 1998, zh: "经济衰退，裁员潮", en: "Recession and a wave of retrenchments" }] },
    { title: { zh: "年轻家庭搬进来", en: "Young Families Move In" }, years: [1999, 2008], history: [
      { year: 2001, zh: "经济衰退、裁员", en: "Recession and retrenchments" },
      { year: 2003, zh: "SARS 疫情", en: "SARS outbreak" },
      { year: 2004, zh: "李显龙接任总理", en: "Lee Hsien Loong becomes Prime Minister" },
      { year: 2006, zh: "移民大幅增加", en: "Immigration rises sharply" }] },
    { title: { zh: "配额检讨", en: "Quota Review" }, years: [2009, 2018], history: [
      { year: 2010, zh: "EIP 调高印度及其他族群的上限，并对非马来西亚籍永久居民加了配额", en: "EIP raises the Indian/Others limits and adds a quota for non-Malaysian permanent residents" },
      { year: 2013, zh: "《人口白皮书》引发抗议；12 月小印度骚乱", en: "Population White Paper protests; December Little India riot" },
      { year: 2014, zh: "推出建国一代配套", en: "Pioneer Generation Package" },
      { year: 2015, zh: "李光耀逝世；建国 50 周年", en: "Lee Kuan Yew dies; SG50" },
      { year: 2018, zh: "宣布自愿提早重建计划（VERS），社会讨论组屋地契归零", en: "VERS announced amid debate on lease decay" }] },
    { title: { zh: "找到节奏", en: "Finding a Rhythm" }, years: [2019, 2028], history: [
      { year: 2020, zh: "新冠疫情，客工宿舍大规模感染、封锁", en: "COVID-19; migrant dormitories locked down" },
      { year: 2020, zh: "小贩文化列入联合国教科文组织非物质文化遗产", en: "Hawker culture inscribed by UNESCO" }] },
    { title: { zh: "新的要求", en: "New Requirements" }, years: [2029, 2038], history: [] },
    { title: { zh: "车流变多", en: "Growing Traffic" }, years: [2039, 2048], history: [] },
    { title: { zh: "社区老了", en: "An Ageing Community" }, years: [2049, 2058], history: [] },
    { title: { zh: "重建的传闻", en: "Talk of Redevelopment" }, years: [2059, 2068], history: [] },
    { title: { zh: "最后的日常", en: "The Last Everyday Moments" }, years: [2069, 2078], history: [] },
    { title: { zh: "地契将尽", en: "The Lease Nears Its End" }, years: [2079, 2088], history: [] }
  ];

  // 进度钟种子：游戏端事件 → 启动一个钟（原作信件里的冲突改写成钟）
  const CLOCK_SEEDS = [
    { on: { type: "build", card: "smart" }, clock: { id: "chen_withdraws", owner: "chen", segments: 4, name: { zh: "陈阿姨不再下楼", en: "Mdm Chan stops coming downstairs" }, consequence: { zh: "陈阿姨不再去楼下，象棋角空了", en: "Mdm Chan stops going downstairs; the chess corner is empty" } } },
    { on: { type: "policy", card: "tighten_quota" }, clock: { id: "aisyah_stuck", owner: "aisyah", segments: 4, name: { zh: "Aisyah 家卖不掉房", en: "Aisyah’s family cannot sell" }, consequence: { zh: "Aisyah 家放弃搬去勿洛，留在一个他们不再想留的地方", en: "Aisyah's family gives up on Bedok and stays where they no longer wish to be" } } },
    { on: { type: "policy", card: "rent_rise" }, clock: { id: "hawker_priced_out", owner: "ah_seng", segments: 4, name: { zh: "熟食中心吃不起", en: "Priced out of the hawker centre" }, consequence: { zh: "Mei、Kumar 和 Aisyah 家不再去熟食中心吃饭", en: "Mei, Kumar and Aisyah's family stop eating at the hawker centre" } } },
    { on: { type: "policy", card: "cleanup" }, clock: { id: "long_table_gone", owner: "aisyah", segments: 4, name: { zh: "长桌没地方摆", en: "Nowhere for the long table" }, consequence: { zh: "开斋节长桌没有再搬下楼", en: "The Hari Raya table is not carried downstairs again" } } },
    { on: { type: "decade", decade: 1 }, unless_built: ["childcare"], clock: { id: "childcare_queue", owner: "lin", segments: 6, name: { zh: "托儿排队", en: "The childcare waiting list" }, consequence: { zh: "慧玲辞职在家带孩子", en: "Hui Ling quits her job to look after Jun Hao" } } },
    { on: { type: "decade", decade: 1 }, unless_built: ["rest", "blank"], clock: { id: "afternoon_heat", owner: "kumar", segments: 6, name: { zh: "午后高温", en: "The afternoon heat" }, consequence: { zh: "一位工友午休时中暑，被送去医院", en: "A worker collapses from the heat during lunch" } } }
  ];

  // GM 即兴补全细节时遵守的组屋生活设定（写进提示词）
  const SETTING_NOTES = {
    zh: "新加坡组屋（HDB）。void deck 是公共的：马来婚礼搭棚、华人丧事守夜、选举宣传、下棋、补习、孩子骑车。走廊有晾衣竹竿、鞋架、盆栽、神台香炉。附近有熟食中心、巴刹、咖啡店，清真摊位是分开的。语言：英语是工作语言；华人老一辈说福建、潮州、广东、海南话，年轻一辈说华语和英语；马来家庭说马来语；泰米尔工人说泰米尔语；Singlish 是日常混合口语，只作语气点缀，不做口音笑料。居委会、民众联络所、市镇理事会管楼下的事，议员每周接见选民。湿热，午后常有雷阵雨，十二月到一月是季风季。种族融合政策（EIP）的规则：每座楼、每个邻区各族群有比例上限；一个族群到了上限，房子就不能再卖给这个族群的买家，除非卖方也是这个族群。所以少数族裔屋主在华人比例已满的楼里卖房，不能卖给华人买家，买家少、等得久；EIP 不是规定只能卖给同族。没有保安亭、没有小区围墙、没有物业公司，不要写成中国大陆的小区。真实历史只做背景，住户只说政策落在自己身上是什么样子，不发表政策评论，不替任何政党说话。族群和宗教细节要准确。",
    en: "Singapore HDB estate. The void deck is shared: Malay wedding tents, Chinese funeral wakes, election rallies, chess, tuition, children cycling. Corridors have laundry poles, shoe racks, potted plants, altars. Nearby: hawker centre, wet market, kopitiam; halal stalls are separate. English is the working language; older Chinese speak Hokkien, Teochew, Cantonese, Hainanese, the young speak Mandarin and English; Malay families speak Malay; Tamil workers speak Tamil. Singlish is everyday mixed speech: use lightly as flavour, never as an accent joke. Residents' Committees, the community centre and the town council run things downstairs; the MP holds weekly meet-the-people sessions. Hot and humid, afternoon thunderstorms, monsoon in December–January. How the Ethnic Integration Policy (EIP) works: each block and neighbourhood has a limit for each ethnic group; once a group's limit is reached, a flat there can no longer be sold to a buyer of that group unless the seller is of the same group. So a minority owner in a block at its Chinese limit cannot sell to Chinese buyers, and faces fewer buyers and a longer wait; the EIP does not mean owners may only sell to their own race. No guard posts, gated compounds or property managers. Real history is background only: residents speak about how policies land on their own lives, never give policy commentary or speak for any party. Be accurate about ethnic and religious detail."
  };

  // 叙事基调（10-28 Polaris：新加坡的现实好残酷，GM 写走向时温柔一点）
  const TONE_NOTES = {
    zh: "写走向时温柔一点。现实可以难，但这是一个关于人的故事，不是社会问题报告。坏事发生时给它留一点人的温度：有人递一杯咖啡乌，有人记得你的名字，有人在长桌边多摆一张椅子。不回避代价（代价由规则决定，照样发生），也不渲染苦难；不让任何人的结局只剩下悲惨。每个十年至少安排一件小小的好事。也允许没有任何深刻意义的日常：不是每个场景都要推动什么、揭示什么或说明什么。有人在楼下等雨停，有人为两毛钱跟鱼贩讨价还价，孩子在走廊踢球，陈阿姨赢了一盘棋得意了一下午。这些事可以就只是这些事，不必给它们找意义，结尾也不要点题。",
    en: "Be gentle when shaping where things go. Reality can be hard, but this is a story about people, not a report on social problems. When bad things happen, leave room for warmth: someone hands over a kopi-o, someone remembers your name, someone adds a chair at the long table. Do not hide the costs (the rules decide them and they still happen), and do not dwell on suffering; no one's ending should be only misery. Plan at least one small good thing each decade. Ordinary days with no deeper meaning are allowed too: not every scene has to move, reveal or explain anything. Someone waits downstairs for the rain to stop, someone haggles with the fishmonger over twenty cents, children kick a ball along the corridor, Mdm Chan gloats all afternoon over a won game. These things can simply be what they are; do not hunt for their meaning or close on a moral."
  };

  // 设定门（10-28 Polaris 的硬约束）：提示词里这样要求，harness.js 的 leakCheck 用代码兜底
  const DISCLOSURE_NOTES = {
    zh: "不能把设定直接说出来，更不能把张力直接说出来。人物的来历、张力、秘密只能通过言行、物件和细节表现：陈阿姨不会说自己被遗忘了，她只是不再下楼；Kumar 不会说自己在伪装，他只是在居民面前永远说 OK。旁白也不能替人物点题。不要用\"张力\"\"锚点\"\"设定\"这类词，不要照抄设定原文。",
    en: "Never state the setting outright, and above all never state a character's tension. Backgrounds, tensions and secrets show only through words, deeds, objects and detail: Mdm Chan never says she has been forgotten, she just stops coming downstairs; Kumar never says he wears a mask, he just always says OK to residents. Narration must not spell out the theme either. Do not use words like 'tension', 'anchor' or 'backstory', and do not copy setting text."
  };

  // 角色：能说话、有自己心思的人。不拆的户本身就是一个角色（陈阿姨、Aisyah 一家、Kumar 和工友）；
  // 拆开的户（split）每个成员是一个角色，各有自己的位置、印象和秘密。满意度和需求仍按户算（游戏端是按户的）
  const CHARACTERS = {};
  for (const [hid, r] of Object.entries(RESIDENTS)) {
    if (!r.split) CHARACTERS[hid] = { id: hid, household: hid, member: null };
    else for (const m of r.members) CHARACTERS[m.id] = { id: m.id, household: hid, member: m };
  }

  const inYear = (m, year) => m.from <= year && (m.to == null || m.to > year);
  function membersAt(residentId, year) { return RESIDENTS[residentId].members.filter((m) => inYear(m, year)); }
  function livesHere(residentId, year) { return RESIDENTS[residentId].arrives <= year && membersAt(residentId, year).length > 0; }
  function householdOf(id) { return RESIDENTS[id] ? id : CHARACTERS[id] ? CHARACTERS[id].household : null; }
  function characterPresent(id, year) {
    const c = CHARACTERS[id];
    return !!c && livesHere(c.household, year) && (!c.member || inYear(c.member, year));
  }
  function charactersAt(year) { return Object.keys(CHARACTERS).filter((id) => characterPresent(id, year)); }
  function canTalk(id, year) { const c = CHARACTERS[id]; return !!c && !(c.member && c.member.talks_from > year); }
  function characterName(id) { const c = CHARACTERS[id]; return c ? (c.member ? c.member.name : RESIDENTS[id].name) : null; }
  // 谁身上有哪一对张力：不拆的户就是户的张力；拆开的户看 tension_holder（"family" 记在户上，否则记在那个成员身上），成员也可以有自己的一对
  function tensionOf(id) {
    const c = CHARACTERS[id];
    if (c && !c.member) return RESIDENTS[id].tension;
    if (c) return c.member.tension || (RESIDENTS[c.household].tension_holder === id ? RESIDENTS[c.household].tension : null);
    const r = RESIDENTS[id];
    return r && r.split && r.tension_holder === "family" ? r.tension : null;
  }
  function mindIds() { return Object.keys(CHARACTERS).concat(Object.keys(RESIDENTS).filter((h) => RESIDENTS[h].split && RESIDENTS[h].tension_holder === "family")); }
  // 秘密从哪年到哪年成立（from / to，不写就是一直成立）
  const secretActive = (s, year) => year == null || ((s.from == null || s.from <= year) && (s.to == null || s.to >= year));
  // 这个人知道的秘密：自己家全家都知道的 + 只有他自己知道的（holder）+ 别人家里他也知道的（known_to）。
  // 返回 { household, secret }；给了 year 就只算那一年成立的
  // 会随时间变的文字：{ zh, en } 是开局（1989 年）时的样子，later 里每一段到了 from 那一年才算发生，接在后面。
  // 角色和 GM 只拿到这一年为止的部分：住户不该知道自己以后会怎样（10-28 Polaris）
  function textAt(o, year) {
    if (!o || typeof o !== "object" || !o.later) return o;
    const now = o.later.filter((p) => (p.from == null || year >= p.from) && (p.to == null || year <= p.to));
    // 英文段落以标点开头的（", …"、"; …"）直接接上，其余隔一个空格
    return { zh: o.zh + now.map((p) => p.zh).join(""), en: o.en + now.map((p) => (/^[,;.:]/.test(p.en) ? p.en : " " + p.en)).join("") };
  }

  function secretsKnownBy(id, year) {
    const c = CHARACTERS[id];
    if (!c) return [];
    const out = [];
    for (const [hid, r] of Object.entries(RESIDENTS)) {
      for (const s of r.secrets) {
        if (!secretActive(s, year)) continue;
        const own = hid === c.household && (!s.holder || !c.member || s.holder === id);
        if (own || (s.known_to || []).includes(id)) out.push({ household: hid, secret: s });
      }
    }
    return out;
  }

  root.V2World = {
    START_YEAR, LEASE_END, NEEDS, BARRIERS, BADGES, FACILITIES, POLICIES, RESIDENTS, CHARACTERS, RELATIONS, SCENE_SEEDS, SUPPORTING,
    DECADES, CLOCK_SEEDS, SETTING_NOTES, TONE_NOTES, DISCLOSURE_NOTES, BLOCK: "BLK 317A",
    decadeOfYear(year) { return Math.floor((year - START_YEAR) / 10) + 1; },
    membersAt, livesHere, householdOf, textAt, characterPresent, charactersAt, canTalk, characterName, tensionOf, mindIds, secretActive, secretsKnownBy
  };
})(typeof window !== "undefined" ? window : globalThis);
