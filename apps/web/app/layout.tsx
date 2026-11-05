import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import './workspace-theme.css';

export const metadata: Metadata = {
  title: { default: 'Shorts Factory', template: '%s | Shorts Factory' },
  description: 'Tạo video từ bài viết và bình luận, chỉnh lời đọc rồi xuất MP4 về máy.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="vi" data-scroll-behavior="smooth"><body><a className="skip-link" href="#main-content">Đến nội dung chính</a>{children}</body></html>;
}
