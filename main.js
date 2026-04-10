const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

let win; // 창 객체를 전역 변수로 선언

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

async function generateAiReply(userText) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

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
              text: '너는 짧고 자연스러운 한국어로 답하는 데스크톱 비서다. 한두 문장 이내로 간결하게 답해라.'
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
          maxOutputTokens: 120
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
    width: 240,
    height: 300,
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
  win.on('close', saveWindowPosition);
}

ipcMain.handle('generate-ai-response', async (_event, userText) => {
  // 한글 입력이 비어 있으면 불필요한 호출을 막음
  const normalizedText = typeof userText === 'string' ? userText.trim() : '';

  if (!normalizedText) {
    return { ok: false, error: '전송할 음성 텍스트가 없습니다.' };
  }

  try {
    const reply = await generateAiReply(normalizedText);
    return { ok: true, reply };
  } catch (error) {
    console.error('❌ AI 응답 생성 실패:', error);
    return { ok: false, error: error.message || 'AI 응답 생성에 실패했습니다.' };
  }
});

// 윈도우에서 가상 데스크톱 이동 시 창이 사라지는 현상 방지
app.commandLine.appendSwitch('disable-features', 'WindowOcclusionPrediction');

app.whenReady().then(createWindow);
