import { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import {
  ClipboardEdit,
  Cloud,
  Home,
  LogOut,
  Trophy,
  Video,
} from 'lucide-react';
import type { AuthUser, PortalData, PortalTab } from './types';
import {
  loadPortalData,
  savePortalData,
} from './data/sampleData';
import {
  auth,
  isFirebaseConfigured,
  resolveGoogleRedirect,
  signInWithGoogle,
  signOutFromFirebase,
} from './firebase';
import {
  savePortalDataToCloud,
  subscribePortalData,
} from './services/portalStore';
import { extractYouTubeVideoId } from './utils/youtube';
import { LoginScreen } from './components/LoginScreen';
import { AccessDeniedScreen } from './components/AccessDeniedScreen';
import { PinGate } from './components/PinGate';
import { HomeView } from './components/HomeView';
import { GamesView } from './components/GamesView';
import { PracticesView } from './components/PracticesView';
import { AdminView } from './components/AdminView';

const AUTH_SESSION_KEY = 'hoops_portal_auth_v1';

interface ToastItem {
  id: string;
  message: string;
  tone: 'success' | 'info' | 'danger';
}

let toastSeq = 0;

function createToastId(): string {
  toastSeq += 1;
  return `toast_${toastSeq}_${crypto.randomUUID().slice(0, 8)}`;
}

function formatAuthErrorMessage(err: unknown): string {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: unknown }).code)
      : '';
  switch (code) {
    case 'auth/unauthorized-domain':
      return 'このURLからのGoogleログインは未許可です。Macからは http://localhost:5173 、スマホからは公開URL（basketball-video-stats.vercel.app）を開いてお試しください。';
    case 'auth/popup-closed-by-user':
      return 'ログイン画面が閉じられました。もう一度お試しください。';
    case 'auth/cancelled-popup-request':
      return 'ログイン処理をやり直してください。';
    case 'auth/network-request-failed':
      return '通信エラーが発生しました。インターネット接続をご確認ください。';
    default:
      return 'Googleログインに失敗しました。時間をおいてもう一度お試しください。';
  }
}

