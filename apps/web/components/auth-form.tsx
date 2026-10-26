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
      router.replace('/dashboard'); router.refresh();
    } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  }

  return <main id="main-content" className="auth-layout">
    <section className="auth-intro" aria-label="Shorts Factory">
      <Link className="brand" href="/"><span className="brand-mark" aria-hidden="true">sf</span>shorts factory</Link>
      <div className="auth-message"><span className="eyebrow">YOUR EDITORIAL WORKSPACE</span><h1>Good stories.<br />Clear rights.<br />A better starting point.</h1><p>Bring your authorized posts and comments into one workspace. Review their provenance before they move into production.</p></div>
      <div className="auth-footnote"><span className="status-dot" aria-hidden="true" />Manual import first. Human review always.</div>
    </section>
    <section className="auth-form-wrap">
      <div className="auth-form-card">
        <span className="eyebrow">WELCOME TO SHORTS FACTORY</span>
        <h2>{registering ? 'Create your account' : 'Welcome back'}</h2>
        <p className="muted">{registering ? 'Start with a workspace for your editorial team.' : 'Sign in to your editorial workspace.'}</p>
        {error && <ErrorNotice message={error} />}
        <form onSubmit={submit} className="form-stack">
          {registering && <label>Name<input name="name" autoComplete="name" required maxLength={100} /></label>}
          <label>Email address<input name="email" type="email" autoComplete="email" required maxLength={254} /></label>
          <label>Password<input name="password" type="password" autoComplete={registering ? 'new-password' : 'current-password'} minLength={12} maxLength={128} required /></label>
          {registering && <p className="field-help">Use at least 12 characters. Keep this password unique.</p>}
          <button className="button" disabled={busy}>{busy ? 'Please wait…' : registering ? 'Create account' : 'Sign in'}<span aria-hidden="true">↗</span></button>
        </form>
        <p className="auth-switch">{registering ? 'Already have an account?' : 'New to Shorts Factory?'} <button className="text-button" onClick={() => { setRegistering(!registering); setError(''); }}>{registering ? 'Sign in' : 'Create account'}</button></p>
        <p className="field-help auth-policy">Platform connections are disabled until approved. TikTok uses manual handoff.</p>
      </div>
    </section>
  </main>;
}
