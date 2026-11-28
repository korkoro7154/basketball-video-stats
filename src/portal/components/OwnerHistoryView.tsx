import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  FlaskConical,
  History,
  LogOut,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import type { AuthUser, PortalData, PortalRevision } from '../types';
import {
  fetchPortalRevisionsFromCloud,
  pruneOldPortalRevisions,
  restorePortalRevisionInCloud,
} from '../services/portalStore';
import {
  MAX_REVISIONS_KEEP,
  computePortalRevisionStats,
  formatRevisionDateJst,
} from '../utils/revisions';
import './OwnerHistoryView.css';

interface OwnerHistoryViewProps {
  teamName: string;
  currentUser: AuthUser;
  isOwner: boolean;
  isFirebaseConfigured: boolean;
  sandboxActive: boolean;
  currentData: PortalData;
  onExitHistoryMode: () => void;
  onExitSandboxMode?: () => void;
  onLogout: () => void;
  onRestoreComplete: (restoredData: PortalData) => void;
}

function formatHistoryError(err: unknown, fallback: string): string {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: unknown }).code)
      : '';
  if (code === 'permission-denied') {
    return '履歴へのアクセス権限がありません。Firebase Console の Firestore ルールへ最新の firestore.rules が反映されているかご確認ください。';
  }
  return fallback;
}

function formatActorLabel(actorName: string, actorEmail: string): string {
  const name = actorName.trim();
  const email = actorEmail.trim();
  if (name && email && name.toLowerCase() !== email.toLowerCase()) {
    return `${name}（${email}）`;
  }
  return name || email || '不明なユーザー';
}

