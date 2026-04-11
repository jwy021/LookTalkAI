import { ThemeManager } from './themeManager.js';
import { UIController } from './uiController.js';
import { HistoryManager } from './historyManager.js';
import { FaceTracker } from './faceTracker.js';
import { SpeechHandler } from './speechHandler.js';
import { ROBOT_STATE } from './constants.js'; // 상수 임포트 추가
import { AiClient } from './aiClient.js';
import { TtsService } from './ttsService.js';

const ui = new UIController();
const theme = new ThemeManager();
const history = new HistoryManager();
const video = document.getElementById('webcam');
const statusText = document.getElementById('status-text');
const robotFace = document.getElementById('robot-face');
const settingsPanel = document.getElementById('settings-panel');
const historyDrawer = document.getElementById('history-drawer');
const toggleHistoryButton = document.getElementById('toggle-history-button');
const widget = document.getElementById('widget');

let isAborted = false;
let isGeneratingResponse = false;
let isAppReady = false;
let appSettings = theme.loadSettings();

// ── 드래그 이동 및 설정 패널 클릭 감지 ──
let isDragging = false;
let dragStartX, dragStartY;
let hasMoved = false;

document.querySelectorAll('.drag-handle').forEach(handle => {
  handle.addEventListener('mousedown', (e) => {
    // 버튼이나 입력창 클릭 시에는 드래그 무시
    if (e.target.closest('button') || e.target.closest('input')) return;

    isDragging = true;
    hasMoved = false;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
  });
});

window.addEventListener('mousemove', (e) => {
  if (isDragging) {
    hasMoved = true;
    window.lookTalkAPI.dragWindow({ mouseX: dragStartX, mouseY: dragStartY });
  }
});

window.addEventListener('mouseup', (e) => {
  isDragging = false;
});

// ── 우클릭 종료 패널 (캐릭터 우클릭 시) ──
robotFace.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const confirmClose = confirm("LookTalk AI를 종료할까요?");
  if (confirmClose) {
    window.lookTalkAPI.closeApp();
  }
});

// ── UI 토글 시 크기 업데이트 호출 ──
robotFace.addEventListener('click', () => {
  if (!hasMoved) {
    settingsPanel.classList.toggle('hidden');
    historyDrawer.classList.add('hidden');
    updateSettingsUI();
    updateWindowSize(); // 크기 조절
  }
});

// ── 대화 기록(히스토리) 패널 열기 ──
toggleHistoryButton.addEventListener('click', () => {
  const isHidden = historyDrawer.classList.toggle('hidden');
  settingsPanel.classList.add('hidden'); // 설정창은 닫음

  if (!isHidden) history.render();
  updateWindowSize(); // 크기 조절
});

document.getElementById('clear-history-button').addEventListener('click', () => {
  history.clear();
});

// ── 입력 모드 및 버튼 텍스트 복구 ──
function setInputMode(show) {
  const inputRow = document.getElementById('input-row');
  const toggleBtn = document.getElementById('toggle-input-button');

  if (show) {
    if (speech.isRecording) {
      isAborted = true;
      speech.stop();
    }
    inputRow.classList.remove('hidden');
    toggleBtn.innerText = '닫기';
    setTimeout(() => document.getElementById('text-input').focus(), 10);
  } else {
    inputRow.classList.add('hidden');
    toggleBtn.innerText = '입력';
    toggleBtn.style.backgroundColor = ''; // 빨간색 해제
    document.getElementById('text-input').blur();
  }
}

// ── 음성 핸들러 설정 ──
const speech = new SpeechHandler(
  (base64, mime) => {
    if (isAborted) {
      isAborted = false;
      return;
    }
    requestAi({ type: 'audio', data: base64, mimeType: mime });
  },
  (isRecording) => {
    widget.classList.toggle('recording', isRecording);
    const toggleBtn = document.getElementById('toggle-input-button');

    if (isRecording) {
      ui.setRobotState(ROBOT_STATE.LISTENING);
      toggleBtn.innerText = '중단';
      toggleBtn.style.backgroundColor = '#f87171';
      statusText.innerText = '🎙️ 듣는 중...';
      statusText.style.color = '#4ade80';
    } else {
      if (!isGeneratingResponse) {
        ui.setRobotState(ROBOT_STATE.IDLE);
        statusText.innerText = '준비 완료';
        statusText.style.color = '#60a5fa';
      }
      // 6. 녹음이 끝나면 현재 텍스트창 상태에 맞춰 버튼 텍스트 강제 복구
      const isInputHidden = document.getElementById('input-row').classList.contains('hidden');
      toggleBtn.innerText = isInputHidden ? '입력' : '닫기';
      toggleBtn.style.backgroundColor = '';
    }
  },
  (rms) => ui.handleVolumeEffect(rms, speech.isRecording)
);

