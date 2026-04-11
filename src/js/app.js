import { FaceTracker } from './faceTracker.js';
import { SpeechHandler } from './speechHandler.js';
const { ipcRenderer } = require('electron');

// ── DOM 요소 캐싱 ──
// UI 요소 가져오기
const widget = document.getElementById('widget');
const statusText = document.getElementById('status-text');
const speechBubble = document.getElementById('speech-bubble');
const video = document.getElementById('webcam');
const inputRow = document.getElementById('input-row');
const textInput = document.getElementById('text-input');
const sendButton = document.getElementById('send-button');
const sendIcon = document.getElementById('send-icon');
const sendSpinner = document.getElementById('send-spinner');
const toggleInputButton = document.getElementById('toggle-input-button');
const toggleHistoryButton = document.getElementById('toggle-history-button');
const historyDrawer = document.getElementById('history-drawer');
const historyList = document.getElementById('history-list');
const clearHistoryButton = document.getElementById('clear-history-button');
const settingsPanel = document.getElementById('settings-panel');
const paletteOptions = Array.from(document.querySelectorAll('.palette-option'));
const personalityOptions = Array.from(document.querySelectorAll('.personality-option'));
const settingPills = Array.from(document.querySelectorAll('.setting-pill'));
const leftEye = document.getElementById('left-eye');
const rightEye = document.getElementById('right-eye');
const leftPupil = document.getElementById('left-pupil');
const rightPupil = document.getElementById('right-pupil');
const robotFace = document.getElementById('robot-face');
const antennaBall = document.getElementById('antenna-ball');
const mouthShape = document.getElementById('mouth-shape');


let isGeneratingResponse = false;
let bubbleTimerId = null;
let isListeningSessionActive = false;
let blinkIntervalId = null;
let typingTimerId = null;
let conversationHistory = [];
let isSpeechTriggerLocked = false;
let currentPalette = 'mint';
let currentPersonality = 'calm';
let cameraStream = null;
let hasStartedLoop = false;
let handRaisedSince = 0;
let speechTriggerCooldownUntil = 0;

const historyStorageKey = 'looktalk.history';
const settingsStorageKey = 'looktalk.settings';
const handTriggerHoldMs = 350;
const handTriggerCooldownMs = 1500;
const defaultSettings = {
  bubbleDurationMs: 5000,
  responseLength: 'short',
  voiceTriggerEnabled: true,
  historyPersistenceEnabled: true
};
let appSettings = { ...defaultSettings };

const paletteThemes = {
  mint: {
    body: '#24313a',
    face: '#182127',
    accent: '#38d6b5',
    accentGlow: 'rgba(56, 214, 181, 0.35)',
    cheek: 'rgba(255, 146, 122, 0.35)'
  },
  coral: {
    body: '#3a2a30',
    face: '#24171c',
    accent: '#ff7d7d',
    accentGlow: 'rgba(255, 125, 125, 0.35)',
    cheek: 'rgba(255, 189, 171, 0.38)'
  },
  lemon: {
    body: '#353127',
    face: '#221f17',
    accent: '#f4cf4f',
    accentGlow: 'rgba(244, 207, 79, 0.35)',
    cheek: 'rgba(255, 177, 108, 0.34)'
  },
  blue: {
    body: '#243245',
    face: '#17212e',
    accent: '#5eb6ff',
    accentGlow: 'rgba(94, 182, 255, 0.35)',
    cheek: 'rgba(255, 166, 166, 0.28)'
  }
};

