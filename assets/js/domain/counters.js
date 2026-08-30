/**
 * Bộ đếm hiển thị trên thanh điều hướng (FR-IDEA-06).
 *
 * Tách thành module riêng để tầng domain không phải phụ thuộc ngược vào UI:
 * `service.js` cập nhật giá trị, `layout.js` chỉ đọc để vẽ badge.
 */
export const navCounters = {
  pendingIdeas: 0,
  stuck: 0,
  joinRequests: 0,
  solutionRequests: 0,
};
