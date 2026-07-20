import { useState } from 'react';
import { api, ApiError } from './api';

interface Props {
  purpose: 'consumer' | 'chef';
  title: string;
  subtitle: string;
  onSuccess: () => void;
}

export function OtpLogin({ purpose, title, subtitle, onSuccess }: Props) {
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [masked, setMasked] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function sendOtp() {
    setBusy(true);
    setError('');
    try {
      const res = await api.requestOtp(phone, purpose);
      setMasked(res.phoneMasked);
      setStep('code');
      setCode('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not send the OTP. Please retry.');
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    setError('');
    try {
      await api.verifyOtp(phone, purpose, code);
      onSuccess();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Verification failed. Please retry.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="otp-card">
      <h2>{title}</h2>
      <p className="muted">{subtitle}</p>
      {step === 'phone' ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void sendOtp();
          }}
        >
          <label htmlFor="otp-phone">Mobile number</label>
          <input
            id="otp-phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            placeholder="10-digit Indian mobile"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />
          {error && <p className="error" role="alert">{error}</p>}
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? 'Sending…' : 'Send OTP'}
          </button>
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void verify();
          }}
        >
          <p className="muted">
            An OTP was sent to <strong>{masked}</strong>. It expires in 5 minutes.
          </p>
          <label htmlFor="otp-code">One-time password</label>
          <input
            id="otp-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{4,8}"
            placeholder="6-digit code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
          />
          {error && <p className="error" role="alert">{error}</p>}
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? 'Verifying…' : 'Verify & continue'}
          </button>
          <button
            className="btn ghost"
            type="button"
            disabled={busy}
            onClick={() => {
              setStep('phone');
              setError('');
            }}
          >
            Change number
          </button>
        </form>
      )}
    </div>
  );
}
