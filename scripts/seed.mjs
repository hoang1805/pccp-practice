/**
 * Sinh dữ liệu khởi tạo trong `data/`.
 *
 *   node scripts/seed.mjs          # chỉ tạo file còn thiếu
 *   node scripts/seed.mjs --force  # ghi đè toàn bộ
 *
 * Đề bài ở đây do dự án tự viết, KHÔNG sao chép từ Programmers.
 */

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const FORCE = process.argv.includes('--force');
const SCHEMA_VERSION = 1;
const now = new Date().toISOString();

let written = 0, skipped = 0;

function put(path, data) {
  if (existsSync(path) && !FORCE) { skipped++; return; }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf8');
  written++;
}

/* ------------------------------------------------------------- config -- */

put('data/config.json', {
  schemaVersion: SCHEMA_VERSION,
  exam: {
    durationMinutes: 120,
    slots: [
      { slot: 'L1',  level: 1, points: 300 },
      { slot: 'L2',  level: 2, points: 200 },
      { slot: 'L3A', level: 3, points: 200 },
      { slot: 'L3B', level: 3, points: 300 },
    ],
    totalPoints: 1000,
    languages: ['Python', 'JavaScript', 'Java', 'C', 'C++', 'C#'],
    // Trang giới thiệu PCCP không công bố ngưỡng hạng — quản trị viên tự nhập
    // trong màn hình Cấu hình. Để null thì hệ thống chỉ hiện điểm thô.
    gradeThresholds: [
      { grade: 'Lv.5', minScore: null },
      { grade: 'Lv.4', minScore: null },
      { grade: 'Lv.3', minScore: null },
      { grade: 'Lv.2', minScore: null },
      { grade: 'Lv.1', minScore: null },
    ],
  },
  features: {
    leaderboardEnabled: true,
    autoGrantOnApprovedIdea: false,
    publicApprovedIdeas: false,
    hardStuckAlertHours: 48,
  },
  updatedAt: now,
  updatedBy: null,
});

/* -------------------------------------------------------------- users -- */
/* Cố tình để trống: người đầu tiên đăng nhập bằng token có quyền ghi sẽ
   tự động trở thành quản trị viên đầu tiên (xem core/auth.js).            */

put('data/users.json', {
  schemaVersion: SCHEMA_VERSION,
  users: [],
  pendingJoins: [],
});

/* ----------------------------------------------------------- problems -- */

