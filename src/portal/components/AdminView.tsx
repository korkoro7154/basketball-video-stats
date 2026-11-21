import { useEffect, useState } from 'react';
import {
  Check,
  Clock,
  Lock,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  Undo2,
  UserPlus,
  Mail,
  ShieldCheck,
} from 'lucide-react';
import type {
  GameCategory,
  GameRecord,
  GameStatEvent,
  Player,
  PlayerBoxScoreEntry,
  PortalData,
  PracticeVideo,
  QuarterLabel,
  StatActionType,
} from '../types';
import {
  STAT_META,
  computeGameScores,
  createEmptyBoxScoreEntry,
} from '../utils/stats';
import { formatSeconds } from '../utils/youtube';
import { YouTubeImportPanel } from './YouTubeImportPanel';

interface AdminViewProps {
  data: PortalData;
  currentUserEmail?: string;
  onUpdateData: (updater: (prev: PortalData) => PortalData) => void;
  onNotify: (message: string, tone?: 'success' | 'info' | 'danger') => void;
  onLockPin: () => void;
  onOpenGameDetail: (gameId: string) => void;
}

type AdminSubTab = 'stats' | 'youtube' | 'roster' | 'settings';

const STAT_BUTTON_LIST: StatActionType[] = [
  '2P_MADE',
  '2P_MISS',
  '3P_MADE',
  '3P_MISS',
  'FT_MADE',
  'FT_MISS',
  'OREB',
  'DREB',
  'AST',
  'STL',
  'BLK',
  'TO',
  'PF',
];

let nextSeq = 0;

function createClientId(prefix: string): string {
  nextSeq += 1;
  return `${prefix}_${nextSeq}_${crypto.randomUUID().slice(0, 8)}`;
}

function EmptyRosterNotice({ onOpenRoster }: { onOpenRoster: () => void }) {
  return (
    <div className="admin-warn-note">
      <span>
        まだ部員が登録されていません。「選手名簿」タブから部員を追加すると個人別の記録ができます。
      </span>
      <div className="top-gap">
        <button type="button" className="btn-soft-sm" onClick={onOpenRoster}>
          <UserPlus size={14} /> 選手名簿を開く
        </button>
      </div>
    </div>
  );
}