// 세션 대화는 렌더러 메모리에만 보관한다.
function escapeHtml(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function saveConversationHistory() {
  if (!appSettings.historyPersistenceEnabled) {
    localStorage.removeItem(historyStorageKey);
    return;
  }

  localStorage.setItem(historyStorageKey, JSON.stringify(conversationHistory.slice(-30)));
}

function addConversationMessage(role, text) {
  const trimmedText = text.trim();
  if (!trimmedText) return;

  conversationHistory.push({ role, text: trimmedText });
  renderConversationHistory();
  saveConversationHistory();
}

function renderConversationHistory() {
  if (conversationHistory.length === 0) {
    historyList.innerHTML = '<p class="history-empty">대화가 아직 없어요.</p>';
    return;
  }

  historyList.innerHTML = conversationHistory
    .map(({ role, text }) => {
      const roleLabel = role === 'user' ? '나' : 'AI';
      const bubbleClass = role === 'user' ? 'user' : 'assistant';
      return `
        <div class="history-item ${bubbleClass}">
          <span class="history-role">${roleLabel}</span>
          <p class="history-message">${escapeHtml(text)}</p>
        </div>
      `;
    })
    .join('');

  historyList.scrollTop = historyList.scrollHeight;
}

function toggleHistoryDrawer() {
  const willOpen = historyDrawer.classList.contains('hidden');
  historyDrawer.classList.toggle('hidden', !willOpen);
  widget.setAttribute('data-history-open', willOpen ? 'true' : 'false');
  ipcRenderer.send('set-history-drawer-open', willOpen);
}

function updateAppSetting(key, value) {
  appSettings = {
    ...appSettings,
    [key]: value
  };
  localStorage.setItem(settingsStorageKey, JSON.stringify(appSettings));
}

function updateSelectionState(buttons, selectedValue, attributeName) {
  buttons.forEach((button) => {
    const isSelected = button.dataset[attributeName] === selectedValue;
    button.classList.toggle('selected', isSelected);
  });
}

function updateSettingSelectionState(key) {
  settingPills.forEach((button) => {
    const isSameSetting = button.dataset.settingKey === key;
    if (!isSameSetting) return;

    let normalizedValue = button.dataset.settingValue;
    if (normalizedValue === 'true') normalizedValue = true;
    if (normalizedValue === 'false') normalizedValue = false;
    if (['3000', '5000', '8000'].includes(button.dataset.settingValue)) {
      normalizedValue = Number(button.dataset.settingValue);
    }

    button.classList.toggle('selected', appSettings[key] === normalizedValue);
  });
}

function applyPalette(paletteName) {
  const theme = paletteThemes[paletteName] || paletteThemes.mint;
  currentPalette = paletteName in paletteThemes ? paletteName : 'mint';

  // CSS 변수만 바꿔서 팔레트를 즉시 반영한다.
  document.documentElement.style.setProperty('--robot-body', theme.body);
  document.documentElement.style.setProperty('--robot-face', theme.face);
  document.documentElement.style.setProperty('--accent', theme.accent);
  document.documentElement.style.setProperty('--accent-glow', theme.accentGlow);
  document.documentElement.style.setProperty('--cheek', theme.cheek);
  updateSelectionState(paletteOptions, currentPalette, 'palette');
  localStorage.setItem('looktalk.palette', currentPalette);
}

function applyPersonality(personality) {
  currentPersonality = personality || 'calm';
  updateSelectionState(personalityOptions, currentPersonality, 'personality');
  localStorage.setItem('looktalk.personality', currentPersonality);
}

function toggleSettingsPanel() {
  const willOpen = settingsPanel.classList.contains('hidden');
  settingsPanel.classList.toggle('hidden', !willOpen);
  ipcRenderer.send('set-settings-panel-open', willOpen);
}

function loadSavedSettings() {
  const savedPalette = localStorage.getItem('looktalk.palette') || 'mint';
  const savedPersonality = localStorage.getItem('looktalk.personality') || 'calm';
  const savedSettings = JSON.parse(localStorage.getItem(settingsStorageKey) || 'null');
  appSettings = {
    ...defaultSettings,
    ...(savedSettings || {})
  };
  applyPalette(savedPalette);
  applyPersonality(savedPersonality);
  updateSettingSelectionState('responseLength');
  updateSettingSelectionState('bubbleDurationMs');
  updateSettingSelectionState('voiceTriggerEnabled');
  updateSettingSelectionState('historyPersistenceEnabled');
}

function loadConversationHistory() {
  if (!appSettings.historyPersistenceEnabled) {
    conversationHistory = [];
    renderConversationHistory();
    return;
  }

  const savedHistory = JSON.parse(localStorage.getItem(historyStorageKey) || '[]');
  conversationHistory = Array.isArray(savedHistory) ? savedHistory : [];
  renderConversationHistory();
}

async function startCameraStream() {
  if (cameraStream) {
    return;
  }

  // 음성 트리거가 켜졌을 때만 카메라를 다시 연다.
  cameraStream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480 }
  });

  video.srcObject = cameraStream;
  await video.play();
  console.log('🎥 카메라 재생 시작');
}

