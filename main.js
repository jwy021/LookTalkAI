const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

let win; // 창 객체를 전역 변수로 선언

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
    width: 150,
    height: 150,
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

// 윈도우에서 가상 데스크톱 이동 시 창이 사라지는 현상 방지
app.commandLine.appendSwitch('disable-features', 'WindowOcclusionPrediction');

app.whenReady().then(createWindow);