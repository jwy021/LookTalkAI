const { app, BrowserWindow, ipcMain, screen } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

let win; // 창 객체를 전역 변수로 선언
let cursorPollTimerId = null;
let googleAccessTokenCache = null;
let googleAccessTokenExpiresAt = 0;
let googleQuotaProjectId = null;
let isHistoryDrawerOpen = false;
let isSettingsPanelOpen = false;
const collapsedWindowWidth = 220;
const expandedSettingsWindowWidth = 460;
const collapsedWindowHeight = 350;
const expandedWindowHeight = 540;
const expandedSettingsWindowHeight = 680;

function loadEnvFile() {
  const envPath = path.join(__dirname, '.env');

  if (!fs.existsSync(envPath)) {
    return;
  }

  const envLines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);

  for (const rawLine of envLines) {
    const line = rawLine.trim();

    // 한글 주석과 빈 줄은 건너뜀
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');

    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (!key || process.env[key]) {
      continue;
    }

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

loadEnvFile();

const geminiModel = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite-preview';
const googleSpeechLanguageCode = process.env.GOOGLE_SPEECH_LANGUAGE_CODE || 'ko-KR';
const personalityPrompts = {
  calm: '차분하고 안정적인 말투로 답해라.',
  bright: '발랄하고 친근한 말투로 답해라.',
  tsundere: '조금 시크하지만 밉지 않은 말투로 답해라.',
  assistant: '정돈된 프로 비서 톤으로 답해라.'
};
const responseLengthConfigs = {
  short: {
    prompt: '한 문장 또는 아주 짧은 두 문장으로 답해라.',
    maxTokens: 90
  },
  medium: {
    prompt: '짧은 두세 문장 안에서 자연스럽게 답해라.',
    maxTokens: 160
  }
};

function toBase64Url(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function getGoogleApplicationDefaultCredentials() {
  const adcPathFromEnv = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const defaultAdcPath = path.join(
    os.homedir(),
    '.config',
    'gcloud',
    'application_default_credentials.json'
  );
  const credentialsPath = adcPathFromEnv || defaultAdcPath;

  if (!fs.existsSync(credentialsPath)) {
    throw new Error(
      'Application Default Credentials 파일을 찾지 못했습니다. `gcloud auth application-default login`을 먼저 실행하세요.'
    );
  }

  const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
  googleQuotaProjectId = credentials.quota_project_id || process.env.GOOGLE_CLOUD_QUOTA_PROJECT || null;
  return credentials;
}

async function getGoogleAccessToken() {
  const now = Date.now();

  if (googleAccessTokenCache && now < googleAccessTokenExpiresAt) {
    return googleAccessTokenCache;
  }

  const credentials = getGoogleApplicationDefaultCredentials();
  let tokenResponse;

  if (credentials.type === 'authorized_user') {
    tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        client_id: credentials.client_id,
        client_secret: credentials.client_secret,
        refresh_token: credentials.refresh_token,
        grant_type: 'refresh_token'
      })
    });
  } else if (credentials.type === 'service_account') {
    const issuedAt = Math.floor(now / 1000);
    const expiresAt = issuedAt + 3600;
    const header = toBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claimSet = toBase64Url(JSON.stringify({
      iss: credentials.client_email,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: 'https://oauth2.googleapis.com/token',
      exp: expiresAt,
      iat: issuedAt
    }));
    const unsignedToken = `${header}.${claimSet}`;
    const signature = crypto
      .createSign('RSA-SHA256')
      .update(unsignedToken)
      .sign(credentials.private_key, 'base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');

    tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${unsignedToken}.${signature}`
      })
    });
  } else {
    throw new Error(`지원하지 않는 ADC 자격 증명 타입입니다: ${credentials.type}`);
  }

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text();
    throw new Error(`Google OAuth 토큰 발급 실패 (${tokenResponse.status}): ${errorText}`);
  }

  const tokenData = await tokenResponse.json();
  googleAccessTokenCache = tokenData.access_token;
  googleAccessTokenExpiresAt = now + Math.max((tokenData.expires_in - 60) * 1000, 0);

  return googleAccessTokenCache;
}

function extractTranscript(data) {
  const results = Array.isArray(data?.results) ? data.results : [];

  return results
    .map((result) => result?.alternatives?.[0]?.transcript || '')
    .join(' ')
    .trim();
}

async function transcribeAudioWithGoogle({ audioBase64, mimeType }) {
  if (!audioBase64) {
    throw new Error('전사할 오디오 데이터가 없습니다.');
  }

  const accessToken = await getGoogleAccessToken();
  const response = await fetch('https://speech.googleapis.com/v1/speech:recognize', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(googleQuotaProjectId ? { 'x-goog-user-project': googleQuotaProjectId } : {})
    },
    body: JSON.stringify({
      config: {
        encoding: mimeType?.includes('webm') ? 'WEBM_OPUS' : 'LINEAR16',
        sampleRateHertz: 48000,
        languageCode: googleSpeechLanguageCode,
        enableAutomaticPunctuation: true,
        model: 'latest_short'
      },
      audio: {
        content: audioBase64
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Google STT 호출 실패 (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const transcript = extractTranscript(data);

  if (!transcript) {
    throw new Error('Google STT 응답에서 전사 텍스트를 찾지 못했습니다.');
  }

  console.log('[STT][OUTPUT]', transcript);

  return transcript;
}

function extractResponseText(data) {
  const parts = data?.candidates?.[0]?.content?.parts;

  if (!Array.isArray(parts)) {
    return '';
  }

  return parts
    .map((part) => part?.text || '')
    .join('')
    .trim();
}

async function generateAiReply(userText, personality = 'calm', responseLength = 'short') {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  const personalityPrompt = personalityPrompts[personality] || personalityPrompts.calm;
  const lengthConfig = responseLengthConfigs[responseLength] || responseLengthConfigs.short;

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY 환경 변수가 설정되지 않았습니다.');
  }

  // LLM으로 보내는 실제 입력값을 디버그 콘솔에 기록
  console.log('[LLM][INPUT]', userText);

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              // 성격과 답변 길이를 함께 프롬프트에 반영한다.
              text: `너는 짧고 자연스러운 한국어로 답하는 데스크톱 비서다. ${personalityPrompt} ${lengthConfig.prompt}`
            }
          ]
        },
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: userText
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: lengthConfig.maxTokens
        }
      })
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API 호출 실패 (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const replyText = extractResponseText(data);

  if (!replyText) {
    throw new Error('Gemini 응답에서 텍스트를 찾지 못했습니다.');
  }

  // LLM이 반환한 실제 출력값을 디버그 콘솔에 기록
  console.log('[LLM][OUTPUT]', replyText);

  return replyText;
}

function updateWindowBounds() {
  if (!win || win.isDestroyed()) {
    return;
  }

  const bounds = win.getBounds();
  const nextWidth = isSettingsPanelOpen ? expandedSettingsWindowWidth : collapsedWindowWidth;
  const nextHeight = Math.max(
    collapsedWindowHeight,
    isHistoryDrawerOpen ? expandedWindowHeight : collapsedWindowHeight,
    isSettingsPanelOpen ? expandedSettingsWindowHeight : collapsedWindowHeight
  );
  const nextX = bounds.x - Math.round((nextWidth - bounds.width) / 2);

  win.setBounds({
    ...bounds,
    x: nextX,
    width: nextWidth,
    height: nextHeight
  });
}

function createWindow() {
  // 1. 좌표를 저장할 파일의 경로 설정 (컴퓨터의 안전한 사용자 데이터 폴더에 저장됨)
  const configPath = path.join(app.getPath('userData'), 'window-bounds.json');
  let savedBounds = {};

  // 2. 이전에 저장해 둔 좌표 파일이 있다면 읽어오기
  try {
    if (fs.existsSync(configPath)) {
      savedBounds = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (e) {
    console.log('이전 위치 정보를 불러오지 못했습니다.');
  }

  // 3. 창 생성 (저장된 x, y 좌표가 있으면 적용하고, 없으면 기본값으로 화면 가운데 띄움)
  win = new BrowserWindow({
    width: collapsedWindowWidth,
    height: collapsedWindowHeight,
    x: savedBounds.x,  // ⭐️ 불러온 X 좌표
    y: savedBounds.y,  // ⭐️ 불러온 Y 좌표
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });

  // 모든 가상 데스크톱(워크스페이스)에 창을 표시함
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // 윈도우 OS 특성상 가끔 적용이 안 될 때를 대비한 보조 설정
  win.setAlwaysOnTop(true, 'screen-saver');

  win.loadFile('src/index.html');

  // 창이 완전히 준비된 후 다시 한번 위치 고정 명령 (윈도우 버그 방지)
  win.once('ready-to-show', () => {
    win.show();
  });

  // 4. 창을 드래그해서 위치를 옮기거나, 앱을 끌 때 현재 좌표를 파일에 저장
  const saveWindowPosition = () => {
    const bounds = win.getBounds(); // 현재 창의 x, y, width, height 가져오기
    fs.writeFileSync(configPath, JSON.stringify(bounds));
  };

  win.on('moved', saveWindowPosition);
  win.on('close', () => {
    saveWindowPosition();
    if (cursorPollTimerId) {
      clearInterval(cursorPollTimerId);
      cursorPollTimerId = null;
    }
  });

  // 5. 전역 커서 위치를 30fps로 폴링해서 렌더러에 전달 (투명 창 밖에서도 눈 추적 가능)
  cursorPollTimerId = setInterval(() => {
    if (win.isDestroyed()) {
      clearInterval(cursorPollTimerId);
      return;
    }

    const cursor = screen.getCursorScreenPoint();
    const bounds = win.getBounds();

    // 스크린 좌표를 창 로컬 좌표로 변환
    win.webContents.send('cursor-position', {
      x: cursor.x - bounds.x,
      y: cursor.y - bounds.y
    });
  }, 33); // ~30fps
}

ipcMain.on('set-history-drawer-open', (_event, isOpen) => {
  isHistoryDrawerOpen = isOpen;
  updateWindowBounds();
});

ipcMain.on('set-settings-panel-open', (_event, isOpen) => {
  isSettingsPanelOpen = isOpen;
  updateWindowBounds();
});

ipcMain.handle('generate-ai-response', async (_event, payload) => {
  // 한글 입력이 비어 있으면 불필요한 호출을 막음
  const normalizedText = typeof payload?.userText === 'string' ? payload.userText.trim() : '';
  const personality = typeof payload?.personality === 'string' ? payload.personality : 'calm';
  const responseLength = typeof payload?.responseLength === 'string' ? payload.responseLength : 'short';

  if (!normalizedText) {
    return { ok: false, error: '전송할 음성 텍스트가 없습니다.' };
  }

  try {
    const reply = await generateAiReply(normalizedText, personality, responseLength);
    return { ok: true, reply };
  } catch (error) {
    console.error('❌ AI 응답 생성 실패:', error);
    return { ok: false, error: error.message || 'AI 응답 생성에 실패했습니다.' };
  }
});

ipcMain.handle('transcribe-audio', async (_event, payload) => {
  try {
    const transcript = await transcribeAudioWithGoogle(payload || {});
    return { ok: true, transcript };
  } catch (error) {
    console.error('❌ Google STT 전사 실패:', error);
    return { ok: false, error: error.message || 'Google STT 전사에 실패했습니다.' };
  }
});

// 윈도우에서 가상 데스크톱 이동 시 창이 사라지는 현상 방지
app.commandLine.appendSwitch('disable-features', 'WindowOcclusionPrediction');

app.whenReady().then(createWindow);
