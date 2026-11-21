import { LogOut, RefreshCw, ShieldAlert } from 'lucide-react';

interface AccessDeniedScreenProps {
  email: string;
  onSwitchAccount: () => void;
  onSignOut: () => void;
}

export function AccessDeniedScreen({
  email,
  onSwitchAccount,
  onSignOut,
}: AccessDeniedScreenProps) {
  return (
    <div className="portal-auth-page">
      <div className="portal-auth-card">
        <div className="access-denied-icon">
          <ShieldAlert size={28} />
        </div>

        <h1 className="portal-auth-title">閲覧許可の確認待ち</h1>
        <p className="portal-auth-subtitle">
          このGoogleアカウントは、まだ部員メンバーとして登録されていません。
        </p>

        <div className="denied-email-box">
          <span className="denied-email-label">現在ログイン中のアドレス</span>
          <strong className="denied-email-value">{email || '（不明）'}</strong>
        </div>

        <p className="denied-guide-text">
          マネージャーまたは顧問にこのメールアドレスを伝えて、管理画面の「選手名簿 → ログイン許可メンバー」から追加してもらってください。
        </p>

        <button
          type="button"
          className="btn-accent btn-block"
          onClick={onSwitchAccount}
        >
          <RefreshCw size={16} />
          別のGoogleアカウントでログインし直す
        </button>

        <button
          type="button"
          className="btn-ghost btn-block"
          onClick={onSignOut}
        >
          <LogOut size={16} />
          ログアウト
        </button>
      </div>
    </div>
  );
}
