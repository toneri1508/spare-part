# Kho spare part (lưu dữ liệu trên GitHub)

Web quản lý spare part cho Maint Line VD3: xuất kho, nhập kho, quét QR, nhập từ Excel, lịch sử giao dịch, quản lý người dùng, kho và dây chuyền. Toàn bộ dữ liệu nằm trong một kho GitHub riêng tư, không dùng Firebase.

## Vì sao dữ liệu không thể mất như bản cũ

Bản Firebase cũ có dòng code: khi đọc dữ liệu bị lỗi (chỉ cần rớt mạng), app coi như "không có dữ liệu" rồi ghi danh sách rỗng đè lên. Bản này thay đổi cách lưu từ gốc:

1. **Không bao giờ ghi khi chưa đọc được.** Mỗi lần lưu, app đọc bản mới nhất trên GitHub. Nếu đọc lỗi, thao tác dừng lại và báo lỗi, không ghi gì.
2. **Chỉ ghi phần thay đổi, không ghi đè cả danh sách từ máy.** Mỗi thao tác (xuất 2 cái, sửa tên…) được áp dụng lên bản mới nhất vừa đọc.
3. **Hai máy lưu cùng lúc không đè nhau.** Nếu máy khác vừa lưu trước, GitHub từ chối, app đọc lại và làm lại thao tác.
4. **Chốt chặn chống xóa hàng loạt.** Nếu một thao tác làm số vật tư, giao dịch, người dùng, kho hay dây chuyền giảm nhiều hơn mức nó được phép (ví dụ xóa 1 vật tư thì chỉ được giảm 1), app chặn lại.
5. **Mọi thay đổi đều là một commit.** Vào tab Commits của kho dữ liệu trên GitHub là thấy ai sửa gì, lúc nào, và quay lại được bất kỳ phiên bản nào.

## Cài đặt lần đầu (quản trị viên, khoảng 15 phút)

Cần hai kho GitHub: một kho **công khai** chứa code web, một kho **riêng tư** chứa dữ liệu.

### Bước 1. Tạo kho dữ liệu (riêng tư)

1. Trên github.com bấm **New repository**.
2. Đặt tên, ví dụ `spare-part-data`. Chọn **Private**. Đánh dấu **Add a README file**.
3. Bấm **Create repository**.

### Bước 2. Tạo khóa truy cập

1. Bấm ảnh đại diện → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
2. **Token name**: `kho-spare-part`. **Expiration**: chọn thời hạn dài nhất cho phép, ghi lại ngày hết hạn vào lịch.
3. **Repository access**: chọn **Only select repositories** → chọn `spare-part-data`.
4. **Permissions** → **Repository permissions** → **Contents**: chọn **Read and write**.
5. Bấm **Generate token** và sao chép khóa (bắt đầu bằng `github_pat_`). GitHub chỉ hiện khóa một lần.

### Bước 3. Đưa web lên GitHub Pages

1. Tạo kho mới, ví dụ `spare-part-app`, chọn **Public** (GitHub Pages miễn phí cần kho công khai; code không chứa khóa hay dữ liệu nên công khai là an toàn).
2. Bấm **Add file → Upload files**, kéo toàn bộ nội dung thư mục này vào (gồm `index.html`, thư mục `css`, `js`), rồi **Commit changes**.
3. Vào **Settings → Pages**. Ở **Branch** chọn `main` và thư mục `/ (root)`, bấm **Save**.
4. Sau 1–2 phút, web chạy tại `https://ten-tai-khoan.github.io/spare-part-app/`.

Có thể dùng luôn kho `spare-part-dashboard` cũ: xóa các file cũ, tải file mới lên. Địa chỉ web giữ nguyên.

### Bước 4. Kết nối và đưa dữ liệu vào

1. Mở địa chỉ web, nhập `ten-tai-khoan/spare-part-data` và dán khóa, bấm **Kết nối**.
2. Kho dữ liệu còn trống nên web hỏi cách bắt đầu:
   - **Khôi phục dữ liệu cũ** (xem mục bên dưới), hoặc
   - **Bắt đầu với kho trống**: nhập ID và tên quản trị viên.
3. Đăng nhập bằng ID quản trị viên.

## Khôi phục dữ liệu từ Firebase cũ

Vào màn hình khởi tạo (hoặc **Quản lý → Sao lưu, khôi phục**) và chọn một nguồn:

**Từ Firebase.** Các ô đã điền sẵn cấu hình của bản cũ.
- Nếu đã bật PITR (Point-in-time recovery) trong Firebase, chọn **Đọc dữ liệu tại thời điểm** là một phút trước lúc bị xóa, ví dụ 15:39 ngày 11/09/2026. Firestore giữ bản cũ 7 ngày kể từ khi bật PITR.
- Nếu đã clone database về thời điểm cũ, đổi ô **Database** thành tên database clone (ví dụ `khoi-phuc`) và để trống ô thời điểm.

**Từ file.** Chọn file `sao-luu-trinh-duyet.json` đã xuất từ laptop còn phiên đăng nhập cũ. Web tự dò mọi phiên bản dữ liệu trong file và chọn bản đầy đủ nhất.

Web luôn hiện bản xem trước (số vật tư, giao dịch, 5 vật tư đầu) để kiểm tra trước khi bấm khôi phục.

## Kết nối điện thoại và máy tính khác

