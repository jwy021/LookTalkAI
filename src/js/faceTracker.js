import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3";

export class FaceTracker {
    constructor(videoElement) {
        this.video = videoElement;
        this.faceLandmarker = null;
        this.lastVideoTime = -1;
    }

    async init() {
        try {
            // WASM 로더 설정 (네트워크 에러 방지를 위해 최신 CDN 사용)
            const filesetResolver = await FilesetResolver.forVisionTasks(
                "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
            );

            this.faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
                baseOptions: {
                    modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
                    delegate: "GPU"
                },
                runningMode: "VIDEO",
                numFaces: 1
            });
            console.log("✅ AI 모델 로드 성공");
        } catch (error) {
            console.error("❌ AI 모델 로드 실패:", error);
            throw error; // 에러를 상위(app.js)로 던짐
        }
    }

    checkGaze() {
        // 모델이 없거나 비디오 데이터가 아직 안 들어왔으면 스킵
        if (!this.faceLandmarker || this.video.readyState < 2) return null;
        if (this.video.currentTime === this.lastVideoTime) return null;

        this.lastVideoTime = this.video.currentTime;

        const results = this.faceLandmarker.detectForVideo(this.video, performance.now());

        if (!results.faceLandmarks || results.faceLandmarks.length === 0) {
            return { active: false, msg: "얼굴 없음" };
        }

        const landmarks = results.faceLandmarks[0];
        const nose = landmarks[1];
        const leftCheek = landmarks[234];
        const rightCheek = landmarks[454];
        const forehead = landmarks[10];
        const chin = landmarks[152];

        const yawRatio = (nose.x - leftCheek.x) / (rightCheek.x - nose.x);
        const pitchRatio = (nose.y - forehead.y) / (chin.y - nose.y);

        const screenW = window.screen.availWidth;
        const screenH = window.screen.availHeight;
        const widgetX = window.screenX + 75;
        const widgetY = window.screenY + 75;

        const posX = widgetX / screenW;
        const posY = widgetY / screenH;

        let matchX = (posX < 0.35 && yawRatio > 1.4) || (posX > 0.65 && yawRatio < 0.7) || (posX >= 0.35 && posX <= 0.65 && yawRatio >= 0.7 && yawRatio <= 1.4);
        let matchY = (posY < 0.3 && pitchRatio < 0.9) || (posY > 0.7 && pitchRatio > 1.08) || (posY >= 0.3 && posY <= 0.7 && pitchRatio >= 0.9 && pitchRatio <= 1.1);

        return { active: matchX && matchY, msg: "OK" };
    }
}