function stopCameraStream() {
  if (!cameraStream) {
    return;
  }

  cameraStream.getTracks().forEach((track) => track.stop());
  cameraStream = null;
  video.pause();
  video.srcObject = null;
}

// 준비 가능 여부를 안테나 색으로만 표시한다.
function setReadinessState(isReady) {
  widget.setAttribute('data-ready', isReady ? 'ready' : 'not-ready');
}

// ══════════════════════════════════════════════
// 로봇 상태 관리 (바운스 트랜지션 포함)
// ══════════════════════════════════════════════
let currentState = 'idle';

function setRobotState(state) {
  if (currentState === state) return;

  currentState = state;
  widget.setAttribute('data-state', state);

  // 상태 전환 시 바운스 효과
  robotFace.classList.remove('bounce');
  void robotFace.offsetWidth; // reflow 트리거
  robotFace.classList.add('bounce');
}

// ══════════════════════════════════════════════
// 눈 깜빡임
// ══════════════════════════════════════════════
function blink() {
  const s = currentState;
  if (s === 'happy' || s === 'error' || s === 'sleeping') return;

  leftEye.classList.add('blink');
  rightEye.classList.add('blink');
  setTimeout(() => {
    leftEye.classList.remove('blink');
    rightEye.classList.remove('blink');
  }, 150);
}

function startBlinking() {
  if (blinkIntervalId) return;

  function scheduleNextBlink() {
    const delay = 2000 + Math.random() * 3000;
    blinkIntervalId = setTimeout(() => {
      blink();
      scheduleNextBlink();
    }, delay);
  }
  scheduleNextBlink();
}

// ══════════════════════════════════════════════
// 마우스 시선 추적 (전역 – IPC 기반)
// ══════════════════════════════════════════════
const MAX_PUPIL_OFFSET = 6;

function updatePupilPosition(mouseX, mouseY) {
  // 특수 상태에서는 CSS 애니메이션에 맡김
  if (currentState === 'thinking' || currentState === 'error' ||
    currentState === 'happy' || currentState === 'sleeping') {
    return;
  }

  [
    { eye: leftEye, pupil: leftPupil },
    { eye: rightEye, pupil: rightPupil }
  ].forEach(({ eye, pupil }) => {
    const rect = eye.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    let dx = mouseX - centerX;
    let dy = mouseY - centerY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > 0) {
      // 거리가 멀어도 최대 오프셋까지만 이동
      const clampedDistance = Math.min(distance, 200);
      const ratio = clampedDistance / 200;
      dx = (dx / distance) * MAX_PUPIL_OFFSET * ratio;
      dy = (dy / distance) * MAX_PUPIL_OFFSET * ratio;
    }

    pupil.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
  });
}

// 메인 프로세스에서 전역 커서 좌표를 받아서 눈동자 추적 (창 밖에서도 동작)
ipcRenderer.on('cursor-position', (_event, pos) => {
  updatePupilPosition(pos.x, pos.y);
});

