import { HandTracker } from './handTracker.js';
import { SpeechHandler } from './speechHandler.js';

const statusText = document.getElementById('status-text');
const speechBubble = document.getElementById('speech-bubble');
const video = document.getElementById('webcam');

const speech = new SpeechHandler((text) => {
  if (text.trim().length > 0) {
    speechBubble.innerText = text;
    speechBubble.style.display = 'block';
  }
});

const tracker = new HandTracker(video);
let recordingTimer = null;
const RECORDING_DURATION = 5000; // 5초 동안 인식

function startRecordingSession() {
  if (speech.isRecording) return; // 이미 인식 중이면 무시

  statusText.innerText = "🎙️ 듣는 중 (5초)...";
  statusText.style.color = "#4ade80";
  speechBubble.innerText = "말씀하세요!";
  speechBubble.style.display = 'block';
  speech.start();

  // 5초 뒤에 자동으로 종료
  recordingTimer = setTimeout(() => {
    stopRecordingSession();
  }, RECORDING_DURATION);
}

function stopRecordingSession() {
  statusText.innerText = "손을 들면 시작합니다";
  statusText.style.color = "gray";
  speechBubble.style.display = 'none';
  speech.stop();
  recordingTimer = null;
}

function loop() {
  // 이미 녹음 중이면 손 위치를 체크하지 않고 대기
  if (!speech.isRecording) {
    if (tracker.isHandRaised()) {
      console.log("✋ 손 들기 감지됨!");
      startRecordingSession();
    }
  }
  requestAnimationFrame(loop);
}

async function startApp() {
  try {
    statusText.innerText = "손 인식 로딩 중...";
    await tracker.init();

    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    video.srcObject = stream;
    video.onloadedmetadata = () => {
      video.play();
      statusText.innerText = "준비 완료 (손을 드세요)";
      loop();
    };
  } catch (err) {
    console.error(err);
  }
}

startApp();