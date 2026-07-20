import React, { useEffect, useState } from 'react';

// ────────────────────────────────────────────────────────────────────────
// src/components/LicenseGate.jsx (2026-07-13 신규, 2026-07-20 정책 변경)
// 라이선스 키가 없거나(hasKey:false) 문제(만료 / 서명 무효 / 다른 기기에
// 등록됨 / 시스템 시간 조작 감지)가 있을 때 전체 앱 대신 이 안내 화면을
// 보여주고, 여기서 키를 등록하기 전까지는 다른 어떤 화면(사이드바 메뉴
// 포함)에도 접근할 수 없다.
//
// 2026-07-20 변경: 원래는 "키를 아예 넣지 않은 경우는 스탠다드로 계속
// 쓸 수 있어야 한다"는 설계였으나(예전 주석/의도는 git 이력 참고),
// 사용자가 "라이선스 키 등록 전에는 아무것도 작동하면 안 되고, 등록
// 전까지는 이 화면 외 다른 곳으로 못 가야 한다"고 정책을 명확히 확정 —
// hasKey:false도 이제 차단 대상에 포함. 별도 팝업/네비게이션 제한 대신
// 기존 전체화면 차단 방식을 그대로 재사용(사용자 선택) — 사이드바 자체가
// 렌더링되지 않으므로 자연히 다른 섹션으로 이동할 방법이 없고, 이 화면
// 안의 입력창에서 바로 키를 등록한다.
//
// 개발 모드(main.js의 isDev)에서는 getLicenseStatus()가 항상
// devBypass:true를 함께 내려주므로, 개발 중에는 이 잠금이 적용되지
// 않는다(사용자가 명시적으로 원한 예외 — 개발 중엔 키 없이 자유롭게
// 테스트해야 함). 배포판에서는 devBypass가 항상 false라 이 예외 자체가
// 존재하지 않는다.
//
// 확인이 끝나기 전(status === undefined)에는 기존 화면을 그대로 보여준다
// — 확인 자체가 매우 빨라(로컬 검증) 체감 지연이 거의 없고, 확인이 끝난
// 뒤 곧바로 차단 화면으로 전환된다.
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

  // 2026-07-20: !status.hasKey(키 미등록)도 차단 대상에 포함. devBypass만
  // 예외로 통과시킨다(개발 모드 전용, 배포판에서는 항상 false).
  const blocked = !!(status && !status.devBypass && (!status.hasKey || !status.valid));
  if (!blocked) return children;

  const handleApply = async () => {
    setApplying(true);
    setMsg(null);
    const res = await window.electronAPI.license.set(keyInput);
    setApplying(false);
    if (res.success) {
      setStatus(res.status);
      if (!res.status.hasKey || !res.status.valid) {
        setMsg(res.status.reason || '라이선스를 다시 확인해주세요.');
      }
    } else {
      setMsg(res.error || '라이선스 적용에 실패했습니다.');
    }
  };

  const heading = status.hasKey ? '라이선스 확인이 필요합니다' : '라이선스 등록이 필요합니다';
  const reasonText = status.hasKey
    ? (status.reason || '등록된 라이선스에 문제가 있습니다.')
    : '이 프로그램을 사용하려면 라이선스 키를 등록해야 합니다.';

  return (
    <div className="license-gate">
      <div className="license-gate-box">
        <div className="license-gate-icon">🔒</div>
        <h1>{heading}</h1>
        <p className="license-gate-reason">{reasonText}</p>
        <div className="license-gate-input-row">
          <input
            type="text"
            className="input"
            value={keyInput}
            onChange={e => setKeyInput(e.target.value)}
            placeholder="라이선스 키를 입력하세요"
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