// ══════════════════════════════════════════════
// 말풍선 타이핑 효과
// ══════════════════════════════════════════════
function showResponseBubble(text, onTypingComplete) {
  if (typingTimerId) {
    clearTimeout(typingTimerId);
    typingTimerId = null;
  }
  if (bubbleTimerId) {
    clearTimeout(bubbleTimerId);
    bubbleTimerId = null;
  }

  speechBubble.innerHTML = '<span class="typing-cursor"></span>';
  speechBubble.style.display = 'block';

  requestAnimationFrame(() => {
    speechBubble.classList.add('visible');
  });

  let charIndex = 0;
  const chars = [...text]; // 한글 안전 분리

  function typeNext() {
    if (charIndex < chars.length) {
      const cursor = speechBubble.querySelector('.typing-cursor');
      if (cursor) {
        cursor.insertAdjacentText('beforebegin', chars[charIndex]);
      } else {
        speechBubble.textContent += chars[charIndex];
      }
      charIndex++;
      typingTimerId = setTimeout(typeNext, 35 + Math.random() * 25);
    } else {
      // 타이핑 완료 → 커서 제거
      const cursor = speechBubble.querySelector('.typing-cursor');
      if (cursor) cursor.remove();
      typingTimerId = null;
      if (typeof onTypingComplete === 'function') {
        onTypingComplete();
      }

      bubbleTimerId = setTimeout(() => {
        speechBubble.classList.remove('visible');
        setTimeout(() => {
          speechBubble.style.display = 'none';
          speechBubble.innerHTML = '';
        }, 400);
        bubbleTimerId = null;
      }, appSettings.bubbleDurationMs);
    }
  }

  typingTimerId = setTimeout(typeNext, 200);
}

// ══════════════════════════════════════════════
// 전송 버튼 로딩 스피너
// ══════════════════════════════════════════════
function setSendButtonLoading(isLoading) {
  if (isLoading) {
    sendIcon.classList.add('hidden');
    sendSpinner.classList.remove('hidden');
  } else {
    sendIcon.classList.remove('hidden');
    sendSpinner.classList.add('hidden');
  }
}

function setGeneratingState(isGenerating) {
  isGeneratingResponse = isGenerating;
  textInput.disabled = isGenerating;
  sendButton.disabled = isGenerating;
  setSendButtonLoading(isGenerating);
}

// ══════════════════════════════════════════════
// 볼륨 반응 (듣는 중)
// ══════════════════════════════════════════════
function handleVolumeChange(rms) {
  if (currentState !== 'listening') return;

  const normalized = Math.min(rms / 0.15, 1);

  // 입 크기 – 볼륨에 따라 scaleY
  const mouthScale = 0.5 + normalized * 0.8;
  mouthShape.style.transform = `scaleY(${mouthScale.toFixed(2)})`;

  // 안테나 볼 – 볼륨에 따라 크기
  const ballScale = 1 + normalized * 0.5;
  antennaBall.style.transform = `scale(${ballScale.toFixed(2)})`;
}

function resetVolumeEffects() {
  mouthShape.style.transform = '';
  antennaBall.style.transform = '';
}

// ══════════════════════════════════════════════
// 상태 전환 헬퍼
// ══════════════════════════════════════════════
function setListeningSessionActive(isActive) {
  isListeningSessionActive = isActive;

  if (isActive) {
    setRobotState('listening');
    statusText.innerText = '';
    statusText.style.color = 'transparent';
    return;
  }

  resetVolumeEffects();

  if (isGeneratingResponse) {
    return;
  }

  setRobotState('idle');
  setReadinessState(false);
  statusText.innerText = '';
  statusText.style.color = 'transparent';
}

