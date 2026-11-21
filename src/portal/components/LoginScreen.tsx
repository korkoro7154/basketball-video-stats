import { useState } from 'react';
import { Lock, Mail, LogIn, ShieldCheck, AlertCircle } from 'lucide-react';
import type { AuthUser } from '../types';

interface LoginScreenProps {
  teamName: string;
  isFirebaseMode: boolean;
  loading?: boolean;
  errorMessage?: string;
  onGoogleSignIn: () => Promise<void>;
  onDemoLogin?: (user: AuthUser) => void;
}

export function LoginScreen({
  teamName,
  isFirebaseMode,
  loading = false,
  errorMessage = '',
  onGoogleSignIn,
  onDemoLogin,
}: LoginScreenProps) {
  const [nameInput, setNameInput] = useState('部員メンバー');
  const [emailInput, setEmailInput] = useState('member@sakuradai-bbc.jp');
  const [passwordInput, setPasswordInput] = useState('••••••••');

  const handleDemoGoogle = () => {
    if (!onDemoLogin) return;
    onDemoLogin({
      id: 'user_google_demo',
      name: nameInput.trim() || '部員（Google）',
      email: 'member.google@sakuradai-bbc.jp',
      loginMethod: 'google',
    });
  };

  const handleDemoEmail = (e: React.FormEvent) => {
    e.preventDefault();
    if (!onDemoLogin) return;
    onDemoLogin({
      id: 'user_email_demo',
      name: nameInput.trim() || '部員メンバー',
      email: emailInput.trim() || 'member@sakuradai-bbc.jp',
      loginMethod: 'email',
    });
  };

  return (
    <div className="portal-auth-page">
      <div className="portal-auth-card">
        <div className="portal-auth-badge">
          <Lock size={14} />
          <span>第1ロック：部員専用ポータル</span>
        </div>

        <div className="portal-auth-logo">🏀</div>
        <h1 className="portal-auth-title">{teamName}</h1>
        <p className="portal-auth-subtitle">
          試合動画・練習動画・スタッツ共有ポータル
        </p>

        {isFirebaseMode ? (
          <>
            <div className="portal-demo-notice">
              <ShieldCheck size={16} className="notice-icon" />
              <div>
                <strong>部員限定の共有ポータルです</strong>
                <p>
                  許可された部員のGoogleアカウントでログインすると、チームの動画とスタッツを閲覧できます。
                </p>
              </div>
            </div>

            {errorMessage && (
              <div className="portal-auth-error">
                <AlertCircle size={16} />
                <span>{errorMessage}</span>
              </div>
            )}

            <button
              type="button"
              className="btn-google"
              disabled={loading}
              onClick={() => void onGoogleSignIn()}
            >
              <span className="google-g">G</span>
              {loading ? 'ログイン中...' : 'Googleアカウントでログイン'}
            </button>
          </>
        ) : (
          <>
            <div className="portal-demo-notice">
              <ShieldCheck size={16} className="notice-icon" />
              <div>
                <strong>画面確認用の試作版です</strong>
                <p>
                  現在はボタンを押すだけで中を確認できます。本番時は許可された部員だけがログインできるよう設定します。
                </p>
              </div>
            </div>

            <button
              type="button"
              className="btn-google"
              onClick={handleDemoGoogle}
            >
              <span className="google-g">G</span>
              Googleアカウントでログイン
            </button>

            <div className="portal-divider">
              <span>またはメールアドレスで入る</span>
            </div>

            <form onSubmit={handleDemoEmail} className="portal-auth-form">
              <label className="field-label">
                <span>表示名</span>
                <input
                  type="text"
                  className="portal-input"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  placeholder="例：高橋 颯太"
                />
              </label>

              <label className="field-label">
                <span>メールアドレス</span>
                <div className="input-with-icon">
                  <Mail size={16} />
                  <input
                    type="email"
                    className="portal-input"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    placeholder="member@example.com"
                  />
                </div>
              </label>

              <label className="field-label">
                <span>パスワード</span>
                <input
                  type="password"
                  className="portal-input"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  placeholder="パスワード"
                />
              </label>

              <button type="submit" className="btn-accent btn-block">
                <LogIn size={18} />
                ポータルに入る
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
