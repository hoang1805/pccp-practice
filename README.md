# PCCP Practicing

Nền tảng luyện tập & theo dõi tiến độ thi **PCCP** (Programmers Certified Coding Professional)
cho một nhóm học viên nhỏ.

Chạy hoàn toàn tĩnh trên **GitHub Pages**, không có máy chủ riêng.
Dữ liệu là các file JSON nằm ngay trong repository — **repo chính là database**,
và lịch sử Git chính là nhật ký kiểm toán.

> Đặc tả đầy đủ: [`docs/SRS.md`](docs/SRS.md)

---

## Có gì

| | |
|---|---|
| **Bộ đề theo ngày** | Đúng cấu trúc PCCP: 1 × Lv.1 + 1 × Lv.2 + 2 × Lv.3 — thang **300/200/200/300 = 1000** |
| **Bộ đề cá nhân** | Mỗi học viên tự ghim bộ đề riêng, độc lập với bộ đề chính thức |
| **4 trạng thái** | Chưa làm → Đang làm → Hard stuck → Hoàn thành, có đo thời gian và lịch sử |
| **Hard stuck** | Học viên mô tả điểm vướng; giáo viên thấy và gửi **gợi ý phân cấp 1→3** |
| **Ý tưởng giải** | Học viên nộp approach, quản trị viên duyệt / yêu cầu sửa / từ chối |
| **Lời giải có kiểm soát** | Chỉ mở khi **đã hoàn thành** *và* **được cấp quyền** |
| **Thi thử** | Đồng hồ 120 phút, ẩn gợi ý và lời giải, tự chấm trên thang 1000 |
| **Thống kê** | Streak, heatmap 12 tháng, bảng xếp hạng, ma trận tiến độ cho quản trị viên |
| **Quản trị** | Thành viên, bài tập, bộ đề, cấu hình, sao lưu, nhật ký |

---

## Chạy thử ngay (không cần repo, không cần token)

```bash
git clone <repo-url> && cd pccp-practicing
node scripts/seed.mjs     # tạo dữ liệu mẫu: 7 bài tập, 2 lời giải, 3 gợi ý
npm run serve             # http://localhost:8080
```

Ở màn hình đầu tiên chọn **“Vào chế độ cục bộ”**. Ứng dụng đọc thẳng thư mục `data/`
và lưu mọi thay đổi vào IndexedDB của trình duyệt.

> Chế độ cục bộ chỉ để xem thử và phát triển — thay đổi **không** đồng bộ cho ai khác
> và mất khi bạn xoá dữ liệu site.

---

## Triển khai thật

### 1. Tạo repo và bật Pages

```bash
git init && git add -A && git commit -m "khởi tạo PCCP Practicing"
git remote add origin https://github.com/<owner>/<repo>.git
git push -u origin main
```

Vào **Settings → Pages → Source: GitHub Actions**. Workflow
[`pages.yml`](.github/workflows/pages.yml) sẽ deploy nguyên trạng repo — không có bước build.

Ứng dụng tự nhận ra `owner/repo` từ URL `https://<owner>.github.io/<repo>/`,
nên không cần cấu hình gì thêm.

### 2. Tạo fine-grained token

Mỗi người dùng tự tạo token của mình:

1. **Settings → Developer settings → Personal access tokens → Fine-grained tokens**
2. **Resource owner**: chủ sở hữu repo
3. **Repository access**: *Only select repositories* → chọn đúng repo này
4. **Repository permissions**: **Contents = Read and write** — không cấp thêm gì khác
5. **Expiration**: tối đa 90 ngày

Dán token vào màn hình đăng nhập. Token chỉ nằm trong `localStorage` của trình duyệt
và chỉ được gửi tới `api.github.com`.

> ⛔ **Không bao giờ** nhúng một token dùng chung vào mã nguồn. GitHub secret-scanning
> sẽ thu hồi nó ngay khi commit, và trong lúc chờ thì cả Internet có quyền ghi vào repo.

### 3. Người đầu tiên đăng nhập = quản trị viên

`data/users.json` khởi tạo rỗng. Người đầu tiên đăng nhập bằng token **có quyền ghi**
sẽ tự động trở thành quản trị viên đầu tiên. Những người sau đăng nhập sẽ tạo
**yêu cầu tham gia** để quản trị viên duyệt.

### 4. Thêm bài tập và đăng bộ đề

**Quản trị → Bài tập → + Bài tập mới** (hoặc *Nhập JSON* để thêm hàng loạt),
rồi **Quản trị → Bộ đề → Đăng bộ đề hôm nay**.

Cần tối thiểu 1 bài Lv.1, 1 bài Lv.2 và 2 bài Lv.3 để tạo được một bộ đề đầy đủ.

---

## Cấu trúc dữ liệu

