import { getApps, initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  getAuth,
  getRedirectResult,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from 'firebase/auth';
import type { Auth, User } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
};

export const firebaseApiKey = firebaseConfig.apiKey;

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey &&
    firebaseConfig.authDomain &&
    firebaseConfig.projectId &&
    firebaseConfig.appId
);

let auth: Auth | null = null;
let db: Firestore | null = null;
let googleProvider: GoogleAuthProvider | null = null;

if (isFirebaseConfigured) {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  googleProvider = new GoogleAuthProvider();
  googleProvider.setCustomParameters({ prompt: 'select_account' });
}

export { auth, db };

export async function signInWithGoogle(): Promise<User | null> {
  if (!auth || !googleProvider) {
    throw new Error('Firebase認証がまだ設定されていません。');
  }
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (err: unknown) {
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? String((err as { code?: unknown }).code)
        : '';
    if (
      code === 'auth/popup-blocked' ||
      code === 'auth/operation-not-supported-in-this-environment'
    ) {
      await signInWithRedirect(auth, googleProvider);
      return null;
    }
    throw err;
  }
}

export async function resolveGoogleRedirect(): Promise<User | null> {
  if (!auth) return null;
  try {
    const result = await getRedirectResult(auth);
    return result?.user ?? null;
  } catch (err) {
    console.error('Redirect auth error:', err);
    return null;
  }
}

export async function signOutFromFirebase(): Promise<void> {
  if (!auth) return;
  await signOut(auth);
}

export async function requestYouTubeAccessToken(): Promise<{
  accessToken: string;
  accountEmail: string;
}> {
  if (!isFirebaseConfigured) {
    throw new Error('Firebaseがまだ設定されていません。');
  }

  const ytApp =
    getApps().find((a) => a.name === 'youtube-sync') ??
    initializeApp(firebaseConfig, 'youtube-sync');
  const ytAuth = getAuth(ytApp);
  const ytProvider = new GoogleAuthProvider();
  ytProvider.addScope('https://www.googleapis.com/auth/youtube.readonly');
  ytProvider.setCustomParameters({ prompt: 'select_account' });

  try {
    const result = await signInWithPopup(ytAuth, ytProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    const accessToken = credential?.accessToken ?? '';
    const accountEmail = result.user.email || '';
    await signOut(ytAuth);

    if (!accessToken) {
      throw new Error(
        'YouTubeの読み取り権限を取得できませんでした。アカウント選択時にYouTube参照の許可にチェックを入れてお試しください。'
      );
    }

    return { accessToken, accountEmail };
  } catch (err: unknown) {
    try {
      await signOut(ytAuth);
    } catch {
      // ignore cleanup error
    }
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? String((err as { code?: unknown }).code)
        : '';
    if (code === 'auth/popup-closed-by-user') {
      throw new Error('YouTube連携のログイン画面が閉じられました。', { cause: err });
    }
    if (code === 'auth/popup-blocked') {
      throw new Error(
        'ポップアップがブラウザにブロックされました。ポップアップを許可してもう一度お試しください。',
        { cause: err }
      );
    }
    if (code === 'auth/unauthorized-domain') {
      throw new Error(
        'このURLではGoogle認証が許可されていません。Macからは http://localhost:5173 を開いてお試しください。',
        { cause: err }
      );
    }
    throw err;
  }
}