async function requestAiResponse(userText) {
  const trimmedText = userText.trim();

  if (trimmedText.length === 0 || isGeneratingResponse) {
    return;
  }

  // 사용자 발화도 같은 세션 서랍에 남긴다.
  addConversationMessage('user', trimmedText);
  // 답변 타이핑이 끝날 때까지 음성 트리거를 잠근다.
  isSpeechTriggerLocked = true;
  setGeneratingState(true);
  setRobotState('thinking');
  statusText.innerText = '';
  statusText.style.color = 'transparent';

  try {
    const response = await ipcRenderer.invoke('generate-ai-response', {
      userText: trimmedText,
      personality: currentPersonality,
      responseLength: appSettings.responseLength
    });

    if (!response?.ok) {
      throw new Error(response?.error || 'AI 응답 생성에 실패했습니다.');
    }

    showResponseBubble(response.reply, () => {
      isSpeechTriggerLocked = false;
    });
    addConversationMessage('assistant', response.reply);
    setRobotState('happy');
    statusText.innerText = '';
    statusText.style.color = 'transparent';

    setTimeout(() => {
      if (currentState === 'happy') {
        setRobotState('idle');
        statusText.innerText = '';
        statusText.style.color = 'transparent';
      }
    }, 3500);
  } catch (error) {
    console.error('❌ 렌더러 AI 요청 실패:', error);
    showResponseBubble('으앙... 오류가 났어요 😢', () => {
      isSpeechTriggerLocked = false;
    });
    setRobotState('error');
    statusText.innerText = '';
    statusText.style.color = 'transparent';

    setTimeout(() => {
      if (currentState === 'error') {
        setRobotState('idle');
        statusText.innerText = '';
        statusText.style.color = 'transparent';
      }
    }, 3000);
  } finally {
    setGeneratingState(false);
  }
}

// 입력 상태 제어
function setGeneratingState(isGenerating) {
  isGeneratingResponse = isGenerating;
  textInput.disabled = isGenerating;
  sendButton.disabled = isGenerating;
  // AI가 응답 중일 때는 입력창을 닫아주는 것이 UX상 깔끔합니다.
  if (isGenerating) setInputMode(false);
}

// 2. 음성 핸들러 설정
const speech = new SpeechHandler(
  (base64Data, mimeType) => {
    // ✅ 중단 버튼을 눌러서 멈춘 경우라면 AI에게 요청하지 않음
    if (isAborted) {
      console.log('[App] 음성 인식 취소됨: 대기 상태로 전환합니다.');
      isAborted = false; // 플래그 초기화
      return;
    }
    requestAi({ type: 'audio', data: base64Data, mimeType });
  },
  (isRecording) => {
    widget.classList.toggle('recording', isRecording);

    if (isRecording) {
      statusText.innerText = '🎙️ 듣는 중...';
      statusText.style.color = '#4ade80';

      // ✅ 마이크 사용 중일 때 버튼을 '중단'으로 변경
      toggleInputButton.innerText = '중단';
      toggleInputButton.style.backgroundColor = '#f87171'; // 중단 느낌의 빨간색 계열
    } else {
      // 녹음이 끝나면 다시 상태 확인 후 복구
      if (!isGeneratingResponse) {
        statusText.innerText = '준비 완료';
        statusText.style.color = '#60a5fa';
      }

      // 입력창이 닫혀있는 상태라면 다시 '입력'으로, 열려있다면 '닫기'로 복구
      const isTextInputActive = !inputRow.classList.contains('hidden');
      toggleInputButton.innerText = isTextInputActive ? '닫기' : '입력';
      toggleInputButton.style.backgroundColor = '';
    }
    setListeningSessionActive(isRecording);
  },
  (rms) => {
    handleVolumeChange(rms);
  }
);

// ══════════════════════════════════════════════
// 얼굴 추적기
// ══════════════════════════════════════════════
const tracker = new FaceTracker(video);

// ══════════════════════════════════════════════
// 입력 UI 이벤트
// ══════════════════════════════════════════════
function toggleTextInput() {
  const isHidden = inputRow.classList.toggle('hidden');

  if (!isHidden) {
    textInput.focus();
    return;
  }

  textInput.value = '';
}

toggleHistoryButton.addEventListener('click', () => {
  toggleHistoryDrawer();
});

toggleInputButton.addEventListener('click', () => {
  toggleTextInput();
});

clearHistoryButton.addEventListener('click', () => {
  conversationHistory = [];
  renderConversationHistory();
  saveConversationHistory();
});

// 얼굴을 누르면 설정 패널을 토글한다.
robotFace.addEventListener('click', (event) => {
  event.stopPropagation();
  toggleSettingsPanel();
});

