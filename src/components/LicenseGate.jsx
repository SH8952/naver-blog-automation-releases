import React, { useEffect, useState } from 'react';

// ────────────────────────────────────────────────────────────────────────
// src/components/LicenseGate.jsx (2026-07-13 신규)
// 라이선스 키가 "있는데" 문제(만료 / 서명 무효 / 다른 기기에 등록됨 /
// 시스템 시간 조작 감지)가 있을 때만 전체 앱 대신 이 안내 화면을 보여준다.
// 키를 아예 넣지 않은 경우는 차단 대상이 아니다 — 지금처럼 스탠다드로
// 계속 사용할 수 있어야 하므로 그대로 통과시킨다.
//
// 개발 모드(main.js의 isDev)에서는 getLicenseStatus()가 항상
// devBypass:true를 함께 내려주므로, 작업 중 실수로 개발자 본인이 막히는
// 일이 없다.
//
// 확인이 끝나기 전(status === undefined)에는 기존 화면을 그대로 보여준다
// — 키가 없거나 정상인 절대다수 사용자는 이 지연을 체감할 일이 없고
// (그 경로는 즉시 반환됨), 문제가 있는 소수의 경우에만 확인이 끝난 뒤
// 차단 화면으로 전환된다.
// ────────────────────────────────────────────────────────────────────────

export default function LicenseGate({ children }) {
  const [status, setStatus] = useState(undefined); // undefined: 확인 중
  const [keyInput, setKeyInput] = useState('');
  const [applying, setApplying] = useState(false);
  const [msg, setMsg] = useState(null);

  const check = () => {
    if (!window.electronAPI || !window.electronAPI.license) {
      // preload 브리지가 없는 예외적인 상황(브라우저 프리뷰 등) — 차단하지 않음
      setStatus(null);
      return;
    }
    window.electronAPI.license.get()
      .then(res => setStatus(res.success ? res.status : null))
      .catch(() => setStatus(null));
  };

  useEffect(() => { check(); }, []);

  if (status === undefined) return children;

  const blocked = !!(status && status.hasKey && !status.valid && !status.devBypass);
  if (!blocked) return children;

  const handleApply = async () => {
    setApplying(true);
    setMsg(null);
    const res = await window.electronAPI.license.set(keyInput);
    setApplying(false);
    if (res.success) {
      setStatus(res.status);
      if (res.status.hasKey && !res.status.valid) {
        setMsg(res.status.reason || '라이선스를 다시 확인해주세요.');
      }
    } else {
      setMsg(res.error || '라이선스 적용에 실패했습니다.');
    }
  };

  return (
    <div className="license-gate">
      <div className="license-gate-box">
        <div className="license-gate-icon">🔒</div>
        <h1>라이선스 확인이 필요합니다</h1>
        <p className="license-gate-reason">{status.reason || '등록된 라이선스에 문제가 있습니다.'}</p>
        <div className="license-gate-input-row">
          <input
            type="text"
            className="input"
            value={keyInput}
            onChange={e => setKeyInput(e.target.value)}
            placeholder="새 라이선스 키를 입력하세요"
            autoFocus
          />
          <button className="btn btn-primary" onClick={handleApply} disabled={applying || !keyInput.trim()}>
            {applying ? '적용 중…' : '적용'}
          </button>
        </div>
        {msg && <div className="license-gate-msg">{msg}</div>}
        <button className="license-gate-retry" onClick={check}>다시 확인</button>
      </div>
    </div>
  );
}