Quản trị viên vào **Quản lý → Kết nối thiết bị → Hiện link kết nối**. Gửi link đó qua Zalo, hoặc để nhân viên dùng camera điện thoại quét mã QR trên màn hình. Mở link là thiết bị được kết nối, sau đó nhân viên nhập ID của mình.

Link chứa khóa truy cập. Chỉ gửi cho người trong nhóm.

## Phân quyền

Chỉ có hai vai trò, quyền cố định, không cần bật tắt gì thêm.

| Việc | Nhân viên | Quản trị viên |
|---|---|---|
| Xuất kho, nhập kho, quét QR, nhập Excel | Có | Có |
| Tạo vật tư mới | Có | Có |
| Sửa thông tin vật tư (mã, tên, nhóm, đơn vị, tồn tối thiểu, mô tả) | Có | Có |
| Sửa số tồn theo từng kho | Có | Có |
| Xóa vật tư | Không | Có |
| Sửa, xóa giao dịch trong Lịch sử | Không | Có |
| Người dùng, kho, dây chuyền, cài đặt, sao lưu | Không | Có |

Mỗi lần sửa số tồn được ghi thành giao dịch "Điều chỉnh tồn kho" trong Lịch sử kèm tên
người sửa, nên vẫn biết ai chỉnh gì. Ai lỡ sửa sai thì quản trị viên xóa giao dịch điều
chỉnh đó, hoặc mở lịch sử commit trên GitHub để quay lại.

**Lưu ý thật lòng về bảo mật.** Đăng nhập bằng ID là để ghi nhận ai làm gì, giống bản cũ, không phải mật khẩu. Ai có khóa truy cập (tức là mọi thiết bị đã kết nối) về kỹ thuật đều có thể sửa dữ liệu trực tiếp qua GitHub. Bù lại, mọi thay đổi đều nằm trong lịch sử commit và khôi phục được. Khi có người nghỉ việc hoặc lỡ lộ link: vào GitHub xóa khóa cũ, tạo khóa mới, rồi gửi link kết nối mới cho các máy.

## Xem lại hoặc quay về phiên bản cũ

- Mở kho `spare-part-data` trên GitHub → **Commits**. Mỗi dòng ghi thao tác và người thực hiện.
- Bấm vào một commit để xem chính xác dòng nào thay đổi (mỗi vật tư, mỗi giao dịch là một dòng trong file).
- Muốn quay về: bấm **Browse files** ở commit đó, tải file cần thiết, hoặc dùng **Quản lý → Sao lưu, khôi phục** với một bản sao lưu đã tải trước đó.

## Những điều cần biết

- **Cần có mạng khi lưu.** Mất mạng thì thao tác báo lỗi, không lưu nửa chừng. Có mạng lại thì bấm lưu lần nữa.
- **Đồng bộ giữa các máy** mất tối đa khoảng 20 giây, và cập nhật ngay khi mở lại tab.
- **Khóa hết hạn** thì web báo "Khóa truy cập không hợp lệ hoặc đã hết hạn". Tạo khóa mới và gửi lại link kết nối.
- **Quét QR** cần mở web qua `https` (GitHub Pages đã là https) và cho phép camera.
- Thư viện Excel được tải từ cdnjs khi dùng tới; quét QR và tạo mã QR chạy ngay trên máy.

## Cấu trúc dữ liệu trong kho GitHub

```
data/meta.json          cài đặt, dây chuyền, kho, người dùng
data/items.json         vật tư: mã, tên, nhóm, đơn vị, tồn tối thiểu
data/stocks.json        số tồn theo từng kho, mỗi vật tư một dòng
data/tx/_hot.json       giao dịch trong ngày hôm nay
data/tx/2026-09.json    giao dịch các ngày trước của tháng 9/2026
```

Tồn kho tách khỏi `items.json` và giao dịch trong ngày tách khỏi file tháng là để mỗi
lần nhập/xuất chỉ phải gửi lên GitHub hai file nhỏ. Với kho 2.000 mã, một lần xuất kho
gửi khoảng 90 KB thay vì 1,2 MB như trước, nên quét tem bằng 4G ở xưởng không phải chờ.
Mỗi ngày một lần, giao dịch của ngày đã qua được dồn vào file tháng.

Kho dữ liệu tạo bằng bản cũ (tồn nằm trong `items.json`) vẫn mở được bình thường và tự
chuyển sang cấu trúc này ngay ở thao tác lưu đầu tiên. **Sau khi cập nhật code, bảo mọi
máy tải lại trang một lần** để không còn máy nào chạy bản cũ.

Mã kho, mã vật tư, mã người dùng giữ nguyên như bản Firebase cũ, nên file Excel và tem QR đã in vẫn dùng được.

## Cấu trúc code

```
index.html
css/app.css
js/main.js          khởi động, điều hướng, vẽ lại khi dữ liệu đổi
js/store.js         đọc, đồng bộ và lưu an toàn (toàn bộ cơ chế chống mất dữ liệu)
js/github.js        gọi GitHub API, commit nhiều file một lần
js/model.js         cấu trúc dữ liệu, chốt chặn chống xóa hàng loạt
js/migrate.js       chuyển dữ liệu từ Firebase cũ
js/components.js    dòng vật tư, xuất kho, sửa vật tư, tem QR, giao dịch
js/excel.js         file mẫu, nhập và xuất Excel
js/scanner.js       quét QR bằng camera
js/views/           các trang: tổng quan, vật tư, nhập kho, lịch sử, quản lý…
js/vendor/          jsQR (quét QR), qrcode-generator (tạo QR), đều giấy phép MIT/Apache
```