export function PortalApp() {
  const [authState, setAuthState] = useState<{
    ready: boolean;
    user: AuthUser | null;
  }>(() => ({
    ready: !isFirebaseConfigured,
    user: null,
  }));

  const [demoUser, setDemoUser] = useState<AuthUser | null>(() => {
    if (isFirebaseConfigured) return null;
    try {
      const saved = sessionStorage.getItem(AUTH_SESSION_KEY);
      return saved ? (JSON.parse(saved) as AuthUser) : null;
    } catch {
      return null;
    }
  });

  const [localData, setLocalData] = useState<PortalData>(() => loadPortalData());
  const [cloudData, setCloudData] = useState<PortalData | null>(null);
  const [cloudStatus, setCloudStatus] = useState<
    'idle' | 'ready' | 'denied' | 'error'
  >('idle');
  const [cloudError, setCloudError] = useState('');

  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');

  const [activeTab, setActiveTab] = useState<PortalTab>('home');
  const [pinUnlocked, setPinUnlocked] = useState(false);

  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [selectedPracticeId, setSelectedPracticeId] = useState<string | null>(null);
  const [gameSearchQuery, setGameSearchQuery] = useState('');
  const [practiceSearchQuery, setPracticeSearchQuery] = useState('');
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const notify = (
    message: string,
    tone: 'success' | 'info' | 'danger' = 'info'
  ) => {
    const id = createToastId();
    setToasts((prev) => [...prev, { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 2800);
  };

  // Firebase Auth 監視
  useEffect(() => {
    if (!isFirebaseConfigured || !auth) return;
    void resolveGoogleRedirect();

    return onAuthStateChanged(auth, (fbUser) => {
      if (fbUser) {
        setAuthState({
          ready: true,
          user: {
            id: fbUser.uid,
            name: fbUser.displayName || fbUser.email || '部員',
            email: fbUser.email || '',
            loginMethod: 'google',
          },
        });
      } else {
        setAuthState({ ready: true, user: null });
        setCloudData(null);
        setCloudStatus('idle');
        setCloudError('');
        setPinUnlocked(false);
      }
    });
  }, []);

  // Firestore リアルタイム購読
  useEffect(() => {
    if (!isFirebaseConfigured || !authState.user) return;
    const email = authState.user.email;

    return subscribePortalData(email, {
      onData: (nextData) => {
        setCloudData(nextData);
        setCloudStatus('ready');
        setCloudError('');
      },
      onAccessDenied: () => {
        setCloudData(null);
        setCloudStatus('denied');
      },
      onError: (msg) => {
        setCloudError(msg);
        setCloudStatus('error');
      },
    });
  }, [authState.user]);

  // オフライン試作時のみ localStorage 保存
  useEffect(() => {
    if (!isFirebaseConfigured) {
      savePortalData(localData);
    }
  }, [localData]);

  const currentUser = isFirebaseConfigured ? authState.user : demoUser;
  const data = isFirebaseConfigured ? (cloudData ?? localData) : localData;

  const updateData = (updater: (prev: PortalData) => PortalData) => {
    if (isFirebaseConfigured) {
      setCloudData((prev) => {
        const base = prev ?? localData;
        const next = updater(base);
        void savePortalDataToCloud(next).catch((err) => {
          console.error('Cloud save error:', err);
          notify('クラウドへの保存に失敗しました。通信状況をご確認ください。', 'danger');
        });
        return next;
      });
    } else {
      setLocalData((prev) => updater(prev));
    }
  };

  const handleGoogleSignIn = async () => {
    setAuthBusy(true);
    setAuthError('');
    try {
      await signInWithGoogle();
    } catch (err) {
      setAuthError(formatAuthErrorMessage(err));
    } finally {
      setAuthBusy(false);
    }
  };

  const handleDemoLogin = (user: AuthUser) => {
    setDemoUser(user);
    try {
      sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(user));
    } catch {
      // ignore
    }
    notify(`${user.name} としてログインしました`, 'success');
  };

  const handleLogout = () => {
    setPinUnlocked(false);
    setActiveTab('home');
    setSelectedGameId(null);
    setSelectedPracticeId(null);

    if (isFirebaseConfigured) {
      void signOutFromFirebase();
    } else {
      setDemoUser(null);
      try {
        sessionStorage.removeItem(AUTH_SESSION_KEY);
      } catch {
        // ignore
      }
    }
  };

  const handleSwitchAccount = () => {
    void (async () => {
      await signOutFromFirebase();
      await handleGoogleSignIn();
    })();
  };

  const handleTabChange = (tab: PortalTab) => {
    setActiveTab(tab);
    if (tab !== 'games') setSelectedGameId(null);
    if (tab !== 'practices') setSelectedPracticeId(null);
  };

  const handleUpdateGameVideoUrl = (
    gameId: string,
    clipId: string,
    youtubeUrl: string
  ) => {
    const videoId = extractYouTubeVideoId(youtubeUrl);
    if (!videoId) {
      notify('有効なYouTube URLを確認してください', 'danger');
      return;
    }
    updateData((prev) => ({
      ...prev,
      games: prev.games.map((g) => {
        if (g.id !== gameId) return g;
        return {
          ...g,
          videos: g.videos.map((v) =>
            v.id === clipId ? { ...v, youtubeId: videoId, youtubeUrl } : v
          ),
        };
      }),
    }));
    notify('YouTube動画を反映しました', 'success');
  };

  const handleUpdatePracticeUrl = (practiceId: string, youtubeUrl: string) => {
    const videoId = extractYouTubeVideoId(youtubeUrl);
    if (!videoId) {
      notify('有効なYouTube URLを確認してください', 'danger');
      return;
    }
    updateData((prev) => ({
      ...prev,
      practices: prev.practices.map((p) =>
        p.id === practiceId ? { ...p, youtubeId: videoId, youtubeUrl } : p
      ),
    }));
    notify('練習のYouTube動画を反映しました', 'success');
  };

  // 1. 認証読み込み中
  if (isFirebaseConfigured && !authState.ready) {
    return (
      <div className="portal-loading-page">
        <div className="portal-spinner" />
        <p>ログイン状態を確認しています...</p>
      </div>
    );
  }

  // 2. 未ログイン（第1ロック）
  if (!currentUser) {
    return (
      <LoginScreen
        teamName={data.teamName}
        isFirebaseMode={isFirebaseConfigured}
        loading={authBusy}
        errorMessage={authError}
        onGoogleSignIn={handleGoogleSignIn}
        onDemoLogin={handleDemoLogin}
      />
    );
  }

  // 3. Firebaseモードで未許可ユーザー
  if (isFirebaseConfigured && cloudStatus === 'denied') {
    return (
      <AccessDeniedScreen
        email={currentUser.email}
        onSwitchAccount={handleSwitchAccount}
        onSignOut={handleLogout}
      />
    );
  }

  // 4. Firebaseモードで通信エラー
  if (isFirebaseConfigured && cloudStatus === 'error') {
    return (
      <div className="portal-auth-page">
        <div className="portal-auth-card">
          <h1 className="portal-auth-title">読み込みエラー</h1>
          <p className="portal-auth-subtitle">
            {cloudError || 'クラウドとの接続に失敗しました。'}
          </p>
          <button
            type="button"
            className="btn-accent btn-block"
            onClick={() => window.location.reload()}
          >
            再読み込みする
          </button>
          <button
            type="button"
            className="btn-ghost btn-block"
            onClick={handleLogout}
          >
            ログアウト
          </button>
        </div>
      </div>
    );
  }

  // 5. Firebaseデータ初期読込中
  if (isFirebaseConfigured && !cloudData) {
    return (
      <div className="portal-loading-page">
        <div className="portal-spinner" />
        <p>クラウドからチームデータを読み込んでいます...</p>
      </div>
    );
  }

  return (
    <div className="portal-shell">
      {/* ヘッダー */}
      <header className="portal-header">
        <div className="portal-header-inner">
          <div className="portal-brand">
            <span className="brand-ball">🏀</span>
            <div>
              <div className="brand-title">{data.teamName}</div>
              <div className="brand-sub-row">
                <span className="brand-sub">動画・スタッツ共有ポータル</span>
                {isFirebaseConfigured && (
                  <span className="cloud-sync-pill">
                    <Cloud size={10} /> 同期中
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="portal-user-box">
            <span className="user-pill">{currentUser.name}</span>
            <button
              type="button"
              className="btn-logout"
              onClick={handleLogout}
              title="ログアウト"
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </header>

      {/* メイン領域 */}
      <main className="portal-main">
        {activeTab === 'home' && (
          <HomeView
            games={data.games}
            practices={data.practices}
            onOpenGame={(gameId) => {
              setSelectedGameId(gameId);
              setActiveTab('games');
            }}
            onOpenPractice={(practiceId) => {
              setSelectedPracticeId(practiceId);
              setActiveTab('practices');
            }}
            onSearchGames={(q) => {
              setGameSearchQuery(q);
              setSelectedGameId(null);
              setActiveTab('games');
            }}
            onSearchPractices={(q) => {
              setPracticeSearchQuery(q);
              setSelectedPracticeId(null);
              setActiveTab('practices');
            }}
            onGoToAdmin={() => setActiveTab('admin')}
          />
        )}

        {activeTab === 'games' && (
          <GamesView
            key={selectedGameId ?? 'list'}
            games={data.games}
            players={data.players}
            selectedGameId={selectedGameId}
            onSelectGame={setSelectedGameId}
            searchQuery={gameSearchQuery}
            onSearchQueryChange={setGameSearchQuery}
            onUpdateGameVideoUrl={handleUpdateGameVideoUrl}
          />
        )}

        {activeTab === 'practices' && (
          <PracticesView
            key={selectedPracticeId ?? 'list'}
            practices={data.practices}
            practiceTags={data.practiceTags}
            selectedPracticeId={selectedPracticeId}
            onSelectPractice={setSelectedPracticeId}
            searchQuery={practiceSearchQuery}
            onSearchQueryChange={setPracticeSearchQuery}
            onUpdatePracticeUrl={handleUpdatePracticeUrl}
          />
        )}

        {activeTab === 'admin' &&
          (!pinUnlocked ? (
            <PinGate
              expectedPin={data.adminPin}
              onSuccess={() => {
                setPinUnlocked(true);
                notify('管理者モードを解除しました', 'success');
              }}
            />
          ) : (
            <AdminView
              data={data}
              currentUserEmail={currentUser.email}
              onUpdateData={updateData}
              onNotify={notify}
              onLockPin={() => {
                setPinUnlocked(false);
                notify('管理者モードをロックしました', 'info');
              }}
              onOpenGameDetail={(gameId) => {
                setSelectedGameId(gameId);
                setActiveTab('games');
              }}
            />
          ))}
      </main>

      {/* 下部固定ナビゲーション */}
      <nav className="portal-bottom-nav" aria-label="メインメニュー">
        <div className="portal-bottom-nav-inner">
          <button
            type="button"
            className={`nav-tab-btn ${activeTab === 'home' ? 'is-active' : ''}`}
            onClick={() => handleTabChange('home')}
          >
            <Home size={20} />
            <span>ホーム</span>
          </button>

          <button
            type="button"
            className={`nav-tab-btn ${activeTab === 'games' ? 'is-active' : ''}`}
            onClick={() => handleTabChange('games')}
          >
            <Trophy size={20} />
            <span>試合</span>
          </button>

          <button
            type="button"
            className={`nav-tab-btn ${activeTab === 'practices' ? 'is-active' : ''}`}
            onClick={() => handleTabChange('practices')}
          >
            <Video size={20} />
            <span>練習</span>
          </button>

          <button
            type="button"
            className={`nav-tab-btn ${activeTab === 'admin' ? 'is-active' : ''}`}
            onClick={() => handleTabChange('admin')}
          >
            <ClipboardEdit size={20} />
            <span>記録・管理</span>
          </button>
        </div>
      </nav>

      {/* トースト通知 */}
      <div className="portal-toast-stack" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`portal-toast tone-${t.tone}`}>
            {t.message}
          </div>
        ))}
      </div>
    </div>
  );
}