```
data/
├─ config.json               cấu hình hệ thống (chỉ ADMIN ghi)
├─ users.json                danh bạ thành viên + yêu cầu tham gia
├─ problems/
│  ├─ _index.json            metadata rút gọn — client chỉ cần 1 request
│  └─ <problemId>.json       đề bài đầy đủ
├─ solutions/<problemId>.json    lời giải, base64 (xem ghi chú bên dưới)
├─ daily/<YYYY-MM-DD>.json       bộ đề chính thức của ngày
├─ personal/<userId>.json        bộ đề cá nhân + bài đã ghim
├─ progress/<userId>.json        trạng thái mọi bài của một người
├─ ideas/<userId>.json           ý tưởng đã nộp + kết quả duyệt
├─ hints/<problemId>.json        gợi ý chung và gợi ý riêng
├─ grants/<userId>.json          quyền xem lời giải
├─ exams/<userId>.json           lịch sử thi thử
└─ audit/<YYYY-MM>.jsonl         nhật ký thao tác
```

**Mỗi người ghi vào file riêng của mình.** Nhờ vậy hai người dùng đồng thời gần như
không bao giờ đụng nhau. Khi vẫn xảy ra xung đột (HTTP 409), ứng dụng đọc lại bản mới nhất,
hợp nhất theo từng bản ghi (`updatedAt` mới hơn thắng) rồi ghi lại — không ai mất dữ liệu.

---

## Về bảo mật — đọc trước khi dùng

Dự án **cố ý không đặt nặng bảo mật**. Ba điều bạn cần biết:

1. **Repo là public ⇒ mọi dữ liệu trong `data/` là công khai** — kể cả mô tả điểm vướng,
   nhận xét của giáo viên và thống kê cá nhân. Đừng nhập thông tin nhạy cảm.

2. **Lời giải lưu dạng base64, không phải mã hoá.** Đó chỉ là rào cản để học viên không
   *vô tình* thấy đáp án khi lướt repo. Ai cố tình thì giải mã được trong một dòng lệnh.

3. **Phân quyền chỉ được thực thi ở giao diện.** Bất kỳ ai có quyền ghi repo đều có thể
   sửa file của người khác bằng `git`. Lịch sử Git giúp phát hiện và hoàn tác.

Những điều này chấp nhận được với một nhóm học tập tin cậy. Nếu cần bảo mật thật,
xem [`docs/SRS.md`](docs/SRS.md) §8 (RISK-01…RISK-03).

Ngoại lệ duy nhất vẫn được xử lý bằng kỹ thuật: **XSS**. Không phải để bảo vệ dữ liệu
(vốn đã công khai) mà để bảo vệ token — token bị đánh cắp nghĩa là repo của cả nhóm
có thể bị xoá. Vì vậy mọi Markdown do người dùng nhập đều đi qua DOMPurify, và trang
có Content-Security-Policy chặt.

---

## Phát triển

```bash
npm test              # unit test quy tắc nghiệp vụ + tầng dữ liệu (36 test)
npm run validate      # kiểm tra toàn vẹn data/ theo INT-01…INT-12
npm run build-index   # sinh lại data/problems/_index.json
npm run serve         # server tĩnh cho phát triển
node scripts/check-imports.mjs   # đối chiếu import với export
```

Không có bước build và không có dependency runtime — mã nguồn là ES module chạy thẳng
trên trình duyệt. `package.json` chỉ dùng cho script phát triển.

### Kiến trúc

```
assets/js/
├─ core/      I/O và hạ tầng: github, local-client, store, cache, auth, router, bus, util
├─ domain/    nghiệp vụ thuần, không chạm DOM: rules, service, stats, constants
├─ ui/        hiển thị dùng chung: components, layout, markdown, set-view
└─ pages/     một module cho mỗi màn hình
```

Ranh giới quan trọng: **`domain/rules.js` là hàm thuần** — mọi quy tắc (chuyển trạng thái,
kiểm tra slot, điều kiện xem lời giải) nằm ở đó và được unit test đầy đủ.
Giao diện không bao giờ tự quyết định quyền truy cập.

### Thư viện ngoài

Markdown được render bằng `markdown-it` + `DOMPurify` tải từ cdnjs. Nếu CDN không
truy cập được, ứng dụng **tự động rơi về chế độ văn bản thuần** thay vì render HTML chưa
làm sạch — thà xấu còn hơn để lọt XSS.

---

## Giới hạn đã biết

- **Không chấm code tự động.** Không có sandbox thực thi; điểm thi thử do người dùng tự chấm.
- **Ngưỡng quy đổi hạng Lv.1–Lv.5 để trống.** Trang giới thiệu PCCP không công bố các mốc này;
  quản trị viên phải tự nhập ở **Quản trị → Cấu hình**. Chưa nhập thì hệ thống chỉ hiện điểm thô.
- **Hạn mức GitHub API**: 5.000 request/giờ cho mỗi token, 60 request/giờ cho khách chưa đăng nhập.
- **Không sao chép đề có bản quyền.** Chỉ nhập đề tự viết hoặc tự tóm tắt, kèm link nguồn.

---

## Giấy phép

MIT
