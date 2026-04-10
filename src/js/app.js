import { FaceTracker } from './faceTracker.js';
import { SpeechHandler } from './speechHandler.js';

const { ipcRenderer } = require('electron');

const widget = document.getElementById('widget');
const statusText = document.getElementById('status-text');
const speechBubble = document.getElementById('speech-bubble');
const video = document.getElementById('webcam');
const inputRow = document.getElementById('input-row');
const textInput = document.getElementById('text-input');
const sendButton = document.getElementById('send-button');
const toggleInputButton = document.getElementById('toggle-input-button');
let isGeneratingResponse = false;
let bubbleTimerId = null;
let isListeningSessionActive = false;

function showResponseBubble(text) {
  speechBubble.innerText = text;
  speechBubble.style.display = 'block';

  if (bubbleTimerId) {
    clearTimeout(bubbleTimerId);
  }

  // 한글 응답을 잠깐 보여준 뒤 자동으로 숨김
  bubbleTimerId = setTimeout(() => {
    speechBubble.style.display = 'none';
    speechBubble.innerText = '';
    bubbleTimerId = null;
  }, 5000);
}

function setGeneratingState(isGenerating) {
  // 한글 입력 중복 전송을 막기 위해 버튼과 입력창 상태를 함께 제어
  isGeneratingResponse = isGenerating;
  textInput.disabled = isGenerating;
  sendButton.disabled = isGenerating;
}

function updateRecordingIndicator() {
  // 한글 UI에서 녹음 중 상태를 테두리 색으로도 바로 알 수 있게 표시
  widget.classList.toggle('recording', isListeningSessionActive || speech.isRecording);
}

function setListeningSessionActive(isActive) {
  isListeningSessionActive = isActive;
  updateRecordingIndicator();

  if (isActive) {
    statusText.innerText = '🎙️ 듣는 중...';
    statusText.style.color = '#4ade80';
    return;
  }

  if (isGeneratingResponse) {
    return;
  }

  statusText.innerText = '준비 완료';
  statusText.style.color = '#60a5fa';
}

async function requestAiResponse(userText) {
  const trimmedText = userText.trim();

  if (trimmedText.length === 0 || isGeneratingResponse) {
    return;
  }

  setGeneratingState(true);
  statusText.innerText = 'AI 생각 중...';
  statusText.style.color = '#facc15';

  try {
    const response = await ipcRenderer.invoke('generate-ai-response', trimmedText);

    if (!response?.ok) {
      throw new Error(response?.error || 'AI 응답 생성에 실패했습니다.');
    }

    showResponseBubble(response.reply);
    statusText.innerText = '답변 완료';
    statusText.style.color = '#60a5fa';
  } catch (error) {
    console.error('❌ 렌더러 AI 요청 실패:', error);
    showResponseBubble('AI 응답을 가져오지 못했어요.');
    statusText.innerText = 'AI 응답 에러';
    statusText.style.color = '#f87171';
  } finally {
    // 다음 입력을 다시 받을 수 있도록 잠금을 해제
    setGeneratingState(false);
  }
}

// 1. 음성 인식기 생성
const speech = new SpeechHandler(
  async (text, isFinal) => {
    const trimmedText = text.trim();

    if (!isFinal) {
      return;
    }

    // 한 번 트리거에 한 번만 응답하도록 최종 인식 직후 녹음을 종료
    speech.stop();
    await requestAiResponse(trimmedText);
  },
  (isRecording) => {
    // 브라우저 STT의 실제 시작/종료 시점에만 세션 상태를 맞춤
    setListeningSessionActive(isRecording);
  }
);

// 2. 얼굴 추적기 생성
const tracker = new FaceTracker(video);

function toggleTextInput() {
  const isHidden = inputRow.classList.toggle('hidden');
  toggleInputButton.innerText = isHidden ? '입력' : '닫기';

  // 한글 텍스트 테스트를 바로 할 수 있게 열릴 때 포커스
  if (!isHidden) {
    textInput.focus();
    return;
  }

  textInput.value = '';
}

toggleInputButton.addEventListener('click', () => {
  toggleTextInput();
});

sendButton.addEventListener('click', async () => {
  await requestAiResponse(textInput.value);
  textInput.value = '';
});

textInput.addEventListener('keydown', async (event) => {
  if (event.key !== 'Enter') {
    return;
  }

  event.preventDefault();
  await requestAiResponse(textInput.value);
  textInput.value = '';
});

// 메인 루프 함수
function loop() {
  const result = tracker.checkGaze();

    if (result) {
      if (isListeningSessionActive || speech.isRecording) {
        statusText.innerText = "🎙️ 듣는 중...";
        statusText.style.color = "#4ade80";
      } else if (result.msg === "얼굴 없음") {
        statusText.innerText = "얼굴을 보여주세요";
        statusText.style.color = "gray";
      } else if (result.gazeActive && result.handRaised) {
        // 준비 완료 상태에서 손 제스처가 들어왔을 때만 실제 듣기 시작
        if (!isListeningSessionActive && !speech.isRecording && !speech.isStarting) {
          speech.start();
        }
      } else if (result.gazeActive) {
        if (!isListeningSessionActive && !speech.isRecording) {
          // 시선은 준비 상태만 표시하고, 실제 STT 시작 트리거로는 사용하지 않음
          statusText.innerText = "준비 완료";
          statusText.style.color = "#60a5fa";
        }
      } else {
        // 얼굴은 인식됐지만 준비 완료 조건이 아니면 바로 상태 반영
        if (!isListeningSessionActive && !speech.isRecording) {
          statusText.innerText = "준비 완료";
          statusText.style.color = "gray";
        }
      }
  }
  requestAnimationFrame(loop);
}

async function startApp() {
  try {
    console.log("🚀 앱 시작 시퀀스 가동...");
    statusText.innerText = "AI 로딩 중...";

    await tracker.init();
    console.log("✅ AI 모델 준비 완료");

    // 카메라 권한 요청 및 연결
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480 }
    });
    video.srcObject = stream;

    // ⭐️ 핵심: 비디오가 실제로 재생될 수 있는 상태가 되면 루프 시작
    video.onloadedmetadata = () => {
      video.play();
      console.log("🎥 카메라 재생 시작");
      statusText.innerText = "준비 완료!";
      loop(); // 루프 강제 시작
    };

  } catch (err) {
    statusText.innerText = "초기화 에러!";
    console.error("❌ 앱 시작 중 치명적 오류:", err);
  }
}

// 앱 실행
startApp();