export function OwnerHistoryView({
  teamName,
  currentUser,
  isOwner,
  isFirebaseConfigured,
  sandboxActive,
  currentData,
  onExitHistoryMode,
  onExitSandboxMode,
  onLogout,
  onRestoreComplete,
}: OwnerHistoryViewProps) {
  const [revisions, setRevisions] = useState<PortalRevision[]>([]);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [hasOverflow, setHasOverflow] = useState(false);
  const [loading, setLoading] = useState<boolean>(
    () => isOwner && isFirebaseConfigured
  );
  const [loadError, setLoadError] = useState('');
  const [statusMessage, setStatusMessage] = useState<{
    text: string;
    tone: 'success' | 'danger' | 'info';
  } | null>(null);
  const [busyAction, setBusyAction] = useState<'restore' | 'prune' | null>(
    null
  );
  const [restoreTarget, setRestoreTarget] = useState<PortalRevision | null>(
    null
  );
  const [confirmPruneOpen, setConfirmPruneOpen] = useState(false);

  useEffect(() => {
    if (!isOwner || !isFirebaseConfigured) return;
    let cancelled = false;

    void (async () => {
      try {
        const result = await fetchPortalRevisionsFromCloud(MAX_REVISIONS_KEEP);
        if (cancelled) return;
        setRevisions(result.revisions);
        setTotalCount(result.totalCount);
        setHasOverflow(result.hasOverflow);
        setLoadError('');
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to fetch portal revisions:', err);
        setLoadError(
          formatHistoryError(
            err,
            '変更履歴の読み込みに失敗しました。通信状況をご確認ください。'
          )
        );
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOwner, isFirebaseConfigured]);

  const refreshRevisions = async () => {
    if (!isOwner || !isFirebaseConfigured) return;
    setLoading(true);
    setLoadError('');
    try {
      const result = await fetchPortalRevisionsFromCloud(MAX_REVISIONS_KEEP);
      setRevisions(result.revisions);
      setTotalCount(result.totalCount);
      setHasOverflow(result.hasOverflow);
    } catch (err) {
      console.error('Failed to refresh portal revisions:', err);
      setLoadError(
        formatHistoryError(
          err,
          '変更履歴の再読み込みに失敗しました。通信状況をご確認ください。'
        )
      );
    } finally {
      setLoading(false);
    }
  };

  if (!isOwner) {
    return (
      <div className="portal-auth-page">
        <div className="portal-auth-card">
          <div className="access-denied-icon">
            <ShieldAlert size={28} />
          </div>
          <h1 className="portal-auth-title">
            オーナー専用ページです（閲覧権限がありません）
          </h1>
          <button
            type="button"
            className="btn-accent btn-block"
            onClick={onExitHistoryMode}
          >
            <ArrowLeft size={16} />
            通常のポータルへ戻る
          </button>
        </div>
      </div>
    );
  }

  const currentStats = computePortalRevisionStats(currentData);
  const restoreTargetStats = restoreTarget
    ? computePortalRevisionStats(restoreTarget.beforeSnapshot)
    : null;

  const handleConfirmRestore = async () => {
    if (!restoreTarget || busyAction !== null) return;
    if (!isFirebaseConfigured || sandboxActive) {
      setRestoreTarget(null);
      return;
    }

    setBusyAction('restore');
    setStatusMessage(null);
    try {
      const { restoredData } = await restorePortalRevisionInCloud({
        revision: restoreTarget,
        actorEmail: currentUser.email,
        actorName: currentUser.name,
      });
      onRestoreComplete(restoredData);
      setRestoreTarget(null);
      setStatusMessage({
        tone: 'success',
        text: '指定した変更前の状態へ復元しました（復元前の控えも新しい履歴に保存しました）。',
      });
      await refreshRevisions();
    } catch (err) {
      console.error('Failed to restore portal revision:', err);
      setStatusMessage({
        tone: 'danger',
        text: formatHistoryError(
          err,
          'データの復元に失敗しました。通信状況をご確認のうえもう一度お試しください。'
        ),
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleConfirmPrune = async () => {
    if (busyAction !== null) return;
    if (!isFirebaseConfigured || sandboxActive) {
      setConfirmPruneOpen(false);
      return;
    }

    setBusyAction('prune');
    setStatusMessage(null);
    try {
      const result = await pruneOldPortalRevisions(MAX_REVISIONS_KEEP);
      setConfirmPruneOpen(false);
      setStatusMessage({
        tone: 'info',
        text:
          result.deletedCount > 0
            ? `${result.deletedCount}件の古い履歴を整理しました${result.hasMore ? '（まだ古い履歴が残っています。必要に応じて再度実行してください）' : ''}。`
            : '整理対象の古い履歴はありませんでした。',
      });
      await refreshRevisions();
    } catch (err) {
      console.error('Failed to prune portal revisions:', err);
      setStatusMessage({
        tone: 'danger',
        text: formatHistoryError(
          err,
          '古い履歴の整理に失敗しました。通信状況をご確認ください。'
        ),
      });
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="owner-history-shell">
      <header className="owner-history-header">
        <div className="owner-history-header-inner">
          <div className="owner-history-brand">
            <img src="/icon-192.png" alt="" className="brand-logo-img" />
            <div>
              <h1 className="owner-history-title">変更履歴・ワンタップ復元</h1>
              <div className="owner-history-subtitle">
                <History size={12} />
                <span>{teamName}（オーナー専用）</span>
              </div>
            </div>
          </div>

          <div className="owner-history-header-actions">
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={onExitHistoryMode}
            >
              <ArrowLeft size={14} />
              通常のポータルへ戻る
            </button>
            <button
              type="button"
              className="btn-soft-sm"
              onClick={() => void refreshRevisions()}
              disabled={loading || !isFirebaseConfigured || busyAction !== null}
            >
              <RefreshCw
                size={14}
                className={loading ? 'owner-history-spin' : ''}
              />
              最新に更新
            </button>
            <button
              type="button"
              className="btn-logout"
              onClick={onLogout}
              title="ログアウト"
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </header>

      <main className="owner-history-main">
        {sandboxActive && (
          <div className="owner-history-alert tone-warning" role="status">
            <div className="owner-history-alert-text">
              <FlaskConical size={16} />
              <span>
                ローカルテストモードが ON のため、復元や古い履歴の削除は実行できません（本番データは保護されています）。
              </span>
            </div>
            {onExitSandboxMode && (
              <button
                type="button"
                className="sandbox-btn sandbox-btn-exit"
                onClick={onExitSandboxMode}
              >
                テスト終了（本番へ戻る）
              </button>
            )}
          </div>
        )}

        {!isFirebaseConfigured && (
          <div className="owner-history-alert tone-info">
            <div className="owner-history-alert-text">
              <AlertTriangle size={16} />
              <span>
                現在はオフライン試作モードのため、クラウド変更履歴は利用できません。
              </span>
            </div>
          </div>
        )}

        <section className="owner-history-summary-bar">
          <div className="owner-history-summary-top">
            <span className="owner-history-summary-label">
              現在の本番データ概要
            </span>
            <span className="owner-history-count-badge">
              {totalCount !== null
                ? `全 ${totalCount} 件中 最新 ${revisions.length} 件を表示`
                : `最新 ${revisions.length} 件を表示（最大 ${MAX_REVISIONS_KEEP} 件）`}
            </span>
          </div>
          <div className="owner-history-stats-row">
            <span className="owner-history-stat-chip">
              試合日 {currentStats.gameDays}日
            </span>
            <span className="owner-history-stat-chip">
              試合 {currentStats.matches}件
            </span>
            <span className="owner-history-stat-chip">
              スコア済 {currentStats.scoredMatches}件
            </span>
            <span className="owner-history-stat-chip">
              選手 {currentStats.players}名
            </span>
            <span className="owner-history-stat-chip">
              練習動画 {currentStats.practices}本
            </span>
          </div>
        </section>

        {hasOverflow && (
          <div className="owner-history-alert tone-warning">
            <div className="owner-history-alert-text">
              <AlertTriangle size={16} />
              <span>
                保存されている履歴が {MAX_REVISIONS_KEEP} 件を超えています
                {totalCount !== null ? `（現在 ${totalCount} 件）` : ''}。
                古い履歴（{MAX_REVISIONS_KEEP + 1}件目以降）を整理できます。
              </span>
            </div>
            <button
              type="button"
              className="btn-soft-sm"
              disabled={sandboxActive || busyAction !== null}
              onClick={() => setConfirmPruneOpen(true)}
            >
              <Trash2 size={14} />
              31件目以降を整理する
            </button>
          </div>
        )}

        {statusMessage && (
          <div
            className={`owner-history-alert tone-${statusMessage.tone}`}
            role="status"
          >
            <div className="owner-history-alert-text">
              {statusMessage.tone === 'success' ? (
                <CheckCircle2 size={16} />
              ) : (
                <AlertTriangle size={16} />
              )}
              <span>{statusMessage.text}</span>
            </div>
          </div>
        )}

        {loadError && (
          <div className="owner-history-alert tone-danger" role="alert">
            <div className="owner-history-alert-text">
              <AlertTriangle size={16} />
              <span>{loadError}</span>
            </div>
          </div>
        )}

        {loading ? (
          <div className="owner-history-empty">
            <div className="portal-spinner" />
            <span>変更履歴を読み込んでいます...</span>
          </div>
        ) : revisions.length === 0 ? (
          <div className="owner-history-empty">
            <History size={26} />
            <strong>まだ変更履歴はありません</strong>
            <span>
              今後ポータル上で編集・追加・削除が行われると、変更内容と変更前の状態が自動で記録されます。
            </span>
          </div>
        ) : (
          <section className="owner-history-list" aria-label="変更履歴一覧">
            {revisions.map((rev) => {
              const isBackupEntry = rev.actionSummary.startsWith('復元前の控え');
              return (
                <article
                  key={rev.id}
                  className={`owner-history-card ${isBackupEntry ? 'is-backup' : ''}`}
                >
                  <div className="owner-history-card-top">
                    <div className="owner-history-meta">
                      <div className="owner-history-time-row">
                        <span className="owner-history-time">
                          {formatRevisionDateJst(rev.createdAt)}
                        </span>
                        {isBackupEntry && (
                          <span className="owner-history-backup-pill">
                            復元前の控え
                          </span>
                        )}
                      </div>
                      <span className="owner-history-actor">
                        変更者：{formatActorLabel(rev.actorName, rev.actorEmail)}
                      </span>
                    </div>
                  </div>

                  <div className="owner-history-summary">
                    {rev.actionSummary}
                  </div>

                  {rev.changes.length > 0 && (
                    <ul className="owner-history-changes">
                      {rev.changes.map((line, idx) => (
                        <li key={`${rev.id}_c_${idx}`}>{line}</li>
                      ))}
                    </ul>
                  )}

                  <div className="owner-history-card-footer">
                    <span className="owner-history-after-stats">
                      変更後の件数：試合日 {rev.afterStats.gameDays} / 試合{' '}
                      {rev.afterStats.matches}（スコア済{' '}
                      {rev.afterStats.scoredMatches}） / 選手{' '}
                      {rev.afterStats.players} / 練習{' '}
                      {rev.afterStats.practices}
                    </span>

                    <button
                      type="button"
                      className="owner-history-restore-btn"
                      disabled={sandboxActive || busyAction !== null}
                      onClick={() => setRestoreTarget(rev)}
                    >
                      <RotateCcw size={14} />
                      この変更前に戻す
                    </button>
                  </div>
                </article>
              );
            })}
          </section>
        )}
      </main>

      {restoreTarget && restoreTargetStats && (
        <div
          className="owner-history-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="restore-modal-title"
        >
          <div className="owner-history-modal">
            <h2 id="restore-modal-title" className="owner-history-modal-title">
              この変更前の状態に戻しますか？
            </h2>

            <div className="owner-history-modal-box">
              <div>
                <strong>対象の変更：</strong>
                {restoreTarget.actionSummary}
              </div>
              <div>
                <strong>変更日時：</strong>
                {formatRevisionDateJst(restoreTarget.createdAt)}
              </div>
              <div>
                <strong>変更者：</strong>
                {formatActorLabel(
                  restoreTarget.actorName,
                  restoreTarget.actorEmail
                )}
              </div>
            </div>

            <div className="owner-history-modal-box">
              <div>
                <strong>現在のデータ：</strong>
                試合日 {currentStats.gameDays}日 / 試合 {currentStats.matches}件（スコア済{' '}
                {currentStats.scoredMatches}） / 選手 {currentStats.players}名 / 練習{' '}
                {currentStats.practices}本
              </div>
              <div>
                <strong>復元後のデータ：</strong>
                試合日 {restoreTargetStats.gameDays}日 / 試合{' '}
                {restoreTargetStats.matches}件（スコア済{' '}
                {restoreTargetStats.scoredMatches}） / 選手{' '}
                {restoreTargetStats.players}名 / 練習{' '}
                {restoreTargetStats.practices}本
              </div>
            </div>

            <div className="owner-history-modal-note">
              実行すると、現在の最新データが「復元前の控え」として新しい履歴に保存されたあとで復元されます。
            </div>

            <div className="owner-history-modal-actions">
              <button
                type="button"
                className="btn-ghost btn-sm"
                disabled={busyAction !== null}
                onClick={() => setRestoreTarget(null)}
              >
                キャンセル
              </button>
              <button
                type="button"
                className="btn-accent btn-sm"
                disabled={busyAction !== null}
                onClick={() => void handleConfirmRestore()}
              >
                <RotateCcw size={14} />
                {busyAction === 'restore'
                  ? '復元しています...'
                  : 'この変更前に戻す'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmPruneOpen && (
        <div
          className="owner-history-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="prune-modal-title"
        >
          <div className="owner-history-modal">
            <h2 id="prune-modal-title" className="owner-history-modal-title">
              古い履歴（31件目以降）を整理しますか？
            </h2>
            <div className="owner-history-modal-note">
              最新 {MAX_REVISIONS_KEEP} 件の履歴とポータルの現在データはそのまま残り、{MAX_REVISIONS_KEEP + 1}件目以降の古い履歴のみ削除されます。
            </div>
            <div className="owner-history-modal-actions">
              <button
                type="button"
                className="btn-ghost btn-sm"
                disabled={busyAction !== null}
                onClick={() => setConfirmPruneOpen(false)}
              >
                キャンセル
              </button>
              <button
                type="button"
                className="btn-accent btn-sm"
                disabled={busyAction !== null}
                onClick={() => void handleConfirmPrune()}
              >
                <Trash2 size={14} />
                {busyAction === 'prune'
                  ? '整理しています...'
                  : '古い履歴を整理する'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