paletteOptions.forEach((button) => {
  button.addEventListener('click', () => {
    applyPalette(button.dataset.palette);
  });
});

personalityOptions.forEach((button) => {
  button.addEventListener('click', () => {
    applyPersonality(button.dataset.personality);
  });
});

settingPills.forEach((button) => {
  button.addEventListener('click', async () => {
    const { settingKey, settingValue } = button.dataset;
    let normalizedValue = settingValue;

    if (settingValue === 'true') normalizedValue = true;
    if (settingValue === 'false') normalizedValue = false;
    if (['3000', '5000', '8000'].includes(settingValue)) {
      normalizedValue = Number(settingValue);
    }

    updateAppSetting(settingKey, normalizedValue);
    updateSettingSelectionState(settingKey);

    if (settingKey === 'historyPersistenceEnabled') {
      if (!normalizedValue) {
        conversationHistory = [];
        renderConversationHistory();
      }
      saveConversationHistory();
    }

    if (settingKey === 'voiceTriggerEnabled') {
      handRaisedSince = 0;
      speechTriggerCooldownUntil = 0;

      if (!normalizedValue) {
        speech.stop();
        stopCameraStream();
        setReadinessState(false);
        setRobotState('idle');
      } else {
        try {
          await startCameraStream();
        } catch (error) {
          console.error('❌ 카메라 재시작 실패:', error);
          updateAppSetting('voiceTriggerEnabled', false);
          updateSettingSelectionState('voiceTriggerEnabled');
          stopCameraStream();
        }
      }
    }
  });
});

document.addEventListener('click', (event) => {
  if (settingsPanel.classList.contains('hidden')) return;
  if (settingsPanel.contains(event.target) || robotFace.contains(event.target)) return;
  settingsPanel.classList.add('hidden');
  ipcRenderer.send('set-settings-panel-open', false);
});

sendButton.addEventListener('click', async () => {
  await requestAiResponse(textInput.value);
  textInput.value = '';
});

textInput.addEventListener('keydown', async (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  await requestAiResponse(textInput.value);
  textInput.value = '';
});

// ══════════════════════════════════════════════
// 메인 루프
// ══════════════════════════════════════════════
function loop() {
  if (!appSettings.voiceTriggerEnabled) {
    handRaisedSince = 0;
    if (!isGeneratingResponse && !speech.isRecording) {
      setRobotState('idle');
      setReadinessState(false);
    }
    requestAnimationFrame(loop);
    return;
  }

  const result = tracker.checkGaze();
  const now = performance.now();

  if (result) {
    if (isListeningSessionActive || speech.isRecording) {
      // 듣는 중 상태는 setListeningSessionActive에서 관리
      handRaisedSince = 0;
    } else if (result.msg === "얼굴 없음") {
      handRaisedSince = 0;
      if (currentState !== 'thinking' &&
        currentState !== 'happy' &&
        currentState !== 'error') {
        setRobotState('sleeping');
        setReadinessState(false);
        statusText.innerText = '';
        statusText.style.color = 'transparent';
      }
    } else if (result.gazeActive && result.handRaised) {
      if (!handRaisedSince) {
        // 손이 잠깐 스쳐도 바로 켜지지 않게 유지 시간을 본다.
        handRaisedSince = now;
      }

      if (appSettings.voiceTriggerEnabled &&
        now >= speechTriggerCooldownUntil &&
        now - handRaisedSince >= handTriggerHoldMs &&
        !isListeningSessionActive &&
        !speech.isRecording &&
        !speech.isStarting &&
        !isGeneratingResponse &&
        !isSpeechTriggerLocked) {
        handRaisedSince = 0;
        speechTriggerCooldownUntil = now + handTriggerCooldownMs;
        speech.start();
      }
    } else if (result.gazeActive) {
      handRaisedSince = 0;
      if (!isListeningSessionActive && !speech.isRecording && !isGeneratingResponse) {
        setRobotState('idle');
        setReadinessState(true);
        statusText.innerText = '';
        statusText.style.color = 'transparent';
      }
    } else {
      handRaisedSince = 0;
      if (!isListeningSessionActive && !speech.isRecording && !isGeneratingResponse) {
        setRobotState('idle');
        setReadinessState(false);
        statusText.innerText = '';
        statusText.style.color = 'transparent';
      }
    }
  }
  requestAnimationFrame(loop);
}

