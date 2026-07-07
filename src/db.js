const path = require('path');
const { app } = require('electron');

let db = null;

function getDB() {
  if (db) return db;

  const Database = require('better-sqlite3');
  const dbPath = path.join(app.getPath('userData'), 'accounts.db');

  db = new Database(dbPath);

  // WAL 모드: 성능 향상
  db.pragma('journal_mode = WAL');

  // 외래키 강제(foreign_keys) 활성화 (2026-07-05 추가)
  // SQLite는 이 옵션이 커넥션마다 기본 OFF라서, research_items의
  // "FOREIGN KEY (keyword_id) ... ON DELETE CASCADE" 선언이 있어도
  // 지금까지 실제로는 적용되지 않고 있었음 — 키워드를 삭제해도 연결된
  // 글감(research_items)이 안 지워지고 고아 행으로 남아, 같은 키워드를
  // 재등록 후 재수집하면 URL 중복으로 판정돼 "신규 0개"로 잘못 집계되는
  // 원인이었음. 이 옵션을 켜야 위 CASCADE 선언이 실제로 동작함.
  db.pragma('foreign_keys = ON');

  db.prepare(`
    CREATE TABLE IF NOT EXISTS accounts (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      naver_id          TEXT    NOT NULL UNIQUE,
      nickname          TEXT    NOT NULL DEFAULT '',
      memo              TEXT    NOT NULL DEFAULT '',
      cookies_encrypted TEXT    NOT NULL DEFAULT '',
      last_login        TEXT    NOT NULL DEFAULT '',
      status            TEXT    NOT NULL DEFAULT 'active'
    )
  `).run();

  // 발행 이력 & 스케줄 테이블
  db.prepare(`
    CREATE TABLE IF NOT EXISTS posts (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id   INTEGER,
      naver_id     TEXT    NOT NULL DEFAULT '',
      title        TEXT    NOT NULL DEFAULT '',
      content_json TEXT    NOT NULL DEFAULT '{}',
      hashtags     TEXT    NOT NULL DEFAULT '[]',
      images_json  TEXT    NOT NULL DEFAULT '[]',
      status       TEXT    NOT NULL DEFAULT 'draft',
      scheduled_at TEXT    DEFAULT NULL,
      published_at TEXT    DEFAULT NULL,
      post_url     TEXT    NOT NULL DEFAULT '',
      error_msg    TEXT    NOT NULL DEFAULT '',
      created_at   TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
    )
  `).run();

  // 글감 수집 키워드 테이블
  db.prepare(`
    CREATE TABLE IF NOT EXISTS research_keywords (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword          TEXT    NOT NULL,
      category         TEXT    NOT NULL DEFAULT '',
      interval_hours   INTEGER NOT NULL DEFAULT 24,
      last_collected_at TEXT   DEFAULT NULL,
      active           INTEGER NOT NULL DEFAULT 1,
      created_at       TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
    )
  `).run();

  // 마이그레이션: posts 테이블 컬럼 추가 (기존 DB 호환)
  try { db.prepare("ALTER TABLE posts ADD COLUMN category       TEXT NOT NULL DEFAULT ''").run(); } catch(_){}
  try { db.prepare("ALTER TABLE posts ADD COLUMN visibility     TEXT NOT NULL DEFAULT 'public'").run(); } catch(_){}
  try { db.prepare("ALTER TABLE posts ADD COLUMN auto_thumbnail INTEGER NOT NULL DEFAULT 0").run(); } catch(_){}

  // 마이그레이션: 기간 수집 컬럼 추가 (기존 DB 호환)
  try { db.prepare('ALTER TABLE research_keywords ADD COLUMN date_from TEXT DEFAULT NULL').run(); } catch(_){}
  try { db.prepare('ALTER TABLE research_keywords ADD COLUMN date_to   TEXT DEFAULT NULL').run(); } catch(_){}

  // 마이그레이션: 자동화 루프 관련 컬럼 추가 (2026-07-05 신규)
  // - accounts.loop_enabled: 계정별로 자동화 루프 대상에서 포함/제외할지 토글 (기본 포함)
  // - posts.source: 이 글이 어떻게 생성됐는지 구분 ('' = 수동, 'loop_auto' = 완전자동, 'loop_semi' = 반자동 검수대기)
  try { db.prepare('ALTER TABLE accounts ADD COLUMN loop_enabled INTEGER NOT NULL DEFAULT 1').run(); } catch(_){}
  try { db.prepare("ALTER TABLE posts ADD COLUMN source TEXT NOT NULL DEFAULT ''").run(); } catch(_){}

  // 마이그레이션: 계정별 자동화 루프 카테고리 배정 (2026-07-05 추가)
  // 비어있으면(기본값) 카테고리 제한 없이 전체 글감 풀에서 선택(기존 동작과 동일).
  // 값이 있으면 그 카테고리에 속한 키워드들의 글감만 사용 — 계정 간 콘텐츠
  // 중복/유사 위험을 낮추기 위한 2번째 안전장치.
  try { db.prepare("ALTER TABLE accounts ADD COLUMN loop_category TEXT NOT NULL DEFAULT ''").run(); } catch(_){}

  // 마이그레이션: 계정별 네이버 블로그 발행 카테고리 (2026-07-06 추가)
  // loop_category(글감 카테고리 필터)와는 별개 — 이 값은 자동화 루프가
  // 완전자동 발행 시 실제 네이버 블로그의 어떤 카테고리로 발행할지를
  // 지정한다. 비어있으면(기본값) 기존과 동일하게 카테고리를 지정하지
  // 않고 발행(그 블로그에 마지막으로 선택돼 있던 카테고리/기본값 유지).
  try { db.prepare("ALTER TABLE accounts ADD COLUMN naver_category TEXT NOT NULL DEFAULT ''").run(); } catch(_){}

  // 계정별 추가 배정/네이버 카테고리 쌍 (2026-07-06 신규, 파일럿: skysmoga
  // 계정만 UI 노출) — 기존 accounts.loop_category/naver_category는 그대로
  // "1번째 쌍"으로 유지하고, 이 테이블은 2~5번째 쌍(계정당 최대 4개 추가)을
  // 저장한다. 자동화 루프는 이 쌍들을 순서대로 라운드로빈하며 글감을 찾는다.
  // foreign_keys=ON(위에서 이미 설정)이라 계정 삭제 시 CASCADE로 함께 삭제됨.
  db.prepare(`
    CREATE TABLE IF NOT EXISTS account_category_pairs (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id     INTEGER NOT NULL,
      sort_order     INTEGER NOT NULL DEFAULT 0,
      loop_category  TEXT    NOT NULL DEFAULT '',
      naver_category TEXT    NOT NULL DEFAULT '',
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    )
  `).run();

  // 마이그레이션: posts.memo (2026-07-07 신규)
  // 완전자동 발행 직전 썸네일/이미지/본문/관련 사이트 중 하나라도 누락되면
  // 발행하지 않고 검수 대기(status='review')로 돌리면서, 왜 여기로 왔는지
  // 사용자가 바로 알 수 있도록 남기는 안내 메모. 정상 발행/반자동 초안은
  // 빈 문자열 유지(기존 동작에 영향 없음).
  try { db.prepare("ALTER TABLE posts ADD COLUMN memo TEXT NOT NULL DEFAULT ''").run(); } catch(_){}

  // 수집된 글감 테이블
  db.prepare(`
    CREATE TABLE IF NOT EXISTS research_items (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword_id   INTEGER NOT NULL,
      keyword_text TEXT    NOT NULL DEFAULT '',
      title        TEXT    NOT NULL DEFAULT '',
      summary      TEXT    NOT NULL DEFAULT '',
      url          TEXT    NOT NULL DEFAULT '',
      source       TEXT    NOT NULL DEFAULT 'naver',
      collected_at TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
      used         INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (keyword_id) REFERENCES research_keywords(id) ON DELETE CASCADE
    )
  `).run();

  // 일회성 정리(2026-07-05 추가): foreign_keys=ON을 이번에 처음 켰기 때문에,
  // 그 전에 키워드 삭제로 이미 고아가 된 research_items 행이 남아있을 수
  // 있음 — 한 번만 정리(이후로는 위 CASCADE가 자동으로 처리하므로 반복 불필요).
  try {
    db.prepare(
      'DELETE FROM research_items WHERE keyword_id NOT IN (SELECT id FROM research_keywords)'
    ).run();
  } catch (_) {}

  return db;
}

module.exports = { getDB };
