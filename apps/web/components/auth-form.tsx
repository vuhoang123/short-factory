'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../lib/api';
import { unknownResponseSchema } from '../lib/contracts';
import { ErrorNotice } from './feedback';

export function AuthForm() {
  const router = useRouter();
  const [registering, setRegistering] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setError('');
    try {
      await api(registering ? '/auth/register' : '/auth/login', unknownResponseSchema, {
        method: 'POST',
        body: { email: String(form.get('email')), password: String(form.get('password')), ...(registering ? { name: String(form.get('name')) } : {}) },
      });
      router.replace('/studio'); router.refresh();
    } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  }

  return <main id="main-content" className="auth-layout">
    <section className="auth-intro" aria-label="Shorts Factory">
      <Link className="brand" href="/">Shorts Factory</Link>
      <div className="auth-message"><h1>Từ bài viết hay<br />đến video của bạn.</h1><p>Giữ ảnh bài và bình luận gốc, thêm giọng kể rồi xuất MP4 về máy. Bạn kiểm tra nội dung ở từng bước.</p><ol className="auth-process"><li>Nhập bài và chọn bình luận</li><li>Chỉnh lời đọc, nền và nhạc</li><li>Xem, duyệt và tải video</li></ol></div>
      <div className="auth-footnote">Không gian làm video local của bạn.</div>
    </section>
    <section className="auth-form-wrap">
      <div className="auth-form-card">
        <h2>{registering ? 'Tạo tài khoản' : 'Đăng nhập'}</h2>
        <p className="muted">{registering ? 'Tạo workspace để lưu nội dung và video của bạn.' : 'Tiếp tục câu chuyện bạn đang làm.'}</p>
        {error && <ErrorNotice message={error} />}
        <form onSubmit={submit} className="form-stack">
          {registering && <label>Tên của bạn<input name="name" autoComplete="name" required maxLength={100} /></label>}
          <label>Email<input name="email" type="email" autoComplete="email" required maxLength={254} /></label>
          <label>Mật khẩu<input name="password" type="password" autoComplete={registering ? 'new-password' : 'current-password'} minLength={12} maxLength={128} required /></label>
          {registering && <p className="field-help">Dùng mật khẩu riêng cho ứng dụng, ít nhất 12 ký tự.</p>}
          <button className="button" disabled={busy}>{busy ? 'Đang xử lý…' : registering ? 'Tạo tài khoản' : 'Đăng nhập'}</button>
        </form>
        <p className="auth-switch">{registering ? 'Đã có tài khoản?' : 'Chưa có tài khoản?'} <button className="text-button" onClick={() => { setRegistering(!registering); setError(''); }}>{registering ? 'Đăng nhập' : 'Tạo tài khoản'}</button></p>
        <p className="field-help auth-policy">Video được xuất về máy. Bạn chủ động duyệt và đăng bằng tài khoản của mình.</p>
      </div>
    </section>
  </main>;
}
