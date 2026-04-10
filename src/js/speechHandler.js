export class SpeechHandler {
    constructor(onResultCallback, onStateChangeCallback = null) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        this.recognition = new SpeechRecognition();
        this.recognition.lang = 'ko-KR';
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.isRecording = false;
        this.isStarting = false;
        this.onStateChangeCallback = onStateChangeCallback;

        this.recognition.onresult = (event) => {
            const result = event.results[event.results.length - 1];
            const text = result[0].transcript;

            // 한글 중간 결과와 최종 결과를 구분해서 상위로 전달
            onResultCallback(text, result.isFinal);
        };

        this.recognition.onstart = () => {
            this.isStarting = false;
            this.isRecording = true;
            this.onStateChangeCallback?.(true);
        };

        this.recognition.onend = () => {
            this.isStarting = false;
            this.isRecording = false;
            this.onStateChangeCallback?.(false);
        };

        this.recognition.onerror = () => {
            this.isStarting = false;
        };
    }

    start() {
        if (this.isRecording || this.isStarting) {
            return false;
        }

        this.isStarting = true;

        try {
            this.recognition.start();
            return true;
        } catch (e) {
            this.isStarting = false;
            return false;
        }
    }

    stop() {
        if (!this.isRecording && !this.isStarting) {
            return false;
        }

        try {
            this.recognition.stop();
            return true;
        } catch (e) {
            return false;
        }
    }
}