// ── AI 요청 함수 ──
async function requestAi(payload) {
  if (isGeneratingResponse) return;
  isGeneratingResponse = true;

  ui.setRobotState(ROBOT_STATE.THINKING);
  statusText.innerText = 'AI 생각 중...';
  statusText.style.color = '#facc15';

  if (payload.type === 'text') history.addMessage('user', payload.data, appSettings.historyPersistenceEnabled);

  // 💡 aiClient.js 에게 통신을 위임합니다.
  const personality = localStorage.getItem('looktalk.personality') || 'calm';
  const response = await AiClient.request(payload, personality);

  if (response.ok) {
    ui.setRobotState(ROBOT_STATE.HAPPY);
    ui.showBubble(response.reply, appSettings.bubbleDurationMs);
    history.addMessage('assistant', response.reply, appSettings.historyPersistenceEnabled);
    // AI가 말을 할 때 TTS로 읽어줍니다.
    TtsService.speak(response.reply, personality);
  } else {
    console.error("AI Response Error:", response.error);
    ui.setRobotState(ROBOT_STATE.ERROR);
    statusText.innerText = '응답 오류 발생';
    statusText.style.color = '#f87171';
  }

  isGeneratingResponse = false;
  if (!speech.isRecording) {
    setTimeout(() => {
      if (widget.getAttribute('data-state') !== ROBOT_STATE.HAPPY) {
        statusText.innerText = '준비 완료';
        statusText.style.color = '#60a5fa';
      }
    }, 3000);
  }
}

// ── 버튼 이벤트 리스너 연결 ──
document.getElementById('toggle-input-button').addEventListener('click', () => {
  if (speech.isRecording) {
    isAborted = true;
    speech.stop();
    return;
  }
  setInputMode(document.getElementById('input-row').classList.contains('hidden'));
});

document.getElementById('send-button').addEventListener('click', () => {
  const textInput = document.getElementById('text-input');
  const text = textInput.value.trim();
  if (text) {
    requestAi({ type: 'text', data: text });
    textInput.value = '';
  }
});

document.getElementById('text-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    document.getElementById('send-button').click();
  }
});

// 현재 선택된 설정 시각화 업데이트
function updateSettingsUI() {
  // 기존 선택 해제
  document.querySelectorAll('.selected').forEach(el => el.classList.remove('selected'));

  const curPalette = localStorage.getItem('looktalk.palette') || 'mint';
  const curPersonality = localStorage.getItem('looktalk.personality') || 'calm';

  document.querySelector(`.palette-option[data-palette="${curPalette}"]`)?.classList.add('selected');
  document.querySelector(`.personality-option[data-personality="${curPersonality}"]`)?.classList.add('selected');

  Object.keys(appSettings).forEach(key => {
    document.querySelector(`.setting-pill[data-setting-key="${key}"][data-setting-value="${appSettings[key]}"]`)?.classList.add('selected');
  });
}

// ── 창 크기 자동 조절 최적화 ──
function updateWindowSize() {
  const isSettingsOpen = !settingsPanel.classList.contains('hidden');
  const isHistoryOpen = !historyDrawer.classList.contains('hidden');

  let targetWidth = 240;
  let targetHeight = 350;

  if (isSettingsOpen) {
    targetWidth = 400;
    targetHeight = 560;
  } else if (isHistoryOpen) {
    targetHeight = Math.max(350, widget.offsetHeight + 240);
  }

  window.lookTalkAPI.resizeWindow({ width: targetWidth, height: targetHeight });
}

// ── 설정 변경 이벤트 연결 ──
function setupSettings() {
  document.querySelectorAll('.palette-option').forEach(btn => {
    btn.addEventListener('click', (e) => {
      theme.applyPalette(e.target.dataset.palette);
      updateSettingsUI();
    });
  });

  document.querySelectorAll('.personality-option').forEach(btn => {
    btn.addEventListener('click', (e) => {
      localStorage.setItem('looktalk.personality', e.target.dataset.personality);
      updateSettingsUI();
    });
  });

  // 누락되었던 세부 설정(시간, 음성, 기록) 클릭 이벤트 연동
  document.querySelectorAll('.setting-pill').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const key = e.target.dataset.settingKey;
      let value = e.target.dataset.settingValue;

      // 문자열을 데이터 타입에 맞게 변환
      if (value === 'true') value = true;
      else if (value === 'false') value = false;
      else if (!isNaN(value)) value = Number(value);

      theme.saveSettings({ [key]: value });
      appSettings = theme.loadSettings(); // 동기화
      updateSettingsUI();
    });
  });
}

// ── 마우스 눈동자 추적 리스너 ──
if (window.lookTalkAPI.onMouseMoveExternal) {
  window.lookTalkAPI.onMouseMoveExternal((coords) => {
    ui.updateEyeGaze(coords.x, coords.y);
  });
}

// ── 메인 루프 및 초기화 ──
const tracker = new FaceTracker(video);
async function startApp() {
  try {
    await tracker.init();
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    video.srcObject = stream;
    video.onloadedmetadata = () => {
      video.play();
      history.load(appSettings.historyPersistenceEnabled);
      theme.applyPalette(localStorage.getItem('looktalk.palette') || 'mint');
      setupSettings();

      isAppReady = true;
      statusText.innerText = '준비 완료';
      statusText.style.color = '#60a5fa';
      ui.setRobotState(ROBOT_STATE.IDLE); // 초기 상태 설정

      loop();
    };
  } catch (err) {
    statusText.innerText = '카메라 에러';
    statusText.style.color = '#f87171';
  }
}

function loop() {
  if (!isAppReady) {
    requestAnimationFrame(loop);
    return;
  }
  const result = tracker.checkGaze();
  if (appSettings.voiceTriggerEnabled && result && result.handRaised) {
    if (!speech.isRecording && !isGeneratingResponse) {
      setInputMode(false);
      speech.start();
    }
  }
  requestAnimationFrame(loop);
}

startApp();