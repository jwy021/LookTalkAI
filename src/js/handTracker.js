import { HandLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3";

export class HandTracker {
    constructor(videoElement) {
        this.video = videoElement;
        this.handLandmarker = null;
        this.lastVideoTime = -1;
    }

    async init() {
        try {
            const filesetResolver = await FilesetResolver.forVisionTasks(
                "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
            );
            this.handLandmarker = await HandLandmarker.createFromOptions(filesetResolver, {
                baseOptions: {
                    modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
                    delegate: "GPU"
                },
                runningMode: "VIDEO",
                numHands: 1
            });
            console.log("✅ 손 인식 모델 로드 완료");
        } catch (error) {
            console.error("❌ 모델 로드 실패:", error);
        }
    }

    // 손이 올라갔는지 확인 (y값은 위로 갈수록 작아짐)
    isHandRaised() {
        if (!this.handLandmarker || this.video.currentTime === this.lastVideoTime) return false;
        this.lastVideoTime = this.video.currentTime;

        const results = this.handLandmarker.detectForVideo(this.video, performance.now());

        if (results.landmarks && results.landmarks.length > 0) {
            const hand = results.landmarks[0];
            // 손목(0번)이나 손가락 끝의 y값이 0.4(화면 상단 40%)보다 작으면 '들었다'고 판단
            const wristY = hand[0].y;
            return wristY < 0.4;
        }
        return false;
    }
}