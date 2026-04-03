export class SpeechHandler {
    constructor(onResultCallback) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        this.recognition = new SpeechRecognition();
        this.recognition.lang = 'ko-KR';
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.isRecording = false;
        this.isNetworkError = false; // ⭐️ 네트워크 차단 상태 확인용 변수

        this.recognition.onresult = (event) => {
            let interimTranscript = '';
            let finalTranscript = '';

            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript;
                } else {
                    interimTranscript += event.results[i][0].transcript;
                }
            }

            const text = finalTranscript || interimTranscript;
            if (text.trim().length > 0) {
                onResultCallback(text);
            }
        };

        this.recognition.onend = () => {
            // ⭐️ 일반적인 종료일 때만 바로 재시작 (네트워크 에러일 땐 onerror에서 처리)
            if (this.isRecording && !this.isNetworkError) {
                try { this.recognition.start(); } catch (e) { }
            }
        };

        this.recognition.onerror = (event) => {
            console.warn("🎤 STT 에러 발생:", event.error);

            // 구글 서버 차단 방어
            if (event.error === 'network' || event.error === 'not-allowed') {
                this.isNetworkError = true;
                this.isRecording = false; // 일단 녹음 상태를 강제로 끕니다

                const bubble = document.getElementById('speech-bubble');
                if (bubble) bubble.innerText = "서버 연결 지연 중... (잠시 후 다시 시도합니다)";

                // ⭐️ 3초(3000ms) 대기 후 네트워크 에러 상태 초기화 (서버 화 달래기)
                setTimeout(() => {
                    this.isNetworkError = false;
                }, 3000);
            }
        };
    }

    start() {
        if (!this.isRecording) {
            this.isRecording = true;
            this.isNetworkError = false;
            try { this.recognition.start(); } catch (e) { }
        }
    }

    stop() {
        if (this.isRecording) {
            this.isRecording = false;
            try { this.recognition.stop(); } catch (e) { }
        }
    }
}