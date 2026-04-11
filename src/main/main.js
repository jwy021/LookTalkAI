const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { generateGeminiResponse } = require('./geminiService'); // 분리한 모듈 불러오기

// 환경 변수 로드
const envPath = path.join(__dirname, '../../.env'); // 경로 수정 (main.js 위치 기준)
if (fs.existsSync(envPath)) {
  const envLines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of envLines) {
    const [key, ...val] = line.split('=');
    if (key && val) process.env[key.trim()] = val.join('=').trim();
  }
}

let win;
const configPath = path.join(app.getPath('userData'), 'window-bounds.json');

// 마이크 및 최적화 설정
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows', 'true');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,WindowOcclusionPrediction');

// AI 요청 IPC 핸들러
ipcMain.handle('process-ai-request', async (_event, { type, data, mimeType, personality }) => {
  try {
    let parts = [];
    if (type === 'text') {
      parts.push({ text: data });
    } else if (type === 'audio') {
      parts.push({ inlineData: { mimeType: mimeType || 'audio/webm', data: data } });
      parts.push({ text: "이 음성을 듣고 적절하게 대답해줘." });
    }
    const reply = await generateGeminiResponse(parts, personality);
    return { ok: true, reply };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

function createWindow() {
  let savedBounds = {};
  if (fs.existsSync(configPath)) {
    try { savedBounds = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch (e) { }
  }

  win = new BrowserWindow({
    width: 220, height: 350,
    x: savedBounds.x, y: savedBounds.y,
    transparent: true, frame: false, alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: false,    // [보안강화] 직접 Node.js 사용 금지
      contextIsolation: true,    // [보안강화] 메인과 렌더러 환경 완전 분리
      preload: path.join(__dirname, 'preload.js') // [보안강화] 우리가 만든 다리 연결
    }
  });

  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setAlwaysOnTop(true, 'screen-saver');

  // HTML 로드 경로 수정 (renderer 폴더 바라보게)
  win.loadFile(path.join(__dirname, '../renderer/index.html'));

  ipcMain.on('window-drag', (event, { mouseX, mouseY }) => {
    const { x, y } = screen.getCursorScreenPoint();
    win.setPosition(x - mouseX, y - mouseY);
  });

  ipcMain.on('resize-window', (event, { width, height }) => {
    if (win && !win.isDestroyed()) {
      win.setSize(width, height, false);
    }
  });

  ipcMain.on('close-app', () => {
    app.quit();
  });

  const saveWindowPosition = () => {
    const bounds = win.getBounds();
    fs.writeFileSync(configPath, JSON.stringify(bounds));
  };
  win.on('moved', saveWindowPosition);
  win.on('close', saveWindowPosition);

  // 마우스 위치를 추적해서 프론트엔드로 쏴주는 로직
  setInterval(() => {
    if (win && !win.isDestroyed()) {
      const cursor = screen.getCursorScreenPoint();
      const bounds = win.getBounds();
      // 창 기준 상대 좌표로 계산해서 보냄
      win.webContents.send('mouse-move-external', {
        x: cursor.x - bounds.x,
        y: cursor.y - bounds.y
      });
    }
  }, 50);
}

app.whenReady().then(createWindow);