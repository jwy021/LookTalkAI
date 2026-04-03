import { FaceTracker } from './faceTracker.js';
import { SpeechHandler } from './speechHandler.js';

const statusText = document.getElementById('status-text');
const speechBubble = document.getElementById('speech-bubble');
const video = document.getElementById('webcam');

// 1. 음성 인식기 생성
const speech = new SpeechHandler((text) => {
  // 음성 데이터가 들어올 때만 말풍선을 노출
  if (text.trim().length > 0) {
    speechBubble.innerText = text;
    speechBubble.style.display = 'block';
  }
});

// 2. 얼굴 추적기 생성
const tracker = new FaceTracker(video);

// 메인 루프 함수
function loop() {
  const result = tracker.checkGaze();

  if (result) {
    if (result.msg === "얼굴 없음") {
      statusText.innerText = "얼굴을 보여주세요";
      statusText.style.color = "gray";
      speechBubble.style.display = 'none';
      speech.stop();
    } else if (result.active) {
      // 바라보고 있을 때
      if (!speech.isRecording) {
        statusText.innerText = "🎙️ 듣는 중...";
        statusText.style.color = "#4ade80";
        speechBubble.innerText = "듣고 있어요...";
        speechBubble.style.display = 'block';
        speech.start();
      }
    } else {
      // 딴 곳을 볼 때
      if (speech.isRecording) {
        statusText.innerText = "딴 곳 보는 중";
        statusText.style.color = "gray";
        speechBubble.style.display = 'none'; // 시선 돌리면 즉시 숨김
        speechBubble.innerText = "";
        speech.stop();
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