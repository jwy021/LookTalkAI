import { FaceTracker } from './faceTracker.js';
import { SpeechHandler } from './speechHandler.js';

const statusText = document.getElementById('status-text');
const video = document.getElementById('webcam');

// 1. 음성 인식기 생성
const speech = new SpeechHandler((text) => {
  statusText.innerText = text;
});

// 2. 얼굴 추적기 생성
const tracker = new FaceTracker(video);

// 메인 실행 함수
async function startApp() {
  try {
    statusText.innerText = "AI 로딩 중...";

    // AI 모델 로드 대기
    await tracker.init();

    // 카메라 켜기
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    video.srcObject = stream;

    // 비디오 로드 완료 시 루프 시작
    video.onloadeddata = () => {
      console.log("🎥 카메라 재생 시작");
      statusText.innerText = "준비 완료!";
      loop();
    };
    video.play(); // 명시적 실행

  } catch (err) {
    statusText.innerText = "에러 발생!";
    console.error(err);
  }
}

// 루프 함수
function loop() {
  const result = tracker.checkGaze();

  if (result) {
    if (result.msg === "얼굴 없음") {
      statusText.innerText = "얼굴을 보여주세요";
      statusText.style.color = "gray";
      speech.stop();
    } else if (result.active) {
      if (!speech.isRecording) {
        statusText.innerText = "🎙️ 듣는 중...";
        statusText.style.color = "#4ade80";
        speech.start();
      }
    } else {
      if (speech.isRecording) {
        statusText.innerText = "딴 곳 보는 중";
        statusText.style.color = "gray";
        speech.stop();
      }
    }
  }
  requestAnimationFrame(loop);
}

// ⭐️ 함수 이름을 startApp()으로 정확히 호출!
startApp();