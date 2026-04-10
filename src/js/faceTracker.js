import { FaceLandmarker, FilesetResolver, HandLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3";

export class FaceTracker {
    constructor(videoElement) {
        this.video = videoElement;
        this.faceLandmarker = null;
        this.handLandmarker = null;
        this.lastVideoTime = -1;
        this.activeDelegate = null;
        this.lastDebugLogTime = 0;
    }

    async init() {
        try {
            // WASM 로더 설정 (네트워크 에러 방지를 위해 최신 CDN 사용)
            const filesetResolver = await FilesetResolver.forVisionTasks(
                "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
            );

            await this.createLandmarkers(filesetResolver, "GPU");
            this.activeDelegate = "GPU";
            console.log("✅ 얼굴/손 모델 로드 성공 (delegate: GPU)");
        } catch (error) {
            console.warn("⚠️ GPU delegate 로드 실패, CPU로 재시도합니다:", error);

            try {
                const filesetResolver = await FilesetResolver.forVisionTasks(
                    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
                );

                await this.createLandmarkers(filesetResolver, "CPU");
                this.activeDelegate = "CPU";
                console.log("✅ 얼굴/손 모델 로드 성공 (delegate: CPU fallback)");
            } catch (fallbackError) {
                console.error("❌ AI 모델 로드 실패:", fallbackError);
                throw fallbackError; // 에러를 상위(app.js)로 던짐
            }
        }
    }

    async createLandmarkers(filesetResolver, delegate) {
        this.faceLandmarker = await this.createFaceLandmarker(filesetResolver, delegate);
        this.handLandmarker = await this.createHandLandmarker(filesetResolver, delegate);
    }

    async createFaceLandmarker(filesetResolver, delegate) {
        return FaceLandmarker.createFromOptions(filesetResolver, {
            baseOptions: {
                modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
                delegate
            },
            runningMode: "VIDEO",
            numFaces: 1
        });
    }

    async createHandLandmarker(filesetResolver, delegate) {
        return HandLandmarker.createFromOptions(filesetResolver, {
            baseOptions: {
                modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
                delegate
            },
            runningMode: "VIDEO",
            numHands: 2
        });
    }

    logDebug(message, extra = null) {
        const now = performance.now();

        // 한글 로그가 너무 많이 쌓이지 않도록 1초에 한 번만 출력
        if (now - this.lastDebugLogTime < 1000) return;

        this.lastDebugLogTime = now;

        if (extra) {
            console.log(`[FaceTracker] ${message}`, extra);
            return;
        }

        console.log(`[FaceTracker] ${message}`);
    }

    isHandRaised(handLandmarks, faceLandmarks) {
        if (!handLandmarks || handLandmarks.length === 0) {
            return false;
        }

        return handLandmarks.some((hand) => {
            const wrist = hand[0];
            const xs = hand.map((landmark) => landmark.x);
            const ys = hand.map((landmark) => landmark.y);
            const handWidth = Math.max(...xs) - Math.min(...xs);
            const handHeight = Math.max(...ys) - Math.min(...ys);
            const isInsideFrame = wrist.y < 0.98 && wrist.x > 0.01 && wrist.x < 0.99;
            const isHandVisibleEnough = handWidth > 0.08 || handHeight > 0.10;

            // 손이 얼마나 크게 잡히는지 확인하기 위한 한글 디버그 로그
            this.logDebug("손 검출 크기 확인", {
                handWidth: Number(handWidth.toFixed(3)),
                handHeight: Number(handHeight.toFixed(3)),
                isInsideFrame,
                isHandVisibleEnough
            });

            // 화면 안에 손이 어느 정도 보이기만 해도 손 들기로 간주
            return isInsideFrame && isHandVisibleEnough;
        });
    }

    checkGaze() {
        // 모델이 없거나 비디오 데이터가 아직 안 들어왔으면 스킵
        if (!this.faceLandmarker || !this.handLandmarker || this.video.readyState < 2) return null;
        if (this.video.currentTime === this.lastVideoTime) return null;

        this.lastVideoTime = this.video.currentTime;
        const timestamp = performance.now();

        const results = this.faceLandmarker.detectForVideo(this.video, timestamp);

        if (!results.faceLandmarks || results.faceLandmarks.length === 0) {
            // 얼굴 자체를 못 찾는 경우를 구분해서 확인
            this.logDebug(`얼굴 미검출 (delegate: ${this.activeDelegate ?? "unknown"})`);
            return { active: false, msg: "얼굴 없음" };
        }

        const landmarks = results.faceLandmarks[0];
        const handResults = this.handLandmarker.detectForVideo(this.video, timestamp);
        const nose = landmarks[1];
        const leftCheek = landmarks[234];
        const rightCheek = landmarks[454];
        const forehead = landmarks[10];
        const chin = landmarks[152];

        const yawRatio = (nose.x - leftCheek.x) / (rightCheek.x - nose.x);
        const pitchRatio = (nose.y - forehead.y) / (chin.y - nose.y);

        // 위젯 위치 대신 카메라 정면을 보는지 기준으로 판별
        let matchX = yawRatio >= 0.6 && yawRatio <= 1.5;
        let matchY = pitchRatio >= 0.75 && pitchRatio <= 1.18;
        const gazeActive = matchX && matchY;
        const handRaised = this.isHandRaised(handResults?.landmarks, landmarks);

        if (!gazeActive && !handRaised) {
            // 얼굴은 잡혔지만 시선/손 모두 조건을 만족하지 않으면 로그로 남김
            this.logDebug("얼굴 검출됨, 시선 판별 불일치", {
                delegate: this.activeDelegate ?? "unknown",
                yawRatio: Number(yawRatio.toFixed(3)),
                pitchRatio: Number(pitchRatio.toFixed(3)),
                matchX,
                matchY,
                handRaised
            });
        }

        if (handRaised) {
            this.logDebug("손 들기 제스처 감지", {
                delegate: this.activeDelegate ?? "unknown",
                yawRatio: Number(yawRatio.toFixed(3)),
                pitchRatio: Number(pitchRatio.toFixed(3))
            });
        }

        return {
            active: gazeActive || handRaised,
            msg: "OK",
            trigger: handRaised && !gazeActive ? "hand" : "gaze",
            gazeActive,
            handRaised
        };
    }
}
