import Link from 'next/link';

const steps = [
  {
    number: '01',
    title: 'Chọn workspace và tạo kênh',
    description: 'Nếu vừa đăng ký, hãy tạo workspace theo biểu mẫu rồi chọn workspace ở góc trên bên trái. Trong Kênh nội dung (Content channels), tạo một kênh cho từng chủ đề và đặt ngôn ngữ, từ khóa, điểm ứng viên tối thiểu.',
    actions: [{ href: '/channels', label: 'Mở Kênh nội dung' }],
  },
  {
    number: '02',
    title: 'Đặt quy tắc chủ đề',
    description: 'Trong Cài đặt workspace (Workspace settings), đến Discovery topic rules. Chọn kênh, nhập từ khóa/chủ đề được phép và từ cần loại trừ; các mục phân cách bằng dấu phẩy.',
    actions: [{ href: '/settings#topic-rules', label: 'Mở quy tắc chủ đề' }],
  },
  {
    number: '03',
    title: 'Thêm nguồn hoặc nhập nội dung',
    description: 'Để thử giao diện, đăng ký nguồn MANUAL ở chế độ “Synthetic demo discovery” rồi chọn “Sync now”; dữ liệu này hoàn toàn giả lập. Với nội dung thật, chỉ nhập bài và bình luận bạn sở hữu hoặc được phép sử dụng trong Thư viện bài đăng (Post library). “Load example draft” cũng chỉ là dữ liệu mẫu để thử.',
    actions: [
      { href: '/sources', label: 'Mở Nguồn' },
      { href: '/library/posts#import', label: 'Nhập nội dung có quyền' },
    ],
  },
  {
    number: '04',
    title: 'Duyệt quyền trước, duyệt ứng viên sau',
    description: 'Ở Duyệt quyền sử dụng (Rights reviews), kiểm tra bằng chứng, phạm vi thương mại, nền tảng được phép, lãnh thổ, ghi công và ngày hết hạn. Sau khi quyền và cảnh báo an toàn đã đạt, vào Thư viện bài đăng → “Scored candidates” để xem điểm và duyệt hoặc từ chối ứng viên.',
    actions: [
      { href: '/reviews', label: 'Mở Duyệt quyền sử dụng' },
      { href: '/library/posts', label: 'Mở Thư viện bài đăng' },
    ],
  },
  {
    number: '05',
    title: 'Tạo, kiểm tra và duyệt video',
    description: 'Trong Story studio, chọn ứng viên đã duyệt, bình luận, kênh, giọng đọc và mẫu video. Kiểm tra/chỉnh kịch bản, tạo bản render rồi xem trước và ghi quyết định duyệt video. Ảnh nền phải thuộc quyền sử dụng của bạn. Giọng “mock” chỉ là âm thanh kiểm thử.',
    actions: [{ href: '/studio', label: 'Mở Story studio' }],
  },
] as const;

export default function GuidePage() {
  return <>
    <div className="page-heading"><div><span className="eyebrow">SHORTS FACTORY · HƯỚNG DẪN</span><h1>Hướng dẫn sử dụng</h1><p>Làm theo thứ tự dưới đây để đi từ nội dung nguồn đến video đã được người thật duyệt.</p></div></div>

    <div className="notice warning"><strong>Quyền sử dụng luôn là điều kiện bắt buộc.</strong><span>Nội dung công khai không đồng nghĩa với việc được phép tái sử dụng. Quyền chưa rõ, hết hạn hoặc bị thu hồi sẽ bị chặn.</span></div>

    <section className="panel"><div className="panel-heading"><div><h2>Quy trình chính</h2><p>Các nút bên dưới mở thẳng đúng khu vực trong ứng dụng.</p></div></div>
      <div className="guide-grid">{steps.map((step) => <article className="guide-step" key={step.number}>
        <div className="guide-step-heading"><span className="guide-step-number" aria-hidden="true">{step.number}</span><h3>{step.title}</h3></div>
        <p>{step.description}</p>
        <div className="guide-actions">{step.actions.map((action) => <Link className="text-button" href={action.href} key={action.href}>{action.label}<span aria-hidden="true">→</span></Link>)}</div>
      </article>)}</div>
    </section>

    <section className="panel"><div className="panel-heading"><div><h2>Những giới hạn cần nhớ</h2><p>Trạng thái hiện tại của bản local này.</p></div></div>
      <ul className="guide-limits">
        <li><strong>Không có đăng mạng xã hội thật.</strong> Video đã render chỉ nằm trong hàng chờ duyệt; tích hợp đăng bài và OAuth thật chưa được bật.</li>
        <li><strong>Nguồn Reddit, Threads và Facebook chưa kết nối.</strong> Chỉ dùng nhập thủ công có quyền hoặc dữ liệu demo tổng hợp.</li>
        <li><strong>Autopilot và Analytics là phần tùy chọn.</strong> Dùng Dry run để xem lựa chọn và điều kiện chặn; tài khoản/mock và số liệu synthetic không phải dữ liệu mạng xã hội thật.</li>
        <li><strong>Nếu không thấy nút tạo hoặc chỉnh sửa,</strong> hãy nhờ Owner/Admin của workspace thực hiện. Quản lý thành viên, nhật ký và yêu cầu gỡ nội dung cũng nằm trong Cài đặt workspace.</li>
      </ul>
      <div className="guide-footer"><Link className="text-button" href="/autopilot">Mở Autopilot <span aria-hidden="true">→</span></Link><Link className="text-button" href="/analytics">Mở Analytics <span aria-hidden="true">→</span></Link><Link className="text-button" href="/settings">Mở Cài đặt workspace <span aria-hidden="true">→</span></Link></div>
    </section>
  </>;
}