const problems = [
  {
    id: 'P-0001',
    title: 'Đếm số cặp có tổng chia hết cho k',
    level: 1,
    tags: ['array', 'hash', 'math'],
    estimatedMinutes: 20,
    statementMd: [
      'Cho một mảng số nguyên `nums` và một số nguyên dương `k`.',
      '',
      'Hãy đếm số **cặp chỉ số** `(i, j)` với `i < j` sao cho `nums[i] + nums[j]` chia hết cho `k`.',
      '',
      '**Gợi ý hướng nghĩ:** hai số cộng lại chia hết cho `k` khi phần dư của chúng bù nhau.',
    ].join('\n'),
    constraintsMd: [
      '- `2 ≤ nums.length ≤ 100000`',
      '- `-10^9 ≤ nums[i] ≤ 10^9`',
      '- `1 ≤ k ≤ 1000`',
      '- Cẩn thận với số âm khi lấy phần dư.',
    ].join('\n'),
    samples: [
      { input: 'nums = [1, 2, 3, 4, 5], k = 3', output: '4',
        explanation: 'Các cặp: (1,2), (1,5), (2,4), (4,5).' },
      { input: 'nums = [-1, 1, 3], k = 2', output: '3',
        explanation: 'Mọi cặp đều có tổng chẵn.' },
    ],
    difficultyNote: 'Bẫy chính là phép chia dư với số âm trong C/C++/Java.',
    recommendedLanguages: ['Python', 'C++'],
  },
  {
    id: 'P-0002',
    title: 'Nén chuỗi lặp liên tiếp',
    level: 1,
    tags: ['string', 'two-pointers'],
    estimatedMinutes: 18,
    statementMd: [
      'Cho chuỗi `s` chỉ gồm chữ cái thường. Hãy nén chuỗi bằng cách thay mỗi',
      'nhóm ký tự giống nhau liên tiếp bằng `<ký tự><số lần>`, nhưng **chỉ khi**',
      'số lần xuất hiện lớn hơn 1.',
      '',
      'Nếu chuỗi nén không ngắn hơn chuỗi gốc, trả về chuỗi gốc.',
    ].join('\n'),
    constraintsMd: ['- `1 ≤ s.length ≤ 200000`', '- `s` chỉ chứa `a`–`z`.'].join('\n'),
    samples: [
      { input: 's = "aaabbccccd"', output: '"a3b2c4d"' },
      { input: 's = "abcd"', output: '"abcd"', explanation: 'Nén lại dài hơn nên giữ nguyên.' },
    ],
    difficultyNote: 'Đừng quên xử lý nhóm cuối cùng sau khi thoát vòng lặp.',
    recommendedLanguages: ['Python', 'JavaScript'],
  },
  {
    id: 'P-0003',
    title: 'Xếp lịch họp nhiều phòng',
    level: 2,
    tags: ['greedy', 'sorting', 'heap'],
    estimatedMinutes: 35,
    statementMd: [
      'Cho danh sách `meetings`, mỗi phần tử là `[start, end]` (thời điểm bắt đầu và kết thúc).',
      'Một phòng chỉ tổ chức được một cuộc họp tại một thời điểm; cuộc họp kết thúc lúc `t`',
      'và cuộc họp khác bắt đầu lúc `t` thì **dùng chung phòng được**.',
      '',
      'Hãy tìm **số phòng tối thiểu** để tổ chức được toàn bộ cuộc họp.',
    ].join('\n'),
    constraintsMd: [
      '- `1 ≤ meetings.length ≤ 200000`',
      '- `0 ≤ start < end ≤ 10^9`',
    ].join('\n'),
    samples: [
      { input: 'meetings = [[0,30],[5,10],[15,20]]', output: '2' },
      { input: 'meetings = [[7,10],[2,4]]', output: '1' },
    ],
    difficultyNote: 'Có hai lời giải đẹp: min-heap theo thời điểm kết thúc, hoặc sweep line.',
    recommendedLanguages: ['Python', 'Java'],
  },
  {
    id: 'P-0004',
    title: 'Chia kẹo công bằng nhất',
    level: 2,
    tags: ['binary-search', 'greedy'],
    estimatedMinutes: 30,
    statementMd: [
      'Có `n` gói kẹo, gói thứ `i` chứa `candies[i]` viên. Cần chia cho `k` bạn nhỏ,',
      'mỗi bạn nhận **đúng một phần** gồm các viên lấy từ **cùng một gói**',
      '(một gói có thể chia cho nhiều bạn, phần thừa bỏ đi).',
      '',
      'Hãy tìm số viên **lớn nhất** mà mỗi bạn có thể nhận, sao cho cả `k` bạn đều nhận được',
      'số viên bằng nhau. Nếu không chia được, trả về `0`.',
    ].join('\n'),
    constraintsMd: [
      '- `1 ≤ candies.length ≤ 100000`',
      '- `1 ≤ candies[i] ≤ 10^7`',
      '- `1 ≤ k ≤ 10^12`',
    ].join('\n'),
    samples: [
      { input: 'candies = [5,8,6], k = 3', output: '5',
        explanation: 'Gói 8 chia được 1 phần 5, gói 6 chia được 1 phần 5, gói 5 chia được 1 phần 5.' },
      { input: 'candies = [2,5], k = 11', output: '0' },
    ],
    difficultyNote: 'k rất lớn nên đừng dùng vòng lặp theo k. Nhị phân trên đáp án.',
    recommendedLanguages: ['C++', 'Python'],
  },
  {
    id: 'P-0005',
    title: 'Đường đi rẻ nhất trong lưới có cổng dịch chuyển',
    level: 3,
    tags: ['graph', 'bfs', 'dijkstra', 'grid'],
    estimatedMinutes: 50,
    statementMd: [
      'Cho lưới `n × m`. Mỗi ô là một trong:',
      '',
      '- `.` — ô trống, đi vào tốn **1** đơn vị',
      '- `#` — tường, không đi vào được',
      '- chữ cái `a`–`z` — **cổng dịch chuyển**',
      '',
      'Bạn xuất phát từ ô `(0, 0)` và cần tới ô `(n-1, m-1)`. Mỗi bước đi sang ô kề cạnh.',
      'Ngoài ra, khi đang đứng trên một cổng, bạn có thể dịch chuyển tức thời tới **bất kỳ',
      'cổng nào cùng chữ cái** với chi phí **0**.',
      '',
      'Hãy tính tổng chi phí nhỏ nhất, hoặc `-1` nếu không tới được.',
    ].join('\n'),
    constraintsMd: [
      '- `1 ≤ n, m ≤ 1000`',
      '- Ô xuất phát và ô đích luôn không phải tường.',
      '- Có tối đa 26 loại cổng.',
    ].join('\n'),
    samples: [
      { input: 'grid = [".a.", "###", ".a."]', output: '3',
        explanation: 'Đi (0,0)→(0,1) tốn 1, dịch chuyển xuống (2,1) tốn 0, rồi sang (2,2) tốn 1. Cộng ô đích: 3.' },
      { input: 'grid = ["..", "##"]', output: '-1' },
    ],
    difficultyNote: 'Cạnh có trọng số 0 và 1 nên 0-1 BFS với deque là đủ, không cần Dijkstra đầy đủ. Nhớ đánh dấu mỗi nhóm cổng chỉ "xả" một lần để không bị O(n²).',
    recommendedLanguages: ['C++', 'Python'],
  },
  {
    id: 'P-0006',
    title: 'Chia đội cân bằng sức mạnh',
    level: 3,
    tags: ['dp', 'subset-sum', 'bitset'],
    estimatedMinutes: 45,
    statementMd: [
      'Có `n` thành viên, người thứ `i` có sức mạnh `power[i]`. Cần chia **toàn bộ** thành viên',
      'vào đúng hai đội (mỗi đội có thể rỗng).',
      '',
      'Hãy tìm **chênh lệch nhỏ nhất** giữa tổng sức mạnh của hai đội.',
    ].join('\n'),
    constraintsMd: [
      '- `1 ≤ n ≤ 200`',
      '- `1 ≤ power[i] ≤ 1000`',
    ].join('\n'),
    samples: [
      { input: 'power = [1, 6, 11, 5]', output: '1', explanation: '{1,5,6} và {11} → |12 - 11| = 1.' },
      { input: 'power = [10]', output: '10' },
    ],
    difficultyNote: 'Tổng tối đa 200000 nên quy hoạch động theo tổng con là khả thi. Dùng bitset để tăng tốc nếu cần.',
    recommendedLanguages: ['C++', 'Python'],
  },
  {
    id: 'P-0007',
    title: 'Khôi phục cây từ hai thứ tự duyệt',
    level: 3,
    tags: ['tree', 'recursion', 'hash'],
    estimatedMinutes: 40,
    statementMd: [
      'Cho hai mảng `preorder` và `inorder` là kết quả duyệt trước và duyệt giữa của',
      'một cây nhị phân có **các giá trị đôi một khác nhau**.',
      '',
      'Hãy khôi phục cây và trả về kết quả **duyệt sau** (postorder) của nó.',
    ].join('\n'),
    constraintsMd: [
      '- `1 ≤ n ≤ 100000`',
      '- Hai mảng luôn hợp lệ và mô tả cùng một cây.',
      '- Đệ quy sâu có thể tràn stack với cây suy biến.',
    ].join('\n'),
    samples: [
      { input: 'preorder = [3,9,20,15,7], inorder = [9,3,15,20,7]', output: '[9,15,7,20,3]' },
      { input: 'preorder = [1], inorder = [1]', output: '[1]' },
    ],
    difficultyNote: 'Dùng map giá trị → vị trí trong inorder để tránh tìm tuyến tính. Cây suy biến làm độ sâu đệ quy tới 100000.',
    recommendedLanguages: ['C++', 'Java'],
  },
];

