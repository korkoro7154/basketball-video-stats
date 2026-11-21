import { useState } from 'react';
import { Delete, KeyRound, ShieldAlert } from 'lucide-react';

interface PinGateProps {
  expectedPin: string;
  onSuccess: () => void;
}

export function PinGate({ expectedPin, onSuccess }: PinGateProps) {
  const [digits, setDigits] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [shaking, setShaking] = useState(false);

  const handlePressDigit = (num: string) => {
    if (digits.length >= 4) return;
    const next = digits + num;
    setDigits(next);
    setErrorMsg('');

    if (next.length === 4) {
      if (next === expectedPin) {
        onSuccess();
      } else {
        setShaking(true);
        setErrorMsg('暗証番号が違います。もう一度お試しください。');
        window.setTimeout(() => {
          setShaking(false);
          setDigits('');
        }, 480);
      }
    }
  };

  const handleBackspace = () => {
    setDigits((prev) => prev.slice(0, -1));
    setErrorMsg('');
  };

  const handleClear = () => {
    setDigits('');
    setErrorMsg('');
  };

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

  return (
    <div className="pin-gate-wrap">
      <div className={`pin-gate-card ${shaking ? 'is-shaking' : ''}`}>
        <div className="pin-gate-icon">
          <KeyRound size={24} />
        </div>

        <h2 className="pin-gate-title">記録・管理者用 PIN入力</h2>
        <p className="pin-gate-desc">
          動画の追加やスタッツの記録・編集を行うには、マネージャー・顧問用の4桁PINを入力してください。
        </p>

        <div className="pin-dots" aria-label={`入力桁数 ${digits.length} / 4`}>
          {[0, 1, 2, 3].map((idx) => (
            <span
              key={idx}
              className={`pin-dot ${idx < digits.length ? 'is-filled' : ''}`}
            />
          ))}
        </div>

        {errorMsg ? (
          <div className="pin-error">
            <ShieldAlert size={14} />
            <span>{errorMsg}</span>
          </div>
        ) : (
          <div className="pin-hint">
            {expectedPin === '1234'
              ? '試作版の初期PIN：1234'
              : '設定済みの4桁PINを入力してください'}
          </div>
        )}

        <div className="pin-keypad">
          {keys.map((k) => (
            <button
              key={k}
              type="button"
              className="pin-key"
              onClick={() => handlePressDigit(k)}
            >
              {k}
            </button>
          ))}
          <button
            type="button"
            className="pin-key pin-key-sub"
            onClick={handleClear}
          >
            クリア
          </button>
          <button
            type="button"
            className="pin-key"
            onClick={() => handlePressDigit('0')}
          >
            0
          </button>
          <button
            type="button"
            className="pin-key pin-key-sub"
            onClick={handleBackspace}
            aria-label="1文字削除"
          >
            <Delete size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