export function AdminView({
  data,
  currentUserEmail,
  onUpdateData,
  onNotify,
  onLockPin,
  onOpenGameDetail,
}: AdminViewProps) {
  const [subTab, setSubTab] = useState<AdminSubTab>('stats');

  // スタッツ記録用ステート
  const [selectedGameId, setSelectedGameId] = useState<string>(
    () => data.games[0]?.id ?? ''
  );
  const [inputMode, setInputMode] = useState<'live' | 'batch'>('live');
  const [quarter, setQuarter] = useState<QuarterLabel>('1Q');
  const [timerSec, setTimerSec] = useState(0);
  const [timerActive, setTimerActive] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState<'away' | string>(
    () => data.players[0]?.id ?? 'away'
  );

  // 新規試合作成ミニフォーム
  const [showNewGameForm, setShowNewGameForm] = useState(false);
  const [newGameTitle, setNewGameTitle] = useState('');
  const [newGameDate, setNewGameDate] = useState(
    () => new Date().toISOString().split('T')[0]
  );
  const [newGameOpponent, setNewGameOpponent] = useState('');
  const [newGameCategory, setNewGameCategory] = useState<GameCategory>('練習試合');

  // 選手名簿・許可メンバー用ステート
  const [newPlayerNum, setNewPlayerNum] = useState('');
  const [newPlayerName, setNewPlayerName] = useState('');
  const [newPlayerPos, setNewPlayerPos] = useState('G');
  const [newPlayerGrade, setNewPlayerGrade] = useState('2年');
  const [newAllowedEmail, setNewAllowedEmail] = useState('');

  // 設定用ステート
  const [teamNameInput, setTeamNameInput] = useState(data.teamName);
  const [newTagInput, setNewTagInput] = useState('');
  const [newPinInput, setNewPinInput] = useState('');

  useEffect(() => {
    if (!timerActive) return;
    const id = window.setInterval(() => {
      setTimerSec((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [timerActive]);

  const activeGame =
    data.games.find((g) => g.id === selectedGameId) ?? data.games[0] ?? null;

  const handleCreateGame = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGameOpponent.trim()) {
      onNotify('対戦相手を入力してください', 'danger');
      return;
    }
    const id = createClientId('game');
    const created: GameRecord = {
      id,
      title: newGameTitle.trim() || `vs ${newGameOpponent.trim()}`,
      date: newGameDate,
      opponent: newGameOpponent.trim(),
      category: newGameCategory,
      homeScore: 0,
      awayScore: 0,
      videos: [
        {
          id: createClientId('gv'),
          label: '試合動画',
          youtubeId: `demo_${id}`,
          youtubeUrl: '',
        },
      ],
      events: [],
    };
    onUpdateData((prev) => ({
      ...prev,
      games: [created, ...prev.games],
    }));
    setSelectedGameId(id);
    setNewGameTitle('');
    setNewGameOpponent('');
    setShowNewGameForm(false);
    onNotify('新しい試合を作成しました', 'success');
  };

  // 2タップ入力で記録
  const handleQuickRecordStat = (type: StatActionType) => {
    if (!activeGame) return;

    const isAway = selectedTarget === 'away';
    const player = isAway
      ? null
      : data.players.find((p) => p.id === selectedTarget) ?? null;

    if (!isAway && !player) {
      onNotify('先に選手または相手チームを選択してください', 'danger');
      return;
    }

    const newEvent: GameStatEvent = {
      id: createClientId('ev'),
      quarter,
      timestampSec: timerSec,
      team: isAway ? 'away' : 'home',
      playerId: isAway ? null : player!.id,
      type,
    };

    onUpdateData((prev) => ({
      ...prev,
      games: prev.games.map((g) => {
        if (g.id !== activeGame.id) return g;
        const nextEvents = [...g.events, newEvent];
        const pts = STAT_META[type].points;
        return {
          ...g,
          events: nextEvents,
          homeScore: isAway ? g.homeScore : g.homeScore + pts,
          awayScore: isAway ? g.awayScore + pts : g.awayScore,
        };
      }),
    }));

    const targetName = isAway ? '相手チーム' : `#${player!.number} ${player!.name}`;
    onNotify(`${targetName}: ${STAT_META[type].label}`, 'success');
  };

  const handleUndoLastEvent = () => {
    if (!activeGame || activeGame.events.length === 0) return;
    const removed = activeGame.events[activeGame.events.length - 1];
    const pts = STAT_META[removed.type].points;

    onUpdateData((prev) => ({
      ...prev,
      games: prev.games.map((g) => {
        if (g.id !== activeGame.id) return g;
        return {
          ...g,
          events: g.events.slice(0, -1),
          homeScore:
            removed.team === 'home' ? Math.max(0, g.homeScore - pts) : g.homeScore,
          awayScore:
            removed.team === 'away' ? Math.max(0, g.awayScore - pts) : g.awayScore,
        };
      }),
    }));
    onNotify(`直前の記録（${STAT_META[removed.type].label}）を取り消しました`, 'info');
  };

  // まとめ入力の増減ヘルパー
  type BatchField =
    | 'twoPm'
    | 'twoPmiss'
    | 'tpMade'
    | 'tpMiss'
    | 'ftMade'
    | 'ftMiss'
    | 'oreb'
    | 'dreb'
    | 'ast'
    | 'stl'
    | 'blk'
    | 'to'
    | 'pf';

  const getCurrentBatchBox = (game: GameRecord): Record<string, PlayerBoxScoreEntry> => {
    if (game.manualBoxScore && Object.keys(game.manualBoxScore).length > 0) {
      return game.manualBoxScore;
    }
    const base: Record<string, PlayerBoxScoreEntry> = {};
    data.players.forEach((p) => {
      base[p.id] = createEmptyBoxScoreEntry(p.id);
    });
    game.events
      .filter((e) => e.team === 'home' && e.playerId)
      .forEach((e) => {
        const cur = base[e.playerId!];
        if (!cur) return;
        if (e.type === '2P_MADE') {
          cur.pts += 2;
          cur.fgm += 1;
          cur.fga += 1;
        } else if (e.type === '2P_MISS') {
          cur.fga += 1;
        } else if (e.type === '3P_MADE') {
          cur.pts += 3;
          cur.fgm += 1;
          cur.fga += 1;
          cur.tpm += 1;
          cur.tpa += 1;
        } else if (e.type === '3P_MISS') {
          cur.fga += 1;
          cur.tpa += 1;
        } else if (e.type === 'FT_MADE') {
          cur.pts += 1;
          cur.ftm += 1;
          cur.fta += 1;
        } else if (e.type === 'FT_MISS') {
          cur.fta += 1;
        } else if (e.type === 'OREB') cur.oreb += 1;
        else if (e.type === 'DREB') cur.dreb += 1;
        else if (e.type === 'AST') cur.ast += 1;
        else if (e.type === 'STL') cur.stl += 1;
        else if (e.type === 'BLK') cur.blk += 1;
        else if (e.type === 'TO') cur.to += 1;
        else if (e.type === 'PF') cur.pf += 1;
      });
    return base;
  };

  const adjustBatchStat = (playerId: string, field: BatchField, delta: number) => {
    if (!activeGame) return;

    onUpdateData((prev) => ({
      ...prev,
      games: prev.games.map((g) => {
        if (g.id !== activeGame.id) return g;
        const map = { ...getCurrentBatchBox(g) };
        const cur = { ...(map[playerId] ?? createEmptyBoxScoreEntry(playerId)) };

        const twoPm = Math.max(0, cur.fgm - cur.tpm);
        const twoPmiss = Math.max(0, cur.fga - cur.tpa - twoPm);
        const tpMiss = Math.max(0, cur.tpa - cur.tpm);
        const ftMiss = Math.max(0, cur.fta - cur.ftm);

        let nextTwoPm = twoPm;
        let nextTwoPmiss = twoPmiss;
        let nextTpm = cur.tpm;
        let nextTpMiss = tpMiss;
        let nextFtm = cur.ftm;
        let nextFtMiss = ftMiss;

        switch (field) {
          case 'twoPm':
            nextTwoPm = Math.max(0, twoPm + delta);
            break;
          case 'twoPmiss':
            nextTwoPmiss = Math.max(0, twoPmiss + delta);
            break;
          case 'tpMade':
            nextTpm = Math.max(0, cur.tpm + delta);
            break;
          case 'tpMiss':
            nextTpMiss = Math.max(0, tpMiss + delta);
            break;
          case 'ftMade':
            nextFtm = Math.max(0, cur.ftm + delta);
            break;
          case 'ftMiss':
            nextFtMiss = Math.max(0, ftMiss + delta);
            break;
          case 'oreb':
            cur.oreb = Math.max(0, cur.oreb + delta);
            break;
          case 'dreb':
            cur.dreb = Math.max(0, cur.dreb + delta);
            break;
          case 'ast':
            cur.ast = Math.max(0, cur.ast + delta);
            break;
          case 'stl':
            cur.stl = Math.max(0, cur.stl + delta);
            break;
          case 'blk':
            cur.blk = Math.max(0, cur.blk + delta);
            break;
          case 'to':
            cur.to = Math.max(0, cur.to + delta);
            break;
          case 'pf':
            cur.pf = Math.max(0, cur.pf + delta);
            break;
        }

        cur.tpm = nextTpm;
        cur.tpa = nextTpm + nextTpMiss;
        cur.fgm = nextTwoPm + nextTpm;
        cur.fga = cur.fgm + nextTwoPmiss + nextTpMiss;
        cur.ftm = nextFtm;
        cur.fta = nextFtm + nextFtMiss;
        cur.pts = nextTwoPm * 2 + nextTpm * 3 + nextFtm;

        map[playerId] = cur;
        const totalHomePts = Object.values(map).reduce((sum, item) => sum + item.pts, 0);

        return {
          ...g,
          manualBoxScore: map,
          homeScore: totalHomePts,
        };
      }),
    }));
  };

  const adjustAwayScoreBatch = (delta: number) => {
    if (!activeGame) return;
    onUpdateData((prev) => ({
      ...prev,
      games: prev.games.map((g) =>
        g.id === activeGame.id
          ? { ...g, awayScore: Math.max(0, g.awayScore + delta) }
          : g
      ),
    }));
  };

  // 選手追加・削除
  const handleAddPlayer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlayerNum.trim() || !newPlayerName.trim()) {
      onNotify('背番号と選手名を入力してください', 'danger');
      return;
    }
    if (data.players.some((p) => p.number === newPlayerNum.trim())) {
      onNotify(`背番号 #${newPlayerNum.trim()} はすでに登録されています`, 'danger');
      return;
    }
    const created: Player = {
      id: createClientId('p'),
      number: newPlayerNum.trim(),
      name: newPlayerName.trim(),
      position: newPlayerPos,
      grade: newPlayerGrade,
    };
    onUpdateData((prev) => ({
      ...prev,
      players: [...prev.players, created],
    }));
    setNewPlayerNum('');
    setNewPlayerName('');
    onNotify(`#${created.number} ${created.name} を追加しました`, 'success');
  };

  const handleAddAllowedEmail = (e: React.FormEvent) => {
    e.preventDefault();
    const email = newAllowedEmail.trim().toLowerCase();
    if (!email || !email.includes('@') || !email.includes('.')) {
      onNotify('正しいGoogleメールアドレスを入力してください', 'danger');
      return;
    }
    const existing = new Set([
      ...data.ownerEmails.map((em) => em.trim().toLowerCase()),
      ...data.allowedEmails.map((em) => em.trim().toLowerCase()),
    ]);
    if (existing.has(email)) {
      onNotify('このメールアドレスはすでに許可されています', 'info');
      return;
    }
    onUpdateData((prev) => ({
      ...prev,
      allowedEmails: [...prev.allowedEmails, email],
    }));
    setNewAllowedEmail('');
    onNotify(`${email} を閲覧許可に追加しました`, 'success');
  };

  const handleRemoveAllowedEmail = (email: string) => {
    const normalized = email.trim().toLowerCase();
    if (data.ownerEmails.some((em) => em.trim().toLowerCase() === normalized)) {
      onNotify('管理者アカウントは削除できません', 'danger');
      return;
    }
    if (!window.confirm(`「${normalized}」の閲覧許可を取り消しますか？`)) {
      return;
    }
    onUpdateData((prev) => ({
      ...prev,
      allowedEmails: prev.allowedEmails.filter(
        (em) => em.trim().toLowerCase() !== normalized
      ),
    }));
    onNotify(`${normalized} を許可リストから削除しました`, 'info');
  };

  const handleRemovePlayer = (player: Player) => {
    if (!window.confirm(`「#${player.number} ${player.name}」を名簿から削除しますか？`)) {
      return;
    }
    onUpdateData((prev) => ({
      ...prev,
      players: prev.players.filter((p) => p.id !== player.id),
    }));
    onNotify('選手を削除しました', 'info');
  };

  // 設定変更
  const handleSaveTeamName = (e: React.FormEvent) => {
    e.preventDefault();
    if (!teamNameInput.trim()) return;
    onUpdateData((prev) => ({ ...prev, teamName: teamNameInput.trim() }));
    onNotify('チーム名を更新しました', 'success');
  };

  const handleAddTag = (e: React.FormEvent) => {
    e.preventDefault();
    const raw = newTagInput.trim();
    if (!raw) return;
    const tag = raw.startsWith('#') ? raw : `#${raw}`;
    if (data.practiceTags.includes(tag)) {
      onNotify('同じタグがすでにあります', 'info');
      return;
    }
    onUpdateData((prev) => ({
      ...prev,
      practiceTags: [...prev.practiceTags, tag],
    }));
    setNewTagInput('');
    onNotify(`タグ「${tag}」を追加しました`, 'success');
  };

  const handleChangePin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{4}$/.test(newPinInput.trim())) {
      onNotify('PINは4桁の数字で入力してください', 'danger');
      return;
    }
    onUpdateData((prev) => ({ ...prev, adminPin: newPinInput.trim() }));
    setNewPinInput('');
    onNotify('管理者PINを変更しました', 'success');
  };

  const handleRemoveGame = (game: GameRecord) => {
    if (
      !window.confirm(
        `試合「${game.date} ${game.title}（vs ${game.opponent}）」を削除しますか？\n（※動画やスタッツ記録も消えます）`
      )
    ) {
      return;
    }
    onUpdateData((prev) => ({
      ...prev,
      games: prev.games.filter((g) => g.id !== game.id),
    }));
    if (selectedGameId === game.id) {
      setSelectedGameId('');
    }
    onNotify('試合を削除しました', 'info');
  };

  const handleRemovePractice = (practice: PracticeVideo) => {
    if (
      !window.confirm(
        `練習動画「${practice.date} ${practice.title}」を削除しますか？`
      )
    ) {
      return;
    }
    onUpdateData((prev) => ({
      ...prev,
      practices: prev.practices.filter((p) => p.id !== practice.id),
    }));
    onNotify('練習動画を削除しました', 'info');
  };

  const activeScores = activeGame
    ? computeGameScores(activeGame)
    : { homeScore: 0, awayScore: 0 };

  const batchMap = activeGame ? getCurrentBatchBox(activeGame) : {};

  return (
    <div className="portal-section-stack">
      {/* 管理者ステータスバー */}
      <div className="admin-status-bar">
        <div className="admin-status-left">
          <span className="admin-badge">管理者モード</span>
          <span className="admin-sub">記録・編集OK</span>
        </div>
        <button type="button" className="btn-lock" onClick={onLockPin}>
          <Lock size={14} /> ロックする
        </button>
      </div>

      {/* サブタブ */}
      <div className="admin-subtab-grid">
        {[
          { id: 'stats' as const, label: 'スタッツ記録' },
          { id: 'youtube' as const, label: 'YouTube登録' },
          { id: 'roster' as const, label: '選手名簿' },
          { id: 'settings' as const, label: '設定' },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`admin-subtab-btn ${subTab === tab.id ? 'is-active' : ''}`}
            onClick={() => setSubTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ================================================= */}
      {/* ① スタッツ記録                                    */}
      {/* ================================================= */}
      {subTab === 'stats' && (
        <div className="portal-section-stack">
          {/* 対象試合選択 */}
          <section className="portal-card">
            <div className="row-between">
              <span className="field-caption">記録する試合</span>
              <button
                type="button"
                className="btn-soft-sm"
                onClick={() => setShowNewGameForm((v) => !v)}
              >
                <Plus size={14} /> 新しい試合を作成
              </button>
            </div>

            <select
              className="portal-select"
              value={activeGame?.id ?? ''}
              onChange={(e) => setSelectedGameId(e.target.value)}
            >
              {data.games.map((g) => {
                const sc = computeGameScores(g);
                return (
                  <option key={g.id} value={g.id}>
                    {g.date} vs {g.opponent}（{sc.homeScore}-{sc.awayScore}）
                  </option>
                );
              })}
            </select>

            {showNewGameForm && (
              <form onSubmit={handleCreateGame} className="inline-subform">
                <input
                  type="text"
                  className="portal-input"
                  placeholder="対戦相手（例：○○高校）*"
                  value={newGameOpponent}
                  onChange={(e) => setNewGameOpponent(e.target.value)}
                />
                <input
                  type="text"
                  className="portal-input"
                  placeholder="大会・試合名（例：県大会 準々決勝）"
                  value={newGameTitle}
                  onChange={(e) => setNewGameTitle(e.target.value)}
                />
                <div className="two-col-row">
                  <input
                    type="date"
                    className="portal-input"
                    value={newGameDate}
                    onChange={(e) => setNewGameDate(e.target.value)}
                  />
                  <select
                    className="portal-select"
                    value={newGameCategory}
                    onChange={(e) => setNewGameCategory(e.target.value as GameCategory)}
                  >
                    <option value="公式戦">公式戦</option>
                    <option value="練習試合">練習試合</option>
                    <option value="カップ戦">カップ戦</option>
                  </select>
                </div>
                <button type="submit" className="btn-accent btn-block">
                  試合を作成する
                </button>
              </form>
            )}

            {/* 入力モード切替 */}
            <div className="subtab-bar top-gap">
              <button
                type="button"
                className={`subtab-btn ${inputMode === 'live' ? 'is-active' : ''}`}
                onClick={() => setInputMode('live')}
              >
                ⚡ 試合中 2タップ入力
              </button>
              <button
                type="button"
                className={`subtab-btn ${inputMode === 'batch' ? 'is-active' : ''}`}
                onClick={() => setInputMode('batch')}
              >
                📝 試合後 まとめ入力
              </button>
            </div>
          </section>

          {activeGame && inputMode === 'live' && (
            <>
              {/* スコア・クオーター・簡易時計 */}
              <section className="portal-card">
                <div className="live-scoreboard">
                  <div className="live-team">
                    <span>自チーム</span>
                    <strong className="score-home">{activeScores.homeScore}</strong>
                  </div>
                  <div className="live-clock-box">
                    <div className="live-clock-time">
                      <Clock size={14} /> {formatSeconds(timerSec)}
                    </div>
                    <div className="live-clock-btns">
                      <button
                        type="button"
                        className="btn-soft-sm"
                        onClick={() => setTimerActive((a) => !a)}
                      >
                        {timerActive ? <Pause size={13} /> : <Play size={13} />}
                        {timerActive ? '停止' : '開始'}
                      </button>
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        onClick={() => {
                          setTimerActive(false);
                          setTimerSec(0);
                        }}
                      >
                        <RotateCcw size={13} />
                      </button>
                    </div>
                  </div>
                  <div className="live-team">
                    <span>{activeGame.opponent}</span>
                    <strong>{activeScores.awayScore}</strong>
                  </div>
                </div>

                <div className="quarter-pill-row">
                  {(['1Q', '2Q', '3Q', '4Q', 'OT'] as QuarterLabel[]).map((q) => (
                    <button
                      key={q}
                      type="button"
                      className={`filter-chip ${quarter === q ? 'is-active' : ''}`}
                      onClick={() => setQuarter(q)}
                    >
                      {q}
                    </button>
                  ))}
                </div>

                {activeGame.manualBoxScore &&
                  Object.keys(activeGame.manualBoxScore).length > 0 && (
                    <div className="admin-warn-note">
                      この試合は「試合後まとめ入力」のデータが優先表示されています。ライブ入力を試す場合は上の「新しい試合を作成」か別の試合を選んでください。
                    </div>
                  )}
              </section>

              {/* Step 1: 選手選択 */}
              <section className="portal-card">
                <div className="step-title">
                  <span className="step-num">1</span> 誰のプレイか選ぶ
                </div>
                {data.players.length === 0 && (
                  <EmptyRosterNotice onOpenRoster={() => setSubTab('roster')} />
                )}
                <div className="player-pick-grid">
                  {data.players.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={`player-pick-btn ${
                        selectedTarget === p.id ? 'is-selected' : ''
                      }`}
                      onClick={() => setSelectedTarget(p.id)}
                    >
                      <span className="pick-num">#{p.number}</span>
                      <span className="pick-name">{p.name}</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    className={`player-pick-btn is-away ${
                      selectedTarget === 'away' ? 'is-selected' : ''
                    }`}
                    onClick={() => setSelectedTarget('away')}
                  >
                    <span className="pick-num">相手</span>
                    <span className="pick-name">{activeGame.opponent}</span>
                  </button>
                </div>
              </section>

              {/* Step 2: スタッツ即記録ボタン */}
              <section className="portal-card">
                <div className="step-title">
                  <span className="step-num">2</span> アクションを押すだけで即記録
                </div>
                <div className="stat-pad-grid">
                  {STAT_BUTTON_LIST.map((type) => {
                    const meta = STAT_META[type];
                    return (
                      <button
                        key={type}
                        type="button"
                        className={`stat-pad-btn tone-${meta.tone}`}
                        onClick={() => handleQuickRecordStat(type)}
                      >
                        <strong>{meta.shortLabel}</strong>
                        <span>{meta.label}</span>
                      </button>
                    );
                  })}
                </div>

                {/* 直近ログ + Undo */}
                <div className="undo-bar">
                  <div className="last-event-text">
                    {activeGame.events.length > 0 ? (
                      (() => {
                        const last = activeGame.events[activeGame.events.length - 1];
                        const p = last.playerId
                          ? data.players.find((pl) => pl.id === last.playerId)
                          : null;
                        return `直前: [${last.quarter}] ${
                          last.team === 'away'
                            ? '相手'
                            : p
                              ? `#${p.number} ${p.name}`
                              : '自チーム'
                        } - ${STAT_META[last.type].label}`;
                      })()
                    ) : (
                      'まだこの試合の記録はありません'
                    )}
                  </div>
                  <button
                    type="button"
                    className="btn-undo"
                    disabled={activeGame.events.length === 0}
                    onClick={handleUndoLastEvent}
                  >
                    <Undo2 size={15} /> 1つ戻す
                  </button>
                </div>
              </section>
            </>
          )}

          {activeGame && inputMode === 'batch' && (
            <section className="portal-card">
              <div className="batch-score-header">
                <div>
                  <span className="field-caption">合計スコア</span>
                  <div className="batch-score-line">
                    <strong className="score-home">{activeScores.homeScore}</strong>
                    <span>-</span>
                    <strong>{activeScores.awayScore}</strong>
                  </div>
                </div>
                <div className="away-stepper">
                  <span className="field-caption">相手得点</span>
                  <div className="stepper-group">
                    <button
                      type="button"
                      className="step-btn"
                      onClick={() => adjustAwayScoreBatch(-1)}
                    >
                      -
                    </button>
                    <span className="step-val">{activeScores.awayScore}</span>
                    <button
                      type="button"
                      className="step-btn"
                      onClick={() => adjustAwayScoreBatch(1)}
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>

              <p className="table-helper-text">
                スコアシートを見ながら「+ / -」を押すと、得点が自動計算されて即保存されます。
              </p>

              {data.players.length === 0 ? (
                <EmptyRosterNotice onOpenRoster={() => setSubTab('roster')} />
              ) : (
                <div className="batch-player-list">
                  {data.players.map((p) => {
                    const entry = batchMap[p.id] ?? createEmptyBoxScoreEntry(p.id);
                    const twoPm = Math.max(0, entry.fgm - entry.tpm);
                    const twoPmiss = Math.max(0, entry.fga - entry.tpa - twoPm);
                    const tpMiss = Math.max(0, entry.tpa - entry.tpm);
                    const ftMiss = Math.max(0, entry.fta - entry.ftm);

                    const steppers: Array<{
                      label: string;
                      field: BatchField;
                      val: number;
                    }> = [
                      { label: '2P成功', field: 'twoPm', val: twoPm },
                      { label: '2Pミス', field: 'twoPmiss', val: twoPmiss },
                      { label: '3P成功', field: 'tpMade', val: entry.tpm },
                      { label: '3Pミス', field: 'tpMiss', val: tpMiss },
                      { label: 'FT成功', field: 'ftMade', val: entry.ftm },
                      { label: 'FTミス', field: 'ftMiss', val: ftMiss },
                      { label: 'O-REB', field: 'oreb', val: entry.oreb },
                      { label: 'D-REB', field: 'dreb', val: entry.dreb },
                      { label: 'AST', field: 'ast', val: entry.ast },
                      { label: 'STL', field: 'stl', val: entry.stl },
                      { label: 'BLK', field: 'blk', val: entry.blk },
                      { label: 'TO', field: 'to', val: entry.to },
                      { label: 'PF', field: 'pf', val: entry.pf },
                    ];

                    return (
                      <div key={p.id} className="batch-player-card">
                        <div className="batch-player-head">
                          <span>
                            <span className="jersey-num">#{p.number}</span>{' '}
                            <strong>{p.name}</strong>
                          </span>
                          <span className="batch-pts">{entry.pts} 点</span>
                        </div>

                        <div className="batch-stepper-grid">
                          {steppers.map((st) => (
                            <div key={st.field} className="mini-stepper-item">
                              <span className="mini-stepper-label">{st.label}</span>
                              <div className="mini-stepper-controls">
                                <button
                                  type="button"
                                  className="mini-step-btn"
                                  onClick={() => adjustBatchStat(p.id, st.field, -1)}
                                >
                                  -
                                </button>
                                <span className="mini-step-val">{st.val}</span>
                                <button
                                  type="button"
                                  className="mini-step-btn"
                                  onClick={() => adjustBatchStat(p.id, st.field, 1)}
                                >
                                  +
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <button
                type="button"
                className="btn-accent btn-block top-gap"
                onClick={() => onOpenGameDetail(activeGame.id)}
              >
                <Check size={17} /> 試合ページで表示を確認する
              </button>
            </section>
          )}
        </div>
      )}

      {/* ================================================= */}
      {/* ② YouTube連携・登録                               */}
      {/* ================================================= */}
      {subTab === 'youtube' && (
        <YouTubeImportPanel
          data={data}
          onUpdateData={onUpdateData}
          onNotify={onNotify}
          onSelectActiveGame={setSelectedGameId}
        />
      )}

      {/* ================================================= */}
      {/* ③ 選手名簿                                        */}
      {/* ================================================= */}
      {subTab === 'roster' && (
        <div className="portal-section-stack">
          <section className="portal-card">
            <div className="block-title-row">
              <UserPlus size={18} className="accent-icon" />
              <h3>部員を追加</h3>
            </div>
            <form onSubmit={handleAddPlayer} className="portal-auth-form">
              <div className="roster-form-row">
                <input
                  type="text"
                  className="portal-input num-input"
                  value={newPlayerNum}
                  onChange={(e) => setNewPlayerNum(e.target.value)}
                  placeholder="番号"
                  maxLength={3}
                />
                <input
                  type="text"
                  className="portal-input flex-1"
                  value={newPlayerName}
                  onChange={(e) => setNewPlayerName(e.target.value)}
                  placeholder="選手名（例：山田 太郎）"
                />
              </div>
              <div className="two-col-row">
                <select
                  className="portal-select"
                  value={newPlayerPos}
                  onChange={(e) => setNewPlayerPos(e.target.value)}
                >
                  <option value="PG">PG</option>
                  <option value="SG">SG</option>
                  <option value="SF">SF</option>
                  <option value="PF">PF</option>
                  <option value="C">C</option>
                  <option value="G">G</option>
                  <option value="F">F</option>
                </select>
                <select
                  className="portal-select"
                  value={newPlayerGrade}
                  onChange={(e) => setNewPlayerGrade(e.target.value)}
                >
                  <option value="3年">3年</option>
                  <option value="2年">2年</option>
                  <option value="1年">1年</option>
                </select>
              </div>
              <button type="submit" className="btn-accent btn-block">
                <Plus size={17} /> 名簿に追加する
              </button>
            </form>
          </section>

          <section className="portal-card">
            <h3 className="block-subtitle">登録済み部員（{data.players.length}名）</h3>
            <div className="roster-list">
              {[...data.players]
                .sort(
                  (a, b) =>
                    (parseInt(a.number, 10) || 999) - (parseInt(b.number, 10) || 999)
                )
                .map((player) => (
                  <div key={player.id} className="roster-row">
                    <div className="roster-left">
                      <span className="roster-badge">#{player.number}</span>
                      <div>
                        <div className="roster-name">{player.name}</div>
                        <div className="roster-meta">
                          {player.position || '-'} / {player.grade || '-'}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn-icon-danger"
                      onClick={() => handleRemovePlayer(player)}
                      aria-label={`${player.name}を削除`}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
            </div>
          </section>

          <section className="portal-card">
            <div className="block-title-row">
              <ShieldCheck size={18} className="accent-icon" />
              <h3>ログイン許可メンバー（Googleメール）</h3>
            </div>
            <p className="table-helper-text">
              ここに登録したGoogleメールアドレスの部員だけが、ログインして動画やスタッツを見られます。
            </p>
            <form onSubmit={handleAddAllowedEmail} className="inline-input-btn">
              <div className="input-with-icon flex-1">
                <Mail size={16} />
                <input
                  type="email"
                  className="portal-input"
                  value={newAllowedEmail}
                  onChange={(e) => setNewAllowedEmail(e.target.value)}
                  placeholder="member@gmail.com"
                />
              </div>
              <button type="submit" className="btn-accent btn-sm">
                <Plus size={15} /> 追加
              </button>
            </form>

            <div className="roster-list">
              {Array.from(
                new Set([
                  ...data.ownerEmails.map((em) => em.trim().toLowerCase()),
                  ...data.allowedEmails.map((em) => em.trim().toLowerCase()),
                ])
              ).map((email) => {
                const isOwner = data.ownerEmails.some(
                  (em) => em.trim().toLowerCase() === email
                );
                const isSelf =
                  currentUserEmail &&
                  currentUserEmail.trim().toLowerCase() === email;
                return (
                  <div key={email} className="roster-row">
                    <div className="allowed-email-info">
                      <span className="allowed-email-text">{email}</span>
                      <div className="allowed-badges">
                        {isOwner && <span className="owner-badge">管理者</span>}
                        {isSelf && <span className="self-badge">ログイン中</span>}
                      </div>
                    </div>
                    {!isOwner && (
                      <button
                        type="button"
                        className="btn-icon-danger"
                        onClick={() => handleRemoveAllowedEmail(email)}
                        aria-label={`${email}の許可を削除`}
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      )}

      {/* ================================================= */}
      {/* ④ 設定                                            */}
      {/* ================================================= */}
      {subTab === 'settings' && (
        <div className="portal-section-stack">
          <section className="portal-card">
            <h3 className="block-subtitle">チーム名の変更</h3>
            <form onSubmit={handleSaveTeamName} className="inline-input-btn">
              <input
                type="text"
                className="portal-input flex-1"
                value={teamNameInput}
                onChange={(e) => setTeamNameInput(e.target.value)}
              />
              <button type="submit" className="btn-accent btn-sm">
                <Save size={15} /> 保存
              </button>
            </form>
          </section>

          <section className="portal-card">
            <h3 className="block-subtitle">練習タグの追加</h3>
            <form onSubmit={handleAddTag} className="inline-input-btn">
              <input
                type="text"
                className="portal-input flex-1"
                value={newTagInput}
                onChange={(e) => setNewTagInput(e.target.value)}
                placeholder="例：#ゾーンプレス"
              />
              <button type="submit" className="btn-accent btn-sm">
                <Plus size={15} /> 追加
              </button>
            </form>
            <div className="chip-wrap top-gap">
              {data.practiceTags.map((t) => (
                <span key={t} className="tag-pill">
                  {t}
                </span>
              ))}
            </div>
          </section>

          <section className="portal-card">
            <h3 className="block-subtitle">管理者PINの変更（4桁数字）</h3>
            <form onSubmit={handleChangePin} className="inline-input-btn">
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                className="portal-input flex-1"
                value={newPinInput}
                onChange={(e) => setNewPinInput(e.target.value)}
                placeholder="新しい4桁の数字"
              />
              <button type="submit" className="btn-accent btn-sm">
                変更
              </button>
            </form>
          </section>

          <section className="portal-card">
            <h3 className="block-subtitle">登録済み 試合・練習の削除</h3>
            <p className="table-helper-text">
              不要になった試合や練習動画を1件ずつ削除できます。
            </p>

            {data.games.length === 0 && data.practices.length === 0 ? (
              <div className="empty-box">登録済みの試合・練習はまだありません</div>
            ) : (
              <div className="portal-section-stack">
                {[
                  {
                    key: 'games',
                    caption: `試合（${data.games.length}件）`,
                    rows: [...data.games]
                      .sort((a, b) => b.date.localeCompare(a.date))
                      .map((game) => ({
                        id: game.id,
                        primary: `${game.date} vs ${game.opponent}`,
                        secondary: game.title,
                        ariaLabel: `${game.title}を削除`,
                        onRemove: () => handleRemoveGame(game),
                      })),
                  },
                  {
                    key: 'practices',
                    caption: `練習動画（${data.practices.length}件）`,
                    rows: [...data.practices]
                      .sort((a, b) => b.date.localeCompare(a.date))
                      .map((practice) => ({
                        id: practice.id,
                        primary: practice.title,
                        secondary: practice.date,
                        ariaLabel: `${practice.title}を削除`,
                        onRemove: () => handleRemovePractice(practice),
                      })),
                  },
                ]
                  .filter((section) => section.rows.length > 0)
                  .map((section) => (
                    <div key={section.key} className="roster-list">
                      <div className="field-caption">{section.caption}</div>
                      {section.rows.map((row) => (
                        <div key={row.id} className="roster-row">
                          <div className="allowed-email-info">
                            <span className="roster-name">{row.primary}</span>
                            <span className="roster-meta">{row.secondary}</span>
                          </div>
                          <button
                            type="button"
                            className="btn-icon-danger"
                            onClick={row.onRemove}
                            aria-label={row.ariaLabel}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      ))}
                    </div>
                  ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