for (const p of problems) {
  put(join('data/problems', `${p.id}.json`), {
    schemaVersion: SCHEMA_VERSION,
    ...p,
    sourceUrl: '',
    sourceNote: 'Đề do dự án tự soạn, không sao chép từ nguồn có bản quyền.',
    archived: false,
    createdBy: null,
    createdAt: now,
    updatedAt: now,
  });
}

put('data/problems/_index.json', {
  schemaVersion: SCHEMA_VERSION,
  generatedAt: now,
  problems: problems.map(p => ({
    id: p.id, title: p.title, level: p.level, tags: p.tags,
    estimatedMinutes: p.estimatedMinutes, archived: false, updatedAt: now,
  })),
});

/* ---------------------------------------------------------- solutions -- */
/* Nội dung để base64 chỉ nhằm tránh lộ đáp án khi lướt repo (DEC-02).
   Đây KHÔNG phải mã hoá — ai cũng giải mã được.                          */

const encode = obj => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');

const solutions = {
  'P-0001': {
    approachMd: [
      '## Ý tưởng',
      'Hai số `a + b` chia hết cho `k` khi `(a mod k) + (b mod k)` bằng `0` hoặc `k`.',
      '',
      'Đếm tần suất từng phần dư `r` trong `[0, k)`, rồi ghép `r` với `k - r`:',
      '',
      '- `r = 0`: chọn 2 trong `cnt[0]` → `C(cnt[0], 2)`',
      '- `k` chẵn và `r = k/2`: `C(cnt[k/2], 2)`',
      '- còn lại: `cnt[r] * cnt[k-r]`, chỉ duyệt `r < k - r` để không đếm lặp',
    ].join('\n'),
    complexity: { time: 'O(n + k)', space: 'O(k)' },
    referenceCode: [{
      language: 'Python',
      code: [
        'def solution(nums, k):',
        '    cnt = [0] * k',
        '    for x in nums:',
        '        cnt[x % k] += 1        # Python: phần dư luôn không âm',
        '',
        '    total = cnt[0] * (cnt[0] - 1) // 2',
        '    r = 1',
        '    while r < k - r:',
        '        total += cnt[r] * cnt[k - r]',
        '        r += 1',
        '    if k % 2 == 0:',
        '        c = cnt[k // 2]',
        '        total += c * (c - 1) // 2',
        '    return total',
      ].join('\n'),
    }],
    pitfallsMd: [
      '- Trong C/C++/Java, `-1 % 3` cho `-1` chứ không phải `2`. Phải chuẩn hoá: `((x % k) + k) % k`.',
      '- Kết quả có thể vượt `int` khi n lớn — dùng `long long`.',
    ].join('\n'),
  },
  'P-0005': {
    approachMd: [
      '## Ý tưởng',
      'Đồ thị có hai loại cạnh: bước sang ô kề (trọng số 1) và dịch chuyển giữa các cổng',
      'cùng chữ cái (trọng số 0). Chỉ có hai mức trọng số nên **0-1 BFS** với `deque` là đủ:',
      'cạnh trọng số 0 đẩy vào đầu hàng đợi, cạnh trọng số 1 đẩy vào cuối.',
      '',
      '### Điểm mấu chốt về độ phức tạp',
      'Nếu mỗi lần đứng trên cổng lại duyệt toàn bộ cổng cùng loại thì tệ nhất là O((nm)²).',
      'Cách khắc phục: với mỗi chữ cái, chỉ "xả" nhóm cổng đó **đúng một lần**, sau đó đánh dấu',
      'nhóm đã dùng để không lặp lại.',
    ].join('\n'),
    complexity: { time: 'O(n·m)', space: 'O(n·m)' },
    referenceCode: [{
      language: 'Python',
      code: [
        'from collections import deque, defaultdict',
        '',
        'def solution(grid):',
        '    n, m = len(grid), len(grid[0])',
        '    portals = defaultdict(list)',
        '    for i in range(n):',
        '        for j in range(m):',
        '            c = grid[i][j]',
        '            if c.isalpha():',
        '                portals[c].append((i, j))',
        '    used = set()                      # nhóm cổng đã xả',
        '',
        '    INF = float("inf")',
        '    dist = [[INF] * m for _ in range(n)]',
        '    dist[0][0] = 1 if grid[0][0] != "#" else INF',
        '    dq = deque([(0, 0)])',
        '',
        '    while dq:',
        '        i, j = dq.popleft()',
        '        d = dist[i][j]',
        '        c = grid[i][j]',
        '        if c.isalpha() and c not in used:',
        '            used.add(c)',
        '            for (pi, pj) in portals[c]:',
        '                if d < dist[pi][pj]:',
        '                    dist[pi][pj] = d      # dịch chuyển tốn 0',
        '                    dq.appendleft((pi, pj))',
        '        for di, dj in ((1,0), (-1,0), (0,1), (0,-1)):',
        '            ni, nj = i + di, j + dj',
        '            if 0 <= ni < n and 0 <= nj < m and grid[ni][nj] != "#":',
        '                if d + 1 < dist[ni][nj]:',
        '                    dist[ni][nj] = d + 1',
        '                    dq.append((ni, nj))',
        '',
        '    return -1 if dist[n-1][m-1] == INF else dist[n-1][m-1]',
      ].join('\n'),
    }],
    pitfallsMd: [
      '- Quên đánh dấu nhóm cổng đã xả → TLE ở lưới dày cổng.',
      '- Dùng `list.pop(0)` thay `deque.popleft()` biến thuật toán thành O(n²).',
      '- Lưới toàn tường quanh ô đích: phải trả `-1` chứ không phải chi phí vô hạn.',
    ].join('\n'),
  },
};

