/**
 * Hằng số nghiệp vụ — enum, nhãn tiếng Việt, cấu hình slot mặc định.
 * Tham chiếu SRS §5.2.
 */

/* --------------------------------------------------------------- roles -- */
export const ROLE = { USER: 'USER', ADMIN: 'ADMIN' };
export const ROLE_LABEL = { USER: 'Học viên', ADMIN: 'Quản trị viên' };

/* ------------------------------------------------------------- statuses -- */
export const STATUS = {
  NOT_STARTED: 'NOT_STARTED',
  IN_PROGRESS: 'IN_PROGRESS',
  HARD_STUCK:  'HARD_STUCK',
  COMPLETED:   'COMPLETED',
};

export const STATUS_ORDER = [
  STATUS.NOT_STARTED, STATUS.IN_PROGRESS, STATUS.HARD_STUCK, STATUS.COMPLETED,
];

/** Nhãn + biểu tượng: trạng thái không bao giờ chỉ truyền đạt bằng màu (NFR-A-02). */
export const STATUS_META = {
  NOT_STARTED: { label: 'Chưa làm',    icon: '○', badge: 'badge-neutral' },
  IN_PROGRESS: { label: 'Đang làm',    icon: '◐', badge: 'badge-info' },
  HARD_STUCK:  { label: 'Hard stuck',  icon: '⚠', badge: 'badge-warn' },
  COMPLETED:   { label: 'Hoàn thành',  icon: '●', badge: 'badge-ok' },
};

/* ---------------------------------------------------------------- ideas -- */
export const IDEA_STATUS = {
  DRAFT:          'DRAFT',
  PENDING:        'PENDING',
  APPROVED:       'APPROVED',
  NEEDS_REVISION: 'NEEDS_REVISION',
  REJECTED:       'REJECTED',
};

export const IDEA_META = {
  DRAFT:          { label: 'Nháp',            badge: 'badge-neutral' },
  PENDING:        { label: 'Chờ duyệt',       badge: 'badge-info' },
  APPROVED:       { label: 'Đã duyệt',        badge: 'badge-ok' },
  NEEDS_REVISION: { label: 'Cần sửa',         badge: 'badge-warn' },
  REJECTED:       { label: 'Từ chối',         badge: 'badge-danger' },
};

/* ---------------------------------------------------------------- slots -- */
/** Cấu trúc đề PCCP: 1 bài Lv.1, 1 bài Lv.2, 2 bài Lv.3 — tổng 1000 điểm. */
export const DEFAULT_SLOTS = [
  { slot: 'L1',  level: 1, points: 300 },
  { slot: 'L2',  level: 2, points: 200 },
  { slot: 'L3A', level: 3, points: 200 },
  { slot: 'L3B', level: 3, points: 300 },
];

export const SLOT_KEYS = DEFAULT_SLOTS.map(s => s.slot);

export const SET_STATUS = {
  DRAFT: 'DRAFT', INCOMPLETE: 'INCOMPLETE', PUBLISHED: 'PUBLISHED',
};
export const SET_STATUS_META = {
  DRAFT:      { label: 'Nháp',        badge: 'badge-neutral' },
  INCOMPLETE: { label: 'Chưa đủ bài', badge: 'badge-warn' },
  PUBLISHED:  { label: 'Đã phát hành', badge: 'badge-ok' },
};

export const SET_KIND = { OFFICIAL: 'OFFICIAL', PERSONAL: 'PERSONAL' };

/* ---------------------------------------------------------------- hints -- */
export const HINT_LEVEL_META = {
  1: { label: 'Cấp 1 — Định hướng',  desc: 'Gợi ý hướng suy nghĩ, không nói thuật toán.' },
  2: { label: 'Cấp 2 — Thuật toán',  desc: 'Nêu tên thuật toán / kỹ thuật cần dùng.' },
  3: { label: 'Cấp 3 — Gần lời giải', desc: 'Mô tả chi tiết các bước, gần như lời giải.' },
};

/* ------------------------------------------------------------ languages -- */
export const LANGUAGES = ['Python', 'JavaScript', 'Java', 'C', 'C++', 'C#'];

/* ---------------------------------------------------------------- misc --- */
export const LEVELS = [1, 2, 3];
export const SCHEMA_VERSION = 1;

/** Số ký tự tối thiểu khi mô tả điểm vướng (SRS INT-05). */
export const MIN_STUCK_REASON = 20;

/** Nhãn hành động trong nhật ký kiểm toán. */
export const AUDIT_ACTION_LABEL = {
  LOGIN:                  'Đăng nhập',
  JOIN_REQUEST:           'Yêu cầu tham gia',
  USER_APPROVE:           'Duyệt thành viên',
  USER_REJECT:            'Từ chối thành viên',
  USER_ROLE_CHANGE:       'Đổi vai trò',
  USER_DEACTIVATE:        'Vô hiệu hoá user',
  USER_ACTIVATE:          'Kích hoạt user',
  USER_DELETE:            'Xoá user',
  PROFILE_UPDATE:         'Cập nhật hồ sơ',
  PROBLEM_CREATE:         'Tạo bài tập',
  PROBLEM_UPDATE:         'Sửa bài tập',
  PROBLEM_ARCHIVE:        'Lưu trữ bài tập',
  PROBLEM_IMPORT:         'Nhập bài tập hàng loạt',
  DAILY_PUBLISH:          'Phát hành bộ đề',
  DAILY_UPDATE:           'Sửa bộ đề',
  PERSONAL_SET_UPDATE:    'Cập nhật bộ đề cá nhân',
  PROGRESS_STATUS_CHANGE: 'Đổi trạng thái bài',
  IDEA_SUBMIT:            'Nộp ý tưởng',
  IDEA_REVIEW:            'Duyệt ý tưởng',
  HINT_CREATE:            'Tạo gợi ý',
  HINT_REVEAL:            'Mở gợi ý',
  HINT_FEEDBACK:          'Phản hồi gợi ý',
  SOLUTION_SAVE:          'Lưu lời giải',
  SOLUTION_GRANT:         'Cấp quyền xem lời giải',
  SOLUTION_REVOKE:        'Thu hồi quyền xem lời giải',
  SOLUTION_REQUEST:       'Yêu cầu xem lời giải',
  SOLUTION_VIEW:          'Xem lời giải',
  EXAM_FINISH:            'Kết thúc thi thử',
  CONFIG_UPDATE:          'Cập nhật cấu hình',
  DATA_EXPORT:            'Xuất dữ liệu',
  DATA_IMPORT:            'Nhập dữ liệu',
};