// 4. 입력 모드 및 텍스트 제출 로직
function setInputMode(show) {
  if (show) {
    // 마이크 녹음 중이라면 즉시 중단 및 UI 초기화
    if (speech.isRecording) {
      isAborted = true;
      console.log('[App] 마이크 취소: 텍스트 모드로 전환합니다.');
      speech.stop();
      // speech.stop()이 호출되면 SpeechHandler 내부에서 onStateChange(false)를 실행하므로
      // 테두리(recording 클래스)는 자동으로 제거됩니다.
    }

    inputRow.classList.remove('hidden');
    toggleInputButton.innerText = '닫기';
    toggleInputButton.style.backgroundColor = '';

    // 약간의 지연 후 포커스를 주어야 Electron에서 확실히 인식됨
    setTimeout(() => textInput.focus(), 10);
  } else {
    inputRow.classList.add('hidden');
    if (!speech.isRecording) {
      toggleInputButton.innerText = '입력';
    }
    textInput.value = '';
    textInput.blur();
  }
}

function toggleTextInput() {
  const isCurrentlyHidden = inputRow.classList.contains('hidden');

  // ✅ 만약 마이크가 켜져 있는 상태에서 버튼(중단)을 누른 것이라면
  if (speech.isRecording) {
    speech.stop(); // 녹음 중단 (이후 SpeechHandler 콜백에 의해 '입력'으로 돌아감)
    return;
  }

  setInputMode(isCurrentlyHidden);
}

// ✅ 누락되었던 텍스트 제출 함수 추가
async function handleTextSubmit() {
  const text = textInput.value.trim();
  if (text && !isGeneratingResponse) {
    await requestAi({ type: 'text', data: text });
    textInput.value = '';
  }
}

toggleInputButton.addEventListener('click', toggleTextInput);
sendButton.addEventListener('click', handleTextSubmit); // 전송 버튼 연결

textInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    handleTextSubmit();
  }
});

// 5. 말풍선 표시
function showResponseBubble(text) {
  speechBubble.innerText = text;
  speechBubble.style.display = 'block';

  // 기존에 설정된 타이머가 있다면 초기화하는 로직을 추가하면 더 안정적입니다.
  if (window.bubbleTimeout) clearTimeout(window.bubbleTimeout);

  window.bubbleTimeout = setTimeout(() => {
    speechBubble.style.display = 'none';
    speechBubble.innerText = '';
  }, 7000); // 답변이 길 수 있으니 7초로 넉넉하게 설정
}

// 6. 앱 시작
// ══════════════════════════════════════════════
// 앱 시작
// ══════════════════════════════════════════════
async function startApp() {
  try {
    console.log("🚀 앱 시작 시퀀스 가동...");
    setRobotState('thinking');
    setReadinessState(false);
    statusText.innerText = '';
    statusText.style.color = 'transparent';

    await tracker.init();
    console.log("✅ AI 모델 준비 완료");
    if (appSettings.voiceTriggerEnabled) {
      await startCameraStream();
    }

    setRobotState('happy');
    statusText.innerText = '';
    statusText.style.color = 'transparent';

    setTimeout(() => {
      setRobotState('idle');
      setReadinessState(false);
      statusText.innerText = '';
      statusText.style.color = 'transparent';
    }, 2500);

    startBlinking();
    if (!hasStartedLoop) {
      hasStartedLoop = true;
      loop();
    }

  } catch (err) {
    setRobotState('error');
    setReadinessState(false);
    statusText.innerText = '';
    statusText.style.color = 'transparent';
    console.error("❌ 앱 시작 중 치명적 오류:", err);
  }
}

setReadinessState(false);
loadSavedSettings();
loadConversationHistory();
startApp();