for (const [pid, payload] of Object.entries(solutions)) {
  put(join('data/solutions', `${pid}.json`), {
    schemaVersion: SCHEMA_VERSION,
    problemId: pid,
    encoding: 'base64',
    contentB64: encode(payload),
    createdBy: null,
    updatedAt: now,
  });
}

/* -------------------------------------------------------------- hints -- */

put('data/hints/P-0005.json', {
  schemaVersion: SCHEMA_VERSION,
  problemId: 'P-0005',
  hints: [
    {
      id: 'H-0001', level: 1, targetUserId: null,
      contentMd: 'Chi phí di chuyển ở đây có phải lúc nào cũng như nhau không? Hãy để ý loại cạnh nào tốn 0.',
      createdBy: null, createdAt: now, updatedAt: now, feedback: null,
    },
    {
      id: 'H-0002', level: 2, targetUserId: null,
      contentMd: 'Đồ thị chỉ có cạnh trọng số 0 và 1 → **0-1 BFS** với `deque`: cạnh 0 đẩy vào đầu, cạnh 1 đẩy vào cuối. Không cần Dijkstra với heap.',
      createdBy: null, createdAt: now, updatedAt: now, feedback: null,
    },
    {
      id: 'H-0003', level: 3, targetUserId: null,
      contentMd: 'Nếu vẫn TLE: mỗi nhóm cổng cùng chữ cái chỉ được "xả" **một lần** trong suốt thuật toán. Giữ một `set` các chữ cái đã xử lý, nếu không độ phức tạp thành O((n·m)²).',
      createdBy: null, createdAt: now, updatedAt: now, feedback: null,
    },
  ],
});

console.log(`Seed xong: ghi ${written} file, bỏ qua ${skipped} file đã tồn tại.`);
if (skipped && !FORCE) console.log('Dùng --force để ghi đè.');
